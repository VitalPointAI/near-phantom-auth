---
phase: 02-input-validation
plan: 02
subsystem: api
tags: [zod, express, validation, security, webauthn, oauth]

requires:
  - phase: 02-01
    provides: validateBody helper and all 13 Zod schemas for POST route bodies

provides:
  - All 11 POST handlers in src/server/router.ts validated with Zod schemas before business logic
  - Both POST handlers in src/server/oauth/router.ts validated with Zod schemas
  - Zero req.body direct destructuring in either router file — all replaced with typed validated body
  - All manual if (!field) presence guards removed and replaced by schema enforcement

affects: [03-session-security, 04-passkey-security, 05-mpc-signing, testing]

tech-stack:
  added: []
  patterns:
    - "validateBody-first: const body = validateBody(schema, req, res); if (!body) return; is the canonical entry pattern for all POST handlers"
    - "Auth-before-body: session authentication checks precede validateBody in routes that require auth (walletVerify, walletLink, ipfsSetup, oauthLink)"
    - "Empty-schema guard: routes with no expected body fields (registerStart, logout, walletLink, walletStart) use z.object({}) schema to reject non-object bodies"

key-files:
  created: []
  modified:
    - src/server/router.ts
    - src/server/oauth/router.ts

key-decisions:
  - "Empty-body POST routes (registerStart, logout, walletLink, walletStart) use z.object({}) schema — ensures req.body is at least a valid empty object; rejects non-object payloads"
  - "Auth-before-body ordering preserved in walletVerify, ipfsSetup, oauthLink — session check must remain first because it is authentication not input validation"
  - "walletFinish uses walletFinishBodySchema (not walletVerifyBodySchema) — different field set: nearAccountId vs walletAccountId"

patterns-established:
  - "validateBody-first: every POST handler's first action in the try block is const body = validateBody(schema, req, res); if (!body) return;"
  - "No req.body destructuring without prior validateBody — enforced across all 13 POST routes (11 in router.ts, 2 in oauth/router.ts)"

requirements-completed: [SEC-05]

duration: 7min
completed: 2026-03-14
---

# Phase 02 Plan 02: Route Validation Wiring Summary

**Zod schema validation wired into all 13 POST handlers across router.ts and oauth/router.ts, replacing all manual req.body destructuring and if (!field) guards with type-safe validated body objects**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-14T13:46:23Z
- **Completed:** 2026-03-14T13:53:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- All 11 POST handlers in router.ts now call validateBody with the correct schema before any business logic
- Both POST handlers in oauth/router.ts call validateBody; removed all manual if (!code || !state) and if (!code) guards
- Zero remaining req.body direct references in either router file; all destructuring moved to the validated body object
- Full test suite (65 tests across 3 files) passes with zero failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire validation into router.ts (11 POST handlers)** - `f038d21` (feat)
2. **Task 2: Wire validation into oauth/router.ts (2 POST handlers)** - `347c6d1` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified
- `src/server/router.ts` — 11 POST handlers converted: registerStart, registerFinish, loginStart, loginFinish, logout, walletLink, walletVerify, walletStart, walletFinish, ipfsSetup, ipfsRecover
- `src/server/oauth/router.ts` — 2 POST handlers converted: /:provider/callback, /:provider/link

## Decisions Made
- Empty-body POST routes use `z.object({})` schema to enforce that req.body is at least a valid empty object while accepting (and discarding) extra fields
- Auth-before-body ordering preserved where required: walletVerify, ipfsSetup, and oauthLink authenticate the session before validating the body; validateBody would short-circuit before the auth check if placed first
- Confirmed walletFinish uses `walletFinishBodySchema` (nearAccountId field) distinct from walletVerify using `walletVerifyBodySchema` (walletAccountId field) — correct separate schemas for different routes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None — all 13 schema imports resolved correctly, validateBody helper worked as expected, and tests confirmed all changes correct.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SEC-05 fully satisfied: every POST endpoint now rejects malformed requests with HTTP 400 before business logic executes
- Both router files are now type-safe at the boundary — validated body objects carry Zod-inferred types throughout handlers
- Phase 03 (session security) and Phase 04 (passkey security) can proceed with confidence that input boundaries are correctly guarded

## Self-Check: PASSED

All files confirmed present. All commits verified in git log.

---
*Phase: 02-input-validation*
*Completed: 2026-03-14*
