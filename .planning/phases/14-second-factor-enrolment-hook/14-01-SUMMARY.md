---
phase: 14-second-factor-enrolment-hook
plan: 01
subsystem: auth
tags: [hooks, types, scaffolding, wave-0, second-factor, discriminated-union, secondFactor-echo, afterAuthSuccess]

# Dependency graph
requires:
  - phase: 11-backup-eligibility-flags-hooks-scaffolding
    provides: AnonAuthHooks placeholder type (afterAuthSuccess?: (ctx: unknown) => Promise<unknown>); /server barrel re-export of AnonAuthHooks
  - phase: 13-registration-analytics-hook
    provides: Wave-0 stub pattern (header docblock + vitest-only imports + it.todo placeholders); AnalyticsEvent re-export precedent in /server barrel
provides:
  - AfterAuthSuccessProvider literal union ('google' | 'github' | 'twitter')
  - AfterAuthSuccessCtx discriminated union (3 variants keyed off authMethod) — passkey-register, passkey-login, oauth-google|github|twitter
  - AfterAuthSuccessResult discriminated union ({ continue:true } | { continue:false; status; body })
  - Tightened AnonAuthHooks.afterAuthSuccess signature with locked types
  - secondFactor?: { status; body } echo on RegistrationFinishResponse + AuthenticationFinishResponse
  - /server barrel re-exports for all 3 new types (AfterAuthSuccessCtx, AfterAuthSuccessResult, AfterAuthSuccessProvider)
  - 4 Wave-0 stub files with 47 it.todo placeholders (locks HOOK-02..06 requirement → test-file 1:1 map for Plan 04)
affects: [14-02-PLAN, 14-03-PLAN, 14-04-PLAN, 15-backfill-hook]

# Tech tracking
tech-stack:
  added: []  # no new dependencies — types lift express's existing Request type
  patterns:
    - "Discriminated union with provider field on ONLY one variant (Pitfall 5 / T-14-05 narrowing defense)"
    - "additive secondFactor? echo following BACKUP-01's nested-key spread pattern"
    - "Wave-0 stub locks requirement → test-file map before call sites are wired (mirrors Phase 13)"

key-files:
  created:
    - src/__tests__/second-factor-register.test.ts
    - src/__tests__/second-factor-login.test.ts
    - src/__tests__/second-factor-oauth.test.ts
    - src/__tests__/second-factor-orphan.test.ts
  modified:
    - src/types/index.ts
    - src/server/index.ts

key-decisions:
  - "Open Question #2 Option (b): codename is REQUIRED on passkey variants and OPTIONAL on OAuth variant — OAuthUser (src/types/index.ts:410-422) has no codename field in v0.7.0, so OAuth-variant cannot promise one"
  - "Pitfall 5 / T-14-05 mitigation: provider: AfterAuthSuccessProvider placed ONLY on the OAuth brace block; passkey variants do NOT carry provider — TypeScript type narrowing enforces correctness at compile time"
  - "Pitfall 4 (Option A) locked into stub assertions: Pitfall 4 it.todo entries assert that register.finish.success / login.finish.success / oauth.callback.success analytics events fire REGARDLESS of continue:true vs continue:false"
  - "AfterAuthSuccessProvider mirrors src/server/analytics.ts:39's OauthProvider literally rather than importing it — avoids circular import between types/index.ts and server/analytics.ts"
  - "body: Record<string, unknown> chosen over object — tighter (object accepts Date/RegExp etc. that res.json() does not handle predictably)"
  - "secondFactor? appended AFTER existing passkey? key in both finish-response interfaces (additive, BACKUP-01 spread style)"
  - "Three new types re-exported from /server barrel adjacent to AnonAuthHooks (Open Question #5: consumer needs them for explicit annotations)"

patterns-established:
  - "Discriminated-union-by-authMethod for hook ctx: each variant carries only the fields valid in its branch; provider exists on OAuth variant only — narrowing breaks at compile if violated"
  - "Hook return type as discriminated union over `continue` flag: continue:true = no extra fields, continue:false = mandatory status + body — prevents 'optional everything' gravity that would let consumers return ambiguous results"
  - "secondFactor: { status, body } echo as canonical short-circuit indicator — even if consumer's body has a `secondFactor` key, the echo wins (locks contract for client-side detection)"
  - "Wave-0 stub pattern reusable across milestones: header docblock cites requirement IDs + analog file:line; ONLY vitest-only imports; it.todo placeholders enumerate every assertion in plain English; vitest registers as skipped (no false positives, file is wired)"

requirements-completed: [HOOK-02, HOOK-03, HOOK-04, HOOK-05]

# Metrics
duration: 5min
completed: 2026-04-30
---

# Phase 14 Plan 01: Second-Factor Hook Type Contract + Wave-0 Test Stubs Summary

**Locked the AnonAuthHooks.afterAuthSuccess type contract (3-variant discriminated ctx + 2-variant return) and dropped 4 Wave-0 test stubs with 47 it.todo placeholders covering HOOK-02..06.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-30T10:54:35Z
- **Completed:** 2026-04-30T10:59:32Z
- **Tasks:** 2
- **Files modified:** 2 source files modified (src/types/index.ts, src/server/index.ts) + 4 test stubs created

## Accomplishments

- **AnonAuthHooks.afterAuthSuccess** signature tightened from Phase 11 placeholder `(ctx: unknown) => Promise<unknown>` to locked `(ctx: AfterAuthSuccessCtx) => Promise<AfterAuthSuccessResult>`. Phase 11 placeholder string occurs 0 times in src/types/index.ts (T-14-09 mitigation gate verified).
- **AfterAuthSuccessCtx** discriminated union added: 3 variants keyed off `authMethod` (`'passkey-register'` | `'passkey-login'` | `'oauth-google' | 'oauth-github' | 'oauth-twitter'`). `provider: AfterAuthSuccessProvider` exists ONLY on the OAuth variant — passkey variants reject `ctx.provider` reads at compile time (Pitfall 5 / T-14-05).
- **AfterAuthSuccessResult** discriminated union added: `{ continue: true } | { continue: false; status: number; body: Record<string, unknown> }`. `body` typed as `Record<string, unknown>` (tighter than `object`).
- **secondFactor?: { status; body }** optional echo appended to BOTH `RegistrationFinishResponse` and `AuthenticationFinishResponse` (HOOK-05).
- **Three new types re-exported** from `src/server/index.ts` adjacent to `AnonAuthHooks` (sibling to Phase 11's HOOK-01 re-export).
- **Four Wave-0 stub test files** created at `src/__tests__/second-factor-{register,login,oauth,orphan}.test.ts`, each with header docblock + vitest-only imports + `it.todo` placeholders. Total: **47 it.todo** entries (12 register + 11 login + 17 oauth + 7 orphan); vitest registers all 4 files as `skipped` (0 failures).
- **Typecheck green** (`npm run typecheck` exits 0); **full suite green** (397 passed / 4 skipped / 0 failed — Phase 13 baseline preserved exactly; 47 new todos = the new stubs).

## Task Commits

Each task was committed atomically:

1. **Task 1: Tighten AnonAuthHooks.afterAuthSuccess + add secondFactor? to finish responses** — `709d055` (feat)
2. **Task 2: Create 4 Wave-0 test stubs (locks requirement → test-file 1:1 map)** — `d00e3f6` (test)

## Files Created/Modified

### Modified
- `src/types/index.ts` — Added `import type { Request } from 'express'`; added `AfterAuthSuccessProvider` literal union (3 OAuth providers); added `AfterAuthSuccessCtx` 3-variant discriminated union; added `AfterAuthSuccessResult` 2-variant discriminated union; tightened `AnonAuthHooks.afterAuthSuccess` from `(ctx: unknown) => Promise<unknown>` to the locked union signature; appended `secondFactor?: { status; body }` to both `RegistrationFinishResponse` and `AuthenticationFinishResponse`. JSDoc on `AfterAuthSuccessCtx` explicitly documents T-14-03 mitigation (library MUST NOT log/telemetrize ctx fields) and HOOK-06 orphan-MPC trade-off.
- `src/server/index.ts` — Added `AfterAuthSuccessCtx`, `AfterAuthSuccessResult`, `AfterAuthSuccessProvider` to the existing type re-export block, immediately after `AnonAuthHooks,` (Phase 11 anchor).

### Created
- `src/__tests__/second-factor-register.test.ts` (12 it.todo) — HOOK-02 + HOOK-05 + Pitfall 4 ordering on register-finish path; references fire-point at src/server/router.ts:201-281 (insert at line 247).
- `src/__tests__/second-factor-login.test.ts` (11 it.todo) — HOOK-03 + HOOK-05 on login-finish; references fire-point at src/server/router.ts:328-385 (insert at line 351); explicitly asserts NO transaction wrapper.
- `src/__tests__/second-factor-oauth.test.ts` (17 it.todo) — HOOK-04 × 3 success branches (existing-same-provider, existing-link-by-email, new-user) + HOOK-05 + Pitfall 6 (IPFS commit on continue:false); fire-point line refs cite oauth/router.ts:241-262, :264-300, :302-383.
- `src/__tests__/second-factor-orphan.test.ts` (7 it.todo) — HOOK-06 DB-rollback + orphan-MPC change-detector; encodes the orphan trade-off in CI (asserts mpcManager.createAccount runs BEFORE mockDb.transaction; if MPC moves inside the transaction, the test breaks and forces a planner review).

## Decisions Made

### Exact JSDoc + signature lifted into types/index.ts (per output spec)

The replacement for the Phase 11 placeholder line in `AnonAuthHooks`:

```typescript
/**
 * v0.7.0 — Phase 14 HOOK-02..06. Fires INSIDE /register/finish (after
 * passkey verify + DB persist + MPC funding), inside /login/finish (after
 * passkey verify + getUserById), and inside OAuth /callback × 3 success
 * branches (after token exchange + user resolution). Always fires BEFORE
 * `sessionManager.createSession`.
 * ...
 * WARNING (HOOK-06): `mpcManager.createAccount` runs BEFORE the DB
 * transaction opens on register-finish (router.ts:225); on the OAuth
 * new-user branch (oauth/router.ts:304) it runs without any
 * transaction wrapper. A hook throw OR a `continue: false` AFTER MPC
 * funding leaves an orphaned funded NEAR implicit account with no DB
 * record. Consumers MUST be idempotent and prefer `continue: false`
 * over throwing for soft failures.
 */
afterAuthSuccess?: (ctx: AfterAuthSuccessCtx) => Promise<AfterAuthSuccessResult>;
```

### OAuth `codename?: string` decision (Open Question #2 Option (b))

`codename` is REQUIRED on passkey variants and OPTIONAL on OAuth variant. Rationale: `OAuthUser` (src/types/index.ts:410-422) does not currently carry a codename field in v0.7.0, so the OAuth ctx variant cannot promise one. Field reserved for future homogenization (when OAuth users may receive auto-generated codenames in a later milestone, the field can be tightened to required without breaking the existing surface).

### Pitfall 4 (Option A) locked into stub assertions

The register, login, and OAuth stub files each include an `it.todo` entry that asserts `register.finish.success` / `login.finish.success` / `oauth.callback.success` analytics events fire **regardless** of `continue:true` vs `continue:false`. This locks Option A (emit on short-circuit) at the test-spec level — Plan 04's executor cannot accidentally implement Option B (suppress analytics on short-circuit) without breaking the assertion swap.

### Stub file shape (47 it.todo, vitest-only imports)

| File | it.todo count | Requirement coverage |
|------|---------------|----------------------|
| second-factor-register.test.ts | 12 | HOOK-02 + HOOK-05 + Pitfall 4 + backwards-compat |
| second-factor-login.test.ts | 11 | HOOK-03 + HOOK-05 + Pitfall 4 + no-transaction-wrapper + backwards-compat |
| second-factor-oauth.test.ts | 17 | HOOK-04 × 3 branches + HOOK-05 + Pitfall 4 + Pitfall 6 + backwards-compat |
| second-factor-orphan.test.ts | 7 | HOOK-06 (DB rollback + orphan-MPC change-detector) |
| **Total** | **47** | HOOK-02..06 + Pitfall 4 + Pitfall 5 (compile-time) + Pitfall 6 |

### Re-export block update for src/server/index.ts

Three lines inserted immediately after `AnonAuthHooks, // Phase 11 HOOK-01 re-export`:

```typescript
AfterAuthSuccessCtx,           // Phase 14 HOOK-02..04 re-export
AfterAuthSuccessResult,        // Phase 14 HOOK-02..05 re-export
AfterAuthSuccessProvider,      // Phase 14 HOOK-04 re-export
```

This ensures Plans 02/03 (passkey + oauth call-site wires) inherit a fully-checked surface — TypeScript will reject any `ctx` shape that does not match `AfterAuthSuccessCtx`.

## Deviations from Plan

None - plan executed exactly as written.

The two acceptance criteria with regex flaws are noted below for transparency, but neither caused a deviation in code:

1. **Discriminated-union narrowing gate** (Task 1 acceptance): The plan's awk regex `^      \}` (6 spaces) does not match the actual closing brace which has 4 spaces. The semantic intent — passkey variants must NOT contain `provider`, OAuth variant must contain exactly one `provider: AfterAuthSuccessProvider` — was verified manually with the corrected regex (`^    \}`): passkey-register variant block contains 0 `provider` references, passkey-login variant block contains 0, OAuth variant block contains exactly 1. Pitfall 5 / T-14-05 mitigation is satisfied; the type narrowing constraint is enforced at compile time by tsc.

2. **Forbidden-imports gate** (Task 2 acceptance): The plan's regex `(import.*\bvi\b|import.*expect|import.*from 'supertest'|createRouter|createOAuthRouter)` is overly broad — the alternation matches `createOAuthRouter` anywhere, including inside `it.todo` description strings. `second-factor-oauth.test.ts:40` contains the string `'hooks: {} on createOAuthRouter → all 3 branches run unchanged'` inside an `it.todo()` description, which is the intentional Plan 04 assertion-target text. The semantic intent — no production-code imports — is satisfied: every file's only import line is `import { describe, it } from 'vitest';` (verified by `grep -E "^import" | head -1` per file). No fix applied; the `it.todo` description is load-bearing for Plan 04's 1:1 swap.

## Issues Encountered

None.

## Threat Flags

No new threat surface introduced beyond what the plan's `<threat_model>` already enumerates (T-14-03, T-14-05, T-14-09 all mitigated as planned). The HIGH-severity threats (T-14-01 transaction starvation, T-14-02 cookie leak, T-14-04 OAuth new-user partial state) are all wired in Plans 02/03 — Plan 01 establishes only the type-safe surface those plans must conform to.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Plans 02/03 (parallel call-site wires for passkey + OAuth)** can now safely begin: TypeScript will reject any `ctx` that does not match `AfterAuthSuccessCtx`; consumers who explicitly annotate hook arguments use the re-exported types from `/server`.
- **Plan 04 (integration tests)** has 47 it.todo placeholders waiting for 1:1 swap. No re-discovery needed — the requirement → test-file map is locked.
- **No blockers.** The HOOK-06 orphan-MPC trade-off is documented in the JSDoc on `afterAuthSuccess`; consumers building against the type contract will see the warning at editor hover time.

## Self-Check: PASSED

Verified after writing this summary:

- [x] `src/types/index.ts` modified: `AfterAuthSuccessCtx`, `AfterAuthSuccessResult`, `AfterAuthSuccessProvider` exist; placeholder removed; `secondFactor?` x2 added.
- [x] `src/server/index.ts` modified: 3 new types re-exported.
- [x] `src/__tests__/second-factor-register.test.ts` exists (12 it.todo, vitest-only).
- [x] `src/__tests__/second-factor-login.test.ts` exists (11 it.todo, vitest-only).
- [x] `src/__tests__/second-factor-oauth.test.ts` exists (17 it.todo, vitest-only).
- [x] `src/__tests__/second-factor-orphan.test.ts` exists (7 it.todo, vitest-only).
- [x] Commit `709d055` exists in git log (Task 1 — feat).
- [x] Commit `d00e3f6` exists in git log (Task 2 — test).
- [x] `npm run typecheck` exits 0.
- [x] `npm test --run` exits 0 (397 passed / 4 skipped / 47 todo / 0 failed).

---
*Phase: 14-second-factor-enrolment-hook*
*Completed: 2026-04-30*
