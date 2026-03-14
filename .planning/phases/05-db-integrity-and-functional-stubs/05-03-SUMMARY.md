---
phase: 05-db-integrity-and-functional-stubs
plan: 03
subsystem: auth
tags: [near, express, webauthn, passkey, database, transaction, recovery, wallet]

# Dependency graph
requires:
  - phase: 05-01
    provides: transaction/deleteUser/deleteRecoveryData optional methods on DatabaseAdapter
  - phase: 05-02
    provides: postgres adapter implementing transaction, deleteUser, deleteRecoveryData
provides:
  - Transaction-wrapped /register/finish that atomically creates user+passkey+session
  - BUG-04 fix: wallet/verify stores signature.publicKey (not 'enabled') in anon_recovery.reference
  - POST /account/reregister-passkey for post-recovery passkey registration
  - DELETE /account with correct deletion order (sessions -> recovery -> user -> passkey cascade)
affects: phase-06-email-recovery, any phase adding new account management routes

# Tech tracking
tech-stack:
  added: []
  patterns:
    - db.transaction?.(fn) fallback pattern for optional transaction wrapping
    - Ordered deletion without FK cascades: sessions first, recovery second, user last (passkeys cascade)
    - 501 Not Implemented for optional adapter methods that are missing

key-files:
  created: []
  modified:
    - src/server/router.ts
    - src/server/validation/schemas.ts
    - src/__tests__/validation.test.ts

key-decisions:
  - "signature in walletVerifyBodySchema and walletFinishBodySchema is a WalletSignature object (not a string) — schema was wrong before; fixed to match WalletSignature interface"
  - "sessionManager.createSession inside doRegistration transaction callback writes cookie to response buffer before transaction commits; harmless if rollback since response will be 500 error and session row won't exist"
  - "DELETE /account: destroySession before deleteUserSessions — invalidates auth cookie immediately before any data deletion begins"
  - "DELETE /account returns 501 if db.deleteUser not implemented — consistent with project optional-with-fallback pattern"

patterns-established:
  - "Optional DB method conditional wrap: db.transaction ? await db.transaction(fn) : await fn(db)"
  - "Account deletion order: destroySession -> deleteUserSessions -> deleteRecoveryData? -> deleteUser (passkeys cascade)"

requirements-completed: [INFRA-02, BUG-04, STUB-02, STUB-03]

# Metrics
duration: 15min
completed: 2026-03-14
---

# Phase 05 Plan 03: DB Integrity and Functional Stubs Summary

**Transaction-wrapped registration with atomic user/passkey/session creation, BUG-04 wallet public key fix, and POST /account/reregister-passkey + DELETE /account routes**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-14T18:28:00Z
- **Completed:** 2026-03-14T18:43:37Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- INFRA-02: /register/finish DB operations wrapped in db.transaction() when adapter supports it; sequential fallback maintains backward compatibility for adapters without transaction support
- BUG-04: wallet/verify route now passes signature.publicKey to addRecoveryWallet and stores it in anon_recovery.reference instead of the string literal 'enabled', enabling verifyRecoveryWallet chain to function correctly
- STUB-02: POST /account/reregister-passkey added — authenticated users can restart passkey registration after wallet/IPFS recovery, returns challengeId+options
- STUB-03: DELETE /account added — destroys session, deletes all user sessions/recovery/user data in cascade-safe order, returns 501 if adapter lacks deleteUser

## Task Commits

Each task was committed atomically:

1. **Task 1: Transaction wrap registration + fix wallet/verify public key** - `2ba466b` (feat)
2. **Task 2: Add passkey re-registration and account deletion routes** - `ed4d3a1` (feat)

## Files Created/Modified

- `src/server/router.ts` - Transaction-wrapped /register/finish, BUG-04 wallet/verify fix, two new account management routes
- `src/server/validation/schemas.ts` - walletVerifyBodySchema and walletFinishBodySchema signature field changed from z.string() to WalletSignature object schema
- `src/__tests__/validation.test.ts` - Updated test fixtures for walletVerify and walletFinish schemas to use correct WalletSignature object shape

## Decisions Made

- WalletSignature schema fix: the existing schemas.ts declared `signature: z.string()` but `WalletRecoveryManager.verifyLinkSignature` expects a `WalletSignature` object with `{ signature, publicKey, message }`. TypeScript already reported TS2345 on both wallet routes. Schema updated to match the actual interface; test fixtures updated accordingly.
- Transaction callback includes `sessionManager.createSession` which writes a cookie to the response buffer. On rollback the cookie is buffered but the 500 error response is sent — cookie is harmless since session row won't exist in DB.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed walletVerifyBodySchema and walletFinishBodySchema signature type**
- **Found during:** Task 1 (pre-flight TypeScript check)
- **Issue:** Both schemas declared `signature: z.string().min(1)` but `verifyLinkSignature` and `verifyRecoverySignature` both accept `WalletSignature` (an object with `signature`, `publicKey`, `message`). TypeScript reported TS2345 on lines 421 and 489 of router.ts.
- **Fix:** Changed both schemas to `z.object({ signature: z.string(), publicKey: z.string(), message: z.string() })`. Updated validation.test.ts test fixtures to use correct object shape.
- **Files modified:** src/server/validation/schemas.ts, src/__tests__/validation.test.ts
- **Verification:** `npx tsc --noEmit` passes, `npx vitest run` 92/92 pass
- **Committed in:** 2ba466b (Task 1) and ed4d3a1 (Task 2)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in schema type)
**Impact on plan:** The schema fix was pre-existing and necessary for the BUG-04 fix to compile. No scope creep.

## Issues Encountered

- Pre-existing session.test.ts TypeScript errors (Cannot find name 'expect') were present before this plan and are out of scope. They do not affect runtime; vitest runs without issue.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 05 complete: all four requirements (INFRA-02, BUG-04, STUB-02, STUB-03) delivered
- Phase 06 (Email Recovery) can now rely on deleteUser and deleteRecoveryData optional adapter methods being callable via the established optional-with-501 pattern
- The verifyRecoveryWallet chain is now unblocked: anon_recovery.reference stores the actual public key

---
*Phase: 05-db-integrity-and-functional-stubs*
*Completed: 2026-03-14*
