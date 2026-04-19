---
phase: 09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv
verified: 2026-04-19T19:32:00Z
status: human_needed
score: 8/8 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Real authenticator PRF on Chrome 116+ (iCloud Keychain / Google Password Manager / Windows Hello)"
    expected: "Register passkey, verify sealingKeyHex appears in POST /register/finish body in DevTools Network tab; same credential on login produces identical sealingKeyHex in POST /login/finish body; downstream auth-service successfully provisions DEK"
    why_human: "Vitest runs in Node; cannot exercise a real WebAuthn authenticator. End-to-end PRF correctness requires a real browser + real authenticator ceremony."
  - test: "Real authenticator PRF on Safari 18+ (iOS 18 / macOS 15)"
    expected: "Register and login both emit sealingKeyHex (iCloud Keychain returns results.first on registration)"
    why_human: "Headless test runners cannot reach iOS/macOS Safari authenticator stack."
  - test: "Firefox graceful degradation"
    expected: "Registration completes without sealingKeyHex in POST body; no 400 from server; encrypted endpoints respond as expected (e.g., 401 with documented UI warning) when requirePrf=false"
    why_human: "Firefox lacks PRF support; vitest cannot reproduce the real-browser absence plus PRF-unsupported ceremony."
  - test: "requirePrf:true rejection on Firefox"
    expected: "register() and login() reject; state.error contains 'PRF_NOT_SUPPORTED'"
    why_human: "Requires a real PRF-unsupported browser to exercise the rejection path end-to-end (source-pattern tests verify the guard exists but not real-user behavior)."
  - test: "caBLE / hybrid transport PRF survival (phone-as-authenticator)"
    expected: "Cross-device passkey ceremony (phone scanning desktop QR) still surfaces sealingKeyHex on the desktop side"
    why_human: "Requires paired mobile device and a real caBLE ceremony — impossible headless."
  - test: "Hardware key (YubiKey with PRF firmware) PRF on get() but not create()"
    expected: "No sealingKeyHex on registration POST body; sealingKeyHex appears on first login POST body (per WebAuthn spec — hardware keys return enabled:true only on create)"
    why_human: "Needs a physical YubiKey 5 series with PRF-enabled firmware to verify."
---

# Phase 9: WebAuthn PRF Extension for DEK Sealing Key — Verification Report

**Phase Goal:** Library derives a stable 32-byte sealing key per credential via the WebAuthn PRF extension, hex-encodes it, and includes `sealingKeyHex` in POST bodies to `/register/finish` and `/login/finish` so a downstream auth-service can provision and unwrap per-user DEKs. Gracefully degrades on PRF-unsupported browsers; opt-in `requirePrf` enforcement available.

**Verified:** 2026-04-19T19:32:00Z
**Status:** human_needed (all automated must-haves verified; real-authenticator end-to-end flows require human testing)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `createPasskey()` and `authenticateWithPasskey()` request the PRF extension when called with `prfOptions.salt` and return `sealingKeyHex` (64 lowercase hex chars) for PRF-supported authenticators | VERIFIED | `src/client/passkey.ts:82-85,108-118,138-140,156` (create) and `:182-185,201-211,226-228,242` (authenticate). `prfOptions?: { salt: Uint8Array }` added; `extensions.prf.eval.first` set via spread-conditional; `arrayBufferToHex` returns 64-char lowercase hex. Test: `prf.test.ts` "returns 64-char lowercase hex sealingKeyHex for 32-byte PRF output" passes on both functions. |
| 2 | Same credential + same salt produces identical `sealingKeyHex` across registration and every subsequent login (round-trip determinism via deterministic HMAC test mock) | VERIFIED | `prf.test.ts` determinism test: "same credKey + same salt → identical sealingKeyHex" passes. HMAC-SHA-256-based mock factory (`makeMockCredentialWithPrf`) asserts byte-for-byte equality across repeat invocations. |
| 3 | POST `/register/finish` and POST `/login/finish` bodies include `sealingKeyHex` ONLY when defined; the field is OMITTED entirely (not sent as `null`) when PRF is unsupported | VERIFIED | `src/client/api.ts:125-134,146-152` uses spread-conditional `...(sealingKeyHex ? { sealingKeyHex } : {})`. Three tests in `prf.test.ts` assert `expect(rawBody).not.toContain('sealingKeyHex')` on undefined and on explicit-undefined arguments (string-level, not just JSON.parse). |
| 4 | Server-side zod schema validates `sealingKeyHex` as `/^[0-9a-f]{64}$/` and rejects wrong length, uppercase hex, or non-hex characters | VERIFIED | `src/server/validation/schemas.ts:38,79` both register and login finish schemas. Twelve validation tests (6 per schema) cover accepts missing, accepts 64-char lowercase, rejects 63-char, rejects 65-char, rejects uppercase, rejects non-hex — all passing. |
| 5 | `<AnonAuthProvider passkey={{ requirePrf: true }}>` causes `register()`/`login()` to throw an error starting with `PRF_NOT_SUPPORTED` when the authenticator returns no PRF result; default `requirePrf=false` completes the ceremony without `sealingKeyHex` | VERIFIED | `src/client/hooks/useAnonAuth.tsx:208-210,258-260` both callbacks guard `if (passkey?.requirePrf && !credential.sealingKeyHex) throw new Error('PRF_NOT_SUPPORTED: ...')`. Source-pattern tests in `prf.test.ts` (PRF-09 describe) assert guard existence in both ceremonies, absence of unconditional guard (graceful degradation preserved), and `PRF_NOT_SUPPORTED` prefix. Note: real-browser behavior requires human verification (see human_verification). |
| 6 | Default salt `near-phantom-auth-prf-v1` is a module-level constant in `useAnonAuth.tsx` and documented as a permanent deployment commitment | VERIFIED | `src/client/hooks/useAnonAuth.tsx:98` declares `const DEFAULT_PRF_SALT = new TextEncoder().encode('near-phantom-auth-prf-v1')`. Multi-paragraph JSDoc at `:89-97` names the IMMUTABILITY WARNING as a permanent deployment commitment. Source-pattern test asserts exact literal. |
| 7 | `package.json` version is `0.6.0`; `package-lock.json` contains zero `0.5.3` references | VERIFIED | `node -e "console.log(require('./package.json').version)"` → `0.6.0`. `grep -c '"0.5.3"' package-lock.json` → `0`. `grep -c '"0.6.0"' package-lock.json` → `2` (lines 3 and 9). |
| 8 | README documents salt immutability, browser support matrix, and the NULL key-bundle migration approach | VERIFIED | `README.md:24` `## WebAuthn PRF Extension (DEK Sealing Key)`; `:30` `### Configuration`; `:54` `### Salt Immutability`; `:60` `### Browser Support` with 5-row table (Chrome/Edge, Safari, Firefox, Hardware keys, Chrome ≤146 Windows Hello); `:72` `### Migration for Existing Accounts (NULL Key Bundles)`. Features bullet at `:22` added. |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types/index.ts` | `AnonAuthConfig.passkey` nested optional config (`prfSalt?: Uint8Array`, `requirePrf?: boolean`) | VERIFIED | Lines 66-82 contain the block with both fields and documented default salt. |
| `src/server/validation/schemas.ts` | `sealingKeyHex: z.string().regex(/^[0-9a-f]{64}$/).optional()` on register/login finish | VERIFIED | Line 38 (register), line 79 (login). Exactly two matches as required. Outer object remains non-passthrough. |
| `src/client/passkey.ts` | `createPasskey` + `authenticateWithPasskey` with `prfOptions`, PRF extension wiring, hex extraction, `sealingKeyHex` return | VERIFIED | Both signatures accept `prfOptions?: { salt: Uint8Array }`; spread-conditional `extensions` wiring; `arrayBufferToHex` helper at line 73; `sealingKeyHex` returned conditionally. |
| `src/client/api.ts` | `finishRegistration`/`finishAuthentication` thread `sealingKeyHex` conditionally into POST bodies | VERIFIED | Interface signatures (lines 39-46, 53-57) and implementations (lines 125-134, 146-152) use spread-conditional. Verified body omission via fetch-mock string-level assertions. |
| `src/client/hooks/useAnonAuth.tsx` | PRF config wiring, `requirePrf` rejection, `DEFAULT_PRF_SALT` immutability | VERIFIED | `DEFAULT_PRF_SALT` at line 98; `passkey` prop destructured (line 124); both `register`/`login` thread salt and enforce `requirePrf` guard; dep arrays updated to `[api, passkey]`. |
| `src/__tests__/prf.test.ts` | Comprehensive PRF tests (26 passing per summary) | VERIFIED | 26 tests passing, 0 `it.todo` remaining. Covers mock factory sanity, createPasskey extraction, authenticateWithPasskey extraction, api body threading, and useAnonAuth requirePrf via source patterns. |
| `package.json` | version `0.6.0` | VERIFIED | Line 3: `"version": "0.6.0"`. |
| `README.md` | PRF section with salt immutability, browser support, migration note | VERIFIED | Required headings all present; table lists Chrome/Edge, Safari, Firefox, Hardware keys, Chrome ≤146 Windows Hello; NULL key-bundle migration paragraph present. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/server/validation/schemas.ts` | `src/__tests__/validation.test.ts` | `safeParse` assertions on sealingKeyHex | WIRED | Two nested `describe('sealingKeyHex (PRF-08)', ...)` blocks (6 tests each) exercise accepts/rejects cases against both finish schemas. |
| `src/client/passkey.ts` | `src/client/hooks/useAnonAuth.tsx` | `createPasskey(options, { salt })` returns `sealingKeyHex`; hook destructures and forwards | WIRED | `useAnonAuth.tsx:207,222` (register) and `:257,263` (login) consume `credential.sealingKeyHex` after ceremony. |
| `src/client/api.ts` | POST `/register/finish` body | Spread-conditional `...(sealingKeyHex ? { sealingKeyHex } : {})` | WIRED | `api.ts:125-134`. Verified by 3 fetch-mock tests (inclusion when defined, omission when undefined, omission when explicit undefined). |
| `src/client/api.ts` | POST `/login/finish` body | Same spread-conditional | WIRED | `api.ts:146-152`. Verified by 2 fetch-mock tests (inclusion, omission). |
| `src/client/hooks/useAnonAuth.tsx` | `src/client/api.ts` | Trailing `sealingKeyHex` arg to both finish methods | WIRED | `useAnonAuth.tsx:216-223` and `:263`. Source-pattern tests pin the call shape. |
| `src/types/index.ts` | `src/client/hooks/useAnonAuth.tsx` | `AnonAuthProviderProps.passkey` mirrors `AnonAuthConfig.passkey` shape | WIRED | Both interfaces declare matching `{ prfSalt?: Uint8Array; requirePrf?: boolean }` nested shape. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `createPasskey` return | `sealingKeyHex` | `credential.getClientExtensionResults().prf?.results?.first` (ArrayBuffer) → `arrayBufferToHex` | Yes (real authenticator PRF output — 32-byte hex) | FLOWING — verified via deterministic HMAC mock tests |
| `authenticateWithPasskey` return | `sealingKeyHex` | Same path on `navigator.credentials.get` | Yes | FLOWING — verified via mock tests |
| `finishRegistration` POST body | `sealingKeyHex` field | Argument passed from `useAnonAuth.register()` (from `credential.sealingKeyHex`) | Yes when PRF supported; absent when not | FLOWING — fetch-mock asserts both included and omitted states |
| `finishAuthentication` POST body | `sealingKeyHex` field | Same flow for login | Yes when PRF supported; absent when not | FLOWING |
| `useAnonAuth` register/login | `credential.sealingKeyHex` | Return value from `createPasskey`/`authenticateWithPasskey` | Yes (passes through hook; never stored in React state — transient local variable) | FLOWING — source-pattern tests verify forwarding to API |

Note: Server-side consumption of `sealingKeyHex` is intentionally out of scope for this phase (per RESEARCH.md: server-side DEK provisioning is downstream `user-bridge.ts` work). Schema validates the field; no route handler yet reads it. This is documented and aligned with the phase goal.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite passes | `npm test -- --run` | 252 passed / 0 failures / 0 todos across 15 test files (1.88s) | PASS |
| Typecheck passes | `npm run typecheck` | exit 0 | PASS |
| Build produces v0.6.0 dist | `npm run build` | ESM + DTS build success; `client/index.js` 25.74 KB, `server/index.js` 107.83 KB | PASS |
| package.json version correct | `node -e "console.log(require('./package.json').version)"` | `0.6.0` | PASS |
| No `0.5.3` references in lockfile | `grep -c '"0.5.3"' package-lock.json` | `0` | PASS |
| `0.6.0` present in lockfile | `grep -c '"0.6.0"' package-lock.json` | `2` (root + packages[''] self-ref) | PASS |
| README section present | `grep -c '^## WebAuthn PRF Extension' README.md` | `1` | PASS |
| Zero remaining it.todo | `grep -c 'it.todo' src/__tests__/prf.test.ts` | `0` | PASS |
| `sealingKeyHex` occurrences in hook | `grep -c sealingKeyHex src/client/hooks/useAnonAuth.tsx` | `4` (2 guards + 2 API calls) | PASS |
| PRF_NOT_SUPPORTED guard count | `grep -c PRF_NOT_SUPPORTED src/client/hooks/useAnonAuth.tsx` | `3` (2 throws + 1 test-style reference) | PASS |
| Mock factory exports | `grep -c 'makeMockCredentialWithPrf\|makeMockCredentialNoPrf' src/__tests__/prf.test.ts` | `25` (exports + imports + call sites) | PASS |

### Requirements Coverage

Note: The PRF-01 through PRF-12 requirements are defined in the phase-local `09-RESEARCH.md` (not `REQUIREMENTS.md`). `REQUIREMENTS.md` lists hardening milestone requirements (SEC/BUG/STUB/INFRA/DEBT/PERF/EMAIL/TEST) none of which include PRF IDs — the PRF requirement IDs were established during phase 09 research as derived from CONTEXT.md's "Reference checklist for the library PR". This is documented in `09-RESEARCH.md:61-80` ("no formal REQ-IDs exist"). No orphaned requirements — all 12 PRF IDs are declared in plan frontmatter and covered here.

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PRF-01 | 09-01, 09-03 | `passkey.prfSalt?` / `passkey.requirePrf?` on config surfaces | SATISFIED | `AnonAuthConfig.passkey` (types/index.ts:66-82); `AnonAuthProviderProps.passkey` (useAnonAuth.tsx:107-119). |
| PRF-02 | 09-02 | `extensions: { prf: { eval: { first: salt } } }` on `credentials.create()` | SATISFIED | `passkey.ts:108-118` spread-conditional under prfOptions guard. |
| PRF-03 | 09-02 | Same on `credentials.get()` | SATISFIED | `passkey.ts:201-211` mirrors the same pattern. |
| PRF-04 | 09-02 | Extract `getClientExtensionResults().prf?.results?.first` (ArrayBuffer) | SATISFIED | `passkey.ts:138-139, 226-227` both call sites. |
| PRF-05 | 09-02 | Hex-encode 32-byte ArrayBuffer to 64-char lowercase | SATISFIED | `arrayBufferToHex` helper (`passkey.ts:73-77`). Test asserts `/^[0-9a-f]{64}$/`. |
| PRF-06 | 09-02 | `sealingKeyHex` in POST `/register/finish` body | SATISFIED | `api.ts:125-134` spread-conditional; 3 tests assert inclusion + omission. |
| PRF-07 | 09-02 | `sealingKeyHex` in POST `/login/finish` body | SATISFIED | `api.ts:146-152`; 2 tests assert inclusion + omission. |
| PRF-08 | 09-01 | Zod schema accepts optional `sealingKeyHex` with regex `/^[0-9a-f]{64}$/` | SATISFIED | `schemas.ts:38,79`; 12 validation tests. |
| PRF-09 | 09-03 | `requirePrf` rejection path (throw / error state) | SATISFIED (automated); HUMAN VERIFICATION for real-browser behavior | `useAnonAuth.tsx:208-210, 258-260`; 6 source-pattern tests. Real-Firefox lockout requires human validation. |
| PRF-10 | 09-03 | Bump 0.5.3 → 0.6.0 | SATISFIED | `package.json:3` = `0.6.0`; lockfile has 2× `0.6.0`, 0× `0.5.3`. |
| PRF-11 | 09-01, 09-02, 09-03 | Tests for byte-length, determinism, divergence, hex format | SATISFIED | `prf.test.ts` 26 tests covering mock factory sanity (byte-length 32, determinism, two divergence axes) + end-to-end through createPasskey/authenticate. |
| PRF-12 | 09-03 | README: salt immutability, browser support matrix, NULL key-bundle migration | SATISFIED | README lines 22, 24, 30, 54, 60, 72 all present with required content. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | None found in phase-modified files. |

Scanned files: `src/types/index.ts`, `src/server/validation/schemas.ts`, `src/server/index.ts`, `src/client/passkey.ts`, `src/client/api.ts`, `src/client/hooks/useAnonAuth.tsx`, `src/__tests__/prf.test.ts`, `src/__tests__/validation.test.ts`. No TODO/FIXME/XXX/HACK/PLACEHOLDER comments introduced by this phase. No `return null` / `return {}` / empty handlers. No `console.log` added. The spread-conditional pattern `...(x ? { x } : {})` is intentional (documented in CONTEXT.md and RESEARCH.md Pitfall 2) and not a stub. Zero `it.todo` remaining in `prf.test.ts`.

Note: `09-REVIEW.md` identified 3 non-blocking Warnings (WR-01, WR-02, WR-03) for future hardening (client-side 32-byte length assertion, server-side field consumption comment, pre-flight PRF support check to avoid orphaned credentials). These are acknowledged improvements — not failures of the phase goal. They do not block verification.

### Human Verification Required

Real-authenticator end-to-end correctness cannot be exercised by vitest in Node. The following six scenarios require a human operator with real browsers/authenticators:

1. **Chrome 116+ PRF round-trip** — Build sample app against `@vitalpoint/near-phantom-auth@0.6.0`; register passkey; verify `sealingKeyHex` in DevTools Network tab POST `/register/finish` body; login with same credential; verify identical `sealingKeyHex` in POST `/login/finish`.
2. **Safari 18+ (iOS 18 / macOS 15) PRF** — Same flow on Safari with iCloud Keychain; verify PRF fires on both create() and get().
3. **Firefox graceful degradation** — Run sample app on current Firefox (no PRF support); verify registration completes without `sealingKeyHex` in body and no 400 from server when `requirePrf=false` (default).
4. **Firefox `requirePrf:true` rejection** — Set `passkey={{ requirePrf: true }}`; attempt registration on Firefox; verify `state.error` contains `PRF_NOT_SUPPORTED` prefix.
5. **caBLE / hybrid PRF** — Phone-as-authenticator ceremony (phone scanning desktop QR); verify PRF result still surfaces on desktop side.
6. **YubiKey hardware PRF** — Register on PRF-firmware YubiKey; confirm NO `sealingKeyHex` on registration POST; confirm `sealingKeyHex` appears on first login POST (per WebAuthn spec: hardware keys return only `enabled:true` on create, full results on get).

These items were captured in `09-VALIDATION.md` Manual-Only Verifications and are deliberate scope exclusions for automated tests.

### Gaps Summary

None. Every ROADMAP Success Criterion maps to substantive, wired, tested code. All 12 PRF-* requirements are implemented end-to-end across three plans. Full test suite: 252 passed / 0 failures / 0 todos. Typecheck and build both exit 0. README documents immutability, browser matrix, and NULL key-bundle migration. Version bump committed consistently in `package.json` + `package-lock.json`.

The phase goal is achieved from an automated-verification standpoint. Human verification is required only because WebAuthn PRF behavior against real authenticators cannot be exercised headlessly — this is a known constraint of the problem domain, not a gap in phase delivery.

---

_Verified: 2026-04-19T19:32:00Z_
_Verifier: Claude (gsd-verifier)_
