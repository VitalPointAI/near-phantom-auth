/**
 * Registration and Authentication Integration Tests (TEST-07)
 *
 * Integration tests for registration and authentication flows via HTTP.
 * Uses supertest against real Express router with mocked managers.
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
      derivationPath: 'near-anon-auth,temp-user-1',
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
    getUserByCodename: vi.fn().mockResolvedValue(null), // no collision
    getUserByNearAccount: vi.fn().mockResolvedValue(null),
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
    passkey: { credentialId: 'cred-1', userId: 'user-1', counter: 0 },
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
  addRecoveryWallet: vi.fn(),
  verifyRecoveryWallet: vi.fn(),
  getMPCContractId: vi.fn(),
  getNetworkId: vi.fn(),
};

// ---------------------------------------------------------------------------
// Valid WebAuthn credential body shapes
// ---------------------------------------------------------------------------

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
// App factory
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
    rateLimiting: { auth: { limit: 1000, windowMs: 60000 } }, // high limit for tests
    ...overrides,
  } as any);
  app.use(router);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockDb = makeMockDb();
  vi.clearAllMocks();

  // Re-apply default mock return values after clearAllMocks
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
    passkey: { credentialId: 'cred-1', userId: 'user-1', counter: 0 },
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
});

describe('Registration flow', () => {
  it('POST /register/start returns 200 with challengeId and options', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/register/start')
      .send({})
      .expect(200);

    expect(res.body).toHaveProperty('challengeId', 'chal-reg-1');
    expect(res.body).toHaveProperty('options');
    expect(res.body.options).toHaveProperty('challenge', 'base64challenge');
  });

  it('POST /register/start calls passkeyManager.startRegistration', async () => {
    const app = createTestApp();
    await request(app)
      .post('/register/start')
      .send({})
      .expect(200);

    expect(mockPasskeyManager.startRegistration).toHaveBeenCalledOnce();
  });

  it('POST /register/finish returns 200 with codename and nearAccountId', async () => {
    const app = createTestApp();

    // First start registration to get a codename + tempUserId
    const startRes = await request(app).post('/register/start').send({}).expect(200);
    const { challengeId, codename, tempUserId } = startRes.body;

    const res = await request(app)
      .post('/register/finish')
      .send({
        challengeId,
        tempUserId,
        codename,
        response: validRegistrationResponse,
      })
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('codename');
    expect(res.body).toHaveProperty('nearAccountId');
  });

  it('POST /register/finish calls db.createUser, db.createPasskey, sessionManager.createSession', async () => {
    const app = createTestApp();
    const startRes = await request(app).post('/register/start').send({}).expect(200);
    const { challengeId, codename, tempUserId } = startRes.body;

    await request(app)
      .post('/register/finish')
      .send({
        challengeId,
        tempUserId,
        codename,
        response: validRegistrationResponse,
      })
      .expect(200);

    expect(mockDb.createUser).toHaveBeenCalledOnce();
    expect(mockDb.createPasskey).toHaveBeenCalledOnce();
    expect(mockSessionManager.createSession).toHaveBeenCalledOnce();
  });

  it('POST /register/finish with missing body returns 400', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/register/finish')
      .send({})
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });

  it('POST /register/start with non-object body returns 400', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/register/start')
      .send('not-an-object')
      .set('Content-Type', 'text/plain')
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });
});

describe('Authentication flow', () => {
  it('POST /login/start returns 200 with challengeId and options', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/login/start')
      .send({})
      .expect(200);

    expect(res.body).toHaveProperty('challengeId', 'chal-auth-1');
    expect(res.body).toHaveProperty('options');
  });

  it('POST /login/start with codename looks up user', async () => {
    // When codename is provided, it looks up the user first
    mockDb = makeMockDb({
      getUserByCodename: vi.fn().mockResolvedValue({
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
      .post('/login/start')
      .send({ codename: 'ALPHA-BRAVO-7' })
      .expect(200);

    expect(res.body).toHaveProperty('challengeId');
    expect(mockDb.getUserByCodename).toHaveBeenCalledWith('ALPHA-BRAVO-7');
  });

  it('POST /login/start with non-existent codename returns 404', async () => {
    mockDb = makeMockDb({
      getUserByCodename: vi.fn().mockResolvedValue(null),
    });
    const app = createTestApp();
    const res = await request(app)
      .post('/login/start')
      .send({ codename: 'NONEXISTENT-42' })
      .expect(404);

    expect(res.body).toHaveProperty('error');
  });

  it('POST /login/finish with valid credential returns 200 with user data', async () => {
    mockDb = makeMockDb({
      getUserById: vi.fn().mockResolvedValue({
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
      .post('/login/finish')
      .send({
        challengeId: 'chal-auth-1',
        response: validAuthenticationResponse,
      })
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('codename');
  });

  it('POST /login/finish when passkey verification fails returns 401', async () => {
    mockPasskeyManager.finishAuthentication.mockResolvedValue({
      verified: false,
      userId: undefined,
    });
    const app = createTestApp();
    const res = await request(app)
      .post('/login/finish')
      .send({
        challengeId: 'chal-auth-1',
        response: validAuthenticationResponse,
      })
      .expect(401);

    expect(res.body).toHaveProperty('error');
  });

  it('POST /login/finish creates session on success', async () => {
    mockDb = makeMockDb({
      getUserById: vi.fn().mockResolvedValue({
        id: 'user-1',
        codename: 'ALPHA-BRAVO-7',
        nearAccountId: 'abc123def456',
        mpcPublicKey: 'ed25519:TESTKEY',
        derivationPath: 'near-anon-auth,user-1',
        createdAt: new Date(),
      }),
    });
    const app = createTestApp();
    await request(app)
      .post('/login/finish')
      .send({
        challengeId: 'chal-auth-1',
        response: validAuthenticationResponse,
      })
      .expect(200);

    expect(mockSessionManager.createSession).toHaveBeenCalledOnce();
  });
});

describe('Session', () => {
  it('GET /session without cookie returns { authenticated: false }', async () => {
    // No session cookie — sessionManager.getSession returns null
    mockSessionManager.getSession.mockResolvedValue(null);
    const app = createTestApp();
    const res = await request(app)
      .get('/session')
      .expect(401);

    expect(res.body).toHaveProperty('authenticated', false);
  });

  it('GET /session with valid session returns user data', async () => {
    mockSessionManager.getSession.mockResolvedValue({
      id: 'sess-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 3600000),
    });
    mockDb = makeMockDb({
      getUserById: vi.fn().mockResolvedValue({
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
      .get('/session')
      .expect(200);

    expect(res.body).toHaveProperty('authenticated', true);
    expect(res.body).toHaveProperty('codename', 'ALPHA-BRAVO-7');
    expect(res.body).toHaveProperty('nearAccountId', 'abc123def456');
  });

  it('POST /logout returns 200', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/logout')
      .send({})
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
  });

  it('POST /logout calls sessionManager.destroySession', async () => {
    const app = createTestApp();
    await request(app)
      .post('/logout')
      .send({})
      .expect(200);

    expect(mockSessionManager.destroySession).toHaveBeenCalledOnce();
  });
});

describe('Adversarial', () => {
  it('POST /register/finish with invalid challengeId returns 500 when manager throws', async () => {
    mockPasskeyManager.finishRegistration.mockRejectedValue(
      new Error('Challenge expired or not found')
    );
    const app = createTestApp();
    const res = await request(app)
      .post('/register/finish')
      .send({
        challengeId: 'invalid-challenge-id',
        tempUserId: 'temp-user-1',
        codename: 'ALPHA-BRAVO-7',
        response: validRegistrationResponse,
      })
      .expect(500);

    expect(res.body).toHaveProperty('error');
  });

  it('Tampered session: GET /session with tampered cookie returns 401 when sessionManager returns null', async () => {
    // When session cookie is tampered, sessionManager.getSession returns null
    mockSessionManager.getSession.mockResolvedValue(null);
    const app = createTestApp();

    const res = await request(app)
      .get('/session')
      .set('Cookie', 'anon_session=tampered.invalidsignature')
      .expect(401);

    expect(res.body).toHaveProperty('authenticated', false);
  });

  it('POST /login/finish with unknown userId from passkey returns 404', async () => {
    // passkey verifies but user is not in db
    mockPasskeyManager.finishAuthentication.mockResolvedValue({
      verified: true,
      userId: 'unknown-user-id',
    });
    mockDb = makeMockDb({
      getUserById: vi.fn().mockResolvedValue(null),
    });
    const app = createTestApp();
    const res = await request(app)
      .post('/login/finish')
      .send({
        challengeId: 'chal-auth-1',
        response: validAuthenticationResponse,
      })
      .expect(404);

    expect(res.body).toHaveProperty('error');
  });
});
