import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { createScimRouter } from '../server/enterprise/scim.js';
import { createEnterpriseBinding } from '../server/enterprise/index.js';
import { makeEnterpriseDb, makeMpcManager } from './enterprise-test-helpers.js';

function appWithScim() {
  const app = express();
  const db = makeEnterpriseDb();
  const enterprise = createEnterpriseBinding({
    db,
    mpcManager: makeMpcManager() as never,
    enterpriseConfig: { enabled: true },
  });
  app.use('/scim/v2', createScimRouter({
    db,
    enterprise,
    enterpriseConfig: { enabled: true, scim: { enabled: true, bearerToken: 'secret' } },
    rateLimiting: { auth: { limit: 1000, windowMs: 60_000 } },
  }));
  return { app, db };
}

const auth = { Authorization: 'Bearer secret' };

describe('ENT-06: SCIM ServiceProviderConfig and Groups', () => {
  it('returns ServiceProviderConfig without leaking the bearer token', async () => {
    const { app } = appWithScim();
    const res = await request(app).get('/scim/v2/ServiceProviderConfig').set(auth).expect(200);

    expect(res.body.patch.supported).toBe(true);
    expect(res.body.bulk.supported).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('protects Groups with bearer auth', async () => {
    const { app } = appWithScim();
    await request(app).get('/scim/v2/Groups').expect(401);
  });

  it('creates and reads a SCIM Group', async () => {
    const { app } = appWithScim();
    const created = await request(app)
      .post('/scim/v2/Groups')
      .set(auth)
      .send({ externalId: 'group-1', displayName: 'Analysts', members: [] })
      .expect(201);

    expect(created.body.displayName).toBe('Analysts');

    const read = await request(app).get('/scim/v2/Groups/group-1').set(auth).expect(200);
    expect(read.body.id).toBe('group-1');
  });

  it('updates group membership as enterprise attrs only', async () => {
    const { app, db } = appWithScim();
    await request(app).post('/scim/v2/Groups').set(auth).send({ externalId: 'group-1', displayName: 'Analysts' });

    await request(app)
      .patch('/scim/v2/Groups/group-1')
      .set(auth)
      .send({ Operations: [{ op: 'Replace', path: 'members', value: [{ value: 'employee-1' }] }] })
      .expect(200);

    expect(db.updateEnterpriseExternalAttrs).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      groups: ['Analysts'],
    }));
  });

  it('contains no package role/permission/scope policy mapping', () => {
    const source = readFileSync('src/server/enterprise/scim.ts', 'utf8');
    for (const forbidden of ['roleToPermission', 'permissionMap', 'scopeMap', 'auditLog']) {
      expect(source).not.toContain(forbidden);
    }
  });
});

