/**
 * Phase 14 Plan 04 — HOOK-02 (afterAuthSuccess fires inside /register/finish)
 * + HOOK-05 (secondFactor echo on continue:false response).
 *
 * Mock harness analog: src/__tests__/analytics-lifecycle.test.ts:14-230
 *   (full register flow with vi.fn() spy on hooks, supertest-driven).
 *
 * Each it.todo below maps to a specific assertion the executor of Plan 04
 * will replace with real code. The 1:1 requirement → test-file map is
 * locked here; Plan 04 does NOT add new it() blocks, only swaps todos.
 *
 * Fire-point line ref: src/server/router.ts:201-323 (HOOK-02 fire at line 248).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRouter } from '../server/router.js';
import type { DatabaseAdapter } from '../types/index.js';
import type { AnalyticsEvent } from '../server/analytics.js';

// ---------------------------------------------------------------------------
// Mock harness — lifted from analytics-lifecycle.test.ts:26-207 (drops
// recovery-only mocks since this file only exercises /register/finish).
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
    getUserById: vi.fn(),
    getUserByCodename: vi.fn().mockResolvedValue(null),
    getUserByNearAccount: vi.fn(),
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
  startAuthentication: vi.fn(),
  finishAuthentication: vi.fn(),
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

const REGISTER_BODY = {
  challengeId: 'chal-reg-1',
  response: validRegistrationResponse,
  tempUserId: 'temp-user-1',
  codename: 'ALPHA-BRAVO-7',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb = makeMockDb();
  mockSessionManager.createSession.mockResolvedValue({ id: 'sess-1', userId: 'user-1' });
  mockMpcManager.createAccount.mockResolvedValue({
    nearAccountId: 'abc123def456',
    derivationPath: 'near-anon-auth,temp-user-1',
    mpcPublicKey: 'ed25519:TESTKEY',
    onChain: false,
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
});

describe('HOOK-02: afterAuthSuccess fires on POST /register/finish', () => {
  it('hook is called exactly once per request, with passkey-register ctx', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(200);
    expect(afterAuthSuccess).toHaveBeenCalledTimes(1);
    expect(afterAuthSuccess.mock.calls[0][0]).toMatchObject({
      authMethod: 'passkey-register',
    });
  });

  it('ctx contains userId, codename, nearAccountId, and a defined req field', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(200);
    const ctx = afterAuthSuccess.mock.calls[0][0];
    expect(ctx).toMatchObject({
      authMethod: 'passkey-register',
      userId: 'user-1',
      codename: 'ALPHA-BRAVO-7',
      nearAccountId: 'abc123def456',
    });
    expect(ctx.req).toBeDefined();
  });

  it("ctx.authMethod === 'passkey-register' (no provider field — Pitfall 5)", async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(200);
    const ctx = afterAuthSuccess.mock.calls[0][0];
    expect(ctx.authMethod).toBe('passkey-register');
    expect(ctx).not.toHaveProperty('provider');
  });

  it('continue:true allows sessionManager.createSession to be called', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(200);
    expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
  });

  it('continue:true response is the standard RegistrationFinishResponse with secondFactor undefined', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });
    const res = await request(app).post('/register/finish').send(REGISTER_BODY).expect(200);
    expect(res.body).toMatchObject({
      success: true,
      codename: 'ALPHA-BRAVO-7',
      nearAccountId: 'abc123def456',
    });
    expect(res.body.secondFactor).toBeUndefined();
  });

  it('continue:false short-circuits: status matches consumer.status, body fields are spread into response top-level', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({
      continue: false,
      status: 202,
      body: { needsSecondFactor: true, totpUri: 'otpauth://totp/example' },
    });
    const res = await request(app).post('/register/finish').send(REGISTER_BODY).expect(202);
    expect(res.body.needsSecondFactor).toBe(true);
    expect(res.body.totpUri).toBe('otpauth://totp/example');
  });

  it('continue:false response includes secondFactor: { status, body } echo (HOOK-05)', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({
      continue: false,
      status: 202,
      body: { needsSecondFactor: true, totpUri: 'otpauth://totp/example' },
    });
    const res = await request(app).post('/register/finish').send(REGISTER_BODY).expect(202);
    expect(res.body.secondFactor).toMatchObject({
      status: 202,
      body: { needsSecondFactor: true, totpUri: 'otpauth://totp/example' },
    });
  });

  it('continue:false skips sessionManager.createSession entirely', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: false, status: 202, body: {} });
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(202);
    expect(mockSessionManager.createSession).not.toHaveBeenCalled();
  });

  it('continue:false response has NO Set-Cookie header (Pitfall 2 / T-14-02)', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: false, status: 202, body: {} });
    const res = await request(app).post('/register/finish').send(REGISTER_BODY).expect(202);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('Pitfall 4 Option A: register.finish.success analytics event fires REGARDLESS of continue:true vs continue:false', async () => {
    // Case A: continue:true
    let bundle = makeApp();
    bundle.afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(bundle.app).post('/register/finish').send(REGISTER_BODY).expect(200);
    expect(findEvent(bundle.onAuthEvent, 'register.finish.success')).toBeDefined();

    // Case B: continue:false (fresh app to reset spies and mocks)
    mockDb = makeMockDb();
    mockSessionManager.createSession.mockResolvedValue({ id: 'sess-1', userId: 'user-1' });
    bundle = makeApp();
    bundle.afterAuthSuccess.mockResolvedValue({ continue: false, status: 202, body: {} });
    await request(bundle.app).post('/register/finish').send(REGISTER_BODY).expect(202);
    expect(findEvent(bundle.onAuthEvent, 'register.finish.success')).toBeDefined();
  });

  it('Backwards compat: hooks: {} (no afterAuthSuccess) → flow runs unchanged, createSession called', async () => {
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
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(200);
    expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
  });

  it('Backwards compat: hooks omitted entirely → flow runs unchanged, createSession called', async () => {
    const app = express();
    app.use(express.json());
    const router = createRouter({
      db: mockDb,
      sessionManager: mockSessionManager as any,
      passkeyManager: mockPasskeyManager as any,
      mpcManager: mockMpcManager as any,
      rateLimiting: { auth: { limit: 1000, windowMs: 60000 } },
      rpId: 'localhost',
    } as any);
    app.use(router);
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(200);
    expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
  });
});
