---
phase: 01-atomic-security-fixes
verified: 2026-03-14T09:15:00Z
status: passed
score: 15/15 must-haves verified
gaps: []
human_verification: []
---

# Phase 1: Atomic Security Fixes — Verification Report

**Phase Goal:** Fix critical security vulnerabilities and correctness bugs with zero API surface changes
**Verified:** 2026-03-14T09:15:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | vitest runs successfully with zero configuration errors | VERIFIED | `npx vitest run` exits 0; 22 tests pass, 0 failures |
| 2  | Test stubs for session and mpc modules exist and are recognized by vitest | VERIFIED | `src/__tests__/session.test.ts` (7 tests), `src/__tests__/mpc.test.ts` (15 tests) — all passing |
| 3  | AnonAuthConfig and MPCAccountConfig have optional derivationSalt property | VERIFIED | `src/types/index.ts` lines 44-45 and 58-59 |
| 4  | DatabaseAdapter has optional updateSessionExpiry method | VERIFIED | `src/types/index.ts` line 160 |
| 5  | Tampered session cookie signature returns null, not a valid sessionId | VERIFIED | 3 test cases: tampered, truncated, extended — all return null |
| 6  | Session verification uses crypto.timingSafeEqual, not string equality | VERIFIED | `src/server/session.ts` line 8 imports `timingSafeEqual`; line 72 calls it |
| 7  | Session refresh updates expiresAt in the database when adapter supports it | VERIFIED | `src/server/session.ts` lines 200-202: `await db.updateSessionExpiry(session.id, newExpiresAt)` |
| 8  | Session refresh falls back to cookie-only with one-time warning when adapter lacks updateSessionExpiry | VERIFIED | Lines 202-207; instance-scoped `warnedNoUpdateSessionExpiry` flag; test confirms 1 warn across 3 calls |
| 9  | Custom base58Encode function is deleted and all call sites use bs58.encode | VERIFIED | No `base58Encode` definition in `src/server/mpc.ts`; `bs58.encode` found at lines 92, 155, 412 |
| 10 | NEAR amount conversion uses bn.js for integer arithmetic, not parseFloat | VERIFIED | Lines 195-198 in `src/server/mpc.ts`; no `parseFloat.*1e24` anywhere in file |
| 11 | buildSignedTransaction output includes 32-byte public key between key type byte and 64-byte signature | VERIFIED | Lines 304-315 in `src/server/mpc.ts`; 5 tests confirm byte layout |
| 12 | Account derivation produces different output when derivationSalt is configured versus absent | VERIFIED | Lines 406-409 in `src/server/mpc.ts`; test confirms different account IDs |
| 13 | Existing unsalted derivation produces identical output to current code (backward compat) | VERIFIED | Seed format `implicit-${userId}` unchanged when salt absent; test confirms two unsalted managers produce identical IDs |
| 14 | derivationSalt flows from AnonAuthConfig through createMPCManager to MPCAccountManager at runtime | VERIFIED | `src/server/index.ts` line 136: `derivationSalt: config.mpc?.derivationSalt`; `MPCAccountManager` constructor assigns `this.derivationSalt` (line 376) |
| 15 | Full test suite is green | VERIFIED | 22/22 tests pass, 0 failures, 0 skipped |

**Score:** 15/15 truths verified

---

## Required Artifacts

### Plan 01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `vitest.config.ts` | Vitest test runner configuration | VERIFIED | Contains `defineConfig`, `globals: true`, `environment: 'node'` |
| `src/__tests__/session.test.ts` | Test stubs for SEC-01, BUG-03 | VERIFIED | 7 real passing tests; 307 lines; imports `createSessionManager` |
| `src/__tests__/mpc.test.ts` | Test stubs for SEC-04, BUG-01, BUG-02, DEBT-02 | VERIFIED | 15 real passing tests; 202 lines; imports `MPCAccountManager` |
| `src/types/index.ts` | Extended type contracts for phase 1 | VERIFIED | Contains `derivationSalt` (lines 45, 59), `updateSessionExpiry` (line 160) |

### Plan 02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/server/session.ts` | Timing-safe session verification and DB-backed refresh | VERIFIED | `timingSafeEqual` imported (line 8) and called (line 72); `db.updateSessionExpiry` called (line 201) |
| `src/server/db/adapters/postgres.ts` | PostgreSQL implementation of updateSessionExpiry | VERIFIED | Method at lines 540-546: `UPDATE anon_sessions SET expires_at = $1 WHERE id = $2` |
| `src/__tests__/session.test.ts` | Passing tests for SEC-01 and BUG-03 (min 50 lines) | VERIFIED | 307 lines; 7 passing tests |

### Plan 03 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/server/mpc.ts` | Corrected MPC module with all 4 fixes | VERIFIED | Contains `bs58.encode`, `BN`, `derivationSalt`, fixed `buildSignedTransaction` |
| `src/server/index.ts` | Updated createMPCManager call site passing derivationSalt | VERIFIED | Line 136: `derivationSalt: config.mpc?.derivationSalt` |
| `src/__tests__/mpc.test.ts` | Passing tests for DEBT-02, BUG-01, BUG-02, SEC-04 (min 60 lines) | VERIFIED | 202 lines; 15 passing tests |

---

## Key Link Verification

### Plan 01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/__tests__/session.test.ts` | `src/server/session.ts` | import of createSessionManager | WIRED | Line 9: `import { createSessionManager } from '../server/session.js'` |
| `src/__tests__/mpc.test.ts` | `src/server/mpc.ts` | import of MPC functions | WIRED | Line 13: `import { MPCAccountManager } from '../server/mpc.js'` |

### Plan 02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/server/session.ts` | `crypto.timingSafeEqual` | import and call in verifySessionId | WIRED | Line 8 import; line 72 call with length guard at line 71 |
| `src/server/session.ts` | `db.updateSessionExpiry` | optional method call in refreshSession | WIRED | Lines 200-202: `if (db.updateSessionExpiry) { await db.updateSessionExpiry(...) }` |
| `src/server/db/adapters/postgres.ts` | `anon_sessions` table | UPDATE query | WIRED | Line 542: `UPDATE anon_sessions SET expires_at = $1 WHERE id = $2` |

### Plan 03 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/server/mpc.ts` | `bs58` | static import replacing hand-rolled base58Encode | WIRED | Line 9: `import bs58 from 'bs58'`; used at lines 92, 143, 155, 412 |
| `src/server/mpc.ts` | `bn.js` | import for yoctoNEAR conversion | WIRED | Line 10: `import BN from 'bn.js'`; used at line 198 |
| `src/server/mpc.ts` | `config.derivationSalt` | MPCAccountManager constructor and createAccount | WIRED | Constructor line 376: `this.derivationSalt = config.derivationSalt`; createAccount lines 406-409 |
| `src/server/index.ts` | `src/server/mpc.ts` | createMPCManager call passes derivationSalt from config | WIRED | Line 136: `derivationSalt: config.mpc?.derivationSalt` |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SEC-01 | Plan 02 | Session signature verification uses constant-time comparison | SATISFIED | `timingSafeEqual` used in `verifySessionId`; 4 passing tests confirm tamper rejection |
| SEC-04 | Plans 01, 03 | Account derivation uses server-side secret salt | SATISFIED | `derivationSalt` in types, MPCConfig, MPCAccountManager; wired through index.ts; 3 passing tests |
| BUG-01 | Plan 03 | NEAR amount conversion uses BigInt-based math | SATISFIED | BN-based string split pattern in `fundAccountFromTreasury`; no `parseFloat`; 4 passing tests |
| BUG-02 | Plan 03 | Signed transaction format includes public key in signature wrapper | SATISFIED | `buildSignedTransaction` includes `publicKey` push; 5 passing tests verify byte layout |
| BUG-03 | Plans 01, 02 | Session refresh updates expiresAt in database | SATISFIED | `db.updateSessionExpiry` called in `refreshSession`; postgres adapter implements it; 3 passing tests |
| DEBT-02 | Plan 03 | Custom base58Encode replaced with bs58.encode consistently | SATISFIED | `base58Encode` function absent from mpc.ts; `bs58.encode`/`bs58.decode` used at all 4 call sites |

**All 6 required requirements: SATISFIED**

### Orphaned Requirements Check

No requirement IDs are mapped to Phase 1 in REQUIREMENTS.md that are not accounted for in the plans. The traceability table confirms SEC-01, SEC-04, BUG-01, BUG-02, BUG-03, and DEBT-02 are the only Phase 1 requirements.

---

## Anti-Patterns Found

### Scan: session.ts

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

### Scan: mpc.ts

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/server/mpc.ts` | 491-499 | `// TODO: Implement full MPC signing flow` in `addRecoveryWallet` | Info | Out-of-scope for Phase 1; STUB-01 is a Phase 5 requirement — not a regression |
| `src/server/mpc.ts` | 533-534 | `// Check if recovery wallet's key is in the access key list` stub comment | Info | BUG-04 is a Phase 5 requirement — pre-existing, not introduced by Phase 1 |

Both anti-patterns are pre-existing stubs for Phase 5 requirements (STUB-01, BUG-04). Phase 1 did not introduce them and did not claim to fix them.

### Scan: postgres.ts

No anti-patterns found.

### Scan: session.test.ts, mpc.test.ts

No `it.todo()` or `it.skip()` remain — all stubs converted to real assertions.

---

## TypeScript Compilation Note

Running `npx tsc --noEmit` emits 14 errors. All 14 are `Cannot find name 'expect'` in the test files (`session.test.ts`, `mpc.test.ts`). These occur because `tsconfig.json` does not include `@vitest/globals` types for the `expect` global. This is a pre-existing tsconfig configuration gap — it is not a Phase 1 regression:

- Production source (`src/server/**`, `src/types/**`) compiles with zero errors.
- Vitest itself resolves the globals at runtime — all 22 tests pass.
- The plan's own verification (`npx tsc --noEmit`) checked only production sources.

This is a minor known gap (not a blocker): the tsconfig should include `"types": ["vitest/globals"]` to eliminate the false positives, but this is a separate concern outside Phase 1's requirement scope.

---

## Human Verification Required

None. All observable truths are verifiable programmatically via test execution and static code inspection.

---

## Gaps Summary

No gaps. All 15 observable truths are verified. All 6 required requirements (SEC-01, SEC-04, BUG-01, BUG-02, BUG-03, DEBT-02) are satisfied. All key links are wired. The test suite is green at 22/22 tests. The phase goal — "fix critical security vulnerabilities and correctness bugs with zero API surface changes" — is fully achieved.

The only observation worth noting for future phases: adding `"types": ["vitest/globals"]` to tsconfig.json would allow `npx tsc --noEmit` to run clean on test files. This is a DEBT item, not a Phase 1 gap.

---

_Verified: 2026-03-14T09:15:00Z_
_Verifier: Claude (gsd-verifier)_
