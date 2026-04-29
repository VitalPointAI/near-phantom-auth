---
phase: 10
plan: 01
status: complete
requirements:
  - MPC-01
completed: 2026-04-28
---

# Plan 10-01 Summary — MPC-01 Export Bug Fix

## What Shipped

Closes MPC-01 — the v0.6.0 production-blocking export bug that was driving the
Ledgera mpc-sidecar restart loop. Consumer code can now `import { MPCAccountManager }`
and instantiate it at runtime; the previous `export type` modifier was stripped by
TypeScript at compile time, leaving the class constructor absent from
`dist/server/index.js`.

## Files Changed

### `src/server/mpc.ts` (+22 lines)
Added two consumer-facing type aliases between `MPCConfig` and `getMPCContractId`:

- `MPCAccountManagerConfig` — REQUIRED `treasuryAccount`, `treasuryPrivateKey`,
  `derivationSalt` at the type boundary (enforces MPC-07 cross-tenant isolation
  for standalone consumers). Internal `createAnonAuth` callers continue to use
  `MPCConfig` with optional fields, so backward compat is preserved.
- `CreateAccountResult` — alias of `MPCAccount` for the frozen public contract.

### `src/server/index.ts` (line 260, split into 2 lines)
Replaced:
```typescript
export type { MPCAccountManager, MPCConfig, MPCAccount } from './mpc.js';
```
With:
```typescript
export { MPCAccountManager } from './mpc.js';
export type { MPCAccountManagerConfig, CreateAccountResult, MPCConfig, MPCAccount } from './mpc.js';
```

### `src/__tests__/exports.test.ts` (new, 112 lines, 10 tests)
Regression gate organized into 4 describe blocks:

1. **Runtime export** (3 tests) — `typeof MPCAccountManager === 'function'`,
   instantiation does not throw, instances expose `createAccount` and
   `verifyRecoveryWallet` methods.
2. **Type aliases re-exported** (3 tests) — compile-time check that
   `MPCAccountManagerConfig`, `CreateAccountResult`, `MPCConfig`, `MPCAccount`
   resolve from `'../server/index.js'`.
3. **Source-level export shape** (2 tests) — `src/server/index.ts` contains the
   new value-export pattern AND does NOT contain the old broken type-only form.
4. **Build artifact** (2 tests, `describe.skipIf(!haveDist)`) — `dist/server/index.js`
   exposes `MPCAccountManager` as a runtime value; `await import(distPath)` yields
   a function. Skipped when `dist/` is absent (early-wave runs).

## Verification Results

| Check | Status |
|-------|--------|
| `nvm use 20 && npx tsc --noEmit` | ✓ exit 0 |
| Plan acceptance grep checks (5 patterns) | ✓ all match exactly once |
| `nvm use 20 && npm run build` | ✓ tsup build success in 503ms |
| `dist/server/index.js` runtime export | ✓ MPCAccountManager exported as function |
| `npm test -- --run src/__tests__/exports.test.ts` | ✓ 10/10 pass |
| Full suite `npm test -- --run` | ✓ 262/262 pass (252 baseline + 10 new) |

## Key Files Created

- `src/__tests__/exports.test.ts`

## Key Files Modified

- `src/server/index.ts` (line 260 split into 2 lines)
- `src/server/mpc.ts` (+22 lines: 2 type aliases between line 34 and old line 36)

## Commits

- `402d9b1` `fix(10-01): MPC-01 export bug — value-export MPCAccountManager + add MPCAccountManagerConfig/CreateAccountResult`
- `dd0cd7c` `test(10-01): MPC-01 exports regression gate (10 tests)`

## Notes

- Dispatched first in worktree mode but the worktree was created from `ae64f44`
  (pre-phase-10) instead of current main `fb8f66b`. Re-dispatched in sequential
  mode (no worktree) to bypass the bug. Source edits were made by the executor
  agent before its sandbox blocked further commands; orchestrator finished the
  build/test/commit cycle.
- Type alias `MPCAccountManagerConfig` is a forward-compat stub for Plans 03/04/05.
  The current class constructor accepts `MPCConfig`, which is a structural superset
  of `MPCAccountManagerConfig` — calls compile and run today; Plans 04/05 will
  harden the constructor to accept `MPCAccountManagerConfig` directly.

## Self-Check: PASSED

All success criteria from the plan met. No deviations from the plan spec.
