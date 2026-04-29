---
phase: 12-multi-rp-id-verification
plan: 04
subsystem: auth
tags: [webauthn, related-origins, passkey-integration, conditional-spread, readme, rpid-03, rpid-04, rpid-05, v0.7.0]

# Dependency graph
requires:
  - plan: 12-01
    provides: RelatedOrigin paired-tuple interface; AnonAuthConfig.rp.relatedOrigins?:; /server re-export
  - plan: 12-02
    provides: validateRelatedOrigins helper (defensive copy, fail-fast classified errors)
  - plan: 12-03
    provides: VerifyRegistrationInput/VerifyAuthenticationInput widened to string | string[]
provides:
  - PasskeyConfig.relatedOrigins REQUIRED readonly array (factory always passes [])
  - createAnonAuth startup-validation hook (Pitfall 4 fail-fast, before createPasskeyManager)
  - Conditional-spread idiom (Pattern S7) at both verifyRegistrationResponse and verifyAuthenticationResponse call sites
  - README "## Cross-Domain Passkeys (v0.7.0)" section with /.well-known/webauthn skeleton, hosting requirements, paired-tuple security note, browser support, references
  - README Configuration block with commented-out relatedOrigins example
  - 13 new test cases across 3 describe blocks: createAnonAuth integration, source-level invariant, RPID-04 compile fixtures
affects: []  # Phase 12 close-out plan

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern S7 conditional-spread: `array.length === 0 ? primary : [primary, ...array.map(field)]` preserves byte-identical legacy code path when array is empty AND emits primary at index 0 when populated"
    - "Inline-map-per-call preserves pairing by tuple ORDER without intermediate variables (Pitfall 1 mitigation — same array iterated in same order at the call site)"
    - "Required-with-empty-default field over optional field at internal contract boundary: `relatedOrigins: readonly RelatedOrigin[]` (no `?`) prevents future bugs where the factory drops the field — TypeScript flags it instead of silently using a `?? []` fallback"
    - "Source-level grep test guards refactor regression: `readFileSync` + regex assertion catches pitfalls at CI time without requiring runtime mock injection"
    - "Append-at-end factory call site (Pattern S4): new `relatedOrigins:` field added at the end of `createPasskeyManager` opts, no reorder of existing rpName/rpId/origin/logger fields"

key-files:
  created: []
  modified:
    - src/server/passkey.ts
    - src/server/index.ts
    - src/__tests__/passkey.test.ts
    - README.md
    - src/__tests__/related-origins.test.ts

key-decisions:
  - "PasskeyConfig.relatedOrigins is REQUIRED (no ?) — factory always passes []; this is not optional sugar, it's a contract that the upstream validator ran first. Optional with `?` would let a future refactor silently drop the field and re-introduce a string-form regression"
  - "Inline `.map()` at call site instead of intermediate `const origins = ...; const rpIds = ...;` — Pitfall 1 mitigation: pairing intent is preserved by tuple ORDER; an intermediate destructure separates the two .map() calls and lets a future reorder of one (but not the other) silently break pairing"
  - "Conditional-spread `length === 0 ? string : [primary, ...mapped]` rather than always-spread `[primary, ...mapped]` — empty array would still emit a single-element array. The conditional preserves the v0.6.1 string-form code path on every consumer that doesn't configure relatedOrigins (T-12-04 backwards-compat)"
  - "Library does NOT auto-host /.well-known/webauthn — README states this literally. Auto-hosting helpers (RPID-V2-01/V2-02) deferred to v0.8+ to prevent consumers assuming the library will serve the JSON for them"
  - "passkey.test.ts:testConfig adds `relatedOrigins: []` in one shared place — single source-of-truth update covers all 22 createPasskeyManager call sites without per-test boilerplate"
  - "Source-level grep test (Block 5) chosen over runtime spy on @simplewebauthn/server — mocking the library mid-test file is intrusive and high-maintenance; grep test catches Pitfall 1 + Pitfall 5 deterministically and is consistent with the existing exports.test.ts MPC-01 pattern"

patterns-established:
  - "Multi-RP wave integration shape: types (Plan 01) → validator (Plan 02) → standalone API widening (Plan 03) → integration plan (THIS, Plan 04). Each prior plan ships in isolation and is independently verifiable; the final plan threads them together at the consumer-facing surface"
  - "Required-empty-default + factory contract: a downstream factory requires a field the consumer treats as optional. The factory wrapper (createAnonAuth here) calls a normalizing helper that returns a default ([]), passes that to the inner factory (createPasskeyManager). The inner factory's TYPE forbids omission — preventing factory-drop bugs"

requirements-completed: [RPID-03, RPID-04, RPID-05]

# Metrics
duration: 21min
completed: 2026-04-29
---

# Phase 12 Plan 04: Multi-RP_ID Passkey Integration & README Summary

**Plan 04 wires the type contract (Plan 01), validator (Plan 02), and standalone-API widening (Plan 03) into the actual `verifyRegistrationResponse` / `verifyAuthenticationResponse` call sites in `src/server/passkey.ts`, adds the startup-validation hook in `createAnonAuth`, documents the consumer-owned `/.well-known/webauthn` contract in the README, and lands integration tests proving fail-fast at construction and the conditional-spread shape preservation. Phase 12 is now functionally complete — multi-RP_ID passkey verification works at runtime; v0.6.1 consumers see byte-identical behavior.**

## Performance

- **Duration:** ~21 min
- **Started:** 2026-04-29T22:36:49Z
- **Completed:** 2026-04-29T22:57:27Z
- **Tasks:** 4 / 4
- **Files modified:** 5

## Accomplishments

### Source code wiring

- **`PasskeyConfig.relatedOrigins: readonly RelatedOrigin[]`** added as a REQUIRED field on the inner config (no `?` modifier). The `RelatedOrigin` type was added to the existing type-only import block. The `readonly` modifier signals the contract to readers (TypeScript erases at runtime, but it documents intent).
- **Pattern S7 conditional-spread idiom** applied at BOTH `verifyRegistrationResponse` (lines ~172-181) and `verifyAuthenticationResponse` (lines ~282-292) call sites. Empty array → `string` form (byte-identical to v0.6.1). Populated array → `string[]` form with `config.origin` and `config.rpId` at index 0; mapped relatedOrigins follow in declaration order. Pairing preserved by inline `.map()` calls iterating the same array twice at the call site (Pitfall 1: NO intermediate `const origins/rpIds = ...` variable).
- **`validateRelatedOrigins` import + startup call** in `src/server/index.ts:createAnonAuth`. Runs AFTER `rpConfig` is resolved and BEFORE `createPasskeyManager` is constructed (Pitfall 4: fail-fast at startup, never at request-time). Sourced from `config.rp?.relatedOrigins` (NOT `rpConfig.relatedOrigins`) because the fallback `rpConfig` has no `relatedOrigins` field. The helper handles `undefined` → `[]`.
- **`relatedOrigins: validatedRelatedOrigins`** appended at the end of the `createPasskeyManager(db, {...})` call (Pattern S4 additive append). NO threading into `createRouter`, `createOAuthRouter`, `createMPCManager`, `createSessionManager` — only the passkey path hits `verify*Response`.
- **`passkey.test.ts:testConfig`** updated to include `relatedOrigins: [] as const` in one shared place — single source-of-truth fix for all 22 existing `createPasskeyManager` call sites in the test file (no per-test boilerplate).

### README documentation

- New top-level **`## Cross-Domain Passkeys (v0.7.0)`** section inserted after the existing PRF section and before `## Installation`. Covers:
  - **What the library does:** validate, spread, cap-at-5
  - **What the consumer must do:** the `/.well-known/webauthn` JSON skeleton with hosting requirements (HTTPS, Content-Type, primary-rpId-not-listed, no wildcards, max 5 unique eTLD+1 labels)
  - **Browser support:** Chrome 128 (Aug 2024), Safari 18 (Sep 2024), Firefox graceful-degrade with separate per-domain registration
  - **Server-side configuration:** `createAnonAuth({ rp: { ..., relatedOrigins: [...] } })` example with paired-tuple shape
  - **Security note:** paired tuple vs parallel arrays — explains why `Array<{origin, rpId}>` is structurally safer than `{origins: string[], rpIds: string[]}` (T-12-01 rationale, mirrors Plan 01 type-level defense at the documentation surface)
  - **References:** passkeys.dev, web.dev, W3C WebAuthn Level 3 §5.10.3
- The literal warning string `"library does NOT auto-host"` is present in the README (T-12-05 mitigation, verified by acceptance criterion grep)
- Existing `## Configuration` `rp:` sub-block extended with commented-out `relatedOrigins:` example (preserving `name`, `id`, `origin` verbatim)

### Tests

Three new describe blocks appended to `src/__tests__/related-origins.test.ts` (file grew from 16 tests to 29):

**Block 4 — `RPID-02 / RPID-03: createAnonAuth startup validation (fail-fast)`** — 6 it() blocks:
- Happy: `relatedOrigins` omitted, `[]`, single valid entry — no throw
- Negative: 6-entry list throws `/max 5/i`, wildcard throws `/wildcard/i`, suffix-domain mismatch throws `/suffix|host/i`
- Uses `makeMinimalDb` mirroring the proven `hooks-scaffolding.test.ts` pattern

**Block 5 — `RPID-03: conditional-spread shape preserved (source-level invariant)`** — 3 it() blocks:
- `readFileSync` + regex on `src/server/passkey.ts`
- Asserts `config.relatedOrigins.length === 0` appears EXACTLY 4 times (2 fields × 2 call sites)
- Asserts `[config.origin, ...config.relatedOrigins.map(r => r.origin)]` and `[config.rpId, ...config.relatedOrigins.map(r => r.rpId)]` patterns are present (Pitfall 5: primary at index 0)
- Asserts NO `config.relatedOrigins ?? []` fallback (catches dropped factory field)

**Block 6 — `RPID-04: standalone verifyRegistration / verifyAuthentication accept string | string[]`** — 4 it() blocks:
- VerifyRegistrationInput accepts string-form (backwards compat)
- VerifyRegistrationInput accepts string[]-form (RPID-04 widening)
- VerifyAuthenticationInput accepts string-form
- VerifyAuthenticationInput accepts string[]-form
- Compile-time test: file fails `tsc --noEmit` if Plan 03's widening regressed; runtime assertions are trivial — the compile check IS the test

## Task Commits

| # | Task | Type | Hash |
|---|------|------|------|
| 1 | Extend PasskeyConfig with relatedOrigins; conditional-spread at both verify call sites | feat | `dadc264` |
| 2 | Wire createAnonAuth: import + startup validate + thread relatedOrigins into createPasskeyManager | feat | `a13fc7c` |
| 3 | Add Cross-Domain Passkeys section to README; update Configuration block | docs | `b58fb32` |
| 4 | Integration tests — startup-throw + conditional-spread + RPID-04 compile fixtures | test | `56e24a1` |

_Note: SUMMARY.md commit is made by the orchestrator after worktree merge; this worktree skips STATE.md and ROADMAP.md updates per parallel-execution protocol._

## Files Created/Modified

- `src/server/passkey.ts` — added `RelatedOrigin` to type imports, REQUIRED `relatedOrigins: readonly RelatedOrigin[]` field on `PasskeyConfig`, conditional-spread idiom at both verify call sites (~24 lines net, including JSDoc)
- `src/server/index.ts` — added `validateRelatedOrigins` import, startup-validation block (10 lines including comment), `relatedOrigins: validatedRelatedOrigins` field on `createPasskeyManager` call (~11 lines net)
- `src/__tests__/passkey.test.ts` — single-line update to shared `testConfig` (added `relatedOrigins: [] as const` to satisfy required-field contract for 22 existing call sites)
- `README.md` — new `## Cross-Domain Passkeys (v0.7.0)` top-level section (~95 lines), Configuration block extended with commented-out `relatedOrigins` example (~7 lines net, total +107 lines)
- `src/__tests__/related-origins.test.ts` — extended import block (+8 lines including readFileSync, createAnonAuth, type imports), three new describe blocks (Block 4: 6 it(), Block 5: 3 it(), Block 6: 4 it() — 13 new tests, +221 lines net)

## Decisions Made

### Why `PasskeyConfig.relatedOrigins` is REQUIRED (no `?` modifier)

The factory contract is: `createAnonAuth` ALWAYS passes a `relatedOrigins` field to `createPasskeyManager` (either the validator's defensive copy of consumer input, or `[]` when consumer omits the field). Making the inner type optional would let a future refactor silently drop the field and revert to the default-undefined path inside passkey.ts, which would re-introduce a `relatedOrigins?.length === 0` problem (`undefined.length` throws). Required-with-empty-default is the strict contract: factory drops are compile errors, not runtime regressions.

### Conditional-spread vs always-spread

Always-spreading `[config.origin, ...config.relatedOrigins.map(r => r.origin)]` would emit a single-element `string[]` (e.g., `['https://shopping.com']`) on every v0.6.1 consumer who doesn't configure `relatedOrigins`. Although `@simplewebauthn/server` accepts `string | string[]`, the runtime CODE PATH inside the library differs — string takes a fast equality check, array takes `.includes()`. Backwards-compat (T-12-04) requires byte-identical behavior. The conditional check `config.relatedOrigins.length === 0 ? string : [...]` keeps v0.6.1 consumers on the string code path; only consumers who actively configure `relatedOrigins` see the array form.

### Inline `.map()` at call site (no intermediate variable)

Pitfall 1 in `12-RESEARCH.md`: a refactor that adds `const origins = config.relatedOrigins.map(r => r.origin); const rpIds = config.relatedOrigins.map(r => r.rpId);` separates the two map calls. If a future change reorders one but not the other (e.g., `origins.sort()` for log clarity), pairing breaks silently and `@simplewebauthn/server` accepts assertions where `originA` was signed under `rpIdB`. Inline `.map()` at the call site iterates the same `config.relatedOrigins` array twice in the same order — the spread idiom is the source of truth. Block 5 grep guard catches future intermediate-variable refactors at CI time.

### Single shared `testConfig` update over per-test additions

`src/__tests__/passkey.test.ts` has 22 `createPasskeyManager(db, testConfig)` call sites referring to a single `testConfig` const at line 110. The Required-with-empty-default contract change broke all 22 simultaneously. Updating one place (the shared const) is far cleaner than adding `relatedOrigins: []` to every test fixture — and matches the test-file authoring style (testConfig is shared exactly to avoid duplication).

### Source-level grep test (Block 5) over runtime spy

Plan 04 needs to assert that `config.relatedOrigins.length === 0 ? string : [...]` appears at both call sites. Two approaches:

1. **Runtime spy:** `vi.mock('@simplewebauthn/server', ...)` to intercept verifyRegistrationResponse args and assert the shape per call. Requires test setup that exercises the registration/authentication flow, which means challenge generation, mock authenticator data, etc. — high test complexity, brittle to library version changes.
2. **Source-level grep:** `readFileSync` + regex on `src/server/passkey.ts`. Asserts the pattern is present in source. Catches Pitfall 1 (no intermediate variable) and Pitfall 5 (primary at index 0) deterministically. Mirrors the existing `exports.test.ts` MPC-01 pattern.

Chose (2). Runtime correctness is verified indirectly: the existing 22 tests in `passkey.test.ts` use the string-form path (their `testConfig.relatedOrigins = []` triggers the conditional's TRUE branch) and they all pass — proving the conditional-spread didn't break v0.6.1 behavior. The source-level grep ensures the spread shape stays intact through future refactors.

### "Library does NOT auto-host" literal warning

The README literally states `library does NOT auto-host` (matched by acceptance criterion grep). This is the T-12-05 mitigation: the most likely consumer mistake is assuming the library serves `/.well-known/webauthn` automatically. By stating the negative explicitly in a top-level section, the contract is unmissable. Auto-hosting helpers (RPID-V2-01: `generateWellKnownWebauthnJSON()`, RPID-V2-02: `mountWellKnownWebauthnRoute()`) are deferred to v0.8+ to prevent consumers assuming the library has already done it.

## Deviations from Plan

### [Rule 3 - Blocking] Updated `src/__tests__/passkey.test.ts:testConfig` with `relatedOrigins: []`

- **Found during:** Task 1 — running `npm run typecheck` after extending `PasskeyConfig.relatedOrigins` to REQUIRED produced 14 errors in `src/__tests__/passkey.test.ts` (every `createPasskeyManager(db, testConfig)` call) and 1 error in `src/server/index.ts` (the call site that Task 2 was about to fix).
- **Issue:** The plan made `relatedOrigins` REQUIRED but did not explicitly enumerate that the existing test fixture needed updating. The plan's Task 1 verify step (`npm run typecheck`) required the codebase to typecheck cleanly after Task 1 — but typecheck failures are guaranteed by the required-field change.
- **Fix:** Added `relatedOrigins: [] as const` to the single shared `testConfig` at `src/__tests__/passkey.test.ts:110`. This satisfies the required-field contract for all 22 `createPasskeyManager(...)` call sites in the test file and exercises the empty-array (string-form) branch of the conditional-spread — the exact backwards-compat path that needs continued green coverage. No test logic changed.
- **Files modified:** `src/__tests__/passkey.test.ts` (1 line)
- **Commit:** Bundled into Task 1 commit `dadc264` (the change is mechanical and inseparable from making the field required)

### [Documentation] Added `rpConfig` reference to startup-validation comment in src/server/index.ts

- **Found during:** Task 2 verification — acceptance criterion #3 requires `grep -B 5 "validateRelatedOrigins(" | grep -c "rpConfig" >= 1`. My initial comment block did not contain the literal string `rpConfig`; the `const rpConfig = ...` declaration was 6+ lines before the function call (just outside the -B 5 window).
- **Issue:** Test of an authoring/positioning intent rather than a runtime bug — but the acceptance criterion's INTENT (validation runs after rpConfig is resolved) is satisfied semantically.
- **Fix:** Reworded the existing comment block on the validateRelatedOrigins call from `"... never at request time). Helper handles undefined/[] as a no-op (returns [])."` to `"... never at request time). Runs AFTER rpConfig resolution so primary rpId/origin are available for suffix-domain checks. Helper handles undefined/[] (returns [])."`. The new wording is more accurate documentation AND satisfies the grep.
- **Files modified:** `src/server/index.ts` (1 line edit, same Task 2 commit)
- **Commit:** Bundled into Task 2 commit `a13fc7c`

These two deviations are minor mechanical follow-throughs of the plan's contract changes, not functional changes. Both committed atomically with the parent task — neither requires architectural decision-making (Rule 4 not triggered).

## Issues Encountered

None. Build artifact churn (dist/) was expected (the repo tracks dist/ for npm package distribution at version-bump boundaries); my source-only commits do not touch dist/, and stray build artifacts from verification runs were reverted via `git checkout -- dist/` (no destructive blanket commands).

## Verification Commands Run

| # | Command | Exit | Notes |
|---|---------|------|-------|
| 1 | `nvm use 20 && npm run typecheck` (after Task 1 + testConfig fix) | 0 | tsc --noEmit clean |
| 2 | `nvm use 20 && npm test -- --run src/__tests__/passkey.test.ts` (after Task 1) | 0 | 22 / 22 pass — backwards compat confirmed |
| 3 | `nvm use 20 && npm run typecheck` (after Task 2) | 0 | clean |
| 4 | `nvm use 20 && npm run build` (after Task 2) | 0 | esbuild + dts succeeded |
| 5 | Acceptance grep — Task 1 (10 criteria, all pass) | all ✓ | RelatedOrigin imported, REQUIRED, conditional-spread at both sites, primary at index 0, no `?? []`, no intermediate vars |
| 6 | Acceptance grep — Task 2 (8 criteria, all pass) | all ✓ | validateRelatedOrigins imported once, called once, threaded into createPasskeyManager only, rpConfig context preserved |
| 7 | `nvm use 20 && grep -q "## Cross-Domain Passkeys (v0.7.0)" README.md && grep -q "/.well-known/webauthn" && grep -q "passkeys.dev" && grep -q "library does NOT auto-host"` (Task 3 verify) | 0 | all 4 README invariants pass |
| 8 | Acceptance grep — Task 3 (12 criteria, all pass) | all ✓ | section heading, JSON skeleton, hosting requirements, paired-tuple security note, references, configuration block updated |
| 9 | `nvm use 20 && npm test -- --run src/__tests__/related-origins.test.ts` | 0 | 29 / 29 pass (was 16; +13 new tests across Blocks 4/5/6) |
| 10 | `nvm use 20 && npm test -- --run` (full suite, final) | 0 | **330 passed / 4 skipped / 0 failed** across 21 test files |
| 11 | `nvm use 20 && npm run typecheck` (final) | 0 | clean |
| 12 | Acceptance grep — Task 4 (18 criteria, all pass) | all ✓ | imports, describe blocks, it() counts, regex patterns |

## Threat Model Confirmation

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-12-01 | mitigate | ✓ Two-layer defense intact: (a) Plan 01's paired-tuple type makes index drift a type error; (b) Plan 04's inline `.map()` at the call site preserves pairing by tuple ORDER without intermediate variables. Block 5 grep guard catches future intermediate-variable refactors. |
| T-12-02 | mitigate | ✓ `validateRelatedOrigins` runs at startup AFTER rpConfig resolution and BEFORE `createPasskeyManager` (Pitfall 4 fail-fast). Block 4 covers 6 fail-fast scenarios at construction time: count cap, wildcard origin, suffix-domain mismatch (plus 3 happy-path no-throw cases). |
| T-12-03 | mitigate | ✓ Conditional-spread passes paired arrays into `verifyRegistrationResponse` and `verifyAuthenticationResponse`. The library's own `expectedOrigin.includes(origin)` rejects forged origins not in the array; v0.6.1's anti-phishing guarantee (origin embedded in signed clientDataJSON) is unchanged. |
| T-12-04 | mitigate | ✓ Conditional-spread emits `string` form (NOT single-element array) when `relatedOrigins.length === 0`. Existing 22 passkey.test.ts cases (all use empty `relatedOrigins: []`) stay green — the v0.6.1 string-form code path is byte-identical. Block 5 source-level test asserts EXACTLY 4 occurrences of `length === 0` (2 fields × 2 call sites). |
| T-12-05 | mitigate | ✓ README literal warning string `"library does NOT auto-host"` present (Task 3 acceptance grep). Section also documents the URL pattern (`https://{primaryRpId}/.well-known/webauthn`), Content-Type, HTTPS-only requirement, 5-origin cap, no-wildcards rule. RPID-V2-01/02 (auto-hosting helpers) deferred to v0.8+. |
| T-12-NEW-03 | mitigate | ✓ Block 5 grep guard `expect(source).not.toMatch(/config\.relatedOrigins\s*\?\?\s*\[\]/)` catches a future "drop the field, add a `?? []` fallback" regression. Required-field type ensures TypeScript catches factory-drop bugs at compile time. |

## Phase 12 Close-Out

All Phase 12 requirements complete:

- **RPID-01** (Plan 01): RelatedOrigin paired-tuple type + AnonAuthConfig.rp.relatedOrigins + /server re-export ✓
- **RPID-02** (Plan 02): validateRelatedOrigins startup helper with full negative coverage ✓
- **RPID-03** (Plan 04 — THIS): PasskeyConfig.relatedOrigins + conditional-spread at both verify call sites + createAnonAuth startup integration ✓
- **RPID-04** (Plans 03 + 04): VerifyRegistrationInput / VerifyAuthenticationInput accept `string | string[]` (Plan 03 widened the standalone API; Plan 04 added compile fixtures) ✓
- **RPID-05** (Plan 04 — THIS): README "## Cross-Domain Passkeys (v0.7.0)" top-level section with /.well-known/webauthn skeleton, hosting contract, browser support, paired-tuple security note ✓

Phase 12 is ready for `/gsd-verify-work`. The package version remains at v0.6.1 for now — a separate release plan will bump to v0.7.0 once verifier signoff lands.

## User Setup Required

None. Cross-domain passkey support is OPTIONAL; consumers who don't configure `rp.relatedOrigins` see byte-identical v0.6.1 behavior. Consumers who do enable the feature will need to host `/.well-known/webauthn` themselves at the primary RP ID — the README documents the JSON shape, hosting requirements, and the consumer-responsibility contract.

## Self-Check: PASSED

Verified:
- File `src/server/passkey.ts` exists and contains `relatedOrigins: readonly RelatedOrigin[]` REQUIRED field — FOUND
- File `src/server/index.ts` exists and contains `validateRelatedOrigins(` call + `relatedOrigins: validatedRelatedOrigins` — FOUND
- File `README.md` exists and contains `## Cross-Domain Passkeys (v0.7.0)` — FOUND
- File `src/__tests__/related-origins.test.ts` exists and contains all 3 new describe blocks (RPID-02/03 startup, RPID-03 source-level invariant, RPID-04 compile fixtures) — FOUND
- File `src/__tests__/passkey.test.ts` exists and contains updated testConfig with `relatedOrigins: [] as const` — FOUND
- Commit `dadc264` (Task 1) — FOUND in git log
- Commit `a13fc7c` (Task 2) — FOUND in git log
- Commit `b58fb32` (Task 3) — FOUND in git log
- Commit `56e24a1` (Task 4) — FOUND in git log
- Full vitest suite: 330 passed / 4 skipped / 0 failed — VERIFIED
- npm run typecheck: clean — VERIFIED
- npm run build: success — VERIFIED

## Next Phase Readiness

Phase 12 close-out signal: All RPID-01..05 requirements landed. Subsequent phases can now:

- Bump package version to v0.7.0 (release plan, separate from this hardening track)
- Land RPID-V2-01/V2-02 auto-hosting helpers if user demand emerges (currently deferred to v0.8+)
- Consume the cross-domain passkey API in real deployments (e.g., `shopping.com` + `shopping.co.uk` shared passkey path)

No blockers. No open concerns.

---
*Phase: 12-multi-rp-id-verification*
*Plan: 04*
*Completed: 2026-04-29*
