---
phase: 12-multi-rp-id-verification
verified: 2026-04-29T19:14:00Z
status: passed
score: 5/5 success criteria verified; 5/5 RPID requirements satisfied
overrides_applied: 0
re_verification: false
---

# Phase 12: Multi-RP_ID Verification — Verification Report

**Phase Goal (from ROADMAP.md):** Accept passkey assertions from multiple related origins (cross-domain passkey support via WebAuthn Related Origin Requests) without opening an origin-spoofing surface. Fully orthogonal to the hook phases.

**Verified:** 2026-04-29T19:14:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth                                                                                                                                                                                                  | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | A consumer configuring `rp.relatedOrigins: [...]` at `createAnonAuth()` startup verifies passkey assertions arriving from any listed origin                                                            | VERIFIED  | `src/server/passkey.ts:183-188,294-299` — both `verifyRegistrationResponse` and `verifyAuthenticationResponse` calls use the conditional-spread idiom passing `[config.origin, ...config.relatedOrigins.map(r => r.origin)]` and `[config.rpId, ...config.relatedOrigins.map(r => r.rpId)]`. Library `@simplewebauthn/server@13.x` accepts `string \| string[]` natively.       |
| 2   | A consumer passing a malformed `relatedOrigins` (wildcard, non-https, host not suffix-domain of rpId, more than 5 entries) sees `createAnonAuth()` throw with a classified message at startup           | VERIFIED  | `src/server/relatedOrigins.ts:45-104` implements 7 validation branches with classified `Error` messages. `src/server/index.ts:136-140` calls `validateRelatedOrigins` AFTER rpConfig resolution and BEFORE `createPasskeyManager`. Integration test `RPID-02 / RPID-03: createAnonAuth startup validation (fail-fast)` exercises max-5, wildcard, suffix-domain throws — passes. |
| 3   | An attacker on `evil.com` forging an assertion with a spoofed `clientDataJSON.origin` against a multi-RP_ID-enabled instance gets `verified: false` from `verifyAuthenticationResponse`                  | VERIFIED  | The library's `expectedOrigin.includes(origin)` check rejects forged origins not in the configured list (verified in 12-RESEARCH.md against `verifyAuthenticationResponse.js:71-81`). The conditional-spread at `passkey.ts:294-299` preserves pairing by tuple ORDER (inline `.map()` calls iterate the same array twice — Pitfall 1 mitigation; no intermediate variables). |
| 4   | A consumer importing standalone `verifyRegistration()` / `verifyAuthentication()` can pass `expectedRPID` and `expectedOrigin` as `string \| string[]`; existing `string` form continues to compile/verify identically | VERIFIED  | `src/server/webauthn.ts:98,103,172,175` — both `VerifyRegistrationInput` and `VerifyAuthenticationInput` declare `expectedOrigin: string \| string[]` and `expectedRPID: string \| string[]`. Function bodies pass values verbatim (no `Array.isArray` branching — verified). 4 compile-fixture tests in `related-origins.test.ts` confirm both forms.                            |
| 5   | A consumer reading the README finds the `/.well-known/webauthn` consumer responsibility documented (library does NOT auto-host) with links to passkeys.dev and W3C Passkey Endpoints spec, plus a JSON skeleton | VERIFIED  | `README.md:91-189` — top-level "## Cross-Domain Passkeys (v0.7.0)" section with: `library does NOT auto-host` warning at line 114; `/.well-known/webauthn` URL pattern (lines 117, 132); JSON skeleton (lines 120-128); links to passkeys.dev (lines 187), web.dev (188), and W3C WebAuthn Level 3 (189); browser support, paired-tuple security note.                          |

**Score:** 5/5 truths VERIFIED

### Required Artifacts

| Artifact                              | Expected                                                                                            | Status     | Details                                                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/index.ts`                  | `RelatedOrigin` paired-tuple interface (both fields required); `AnonAuthConfig.rp.relatedOrigins?:` | VERIFIED  | Interface declared at line 80 with `origin: string` and `rpId: string` both required; `relatedOrigins?: RelatedOrigin[]` at line 125 inside `AnonAuthConfig.rp` block.                          |
| `src/server/index.ts`                 | `RelatedOrigin` in re-export block; `validateRelatedOrigins` import + call; `relatedOrigins` thread-through | VERIFIED  | `RelatedOrigin` re-exported at line 261; `validateRelatedOrigins` imported at line 40 and called at line 136-140; `relatedOrigins: validatedRelatedOrigins` threaded into `createPasskeyManager` at line 147. |
| `src/server/relatedOrigins.ts`        | Single named export `validateRelatedOrigins`; pure synchronous; defensive copy; classified throws    | VERIFIED  | 104 lines; single `export function validateRelatedOrigins`; `return [...entries]` at line 103; 7 throw branches; no I/O, no logger, no async.                                                   |
| `src/server/passkey.ts`               | `PasskeyConfig.relatedOrigins: readonly RelatedOrigin[]` REQUIRED; conditional-spread at both verify call sites | VERIFIED  | Line 50 — REQUIRED (no `?`). Conditional-spread at lines 183-188 (registration) and 294-299 (authentication); 4 occurrences of `config.relatedOrigins.length === 0` (2 fields × 2 sites).      |
| `src/server/webauthn.ts`              | `VerifyRegistrationInput` and `VerifyAuthenticationInput` widened to `string \| string[]`            | VERIFIED  | Lines 98, 103, 172, 175 — all 4 fields widened. Function bodies untouched.                                                                                                                       |
| `src/__tests__/exports.test.ts`       | Compile-time + source-level RPID-01 type re-export assertions                                       | VERIFIED  | `describe('RPID-01: RelatedOrigin type is re-exported from /server', ...)` with `const ro: RelatedOrigin = {...}` (compile-time) and source-level grep guard.                                  |
| `src/__tests__/related-origins.test.ts` | Wave 0 unit tests + integration tests + RPID-04 compile fixtures                                  | VERIFIED  | 29 tests across 6 describe blocks: happy/negative/invariant for validateRelatedOrigins (Block 1-3), createAnonAuth startup integration (Block 4), source-level conditional-spread invariant (Block 5), RPID-04 string/string[] compile fixtures (Block 6). All passing. |
| `README.md`                           | "## Cross-Domain Passkeys (v0.7.0)" section with JSON skeleton, hosting requirements, library-not-auto-host callout, references | VERIFIED  | Lines 91-189; all required content present.                                                                                                                                                    |

### Key Link Verification

| From                                     | To                                                  | Via                                  | Status | Details                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------- | ------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/index.ts:AnonAuthConfig.rp`   | `src/types/index.ts:RelatedOrigin`                  | optional structural reference        | WIRED  | `relatedOrigins?: RelatedOrigin[]` at line 125 references the interface declared at line 80.                                                                                              |
| `src/server/index.ts` re-export block    | `src/types/index.ts:RelatedOrigin`                  | type re-export                       | WIRED  | Line 261 `RelatedOrigin,        // Phase 12 RPID-01 re-export` inside `export type { ... } from '../types/index.js'`.                                                                    |
| `src/server/relatedOrigins.ts`           | `src/types/index.ts:RelatedOrigin`                  | type-only import                     | WIRED  | Line 12 `import type { RelatedOrigin } from '../types/index.js'`.                                                                                                                         |
| `src/server/index.ts:createAnonAuth`     | `src/server/relatedOrigins.ts:validateRelatedOrigins` | startup call before createPasskeyManager | WIRED  | Line 40 import; line 136 call; runs after rpConfig resolution (line 127-131), before createPasskeyManager (line 142).                                                                    |
| `src/server/index.ts:createPasskeyManager call` | `src/server/passkey.ts:PasskeyConfig.relatedOrigins` | factory thread-through               | WIRED  | Line 147 `relatedOrigins: validatedRelatedOrigins` appended to createPasskeyManager opts.                                                                                                  |
| `src/server/passkey.ts:finishRegistration` | `@simplewebauthn/server:verifyRegistrationResponse` | conditional-spread (string \| string[]) | WIRED  | Lines 180-189 conditional-spread idiom; 2 fields each with `config.relatedOrigins.length === 0` ternary.                                                                                  |
| `src/server/passkey.ts:finishAuthentication` | `@simplewebauthn/server:verifyAuthenticationResponse` | conditional-spread (string \| string[]) | WIRED  | Lines 291-299 conditional-spread idiom; 2 fields each with `config.relatedOrigins.length === 0` ternary.                                                                                  |
| `src/__tests__/related-origins.test.ts`  | `src/server/relatedOrigins.ts:validateRelatedOrigins` | value import                         | WIRED  | Line 17 `import { validateRelatedOrigins } from '../server/relatedOrigins.js'`.                                                                                                           |

All key links WIRED.

### Data-Flow Trace (Level 4)

| Artifact                              | Data Variable                | Source                                        | Produces Real Data | Status   |
| ------------------------------------- | ---------------------------- | --------------------------------------------- | ------------------ | -------- |
| `passkey.ts:finishRegistration`       | `config.relatedOrigins`      | `createPasskeyManager` opts threaded from `createAnonAuth` after `validateRelatedOrigins(config.rp?.relatedOrigins, …)` | Yes (defensive copy of consumer config or `[]`) | FLOWING  |
| `passkey.ts:finishAuthentication`     | `config.relatedOrigins`      | Same source as above                          | Yes                | FLOWING  |
| `relatedOrigins.ts:validateRelatedOrigins` | `entries`                | Consumer's `config.rp?.relatedOrigins`        | Yes (consumer config) | FLOWING  |

Data flow is end-to-end: consumer config → factory → validator (defensive copy) → `PasskeyConfig.relatedOrigins` → conditional-spread at verify call sites. The empty-array path preserves byte-identical v0.6.1 string-form behavior; the populated-array path passes paired `string[]` arrays with primary at index 0.

### Behavioral Spot-Checks

| Behavior                                                                                  | Command                                                                          | Result | Status |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------ | ------ |
| TypeScript compilation across the phase                                                   | `nvm use 20 && npm run typecheck`                                                | exit 0 | PASS   |
| Phase-specific test suite passes                                                          | `nvm use 20 && npm test -- --run src/__tests__/related-origins.test.ts`           | 29/29 pass | PASS   |
| Existing exports test still validates RPID-01 type re-export                              | `nvm use 20 && npm test -- --run src/__tests__/exports.test.ts`                   | 12/12 pass | PASS   |
| Backwards-compat: existing passkey tests continue to pass (string-form path)              | `nvm use 20 && npm test -- --run src/__tests__/passkey.test.ts`                   | 22/22 pass | PASS   |
| Full vitest suite — no regressions across the codebase                                    | `nvm use 20 && npm test -- --run`                                                | 330/334 pass (4 skipped, 0 failed) | PASS |
| Build succeeds (esbuild + DTS)                                                            | `nvm use 20 && npm run build`                                                    | exit 0; .d.ts/.d.cts files emitted | PASS |
| Conditional-spread present 4× in passkey.ts (2 fields × 2 sites)                          | `grep -c "config.relatedOrigins.length === 0" src/server/passkey.ts`              | 4 | PASS |
| No nullish-coalescing fallback (catches dropped factory field)                            | `grep -c "config.relatedOrigins ?? \[\]" src/server/passkey.ts`                   | 0 | PASS |
| validateRelatedOrigins called exactly once at startup                                     | `grep -c "validateRelatedOrigins(" src/server/index.ts`                            | 1 | PASS |
| README invariants — Cross-Domain Passkeys section + auto-host warning                     | `grep -q "## Cross-Domain Passkeys (v0.7.0)" README.md && grep -q "library does NOT auto-host" README.md` | exit 0 | PASS |

All behavioral spot-checks PASS.

### Requirements Coverage

| Requirement | Source Plan(s)               | Description                                                                                                                                                                                                                       | Status     | Evidence                                                                                                                                                                |
| ----------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPID-01     | 12-01                        | `AnonAuthConfig.rp.relatedOrigins?: Array<{ origin: string; rpId: string }>` accepts paired tuples; default `[]` ≡ v0.6.1 behavior                                                                                                  | SATISFIED  | `src/types/index.ts:80-87` (interface) and `:113-126` (config field); both `RelatedOrigin` fields required; field optional on `AnonAuthConfig.rp`.                       |
| RPID-02     | 12-02, 12-04                 | Library validates `relatedOrigins` at `createAnonAuth()` startup: scheme, wildcards, suffix-domain, max 5; classified throws                                                                                                       | SATISFIED  | `src/server/relatedOrigins.ts` 7 validation branches; `src/server/index.ts:136-140` startup call; integration test Block 4 verifies fail-fast.                            |
| RPID-03     | 12-04                        | `verifyRegistrationResponse` and `verifyAuthenticationResponse` calls in `passkey.ts` pass paired arrays with primary at index 0                                                                                                    | SATISFIED  | `src/server/passkey.ts:183-188,294-299` conditional-spread; primary at index 0; inline `.map()` preserves pairing by tuple order. Source-level invariant test Block 5 enforces. |
| RPID-04     | 12-03, 12-04                 | Standalone `verifyRegistration()` / `verifyAuthentication()` types widen `expectedRPID`/`expectedOrigin` to `string \| string[]`; string form preserved                                                                            | SATISFIED  | `src/server/webauthn.ts:98,103,172,175` widened; function bodies pass through verbatim. Block 6 compile fixtures (4 it() blocks) cover both shapes.                      |
| RPID-05     | 12-04                        | README documents `/.well-known/webauthn` consumer responsibility; library NOT auto-host; links to passkeys.dev and W3C; JSON skeleton                                                                                                | SATISFIED  | `README.md:91-189` Cross-Domain Passkeys section with all required elements verified by grep.                                                                            |

All 5 RPID requirements declared in PLAN frontmatter are SATISFIED. No orphaned requirements (REQUIREMENTS.md maps RPID-01..05 to Phase 12; all are claimed by plans 12-01..12-04).

### Anti-Patterns Found

| File                                | Line | Pattern                                                                                                                                                                              | Severity | Impact |
| ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ |
| —                                   | —    | No TODO/FIXME/PLACEHOLDER comments in any phase 12 source file. No stub implementations. No empty handlers.                                                                          | —        | —      |

The phase 12 code review (`12-REVIEW.md`) found 6 WARNING-class issues (WR-01..WR-06) in the validator's permissiveness (HTTPS regex admits userinfo, case-sensitivity gaps, no inter-entry duplicate detection, etc.) and 4 INFO items. None are BLOCKER-class — the reviewer explicitly states: "All findings are WARNING-class (degrade quality, robustness, or DX) or INFO. None are BLOCKER-class (no exploit, no data loss, no crash on supported input). The phase is shippable, but the warnings should be addressed before this becomes a stable v0.7.0 surface." These quality concerns do NOT prevent goal achievement — they refine the validator's failure modes. They are tracked as INFO-level observations here and should be considered for follow-up before the v0.7.0 release tag.

### Human Verification Required

None. All success criteria are observable through automated checks (typecheck, vitest, source-level greps). The integration test (`RPID-02 / RPID-03: createAnonAuth startup validation (fail-fast)`) exercises construction-time throws with real `createAnonAuth` calls; backwards-compat is asserted through the existing 22 `passkey.test.ts` cases (all use empty `relatedOrigins`).

The library's runtime defense against forged origins (Truth #3) relies on `@simplewebauthn/server`'s `expectedOrigin.includes(origin)` check, which is verified by the library's own test suite and confirmed in 12-RESEARCH.md against the library source. A live attack-simulation test against a real authenticator is out of scope for the wrapper library.

### Gaps Summary

No gaps. Phase 12 goal is achieved end-to-end:

1. The paired-tuple type contract (Plan 01) prevents index-drift at the type level
2. The startup validator (Plan 02) rejects malformed configs with classified messages before any factory runs
3. The standalone-export widening (Plan 03) lets framework-agnostic consumers use cross-domain passkey support
4. The integration plan (Plan 04) wires it all together: validates at startup in `createAnonAuth`, threads validated arrays into `PasskeyConfig`, applies the conditional-spread idiom at both verify call sites, and documents the consumer-owned `/.well-known/webauthn` contract in the README

The conditional-spread idiom (`length === 0 ? string : [primary, ...mapped]`) is the critical invariant: when `relatedOrigins` is omitted, the runtime path is byte-identical to v0.6.1 (string form passed to library, not single-element array). When `relatedOrigins` is configured, paired arrays flow through with the primary rp at index 0.

The 6 WARNING-class review findings (WR-01..WR-06) are validator-permissiveness concerns (regex looseness, case sensitivity, no inter-entry duplicate detection, parallel-array footgun on the standalone API). They refine validator failure modes and do not prevent the phase goal from being achieved — they are quality-of-implementation concerns the team should address before tagging v0.7.0 stable. They are NOT gaps against this phase's success criteria.

---

_Verified: 2026-04-29T19:14:00Z_
_Verifier: Claude (gsd-verifier)_
