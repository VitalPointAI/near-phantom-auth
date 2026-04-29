---
phase: 11-backup-eligibility-flags-hooks-scaffolding
plan: "06"
subsystem: auth
tags: [webauthn, passkey, backup-eligibility, react-hook, typescript]

# Dependency graph
requires:
  - phase: 11-01
    provides: "RegistrationFinishResponse.passkey? and AuthenticationFinishResponse.passkey? type extensions"
  - phase: 11-04
    provides: "/register/finish response wired with passkey: { backedUp, backupEligible }"
  - phase: 11-05
    provides: "/login/finish response wired with passkey: { backedUp, backupEligible }"
provides:
  - "src/client/hooks/useAnonAuth.tsx: AnonAuthState exposes passkeyBackedUp and passkeyBackupEligible; populated from register/login finish responses"
affects:
  - "React consumers reading state.passkeyBackedUp / state.passkeyBackupEligible after register() or login()"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern S4 additive interface extension — new fields appended adjacent to credentialCloudSynced, no reorder"
    - "Pattern 7 type-cascade — RegistrationFinishResponse/AuthenticationFinishResponse extended in 11-01 propagate through src/client/api.ts imports with no api.ts change"
    - "Nullish coalescing ?? null — result.passkey?.backedUp ?? null guards degraded-path responses omitting passkey key (T-11-06-03 mitigation)"
    - "Pitfall 7 JSDoc — each field has explicit BE vs BS lifecycle comment to prevent caller confusion"

key-files:
  created: []
  modified:
    - src/client/hooks/useAnonAuth.tsx

key-decisions:
  - "Populate passkeyBackedUp / passkeyBackupEligible from result.passkey (finish response), NOT from a /session round-trip — finish response carries the FRESH BE/BS values plumbed in 11-04/11-05"
  - "Both fields initialized to null in initial state (not false) — null means 'not yet known'; false could incorrectly imply the credential is not backed up"
  - "Nullish coalescing ?? null ensures the AnonAuthState contract (boolean | null) is preserved even when passkey key is absent from a degraded-path response"

requirements-completed: [BACKUP-04]

# Metrics
duration: "2min"
completed: 2026-04-29
---

# Phase 11 Plan 06: AnonAuthState passkeyBackedUp + passkeyBackupEligible Summary

**BACKUP-04 landed: `AnonAuthState` exposes `passkeyBackedUp: boolean | null` and `passkeyBackupEligible: boolean | null`, populated from `result.passkey` after `register()` and `login()` resolve — no extra round-trip required**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-29T20:34:55Z
- **Completed:** 2026-04-29T20:36:48Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Extended `AnonAuthState` interface with two new `boolean | null` fields (`passkeyBackedUp`, `passkeyBackupEligible`) adjacent to the existing `credentialCloudSynced` field — additive, no existing field reordered
- JSDoc on each field encodes the BE/BS lifecycle contract verbatim per Pitfall 7: `passkeyBackedUp` carries the BS bit (may FLIP 0→1), `passkeyBackupEligible` carries the BE bit (immutable for credential lifetime)
- Initial `useState<AnonAuthState>` value extended with both fields set to `null` (not-yet-known)
- `register()` success setState: `result.passkey?.backedUp ?? null` and `result.passkey?.backupEligible ?? null`
- `login()` success setState: same population from the finish response (not from `/session`)
- Typecheck green; full suite green (299 passed, 4 skipped)

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend AnonAuthState; populate in register/login | `580aeb8` | `src/client/hooks/useAnonAuth.tsx` |

## Files Created/Modified

- `src/client/hooks/useAnonAuth.tsx` (+12 lines) — Three coordinated additive changes:
  1. Interface: `passkeyBackedUp: boolean | null` + `passkeyBackupEligible: boolean | null` with BE/BS JSDoc
  2. Initial state: both fields as `null`
  3. `register()` and `login()` setState: both fields populated via `result.passkey?.backedUp ?? null` / `result.passkey?.backupEligible ?? null`

## Pattern S4 / Pattern 7 Propagation Strategy

**Pattern S4 (additive, no reorder):** New fields appended immediately after `credentialCloudSynced` in the interface — existing field order preserved byte-identical to v0.6.1.

**Pattern 7 (type-cascade):** No change to `src/client/api.ts` required. The file already imports `RegistrationFinishResponse` and `AuthenticationFinishResponse` from `../types/index.js` (which were extended in 11-01 with `passkey?: { backedUp: boolean; backupEligible: boolean }`). The `result.passkey?.backedUp` reference in the hook resolves to `boolean | undefined` via the type cascade; the `?? null` produces `boolean | null` matching the new state field types — all type-safe with no manual propagation.

## Pitfall 7 JSDoc Strategy (BE vs BS Confusion)

Each new field carries explicit lifecycle documentation:

```typescript
/** Whether the most recent passkey was backed up (BS bit) — re-read on every login,
 *  may FLIP 0→1 over the credential's lifetime. null until register() or login() resolves. */
passkeyBackedUp: boolean | null;

/** Whether the most recent passkey is backup-eligible (BE bit) — set ONCE at registration,
 *  immutable for the credential's lifetime. null until register() or login() resolves. */
passkeyBackupEligible: boolean | null;
```

A consumer reading the JSDoc at their call site can immediately distinguish BE (capability, registered once) from BS (state, may change) without consulting external documentation. This directly mitigates T-11-06-02 (BE/BS confusion misconfiguration risk).

## Acceptance Criteria Verification

| Criterion | Check | Result |
|-----------|-------|--------|
| `passkeyBackedUp: boolean \| null` in interface | `grep -c "passkeyBackedUp: boolean \| null"` | 1 |
| `passkeyBackupEligible: boolean \| null` in interface | `grep -c "passkeyBackupEligible: boolean \| null"` | 1 |
| BS bit JSDoc | `grep -c "BS bit"` | 1 |
| BE bit JSDoc | `grep -c "BE bit"` | 1 |
| FLIP semantics | `grep -c "FLIP"` | 1 |
| immutable semantics | `grep -c "immutable"` | 2 |
| initial state `passkeyBackedUp: null` | `grep -c "passkeyBackedUp: null"` | 1 |
| initial state `passkeyBackupEligible: null` | `grep -c "passkeyBackupEligible: null"` | 1 |
| register()/login() populate backedUp (2 sites) | `grep -c "result.passkey?.backedUp ?? null"` | 2 |
| register()/login() populate backupEligible (2 sites) | `grep -c "result.passkey?.backupEligible ?? null"` | 2 |

## Verification Commands Run

| Command | Exit Code |
|---------|-----------|
| `npm run typecheck` | 0 |
| `npm test -- --run` (full suite, 2nd run) | 0 (299 passed, 4 skipped) |

Note: First full-suite run had a pre-existing flaky timeout in `ipfs.test.ts` due to resource contention under parallel execution (the test passes consistently when run in isolation and on second full-suite run). This is out-of-scope and pre-existing.

## Phase 11 Closure

All 6 Phase 11 requirements are now landed:

| Plan | Requirement | Status |
|------|-------------|--------|
| 11-01 | BACKUP-05 (`deriveBackupEligibility` helper + response type extensions) | Complete |
| 11-02 | HOOK-01 (AnonAuthHooks interface + thread through createAnonAuth) | Complete |
| 11-03 | BACKUP-03 (verifyRegistration backupEligible field) | Complete |
| 11-04 | BACKUP-01 (/register/finish passkey response) | Complete |
| 11-05 | BACKUP-02 (/login/finish BS-bit-flip passkey response) | Complete |
| 11-06 | BACKUP-04 (AnonAuthState passkeyBackedUp + passkeyBackupEligible) | Complete |

Phase 11 is ready for `/gsd-verify-work 11`.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — both fields are wired to live `result.passkey` data from the finish responses. No hardcoded values or placeholder data.

## Threat Flags

None — the new fields expose only `boolean | null` values derived from `@simplewebauthn/server`-parsed credential metadata (public, non-PII). No new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED
