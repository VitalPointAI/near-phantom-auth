---
phase: 11-backup-eligibility-flags-hooks-scaffolding
plan: "04"
subsystem: auth
tags: [webauthn, passkey, backup-eligibility, supertest, express-router]

# Dependency graph
requires:
  - phase: 11-01
    provides: "deriveBackupEligibility helper in src/server/backup.ts and RegistrationFinishResponse.passkey type"
provides:
  - "POST /register/finish HTTP response includes additive passkey: { backedUp: boolean; backupEligible: boolean } nested key"
  - "BACKUP-01 supertest coverage: multiDevice (true/true) and singleDevice (false/false) cases"
affects:
  - 11-05
  - 11-06
  - client consumers reading /register/finish response shape

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern S4 additive append — new optional keys appended at END of res.json() literal, existing keys untouched"
    - "passkeyData from finishRegistration is the fresh source for BE/BS bits at register-finish (never stale DB row)"
    - "mockResolvedValueOnce() per-test override over beforeEach default for variant fixture cases"

key-files:
  created: []
  modified:
    - src/server/router.ts
    - src/__tests__/registration-auth.test.ts

key-decisions:
  - "passkey field appended at END of /register/finish literal per Pattern S4 (additive, no reorder)"
  - "passkeyData.backedUp and passkeyData.deviceType read from finishRegistration result, never from DB (Pitfall 1 defense)"
  - "/login/finish site left untouched — owned by 11-05"

patterns-established:
  - "Pattern S4: additive response extension — append at end, preserve field order"

requirements-completed: [BACKUP-01]

# Metrics
duration: 9min
completed: 2026-04-29
---

# Phase 11 Plan 04: Register-Finish passkey Response + BACKUP-01 Tests Summary

**Plumbs BE/BS bits from `finishRegistration` into `/register/finish` JSON response and adds two BACKUP-01 supertest cases covering multiDevice (backedUp:true, backupEligible:true) and singleDevice (backedUp:false, backupEligible:false)**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-29T19:51:39Z
- **Completed:** 2026-04-29T20:00:51Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `POST /register/finish` now returns `{ success, codename, nearAccountId, passkey: { backedUp, backupEligible } }` — consumers can show backup hint right after registration without an extra round-trip
- Pattern S4 respected: `passkey` block appended at the END of the response literal; `success`/`codename`/`nearAccountId` are byte-identical to v0.6.1
- BACKUP-01 supertest assertions cover both multiDevice and singleDevice cases using the existing mock scaffold (no new describe blocks, no new dependencies)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend /register/finish response with passkey field** - `7baa2fa` (feat)
2. **Task 2: Add BACKUP-01 supertest assertions** - `2d54932` (test)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `src/server/router.ts` — added `import { deriveBackupEligibility } from './backup.js'` (line 21) and extended the `/register/finish` `res.json()` literal with `passkey: { backedUp: passkeyData.backedUp, backupEligible: deriveBackupEligibility(passkeyData.deviceType) }` (+5 lines)
- `src/__tests__/registration-auth.test.ts` — added 2 BACKUP-01 `it()` blocks inside the existing `describe('Registration flow')` block (+59 lines, 19 → 21 tests)

## Pattern S4 Additive Append Strategy

The `passkey` key was appended at the END of the `/register/finish` response literal:

```typescript
res.json({
  success: true,          // existing — position unchanged
  codename: user.codename,     // existing — position unchanged
  nearAccountId: user.nearAccountId, // existing — position unchanged
  passkey: {              // NEW — appended last
    backedUp: passkeyData.backedUp,
    backupEligible: deriveBackupEligibility(passkeyData.deviceType),
  },
});
```

Source of truth: `passkeyData` returned fresh from `passkeyManager.finishRegistration()` — never from the DB row (Pitfall 1 from RESEARCH.md is a `/login/finish` risk; applied proactively here too per T-11-04-03).

## Test Scaffold

Both BACKUP-01 tests reuse the existing infrastructure from `registration-auth.test.ts`:
- `mockPasskeyManager.finishRegistration.mockResolvedValueOnce(...)` to override the `beforeEach` default for each variant
- `createTestApp()` factory (no changes needed)
- `validRegistrationResponse` fixture (no changes needed)
- `toMatchObject` for multiDevice (flexible), `toEqual` for singleDevice (exact shape)

## Verification Commands Run

| Command | Exit Code |
|---------|-----------|
| `npm run typecheck` | 0 |
| `npm test -- --run src/__tests__/registration-auth.test.ts` | 0 (21 tests, all green) |
| `grep -c "passkey: {" src/server/router.ts` | 1 (register only; login site owned by 11-05) |

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- BACKUP-01 complete. `/login/finish` passkey response site (BACKUP-02) is owned by plan 11-05.
- `deriveBackupEligibility` import pattern in router.ts is the template for 11-05's second call site.
- All 21 registration-auth tests green; no regressions.

---
*Phase: 11-backup-eligibility-flags-hooks-scaffolding*
*Completed: 2026-04-29*
