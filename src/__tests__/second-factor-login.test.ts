/**
 * Phase 14 Plan 04 — HOOK-03 (afterAuthSuccess fires inside /login/finish)
 * + HOOK-05 (secondFactor echo on continue:false response).
 *
 * Mock harness analog: src/__tests__/analytics-lifecycle.test.ts:469-612
 *   (login describe blocks).
 *
 * Fire-point line ref: src/server/router.ts:371-463 (HOOK-03 fire at line 405,
 * AFTER getUserById success + BEFORE createSession). NO transaction wrapper.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRouter } from '../server/router.js';
import type { DatabaseAdapter } from '../types/index.js';
import type { AnalyticsEvent } from '../server/analytics.js';

// ---------------------------------------------------------------------------
// Mock harness — lifted from analytics-lifecycle.test.ts:26-207.
// Login-specific delta: getUserById returns the resolved user row.
// ---------------------------------------------------------------------------

function makeMockDb(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    createUser: vi.fn(),
    getUserById: vi.fn().mockResolvedValue({
      id: 'user-1',
      codename: 'ALPHA-BRAVO-7',
      nearAccountId: 'abc123def456',
      mpcPublicKey: 'ed25519:TESTKEY',
      derivationPath: 'near-anon-auth,user-1',
      createdAt: new Date(),
    }),
    getUserByCodename: vi.fn().mockResolvedValue(null),
    getUserByNearAccount: vi.fn(),
    createOAuthUser: vi.fn(),
    getOAuthUserById: vi.fn(),
    getOAuthUserByEmail: vi.fn(),
    getOAuthUserByProvider: vi.fn(),
    linkOAuthProvider: vi.fn(),
    createPasskey: vi.fn(),
    getPasskeyById: vi.fn(),
    getPasskeysByUserId: vi.fn().mockResolvedValue([]),
    updatePasskeyCounter: vi.fn(),
    deletePasskey: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    deleteUserSessions: vi.fn(),
    cleanExpiredSessions: vi.fn(),
    storeChallenge: vi.fn(),
    getChallenge: vi.fn(),
    deleteChallenge: vi.fn(),
    storeRecoveryData: vi.fn(),
    getRecoveryData: vi.fn(),
    ...overrides,
  } as DatabaseAdapter;
}

const mockPasskeyManager = {
  startRegistration: vi.fn(),
  finishRegistration: vi.fn(),
  startAuthentication: vi.fn(),
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
  createAccount: vi.fn(),
  addRecoveryWallet: vi.fn(),
  verifyRecoveryWallet: vi.fn(),
  getMPCContractId: vi.fn(),
  getNetworkId: vi.fn(),
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

let mockDb: DatabaseAdapter;

function makeApp(overrides: Record<string, unknown> = {}) {
  const afterAuthSuccess = vi.fn();
  const onAuthEvent = vi.fn();
  const app = express();
  app.use(express.json());
  const router = createRouter({
    db: mockDb,
    sessionManager: mockSessionManager as any,
    passkeyManager: mockPasskeyManager as any,
    mpcManager: mockMpcManager as any,
    rateLimiting: { auth: { limit: 1000, windowMs: 60000 } },
    rpId: 'localhost',
    hooks: { afterAuthSuccess, onAuthEvent },
    ...overrides,
  } as any);
  app.use(router);
  return { app, afterAuthSuccess, onAuthEvent };
}

function findEvent(spy: ReturnType<typeof vi.fn>, type: string): AnalyticsEvent | undefined {
  for (const call of spy.mock.calls) {
    const ev = call[0] as AnalyticsEvent;
    if (ev && ev.type === type) return ev;
  }
  return undefined;
}

const LOGIN_BODY = {
  challengeId: 'chal-auth-1',
  response: validAuthenticationResponse,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb = makeMockDb();
  mockSessionManager.createSession.mockResolvedValue({ id: 'sess-1', userId: 'user-1' });
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
});

describe('HOOK-03: afterAuthSuccess fires on POST /login/finish', () => {
  it('hook is called exactly once per request, with passkey-login ctx', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/login/finish').send(LOGIN_BODY).expect(200);
    expect(afterAuthSuccess).toHaveBeenCalledTimes(1);
    expect(afterAuthSuccess.mock.calls[0][0]).toMatchObject({
      authMethod: 'passkey-login',
    });
  });

  it("ctx.authMethod === 'passkey-login' (no provider field — Pitfall 5)", async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/login/finish').send(LOGIN_BODY).expect(200);
    const ctx = afterAuthSuccess.mock.calls[0][0];
    expect(ctx.authMethod).toBe('passkey-login');
    expect(ctx).not.toHaveProperty('provider');
  });

  it('ctx.userId, ctx.codename, ctx.nearAccountId match the resolved user row from db.getUserById', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/login/finish').send(LOGIN_BODY).expect(200);
    const ctx = afterAuthSuccess.mock.calls[0][0];
    expect(ctx.userId).toBe('user-1');
    expect(ctx.codename).toBe('ALPHA-BRAVO-7');
    expect(ctx.nearAccountId).toBe('abc123def456');
    expect(ctx.req).toBeDefined();
  });

  it('continue:true allows sessionManager.createSession to be called', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/login/finish').send(LOGIN_BODY).expect(200);
    expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
  });

  it('continue:true response is the standard AuthenticationFinishResponse with secondFactor undefined', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });
    const res = await request(app).post('/login/finish').send(LOGIN_BODY).expect(200);
    expect(res.body).toMatchObject({
      success: true,
      codename: 'ALPHA-BRAVO-7',
    });
    expect(res.body.secondFactor).toBeUndefined();
  });

  it('continue:false short-circuits: status, spread body, secondFactor echo all correct', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({
      continue: false,
      status: 401,
      body: { error: 'TOTP required', challenge: 'totp-1' },
    });
    const res = await request(app).post('/login/finish').send(LOGIN_BODY).expect(401);
    expect(res.body.error).toBe('TOTP required');
    expect(res.body.challenge).toBe('totp-1');
    expect(res.body.secondFactor).toMatchObject({
      status: 401,
      body: { error: 'TOTP required', challenge: 'totp-1' },
    });
  });

  it('continue:false skips sessionManager.createSession', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: false, status: 401, body: {} });
    await request(app).post('/login/finish').send(LOGIN_BODY).expect(401);
    expect(mockSessionManager.createSession).not.toHaveBeenCalled();
  });

  it('continue:false response has NO Set-Cookie header (T-14-02)', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: false, status: 401, body: {} });
    const res = await request(app).post('/login/finish').send(LOGIN_BODY).expect(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('Pitfall 4 Option A: login.finish.success analytics event fires REGARDLESS of short-circuit', async () => {
    // Case A: continue:true
    let bundle = makeApp();
    bundle.afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(bundle.app).post('/login/finish').send(LOGIN_BODY).expect(200);
    expect(findEvent(bundle.onAuthEvent, 'login.finish.success')).toBeDefined();

    // Case B: continue:false
    mockDb = makeMockDb();
    mockSessionManager.createSession.mockResolvedValue({ id: 'sess-1', userId: 'user-1' });
    bundle = makeApp();
    bundle.afterAuthSuccess.mockResolvedValue({ continue: false, status: 401, body: {} });
    await request(bundle.app).post('/login/finish').send(LOGIN_BODY).expect(401);
    expect(findEvent(bundle.onAuthEvent, 'login.finish.success')).toBeDefined();
  });

  it('No transaction wrapper: db.transaction is NOT called even when adapter exposes it', async () => {
    const transactionSpy = vi.fn();
    mockDb = makeMockDb({ transaction: transactionSpy } as any);
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/login/finish').send(LOGIN_BODY).expect(200);
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it('Backwards compat: hooks: {} → login flow runs unchanged', async () => {
    const app = express();
    app.use(express.json());
    const router = createRouter({
      db: mockDb,
      sessionManager: mockSessionManager as any,
      passkeyManager: mockPasskeyManager as any,
      mpcManager: mockMpcManager as any,
      rateLimiting: { auth: { limit: 1000, windowMs: 60000 } },
      rpId: 'localhost',
      hooks: {},
    } as any);
    app.use(router);
    await request(app).post('/login/finish').send(LOGIN_BODY).expect(200);
    expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
  });
});
