---
phase: 12-multi-rp-id-verification
plan: 03
subsystem: auth
tags: [webauthn, passkey, rpid, simplewebauthn, types, jsdoc]

# Dependency graph
requires:
  - phase: 12-multi-rp-id-verification
    provides: "Pattern Assignment #6 (12-PATTERNS.md): exact widening shape for VerifyRegistrationInput / VerifyAuthenticationInput; RPID-04 paired-tuple contract documented in 12-RESEARCH.md"
provides:
  - "VerifyRegistrationInput.expectedOrigin: string | string[] (widened)"
  - "VerifyRegistrationInput.expectedRPID: string | string[] (widened)"
  - "VerifyAuthenticationInput.expectedOrigin: string | string[] (widened)"
  - "VerifyAuthenticationInput.expectedRPID: string | string[] (widened)"
  - "JSDoc on each widened field cross-referencing RPID-04, the cross-domain use case, and the consumer-owned paired-tuple invariant for standalone callers"
  - "Backwards-compat preserved — existing string-form callers (passkey.ts, passkey.test.ts) compile and pass unchanged"
affects: [12-04, multi-rp-id-verification, framework-agnostic-consumers, nextjs-route-handler-consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Type widening on wrapper interfaces — narrow → string | string[] — when underlying library already accepts both shapes; zero runtime change"
    - "JSDoc cross-reference in lockstep — paired-tuple invariant documented at the interface field level so consumers see it at the call site"

key-files:
  created: []
  modified:
    - "src/server/webauthn.ts (interface widenings only; function bodies untouched)"

key-decisions:
  - "Widen the wrapper INPUT types only; do NOT add Array.isArray branching, do NOT touch function bodies — @simplewebauthn/server@13.x has accepted string | string[] on expectedOrigin / expectedRPID since v8 (verified via library .d.ts inspection in 12-RESEARCH.md)"
  - "Paired-tuple invariant for standalone callers is consumer-owned (T-12-01 disposition: accept) — the framework-agnostic exports cannot enforce origin↔rpId pairing on consumers who construct arrays themselves; JSDoc documents this explicitly so consumers see the contract at the call site"
  - "Compile fixtures for the new string[] form deferred to Plan 04 Task 4 — keeps wave-2 plans (12-02 helper / 12-03 widening) on disjoint files for safe parallel execution; backwards-compat assertion lives here via passkey.test.ts (string-form path)"

patterns-established:
  - "Pattern: Wrapper-side relaxation when library already permits the wider shape — widen the type, leave the body byte-identical, add JSDoc cross-reference to the requirement (RPID-04) and the use case (cross-domain passkeys), and rely on the existing string-form test to assert backwards compat"

requirements-completed: [RPID-04]

# Metrics
duration: 2min
completed: 2026-04-29
---

# Phase 12 Plan 03: Standalone-Export Type Widening (RPID-04) Summary

**`VerifyRegistrationInput` and `VerifyAuthenticationInput` widened from `expectedOrigin: string` / `expectedRPID: string` to `string | string[]` on the framework-agnostic exports — zero runtime change, full backwards compatibility, JSDoc cross-references RPID-04 and the cross-domain passkey contract.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-29T22:23:47Z
- **Completed:** 2026-04-29T22:25:16Z
- **Tasks:** 1 / 1
- **Files modified:** 1

## Accomplishments

- Widened both `VerifyRegistrationInput` and `VerifyAuthenticationInput` so consumers calling the standalone `verifyRegistration()` / `verifyAuthentication()` exports directly (Next.js route handlers; framework-agnostic server users) can pass arrays for cross-domain passkey support.
- Preserved every existing string-form caller — `string` is a structural subtype of `string | string[]`, so `src/server/passkey.ts` (lines 175-176, 282-283) and `src/__tests__/passkey.test.ts` continue to compile and pass with no changes.
- Documented the consumer-owned paired-tuple invariant inline at the interface field level so direct callers see at the call site that `@simplewebauthn/server` does NOT cross-check origin↔rpId pairing.
- Verified the function bodies remain byte-identical to the pre-edit version: both `verifyRegistration` (lines 256-294) and `verifyAuthentication` (lines 337-371) destructure `expectedOrigin` / `expectedRPID` from `input` and pass them VERBATIM into the underlying library — no `Array.isArray(...)` branching, no transformation, no spreading.

## Task Commits

1. **Task 1: Widen VerifyRegistrationInput and VerifyAuthenticationInput to accept string | string[]** — `4094e36` (feat)

## Files Created/Modified

- `src/server/webauthn.ts` — Two interface declarations updated (`VerifyRegistrationInput` lines 89-104, `VerifyAuthenticationInput` lines 161-178). Diff is +16 / -8 lines: 4 type widenings (`string` → `string | string[]` on 2 fields × 2 interfaces) + JSDoc rewrites cross-referencing RPID-04, the cross-domain passkey use case, and (for `VerifyRegistrationInput`) the consumer-owned paired-tuple invariant. Function bodies untouched.

## The Widening (4 fields total)

| Interface | Field | Before | After |
|-----------|-------|--------|-------|
| `VerifyRegistrationInput` | `expectedOrigin` | `string` | `string \| string[]` |
| `VerifyRegistrationInput` | `expectedRPID` | `string` | `string \| string[]` |
| `VerifyAuthenticationInput` | `expectedOrigin` | `string` | `string \| string[]` |
| `VerifyAuthenticationInput` | `expectedRPID` | `string` | `string \| string[]` |

## Why Function Bodies Required ZERO Changes

`@simplewebauthn/server@13.x` already accepts `string | string[]` on both `expectedOrigin` and `expectedRPID` for `verifyRegistrationResponse` and `verifyAuthenticationResponse`. The runtime path was never narrow — only the wrapper type was artificially narrow. Per `12-RESEARCH.md` Sources / `verifyRegistrationResponse.d.ts:25-26` and `verifyAuthenticationResponse.d.ts:22-33` (verified during planning), the library applies `expectedOrigin.includes(origin)` / `expectedRPID.includes(rpId)` membership tests regardless of input shape — the runtime defense (T-12-03) is unchanged from v0.6.1 to v0.7.0.

The wrapper destructures the two fields and passes them verbatim:

```typescript
// verifyRegistration (lines 256-267)
const { response, expectedChallenge, expectedOrigin, expectedRPID } = input;
const verification = await verifyRegistrationResponse({
  response: ...,
  expectedChallenge,
  expectedOrigin,    // ← passed through verbatim
  expectedRPID,      // ← passed through verbatim
});

// verifyAuthentication (lines 337-354) — same pattern
```

No `Array.isArray(...)` branching, no transformation, no `[expectedOrigin]` wrapping. The widening is a wrapper-side relaxation only.

## Backwards-Compat Assertion

`src/__tests__/passkey.test.ts` (22 tests) exercises both wrapper functions through `passkey.ts`, which itself calls `verifyRegistrationResponse` / `verifyAuthenticationResponse` with the string form (`expectedOrigin: config.origin`, `expectedRPID: config.rpId`). All 22 tests pass without modification, confirming `string` remains a valid input on both interfaces.

## RPID-04 Standalone-Export Contract

| Path | Pairing enforcement |
|------|--------------------|
| Direct callers of `verifyRegistration()` / `verifyAuthentication()` (this plan's surface) | **Consumer-owned** — the framework-agnostic exports do not see consumer-side config. JSDoc on the widened fields explicitly states "pair the array elements 1:1 with `expectedOrigin` by index — `@simplewebauthn/server` does NOT cross-check pairing." Consumers should reuse the `validateRelatedOrigins` helper (Plan 02) at startup, or accept the disposition `T-12-01: accept (consumer-owned)`. |
| `createAnonAuth` callers | **Library-owned** — Plan 04 wires `validateRelatedOrigins` upstream of the spread, so paired arrays reach `passkey.ts` already validated. |

## Cross-Reference

Plan 04 Task 4 will add explicit positive compile fixtures for the new `string[]` form on both interfaces alongside its `related-origins.test.ts` extension.

## Verification Commands Run

| Command | Exit | Result |
|---------|------|--------|
| `nvm use 20 && npm run typecheck` | 0 | Typecheck green; no narrow `string` declarations remain on `expectedOrigin` / `expectedRPID` in the two widened interfaces |
| `nvm use 20 && npm test -- --run src/__tests__/passkey.test.ts` | 0 | 22 / 22 tests pass — backwards-compat assertion (string-form callers preserved) |
| `nvm use 20 && npm test -- --run` | 0 | Full suite: 301 passed / 4 skipped (testnet-skipped, expected) / 0 failed across 20 test files |

## Acceptance Criteria — All Pass

- ✓ `expectedOrigin: string \| string[]` count: **2** (>=2)
- ✓ `expectedRPID: string \| string[]` count: **2** (>=2)
- ✓ `RPID-04` references: **4** (>=2)
- ✓ `credential: StoredCredential` count: **1** (==1)
- ✓ verifyRegistration destructure preserved: **1** (>=1)
- ✓ verifyAuthentication destructure preserved: **1** (>=1)
- ✓ `Array.isArray(expectedOrigin)`: **0** (==0)
- ✓ `Array.isArray(expectedRPID)`: **0** (==0)
- ✓ Narrow `expectedOrigin: string;` lines: **0** (==0)
- ✓ Narrow `expectedRPID: string;` lines: **0** (==0)
- ✓ Typecheck green
- ✓ `passkey.test.ts` passes unchanged
- ✓ Full suite green

## Decisions Made

- Followed plan as specified — Pattern Assignment #6 from `12-PATTERNS.md` was applied verbatim. JSDoc text matches the plan's `<interfaces>` block exactly.
- Used `git commit --no-verify` per the worktree parallel-execution protocol; orchestrator validates hooks once after merge.

## Deviations from Plan

None — plan executed exactly as written. Function bodies were already passing `expectedOrigin` / `expectedRPID` verbatim per the planner's `[VERIFIED]` note (12-PATTERNS.md line 458; 12-RESEARCH.md Pattern 3 lines 388-391), so no transformation needed to be removed.

## Issues Encountered

None.

## Next Phase Readiness

- Plan 12-04 (Wave 3) can now reference the widened types to:
  1. Spread the validated `relatedOrigins` arrays into the standalone exports from `passkey.ts` (the `createAnonAuth` upstream validation path).
  2. Add positive compile fixtures asserting both string and string[] forms type-check on both interfaces.
- No blockers. The standalone export surface is ready for Plan 04's wiring; the backwards-compat asserter (`passkey.test.ts`) confirms the type widening is non-breaking.

## Self-Check: PASSED

Verified post-write:

- File modified `src/server/webauthn.ts` — FOUND (`git show 4094e36 --stat`).
- Commit `4094e36` — FOUND in `git log --oneline`.
- SUMMARY file `.planning/phases/12-multi-rp-id-verification/12-03-SUMMARY.md` — written.

---
*Phase: 12-multi-rp-id-verification*
*Plan: 03*
*Completed: 2026-04-29*
