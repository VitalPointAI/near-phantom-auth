---
phase: 15-lazy-backfill-hook
plan: 03
subsystem: tests
tags: [hooks, lazy-backfill, integration-tests, redaction]
completed: 2026-04-30
---

# Phase 15 Plan 03 Summary

Replaced the Wave-0 backfill test stubs with real assertions.

## Outcome

- `src/__tests__/backfill-login.test.ts` now covers:
  - gated fire only when `sealingKeyHex` is present
  - ctx shape and payload echo
  - all 4 `BackfillReason` values
  - contained sync throw / rejected promise behavior
  - Phase 14 + Phase 15 hook co-existence
  - hooks `{}` / hooks omitted back-compat
- `src/__tests__/backfill-redaction.test.ts` now acts as the Phase 15 change detector:
  - zero `sealingKeyHex` substring leakage in captured logs
  - no `userId` / `codename` / `nearAccountId` leakage
  - WARN-level log envelope matches `redactErrorMessage()`
  - exact log message string locked to `backfill hook threw`

## Verification

- `npm run typecheck` passed.
- `backfill-login`, `backfill-redaction`, `second-factor-login`, `analytics-lifecycle`, and `registration-auth` all passed under Node 20 when rerun outside the sandbox.

## Notes

- The sandbox blocks `supertest` listener binding with `listen EPERM`; verification was rerun unrestricted to get a real result.
