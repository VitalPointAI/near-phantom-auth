---
phase: 09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv
plan: 01
subsystem: auth
tags: [webauthn, prf, zod, typescript, tests, vitest]

# Dependency graph
requires:
  - phase: 02-zod-validation-schemas
    provides: "registerFinishBodySchema / loginFinishBodySchema with .passthrough() on WebAuthn credential responses"
provides:
  - "AnonAuthConfig.passkey nested optional config (prfSalt, requirePrf) — type-only server contract"
  - "Optional sealingKeyHex regex-validated field on registerFinishBodySchema and loginFinishBodySchema"
  - "src/__tests__/prf.test.ts Wave 0 scaffold with exported makeMockCredentialWithPrf and makeMockCredentialNoPrf HMAC-SHA-256 mock factories"
  - "Deterministic PRF test vectors (byte-length, determinism, divergence) — baseline for Plans 02/03"
affects: [09-02, 09-03, useAnonAuth, createPasskey, authenticateWithPasskey, finishRegistration, finishAuthentication]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zod regex-validated optional field (sealingKeyHex: z.string().regex(/^[0-9a-f]{64}$/).optional())"
    - "Deterministic HMAC mock factory (node:crypto createHmac) for WebAuthn PRF test vectors"
    - "it.todo() placeholder reservations wired to future-plan test requirements"

key-files:
  created:
    - "src/__tests__/prf.test.ts"
  modified:
    - "src/types/index.ts"
    - "src/server/index.ts"
    - "src/server/validation/schemas.ts"
    - "src/__tests__/validation.test.ts"

key-decisions:
  - "AnonAuthConfig.passkey is type-only on server — no runtime forwarding, no sub-manager receives prfSalt/requirePrf; documented in createAnonAuth comment"
  - "sealingKeyHex regex /^[0-9a-f]{64}$/ on outer object (non-passthrough) — rejects empty string, wrong length, uppercase, non-hex; mitigates T-09-01/02/05/06"
  - "prf.test.ts exports mock factories from the test file (not a separate helpers module) per plan scope — Plans 02/03 import from this file"
  - "15 it.todo() placeholders reserved (plan specified ≥14) — one per PRF-* requirement surface in Plans 02/03"
  - "TDD RED commit for Task 2 (a9ce0e8) precedes GREEN commit (d2f9861) — RED state failed 8 assertions due to Zod silently stripping unknown keys; regex addition turned them green"

patterns-established:
  - "Schema validation of optional crypto hex fields uses inline regex rather than a shared helper — matches existing `userHandle: z.string().optional()` pattern in loginFinishBodySchema"
  - "Threat register mitigations documented in plan frontmatter map 1:1 to regex constraints in the schema (length + charset)"
  - "Plan-scoped vi.clearAllMocks() inside beforeEach + globalThis navigator assignment — reusable pattern for any WebAuthn-in-Node test"

requirements-completed:
  - PRF-01
  - PRF-08
  - PRF-11

# Metrics
duration: 4min
completed: 2026-04-19
---

# Phase 09 Plan 01: WebAuthn PRF Foundation Types, Schemas, and Test Scaffold Summary

**AnonAuthConfig.passkey type contract, regex-validated sealingKeyHex on register/login finish schemas, and prf.test.ts Wave 0 scaffold with deterministic HMAC mock factories ready for Plans 02/03 to consume.**

## Performance

- **Duration:** 4 min (266s)
- **Started:** 2026-04-19T22:53:45Z
- **Completed:** 2026-04-19T22:58:11Z
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 edited)
- **Commits:** 4 (1 feat for Task 1, test+feat pair for Task 2 TDD, 1 test for Task 3)

## Accomplishments
- AnonAuthConfig.passkey nested config accepts `prfSalt?: Uint8Array` and `requirePrf?: boolean`; default salt string `near-phantom-auth-prf-v1` documented in JSDoc.
- registerFinishBodySchema and loginFinishBodySchema both validate optional `sealingKeyHex: z.string().regex(/^[0-9a-f]{64}$/).optional()`; twelve new tests cover accepts-missing, accepts-valid, rejects 63-char, rejects 65-char, rejects uppercase, rejects non-hex — six per schema.
- New `src/__tests__/prf.test.ts` exports `makeMockCredentialWithPrf` and `makeMockCredentialNoPrf` built on Node `createHmac('sha256', credKey).update(prfSalt)`; 5 sanity tests prove byte-length (32), determinism per (credKey, salt), divergence across both axes, and empty-extension shape for no-PRF case.
- 15 `it.todo()` placeholders carry forward PRF-02/03/04/05/06/07/09 test surface into Plans 02/03 — none count as failures; suite stays green.
- Full test suite: 214 baseline → 231 passing + 15 todos (246 total). `npm run typecheck` exits 0. No existing test modified, no sub-manager wiring changed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PasskeyConfig to AnonAuthConfig and createAnonAuth signature (type-only)** — `547f300` (feat)
2. **Task 2 (RED): Failing sealingKeyHex schema tests** — `a9ce0e8` (test)
3. **Task 2 (GREEN): Add sealingKeyHex regex to register/login finish schemas** — `d2f9861` (feat)
4. **Task 3: prf.test.ts Wave 0 scaffold with HMAC mock factories** — `133a275` (test)

**Plan metadata:** (pending — worktree mode; orchestrator commits SUMMARY.md in a metadata commit)

_TDD: Task 2 followed RED→GREEN (no REFACTOR needed — the schema change is a one-line addition per schema). Tasks 1 and 3 are scaffolding/type-only; their verification commands (`npm run typecheck` / new-file vitest run) fail pre-change and pass post-change, which is the equivalent RED→GREEN discipline per the plan's tdd="true" attribute._

## Files Created/Modified

- `src/types/index.ts` — Added `AnonAuthConfig.passkey` optional nested interface (prfSalt, requirePrf) between existing `rp?` and `oauth?` blocks; JSDoc documents default salt and server-side-type-only semantics.
- `src/server/index.ts` — Added explanatory comment at the top of `createAnonAuth` clarifying `config.passkey` is not forwarded to any sub-manager (PRF is purely client-side). No runtime logic change.
- `src/server/validation/schemas.ts` — Added `sealingKeyHex: z.string().regex(/^[0-9a-f]{64}$/).optional()` to `registerFinishBodySchema` (between `codename` and `response`) and to `loginFinishBodySchema` (between `challengeId` and `response`). Outer objects stay non-passthrough — unknown top-level keys are stripped.
- `src/__tests__/validation.test.ts` — Added two nested `describe('sealingKeyHex (PRF-08)', …)` blocks (one inside each existing finish-body describe) with 6 tests each: accepts missing, accepts 64-char lowercase, rejects 63, rejects 65, rejects uppercase, rejects non-hex.
- `src/__tests__/prf.test.ts` (new) — 192 lines. Exports `MockPublicKeyCredential` type and two factory functions (`makeMockCredentialWithPrf`, `makeMockCredentialNoPrf`); installs `globalThis.navigator.credentials`, `atob`/`btoa`, `PublicKeyCredential`, `window` stubs in `beforeEach`; 5 sanity tests under `mock factory sanity (PRF-11 baseline)`; 15 `it.todo()` placeholders across 5 describe blocks mapped to PRF-02/03/04/05/06/07/09.

## Decisions Made

- **Default PRF salt string** set to `near-phantom-auth-prf-v1` in the `prfSalt` JSDoc per CONTEXT.md locked decision. The actual runtime default is declared in Plan 03's `useAnonAuth` module-level constant per PATTERNS.md observation #1 (salt lives on the client, not the server).
- **Non-passthrough outer schema** retained — adding `.passthrough()` would leak arbitrary top-level keys to downstream handlers (T-09-06 elevation of privilege). The explicit `sealingKeyHex` field is the correct pattern, matching the plan's acceptance criteria.
- **HMAC-SHA-256 deterministic mock** chosen over virtual-authenticator / CDP approaches — vitest runs in Node (not jsdom), so a pure-function mock is the lowest-friction approach. The RESEARCH.md "Don't Hand-Roll" table explicitly approves this for deterministic PRF test vectors.
- **Mock factories exported from `prf.test.ts`** (not extracted into a helpers module) — plan scope kept them colocated; Plans 02/03 can `import { makeMockCredentialWithPrf } from './prf.test.js'`.

## Deviations from Plan

None — plan executed exactly as written. All three acceptance-criteria sets pass verbatim, full test suite green (231 + 15 todos = 246), typecheck green, no files touched outside the plan's `files_modified` manifest.

## Issues Encountered

None. TDD RED was observed as expected: adding `sealingKeyHex: 'a'.repeat(65)` to a Zod schema with no such field → Zod strips it → `safeParse({...}).success` is `true` → the "rejects" assertions failed. Adding the regex field turned all 12 new assertions green.

## Threat Model Coverage

All T-09-* mitigations specified in the plan frontmatter are realized in the committed code:

| Threat | Plan Disposition | Realization |
|--------|------------------|-------------|
| T-09-01 Tampering (arbitrary sealingKeyHex) | mitigate | Regex `/^[0-9a-f]{64}$/` rejects non-hex/non-64-char (verified by 4 test assertions) |
| T-09-02 DoS via oversized hex | mitigate | Same regex bounds string length to exactly 64 chars; parse fails early |
| T-09-03 Info disclosure in logs | accept (this plan) | No log-path changes — documented as Plan 03 README item |
| T-09-04 Default salt mutation | mitigate (Plan 03 README) | prfSalt constant lives in Plan 03; this plan documents immutability in JSDoc |
| T-09-05 Empty-string spoofing | mitigate | Regex rejects empty strings (fails length check); verified by 63-char rejection case |
| T-09-06 Outer `.passthrough()` elevation | mitigate | Explicit field addition; outer schema stays non-passthrough; confirmed by preserving existing Plan 02 pattern |

No new threat surface introduced beyond what the plan threat_model anticipated.

## Known Stubs

`src/__tests__/prf.test.ts` contains 15 `it.todo()` placeholders — these are **intentional**, reserved for Plans 02 and 03 per the plan's task 3 acceptance criteria (`≥14 it.todo()`). Each todo string names the requirement (PRF-02/03/04/05/06/07/09) it covers. Not counted as stubs because the plan explicitly mandates them.

No unintentional stubs introduced. No files render placeholder UI, no hardcoded empty values flow to consumer code.

## Next Plan Readiness

Plan 02 can now:
- Consume `AnonAuthConfig.passkey` / `AnonAuthProviderProps.passkey` as the type surface for `prfOptions` threaded into `createPasskey` and `authenticateWithPasskey`.
- Assert against `sealingKeyHex` schema presence via the already-passing validation tests (no server-side changes needed from Plan 02).
- Import `makeMockCredentialWithPrf` and `makeMockCredentialNoPrf` from `src/__tests__/prf.test.js` and fill the reserved `it.todo()` bodies for PRF-02/03/04/05/06/07.

Plan 03 can:
- Mirror `AnonAuthConfig.passkey` into `AnonAuthProviderProps.passkey` in `useAnonAuth.tsx`.
- Fill PRF-09 todos (requirePrf rejection path) using the same mock factories.
- Use the prfSalt JSDoc default (`near-phantom-auth-prf-v1`) as the module-level constant.

No blockers or concerns surfaced.

## Self-Check: PASSED

**Files exist:**
- FOUND: `src/types/index.ts` (modified)
- FOUND: `src/server/index.ts` (modified)
- FOUND: `src/server/validation/schemas.ts` (modified)
- FOUND: `src/__tests__/validation.test.ts` (modified)
- FOUND: `src/__tests__/prf.test.ts` (created)

**Commits exist (verified via `git log --oneline -6`):**
- FOUND: `547f300` feat(09-01): add AnonAuthConfig.passkey (prfSalt, requirePrf) type contract
- FOUND: `a9ce0e8` test(09-01): add failing sealingKeyHex schema tests (PRF-08)
- FOUND: `d2f9861` feat(09-01): validate sealingKeyHex on register/login finish schemas (PRF-08)
- FOUND: `133a275` test(09-01): add prf.test.ts Wave 0 scaffold with HMAC mock factories (PRF-11)

**Verification commands exit 0:**
- `npm run typecheck` → exit 0
- `npm test -- --run src/__tests__/validation.test.ts` → 55 tests passed (43 baseline + 12 new)
- `npm test -- --run src/__tests__/prf.test.ts` → 5 passed + 15 todos
- `npm test -- --run` → 231 passed + 15 todos (246 total) across 15 test files

---
*Phase: 09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv*
*Plan: 01*
*Completed: 2026-04-19*
