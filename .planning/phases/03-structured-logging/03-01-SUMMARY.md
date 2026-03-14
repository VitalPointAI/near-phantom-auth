---
phase: 03-structured-logging
plan: 01
subsystem: infra
tags: [pino, logging, typescript, vitest]

# Dependency graph
requires:
  - phase: 02-input-validation
    provides: All server infrastructure and route handlers that need logging threaded through them

provides:
  - pino installed as production dependency (v10.3.1), externalized in tsup
  - AnonAuthConfig.logger field for consumer-provided pino.Logger injection
  - logger field in all 8 internal config interfaces (SessionConfig, PasskeyConfig, MPCConfig, RouterConfig, OAuthRouterConfig, WalletRecoveryConfig, IPFSRecoveryConfig, middleware parameters)
  - createAnonAuth creates pino({ level: 'silent' }) default and threads logger to all managers/routers
  - Each manager/router creates child logger with module binding (session, passkey, mpc, middleware, router, oauth, wallet-recovery, ipfs-recovery)
  - logging.test.ts scaffold with 3 passing concrete tests and 6 todo stubs

affects: [03-02-console-replacement, all server managers that will use log.* in Plan 02]

# Tech tracking
tech-stack:
  added: [pino@10.3.1]
  patterns:
    - No-op silent logger pattern — pino({ level: 'silent' }) as default so consumers who omit logger see zero output
    - Child logger threading — each manager creates child({ module: 'name' }) from injected logger for structured context
    - External library pattern — pino added to tsup external array so it is not bundled into the library output

key-files:
  created:
    - src/__tests__/logging.test.ts
    - .planning/phases/03-structured-logging/deferred-items.md
  modified:
    - package.json (pino dependency added)
    - package-lock.json
    - tsup.config.ts (pino externalized)
    - src/types/index.ts (logger field on AnonAuthConfig, pino type import)
    - src/server/index.ts (pino import, default logger creation, threading to all managers)
    - src/server/session.ts (pino import, logger field on SessionConfig, child logger in factory)
    - src/server/passkey.ts (pino import, logger field on PasskeyConfig, child logger in factory)
    - src/server/mpc.ts (pino import, logger field on MPCConfig, log private field in class)
    - src/server/middleware.ts (pino import, logger param on createAuthMiddleware/createRequireAuth)
    - src/server/router.ts (pino import, logger field on RouterConfig, child logger in factory)
    - src/server/oauth/router.ts (pino import, logger field on OAuthRouterConfig, child logger in factory)
    - src/server/recovery/wallet.ts (pino import, logger field on WalletRecoveryConfig, child logger in factory)
    - src/server/recovery/ipfs.ts (pino import, logger field on IPFSRecoveryConfig, child logger in factory)

key-decisions:
  - "pino externalized in tsup.config.ts — library consumers provide their own pino instance; not bundled to avoid version conflicts"
  - "No-op default is pino({ level: 'silent' }) — consumers who do not pass a logger see zero output, no console pollution"
  - "Child loggers with module binding created in each factory — Plan 02 can use log.* directly without any plumbing changes"
  - "Pre-existing TypeScript errors in session.test.ts and router.ts are out of scope — logged to deferred-items.md, not fixed here"

patterns-established:
  - "Logger threading pattern: AnonAuthConfig.logger flows through createAnonAuth to every factory as config.logger"
  - "Silent default pattern: (config.logger ?? pino({ level: 'silent' })).child({ module: 'name' }) in every factory"
  - "Type-only import for pino types in interfaces: import type { Logger } from 'pino'; runtime import pino from 'pino' only where fallback is created"

requirements-completed: [INFRA-01, SEC-06]

# Metrics
duration: 6min
completed: 2026-03-14
---

# Phase 03 Plan 01: Structured Logging Infrastructure Summary

**pino v10.3.1 installed and threaded through all 8 server managers via no-op silent default, enabling Plan 02 to replace console.* calls without any plumbing work**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-14T15:07:09Z
- **Completed:** 2026-03-14T15:13:35Z
- **Tasks:** 2
- **Files modified:** 13 (plus 2 created)

## Accomplishments
- pino installed as production dependency and externalized in tsup so library consumers control the version
- All 9 config interfaces (AnonAuthConfig plus 8 internal ones) have `logger?: pino.Logger` field
- createAnonAuth creates `pino({ level: 'silent' })` default and passes it to all managers/routers
- Each factory creates a child logger with `{ module: 'name' }` binding, ready for Plan 02 to use
- logging.test.ts scaffold: 3 passing concrete tests verify no-op suppression, child inheritance, and injectable logger; 6 todo stubs for Plan 02 to implement

## Task Commits

Each task was committed atomically:

1. **Task 1: Install pino, add logger to all config interfaces, create no-op default and thread through createAnonAuth** - `8ddb8d9` (feat)
2. **Task 2: Create logging test scaffold** - `b65e645` (test)

## Files Created/Modified
- `package.json` — pino ^10.3.1 added to dependencies
- `tsup.config.ts` — pino added to external array
- `src/types/index.ts` — import type pino; logger field on AnonAuthConfig
- `src/server/index.ts` — pino runtime import; logger creation and threading
- `src/server/session.ts` — pino import; logger on SessionConfig; child log in factory
- `src/server/passkey.ts` — pino import; logger on PasskeyConfig; child log in factory
- `src/server/mpc.ts` — pino import; logger on MPCConfig; log private field in MPCAccountManager
- `src/server/middleware.ts` — pino import; logger param on both middleware factories
- `src/server/router.ts` — pino import; logger on RouterConfig; child log in factory
- `src/server/oauth/router.ts` — pino import; logger on OAuthRouterConfig; child log in factory
- `src/server/recovery/wallet.ts` — pino import; logger on WalletRecoveryConfig; child log in factory
- `src/server/recovery/ipfs.ts` — pino import; logger on IPFSRecoveryConfig; child log in factory
- `src/__tests__/logging.test.ts` — 3 concrete tests + 6 todo stubs (created)
- `.planning/phases/03-structured-logging/deferred-items.md` — out-of-scope pre-existing errors (created)

## Decisions Made
- pino externalized in tsup: library consumers provide their own instance, avoiding version conflicts and bundle bloat
- No-op default is `pino({ level: 'silent' })`: consumers who omit logger see zero output
- Child loggers in each factory: Plan 02 can use `log.*` calls directly without any additional wiring
- Pre-existing TypeScript errors (session.test.ts missing vitest globals, router.ts WalletSignature mismatch) logged to deferred-items.md as out of scope

## Deviations from Plan

None — plan executed exactly as written. The pre-existing TypeScript errors were discovered but correctly identified as out of scope (existed before Phase 03 work began) and deferred.

## Issues Encountered
- Pre-existing TypeScript errors prevent `npx tsc --noEmit && echo "TYPECHECK OK"` from returning clean exit. Verified these errors existed on the baseline commit (git stash confirmed). All new code compiles without errors. Logged to `deferred-items.md`.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Logging infrastructure complete; Plan 02 can replace all console.* calls with `log.*` calls
- All managers have `log` variables (or fields) ready to use in Plan 02
- 6 todo stubs in logging.test.ts define the verification targets for Plan 02

---
*Phase: 03-structured-logging*
*Completed: 2026-03-14*
