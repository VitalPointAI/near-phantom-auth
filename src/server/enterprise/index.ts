import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { Logger } from 'pino';
import pino from 'pino';
import type {
  DatabaseAdapter,
  EnterpriseBindingApi,
  EnterpriseConfig,
  EnterpriseEventMap,
  EnterpriseStatus,
  EnterpriseUser,
} from '../../types/index.js';
import type { MPCAccountManager } from '../mpc.js';
import {
  EnterpriseAdapterError,
  EnterpriseIdentityNotFoundError,
} from './errors.js';

export interface EnterpriseBindingConfig {
  db: DatabaseAdapter;
  mpcManager: MPCAccountManager;
  enterpriseConfig: EnterpriseConfig;
  logger?: Logger;
}

type RequiredEnterpriseMethod =
  | 'createEnterpriseUser'
  | 'getEnterpriseUserById'
  | 'getEnterpriseUserByExternalId'
  | 'getEnterpriseUserByNearAccount'
  | 'setEnterpriseUserStatus'
  | 'deleteEnterpriseUser';

function requireMethod<T extends RequiredEnterpriseMethod>(
  db: DatabaseAdapter,
  method: T,
): NonNullable<DatabaseAdapter[T]> {
  const fn = db[method];
  if (!fn) {
    throw new EnterpriseAdapterError(`Enterprise module requires DatabaseAdapter.${method}()`);
  }
  return fn as NonNullable<DatabaseAdapter[T]>;
}

async function deleteEnterpriseSessions(db: DatabaseAdapter, user: EnterpriseUser): Promise<void> {
  if (db.deleteSessionsByUserAndTrack) {
    await db.deleteSessionsByUserAndTrack(user.id, 'enterprise');
    return;
  }
  await db.deleteUserSessions(user.id);
}

export function createEnterpriseBinding(config: EnterpriseBindingConfig): EnterpriseBindingApi {
  const log = (config.logger ?? pino({ level: 'silent' })).child({ module: 'enterprise' });
  const emitter = new EventEmitter();
  const { db, mpcManager, enterpriseConfig } = config;

  const api = {
    async linkIdentity(input) {
      const getByExternal = requireMethod(db, 'getEnterpriseUserByExternalId');
      const existing = await getByExternal.call(db, input.externalIdp, input.externalSub);
      if (existing) {
        return {
          nearAccountId: existing.nearAccountId,
          enterpriseUserId: existing.id,
          isNew: false,
        };
      }

      let nearAccountId = input.nearAccountId;
      if (!nearAccountId) {
        if (enterpriseConfig.binding?.mintMpcIfMissing === false) {
          throw new EnterpriseAdapterError('nearAccountId is required when enterprise.binding.mintMpcIfMissing is false');
        }
        const mpcAccount = await mpcManager.createAccount(randomUUID());
        nearAccountId = mpcAccount.nearAccountId;
      }

      const createUser = requireMethod(db, 'createEnterpriseUser');
      const user = await createUser.call(db, {
        nearAccountId,
        externalIdp: input.externalIdp,
        externalSub: input.externalSub,
        externalAttrs: input.externalAttrs,
        scimId: input.scimId,
        status: 'active',
      });

      const payload = {
        externalIdp: user.externalIdp,
        externalSub: user.externalSub,
        nearAccountId: user.nearAccountId,
        enterpriseUserId: user.id,
        ts: Date.now(),
      };
      emitter.emit('identity.linked', payload);
      log.debug({ externalIdp: user.externalIdp }, 'enterprise identity linked');

      return { nearAccountId: user.nearAccountId, enterpriseUserId: user.id, isNew: true };
    },

    async unlinkIdentity(input) {
      const getByExternal = requireMethod(db, 'getEnterpriseUserByExternalId');
      const user = await getByExternal.call(db, input.externalIdp, input.externalSub);
      if (!user) throw new EnterpriseIdentityNotFoundError('Enterprise identity not found');

      const mode = input.mode ?? 'revoke';
      if (mode === 'delete') {
        const deleteUser = requireMethod(db, 'deleteEnterpriseUser');
        await deleteEnterpriseSessions(db, user);
        await deleteUser.call(db, user.id);
      } else {
        await api.setStatus({
          externalIdp: input.externalIdp,
          externalSub: input.externalSub,
          status: 'deprovisioned',
        });
      }

      emitter.emit('identity.unlinked', {
        externalIdp: input.externalIdp,
        externalSub: input.externalSub,
        nearAccountId: user.nearAccountId,
        mode,
        ts: Date.now(),
      });

      return { ok: true };
    },

    async resolveByExternalId(externalIdp, externalSub) {
      const getByExternal = requireMethod(db, 'getEnterpriseUserByExternalId');
      const user = await getByExternal.call(db, externalIdp, externalSub);
      if (!user) return null;
      return { nearAccountId: user.nearAccountId, status: user.status, enterpriseUserId: user.id };
    },

    async resolveByNearAccount(nearAccountId) {
      const getByNear = requireMethod(db, 'getEnterpriseUserByNearAccount');
      const user = await getByNear.call(db, nearAccountId);
      if (!user) return null;
      return { externalIdp: user.externalIdp, externalSub: user.externalSub, status: user.status };
    },

    async setStatus(input) {
      const getByExternal = requireMethod(db, 'getEnterpriseUserByExternalId');
      const user = await getByExternal.call(db, input.externalIdp, input.externalSub);
      if (!user) throw new EnterpriseIdentityNotFoundError('Enterprise identity not found');

      const setStatus = requireMethod(db, 'setEnterpriseUserStatus');
      const updated = await setStatus.call(db, user.id, input.status);
      if (input.status === 'suspended' || input.status === 'deprovisioned') {
        await deleteEnterpriseSessions(db, user);
      }

      emitter.emit('identity.status', {
        externalIdp: user.externalIdp,
        externalSub: user.externalSub,
        nearAccountId: user.nearAccountId,
        from: user.status,
        to: updated.status as EnterpriseStatus,
        ts: Date.now(),
      });

      return { ok: true };
    },

    on(event, handler) {
      emitter.on(event, handler as (payload: EnterpriseEventMap[keyof EnterpriseEventMap]) => void);
      return api;
    },

    emit(event, payload) {
      return emitter.emit(event, payload);
    },
  } satisfies EnterpriseBindingApi;

  return api;
}

export {
  BindingError,
  EnterpriseAdapterError,
  EnterpriseDisabledError,
  EnterpriseIdentityNotFoundError,
  EnterpriseIdentityConflictError,
  EnterpriseDeprovisionedError,
} from './errors.js';
