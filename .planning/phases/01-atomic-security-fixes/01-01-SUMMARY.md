---
phase: 01-atomic-security-fixes
plan: 01
subsystem: test-infrastructure
tags: [vitest, types, test-stubs, SEC-04, BUG-03]
dependency_graph:
  requires: []
  provides:
    - vitest test runner configured and passing
    - test stubs for SEC-01, BUG-03, DEBT-02, BUG-01, BUG-02, SEC-04
    - derivationSalt type contract on AnonAuthConfig and MPCAccountConfig
    - updateSessionExpiry optional method on DatabaseAdapter
  affects:
    - src/types/index.ts (extended)
    - Plans 02 and 03 (consume test stubs and type contracts)
tech_stack:
  added:
    - vitest@4.0.18 (test runner)
    - bn.js (yoctoNEAR arithmetic for BUG-01 tests)
    - "@types/bn.js (types for bn.js)"
  patterns:
    - it.todo() stubs — test scaffolding that passes with zero failures
    - Optional DatabaseAdapter methods — no breaking changes, internal fallback pattern
key_files:
  created:
    - vitest.config.ts
    - src/__tests__/session.test.ts
    - src/__tests__/mpc.test.ts
  modified:
    - src/types/index.ts
    - package.json
    - package-lock.json
decisions:
  - Used it.todo() instead of it.skip() — skipped files show in vitest output as skipped, todos are cleaner for scaffolding
  - Mock DatabaseAdapter in session.test.ts implements all required methods to avoid type errors despite loose tsconfig
key_decisions:
  - it.todo() used for all stubs (suite runs green, 0 failures, 16 todos)
  - Mock DatabaseAdapter in session.test.ts is fully typed against all interface methods
metrics:
  duration: "~6 minutes"
  completed: "2026-03-14"
  tasks_completed: 2
  files_created: 4
  files_modified: 3
---

# Phase 1 Plan 01: Test Infrastructure and Type Contracts Summary

Test infrastructure and Phase 1 type contracts established using vitest with todo-based test stubs and non-breaking interface additions.

## What Was Built

### vitest.config.ts

Standard vitest configuration with `globals: true` and `environment: 'node'`. Resolves the missing test runner that `package.json` referenced but never had configured.

### src/__tests__/session.test.ts

Test stubs for two groups:
- `verifySessionId - SEC-01`: Four todo stubs covering valid signature round-trip, tampered signature, truncated signature, and constant-time comparison.
- `refreshSession - BUG-03`: Three todo stubs covering `updateSessionExpiry` call when present, cookie-only fallback when absent, and single-warning-per-session behavior.

Includes a fully-typed `makeMockDb()` helper with all `DatabaseAdapter` methods mocked — required because tsconfig has `noImplicitAny: false` but vitest/TypeScript still enforces interface shape.

### src/__tests__/mpc.test.ts

Test stubs for four groups:
- `base58Encode replacement - DEBT-02`: 1 todo for library output equivalence.
- `yoctoNEAR conversion - BUG-01`: 3 todos covering integer precision edge cases.
- `buildSignedTransaction - BUG-02`: 2 todos for byte layout validation.
- `derivation salt - SEC-04`: 3 todos for unsalted/salted derivation comparison.

### src/types/index.ts

Three additions:
1. `derivationSalt?: string` on `AnonAuthConfig` — server-side salt for SEC-04 implementation.
2. `derivationSalt?: string` on `MPCAccountConfig` — forwarded config for the MPC layer.
3. `updateSessionExpiry?(sessionId: string, newExpiresAt: Date): Promise<void>` optional method on `DatabaseAdapter` — allows BUG-03 fix without breaking existing adapters.

## Verification Results

```
vitest run: 2 skipped, 16 todo, 0 failures — exit 0
tsc --noEmit: no errors — exit 0
```

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- vitest.config.ts exists: FOUND
- src/__tests__/session.test.ts exists: FOUND
- src/__tests__/mpc.test.ts exists: FOUND
- src/types/index.ts contains derivationSalt: FOUND
- src/types/index.ts contains updateSessionExpiry: FOUND
- Commit d3a86a9: FOUND (Task 1)
- Commit ae64027: FOUND (Task 2)
