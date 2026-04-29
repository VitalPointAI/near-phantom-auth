---
phase: 10
plan: 04
status: complete
requirements:
  - MPC-02
  - MPC-03
  - MPC-06
  - MPC-08
  - MPC-09
  - MPC-10
  - MPC-11
completed: 2026-04-29
---

# Plan 10-04 Summary — MPCAccountManager Hardening

## What Shipped

The behavioral core of the v0.6.1 hotfix. Closes 7 requirements (MPC-02, MPC-03,
MPC-06, MPC-08, MPC-09, MPC-10, MPC-11). Hardens `MPCAccountManager` against
the consumer's frozen contract: throw on failure (was: degraded return),
idempotent retry (was: re-broadcast), nonce-race convergence (was: silent
failure), `parseNearAmount` (was: BN-based), and `KeyPair` field (was: raw
private-key string).

## Files Changed

### `src/server/mpc.ts` (+330/-143 lines)

Seven edits applied:

1. **`parseNearAmount` import added** (after `@near-js/crypto`).
2. **`fundAccountFromTreasury` signature** changed from `treasuryPrivateKey: string`
   → `keyPair: KeyPair`. Internal body derives `secretKey`/`publicKey` from the
   KeyPair object — the raw private-key string never re-appears.
3. **yoctoNEAR conversion** in `fundAccountFromTreasury` switched to
   `parseNearAmount(amountNear)` (MPC-08). Replaces the BN-based block.
4. **Class private field** `treasuryPrivateKey?: string` → `keyPair?: KeyPair`
   (MPC-09). Constructor materializes the KeyPair once via
   `KeyPair.fromString(config.treasuryPrivateKey as 'ed25519:${string}')`.
5. **`addRecoveryWallet`** uses `this.keyPair` directly with `new KeyPairSigner(this.keyPair)`.
   No local `KeyPair.fromString` call.
6. **`createAccount`** rewritten end to end:
   - Step 1: deterministic derivation (MPC-02, MPC-04).
   - Step 2: idempotency via `accountExists` (MPC-03).
   - Step 3: no-treasury backward-compat → returns `{ onChain: false }` without throwing.
   - Step 4: fund from treasury — passes `this.keyPair` (object, not `.toString()`).
   - Step 5: nonce-race convergence — retry `accountExists` once on InvalidNonce; success if winner already provisioned (MPC-06).
   - Step 6: classify error and `throw new Error(...)` with `cause` set (MPC-10).
7. **Module-level helpers** added (`isLikelyNonceRace`, `isRpcUnreachable`,
   `isTreasuryUnderfunded`) and **`verifyRecoveryWallet`** simplified to delegate
   directly to `checkWalletAccess` (no try/catch swallow). Plan 03's hardened
   `checkWalletAccess` propagates RPC failures (MPC-10).

### `src/__tests__/mpc-account-manager.test.ts` (+330/-15 lines)

Plan 02's 12 `it.todo` placeholders replaced with real assertions across 5
describe blocks:

| Block | T-cases | Skip-guard |
|-------|---------|------------|
| Testnet provisioning | T1, T2 | `describe.skipIf(!HAVE_TESTNET)` |
| Derivation determinism | T3, T4, T12, T3-bonus, T-MPC-08 | none (unit) |
| Error paths | T5, T6, T6-bonus | none (unit) |
| Testnet recovery | T7, T11 | `describe.skipIf(!HAVE_TESTNET)` |
| Permission matrix | T8, T9, T10 | none (unit) |

Bonus cases:
- **T3-bonus** asserts the idempotency contract — second call with
  `view_account: exists` triggers zero `broadcast_tx_commit` calls.
- **T6-bonus** asserts MPC-06 nonce-race convergence end-to-end.
- **T-MPC-08** verifies `parseNearAmount('0.01')` = 10^22 yoctoNEAR is
  encoded into the borsh `broadcast_tx_commit` body bytes (16-byte u128
  little-endian sequence search).

Test treasury key is a freshly-generated ed25519 KeyPair — never used against
mainnet/testnet.

## Verification Results

| Check | Status |
|-------|--------|
| `nvm use 20 && npx tsc --noEmit` | ✓ exit 0 |
| All 16 plan acceptance grep gates | ✓ all pass |
| **MPC-09 call-stack isolation grep gate** | ✓ `treasuryPrivateKey` appears only in 2 interface declarations + 3 constructor materialization lines |
| `npm test -- --run src/__tests__/mpc.test.ts` | ✓ 17/17 (SEC-04 derivation tests preserved) |
| `npm test -- --run src/__tests__/logging.test.ts` | ✓ 9/9 (no leak in `log.*` calls) |
| `npm test -- --run src/__tests__/wallet.test.ts` | ✓ 18/18 |
| `npm test -- --run src/__tests__/mpc-account-manager.test.ts` | ✓ 11 pass + 4 testnet-skipped = 15 |
| Full suite `npm test -- --run` | ✓ 276 pass + 4 skipped = 280 total, 0 failures |

## Commits

- `dcb364c` `feat(10-04): harden MPCAccountManager — KeyPair field, parseNearAmount, throw-on-failure, idempotency, nonce-race convergence`

## Notes for Plan 05 (treasury leak audit)

- **Rebuild dist/ before grep** — Plan 05 must run `npm run build` first, then
  grep the JS/CJS bundles. The current dist/ was rebuilt during 10-04 verification.
- **MPC-09 expectation**: `grep -rn treasuryPrivateKey dist/server/ --include=*.js --include=*.cjs`
  should return zero matches in the runtime bundle. The `.d.ts` files MAY contain
  the field name as a type property — that is acceptable.
- The `bn.js` import remains in mpc.ts even though local usage is gone — tsup
  tree-shakes unused imports and `@near-js/transactions` may transitively use BN.

## Execution Notes

- This plan was attempted three times in parallel/worktree mode (twice via
  agent dispatch, once via direct Edit). Two agent dispatches hit the
  executor sandbox restriction; a third hit a stream timeout after 26 tool
  uses. Final completion was driven by the orchestrator using the Edit tool
  directly (6 Edit calls + 1 Write call), then verifying via tsc and vitest.
- The plan's verbatim code snippets made direct execution tractable.

## Self-Check: PASSED
