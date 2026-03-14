---
phase: 06-scalability-tech-debt-and-email
plan: "04"
subsystem: infra
tags: [cleanup, scheduler, setInterval, unref, DatabaseAdapter]

requires:
  - phase: 06-01
    provides: cleanExpiredSessions/cleanExpiredChallenges/cleanExpiredOAuthStates on DatabaseAdapter
  - phase: 06-03
    provides: EmailService and email.ts module already in server

provides:
  - Standalone createCleanupScheduler factory in src/server/cleanup.ts
  - CleanupScheduler interface with stop() handle
  - Re-export of createCleanupScheduler from src/server/index.ts for consumer access
  - Re-export of createEmailService, EmailService, EmailConfig from src/server/index.ts

affects:
  - consumers using the library who want automatic DB cleanup
  - phase 07 (future email/validation phases)

tech-stack:
  added: []
  patterns:
    - "Composable scheduler: standalone factory, not embedded in AnonAuthInstance"
    - "unref() on setInterval so timer never blocks process exit or test teardown"
    - "Optional chaining on optional DatabaseAdapter methods with ?? 0 fallback"
    - "Log-on-change: only emit info log when rows were actually deleted"

key-files:
  created:
    - src/server/cleanup.ts
  modified:
    - src/server/index.ts

key-decisions:
  - "createCleanupScheduler is a standalone export, not embedded in AnonAuthInstance — consumers call it after initialization (composable pattern)"
  - "handle.unref() called immediately so the timer never prevents process exit in tests or graceful shutdown"
  - "cleanExpiredChallenges and cleanExpiredOAuthStates are optional-chained with ?? 0 — custom adapters that don't implement them still work"
  - "createEmailService and EmailConfig now exported from server entry point — previously only available internally"

patterns-established:
  - "Periodic background work: standalone factory returning stop() handle, timer unref'd, only log on actual activity"

requirements-completed:
  - INFRA-04

duration: 8min
completed: 2026-03-14
---

# Phase 06 Plan 04: Cleanup Scheduler Summary

**Composable setInterval cleanup scheduler with unref'd timer, optional-chained adapter methods, and standalone stop() handle for graceful shutdown**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-14T16:21:00Z
- **Completed:** 2026-03-14T16:29:15Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- New src/server/cleanup.ts module with createCleanupScheduler factory and CleanupScheduler interface
- Timer is unref'd immediately so test suites and graceful shutdowns never hang on the scheduler
- Scheduler exported from src/server/index.ts as standalone composable function; also added previously-missing createEmailService export

## Task Commits

Each task was committed atomically:

1. **Task 1: Create cleanup scheduler module** - `658108d` (feat)
2. **Task 2: Export createCleanupScheduler from server entry point** - `113a2a8` (feat)

## Files Created/Modified

- `src/server/cleanup.ts` - CleanupScheduler interface and createCleanupScheduler factory; calls all three expired-record cleanup methods
- `src/server/index.ts` - Added re-exports for createCleanupScheduler, CleanupScheduler, createEmailService, EmailService, EmailConfig

## Decisions Made

- createCleanupScheduler is a standalone export, not embedded in AnonAuthInstance. This follows the library's composable pattern (consumers wire the pieces they need).
- handle.unref() called immediately after setInterval — prevents timer from blocking process exit in test suites or during graceful shutdown.
- cleanExpiredChallenges and cleanExpiredOAuthStates are optional-chained with ?? 0 fallback — custom DatabaseAdapter implementations that don't add these methods still work without error.
- createEmailService was previously only imported internally; added as public export alongside createCleanupScheduler since both are standalone consumer-facing factories.

## Deviations from Plan

None - plan executed exactly as written. The email export was listed as "check if Plan 03 already added this — if so, skip; if not, add here." Plan 03 had not added it, so it was added per the task instructions.

## Issues Encountered

TypeScript reported 14 pre-existing errors in src/__tests__/session.test.ts (Cannot find name 'expect') — these are pre-existing and unrelated to this plan's changes. All new files compile cleanly with zero errors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- INFRA-04 satisfied: expired sessions, challenges, and OAuth states can now be automatically cleaned by a scheduler
- Consumers can import { createCleanupScheduler } and call it after auth.initialize() with their logger and desired interval
- Phase 06 complete — all 4 plans executed

---
*Phase: 06-scalability-tech-debt-and-email*
*Completed: 2026-03-14*
