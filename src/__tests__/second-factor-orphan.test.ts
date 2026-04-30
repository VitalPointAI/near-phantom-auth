/**
 * Phase 14 Plan 04 — HOOK-06 (DB rollback on hook throw + orphan-MPC
 * change-detector).
 *
 * Mock harness analog: src/__tests__/analytics-lifecycle.test.ts:14-230
 *   (passkey register fixture) PLUS a mockDb.transaction emulator that
 *   mirrors Postgres BEGIN/COMMIT/ROLLBACK semantics — call fn(adapter); on
 *   thrown rejection, rethrow without committing rows.
 *
 * This test file is a CHANGE DETECTOR. Its purpose is to encode the
 * orphan-MPC contract in CI: if mpcManager.createAccount ever moves
 * INSIDE the db.transaction() callback, the call-order assertion will
 * break — and the planner will be forced to revisit the HOOK-06 README
 * copy and the trade-off documentation.
 *
 * Fire-point line ref: src/server/router.ts:201-323 (mpcManager.createAccount
 * at line 225 — BEFORE doRegistration callback at line 230 — BEFORE the
 * db.transaction wrapper at line 287).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRouter } from '../server/router.js';
import type { DatabaseAdapter } from '../types/index.js';
import type { AnalyticsEvent } from '../server/analytics.js';

// ---------------------------------------------------------------------------
// Mock harness — lifted from analytics-lifecycle.test.ts:26-207.
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

const REGISTER_BODY = {
  challengeId: 'chal-reg-1',
  response: validRegistrationResponse,
  tempUserId: 'temp-user-1',
  codename: 'ALPHA-BRAVO-7',
};

let mockDb: DatabaseAdapter;
let mockTransaction: ReturnType<typeof vi.fn>;

/**
 * Build an app whose mockDb has a `transaction` method that emulates
 * Postgres BEGIN/COMMIT/ROLLBACK semantics:
 *   - Call fn(adapter) with the same adapter instance.
 *   - On async throw from fn, rethrow (Postgres adapter would call ROLLBACK;
 *     in this mock the rethrow IS the rollback signal — outer catch sees the
 *     throw and 500s).
 */
function makeAppWithTransaction(hookBehavior: () => any) {
  mockTransaction = vi.fn(async <T,>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> => {
    return await fn(mockDb);
  });
  mockDb = makeMockDb({ transaction: mockTransaction } as any);
  const afterAuthSuccess = vi.fn().mockImplementation(hookBehavior);
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

beforeEach(() => {
  vi.clearAllMocks();
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

describe('HOOK-06: hook throw on /register/finish triggers DB rollback (orphan MPC documented)', () => {
  it('afterAuthSuccess.mockRejectedValue(new Error(...)) → response is 500', async () => {
    const { app } = makeAppWithTransaction(() => Promise.reject(new Error('hook deliberately threw')));
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(500);
  });

  it('mpcManager.createAccount was called EXACTLY ONCE before the throw (orphan-MPC contract)', async () => {
    const { app } = makeAppWithTransaction(() => Promise.reject(new Error('throw')));
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(500);
    expect(mockMpcManager.createAccount).toHaveBeenCalledTimes(1);
  });

  it('sessionManager.createSession was NOT called (hook threw before session creation)', async () => {
    const { app } = makeAppWithTransaction(() => Promise.reject(new Error('throw')));
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(500);
    expect(mockSessionManager.createSession).not.toHaveBeenCalled();
  });

  it('mockDb.transaction was invoked AND the throw propagated through it', async () => {
    const { app } = makeAppWithTransaction(() => Promise.reject(new Error('throw')));
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(500);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // The transaction wrapper received the rejection — i.e., its promise rejected.
    // We can verify this indirectly: createUser was called inside fn(mockDb), and the
    // throw from afterAuthSuccess propagated up so the outer 500 fired.
    expect(mockDb.createUser).toHaveBeenCalledTimes(1);
  });

  it('mpcManager.createAccount was called BEFORE mockDb.transaction (call-order assertion: encodes the orphan trade-off)', async () => {
    const { app } = makeAppWithTransaction(() => Promise.reject(new Error('throw')));
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(500);
    // CHANGE-DETECTOR: if a future change moves MPC inside the transaction, this
    // assertion will FAIL. The planner is then forced to revisit the HOOK-06
    // README copy + orphan-MPC trade-off doc.
    const mpcCallOrder = (mockMpcManager.createAccount.mock as any).invocationCallOrder[0];
    const txCallOrder = (mockTransaction.mock as any).invocationCallOrder[0];
    expect(mpcCallOrder).toBeLessThan(txCallOrder);
  });

  it("register.finish.failure analytics fires with reason: 'internal-error' from outer catch", async () => {
    const { app, onAuthEvent } = makeAppWithTransaction(() => Promise.reject(new Error('throw')));
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(500);
    const failure = findEvent(onAuthEvent, 'register.finish.failure');
    expect(failure).toBeDefined();
    expect((failure as any).reason).toBe('internal-error');
  });

  it('CHANGE-DETECTOR DOC: if MPC moves inside the transaction, this test breaks; planner reviews HOOK-06 README copy', async () => {
    // This test exists to surface the change-detector intent in test runner output.
    // The actual structural check is in the call-order assertion above — when that
    // breaks, this docstring is the one that explains WHY the planner must intervene.
    const { app } = makeAppWithTransaction(() => Promise.reject(new Error('throw')));
    await request(app).post('/register/finish').send(REGISTER_BODY).expect(500);
    // Concrete invariants asserted here mirror the call-order test so a single
    // change-set typically breaks both — the docstring + the structural check.
    expect(mockMpcManager.createAccount).toHaveBeenCalledTimes(1);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const mpcCallOrder = (mockMpcManager.createAccount.mock as any).invocationCallOrder[0];
    const txCallOrder = (mockTransaction.mock as any).invocationCallOrder[0];
    expect(mpcCallOrder).toBeLessThan(txCallOrder);
  });
});
