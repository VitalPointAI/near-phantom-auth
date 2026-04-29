---
phase: 11-backup-eligibility-flags-hooks-scaffolding
plan: 01
subsystem: auth
tags: [webauthn, backup-eligibility, passkey, typescript, vitest, tdd]

# Dependency graph
requires: []
provides:
  - "src/server/backup.ts: deriveBackupEligibility(deviceType) pure helper — single source of truth for BACKUP-05"
  - "src/__tests__/backup.test.ts: 3 vitest unit tests covering all branches + type-smoke"
  - "src/types/index.ts: RegistrationFinishResponse and AuthenticationFinishResponse extended with passkey?: { backedUp: boolean; backupEligible: boolean }"
affects:
  - "11-03 (webauthn.ts verifyRegistration): import { deriveBackupEligibility } from './backup.js'"
  - "11-04 (router.ts register finish): import { deriveBackupEligibility } from './backup.js'"
  - "11-05 (router.ts login finish): import { deriveBackupEligibility } from './backup.js'"
  - "11-02 (useAnonAuth.tsx): consumes RegistrationFinishResponse.passkey and AuthenticationFinishResponse.passkey via type cascade"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-source-of-truth pure helper: zero imports, pure function, mirrors src/server/codename.ts shape"
    - "Additive optional response field: passkey? appended last, no reorder, no replace"
    - "TDD RED/GREEN: test file committed before implementation"

key-files:
  created:
    - src/server/backup.ts
    - src/__tests__/backup.test.ts
  modified:
    - src/types/index.ts

key-decisions:
  - "deriveBackupEligibility takes the narrowest possible signature (literal union) to reject caller shape drift at tsc time"
  - "passkey field is optional (?) on both finish-response interfaces so degraded-path responses omitting the field remain valid"
  - "AuthenticationFinishResponse does NOT add nearAccountId (D-LOGIN-NEARACCOUNTID decision preserved — minimal blast radius)"

patterns-established:
  - "Pattern: pure helper file in src/server/ with zero imports, JSDoc encoding the lifecycle invariant, paired __tests__/<name>.test.ts"
  - "Pattern: additive optional nested response key — append last, never reorder existing fields"

requirements-completed: [BACKUP-05]

# Metrics
duration: 2min
completed: 2026-04-29
---

# Phase 11 Plan 01: backup-eligibility-flags-hooks-scaffolding Summary

**`deriveBackupEligibility(deviceType)` pure helper (BACKUP-05) + response-type extensions for `passkey?: { backedUp, backupEligible }` on both finish-response interfaces — Wave 1 foundation contract for Wave 2/3 plans**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-29T16:29:37Z
- **Completed:** 2026-04-29T16:31:42Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `src/server/backup.ts`: zero-import pure function `deriveBackupEligibility('multiDevice') => true`, `deriveBackupEligibility('singleDevice') => false`, with full BE/BS lifecycle JSDoc encoding the `BE === false implies BS === false` invariant
- Created `src/__tests__/backup.test.ts`: 3 vitest tests (multiDevice branch, singleDevice branch, type-smoke for union exhaustiveness) — all pass
- Extended `RegistrationFinishResponse` and `AuthenticationFinishResponse` in `src/types/index.ts` with additive `passkey?: { backedUp: boolean; backupEligible: boolean }` — `npm run typecheck` green

## Task Commits

Each task was committed atomically (TDD task has three commits):

1. **Task 1 (RED): Add failing tests for deriveBackupEligibility** - `24f07cc` (test)
2. **Task 1 (GREEN): Implement deriveBackupEligibility helper** - `f3d6a36` (feat)
3. **Task 2: Extend finish-response interfaces with passkey field** - `e4e1abc` (feat)

## Files Created/Modified

- `src/server/backup.ts` (33 lines, new) — Pure helper: `deriveBackupEligibility(deviceType: 'singleDevice' | 'multiDevice'): boolean`. JSDoc encodes BE (bit 3, immutable, capability) vs BS (bit 4, may flip, state) lifecycle invariant. Zero imports.
- `src/__tests__/backup.test.ts` (19 lines, new) — 3 vitest tests: multiDevice->true, singleDevice->false, type-smoke confirming both return `boolean`
- `src/types/index.ts` (+6 lines) — Additive `passkey?: { backedUp: boolean; backupEligible: boolean }` appended to `RegistrationFinishResponse` (BACKUP-01 JSDoc) and `AuthenticationFinishResponse` (BACKUP-02 JSDoc). Existing fields preserved verbatim.

## Helper Signature and JSDoc Strategy

```typescript
export function deriveBackupEligibility(
  deviceType: 'singleDevice' | 'multiDevice'
): boolean {
  return deviceType === 'multiDevice';
}
```

The JSDoc block distinguishes:
- **BE (Backup Eligibility)**: bit 3, set once at credential creation, immutable for credential lifetime, encoded by `@simplewebauthn/server` as `credentialDeviceType === 'multiDevice'`
- **BS (Backup State)**: bit 4, may flip 0→1 over credential lifetime, re-read on every assertion, encoded as `credentialBackedUp` (boolean)
- **Invariant**: `BE === false implies BS === false` — a singleDevice credential cannot be backed up

## Type-Extension Strategy

Additive, optional, no field reorder per Pattern S4:
1. Both response interfaces append `passkey?` as the last field
2. `?` modifier preserves forward-compat for degraded-path responses omitting the flags
3. `AuthenticationFinishResponse` does NOT gain `nearAccountId` (D-LOGIN-NEARACCOUNTID decision)
4. JSDoc on each field cites the BACKUP-01 / BACKUP-02 requirement IDs

## Verification Commands Run

```
npm test -- --run src/__tests__/backup.test.ts   # exit 0, 3 tests passed
npm run typecheck                                  # exit 0, 0 errors
grep -c "deriveBackupEligibility" src/server/router.ts src/server/webauthn.ts  # both 0
```

## Wave 2 Unblocking Note

Plans 11-03, 11-04, and 11-05 may now:

```typescript
import { deriveBackupEligibility } from './backup.js';
```

The `passkey?: { backedUp: boolean; backupEligible: boolean }` type on `RegistrationFinishResponse` / `AuthenticationFinishResponse` propagates automatically to `src/client/api.ts` via the existing import chain (no `api.ts` change needed).

## Decisions Made

- `deriveBackupEligibility` takes the narrowest possible signature (literal union, not `string`) to reject caller shape drift at compile time (T-11-01-04 mitigated)
- `passkey` field is `optional` (`?`) on both finish-response interfaces so degraded-path callers that omit it remain type-valid (T-11-01-03 accepted per plan)
- `AuthenticationFinishResponse` preserves the existing `{ success, codename }` shape — no silent `nearAccountId` addition (D-LOGIN-NEARACCOUNTID decision preserved)

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Wave 2 can proceed: `src/server/backup.ts` exports `deriveBackupEligibility`, contract is stable
- Wave 2 response-type contract is in place: `RegistrationFinishResponse.passkey?` and `AuthenticationFinishResponse.passkey?` exist
- Plan 11-02 (`AnonAuthHooks` scaffolding) and plans 11-03/04/05 (router/webauthn wiring) are unblocked

---
*Phase: 11-backup-eligibility-flags-hooks-scaffolding*
*Completed: 2026-04-29*

## Self-Check: PASSED
