---
phase: 13-registration-analytics-hook
plan: 01
subsystem: testing
tags: [analytics, vitest, scaffolding, wave-0, it-todo, nyquist-gate, v0.7.0]

# Dependency graph
requires:
  - phase: 12-multi-rp-id-verification
    provides: vitest 4.0.18 test infrastructure, src/__tests__/ glob pattern, MPC-07 tsc-fail fixture pattern, exports.test.ts compile+runtime cross-check pattern, registration-auth.test.ts mock harness
provides:
  - Six analytics test stub files under src/__tests__/ registered with vitest (51 it.todo placeholders total)
  - Wave 0 Nyquist gate locked: every Phase 13 requirement (ANALYTICS-01..06) has a registered test slot before Plan 02 lands production code
  - Header docblocks in each stub citing requirement IDs, analog files, and Plan 02+ fill-in instructions
affects: [13-02-analytics-types-and-wrap, 13-03-router-emit-points, 13-04-oauth-emit-points, 13-05-latency-and-error-swallow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Wave 0 Nyquist gate via `it.todo` placeholders — vitest registers todos as skipped, so stubs prove the file is wired without running real assertions
    - Stub-only header docblock convention — every stub cites requirement IDs, analog test files, and explicit Plan 02+ replacement instructions
    - Zero production-code import rule for Wave 0 — the only allowed import is `{ describe, it } from 'vitest'`; production imports land in Wave 1+
    - Single-line `it.todo("...")` statements driven directly from the Lifecycle Boundary Inventory (13-RESEARCH.md lines 127-157) — every emit point gets a slot, ready for 1:1 replacement in Wave 1+

key-files:
  created:
    - src/__tests__/analytics-types.test.ts
    - src/__tests__/analytics-pii-leak.test.ts
    - src/__tests__/analytics-pii-snapshot.test.ts
    - src/__tests__/analytics-lifecycle.test.ts
    - src/__tests__/analytics-oauth.test.ts
    - src/__tests__/analytics-latency.test.ts
  modified: []

key-decisions:
  - "Test files live directly under src/__tests__/ (NOT in a src/__tsc_fail/ subdirectory) — REQUIREMENTS uses `__tsc_fail/` as a category name, but actual MPC-07 lives at src/__tests__/mpc-treasury-leak.test.ts; mirror that location for the new analytics-pii-leak.test.ts"
  - "Single import line `import { describe, it } from 'vitest'` only — no production code imports yet, since src/server/analytics.ts does not exist until Plan 02. Avoids tsc errors and locks the Wave 0 invariant"
  - "Header docblock cites both requirement IDs AND analog files (mpc-treasury-leak.test.ts:197-242 for ANALYTICS-03, exports.test.ts:48-82 for ANALYTICS-02/05, registration-auth.test.ts:18-211 for ANALYTICS-01) — Plan 02+ executors can copy the analog verbatim instead of re-deriving the pattern"
  - "it.todo slot count derived from Lifecycle Boundary Inventory in 13-RESEARCH.md lines 127-157, not invented — every emit point in router.ts (11), oauth/router.ts (3), and the failure paths (3 register + 3 login) gets exactly one slot"
  - "All six files committed across two atomic commits: 3f64eb9 (3 type-system stubs) + 8989388 (3 integration stubs) — splits along the natural seam (compile-time fixture vs. supertest harness) so Plan 02 implementer can land the production code in the same order"

patterns-established:
  - "Wave 0 stub pattern: one file per requirement category, header docblock + describe + N×it.todo. Pure test-runner registration, zero production deps. Vitest reports todos as skipped so the test count is non-zero without false-positive assertions."
  - "Requirement→test-file 1:1 mapping locked at Wave 0 — Wave 1+ plans only need to replace `it.todo(...)` strings with real `it(...)` blocks; no new test files invented downstream"
  - "Pre-cite the analog: every stub names the existing test file and line range that demonstrates the production-code-bearing pattern, eliminating re-discovery cost in Plans 02–05"

requirements-completed: [ANALYTICS-01, ANALYTICS-02, ANALYTICS-03, ANALYTICS-04, ANALYTICS-05, ANALYTICS-06]

# Metrics
duration: 3min
completed: 2026-04-29
---

# Phase 13 Plan 01: Analytics Wave-0 Test Scaffolding Summary

**Six analytics test files (`analytics-{types,pii-leak,pii-snapshot,lifecycle,oauth,latency}.test.ts`) created under `src/__tests__/` with 51 `it.todo` placeholders covering ANALYTICS-01..06; vitest registers all six files (todos counted as skipped, no failures); requirement→file 1:1 map locked so Wave 1+ executors only swap `it.todo(...)` for real `it(...)` blocks without inventing new files.**

> **Wave 0 invariant:** Plans 02–05 will replace the `it.todo` slots with real assertions. The stubs are intentional; they exist to prove vitest sees the new files and to lock the requirement→test-file mapping before any production code lands. This is a required Phase 13 deliverable, NOT incomplete work.

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-30T02:07:59Z
- **Completed:** 2026-04-30T02:11:09Z
- **Tasks:** 2 / 2
- **Files modified:** 6 (all created)

## Accomplishments

- **6 stub files committed**, all picked up by vitest 4.0.18 with the existing `src/__tests__/**/*.test.ts` glob — no config changes required.
- **51 `it.todo` placeholders** registered (target was ≥51 per the success criterion):
  - `analytics-types.test.ts` — 11 slots covering AnalyticsEvent discriminated-union narrowing (ANALYTICS-02).
  - `analytics-pii-leak.test.ts` — 6 slots covering tsc-fail fixture for forbidden PII keys: `codename`, `userId`, `nearAccountId`, `email`, `ip`, `userAgent` (ANALYTICS-03).
  - `analytics-pii-snapshot.test.ts` — 3 slots covering ALLOWED_EVENT_FIELDS whitelist (ANALYTICS-05).
  - `analytics-lifecycle.test.ts` — 18 slots covering passkey lifecycle (11) + recovery (4) + account-delete (1) + ANALYTICS-06 default-emit failure events (2). Every emit point in the Lifecycle Boundary Inventory gets a slot.
  - `analytics-oauth.test.ts` — 6 slots covering oauth.callback.success on all 3 OAuth code paths + payload-PII-absence + no-failure-variant assertions (ANALYTICS-01).
  - `analytics-latency.test.ts` — 7 slots covering fire-and-forget < 500ms, throwing-hook still 200 OK, redacted pino WARN, awaitAnalytics: true mode latency, and rejected-Promise containment (ANALYTICS-04).
- **Header docblocks** on every file cite requirement IDs AND analog test files (mpc-treasury-leak.test.ts:197-242 for the tsc-fail fixture, exports.test.ts:48-82 for the compile+runtime cross-check, registration-auth.test.ts:18-211 for the mock harness). Plan 02+ executors can copy the analog verbatim.
- **No production-code imports** — the only allowed import is `{ describe, it } from 'vitest'`. `grep -r "from '../server/" src/__tests__/analytics-*.test.ts | wc -l` returns `0`, satisfying the verification rule that locks Wave 0 to test-only scaffolding.
- **Full test suite stayed green:** 330 passed, 4 skipped (testnet), 51 todos, 0 failures (385 total). `npm run typecheck` exits 0.

## Task Commits

Each task was committed atomically:

1. **Task 1: Stub three type-system / fixture test files (analytics-types, analytics-pii-leak, analytics-pii-snapshot)** — `3f64eb9` (test)
2. **Task 2: Stub three integration test files (analytics-lifecycle, analytics-oauth, analytics-latency)** — `8989388` (test)

_Note: SUMMARY.md commit will be made by the orchestrator's final-metadata step._

## Files Created/Modified

- `src/__tests__/analytics-types.test.ts` (30 lines) — Wave 0 stub, 11 it.todo for ANALYTICS-02 (discriminated-union narrowing).
- `src/__tests__/analytics-pii-leak.test.ts` (30 lines) — Wave 0 stub, 6 it.todo for ANALYTICS-03 (tsc-fail fixture, MPC-07 analog).
- `src/__tests__/analytics-pii-snapshot.test.ts` (23 lines) — Wave 0 stub, 3 it.todo for ANALYTICS-05 (ALLOWED_EVENT_FIELDS whitelist).
- `src/__tests__/analytics-lifecycle.test.ts` (49 lines) — Wave 0 stub, 18 it.todo for ANALYTICS-01 passkey + recovery + account-delete and ANALYTICS-06 failure events.
- `src/__tests__/analytics-oauth.test.ts` (28 lines) — Wave 0 stub, 6 it.todo for ANALYTICS-01 oauth.callback.success × 3 paths.
- `src/__tests__/analytics-latency.test.ts` (38 lines) — Wave 0 stub, 7 it.todo for ANALYTICS-04 latency + error swallow + await mode.

## Decisions Made

### Why test files live under `src/__tests__/` (not `src/__tsc_fail/`)

REQUIREMENTS line 53 names the category `__tsc_fail/`, but the canonical analog `src/__tests__/mpc-treasury-leak.test.ts` lives directly under `src/__tests__/` — `__tsc_fail/` is a conceptual category, not a literal directory. Putting the new fixture in a sibling directory would break the vitest config glob `src/__tests__/**/*.test.ts` and would require config changes outside the Wave 0 scope. Decision: mirror MPC-07's actual location (Critical Constraint 5 in the plan).

### Why the only import is `{ describe, it } from 'vitest'`

The production-code module `src/server/analytics.ts` does not exist yet — it lands in Plan 02. Importing `AnalyticsEvent` or `ALLOWED_EVENT_FIELDS` from a non-existent module would fail tsc, breaking the typecheck verification gate. The plan explicitly states "Do NOT add unused imports — vitest's no-unused-vars rule may complain. The only import in each is `import { describe, it } from 'vitest';`". This locks the Wave 0 invariant: stubs prove the file is wired, nothing more.

### Why the slot count derives from the Lifecycle Boundary Inventory

13-RESEARCH.md lines 127-157 enumerate every emit point in `router.ts` and `oauth/router.ts` (11 + 3 = 14 success boundaries plus 6 failure boundaries). The plan's `it.todo` slot counts (18 in lifecycle, 6 in oauth, 7 in latency, etc.) are derived directly from this inventory, not invented. Wave 1+ executors can map slot → emit point 1:1 by reading the docblock — no re-discovery needed.

### Why two commits, not one

The natural seam is "compile-time fixture stubs" (Task 1: types/pii-leak/pii-snapshot) vs. "supertest harness stubs" (Task 2: lifecycle/oauth/latency). Plan 02 lands the production code in the same order — `analytics.ts` (type union + ALLOWED_EVENT_FIELDS + wrapAnalytics) before the router emit points. Splitting Wave 0 along the same seam means the per-task test-file matching is preserved when Wave 1+ does the swap.

## Deviations from Plan

None — plan executed exactly as written.

The plan was unusually well-specified: every it.todo string was given verbatim, the header docblocks were provided as copy-paste blocks, and the analog file references were pre-cited. Both tasks landed first try, full suite + typecheck green on first run.

One observation worth noting (NOT a deviation): the gsd-sdk commit handler auto-includes related planning files alongside the staged source files. As a result, commit `3f64eb9` (Task 1) bundled in `.planning/STATE.md` (modified by an earlier session) and the previously-untracked `.planning/phases/13-registration-analytics-hook/13-PATTERNS.md`. The 3 staged source files plus those 2 planning files were committed atomically. This matches `<task_commit_protocol>` Step 4 ("If `commit_docs` is configured…") and is consistent with the project's `commit_docs: true` config in `.planning/config.json`. No production code was unintentionally included.

## Issues Encountered

None.

## Verification Commands Run

| # | Command                                                                                                          | Exit | Notes                                                                       |
|---|------------------------------------------------------------------------------------------------------------------|------|-----------------------------------------------------------------------------|
| 1 | `nvm use 20 && npm test -- --run src/__tests__/analytics-types.test.ts ... analytics-pii-snapshot.test.ts`       | 0    | 3 files / 20 todos / 0 failures (Task 1 verify)                             |
| 2 | `nvm use 20 && npm run typecheck`                                                                                | 0    | tsc --noEmit clean after Task 1                                             |
| 3 | `nvm use 20 && npm test -- --run src/__tests__/analytics-lifecycle.test.ts ... analytics-latency.test.ts`        | 0    | 3 files / 31 todos / 0 failures (Task 2 verify)                             |
| 4 | `nvm use 20 && npm test -- --run`                                                                                | 0    | Full suite: 330 passed / 4 skipped / 51 todos / 0 failed (385 total)        |
| 5 | `nvm use 20 && npm run typecheck`                                                                                | 0    | tsc --noEmit clean after Task 2                                             |
| 6 | `ls src/__tests__/analytics-*.test.ts`                                                                           | 0    | 6 paths returned                                                            |
| 7 | `grep -c "it.todo" src/__tests__/analytics-types.test.ts`                                                        | =12  | ≥11 ✓                                                                       |
| 8 | `grep -c "it.todo" src/__tests__/analytics-pii-leak.test.ts`                                                     | =7   | ≥6 ✓                                                                        |
| 9 | `grep -c "it.todo" src/__tests__/analytics-pii-snapshot.test.ts`                                                 | =4   | ≥3 ✓                                                                        |
| 10 | `grep -c "it.todo" src/__tests__/analytics-lifecycle.test.ts`                                                   | =19  | ≥18 ✓                                                                       |
| 11 | `grep -c "it.todo" src/__tests__/analytics-oauth.test.ts`                                                       | =7   | ≥6 ✓                                                                        |
| 12 | `grep -c "it.todo" src/__tests__/analytics-latency.test.ts`                                                     | =8   | ≥7 ✓                                                                        |
| 13 | `grep -r "from '../server/" src/__tests__/analytics-*.test.ts \| wc -l`                                         | =0   | No production imports — Wave 0 invariant ✓                                  |

> Note on grep counts: each file has a comment in its docblock referencing `it.todo` (e.g., "replace each `it.todo` below"), which adds 1 to the raw grep count. The actual `it.todo(...)` *statement* count matches the plan target exactly (11/6/3/18/6/7 = 51 total).

## Threat Model Confirmation

| Threat ID | Disposition | Status                                                                                                                                                               |
|-----------|-------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| T-13-01   | mitigate    | ✓ Wave 0 stub-only; the per-test UUID fixture path requirement is locked into the docblock for Plan 02 (`_analytics-pii-fixture-${randomUUID()}.ts` per Pitfall 5). |
| T-13-02   | accept      | ✓ Wave 0 mandate documented in every docblock — `it.todo` MUST be replaced by real `it(...)` blocks in Plans 02–05. Acceptance criteria for those plans count `it.todo` and reject un-replaced slots. |
| T-13-03   | accept      | ✓ Only `import { describe, it } from 'vitest';` in each stub. `it.todo` is zero-cost (vitest skips it). No long-running test surface.                                |

## Known Stubs

The 51 `it.todo` placeholders ARE intentional Wave 0 stubs — they prove the file is registered with vitest and lock the requirement→test-file 1:1 map. They are NOT bugs.

| Stub location | Count | Replaced by |
|---|---|---|
| `src/__tests__/analytics-types.test.ts` | 11 | Plan 02 (after `src/server/analytics.ts` exists with `AnalyticsEvent` discriminated union) |
| `src/__tests__/analytics-pii-leak.test.ts` | 6 | Plan 02 (after `AnalyticsEvent` exists; replaces with `it.each` + per-test `randomUUID()` fixture) |
| `src/__tests__/analytics-pii-snapshot.test.ts` | 3 | Plan 02 (after `ALLOWED_EVENT_FIELDS` is exported) |
| `src/__tests__/analytics-lifecycle.test.ts` | 18 | Plans 02 + 03 (after `wrapAnalytics` and router emit points exist) |
| `src/__tests__/analytics-oauth.test.ts` | 6 | Plans 02 + 04 (after OAuth router emit points exist) |
| `src/__tests__/analytics-latency.test.ts` | 7 | Plans 02 + 03 (after `wrapAnalytics` exists with `await` opt-in) |

Each docblock cites the exact replacement instructions inline (analog file + line range + replacement pattern). Wave 1+ executors should not need to consult the plan again to do the swap.

## Downstream-Plan Unblock Note

Plan **13-02** (Wave 1 — `src/server/analytics.ts` type union + `wrapAnalytics`) is now unblocked: the test contracts for ANALYTICS-02, ANALYTICS-03, and ANALYTICS-05 are pre-registered. Plan 13-02 implementers will:

1. Create `src/server/analytics.ts` with the discriminated union from 13-RESEARCH.md Pattern 1 (lines 240-313).
2. Replace the 11 `it.todo` slots in `analytics-types.test.ts` with real `it(...)` blocks importing `AnalyticsEvent` from the new file.
3. Replace the 6 `it.todo` slots in `analytics-pii-leak.test.ts` with the tsc-fail fixture (analog: `mpc-treasury-leak.test.ts:197-242`).
4. Replace the 3 `it.todo` slots in `analytics-pii-snapshot.test.ts` with the ALLOWED_EVENT_FIELDS whitelist assertions.

Plans **13-03** (router emit points), **13-04** (OAuth emit points), and **13-05** (latency + error swallow) follow the same pattern — production code lands, then `it.todo` slots get swapped.

No new test files should be invented in Plans 13-02..05 — the requirement→file map is locked.

## User Setup Required

None — no external service configuration required.

## Self-Check: PASSED

Verified:
- File `src/__tests__/analytics-types.test.ts` exists — FOUND
- File `src/__tests__/analytics-pii-leak.test.ts` exists — FOUND
- File `src/__tests__/analytics-pii-snapshot.test.ts` exists — FOUND
- File `src/__tests__/analytics-lifecycle.test.ts` exists — FOUND
- File `src/__tests__/analytics-oauth.test.ts` exists — FOUND
- File `src/__tests__/analytics-latency.test.ts` exists — FOUND
- Commit `3f64eb9` (Task 1 — three type-system stubs) — FOUND in git log
- Commit `8989388` (Task 2 — three integration stubs) — FOUND in git log

## Next Phase Readiness

- Plan 13-02 (Wave 1 — analytics.ts type union + wrapAnalytics envelope) is unblocked.
- All six Wave-0 test slots are registered and visible in `npm test -- --run` output.
- No blockers, no concerns.

---
*Phase: 13-registration-analytics-hook*
*Plan: 01*
*Completed: 2026-04-29*
