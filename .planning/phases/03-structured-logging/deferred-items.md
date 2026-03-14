# Deferred Items — Phase 03

## Pre-existing TypeScript Errors (Out of Scope)

Discovered during 03-01 execution. These errors existed before Phase 03 work began.

### session.test.ts — missing vitest imports

`src/__tests__/session.test.ts` has 14 TypeScript errors for `Cannot find name 'expect'`.
Root cause: The test file uses bare `expect` without importing it from vitest.
This is a pre-existing issue from Phase 01/02 test scaffolding.
Note: vitest tests work fine at runtime (vitest injects globals), but `tsc --noEmit` fails
because `types: ['vitest/globals']` is not configured in tsconfig.json.

Suggested fix: Add `"types": ["vitest/globals"]` to tsconfig.json compilerOptions,
or add explicit `import { expect } from 'vitest'` to session.test.ts.

### router.ts — WalletSignature type mismatch

`src/server/router.ts` has 2 errors where `string` is passed where `WalletSignature` is expected.
These are pre-existing issues from Phase 01/02 router implementation work.
Likely the validation schemas return typed strings but the router passes them directly to
functions expecting the full `WalletSignature` interface.
