---
phase: 14
plan: 03
subsystem: oauth-router-hooks
tags: [hooks, second-factor, oauth-router, fire-points, callback, runOAuthHook-helper, parallel-with-14-02]
requires:
  - "Plan 14-01 — AfterAuthSuccessCtx + AfterAuthSuccessResult discriminated-union types (parallel worktree)"
provides:
  - "runOAuthHook helper local to createOAuthRouter factory closure"
  - "HOOK-04 fire points × 3 OAuth callback success branches (existing-same-provider, link-by-email, new-user)"
  - "HOOK-05 short-circuit response shape on all 3 branches (spread body + structured secondFactor echo)"
  - "Pitfall 4 Option A locked: oauth.callback.success emit fires regardless of short-circuit"
affects:
  - "src/server/oauth/router.ts — POST /oauth/:provider/callback handler (3 success branches)"
tech-stack:
  added: []
  patterns:
    - "Local helper pattern (Pattern 7 / RESEARCH §Pattern 7) — encapsulates 3 IDENTICAL fire blocks; closure-captures config.hooks; private to factory"
    - "Template-literal type narrowing — Extract<AfterAuthSuccessCtx, { authMethod: `oauth-${string}` }> ensures only OAuth ctx variants compile at call sites (T-14-05)"
    - "Hook-before-cookie ordering — runOAuthHook resolves BEFORE sessionManager.createSession on every branch (T-14-02 Set-Cookie leak mitigation)"
key-files:
  created: []
  modified:
    - src/server/oauth/router.ts
decisions:
  - "Helper hybrid (Pattern 7): inline at register/login (different ctx shapes) — helper for the 3 OAuth branches (identical ctx shape) — drift across branches is a correctness risk; helper enforces lockstep by construction"
  - "Pitfall 4 Option A: oauth.callback.success emit fires on every branch regardless of short-circuit — auth itself succeeded, consumer's second-factor decision is downstream observability, not a re-classification"
  - "OAuth ctx OMITS codename — OAuthUser has no codename column (verified types/index.ts:410-422); Plan 14-01 marks codename optional on OAuth variant (Open Question #2 Option (b))"
  - "Branch 3 (new user) orphan trade-off WIDER than register-finish: NO transaction wrapper at all → user + MPC + IPFS blob ALL committed even on continue:false (Pitfall 6 / T-14-04). Inline block comment flags this for Plan 14-04 README copy."
  - "Helper takes AnonAuthHooks['afterAuthSuccess'] indexed-access type so it can accept undefined directly (Pitfall 7 / T-14-07) — caller passes config.hooks?.afterAuthSuccess unchanged"
metrics:
  duration: "~10 minutes"
  completed: 2026-04-30T10:59:27Z
  tasks: 2
  files_changed: 1
  lines_added: 73
  lines_removed: 1
---

# Phase 14 Plan 03: Wire afterAuthSuccess into OAuth router × 3 branches Summary

Wired the v0.7.0 `hooks.afterAuthSuccess` into all three OAuth callback success branches in `src/server/oauth/router.ts`, using a local `runOAuthHook` helper to enforce lockstep across the 3 IDENTICAL fire blocks (drift between branches is a correctness risk; helper makes drift impossible by construction).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add runOAuthHook helper + import AfterAuthSuccessCtx | `0e41b6a` | src/server/oauth/router.ts |
| 2 | Wire HOOK-04 fire points across all 3 OAuth callback success branches | `d2d87ef` | src/server/oauth/router.ts |

## Helper Signature (lifted into createOAuthRouter factory closure)

```typescript
async function runOAuthHook(
  hook: AnonAuthHooks['afterAuthSuccess'],
  ctx: Extract<AfterAuthSuccessCtx, { authMethod: `oauth-${string}` }>,
): Promise<{ status: number; body: Record<string, unknown> } | undefined> {
  if (!hook) return undefined;
  const result = await hook(ctx);
  if (result.continue) return undefined;
  return { status: result.status, body: result.body };
}
```

Inserted immediately after the existing `emit = wrapAnalytics(...)` capture (line 68) and before `// Create rate limiter instance` (line 96). The helper is private to the factory closure — closes over no implicit state, takes `hook` and `ctx` explicitly.

**Why a helper here but inline at register/login:** OAuth has 3 IDENTICAL fire sites — extraction prevents drift and keeps the branch bodies readable. Register and login (Plan 14-02 territory) have ONE site each with different ctx shapes; extraction adds indirection without dedup.

## Three Branch-Specific Insert Points

### Branch 1 — existing user, same provider (line 265)

**Surrounding logic:**
- AFTER `db.getOAuthUserByProvider(provider, profile.providerId)` resolves a user (line 262)
- BEFORE `sessionManager.createSession(user.id, res, ...)` (line 282)

**Line ordering invariant:** `getOAuthUserByProvider:262 < HOOK-04 fire:265 < createSession:282` ✓

**Hook ctx shape:**
```typescript
{
  authMethod: `oauth-${provider}` as const,
  userId: user.id,
  nearAccountId: user.nearAccountId,
  provider,
  req,
}
```

`codename` is OMITTED.

### Branch 2 — existing user, link by email (line 318)

**Surrounding logic:**
- AFTER `db.linkOAuthProvider(user.id, providerData)` (line 316)
- BEFORE `sessionManager.createSession(user.id, res, ...)` (line 332)

**Line ordering invariant:** `linkOAuthProvider:316 < HOOK-04 fire:318 < createSession:332` ✓

### Branch 3 — new user (line 417)

**Surrounding logic:**
- AFTER the IPFS recovery setup `}` close (line 412 — closes `if (ipfsRecovery && profile.email)`)
- BEFORE `sessionManager.createSession(newUser.id, res, ...)` (line 437)

**Line ordering invariant:** `IPFS-recovery-block-end:412 < HOOK-04 fire:417 < createSession:437` ✓

**Special note:** Plan 14-04 README copy MUST include the inline block comment verbatim — see "Threat Flags / Pitfall 6 trade-off" below.

## oauth.callback.success Emit Count Doubled (Pitfall 4 Option A)

**Pre-Plan-14-03 emit count:** 3 (one per continue:true path).

**Post-Plan-14-03 emit count:** 6 (3 continue:true paths + 3 continue:false short-circuit paths).

**Why doubled:** Pitfall 4 Option A is locked — `oauth.callback.success` fires regardless of whether the consumer's hook short-circuits. The auth itself succeeded (token exchange + user resolution). The consumer's second-factor decision is downstream observability, not a re-classification of the auth event.

**Per-request invariant:** A single OAuth callback request still emits the event EXACTLY ONCE — either the continue:true path emits it, or the continue:false short-circuit path emits it, never both (mutually exclusive code paths inside `if (sf) { ... } else /* implicit */ { ... }`).

**Verification:** `grep -c "type: 'oauth.callback.success'" src/server/oauth/router.ts` returns `6` (acceptance gate ≥ 6 satisfied).

## Pitfall 6 / T-14-04 Trade-off — flag for Plan 14-04 README copy

**Documented as inline block comment immediately above the Branch 3 helper call:**

```typescript
// ░░ Phase 14 HOOK-04 fire point — Branch 3 (new user) ░░
// HARSHEST orphan trade-off in v0.7.0: NO transaction wrapper. A hook throw or
// continue:false leaves user (db.createOAuthUser at line ~315), MPC account
// (mpcManager.createAccount at line ~304), AND IPFS recovery blob (db.storeRecoveryData
// at line ~339) ALL committed. README in Plan 14-04 documents this verbatim
// (RESEARCH §Pitfall 6 / T-14-04). Mitigation: idempotent + non-throwing hooks.
```

**Why this matters:**
- Branch 3 has NO transaction wrapper at all (verified by reading `oauth/router.ts:325-385` end-to-end — no `db.transaction(fn)` call).
- The orphan surface is wider than register-finish (which DOES have a transaction wrapper but still leaks the MPC fund).
- Plan 14-04's README copy must reproduce this trade-off verbatim. The `second-factor-orphan.test.ts` in Plan 14-04 should be a CHANGE DETECTOR that asserts the IPFS CID IS in the DB after a continue:false on Branch 3 (NOT not-in-DB — the trade-off is locked).

## Line-Count Diff for src/server/oauth/router.ts

- **Pre-Plan-14-03:** 447 lines.
- **Post-Plan-14-03:** 519 lines.
- **Delta:** +72 lines (helper definition: ~24 lines; 3× fire blocks: ~12 + 16 + 20 lines including Pitfall 6 inline doc).

Slightly over the plan's predicted 50-70 because the Pitfall 6 inline block comment was preserved verbatim from the plan's `<action>` block — this is the plan's intent (the comment IS the README copy source).

## Verification Results

- ✅ `npm test -- --run src/__tests__/analytics-oauth.test.ts`: 10/10 pass. Phase 13 OAuth lifecycle test surface is unchanged — they pass `hooks: { onAuthEvent }` only; the optional-chain guard `if (!hook) return undefined;` makes the missing-`afterAuthSuccess` path identical to pre-Phase-14 behavior.
- ⚠️ `npm run typecheck`: 4 errors remain. All 4 are type-only inconsistencies waiting on Plan 14-01 (parallel worktree) to land:
  1. `Module '"../../types/index.js"' has no exported member 'AfterAuthSuccessCtx'.` (Plan 14-01 will add the export)
  2-4. `Property 'continue' / 'status' / 'body' does not exist on type 'unknown'.` — `result` is typed as `unknown` because the current `afterAuthSuccess?: (ctx: unknown) => Promise<unknown>` signature has not yet been tightened to the discriminated-union return type. Plan 14-01 owns this tightening.
- ✅ All Task 1 acceptance gates pass (helper signature, optional-chain guard, awaits hook, no log calls in helper region, line ordering emit < helper < rate-limiter).
- ✅ All Task 2 acceptance gates pass (`runOAuthHook` called exactly 3 times, `oauth-${provider} as const` exactly 3 times, HOOK-05 short-circuit response exactly 3 times, no `codename` field at any call, `oauth.callback.success` emit count = 6, no log calls in any fire-block region).

Per parent agent guidance: "Type-only inconsistencies between worktrees surface during the post-merge test gate; do not block on them." The post-merge typecheck will run against Plan 14-01's tightened types and resolve all 4 errors.

## Deviations from Plan

None. Plan executed exactly as written. The 4 expected typecheck errors are pre-merge cross-worktree dependencies, not deviations.

## Threat Surface Scan

The plan's `<threat_model>` lists 6 threat IDs (T-14-02, T-14-03, T-14-04, T-14-05, T-14-07, T-14-08, T-14-09). Each is mitigated or accepted by construction:

| Threat ID | Disposition | Verified |
|-----------|-------------|----------|
| T-14-02 (Set-Cookie leak on short-circuit) | mitigate | All 3 fire sites resolve `runOAuthHook` BEFORE `sessionManager.createSession`; per-branch line-ordering verified |
| T-14-03 (PII in library logs) | mitigate | `awk` over each fire-block region returns 0 log calls; helper itself has 0 log calls |
| T-14-04 (Branch 3 orphan extends to IPFS) | accept (documented) | Inline block comment above Branch 3 fire site; flagged in this Summary for Plan 14-04 README copy |
| T-14-05 (type narrowing — provider on wrong variant) | mitigate | Helper signature uses `Extract<AfterAuthSuccessCtx, { authMethod: \`oauth-${string}\` }>` template-literal pattern — only OAuth variants compile |
| T-14-07 (undefined hook crash) | mitigate | Helper's `if (!hook) return undefined;` literal verified; analytics-oauth.test.ts (which omits afterAuthSuccess) passes 10/10 |
| T-14-08 (async race) | mitigate | Helper's `const result = await hook(ctx);` literal verified |
| T-14-09 (analytics double-fire / wrong-event on short-circuit) | mitigate | Pitfall 4 Option A locked — emit count grew from 3 → 6 (3 continue:true + 3 continue:false), per-request invariant: exactly one emit per request, mutually exclusive code paths |

No new threat surface introduced beyond what the plan's threat model anticipates. No `## Threat Flags` section needed.

## Known Stubs

None. All 3 fire points are fully wired against the agreed final shape from Plan 14-01. The `it.todo` stubs in Wave 0's `src/__tests__/second-factor-oauth.test.ts` (Plan 14-01 territory) are the test surface that Plan 14-04 will turn green — they remain `it.todo` as the plan expects.

## TDD Gate Compliance

Plan type is `execute`, not `tdd` — no RED/GREEN/REFACTOR gate sequence required. Tests will be authored in Plan 14-04.

## Self-Check: PASSED

**Created files:**
- ✅ FOUND: `.planning/phases/14-second-factor-enrolment-hook/14-03-SUMMARY.md` (this file, after this commit)

**Modified files:**
- ✅ FOUND: `src/server/oauth/router.ts` (519 lines; helper at line 86; fire points at 265, 318, 417)

**Commits:**
- ✅ FOUND: `0e41b6a` — feat(14-03): add runOAuthHook helper and import AfterAuthSuccessCtx
- ✅ FOUND: `d2d87ef` — feat(14-03): wire afterAuthSuccess across 3 OAuth callback branches
