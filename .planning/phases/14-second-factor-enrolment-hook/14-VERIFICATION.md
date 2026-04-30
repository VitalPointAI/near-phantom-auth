---
phase: 14-second-factor-enrolment-hook
verified: 2026-04-30T08:30:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 14: Second-Factor Enrolment Hook Verification Report

**Phase Goal:** Expose `hooks.afterAuthSuccess` that fires inline inside the registration transaction (after passkey verify + DB persist + MPC funding, before `sessionManager.createSession`) on passkey register, passkey login, AND OAuth callback success. Most-invasive cross-cutting phase — sits inside `db.transaction()`, defers session creation, has the MPC-funded-but-rolled-back trade-off.

**Verified:** 2026-04-30T08:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Hook fires AFTER passkey verify + DB persist + MPC funding but BEFORE `sessionManager.createSession` on `POST /register/finish` (`authMethod: 'passkey-register'`); `continue: false` short-circuits with consumer's body and NO session cookie | VERIFIED | `src/server/router.ts:248-277` — hook fires inside `doRegistration` callback after `adapter.createPasskey` (line 238) and before `sessionManager.createSession` (line 279). Awk gate confirms ordering: createPasskey:238 < hook:264 < createSession:279. `result.continue === false` branch returns `{ user, session: undefined, secondFactor }` from the closure (line 275); the post-transaction handler at line 301-308 issues `res.status(secondFactor.status).json({ ...secondFactor.body, secondFactor })` without invoking createSession. Test `second-factor-register.test.ts:261` asserts `res.headers['set-cookie']` is undefined on short-circuit. 12/12 register tests pass. |
| 2 | Same hook fires inside `POST /login/finish` (`authMethod: 'passkey-login'`) after passkey verify, before session creation — same return-shape contract; same short-circuit semantics | VERIFIED | `src/server/router.ts:395-416` — hook fires after `if (!user)` early-return (line 390) and before `sessionManager.createSession` (line 443). Manual line-order check: user-not-found:391 < hook:407 < createSession:443. Login uses NO transaction wrapper (locked decision). On `continue: false`, the handler at line 430-437 returns the structured echo response without calling createSession. Test `second-factor-login.test.ts:233` asserts `res.headers['set-cookie']` is undefined on short-circuit; one test explicitly asserts `db.transaction` is NOT invoked even when adapter exposes it. 11/11 login tests pass. |
| 3 | Same hook fires inside the OAuth callback (`authMethod: 'oauth-google' \| 'oauth-github' \| 'oauth-twitter'`) after token exchange + user resolution, before session creation — `provider` is exposed on the hook context | VERIFIED | `src/server/oauth/router.ts:86-94` — `runOAuthHook` helper defined inside `createOAuthRouter`. Helper signature uses `Extract<AfterAuthSuccessCtx, { authMethod: \`oauth-${string}\` }>` template-literal narrowing. Called 3× (one per branch): Branch 1 (existing user, same provider) at line 266 after `db.getOAuthUserByProvider`; Branch 2 (link by email) at line 319 after `db.linkOAuthProvider`; Branch 3 (new user) at line 423 after `db.createOAuthUser` + IPFS recovery. Each call passes ctx with `authMethod: \`oauth-${provider}\` as const`, `provider` field, no codename. All 3 fire BEFORE `sessionManager.createSession` (lines 282/337/437 respectively). 17/17 oauth tests pass including all 3 branch describe blocks. |
| 4 | A hook returning `{ continue: false, status, body }` produces a response that includes `secondFactor: { status, body }` echo on the corresponding endpoint; `continue: true` omits the echo | VERIFIED | `src/types/index.ts:637, 653` — `secondFactor?: { status: number; body: Record<string, unknown> }` appended to BOTH `RegistrationFinishResponse` (line 637) and `AuthenticationFinishResponse` (line 653). Echo wired in 5 fire-point response shapes: `router.ts:304-307` (register), `router.ts:433-436` (login), `oauth/router.ts:278/329/433` (OAuth × 3 branches). Each short-circuit returns `res.status(...).json({ ...body, secondFactor: { status, body } })`. Test assertions: register test line 226-230 asserts `res.body.secondFactor` matches `{ status: 202, body: {...} }`; oauth tests assert `secondFactor: sf` echo on each branch. `continue: true` paths flow through standard responses with no `secondFactor` field; tests verify `res.body.secondFactor` is undefined on `continue: true`. |
| 5 | A consumer reading the README finds the MPC-funded-but-rolled-back failure mode explicitly documented (MPC `createAccount` runs BEFORE the transaction, leaving an orphaned MPC account on hook throw), with the recommended mitigation (idempotent, non-throwing hooks returning `{ continue: false }` for soft failures) | VERIFIED | `README.md:191-316` — new top-level section "## Second-Factor Enrolment Hook (v0.7.0)" sits between Cross-Domain Passkeys (line 91) and Installation (line 317). Section covers: (a) discriminated-union signature with all 3 ctx variants + return type (line 222-241); (b) all 5 fire points with file refs and ordering (line 200-218); (c) MPC orphan trade-off paragraph (line 282-300) with the verbatim phrase "orphaned funded NEAR implicit account with no DB record"; (d) recommended mitigation "make your hook idempotent and non-throwing. Prefer `{ continue: false, status, body }` over `throw`" (line 290-292); (e) cookie semantics on short-circuit (line 302-309); (f) `req` is bare Express Request — consumer responsibility to sanitize (line 278-280); (g) OAuth Branch 3 widened trade-off including IPFS recovery blob (line 297-300). Phase 16 RELEASE-01 will lift this section verbatim. The `second-factor-orphan.test.ts:215-224` change-detector encodes the "MPC before transaction" decision in CI via `invocationCallOrder` assertion. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types/index.ts` | AfterAuthSuccessProvider, AfterAuthSuccessCtx (3-variant DU), AfterAuthSuccessResult; tightened AnonAuthHooks.afterAuthSuccess; secondFactor? on both finish responses; Request import from express | VERIFIED | All 3 types present (lines 59, 82, 122). `afterAuthSuccess?: (ctx: AfterAuthSuccessCtx) => Promise<AfterAuthSuccessResult>` at line 152. `secondFactor?` on both finish responses (lines 637, 653). Phase 11 placeholder `(ctx: unknown) => Promise<unknown>` removed. Discriminated union has 3 variants keyed off `authMethod`; `provider: AfterAuthSuccessProvider` is on OAuth variant only (line 104). |
| `src/server/index.ts` | Re-exports of AfterAuthSuccessCtx, AfterAuthSuccessResult, AfterAuthSuccessProvider | VERIFIED | Lines 265-267 — three re-exports added immediately after `AnonAuthHooks` (Phase 11 anchor). |
| `src/server/router.ts` | HOOK-02 fire point in register-finish (inside doRegistration); HOOK-03 fire point in login-finish (no transaction); HOOK-05 short-circuit on both | VERIFIED | Register HOOK-02 at lines 248-277 (inside `doRegistration` between createPasskey:238 and createSession:279); login HOOK-03 at lines 395-416 (after getUserById:388 success, before createSession:443). Both use `result.continue === false` literal-equality narrowing (post-Wave-1 fix for `strict: false` tsconfig). Both have `await config.hooks.afterAuthSuccess` with optional-chain guard (Pitfall 7/8). secondFactor carried out of doRegistration via return tuple (closure pattern). Pitfall 4 Option A locked: `register.finish.success` emit position unchanged; `login.finish.success` reordered to fire BEFORE short-circuit branch. |
| `src/server/oauth/router.ts` | runOAuthHook helper + HOOK-04 fire points × 3 branches; HOOK-05 short-circuit on all 3 | VERIFIED | Helper at lines 86-94 with `Extract<AfterAuthSuccessCtx, { authMethod: \`oauth-${string}\` }>` narrowing. Branch 1 fire at line 266 (after getOAuthUserByProvider, before createSession); Branch 2 fire at line 319 (after linkOAuthProvider, before createSession); Branch 3 fire at line 423 (after IPFS recovery, before createSession). All 3 short-circuit with `res.status(sf.status).json({ ...sf.body, secondFactor: sf })`. `oauth.callback.success` emit count = 6 (3 continue:true + 3 continue:false short-circuit), per Pitfall 4 Option A. |
| `src/__tests__/second-factor-register.test.ts` | HOOK-02 + HOOK-05 + Pitfall 4 + backwards-compat; ≥10 it() blocks; zero it.todo | VERIFIED | 12 it() blocks; 0 it.todo (all converted from Wave-0 stubs). 312 lines. Asserts: hook-called-once, ctx shape, continue:true vs continue:false, set-cookie undefined on short-circuit, Pitfall 4 Option A success-emit-regardless, hooks:{} backcompat, hooks-omitted backcompat. All 12 tests pass. |
| `src/__tests__/second-factor-login.test.ts` | HOOK-03 + HOOK-05 + no-transaction-wrapper + Pitfall 4 + backcompat; ≥9 it() blocks; zero it.todo | VERIFIED | 11 it() blocks; 0 it.todo. 277 lines. Includes the critical `transactionSpy.not.toHaveBeenCalled()` assertion (login has no transaction wrapper). All 11 tests pass. |
| `src/__tests__/second-factor-oauth.test.ts` | HOOK-04 × 3 branches + HOOK-05 + Pitfall 4 + Pitfall 6 (IPFS commit on Branch 3); ≥12 it() blocks; zero it.todo | VERIFIED | 17 it() blocks; 0 it.todo. 542 lines. 3 describe blocks for branches + backcompat. Pitfall 6/T-14-04 assertion present (lines 446-449): on Branch 3 short-circuit, `db.createOAuthUser`, `mpcManager.createAccount`, `ipfsRecovery.createRecoveryBackup`, AND `db.storeRecoveryData` are ALL called exactly once. Cookie hygiene assertion via `noLiveSessionCookie` helper that filters expired clear-cookie entries. All 17 tests pass. |
| `src/__tests__/second-factor-orphan.test.ts` | HOOK-06 change detector + DB rollback + call-order; ≥6 it() blocks; zero it.todo | VERIFIED | 7 it() blocks; 0 it.todo. 248 lines. mockDb.transaction emulator at lines 135-155 (calls fn(adapter), rethrows on error). The change-detector call-order assertion at lines 215-224: `expect(mpcCallOrder).toBeLessThan(txCallOrder)` — encodes "MPC before transaction" in CI. Hook throw → 500 + register.finish.failure(reason='internal-error') asserted at lines 226-232. All 7 tests pass. |
| `README.md` | Section "Second-Factor Enrolment Hook (v0.7.0)" between Cross-Domain Passkeys and Installation; covers 7 required topics | VERIFIED | Lines 191-316. Section ordering: Cross-Domain Passkeys:91 < Second-Factor:191 < Installation:317. All 7 topics covered: discriminated-union signature, 5 fire points with file refs, MPC orphan trade-off (verbatim canonical copy for Phase 16 RELEASE-01), recommended mitigation, Set-Cookie semantics, bare Express Request responsibility, OAuth Branch 3 widened IPFS trade-off. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `AnonAuthHooks.afterAuthSuccess` (types/index.ts) | `AfterAuthSuccessCtx` + `AfterAuthSuccessResult` | function signature | WIRED | `src/types/index.ts:152` — `afterAuthSuccess?: (ctx: AfterAuthSuccessCtx) => Promise<AfterAuthSuccessResult>` |
| `src/server/index.ts` re-export block | `AfterAuthSuccessCtx`, `AfterAuthSuccessResult`, `AfterAuthSuccessProvider` | export type | WIRED | Lines 265-267 — three re-exports adjacent to AnonAuthHooks |
| Register-finish handler | `config.hooks?.afterAuthSuccess` | optional-chain inside doRegistration | WIRED | `src/server/router.ts:262-269` — optional-chain guard + literal `'passkey-register'` ctx |
| Login-finish handler | `config.hooks?.afterAuthSuccess` | optional-chain after getUserById | WIRED | `src/server/router.ts:405-412` — optional-chain guard + literal `'passkey-login'` ctx |
| OAuth callback × 3 branches | `runOAuthHook(config.hooks?.afterAuthSuccess, ctx)` | local helper | WIRED | `src/server/oauth/router.ts:266, 319, 423` — all 3 branches use the helper with branch-specific ctx |
| `doRegistration` return tuple | post-transaction `secondFactor` handling | tuple destructure | WIRED | `src/server/router.ts:287` — `const { user, secondFactor } = db.transaction ? await db.transaction(doRegistration) : await doRegistration(db);` |
| Register-finish response on continue:false | HOOK-05 secondFactor echo | `res.status().json({ ...body, secondFactor })` | WIRED | `src/server/router.ts:301-308` — short-circuit branch with spread + structured echo |
| OAuth × 3 branches response on continue:false | HOOK-05 secondFactor echo | `res.status().json({ ...sf.body, secondFactor: sf })` | WIRED | `src/server/oauth/router.ts:278, 329, 433` — three identical short-circuit returns |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `src/server/router.ts` register-finish | `secondFactor` | Hook return value `{ continue: false, status, body }` (carried via doRegistration return tuple) | Yes — sourced from consumer's `await config.hooks.afterAuthSuccess(ctx)` resolved promise; flows through `db.transaction()` callback return; spread into `res.json({...body, secondFactor})` | FLOWING |
| `src/server/router.ts` login-finish | `secondFactor` | Hook return value (direct, no transaction wrapper) | Yes — sourced from `config.hooks.afterAuthSuccess(ctx)`; flows directly into `res.json({...body, secondFactor})` | FLOWING |
| `src/server/oauth/router.ts` × 3 branches | `sf` (short-circuit descriptor) | `runOAuthHook(hook, ctx)` returns `{ status, body }` on continue:false | Yes — sourced from consumer's hook via the helper; flows into `res.json({...sf.body, secondFactor: sf})` | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Typecheck passes (no `tsc` errors) | `nvm use 20 && npm run typecheck` | exit 0, no output | PASS |
| Full test suite green | `nvm use 20 && npm test -- --run` | 31 files, 444 passed / 4 skipped / 0 failed | PASS |
| Phase 14 test files all pass | `nvm use 20 && npm test -- --run src/__tests__/second-factor-*.test.ts` | 4 files, 47 passed (12 + 11 + 17 + 7), 0 failed | PASS |
| Hook is awaited at every fire site (Pitfall 8) | `grep -c "await config.hooks.afterAuthSuccess" src/server/router.ts` + `grep -c "await runOAuthHook" src/server/oauth/router.ts` | 2 (router) + 3 (oauth) = 5 explicit awaits | PASS |
| Optional-chain guard at every fire site (Pitfall 7) | `grep -c "config.hooks?.afterAuthSuccess" src/server/router.ts` + same for oauth | 2 + 3 = 5 sites with optional chain | PASS |
| No ctx logging in library (T-14-03 anonymity) | `grep -v '^[[:space:]]*//' src/server/{router.ts,oauth/router.ts} \| grep -E 'log\.(info\|warn\|error)\([^)]*ctx'` | 0 matches | PASS |
| Discriminated narrowing uses literal-equality (post-Wave-1 fix for tsconfig strict:false) | `grep -c "result.continue === false\|result.continue === true" src/server/router.ts src/server/oauth/router.ts` | 2 (router) + 1 (oauth) = 3 explicit narrowings | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| HOOK-02 | 14-01, 14-02, 14-04 | `hooks.afterAuthSuccess(ctx)` fires inside `/register/finish` after DB persist + MPC funding, before session creation; `continue: false` returns body with status; hook throw → DB rollback via `db.transaction()` | SATISFIED | `src/server/router.ts:248-277` (fire point inside doRegistration). DB rollback verified by `second-factor-orphan.test.ts:215-224` (call-order + transaction throw propagation). `register.finish.success` analytics fires regardless (Pitfall 4 Option A). |
| HOOK-03 | 14-01, 14-02, 14-04 | Same hook fires inside `/login/finish` (`authMethod: 'passkey-login'`) after passkey verify, before session creation | SATISFIED | `src/server/router.ts:395-416` (fire point after getUserById, before createSession). NO transaction wrapper (login does no multi-write DB op between verify and session). 11 login tests assert all branches. |
| HOOK-04 | 14-01, 14-03, 14-04 | Same hook fires inside OAuth `/callback` (`authMethod: 'oauth-google' \| 'oauth-github' \| 'oauth-twitter'`) after token exchange + user resolution, before session creation; `provider` exposed on `ctx` | SATISFIED | `src/server/oauth/router.ts:266, 319, 423` (3 branches). All use `runOAuthHook` helper. ctx contains `provider` field on OAuth variant only (Pitfall 5/T-14-05 narrowing). 17 oauth tests assert all 3 branches. |
| HOOK-05 | 14-01, 14-02, 14-03, 14-04 | All 3 endpoint responses include `secondFactor?: { status: number; body: object }` echo when hook returned `continue: false`; absent on `continue: true` | SATISFIED | `src/types/index.ts:637, 653` adds `secondFactor?` to both `RegistrationFinishResponse` and `AuthenticationFinishResponse`. 5 fire-point response shapes implement the echo. Tests assert `res.body.secondFactor` matches structured echo on continue:false and is undefined on continue:true. |
| HOOK-06 | 14-04 | README documents the MPC-funded-but-rolled-back failure mode and recommended mitigation (idempotent, non-throwing hooks; prefer `continue: false` over throw) | SATISFIED | `README.md:282-300` — "MPC orphan trade-off (HOOK-06)" subsection with verbatim canonical copy. CI change-detector at `second-factor-orphan.test.ts:215-224` encodes "MPC before transaction" call-order; if MPC moves inside transaction, planner is forced to revisit README. Phase 16 RELEASE-01 lifts the README copy verbatim. |

All 5 phase-14 requirements (HOOK-02..06) are SATISFIED. No orphaned requirements detected.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No anti-patterns detected. No TODO/FIXME/PLACEHOLDER comments in modified production files. No `console.log`-only implementations. No empty handlers. The 5 fire points have full hook-fire + result-handling logic; the secondFactor echo flows through the response. The post-Wave-1 fix (`result.continue === false` instead of `if (!result.continue)`) is correct given tsconfig `strict: false`. |

### Human Verification Required

None — all 5 must-haves are programmatically verified through:
- Static checks: type contract in src/types/index.ts, code structure in router files, README presence
- Runtime checks: 47 phase-14 tests passing (12 + 11 + 17 + 7), full suite 444/4
- Cross-cutting: typecheck clean, no ctx logging, all fire points awaited and optionally-chained

The phase delivers a code-level surface (hooks called from server routers) — every observable truth is grep-verifiable AND test-asserted. No visual UI, no real-time behavior, no external service integration that would require human testing.

### Gaps Summary

No gaps found. Phase 14 fully delivers the locked goal:

1. **All 5 ROADMAP success criteria** verified against codebase artifacts.
2. **All 5 requirement IDs** (HOOK-02..06) traced to specific file:line implementations with passing tests.
3. **All 9 required artifacts** (2 type/barrel + 2 router source files + 4 test files + README section) present and substantive.
4. **All 8 key links** wired (type signature → ctx/result; barrel → consumer surface; 5 fire points → hook function; doRegistration return tuple → secondFactor handling; 5 short-circuit response shapes → HOOK-05 echo).
5. **Data-flow trace** confirms the secondFactor descriptor actually flows from consumer hook return → JSON response body, on all 5 fire-point paths.
6. **Behavioral spot-checks** all pass: typecheck clean, full suite green, hook awaited everywhere, optional-chain guarded everywhere, T-14-03 anonymity invariant respected (no ctx logged).
7. **Post-Wave-1 fix** correctly applied: explicit literal-equality narrowing (`=== false` / `=== true`) at all 3 sites because tsconfig has `strict: false`, which makes truthy/falsy narrowing on discriminated unions unreliable.
8. **Change-detector test** in CI encodes the locked HOOK-06 decision (MPC before transaction); if a future PR refactors MPC into the transaction, the test breaks and the planner must revisit the README orphan trade-off paragraph.

The phase is the most-invasive cross-cutting surface in v0.7.0 (sits inside `db.transaction()`, defers session creation, has the MPC-funded-but-rolled-back trade-off) and all the anti-pitfall mitigations from RESEARCH/VALIDATION are encoded in code AND tests. Phase 16 RELEASE-01 has a clean handoff: the canonical README section is in place and ready to lift verbatim.

Ready to proceed to Phase 15 (Lazy-Backfill Hook), which depends on Phase 14's hook-firing-inside-auth-lifecycle pattern.

---

*Verified: 2026-04-30T08:30:00Z*
*Verifier: Claude (gsd-verifier)*
