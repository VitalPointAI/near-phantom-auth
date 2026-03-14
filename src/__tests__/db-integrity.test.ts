/**
 * DB Integrity and Functional Stubs Tests
 *
 * INFRA-02: Registration transaction rollback
 * BUG-04: verifyRecoveryWallet specific key check
 * STUB-01: addRecoveryWallet real MPC signing (see mpc.test.ts)
 * STUB-02: Passkey re-registration endpoint
 * STUB-03: Account deletion endpoint
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createRouter } from '../server/router.js';
import { MPCAccountManager } from '../server/mpc.js';
import type { DatabaseAdapter, Session, AnonUser } from '../types/index.js';
import type { SessionManager } from '../server/session.js';
import type { PasskeyManager } from '../server/passkey.js';

// ============================================
// Mock helpers
// ============================================

const MOCK_USER: AnonUser = {
  id: 'user-1',
  type: 'anonymous',
  codename: 'ALPHA-BRAVO-42',
  nearAccountId: 'test-account.testnet',
  mpcPublicKey: 'ed25519:test',
  derivationPath: 'near-anon-auth,user-1',
  createdAt: new Date(),
  lastActiveAt: new Date(),
};

const MOCK_SESSION: Session = {
  id: 'session-1',
  userId: 'user-1',
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3600000),
  lastActivityAt: new Date(),
};

function makeMockDb(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    createUser: vi.fn().mockResolvedValue(MOCK_USER),
    getUserById: vi.fn().mockResolvedValue(MOCK_USER),
    getUserByCodename: vi.fn().mockResolvedValue(null),
    getUserByNearAccount: vi.fn().mockResolvedValue(MOCK_USER),
    createOAuthUser: vi.fn(),
    getOAuthUserById: vi.fn(),
    getOAuthUserByEmail: vi.fn(),
    getOAuthUserByProvider: vi.fn(),
    linkOAuthProvider: vi.fn(),
    createPasskey: vi.fn().mockResolvedValue({}),
    getPasskeyById: vi.fn(),
    getPasskeysByUserId: vi.fn().mockResolvedValue([]),
    updatePasskeyCounter: vi.fn(),
    deletePasskey: vi.fn(),
    createSession: vi.fn().mockResolvedValue(MOCK_SESSION),
    getSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    deleteUserSessions: vi.fn().mockResolvedValue(undefined),
    cleanExpiredSessions: vi.fn().mockResolvedValue(0),
    storeChallenge: vi.fn().mockResolvedValue(undefined),
    getChallenge: vi.fn(),
    deleteChallenge: vi.fn().mockResolvedValue(undefined),
    storeRecoveryData: vi.fn().mockResolvedValue(undefined),
    getRecoveryData: vi.fn(),
    ...overrides,
  };
}

function makeMockSessionManager(overrides: Partial<SessionManager> = {}): SessionManager {
  return {
    createSession: vi.fn().mockResolvedValue(MOCK_SESSION),
    getSession: vi.fn().mockResolvedValue(null),
    destroySession: vi.fn().mockResolvedValue(undefined),
    refreshSession: vi.fn().mockResolvedValue(undefined),
    extendSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SessionManager;
}

function makeMockPasskeyManager(overrides: Partial<PasskeyManager> = {}): PasskeyManager {
  return {
    startRegistration: vi.fn().mockResolvedValue({ challengeId: 'challenge-1', options: { challenge: 'test' } }),
    finishRegistration: vi.fn().mockResolvedValue({ verified: true, passkeyData: {
      credentialId: 'cred-1',
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
    }}),
    startAuthentication: vi.fn().mockResolvedValue({ challengeId: 'challenge-1', options: {} }),
    finishAuthentication: vi.fn().mockResolvedValue({ verified: false }),
    ...overrides,
  } as unknown as PasskeyManager;
}

function makeMockMpcManager(): InstanceType<typeof MPCAccountManager> {
  return {
    createAccount: vi.fn().mockResolvedValue({
      nearAccountId: 'test-account.testnet',
      mpcPublicKey: 'ed25519:test',
      derivationPath: 'near-anon-auth,user-1',
      onChain: false,
    }),
    addRecoveryWallet: vi.fn().mockResolvedValue({ success: true, txHash: 'abc123' }),
    verifyRecoveryWallet: vi.fn().mockResolvedValue(false),
  } as unknown as InstanceType<typeof MPCAccountManager>;
}

function createTestApp(
  db: DatabaseAdapter,
  sessionManager: SessionManager,
  passkeyManager?: PasskeyManager
) {
  const app = express();
  const router = createRouter({
    db,
    sessionManager,
    passkeyManager: passkeyManager ?? makeMockPasskeyManager(),
    mpcManager: makeMockMpcManager(),
  });
  app.use(router);
  return app;
}

// ============================================
// INFRA-02: Registration transaction rollback
// ============================================

describe('INFRA-02: Registration transaction rollback', () => {
  it('rolls back user creation when createPasskey fails inside transaction', async () => {
    // Create a transaction adapter that propagates errors from the callback
    const txAdapter = makeMockDb({
      createUser: vi.fn().mockResolvedValue(MOCK_USER),
      createPasskey: vi.fn().mockRejectedValue(new Error('createPasskey failed')),
      createSession: vi.fn().mockResolvedValue(MOCK_SESSION),
    });

    const db = makeMockDb({
      transaction: vi.fn().mockImplementation(async (cb: (tx: DatabaseAdapter) => Promise<unknown>) => {
        return cb(txAdapter);
      }),
    });

    const sessionManager = makeMockSessionManager();
    const passkeyManager = makeMockPasskeyManager();
    const app = createTestApp(db, sessionManager, passkeyManager);

    const res = await request(app)
      .post('/register/finish')
      .send({
        challengeId: 'challenge-1',
        response: { id: 'cred-1', rawId: 'cred-1', response: { clientDataJSON: 'x', attestationObject: 'x' }, type: 'public-key', clientExtensionResults: {} },
        tempUserId: 'user-1',
        codename: 'ALPHA-BRAVO-42',
      });

    // Should fail with 500 since createPasskey throws inside transaction
    expect(res.status).toBe(500);
    // createUser was called inside the tx (it ran before createPasskey failed)
    expect(txAdapter.createUser).toHaveBeenCalled();
  });

  it('falls back to sequential calls when adapter has no transaction()', async () => {
    // db without transaction() method
    const db = makeMockDb();
    // Ensure no transaction property
    delete (db as any).transaction;

    const sessionManager = makeMockSessionManager();
    const passkeyManager = makeMockPasskeyManager();
    const app = createTestApp(db, sessionManager, passkeyManager);

    const res = await request(app)
      .post('/register/finish')
      .send({
        challengeId: 'challenge-1',
        response: { id: 'cred-1', rawId: 'cred-1', response: { clientDataJSON: 'x', attestationObject: 'x' }, type: 'public-key', clientExtensionResults: {} },
        tempUserId: 'user-1',
        codename: 'ALPHA-BRAVO-42',
      });

    // Sequential calls should work and succeed with 200
    expect(res.status).toBe(200);
    expect(db.createUser).toHaveBeenCalled();
    expect(db.createPasskey).toHaveBeenCalled();
  });

  it('rolls back user and passkey when createSession fails', async () => {
    const txAdapter = makeMockDb({
      createUser: vi.fn().mockResolvedValue(MOCK_USER),
      createPasskey: vi.fn().mockResolvedValue({}),
      createSession: vi.fn().mockRejectedValue(new Error('createSession failed')),
    });

    const db = makeMockDb({
      transaction: vi.fn().mockImplementation(async (cb: (tx: DatabaseAdapter) => Promise<unknown>) => {
        return cb(txAdapter);
      }),
    });

    // Use a sessionManager that wraps the db.createSession
    const sessionManager = makeMockSessionManager({
      createSession: vi.fn().mockRejectedValue(new Error('Session creation failed')),
    });

    const passkeyManager = makeMockPasskeyManager();
    const app = createTestApp(db, sessionManager, passkeyManager);

    const res = await request(app)
      .post('/register/finish')
      .send({
        challengeId: 'challenge-1',
        response: { id: 'cred-1', rawId: 'cred-1', response: { clientDataJSON: 'x', attestationObject: 'x' }, type: 'public-key', clientExtensionResults: {} },
        tempUserId: 'user-1',
        codename: 'ALPHA-BRAVO-42',
      });

    // Should fail since session creation fails
    expect(res.status).toBe(500);
  });
});

// ============================================
// BUG-04: verifyRecoveryWallet specific key check
// ============================================

describe('BUG-04: verifyRecoveryWallet specific key check', () => {
  const treasuryKeyPair = nacl.sign.keyPair();
  const treasuryPrivateKey = `ed25519:${bs58.encode(Buffer.from(treasuryKeyPair.secretKey))}`;
  const recoveryPubKey = `ed25519:${bs58.encode(Buffer.from(nacl.sign.keyPair().publicKey))}`;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when specific recovery key exists on account', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { nonce: 0, permission: 'FullAccess' },
        // no error field = key exists
      }),
    }));

    const manager = new MPCAccountManager({
      networkId: 'testnet',
      accountPrefix: 'anon',
      treasuryAccount: 'treasury.testnet',
      treasuryPrivateKey,
    });

    const result = await manager.verifyRecoveryWallet('test-account.testnet', recoveryPubKey);
    expect(result).toBe(true);
  });

  it('returns false when account has keys but not the recovery key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: { cause: { name: 'UNKNOWN_ACCESS_KEY' }, code: -32000, message: 'Server error' },
      }),
    }));

    const manager = new MPCAccountManager({
      networkId: 'testnet',
      accountPrefix: 'anon',
      treasuryAccount: 'treasury.testnet',
      treasuryPrivateKey,
    });

    const result = await manager.verifyRecoveryWallet('test-account.testnet', recoveryPubKey);
    expect(result).toBe(false);
  });

  it('returns false when account does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: { cause: { name: 'UNKNOWN_ACCOUNT' }, code: -32000, message: 'Server error' },
      }),
    }));

    const manager = new MPCAccountManager({
      networkId: 'testnet',
      accountPrefix: 'anon',
      treasuryAccount: 'treasury.testnet',
      treasuryPrivateKey,
    });

    const result = await manager.verifyRecoveryWallet('nonexistent.testnet', recoveryPubKey);
    expect(result).toBe(false);
  });
});

// ============================================
// STUB-02: Passkey re-registration endpoint
// ============================================

describe('STUB-02: Passkey re-registration endpoint', () => {
  it('returns 401 when not authenticated', async () => {
    const db = makeMockDb();
    const sessionManager = makeMockSessionManager({
      getSession: vi.fn().mockResolvedValue(null),
    });
    const app = createTestApp(db, sessionManager);

    const res = await request(app).post('/account/reregister-passkey').send({});

    expect(res.status).toBe(401);
  });

  it('returns 200 with challengeId and options for authenticated user', async () => {
    const db = makeMockDb();
    const sessionManager = makeMockSessionManager({
      getSession: vi.fn().mockResolvedValue(MOCK_SESSION),
    });
    const passkeyManager = makeMockPasskeyManager({
      startRegistration: vi.fn().mockResolvedValue({
        challengeId: 'challenge-for-reregister',
        options: { challenge: 'reregister-challenge' },
      }),
    });
    const app = createTestApp(db, sessionManager, passkeyManager);

    const res = await request(app).post('/account/reregister-passkey').send({});

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('challengeId', 'challenge-for-reregister');
    expect(res.body).toHaveProperty('options');
  });
});

// ============================================
// STUB-03: Account deletion endpoint
// ============================================

describe('STUB-03: Account deletion endpoint', () => {
  it('returns 401 when not authenticated', async () => {
    const db = makeMockDb();
    const sessionManager = makeMockSessionManager({
      getSession: vi.fn().mockResolvedValue(null),
    });
    const app = createTestApp(db, sessionManager);

    const res = await request(app).delete('/account');

    expect(res.status).toBe(401);
  });

  it('deletes user and all associated data', async () => {
    const deleteUser = vi.fn().mockResolvedValue(undefined);
    const deleteRecoveryData = vi.fn().mockResolvedValue(undefined);
    const deleteUserSessions = vi.fn().mockResolvedValue(undefined);

    const db = makeMockDb({
      deleteUser,
      deleteRecoveryData,
      deleteUserSessions,
    });
    const sessionManager = makeMockSessionManager({
      getSession: vi.fn().mockResolvedValue(MOCK_SESSION),
      destroySession: vi.fn().mockResolvedValue(undefined),
    });
    const app = createTestApp(db, sessionManager);

    const res = await request(app).delete('/account');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(deleteUser).toHaveBeenCalledWith('user-1');
    expect(deleteUserSessions).toHaveBeenCalled();
  });

  it('returns 501 when deleteUser is not implemented', async () => {
    const db = makeMockDb();
    // No deleteUser on this adapter
    delete (db as any).deleteUser;

    const sessionManager = makeMockSessionManager({
      getSession: vi.fn().mockResolvedValue(MOCK_SESSION),
    });
    const app = createTestApp(db, sessionManager);

    const res = await request(app).delete('/account');

    expect(res.status).toBe(501);
  });
});
