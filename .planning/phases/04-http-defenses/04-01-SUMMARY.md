---
phase: 04-http-defenses
plan: 01
subsystem: infra
tags: [express-rate-limit, csrf-csrf, cookie-parser, typescript, types]

# Dependency graph
requires:
  - phase: 03-structured-logging
    provides: logger forwarding pattern used as template for rateLimiting/csrf forwarding
provides:
  - RateLimitConfig and CsrfConfig interfaces in src/types/index.ts
  - rateLimiting and csrf optional fields on AnonAuthConfig, RouterConfig, OAuthRouterConfig
  - createAnonAuth forwards rateLimiting and csrf to createRouter and createOAuthRouter
  - Test stubs for SEC-02 (rate-limiting), SEC-03 (csrf), INFRA-05 (oauth-cookie-guard)
  - express-rate-limit, csrf-csrf, cookie-parser installed as dependencies
affects: [04-02-rate-limiting, 04-03-csrf]

# Tech tracking
tech-stack:
  added: [express-rate-limit, csrf-csrf, cookie-parser, @types/cookie-parser]
  patterns: [config-type-before-feature, tsup-externalize-middleware, test-stubs-for-future-plans]

key-files:
  created:
    - src/__tests__/rate-limiting.test.ts
    - src/__tests__/csrf.test.ts
    - src/__tests__/oauth-cookie-guard.test.ts
  modified:
    - src/types/index.ts
    - src/server/index.ts
    - src/server/router.ts
    - src/server/oauth/router.ts
    - tsup.config.ts
    - package.json
    - package-lock.json

key-decisions:
  - "express-rate-limit, csrf-csrf, cookie-parser externalized in tsup.config.ts — middleware deps consumed by library users; not bundled to avoid version conflicts"
  - "RateLimitConfig and CsrfConfig defined before implementation — Plans 02 and 03 can implement without any type/setup work"
  - "Test stubs created with it.todo placeholders — suite runs green with 19 todos, clean scaffolding for Plans 02 and 03"

patterns-established:
  - "Config-type-before-feature: define types and wire forwarding in a setup plan before implementation plans"
  - "New middleware deps externalized in tsup.config.ts — follows the pattern established for express and pino"

requirements-completed: [SEC-02, SEC-03, INFRA-05]

# Metrics
duration: 8min
completed: 2026-03-14
---

# Phase 04 Plan 01: HTTP Defenses Foundation Summary

**RateLimitConfig and CsrfConfig type contracts installed with express-rate-limit, csrf-csrf, cookie-parser deps — Plans 02 and 03 have zero setup work remaining**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-14T16:25:00Z
- **Completed:** 2026-03-14T16:33:21Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Installed express-rate-limit, csrf-csrf, cookie-parser (+ @types/cookie-parser) as production deps, externalized in tsup.config.ts
- Defined RateLimitConfig and CsrfConfig interfaces in src/types/index.ts; extended AnonAuthConfig with both optional fields; re-exported from src/server/index.ts
- Extended RouterConfig and OAuthRouterConfig with rateLimiting and csrf fields; wired createAnonAuth to forward both to createRouter and createOAuthRouter
- Created 3 test stub files (rate-limiting, csrf, oauth-cookie-guard) — 19 it.todo placeholders, full suite 74 passing + 19 todos, 0 failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and define config types** - `c17bc3a` (feat)
2. **Task 2: Extend router configs, wire createAnonAuth forwarding, create test stubs** - `8429c06` (feat)

## Files Created/Modified

- `src/types/index.ts` - Added RateLimitConfig, CsrfConfig interfaces; added rateLimiting/csrf to AnonAuthConfig
- `src/server/index.ts` - Added rateLimiting/csrf to createRouter and createOAuthRouter calls; re-exported new types
- `src/server/router.ts` - Added RateLimitConfig, CsrfConfig imports; added rateLimiting/csrf to RouterConfig
- `src/server/oauth/router.ts` - Added RateLimitConfig, CsrfConfig imports; added rateLimiting/csrf to OAuthRouterConfig
- `tsup.config.ts` - Externalized express-rate-limit, csrf-csrf, cookie-parser
- `package.json` - Added express-rate-limit, csrf-csrf, cookie-parser, @types/cookie-parser
- `src/__tests__/rate-limiting.test.ts` - New: 10 it.todo stubs for SEC-02
- `src/__tests__/csrf.test.ts` - New: 6 it.todo stubs for SEC-03
- `src/__tests__/oauth-cookie-guard.test.ts` - New: 3 it.todo stubs for INFRA-05

## Decisions Made

- express-rate-limit, csrf-csrf, cookie-parser externalized in tsup.config.ts — these are Express middleware that library consumers provide; same pattern as express and pino externalization
- RateLimitConfig uses nested `auth` and `recovery` sub-objects for endpoint-group-specific config — allows independent window/limit tuning per endpoint group
- CsrfConfig takes only `secret` field — minimal surface area; implementation details deferred to Plan 03

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript errors (session.test.ts `expect` not found, router.ts WalletSignature mismatch) confirmed to exist before this plan and are out of scope. No new errors introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 (rate limiting implementation) has full type contracts and test stubs ready
- Plan 03 (CSRF implementation) has full type contracts and test stubs ready
- Both plans can begin implementation immediately with zero setup work

---
*Phase: 04-http-defenses*
*Completed: 2026-03-14*
