/**
 * Phase 13 Plan 01 (Wave 0) — ANALYTICS-01 OAuth stub.
 *
 * Covers:
 *   - ANALYTICS-01: oauth.callback.success fires from all THREE OAuth
 *     code paths (Critical Constraint 3): existing-user-same-provider
 *     (oauth/router.ts:232), existing-user-link-by-email
 *     (oauth/router.ts:266), and new-user (oauth/router.ts:350).
 *
 * Critical Constraint 4: there is NO oauth.callback.failure variant —
 * REQUIREMENTS only lists success.
 *
 * Analog: src/__tests__/oauth-cookie-guard.test.ts (closest existing
 * OAuth-router supertest harness).
 *
 * When Plans 02 + 04 land, replace each `it.todo` with a real
 * `request(app).post('/auth/oauth/callback')` block that exercises the
 * three branches via different mockDb return values and asserts the
 * onAuthEvent spy was called with provider matching the test fixture.
 */
import { describe, it } from 'vitest';

describe('ANALYTICS-01: oauth.callback.success × 3 code paths (Wave 0 stub)', () => {
  it.todo("emits oauth.callback.success on existing-user-same-provider branch (oauth/router.ts:232)");
  it.todo("emits oauth.callback.success on existing-user-link-by-email branch (oauth/router.ts:266)");
  it.todo("emits oauth.callback.success on new-user branch (oauth/router.ts:350)");
  it.todo("event payload provider field is exactly the OAuth provider used (google|github|twitter)");
  it.todo("event payload contains NO email, NO userId, NO nearAccountId, NO codename");
  it.todo("does NOT emit any oauth.callback.failure variant on invalid state / token-exchange error");
});
