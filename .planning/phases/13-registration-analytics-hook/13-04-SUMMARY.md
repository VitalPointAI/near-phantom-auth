---
phase: 13-registration-analytics-hook
plan: 04
subsystem: server
tags: [analytics, emit-points, oauth-router, lifecycle, supertest, wave-2, v0.7.0]

# Dependency graph
requires:
  - phase: 13-registration-analytics-hook
    plan: 02
    provides: AnalyticsEvent discriminated union (oauth.callback.success variant), wrapAnalytics envelope, OauthProvider literal type, OAuthRouterConfig.rpId? + OAuthRouterConfig.awaitAnalytics? optional fields, createAnonAuth lockstep threading
  - phase: 13-registration-analytics-hook
    plan: 03
    provides: Canonical wrapAnalytics + emit closure-once pattern in src/server/router.ts; supertest + onAuthEvent spy + expectNoPII helper structure for analytics-lifecycle.test.ts (mirrored here for OAuth)
  - phase: 13-registration-analytics-hook
    plan: 01
    provides: 6 it.todo slots in src/__tests__/analytics-oauth.test.ts pre-registered with header docblock citing the analog harness in oauth-cookie-guard.test.ts
provides:
  - 3 inline emit({ type: 'oauth.callback.success', rpId, timestamp, provider }) call sites in src/server/oauth/router.ts — one per OAuth success branch (existing-user-same-provider, existing-user-link-by-email, new-user)
  - wrapAnalytics closure captured ONCE at createOAuthRouter() factory entry (Pitfall 2 mitigation; grep gate `wrapAnalytics(` = 1)
  - 10 supertest assertions in analytics-oauth.test.ts covering all 3 OAuth branches + provider parameterization (it.each over google/github/twitter) + 2 PII negative tests + 2 failure-branch negative tests (Critical Constraint 4)
  - Critical Constraint 4 enforced at the grep layer: `grep -c "oauth.callback.failure" src/server/oauth/router.ts` = 0; runtime test confirms failure branches emit ZERO events with type starting `oauth.callback.failure`
  - ANALYTICS-01 (passkey + recovery + account-delete + OAuth) now FULLY COMPLETE across Plans 03 + 04
affects: [13-05-latency-and-error-swallow, 14-second-factor-hook, 16-release-prep]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Inline emit({ type, rpId, timestamp, provider }) at every OAuth success branch — handlers are the only context that knows which branch they took, so events are constructed inline rather than centralized
    - Closure-once pattern: `const emit = wrapAnalytics(...)` at factory entry, NEVER per-request (Pitfall 2 — mirrors src/server/router.ts and the logger init pattern at every other manager)
    - Provider-parameterized OAuth callback test via `it.each(['google', 'github', 'twitter'] as const)` — single it.each block exercises all 3 providers with provider-matched validateState/getProfile mocks, asserts event.provider matches the fixture
    - Negative-test by filter: `failureCalls = events.filter(e => e.type.startsWith('oauth.callback.failure')); expect(failureCalls).toEqual([])` — proves Critical Constraint 4 at runtime even when the route returns 400/500
    - OAuthManager stubbing via `oauthManager` config field (already supported by createOAuthRouter for test injection) — test controls validateState/exchangeCode/getProfile directly without needing real OAuth providers

key-files:
  created:
    - .planning/phases/13-registration-analytics-hook/13-04-SUMMARY.md
  modified:
    - src/server/oauth/router.ts
    - src/__tests__/analytics-oauth.test.ts

key-decisions:
  - "wrapAnalytics import uses '../analytics.js' (one-level-up relative path) consistent with existing imports in oauth/router.ts (e.g. `'../session.js'`, `'../mpc.js'`); preserves NodeNext module resolution"
  - "Closure inserted AFTER existing config destructuring at line 62 (just after `emailService` field) and BEFORE `// Create rate limiter instance` — preserves the existing structural flow while ensuring `rpId` + `emit` are available for the OAuth callback handler"
  - "Mock OAuthManager helper (`makeMockOAuthManager`) injected via the `oauthManager` config field rather than mocking the createOAuthManager factory — the field already exists for INFRA-03 test injection (oauth-cookie-guard.test.ts pattern), so reusing it keeps the harness aligned with the canonical OAuth-router test convention"
  - "PII negative tests use clearly-identifiable token strings (`PII-EMAIL`, `PII-USER-ID`, `PII-NEAR-ACCOUNT`) in mockDb returns AND assert via `JSON.stringify(event)` regex that none of those tokens appear in the captured event payload — defense-in-depth on top of expectNoPII() structural check"
  - "Critical Constraint 4 negative tests cover BOTH state-validation failure (validateState returns null → 400) AND token-exchange failure (exchangeCode throws → 500) — proves no oauth.callback.failure variant is emitted on either failure code path"

patterns-established:
  - "OAuth-router emit point: every success branch emits inline emit({ type: 'oauth.callback.success', rpId, timestamp, provider }) BEFORE the corresponding `return res.json(...)`. Plan 14 (HOOK-04 — afterAuthSuccess) will install hook calls at the same three branches, AFTER the emit (so analytics fires regardless of hook outcome)."
  - "OAuthManager test stub: makeMockOAuthManager({ validateState?, exchangeCode?, getProfile? }) is the canonical pattern for any future OAuth-router test that needs to drive a specific success or failure branch. Plans 14 + 16 should reuse this helper rather than reinventing the OAuth flow mock."
  - "Critical-Constraint-by-runtime-test: when a constraint forbids a code variant (e.g. 'no oauth.callback.failure'), assert it both at the grep layer (CI) AND with a runtime negative test (filter the spy's mock.calls for the forbidden type, expect empty). Future negative-shape constraints in Plans 14 + 15 should follow this pattern."

requirements-completed: [ANALYTICS-01]

# Metrics
duration: 5m
completed: 2026-04-30
---

# Phase 13 Plan 04: OAuth Router Emit Points + Analytics-OAuth Tests Summary

**3 inline `oauth.callback.success` emit() call sites now fire from `src/server/oauth/router.ts` — one per OAuth success branch (existing-user-same-provider, existing-user-link-by-email, new-user) — with `wrapAnalytics` closure captured ONCE at factory entry, NO `oauth.callback.failure` variant introduced (Critical Constraint 4 enforced at both the grep layer and via runtime negative tests), and 10 supertest assertions in `analytics-oauth.test.ts` covering all 3 branches + provider parameterization (google/github/twitter) + 2 PII negative tests + 2 failure-branch-no-emit tests; full suite + typecheck green; ANALYTICS-01 now fully complete across Plans 03 + 04.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-30T03:02:15Z
- **Completed:** 2026-04-30T03:06:42Z
- **Tasks:** 2 / 2
- **Files modified:** 2 (1 source + 1 test)

## Accomplishments

- **`src/server/oauth/router.ts` — wrapAnalytics integration complete:**
  - `import { wrapAnalytics } from '../analytics.js'` added next to existing relative imports (after `validation/validateBody.js`).
  - Factory closure added at top of `createOAuthRouter()`: `const rpId = config.rpId ?? 'localhost'` + `const emit = wrapAnalytics(config.hooks?.onAuthEvent, { logger: config.logger, await: config.awaitAnalytics === true })`. **Captured ONCE at factory entry** — Pitfall 2 mitigation; mirrors `src/server/router.ts:79-83`.
  - 3 inline `emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider })` calls inserted — one BEFORE each of the 3 `return res.json(...)` statements in the OAuth callback handler:

  | Branch | Insert Position | Provider Source |
  |--------|----------------|-----------------|
  | 1. existing-user-same-provider | After `sessionManager.createSession(user.id, ...)`, before `return res.json({ ..., isNewUser: false })` (~line 234) | `provider` (already in scope from `req.params.provider as 'google' \| 'github' \| 'twitter'` at line 209) |
  | 2. existing-user-link-by-email | After `sessionManager.createSession(user.id, ...)` inside `if (profile.email) { if (user) { ... } }` block, before `return res.json({ ..., linkedProvider: provider })` (~line 278) | Same `provider` variable |
  | 3. new-user | After `sessionManager.createSession(newUser.id, ...)`, before `return res.json({ ..., isNewUser: true })` (~line 362) | Same `provider` variable |

- **NO `oauth.callback.failure` variant introduced (Critical Constraint 4):** `grep -c "oauth.callback.failure" src/server/oauth/router.ts` = 0. The OAuth callback's failure paths (invalid state → 400; token-exchange error caught at line 369 → 500) emit nothing — REQUIREMENTS line 51 lists success only, and the discriminated union has no `oauth.callback.failure` variant (would fail tsc).
- **`src/__tests__/analytics-oauth.test.ts` — 10 supertest assertions implemented:**
  - 3 primary branch tests — one per OAuth success path — each constructs mockDb returns to drive the route into the correct branch, asserts response shape (`isNewUser`/`linkedProvider`), captures `onAuthEvent` event, asserts `{ type, rpId, provider, timestamp }` shape, runs `expectNoPII()`.
  - 3 provider-parameterized tests via `it.each(['google', 'github', 'twitter'] as const)` — each provider gets its own `validateState` mock returning a record with the matching provider; `getProfile` mock returns a profile with the matching provider; assertion confirms `event.provider === <fixture provider>`.
  - 2 PII negative tests (Branch 1 + Branch 3) — mockDb returns `email: 'PII-EMAIL@example.com'`, `id: 'PII-USER-ID'`, `nearAccountId: 'PII-NEAR-ACCOUNT'` (clearly-identifiable tokens); assertion runs `expectNoPII()` AND verifies via `JSON.stringify(event).match(/PII-EMAIL/)` etc. that NO PII string appears anywhere in the serialized payload.
  - 2 failure-branch negative tests (Critical Constraint 4) — one drives `validateState` to return null (400 response), the other has `exchangeCode` throw (500 response). Both filter `onAuthEvent.mock.calls` for events with `type.startsWith('oauth.callback.failure')` and assert the filtered array is empty. The 500 test additionally asserts NO `oauth.callback.success` is emitted on the failure path.
- **All grep gates pass:**

  | Gate | Expected | Actual |
  |------|----------|--------|
  | `import { wrapAnalytics }` in oauth/router.ts | 1 | 1 |
  | `wrapAnalytics(` in oauth/router.ts | 1 | 1 |
  | `const emit = wrapAnalytics` in oauth/router.ts | 1 | 1 |
  | `type: 'oauth.callback.success'` in oauth/router.ts | 3 | 3 |
  | `oauth.callback.failure` in oauth/router.ts | 0 | 0 |
  | `provider` references in oauth/router.ts | ≥ 3 | 53 (existing references + the 3 new emits) |
  | `it.todo` in analytics-oauth.test.ts | 0 | 0 |
  | `Branch 1 \| Branch 2 \| Branch 3` in test | ≥ 3 | 12 |
  | `oauth.callback.success` in test | ≥ 4 | 19 |
  | `oauth.callback.failure` in test | ≥ 1 | 6 |
  | `expect(onAuthEvent)` in test | ≥ 5 | 6 |

- **Full test suite green:** 390 passed / 4 skipped (testnet) / 7 todos (remaining in analytics-latency.test.ts for Plan 13-05) / 0 failed (401 total across 27 files). Up from 380 passed in Plan 13-03; the +10 are the new analytics-oauth tests.
- **`npm run typecheck` clean** at every task boundary (Tasks 1, 2).
- **Existing OAuth test invariants preserved:** `oauth-cookie-guard.test.ts` (10/10) still passes after the router edits — no regressions, no shape changes to the OAuth callback's `res.json` payloads.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add wrapAnalytics import + factory closure + 3 oauth.callback.success emits** — `07cc752` (feat)
2. **Task 2: Implement analytics-oauth.test.ts (replace 6 it.todo with 10 real supertest assertions)** — `601e2fc` (test)

_Note: SUMMARY.md commit will be made by the orchestrator's final-metadata step._

## Files Created/Modified

**Created:**
- `.planning/phases/13-registration-analytics-hook/13-04-SUMMARY.md` (this file)

**Modified:**
- `src/server/oauth/router.ts` — added `wrapAnalytics` import (1 line), factory closure (`rpId` + `emit`, 6 lines), and 3 inline `emit({ ... })` call sites (1 line each + 1 blank line each). Net diff: +15 lines.
- `src/__tests__/analytics-oauth.test.ts` — replaced the 30-line Wave 0 stub (6 `it.todo` placeholders) with a 498-line full implementation: mock harness (DB + 4 managers + OAuthManager stub) + `makeOAuthApp()` factory with `onAuthEvent` spy + `expectNoPII` helper + 10 `it()` blocks across 6 `describe` blocks (3 branch + 1 provider-parameterized + 1 PII negative + 1 failure-branch negative). Mirrors the structure of `oauth-cookie-guard.test.ts` and `analytics-lifecycle.test.ts`.

## Decisions Made

### Why the `oauthManager` config field is used to inject the test stub (rather than mocking `createOAuthManager`)

`createOAuthRouter` accepts an optional `oauthManager` field on its config (line 41 of `oauth/router.ts`): "Optional pre-created OAuthManager instance. If omitted, one is created internally." This was originally added for INFRA-03 test injection in `oauth-cookie-guard.test.ts`, where the test needs to control `validateState` returns directly.

For Plan 04, this is the cleanest seam: the test creates a `makeMockOAuthManager({ validateState?, exchangeCode?, getProfile? })` helper that returns an `OAuthManager` matching the interface, with the three mocked methods controlled by the test. The router's internal flow (`oauthManager.validateState(state) → exchangeCode → getProfile → branch decision`) runs end-to-end, but the I/O boundary is fully test-controlled.

This is preferable to mocking `createOAuthManager` (would require `vi.mock` at the module level and break the dependency-injection test pattern) or mocking individual provider HTTP calls (would tie the test to undici/fetch internals).

### Why PII negative tests use clearly-identifiable tokens AND `JSON.stringify` checks

`expectNoPII(event)` is a structural check — it asserts the captured event's `Object.keys()` does NOT contain `email`, `userId`, etc. But that wouldn't catch a hypothetical bug where the event is constructed as `{ type: '...', rpId, timestamp, provider, ['x' + 'email']: '...' }` (string concatenation hiding the key) or where PII leaks into a nested object.

Adding a string-level scan (`expect(JSON.stringify(event)).not.toMatch(/PII-EMAIL/)`) is defense-in-depth: even if the structural check missed a deep nesting, the unique fixture strings (`PII-EMAIL`, `PII-USER-ID`, `PII-NEAR-ACCOUNT`) would surface in the serialized payload. Belt-and-braces.

The same approach is used in Plan 03's leaked-codename test (`'ALPHA-7-BRAVO'` token in error message + assertion that `JSON.stringify(event)` does not contain it).

### Why two failure-branch negative tests instead of one

Critical Constraint 4 forbids `oauth.callback.failure` regardless of WHERE the failure originates. Two distinct failure code paths exist in the OAuth callback:

1. **Pre-flight failure** (state validation returns null at line 214 → 400). The handler returns immediately; the catch block is never entered.
2. **Mid-flight failure** (token exchange / profile retrieval throws at line 224/227 → caught at line 369 → 500).

Testing both proves that NO emit() of any type fires from EITHER failure path. A single test would only cover one of these — the other could regress without detection. This matches the rigor of Plan 03's `register.finish.failure × 3` and `login.finish.failure × 3` exhaustive-exit-path coverage.

## Deviations from Plan

None — plan executed exactly as written.

The plan was extremely well-specified: every emit insertion point came with an exact anchor string + literal payload, every grep gate was prelisted, and the test harness analog files were pre-cited. Tasks 1 and 2 each landed first try with typecheck + targeted-test green; full suite green on first run after each commit.

## Authentication Gates

None — no auth gates required for this plan (test infrastructure + emit insertions; no external service calls).

## Issues Encountered

None — clean execution. The Plan 03 SUMMARY mentioned a transient vitest 4.x parallel-runner flake; that did NOT recur during this plan's verification runs (full suite green on first invocation after each commit).

## Verification Commands Run

| # | Command | Exit | Notes |
|---|---------|------|-------|
| 1 | `nvm use 20 && npm run typecheck` after Task 1 | 0 | oauth/router.ts wrapAnalytics import + closure + 3 emits clean |
| 2 | `nvm use 20 && npm test -- --run src/__tests__/oauth-cookie-guard.test.ts` after Task 1 | 0 | 10/10 — no regressions in existing OAuth tests |
| 3 | `nvm use 20 && npm test -- --run` after Task 1 | 0 | 380 passed / 4 skipped (testnet) / 13 todos / 0 failed |
| 4 | `nvm use 20 && npm test -- --run src/__tests__/analytics-oauth.test.ts` after Task 2 | 0 | 10/10 — all new ANALYTICS-01 OAuth supertest assertions pass |
| 5 | `nvm use 20 && npm run typecheck` after Task 2 | 0 | tsc --noEmit clean across the full project |
| 6 | `nvm use 20 && npm test -- --run` final | 0 | **390 passed** / 4 skipped (testnet) / **7 todos** (down from 13; remaining in analytics-latency for Plan 13-05) / 0 failed (401 total across 27 files) |
| 7 | All grep acceptance criteria | ALL | See "All grep gates pass" table above |

## Threat Model Confirmation

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-13-18 (Information Disclosure: OAuth event payload leaks `email` from `profile.email`) | mitigate | ✓ AnalyticsEvent's `oauth.callback.success` variant has type `{ type, rpId, timestamp, provider }` — `email` is not assignable. Runtime tests confirm: mockDb returns `email: 'PII-EMAIL@example.com'`, captured event's `JSON.stringify` does NOT contain `'PII-EMAIL'`. |
| T-13-19 (Information Disclosure: OAuth event payload leaks `user.id` / `nearAccountId`) | mitigate | ✓ Variant type forbids it. Runtime tests confirm: mockDb returns `id: 'PII-USER-ID'` and `nearAccountId: 'PII-NEAR-ACCOUNT'`, captured event's `JSON.stringify` contains NEITHER token. |
| T-13-20 (Tampering: a future PR adds an `oauth.callback.failure` variant) | mitigate | ✓ Critical Constraint 4 enforced at three layers: (a) grep gate `grep -c "oauth.callback.failure" src/server/oauth/router.ts` = 0; (b) AnalyticsEvent union has no failure variant (any addition fails analytics-types.test.ts exhaustiveness); (c) runtime negative tests on both failure paths (state-validation + token-exchange) confirm `failureCalls.length === 0`. |
| T-13-21 (Information Disclosure: OAuth event leaks per-request rpId from `relatedOrigins`) | accept | ✓ `rpId` is sourced from `config.rpId` (which createAnonAuth sets to `rp.id` PRIMARY only, per Plan 02 Critical Constraint 1). Per-request rpId derivation is OUT OF SCOPE for Phase 13. |
| T-13-22 (Tampering: wrapAnalytics resolved per-request instead of at factory entry) | mitigate | ✓ Pitfall 2 grep gate passes: `grep -c "wrapAnalytics(" src/server/oauth/router.ts` = 1. Closure captured ONCE at line 67 of the post-edit file (top of `createOAuthRouter()`, AFTER the destructure, BEFORE the rate limiter). |

## Known Stubs

None introduced by this plan. The 7 remaining `it.todo` placeholders in the suite are all in `analytics-latency.test.ts` (will be replaced by Plan 13-05 — latency, error-swallow, await-mode end-to-end tests). They are intentional Wave-0 stubs from Plan 13-01, locked to the requirement→file 1:1 map.

## Threat Flags

None. No new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries. The new emit() side-effects are inside existing handlers; they invoke the consumer's hook through the wrapAnalytics envelope (which swallows errors AND redacts Error.message via `redactErrorMessage`). No new attack surface.

## Downstream-Plan Unblock Note

Plan **13-05** (Wave 3 — latency + error-swallow + await-mode end-to-end) is unblocked:

1. All emit points for Phase 13 are now wired (15 in `router.ts` + 3 in `oauth/router.ts` = 18 inline emit() calls). Plan 05 can attach a 5-second `slowHook` and assert fire-and-forget < 500ms / await mode ~5s using ANY of the 18 emit points (recommend `register.start` for simplicity — least mock setup required).
2. The error-swallow contract is provable end-to-end: a throwing `onAuthEvent` will return `void` from `wrapAnalytics`, the response continues, and a redacted WARN is logged via `pino`. The Wave-0 `analytics-latency.test.ts` already cites the captured-pino-stream pattern from `logging.test.ts:31-40`.
3. The 7 `it.todo` slots in `analytics-latency.test.ts` are ready for Plan 05 implementation.

## User Setup Required

None — no external service configuration required.

## Self-Check: PASSED

Verified:
- File `src/server/oauth/router.ts` modified (wrapAnalytics import + factory closure + 3 emit calls) — FOUND
- File `src/__tests__/analytics-oauth.test.ts` modified (30 → 498 lines, 0 it.todo, 10 it() blocks) — FOUND
- File `.planning/phases/13-registration-analytics-hook/13-04-SUMMARY.md` created — FOUND (this file)
- Commit `07cc752` (Task 1 — oauth/router.ts emit insertions) — FOUND in git log
- Commit `601e2fc` (Task 2 — analytics-oauth.test.ts implementation) — FOUND in git log

## Next Phase Readiness

- Plan 13-05 (latency + error-swallow + await-mode) is unblocked — all 18 emit points exist; can drive end-to-end timing assertions.
- ANALYTICS-01 is now functionally COMPLETE: passkey lifecycle (Plan 03) + recovery + account-delete (Plan 03) + OAuth callback (Plan 04). Plan 05 will exercise the wrapAnalytics envelope behavior (latency, error swallow, await mode) — separate from emit-point coverage.
- Phase 13 ANALYTICS-02 through ANALYTICS-06 already complete (Plan 02 + Plan 03).
- No blockers, no concerns.

---
*Phase: 13-registration-analytics-hook*
*Plan: 04*
*Completed: 2026-04-30*
