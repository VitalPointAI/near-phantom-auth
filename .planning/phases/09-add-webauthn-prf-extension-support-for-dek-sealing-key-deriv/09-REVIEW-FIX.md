---
phase: 09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv
fixed_at: 2026-04-19T00:00:00Z
review_path: .planning/phases/09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv/09-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 9: Code Review Fix Report

**Fixed at:** 2026-04-19
**Source review:** .planning/phases/09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv/09-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (Warnings — Critical count was 0; Info findings excluded per fix_scope=critical_warning)
- Fixed: 3
- Skipped: 0

All Critical + Warning findings were addressed. Info findings (IN-01 through IN-05) were out of scope for this iteration and remain open.

**Verification:**
- `npm run typecheck` passed after each fix
- Targeted test files (`prf.test.ts`, `passkey.test.ts`, `validation.test.ts`) passed after each fix (99 tests)
- Full suite passed after final fix (252 tests, 15 files)

## Fixed Issues

### WR-01: Client does not verify PRF output is exactly 32 bytes before hex-encoding

**Files modified:** `src/client/passkey.ts`
**Commit:** 1612156
**Applied fix:** Added an explicit `byteLength !== 32` guard immediately after extracting `prfResult` in both `createPasskey` (around line 140) and `authenticateWithPasskey` (around line 228). A non-compliant authenticator returning a non-32-byte PRF output now throws `PRF_UNEXPECTED_LENGTH: expected 32 bytes, got N` locally rather than silently producing a malformed `sealingKeyHex` that would surface as an opaque server-side 400. The guard is defensive (spec mandates 32 bytes) and anchors the crypto invariant at the source. Tests: `prf.test.ts` and `passkey.test.ts` still pass (existing tests use 32-byte mock PRF outputs; new edge-case is not covered, see Follow-ups).

### WR-02: Server accepts `sealingKeyHex` but no route handler consumes it

**Files modified:** `src/server/validation/schemas.ts`
**Commit:** 1510a8f
**Applied fix:** Added an explanatory code comment above both `sealingKeyHex` field declarations in `registerFinishBodySchema` (line 38) and `loginFinishBodySchema` (line 79). The comment flags that the field is accepted so downstream consumers (e.g., a DEK auth-service) can forward it as-is, warns future maintainers to treat it as key material, and prescribes that the validated body must not be logged as a whole (fields should be extracted individually). Confirmed via grep that no logger in `src/server/` currently spreads the validated body, satisfying the WR-02 secondary audit ask. Tests: `validation.test.ts` (55 tests) passed.

### WR-03: `requirePrf` guard runs after credential provisioning, leaving orphaned credentials

**Files modified:** `src/types/index.ts`, `src/client/hooks/useAnonAuth.tsx`
**Commit:** fd4e769
**Applied fix:** Chose Option B (document the trade-off) per the prompt guidance, since pre-flight PRF detection requires `PublicKeyCredential.getClientCapabilities()` which is not yet broadly available. Expanded the JSDoc on `AnonAuthConfig.passkey.requirePrf` (src/types/index.ts) to explain the orphan-credential limitation, why the library does not attempt a pre-flight probe today, and the weaker login-path implication (counter bump + UX). Added matching short comments at the two throw sites in `useAnonAuth.tsx` (register and login) that reference the JSDoc for full context. Rejection order unchanged — ceremonies still run before the requirePrf check. Tests: source-pattern regexes in `prf.test.ts` (e.g., `/if\s*\(\s*passkey\?\.requirePrf\s*&&\s*!credential\.sealingKeyHex\s*\)/`, `/\},\s*\[\s*api,\s*passkey\s*\]/g`) still match after the comment additions; all 26 PRF tests pass.

## Follow-ups (not in scope)

- Info findings IN-01 through IN-05 from the review remain open for a future pass.
- WR-01 introduced a new throw path (`PRF_UNEXPECTED_LENGTH`) that is not covered by a dedicated test. Consider adding a mock-based test that returns a 16-byte or 64-byte `prf.results.first` and asserts the throw — out of scope for this fix iteration since the guard is defensive against spec-non-compliant authenticators.
- WR-03 Option A (pre-flight PRF probe via `PublicKeyCredential.getClientCapabilities()`) is deferred until that browser API is mainstream.

---

_Fixed: 2026-04-19_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
