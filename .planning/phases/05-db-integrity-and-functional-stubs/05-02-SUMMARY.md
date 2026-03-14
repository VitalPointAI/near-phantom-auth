---
phase: 05-db-integrity-and-functional-stubs
plan: 02
subsystem: mpc
tags: [near, mpc, addkey, recovery, typescript, vitest]

# Dependency graph
requires:
  - phase: 05-01
    provides: DatabaseAdapter optional methods; test scaffold with 14 it.todo() stubs
provides:
  - Real addRecoveryWallet using @near-js/transactions AddKey transaction with broadcast_tx_commit
  - Fixed verifyRecoveryWallet using view_access_key with specific public key via checkWalletAccess
affects:
  - 05-03 (account deletion endpoint — mpc.ts now clean)
  - router.ts (callers of addRecoveryWallet/verifyRecoveryWallet need public key, not account name)

# Tech tracking
tech-stack:
  added:
    - "@near-js/transactions actionCreators.addKey + actionCreators.fullAccessKey"
    - "@near-js/signers KeyPairSigner.signTransaction"
    - "@near-js/crypto KeyPair.fromString, PublicKey.fromString"
  patterns:
    - "addKey via actionCreators object — addKey/fullAccessKey are NOT direct exports from @near-js/transactions; they live in actionCreators"
    - "KeyPairSigner.getPublicKey() called ONCE — result used for both nonce fetch and createTransaction to avoid public key mismatch error"
    - "bs58.decode(blockHashStr) for blockHash param — createTransaction requires Uint8Array, NOT base58 string"
    - "checkWalletAccess delegation — verifyRecoveryWallet delegates entirely to existing wallet.ts function"

key-files:
  created: []
  modified:
    - src/server/mpc.ts

key-decisions:
  - "actionCreators destructuring for addKey/fullAccessKey — plan showed direct imports that don't exist; fixed to use actionCreators object which is the actual export"
  - "Treasury key cast to ed25519 template literal — KeyPair.fromString requires KeyPairString type; cast as `ed25519:${string}` is safe given the runtime format"
  - "Use treasury key as signer for AddKey per plan direction — signing authority question deferred to testnet validation (existing STATE.md blocker)"

patterns-established:
  - "@near-js signing pattern: KeyPair.fromString → KeyPairSigner → getPublicKey() → createTransaction → signTransaction → signedTx.encode() → base64 → broadcast_tx_commit"
  - "verifyRecoveryWallet thin delegation: check-specific-key logic fully owned by checkWalletAccess in wallet.ts"

requirements-completed: [STUB-01, BUG-04]

# Metrics
duration: 8min
completed: 2026-03-14
---

# Phase 05 Plan 02: MPC Recovery Wallet Methods Summary

**Real addRecoveryWallet via @near-js AddKey transaction and fixed verifyRecoveryWallet using view_access_key with specific public key**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-14T14:35:00Z
- **Completed:** 2026-03-14T14:43:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Replaced `pending-${Date.now()}` stub in `addRecoveryWallet` with a real AddKey transaction using `@near-js/transactions`, `@near-js/signers`, and `@near-js/crypto`. Fetches nonce + block hash via `view_access_key` RPC, builds AddKey action, signs with `KeyPairSigner`, broadcasts via `broadcast_tx_commit`, returns real `txHash`.
- Fixed `verifyRecoveryWallet` to delegate to `checkWalletAccess` from `src/server/recovery/wallet.ts` which uses `view_access_key` with the specific public key parameter instead of `view_access_key_list` which only checked if any key existed.
- Both method signatures updated to accept `recoveryWalletPublicKey` (ed25519:BASE58 format) instead of a wallet account name — corrects the fundamental mismatch between what the on-chain operations require and what was previously passed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement real addRecoveryWallet with @near-js AddKey transaction** - `1cce1ed` (feat)
2. **Task 2: Fix verifyRecoveryWallet to check specific public key** - `29aeaf9` (fix)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `src/server/mpc.ts` - Added @near-js imports, replaced addRecoveryWallet stub with real AddKey transaction, replaced verifyRecoveryWallet with checkWalletAccess delegation

## Decisions Made

- `addKey` and `fullAccessKey` are inside `actionCreators` object, NOT direct named exports from `@near-js/transactions` — plan's import statement was incorrect; fixed by importing `actionCreators` and destructuring
- `KeyPair.fromString` requires `KeyPairString` template literal type — cast as `ed25519:${string}` is safe given the runtime key format
- Treasury key used as signer for AddKey per plan direction — the open question about key authority (treasury key vs derived account key) is deferred to testnet validation (flagged in STATE.md blockers)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] addKey/fullAccessKey not direct exports from @near-js/transactions**
- **Found during:** Task 1 (TypeScript compilation + runtime verification)
- **Issue:** Plan specified `import { addKey, fullAccessKey } from '@near-js/transactions'` but these are not direct exports — they're inside the `actionCreators` named export
- **Fix:** Import `actionCreators` from `@near-js/transactions` and destructure `{ addKey, fullAccessKey }` from it
- **Files modified:** src/server/mpc.ts
- **Commit:** 1cce1ed

**2. [Rule 1 - Bug] KeyPair.fromString type mismatch**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** `KeyPair.fromString()` requires `KeyPairString` type (`ed25519:${string} | secp256k1:${string}`), but `this.treasuryPrivateKey` is `string | undefined`
- **Fix:** Added type cast `as 'ed25519:${string}'` with a guard check ensuring `treasuryPrivateKey` is defined before the call
- **Files modified:** src/server/mpc.ts
- **Commit:** 1cce1ed

## Issues Encountered

Pre-existing TypeScript errors in `session.test.ts` (missing `expect` imports) and `router.ts` (WalletSignature type mismatch) remain — these were present before this plan and are out of scope.

## Verification Results

- `npx tsc --noEmit` — no new errors in mpc.ts
- `npx vitest run` — 92 passing, 14 todos, 0 failures (unchanged from plan baseline)
- `grep "pending-" src/server/mpc.ts` — no matches (stub removed)
- `grep "view_access_key_list" src/server/mpc.ts` — no matches (broken check removed)

## User Setup Required

None — no external service configuration required. Testnet validation of treasury key signing authority is flagged in STATE.md blockers for later verification.

## Next Phase Readiness

- Plan 03 can proceed — mpc.ts is clean, new method signatures are correct
- Router callers of `addRecoveryWallet`/`verifyRecoveryWallet` will need updating to pass public keys instead of account names (Plan 03 scope)
- Full test suite: 92 tests passing, 14 todos, 0 failures

---
*Phase: 05-db-integrity-and-functional-stubs*
*Completed: 2026-03-14*
