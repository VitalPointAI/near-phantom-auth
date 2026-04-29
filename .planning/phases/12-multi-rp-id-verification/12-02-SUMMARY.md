---
phase: 12
plan: 02
subsystem: server/related-origins
tags: [rpid-02, validation, webauthn, related-origin-requests, startup-config, tdd, wave-2]
dependency_graph:
  requires:
    - 12-01  # RelatedOrigin interface in src/types/index.ts
  provides:
    - validateRelatedOrigins  # pure-function startup helper exported from src/server/relatedOrigins.ts
  affects:
    - src/types/index.ts:RelatedOrigin  # consumed as readonly RelatedOrigin[] | undefined
tech_stack:
  added: []
  patterns:
    - pure-function-helper       # mirrors src/server/backup.ts: zero I/O, zero logger, single named export
    - tdd-red-green              # Task 1 RED, Task 2 GREEN against same spec
    - throw-on-first-failure     # mirrors src/server/index.ts:104 startup-throw idiom
    - defensive-shallow-copy     # spread-return prevents downstream mutation of consumer config
    - boundary-aware-suffix-check  # endsWith('.' + rpIdLower) defeats Pitfall 2 ("notshopping.com")
    - localhost-https-coupling   # http:// is permitted ONLY when paired rpId === 'localhost' (Pitfall 3)
key_files:
  created:
    - src/server/relatedOrigins.ts                # 104 lines, 1 export, pure synchronous helper
    - src/__tests__/related-origins.test.ts       # 149 lines, 16 it() blocks across 3 describe groups
  modified: []
decisions:
  - throw on first failure (not collect-all-errors) — matches existing connectionString startup-throw idiom; clearer error messages; consumer fixes one config issue at a time
  - return [...entries] (not Object.freeze) — TypeScript readonly is enough for the type contract; runtime freeze would require freezing nested objects too and isn't worth the cost since the helper runs once at startup
  - throw new Error (not custom error class) — project convention; mirrors src/server/index.ts:104; pino externalization means the caller decides log handling
  - boundary check uses endsWith('.' + rpId) (not endsWith(rpId)) — Pitfall 2 defense: "notshopping.com" must NOT match rpId "shopping.com"
  - localhost-http exception is COUPLED to rpId === 'localhost' (not independent) — Pitfall 3 defense: http://localhost:3000 paired with rpId="shopping.com" must throw
metrics:
  duration: "3m"
  duration_seconds: 178
  completed: "2026-04-29"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  test_count_added: 16
  test_count_total_after: 333  # 317 baseline + 16 new (4 skipped pre-existing)
---

# Phase 12 Plan 02: Multi-RP_ID Startup Validation Helper Summary

`validateRelatedOrigins` startup-config helper for `rp.relatedOrigins` (RPID-02) — pure synchronous function in `src/server/relatedOrigins.ts` that throws with classified messages on each of seven validation branches, paired with 16 Wave 0 unit tests covering happy/negative/invariant cases.

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/server/relatedOrigins.ts` | 104 | Pure-function helper exporting `validateRelatedOrigins`. Zero I/O, zero logger, no async, single named export. Mirrors the `src/server/backup.ts` / `src/server/codename.ts` pattern S2 (header doc + per-function JSDoc + minimal local imports). |
| `src/__tests__/related-origins.test.ts` | 149 | Wave 0 vitest spec — 16 `it()` blocks across 3 `describe` groups (happy / negative / invariant). No mocks; pure-function tests only. |

## Validation Rule Order

The helper iterates `entries` ONCE in declaration order; per-entry validation runs the following checks in this exact sequence and throws on the FIRST failure encountered:

1. **Count cap** (array-level) — `entries.length > MAX_RELATED_ORIGINS (5)` → `rp.relatedOrigins: max 5 entries allowed (got N)...`
2. **Shape** — `typeof origin !== 'string' || typeof rpId !== 'string'` → `rp.relatedOrigins[i]: must be { origin: string; rpId: string }`
3. **Wildcards** — `'*'` in either field → `rp.relatedOrigins[i]: wildcards are not permitted`
4. **Scheme + localhost coupling** — `!HTTPS_RE.test(origin) && !(LOCALHOST_HTTP_RE.test(origin) && rpId === 'localhost')` → `rp.relatedOrigins[i]: origin must be https:// ... http:// is only permitted when rpId === "localhost"`
5. **rpId validity** — `!RPID_RE.test(rpId)` → `rp.relatedOrigins[i]: rpId "..." is not a valid host`
6. **Suffix-domain (boundary-aware)** — `host !== rpIdLower && !host.endsWith('.' + rpIdLower)` → `rp.relatedOrigins[i]: origin host "..." is not a suffix-domain of rpId "..."`
7. **Duplicate-of-primary** — `origin === primaryOrigin && rpId === primaryRpId` → `rp.relatedOrigins[i]: duplicates the primary rp ... do not list it in relatedOrigins`

If all checks pass, the function returns `[...entries]` — a fresh shallow copy of the input array.

## Why "throw on first failure" instead of "collect all errors"

- **Clearer error messages.** A consumer staring at startup logs sees ONE classified message identifying which entry failed and why. A "collected" error would dump 10+ items in one throw and obscure the root cause.
- **Matches existing project idiom.** `src/server/index.ts:104` already throws on the first config defect (`connectionString` missing). The validator follows the same first-failure pattern so the deploy-time experience is consistent across the library.
- **Failure is rare and config is small.** Max 5 entries means at most 5 per-entry failures and 1 array-level. Forcing the consumer to fix one issue at a time, one deploy at a time, is fine — `relatedOrigins` is a config literal, not a user-supplied form.

## TDD Cycle Evidence

| Task | Phase | Commit | What |
|------|-------|--------|------|
| 1 | RED | `4920682` | `test(12-02): add failing tests for validateRelatedOrigins`. Created `src/__tests__/related-origins.test.ts` with 16 `it()` blocks. Vitest exited non-zero — `Cannot find module '../server/relatedOrigins.js'` (the import fails at module-load time, before any `it()` body runs). |
| 2 | GREEN | `d53c24f` | `feat(12-02): implement validateRelatedOrigins startup-config helper (RPID-02)`. Created `src/server/relatedOrigins.ts`. All 16 tests pass. |

REFACTOR phase: not needed — implementation lifted directly from `12-RESEARCH.md` Pattern 2 lines 285-342, no clean-up required after GREEN.

## TDD Gate Compliance

- RED gate: `test(12-02): ...` commit `4920682` exists ✓
- GREEN gate: `feat(12-02): ...` commit `d53c24f` exists, after RED ✓
- REFACTOR gate: skipped (no cleanup needed) — acceptable per TDD

## Verification Commands & Exit Codes

| Command | Exit | Result |
|---------|------|--------|
| `nvm use 20 && npm test -- --run src/__tests__/related-origins.test.ts` (after Task 1, before Task 2) | 1 | RED confirmed: `Cannot find module '../server/relatedOrigins.js'` |
| `nvm use 20 && npm test -- --run src/__tests__/related-origins.test.ts` (after Task 2) | 0 | 16/16 tests passed in 7ms |
| `nvm use 20 && npm run typecheck` (after Task 2) | 0 | tsc clean — RelatedOrigin type-only import resolves; readonly RelatedOrigin[] \| undefined accepted |
| `nvm use 20 && npm test -- --run` (full suite, after Task 2) | 0 | 21 test files, 317 passed + 4 pre-existing skipped (testnet); no regressions |

## Threat Model Coverage

All threats in the plan's `<threat_model>` register with `mitigate` disposition are now defended by this implementation:

| Threat ID | Defense | Test Coverage |
|-----------|---------|---------------|
| T-12-01 (paired-tuple drift) | Single-pass loop reading both `e.origin` and `e.rpId` from the same object; defensive copy preserves order; docstring forbids intermediate `.filter()`/`.sort()` | I1 (returns fresh copy) |
| T-12-02 (malformed config) | All 4 validation rules implemented as explicit branches with classified throws | N1 max-5, N2/N3 wildcard, N4 https, N5 localhost-coupling, N6/N7 suffix-domain boundary, N8 duplicate-of-primary, N9 invalid rpId, N10 wrong-shape |
| T-12-04 (backwards compat) | First guard `if (!entries \|\| entries.length === 0) return [];` — undefined and `[]` return byte-identical `[]` | P1 (undefined) and P2 (empty array) |
| T-12-NEW-01 (in-place mutation) | `return [...entries]` — defensive shallow copy | I1 asserts `out !== input` and that mutating `out` does not affect `input` |

T-12-03 (forged `clientDataJSON.origin`) and T-12-05 (consumer mis-hosts `/.well-known/webauthn`) are not in this plan's scope — Plan 04 owns those.

## Deviations from Plan

None — plan executed exactly as written. Implementation lifted verbatim from `12-RESEARCH.md` Pattern 2 lines 285-342 with no executor-identified drift. All grep-based and test-based acceptance criteria from both Tasks pass on first run.

## Downstream-plan Unblock Note

Plan 04 (`createAnonAuth` integration) may now:

```typescript
import { validateRelatedOrigins } from './relatedOrigins.js';

// inside createAnonAuth body:
const relatedOrigins = validateRelatedOrigins(
  config.rp?.relatedOrigins,
  config.rp.id,
  config.rp.origin,
);
// store on PasskeyConfig and spread at verify*Response call sites in Plan 04.
```

The helper is the entire RPID-02 surface; Plan 04's integration is the runtime expression of the R3 origin-spoofing defense.

## Self-Check: PASSED

- `src/server/relatedOrigins.ts` exists ✓ (`test -f` returned 0)
- `src/__tests__/related-origins.test.ts` exists ✓ (`test -f` returned 0)
- Commit `4920682` exists in `git log` ✓
- Commit `d53c24f` exists in `git log` ✓
- All 16 new tests pass ✓
- Full suite (321 tests across 21 files) green, 0 failures ✓
- Typecheck green ✓
- No file deletions in either commit ✓
- No untracked files left behind ✓
- No stub patterns (TODO/FIXME/placeholder) in new files ✓
