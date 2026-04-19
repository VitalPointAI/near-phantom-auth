---
phase: 09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv
plan: 02
subsystem: auth
tags: [webauthn, prf, client, api, tdd]

# Dependency graph
requires:
  - phase: 09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv
    plan: 01
    provides: "AnonAuthConfig.passkey type; sealingKeyHex regex schema on register/login finish; prf.test.ts Wave 0 scaffold with HMAC mock factories"
provides:
  - "createPasskey(options, { salt }) ceremony with PRF extension wired into navigator.credentials.create and 64-char hex sealingKeyHex return field"
  - "authenticateWithPasskey(options, { salt }) ceremony with PRF extension wired into navigator.credentials.get and sealingKeyHex return field"
  - "api.finishRegistration/finishAuthentication thread sealingKeyHex into POST body via spread-conditional — field absent (not null) when undefined"
  - "arrayBufferToHex utility (ArrayBuffer -> 64-char lowercase hex) for PRF output encoding"
  - "PRFExtensionInput / PRFExtensionOutput local type augmentations (Level 3 WebAuthn)"
affects: [09-03, useAnonAuth, ApiClient consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Local-type augmentation pattern (`satisfies PRFExtensionInput` + `as unknown as DomExtensionsType`) for WebAuthn Level 3 extensions absent from lib.dom.d.ts"
    - "Spread-conditional field inclusion (`...(value ? { value } : {})`) for POST body fields that must be absent (not null) when undefined"
    - "Dynamic-import-after-mock-install pattern for modules that read globalThis.navigator during import cycle"

key-files:
  created: []
  modified:
    - "src/client/passkey.ts"
    - "src/client/api.ts"
    - "src/__tests__/prf.test.ts"

key-decisions:
  - "Used `satisfies PRFExtensionInput` + `as unknown as PublicKeyCredentialCreationOptions['extensions']` double-cast for the PRF extensions slot — the direct `as PRFExtensionInput` cast specified in the plan action list does not satisfy TypeScript 5.9 strict DOM typing (Uint8Array<ArrayBufferLike> vs BufferSource<ArrayBuffer>); double-cast preserves local shape enforcement while unblocking DOM assignability"
  - "Kept PRFExtensionInput and PRFExtensionOutput as named types (not replaced with inline `as any`) per RESEARCH.md Pitfall 3 — localized augmentation keeps strict typing at call sites"
  - "TDD gate followed strictly for both tasks: RED test commit precedes GREEN implementation commit; RED state verified by both runtime failures (wrong values) AND typecheck failures (arity/missing-field errors)"

patterns-established:
  - "Plan-02 cast pattern for WebAuthn Level 3 extension inputs: build value with `satisfies LocalType`, then `as unknown as DomExtensionsType` at the extensions slot. Documents local shape AND satisfies DOM assignability."
  - "API finish-body omission pattern: `...(fieldVariable ? { fieldVariable } : {})` — stricter than relying on JSON.stringify's undefined-drop, because it guarantees absence at the object-literal level (safer across serializers)."
  - "Import-after-mock pattern in prf.test.ts: `const { createPasskey } = await import('../client/passkey.js')` inside each test ensures fresh module evaluation picks up the globalThis.navigator assigned in beforeEach."

requirements-completed:
  - PRF-02
  - PRF-03
  - PRF-04
  - PRF-05
  - PRF-06
  - PRF-07
  - PRF-11

# Metrics
duration: 7min
completed: 2026-04-19
---

# Phase 09 Plan 02: WebAuthn PRF Extension Client Ceremony and API Threading Summary

**Wired the WebAuthn PRF extension into `createPasskey`/`authenticateWithPasskey` and threaded `sealingKeyHex` through `finishRegistration`/`finishAuthentication` POST bodies with spread-conditional field omission — 14 placeholder tests replaced with real passing assertions, full suite remains green.**

## Performance

- **Duration:** 7 min (405s)
- **Started:** 2026-04-19T23:02:30Z
- **Tasks:** 2 (both `type="auto" tdd="true"`)
- **Files modified:** 3 (0 created, 3 edited)
- **Commits:** 4 (RED test + GREEN feat pair per task; strict TDD discipline)

## Accomplishments

- `createPasskey(options, prfOptions?)` now accepts an optional `{ salt: Uint8Array }` second argument. When present, `extensions.prf.eval.first` is wired into the `navigator.credentials.create` publicKey options. After the ceremony, `getClientExtensionResults().prf?.results?.first` (ArrayBuffer) is hex-encoded and returned as `sealingKeyHex: string`. When `prfOptions` is omitted entirely, no `extensions` key is set (verified by mock-call inspection — T-09-11 mitigation).
- `authenticateWithPasskey` mirrors the same signature extension and extraction path for `navigator.credentials.get`.
- Both functions' return types are extended to `RegistrationResponseJSON & { sealingKeyHex?: string }` / `AuthenticationResponseJSON & { sealingKeyHex?: string }` — a non-breaking intersection type that keeps existing consumers working while providing the new field to hook callers.
- `ApiClient.finishRegistration` gains a trailing `sealingKeyHex?: string` (6th position, after `username?`); `ApiClient.finishAuthentication` gains a trailing `sealingKeyHex?: string` (3rd position, after `response`). Both implementations use `...(sealingKeyHex ? { sealingKeyHex } : {})` to guarantee the field is absent from the serialized body when undefined — verified via fetch mock with `expect(rawBody).not.toContain('sealingKeyHex')` in three tests (T-09-09 mitigation).
- 14 previously-reserved `it.todo()` placeholders from Plan 01 have real passing test bodies:
  - createPasskey describe: 7 tests (extensions presence, omission when prfOptions missing, 64-char hex output, undefined when no PRF, determinism, two divergence axes)
  - authenticateWithPasskey describe: 3 tests (extensions presence, hex output, undefined when no PRF)
  - finishRegistration describe: 3 tests (inclusion when defined, omission when absent, omission when explicit undefined)
  - finishAuthentication describe: 2 tests (inclusion when defined, omission when absent)
- Test suite before Plan 02: 231 passing + 15 todos. After Plan 02: 246 passing + 2 todos. Net: +15 passing, -13 todos (13 todos replaced by 14 real tests; net gain accounts for the one extra test added to createPasskey's block beyond the original placeholder count).
- `npm run typecheck` exits 0.
- `npm test -- --run src/__tests__/prf.test.ts` — 20 passed + 2 todos.
- `npm test -- --run src/__tests__/passkey.test.ts` — 18 passed (no regressions in baseline suite).
- `npm test -- --run` — 246 passed + 2 todos across 15 test files.

## Task Commits

Each task was committed atomically, with TDD RED and GREEN commits paired:

1. **Task 1 (RED):** `test(09-02): add failing tests for createPasskey/authenticateWithPasskey PRF extraction` — `dea84c4`
2. **Task 1 (GREEN):** `feat(09-02): wire WebAuthn PRF extension into createPasskey/authenticateWithPasskey` — `6464c41`
3. **Task 2 (RED):** `test(09-02): add failing tests for finishRegistration/finishAuthentication sealingKeyHex threading` — `942cb08`
4. **Task 2 (GREEN):** `feat(09-02): thread sealingKeyHex through api.finishRegistration/finishAuthentication` — `26fe05a`

**Plan metadata:** (pending — worktree mode; orchestrator commits SUMMARY.md after wave merge)

## Files Created/Modified

- `src/client/passkey.ts` — Added `PRFExtensionInput` / `PRFExtensionOutput` local type augmentations (Level 3 PRF extension absent from `lib.dom.d.ts`). Added `arrayBufferToHex(buffer: ArrayBuffer): string` helper below `bufferToBase64url`. Extended `createPasskey` signature with `prfOptions?: { salt: Uint8Array }` and return type `& { sealingKeyHex?: string }`. Spread-conditional `extensions` field into `publicKeyOptions` (cast `satisfies PRFExtensionInput` then `as unknown as PublicKeyCredentialCreationOptions['extensions']` to bypass strict DOM type check while preserving local shape enforcement). Extracted `ext.prf?.results?.first` via `PRFExtensionOutput` cast. Added `sealingKeyHex` to the return literal. Identical mirror changes in `authenticateWithPasskey` for `navigator.credentials.get`.
- `src/client/api.ts` — Added trailing `sealingKeyHex?: string` parameter to `ApiClient.finishRegistration` (6th param) and `ApiClient.finishAuthentication` (3rd param) interface signatures. Same addition to both implementations, with the body construction using `...(sealingKeyHex ? { sealingKeyHex } : {})` spread-conditional to ensure absence in the serialized JSON when undefined. No other methods modified.
- `src/__tests__/prf.test.ts` — Replaced two describe-blocks from Plan 01 (createPasskey + authenticateWithPasskey PRF extraction) with 10 real tests and two more describe-blocks (finishRegistration + finishAuthentication body threading) with 5 real tests. All tests use the existing `makeMockCredentialWithPrf` / `makeMockCredentialNoPrf` factories from Plan 01, dynamic `await import('../client/passkey.js')` / `api.js` to ensure fresh module evaluation after globalThis navigator assignment, and vi.fn() fetch mocks that capture request body for body-level assertions. The `useAnonAuth requirePrf` describe block with 2 `it.todo` placeholders is unchanged — reserved for Plan 03.

## Decisions Made

- **Double-cast for WebAuthn Level 3 extensions**: The plan's action list specified `as PRFExtensionInput` directly on the extensions object. Under TypeScript 5.9 with current DOM library, this fails because `Uint8Array<ArrayBufferLike>` is not assignable to `BufferSource` (which expects `ArrayBufferView<ArrayBuffer>`, rejecting `SharedArrayBuffer`). The plan's RESEARCH.md Pitfall 3 anticipated typecheck friction at exactly this boundary. The chosen fix is `satisfies PRFExtensionInput` (local shape enforcement, no widening) followed by `as unknown as PublicKeyCredentialCreationOptions['extensions']` (DOM assignability). This is strictly tighter than `as any` and more documentation-rich than a single cast to the DOM type. See Deviations below.
- **Kept named local types over inline `as any`**: `PRFExtensionInput` and `PRFExtensionOutput` remain named at module scope per plan intent. Grep shows 3 matches for `prf: { eval: { first:` (1 type + 2 call sites) vs the plan's "exactly TWO matches" acceptance — this is a plan self-consistency issue (Action Step 1 mandates the type containing that exact substring, making "exactly TWO matches" impossible without deleting the type). The functional intent is met: two call sites use the pattern.
- **TDD RED proven via dual signal**: Each RED state had both runtime failures (real assertion mismatches) AND typecheck failures (arity / missing-field errors). GREEN was gated on both passing, not just runtime.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking typecheck error] Adjusted extension-cast pattern to satisfy strict DOM types**
- **Found during:** Task 1 GREEN gate verification (after writing code per plan Step 4 and Step 8)
- **Issue:** Plan action steps specified `as PRFExtensionInput` at the `extensions` spread site. Under current TypeScript + `lib.dom.d.ts`, this produces: `error TS2322: Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'BufferSource'. ... Type 'SharedArrayBuffer' is not assignable to type 'ArrayBuffer'`. The DOM type `AuthenticationExtensionsClientInputs.extensions` has a narrower `BufferSource` constraint than the generic `Uint8Array` we pass in.
- **Fix:** Replaced `as PRFExtensionInput` with `satisfies PRFExtensionInput) as unknown as PublicKeyCredentialCreationOptions['extensions']` (and `...RequestOptions['extensions']` for authenticate). This:
  1. Keeps strict local shape enforcement (`satisfies` ensures the object literally conforms to PRFExtensionInput).
  2. Bypasses the DOM type assignability error by going through `unknown`.
  3. Still references `PRFExtensionInput` so grep-acceptance-criterion `AuthenticationExtensionsPRFInputs` returns 0 (we use the PLAN-specified name, not the spec name).
- **Files modified:** `src/client/passkey.ts` (2 call sites — createPasskey and authenticateWithPasskey)
- **Commit:** `6464c41`

### Acceptance Criteria Notes

- **`grep -n "prf: { eval: { first:" src/client/passkey.ts` returns 3, not 2**: The plan's Action Step 1 mandates `type PRFExtensionInput = { prf: { eval: { first: Uint8Array } } };` which contains that exact substring. The "exactly TWO matches" acceptance criterion is satisfied in spirit (2 call sites + 1 type definition); literal 2 is impossible without deleting the mandated type. Documented here for verifier visibility.
- All other Task 1 and Task 2 grep-based acceptance criteria met literally: `prfOptions?: { salt: Uint8Array }` = 2, `arrayBufferToHex` = 3, `sealingKeyHex` in passkey.ts = 6, `AuthenticationExtensionsPRFInputs` = 0, `sealingKeyHex?: string` in api.ts = 4, spread-conditional = 2, `not.toContain` in test = 3.

## Issues Encountered

Task 1 typecheck failure as described above — resolved inline via the double-cast pattern. No blockers, no architectural decisions required. TDD RED was achieved cleanly on both tasks; the RED state for Task 2 had 2 runtime failures (the "include" tests) rather than 5, because the "omit when undefined" assertions pass trivially pre-fix (JS omits `undefined` from the old object literal at JSON.stringify time). The spread-conditional GREEN fix is stricter because it keeps the key off the literal at all.

## Threat Model Coverage

All T-09-* mitigations specified in the plan frontmatter are realized in the committed code:

| Threat | Plan Disposition | Realization |
|--------|------------------|-------------|
| T-09-07 Tampering (salt mutation in client) | mitigate | `prfOptions.salt` is used as an opaque Uint8Array, never mutated, never reassigned. The salt is the caller's responsibility (Plan 03 hook). |
| T-09-08 Info Disclosure (sealingKeyHex in logs) | mitigate | No new `console.*` calls in passkey.ts or api.ts. Error paths throw non-sensitive `Error` messages. |
| T-09-09 Tampering (sealingKeyHex:null sent) | mitigate | Spread-conditional `...(sealingKeyHex ? { sealingKeyHex } : {})` guarantees field absence. Three tests verify `expect(rawBody).not.toContain('sealingKeyHex')` — covers string-level (not just JSON.parse-level) verification. |
| T-09-10 DoS (oversized salt) | accept | Salt length is authenticator's concern; client passes through unchanged. |
| T-09-11 EoP (accidental extensions.prf with no prfOptions) | mitigate | Test `does NOT set extensions when prfOptions is omitted` asserts `arg.publicKey.extensions` is undefined in mock call — spread-conditional guarantees no extension leakage. |
| T-09-12 Info Disclosure (sealingKeyHex storage) | mitigate | No persistence of sealingKeyHex added in this plan. Value flows: credential return -> function return -> (Plan 03) hook local var -> API call -> discarded. |
| T-09-13 Tampering (as unknown cast) | accept | Double-cast (`satisfies ... as unknown as ...`) used deliberately at the DOM boundary per Pitfall 3. Runtime guards (`ext.prf?.results?.first` optional-chain) handle malformed responses without crashing. |

No new threat surface introduced beyond the plan's anticipated boundary.

## Known Stubs

None introduced by this plan.

The two remaining `it.todo()` placeholders in `src/__tests__/prf.test.ts` (lines 374-375) are for `describe('useAnonAuth requirePrf rejection (PRF-09) — filled by Plan 03')` — these are intentional reservations from Plan 01 awaiting Plan 03 (useAnonAuth hook wiring). Not counted as stubs in this plan.

## Threat Flags

None. No new network endpoints, auth paths, file access, or trust-boundary schema changes introduced beyond what the plan's `<threat_model>` anticipated. The `sealingKeyHex` field added to POST bodies is the central feature of this plan and is already in the register.

## Next Plan Readiness

Plan 03 can now:
- Call `createPasskey(options, { salt })` — receives `sealingKeyHex` in the response object.
- Call `authenticateWithPasskey(options, { salt })` — same.
- Thread the returned `sealingKeyHex` into `api.finishRegistration(..., sealingKeyHex)` and `api.finishAuthentication(..., sealingKeyHex)` as the new trailing argument.
- Implement `requirePrf` rejection path in the hook by checking `!sealingKeyHex && passkey?.requirePrf === true` after each ceremony and throwing.
- Fill the 2 remaining `it.todo()` tests in `prf.test.ts` (lines 374-375).
- Default `prfSalt` to `new TextEncoder().encode('near-phantom-auth-prf-v1')` as the module-level constant per RESEARCH.md Pattern 4 and PATTERNS.md observation #1.

No blockers surfaced.

## Self-Check: PASSED

**Files modified exist (verified via Read tool):**
- FOUND: `src/client/passkey.ts` — 210 lines, contains PRFExtensionInput, PRFExtensionOutput, arrayBufferToHex, prfOptions on both exports
- FOUND: `src/client/api.ts` — 218 lines, contains sealingKeyHex?: string on 4 signatures and spread-conditional on 2 implementations
- FOUND: `src/__tests__/prf.test.ts` — 376 lines, 20 real tests + 2 remaining it.todo for Plan 03

**Commits exist (verified via `git log`):**
- FOUND: `dea84c4` test(09-02): RED tests for createPasskey/authenticateWithPasskey PRF
- FOUND: `6464c41` feat(09-02): GREEN implementation for PRF extension in passkey.ts
- FOUND: `942cb08` test(09-02): RED tests for api finishRegistration/finishAuthentication
- FOUND: `26fe05a` feat(09-02): GREEN sealingKeyHex threading in api.ts

**Verification commands exit 0:**
- `npm run typecheck` -> exit 0
- `npm test -- --run src/__tests__/prf.test.ts` -> 20 passed + 2 todos
- `npm test -- --run src/__tests__/passkey.test.ts` -> 18 passed (no regressions)
- `npm test -- --run` -> 246 passed + 2 todos across 15 test files

## TDD Gate Compliance

Plan 02 task-level TDD (not plan-level, since `type: execute` not `type: tdd` in frontmatter). Each task has `tdd="true"` and was executed with strict RED->GREEN discipline:

- Task 1 RED commit `dea84c4` (test) precedes GREEN commit `6464c41` (feat). RED state had 6 runtime failures + 20 typecheck errors before feat commit; all green after.
- Task 2 RED commit `942cb08` (test) precedes GREEN commit `26fe05a` (feat). RED state had 2 runtime failures + 3 typecheck errors before feat commit; all green after.

No REFACTOR commits needed — the implementations are minimal and follow plan structure verbatim (with the single typecheck-driven double-cast deviation documented above).

---
*Phase: 09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv*
*Plan: 02*
*Completed: 2026-04-19*
