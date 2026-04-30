/**
 * Phase 13 Plan 05 — ANALYTICS-04 implementation (latency, error swallow,
 * await mode). This file depends on the emit closure landed by Plans 02-03.
 *
 * Reference implementations:
 *   - Latency: 13-RESEARCH.md Code Examples lines 705-721
 *   - Error swallow: src/__tests__/logging.test.ts:31-40 pattern (pino with
 *     custom stream)
 *   - Mock harness: src/__tests__/registration-auth.test.ts:18-211
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import pino from 'pino';
import type { Logger } from 'pino';
import { createRouter } from '../server/router.js';
import type { DatabaseAdapter } from '../types/index.js';
import type { AnalyticsEvent } from '../server/analytics.js';

// ---------------------------------------------------------------------------
// Mock DatabaseAdapter — copied verbatim from registration-auth.test.ts:18-67
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
    getUserByCodename: vi.fn().mockResolvedValue(null),
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
    deleteRecoveryData: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock managers — copied verbatim from registration-auth.test.ts:73-118
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
// App factory + onAuthEvent spy
// ---------------------------------------------------------------------------

interface MakeAppOpts {
  onAuthEvent?: (event: AnalyticsEvent) => void | Promise<void>;
  awaitAnalytics?: boolean;
  logger?: Logger;
}

let mockDb: DatabaseAdapter;

function makeApp(opts: MakeAppOpts = {}) {
  const app = express();
  app.use(express.json());
  const router = createRouter({
    db: mockDb,
    sessionManager: mockSessionManager as any,
    passkeyManager: mockPasskeyManager as any,
    mpcManager: mockMpcManager as any,
    rpId: 'localhost',
    rateLimiting: { auth: { limit: 1000, windowMs: 60000 } },
    hooks: opts.onAuthEvent ? { onAuthEvent: opts.onAuthEvent } : undefined,
    awaitAnalytics: opts.awaitAnalytics,
    logger: opts.logger,
  } as any);
  app.use(router);
  return app;
}

/** Pino stream capture — mirrors src/__tests__/logging.test.ts:31-40. Drives
 *  `pino` to push every log entry into an array so the test can assert on the
 *  WARN entry produced by `wrapAnalytics` when the consumer's hook throws. */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ANALYTICS-04: fire-and-forget latency', () => {
  it('a 5s onAuthEvent hook does NOT add 5s to /register/start latency (elapsed < 500ms)', async () => {
    let hookResolved = false;
    const slowHook = async () => {
      await new Promise((r) => setTimeout(r, 5000));
      hookResolved = true;
    };

    const app = makeApp({ onAuthEvent: slowHook, awaitAnalytics: false });

    const t0 = performance.now();
    const res = await request(app).post('/register/start').send({});
    const elapsed = performance.now() - t0;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(500); // hook's 5s is NOT in critical path
    expect(hookResolved).toBe(false);  // hook still running in background
  }, 10_000);

  it('hookResolved remains false at the time the response returns (proof of fire-and-forget)', async () => {
    // Same fixture as above — explicit assertion that the response arrives
    // BEFORE the 5s timer fires, separated into its own it() block to
    // make the proof-of-fire-and-forget contract grep-visible.
    let hookResolved = false;
    const slowHook = async () => {
      await new Promise((r) => setTimeout(r, 5000));
      hookResolved = true;
    };

    const app = makeApp({ onAuthEvent: slowHook, awaitAnalytics: false });

    const t0 = performance.now();
    const res = await request(app).post('/register/start').send({});
    const elapsed = performance.now() - t0;

    expect(res.status).toBe(200);
    expect(hookResolved).toBe(false);
    // The 5s timer cannot have fired in the elapsed window.
    expect(elapsed).toBeLessThan(5000);
  }, 10_000);
});

describe('ANALYTICS-04: error swallow (sync throw)', () => {
  it('a synchronously-throwing onAuthEvent still produces a 200 OK response', async () => {
    const throwHook = () => {
      throw new Error('boom-codename-leak-ALPHA-7');
    };

    const { logger, entries } = makeCapturedLogger();
    const app = makeApp({ onAuthEvent: throwHook, logger });

    const res = await request(app).post('/register/start').send({});
    expect(res.status).toBe(200);

    // Find the WARN entry from the analytics module.
    const analyticsWarn = entries.find(
      (e) => e.level === 40 && e.module === 'analytics',
    );
    expect(analyticsWarn).toBeDefined();
    expect(analyticsWarn.err).toEqual(
      expect.objectContaining({ name: 'Error' }),
    );

    // CRITICAL: the redacted log MUST NOT contain Error.message.
    // The leaked codename is in the message; it must NOT survive redaction.
    expect(JSON.stringify(entries)).not.toContain('boom-codename-leak-ALPHA-7');

    // The 'err' field MUST NOT have a 'message' key.
    expect(analyticsWarn.err.message).toBeUndefined();
  });

  it('a hook returning a rejected Promise is also caught (.catch attached)', async () => {
    const rejectHook = () => Promise.reject(new Error('rejected-boom-ALPHA-7'));

    const { logger, entries } = makeCapturedLogger();
    const app = makeApp({ onAuthEvent: rejectHook, logger });

    const res = await request(app).post('/register/start').send({});
    expect(res.status).toBe(200);

    // Allow the .catch to fire — fire-and-forget mode does not await the
    // hook, so the rejection settles on the next microtask.
    await new Promise((r) => setImmediate(r));

    const analyticsWarn = entries.find(
      (e) => e.level === 40 && e.module === 'analytics',
    );
    expect(analyticsWarn).toBeDefined();
    expect(analyticsWarn.err).toEqual(expect.objectContaining({ name: 'Error' }));
    expect(JSON.stringify(entries)).not.toContain('rejected-boom-ALPHA-7');
    expect(analyticsWarn.err.message).toBeUndefined();
  });
});

describe('ANALYTICS-04: awaitAnalytics: true mode', () => {
  it('a 5s onAuthEvent hook ADDS ~5s to /register/start when awaitAnalytics is true', async () => {
    const slowHook = async () => {
      await new Promise((r) => setTimeout(r, 5000));
    };

    const app = makeApp({ onAuthEvent: slowHook, awaitAnalytics: true });

    const t0 = performance.now();
    const res = await request(app).post('/register/start').send({});
    const elapsed = performance.now() - t0;

    expect(res.status).toBe(200);
    expect(elapsed).toBeGreaterThan(4500); // await mode wired — hook's 5s IS in the critical path
  }, 10_000);

  it('a synchronously-throwing onAuthEvent in await mode STILL produces 200 OK (Critical Constraint 8 — errors swallowed)', async () => {
    const throwHook = () => {
      throw new Error('await-mode-throw-leak-7');
    };
    const { logger, entries } = makeCapturedLogger();
    const app = makeApp({ onAuthEvent: throwHook, awaitAnalytics: true, logger });

    const res = await request(app).post('/register/start').send({});
    expect(res.status).toBe(200);

    const analyticsWarn = entries.find(
      (e) => e.level === 40 && e.module === 'analytics',
    );
    expect(analyticsWarn).toBeDefined();
    expect(JSON.stringify(entries)).not.toContain('await-mode-throw-leak-7');
  }, 10_000);

  it('a Promise-rejecting onAuthEvent in await mode STILL produces 200 OK', async () => {
    const rejectHook = () => Promise.reject(new Error('await-rejected-leak-7'));
    const { logger, entries } = makeCapturedLogger();
    const app = makeApp({ onAuthEvent: rejectHook, awaitAnalytics: true, logger });

    const res = await request(app).post('/register/start').send({});
    expect(res.status).toBe(200);

    const analyticsWarn = entries.find(
      (e) => e.level === 40 && e.module === 'analytics',
    );
    expect(analyticsWarn).toBeDefined();
    expect(JSON.stringify(entries)).not.toContain('await-rejected-leak-7');
  }, 10_000);
});
