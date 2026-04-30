/**
 * Phase 13 Plan 01 (Wave 0) — ANALYTICS-01 + ANALYTICS-06 stub.
 *
 * Covers:
 *   - ANALYTICS-01: every lifecycle event fires at the correct boundary
 *     on the passkey router, recovery endpoints, and account-deletion.
 *     OAuth lives in analytics-oauth.test.ts (separate harness).
 *   - ANALYTICS-06: register.finish.failure and login.finish.failure
 *     fire from every non-success exit (early returns + catch block).
 *
 * Analogs:
 *   - src/__tests__/registration-auth.test.ts:18-211 (mock harness)
 *   - src/__tests__/recovery.test.ts:254-541 (wallet/IPFS/delete coverage)
 *
 * When Plans 02 + 03 land, replace each `it.todo` with a supertest
 * `request(app).post(...)` block that asserts the onAuthEvent spy was
 * called with the expected event literal.
 */
import { describe, it } from 'vitest';

describe('ANALYTICS-01: passkey lifecycle events (Wave 0 stub)', () => {
  it.todo("POST /register/start emits { type: 'register.start', rpId, timestamp }");
  it.todo("POST /register/finish (success) emits { type: 'register.finish.success', rpId, timestamp, backupEligible }");
  it.todo("POST /register/finish emits register.finish.failure with reason='invalid-codename' on bad codename");
  it.todo("POST /register/finish emits register.finish.failure with reason='passkey-verification-failed' on verify=false");
  it.todo("POST /register/finish emits register.finish.failure with reason='internal-error' from catch block (passkeyManager throw)");
  it.todo("POST /login/start emits { type: 'login.start', rpId, timestamp, codenameProvided: boolean }");
  it.todo("POST /login/start does NOT include the codename string in the event payload");
  it.todo("POST /login/finish (success) emits { type: 'login.finish.success', rpId, timestamp, backupEligible }");
  it.todo("POST /login/finish emits login.finish.failure with reason='auth-failed' on verified=false");
  it.todo("POST /login/finish emits login.finish.failure with reason='user-not-found' when db lookup misses");
  it.todo("POST /login/finish emits login.finish.failure with reason='internal-error' from catch block");
});

describe('ANALYTICS-01: recovery lifecycle events (Wave 0 stub)', () => {
  it.todo("POST /recovery/wallet/verify emits recovery.wallet.link.success after storeRecoveryData");
  it.todo("POST /recovery/wallet/finish emits recovery.wallet.recover.success after createSession");
  it.todo("POST /recovery/ipfs/setup emits recovery.ipfs.setup.success after storeRecoveryData");
  it.todo("POST /recovery/ipfs/recover emits recovery.ipfs.recover.success after createSession");
});

describe('ANALYTICS-01: account-delete event (Wave 0 stub)', () => {
  it.todo("DELETE /account emits { type: 'account.delete', rpId, timestamp } after deleteUser");
});

describe('ANALYTICS-06: failure events emitted by default (Wave 0 stub)', () => {
  it.todo("register.finish.failure event fires WITHOUT consumer setting any opt-in flag");
  it.todo("login.finish.failure event reason field is one of the static enum values, never Error.message");
});
