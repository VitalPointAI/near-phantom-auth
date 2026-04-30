---
phase: 15-lazy-backfill-hook
plan: 02
subsystem: auth
tags: [hooks, lazy-backfill, login-finish, containment, redaction]
completed: 2026-04-30
---

# Phase 15 Plan 02 Summary

Wired `hooks.backfillKeyBundle` into `POST /login/finish`.

## Outcome

- `src/server/router.ts` now destructures `sealingKeyHex` from the validated login body.
- `hooks.backfillKeyBundle` fires only when `sealingKeyHex` is present and the consumer configured the hook.
- The fire point is after Phase 14 `afterAuthSuccess` short-circuit handling and before `sessionManager.createSession`.
- Hook results are echoed on `AuthenticationFinishResponse.backfill`.
- Hook throws are contained with a nested try/catch, WARN-logged via `redactErrorMessage()`, and downgraded to `backfill: { backfilled: false, reason: 'skipped' }`.

## Verification

- `npm run typecheck` passed.
- Targeted auth/backfill suites passed in an unrestricted test environment after sandbox `listen EPERM` false negatives were cleared.

## Notes

- No register-side fire site was added.
- No ctx fields are logged at the fire site.
- Await semantics are intentional: the hook result must exist before `res.json()`.
