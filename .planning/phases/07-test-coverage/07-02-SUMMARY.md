---
phase: 07-test-coverage
plan: 02
subsystem: testing
tags: [vitest, tweetnacl, ed25519, bs58, wallet-recovery, session, adversarial]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "session manager (createSessionManager) with HMAC signing"
  - phase: 05-db-integrity-and-functional-stubs
    provides: "wallet recovery module (verifyWalletSignature, checkWalletAccess, createWalletRecoveryManager)"

provides:
  - "Real ed25519 signature verification tests for wallet recovery (TEST-05)"
  - "Session adversarial test coverage verification (TEST-01)"
  - "15 wallet unit tests covering all critical crypto paths"

affects: [07-test-coverage]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real cryptographic keypair generation via nacl.sign.keyPair() for authentic test signatures"
    - "vi.stubGlobal('fetch', ...) with afterEach(() => vi.unstubAllGlobals()) for fetch mocking isolation"
    - "SHA256 message hashing before nacl.sign.detached — mirrors NEAR wallet signing convention"

key-files:
  created:
    - src/__tests__/wallet.test.ts
  modified: []

key-decisions:
  - "session.test.ts adversarial coverage was already complete — tampered, truncated, and extended cookie cases all verified green without modification"
  - "Adversarial unrelated-key case tested by: creating valid sig with keypair A, mocking RPC to return UNKNOWN_ACCESS_KEY error, asserting checkWalletAccess returns false"
  - "buildValidWalletSignature helper generates real keypairs and real detached signatures to avoid any mocking of the crypto layer"

patterns-established:
  - "Crypto tests: use real nacl keypairs — never mock the signing or verification primitives themselves"
  - "RPC-dependent functions: mock fetch at the global level, restore in afterEach"

requirements-completed: [TEST-05, TEST-01]

# Metrics
duration: 7min
completed: 2026-03-14
---

# Phase 07 Plan 02: Wallet Recovery Unit Tests and Session Adversarial Coverage

**15 wallet recovery tests using real ed25519 keypairs (tweetnacl) covering verifyWalletSignature, checkWalletAccess, and the adversarial unrelated-key case; session.test.ts adversarial coverage confirmed complete with no changes needed**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-14T22:53:27Z
- **Completed:** 2026-03-14T23:00:XX Z
- **Tasks:** 2
- **Files modified:** 1 (created)

## Accomplishments

- Created src/__tests__/wallet.test.ts with 15 tests covering all required behaviors
- Real ed25519 signatures generated with tweetnacl — no mocking of crypto primitives
- Adversarial "unrelated key on account" case: valid sig + mocked RPC error = verified: false
- Confirmed session.test.ts already covers all 3 adversarial cookie cases (tampered, truncated, extended)
- Full test suite: 158 passing, 14 todos (pre-existing), 0 failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Wallet recovery unit tests (TEST-05)** - `6ee92d3` (test)
2. **Task 2: Verify session adversarial test coverage (TEST-01)** - no code changes; session.test.ts already complete

**Plan metadata:** (final docs commit, see below)

## Files Created/Modified

- `src/__tests__/wallet.test.ts` - 15 wallet recovery unit tests with real ed25519 signatures

## Decisions Made

- session.test.ts was substantially complete per research — all adversarial cases already tested. No modifications made.
- buildValidWalletSignature helper creates real keypairs and real nacl.sign.detached signatures to ensure the crypto layer is actually tested, not mocked.
- Adversarial unrelated-key case is tested at the checkWalletAccess level: valid cryptographic signature from keypair A + mocked RPC returning UNKNOWN_ACCESS_KEY → verified: false.

## Deviations from Plan

None — plan executed exactly as written. Task 2 confirmed zero gaps in session.test.ts coverage.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- TEST-05 (wallet recovery tests) complete with 11+ test cases
- TEST-01 (session adversarial) complete and verified
- Full test suite clean (158 passing, 0 failures)
- Phase 07 plan 02 complete; remaining plans in phase 07 can build on this coverage

---
*Phase: 07-test-coverage*
*Completed: 2026-03-14*
