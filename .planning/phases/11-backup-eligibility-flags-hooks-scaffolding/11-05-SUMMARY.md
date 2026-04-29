---
phase: 11
plan: 05
subsystem: passkey-auth
tags: [backup-eligibility, bs-bit-flip, login-finish, database-adapter, tdd]
dependency_graph:
  requires: [11-01, 11-04]
  provides: [BACKUP-02]
  affects: [src/types/index.ts, src/server/passkey.ts, src/server/db/adapters/postgres.ts, src/server/router.ts, src/__tests__/registration-auth.test.ts]
tech_stack:
  added: []
  patterns:
    - optional-adapter-method with internal fallback (project constraint)
    - BS-bit-flip conditional write (no spurious writes)
    - spread-guard pattern for additive response fields
    - TDD RED/GREEN/REFACTOR with vitest + supertest
key_files:
  created: []
  modified:
    - src/types/index.ts
    - src/server/passkey.ts
    - src/server/db/adapters/postgres.ts
    - src/server/router.ts
    - src/__tests__/registration-auth.test.ts
    - src/__tests__/passkey.test.ts
decisions:
  - optional updatePasskeyBackedUp on DatabaseAdapter (project constraint: new adapter methods must be optional with internal fallback)
  - BS-bit-flip write guarded by freshBackedUp !== passkey.backedUp to avoid spurious writes
  - spread-guard ...(passkeyData && { passkey: {...} }) ensures { success, codename } on degraded path
  - D-LOGIN-NEARACCOUNTID honored: nearAccountId NOT added to /login/finish response
metrics:
  duration: "8 minutes"
  completed_date: "2026-04-29"
  tasks: 3
  files_modified: 6
---

# Phase 11 Plan 05: BACKUP-02 Login-Finish BS-Bit-Flip Summary

BACKUP-02 end-to-end: `/login/finish` now surfaces `passkey: { backedUp, backupEligible }` derived from FRESH assertion data, with conditional DB persistence via an optional adapter method.

## Files Modified

| File | Delta | Change |
|------|-------|--------|
| `src/types/index.ts` | +7 | Added optional `DatabaseAdapter.updatePasskeyBackedUp?` with JSDoc |
| `src/server/db/adapters/postgres.ts` | +7 | Implemented `updatePasskeyBackedUp` via parameterised SQL UPDATE |
| `src/server/passkey.ts` | +22 | Extended `finishAuthentication`: FRESH BS/BE extraction, conditional persist, `passkeyData` return |
| `src/server/router.ts` | +11 | `/login/finish` destructures `passkeyData`, spreads `passkey: { backedUp, backupEligible }` |
| `src/__tests__/passkey.test.ts` | +137 | 4 BACKUP-02 unit tests (passkeyData return, BS-bit-flip persist, no-spurious-write, graceful fallback) |
| `src/__tests__/registration-auth.test.ts` | +74 | 2 BACKUP-02 supertests (BS-bit-flip response, singleDevice backupEligible:false) |

## Pitfall 1 Mitigation Strategy

**Problem:** The stored DB row's `backedUp` may be stale — the BS bit can flip 0→1 over a credential's lifetime (device added to a password manager or cloud sync). Using the stored value as the response source would misreport backup state.

**Solution:** `finishAuthentication` reads `verification.authenticationInfo.credentialBackedUp` and `verification.authenticationInfo.credentialDeviceType` from the FRESH verification result, NOT from `passkey.backedUp` (the stored row). The stored row is used ONLY for change-detection (the write-skip optimization).

**Test coverage:** The BS-bit-flip supertest seeds `mockPasskeyManager.finishAuthentication` with `passkey.backedUp: false` (stale) and `passkeyData.backedUp: true` (fresh), asserts `res.body.passkey.backedUp === true`.

## Optional Adapter Method Strategy

`DatabaseAdapter.updatePasskeyBackedUp?(credentialId, backedUp): Promise<void>` is declared with `?` (optional). The implementation in `finishAuthentication` guards with:

```typescript
if (freshBackedUp !== passkey.backedUp && db.updatePasskeyBackedUp) {
  await db.updatePasskeyBackedUp(passkey.credentialId, freshBackedUp);
}
```

Two guards active:
1. Value-change guard (`freshBackedUp !== passkey.backedUp`) — no spurious writes when BS bit hasn't changed
2. Optional-method guard (`db.updatePasskeyBackedUp`) — no throw when a custom adapter omits this method

The JSDoc on the type declaration explains: "If not implemented, the BS bit re-read at login is reflected in the response body but NOT persisted; the next session start will see the stale stored value."

## D-LOGIN-NEARACCOUNTID Adherence

The `/login/finish` response shape is preserved exactly per D-LOGIN-NEARACCOUNTID:

```typescript
res.json({
  success: true,
  codename: user.codename,
  ...(passkeyData && {
    passkey: {
      backedUp: passkeyData.backedUp,
      backupEligible: deriveBackupEligibility(passkeyData.deviceType),
    },
  }),
});
```

`nearAccountId` is NOT added. The spread-guard makes `passkey` truly optional — on degraded paths that return no `passkeyData`, the response ships as `{ success, codename }` exactly matching the pre-v0.7.0 shape.

The BS-bit-flip test asserts `expect(res.body.nearAccountId).toBeUndefined()` to prevent regression.

## BACKUP-02 BS-Bit-Flip Test Design

The supertest proves FRESH value is used, not stored:

1. **Stale DB row:** `mockDb.getPasskeyById` returns `backedUp: false`
2. **Fresh assertion:** `mockPasskeyManager.finishAuthentication` returns `passkeyData: { backedUp: true, deviceType: 'multiDevice' }` (the fresh assertion-derived value)
3. **Assert response carries fresh value:** `expect(res.body.passkey).toMatchObject({ backedUp: true, backupEligible: true })`
4. **Assert anonymity invariant:** `expect(res.body.nearAccountId).toBeUndefined()`

If the implementation regressed to using the stored row, `backedUp` would be `false` and the test would fail.

## Verification Commands Run

1. `npm run typecheck` — exits 0 (DatabaseAdapter contract aligns with Postgres impl; PasskeyManager extended return matches router destructure)
2. `npm test -- --run src/__tests__/registration-auth.test.ts` — exits 0, 23 tests pass including 2 BACKUP-02 supertests
3. `npm test -- --run src/__tests__/passkey.test.ts` — exits 0, 22 tests pass including 4 BACKUP-02 unit tests
4. `npm test -- --run` — exits 0, full suite green: 299 tests pass, 4 skipped

## Deviations from Plan

None — plan executed exactly as written. TDD RED/GREEN cycle followed for Tasks 2 and 3.

## TDD Gate Compliance

Task 2 (passkey.ts):
- RED commit: `26c652e` — 4 failing BACKUP-02 tests added
- GREEN commit: `6c61be5` — implementation; all tests pass

Task 3 (router.ts):
- RED commit: `b3ee88b` — 2 failing BACKUP-02 supertests added
- GREEN commit: `b12032f` — router implementation; all tests pass

## Self-Check: PASSED

- `src/types/index.ts` — exists, contains `updatePasskeyBackedUp?`
- `src/server/db/adapters/postgres.ts` — exists, contains `async updatePasskeyBackedUp(`
- `src/server/passkey.ts` — exists, contains `passkeyData:` in finishAuthentication return
- `src/server/router.ts` — exists, contains `...(passkeyData &&`
- `src/__tests__/registration-auth.test.ts` — exists, contains 2 `BACKUP-02` markers
- Commits 97806a0, 26c652e, 6c61be5, b3ee88b, b12032f — all present in git log
