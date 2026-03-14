---
phase: 02-input-validation
plan: 01
subsystem: api
tags: [zod, validation, webauthn, express, typescript]

# Dependency graph
requires:
  - phase: 01-atomic-security-fixes
    provides: corrected MPC, session, and crypto foundations that these schemas protect

provides:
  - 13 named Zod 4 schemas covering all POST route bodies (registerStartBodySchema, registerFinishBodySchema, loginStartBodySchema, loginFinishBodySchema, logoutBodySchema, walletLinkBodySchema, walletVerifyBodySchema, walletStartBodySchema, walletFinishBodySchema, ipfsSetupBodySchema, ipfsRecoverBodySchema, oauthCallbackBodySchema, oauthLinkBodySchema)
  - validateBody<T> helper that returns typed data on success or sends HTTP 400 on failure
  - Unit test suite (43 tests) proving schema acceptance and rejection behavior

affects: [02-02-route-wiring, Phase 7 testing, any future route additions]

# Tech tracking
tech-stack:
  added: [zod@^4.3.6 (production dependency)]
  patterns:
    - Shared schema module at src/server/validation/schemas.ts — all schemas importable by routes and tests
    - validateBody<T>(schema, req, res) inline helper — call at top of handler before any business logic
    - z.object({}).catchall(z.unknown()) for AuthenticationExtensionsClientOutputs (workaround for Zod 4.3.6 z.record(z.unknown()) bug)
    - .passthrough() on WebAuthn credential outer and inner response objects — never .strict()
    - z.string().min(1) for all required string fields — catches empty string that truthiness guards miss

key-files:
  created:
    - src/server/validation/schemas.ts
    - src/server/validation/validateBody.ts
    - src/__tests__/validation.test.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "z.object({}).catchall(z.unknown()) replaces z.record(z.unknown()) for clientExtensionResults — Zod 4.3.6 has a bug where z.record(z.unknown()) throws TypeError when values are nested objects; catchall is semantically equivalent and works correctly"
  - "WebAuthn credential response objects use .passthrough() on both outer credential and inner response sub-object — browser vendors (Chrome extensions, password managers) add non-spec properties; .strict() would reject valid credentials from real users"

patterns-established:
  - "Pattern: validateBody at top of POST handler — call before any await; early return if null since 400 already sent"
  - "Pattern: z.string().min(1) for all required string fields — not z.string() alone which allows empty string"
  - "Pattern: schemas.ts is the single import source for schemas in both route files and test files"

requirements-completed: [SEC-05]

# Metrics
duration: 5min
completed: 2026-03-14
---

# Phase 02 Plan 01: Input Validation Infrastructure Summary

**Zod 4.3.6 schemas for all 13 POST route bodies with passthrough WebAuthn credential validation and typed validateBody helper**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-14T13:38:11Z
- **Completed:** 2026-03-14T13:42:47Z
- **Tasks:** 1 (TDD: RED commit + GREEN commit)
- **Files modified:** 5

## Accomplishments

- Installed zod@^4.3.6 as production dependency (Zod 4 stable since late 2025)
- Created `src/server/validation/schemas.ts` with 13 named schema exports covering all POST routes with bodies
- Created `src/server/validation/validateBody.ts` generic typed helper using safeParse
- Wrote 43 unit tests covering valid payload acceptance, invalid payload rejection, passthrough behavior, and validateBody helper behavior — all pass

## Task Commits

Each task was committed atomically:

1. **TDD RED: Failing validation tests** - `cd1db72` (test)
2. **TDD GREEN: schemas.ts + validateBody.ts implementation** - `f6da362` (feat)

_Note: TDD task split into two commits (test then implementation)_

## Files Created/Modified

- `src/server/validation/schemas.ts` — 13 named Zod schemas for all POST route bodies
- `src/server/validation/validateBody.ts` — generic `validateBody<T>(schema, req, res)` helper
- `src/__tests__/validation.test.ts` — 43 unit tests for schema acceptance/rejection and helper behavior
- `package.json` — zod@^4.3.6 added to production dependencies
- `package-lock.json` — updated lockfile

## Decisions Made

**z.object({}).catchall(z.unknown()) for clientExtensionResults:** Zod 4.3.6 has a bug in `z.record(z.unknown())` — when the record contains values that are nested objects (e.g., `{ credProps: { rk: true } }`), it throws `TypeError: Cannot read properties of undefined (reading '_zod')`. The `z.object({}).catchall(z.unknown())` pattern is semantically equivalent (accepts any string keys with unknown values) and works correctly. Documented in schema code comments.

**WebAuthn .passthrough() decision:** Already decided in STATE.md; executed as specified. Both outer credential object and inner `response` sub-object use `.passthrough()` so browser vendor extension properties pass through to `@simplewebauthn/server` unmolested.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] z.record(z.unknown()) replaced with z.object({}).catchall(z.unknown())**
- **Found during:** Task 1 (TDD GREEN — making tests pass)
- **Issue:** Zod 4.3.6 `z.record(z.unknown())` throws `TypeError: Cannot read properties of undefined (reading '_zod')` when parsing records whose values are nested objects (e.g., `clientExtensionResults: { credProps: { rk: true } }`). This is a Zod 4.3.6 runtime bug, not a user error.
- **Fix:** Replaced `z.record(z.unknown())` with `z.object({}).catchall(z.unknown())` for the `clientExtensionResults` field in both `registerFinishBodySchema` and `loginFinishBodySchema`. Added explanatory comment in schemas.ts.
- **Files modified:** `src/server/validation/schemas.ts`
- **Verification:** Test "accepts response with extra unknown browser extension properties (passthrough)" passes; all 43 tests green
- **Committed in:** `f6da362` (feat task commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in Zod 4.3.6 z.record with nested object values)
**Impact on plan:** Fix is semantically equivalent to the planned approach. No scope creep. clientExtensionResults is still typed as an object with arbitrary unknown keys — the API is identical from the schema consumer's perspective.

## Issues Encountered

None beyond the Zod 4.3.6 `z.record(z.unknown())` bug documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02-02 can now import all 13 schemas from `src/server/validation/schemas.ts`
- Plan 02-02 can use `validateBody` helper at the top of each POST handler
- All schemas proven correct by 43 unit tests before wiring into route handlers
- No blockers

---
*Phase: 02-input-validation*
*Completed: 2026-03-14*
