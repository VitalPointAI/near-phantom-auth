/**
 * Phase 14 Plan 04 — HOOK-04 (afterAuthSuccess fires inside OAuth /callback
 * × 3 success branches) + HOOK-05 (secondFactor echo).
 *
 * Mock harness analog: src/__tests__/analytics-oauth.test.ts:1-200 (3-branch
 * harness — getOAuthUserByProvider/Email mock-driven branch selection).
 *
 * Fire-point line refs (post-Plan 14-03):
 *   Branch 1 (existing user, same provider):  src/server/oauth/router.ts:265
 *   Branch 2 (existing user, link by email):  src/server/oauth/router.ts:318
 *   Branch 3 (new user):                      src/server/oauth/router.ts:417
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOAuthRouter } from '../server/oauth/router.js';
import type { DatabaseAdapter, OAuthConfig } from '../types/index.js';
import type { SessionManager } from '../server/session.js';
import type { MPCAccountManager } from '../server/mpc.js';
import type { OAuthManager, OAuthProfile } from '../server/oauth/index.js';
import type { AnalyticsEvent } from '../server/analytics.js';

// ---------------------------------------------------------------------------
// Mock harness — lifted from analytics-oauth.test.ts:32-160 verbatim, with
// `afterAuthSuccess` spy added alongside the existing `onAuthEvent` spy.
// ---------------------------------------------------------------------------

type MockDb = DatabaseAdapter & {
  getOAuthState: ReturnType<typeof vi.fn>;
  deleteOAuthState: ReturnType<typeof vi.fn>;
  storeOAuthState: ReturnType<typeof vi.fn>;
  getOAuthUserByProvider: ReturnType<typeof vi.fn>;
  getOAuthUserByEmail: ReturnType<typeof vi.fn>;
  createOAuthUser: ReturnType<typeof vi.fn>;
  linkOAuthProvider: ReturnType<typeof vi.fn>;
  storeRecoveryData: ReturnType<typeof vi.fn>;
};

const fakeProfile: OAuthProfile = {
  provider: 'google',
  providerId: 'provider-id-1',
  email: 'oauth-user@example.com',
  name: 'OAuth User',
  avatarUrl: 'https://avatar.example/u.png',
  raw: {},
};

function makeMockDb(): MockDb {
  return {
    getOAuthState: vi.fn().mockResolvedValue(null),
    deleteOAuthState: vi.fn().mockResolvedValue(undefined),
    storeOAuthState: vi.fn().mockResolvedValue(undefined),
    createOAuthUser: vi.fn(),
    getOAuthUserByProvider: vi.fn().mockResolvedValue(null),
    getOAuthUserByEmail: vi.fn().mockResolvedValue(null),
    linkOAuthProvider: vi.fn().mockResolvedValue(undefined),
    storeRecoveryData: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  } as unknown as MockDb;
}

const mockSessionManager = {
  createSession: vi.fn().mockResolvedValue(undefined),
  getSession: vi.fn().mockResolvedValue(null),
  destroySession: vi.fn().mockResolvedValue(undefined),
  extendSession: vi.fn().mockResolvedValue(undefined),
} as unknown as SessionManager;

const mockMpcManager = {
  createAccount: vi.fn().mockResolvedValue({
    nearAccountId: 'oauth-near-account-new',
    mpcPublicKey: 'ed25519:OAUTHKEY',
    derivationPath: 'near-anon-auth,oauth-1',
  }),
  addRecoveryWallet: vi.fn().mockResolvedValue(undefined),
} as unknown as MPCAccountManager;

const mockOAuthConfig: OAuthConfig = {
  callbackBaseUrl: 'http://localhost:3000/oauth',
  google: undefined,
  github: undefined,
  twitter: undefined,
};

function makeMockOAuthManager(opts: {
  validateState?: () => Promise<unknown>;
  exchangeCode?: () => Promise<unknown>;
  getProfile?: () => Promise<OAuthProfile>;
} = {}): OAuthManager {
  return {
    isConfigured: () => true,
    getAuthUrl: vi.fn(),
    exchangeCode: vi.fn(
      opts.exchangeCode ??
        (async () => ({
          accessToken: 'test-token',
          expiresIn: 3600,
          tokenType: 'Bearer',
        })),
    ) as unknown as OAuthManager['exchangeCode'],
    getProfile: vi.fn(
      opts.getProfile ?? (async () => fakeProfile),
    ) as unknown as OAuthManager['getProfile'],
    validateState: vi.fn(
      opts.validateState ??
        (async () => ({
          state: 'test-state',
          provider: 'google',
          codeVerifier: 'test-verifier',
          redirectUri: 'http://localhost:3000/oauth/google',
          expiresAt: new Date(Date.now() + 600000),
        })),
    ) as unknown as OAuthManager['validateState'],
  };
}

interface AppOverrides {
  mockDb?: MockDb;
  oauthManager?: OAuthManager;
  rpId?: string;
  ipfsRecovery?: unknown;
}

function makeOAuthApp(overrides: AppOverrides = {}) {
  const afterAuthSuccess = vi.fn();
  const onAuthEvent = vi.fn();
  const app = express();
  app.use(express.json());
  const cfg: Record<string, unknown> = {
    db: overrides.mockDb ?? makeMockDb(),
    sessionManager: mockSessionManager,
    mpcManager: mockMpcManager,
    oauthConfig: mockOAuthConfig,
    oauthManager: overrides.oauthManager ?? makeMockOAuthManager(),
    rpId: overrides.rpId ?? 'localhost',
    hooks: { afterAuthSuccess, onAuthEvent },
  };
  if (overrides.ipfsRecovery !== undefined) cfg.ipfsRecovery = overrides.ipfsRecovery;
  const router = createOAuthRouter(cfg as any);
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

// T-14-02 cookie leak guard for OAuth: the router always emits clearCookie
// hygiene for `oauth_state` and `oauth_code_verifier` (expired Set-Cookie
// entries — those are NOT session cookies). The leak we guard against is a
// LIVE session cookie. Helper: every Set-Cookie entry must be expired.
function noLiveSessionCookie(setCookieHeader: string[] | string | undefined): boolean {
  if (!setCookieHeader) return true;
  const entries = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return entries.every((c) => /Expires=Thu, 01 Jan 1970/i.test(c));
}

const CALLBACK_BODY = { code: 'test-code', state: 'test-state' };

const existingUserSameProvider = {
  id: 'oauth-user-1',
  email: 'existing@example.com',
  name: 'Existing User',
  avatarUrl: null,
  nearAccountId: 'oauth-near-acct-1',
  mpcPublicKey: 'ed25519:OAUTHKEY',
  derivationPath: 'near-anon-auth,oauth-user-1',
  providers: [
    { provider: 'google', providerId: 'pid-1', email: 'existing@example.com', connectedAt: new Date() },
  ],
  createdAt: new Date(),
  lastActiveAt: new Date(),
};

const existingUserByEmail = {
  id: 'oauth-user-2',
  email: 'oauth-user@example.com',
  name: 'Linked User',
  avatarUrl: null,
  nearAccountId: 'oauth-near-acct-2',
  mpcPublicKey: 'ed25519:OAUTHKEY2',
  derivationPath: 'near-anon-auth,oauth-user-2',
  providers: [],
  createdAt: new Date(),
  lastActiveAt: new Date(),
};

const newUser = {
  id: 'oauth-user-3',
  email: 'oauth-user@example.com',
  name: 'New User',
  avatarUrl: null,
  nearAccountId: 'oauth-near-account-new',
  mpcPublicKey: 'ed25519:OAUTHKEY',
  derivationPath: 'near-anon-auth,oauth-1',
  providers: [],
  createdAt: new Date(),
  lastActiveAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockSessionManager.createSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockMpcManager.createAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
    nearAccountId: 'oauth-near-account-new',
    mpcPublicKey: 'ed25519:OAUTHKEY',
    derivationPath: 'near-anon-auth,oauth-1',
  });
});

// ===========================================================================
// Branch 1 — existing user, same provider
// ===========================================================================

describe('HOOK-04: afterAuthSuccess fires on OAuth /callback — Branch 1 (existing user, same provider)', () => {
  function branch1Db(): MockDb {
    const db = makeMockDb();
    db.getOAuthUserByProvider.mockResolvedValue(existingUserSameProvider);
    return db;
  }

  it('hook is called exactly once with oauth-<provider> ctx', async () => {
    const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: branch1Db() });
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/google/callback').send(CALLBACK_BODY).expect(200);
    expect(afterAuthSuccess).toHaveBeenCalledTimes(1);
    expect(afterAuthSuccess.mock.calls[0][0]).toMatchObject({
      authMethod: 'oauth-google',
      userId: existingUserSameProvider.id,
      nearAccountId: existingUserSameProvider.nearAccountId,
      provider: 'google',
    });
  });

  it("ctx.authMethod is one of 'oauth-google' | 'oauth-github' | 'oauth-twitter' matching the path :provider", async () => {
    for (const provider of ['google', 'github', 'twitter'] as const) {
      const db = makeMockDb();
      db.getOAuthUserByProvider.mockResolvedValue(existingUserSameProvider);
      const oauthManager = makeMockOAuthManager({
        validateState: async () => ({
          state: 'test-state',
          provider,
          codeVerifier: 'test-verifier',
          redirectUri: `http://localhost:3000/oauth/${provider}`,
          expiresAt: new Date(Date.now() + 600000),
        }),
        getProfile: async () => ({ ...fakeProfile, provider }),
      });
      const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: db, oauthManager });
      afterAuthSuccess.mockResolvedValue({ continue: true });
      await request(app).post(`/${provider}/callback`).send(CALLBACK_BODY).expect(200);
      expect(afterAuthSuccess.mock.calls[0][0].authMethod).toBe(`oauth-${provider}`);
    }
  });

  it('ctx.provider matches the path :provider literal', async () => {
    const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: branch1Db() });
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/google/callback').send(CALLBACK_BODY).expect(200);
    expect(afterAuthSuccess.mock.calls[0][0].provider).toBe('google');
  });

  it('ctx.codename is OMITTED on OAuth ctx (OAuthUser has no codename in v0.7.0)', async () => {
    const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: branch1Db() });
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/google/callback').send(CALLBACK_BODY).expect(200);
    const ctx = afterAuthSuccess.mock.calls[0][0];
    expect(ctx).not.toHaveProperty('codename');
  });

  it('continue:true allows sessionManager.createSession + standard OAuth response', async () => {
    const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: branch1Db() });
    afterAuthSuccess.mockResolvedValue({ continue: true });
    const res = await request(app).post('/google/callback').send(CALLBACK_BODY).expect(200);
    expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({ success: true, isNewUser: false });
    expect(res.body.secondFactor).toBeUndefined();
  });

  it('continue:false short-circuits: status, spread body, secondFactor echo', async () => {
    const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: branch1Db() });
    afterAuthSuccess.mockResolvedValue({
      continue: false,
      status: 202,
      body: { needsSecondFactor: true, totpUri: 'otpauth://totp/example' },
    });
    const res = await request(app).post('/google/callback').send(CALLBACK_BODY).expect(202);
    expect(res.body.needsSecondFactor).toBe(true);
    expect(res.body.totpUri).toBe('otpauth://totp/example');
    expect(res.body.secondFactor).toMatchObject({
      status: 202,
      body: { needsSecondFactor: true, totpUri: 'otpauth://totp/example' },
    });
  });

  it('continue:false skips sessionManager.createSession; no Set-Cookie (T-14-02)', async () => {
    const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: branch1Db() });
    afterAuthSuccess.mockResolvedValue({ continue: false, status: 202, body: {} });
    const res = await request(app).post('/google/callback').send(CALLBACK_BODY).expect(202);
    expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    expect(noLiveSessionCookie(res.headers['set-cookie'] as any)).toBe(true);
  });

  it('Pitfall 4 Option A: oauth.callback.success fires regardless of short-circuit', async () => {
    // continue:true
    let bundle = makeOAuthApp({ mockDb: branch1Db() });
    bundle.afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(bundle.app).post('/google/callback').send(CALLBACK_BODY).expect(200);
    expect(findEvent(bundle.onAuthEvent, 'oauth.callback.success')).toBeDefined();

    // continue:false
    bundle = makeOAuthApp({ mockDb: branch1Db() });
    bundle.afterAuthSuccess.mockResolvedValue({ continue: false, status: 202, body: {} });
    await request(bundle.app).post('/google/callback').send(CALLBACK_BODY).expect(202);
    expect(findEvent(bundle.onAuthEvent, 'oauth.callback.success')).toBeDefined();
  });
});

// ===========================================================================
// Branch 2 — existing user, link by email
// ===========================================================================

describe('HOOK-04: afterAuthSuccess fires on OAuth /callback — Branch 2 (existing user, link by email)', () => {
  function branch2Db(): MockDb {
    const db = makeMockDb();
    db.getOAuthUserByProvider.mockResolvedValue(null);
    db.getOAuthUserByEmail.mockResolvedValue(existingUserByEmail);
    return db;
  }

  it('hook fires AFTER db.linkOAuthProvider and BEFORE createSession', async () => {
    const db = branch2Db();
    const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: db });
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/google/callback').send(CALLBACK_BODY).expect(200);

    expect(db.linkOAuthProvider).toHaveBeenCalledTimes(1);
    expect(afterAuthSuccess).toHaveBeenCalledTimes(1);
    // call-order: linkOAuthProvider before afterAuthSuccess before createSession
    const linkOrder = (db.linkOAuthProvider.mock as any).invocationCallOrder[0];
    const hookOrder = (afterAuthSuccess.mock as any).invocationCallOrder[0];
    const sessionOrder = ((mockSessionManager.createSession as ReturnType<typeof vi.fn>).mock as any).invocationCallOrder[0];
    expect(linkOrder).toBeLessThan(hookOrder);
    expect(hookOrder).toBeLessThan(sessionOrder);
  });

  it('ctx contains nearAccountId from the linked existing user', async () => {
    const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: branch2Db() });
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/google/callback').send(CALLBACK_BODY).expect(200);
    expect(afterAuthSuccess.mock.calls[0][0]).toMatchObject({
      authMethod: 'oauth-google',
      userId: existingUserByEmail.id,
      nearAccountId: existingUserByEmail.nearAccountId,
      provider: 'google',
    });
  });

  it('continue:false short-circuits with all HOOK-05 contract intact', async () => {
    const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: branch2Db() });
    afterAuthSuccess.mockResolvedValue({
      continue: false,
      status: 202,
      body: { needsSecondFactor: true },
    });
    const res = await request(app).post('/google/callback').send(CALLBACK_BODY).expect(202);
    expect(res.body.needsSecondFactor).toBe(true);
    expect(res.body.secondFactor).toMatchObject({ status: 202, body: { needsSecondFactor: true } });
    expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    expect(noLiveSessionCookie(res.headers['set-cookie'] as any)).toBe(true);
  });
});

// ===========================================================================
// Branch 3 — new user (with IPFS recovery; widest orphan trade-off)
// ===========================================================================

describe('HOOK-04: afterAuthSuccess fires on OAuth /callback — Branch 3 (new user)', () => {
  function branch3Db(): MockDb {
    const db = makeMockDb();
    db.getOAuthUserByProvider.mockResolvedValue(null);
    db.getOAuthUserByEmail.mockResolvedValue(null);
    db.createOAuthUser.mockResolvedValue(newUser);
    return db;
  }

  function makeIpfsRecovery() {
    return {
      validatePassword: vi.fn().mockReturnValue({ valid: true, errors: [] }),
      createRecoveryBackup: vi.fn().mockResolvedValue({
        cid: 'QmTestCID1234567890',
        passwordStrength: 'strong',
      }),
      recoverFromBackup: vi.fn(),
    };
  }

  it('hook fires AFTER mpcManager.createAccount + db.createOAuthUser + IPFS recovery setup, BEFORE createSession', async () => {
    const db = branch3Db();
    const ipfsRecovery = makeIpfsRecovery();
    const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: db, ipfsRecovery });
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/google/callback').send(CALLBACK_BODY).expect(200);

    expect(mockMpcManager.createAccount).toHaveBeenCalledTimes(1);
    expect(db.createOAuthUser).toHaveBeenCalledTimes(1);
    expect(ipfsRecovery.createRecoveryBackup).toHaveBeenCalledTimes(1);
    expect(afterAuthSuccess).toHaveBeenCalledTimes(1);

    // Call-order: MPC < createOAuthUser < IPFS < hook < session
    const mpcOrder = ((mockMpcManager.createAccount as ReturnType<typeof vi.fn>).mock as any).invocationCallOrder[0];
    const userOrder = (db.createOAuthUser.mock as any).invocationCallOrder[0];
    const ipfsOrder = (ipfsRecovery.createRecoveryBackup.mock as any).invocationCallOrder[0];
    const hookOrder = (afterAuthSuccess.mock as any).invocationCallOrder[0];
    const sessionOrder = ((mockSessionManager.createSession as ReturnType<typeof vi.fn>).mock as any).invocationCallOrder[0];
    expect(mpcOrder).toBeLessThan(userOrder);
    expect(userOrder).toBeLessThan(ipfsOrder);
    expect(ipfsOrder).toBeLessThan(hookOrder);
    expect(hookOrder).toBeLessThan(sessionOrder);
  });

  it('ctx contains nearAccountId from the freshly created user', async () => {
    const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: branch3Db(), ipfsRecovery: makeIpfsRecovery() });
    afterAuthSuccess.mockResolvedValue({ continue: true });
    await request(app).post('/google/callback').send(CALLBACK_BODY).expect(200);
    expect(afterAuthSuccess.mock.calls[0][0]).toMatchObject({
      authMethod: 'oauth-google',
      userId: newUser.id,
      nearAccountId: newUser.nearAccountId,
      provider: 'google',
    });
  });

  it('continue:false short-circuits — but user, MPC account, and IPFS blob are ALL committed (Pitfall 6 / T-14-04)', async () => {
    const db = branch3Db();
    const ipfsRecovery = makeIpfsRecovery();
    const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: db, ipfsRecovery });
    afterAuthSuccess.mockResolvedValue({ continue: false, status: 202, body: {} });
    const res = await request(app).post('/google/callback').send(CALLBACK_BODY).expect(202);

    // Pitfall 6 / T-14-04: user, MPC account, IPFS blob, AND recovery row ALL committed
    expect(db.createOAuthUser).toHaveBeenCalledTimes(1);
    expect(mockMpcManager.createAccount).toHaveBeenCalledTimes(1);
    expect(ipfsRecovery.createRecoveryBackup).toHaveBeenCalledTimes(1);
    expect(db.storeRecoveryData).toHaveBeenCalledTimes(1);
    // Only the session is skipped
    expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    expect(noLiveSessionCookie(res.headers['set-cookie'] as any)).toBe(true);
  });

  it('continue:true allows session + isNewUser:true response', async () => {
    const { app, afterAuthSuccess } = makeOAuthApp({ mockDb: branch3Db(), ipfsRecovery: makeIpfsRecovery() });
    afterAuthSuccess.mockResolvedValue({ continue: true });
    const res = await request(app).post('/google/callback').send(CALLBACK_BODY).expect(200);
    expect(res.body).toMatchObject({ success: true, isNewUser: true });
    expect(res.body.secondFactor).toBeUndefined();
    expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Backwards compat — no hook configured
// ===========================================================================

describe('HOOK-04: backwards compatibility (no hook configured)', () => {
  function appWithoutHook(mockDb: MockDb, opts: { ipfsRecovery?: unknown } = {}) {
    const app = express();
    app.use(express.json());
    const cfg: Record<string, unknown> = {
      db: mockDb,
      sessionManager: mockSessionManager,
      mpcManager: mockMpcManager,
      oauthConfig: mockOAuthConfig,
      oauthManager: makeMockOAuthManager(),
      rpId: 'localhost',
      hooks: {},
    };
    if (opts.ipfsRecovery !== undefined) cfg.ipfsRecovery = opts.ipfsRecovery;
    const router = createOAuthRouter(cfg as any);
    app.use(router);
    return app;
  }

  it('hooks: {} on createOAuthRouter → all 3 branches run unchanged', async () => {
    // Branch 1
    let db = makeMockDb();
    db.getOAuthUserByProvider.mockResolvedValue(existingUserSameProvider);
    let res = await request(appWithoutHook(db)).post('/google/callback').send(CALLBACK_BODY).expect(200);
    expect(res.body.isNewUser).toBe(false);

    // Branch 2
    db = makeMockDb();
    db.getOAuthUserByProvider.mockResolvedValue(null);
    db.getOAuthUserByEmail.mockResolvedValue(existingUserByEmail);
    res = await request(appWithoutHook(db)).post('/google/callback').send(CALLBACK_BODY).expect(200);
    expect(res.body.linkedProvider).toBe('google');

    // Branch 3
    db = makeMockDb();
    db.getOAuthUserByProvider.mockResolvedValue(null);
    db.getOAuthUserByEmail.mockResolvedValue(null);
    db.createOAuthUser.mockResolvedValue(newUser);
    res = await request(appWithoutHook(db)).post('/google/callback').send(CALLBACK_BODY).expect(200);
    expect(res.body.isNewUser).toBe(true);
  });

  it('hooks omitted entirely → all 3 branches run unchanged', async () => {
    function appWithNoHooks(mockDb: MockDb) {
      const app = express();
      app.use(express.json());
      const router = createOAuthRouter({
        db: mockDb,
        sessionManager: mockSessionManager,
        mpcManager: mockMpcManager,
        oauthConfig: mockOAuthConfig,
        oauthManager: makeMockOAuthManager(),
        rpId: 'localhost',
      } as any);
      app.use(router);
      return app;
    }

    let db = makeMockDb();
    db.getOAuthUserByProvider.mockResolvedValue(existingUserSameProvider);
    await request(appWithNoHooks(db)).post('/google/callback').send(CALLBACK_BODY).expect(200);

    db = makeMockDb();
    db.getOAuthUserByProvider.mockResolvedValue(null);
    db.getOAuthUserByEmail.mockResolvedValue(existingUserByEmail);
    await request(appWithNoHooks(db)).post('/google/callback').send(CALLBACK_BODY).expect(200);

    db = makeMockDb();
    db.getOAuthUserByProvider.mockResolvedValue(null);
    db.getOAuthUserByEmail.mockResolvedValue(null);
    db.createOAuthUser.mockResolvedValue(newUser);
    await request(appWithNoHooks(db)).post('/google/callback').send(CALLBACK_BODY).expect(200);
  });
});
