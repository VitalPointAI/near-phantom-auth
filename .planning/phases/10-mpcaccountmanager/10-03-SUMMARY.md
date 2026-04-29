---
phase: 10
plan: 03
status: complete
requirements:
  - MPC-04
  - MPC-05
completed: 2026-04-29
---

# Plan 10-03 Summary — Wallet FullAccess Permission Gate

## What Shipped

Closes MPC-04 (deleted-account safety) and MPC-05 (FullAccess gate). Fixes the
v0.6.0 security gap where `checkWalletAccess` in `src/server/recovery/wallet.ts`
returned `true` for any non-error RPC response — including FunctionCall-only
keys, which cannot sign arbitrary transactions and therefore must NOT satisfy
`verifyRecoveryWallet`.

## Files Changed

### `src/server/recovery/wallet.ts` (lines 84-125)
Rewrote `checkWalletAccess`:
- Removed outer `try { ... } catch { return false; }` so `fetch()` throws
  propagate to the caller (required by MPC-10).
- Replaced `return !result.error;` with the FullAccess gate:
  ```typescript
  if (result.error || !result.result) return false;
  return result.result.permission === 'FullAccess';
  ```
- Typed parsed JSON as `{ result?: { permission: 'FullAccess' | { FunctionCall: unknown }; ... }; error?: unknown }` per `@near-js/types` `AccessKeyViewRaw`.

### `src/__tests__/wallet.test.ts`
- Migrated existing `'returns false when fetch throws (network failure)'` →
  `'throws when fetch fails (RPC unreachable — MPC-10 propagation)'` using
  `await expect(...).rejects.toThrow('Network error')`. Done in the same
  commit as the source change so no intermediate red state.
- Appended new describe block `'checkWalletAccess — MPC-05: FullAccess
  permission gate'` with 3 regression cases:
  - FunctionCall permission → false
  - FullAccess permission → true (regression — existing behavior preserved)
  - UNKNOWN_ACCOUNT error → false (deleted-account safety)
- All untouched existing cases (mainnet URL test, UNKNOWN_ACCESS_KEY, recovery
  manager block) stay green against the new code by inspection.

## Behavior Matrix

| RPC outcome | Before (v0.6.0) | After (10-03) | Closes |
|-------------|-----------------|---------------|--------|
| `result.permission === 'FullAccess'` | true | true | regression |
| `result.permission === { FunctionCall: ... }` | **true** | **false** | MPC-05 |
| `error: UNKNOWN_ACCESS_KEY` | false | false | regression |
| `error: UNKNOWN_ACCOUNT` (deleted) | false | false | MPC-04 |
| `fetch()` throws (network unreachable) | swallowed → false | **propagates** | MPC-10 prep |

## Verification Results

| Check | Status |
|-------|--------|
| `npx tsc --noEmit` | ✓ exit 0 |
| `npm test -- --run src/__tests__/wallet.test.ts` | ✓ 18/18 pass |
| `npm test -- --run` (full suite) | ✓ 265 pass + 12 todo = 277 total, 0 failures |

## Commits

- `ab5d0d9` `feat(10-03): gate checkWalletAccess on FullAccess permission (MPC-04/05)`

## Notes

- The `verifyRecoveryWallet` wrapper in `src/server/mpc.ts:594-604` still has
  its own `try { ... } catch { return false; }` that swallows the new
  propagating throw. Plan 10-04 revises that wrapper — keeping the v0.6.0
  public surface backward-compatible during this plan was an explicit plan
  design choice.
- Mainnet-URL test (`src/__tests__/wallet.test.ts:178-190`) only asserts
  `mockFetch.toHaveBeenCalledWith(...)`, not the return value — stays green
  even though the new gate returns `false` for `{ result: {} }`.

## Self-Check: PASSED
