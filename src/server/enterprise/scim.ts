import { randomUUID, timingSafeEqual } from 'crypto';
import { Router, json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import pino from 'pino';
import type { Logger } from 'pino';
import { z } from 'zod';
import type {
  DatabaseAdapter,
  EnterpriseBindingApi,
  EnterpriseConfig,
  EnterpriseUser,
  RateLimitConfig,
} from '../../types/index.js';

export interface ScimRouterConfig {
  db: DatabaseAdapter;
  enterprise: EnterpriseBindingApi;
  enterpriseConfig: EnterpriseConfig;
  rateLimiting?: RateLimitConfig;
  logger?: Logger;
}

const scimUserSchema = z.object({
  userName: z.string().min(1),
  externalId: z.string().min(1).optional(),
  active: z.boolean().optional(),
  name: z.record(z.string(), z.unknown()).optional(),
  emails: z.array(z.record(z.string(), z.unknown())).optional(),
  groups: z.array(z.union([
    z.string(),
    z.object({ value: z.string().optional(), display: z.string().optional() }).passthrough(),
  ])).optional(),
}).passthrough();

const scimPatchSchema = z.object({
  Operations: z.array(z.object({
    op: z.string().min(1),
    path: z.string().optional(),
    value: z.unknown().optional(),
  }).passthrough()),
}).passthrough();

const scimGroupSchema = z.object({
  displayName: z.string().min(1),
  externalId: z.string().optional(),
  members: z.array(z.object({
    value: z.string().optional(),
    display: z.string().optional(),
  }).passthrough()).optional(),
}).passthrough();

function tokenMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function scimError(res: Response, status: number, detail: string, scimType?: string) {
  return res.status(status).json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: String(status),
    detail,
    ...(scimType && { scimType }),
  });
}

function extractExternalSub(body: { externalId?: string; userName?: string }): string {
  return body.externalId || body.userName || '';
}

function getPathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

function normalizeGroups(groups: unknown): unknown[] | undefined {
  if (!Array.isArray(groups)) return undefined;
  return groups.map((group) => {
    if (typeof group === 'string') return group;
    if (group && typeof group === 'object') {
      const record = group as Record<string, unknown>;
      return record.display || record.value || record;
    }
    return group;
  });
}

function mapExternalAttrs(
  body: Record<string, unknown>,
  attributeMapping: Record<string, string> = {},
): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const [scimPath, attrKey] of Object.entries(attributeMapping)) {
    const value = getPathValue(body, scimPath);
    if (value !== undefined) attrs[attrKey] = value;
  }
  const groups = normalizeGroups(body.groups);
  if (groups) attrs.groups = groups;
  return attrs;
}

function toScimUser(user: EnterpriseUser) {
  const attrs = user.externalAttrs ?? {};
  const userName = typeof attrs.email === 'string' ? attrs.email : user.externalSub;
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: user.scimId || user.id,
    userName,
    externalId: user.externalSub,
    active: user.status === 'active',
    name: attrs.displayName ? { formatted: attrs.displayName } : undefined,
    groups: attrs.groups,
    meta: {
      resourceType: 'User',
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
    },
  };
}

function toScimGroup(group: { id: string; displayName: string; members: Array<Record<string, unknown>> }) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
    id: group.id,
    displayName: group.displayName,
    members: group.members,
    meta: { resourceType: 'Group' },
  };
}

async function getByScimOrId(db: DatabaseAdapter, id: string): Promise<EnterpriseUser | null> {
  return (await db.getEnterpriseUserByScimId?.(id)) || (await db.getEnterpriseUserById?.(id)) || null;
}

export function createScimRouter(config: ScimRouterConfig): Router {
  const router = Router();
  const log = (config.logger ?? pino({ level: 'silent' })).child({ module: 'scim' });
  const scimConfig = config.enterpriseConfig.scim;
  if (!scimConfig?.bearerToken) {
    throw new Error('Enterprise SCIM requires enterprise.scim.bearerToken');
  }

  const externalIdp = scimConfig.externalIdp ?? 'scim';
  const groups = new Map<string, { id: string; displayName: string; members: Array<Record<string, unknown>> }>();
  const authRateConfig = config.rateLimiting?.auth ?? {};

  router.use(rateLimit({
    windowMs: authRateConfig.windowMs ?? 15 * 60 * 1000,
    limit: authRateConfig.limit ?? 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      log.warn({ limit: options.limit }, 'SCIM rate limit exceeded');
      scimError(res, 429, 'Too many SCIM requests');
    },
  }));

  router.use(json());
  router.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!token || !tokenMatches(token, scimConfig.bearerToken)) {
      return scimError(res, 401, 'Invalid bearer token');
    }
    next();
  });

  router.get('/ServiceProviderConfig', (_req, res) => {
    res.json({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{
        type: 'oauthbearertoken',
        name: 'Bearer Token',
        description: 'SCIM bearer token configured by the consuming application.',
        primary: true,
      }],
    });
  });

  router.post('/Users', async (req, res) => {
    const parsed = scimUserSchema.safeParse(req.body);
    if (!parsed.success) return scimError(res, 400, 'Invalid SCIM User payload', 'invalidValue');

    const body = parsed.data;
    const externalSub = extractExternalSub(body);
    const linked = await config.enterprise.linkIdentity({
      externalIdp,
      externalSub,
      externalAttrs: mapExternalAttrs(body, scimConfig.attributeMapping),
      scimId: externalSub,
    });
    const user = await config.db.getEnterpriseUserById?.(linked.enterpriseUserId);
    if (!user) return scimError(res, 500, 'Provisioned enterprise user could not be loaded');
    config.enterprise.emit('scim.provisioned', {
      externalIdp,
      externalSub,
      nearAccountId: user.nearAccountId,
      enterpriseUserId: user.id,
      ts: Date.now(),
    });
    res.status(linked.isNew ? 201 : 200).json(toScimUser(user));
  });

  router.get('/Users', async (req, res) => {
    const filter = String(req.query.filter || '');
    const match = filter.match(/^(userName|externalId)\s+eq\s+"([^"]+)"$/);
    if (!match) return scimError(res, 400, 'Unsupported SCIM filter', 'invalidFilter');
    const externalSub = match[2];
    const user = await config.db.getEnterpriseUserByExternalId?.(externalIdp, externalSub);
    const resources = user ? [toScimUser(user)] : [];
    res.json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: resources.length,
      Resources: resources,
      startIndex: 1,
      itemsPerPage: resources.length,
    });
  });

  router.get('/Users/:id', async (req, res) => {
    const user = await getByScimOrId(config.db, req.params.id);
    if (!user) return scimError(res, 404, 'SCIM User not found');
    res.json(toScimUser(user));
  });

  router.patch('/Users/:id', async (req, res) => {
    const parsed = scimPatchSchema.safeParse(req.body);
    if (!parsed.success) return scimError(res, 400, 'Invalid SCIM PATCH payload', 'invalidValue');
    let user = await getByScimOrId(config.db, req.params.id);
    if (!user) return scimError(res, 404, 'SCIM User not found');

    let attrs = { ...(user.externalAttrs ?? {}) };
    for (const operation of parsed.data.Operations) {
      if (operation.op.toLowerCase() !== 'replace') return scimError(res, 400, 'Unsupported SCIM PATCH operation', 'mutability');
      const path = operation.path;
      if (path === 'active') {
        const active = operation.value === true;
        await config.enterprise.setStatus({
          externalIdp: user.externalIdp,
          externalSub: user.externalSub,
          status: active ? 'active' : 'deprovisioned',
        });
        user = (await config.db.getEnterpriseUserById?.(user.id)) ?? user;
      } else if (path === 'groups') {
        attrs.groups = normalizeGroups(operation.value);
      } else if (path === 'userName') {
        attrs.email = operation.value;
      } else if (path === 'name') {
        attrs.displayName = (operation.value as Record<string, unknown>)?.formatted ?? operation.value;
      } else {
        return scimError(res, 400, 'Unsupported SCIM PATCH path', 'noTarget');
      }
    }
    if (config.db.updateEnterpriseExternalAttrs) {
      user = await config.db.updateEnterpriseExternalAttrs(user.id, attrs);
    }
    res.json(toScimUser(user));
  });

  router.put('/Users/:id', async (req, res) => {
    const parsed = scimUserSchema.safeParse(req.body);
    if (!parsed.success) return scimError(res, 400, 'Invalid SCIM User payload', 'invalidValue');
    let user = await getByScimOrId(config.db, req.params.id);
    if (!user) return scimError(res, 404, 'SCIM User not found');
    const status = parsed.data.active === false ? 'deprovisioned' : 'active';
    await config.enterprise.setStatus({ externalIdp: user.externalIdp, externalSub: user.externalSub, status });
    if (config.db.updateEnterpriseUser) {
      user = await config.db.updateEnterpriseUser(user.id, {
        status,
        externalAttrs: mapExternalAttrs(parsed.data, scimConfig.attributeMapping),
      });
    }
    res.json(toScimUser(user));
  });

  router.delete('/Users/:id', async (req, res) => {
    const user = await getByScimOrId(config.db, req.params.id);
    if (!user) return scimError(res, 404, 'SCIM User not found');
    await config.enterprise.unlinkIdentity({
      externalIdp: user.externalIdp,
      externalSub: user.externalSub,
      mode: 'revoke',
    });
    config.enterprise.emit('scim.deprovisioned', {
      externalIdp: user.externalIdp,
      externalSub: user.externalSub,
      nearAccountId: user.nearAccountId,
      enterpriseUserId: user.id,
      ts: Date.now(),
    });
    res.status(204).send();
  });

  router.get('/Groups', (_req, res) => {
    const resources = Array.from(groups.values()).map(toScimGroup);
    res.json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: resources.length,
      Resources: resources,
      startIndex: 1,
      itemsPerPage: resources.length,
    });
  });

  router.post('/Groups', (req, res) => {
    const parsed = scimGroupSchema.safeParse(req.body);
    if (!parsed.success) return scimError(res, 400, 'Invalid SCIM Group payload', 'invalidValue');
    const id = parsed.data.externalId || randomUUID();
    const group = {
      id,
      displayName: parsed.data.displayName,
      members: parsed.data.members ?? [],
    };
    groups.set(id, group);
    res.status(201).json(toScimGroup(group));
  });

  router.get('/Groups/:id', (req, res) => {
    const group = groups.get(req.params.id);
    if (!group) return scimError(res, 404, 'SCIM Group not found');
    res.json(toScimGroup(group));
  });

  router.patch('/Groups/:id', async (req, res) => {
    const group = groups.get(req.params.id);
    if (!group) return scimError(res, 404, 'SCIM Group not found');
    const parsed = scimPatchSchema.safeParse(req.body);
    if (!parsed.success) return scimError(res, 400, 'Invalid SCIM PATCH payload', 'invalidValue');
    for (const operation of parsed.data.Operations) {
      if (operation.op.toLowerCase() !== 'replace' || operation.path !== 'members') {
        return scimError(res, 400, 'Unsupported SCIM Group PATCH operation', 'mutability');
      }
      group.members = Array.isArray(operation.value) ? operation.value as Array<Record<string, unknown>> : [];
      for (const member of group.members) {
        const id = typeof member.value === 'string' ? member.value : undefined;
        const user = id ? await getByScimOrId(config.db, id) : null;
        if (user && config.db.updateEnterpriseExternalAttrs) {
          const attrs = { ...(user.externalAttrs ?? {}) };
          attrs.groups = [group.displayName];
          await config.db.updateEnterpriseExternalAttrs(user.id, attrs);
        }
      }
    }
    res.json(toScimGroup(group));
  });

  return router;
}
