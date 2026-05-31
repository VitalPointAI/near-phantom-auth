import { vi } from 'vitest';
import type {
  DatabaseAdapter,
  EnterpriseStatus,
  EnterpriseUser,
  OAuthUser,
  Session,
} from '../types/index.js';

export const enterpriseUser = (overrides: Partial<EnterpriseUser> = {}): EnterpriseUser => ({
  id: 'ent-1',
  type: 'enterprise',
  nearAccountId: 'enterprise.testnet',
  externalIdp: 'scim',
  externalSub: 'employee-1',
  externalAttrs: { email: 'employee@example.com', displayName: 'Employee One' },
  scimId: 'employee-1',
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

export const session = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  userId: 'user-1',
  track: 'anonymous',
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  lastActivityAt: new Date(),
  ...overrides,
});

export const oauthUser = (overrides: Partial<OAuthUser> = {}): OAuthUser => ({
  id: 'oauth-1',
  type: 'standard',
  email: 'oauth@example.com',
  nearAccountId: 'oauth.testnet',
  mpcPublicKey: 'ed25519:oauth',
  derivationPath: 'near-anon-auth,oauth-1',
  providers: [],
  createdAt: new Date(),
  lastActiveAt: new Date(),
  ...overrides,
});

export function makeEnterpriseDb(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
  const users = new Map<string, EnterpriseUser>();
  const base = enterpriseUser();
  users.set(base.id, base);

  const db: DatabaseAdapter = {
    initialize: vi.fn().mockResolvedValue(undefined),
    createUser: vi.fn(),
    getUserById: vi.fn().mockResolvedValue(null),
    getUserByCodename: vi.fn(),
    getUserByNearAccount: vi.fn(),
    createOAuthUser: vi.fn(),
    getOAuthUserById: vi.fn().mockResolvedValue(oauthUser()),
    getOAuthUserByEmail: vi.fn(),
    getOAuthUserByProvider: vi.fn(),
    linkOAuthProvider: vi.fn(),
    createPasskey: vi.fn(),
    getPasskeyById: vi.fn(),
    getPasskeysByUserId: vi.fn(),
    updatePasskeyCounter: vi.fn(),
    deletePasskey: vi.fn(),
    createSession: vi.fn().mockImplementation(async (input) => session({
      id: input.id ?? 'session-created',
      userId: input.userId,
      track: input.track,
      expiresAt: input.expiresAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    })),
    getSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    deleteUserSessions: vi.fn().mockResolvedValue(undefined),
    cleanExpiredSessions: vi.fn().mockResolvedValue(0),
    storeChallenge: vi.fn(),
    getChallenge: vi.fn(),
    deleteChallenge: vi.fn(),
    storeRecoveryData: vi.fn(),
    getRecoveryData: vi.fn(),
    initializeEnterprise: vi.fn().mockResolvedValue(undefined),
    createEnterpriseUser: vi.fn().mockImplementation(async (input) => {
      const user = enterpriseUser({
        id: `ent-${users.size + 1}`,
        nearAccountId: input.nearAccountId,
        externalIdp: input.externalIdp,
        externalSub: input.externalSub,
        externalAttrs: input.externalAttrs,
        scimId: input.scimId,
        status: input.status ?? 'active',
      });
      users.set(user.id, user);
      return user;
    }),
    getEnterpriseUserById: vi.fn().mockImplementation(async (id) => users.get(id) ?? null),
    getEnterpriseUserByExternalId: vi.fn().mockImplementation(async (externalIdp, externalSub) => {
      return Array.from(users.values()).find((u) => u.externalIdp === externalIdp && u.externalSub === externalSub) ?? null;
    }),
    getEnterpriseUserByNearAccount: vi.fn().mockImplementation(async (nearAccountId) => {
      return Array.from(users.values()).find((u) => u.nearAccountId === nearAccountId) ?? null;
    }),
    getEnterpriseUserByScimId: vi.fn().mockImplementation(async (scimId) => {
      return Array.from(users.values()).find((u) => u.scimId === scimId) ?? null;
    }),
    updateEnterpriseUser: vi.fn().mockImplementation(async (id, patch) => {
      const existing = users.get(id)!;
      const updated = { ...existing, ...patch, updatedAt: new Date() };
      users.set(id, updated);
      return updated;
    }),
    setEnterpriseUserStatus: vi.fn().mockImplementation(async (id, status: EnterpriseStatus) => {
      const existing = users.get(id)!;
      const updated = { ...existing, status, updatedAt: new Date() };
      users.set(id, updated);
      return updated;
    }),
    deleteEnterpriseUser: vi.fn().mockImplementation(async (id) => {
      users.delete(id);
    }),
    updateEnterpriseExternalAttrs: vi.fn().mockImplementation(async (id, externalAttrs) => {
      const existing = users.get(id)!;
      const updated = { ...existing, externalAttrs, updatedAt: new Date() };
      users.set(id, updated);
      return updated;
    }),
    deleteSessionsByUserAndTrack: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return db;
}

export function makeMpcManager() {
  return {
    createAccount: vi.fn().mockResolvedValue({
      nearAccountId: 'minted.testnet',
      mpcPublicKey: 'ed25519:minted',
      derivationPath: 'near-anon-auth,minted',
      onChain: false,
    }),
    addRecoveryWallet: vi.fn(),
    verifyRecoveryWallet: vi.fn(),
    getMPCContractId: vi.fn(),
    getNetworkId: vi.fn(),
  };
}

