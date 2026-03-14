/**
 * Recovery Flow Integration Tests (TEST-08)
 *
 * Integration tests for IPFS recovery and wallet recovery flows via HTTP.
 * Uses supertest against real Express router with mocked managers.
 *
 * Critical: wallet and IPFS recovery routes only exist when the respective
 * managers are passed to createRouter (pitfall 6 from research).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRouter } from '../server/router.js';
import type { DatabaseAdapter } from '../types/index.js';

// ---------------------------------------------------------------------------
// Mock db — full DatabaseAdapter implementation with vi.fn()
// ---------------------------------------------------------------------------

function makeMockDb(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    createUser: vi.fn().mockResolvedValue({
      id: 'user-1',
      codename: 'ALPHA-BRAVO-7',
      nearAccountId: 'abc123def456',
      mpcPublicKey: 'ed25519:TESTKEY',
      derivationPath: 'near-anon-auth,user-1',
      createdAt: new Date(),
    }),
    getUserById: vi.fn().mockResolvedValue({
      id: 'user-1',
      codename: 'ALPHA-BRAVO-7',
      nearAccountId: 'abc123def456',
      mpcPublicKey: 'ed25519:TESTKEY',
      derivationPath: 'near-anon-auth,user-1',
      createdAt: new Date(),
    }),
    getUserByCodename: vi.fn().mockResolvedValue(null),
    getUserByNearAccount: vi.fn().mockResolvedValue({
      id: 'user-1',
      codename: 'ALPHA-BRAVO-7',
      nearAccountId: 'abc123def456',
      mpcPublicKey: 'ed25519:TESTKEY',
      derivationPath: 'near-anon-auth,user-1',
      createdAt: new Date(),
    }),
    createOAuthUser: vi.fn(),
    getOAuthUserById: vi.fn(),
    getOAuthUserByEmail: vi.fn(),
    getOAuthUserByProvider: vi.fn(),
    linkOAuthProvider: vi.fn(),
    createPasskey: vi.fn().mockResolvedValue(undefined),
    getPasskeyById: vi.fn(),
    getPasskeysByUserId: vi.fn().mockResolvedValue([]),
    updatePasskeyCounter: vi.fn(),
    deletePasskey: vi.fn(),
    createSession: vi.fn().mockResolvedValue({
      id: 'sess-1',
      userId: 'user-1',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
      lastActivityAt: new Date(),
    }),
    getSession: vi.fn().mockResolvedValue(null),
    deleteSession: vi.fn(),
    deleteUserSessions: vi.fn().mockResolvedValue(undefined),
    cleanExpiredSessions: vi.fn().mockResolvedValue(0),
    storeChallenge: vi.fn().mockResolvedValue(undefined),
    getChallenge: vi.fn().mockResolvedValue(null),
    deleteChallenge: vi.fn().mockResolvedValue(undefined),
    storeRecoveryData: vi.fn().mockResolvedValue(undefined),
    getRecoveryData: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock managers
// ---------------------------------------------------------------------------

const mockPasskeyManager = {
  startRegistration: vi.fn().mockResolvedValue({
    challengeId: 'chal-reg-1',
    options: { challenge: 'base64challenge' },
  }),
  finishRegistration: vi.fn().mockResolvedValue({ verified: false }),
  startAuthentication: vi.fn().mockResolvedValue({
    challengeId: 'chal-auth-1',
    options: { challenge: 'authchallenge' },
  }),
  finishAuthentication: vi.fn().mockResolvedValue({ verified: false }),
};

const mockMpcManager = {
  createAccount: vi.fn().mockResolvedValue({
    nearAccountId: 'abc123def456',
    derivationPath: 'near-anon-auth,temp-user-1',
    mpcPublicKey: 'ed25519:TESTKEY',
    onChain: false,
  }),
  addRecoveryWallet: vi.fn().mockResolvedValue({ success: true, txHash: 'REAL_TX_HASH_123' }),
  verifyRecoveryWallet: vi.fn(),
  getMPCContractId: vi.fn(),
  getNetworkId: vi.fn(),
};

// ---------------------------------------------------------------------------
// Mock wallet recovery manager
// ---------------------------------------------------------------------------

const mockWalletRecovery = {
  generateLinkChallenge: vi.fn().mockReturnValue({
    challenge: 'near-anon-auth:link-recovery:123456',
    expiresAt: new Date(Date.now() + 300000),
  }),
  verifyLinkSignature: vi.fn().mockReturnValue({
    verified: true,
    walletId: 'ed25519:TESTWALLETKEY',
  }),
  generateRecoveryChallenge: vi.fn().mockReturnValue({
    challenge: 'near-anon-auth:recover-account:123456',
    expiresAt: new Date(Date.now() + 300000),
  }),
  verifyRecoverySignature: vi.fn().mockResolvedValue({ verified: true }),
};

// ---------------------------------------------------------------------------
// Mock IPFS recovery manager
// ---------------------------------------------------------------------------

const mockIpfsRecovery = {
  validatePassword: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  createRecoveryBackup: vi.fn().mockResolvedValue({
    cid: 'QmTest1234567890abcdef',
    passwordStrength: 'strong',
  }),
  recoverFromBackup: vi.fn().mockResolvedValue({
    userId: 'user-1',
    nearAccountId: 'abc123def456',
    derivationPath: 'near-anon-auth,user-1',
    createdAt: Date.now(),
  }),
};

// ---------------------------------------------------------------------------
// Session manager mock — supports authenticated and unauthenticated states
// ---------------------------------------------------------------------------

const mockSessionManager = {
  createSession: vi.fn().mockResolvedValue({ id: 'sess-1', userId: 'user-1' }),
  getSession: vi.fn().mockResolvedValue(null), // unauthenticated by default
  destroySession: vi.fn().mockResolvedValue(undefined),
  refreshSession: vi.fn().mockResolvedValue(undefined),
};

const authenticatedSession = {
  id: 'sess-1',
  userId: 'user-1',
  expiresAt: new Date(Date.now() + 3600000),
};

// ---------------------------------------------------------------------------
// App factories
// ---------------------------------------------------------------------------

let mockDb: DatabaseAdapter;

function createTestApp(overrides: Record<string, unknown> = {}) {
  const app = express();
  app.use(express.json());
  const router = createRouter({
    db: mockDb,
    sessionManager: mockSessionManager as any,
    passkeyManager: mockPasskeyManager as any,
    mpcManager: mockMpcManager as any,
    walletRecovery: mockWalletRecovery as any,
    ipfsRecovery: mockIpfsRecovery as any,
    rateLimiting: {
      auth: { limit: 1000, windowMs: 60000 },
      recovery: { limit: 1000, windowMs: 60000 },
    },
    ...overrides,
  } as any);
  app.use(router);
  return app;
}

function createAppWithoutRecovery() {
  const app = express();
  app.use(express.json());
  const router = createRouter({
    db: mockDb,
    sessionManager: mockSessionManager as any,
    passkeyManager: mockPasskeyManager as any,
    mpcManager: mockMpcManager as any,
    // walletRecovery and ipfsRecovery intentionally omitted
    rateLimiting: {
      auth: { limit: 1000, windowMs: 60000 },
      recovery: { limit: 1000, windowMs: 60000 },
    },
  } as any);
  app.use(router);
  return app;
}

// ---------------------------------------------------------------------------
// Reset all mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockDb = makeMockDb();
  vi.clearAllMocks();

  // Re-apply default mock return values after clearAllMocks
  mockWalletRecovery.generateLinkChallenge.mockReturnValue({
    challenge: 'near-anon-auth:link-recovery:123456',
    expiresAt: new Date(Date.now() + 300000),
  });
  mockWalletRecovery.verifyLinkSignature.mockReturnValue({
    verified: true,
    walletId: 'ed25519:TESTWALLETKEY',
  });
  mockWalletRecovery.generateRecoveryChallenge.mockReturnValue({
    challenge: 'near-anon-auth:recover-account:123456',
    expiresAt: new Date(Date.now() + 300000),
  });
  mockWalletRecovery.verifyRecoverySignature.mockResolvedValue({ verified: true });

  mockIpfsRecovery.validatePassword.mockReturnValue({ valid: true, errors: [] });
  mockIpfsRecovery.createRecoveryBackup.mockResolvedValue({
    cid: 'QmTest1234567890abcdef',
    passwordStrength: 'strong',
  });
  mockIpfsRecovery.recoverFromBackup.mockResolvedValue({
    userId: 'user-1',
    nearAccountId: 'abc123def456',
    derivationPath: 'near-anon-auth,user-1',
    createdAt: Date.now(),
  });

  mockSessionManager.createSession.mockResolvedValue({ id: 'sess-1', userId: 'user-1' });
  mockSessionManager.getSession.mockResolvedValue(null); // unauthenticated by default
  mockSessionManager.destroySession.mockResolvedValue(undefined);

  mockMpcManager.addRecoveryWallet.mockResolvedValue({ success: true, txHash: 'REAL_TX_HASH_123' });
});

// ---------------------------------------------------------------------------
// Wallet recovery flow
// ---------------------------------------------------------------------------

describe('Wallet recovery flow', () => {
  it('POST /recovery/wallet/link returns 200 with challenge when authenticated', async () => {
    mockSessionManager.getSession.mockResolvedValue(authenticatedSession);
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/wallet/link')
      .send({})
      .expect(200);

    expect(res.body).toHaveProperty('challenge', 'near-anon-auth:link-recovery:123456');
    expect(res.body).toHaveProperty('expiresAt');
  });

  it('POST /recovery/wallet/link calls walletRecovery.generateLinkChallenge when authenticated', async () => {
    mockSessionManager.getSession.mockResolvedValue(authenticatedSession);
    const app = createTestApp();

    await request(app)
      .post('/recovery/wallet/link')
      .send({})
      .expect(200);

    expect(mockWalletRecovery.generateLinkChallenge).toHaveBeenCalledOnce();
    expect(mockDb.storeChallenge).toHaveBeenCalledOnce();
  });

  it('POST /recovery/wallet/link returns 401 when not authenticated', async () => {
    mockSessionManager.getSession.mockResolvedValue(null);
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/wallet/link')
      .send({})
      .expect(401);

    expect(res.body).toHaveProperty('error');
    expect(mockWalletRecovery.generateLinkChallenge).not.toHaveBeenCalled();
  });

  it('POST /recovery/wallet/verify with valid signature calls mpcManager.addRecoveryWallet', async () => {
    mockSessionManager.getSession.mockResolvedValue(authenticatedSession);
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/wallet/verify')
      .send({
        signature: {
          signature: 'base64signature',
          publicKey: 'ed25519:TESTWALLETKEY',
          message: 'near-anon-auth:link-recovery:123456',
        },
        challenge: 'near-anon-auth:link-recovery:123456',
        walletAccountId: 'my-wallet.near',
      })
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(mockMpcManager.addRecoveryWallet).toHaveBeenCalledOnce();
    expect(mockDb.storeRecoveryData).toHaveBeenCalledOnce();
  });

  it('POST /recovery/wallet/verify returns 401 when not authenticated', async () => {
    mockSessionManager.getSession.mockResolvedValue(null);
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/wallet/verify')
      .send({
        signature: {
          signature: 'base64signature',
          publicKey: 'ed25519:TESTWALLETKEY',
          message: 'near-anon-auth:link-recovery:123456',
        },
        challenge: 'near-anon-auth:link-recovery:123456',
        walletAccountId: 'my-wallet.near',
      })
      .expect(401);

    expect(res.body).toHaveProperty('error');
  });

  it('POST /recovery/wallet/verify with invalid signature returns 401', async () => {
    mockSessionManager.getSession.mockResolvedValue(authenticatedSession);
    mockWalletRecovery.verifyLinkSignature.mockReturnValue({ verified: false });
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/wallet/verify')
      .send({
        signature: {
          signature: 'invalidsignature',
          publicKey: 'ed25519:WRONGKEY',
          message: 'wrong-message',
        },
        challenge: 'near-anon-auth:link-recovery:123456',
        walletAccountId: 'my-wallet.near',
      })
      .expect(401);

    expect(res.body).toHaveProperty('error');
    expect(mockMpcManager.addRecoveryWallet).not.toHaveBeenCalled();
  });

  it('POST /recovery/wallet/start returns 200 with challenge', async () => {
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/wallet/start')
      .send({})
      .expect(200);

    expect(res.body).toHaveProperty('challenge', 'near-anon-auth:recover-account:123456');
    expect(res.body).toHaveProperty('expiresAt');
    expect(mockWalletRecovery.generateRecoveryChallenge).toHaveBeenCalledOnce();
  });

  it('POST /recovery/wallet/finish with verified signature creates session', async () => {
    mockDb = makeMockDb({
      getUserByNearAccount: vi.fn().mockResolvedValue({
        id: 'user-1',
        codename: 'ALPHA-BRAVO-7',
        nearAccountId: 'abc123def456',
        mpcPublicKey: 'ed25519:TESTKEY',
        derivationPath: 'near-anon-auth,user-1',
        createdAt: new Date(),
      }),
    });
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/wallet/finish')
      .send({
        signature: {
          signature: 'base64recoverysignature',
          publicKey: 'ed25519:TESTWALLETKEY',
          message: 'near-anon-auth:recover-account:123456',
        },
        challenge: 'near-anon-auth:recover-account:123456',
        nearAccountId: 'abc123def456',
      })
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('codename');
    expect(mockSessionManager.createSession).toHaveBeenCalledOnce();
  });

  it('POST /recovery/wallet/finish with failed verification returns 401', async () => {
    mockWalletRecovery.verifyRecoverySignature.mockResolvedValue({ verified: false });
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/wallet/finish')
      .send({
        signature: {
          signature: 'invalidsignature',
          publicKey: 'ed25519:WRONGKEY',
          message: 'wrong-message',
        },
        challenge: 'near-anon-auth:recover-account:123456',
        nearAccountId: 'abc123def456',
      })
      .expect(401);

    expect(res.body).toHaveProperty('error');
    expect(mockSessionManager.createSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// IPFS recovery flow
// ---------------------------------------------------------------------------

describe('IPFS recovery flow', () => {
  it('POST /recovery/ipfs/setup returns 200 with CID when authenticated', async () => {
    mockSessionManager.getSession.mockResolvedValue(authenticatedSession);
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/ipfs/setup')
      .send({ password: 'StrongPassword123!' })
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('cid', 'QmTest1234567890abcdef');
    expect(mockIpfsRecovery.createRecoveryBackup).toHaveBeenCalledOnce();
    expect(mockDb.storeRecoveryData).toHaveBeenCalledOnce();
  });

  it('POST /recovery/ipfs/setup returns 401 when not authenticated', async () => {
    mockSessionManager.getSession.mockResolvedValue(null);
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/ipfs/setup')
      .send({ password: 'StrongPassword123!' })
      .expect(401);

    expect(res.body).toHaveProperty('error');
    expect(mockIpfsRecovery.createRecoveryBackup).not.toHaveBeenCalled();
  });

  it('POST /recovery/ipfs/setup returns 400 when password is too weak', async () => {
    mockSessionManager.getSession.mockResolvedValue(authenticatedSession);
    mockIpfsRecovery.validatePassword.mockReturnValue({
      valid: false,
      errors: ['Password must be at least 12 characters'],
    });
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/ipfs/setup')
      .send({ password: 'weak' })
      .expect(400);

    expect(res.body).toHaveProperty('error', 'Password too weak');
    expect(res.body).toHaveProperty('details');
    expect(mockIpfsRecovery.createRecoveryBackup).not.toHaveBeenCalled();
  });

  it('POST /recovery/ipfs/recover with valid CID + password returns user data and creates session', async () => {
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/ipfs/recover')
      .send({
        cid: 'QmTest1234567890abcdef',
        password: 'StrongPassword123!',
      })
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('codename');
    expect(mockIpfsRecovery.recoverFromBackup).toHaveBeenCalledWith(
      'QmTest1234567890abcdef',
      'StrongPassword123!'
    );
    expect(mockSessionManager.createSession).toHaveBeenCalledOnce();
  });

  it('POST /recovery/ipfs/recover with invalid password returns 401', async () => {
    mockIpfsRecovery.recoverFromBackup.mockRejectedValue(new Error('Invalid password'));
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/ipfs/recover')
      .send({
        cid: 'QmTest1234567890abcdef',
        password: 'wrongpassword',
      })
      .expect(401);

    expect(res.body).toHaveProperty('error', 'Invalid password or CID');
    expect(mockSessionManager.createSession).not.toHaveBeenCalled();
  });

  it('POST /recovery/ipfs/recover with missing body returns 400', async () => {
    const app = createTestApp();

    const res = await request(app)
      .post('/recovery/ipfs/recover')
      .send({})
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// Recovery routes absent
// ---------------------------------------------------------------------------

describe('Recovery routes absent', () => {
  it('/recovery/wallet/* returns 404 when walletRecovery not passed to createRouter', async () => {
    const app = createAppWithoutRecovery();

    const routes = [
      '/recovery/wallet/link',
      '/recovery/wallet/verify',
      '/recovery/wallet/start',
      '/recovery/wallet/finish',
    ];

    for (const path of routes) {
      await request(app).post(path).send({}).expect(404);
    }
  });

  it('/recovery/ipfs/* returns 404 when ipfsRecovery not passed to createRouter', async () => {
    const app = createAppWithoutRecovery();

    await request(app).post('/recovery/ipfs/setup').send({ password: 'test' }).expect(404);
    await request(app).post('/recovery/ipfs/recover').send({ cid: 'Qm', password: 'test' }).expect(404);
  });
});
