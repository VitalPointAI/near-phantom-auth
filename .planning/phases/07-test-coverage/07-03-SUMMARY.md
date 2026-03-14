---
phase: 07-test-coverage
plan: 03
subsystem: testing
tags: [vitest, passkey, webauthn, mpc, supertest, express]

# Dependency graph
requires:
  - phase: 05-db-integrity-and-functional-stubs
    provides: "router.ts with INFRA-02/STUB-02/STUB-03 implementations"
  - phase: 01-test-scaffolding
    provides: "test patterns, makeMockDb helper style"
provides:
  - "passkey.test.ts: 18 tests covering full passkey lifecycle (TEST-02)"
  - "mpc.test.ts additions: addRecoveryWallet tests with fetch-level mocking (STUB-01)"
  - "db-integrity.test.ts: all 11 tests implemented replacing 14 it.todo() stubs"
affects: [phase-07-plan-04, future-coverage-reporting]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vi.mock at module level for @simplewebauthn/server with full mock return values"
    - "makeMockDb with internal Map for challenge store (simulates real DB)"
    - "vi.stubGlobal('fetch') per test for NEAR RPC mocking; vi.unstubAllGlobals() in afterEach"
    - "supertest integration tests via createTestApp factory following rate-limiting.test.ts pattern"

key-files:
  created:
    - src/__tests__/passkey.test.ts
  modified:
    - src/__tests__/mpc.test.ts
    - src/__tests__/db-integrity.test.ts

key-decisions:
  - "vi.clearAllMocks() in beforeEach + re-apply mocked values ensures isolation between tests in same describe"
  - "INFRA-02 transaction test uses txAdapter pattern: mock db.transaction calls callback with a separate adapter that has targeted mock behaviors"
  - "STUB-01 addRecoveryWallet tests appended to mpc.test.ts (not db-integrity) per plan requirement — tests real fetch-level mocking not manager stub"
  - "db-integrity.test.ts uses nacl.sign.keyPair() to generate real treasury key for BUG-04 MPCAccountManager construction"

patterns-established:
  - "Passkey test pattern: module-level vi.mock, makeMockDb with Map-backed challenge store, clearAllMocks + re-mock in beforeEach"
  - "MPC fetch mock pattern: inspect body.method to route different fetch responses (query vs broadcast_tx_commit)"
  - "Router integration test pattern: createTestApp factory wrapping createRouter + express.json(); supertest for HTTP assertions"

requirements-completed: [TEST-02, TEST-03]

# Metrics
duration: 8min
completed: 2026-03-14
---

# Phase 07 Plan 03: Test Coverage — Passkey, MPC, DB Integrity Summary

**Passkey lifecycle tests with mocked @simplewebauthn/server, addRecoveryWallet fetch-level tests asserting non-pending txHash, and all 14 db-integrity it.todo() stubs replaced with 11 real passing tests**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-14T22:50:00Z
- **Completed:** 2026-03-14T22:57:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created `passkey.test.ts` with 18 tests covering all four PasskeyManager methods including error paths
- Added addRecoveryWallet describe block to mpc.test.ts using real keypair + fetch-level mocking; txHash asserted to not match /^pending-/
- Replaced all 14 `it.todo()` stubs in db-integrity.test.ts with 11 real tests covering INFRA-02, BUG-04, STUB-02, STUB-03
- Full test suite: 171 tests passing, zero failures, zero todos in db-integrity.test.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Passkey manager unit tests (TEST-02)** - `73232a5` (test)
2. **Task 2: MPC addRecoveryWallet tests and db-integrity todo stubs (TEST-03)** - `7115220` (test)

## Files Created/Modified
- `src/__tests__/passkey.test.ts` — 18 tests for createPasskeyManager with vi.mock(@simplewebauthn/server)
- `src/__tests__/mpc.test.ts` — added STUB-01 describe block with 2 addRecoveryWallet tests
- `src/__tests__/db-integrity.test.ts` — replaced 14 it.todo() stubs with 11 real implemented tests

## Decisions Made
- `vi.clearAllMocks()` in `beforeEach` with explicit re-application of mock return values ensures test isolation within describe blocks
- The INFRA-02 transaction rollback test uses a separate `txAdapter` passed into the `db.transaction` callback mock — this correctly isolates the inner adapter behavior from the outer db mock
- addRecoveryWallet tests remain in `mpc.test.ts` (not db-integrity.test.ts) per plan specification, with nacl + bs58 generating a real ed25519 treasury key
- BUG-04 tests use `vi.stubGlobal('fetch')` to control `checkWalletAccess` RPC responses; `vi.unstubAllGlobals()` in `afterEach` prevents cross-test pollution

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None - all tests passed on first run.

## Next Phase Readiness
- All TEST-02 and TEST-03 requirements satisfied
- 171 tests passing with zero failures
- Ready for phase 07 plan 04 (final coverage verification or remaining stubs)

---
*Phase: 07-test-coverage*
*Completed: 2026-03-14*
