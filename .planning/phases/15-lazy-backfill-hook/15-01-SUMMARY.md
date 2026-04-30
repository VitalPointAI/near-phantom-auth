---
phase: 15-lazy-backfill-hook
plan: 01
subsystem: auth
tags: [hooks, types, scaffolding, wave-0, lazy-backfill, sealingKey, pass-through, anonymity-invariant, prf]

# Dependency graph
requires:
  - phase: 11-backup-eligibility-flags-hooks-scaffolding
    provides: AnonAuthHooks scaffold (placeholder backfillKeyBundle?: (ctx: unknown) => Promise<unknown>)
  - phase: 14-second-factor-enrolment-hook
    provides: hooks integration pattern (afterAuthSuccess discriminated-union, secondFactor echo on AuthenticationFinishResponse)
  - phase: 09-webauthn-prf
    provides: sealingKeyHex thread-through (loginFinishBodySchema validates ^[0-9a-f]{64}$)
provides:
  - BackfillReason literal union ('already-current' | 'no-legacy-data' | 'completed' | 'skipped')
  - BackfillKeyBundleCtx single-shape ctx (userId, codename, nearAccountId, sealingKeyHex, req)
  - BackfillKeyBundleResult ({ backfilled, reason? })
  - Tightened AnonAuthHooks.backfillKeyBundle signature (ctx: BackfillKeyBundleCtx) => Promise<BackfillKeyBundleResult>
  - AuthenticationFinishResponse.backfill? optional field (additive, after secondFactor?)
  - 3 new types re-exported from src/server/index.ts type re-export block
  - 2 Wave-0 stub test files (backfill-login.test.ts + backfill-redaction.test.ts) with 28 it.todo placeholders
affects: [15-02-wire-call-site, 15-03-wave-2-tests, 15-04-readme-dual-recovery, 16-release-prep]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave-0 stub pattern (mirrors Phase 13 + Phase 14): only `import { describe, it } from 'vitest'`; header docblock cites requirement IDs + analog file:line; `it.todo` placeholders cover all assertions Plan 15-03 will swap in"
    - "Single-shape ctx (NOT discriminated union) for hooks with exactly one fire site — distinct from Phase 14's 3-variant afterAuthSuccess"
    - "BackfillReason as top-level literal union export (consumer ergonomics; consumers can write `reason: BackfillReason` in their hook return)"
    - "Type-level anonymity invariant documentation (T-15-01): JSDoc on BackfillKeyBundleCtx explicitly states library never logs/telemetrizes ctx fields"
    - "Type-level BACKFILL-03 containment documentation: JSDoc on backfillKeyBundle explicitly states 'Backfill failure NEVER blocks login' + WARN log uses redactErrorMessage"

key-files:
  created:
    - src/__tests__/backfill-login.test.ts (Wave-0 stub: 22 it.todo across 4 describe blocks)
    - src/__tests__/backfill-redaction.test.ts (Wave-0 stub: 6 it.todo for T-15-03 change-detector)
  modified:
    - src/types/index.ts (3 new types + tightened backfillKeyBundle signature + backfill? on AuthenticationFinishResponse)
    - src/server/index.ts (3 type re-exports added to existing block)

key-decisions:
  - "BackfillKeyBundleCtx is single-shape (NOT discriminated union) — only one fire site at /login/finish; a discriminator would be ceremony with no payoff. Distinct from Phase 14's 3-variant afterAuthSuccess (which fires from 5 distinct call sites)."
  - "BackfillReason exported as a top-level type, not buried inside BackfillKeyBundleResult — gives consumers ergonomic access (`reason: BackfillReason` in their hook return type)."
  - "sealingKeyHex on BackfillKeyBundleCtx is `string` (NOT optional) — the contract is 'ctx is supplied ONLY when sealingKeyHex was supplied', so the field is always defined at the type level. Plan 15-02 enforces this at the call site (the hook is not invoked when body.sealingKeyHex is undefined)."
  - "backfill? appears on AuthenticationFinishResponse only, NOT RegistrationFinishResponse — Phase 15 fires only on /login/finish per BACKFILL-01. T-15-06 mitigation: a register-side fire site does not exist, so the response shape must not pretend it does."
  - "Wave-0 stubs use only `import { describe, it } from 'vitest'` — no production imports. Vitest registers `it.todo` as skipped, so stubs prove the file is wired without false-positive assertions; Plan 15-03 does a 1:1 swap to real `it()` blocks with real harnesses."
  - "Phase 14 surface (afterAuthSuccess + secondFactor + onAuthEvent) is UNCHANGED — Plan 15-01 is purely additive; the only mutation is replacing the Phase 11 placeholder `(ctx: unknown) => Promise<unknown>` line."

patterns-established:
  - "Single-shape ctx for single-fire-site hooks (BackfillKeyBundleCtx) vs discriminated-union ctx for multi-fire-site hooks (AfterAuthSuccessCtx). Choice driven by call site count."
  - "Wave-0 stub pattern: 1 file per requirement cluster (login + redaction); header docblock pre-cites all analogs (router.ts fire-point, second-factor-login.test.ts harness, analytics-latency.test.ts pino capture) so Wave-2 executor does 1:1 swap"
  - "Static-enum reason fields (BackfillReason literal union) over free-form string — switchable in switch statements, type-narrowable, exhaustiveness-checkable"

requirements-completed: [BACKFILL-01, BACKFILL-02, BACKFILL-03]

# Metrics
duration: 5min
completed: 2026-04-30
---

# Phase 15 Plan 01: Backfill Hook Type Contract & Wave-0 Stubs Summary

**Phase 11 placeholder `backfillKeyBundle: (ctx: unknown) => Promise<unknown>` tightened to single-shape `BackfillKeyBundleCtx → BackfillKeyBundleResult` signature with `BackfillReason` literal union; `AuthenticationFinishResponse.backfill?` echo field added; 3 types re-exported from /server barrel; 2 Wave-0 stub test files lock the BACKFILL-01..03 requirement → assertion map for Plan 15-03**

## Performance

- **Duration:** 5min
- **Started:** 2026-04-30T13:54:31Z
- **Completed:** 2026-04-30T13:59:19Z
- **Tasks:** 2
- **Files modified:** 2 (src/types/index.ts, src/server/index.ts)
- **Files created:** 2 (src/__tests__/backfill-login.test.ts, src/__tests__/backfill-redaction.test.ts)

## Accomplishments

- **Type contract locked:** Phase 11 placeholder removed (`grep -c "(ctx: unknown) => Promise<unknown>"` on backfillKeyBundle returns 0); tightened signature with full JSDoc citing BACKFILL-01..04 + T-15-01 anonymity invariant.
- **3 new types added:** `BackfillReason` (literal union), `BackfillKeyBundleCtx` (single-shape ctx), `BackfillKeyBundleResult` (return shape).
- **Echo field added:** `AuthenticationFinishResponse.backfill?: { backfilled: boolean; reason?: BackfillReason }` — additive, after `secondFactor?`. **NOT added to `RegistrationFinishResponse`** (T-15-06 mitigation: Phase 15 fires only on login).
- **Re-exports:** All 3 types exported from `src/server/index.ts` in the existing type re-export block, alongside the Phase 14 `AfterAuthSuccess*` exports.
- **Wave-0 stubs:** 2 test files with 28 `it.todo` placeholders covering BACKFILL-01..03 + T-15-03 redaction defense. Vitest registers all 28 as todo; both files exit clean.
- **Zero regression:** `npm run typecheck` exits 0; full vitest suite (444 passed, 4 skipped, 28 todo) — no regression on Phase 11–14 surface (afterAuthSuccess, secondFactor, passkey, onAuthEvent all intact).

## Task Commits

Each task was committed atomically:

1. **Task 1: Tighten AnonAuthHooks.backfillKeyBundle + add backfill? to AuthenticationFinishResponse + re-export from /server barrel** — `1588818` (feat)
2. **Task 2: Create 2 Wave-0 test stubs (locks BACKFILL-01..03 → test-file 1:1 map)** — `238cbca` (test)

_Note: Task 1 was marked TDD in the plan, but the "test" gate is the TypeScript compiler itself — tightening `(ctx: unknown) => Promise<unknown>` to `(ctx: BackfillKeyBundleCtx) => Promise<BackfillKeyBundleResult>` is a type-level assertion enforced by `tsc --noEmit`. The Wave-0 runtime test stubs are added separately in Task 2 per the plan's explicit task split. Plan-level `type: execute` (not `type: tdd`), so TDD gate sequence is per-task-tdd, not phase-wide._

## Files Created/Modified

- `src/types/index.ts` — Added `BackfillReason`, `BackfillKeyBundleCtx`, `BackfillKeyBundleResult` exported types before `AnonAuthHooks` interface; replaced placeholder `backfillKeyBundle` line with tightened signature + JSDoc; appended `backfill?` field to `AuthenticationFinishResponse` after `secondFactor?`.
- `src/server/index.ts` — Inserted `BackfillKeyBundleCtx`, `BackfillKeyBundleResult`, `BackfillReason` into the existing `export type { ... } from '../types/index.js'` block, immediately after `AfterAuthSuccessProvider` (Phase 14's last re-export).
- `src/__tests__/backfill-login.test.ts` — Wave-0 stub. 22 `it.todo` calls across 4 describe blocks: BACKFILL-01 (silent skip + ctx shape, 6 todos), BACKFILL-02 (echo on response, all 4 BackfillReason values + reason-omitted + field-coexistence, 6 todos), BACKFILL-03 (containment + 200 OK + Set-Cookie + WARN log + 5s hang, 7 todos), backwards-compat (3 todos). Header docblock cites analytics-lifecycle.test.ts:469-612 + second-factor-login.test.ts:1-156 + router.ts fire-point.
- `src/__tests__/backfill-redaction.test.ts` — Wave-0 stub. 6 `it.todo` calls in single describe block (T-15-03 change-detector). Header docblock cites second-factor-login.test.ts:1-156 + analytics-latency.test.ts:1-100 (pino capture) + analytics.ts:109-119 (redactErrorMessage helper).

## JSDoc Lifted into types/index.ts

**On `BackfillKeyBundleCtx` (T-15-01 anonymity invariant):**
> `userId`, `codename`, `nearAccountId`, AND `sealingKeyHex` are surfaced to the CONSUMER (intended). The library MUST NOT log or telemetrize these fields — they are exposed to the consumer's hook by design but never to the library's pino emissions. (Library logs use `redactErrorMessage` on any thrown Error; the ctx itself is never written to a log payload.)

**On `AnonAuthHooks.backfillKeyBundle` (BACKFILL-03 containment):**
> BACKFILL-03 CONTAINMENT: a hook throw or rejected Promise is caught by the library, logged WARN with a redacted error payload (Error.name + first 2 stack frames; sealingKeyHex NEVER appears in the log), and the response continues with `backfill: { backfilled: false, reason: 'skipped' }`. **Backfill failure NEVER blocks login.**

## Decisions Made

1. **Single-shape ctx (not discriminated union)** — only one fire site at `/login/finish`; discriminator would be ceremony with no payoff. Phase 14's afterAuthSuccess uses a discriminated union because it fires from 5 sites (register, login, OAuth × 3); Plan 15-01's BackfillKeyBundleCtx fires from one site, so the simpler shape is right.
2. **`BackfillReason` is a top-level export** — consumer ergonomics; consumers can declare `reason: BackfillReason` in their hook return type without reaching into `BackfillKeyBundleResult['reason']`.
3. **`sealingKeyHex: string` (defined, not optional)** — the contract is "ctx is supplied ONLY when sealingKeyHex was supplied". Widening to `string | undefined` would force consumers to null-check a field that is guaranteed defined by the call-site contract.
4. **`backfill?` on AuthenticationFinishResponse only** (NOT RegistrationFinishResponse) — Phase 15 fires only on /login/finish (BACKFILL-01). Adding the field to register would imply a register-side fire site that does not exist (T-15-06 mitigation enforced by grep gate).
5. **Wave-0 stub pattern** — only `import { describe, it } from 'vitest'`; no production imports. Mirrors Phase 13 + Phase 14 Wave-0 patterns; lets Plan 15-03 do a 1:1 swap of `it.todo` → real `it()` with no rediscovery.

## Deviations from Plan

None — plan executed exactly as written.

The acceptance criterion grep `grep -c "sealingKeyHex\\?: string" ... == 0` reported 1 match because BRE/ERE `\?` outside `-E` mode treats `?` as the literal `?` (and BSD/GNU `\?` is "optional preceding char"). Verified with fixed-string `grep -F "sealingKeyHex?:"`: zero matches in `BackfillKeyBundleCtx`. The actual contract (sealingKeyHex is non-optional `string`) is met. No code change needed; this is a regex-spelling artifact in the plan's gate, not a deviation.

## Issues Encountered

None.

## Threat Flags

None — Plan 15-01 introduces no new network endpoints, auth paths, file access patterns, or schema changes. All modifications are type-level (no runtime side effects) and match the plan's explicit threat register (T-15-01 / T-15-04 / T-15-06 mitigated by JSDoc + grep gates).

## Self-Check: PASSED

- Created files exist:
  - `src/__tests__/backfill-login.test.ts` — FOUND
  - `src/__tests__/backfill-redaction.test.ts` — FOUND
- Modified files committed:
  - `src/types/index.ts` — modified in `1588818`
  - `src/server/index.ts` — modified in `1588818`
- Commit hashes verified in git log:
  - `1588818` (Task 1, feat) — FOUND
  - `238cbca` (Task 2, test) — FOUND
- All Task 1 acceptance criteria pass (grep gates + typecheck green).
- All Task 2 acceptance criteria pass (28 `it.todo`, 0 `it()`, vitest exits 0, all 4 BackfillReason literals referenced).
- Full suite regression check: 444 passed, 4 skipped, 28 todo (matches Phase 14 close + 28 new todos, no failures).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 15-02 (wire call site at /login/finish)** can proceed: the type contract is now fully checked. Plan 15-02's executor cannot accidentally pass the wrong ctx shape because `tsc` will reject it. The fire site is already pre-cited in the Wave-0 stub header docblock (`src/server/router.ts /login/finish handler — hook fires AFTER db.getUserById success, BEFORE sessionManager.createSession, AND only when body.sealingKeyHex is defined`).
- **Plan 15-03 (Wave-2 real assertions)** has a 1:1 swap target for every assertion: 22 todos in backfill-login.test.ts + 6 todos in backfill-redaction.test.ts = 28 it() blocks to write, no rediscovery needed.
- **Plan 15-04 (README dual-recovery doc)** can lift HOOK-06-style canonical copy after Plans 15-02 + 15-03 land.

---
*Phase: 15-lazy-backfill-hook*
*Completed: 2026-04-30*
