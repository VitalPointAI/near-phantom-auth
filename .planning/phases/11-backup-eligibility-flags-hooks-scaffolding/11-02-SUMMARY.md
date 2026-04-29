---
phase: 11-backup-eligibility-flags-hooks-scaffolding
plan: 02
subsystem: auth
tags: [hooks, typescript, vitest, scaffolding, webauthn, oauth]

# Dependency graph
requires:
  - phase: 11-01
    provides: "passkey?: { backedUp; backupEligible } on RegistrationFinishResponse / AuthenticationFinishResponse"
provides:
  - "src/types/index.ts: AnonAuthHooks interface with three optional callbacks (afterAuthSuccess?, backfillKeyBundle?, onAuthEvent?)"
  - "src/types/index.ts: AnonAuthConfig.hooks?: AnonAuthHooks optional field"
  - "src/server/router.ts: RouterConfig.hooks?: AnonAuthHooks optional field"
  - "src/server/oauth/router.ts: OAuthRouterConfig.hooks?: AnonAuthHooks optional field"
  - "src/server/index.ts: createAnonAuth threads config.hooks into BOTH createRouter and createOAuthRouter"
  - "src/server/index.ts: AnonAuthHooks re-exported from public surface"
  - "src/__tests__/hooks-scaffolding.test.ts: compile fixtures + threading spy + grep invariant guard"
affects:
  - "11-03/04/05 (webauthn.ts, router.ts): hook plumbing present; no change needed"
  - "Phase 13 (ANALYTICS-01..06): can plug onAuthEvent call sites without config-shape change"
  - "Phase 14 (HOOK-02..06): can plug afterAuthSuccess call sites without config-shape change"
  - "Phase 15 (BACKFILL-01..04): can plug backfillKeyBundle call sites without config-shape change"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AnonAuthHooks with unknown ctx per Pattern 6 — downstream phases refine to narrower types"
    - "Pitfall 4 mitigation: both createRouter and createOAuthRouter factory calls updated in lockstep"
    - "Grep guard test: execSync grep in vitest to enforce Phase 11 no-call-sites invariant"
    - "Omit<AnonAuthConfig, 'hooks'> on baseConfig prevents accidental hooks inheritance in compile fixtures"

key-files:
  created:
    - src/__tests__/hooks-scaffolding.test.ts
  modified:
    - src/types/index.ts
    - src/server/router.ts
    - src/server/oauth/router.ts
    - src/server/index.ts

key-decisions:
  - "unknown ctx parameters on all three callbacks per Pattern 6 / Assumption A1 — Phase 13/14/15 will narrow each independently"
  - "All three callback fields use ? modifier (Pitfall 3 guard) so hooks: {} compiles without error"
  - "Both createRouter and createOAuthRouter factory calls receive hooks: config.hooks (Pitfall 4 guard — neither dropped)"
  - "Zero call sites wired in Phase 11 — hooks are accept-and-store only; invocation belongs to Phases 13/14/15"

patterns-established:
  - "Pattern: hooks scaffolding — define interface with unknown, thread through factories, ship grep guard test, refine types in downstream phase"
  - "Pattern: Omit<T, 'optional-field'> on baseConfig prevents accidental inheritance in test compile fixtures"

requirements-completed: [HOOK-01]

# Metrics
duration: 5min
completed: 2026-04-29
---

# Phase 11 Plan 02: backup-eligibility-flags-hooks-scaffolding Summary

**`AnonAuthHooks` type scaffolding (HOOK-01) — three optional callbacks threaded through both router factories with zero call sites, vitest compile + threading + grep invariant guard**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-29T16:33:58Z
- **Completed:** 2026-04-29T16:38:28Z
- **Tasks:** 3
- **Files modified:** 5 (4 modified, 1 created)

## Accomplishments

- Defined `AnonAuthHooks` interface in `src/types/index.ts` with three optional callbacks (`afterAuthSuccess?`, `backfillKeyBundle?`, `onAuthEvent?`) using `unknown` ctx parameters (Pattern 6 — downstream phases refine)
- Extended `AnonAuthConfig.hooks?: AnonAuthHooks`, `RouterConfig.hooks?: AnonAuthHooks`, `OAuthRouterConfig.hooks?: AnonAuthHooks` — `hooks: {}` and hooks omitted both compile
- `createAnonAuth` threads `config.hooks` into BOTH `createRouter` and `createOAuthRouter` factory calls (Pitfall 4 guard: neither factory dropped)
- `AnonAuthHooks` added to public re-export block in `src/server/index.ts`
- Created `src/__tests__/hooks-scaffolding.test.ts`: 6 tests covering compile fixtures (omitted, `{}`), threading-without-invocation spy, and three grep-guard invariant tests — all pass

## Task Commits

1. **Task 1: Define AnonAuthHooks; extend AnonAuthConfig** - `032c328` (feat)
2. **Task 2: Thread hooks through createAnonAuth; extend RouterConfig + OAuthRouterConfig; re-export AnonAuthHooks** - `dbc9968` (feat)
3. **Task 3: Wave 0 hooks-scaffolding test** - `9133e97` (test)

## Files Created/Modified

- `src/types/index.ts` (+33 lines) — New `AnonAuthHooks` interface placed before `AnonAuthConfig`; `hooks?: AnonAuthHooks` appended last to `AnonAuthConfig`. `passkey?` fields from 11-01 preserved verbatim.
- `src/server/router.ts` (+2 lines) — `AnonAuthHooks` added to import; `hooks?: AnonAuthHooks` appended to `RouterConfig`.
- `src/server/oauth/router.ts` (+2 lines) — `AnonAuthHooks` added to existing import; `hooks?: AnonAuthHooks` appended to `OAuthRouterConfig`.
- `src/server/index.ts` (+4 lines) — `hooks: config.hooks` added to both factory calls; `AnonAuthHooks` added to type re-export block.
- `src/__tests__/hooks-scaffolding.test.ts` (136 lines, new) — 6 vitest tests: 2 compile fixtures, 1 threading spy, 3 grep-guard invariants.

## AnonAuthHooks Type Design (Pattern 6)

```typescript
export interface AnonAuthHooks {
  afterAuthSuccess?: (ctx: unknown) => Promise<unknown>;   // Phase 14
  backfillKeyBundle?: (ctx: unknown) => Promise<unknown>;  // Phase 15
  onAuthEvent?: (event: unknown) => void | Promise<void>;  // Phase 13
}
```

`unknown` ctx is deliberate per Assumption A1: Phase 11 has no knowledge of the ctx shapes needed by Phases 13/14/15. Each downstream phase narrows its own parameter type independently, without requiring a config-shape change.

## Threading Strategy (Pitfall 4 Mitigation)

Both factory call sites in `createAnonAuth` receive `hooks: config.hooks`:

```typescript
oauthRouter = createOAuthRouter({ ..., hooks: config.hooks });  // line ~199
const router = createRouter({ ..., hooks: config.hooks });      // line ~218
```

`grep -c "hooks: config.hooks" src/server/index.ts` returns 2. Task 3's `hooks: config.hooks` count assertion would catch a regression if either call site is accidentally dropped in a future edit.

## Test Strategy

| Test | Assertion |
|------|-----------|
| Compile fixture: hooks omitted | `cfg.hooks === undefined`, `createAnonAuth` does not throw |
| Compile fixture: hooks: {} | `cfg.hooks` deep-equals `{}`, `createAnonAuth` does not throw |
| Threading spy | `afterAuthSuccess`, `backfillKeyBundle`, `onAuthEvent` all `not.toHaveBeenCalled()` after construction |
| Grep guard: afterAuthSuccess | `execSync grep \| wc -l` === `'0'` |
| Grep guard: backfillKeyBundle | `execSync grep \| wc -l` === `'0'` |
| Grep guard: onAuthEvent | `execSync grep \| wc -l` === `'0'` |

The grep guards will fail intentionally in Phases 13/14/15 when call sites are wired — at that point the tests should be updated to reflect the new invariants.

## Verification Commands Run

```
npm run typecheck                                           # exit 0 (after each task)
npm test -- --run src/__tests__/hooks-scaffolding.test.ts  # exit 0, 6 tests passed
npm test -- --run                                           # exit 0, 291 tests passed, 4 skipped, 0 regressions
grep -c "hooks: config.hooks" src/server/index.ts          # 2
grep -r 'hooks\.afterAuthSuccess(' src/server | wc -l      # 0
grep -r 'hooks\.backfillKeyBundle(' src/server | wc -l     # 0
grep -r 'hooks\.onAuthEvent(' src/server | wc -l           # 0
```

## Downstream Phase Unblock Note

Phases 13, 14, and 15 may now install call sites without a config-shape change:

```typescript
// Phase 14 (HOOK-02..06) — fires after auth succeeds
if (config.hooks?.afterAuthSuccess) {
  await config.hooks.afterAuthSuccess(ctx);
}

// Phase 15 (BACKFILL-01..04) — fires on login when sealingKeyHex present
if (config.hooks?.backfillKeyBundle) {
  await config.hooks.backfillKeyBundle(ctx);
}

// Phase 13 (ANALYTICS-01..06) — fire-and-forget
if (config.hooks?.onAuthEvent) {
  void config.hooks.onAuthEvent(event);
}
```

The `AnonAuthHooks` re-export from `src/server/index.ts` means consumers can type their callbacks without importing from the internal types path:

```typescript
import { createAnonAuth, type AnonAuthHooks } from '@vitalpoint/near-phantom-auth/server';
```

## Decisions Made

- `unknown` ctx per Pattern 6 (Assumption A1) — downstream phases own type narrowing; no ctx shape lock-in in Phase 11
- All three callbacks `?` (Pitfall 3 guard) — `hooks: {}` must compile
- Both factory calls updated in lockstep (Pitfall 4 guard) — OAuth router is not a second-class citizen
- JSDoc on each callback encodes downstream phase ownership for future maintainers

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phases 11-03, 11-04, 11-05 (webauthn.ts + router.ts wiring) are unblocked and unaffected by hooks scaffolding
- Phases 13/14/15 may plug call sites into the existing scaffolding without modifying `AnonAuthConfig`, `RouterConfig`, or `OAuthRouterConfig`
- Full test suite green, typecheck clean

---
*Phase: 11-backup-eligibility-flags-hooks-scaffolding*
*Completed: 2026-04-29*

## Self-Check: PASSED
