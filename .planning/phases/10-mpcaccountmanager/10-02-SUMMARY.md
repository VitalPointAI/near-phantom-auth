---
phase: 10
plan: 02
status: complete
requirements:
  - MPC-11
completed: 2026-04-29
---

# Plan 10-02 Summary — T1-T12 Test Scaffold

## What Shipped

Wave 0 test-scaffold for `MPCAccountManager`. Closes MPC-11 (test scaffold
prerequisite). Provides the empty-shell describe-block structure that Plans 03
(wallet permission gate), 04 (hardening), and 05 (treasury leak audit) populate
with real assertions.

## Files Created

### `src/__tests__/mpc-account-manager.test.ts` (93 lines, +12 it.todo entries)

5 describe blocks organized by T-case grouping:

| Block | T-cases | Skip-guard |
|-------|---------|------------|
| Testnet provisioning | T1, T2 | `describe.skipIf(!HAVE_TESTNET)` |
| Derivation determinism | T3, T4, T12 | none (unit) |
| Error paths | T5, T6 | none (unit) |
| Testnet recovery | T7, T11 | `describe.skipIf(!HAVE_TESTNET)` |
| Permission matrix | T8, T9, T10 | none (unit) |

Imports `MPCAccountManager` (value) + `MPCAccountManagerConfig` (type) from
`'../server/mpc.js'` — these resolve cleanly because Plan 10-01 added both
exports. `HAVE_TESTNET` derives from `process.env.NEAR_TREASURY_ACCOUNT`, so CI
without the env var skips T1, T2, T7, T11 silently.

## Verification Results

| Check | Status |
|-------|--------|
| Scaffold runs in isolation | ✓ 12 todo, 0 failures (NEAR_TREASURY_ACCOUNT unset → 12 skipped/todo) |
| `nvm use 20 && npx tsc --noEmit` | ✓ exit 0 |
| Full suite `npm test -- --run` | ✓ 262 passing + 12 todo = 274 total, 0 failures |

## T-case → describe-block mapping (handoff to Plan 03/04/05)

| T-case | Describe block | Owner plan | Requirement |
|--------|----------------|------------|-------------|
| T1 | Testnet provisioning | 04 | MPC-02 |
| T2 | Testnet provisioning | 04 | MPC-02 |
| T3 | Derivation determinism | 04 | MPC-03 |
| T4 | Derivation determinism | 04 | MPC-03 |
| T5 | Error paths | 04 | MPC-06 |
| T6 | Error paths | 04 | MPC-08 |
| T7 | Testnet recovery | 04 | MPC-04 |
| T8 | Permission matrix | 03 | MPC-04 |
| T9 | Permission matrix | 03 | MPC-04 |
| T10 | Permission matrix | 03 | MPC-05 |
| T11 | Testnet recovery | 04 | MPC-05 |
| T12 | Derivation determinism | 04 | MPC-07 |

## Commits

- `f07f345` `test(10-02): add T1-T12 scaffold for MPCAccountManager`

## Notes

- Dispatched twice; first dispatch (worktree mode) failed because the worktree
  base was `ae64f44` instead of current main `fb8f66b`. Second dispatch
  (sequential, no worktree) hit the executor sandbox restriction blocking
  `npm`/`nvm`/`git add`. The agent properly reported BLOCKED and exited; the
  orchestrator drove the build/test/commit cycle from outside the sandbox.
- The scaffold deliberately uses `it.todo()` (not `it.skip()`) so vitest
  surfaces the 12 entries as visible work-items in the report — Plans 03/04/05
  must convert these to real assertions before the phase can verify.

## Self-Check: PASSED
