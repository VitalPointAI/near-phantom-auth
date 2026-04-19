---
phase: 09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv
plan: 03
subsystem: auth
tags: [react, hook, prf, readme, version-bump, tdd]

# Dependency graph
requires:
  - phase: 09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv
    plan: 01
    provides: "AnonAuthConfig.passkey type; sealingKeyHex regex schema; prf.test.ts mock factories and it.todo reservations"
  - phase: 09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv
    plan: 02
    provides: "createPasskey/authenticateWithPasskey accept { salt } prfOptions; api finishRegistration/finishAuthentication accept trailing sealingKeyHex?; spread-conditional body pattern"
provides:
  - "AnonAuthProviderProps.passkey { prfSalt?: Uint8Array; requirePrf?: boolean } nested optional prop"
  - "DEFAULT_PRF_SALT module-level constant ('near-phantom-auth-prf-v1') with immutability JSDoc"
  - "register()/login() PRF threading with PRF_NOT_SUPPORTED rejection guard on requirePrf=true"
  - "Library v0.6.0 (package.json + package-lock.json consistent; zero 0.5.3 refs remain)"
  - "README.md 'WebAuthn PRF Extension (DEK Sealing Key)' section with Configuration, Salt Immutability, Browser Support, Migration for Existing Accounts subsections"
  - "Full prf.test.ts coverage (26 passing, 0 todos) across Plans 01/02/03"
affects: [library consumers, auth-service DEK provisioner contract, README docs surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "React-hook source-pattern assertions (fs.readFile + regex match) as a stand-in for @testing-library/react — byte-stable, grep-verifiable, no new test-infra cost"
    - "Top-level DEFAULT_PRF_SALT constant with immutability JSDoc — pattern for deployment-time commitments that survive code changes"
    - "Surgical package-lock.json version edit (no npm install) — mirrors commit b7cc565 pattern"

key-files:
  created:
    - ".planning/phases/09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv/09-03-SUMMARY.md"
  modified:
    - "src/client/hooks/useAnonAuth.tsx"
    - "src/__tests__/prf.test.ts"
    - "package.json"
    - "package-lock.json"
    - "README.md"
    - "dist/* (rebuilt via tsup)"

key-decisions:
  - "Source-pattern tests for PRF-09 (6 assertions on useAnonAuth.tsx) rather than a React renderer — plan-endorsed rationale: project does not install @testing-library/react, and rendering the hook in Node requires out-of-scope infrastructure. Grep-level assertions are byte-stable and match the acceptance_criteria style used throughout this plan."
  - "DEFAULT_PRF_SALT lives in useAnonAuth.tsx (client), NOT passkey.ts (WebAuthn layer) — PATTERNS.md Key Observation #1 locked this choice: the salt is a consumer config decision, threaded in through the hook."
  - "requirePrf guard uses `passkey?.requirePrf && !credential.sealingKeyHex` (optional-chain FIRST) — so the unconditional `if (!credential.sealingKeyHex)` form stays absent from the file (explicitly asserted by test 2). This matches graceful-degradation intent: default behavior is silent success, opt-in strictness."
  - "useCallback dependency arrays updated from [api] to [api, passkey] — ensures React re-memoizes register/login when consumer passes a new passkey config object. Not doing this would bake in the initial prfSalt/requirePrf at provider mount and silently ignore later prop changes."
  - "Surgical package-lock.json edit (2 occurrences swapped) instead of npm install — matches RESEARCH.md reference commit b7cc565; keeps the lockfile deterministic without introducing dependency-tree drift."
  - "Docstring cleanup in prf.test.ts header: removed 'it.todo() placeholders for every PRF-* req' line, replaced with 'Fully populated across Plans 01/02/03' — required to satisfy `grep -c 'it.todo' == 0` acceptance criterion. The comment was genuine stale documentation, not a stub."

patterns-established:
  - "React-hook source-pattern assertion idiom: `await import('node:fs').then(fs => fs.promises.readFile(path, 'utf-8'))` + regex match against source. Reusable for any hook where testing behavior requires DOM/renderer but source-pattern is enough for the intent."
  - "DEFAULT_* module-level constants with IMMUTABILITY WARNING JSDoc placed above the exported interface — emphasizes the deployment-time commitment at the code level (mirrors T-09-14 mitigation in threat model)."
  - "README PRF section layout: intro + Configuration + Salt Immutability + Browser Support (table) + Migration — reusable template for any library feature whose correct configuration is a security-critical deployment choice."

requirements-completed:
  - PRF-01
  - PRF-09
  - PRF-10
  - PRF-12

# Metrics
duration: 5min
completed: 2026-04-19
---

# Phase 09 Plan 03: React Hook Wiring, Version Bump, and README PRF Documentation Summary

**Threaded PRF configuration through `useAnonAuth` with `requirePrf` rejection enforcement, bumped the library to v0.6.0, and added a comprehensive README section covering salt immutability, browser support, and NULL key-bundle migration — closing out Phase 09 end-to-end.**

## Performance

- **Duration:** ~5 min (294s)
- **Started:** 2026-04-19T23:13:24Z
- **Completed:** 2026-04-19T23:18:18Z
- **Tasks:** 2 (both `type="auto" tdd="true"`)
- **Files modified:** 5 source + dist rebuild (1 SUMMARY created)
- **Commits:** 3 per-task (1 RED + 1 GREEN for Task 1, 1 GREEN for Task 2 since its RED state was verified pre-edit without a test-file commit)

## Accomplishments

- **React hook PRF wiring:** `AnonAuthProvider` accepts new optional `passkey: { prfSalt?: Uint8Array; requirePrf?: boolean }` prop. Defaults apply when omitted (prfSalt = `DEFAULT_PRF_SALT`, requirePrf = false). Both `register()` and `login()` thread the salt into `createPasskey`/`authenticateWithPasskey` via the Plan 02 `{ salt: prfSalt }` second arg, enforce the `requirePrf` guard (`passkey?.requirePrf && !credential.sealingKeyHex` → throw `PRF_NOT_SUPPORTED: …`), and forward `credential.sealingKeyHex` as the trailing arg to `api.finishRegistration`/`api.finishAuthentication`. Existing `catch` blocks surface the throw as `state.error` — no new error plumbing.
- **DEFAULT_PRF_SALT:** Module-level `new TextEncoder().encode('near-phantom-auth-prf-v1')` constant placed directly after `AnonAuthContext` creation, with a JSDoc that names the immutability rule in full (rotation identifier, not semver; changing destroys DEK access). This keeps the deployment-time commitment visible at the code level in addition to the README.
- **useCallback dep updates:** Both `register` and `login` dep arrays are `[api, passkey]` so React re-memoizes when consumers pass a new passkey config reference — prevents silently baking in the initial config.
- **PRF-09 tests:** The two `it.todo` placeholders from Plan 01's scaffold were replaced with 6 real source-pattern assertions — guard presence in both ceremonies, `PRF_NOT_SUPPORTED` regex + behavior, correct `credential.sealingKeyHex` forwarding to both API calls, DEFAULT_PRF_SALT literal, dep-array updates. After this plan, `grep -c 'it.todo' src/__tests__/prf.test.ts` returns 0 (including the stale docstring reference which was removed).
- **Version bump v0.5.3 → v0.6.0:** Surgical edit to package.json line 3 and the two `"0.5.3"` occurrences in package-lock.json (root `version` + `packages[''].version`). `grep -c '"0.5.3"' package-lock.json` returns 0; `grep -c '"0.6.0"' package-lock.json` returns 2. No `npm install` executed — deterministic lockfile preservation per RESEARCH.md reference commit b7cc565.
- **README PRF section:** New `## WebAuthn PRF Extension (DEK Sealing Key)` section inserted between the Features bullet list and the Installation heading. Contains: intro + secure-enclave note, `### Configuration` TSX example with both `prfSalt` and `requirePrf`, `### Salt Immutability` (three bolded hard rules), `### Browser Support` (5-row markdown table covering Chrome/Edge, Safari, Firefox, Hardware keys, Chrome ≤146 Windows Hello), graceful-degradation paragraph documenting the `requirePrf` tradeoff, and `### Migration for Existing Accounts (NULL Key Bundles)`. New Features bullet added: "PRF-Derived Sealing Key (v0.6.0+)".
- **Full suite green:** 252 passed, 0 todos (up from 246 + 2 todos before this plan; net +6 tests from PRF-09 coverage). Typecheck exits 0. `npm run build` produces v0.6.0 dist artifacts successfully.

## Task Commits

Each task was committed atomically with TDD discipline:

1. **Task 1 (RED):** `32f2d2c` — `test(09-03): add failing PRF-09 source-pattern tests for useAnonAuth`
   - 6 new assertions replace 2 `it.todo` placeholders
   - RED verified: 6 failing tests against unmodified `useAnonAuth.tsx`
2. **Task 1 (GREEN):** `c845589` — `feat(09-03): wire PRF config through useAnonAuth; enforce requirePrf rejection`
   - DEFAULT_PRF_SALT constant, AnonAuthProviderProps extension, register/login threading, requirePrf guard, dep-array update, stale docstring cleanup
   - GREEN verified: 26 tests pass in prf.test.ts; 252 total across the suite; typecheck green
3. **Task 2 (GREEN):** `33fe26d` — `feat(09-03): bump to v0.6.0 and document PRF extension in README`
   - package.json + package-lock.json version bump; README section + Features bullet; dist rebuilt
   - Task 2 RED state was verified in-place before edits (package.json showed 0.5.3; README had no PRF section; lockfile had 2× 0.5.3). Since Task 2 has no test file — its verification chain is command-based (`node -e`, `grep`, `npm run build`) — a separate RED commit was unnecessary; the pre-edit inspection served the equivalent purpose.

**Plan metadata commit:** (pending — worktree mode; orchestrator commits SUMMARY.md in the merge-completion metadata commit.)

_TDD: Task 1 followed strict RED → GREEN (no REFACTOR needed — implementation is minimal and follows plan verbatim). Task 2 is a configuration/docs task; its RED→GREEN discipline was upheld via command-verification (pre-edit inspection failed the acceptance chain; post-edit it passes)._

## Files Created/Modified

- **`src/client/hooks/useAnonAuth.tsx`** — Added `DEFAULT_PRF_SALT` module-level constant between `AnonAuthContext` and `AnonAuthProviderProps`; extended `AnonAuthProviderProps` with optional nested `passkey: { prfSalt?; requirePrf? }`; destructured `passkey` in `AnonAuthProvider` function signature; in `register` callback: computed `prfSalt` after `api.startRegistration`, threaded it into `createPasskey`, inserted `requirePrf` guard before `isLikelyCloudSynced`, added `credential.sealingKeyHex` trailing arg to `api.finishRegistration`, updated dep array to `[api, passkey]`; mirror changes in `login` for `authenticateWithPasskey`/`api.finishAuthentication`. Did NOT touch logout, refreshSession, clearError, checkUsername, startOAuth, sendMagicLink, verifyMagicLink, recovery object, or Context.Provider assembly.
- **`src/__tests__/prf.test.ts`** — Replaced the trailing `describe('useAnonAuth requirePrf rejection (PRF-09) — filled by Plan 03', …)` block containing 2 `it.todo` placeholders with 6 real `it(...)` source-pattern assertions (guard presence, graceful degradation, finishRegistration forwarding, finishAuthentication forwarding, DEFAULT_PRF_SALT literal, dep-array updates). Updated file-header docstring to remove stale "it.todo() placeholders" language (required for the `grep -c 'it.todo' == 0` acceptance criterion).
- **`package.json`** — Single-line version bump `"0.5.3"` → `"0.6.0"` on line 3. No other fields modified.
- **`package-lock.json`** — Two `"0.5.3"` → `"0.6.0"` swaps (line 3 root, line 9 packages[''] self-ref). Zero 0.5.3 references remain.
- **`README.md`** — Appended "PRF-Derived Sealing Key (v0.6.0+)" bullet to Features list. Inserted new `## WebAuthn PRF Extension (DEK Sealing Key)` section between Features and Installation with Configuration, Salt Immutability, Browser Support (5-row table), graceful-degradation explanation, and Migration subsections.
- **`dist/*`** — Rebuilt via `npm run build` (tsup) with v0.6.0 metadata. The `dist/index-Bywvf8De.d.*` -> `dist/index-DOCiBiZ2.d.*` rename is a tsup hash-change from the new build output; semantically equivalent.

## Decisions Made

- **Source-pattern assertions over React-renderer tests**: The project does not install `@testing-library/react`, and exercising the hook outside a renderer would require a jsdom environment plus mocking infrastructure (api, fetch, navigator.credentials end-to-end) that this plan explicitly scoped out. The plan's `<action>` Step G articulated this rationale and specified the six exact assertions. Implementation matches byte-for-byte, producing deterministic, grep-verifiable coverage of the PRF-09 contract.
- **Optional-chain in the guard, not unconditional**: Guard form is `passkey?.requirePrf && !credential.sealingKeyHex`. A simpler unconditional `if (!credential.sealingKeyHex) throw` would break graceful degradation (Firefox users would be locked out even with `requirePrf: false`). Test 2 explicitly asserts the unconditional pattern is absent from the source, which enforces this at the test level.
- **useCallback dep update [api] → [api, passkey]**: React will re-memoize register/login when the `passkey` reference changes. Omitting this would bake the initial passkey object into the closures and silently ignore later config updates — a subtle bug for apps that toggle `requirePrf` dynamically. One test case asserts the updated dep-array pattern appears twice.
- **Task 2 commit structure**: Single feat commit (not RED+GREEN pair) because Task 2 has no test-file component — its verification is entirely command-based (`node -e`, `grep`, `npm run build`). Plan 02 summary documents the same pattern for non-test-file TDD tasks.
- **Docstring cleanup in prf.test.ts**: The file-header JSDoc from Plan 01 said "it.todo() placeholders for every PRF-* req" — a literal string match that caused the plan's `grep -c 'it.todo' == 0` acceptance criterion to fail by 1. This was genuine stale documentation (all todos were consumed), not a stub. Replaced with accurate language ("Fully populated across Plans 01 / 02 / 03").

## Deviations from Plan

None — plan executed exactly as written. All 13 Task 2 and all 11 Task 1 acceptance-criteria checks pass literally. The only "editorial" change beyond plan Steps A–F was the docstring cleanup in prf.test.ts, which was explicitly required by the `grep -c 'it.todo' == 0` acceptance criterion — the plan's Step G replacement text consumes the test bodies, but does not touch the file header; the header's leftover reference required cleanup to meet the criterion. This is not a deviation per se; it is the acceptance criterion forcing a semantic clarification.

## Issues Encountered

None. TDD RED was observed cleanly on Task 1 (6 failing assertions against unmodified source). Task 2's RED verification (pre-edit inspection) confirmed the expected starting state. All post-edit checks — grep, `node -e`, `npm test`, `npm run typecheck`, `npm run build` — passed on the first run with no retries.

The `dist/` diff is large because tsup produces a hash-suffixed intermediate file (`dist/index-*.d.*`), and the hash changes whenever source changes. This is normal tsup behavior and is tracked in git for this published-package repo; the rename is semantically equivalent.

## Threat Model Coverage

All T-09-* mitigations specified in the plan frontmatter are realized in the committed code:

| Threat | Plan Disposition | Realization |
|--------|------------------|-------------|
| T-09-14 Tampering (salt mutation across releases) | mitigate | README `### Salt Immutability` section with three bolded hard rules ("Do not change the salt after deployment", the deterministic-HMAC explanation, and the `v1`-suffix-is-not-semver clarification). DEFAULT_PRF_SALT JSDoc in useAnonAuth.tsx repeats the warning at the code level. |
| T-09-15 DoS (requirePrf lockout on Firefox) | accept | Per CONTEXT.md locked decision: consumer choice, documented in README Browser Support section as an explicit tradeoff ("Choose `requirePrf: true` only if your user base is restricted…"). |
| T-09-16 Info Disclosure (sealingKeyHex in React DevTools) | accept | sealingKeyHex is a local variable in register/login callbacks — not stored in React state. DevTools would see only the boolean outcome (isAuthenticated, codename), not the sealing key. |
| T-09-17 Tampering (version skew package.json vs lockfile) | mitigate | `grep -c '"0.5.3"' package-lock.json` returns 0 (acceptance criterion enforced). `npm run build` runs as part of verification, which also implicitly validates the lockfile via tsup's workspace resolution. |
| T-09-18 Spoofing (mis-configure DEFAULT_PRF_SALT as per-app unique) | mitigate | README Configuration example shows explicit override via `passkey.prfSalt`; copy clarifies the default is library-internal. DEFAULT_PRF_SALT JSDoc also names the default string. |
| T-09-19 Info Disclosure (state-snapshot telemetry) | accept | Hook does not store sealingKeyHex in state; transient local variable only. Third-party snapshot tools see only outcome booleans. |
| T-09-20 EoP (migration misleads about server-side changes) | mitigate | README `### Migration for Existing Accounts (NULL Key Bundles)` names the specific server-side change required (`provisionUserKeys()` fires when `getUserKeyBundle` returns null) and clarifies the library unconditionally ships `sealingKeyHex` from v0.6.0. |

No new threat surface introduced beyond what the plan's `<threat_model>` anticipated.

## Known Stubs

None. All `it.todo` placeholders from Plan 01 are consumed. No files render placeholder UI, no hardcoded empty values flow to consumer code. README contains no "TODO" / "coming soon" language.

## Threat Flags

None. No new network endpoints, auth paths, file access, or schema changes at trust boundaries. The `sealingKeyHex` threading (the central feature of Phase 09) was introduced in Plan 02 and is already in the register; this plan only adds the consumer-facing configuration surface and docs.

## Phase 09 End-to-End Readiness

With this plan complete, all 12 PRF-* requirements from the phase's research document are implemented:

| ID | Requirement | Plan(s) | Realization |
|----|-------------|---------|-------------|
| PRF-01 | `passkey.prfSalt` / `passkey.requirePrf` on config | 01 + 03 | Server-type AnonAuthConfig.passkey (Plan 01) + client-surface AnonAuthProviderProps.passkey (Plan 03) |
| PRF-02 | `extensions: { prf: { eval: { first: salt } } }` on create() | 02 | src/client/passkey.ts createPasskey |
| PRF-03 | Same on get() | 02 | src/client/passkey.ts authenticateWithPasskey |
| PRF-04 | Extract getClientExtensionResults().prf?.results?.first | 02 | Both functions post-credential |
| PRF-05 | Hex-encode 32-byte ArrayBuffer | 02 | arrayBufferToHex helper |
| PRF-06 | sealingKeyHex in /register/finish body | 02 | api.finishRegistration spread-conditional |
| PRF-07 | sealingKeyHex in /login/finish body | 02 | api.finishAuthentication spread-conditional |
| PRF-08 | Zod schema accepts optional sealingKeyHex | 01 | registerFinishBodySchema + loginFinishBodySchema |
| PRF-09 | requirePrf rejection path | 03 | useAnonAuth register/login guards |
| PRF-10 | v0.5.3 → v0.6.0 | 03 | package.json + package-lock.json |
| PRF-11 | Tests (byte-length, determinism, divergence, hex format) | 01 + 02 + 03 | prf.test.ts 26 tests across 7 describe blocks |
| PRF-12 | README documentation | 03 | New `## WebAuthn PRF Extension` section |

`npm run build` produces v0.6.0 dist/; full test suite green (252 passed, 0 todos); typecheck green. Phase 09 is complete.

## Self-Check: PASSED

**Files exist (verified via Read / grep):**
- FOUND: `src/client/hooks/useAnonAuth.tsx` (modified) — 453 lines; DEFAULT_PRF_SALT at line 97; passkey prop destructure at line 125; register guard at lines 202-204; login guard at lines 247-249
- FOUND: `src/__tests__/prf.test.ts` (modified) — 432 lines; 0 it.todo remaining; 26 tests
- FOUND: `package.json` (modified) — version = 0.6.0
- FOUND: `package-lock.json` (modified) — 0 × "0.5.3", 2 × "0.6.0"
- FOUND: `README.md` (modified) — `## WebAuthn PRF Extension` section present
- FOUND: `dist/*` (rebuilt) — tsup build success at v0.6.0

**Commits exist (verified via `git log --oneline -6`):**
- FOUND: `32f2d2c` test(09-03): add failing PRF-09 source-pattern tests for useAnonAuth
- FOUND: `c845589` feat(09-03): wire PRF config through useAnonAuth; enforce requirePrf rejection
- FOUND: `33fe26d` feat(09-03): bump to v0.6.0 and document PRF extension in README

**Verification commands exit 0:**
- `npm run typecheck` → exit 0
- `npm test -- --run src/__tests__/prf.test.ts` → 26 passed (0 todos)
- `npm test -- --run` → 252 passed across 15 test files (0 todos)
- `npm run build` → tsup build success, dist at v0.6.0
- `node -e "console.log(require('./package.json').version)"` → `0.6.0`
- `grep -c '"0.5.3"' package-lock.json` → `0`
- `grep -c '^## WebAuthn PRF Extension' README.md` → `1`

## TDD Gate Compliance

Plan 03 task-level TDD (`tdd="true"` on both tasks; plan frontmatter is `type: execute`, not plan-level `type: tdd`). Each task upheld RED → GREEN discipline:

- **Task 1:** RED commit `32f2d2c` (test) precedes GREEN commit `c845589` (feat). RED state had 6 runtime failures against unmodified `useAnonAuth.tsx`; GREEN state has all 6 passing plus 20 preserved from Plans 01/02.
- **Task 2:** No test-file commit pair needed — Task 2's verification is command-based (`node -e`, `grep`, `npm run build`). RED state verified via pre-edit inspection: `package.json` showed `0.5.3`, `package-lock.json` had 2× `"0.5.3"`, README had no `## WebAuthn PRF Extension` heading. GREEN state: all acceptance-criteria commands pass after commit `33fe26d`.

No REFACTOR commits needed — implementation is minimal and follows plan structure verbatim.

---
*Phase: 09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv*
*Plan: 03*
*Completed: 2026-04-19*
