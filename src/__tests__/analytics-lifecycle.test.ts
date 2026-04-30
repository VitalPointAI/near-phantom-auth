/**
 * Phase 13 Plan 03 — ANALYTICS-01 (passkey + recovery + account-delete) +
 * ANALYTICS-06 (failure-events-by-default) implementation.
 *
 * Mock harness analog: src/__tests__/registration-auth.test.ts:18-211.
 * Recovery describe blocks analog: src/__tests__/recovery.test.ts:254-541.
 *
 * Each emit point identified in 13-RESEARCH.md Lifecycle Boundary Inventory
 * (lines 131-145) gets at least one it() block asserting:
 *   1. The endpoint behavior is unchanged (same status code as v0.6.1)
 *   2. The onAuthEvent spy was called with the correct event literal
 *   3. The captured event has NO PII keys (defense-in-depth)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRouter } from '../server/router.js';
import type { DatabaseAdapter } from '../types/index.js';
import type { AnalyticsEvent } from '../server/analytics.js';

// ---------------------------------------------------------------------------
// Mock DatabaseAdapter — mirrors registration-auth.test.ts:18-67 +
// recovery.test.ts:21-77 unioned.
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
    deleteRecoveryData: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock managers — copied verbatim from registration-auth.test.ts:73-118 and
// recovery.test.ts:83-145.
// ---------------------------------------------------------------------------

const mockPasskeyManager = {
  startRegistration: vi.fn().mockResolvedValue({
    challengeId: 'chal-reg-1',
    options: { challenge: 'base64challenge', rp: { name: 'Test', id: 'localhost' } },
  }),
  finishRegistration: vi.fn().mockResolvedValue({
    verified: true,
    passkeyData: {
      credentialId: 'cred-1',
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
    },
    tempUserId: 'temp-user-1',
  }),
  startAuthentication: vi.fn().mockResolvedValue({
    challengeId: 'chal-auth-1',
    options: { challenge: 'authchallenge', rpId: 'localhost' },
  }),
  finishAuthentication: vi.fn().mockResolvedValue({
    verified: true,
    userId: 'user-1',
    passkeyData: {
      credentialId: 'cred-1',
      publicKey: new Uint8Array(32),
      counter: 1,
      deviceType: 'singleDevice',
      backedUp: false,
    },
  }),
};

const mockSessionManager = {
  createSession: vi.fn().mockResolvedValue({ id: 'sess-1', userId: 'user-1' }),
  getSession: vi.fn().mockResolvedValue(null),
  destroySession: vi.fn().mockResolvedValue(undefined),
  refreshSession: vi.fn().mockResolvedValue(undefined),
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

const authenticatedSession = {
  id: 'sess-1',
  userId: 'user-1',
  expiresAt: new Date(Date.now() + 3600000),
};

// ---------------------------------------------------------------------------
// App factory + onAuthEvent spy
// ---------------------------------------------------------------------------

let mockDb: DatabaseAdapter;

function makeApp(overrides: Record<string, unknown> = {}) {
  const onAuthEvent = vi.fn();
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
    rpId: 'localhost',
    hooks: { onAuthEvent },
    ...overrides,
  } as any);
  app.use(router);
  return { app, onAuthEvent };
}

// Defense-in-depth runtime check: emitted events must NOT carry PII keys.
const FORBIDDEN_PII_KEYS = ['userId', 'codename', 'nearAccountId', 'email', 'ip', 'userAgent'];

function expectNoPII(event: AnalyticsEvent) {
  const keys = Object.keys(event);
  for (const forbidden of FORBIDDEN_PII_KEYS) {
    expect(keys).not.toContain(forbidden);
  }
}

// Find the first event of a given type in the spy's call history.
function findEvent(spy: ReturnType<typeof vi.fn>, type: string): AnalyticsEvent | undefined {
  for (const call of spy.mock.calls) {
    const ev = call[0] as AnalyticsEvent;
    if (ev && ev.type === type) return ev;
  }
  return undefined;
}

// Valid WebAuthn credential shapes — copied verbatim from
// registration-auth.test.ts:124-146.
const validRegistrationResponse = {
  id: 'cred-id-base64',
  rawId: 'cred-id-base64',
  type: 'public-key' as const,
  response: {
    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
    attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVg',
  },
  clientExtensionResults: {},
};

const validAuthenticationResponse = {
  id: 'cred-id-base64',
  rawId: 'cred-id-base64',
  type: 'public-key' as const,
  response: {
    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
    authenticatorData: 'SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2M',
    signature: 'MEYCIQDl2k5HjG7TkBIZh',
    userHandle: 'user-1',
  },
  clientExtensionResults: {},
};

// ---------------------------------------------------------------------------
// beforeEach — reset mocks to defaults
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockDb = makeMockDb();
  vi.clearAllMocks();

  mockPasskeyManager.startRegistration.mockResolvedValue({
    challengeId: 'chal-reg-1',
    options: { challenge: 'base64challenge', rp: { name: 'Test', id: 'localhost' } },
  });
  mockPasskeyManager.finishRegistration.mockResolvedValue({
    verified: true,
    passkeyData: {
      credentialId: 'cred-1',
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
    },
    tempUserId: 'temp-user-1',
  });
  mockPasskeyManager.startAuthentication.mockResolvedValue({
    challengeId: 'chal-auth-1',
    options: { challenge: 'authchallenge', rpId: 'localhost' },
  });
  mockPasskeyManager.finishAuthentication.mockResolvedValue({
    verified: true,
    userId: 'user-1',
    passkeyData: {
      credentialId: 'cred-1',
      publicKey: new Uint8Array(32),
      counter: 1,
      deviceType: 'singleDevice',
      backedUp: false,
    },
  });
  mockSessionManager.createSession.mockResolvedValue({ id: 'sess-1', userId: 'user-1' });
  mockSessionManager.getSession.mockResolvedValue(null);
  mockSessionManager.destroySession.mockResolvedValue(undefined);
  mockMpcManager.createAccount.mockResolvedValue({
    nearAccountId: 'abc123def456',
    derivationPath: 'near-anon-auth,temp-user-1',
    mpcPublicKey: 'ed25519:TESTKEY',
    onChain: false,
  });
  mockMpcManager.addRecoveryWallet.mockResolvedValue({
    success: true,
    txHash: 'REAL_TX_HASH_123',
  });
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
});

// ===========================================================================
// ANALYTICS-01: register lifecycle events
// ===========================================================================

describe('ANALYTICS-01: register lifecycle events', () => {
  it("POST /register/start emits { type: 'register.start', rpId, timestamp }", async () => {
    const { app, onAuthEvent } = makeApp();
    await request(app).post('/register/start').send({}).expect(200);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'register.start');
    expect(event).toBeDefined();
    expect(event).toMatchObject({ type: 'register.start', rpId: 'localhost' });
    expect(typeof (event as { timestamp: number }).timestamp).toBe('number');
    expectNoPII(event!);
  });

  it("POST /register/finish emits register.finish.success with backupEligible", async () => {
    mockPasskeyManager.finishRegistration.mockResolvedValue({
      verified: true,
      passkeyData: {
        credentialId: 'cred-1',
        publicKey: new Uint8Array(32),
        counter: 0,
        deviceType: 'multiDevice',
        backedUp: true,
      },
      tempUserId: 'temp-user-1',
    });
    const { app, onAuthEvent } = makeApp();
    await request(app)
      .post('/register/finish')
      .send({
        challengeId: 'chal-reg-1',
        response: validRegistrationResponse,
        tempUserId: 'temp-user-1',
        codename: 'ALPHA-BRAVO-7',
      })
      .expect(200);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'register.finish.success');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'register.finish.success',
      rpId: 'localhost',
      backupEligible: true,
    });
    expect(typeof (event as { timestamp: number }).timestamp).toBe('number');
    expectNoPII(event!);
  });

  it("POST /register/finish emits register.finish.failure with reason='invalid-codename' on bad codename", async () => {
    const { app, onAuthEvent } = makeApp();
    await request(app)
      .post('/register/finish')
      .send({
        challengeId: 'chal-reg-1',
        response: validRegistrationResponse,
        tempUserId: 'temp-user-1',
        codename: 'NOT_A_VALID_CODENAME',
      })
      .expect(400);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'register.finish.failure');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'register.finish.failure',
      rpId: 'localhost',
      reason: 'invalid-codename',
    });
    expectNoPII(event!);
  });

  it("POST /register/finish emits register.finish.failure with reason='passkey-verification-failed' on verify=false", async () => {
    mockPasskeyManager.finishRegistration.mockResolvedValueOnce({
      verified: false,
      passkeyData: undefined,
      tempUserId: 'temp-user-1',
    });
    const { app, onAuthEvent } = makeApp();
    await request(app)
      .post('/register/finish')
      .send({
        challengeId: 'chal-reg-1',
        response: validRegistrationResponse,
        tempUserId: 'temp-user-1',
        codename: 'ALPHA-BRAVO-7',
      })
      .expect(400);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'register.finish.failure');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'register.finish.failure',
      rpId: 'localhost',
      reason: 'passkey-verification-failed',
    });
    expectNoPII(event!);
  });

  it("POST /register/finish emits register.finish.failure with reason='internal-error' from catch (passkeyManager throws leaked-codename Error)", async () => {
    // Simulate an Error containing PII in its message — the catch must NOT
    // surface it; reason must be the static enum 'internal-error'.
    mockPasskeyManager.finishRegistration.mockRejectedValueOnce(
      new Error('codename ALPHA-7-LEAK was passed in')
    );
    const { app, onAuthEvent } = makeApp();
    await request(app)
      .post('/register/finish')
      .send({
        challengeId: 'chal-reg-1',
        response: validRegistrationResponse,
        tempUserId: 'temp-user-1',
        codename: 'ALPHA-BRAVO-7',
      })
      .expect(500);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'register.finish.failure');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'register.finish.failure',
      rpId: 'localhost',
      reason: 'internal-error',
    });
    // CRITICAL: leaked codename must NOT appear in the event payload.
    expect(JSON.stringify(event)).not.toContain('ALPHA-7-LEAK');
    expectNoPII(event!);
  });
});

// ===========================================================================
// ANALYTICS-01: login lifecycle events
// ===========================================================================

describe('ANALYTICS-01: login lifecycle events', () => {
  it("POST /login/start emits login.start with codenameProvided=true and DOES NOT leak the codename string", async () => {
    mockDb = makeMockDb({
      getUserByCodename: vi.fn().mockResolvedValue({
        id: 'user-1',
        codename: 'ALPHA-7-BRAVO',
        nearAccountId: 'abc123def456',
        mpcPublicKey: 'ed25519:TESTKEY',
        derivationPath: 'near-anon-auth,user-1',
        createdAt: new Date(),
      }),
    });
    const { app, onAuthEvent } = makeApp();
    await request(app).post('/login/start').send({ codename: 'ALPHA-7-BRAVO' }).expect(200);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'login.start');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'login.start',
      rpId: 'localhost',
      codenameProvided: true,
    });
    // CRITICAL: the codename string itself must NOT appear in the event payload.
    expect(JSON.stringify(event)).not.toContain('ALPHA-7-BRAVO');
    expectNoPII(event!);
  });

  it("POST /login/start emits login.start with codenameProvided=false when no codename supplied", async () => {
    const { app, onAuthEvent } = makeApp();
    await request(app).post('/login/start').send({}).expect(200);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'login.start');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'login.start',
      rpId: 'localhost',
      codenameProvided: false,
    });
    expectNoPII(event!);
  });

  it("POST /login/finish emits login.finish.success with backupEligible (passkeyData present)", async () => {
    mockPasskeyManager.finishAuthentication.mockResolvedValueOnce({
      verified: true,
      userId: 'user-1',
      passkeyData: {
        credentialId: 'cred-1',
        publicKey: new Uint8Array(32),
        counter: 1,
        deviceType: 'multiDevice',
        backedUp: true,
      },
    });
    const { app, onAuthEvent } = makeApp();
    await request(app)
      .post('/login/finish')
      .send({ challengeId: 'chal-auth-1', response: validAuthenticationResponse })
      .expect(200);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'login.finish.success');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'login.finish.success',
      rpId: 'localhost',
      backupEligible: true,
    });
    expectNoPII(event!);
  });

  it("POST /login/finish emits login.finish.failure with reason='auth-failed' on verified=false", async () => {
    mockPasskeyManager.finishAuthentication.mockResolvedValueOnce({
      verified: false,
      userId: undefined,
    });
    const { app, onAuthEvent } = makeApp();
    await request(app)
      .post('/login/finish')
      .send({ challengeId: 'chal-auth-1', response: validAuthenticationResponse })
      .expect(401);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'login.finish.failure');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'login.finish.failure',
      rpId: 'localhost',
      reason: 'auth-failed',
    });
    expectNoPII(event!);
  });

  it("POST /login/finish emits login.finish.failure with reason='user-not-found' on missing user", async () => {
    mockDb = makeMockDb({ getUserById: vi.fn().mockResolvedValue(null) });
    mockPasskeyManager.finishAuthentication.mockResolvedValueOnce({
      verified: true,
      userId: 'orphan-user',
      passkeyData: undefined,
    });
    const { app, onAuthEvent } = makeApp();
    await request(app)
      .post('/login/finish')
      .send({ challengeId: 'chal-auth-1', response: validAuthenticationResponse })
      .expect(404);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'login.finish.failure');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'login.finish.failure',
      rpId: 'localhost',
      reason: 'user-not-found',
    });
    expectNoPII(event!);
  });

  it("POST /login/finish emits login.finish.failure with reason='internal-error' from catch", async () => {
    mockPasskeyManager.finishAuthentication.mockRejectedValueOnce(
      new Error('boom')
    );
    const { app, onAuthEvent } = makeApp();
    await request(app)
      .post('/login/finish')
      .send({ challengeId: 'chal-auth-1', response: validAuthenticationResponse })
      .expect(500);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'login.finish.failure');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'login.finish.failure',
      rpId: 'localhost',
      reason: 'internal-error',
    });
    expectNoPII(event!);
  });
});

// ===========================================================================
// ANALYTICS-01: recovery lifecycle events
// ===========================================================================

describe('ANALYTICS-01: recovery lifecycle events', () => {
  it("POST /recovery/wallet/verify emits recovery.wallet.link.success after storeRecoveryData", async () => {
    mockSessionManager.getSession.mockResolvedValue(authenticatedSession);
    const { app, onAuthEvent } = makeApp();
    await request(app)
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

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'recovery.wallet.link.success');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'recovery.wallet.link.success',
      rpId: 'localhost',
    });
    expect(typeof (event as { timestamp: number }).timestamp).toBe('number');
    expectNoPII(event!);
  });

  it("POST /recovery/wallet/finish emits recovery.wallet.recover.success after createSession", async () => {
    const { app, onAuthEvent } = makeApp();
    await request(app)
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

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'recovery.wallet.recover.success');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'recovery.wallet.recover.success',
      rpId: 'localhost',
    });
    expectNoPII(event!);
  });

  it("POST /recovery/ipfs/setup emits recovery.ipfs.setup.success after storeRecoveryData", async () => {
    mockSessionManager.getSession.mockResolvedValue(authenticatedSession);
    const { app, onAuthEvent } = makeApp();
    await request(app)
      .post('/recovery/ipfs/setup')
      .send({ password: 'StrongPassword123!' })
      .expect(200);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'recovery.ipfs.setup.success');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'recovery.ipfs.setup.success',
      rpId: 'localhost',
    });
    expectNoPII(event!);
  });

  it("POST /recovery/ipfs/recover emits recovery.ipfs.recover.success after createSession", async () => {
    const { app, onAuthEvent } = makeApp();
    await request(app)
      .post('/recovery/ipfs/recover')
      .send({ cid: 'QmTest1234567890abcdef', password: 'StrongPassword123!' })
      .expect(200);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'recovery.ipfs.recover.success');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'recovery.ipfs.recover.success',
      rpId: 'localhost',
    });
    expectNoPII(event!);
  });
});

// ===========================================================================
// ANALYTICS-01: account.delete event
// ===========================================================================

describe('ANALYTICS-01: account.delete event', () => {
  it("DELETE /account emits { type: 'account.delete', rpId, timestamp } after deleteUser", async () => {
    mockSessionManager.getSession.mockResolvedValue(authenticatedSession);
    const { app, onAuthEvent } = makeApp();
    await request(app).delete('/account').expect(200);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'account.delete');
    expect(event).toBeDefined();
    expect(event).toMatchObject({ type: 'account.delete', rpId: 'localhost' });
    expect(typeof (event as { timestamp: number }).timestamp).toBe('number');
    expectNoPII(event!);
  });
});

// ===========================================================================
// ANALYTICS-06: failure events emitted by default (no opt-in flag)
// ===========================================================================

describe('ANALYTICS-06: failure events emitted by default', () => {
  it("register.finish.failure event fires WITHOUT setting any opt-in flag (default config)", async () => {
    // makeApp() does NOT set awaitAnalytics or any opt-in. Failure events MUST
    // still fire by default.
    mockPasskeyManager.finishRegistration.mockResolvedValueOnce({
      verified: false,
      passkeyData: undefined,
      tempUserId: 'temp-user-1',
    });
    const { app, onAuthEvent } = makeApp();
    await request(app)
      .post('/register/finish')
      .send({
        challengeId: 'chal-reg-1',
        response: validRegistrationResponse,
        tempUserId: 'temp-user-1',
        codename: 'ALPHA-BRAVO-7',
      })
      .expect(400);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'register.finish.failure');
    expect(event).toBeDefined();
    expect((event as { reason: string }).reason).toBe('passkey-verification-failed');
  });

  it("login.finish.failure reason is the static enum value 'internal-error', NEVER Error.message (no PII leak)", async () => {
    // Mock passkeyManager to throw an Error whose message contains PII —
    // the catch handler must emit reason: 'internal-error' (static enum)
    // and the leaked codename must NOT appear in the event JSON.
    mockPasskeyManager.finishAuthentication.mockRejectedValueOnce(
      new Error('codename ALPHA-7-BRAVO is leaked into the error string')
    );
    const { app, onAuthEvent } = makeApp();
    await request(app)
      .post('/login/finish')
      .send({ challengeId: 'chal-auth-1', response: validAuthenticationResponse })
      .expect(500);

    expect(onAuthEvent).toHaveBeenCalled();
    const event = findEvent(onAuthEvent, 'login.finish.failure');
    expect(event).toBeDefined();
    expect((event as { reason: string }).reason).toBe('internal-error');
    // CRITICAL: leaked codename must NOT appear in the event payload.
    expect(JSON.stringify(event)).not.toContain('ALPHA-7-BRAVO');
    expectNoPII(event!);
  });
});
