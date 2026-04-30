/**
 * Phase 13 Plan 04 — ANALYTICS-01 (oauth.callback.success × 3 branches).
 *
 * Per Critical Constraint 3 (and 13-RESEARCH.md Open Question #2 / Assumption A3):
 * the event MUST emit from all three OAuth success code paths:
 *   1. Existing user, same provider (oauth/router.ts ~line 234)
 *   2. Existing user, link by email (oauth/router.ts ~line 278)
 *   3. New user (oauth/router.ts ~line 362)
 *
 * Per Critical Constraint 4: there is NO oauth.callback.failure variant.
 * REQUIREMENTS line 51 lists success only.
 *
 * Mock harness analog: src/__tests__/oauth-cookie-guard.test.ts.
 *
 * Defense-in-depth: every captured event is scanned for forbidden PII keys
 * (`email`, `userId`, `nearAccountId`, `codename`, `ip`, `userAgent`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOAuthRouter } from '../server/oauth/router.js';
import type { DatabaseAdapter, OAuthStateRecord, OAuthConfig } from '../types/index.js';
import type { SessionManager } from '../server/session.js';
import type { MPCAccountManager } from '../server/mpc.js';
import type { OAuthManager, OAuthProfile } from '../server/oauth/index.js';
import type { AnalyticsEvent } from '../server/analytics.js';

// ---------------------------------------------------------------------------
// Mock harness — mirrors src/__tests__/oauth-cookie-guard.test.ts:25-79
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

const validOAuthStateRecord: OAuthStateRecord = {
  state: 'test-state',
  provider: 'google',
  codeVerifier: 'test-verifier',
  redirectUri: 'http://localhost:3000/oauth/google',
  expiresAt: new Date(Date.now() + 600000),
};

const fakeProfile: OAuthProfile = {
  provider: 'google',
  providerId: 'provider-id-1',
  email: 'real-user-pii@example.com',
  name: 'Real Name (PII)',
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
    nearAccountId: 'pii-near-account-1',
    mpcPublicKey: 'ed25519:TESTKEY',
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

/**
 * Build a stub OAuthManager. The real one would hit Google/GitHub/Twitter
 * over the network; in tests we control state validation, code exchange,
 * and profile retrieval directly.
 */
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

// ---------------------------------------------------------------------------
// App factory + onAuthEvent spy
// ---------------------------------------------------------------------------

interface AppOverrides {
  mockDb?: MockDb;
  oauthManager?: OAuthManager;
  rpId?: string;
  awaitAnalytics?: boolean;
}

function makeOAuthApp(overrides: AppOverrides = {}) {
  const onAuthEvent = vi.fn();
  const app = express();
  app.use(express.json());
  const router = createOAuthRouter({
    db: overrides.mockDb ?? makeMockDb(),
    sessionManager: mockSessionManager,
    mpcManager: mockMpcManager,
    oauthConfig: mockOAuthConfig,
    oauthManager: overrides.oauthManager ?? makeMockOAuthManager(),
    rpId: overrides.rpId ?? 'localhost',
    awaitAnalytics: overrides.awaitAnalytics ?? false,
    hooks: { onAuthEvent },
  });
  app.use(router);
  return { app, onAuthEvent };
}

// Defense-in-depth: emitted events must NOT carry PII keys.
const FORBIDDEN_PII_KEYS = ['userId', 'codename', 'nearAccountId', 'email', 'ip', 'userAgent'];

function expectNoPII(event: AnalyticsEvent) {
  const keys = Object.keys(event);
  for (const forbidden of FORBIDDEN_PII_KEYS) {
    expect(keys).not.toContain(forbidden);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockSessionManager.createSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockMpcManager.createAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
    nearAccountId: 'pii-near-account-1',
    mpcPublicKey: 'ed25519:TESTKEY',
    derivationPath: 'near-anon-auth,oauth-1',
  });
});

// ===========================================================================
// ANALYTICS-01: Branch 1 (existing user, same provider) — oauth/router.ts ~234
// ===========================================================================

describe('ANALYTICS-01: oauth.callback.success — Branch 1 (existing user, same provider)', () => {
  it("emits oauth.callback.success when existing-user-same-provider branch is hit", async () => {
    const mockDb = makeMockDb();
    // Branch 1: getOAuthUserByProvider returns an existing user
    mockDb.getOAuthUserByProvider.mockResolvedValue({
      id: 'oauth-user-1',
      email: 'existing@example.com',
      name: 'Existing User',
      avatarUrl: null,
      nearAccountId: 'pii-near-account-existing',
    });

    const { app, onAuthEvent } = makeOAuthApp({ mockDb });

    const res = await request(app)
      .post('/google/callback')
      .send({ code: 'test-code', state: 'test-state' });

    // Sanity: route reached the existing-user success branch
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(false);
    expect(res.body.linkedProvider).toBeUndefined();

    expect(onAuthEvent).toHaveBeenCalled();
    const events = onAuthEvent.mock.calls.map((c) => c[0] as AnalyticsEvent);
    const successEvent = events.find((e) => e.type === 'oauth.callback.success');
    expect(successEvent).toBeDefined();
    expect(successEvent).toMatchObject({
      type: 'oauth.callback.success',
      rpId: 'localhost',
      provider: 'google',
    });
    expect(typeof (successEvent as { timestamp: number }).timestamp).toBe('number');
    expectNoPII(successEvent!);
  });
});

// ===========================================================================
// ANALYTICS-01: Branch 2 (existing user, link by email) — oauth/router.ts ~278
// ===========================================================================

describe('ANALYTICS-01: oauth.callback.success — Branch 2 (existing user, link by email)', () => {
  it("emits oauth.callback.success when link-by-email branch is hit", async () => {
    const mockDb = makeMockDb();
    // Branch 2: getOAuthUserByProvider returns null + getOAuthUserByEmail returns existing user
    mockDb.getOAuthUserByProvider.mockResolvedValue(null);
    mockDb.getOAuthUserByEmail.mockResolvedValue({
      id: 'oauth-user-2',
      email: 'real-user-pii@example.com',
      name: 'Linked User',
      avatarUrl: null,
      nearAccountId: 'pii-near-account-linked',
    });

    const { app, onAuthEvent } = makeOAuthApp({ mockDb });

    const res = await request(app)
      .post('/google/callback')
      .send({ code: 'test-code', state: 'test-state' });

    // Sanity: route reached the link-by-email success branch
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(false);
    expect(res.body.linkedProvider).toBe('google');
    expect(mockDb.linkOAuthProvider).toHaveBeenCalled();

    expect(onAuthEvent).toHaveBeenCalled();
    const events = onAuthEvent.mock.calls.map((c) => c[0] as AnalyticsEvent);
    const successEvent = events.find((e) => e.type === 'oauth.callback.success');
    expect(successEvent).toBeDefined();
    expect(successEvent).toMatchObject({
      type: 'oauth.callback.success',
      rpId: 'localhost',
      provider: 'google',
    });
    expect(typeof (successEvent as { timestamp: number }).timestamp).toBe('number');
    expectNoPII(successEvent!);
  });
});

// ===========================================================================
// ANALYTICS-01: Branch 3 (new user) — oauth/router.ts ~362
// ===========================================================================

describe('ANALYTICS-01: oauth.callback.success — Branch 3 (new user)', () => {
  it("emits oauth.callback.success when new-user branch is hit", async () => {
    const mockDb = makeMockDb();
    // Branch 3: both getOAuthUserByProvider and getOAuthUserByEmail return null;
    // createOAuthUser succeeds (returns the freshly minted user)
    mockDb.getOAuthUserByProvider.mockResolvedValue(null);
    mockDb.getOAuthUserByEmail.mockResolvedValue(null);
    mockDb.createOAuthUser.mockResolvedValue({
      id: 'oauth-user-3',
      email: 'real-user-pii@example.com',
      name: 'New User',
      avatarUrl: null,
      nearAccountId: 'pii-near-account-new',
      mpcPublicKey: 'ed25519:TESTKEY',
      derivationPath: 'near-anon-auth,oauth-1',
    });

    const { app, onAuthEvent } = makeOAuthApp({ mockDb });

    const res = await request(app)
      .post('/google/callback')
      .send({ code: 'test-code', state: 'test-state' });

    // Sanity: route reached the new-user success branch
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(true);
    expect(mockDb.createOAuthUser).toHaveBeenCalled();

    expect(onAuthEvent).toHaveBeenCalled();
    const events = onAuthEvent.mock.calls.map((c) => c[0] as AnalyticsEvent);
    const successEvent = events.find((e) => e.type === 'oauth.callback.success');
    expect(successEvent).toBeDefined();
    expect(successEvent).toMatchObject({
      type: 'oauth.callback.success',
      rpId: 'localhost',
      provider: 'google',
    });
    expect(typeof (successEvent as { timestamp: number }).timestamp).toBe('number');
    expectNoPII(successEvent!);
  });
});

// ===========================================================================
// ANALYTICS-01: provider field correctness across all 3 providers
// ===========================================================================

describe('ANALYTICS-01: provider field correctness', () => {
  it.each(['google', 'github', 'twitter'] as const)(
    "event.provider matches the test fixture provider %s (Branch 1 — existing user)",
    async (provider) => {
      const mockDb = makeMockDb();
      mockDb.getOAuthUserByProvider.mockResolvedValue({
        id: `oauth-user-${provider}`,
        email: `${provider}-user@example.com`,
        name: 'Provider User',
        avatarUrl: null,
        nearAccountId: 'pii-near-account-x',
      });

      // OAuthManager.validateState must report a record with the matching provider
      const oauthManager = makeMockOAuthManager({
        validateState: async () => ({
          state: 'test-state',
          provider,
          codeVerifier: 'test-verifier',
          redirectUri: `http://localhost:3000/oauth/${provider}`,
          expiresAt: new Date(Date.now() + 600000),
        }),
        getProfile: async () => ({
          provider,
          providerId: `${provider}-pid-1`,
          email: `${provider}-user@example.com`,
          name: 'Provider User',
          avatarUrl: 'https://avatar/x.png',
          raw: {},
        }),
      });

      const { app, onAuthEvent } = makeOAuthApp({ mockDb, oauthManager });

      const res = await request(app)
        .post(`/${provider}/callback`)
        .send({ code: 'test-code', state: 'test-state' });

      expect(res.status).toBe(200);
      expect(onAuthEvent).toHaveBeenCalled();
      const events = onAuthEvent.mock.calls.map((c) => c[0] as AnalyticsEvent);
      const successEvent = events.find((e) => e.type === 'oauth.callback.success');
      expect(successEvent).toBeDefined();
      expect(successEvent).toMatchObject({
        type: 'oauth.callback.success',
        rpId: 'localhost',
        provider,
      });
      expectNoPII(successEvent!);
    },
  );
});

// ===========================================================================
// ANALYTICS-01: PII negative checks (defense-in-depth)
// ===========================================================================

describe('ANALYTICS-01: PII negative checks', () => {
  it('event payload contains NO email, NO userId, NO nearAccountId, NO codename (Branch 1)', async () => {
    const mockDb = makeMockDb();
    // Use clearly-identifiable PII values that would surface in JSON.stringify
    // if any of them leaked into the event payload.
    mockDb.getOAuthUserByProvider.mockResolvedValue({
      id: 'PII-USER-ID',
      email: 'PII-EMAIL@example.com',
      name: 'Existing User',
      avatarUrl: null,
      nearAccountId: 'PII-NEAR-ACCOUNT',
    });

    const { app, onAuthEvent } = makeOAuthApp({ mockDb });

    await request(app)
      .post('/google/callback')
      .send({ code: 'test-code', state: 'test-state' });

    expect(onAuthEvent).toHaveBeenCalled();
    const events = onAuthEvent.mock.calls.map((c) => c[0] as AnalyticsEvent);
    const successEvent = events.find((e) => e.type === 'oauth.callback.success');
    expect(successEvent).toBeDefined();

    // Structural: forbidden keys absent
    expectNoPII(successEvent!);

    // String-level: no PII values appear in the serialized payload
    const serialized = JSON.stringify(successEvent);
    expect(serialized).not.toMatch(/PII-EMAIL/);
    expect(serialized).not.toMatch(/PII-USER-ID/);
    expect(serialized).not.toMatch(/PII-NEAR-ACCOUNT/);
  });

  it('event payload contains NO PII keys on Branch 3 (new user)', async () => {
    const mockDb = makeMockDb();
    mockDb.getOAuthUserByProvider.mockResolvedValue(null);
    mockDb.getOAuthUserByEmail.mockResolvedValue(null);
    mockDb.createOAuthUser.mockResolvedValue({
      id: 'PII-USER-ID-NEW',
      email: 'PII-EMAIL-NEW@example.com',
      name: 'New User',
      avatarUrl: null,
      nearAccountId: 'PII-NEAR-ACCOUNT-NEW',
      mpcPublicKey: 'ed25519:TESTKEY',
      derivationPath: 'near-anon-auth,oauth-1',
    });

    const { app, onAuthEvent } = makeOAuthApp({ mockDb });

    await request(app)
      .post('/google/callback')
      .send({ code: 'test-code', state: 'test-state' });

    expect(onAuthEvent).toHaveBeenCalled();
    const events = onAuthEvent.mock.calls.map((c) => c[0] as AnalyticsEvent);
    const successEvent = events.find((e) => e.type === 'oauth.callback.success');
    expect(successEvent).toBeDefined();
    expectNoPII(successEvent!);

    const serialized = JSON.stringify(successEvent);
    expect(serialized).not.toMatch(/PII-EMAIL-NEW/);
    expect(serialized).not.toMatch(/PII-USER-ID-NEW/);
    expect(serialized).not.toMatch(/PII-NEAR-ACCOUNT-NEW/);
  });
});

// ===========================================================================
// ANALYTICS-01: failure branches do NOT emit (Critical Constraint 4)
// ===========================================================================

describe('ANALYTICS-01: failure branches do NOT emit (Critical Constraint 4)', () => {
  it('does NOT emit any oauth.callback.failure on invalid state', async () => {
    // OAuth manager reports state validation failure
    const oauthManager = makeMockOAuthManager({
      validateState: async () => null,
    });
    const { app, onAuthEvent } = makeOAuthApp({ oauthManager });

    const res = await request(app)
      .post('/google/callback')
      .send({ code: 'test-code', state: 'unknown-state' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid state');

    // Critical Constraint 4: NO oauth.callback.failure variant should EVER appear,
    // even when validation explicitly failed. The handler returns 400 silently
    // — no analytics event of ANY type from this code path.
    const events = onAuthEvent.mock.calls.map((c) => c[0] as AnalyticsEvent);
    const failureCalls = events.filter(
      (e) => typeof e?.type === 'string' && e.type.startsWith('oauth.callback.failure'),
    );
    expect(failureCalls).toEqual([]);
  });

  it('does NOT emit any oauth.callback.failure on token-exchange error', async () => {
    // OAuth manager succeeds at validateState but throws on exchangeCode
    const oauthManager = makeMockOAuthManager({
      exchangeCode: async () => {
        throw new Error('token exchange failed');
      },
    });
    const { app, onAuthEvent } = makeOAuthApp({ oauthManager });

    const res = await request(app)
      .post('/google/callback')
      .send({ code: 'bad-code', state: 'test-state' });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('OAuth authentication failed');

    const events = onAuthEvent.mock.calls.map((c) => c[0] as AnalyticsEvent);
    const failureCalls = events.filter(
      (e) => typeof e?.type === 'string' && e.type.startsWith('oauth.callback.failure'),
    );
    expect(failureCalls).toEqual([]);

    // Furthermore: NO oauth.callback.success should be emitted on the failure path
    const successCalls = events.filter(
      (e) => typeof e?.type === 'string' && e.type === 'oauth.callback.success',
    );
    expect(successCalls).toEqual([]);
  });
});
