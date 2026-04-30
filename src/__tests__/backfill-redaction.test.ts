/**
 * Phase 15 Plan 03 — BACKFILL-03 redaction defense (T-15-03).
 *
 * `sealingKeyHex` is sensitive material (32-byte PRF-derived sealing key
 * for the consumer's DEK envelope). The library passes it to the consumer's
 * hook (intended exposure) but MUST NEVER write it to any log payload —
 * even in error paths.
 *
 * This file is a CHANGE DETECTOR. If a future PR adds a `log.warn({ ctx })`
 * or `log.error({ err: error.message })` (full message — sealingKeyHex may
 * appear in stacked Error messages built by careless consumers), this test
 * fails and forces a planner review.
 *
 * Hook-spy harness analog: src/__tests__/second-factor-login.test.ts:1-156
 * Pino capture pattern analog: src/__tests__/analytics-latency.test.ts:1-100
 *   (capture pino output via a writable stream; assert NO sealingKeyHex
 *   substring in any captured line).
 *
 * Redaction precedent: src/server/analytics.ts:109-119 redactErrorMessage
 *   (returns { name, stackHead } — never err.message). The Phase 15 hook
 *   throw catch-block MUST use this exact helper for the WARN log.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pino from 'pino';
import type { Logger } from 'pino';
import { createRouter } from '../server/router.js';
import type { DatabaseAdapter } from '../types/index.js';

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

const INFAMOUS_HEX = 'cafebabedeadbeef'.repeat(4);
const LOGIN_BODY_WITH_SEALING_KEY = {
  challengeId: 'chal-auth-1',
  response: validAuthenticationResponse,
  sealingKeyHex: INFAMOUS_HEX,
};

function makeCapturedLogger(): { logger: Logger; entries: any[]; rawLines: string[] } {
  const entries: any[] = [];
  const rawLines: string[] = [];
  const stream = {
    write: (msg: string) => {
      rawLines.push(msg);
      try {
        entries.push(JSON.parse(msg));
      } catch {
        entries.push({ raw: msg });
      }
    },
  };
  const logger = pino({ level: 'warn' }, stream as any);
  return { logger, entries, rawLines };
}

function makeApp(logger: Logger, backfillKeyBundle: (ctx: any) => Promise<unknown> | unknown) {
  const app = express();
  app.use(express.json());
  const router = createRouter({
    db: mockDb,
    sessionManager: mockSessionManager as any,
    passkeyManager: mockPasskeyManager as any,
    mpcManager: mockMpcManager as any,
    rateLimiting: { auth: { limit: 1000, windowMs: 60000 } },
    rpId: 'localhost',
    logger,
    hooks: {
      backfillKeyBundle,
      afterAuthSuccess: vi.fn().mockResolvedValue({ continue: true }),
    },
  } as any);
  app.use(router);
  return app;
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

describe('T-15-03: sealingKeyHex never appears in library log payload, even on hook throw', () => {
  it('Library WARN log on hook throw uses redactErrorMessage (Error.name + stack frames only) — assert log entry has shape { name: "Error", stackHead?: string }, NEVER an `err.message` field', async () => {
    const { logger, entries } = makeCapturedLogger();
    const app = makeApp(logger, () => {
      throw new Error(`backfill failed for ${INFAMOUS_HEX}`);
    });
    await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    const warn = entries.find((entry) => entry.msg === 'backfill hook threw');
    expect(warn).toBeDefined();
    expect(warn.err).toMatchObject({ name: 'Error' });
    expect(warn.err.message).toBeUndefined();
    if (warn.err.stackHead) {
      expect(warn.err.stackHead).not.toContain(INFAMOUS_HEX);
    }
  });

  it('Captured pino output contains ZERO occurrences of the supplied sealingKeyHex value (substring scan over all log lines)', async () => {
    const { logger, rawLines } = makeCapturedLogger();
    const app = makeApp(logger, () => {
      throw new Error(`backfill failed for ${INFAMOUS_HEX}`);
    });
    await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(rawLines.join('\n')).not.toContain(INFAMOUS_HEX);
  });

  it('Hook ctx is NEVER logged — no `log.*({ ctx })` call appears at the fire site (grep gate enforced in Plan 15-02 acceptance, also asserted at runtime by capturing logs and scanning for userId/codename/nearAccountId substrings)', async () => {
    const { logger, rawLines } = makeCapturedLogger();
    const app = makeApp(logger, () => {
      throw new Error('boom');
    });
    await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    const combined = rawLines.join('\n');
    expect(combined).not.toContain('user-1');
    expect(combined).not.toContain('ALPHA-BRAVO-7');
    expect(combined).not.toContain('abc123def456');
  });

  it('A consumer who throws an Error whose .message includes their sealingKeyHex (worst-case: `throw new Error(`backfill failed for ${ctx.sealingKeyHex}`)`) does NOT cause that hex to appear in captured log output (redactErrorMessage stack-frame-only contract holds)', async () => {
    const { logger, entries, rawLines } = makeCapturedLogger();
    const app = makeApp(logger, (ctx) => {
      throw new Error(`backfill failed for ${ctx.sealingKeyHex}`);
    });
    await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(rawLines.join('\n')).not.toContain(INFAMOUS_HEX);
    const warn = entries.find((entry) => entry.msg === 'backfill hook threw');
    expect(JSON.stringify(warn)).not.toContain(INFAMOUS_HEX);
  });

  it('Library logs at WARN level (not INFO/DEBUG) so consumers can opt-out via pino level config', async () => {
    const { logger, entries } = makeCapturedLogger();
    const app = makeApp(logger, () => {
      throw new Error('boom');
    });
    await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    const warn = entries.find((entry) => entry.msg === 'backfill hook threw');
    expect(warn.level).toBe(40);
  });

  it("Log message string is 'backfill hook threw' (or 'backfill hook rejected' for Promise rejection) — exact strings locked here for downstream consumer log-grep tooling", async () => {
    const { logger, entries } = makeCapturedLogger();
    const app = makeApp(logger, () => {
      throw new Error('boom');
    });
    await request(app).post('/login/finish').send(LOGIN_BODY_WITH_SEALING_KEY).expect(200);
    expect(entries.some((entry) => entry.msg === 'backfill hook threw')).toBe(true);
  });
});
