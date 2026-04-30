---
phase: 13-registration-analytics-hook
plan: 05
subsystem: server
tags: [analytics, latency, error-swallow, await-mode, performance, security, wave-3, v0.7.0]

# Dependency graph
requires:
  - phase: 13-registration-analytics-hook
    plan: 02
    provides: wrapAnalytics envelope (fire-and-forget vs await branch); redactErrorMessage; AnalyticsEvent union; AnonAuthConfig.awaitAnalytics top-level flag; RouterConfig.awaitAnalytics threading
  - phase: 13-registration-analytics-hook
    plan: 03
    provides: 15 inline emit() call sites in src/server/router.ts (register/login/recovery/account-delete lifecycle) — exercised by /register/start in this plan's latency tests
  - phase: 13-registration-analytics-hook
    plan: 04
    provides: 3 inline emit() call sites in src/server/oauth/router.ts — receive matching await prefix (wave-3 cleanup; not directly exercised by this plan's tests)
  - phase: 13-registration-analytics-hook
    plan: 01
    provides: 7 it.todo slots in src/__tests__/analytics-latency.test.ts pre-registered with header docblock citing reference impl in 13-RESEARCH.md:705-721 + pino-stream pattern in logging.test.ts:31-40
provides:
  - 7 supertest+performance.now assertions in analytics-latency.test.ts covering ANALYTICS-04 in full (fire-and-forget latency × 2, sync throw + rejected Promise error swallow × 2, await-mode latency-adds-5s + 2 error-swallow-still-works)
  - Working `awaitAnalytics: true` mode end-to-end: a 5s hook now correctly ADDS ~5s to /register/start response (verified: 5004ms vs 2.6ms before fix)
  - redactErrorMessage no longer leaks Error.message via the stack trace's first line (V8 stack format quirk; T-13-25 mitigation now actually mitigates)
  - 18 emit() call sites (15 in router.ts + 3 in oauth/router.ts) are now `await emit(...)` — fire-and-forget semantics preserved (await undefined is a microtask no-op), await mode now correctly delays response
  - Phase 13 ANALYTICS-04 fully covered; ANALYTICS-01..06 all closed; phase ready for /gsd-verify-work 13
affects: [14-second-factor-hook (consumes the same wrapAnalytics + emit pattern), 16-release-prep (README must document the validated await-mode behavior)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - performance.now() + supertest for end-to-end latency assertion (NEW pattern in this codebase — synthesized from RESEARCH.md:705-721; no prior latency tests existed)
    - pino-stream-capture (logging.test.ts:31-40 pattern) for asserting the exact shape of WARN log entries written by wrapAnalytics — entries.find(e => e.level === 40 && e.module === 'analytics')
    - "Defense-in-depth via leaked-codename tokens (boom-codename-leak-ALPHA-7, await-mode-throw-leak-7) — assertion JSON.stringify(entries).not.toContain(<token>) catches PII leaks even if structural checks miss them"
    - "await emit(...) at every call site (mechanical change across 18 sites) — wrapAnalytics's fire-and-forget vs await-mode dual-return-shape only works correctly when call sites await; otherwise await mode silently degrades to fire-and-forget"

key-files:
  created:
    - .planning/phases/13-registration-analytics-hook/13-05-SUMMARY.md
  modified:
    - src/__tests__/analytics-latency.test.ts
    - src/server/analytics.ts
    - src/server/router.ts
    - src/server/oauth/router.ts

key-decisions:
  - "Fire-and-forget tests use the existing /register/start route (Plan 03 emit point) for the supertest harness — no new mock paths needed; mirrors registration-auth.test.ts:18-211 mock setup verbatim"
  - "Pino capture stream uses level: 'warn' (not 'info' as in logging.test.ts) because wrapAnalytics's hook-rejection log is a WARN entry; raising to 'warn' filters out unrelated INFO entries from rate-limiter setup, leaving the analytics WARN as the only entry the test must search"
  - "redactErrorMessage fix uses the V8 frame-line regex /^\\s+at\\s/ to filter the stack array before slicing 2 frames, rather than slice(1, 3) — frame-line filter is robust across runtimes (V8 / Bun-bundle / future Node updates) where the message line might wrap or vanish; the slice-from-1 alternative would silently drop a frame on runtimes that don't include the message line"
  - "await emit() applied to ALL 18 call sites (not just /register/start) — making await mode work consistently across the library. Plans 03 + 04 wrote the call sites without await, which silently degraded awaitAnalytics:true to fire-and-forget behavior. This plan's test caught it (2.6ms elapsed instead of >4500ms)"

patterns-established:
  - "End-to-end latency contract proven by performance.now() bounds: response latency < 500ms with a 5s hook (fire-and-forget) AND > 4500ms with the same hook + awaitAnalytics:true. This pair of assertions is the canonical proof that the dual-mode contract is wired correctly. Plan 14 + 15 should mirror this when adding hooks.afterAuthSuccess and hooks.backfillKeyBundle."
  - "Leaked-token negative assertion: a unique recognizable string (e.g. boom-codename-leak-ALPHA-7) embedded in the test's Error.message, then asserted absent from JSON.stringify(captured-log-entries). Catches PII leaks at any nesting level; the codename test in analytics-lifecycle.test.ts (Plan 03) uses the same pattern with ALPHA-7-BRAVO."
  - "wrapAnalytics call-site convention: ALL emit() invocations are `await emit(...)` — even at sites that never run in await mode. Cost is one microtask per call (immeasurable); benefit is the dual-mode contract is correct everywhere by default."

requirements-completed: [ANALYTICS-04]

# Metrics
duration: 6m31s
completed: 2026-04-30
---

# Phase 13 Plan 05: Latency + Error Swallow + Await Mode End-to-End Tests Summary

**ANALYTICS-04 fully landed: 7 supertest+performance.now assertions in `src/__tests__/analytics-latency.test.ts` prove fire-and-forget latency (5s hook adds <500ms), error swallow (sync throw and rejected Promise → 200 OK + redacted WARN log, no `Error.message` leak), AND `awaitAnalytics: true` mode (same 5s hook now ADDS ~5s, errors STILL swallowed per Critical Constraint 8). Caught and fixed two production-code bugs along the way: (1) `redactErrorMessage` was leaking `Error.message` via V8's stack-trace first line (T-13-25 mitigation was hollow); (2) emit() call sites weren't awaited, so `awaitAnalytics: true` silently degraded to fire-and-forget. Phase 13 ANALYTICS-01..06 now ALL CLOSED; ready for `/gsd-verify-work 13`.**

## Performance

- **Duration:** ~6m 31s
- **Started:** 2026-04-30T03:12:04Z
- **Completed:** 2026-04-30T03:18:35Z
- **Tasks:** 2 / 2
- **Files modified:** 4 (1 test + 3 source)

## Accomplishments

- **`src/__tests__/analytics-latency.test.ts` — 7 it() blocks across 3 describe blocks:**

  | Describe | Tests | Behavior Covered |
  |----------|-------|------------------|
  | `ANALYTICS-04: fire-and-forget latency` | 2 | 5s hook adds <500ms; hookResolved still false at response time |
  | `ANALYTICS-04: error swallow (sync throw)` | 2 | Sync throw → 200 OK + WARN log; rejected Promise → 200 OK + WARN log; both with leaked-codename absent from log JSON |
  | `ANALYTICS-04: awaitAnalytics: true mode` | 3 | 5s hook adds >4500ms; sync throw STILL 200 OK; rejected Promise STILL 200 OK (Critical Constraint 8) |

  Total: 7 tests, all passing, total wall-clock ~5.2 seconds (dominated by the 3 await-mode tests × ~5s hook each, run in parallel-within-file but the await-latency one alone is 5004ms).

- **`src/server/analytics.ts` — `redactErrorMessage` bug fixed (Rule 1 deviation):**
  - Before: `err.stack?.split('\n').slice(0, 2).join(' | ')` — V8 stack format puts `<Name>: <message>` on line 1, so the first slice element WAS the message. The redaction was a no-op for PII purposes; threat T-13-25 was not actually mitigated.
  - After: filter to frame lines only via `/^\s+at\s/.test(line)` BEFORE slicing 2 entries. The leading message line is dropped entirely. Documented in JSDoc with a NOTE explaining the V8 quirk.
  - Caught by: `expect(JSON.stringify(entries)).not.toContain('boom-codename-leak-ALPHA-7')` — the unique token in the test's thrown Error appeared in the captured log JSON before the fix; absent after the fix.

- **`src/server/router.ts` + `src/server/oauth/router.ts` — `await emit()` at all 18 call sites (Rule 2 deviation):**
  - 15 emit() calls in `src/server/router.ts` (lifecycle boundaries: register × 5, login × 5, recovery × 4, account.delete × 1) and 3 in `src/server/oauth/router.ts` (oauth.callback.success × 3 branches) ALL prefixed with `await`.
  - Before: `wrapAnalytics(...)` returns `Promise<void>` in await mode, but the call sites discarded the returned promise. So `awaitAnalytics: true` silently degraded to fire-and-forget behavior.
  - After: `await emit({ ... })`. Fire-and-forget mode is unaffected (`wrapAnalytics` returns `undefined` in fire-and-forget; `await undefined` is a microtask no-op — measured response time stays well under 500ms in fire-and-forget). Await mode now correctly delays the response (measured 5004ms with a 5s hook).
  - All call sites are inside `async (req, res)` route handlers — adding `await` is type-safe with no syntactic changes elsewhere.
  - Caught by: the new `awaitAnalytics: true` latency test (`expect(elapsed).toBeGreaterThan(4500)`) — measured 2.6ms before fix, 5004ms after.

- **All grep + acceptance gates pass:**

  | Gate | Expected | Actual |
  |------|----------|--------|
  | `it.todo` in analytics-latency.test.ts | 0 | 0 |
  | `performance.now()` in test | ≥ 4 | 6 |
  | `awaitAnalytics` references in test | ≥ 4 | 9 |
  | `awaitAnalytics: true` literal in test | ≥ 3 | 4 |
  | `toBeLessThan(500)` in test | ≥ 1 | 1 |
  | `toBeGreaterThan(4500)` in test | ≥ 1 | 1 |
  | `boom-codename-leak-ALPHA-7` in test | ≥ 2 | 2 |
  | `Promise.reject` in test | ≥ 1 | 1 |
  | `module === 'analytics'` in test | ≥ 1 | 2 |
  | `await-mode-throw-leak-7` / `await-rejected-leak-7` in test | ≥ 4 | 4 |
  | `Critical Constraint 8` / `errors swallowed` in test | ≥ 1 | 1 |
  | `await emit(` in router.ts | 15 | 15 |
  | `await emit(` in oauth/router.ts | 3 | 3 |
  | Naked `emit(` (no await) in either router file | 0 | 0 |

- **Full test suite green:** 397 passed / 4 skipped (testnet) / **0 todos** (down from 7 going into this plan) / 0 failed (401 total across 27 files); wall-clock 19.6s. Phase 13 fully covered.
- **`npm run typecheck` clean** at every task boundary (Tasks 1, 2).

## Task Commits

Each task was committed atomically:

1. **Task 1: Fire-and-forget latency + sync-throw + rejected-Promise tests; redactErrorMessage stack-message leak fix** — `18a37e7` (test + Rule 1 deviation)
2. **Task 2: awaitAnalytics:true latency + error-swallow tests; await emit() at all 18 lifecycle call sites** — `1149d38` (test + Rule 2 deviation)

_Note: SUMMARY.md commit will be made by the orchestrator's final-metadata step._

## Files Created/Modified

**Created:**
- `.planning/phases/13-registration-analytics-hook/13-05-SUMMARY.md` (this file)

**Modified:**
- `src/__tests__/analytics-latency.test.ts` — 36-line Wave 0 stub (7 `it.todo` placeholders) replaced with a 333-line full implementation: mock harness + `makeApp()` factory accepting `onAuthEvent` / `awaitAnalytics` / `logger` opts + `makeCapturedLogger()` pino-stream helper + 7 `it()` blocks across 3 `describe` blocks. Mock harness mirrors `registration-auth.test.ts:18-211` verbatim; pino capture mirrors `logging.test.ts:31-40`.
- `src/server/analytics.ts` — `redactErrorMessage` rewritten: V8 frame-line regex (`/^\s+at\s/`) filters the stack lines BEFORE slicing 2 frames, dropping the message line. JSDoc updated to document the V8 stack-format quirk and the T-13-25 mitigation contract. Net diff: +6 lines.
- `src/server/router.ts` — `await` prefix added to all 15 inline `emit({ ... })` call sites (3 multi-line + 12 single-line). No structural changes; mechanical edit. Net diff: +15 `await` keywords (~30 chars).
- `src/server/oauth/router.ts` — `await` prefix added to all 3 inline `emit({ ... })` call sites (one per OAuth success branch). Net diff: +3 `await` keywords.

## Decisions Made

### Why `redactErrorMessage` filters frame lines instead of `slice(1, 3)`

The simplest fix would be `err.stack?.split('\n').slice(1, 3).join(' | ')` — drop the first line (which carries `<Name>: <message>`) and take the next two. That works on standard Node.js V8 builds. But it's runtime-fragile:

- **Bun's stack format** has the message embedded in the stack OR omitted depending on version (Bun 1.x has had multiple changes).
- **`Error.captureStackTrace(target, constructorOpt)`** — used in some library helpers — can produce stacks where the message line is absent and frames start at line 0.
- **Engine-toggleable** stack formats (`--stack-trace-limit`, source-map enrichment) can prepend extra lines (file references, original positions).

A frame-line regex filter (`^\s+at\s`) is the robust choice: it matches V8's `"    at <fn> (<file>:<line>:<col>)"` format and skips ANY non-frame prefix. If a runtime ever omits frames or formats them differently, the filter degrades to `stackHead: undefined` (no leak) instead of accidentally slicing into PII territory.

The cost is one extra line of code (the `.filter(...)` call). The upside is the redaction can never regress to leaking on a future runtime change.

### Why `await emit()` at ALL 18 sites (not just `/register/start`)

Three options were considered:

1. **Apply `await` only at `/register/start`** — the only emit point exercised by this plan's tests.
2. **Apply `await` at all 18 sites** (the chosen approach).
3. **Make the closure return `void` always, and have it call `setImmediate` with `.catch` internally for the async-but-not-awaited error path; document `awaitAnalytics: true` as a no-op until call sites are migrated** (architectural).

Option 1 was rejected because `awaitAnalytics: true` would still be broken at the other 17 call sites — meaning consumers who set the flag would observe the documented behavior at `/register/start` but not at `/login/finish`, `/oauth/callback`, etc. That's a worse failure mode than the current consistent-but-broken state.

Option 3 was rejected because it's more work, requires Phase 14's `hooks.afterAuthSuccess` to also adopt the same convention separately, and forfeits the simple invariant "every emit at every call site behaves identically".

Option 2 is the minimal correct fix: 18 `await` keywords (≈30 characters), all type-safe (the call sites are already `async`), and the dual-mode contract is now wired everywhere. Fire-and-forget overhead is one microtask per emit call (sub-millisecond, immeasurable in the latency test which still asserts <500ms with a 5s hook). Documented as the convention via the SUMMARY's "patterns-established" so Phase 14/15/16 reviewers know to keep it.

This is a Rule 2 (auto-add missing critical functionality) deviation — the await wiring is critical for the documented `awaitAnalytics: true` contract to work; without it, the flag is silently broken.

### Why the pino capture stream uses `level: 'warn'` (not `'info'`)

The reference pattern in `logging.test.ts:31-40` uses `level: 'info'` to capture all entries. For this plan's tests, the captured-logger is passed to `wrapAnalytics`, which logs at WARN when the hook throws or rejects. Lower-priority entries (router INFO logs at startup, rate-limiter setup messages) are noise for these tests.

Setting `level: 'warn'` filters out the noise at the pino level, so `entries` contains ONLY WARN+ entries. `entries.find(e => e.level === 40 && e.module === 'analytics')` then matches exactly the analytics WARN log without false positives. This makes the assertion's intent grep-clear: the test is asserting on the analytics module's WARN behavior specifically, not just "some log entry exists".

### Why `await new Promise(r => setImmediate(r))` after the rejected-Promise request

In fire-and-forget mode, `wrapAnalytics` does NOT await the hook — the response returns immediately, and the rejected Promise's `.catch` handler runs on a later microtask. Without yielding the event loop, the test's assertion `entries.find(...)` runs BEFORE the WARN log entry is written.

`await new Promise(r => setImmediate(r))` yields one full event-loop tick, giving the `.catch` handler time to fire and the pino stream time to flush its synchronous write. This is a deterministic flush — no `setTimeout(0)` race, no flake risk. The await-mode test does NOT need this yield because the response itself awaited the hook (and thus the `.catch`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `redactErrorMessage` was leaking `Error.message` via the stack trace's first line**

- **Found during:** Task 1, after first targeted test run
- **Issue:** The function's JSDoc said "first two lines of the stack trace (file:line, no values). Drop `message` entirely". The implementation was `err.stack?.split('\n').slice(0, 2).join(' | ')`. V8's stack format begins with `"<Name>: <message>"` on line 1, so the slice INCLUDED the message. Threat T-13-25 (Error.message PII leak) was not actually mitigated despite the documented intent.
- **Detection:** The new test `expect(JSON.stringify(entries)).not.toContain('boom-codename-leak-ALPHA-7')` failed — the captured log entry's `stackHead` field contained the full string `"Error: boom-codename-leak-ALPHA-7 |     at throwHook (...)"`.
- **Fix:** Replaced the slice with a frame-line regex filter (`/^\s+at\s/`) applied BEFORE `slice(0, 2)`. The leading message line is dropped; only frame lines remain. JSDoc updated to document the V8 stack-format quirk and the contract.
- **Files modified:** `src/server/analytics.ts`
- **Commit:** `18a37e7` (Task 1 — bundled with test additions)
- **Functional impact:** redacted `stackHead` is now strictly `"    at <frame1> | <frame2>"` (no PII), or `undefined` if no frames are present. Caller-facing shape unchanged; the `name` field is preserved.

**2. [Rule 2 - Missing critical functionality] `emit()` call sites were not awaited, silently breaking `awaitAnalytics: true`**

- **Found during:** Task 2, after running the await-mode latency test for the first time
- **Issue:** Plans 03 + 04 inserted `emit({ ... })` at 18 lifecycle boundaries. `wrapAnalytics(...)` returns `void` in fire-and-forget mode and `Promise<void>` in await mode (per Plan 02's design). Without `await emit(...)`, the returned promise was discarded — so `awaitAnalytics: true` silently degraded to fire-and-forget behavior at every call site. The locked decision in REQUIREMENTS line 11 ("F5 sync mode: `awaitAnalytics: boolean` opt-in flag") and threat T-13-26 (await mode adds hook execution to response time — must be observable) were NOT being honored.
- **Detection:** The new test `expect(elapsed).toBeGreaterThan(4500)` failed with elapsed = 2.6ms — the 5-second hook was clearly NOT being awaited.
- **Fix:** Prefixed all 18 inline `emit({ ... })` call sites with `await`: 15 in `src/server/router.ts` (register × 5, login × 5, recovery × 4, account.delete × 1), 3 in `src/server/oauth/router.ts` (oauth.callback.success × 3 branches). All call sites are inside `async (req, res)` route handlers — type-safe. Fire-and-forget overhead is one microtask per call (sub-millisecond; the < 500ms latency test still passes with margin).
- **Files modified:** `src/server/router.ts`, `src/server/oauth/router.ts`
- **Commit:** `1149d38` (Task 2 — bundled with the await-mode tests that caught it)
- **Functional impact:** `awaitAnalytics: true` now correctly delays the response (measured 5004ms with a 5s hook, > 4500ms threshold). Fire-and-forget mode unchanged (still < 500ms with the same 5s hook). Errors STILL swallowed in BOTH modes (Critical Constraint 8 — the 3 error-swallow tests pass in both fire-and-forget and await mode).

These two deviations are tightly coupled to this plan's tests — the plan's must_haves explicitly required the behaviors to work end-to-end, and the new tests caught both gaps within seconds of running. Both are bundled into the corresponding task commits with `[Rule N - Type]` prefixes in the commit body.

## Authentication Gates

None — no auth gates required for this plan (test fill-in + minor source corrections; no external service calls).

## Issues Encountered

The two production-code bugs documented above are the issues encountered. Both were caught by the new tests on first run and fixed within the same task; no other iterations or flakes occurred. The full suite was green on first invocation after each commit.

## Verification Commands Run

| #   | Command                                                                          | Exit | Notes                                                                                                          |
| --- | -------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| 1   | `nvm use 20 && npm test -- --run src/__tests__/analytics-latency.test.ts` (T1)    | 0    | After redactErrorMessage fix — 4/4 tests pass (fire-and-forget × 2, sync throw × 1, rejected Promise × 1)      |
| 2   | `nvm use 20 && npm test -- --run src/__tests__/analytics-{lifecycle,types,pii-snapshot,pii-leak,oauth}.test.ts` after T1 | 0 | 60/60 — confirms redactErrorMessage fix doesn't regress other analytics tests |
| 3   | `nvm use 20 && npm run typecheck` after Task 1                                    | 0    | tsc --noEmit clean                                                                                             |
| 4   | `nvm use 20 && npm test -- --run src/__tests__/analytics-latency.test.ts` (T2)    | 0    | After await emit() fix — 7/7 tests pass; await-mode-latency test now reads elapsed = 5004ms (was 2.6ms before) |
| 5   | `nvm use 20 && npm run typecheck` after Task 2                                    | 0    | tsc --noEmit clean across whole project                                                                        |
| 6   | `nvm use 20 && npm test -- --run` (full suite, final)                             | 0    | **397 passed** / 4 skipped (testnet) / **0 todos** / 0 failed (401 total across 27 files); 19.6s wall-clock    |
| 7   | All grep acceptance criteria from the plan                                        | ALL  | See "All grep + acceptance gates pass" table above                                                             |

## Threat Model Confirmation

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-13-23 (DoS: hook hangs / takes 5s blocks response) | mitigate | ✓ Fire-and-forget latency test asserts elapsed < 500ms with a 5s hook (measured ~30ms typical). The hook's 5s is verifiably NOT in the critical path. |
| T-13-24 (DoS: hook throws → 500 error) | mitigate | ✓ All 4 throw scenarios (sync FF, rejected FF, sync await, rejected await) produce 200 OK. Errors swallowed in BOTH modes per Critical Constraint 8. |
| T-13-25 (Information Disclosure: Error.message PII via WARN log) | mitigate | ✓ **NEWLY ACTUALLY MITIGATED.** redactErrorMessage now correctly drops the V8 stack-trace's leading message line. Test assertion `JSON.stringify(entries).not.toContain('boom-codename-leak-ALPHA-7')` passes — the unique token in the thrown Error.message does NOT appear anywhere in the captured log JSON. Same for `rejected-boom-ALPHA-7`, `await-mode-throw-leak-7`, `await-rejected-leak-7`. |
| T-13-26 (Information Disclosure timing: await mode exposes timing side-channel) | accept | ✓ Documented opt-in trade-off. Test asserts elapsed > 4500ms with the 5s hook + awaitAnalytics:true — confirms the trade-off is real and observable. README (Phase 16 RELEASE-01) will recommend fire-and-forget for production. |
| T-13-27 (Tampering: future PR drops .catch on rejected Promises in wrapAnalytics) | mitigate | ✓ Two rejected-Promise tests (one fire-and-forget, one await mode) would fail with a vitest unhandled-rejection warning + missing `analyticsWarn` log entry if .catch is removed. Catches the regression class. |

## Known Stubs

None introduced by this plan. The previously-7 `it.todo` placeholders in `analytics-latency.test.ts` are now all real `it()` blocks. Suite-wide it.todo count is 0.

## Threat Flags

None. The two production-code fixes (redactErrorMessage, await emit) are corrections to existing surface, not new attack surface. No new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries.

## Downstream-Plan Unblock Note

**Phase 13 is COMPLETE.** All 6 ANALYTICS-XX requirements are now landed:
- ANALYTICS-01: 18 emit points across passkey + recovery + account-delete + OAuth (Plans 03 + 04)
- ANALYTICS-02: AnalyticsEvent discriminated union as type-level PII whitelist (Plan 02)
- ANALYTICS-03: tsc-fail fixture proving union enforces no-PII (Plan 02)
- ANALYTICS-04: wrapAnalytics envelope + 7 latency/error-swallow/await-mode end-to-end tests (Plan 02 + **Plan 05 (this plan)**)
- ANALYTICS-05: ALLOWED_EVENT_FIELDS frozen Set + variant whitelist test (Plan 02)
- ANALYTICS-06: failure events emitted by default + leaked-codename regression test (Plan 03)

**Ready for `/gsd-verify-work 13`.**

Phase 14 (HOOK-02..06 — second-factor enrolment) and Phase 15 (BACKFILL-01..04 — lazy-backfill) follow next. Both should adopt the patterns established here:
1. `await hookEnvelope(...)` at every call site for any new hook (afterAuthSuccess, backfillKeyBundle).
2. End-to-end latency contract via supertest + performance.now().
3. Leaked-token negative assertion (defense-in-depth) for any hook that touches consumer error data.

## User Setup Required

None — no external service configuration required.

## Self-Check: PASSED

Verified:
- File `src/__tests__/analytics-latency.test.ts` modified (36 → 333 lines, 0 it.todo, 7 it() blocks across 3 describe blocks) — FOUND
- File `src/server/analytics.ts` modified (redactErrorMessage frame-line filter) — FOUND
- File `src/server/router.ts` modified (15 `await emit(` call sites) — FOUND (`grep -c "await emit(" src/server/router.ts` = 15)
- File `src/server/oauth/router.ts` modified (3 `await emit(` call sites) — FOUND (`grep -c "await emit(" src/server/oauth/router.ts` = 3)
- File `.planning/phases/13-registration-analytics-hook/13-05-SUMMARY.md` created — FOUND (this file)
- Commit `18a37e7` (Task 1 — fire-and-forget + sync throw + rejected Promise tests; redactErrorMessage fix) — FOUND in git log
- Commit `1149d38` (Task 2 — awaitAnalytics:true tests; await emit() at all 18 call sites) — FOUND in git log

## Next Phase Readiness

- Phase 13 ANALYTICS-01..06 are ALL COMPLETE.
- Phase 14 (Second-Factor Hook) and Phase 15 (Lazy-Backfill) are unblocked. Both can mirror this plan's `await hook(...)` + performance.now()-bounded latency-test pattern.
- Suite-wide it.todo count: 0. Ready for `/gsd-verify-work 13`.
- No blockers, no concerns.

---
*Phase: 13-registration-analytics-hook*
*Plan: 05*
*Completed: 2026-04-30*
