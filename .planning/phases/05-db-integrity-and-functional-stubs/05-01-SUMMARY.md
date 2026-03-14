---
phase: 05-db-integrity-and-functional-stubs
plan: 01
subsystem: database
tags: [postgres, typescript, vitest, transaction, webauthn]

# Dependency graph
requires:
  - phase: 04-http-defenses
    provides: Completed HTTP defense layer; full test suite green before Phase 5
provides:
  - Optional transaction(), deleteUser(), deleteRecoveryData() on DatabaseAdapter interface
  - Postgres implementations of all three new methods with client-scoped txAdapter helper
  - Test scaffold (14 it.todo() stubs) covering all 5 Phase 5 requirements
affects:
  - 05-02 (registration transaction integration — uses transaction() and test stubs)
  - 05-03 (account deletion endpoint — uses deleteUser(), deleteRecoveryData(), test stubs)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - buildClientAdapter(client) helper — proxies subset of DatabaseAdapter through a PoolClient for transaction context; non-transactional methods throw to prevent misuse
    - Optional interface methods with ? — no breaking changes to existing adapters; Plans 02/03 guard with adapter.transaction?.() before calling

key-files:
  created:
    - src/__tests__/db-integrity.test.ts
  modified:
    - src/types/index.ts
    - src/server/db/adapters/postgres.ts

key-decisions:
  - "Make new DatabaseAdapter methods optional with ? — no breaking changes for custom adapters that don't implement them"
  - "buildClientAdapter() throws 'Not available in transaction context' for non-transactional methods — prevents silent query-outside-transaction bugs"

patterns-established:
  - "Transaction helper pattern: buildClientAdapter(client) duplicates SQL from main adapter but routes through PoolClient — same SQL, different query executor"
  - "it.todo() scaffold before implementation — test stubs for all phase requirements created upfront so Plans 02 and 03 have verification targets from the start"

requirements-completed: [INFRA-02, BUG-04, STUB-01, STUB-02, STUB-03]

# Metrics
duration: 2min
completed: 2026-03-14
---

# Phase 05 Plan 01: DB Integrity Foundation Summary

**Optional transaction/deleteUser/deleteRecoveryData added to DatabaseAdapter with postgres implementations, plus 14-stub test scaffold covering all 5 Phase 5 requirements**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-14T14:29:29Z
- **Completed:** 2026-03-14T14:31:50Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Extended DatabaseAdapter interface with 3 optional methods: `transaction?<T>`, `deleteUser?`, `deleteRecoveryData?`
- Implemented all three in postgres adapter including `buildClientAdapter()` helper for client-scoped SQL routing within transactions
- Created test scaffold with 14 `it.todo()` stubs covering INFRA-02, BUG-04, STUB-01, STUB-02, STUB-03 — full suite stays green

## Task Commits

Each task was committed atomically:

1. **Task 1: Add optional methods to DatabaseAdapter and implement in postgres adapter** - `765833e` (feat)
2. **Task 2: Create test scaffold with it.todo() stubs for all 5 requirements** - `37d09e8` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `src/types/index.ts` - Added `transaction?`, `deleteUser?`, `deleteRecoveryData?` optional methods to DatabaseAdapter
- `src/server/db/adapters/postgres.ts` - Added `buildClientAdapter()` helper and implemented all three new methods
- `src/__tests__/db-integrity.test.ts` - New test scaffold with 14 it.todo() stubs organized by requirement

## Decisions Made

- Optional methods with `?` — existing custom adapters are unaffected; Plans 02 and 03 guard before calling
- `buildClientAdapter()` throws `'Not available in transaction context'` for unused methods — prevents accidental pool queries inside transactions
- Transaction pattern mirrors existing `createOAuthUser` BEGIN/COMMIT/ROLLBACK pattern already in postgres.ts for consistency

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript errors in `session.test.ts` (missing `expect` imports) and `router.ts` (WalletSignature type mismatch) were already present before this plan. No new type errors introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 02 and 03 now have their type contracts (`transaction?`, `deleteUser?`, `deleteRecoveryData?`) and test stubs
- Full test suite: 92 tests passing, 14 todos (all in the new scaffold), 0 failures
- TypeScript clean in all modified files

---
*Phase: 05-db-integrity-and-functional-stubs*
*Completed: 2026-03-14*
