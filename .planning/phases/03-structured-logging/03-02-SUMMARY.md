---
phase: 03-structured-logging
plan: 02
subsystem: infra
tags: [pino, logging, security, structured-logging, console-removal]

# Dependency graph
requires:
  - phase: 03-01
    provides: pino child loggers wired into all 8 server factory functions via log parameter

provides:
  - Zero console.* calls in src/server/ — all replaced with pino structured log calls
  - SEC-06: no sensitive fields (treasuryPrivateKey, derivationPath, mpcPublicKey, sessionSecret) in any log call
  - Complete logging test suite: 9 tests, 0 todos, 0 failures

affects: [all phases, security-audits, observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - log.level({ fields }, 'message') — structured first arg pattern for all log calls
    - Error serialization via { err: error } — pino auto-serializes stack traces
    - Module-level silent logger for standalone exported functions (webauthn.ts, wallet.ts)
    - Logger parameter threading for module-level functions that need log access (fundAccountFromTreasury)

key-files:
  created: []
  modified:
    - src/server/mpc.ts
    - src/server/router.ts
    - src/server/passkey.ts
    - src/server/session.ts
    - src/server/middleware.ts
    - src/server/recovery/wallet.ts
    - src/server/recovery/ipfs.ts
    - src/server/oauth/router.ts
    - src/server/webauthn.ts
    - src/__tests__/logging.test.ts
    - src/__tests__/session.test.ts

key-decisions:
  - "fundAccountFromTreasury accepts log Logger parameter — module-level standalone functions needing logging receive logger from caller rather than using module-level silent fallback"
  - "webauthn.ts and wallet.ts use module-level pino({ level: 'silent' }) loggers — standalone exported functions not created via factory cannot receive injectable loggers, silent default avoids console pollution while maintaining call semantics"
  - "session.test.ts warn-once test updated to spy on injectable pino logger instead of console.warn — test correctness follows implementation: console.warn replaced by log.warn"

patterns-established:
  - "All log calls: log.level({ structuredFields }, 'Message string') — never log.level('string:', value)"
  - "All caught errors: log.error({ err: error }, 'Descriptive message') — never log.error('msg:', error)"
  - "Sensitive field exclusion: nearAccountId safe, derivationPath/treasuryPrivateKey/mpcPublicKey/sessionSecret never logged"

requirements-completed: [INFRA-01, SEC-06]

# Metrics
duration: 6min
completed: 2026-03-14
---

# Phase 03 Plan 02: Structured Logging — Console Replacement Summary

**All 40+ console.* calls replaced with pino structured log calls across 8 server files; zero sensitive fields (treasury keys, derivation paths, MPC keys, session secrets) in any log output; full 9-test logging suite passing with zero todos**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-14T15:16:04Z
- **Completed:** 2026-03-14T15:22:44Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments

- Eliminated every console.log/warn/error call from src/server/ (40+ calls across 9 files) — verified by grep returning 0
- All log calls use pino structured pattern: `log.level({ fields }, 'message')` with error objects as `{ err: error }`
- SEC-06 satisfied: treasuryPrivateKey, derivationPath, mpcPublicKey, sessionSecret verified absent from all log calls via source-scan tests
- Implemented all 6 it.todo() stubs in logging.test.ts — suite now runs 9 tests, 0 todos, 0 failures
- Full vitest suite: 74 tests passing across all 4 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace all console.* calls with pino logger across all 8 server files** - `05c1912` (feat)
2. **Task 2: Complete logging test suite — implement all todo stubs** - `4250c6d` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `src/server/mpc.ts` - 15 console calls replaced; fundAccountFromTreasury gains log parameter; derivationPath/mpcPublicKey absent from all log calls
- `src/server/router.ts` - 12 console.error calls replaced with log.error({ err: error }, 'message')
- `src/server/oauth/router.ts` - 5 console calls replaced including cid info log
- `src/server/passkey.ts` - 2 console.error calls in catch blocks replaced
- `src/server/session.ts` - 1 console.warn replaced; log.warn on warnedNoUpdateSessionExpiry path
- `src/server/middleware.ts` - 2 console.error calls replaced
- `src/server/recovery/wallet.ts` - Module-level _log silent logger added; 1 console.error replaced
- `src/server/recovery/ipfs.ts` - 1 console.log replaced with log.info({ cid, pinningService })
- `src/server/webauthn.ts` - Module-level log silent logger added (pino import added); 2 console.error calls replaced
- `src/__tests__/logging.test.ts` - All 6 todo stubs implemented; pino import added; source-scan tests for sensitive field redaction
- `src/__tests__/session.test.ts` - warn-once test updated to use injectable pino logger instead of console.warn spy; pino import added

## Decisions Made

- **fundAccountFromTreasury logger threading:** The standalone module-level function needed log access after Task 1 replaced its console calls. Added `log: Logger` as a final parameter — the class method passes `this.log`. This is preferable to a module-level silent fallback because it means the treasury funding path is observable when a logger is configured.
- **webauthn.ts/wallet.ts module-level logger:** Standalone exported functions (not factory-created) use `pino({ level: 'silent' }).child({ module: ... })` — they still re-throw errors, so consumers see exceptions regardless; the logging is supplementary.
- **session.test.ts test update:** The existing warn-once test was spying on `console.warn`, which we removed. Updated to use an injectable pino stream that captures warn-level entries. This correctly tests the `warnedNoUpdateSessionExpiry` guard behavior through the new logging path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed session.test.ts warn-once test broken by console.warn removal**
- **Found during:** Task 2 (logging test suite completion)
- **Issue:** `session.test.ts` test "logs warning once on fallback, not on every call" spied on `console.warn` — after Task 1 replaced the `console.warn` with `log.warn`, the spy captured 0 calls and the test failed
- **Fix:** Updated test to inject a pino logger with a writable stream buffer that captures warn-level entries; verifies the warn fires exactly once via the pino output rather than console.warn spy; added `import pino from 'pino'` to session.test.ts
- **Files modified:** src/__tests__/session.test.ts
- **Verification:** `npx vitest run` — 74 tests passing, 0 failures
- **Committed in:** 4250c6d (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug fix)
**Impact on plan:** Auto-fix necessary for test correctness; no scope creep. The test now correctly validates the observable behavior through the new structured logging path.

## Issues Encountered

- Pre-existing TypeScript errors in router.ts (lines 361, 429: `WalletSignature` type mismatch) and session.test.ts (missing `expect` imports) were present before this plan. Confirmed by git stash verification. These are out of scope.

## Next Phase Readiness

- Phase 03 complete: pino logger infrastructure wired (Plan 01) and all console calls replaced (Plan 02)
- INFRA-01 and SEC-06 requirements satisfied and test-verified
- Library emits zero console output by default; consumers with loggers see all structured output

---
*Phase: 03-structured-logging*
*Completed: 2026-03-14*
