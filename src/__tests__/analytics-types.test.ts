/**
 * Phase 13 Plan 01 (Wave 0) — ANALYTICS-02 stub.
 *
 * Covers:
 *   - ANALYTICS-02: AnalyticsEvent discriminated-union forbids PII keys
 *     (compile-time narrowing assertions via assignment).
 *
 * Analog: src/__tests__/exports.test.ts:48-82 (compile + runtime cross-check
 * pattern). When Plan 02 lands `src/server/analytics.ts`, replace each
 * `it.todo(...)` below with a real `it(...)` that imports `AnalyticsEvent`
 * from `../server/analytics.js` and constructs one literal per variant.
 *
 * Wave 0 invariant: this file MUST be picked up by vitest. Production
 * imports are deliberately omitted — they land in Plan 02.
 */
import { describe, it } from 'vitest';

describe('ANALYTICS-02: AnalyticsEvent discriminated union (Wave 0 stub)', () => {
  it.todo('register.start variant assigns from { type, rpId, timestamp }');
  it.todo('register.finish.success variant requires backupEligible: boolean');
  it.todo('register.finish.failure variant requires reason: RegisterFailureReason');
  it.todo('login.start variant requires codenameProvided: boolean');
  it.todo('login.finish.success variant requires backupEligible: boolean');
  it.todo('login.finish.failure variant requires reason: LoginFailureReason');
  it.todo('all four recovery.*.success variants accept exactly { type, rpId, timestamp }');
  it.todo('oauth.callback.success variant requires provider: OauthProvider');
  it.todo('account.delete variant accepts exactly { type, rpId, timestamp }');
  it.todo('switch (event.type) exhausts the union (never assertion in default)');
  it.todo('AnalyticsEvent is re-exported from ../server/index.js (public surface)');
});
