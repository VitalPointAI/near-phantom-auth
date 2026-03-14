---
phase: 01-atomic-security-fixes
plan: 02
subsystem: auth
tags: [crypto, sessions, timingSafeEqual, postgres, hmac, security]

# Dependency graph
requires:
  - phase: 01-atomic-security-fixes plan 01
    provides: DatabaseAdapter.updateSessionExpiry optional interface contract
provides:
  - Timing-safe session signature verification using crypto.timingSafeEqual
  - DB-backed session refresh via adapter.updateSessionExpiry
  - PostgreSQL updateSessionExpiry implementation
  - Passing tests for SEC-01 and BUG-03 (7 tests total)
affects: [session management consumers, any code calling refreshSession, postgres adapter users]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Per-instance warning flag (instance-scoped let vs module-level) for one-time console.warn in class factories
    - Length guard before timingSafeEqual to prevent ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH
    - Optional adapter method with graceful fallback pattern (db.updateSessionExpiry?.())

key-files:
  created: []
  modified:
    - src/server/session.ts
    - src/server/db/adapters/postgres.ts
    - src/__tests__/session.test.ts

key-decisions:
  - "warnedNoUpdateSessionExpiry flag is instance-scoped (inside createSessionManager closure) not module-level — prevents test isolation issues and is semantically correct (different manager instances are independent)"
  - "Length check before timingSafeEqual is required — timingSafeEqual throws ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH if buffers differ in length, so we return null early for mismatched-length signatures"

patterns-established:
  - "timingSafeEqual pattern: compute expected, create Buffers, length check, then compare"
  - "Optional adapter method pattern: if (db.method) { await db.method(...) } else if (!warned) { console.warn(...); warned = true }"

requirements-completed: [SEC-01, BUG-03]

# Metrics
duration: 3min
completed: 2026-03-14
---

# Phase 1 Plan 2: Timing-Safe Session Verification and DB-Backed Refresh Summary

**crypto.timingSafeEqual replaces string equality in verifySessionId, and refreshSession now persists session expiry to the database via adapter.updateSessionExpiry with PostgreSQL implementation**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-14T12:52:16Z
- **Completed:** 2026-03-14T12:54:53Z
- **Tasks:** 2 (Tasks 1 and 2 executed together via TDD flow)
- **Files modified:** 3

## Accomplishments
- SEC-01: Replaced `signature !== expectedSignature` string comparison with `crypto.timingSafeEqual` — eliminates timing oracle on session cookie verification
- SEC-01: Added buffer length guard before `timingSafeEqual` to prevent Node.js throwing `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` on mismatched-length inputs
- BUG-03: `refreshSession` now calls `db.updateSessionExpiry(session.id, newExpiresAt)` when the adapter implements it — session expiry actually persists to the database
- BUG-03: Graceful fallback when adapter lacks `updateSessionExpiry` — single console.warn logged once per manager instance, no error thrown
- Added `updateSessionExpiry` method to PostgreSQL adapter with `UPDATE anon_sessions SET expires_at = $1 WHERE id = $2`
- 7 passing tests covering all SEC-01 and BUG-03 behaviors (converted from .todo() stubs)

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add failing tests for SEC-01 and BUG-03** - `6d4d65d` (test)
2. **Task 1 (GREEN): Fix SEC-01 and BUG-03 implementation** - `7208320` (feat)

_Note: TDD tasks committed as test (RED) then feat (GREEN). Task 2 (activate test stubs) was completed as part of Task 1 TDD flow._

## Files Created/Modified
- `src/server/session.ts` - Added `timingSafeEqual` import, replaced string comparison, added instance-scoped warning flag, added `db.updateSessionExpiry` call in refreshSession
- `src/server/db/adapters/postgres.ts` - Added `updateSessionExpiry` method with UPDATE query
- `src/__tests__/session.test.ts` - Converted all .todo() stubs to real passing assertions (7 tests)

## Decisions Made
- **Instance-scoped warning flag:** `warnedNoUpdateSessionExpiry` is declared inside `createSessionManager` closure, not at module level. Module-level flag caused test isolation failures (flag set in one test polluted subsequent tests). Instance scope is also semantically correct — different manager instances are independent.
- **Length guard before timingSafeEqual:** Node.js throws if buffers differ in length. The guard `if (sigBuffer.length !== expectedBuffer.length) return null` handles truncated and extended signatures without throwing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Moved warnedNoUpdateSessionExpiry from module-level to instance scope**
- **Found during:** Task 1 GREEN phase (test run)
- **Issue:** Plan specified module-level `let warnedNoUpdateSessionExpiry = false` which caused test isolation failures — the "falls back to cookie-only" test set the flag to true before the "logs warning once" test ran, causing 0 warnings observed when 1 was expected
- **Fix:** Moved the flag inside the `createSessionManager` function closure so each manager instance has its own flag
- **Files modified:** `src/server/session.ts`
- **Verification:** All 7 tests pass including "logs warning once on fallback"
- **Committed in:** `7208320` (GREEN phase commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Instance-scoped flag is more correct behavior than module-level — different manager configurations are genuinely independent. No scope creep.

## Issues Encountered
- Plan specified module-level warning flag which failed test isolation — fixed by moving to instance scope inside factory closure

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SEC-01 and BUG-03 resolved — session verification is timing-safe and refresh is database-backed
- Plan 03 (DEBT-02, BUG-01, BUG-02, SEC-04) can proceed — test stubs for those fixes were already written in Plan 01
- PostgreSQL adapter fully implements DatabaseAdapter interface including optional updateSessionExpiry

---
*Phase: 01-atomic-security-fixes*
*Completed: 2026-03-14*

## Self-Check: PASSED

- FOUND: src/server/session.ts
- FOUND: src/server/db/adapters/postgres.ts
- FOUND: src/__tests__/session.test.ts
- FOUND: .planning/phases/01-atomic-security-fixes/01-02-SUMMARY.md
- FOUND commit: 7208320 (feat: GREEN phase)
- FOUND commit: 6d4d65d (test: RED phase)
