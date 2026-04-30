---
phase: 13-registration-analytics-hook
verified: 2026-04-29T23:30:00Z
status: passed
score: 11/11 must-haves verified
overrides_applied: 0
---

# Phase 13: Registration Analytics Hook Verification Report

**Phase Goal:** Expose a fire-and-forget `hooks.onAuthEvent` callback that emits bounded lifecycle events to the consumer's analytics pipeline WITHOUT compromising the anonymity invariant. Lifecycle boundaries on passkey, OAuth, recovery, account-deletion. Type-level PII whitelist (R2 highest-priority defense). `awaitAnalytics: boolean` opt-in.

**Verified:** 2026-04-29T23:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                                         | Status     | Evidence                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ANALYTICS-01: Every lifecycle event fires at the correct boundary (passkey + recovery + account-delete + OAuth × 3)                          | ✓ VERIFIED | `grep -c "type: 'register.start'"` = 1, `'register.finish.success'` = 1, `'register.finish.failure'` = 3, `'login.start'` = 1, `'login.finish.success'` = 1, `'login.finish.failure'` = 3, all 4 recovery = 1 each, `'account.delete'` = 1, `'oauth.callback.success'` = 3 in oauth/router.ts; all 18 emit() sites are `await emit(...)`; 18+10 supertest assertions in analytics-lifecycle and analytics-oauth tests all green. |
| 2   | ANALYTICS-02: AnalyticsEvent discriminated-union narrows variants and is re-exported from public surface                                      | ✓ VERIFIED | `src/server/analytics.ts:53-70` defines 12 variants; `src/server/index.ts:277` re-exports `AnalyticsEvent`; `src/types/index.ts:63` types `AnonAuthHooks.onAuthEvent` as `(event: AnalyticsEvent) => void \| Promise<void>` (no longer unknown); 11 compile-via-assignment tests pass including `_exhaustive: never` switch.                                                                                                |
| 3   | ANALYTICS-03: tsc-fail fixture rejects PII fields at compile time (codename, userId, nearAccountId, email, ip, userAgent)                     | ✓ VERIFIED | `analytics-pii-leak.test.ts` runs 6 child-process `npx tsc --noEmit` invocations, one per forbidden field. All 6 cases pass (tsc fails as expected) using per-test `randomUUID()` fixture paths. Wall-clock ~18s for the file.                                                                                                                                                                                          |
| 4   | ANALYTICS-04: fire-and-forget mode adds <500ms; awaitAnalytics:true mode adds ~5s; errors swallowed in BOTH modes                            | ✓ VERIFIED | `analytics-latency.test.ts` 7 tests pass. Fire-and-forget elapsed asserted < 500ms with 5s hook. Await mode test measured 5005ms (>4500ms threshold). Sync throw + rejected Promise tests pass in BOTH modes (200 OK + WARN log). Critical Constraint 8 honored.                                                                                                                                                       |
| 5   | ANALYTICS-05: every emitted event uses ONLY allowed fields (whitelist)                                                                        | ✓ VERIFIED | `ALLOWED_EVENT_FIELDS = Object.freeze(new Set(['type','rpId','timestamp','provider','backupEligible','reason','codenameProvided']))` at `src/server/analytics.ts:76-84`. `analytics-pii-snapshot.test.ts` runs `it.each` over all 12 variants, asserts `Object.keys(variant)` ⊆ ALLOWED_EVENT_FIELDS for every variant, plus 12-variant lockstep counter guard. 15 expanded tests pass.                                  |
| 6   | ANALYTICS-06: register/login finish.failure fire from every non-success exit (early returns + catch)                                          | ✓ VERIFIED | `grep -c "type: 'register.finish.failure'" src/server/router.ts` = 3 (invalid-codename, passkey-verification-failed, internal-error catch). Same gate for login = 3 (auth-failed, user-not-found, internal-error). 5 supertest tests in analytics-lifecycle exercise each exit path; failure events fire WITHOUT any opt-in flag.                                                                                       |
| 7   | Static-enum reasons only (no Error.message in payload)                                                                                        | ✓ VERIFIED | `RegisterFailureReason` and `LoginFailureReason` defined as static unions at `src/server/analytics.ts:27-36`. Grep for dynamic interpolation patterns (`reason: ${...}`, `reason: error.message`, `reason: err.message`, `reason: String(err)`) returns 0 in router.ts. Leaked-codename test in analytics-lifecycle confirms `Error('codename ALPHA-7-BRAVO is leaked')` → `event.reason === 'internal-error'`.            |
| 8   | redactErrorMessage filters V8 frame lines so stack-trace doesn't leak Error.message (the 13-05 bug fix)                                       | ✓ VERIFIED | `src/server/analytics.ts:114` uses `/^\s+at\s/` regex filter on stack lines BEFORE slicing 2 frames, dropping the V8 leading "<Name>: <message>" line. Tests assert `JSON.stringify(entries).not.toContain('boom-codename-leak-ALPHA-7')` and same for `await-mode-throw-leak-7`, `await-rejected-leak-7`, `rejected-boom-ALPHA-7` — all pass.                                                                          |
| 9   | All 18 emit() call sites are `await`ed (the 13-05 awaitAnalytics fix)                                                                         | ✓ VERIFIED | `grep -c "await emit(" src/server/router.ts` = 15 + `grep -c "await emit(" src/server/oauth/router.ts` = 3 = 18 total. No naked (non-awaited) `emit(` calls anywhere. Awaiting `void` (fire-and-forget mode) is a microtask no-op; awaiting `Promise<void>` (await mode) correctly delays response.                                                                                                                     |
| 10  | Lockstep: rpId + awaitAnalytics threaded into BOTH createRouter and createOAuthRouter                                                         | ✓ VERIFIED | `grep -c "awaitAnalytics" src/server/index.ts` = 2 (lines 212 + 234, threaded into both factory calls). `grep -c "rpId: rpConfig.id" src/server/index.ts` = 3 (line 144 root + lines 211 + 233 in factory calls). Phase 11 invariants preserved: `AnonAuthHooks` and `RelatedOrigin` re-exports still present.                                                                                                          |
| 11  | Full vitest suite green; typecheck clean; no remaining it.todo in analytics-*.test.ts files                                                   | ✓ VERIFIED | `npm test -- --run`: 397 passed / 4 skipped (testnet) / 0 failed across 27 files (19.68s). `npm run typecheck`: exits 0. `grep -c "it.todo" src/__tests__/analytics-*.test.ts` = 0 in every file.                                                                                                                                                                                                                       |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact                                                  | Expected                                                                                | Status     | Details                                                                                                                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/analytics.ts`                                 | AnalyticsEvent (12 variants), ALLOWED_EVENT_FIELDS (frozen Set<7>), wrapAnalytics, redactErrorMessage | ✓ VERIFIED | 171 lines; 12 variants present (3 register + 3 login + 4 recovery + 1 oauth + 1 account); `Object.freeze(new Set([...]))` at line 76; both functions exported; child({ module: 'analytics' }) at line 143.                       |
| `src/types/index.ts`                                      | AnonAuthHooks.onAuthEvent narrowed to AnalyticsEvent; AnonAuthConfig.awaitAnalytics?: boolean top-level | ✓ VERIFIED | Line 6 imports AnalyticsEvent; line 63 narrows onAuthEvent signature; line 207 adds `awaitAnalytics?: boolean` at top level (sibling of hooks). No `(event: unknown)` remaining.                                                  |
| `src/server/router.ts`                                    | wrapAnalytics import, RouterConfig.rpId? + awaitAnalytics?, factory closure, 15 emit calls | ✓ VERIFIED | Line 22 imports; closure at lines 79-83; 15 `await emit(...)` calls covering all 11 unique event types per the Lifecycle Boundary Inventory. `wrapAnalytics(` count = 1 (Pitfall 2 satisfied).                                    |
| `src/server/oauth/router.ts`                              | wrapAnalytics import, OAuthRouterConfig.rpId? + awaitAnalytics?, factory closure, 3 oauth.callback.success emits, NO failure variant | ✓ VERIFIED | Line 20 imports `'../analytics.js'`; closure at lines 67-71; 3 `await emit({ type: 'oauth.callback.success', ... })` calls (one per branch); 0 references to `oauth.callback.failure` (Critical Constraint 4 satisfied).         |
| `src/server/index.ts`                                     | createAnonAuth threads rpId + awaitAnalytics into both factories; AnalyticsEvent re-exported | ✓ VERIFIED | Lines 211/233 thread `rpId: rpConfig.id`; lines 212/234 thread `awaitAnalytics: config.awaitAnalytics`; line 277 has dedicated `export type { AnalyticsEvent } from './analytics.js'`.                                            |
| `src/__tests__/analytics-types.test.ts`                   | 11 it() blocks, exhaustiveness via never, public-surface re-export check                | ✓ VERIFIED | 11 tests, 0 todos. Includes `_exhaustive: never` switch at the default branch and source-text grep for `AnalyticsEvent` in `src/server/index.ts`.                                                                                |
| `src/__tests__/analytics-pii-leak.test.ts`                | tsc-fail fixture × 6 forbidden fields, per-test randomUUID paths                        | ✓ VERIFIED | `it.each` over 6 forbidden cases; per-test `randomUUID()` in fixture paths (Pitfall 5 mitigation); writeFileSync + execSync(npx tsc --noEmit) + finally unlinkSync. All 6 cases pass.                                            |
| `src/__tests__/analytics-pii-snapshot.test.ts`            | ALLOWED_EVENT_FIELDS membership, 12-variant whitelist via it.each, lockstep guard       | ✓ VERIFIED | 15 expanded tests pass. Asserts `ALLOWED_EVENT_FIELDS.size === 7`, `sampleVariants.length === 12`, and Object.keys ⊆ ALLOWED for each.                                                                                            |
| `src/__tests__/analytics-lifecycle.test.ts`               | 18 supertest tests covering passkey + recovery + account-delete + ANALYTICS-06 default + leaked-codename negative | ✓ VERIFIED | 18 it() blocks, 0 todos, 18 expectNoPII checks; ALPHA-7-BRAVO codename-leak negative test present (5 references); failure-by-default tests pass.                                                                                  |
| `src/__tests__/analytics-oauth.test.ts`                   | 10 supertest tests covering 3 branches + provider parameterization + PII negative + failure-not-emitted | ✓ VERIFIED | 10 it() blocks, 0 todos. Branch 1/2/3 each exercised; `it.each(['google','github','twitter'])` provider parameterization; failureCalls filtered, expected []; PII-EMAIL/PII-USER-ID/PII-NEAR-ACCOUNT tokens absent from event JSON. |
| `src/__tests__/analytics-latency.test.ts`                 | 7 tests: fire-and-forget × 2, sync-throw + rejected-Promise × 2, await mode × 3        | ✓ VERIFIED | 7 it() blocks, 0 todos. Fire-and-forget asserts elapsed<500ms with 5s hook; await mode test measured 5005ms; pino capture stream verifies WARN log with redacted error (no Error.message); leaked-token negative assertions pass. |

### Key Link Verification

| From                                  | To                                                              | Via                                              | Status   | Details                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| createAnonAuth (src/server/index.ts)  | createRouter and createOAuthRouter                              | rpId + awaitAnalytics fields (lockstep)          | ✓ WIRED  | `awaitAnalytics: config.awaitAnalytics` at lines 212 + 234; `rpId: rpConfig.id` at lines 211 + 233. `grep -c "awaitAnalytics" src/server/index.ts` = 2 satisfies the Pitfall 3 lockstep gate. |
| AnonAuthHooks.onAuthEvent             | AnalyticsEvent                                                  | type import edge                                 | ✓ WIRED  | `import type { AnalyticsEvent } from '../server/analytics.js'` at line 6 of types/index.ts; signature `(event: AnalyticsEvent) => void \| Promise<void>` at line 63.                       |
| createRouter / createOAuthRouter      | wrapAnalytics                                                   | import + closure capture once at factory entry  | ✓ WIRED  | Both files import `wrapAnalytics`; both capture `const emit = wrapAnalytics(config.hooks?.onAuthEvent, { logger: config.logger, await: config.awaitAnalytics === true })` ONCE at factory entry. |
| Every lifecycle exit                  | emit({ type, rpId, timestamp, ... })                            | inline `await emit(...)` at boundary             | ✓ WIRED  | 15 in router.ts + 3 in oauth/router.ts = 18 total. All prefixed with `await` (verified by grep + observed by passing await-mode latency test).                                            |
| src/server/index.ts re-export block   | AnalyticsEvent (consumer-facing)                                | export type                                      | ✓ WIRED  | `export type { AnalyticsEvent } from './analytics.js'` at line 277. Mirrors the MPCAccountManagerConfig re-export pattern.                                                                |
| analytics-latency.test.ts             | wrapAnalytics + emit closure + pino captured stream             | supertest + performance.now() + pino with stream | ✓ WIRED  | makeApp() helper threads `hooks.onAuthEvent` and `awaitAnalytics`; makeCapturedLogger uses `pino({ level: 'warn' }, stream)` to capture WARN entries. All 7 latency assertions pass.        |

### Data-Flow Trace (Level 4)

| Artifact                       | Data Variable        | Source                                        | Produces Real Data                                    | Status     |
| ------------------------------ | -------------------- | --------------------------------------------- | ----------------------------------------------------- | ---------- |
| `src/server/router.ts` emits   | event payload        | Constructed inline at each lifecycle boundary | Yes — variant-specific fields (rpId from config, timestamp from Date.now(), reason from static enum, backupEligible from deriveBackupEligibility, codenameProvided from !!codename, provider from req.params) | ✓ FLOWING  |
| `src/server/oauth/router.ts`   | event payload        | Constructed inline; provider from req.params  | Yes — provider literal `'google' \| 'github' \| 'twitter'` flows from request to event | ✓ FLOWING  |
| `wrapAnalytics` envelope       | hook return value    | Direct invocation of consumer's onAuthEvent  | Yes — consumer's hook is invoked synchronously on the same tick (FF) or awaited (await mode); error path catches both sync throws and rejected Promises | ✓ FLOWING  |
| analytics-latency tests        | captured log entries | pino stream pushes entries to array          | Yes — entries[] populated when wrapAnalytics logs WARN; tests find by level=40 + module=analytics                                                                                       | ✓ FLOWING  |

### Behavioral Spot-Checks

| Behavior                                                                  | Command                                                                                                  | Result                                                                                | Status   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| Type-system + tsc-fail fixtures + snapshot whitelist                      | `npm test -- --run src/__tests__/analytics-types.test.ts src/__tests__/analytics-pii-snapshot.test.ts src/__tests__/analytics-pii-leak.test.ts` | 32 passed (11 + 15 + 6); wall-clock 18.37s                                            | ✓ PASS   |
| Lifecycle + OAuth supertest + Latency end-to-end                          | `npm test -- --run src/__tests__/analytics-lifecycle.test.ts src/__tests__/analytics-oauth.test.ts src/__tests__/analytics-latency.test.ts` | 35 passed (18 + 10 + 7); await-mode latency observed 5005ms; wall-clock 5.57s         | ✓ PASS   |
| TypeScript clean across whole project                                     | `npm run typecheck`                                                                                       | exits 0; tsc --noEmit clean                                                            | ✓ PASS   |
| Full vitest suite (no regressions)                                        | `npm test -- --run`                                                                                       | 397 passed / 4 skipped (testnet) / 0 failed across 27 files; wall-clock 19.68s         | ✓ PASS   |

### Requirements Coverage

| Requirement   | Source Plan(s)             | Description                                                                                                                                                            | Status        | Evidence                                                                                                                                                                                                                                |
| ------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ANALYTICS-01  | 13-01, 13-03, 13-04        | hooks.onAuthEvent fires at every lifecycle boundary on passkey + OAuth + recovery + account-delete                                                                     | ✓ SATISFIED   | 18 inline emit() sites total; analytics-lifecycle (18 tests) + analytics-oauth (10 tests) all green. Every boundary in the Lifecycle Boundary Inventory is covered.                                                                       |
| ANALYTICS-02  | 13-01, 13-02               | AnalyticsEvent discriminated union forbids PII keys via type narrowing                                                                                                | ✓ SATISFIED   | `src/server/analytics.ts:53-70` defines 12-variant union with literal-typed required fields; `analytics-types.test.ts` verifies compile-via-assignment + never-exhaustive switch + public-surface re-export. 11 tests green.              |
| ANALYTICS-03  | 13-01, 13-02               | tsc-fail fixture proves union enforces no-PII at compile time                                                                                                          | ✓ SATISFIED   | `analytics-pii-leak.test.ts` 6 cases (codename, userId, nearAccountId, email, ip, userAgent) all pass — npx tsc --noEmit fails for each fixture; per-test randomUUID prevents parallel-runner races.                                       |
| ANALYTICS-04  | 13-01, 13-02, 13-05        | wrapAnalytics: fire-and-forget by default; awaitAnalytics:true opt-in; errors swallowed in BOTH modes                                                                  | ✓ SATISFIED   | `analytics-latency.test.ts` 7 tests cover all branches. Fire-and-forget elapsed<500ms; await mode elapsed=5005ms; sync throw + rejected Promise both produce 200 OK in BOTH modes; redacted WARN log verified absent of leaked tokens. |
| ANALYTICS-05  | 13-01, 13-02               | Snapshot whitelist asserts each variant's keys ⊆ allowed-fields                                                                                                       | ✓ SATISFIED   | `ALLOWED_EVENT_FIELDS = Object.freeze(new Set([...7 keys...]))`; `analytics-pii-snapshot.test.ts` runs 15 expanded tests including 12-variant `it.each` whitelist + lockstep counter guard.                                              |
| ANALYTICS-06  | 13-01, 13-03               | register/login finish.failure events emitted by default from every non-success exit                                                                                    | ✓ SATISFIED   | grep gates: register.finish.failure × 3 sites, login.finish.failure × 3 sites; all use static-enum reason; analytics-lifecycle tests prove failure events fire WITHOUT awaitAnalytics opt-in; leaked-codename Error('...ALPHA-7...') → reason: 'internal-error'.   |

No orphaned requirements. All 6 ANALYTICS-* requirements claimed by phase-13 plans are SATISFIED.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |

No anti-patterns of concern. Scanned files: `src/server/analytics.ts`, `src/server/router.ts`, `src/server/oauth/router.ts`, `src/server/index.ts`, `src/types/index.ts`, all 6 `src/__tests__/analytics-*.test.ts` files. No TODO/FIXME/XXX/HACK markers, no placeholder strings, no empty handlers, no console.log-only implementations, no hardcoded empty values flowing to user-visible output. All `vi.fn()` and `mock*` patterns are confined to test files (expected).

Note: `RouterConfig.rpId?` and `OAuthRouterConfig.awaitAnalytics?` are optional fields with `?? 'localhost'` and `=== true` defaults — these are legitimate library-config defaults, not stub data.

### Human Verification Required

None. Phase 13 deliverables are entirely covered by automated tests:

- Lifecycle boundary emission → supertest integration tests
- Type-level PII enforcement → child-process tsc-fail fixture
- Latency behavior → performance.now() bounded supertest
- Error swallow + redacted WARN log → captured pino stream + leaked-token negative assertion
- Whitelist enforcement → frozen Set + variant whitelist test

The only manual-verification item declared in `13-VALIDATION.md` is README "Hooks (v0.7.0)" documentation accuracy — that is explicitly assigned to Phase 16 (RELEASE-01), not Phase 13.

### Gaps Summary

None. All 11 must-haves verified, all 11 artifacts substantive and wired, all 6 key links wired, all 4 behavioral spot-checks pass, all 6 requirements satisfied, no anti-patterns found.

The two production-code bugs caught and fixed during Plan 13-05 (redactErrorMessage V8 stack-message leak; missing `await` on emit() call sites silently degrading awaitAnalytics:true) are now closed and verified by passing tests. The phase delivered everything the goal demanded:

- Type-level PII whitelist enforced at compile time (R2 highest-priority defense, validated by tsc-fail fixture mirroring v0.6.1 MPC-07)
- 18 lifecycle emit sites covering all of passkey + OAuth + recovery + account-delete
- Fire-and-forget envelope adds <100ms (measured) — does NOT block auth response
- awaitAnalytics:true opt-in correctly delays response by ~5s with a 5s hook (Plan 13-05 caught and fixed the silent degradation)
- Errors swallowed in BOTH modes (Critical Constraint 8) — sync throws and rejected Promises both produce 200 OK + redacted WARN log
- Static-enum failure reasons only — `Error.message` never leaks via reason field (verified by leaked-codename test) nor via WARN log (verified by frame-line-filter redaction test)
- `codenameProvided: boolean` PII proxy on login.start — codename string never enters event payload
- Lockstep threading: rpId + awaitAnalytics flow through createAnonAuth into BOTH router factories (Pitfall 3 mitigation)
- All 6 Wave-0 stub files filled with real assertions; suite-wide it.todo count = 0; full vitest suite green; typecheck clean

Phase 13 is ready to ship.

---

_Verified: 2026-04-29T23:30:00Z_
_Verifier: Claude (gsd-verifier)_
