import { describe, expect, it, vi } from 'vitest';
import {
  createAnonAuth,
  createEnterpriseBinding,
  POSTGRES_ENTERPRISE_SCHEMA,
  POSTGRES_SCHEMA,
} from '../server/index.js';
import { makeEnterpriseDb, makeMpcManager } from './enterprise-test-helpers.js';

describe('ENT-02: enterprise persistence schema is conditional and isolated', () => {
  it('keeps enterprise schema separate from the default Postgres schema', () => {
    expect(POSTGRES_SCHEMA).not.toContain('enterprise_users');
    expect(POSTGRES_ENTERPRISE_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS enterprise_users');
    expect(POSTGRES_ENTERPRISE_SCHEMA).toContain('UNIQUE (external_idp, external_sub)');
    expect(POSTGRES_ENTERPRISE_SCHEMA).toContain('idx_enterprise_near');
    expect(POSTGRES_ENTERPRISE_SCHEMA).toContain('idx_enterprise_scim');
  });
});

describe('ENT-03: enterprise binding API', () => {
  it('createAnonAuth exposes enterprise binding only when enabled', () => {
    const db = makeEnterpriseDb();
    const auth = createAnonAuth({
      nearNetwork: 'testnet',
      sessionSecret: 'test-secret-32-chars-long-enough-12345',
      database: { type: 'custom', adapter: db },
      enterprise: { enabled: true },
    });

    expect(auth.enterprise).toBeDefined();
  });

  it('returns existing binding without minting another MPC account', async () => {
    const db = makeEnterpriseDb();
    const mpcManager = makeMpcManager();
    const enterprise = createEnterpriseBinding({
      db,
      mpcManager: mpcManager as never,
      enterpriseConfig: { enabled: true },
    });

    const result = await enterprise.linkIdentity({
      externalIdp: 'scim',
      externalSub: 'employee-1',
    });

    expect(result).toEqual({
      nearAccountId: 'enterprise.testnet',
      enterpriseUserId: 'ent-1',
      isNew: false,
    });
    expect(mpcManager.createAccount).not.toHaveBeenCalled();
  });

  it('mints an MPC account when nearAccountId is omitted for a new binding', async () => {
    const db = makeEnterpriseDb({
      getEnterpriseUserByExternalId: vi.fn().mockResolvedValue(null),
    });
    const mpcManager = makeMpcManager();
    const enterprise = createEnterpriseBinding({
      db,
      mpcManager: mpcManager as never,
      enterpriseConfig: { enabled: true },
    });

    const result = await enterprise.linkIdentity({
      externalIdp: 'okta',
      externalSub: 'employee-2',
    });

    expect(result.isNew).toBe(true);
    expect(result.nearAccountId).toBe('minted.testnet');
    expect(mpcManager.createAccount).toHaveBeenCalledOnce();
    expect(db.createEnterpriseUser).toHaveBeenCalledWith(expect.objectContaining({
      externalIdp: 'okta',
      externalSub: 'employee-2',
      nearAccountId: 'minted.testnet',
    }));
  });

  it('uses supplied nearAccountId without minting', async () => {
    const db = makeEnterpriseDb({
      getEnterpriseUserByExternalId: vi.fn().mockResolvedValue(null),
    });
    const mpcManager = makeMpcManager();
    const enterprise = createEnterpriseBinding({
      db,
      mpcManager: mpcManager as never,
      enterpriseConfig: { enabled: true },
    });

    const result = await enterprise.linkIdentity({
      externalIdp: 'entra',
      externalSub: 'employee-3',
      nearAccountId: 'existing.testnet',
    });

    expect(result.nearAccountId).toBe('existing.testnet');
    expect(mpcManager.createAccount).not.toHaveBeenCalled();
  });

  it('updates status, deletes enterprise sessions, and emits a secret-free event', async () => {
    const db = makeEnterpriseDb();
    const enterprise = createEnterpriseBinding({
      db,
      mpcManager: makeMpcManager() as never,
      enterpriseConfig: { enabled: true },
    });
    const handler = vi.fn();
    enterprise.on('identity.status', handler);

    await enterprise.setStatus({
      externalIdp: 'scim',
      externalSub: 'employee-1',
      status: 'deprovisioned',
    });

    expect(db.setEnterpriseUserStatus).toHaveBeenCalledWith('ent-1', 'deprovisioned');
    expect(db.deleteSessionsByUserAndTrack).toHaveBeenCalledWith('ent-1', 'enterprise');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      externalIdp: 'scim',
      externalSub: 'employee-1',
      nearAccountId: 'enterprise.testnet',
      from: 'active',
      to: 'deprovisioned',
    }));
    expect(JSON.stringify(handler.mock.calls[0][0])).not.toMatch(/bearerToken|cookie|headers|body|req/);
  });

  it('revoke unlink marks deprovisioned while delete unlink hard-deletes', async () => {
    const db = makeEnterpriseDb();
    const enterprise = createEnterpriseBinding({
      db,
      mpcManager: makeMpcManager() as never,
      enterpriseConfig: { enabled: true },
    });

    await enterprise.unlinkIdentity({ externalIdp: 'scim', externalSub: 'employee-1' });
    expect(db.setEnterpriseUserStatus).toHaveBeenCalledWith('ent-1', 'deprovisioned');

    await enterprise.unlinkIdentity({ externalIdp: 'scim', externalSub: 'employee-1', mode: 'delete' });
    expect(db.deleteEnterpriseUser).toHaveBeenCalledWith('ent-1');
  });
});

