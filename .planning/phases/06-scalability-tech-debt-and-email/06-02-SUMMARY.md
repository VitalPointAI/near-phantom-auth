---
phase: 06-scalability-tech-debt-and-email
plan: 02
subsystem: auth
tags: [codename, types, mpc, ipfs, concurrent, tech-debt]

# Dependency graph
requires:
  - phase: 05-db-integrity-and-functional-stubs
    provides: mpc.ts with createAccount, ipfs.ts with fetchFromIPFS

provides:
  - Compound NATO codenames (WORD-WORD-NN, 66,924 unique values)
  - Backward-compatible isValidCodename accepting both legacy and new formats
  - DatabaseConfig.type without 'sqlite' (postgres | custom only)
  - mpc.ts without createTestnetAccount dead code
  - Concurrent IPFS gateway fetch via Promise.any()

affects: [06-03-PLAN, 06-04-PLAN, any consumer of DatabaseConfig or codename generation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Promise.any() for concurrent race-to-first-success fetch patterns
    - Backward-compatible regex patterns with optional segments for format expansion

key-files:
  created: []
  modified:
    - src/server/codename.ts
    - src/types/index.ts
    - src/server/mpc.ts
    - src/server/recovery/ipfs.ts

key-decisions:
  - "isValidCodename NATO pattern uses optional second word segment: /^[A-Z]+(?:-[A-Z]+)?-\\d{1,2}$/ — accepts both ALPHA-7 (legacy) and ALPHA-BRAVO-42 (new)"
  - "Promise.any() with no AbortController — consumers needing timeouts use config.customFetch per PERF-02 spec"
  - "createTestnetAccount deleted with zero call sites confirmed — testnet helper API was dead code"

patterns-established:
  - "Tech debt removal: confirm zero call sites with grep before deleting dead code"
  - "Type union narrowing: remove impossible states from union types to prevent misleading type contracts"

requirements-completed: [DEBT-01, DEBT-03, DEBT-04, PERF-02]

# Metrics
duration: 3min
completed: 2026-03-14
---

# Phase 6 Plan 02: Tech Debt Cleanup Summary

**Compound NATO codenames (WORD-WORD-NN), sqlite type removed from DatabaseConfig, createTestnetAccount dead code deleted, IPFS gateway fetch made concurrent via Promise.any()**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-14T20:19:33Z
- **Completed:** 2026-03-14T20:22:01Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- generateNatoCodename() now produces ALPHA-BRAVO-42 compound format, expanding namespace from 2,574 to 66,924 unique values
- isValidCodename() updated with backward-compatible regex that accepts both legacy ALPHA-7 and new ALPHA-BRAVO-42 formats
- DatabaseConfig.type narrowed to 'postgres' | 'custom' — 'sqlite' was never implemented and was a false type promise
- createTestnetAccount() deleted from mpc.ts after confirming zero call sites across codebase
- fetchFromIPFS() rewritten to fire all 6 IPFS gateways concurrently via Promise.any(), returning the first successful response

## Task Commits

Each task was committed atomically:

1. **Task 1: Compound codenames, remove sqlite type, remove dead testnet code** - `e8a7db5` (fix)
2. **Task 2: Concurrent IPFS gateway fetch with Promise.any()** - `972b337` (fix)

## Files Created/Modified
- `src/server/codename.ts` - generateNatoCodename() produces WORD-WORD-NN, isValidCodename() accepts both formats
- `src/types/index.ts` - DatabaseConfig.type is now 'postgres' | 'custom' (no 'sqlite')
- `src/server/mpc.ts` - Deleted createTestnetAccount() (24-line dead code function with zero call sites)
- `src/server/recovery/ipfs.ts` - fetchFromIPFS() replaced sequential for...of with concurrent Promise.any() race

## Decisions Made
- isValidCodename NATO pattern uses `(?:-[A-Z]+)?` optional segment to accept both legacy and new formats in a single regex — avoids duplicating the pattern or breaking existing stored codenames
- No AbortController or per-gateway timeout added to fetchFromIPFS — per PERF-02 spec, consumers needing timeouts use config.customFetch; Promise.any() is sufficient for the requirement
- Pre-existing TypeScript errors in session.test.ts (Cannot find name 'expect') confirmed as baseline errors that existed before any changes — out of scope per deviation rules

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript compile error (TS2304 Cannot find name 'expect' in session.test.ts) confirmed as baseline by stashing changes and re-running tsc. Not caused by this plan's changes; out of scope per deviation rules scope boundary.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Codename namespace expanded and backward-compatible — 06-03 (email phase) can proceed
- DatabaseConfig type is accurate — consumers using 'sqlite' would now get a compile error (intended breaking change per DEBT-03)
- IPFS concurrent fetch ready — recovery performance improved for all users

---
*Phase: 06-scalability-tech-debt-and-email*
*Completed: 2026-03-14*
