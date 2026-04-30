/**
 * Phase 14 Plan 04 — HOOK-06 (DB rollback on hook throw + orphan-MPC
 * change-detector).
 *
 * Mock harness analog: src/__tests__/analytics-lifecycle.test.ts:14-230
 *   (passkey register fixture) PLUS a NEW pattern: mockDb.transaction
 *   that emulates Postgres rollback semantics (call fn; on throw, rethrow
 *   without committing rows).
 *
 * This test file is a CHANGE DETECTOR. Its purpose is to encode the
 * orphan-MPC contract in CI: if mpcManager.createAccount ever moves
 * INSIDE the db.transaction() callback, this test will break — and the
 * planner will be forced to revisit the HOOK-06 README copy and the
 * trade-off documentation.
 *
 * Fire-point line ref: src/server/router.ts:201-281 (mpcManager.createAccount
 * at line 225 — BEFORE doRegistration callback at line 230).
 */
import { describe, it } from 'vitest';

describe('HOOK-06: hook throw on /register/finish triggers DB rollback (orphan MPC documented)', () => {
  it.todo('afterAuthSuccess.mockRejectedValue(new Error(...)) → response is 500');
  it.todo('mpcManager.createAccount was called EXACTLY ONCE before the throw (orphan-MPC contract)');
  it.todo('sessionManager.createSession was NOT called (hook threw before session creation)');
  it.todo('mockDb.transaction was invoked AND the throw propagated through it');
  it.todo('mpcManager.createAccount was called BEFORE mockDb.transaction (call-order assertion: encodes the orphan trade-off)');
  it.todo('register.finish.failure analytics fires with reason: "internal-error" from outer catch');
  it.todo('CHANGE-DETECTOR DOC: if MPC moves inside the transaction, this test breaks; planner reviews HOOK-06 README copy');
});
