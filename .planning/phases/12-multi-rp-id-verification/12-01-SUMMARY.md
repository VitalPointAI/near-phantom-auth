---
phase: 12-multi-rp-id-verification
plan: 01
subsystem: auth
tags: [webauthn, related-origins, types, public-api, rpid-01, paired-tuple, v0.7.0]

# Dependency graph
requires:
  - phase: 11-backup-eligibility-flags-hooks-scaffolding
    provides: AnonAuthHooks declaration adjacent to v0.7.0 type cluster (sibling pattern mirrored for RelatedOrigin); exports.test.ts MPC-01 type-alias regression pattern
provides:
  - RelatedOrigin paired-tuple interface in src/types/index.ts (origin + rpId both REQUIRED)
  - AnonAuthConfig.rp.relatedOrigins?: RelatedOrigin[] optional field on inline rp config object
  - RelatedOrigin re-exported from src/server/index.ts public type surface
  - RPID-01 regression test asserting both compile-time type-alias re-export and source-level export shape
affects: [12-02-validate-related-origins, 12-03-standalone-widening, 12-04-passkey-integration-readme]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Paired-tuple interface as type-level structural defense against index drift (T-12-01 R3 mitigation)
    - v0.7.0 sibling-type clustering — RelatedOrigin declared adjacent to AnonAuthHooks (mirrors Phase 11 11-02 precedent)
    - Public-surface re-export append at end of existing list, never reorder (Pattern S4 additive)
    - Type-alias regression test: compile-time typed const + source-level grep guard (mirrors MPC-01 pattern)

key-files:
  created: []
  modified:
    - src/types/index.ts
    - src/server/index.ts
    - src/__tests__/exports.test.ts

key-decisions:
  - "RelatedOrigin fields origin and rpId are both REQUIRED string (no `?`) — pairing intent is preserved by structural identity; making either field optional would silently break the R3 origin-spoofing defense"
  - "Paired-tuple shape (Array<{ origin, rpId }>) over two parallel arrays — @simplewebauthn/server@13.x does NOT cross-check pairing (tests independent membership), so the type IS the defense"
  - "AnonAuthConfig.rp.relatedOrigins is optional with `?` modifier — undefined === [] === byte-identical v0.6.1 behavior (T-12-04 backwards-compat mitigation)"
  - "RelatedOrigin clustered with AnonAuthHooks in /server re-export block — v0.7.0 types cluster (Pattern S4 additive append, AnonAuthHooks at line 249, RelatedOrigin appended immediately after)"
  - "Plan 01 lands TYPE contract only — no validation logic, no factory threading, no README; those land in Plans 02/03/04 (lockstep wave merge structure prevents production deploys between plans)"

patterns-established:
  - "Paired-tuple interface as type-level structural invariant: when an array is conceptually a list of pairs, declaring each tuple as a single object with required fields makes index drift a type error rather than a runtime bug"
  - "Type-alias regression: compile-time typed const + source-level grep guard. The compile-time const fails tsc --noEmit if the re-export is dropped; the grep guard catches refactors that drop the re-export without typechecking the test file"

requirements-completed: [RPID-01]

# Metrics
duration: 3min
completed: 2026-04-29
---

# Phase 12 Plan 01: Multi-RP_ID Type Foundation Summary

**Paired-tuple `RelatedOrigin` interface lands in src/types/index.ts (origin + rpId both required), `AnonAuthConfig.rp.relatedOrigins?: RelatedOrigin[]` extends the inline rp config, and the type is re-exported from /server with a compile-time regression test — type contract for downstream Plans 02/03/04 in place; zero runtime change to v0.6.1 behavior.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-29T22:16:40Z
- **Completed:** 2026-04-29T22:19:22Z
- **Tasks:** 2 / 2
- **Files modified:** 3

## Accomplishments

- `RelatedOrigin` paired-tuple interface declared in `src/types/index.ts` immediately after `AnonAuthHooks` (the v0.7.0 sibling type cluster). Both `origin: string` and `rpId: string` are REQUIRED — pairing intent is encoded structurally so a `.map()` reorder cannot silently break the R3 defense.
- `AnonAuthConfig.rp.relatedOrigins?: RelatedOrigin[]` appended to the existing inline `rp` object without reordering or renaming `name`/`id`/`origin`. The `?` modifier preserves byte-identical v0.6.1 behavior when the field is absent (T-12-04 backwards-compat).
- `RelatedOrigin` re-exported from `src/server/index.ts` public type surface alongside `AnonAuthHooks` (Phase 12 RPID-01 marker comment placed adjacent to the Phase 11 HOOK-01 marker).
- New `describe('RPID-01: RelatedOrigin type is re-exported from /server', ...)` block in `src/__tests__/exports.test.ts` with two assertions: a compile-time `const ro: RelatedOrigin = {...}` typed-value (fails tsc --noEmit if re-export is dropped), and a source-level grep that the type appears inside the `export type { ... } from '../types/index.js'` block.
- Full test suite stayed green: 301 passed, 4 skipped (testnet), 0 failures.

## Task Commits

Each task was committed atomically:

1. **Task 1: Declare RelatedOrigin interface; extend AnonAuthConfig.rp** — `4cbc89c` (feat)
2. **Task 2: Re-export RelatedOrigin from /server; assert in exports.test.ts** — `c78644b` (feat)

_Note: SUMMARY.md commit is made by the orchestrator's metadata step in worktree mode._

## Files Created/Modified

- `src/types/index.ts` (+34 lines, total 633) — Added `RelatedOrigin` interface (29 lines including JSDoc) immediately after `AnonAuthHooks`; appended `relatedOrigins?: RelatedOrigin[]` field (5 lines including JSDoc) to existing inline `rp?` object inside `AnonAuthConfig`.
- `src/server/index.ts` (+1 line, total 291) — Added `RelatedOrigin,        // Phase 12 RPID-01 re-export` to the public `export type { ... } from '../types/index.js'` block, placed immediately after `AnonAuthHooks`.
- `src/__tests__/exports.test.ts` (+20 lines, total 132) — Added `type RelatedOrigin` to the existing import block; appended a new top-level `describe('RPID-01: RelatedOrigin type is re-exported from /server', ...)` with two `it` cases (compile-time typed-value + source-level grep guard).

## Decisions Made

### Why both `origin` and `rpId` are REQUIRED on `RelatedOrigin` (T-12-01)

The R3 origin-spoofing threat is mis-pairing — a consumer hands the verifier an `origins` array and an `rpIDs` array whose indices have drifted (e.g., via a `.map()` reorder, or by adding to one list but forgetting the other). `@simplewebauthn/server@13.x` does NOT cross-check pairing; it tests independent membership of each list. By making `RelatedOrigin` a single object with both fields required, the array IS the list of pairs — index drift becomes a type error. Making either field optional would let `{ origin: A } | { rpId: idB }` slip through and silently re-introduce the spoofing surface. Acceptance criterion verified neither field carries `?` inside the `RelatedOrigin` interface block.

### Why `relatedOrigins` is `?:` on `AnonAuthConfig.rp` (T-12-04)

Optional with `?` modifier per Pattern S1 (Phase 11 v0.7.0 precedent). A consumer who omits the field (or passes `relatedOrigins: []`) sees behavior byte-identical to v0.6.1 — no validation runs, no factory shape change, no @simplewebauthn/server@13.x relatedOrigins parameter is threaded. This guarantees additive-only minor-bump safety.

### Paired-tuple over two parallel arrays

`Array<{ origin: string; rpId: string }>` (this plan) vs. `{ origins: string[]; rpIds: string[] }` (rejected). The paired-tuple shape is the only design decision in Phase 12 — it makes pairing intent a type-level property that downstream Plan 03's `relatedOrigins.map(r => r.origin)` and `relatedOrigins.map(r => r.rpId)` lockstep idiom preserves automatically (both maps iterate the same array in the same order). Verified by Pattern 1 / Pitfall 1 in 12-RESEARCH.md.

### v0.7.0 sibling-type clustering in the re-export block

`RelatedOrigin` was placed immediately after `AnonAuthHooks` in the public `export type { ... }` list (not appended at the end) — v0.7.0 additions form a contiguous cluster. The Pattern S4 "append at end, never reorder" rule applies to PRESERVING existing order; placement of NEW v0.7.0 entries within the existing v0.7.0 cluster is purely organizational and does not reorder anything pre-existing. The HOOK-01 marker comment line placement set the precedent.

## Deviations from Plan

None — plan executed exactly as written.

The plan was unusually well-specified: every JSDoc string, every comma in the re-export block, and the exact insertion points for the test file were given verbatim. Both tasks landed first try, typecheck and full test suite green on first run.

One observation worth noting (NOT a deviation): the Task 1 acceptance criterion `grep -E "  rpId\?: string" src/types/index.ts | grep -v "//" | wc -l` returns `1`, not `0`. The single hit is at line 582 inside the pre-existing `PublicKeyCredentialRequestOptionsJSON` interface — a totally unrelated WebAuthn JSON transport type that was already in the file before this plan. The criterion's INTENT (no optional shape leak inside the new `RelatedOrigin` interface) is fully satisfied: an `awk '/^export interface RelatedOrigin/,/^}/'` slice of just the new interface contains zero `origin?:` or `rpId?:` lines. This is consistent with `<verification>` line 340 of the plan, which scopes the same check to `src/types/index.ts` globally and accepts the pre-existing unrelated match.

## Issues Encountered

None.

## Verification Commands Run

| # | Command                                                                | Exit | Notes                                       |
|---|------------------------------------------------------------------------|------|---------------------------------------------|
| 1 | `nvm use 20 && npm run typecheck`                                      | 0    | tsc --noEmit clean after Task 1             |
| 2 | `nvm use 20 && npm test -- --run src/__tests__/exports.test.ts`        | 0    | 12 tests pass (10 existing MPC-01 + 2 new RPID-01) |
| 3 | `nvm use 20 && npm test -- --run`                                      | 0    | Full suite: 301 passed / 4 skipped / 0 failed |
| 4 | Acceptance grep — `RelatedOrigin` interface declared (Task 1)          | =1   | ✓                                          |
| 5 | Acceptance grep — `relatedOrigins?: RelatedOrigin[]` field (Task 1)    | =1   | ✓                                          |
| 6 | Acceptance grep — `name/id/origin: string;` preserved on rp (Task 1)   | =1,1,1 | ✓                                        |
| 7 | Acceptance grep — `RPID-01` JSDoc references (Task 1)                  | =2   | ✓                                          |
| 8 | Acceptance grep — `NOT two parallel` JSDoc (Task 1)                    | =1   | ✓                                          |
| 9 | Acceptance grep — `auto-host` JSDoc warning (Task 1)                   | =1   | ✓                                          |
| 10 | Acceptance grep — `AnonAuthHooks` interface unchanged (Task 1)        | =1   | ✓                                          |
| 11 | Acceptance grep — `RelatedOrigin` in /server re-export block (Task 2) | =1   | ✓                                          |
| 12 | Acceptance grep — `type RelatedOrigin` import in test (Task 2)        | =1   | ✓                                          |
| 13 | Acceptance grep — `describe('RPID-01` block exists (Task 2)           | =1   | ✓                                          |
| 14 | Acceptance grep — `const ro: RelatedOrigin` typed value (Task 2)      | =1   | ✓                                          |
| 15 | Acceptance grep — `RelatedOrigin` total appearances in test (Task 2)  | =6   | ≥2 ✓                                       |
| 16 | Acceptance grep — `describe('MPC-01` blocks unchanged (Task 2)        | =3   | ✓                                          |

## Threat Model Confirmation

| Threat ID | Disposition | Status                                                                                                  |
|-----------|-------------|---------------------------------------------------------------------------------------------------------|
| T-12-01   | mitigate    | ✓ Both `origin` and `rpId` declared REQUIRED. Index drift is a type error.                              |
| T-12-02   | accept      | ✓ Plan 01 declares the type only; `validateRelatedOrigins` is owned by Plan 02 (Wave 2).                |
| T-12-03   | accept      | ✓ Runtime defense (paired spread into verify*Response) lands in Plan 04. Type-only changes do not introduce/close this surface. |
| T-12-04   | mitigate    | ✓ `relatedOrigins?:` is optional. Existing v0.6.1 consumers see byte-identical behavior.                |
| T-12-05   | accept      | ✓ JSDoc on both `RelatedOrigin` and `rp.relatedOrigins` includes the "library does NOT auto-host" warning. Full README skeleton is owned by Plan 04. |

## Downstream-Plan Unblock Note

Plans **12-02**, **12-03**, and **12-04** may now reference `RelatedOrigin`:

- From `../types/index.js` for internal modules (e.g., the upcoming `validateRelatedOrigins(rp)` function in Plan 02).
- From `../server/index.js` for consumer-facing surface assertions and external integration.

The type contract is locked. Subsequent plans MUST NOT modify the `RelatedOrigin` field set or change either field's optionality — those changes would re-open T-12-01.

## User Setup Required

None — no external service configuration required.

## Self-Check: PASSED

Verified:
- File `src/types/index.ts` exists and contains `RelatedOrigin` interface — FOUND
- File `src/server/index.ts` exists and contains `RelatedOrigin` in re-export block — FOUND
- File `src/__tests__/exports.test.ts` exists and contains `describe('RPID-01...` — FOUND
- Commit `4cbc89c` (Task 1) — FOUND in git log
- Commit `c78644b` (Task 2) — FOUND in git log

## Next Phase Readiness

- Plan 12-02 (validateRelatedOrigins + tests) and Plan 12-03 (standalone widening) — both Wave 2 — can begin against the locked type contract.
- Plan 12-04 (passkey integration + README) — Wave 3 — has the public-surface re-export it needs to document.
- No blockers, no concerns.

---
*Phase: 12-multi-rp-id-verification*
*Plan: 01*
*Completed: 2026-04-29*
