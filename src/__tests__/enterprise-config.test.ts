import { describe, expect, it, vi } from 'vitest';
import { createAnonAuth, POSTGRES_SCHEMA } from '../server/index.js';
import type { AnonAuthConfig } from '../types/index.js';
import { makeEnterpriseDb } from './enterprise-test-helpers.js';

const baseConfig = (db = makeEnterpriseDb()): AnonAuthConfig => ({
  nearNetwork: 'testnet',
  sessionSecret: 'test-secret-32-chars-long-enough-12345',
  database: { type: 'custom', adapter: db },
  rp: { name: 'Test', id: 'localhost', origin: 'http://localhost:3000' },
});

describe('ENT-01: enterprise module is default-off', () => {
  it('constructs without enterprise API or SCIM router when config is absent', async () => {
    const db = makeEnterpriseDb();
    const auth = createAnonAuth(baseConfig(db));

    expect(auth.enterprise).toBeUndefined();
    expect(auth.scimRouter).toBeUndefined();

    await auth.initialize();
    expect(db.initialize).toHaveBeenCalledOnce();
    expect(db.initializeEnterprise).not.toHaveBeenCalled();
  });

  it('does not include enterprise_users in the default Postgres schema', () => {
    expect(POSTGRES_SCHEMA).not.toContain('enterprise_users');
  });

  it('exposes enterprise API only when explicitly enabled', async () => {
    const db = makeEnterpriseDb();
    const auth = createAnonAuth({
      ...baseConfig(db),
      enterprise: { enabled: true },
    });

    expect(auth.enterprise).toBeDefined();
    expect(auth.scimRouter).toBeUndefined();

    await auth.initialize();
    expect(db.initializeEnterprise).toHaveBeenCalledOnce();
  });

  it('throws a classified initialization error when enabled adapter cannot initialize enterprise schema', async () => {
    const db = makeEnterpriseDb({ initializeEnterprise: undefined });
    const auth = createAnonAuth({
      ...baseConfig(db),
      enterprise: { enabled: true },
    });

    await expect(auth.initialize()).rejects.toThrow('initializeEnterprise');
  });
});

describe('ENT-07: enterprise PRF/DEK config compiles as additive config', () => {
  it('accepts passkeyStepUp and serverManagedDek without invoking hooks or routers', () => {
    const db = makeEnterpriseDb();
    const hooks = { onAuthEvent: vi.fn() };
    const auth = createAnonAuth({
      ...baseConfig(db),
      hooks,
      enterprise: {
        enabled: true,
        passkeyStepUp: true,
        serverManagedDek: true,
      },
    });

    expect(auth.enterprise).toBeDefined();
    expect(hooks.onAuthEvent).not.toHaveBeenCalled();
  });
});

