---
phase: 13-registration-analytics-hook
plan: 02
subsystem: server
tags: [analytics, types, hooks, config-threading, lockstep, wrapAnalytics, wave-1, v0.7.0]

# Dependency graph
requires:
  - phase: 13-registration-analytics-hook
    plan: 01
    provides: Wave 0 stub files with 51 it.todo slots; analytics-types/analytics-pii-leak/analytics-pii-snapshot stubs locked to 1:1 requirement->test-file map
  - phase: 11-backup-eligibility-flags-hooks-scaffolding
    plan: 02
    provides: AnonAuthHooks.onAuthEvent placeholder (typed unknown), AnonAuthConfig.hooks, hooks threaded through createAnonAuth into both router factories (lockstep precedent)
provides:
  - src/server/analytics.ts module exporting AnalyticsEvent (12-variant discriminated union), ALLOWED_EVENT_FIELDS (frozen Set<7>), redactErrorMessage, wrapAnalytics
  - AnonAuthHooks.onAuthEvent narrowed from `(event: unknown)` to `(event: AnalyticsEvent)`
  - AnonAuthConfig.awaitAnalytics?: boolean at TOP LEVEL of config (not nested under hooks)
  - RouterConfig + OAuthRouterConfig accept rpId? + awaitAnalytics? optional fields
  - createAnonAuth threads rpId: rpConfig.id and awaitAnalytics: config.awaitAnalytics into BOTH createOAuthRouter and createRouter calls in lockstep
  - AnalyticsEvent re-exported from src/server/index.ts (consumer surface)
  - 3 Wave-0 stubs (analytics-types, analytics-pii-leak, analytics-pii-snapshot) replaced with real assertions (32 tests, 0 it.todo)
affects: [13-03-router-emit-points, 13-04-oauth-emit-points, 13-05-latency-and-error-swallow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Discriminated-union as type-level PII whitelist (variant literal-typed required fields drive tsc invariant; future PR adding `userId`, `codename`, etc. fails the tsc-fail fixture)
    - Frozen runtime Set as defense-in-depth whitelist (Object.freeze(new Set([...])) pattern)
    - wrapAnalytics envelope swallows errors EVEN in await mode (Critical Constraint 8 — analytics never breaks auth response)
    - redactErrorMessage returns { name, stackHead } only — Error.message NEVER logged (PII leak via thrown errors mitigated)
    - Per-test randomUUID() fixture path for parallel-runner safety (Pitfall 5 mitigation; mirrors MPC-07 but at scale of 6 it.each blocks)
    - Lockstep mirror: rpId + awaitAnalytics threaded into BOTH createRouter AND createOAuthRouter (Phase 11 HOOK-01 precedent + Pitfall 3 in 13-RESEARCH.md)
    - Compile-via-assignment + never-exhaustive switch — type-system does the work; runtime assertions are minimal sanity checks

key-files:
  created:
    - src/server/analytics.ts
  modified:
    - src/types/index.ts
    - src/server/router.ts
    - src/server/oauth/router.ts
    - src/server/index.ts
    - src/__tests__/analytics-types.test.ts
    - src/__tests__/analytics-pii-snapshot.test.ts
    - src/__tests__/analytics-pii-leak.test.ts

key-decisions:
  - "Imported AnalyticsEvent from ../server/analytics.js into src/types/index.ts (creates a types -> server type-only edge). Plan offered alternative of moving the union into types/, but the import edge is cleaner: analytics.ts owns the union AND the runtime helpers (ALLOWED_EVENT_FIELDS, wrapAnalytics, redactErrorMessage) co-located. Mirrors how MPCAccountManagerConfig lives in src/server/mpc.ts and is re-exported from /server."
  - "awaitAnalytics?: boolean placed at TOP LEVEL of AnonAuthConfig (sibling of hooks?: AnonAuthHooks), NOT nested under hooks. Locked decision per REQUIREMENTS line 11 + 13-PATTERNS.md Edit Target 2. Position matters because the locked decision states it controls library behavior, not hook behavior."
  - "AnalyticsEvent re-exported via a separate `export type { AnalyticsEvent } from './analytics.js';` line rather than added to the existing `export type { ... } from '../types/index.js';` block. Reason: the type lives in ./analytics.js, not ../types/index.js — bundling would require either moving the type (rejected — see decision above) or re-exporting AnalyticsEvent from types/index.ts (extra hop). Keeping the source-of-truth at /server/analytics.js is consistent with MPCAccountManagerConfig re-export pattern (line 276)."
  - "ForbiddenCase interface added to analytics-pii-leak.test.ts (Rule 3 deviation — see below). Original `as const` tuple form caused tsc TS2339 because extraPrefix is only present on a subset of cases; tuple-literal-type narrowing didn't expose the optional field on the union. Replaced with an explicit interface { field; variant; extraPrefix?; extra }. Functional behavior identical — extraPrefix is still consumed via `extraPrefix ?? ''` in the fixture template."
  - "Object.freeze(new Set([...])) as ReadonlySet<string> — the cast satisfies the type signature; freeze is applied at runtime regardless. Mirrors the plan's note on line 381."

patterns-established:
  - "Wave 1 type-foundation-first ordering: land the types module + threading + tsc-fail fixture before lifecycle emit calls. Plans 03 and 04 will INSTALL emit({ type, rpId, timestamp, ... }) at lifecycle boundaries already typed by AnalyticsEvent — they do not invent types."
  - "Tsc-fail fixture parameterization: it.each over an array of forbidden cases lets a single test block cover every forbidden field (vs. 6 separate it() blocks). Required Pitfall 5 mitigation (per-test UUID) because vitest 4.x runs files in parallel and deterministic fixture paths race."
  - "Lockstep gate: when adding new RouterConfig/OAuthRouterConfig fields that flow from createAnonAuth, the test-on-file is `grep -c <field> src/server/index.ts >= 2`. This catches the Pitfall 4 'OAuth router forgotten' regression class at the grep layer (no integration test required)."

requirements-completed: [ANALYTICS-02, ANALYTICS-03, ANALYTICS-04, ANALYTICS-05]

# Metrics
duration: 14m
completed: 2026-04-30
---

# Phase 13 Plan 02: Analytics Types + Wrap Envelope + Lockstep Threading Summary

**Landed `src/server/analytics.ts` (12-variant `AnalyticsEvent` discriminated union, frozen `ALLOWED_EVENT_FIELDS`, `redactErrorMessage`, `wrapAnalytics` with await opt-in and unconditional error swallow), narrowed `AnonAuthHooks.onAuthEvent` from `unknown` to `AnalyticsEvent`, added top-level `AnonAuthConfig.awaitAnalytics?: boolean`, threaded `rpId` + `awaitAnalytics` through `createAnonAuth` into BOTH router factories in lockstep, re-exported `AnalyticsEvent` from `/server`, and replaced 20 `it.todo` slots in three Wave-0 stubs with 32 real assertions (analytics-types, analytics-pii-leak, analytics-pii-snapshot). Full suite + typecheck green; 0 `it.todo` remaining in this plan's three test files.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-04-30T02:20:49Z
- **Completed:** 2026-04-30T02:35:05Z
- **Tasks:** 5 / 5
- **Files modified:** 8 (1 created + 7 modified)

## Accomplishments

- **`src/server/analytics.ts` created** with all five exports the phase requires:
  - `AnalyticsEvent` discriminated union with EXACTLY 12 variants (3 register + 3 login + 4 recovery + 1 oauth + 1 account.delete)
  - `RegisterFailureReason`, `LoginFailureReason`, `OauthProvider` static enums
  - `ALLOWED_EVENT_FIELDS: ReadonlySet<string>` — frozen Set with exactly 7 keys (`type`, `rpId`, `timestamp`, `provider`, `backupEligible`, `reason`, `codenameProvided`)
  - `redactErrorMessage(err)` — strips `Error.message`, returns `{ name, stackHead }` only
  - `wrapAnalytics(hook, opts)` — fire-and-forget by default, await opt-in, errors ALWAYS swallowed in BOTH modes (Critical Constraint 8)
- **`AnonAuthHooks.onAuthEvent` narrowed** from `(event: unknown) => void | Promise<void>` to `(event: AnalyticsEvent) => void | Promise<void>` — the type-level PII whitelist is now consumer-visible.
- **`AnonAuthConfig.awaitAnalytics?: boolean` added at top level** of the config interface (sibling of `hooks?: AnonAuthHooks`), with JSDoc documenting the latency-leakage trade-off and the error-swallow guarantee in await mode.
- **`RouterConfig` + `OAuthRouterConfig` extended** with `rpId?: string` and `awaitAnalytics?: boolean` optional fields, ready for Plans 03 and 04 to install `wrapAnalytics(...)` closures and lifecycle `emit({ ... })` calls.
- **`createAnonAuth` threads both fields in lockstep** into BOTH `createOAuthRouter` (line 199–214) and `createRouter` (line 219–234) calls — `grep -c "awaitAnalytics" src/server/index.ts` returns 2 (Critical Constraint 2 / Pitfall 3 satisfied).
- **`AnalyticsEvent` re-exported from `src/server/index.ts`** as a separate `export type { AnalyticsEvent } from './analytics.js'` line — consumer-facing surface available at `@vitalpoint/near-phantom-auth/server`.
- **Three Wave-0 stubs replaced with real assertions:**
  - `analytics-types.test.ts`: 11 `it()` blocks covering compile-via-assignment for every variant + never-exhaustiveness switch + public-surface re-export check.
  - `analytics-pii-snapshot.test.ts`: ALLOWED_EVENT_FIELDS membership + 12-variant whitelist via `it.each` + lockstep counter guard (4 + 12 = 15 expanded test runs).
  - `analytics-pii-leak.test.ts`: 6-case `it.each` over `forbiddenCases` array; per-test `randomUUID()` fixture path; each fixture writes a `.ts` file, shells out to `npx tsc --noEmit`, asserts non-zero exit + field name appears in stderr, unlinks fixture in `finally`.
- **Full test suite green** after the plan: 362 passed, 4 testnet-skipped, 31 todos (in `analytics-lifecycle`, `analytics-oauth`, `analytics-latency` — these are intentional Wave 0 placeholders for Plans 03/04/05). 0 failures.
- **`npm run typecheck` clean** at every task boundary (Tasks 1, 2, 3, 5 — Task 4 changes are test files that flow through tsc on the next typecheck).
- **Phase 11 invariants preserved:** `AnonAuthHooks` still re-exported from `/server`; `RelatedOrigin` still re-exported; `hooks-scaffolding.test.ts` still passes (6/6); the `(event: unknown)` signature change does not break Phase 11 grep guards (which only forbid call-site invocation, not the type-narrowing edit).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/server/analytics.ts** — `0d835df` (feat)
2. **Task 2: Narrow AnonAuthHooks.onAuthEvent + add awaitAnalytics top-level** — `149214b` (feat)
3. **Task 3: Extend RouterConfig + OAuthRouterConfig + thread through createAnonAuth in lockstep + re-export AnalyticsEvent** — `a3616fe` (feat)
4. **Task 4: Replace it.todo slots in analytics-types and analytics-pii-snapshot** — `8ad9577` (test)
5. **Task 5: Implement tsc-fail fixture in analytics-pii-leak with per-test UUID paths** — `101b75a` (test)

_Note: SUMMARY.md commit will be made by the orchestrator's final-metadata step._

## Files Created/Modified

**Created:**
- `src/server/analytics.ts` (~155 lines) — AnalyticsEvent union, ALLOWED_EVENT_FIELDS, WrapAnalyticsOpts, redactErrorMessage, wrapAnalytics. Co-located runtime helpers + types so consumers can `import { type AnalyticsEvent, wrapAnalytics } from '@vitalpoint/near-phantom-auth/server'` (only the type is re-exported as public surface today; wrapAnalytics is library-internal).

**Modified:**
- `src/types/index.ts` — imported `AnalyticsEvent` (type-only edge); narrowed `AnonAuthHooks.onAuthEvent` signature; added `AnonAuthConfig.awaitAnalytics?: boolean` adjacent to `hooks?: AnonAuthHooks`.
- `src/server/router.ts` — `RouterConfig` gains `rpId?: string` and `awaitAnalytics?: boolean` (just before the closing `}` of the interface, after `hooks?: AnonAuthHooks`).
- `src/server/oauth/router.ts` — `OAuthRouterConfig` gains the same two fields in the same position.
- `src/server/index.ts` — both `createOAuthRouter(...)` and `createRouter(...)` calls thread `rpId: rpConfig.id` and `awaitAnalytics: config.awaitAnalytics`; re-export block adds `export type { AnalyticsEvent } from './analytics.js'`.
- `src/__tests__/analytics-types.test.ts` — entire stub replaced; 11 `it()` blocks, exhaustiveness assertion, public-surface check.
- `src/__tests__/analytics-pii-snapshot.test.ts` — entire stub replaced; 4 `describe`-inner `it()`/`it.each` blocks (15 expanded test runs).
- `src/__tests__/analytics-pii-leak.test.ts` — entire stub replaced; 1 `it.each` over 6 cases (6 expanded test runs); ForbiddenCase interface added (Rule 3 deviation).

## Decisions Made

### Why `AnalyticsEvent` lives in `src/server/analytics.ts`, not `src/types/index.ts`

The plan offered an alternative (per RESEARCH/PATTERNS): define `AnalyticsEvent` in `src/types/index.ts` next to `RelatedOrigin` to AVOID the `types -> server` import edge. I chose to keep the type in `src/server/analytics.ts` because:

1. **Co-location with runtime helpers.** `ALLOWED_EVENT_FIELDS`, `wrapAnalytics`, and `redactErrorMessage` are runtime-only and live alongside the union — splitting the type away from its allowlist constant + envelope creates a maintenance hazard (a future PR could update the union without touching the allowlist).
2. **Mirrors `MPCAccountManagerConfig` precedent.** That type lives in `src/server/mpc.ts` (not `src/types/index.ts`) and is re-exported from `/server` (line 276). The `types -> server` type-only import edge is acceptable here for the same reason.
3. **Public surface stays single-source-of-truth at `/server`.** The Phase 11 `AnonAuthHooks` and Phase 12 `RelatedOrigin` re-exports flow `types -> server`; for `AnalyticsEvent` the flow is `server (analytics.ts) -> types (re-import for hooks signature) -> server (re-export from index.ts)`. This is one extra hop but it preserves the rule that consumers `import { ... } from '@vitalpoint/near-phantom-auth/server'`.

### Why `awaitAnalytics?: boolean` is at the top level (NOT nested under `hooks`)

Per `REQUIREMENTS.md` line 11 ("F5 sync mode: `awaitAnalytics: boolean` opt-in flag at top level of AnonAuthConfig") and `13-PATTERNS.md` Edit Target 2 (line 487-491). The locked decision states `awaitAnalytics` controls **library behavior** (whether to await the hook before responding), not **hook behavior** (which would belong inside `AnonAuthHooks`). Placing it at top-level mirrors how other library-behavior flags (`sessionDurationMs`, `derivationSalt`, `csrf`) are siblings of `hooks`, not children.

Verified via `grep -B1 -A1 "awaitAnalytics" src/types/index.ts`: the field is on line 207, at the same 2-space indentation as `hooks?: AnonAuthHooks` on line 200, both inside `AnonAuthConfig` (which closes on line 209).

### Why a separate `export type { AnalyticsEvent } from './analytics.js';` line

The existing `export type { ... } from '../types/index.js'` block at line 258-273 cannot carry `AnalyticsEvent` because the union lives in `./analytics.js`, not `../types/index.js`. Three options:

1. Move `AnalyticsEvent` into `types/index.ts` (rejected — see decision above).
2. Re-export `AnalyticsEvent` from `types/index.ts`, then re-re-export from `server/index.ts` (extra hop, no benefit).
3. **Add a dedicated export line** (chosen).

The dedicated line is the same pattern used for `MPCAccountManager` value re-export at line 275 (`export { MPCAccountManager } from './mpc.js'`) and `MPCAccountManagerConfig` type re-export at line 276 (`export type { MPCAccountManagerConfig, ... } from './mpc.js'`). Consistent with existing convention.

### Why an explicit `ForbiddenCase` interface in `analytics-pii-leak.test.ts`

The plan's reference implementation used `as const` on the `forbiddenCases` array to lock variant string-literal types. That worked, but tsc emitted TS2339 ("Property 'extraPrefix' does not exist on type ...") inside the `it.each` callback because `extraPrefix` is only present on 4 of 6 cases — the discriminated tuple union didn't expose the optional field on the union member without the prefix.

Fixed by introducing `interface ForbiddenCase { field; variant; extraPrefix?; extra }` and typing the array as `ForbiddenCase[]`. This widens variant from string-literal to plain string but the variant value is interpolated into a fixture source string anyway, so the literal type wasn't load-bearing. Functional behavior identical — runtime tests still pass; tsc clean.

This is documented as a Rule 3 (blocking issue) deviation below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Replaced `as const` tuple-of-objects with explicit `ForbiddenCase` interface in analytics-pii-leak.test.ts**

- **Found during:** Task 5, after first `npm run typecheck`
- **Issue:** `tsc --noEmit` emitted `TS2339: Property 'extraPrefix' does not exist on type '{ field: "codename"; variant: "register.start"; extra: "..."; } | { field: "userId"; ... extraPrefix: "..."; ... } | ...'` at the `it.each` callback's destructure `({ field, variant, extraPrefix, extra })`. The `as const` discriminated-tuple-union form does not flatten optional fields across variants — accessing `extraPrefix` is only valid when the union member that has it is selected.
- **Fix:** Replaced `const forbiddenCases = [...] as const;` with an explicit `interface ForbiddenCase { field: string; variant: string; extraPrefix?: string; extra: string }` and typed the array as `ForbiddenCase[]`. Documented why in a JSDoc comment above the array.
- **Files modified:** `src/__tests__/analytics-pii-leak.test.ts`
- **Commit:** `101b75a` (the fix is in the same commit as the rest of Task 5; the plan's reference implementation was not committed standalone)
- **Functional impact:** None. Runtime tests still pass — variant strings are template-interpolated into fixture source, the literal type was not load-bearing. Trade-off: variant strings are now `string` rather than the literal union, so a typo in `forbiddenCases` would not be caught at compile time. Mitigated by the `expect(tscOutput).toMatch(new RegExp(field))` assertion — a typo'd variant would still fail tsc but for a different reason ("variant 'register.stat' is not assignable to AnalyticsEvent['type']") and the field assertion would still pass; not a correctness regression, just a slightly weaker compile-time check.

That is the only deviation. The plan was unusually well-specified — every other task landed first try.

## Authentication Gates

None — no auth gates required for this plan (pure type-system + factory threading + test fill-in).

## Issues Encountered

The TS2339 error during Task 5 (documented above) was the only iteration. Caught immediately by the post-Task-5 typecheck; one fix; clean re-run.

## Verification Commands Run

| #   | Command                                                                                                                                       | Exit | Notes                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `nvm use 20 && npm run typecheck` after Task 1                                                                                                | 0    | analytics.ts compiles                                                                                                                |
| 2   | `nvm use 20 && npm run typecheck` after Task 2                                                                                                | 0    | types/index.ts narrowing + awaitAnalytics field clean                                                                                |
| 3   | `nvm use 20 && npm run typecheck` after Task 3                                                                                                | 0    | router.ts + oauth/router.ts + index.ts threading clean                                                                               |
| 4   | `nvm use 20 && npm test -- --run src/__tests__/hooks-scaffolding.test.ts` after Task 3                                                        | 0    | 6/6 — Phase 11 invariants preserved                                                                                                  |
| 5   | `nvm use 20 && npm test -- --run src/__tests__/analytics-types.test.ts src/__tests__/analytics-pii-snapshot.test.ts`                          | 0    | 26/26 — analytics-types: 11 + analytics-pii-snapshot: 15 (4 it/it.each expanded to 15 actual runs because it.each over 12 variants)  |
| 6   | `nvm use 20 && npm test -- --run src/__tests__/analytics-pii-leak.test.ts` (after TS2339 fix)                                                 | 0    | 6/6 — every it.each case fails tsc on the right field; ~3s per case (npx tsc spawn-time + tsconfig load)                             |
| 7   | `nvm use 20 && npm run typecheck` final                                                                                                       | 0    | tsc --noEmit clean across whole project                                                                                              |
| 8   | `nvm use 20 && npm test -- --run` (full suite)                                                                                                | 0    | 362 passed / 4 skipped (testnet) / 31 todos (in lifecycle/oauth/latency for Plans 03–05) / 0 failed (397 total across 27 files)      |
| 9   | `ls src/__tests__/_analytics-pii-fixture-*.ts \| wc -l` after the suite                                                                       | =0   | No orphaned fixture files — `finally { unlinkSync(...) }` reliably cleaned up                                                        |
| 10  | All grep acceptance criteria from the plan                                                                                                    | ALL  | 12 variant literal-types in analytics.ts, awaitAnalytics≥2 in index.ts, rpId: rpConfig.id≥2 in index.ts, AnalyticsEvent re-export ✓ |

## Threat Model Confirmation

| Threat ID | Disposition | Status                                                                                                                                                                                                                                                                                          |
| --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-13-04   | mitigate    | ✓ AnalyticsEvent union with literal-typed required fields + ALLOWED_EVENT_FIELDS frozen Set. Verified by Task 4 (analytics-pii-snapshot — 12-variant whitelist test) and Task 5 (analytics-pii-leak — 6-case tsc-fail fixture).                                                                |
| T-13-05   | mitigate    | ✓ redactErrorMessage returns `{ name, stackHead }` only — Error.message NEVER included. Verified by inspection (`grep -c "err.message" src/server/analytics.ts` returns 0). Plan 05 will land the runtime test asserting WARN-log payload contains only the redacted shape.                    |
| T-13-06   | mitigate    | ✓ RegisterFailureReason and LoginFailureReason are static-enum types; the AnalyticsEvent union forces failure variants to use them. Plan 03 (router emit calls) will install the catch-site mapping (any caught Error -> `'internal-error'`). Acceptance criterion enforced at compile time.   |
| T-13-07   | mitigate    | ✓ wrapAnalytics fire-and-forget mode returns immediately; the response continues on the next handler line regardless of hook completion. Plan 05 will land the runtime latency test (5s hook -> response < 500ms).                                                                              |
| T-13-08   | mitigate    | ✓ wrapAnalytics catches sync throws AND attaches .catch(...) to returned Promises in BOTH fire-and-forget and await modes (Critical Constraint 8). Plan 05 will exercise this end-to-end (throwing hook -> 200 OK + WARN log).                                                                  |
| T-13-09   | accept      | ✓ Documented opt-in trade-off in JSDoc on AnonAuthConfig.awaitAnalytics (line 207 of src/types/index.ts).                                                                                                                                                                                       |
| T-13-10   | mitigate    | ✓ LOCKSTEP GATE satisfied: `grep -c "awaitAnalytics" src/server/index.ts` returns 2 (one for createOAuthRouter call, one for createRouter call).                                                                                                                                                |
| T-13-11   | mitigate    | ✓ Per-test randomUUID() fixture path in analytics-pii-leak.test.ts. After full suite: `ls src/__tests__/_analytics-pii-fixture-*.ts` returns 0 (no orphans).                                                                                                                                    |
| T-13-12   | mitigate    | ✓ analytics-pii-snapshot.test.ts asserts `sampleVariants.length === 12` AND `ALLOWED_EVENT_FIELDS.size === 7`. A future PR adding a 13th variant or 8th allowed field without updating BOTH the union AND the test array fails the snapshot test.                                              |

## Known Stubs

None introduced by this plan. The 31 it.todo placeholders that remain in the suite are in `analytics-lifecycle.test.ts` (18), `analytics-oauth.test.ts` (6), and `analytics-latency.test.ts` (7) — these are Wave 0 stubs from Plan 13-01 and will be filled in by Plans 13-03, 13-04, and 13-05 respectively.

## Threat Flags

None. No new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries were introduced. The new surface (analytics emit + awaitAnalytics flag) is fully covered by the threat register above.

## Downstream-Plan Unblock Note

Plan **13-03** (Wave 2 — passkey router emit points) is now unblocked:

1. The `AnalyticsEvent` union exists, so `emit({ type: '...', rpId, timestamp, ... })` calls will be type-checked at compile time — bad emit shapes fail tsc, not at runtime.
2. The `wrapAnalytics(config.hooks?.onAuthEvent, { logger, await: config.awaitAnalytics === true })` envelope is ready to call from `createRouter`.
3. `RouterConfig.rpId` and `RouterConfig.awaitAnalytics` are typed and threaded — Plan 03's `createRouter` body can read them directly.
4. The 18 `it.todo` slots in `analytics-lifecycle.test.ts` (passkey lifecycle — register × 4 paths, login × 4 paths, recovery × 4, account.delete × 1, plus failure-emit guards) are pre-registered with the analog files cited in their docblocks.

Plan **13-04** (Wave 2 — OAuth router emit points) is unblocked the same way: `OAuthRouterConfig.rpId` and `OAuthRouterConfig.awaitAnalytics` are typed and threaded; the 6 `it.todo` slots in `analytics-oauth.test.ts` cover the 3 OAuth success branches and payload-PII-absence assertions.

Plan **13-05** (Wave 2 — latency + error-swallow + await-mode end-to-end) is unblocked: `wrapAnalytics` exists with the await opt-in; the 7 `it.todo` slots in `analytics-latency.test.ts` are ready to assert fire-and-forget < 500ms, throwing hook -> 200 OK + WARN, await mode adds ~5s.

No new test files should be invented in Plans 13-03..05 — the requirement-to-file map locked in Plan 13-01 still holds.

## User Setup Required

None — no external service configuration required.

## Self-Check: PASSED

Verified:

- File `src/server/analytics.ts` exists — FOUND
- File `src/types/index.ts` modified (imports AnalyticsEvent, narrows onAuthEvent, adds awaitAnalytics) — FOUND
- File `src/server/router.ts` modified (RouterConfig has rpId? + awaitAnalytics?) — FOUND
- File `src/server/oauth/router.ts` modified (OAuthRouterConfig has rpId? + awaitAnalytics?) — FOUND
- File `src/server/index.ts` modified (threads both fields in lockstep, re-exports AnalyticsEvent) — FOUND
- File `src/__tests__/analytics-types.test.ts` modified (it.todo replaced) — FOUND
- File `src/__tests__/analytics-pii-snapshot.test.ts` modified (it.todo replaced) — FOUND
- File `src/__tests__/analytics-pii-leak.test.ts` modified (it.todo replaced, randomUUID fixture pattern) — FOUND
- Commit `0d835df` (Task 1 — analytics.ts) — FOUND in git log
- Commit `149214b` (Task 2 — types/index.ts narrowing + awaitAnalytics) — FOUND in git log
- Commit `a3616fe` (Task 3 — router/oauth/index threading + AnalyticsEvent re-export) — FOUND in git log
- Commit `8ad9577` (Task 4 — analytics-types + analytics-pii-snapshot it.todo replacements) — FOUND in git log
- Commit `101b75a` (Task 5 — analytics-pii-leak tsc-fail fixture) — FOUND in git log

## Next Phase Readiness

- Plans 13-03, 13-04, 13-05 are unblocked (Wave 2 — emit-call installation + end-to-end behavior tests).
- The discriminated-union type-level whitelist is enforceable AND the runtime envelope is ready.
- No blockers, no concerns.

---
*Phase: 13-registration-analytics-hook*
*Plan: 02*
*Completed: 2026-04-30*
