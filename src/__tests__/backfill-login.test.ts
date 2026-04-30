/**
 * Phase 15 Plan 03 — BACKFILL-01 (hooks.backfillKeyBundle fires inside
 * /login/finish ONLY when sealingKeyHex was supplied) + BACKFILL-02
 * (result echoed on response under additive `backfill?` key) + BACKFILL-03
 * (hook throw is contained; login NEVER blocked).
 *
 * Mock harness analog: src/__tests__/analytics-lifecycle.test.ts:469-612
 *   (login describe blocks — full register-then-login fixture).
 * Hook-spy harness analog: src/__tests__/second-factor-login.test.ts:1-156
 *   (Phase 14 HOOK-03 — vi.fn() spy on hooks, supertest-driven, getUserById
 *   mock returns the user row).
 *
 * Each assertion below maps to the Phase 15 requirement contract and replaces
 * the Wave-0 todo placeholder 1:1.
 *
 * Fire-point line ref (post-Plan 15-02): src/server/router.ts /login/finish
 * handler — hook fires AFTER db.getUserById success, BEFORE
 * sessionManager.createSession, AND only when body.sealingKeyHex is defined.
 * The fire site is co-located with (or immediately adjacent to) the Phase 14
 * HOOK-03 fire site; relative ordering is part of the tested contract here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pino from 'pino';
import type { Logger } from 'pino';
import { createRouter } from '../server/router.js';
import type { DatabaseAdapter } from '../types/index.js';
import type { AnalyticsEvent } from '../server/analytics.js';

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

const VALID_HEX = 'a'.repeat(64);
const LOGIN_BODY = {
  challengeId: 'chal-auth-1',
  response: validAuthenticationResponse,
};
const LOGIN_BODY_WITH_SEALING_KEY = { ...LOGIN_BODY, sealingKeyHex: VALID_HEX };

interface MakeAppOpts {
  hooksMode?: 'default' | 'empty' | 'omit';
  logger?: Logger;
}

function makeApp(opts: MakeAppOpts = {}) {
  const afterAuthSuccess = vi.fn().mockResolvedValue({ continue: true });
  const backfillKeyBundle = vi.fn();
  const onAuthEvent = vi.fn();
  const app = express();
  app.use(express.json());

  let hooks: Record<string, unknown> | undefined;
  if (opts.hooksMode === 'omit') {
    hooks = undefined;
  } else if (opts.hooksMode === 'empty') {
    hooks = {};
  } else {
    hooks = { afterAuthSuccess, backfillKeyBundle, onAuthEvent };
  }

  const router = createRouter({
    db: mockDb,
    sessionManager: mockSessionManager as any,
    passkeyManager: mockPasskeyManager as any,
    mpcManager: mockMpcManager as any,
    rateLimiting: { auth: { limit: 1000, windowMs: 60000 } },
    rpId: 'localhost',
    hooks: hooks as any,
    logger: opts.logger,
  } as any);
  app.use(router);
  return { app, afterAuthSuccess, backfillKeyBundle, onAuthEvent };
}

function makeCapturedLogger(): { logger: Logger; entries: any[] } {
  const entries: any[] = [];
  const stream = {
    write: (msg: string) => {
      try {
        entries.push(JSON.parse(msg));
      } catch {
        entries.push({ raw: msg });
      }
    },
  };
  const logger = pino({ level: 'warn' }, stream as any);
  return { logger, entries };
}

function findEvent(spy: ReturnType<typeof vi.fn>, type: string): AnalyticsEvent | undefined {
  for (const call of spy.mock.calls) {
    const ev = call[0] as AnalyticsEvent;
    if (ev && ev.type === type) return ev;
  }
  return undefined;
}

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

describe('BACKFILL-01: backfillKeyBundle fires on POST /login/finish ONLY when sealingKeyHex was supplied', () => {
  it('hook is called exactly once with single-shape ctx when sealingKeyHex is supplied', async () => {
    const { app, backfillKeyBundle } = makeApp();
    backfillKeyBundle.mockResolvedValue({ backfilled: true, reason: 'completed' });
    await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(backfillKeyBundle).toHaveBeenCalledTimes(1);
  });

  it('ctx contains userId, codename, nearAccountId, sealingKeyHex, and a defined req field', async () => {
    const { app, backfillKeyBundle } = makeApp();
    backfillKeyBundle.mockResolvedValue({ backfilled: true, reason: 'completed' });
    await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    const ctx = backfillKeyBundle.mock.calls[0][0];
    expect(ctx).toMatchObject({
      userId: 'user-1',
      codename: 'ALPHA-BRAVO-7',
      nearAccountId: 'abc123def456',
      sealingKeyHex: VALID_HEX,
    });
    expect(ctx.req).toBeDefined();
  });

  it('ctx.sealingKeyHex matches the value supplied in the request body (64-char lowercase hex)', async () => {
    const { app, backfillKeyBundle } = makeApp();
    backfillKeyBundle.mockResolvedValue({ backfilled: true, reason: 'completed' });
    const customHex = 'cafebabedeadbeef'.repeat(4);
    await request(app).post('/login/finish').send({ ...LOGIN_BODY, sealingKeyHex: customHex }).expect(200);
    expect(backfillKeyBundle.mock.calls[0][0].sealingKeyHex).toBe(customHex);
  });

  it('hook is NOT called when sealingKeyHex is omitted from the request body (silent skip)', async () => {
    const { app, backfillKeyBundle } = makeApp();
    backfillKeyBundle.mockResolvedValue({ backfilled: true, reason: 'completed' });
    await request(app).post('/login/finish').send(LOGIN_BODY).expect(200);
    expect(backfillKeyBundle).not.toHaveBeenCalled();
  });

  it('response has NO `backfill` field when sealingKeyHex was omitted', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/login/finish').send(LOGIN_BODY).expect(200);
    expect(res.body.backfill).toBeUndefined();
  });

  it('hook is NOT called when sealingKeyHex is omitted, regardless of whether hooks.backfillKeyBundle is configured', async () => {
    const { app, backfillKeyBundle } = makeApp();
    await request(app).post('/login/finish').send(LOGIN_BODY).expect(200);
    expect(backfillKeyBundle).not.toHaveBeenCalled();
  });
});

describe('BACKFILL-02: hook result echoed on response under additive `backfill` key', () => {
  it("hook returning { backfilled: true, reason: 'completed' } produces response.body.backfill = { backfilled: true, reason: 'completed' }", async () => {
    const { app, backfillKeyBundle } = makeApp();
    backfillKeyBundle.mockResolvedValue({ backfilled: true, reason: 'completed' });
    const res = await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(res.body.backfill).toEqual({ backfilled: true, reason: 'completed' });
  });

  it("hook returning { backfilled: false, reason: 'already-current' } produces response.body.backfill = { backfilled: false, reason: 'already-current' }", async () => {
    const { app, backfillKeyBundle } = makeApp();
    backfillKeyBundle.mockResolvedValue({ backfilled: false, reason: 'already-current' });
    const res = await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(res.body.backfill).toEqual({ backfilled: false, reason: 'already-current' });
  });

  it("hook returning { backfilled: false, reason: 'no-legacy-data' } produces response.body.backfill matching", async () => {
    const { app, backfillKeyBundle } = makeApp();
    backfillKeyBundle.mockResolvedValue({ backfilled: false, reason: 'no-legacy-data' });
    const res = await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(res.body.backfill).toEqual({ backfilled: false, reason: 'no-legacy-data' });
  });

  it("hook returning { backfilled: false, reason: 'skipped' } produces response.body.backfill matching", async () => {
    const { app, backfillKeyBundle } = makeApp();
    backfillKeyBundle.mockResolvedValue({ backfilled: false, reason: 'skipped' });
    const res = await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(res.body.backfill).toEqual({ backfilled: false, reason: 'skipped' });
  });

  it('hook returning { backfilled: false } (reason omitted) produces response.body.backfill with reason undefined', async () => {
    const { app, backfillKeyBundle } = makeApp();
    backfillKeyBundle.mockResolvedValue({ backfilled: false });
    const res = await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(res.body.backfill).toEqual({ backfilled: false });
  });

  it('Existing AuthenticationFinishResponse fields (success, codename, passkey?) are unchanged when backfill is present', async () => {
    const { app, backfillKeyBundle } = makeApp();
    backfillKeyBundle.mockResolvedValue({ backfilled: true, reason: 'completed' });
    const res = await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(res.body).toMatchObject({
      success: true,
      codename: 'ALPHA-BRAVO-7',
      passkey: {
        backedUp: false,
        backupEligible: false,
      },
      backfill: { backfilled: true, reason: 'completed' },
    });
  });
});

describe('BACKFILL-03: hook throw is contained — login is NEVER blocked', () => {
  it("hook throwing synchronously (e.g., new Error('boom')) → response is 200 OK (NOT 500)", async () => {
    const { logger, entries } = makeCapturedLogger();
    const { app, backfillKeyBundle } = makeApp({ logger });
    backfillKeyBundle.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(res.status).toBe(200);
    expect(entries.some((entry) => entry.msg === 'backfill hook threw')).toBe(true);
  });

  it('hook returning a rejected Promise → response is 200 OK (NOT 500)', async () => {
    const { app, backfillKeyBundle } = makeApp();
    backfillKeyBundle.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(res.status).toBe(200);
  });

  it("hook throw → response.body.backfill = { backfilled: false, reason: 'skipped' } (BACKFILL-03 fallback)", async () => {
    const { app, backfillKeyBundle } = makeApp();
    backfillKeyBundle.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(res.body.backfill).toEqual({ backfilled: false, reason: 'skipped' });
  });

  it('hook throw → sessionManager.createSession IS called (login completes normally)', async () => {
    const { app, backfillKeyBundle } = makeApp();
    backfillKeyBundle.mockImplementation(() => {
      throw new Error('boom');
    });
    await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
  });

  it('hook throw → library logs WARN with redacted error payload (Error.name + stack frames; NEVER raw error message)', async () => {
    const { logger, entries } = makeCapturedLogger();
    const { app, backfillKeyBundle } = makeApp({ logger });
    backfillKeyBundle.mockImplementation(() => {
      throw new Error(`boom ${VALID_HEX}`);
    });
    await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    const warn = entries.find((entry) => entry.msg === 'backfill hook threw');
    expect(warn).toBeDefined();
    expect(warn.level).toBe(40);
    expect(warn.err).toMatchObject({ name: 'Error' });
    expect(warn.err.message).toBeUndefined();
    expect(JSON.stringify(warn)).not.toContain(VALID_HEX);
  });
});

describe('BACKFILL: backwards compatibility (Phase 11 contract — hooks: {} or hooks omitted)', () => {
  it('hooks: {} (no backfillKeyBundle, no afterAuthSuccess) → /login/finish flow unchanged, no `backfill` field on response', async () => {
    const { app } = makeApp({ hooksMode: 'empty' });
    const res = await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(res.body).toMatchObject({
      success: true,
      codename: 'ALPHA-BRAVO-7',
      passkey: {
        backedUp: false,
        backupEligible: false,
      },
    });
    expect(res.body.backfill).toBeUndefined();
  });

  it('hooks omitted entirely → /login/finish flow unchanged, no `backfill` field on response', async () => {
    const { app } = makeApp({ hooksMode: 'omit' });
    const res = await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.backfill).toBeUndefined();
  });

  it('Phase 14 hooks.afterAuthSuccess and Phase 15 hooks.backfillKeyBundle co-exist: both fire on /login/finish when configured AND sealingKeyHex supplied', async () => {
    const { app, afterAuthSuccess, backfillKeyBundle, onAuthEvent } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });
    backfillKeyBundle.mockResolvedValue({ backfilled: true, reason: 'completed' });
    await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(afterAuthSuccess).toHaveBeenCalledTimes(1);
    expect(backfillKeyBundle).toHaveBeenCalledTimes(1);
    expect(afterAuthSuccess.mock.invocationCallOrder[0]).toBeLessThan(backfillKeyBundle.mock.invocationCallOrder[0]);
    expect(findEvent(onAuthEvent, 'login.finish.success')).toBeDefined();
  });
});
