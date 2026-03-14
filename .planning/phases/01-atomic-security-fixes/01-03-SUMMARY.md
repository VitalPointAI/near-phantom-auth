---
phase: 01-atomic-security-fixes
plan: 03
subsystem: mpc
tags: [near, mpc, bs58, bn.js, implicit-accounts, borsh, ed25519, derivation-salt]

# Dependency graph
requires:
  - phase: 01-atomic-security-fixes/plan-01
    provides: MPCAccountConfig with derivationSalt field added to types/index.ts

provides:
  - Custom base58Encode deleted; bs58.encode used at all call sites in mpc.ts
  - yoctoNEAR conversion uses BN-based integer arithmetic (no floating-point precision loss)
  - buildSignedTransaction emits correct borsh layout with 32-byte public key between keyType and signature
  - derivationSalt threads from MPCConfig through MPCAccountManager constructor to createAccount seed derivation
  - createMPCManager call in index.ts passes derivationSalt from config.mpc.derivationSalt
  - 15 passing tests covering DEBT-02, BUG-01, BUG-02, and SEC-04

affects:
  - phase-05-mpc-signing
  - any consumer of fundAccountFromTreasury (signing correctness)
  - any deployment using implicit account derivation (salt backward-compat)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Static bs58 import at module top; no dynamic imports for crypto utilities
    - BN string-split decimal parsing for bigint NEAR amounts (no parseFloat)
    - Module-level once-warning flag for missing derivationSalt configuration
    - TDD with vi.stubGlobal('fetch') to unit-test createAccount without real RPC calls

key-files:
  created: []
  modified:
    - src/server/mpc.ts
    - src/server/index.ts
    - src/__tests__/mpc.test.ts

key-decisions:
  - "Use static bs58 import replacing dynamic import; remove bs58.default accessor throughout"
  - "BN string arithmetic for yoctoNEAR: split on '.', pad fraction to 24 digits, strip leading zeros, pass integer string to BN constructor"
  - "derivationSalt backward-compat: absent salt uses identical seed format 'implicit-{userId}' matching original code"

patterns-established:
  - "BN-based NEAR amount conversion: split decimal string, reconstruct integer string, use BN for canonical form, cast to BigInt"
  - "Module-level boolean flag for one-time console.warn about missing security config"

requirements-completed: [DEBT-02, BUG-01, BUG-02, SEC-04]

# Metrics
duration: 4min
completed: 2026-03-14
---

# Phase 1 Plan 3: MPC Module Fixes Summary

**Replaced hand-rolled base58 with bs58, fixed floating-point yoctoNEAR math with BN, added missing 32-byte public key to signed transaction layout, and added configurable derivation salt to prevent predictable implicit account IDs.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-14T12:52:12Z
- **Completed:** 2026-03-14T12:56:00Z
- **Tasks:** 2 (TDD: 3 commits — test RED, feat GREEN, no refactor needed)
- **Files modified:** 3

## Accomplishments

- DEBT-02: Deleted 22-line `base58Encode` function with edge-case bugs; replaced all 4 call sites with `bs58.encode`/`bs58.decode` from static import
- BUG-01: Fixed `parseFloat(amountNear) * 1e24` float precision bug; `'0.01'` now converts to exactly `10000000000000000000000n` instead of `9999999999999998976n`
- BUG-02: `buildSignedTransaction` now includes 32-byte ED25519 public key at correct borsh position (transaction + keyType[1] + publicKey[32] + signature[64] = +97 bytes)
- SEC-04: `derivationSalt` field added to `MPCConfig`, stored in `MPCAccountManager`, used in SHA-256 seed input; wired from `config.mpc.derivationSalt` in `index.ts`; one-time console.warn when absent
- 15 tests pass covering all four fixes, including bs58 round-trip, exact yoctoNEAR values, byte-layout assertions, and salt differentiation via mocked fetch

## Task Commits

1. **RED: Failing tests for DEBT-02, BUG-01, BUG-02, SEC-04** - `3a5ab2e` (test)
2. **GREEN: Apply all four mpc.ts fixes + wire index.ts** - `f3b436f` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `src/server/mpc.ts` - Applied all 4 fixes; static bs58/BN imports; derivationSalt in MPCConfig and MPCAccountManager
- `src/server/index.ts` - Added `derivationSalt: config.mpc?.derivationSalt` to createMPCManager call
- `src/__tests__/mpc.test.ts` - Full test suite: 3 DEBT-02 tests, 4 BUG-01 tests, 5 BUG-02 tests, 3 SEC-04 tests

## Decisions Made

- Static `import bs58 from 'bs58'` replaces dynamic `await import('bs58')` and removes all `bs58.default` accessors — cleaner and avoids ESM default wrapping
- BN-based decimal parsing: split string on `.`, pad fraction to 24 digits, strip leading zeros, pass as integer string to `new BN()` — honors locked project decision (BN for integer arithmetic; string manipulation only for unavoidable decimal parsing step)
- derivationSalt absent = seed uses original `implicit-${userId}` format = exact backward compatibility for existing deployments

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- mpc.ts is now correctness-verified and security-hardened for Phase 5 (MPC signing)
- All four fixes are gated by passing tests that can serve as regression anchors
- Phase 5 borsh serialization work should reference the `buildSignedTransaction` byte layout (now correct: transaction + 1 + 32 + 64)
- Phase 5 borsh AddKey fixture validation still required per existing blocker note

---
*Phase: 01-atomic-security-fixes*
*Completed: 2026-03-14*
