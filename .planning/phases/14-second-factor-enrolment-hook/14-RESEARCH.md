# Phase 14: Second-Factor Enrolment Hook — Research

**Researched:** 2026-04-30
**Domain:** Inline lifecycle hook firing inside Express handlers across passkey register/login + OAuth callback; short-circuit response semantics; coordination with Phase 11 hooks scaffolding and Phase 13 analytics emit points; the MPC-funded-but-rolled-back failure mode
**Confidence:** HIGH — every load-bearing fact verified by direct codebase inspection (router.ts, oauth/router.ts, mpc.ts, analytics.ts, types/index.ts, registration-auth.test.ts, analytics-lifecycle.test.ts, hooks-scaffolding.test.ts) and Phase 11/13 RESEARCH/PATTERNS files. No web/Context7 lookups required — Phase 14 is a pure call-site wiring on already-scaffolded types in already-instrumented routers. The remaining UNKNOWN is the v0.7.0-locked tightening of the `AnonAuthHooks.afterAuthSuccess` type (currently `(ctx: unknown) => Promise<unknown>` per Phase 11) — the planner needs to lock the precise `ctx` shape and return-shape contract; this RESEARCH proposes both.

---

## Summary

Phase 14 lands the **fourth and most invasive** call-site wiring in v0.7.0. Everything Phase 14 depends on is already in place:

- `AnonAuthConfig.hooks?.afterAuthSuccess` is reserved with a permissive `(ctx: unknown) => Promise<unknown>` signature (`src/types/index.ts:53-64`); Phase 14 owns tightening that signature to the locked `ctx` and return-shape contract.
- `hooks` is already threaded into `RouterConfig` (`src/server/router.ts:53`) and `OAuthRouterConfig` (`src/server/oauth/router.ts:44`) via `createAnonAuth` (`src/server/index.ts:210, 232`). No factory plumbing is needed.
- The transaction wrapper that defines the rollback boundary already exists at `src/server/router.ts:230-258` (`db.transaction(doRegistration)` with a fallback to sequential calls).
- Phase 13 analytics emit points are co-located with each Phase 14 hook fire point — Phase 14's plan must decide ordering at every site (Pitfall 4 below).

The work is **five emit points across two routers**:
1. `POST /register/finish` — fires AFTER `mpcManager.createAccount` (line 225) and AFTER `adapter.createPasskey` (line 238-246) but BEFORE `sessionManager.createSession` (line 248). The fire point is INSIDE `doRegistration`, INSIDE `db.transaction()` when present.
2. `POST /login/finish` — fires AFTER `passkeyManager.finishAuthentication` (line 335) and AFTER `db.getUserById` (line 345) but BEFORE `sessionManager.createSession` (line 353).
3. OAuth callback (`POST /oauth/:provider/callback`) **× 3 success branches** — fires after token exchange + user resolution but BEFORE `sessionManager.createSession` in each branch:
   - Existing user, same provider — fires before line 243's `createSession`.
   - Existing user, link by email — fires after `db.linkOAuthProvider` (line 277), before line 279's `createSession`.
   - New user — fires after `db.createOAuthUser` + IPFS recovery setup (lines 315-362), before line 365's `createSession`.

The hook is **inline (not fire-and-forget)**. It returns `{ continue: true }` to allow the normal response, or `{ continue: false; status; body }` to short-circuit with the consumer's body and **NO session cookie**. In the register/finish case, a thrown hook causes the existing `db.transaction()` wrapper to roll back the DB state — but the MPC `createAccount` call (line 225) ran BEFORE the transaction opened, so the on-chain implicit account is **orphaned, funded, and not recoverable from the library**. This is the core trade-off requirement HOOK-06 documents.

The short-circuit response includes a `secondFactor: { status, body }` echo on the SUCCESS path of the corresponding endpoint. On `continue: true`, the field is OMITTED. This requires extending the existing `RegistrationFinishResponse` and `AuthenticationFinishResponse` types in `src/types/index.ts:523-543` with an optional `secondFactor?` field and adding the same field to the OAuth callback response shape (which is currently inline-typed in `oauth/router.ts:250-261, 286-298, 372-383`).

**Primary recommendation:** Land the **type contract first** (Plan 01) — tighten `AnonAuthHooks.afterAuthSuccess` to the locked discriminated-union `ctx` and `{ continue: true } | { continue: false; status; body }` return shape; add `secondFactor?` to the three response shapes. Then wire the **passkey register/login fire points** (Plan 02 — single router file, two call sites that both live inside or adjacent to existing transaction wrappers). Then wire the **three OAuth branches** (Plan 03 — single router file, one helper extraction recommended to avoid drift across the three branches). Finally land **README documentation + integration tests** for the orphan-MPC trade-off and the short-circuit semantics (Plan 04). The test fixture pattern is the canonical `analytics-lifecycle.test.ts:184-207` harness — pass an `afterAuthSuccess: vi.fn()` spy through `hooks`, exercise both `continue: true` and `continue: false` branches, assert on response body and on `mockSessionManager.createSession` call count.

The single highest-risk decision is **whether the hook fires inside or outside `db.transaction()`** for the register-finish path. Inside means a hook throw rolls back the DB row (clean rollback, but the library MUST tolerate the orphan-MPC case). Outside means MPC + DB are both committed before the hook runs (no rollback on hook throw — consumer must compensate). The locked decision in REQUIREMENTS line 9 and ROADMAP line 79 is **inside the transaction**: "Hook throw → DB rollback (existing transaction wrapper)." This RESEARCH builds on that.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Define `afterAuthSuccess` ctx shape (discriminated union over `authMethod`) | API / Backend (types) | — | Phase 11 reserved `(ctx: unknown) => Promise<unknown>`; Phase 14 owns tightening it |
| Define hook return shape (`{ continue: true } \| { continue: false; status; body }`) | API / Backend (types) | — | Same locked decision as ctx shape — REQUIREMENTS HOOK-02 line 28 |
| Fire hook inside passkey `/register/finish` post-MPC, post-DB-persist, pre-session | API / Backend (router.ts) | — | Inside `doRegistration` callback, after `adapter.createPasskey` and BEFORE `sessionManager.createSession` |
| Fire hook inside passkey `/login/finish` post-verify, pre-session | API / Backend (router.ts) | — | After `db.getUserById` resolves successfully, BEFORE `sessionManager.createSession` |
| Fire hook inside OAuth callback × 3 success branches, pre-session | API / Backend (oauth/router.ts) | — | One emit at the top of each of the 3 branches BEFORE `sessionManager.createSession` |
| Echo `secondFactor: { status, body }` on the response when `continue: false` | API / Backend (router.ts + oauth/router.ts) | — | Additive optional field on `RegistrationFinishResponse`, `AuthenticationFinishResponse`, and OAuth callback inline response type |
| Skip session-cookie issuance when `continue: false` | API / Backend (router.ts + oauth/router.ts) | — | Early return from handler with consumer-supplied `status` + `body` BEFORE the `sessionManager.createSession` call |
| Surface MPC orphan trade-off in README | Documentation | — | HOOK-06; explicit warning that MPC `createAccount` runs BEFORE the transaction |
| Validate hook contract via integration tests | CI / vitest + supertest | — | Reuse the `analytics-lifecycle.test.ts` mock-router harness; add `afterAuthSuccess` spy + assertions on `createSession.mock.calls.length` and response body shape |
| Document landmine: `db.transaction` rollback semantics on async hook throw | Documentation | — | Same `doRegistration` wrapper that existed since Phase 5 (INFRA-02); transaction.ts already supports async throw → rollback in PG adapter |

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOOK-02 | `hooks.afterAuthSuccess(ctx)` fires inside `/register/finish` after DB persist + MPC funding, before `sessionManager.createSession`. Receives `{ userId, codename, nearAccountId, authMethod: 'passkey-register', req }`; returns `Promise<{ continue: true } \| { continue: false; status: number; body: object }>`. Hook throw → DB rollback. | Fire point: `src/server/router.ts:247` (between `adapter.createPasskey` line 238-246 and `sessionManager.createSession` line 248). MPC `createAccount` already at line 225 (BEFORE `doRegistration` callback). DB transaction wrapper at lines 230-258. Hook MUST run INSIDE `doRegistration` so a throw triggers `db.transaction` rollback. |
| HOOK-03 | Same hook fires inside `/login/finish` (`authMethod: 'passkey-login'`) after passkey verify, before session creation. | Fire point: `src/server/router.ts:352` (between `db.getUserById` line 345 success path and `sessionManager.createSession` line 353). No transaction wrapper here — login does not have a multi-write transaction, so a hook throw on login does NOT roll back DB state (no DB writes between verify and session). |
| HOOK-04 | Same hook fires inside OAuth `/callback` (`authMethod: 'oauth-google' \| 'oauth-github' \| 'oauth-twitter'`) after token exchange + user resolution, before session creation. `provider` exposed on `ctx`. | Fire points × 3: `src/server/oauth/router.ts:242` (existing user, same provider — between line 239 user lookup and line 243 createSession), `oauth/router.ts:278` (link by email — between line 277 `linkOAuthProvider` and line 279 createSession), `oauth/router.ts:364` (new user — between line 339 `storeRecoveryData`/email-send and line 365 createSession). MPC `createAccount` for new-user branch is at line 304, BEFORE the IPFS recovery setup; same orphan trade-off applies in the new-user branch only. |
| HOOK-05 | `/register/finish`, `/login/finish`, and OAuth callback responses include `secondFactor?: { status: number; body: object }` echo when hook returned `continue: false`; absent on `continue: true`. | Add field to `RegistrationFinishResponse` (types/index.ts:523-530), `AuthenticationFinishResponse` (types/index.ts:537-543), and the inline OAuth callback response shape (oauth/router.ts:250-261, 286-298, 372-383). Spread guard: omit field when hook returns `continue: true` (matches Pattern S4 — additive, conditional spread). |
| HOOK-06 | README documents MPC-funded-but-rolled-back failure mode. Recommended mitigation: idempotent, non-throwing hooks returning `{ continue: false }` for soft failures. | New README section under "Hooks (v0.7.0)" — Phase 16 RELEASE-01 owns the prose, but Phase 14 must produce the canonical orphan-trade-off paragraph in this RESEARCH for Phase 16 to lift verbatim. The trade-off: `mpcManager.createAccount(tempUserId)` at `router.ts:225` runs BEFORE `db.transaction()` opens (line 230) — a hook throw triggers DB rollback but the on-chain implicit account remains funded with no DB record. Same for the OAuth new-user branch (`oauth/router.ts:304` createAccount, no transaction wrapper at all). |
</phase_requirements>

---

## User Constraints (from CONTEXT.md)

> No CONTEXT.md exists for Phase 14 (no `/gsd-discuss-phase` was run — verified by `ls .planning/phases/14-second-factor-enrolment-hook/` returning only the directory itself). Constraints below are derived from STATE.md "Decisions" + REQUIREMENTS.md "Locked decisions" + ROADMAP.md Phase 14 Success Criteria — they bind this phase identically.

### Locked Decisions (from milestone scope)

- **F2 2FA hook timing: inline, blocks session creation.** Hook fires after passkey verify + DB persist + MPC funding, BEFORE `sessionManager.createSession`. Hook throw → DB rollback (existing transaction wrapper). [STATE.md line 79; REQUIREMENTS line 9]
- **F2 OAuth integration: hook fires for OAuth too.** Renamed from `afterPasskeyVerify` to `hooks.afterAuthSuccess`. Fires on `/register/finish`, `/login/finish`, AND OAuth `/callback` success. [STATE.md line 80; REQUIREMENTS line 10]
- **MPC-funded-but-rolled-back trade-off documented.** Recommended mitigation: idempotent, non-throwing hooks returning `{ continue: false }` for soft failures. [REQUIREMENTS line 32]
- **Hook receives `{ userId, codename, nearAccountId, authMethod, req }` and returns `Promise<{ continue: true } | { continue: false; status: number; body: object }>`.** [REQUIREMENTS line 28]
- **`provider` exposed on hook context for OAuth fires.** [REQUIREMENTS line 30]
- **`continue: false` short-circuits with consumer's body and NO session cookie.** [REQUIREMENTS line 28; ROADMAP line 129]
- **Anonymity invariant non-negotiable** — hook ctx surfaces `userId`, `codename`, `nearAccountId` to the CONSUMER (intended), but the library does NOT log or telemetrize those values. [STATE.md line 82]
- **`MPCAccountManager` contract FROZEN by consumer pin** — no field/method/return-shape renames. [STATE.md line 83]
- **Zero new dependencies.** [STATE.md line 82]
- **`secondFactor?: { status, body }` echo present on `continue: false`, absent on `continue: true`.** [REQUIREMENTS HOOK-05 line 31]

### Claude's Discretion

- **Whether to extract a `runAfterAuthSuccess(ctx)` helper** that encapsulates the `if (hooks?.afterAuthSuccess) { const result = await hooks.afterAuthSuccess(ctx); if (!result.continue) return res.status(result.status).json({ ...result.body, secondFactor: { status: result.status, body: result.body } }); }` block, or inline it at every fire site. **Recommendation: inline.** Phase 13 explicitly chose inline emit calls over an emitter helper (REQUIREMENTS Out-of-Scope row "EventEmitter for analytics") for the same "no indirection" reason. Inline keeps the fire site close to the surrounding logic; abstraction is `<` 6 lines repeated 5 times — extraction has negative ROI here. **Counter-argument:** the OAuth-router has 3 IDENTICAL fire sites; one helper would prevent drift. Plan can split the difference: inline for register/login (different ctx shapes), helper for the 3 OAuth branches (identical ctx shape). See Pattern 7 below.
- **Whether to make `req` on the ctx the bare Express `Request` or a sanitized subset** (e.g., `{ ip, headers }`). **Recommendation: bare Express `Request`.** REQUIREMENTS line 28 says `{ ..., req }` literally. Consumers may need `req.cookies`, `req.headers`, `req.body`, etc. for second-factor enrolment (e.g., reading a TOTP code from request body). The anonymity invariant applies to LIBRARY emissions (analytics events, logs); the consumer's hook is THEIR code — what they do with `req` is their concern. **Caveat:** documenting `req` in the hook ctx in JSDoc as "the bare Express Request — handle responsibly" is required.
- **Whether to type `body: object` precisely** (e.g., `body: Record<string, unknown>`) or leave as `object`. **Recommendation: `Record<string, unknown>`** — tighter type, still permissive enough to accept any consumer-shaped body. `object` is too loose (would allow `Date`, `RegExp`, etc., which `res.json` does not handle predictably).
- **Whether to capture `req.path` / `req.method` on the hook ctx for debugging** — recommendation: **no.** Phase 11 ctx shape was reserved as `{ userId, codename, nearAccountId, authMethod }` + `req`; adding sugar fields invites scope creep. Consumer reads `req.path` / `req.method` from `req` if needed.
- **Whether the `secondFactor` echo includes the `status` AND the `body`, or just the `body`.** REQUIREMENTS line 31: `secondFactor?: { status: number; body: object }` — both. Recommendation: ship as specified. The `status` echo is small and lets consumers detect short-circuit on the response body alone (without inspecting HTTP status, which some HTTP clients hide behind error handling).
- **Whether `authMethod` for OAuth uses `'oauth-google' | 'oauth-github' | 'oauth-twitter'` (3 string literals) or `'oauth' + provider`.** REQUIREMENTS line 30 names all three explicitly. Recommendation: use the three-literal union; mirrors `OauthProvider` already in `analytics.ts:38-39`.

### Deferred Ideas (OUT OF SCOPE for Phase 14)

- **`hooks.beforePasskeyVerify`** — REQUIREMENTS HOOK-V2-01; pre-verification hook for rate-limit overrides; deferred to v0.8+.
- **EventEmitter-style multi-subscriber API on `afterAuthSuccess`** — same Out-of-Scope row that excludes it for `onAuthEvent`; single callback only.
- **Library-managed second-factor state** (e.g., `anon_users.has_2fa` column) — REQUIREMENTS Out-of-Scope: "2FA enrolment state column on `anon_users`. Library does NOT track 2FA state; consumer persists it (anti-feature AF-06)."
- **Auto-recovery of orphaned MPC accounts** — out of scope; consumer's hook MUST be idempotent OR consumer must accept periodic on-chain orphan cleanup outside this library.
- **Hook firing on logout, account-delete, recovery flows** — REQUIREMENTS HOOK-02..04 limit to register-finish, login-finish, oauth-callback success only. Hook does NOT fire on `/logout`, `/account` DELETE, `/recovery/wallet/finish`, `/recovery/ipfs/recover` even though those create sessions or modify auth state.
- **Suppression of analytics events on hook short-circuit** — see Pitfall 4 below; recommended behavior is to fire `register.finish.success` / `login.finish.success` / `oauth.callback.success` analytics events EVEN when the hook returns `continue: false` (auth itself succeeded; the consumer-side decision to short-circuit is observability surface, not a re-classification of the auth event). The planner should confirm this ordering decision in Plan 01.
- **Type-level enforcement that hook returns the right shape** — `(ctx) => Promise<{ continue: true } | { continue: false; status; body }>` is enforced by TypeScript's structural typing at consumer call site. No tsc-fail fixture is required (this is normal type-checking, not a PII guard).

---

## Standard Stack

### Core (already installed — verified)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `express` | ^5.1.0 [VERIFIED: package.json:80] | Router + Request/Response types — ctx surfaces `req: express.Request` | Already used by `router.ts`, `oauth/router.ts`; no upgrade |
| `vitest` | ^4.0.18 [VERIFIED: package.json:91] | Test runner; `expect.toMatchObject`, `vi.fn()` spy for hook | Already used in 27 test files |
| `supertest` | ^7.2.2 [VERIFIED: package.json:88] | Integration tests for hook fire-point assertions | Already used in `registration-auth.test.ts`, `analytics-lifecycle.test.ts` |
| `pino` | ^10.3.1 [VERIFIED: package.json:79] | Optional WARN log when hook throws (consumer-controlled handling — see Pattern 6) | Already wired in every router; child logger pattern proven |
| `typescript` | ^5.9.3 [VERIFIED: package.json:90] | Discriminated-union type for ctx; structural return-shape enforcement | Already pinned |

**Version verification:** [VERIFIED 2026-04-30 by reading `package.json` at `/home/vitalpointai/projects/near-phantom-auth/package.json`]

**No new dependencies.** Phase 14 is pure call-site wiring on already-installed code. The full stack is already present.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline hook-fire block at each call site | A `runAfterAuthSuccess(hook, ctx, res)` helper in a new file `src/server/hooks-runtime.ts` | Helper is `<` 6 lines and is repeated 5 times. Helper avoids drift between OAuth branches (3 IDENTICAL emit blocks); inline keeps register/login closer to surrounding logic. Recommendation: hybrid — inline at register and login; helper in oauth/router.ts only. See Pattern 7. |
| Hook called inside `doRegistration` (inside `db.transaction`) | Hook called outside `doRegistration` after the transaction commits | INSIDE is the locked decision (REQUIREMENTS line 9). Outside means a hook throw cannot roll back DB state; consumer would see committed user with no second-factor enrolment. INSIDE is the right tradeoff — at the cost of accepting orphan MPC. |
| `body: object` in hook return shape | `body: Record<string, unknown>` | `Record<string, unknown>` is tighter and still permissive — `res.json()` accepts both. Recommendation: `Record<string, unknown>`. |
| Pass `req: express.Request` to hook | Pass sanitized `{ ip, headers, body }` subset | REQUIREMENTS line 28 says `req` literally. Consumer may need cookies / signed values / custom headers for 2FA enrolment. Recommendation: bare `Request`, document responsibility. |

### Already-Installed Tooling

The library already has:
- The `db.transaction(fn)` wrapper at `postgres.ts:185` — wraps async fn in `BEGIN`/`COMMIT`/`ROLLBACK ON ERROR`. Async throw → rollback is the existing contract (since Phase 5 INFRA-02). No DB-layer changes needed.
- Universal logger pattern: `(config.logger ?? pino({ level: 'silent' })).child({ module: 'router' })` at `router.ts:65` and `oauth/router.ts:54`. Phase 14 reuses this for the optional hook-throw WARN log.
- Mock-router test harness: `analytics-lifecycle.test.ts:184-207` (passkey + recovery + account-delete) and `analytics-oauth.test.ts:108-150` (OAuth callback × 3 branches). Phase 14 tests reuse these harnesses verbatim, replacing the `onAuthEvent` spy with an `afterAuthSuccess` spy.

---

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────────┐
                    │             createAnonAuth(config)               │
                    │  config.hooks?.afterAuthSuccess  (Phase 11 type) │
                    │                                  (Phase 14 wire) │
                    └─────────────────────────┬────────────────────────┘
                                              │
                              ┌───────────────┴───────────────┐
                              │                               │
                              ▼                               ▼
                  ┌────────────────────────┐    ┌──────────────────────────┐
                  │     createRouter       │    │   createOAuthRouter       │
                  │  (passkey)             │    │                           │
                  └───────────┬────────────┘    └────────────┬──────────────┘
                              │                              │
        ┌─────────────────────┼─────────────────────┐        │
        ▼                     ▼                     ▼        ▼
┌──────────────────┐ ┌──────────────────┐ ┌─────────────────────────────────┐
│ POST             │ │ POST             │ │ POST /:provider/callback         │
│ /register/finish │ │ /login/finish    │ │  (3 success branches)            │
└──────┬───────────┘ └────────┬─────────┘ └────────────┬─────────────────────┘
       │                      │                        │
       │  Phase 14 fire point flow (each handler):     │
       │                      │                        │
       ▼                      ▼                        ▼
  passkeyManager.        passkeyManager.         oauthManager.exchangeCode
   finishRegistration     finishAuthentication    + .getProfile + user lookup
       │                      │                        │
       ▼                      ▼                        ▼
  mpcManager.            db.getUserById          (existing user || link    │
   createAccount  ◄────  (no MPC, no DB writes)   by email || create new   │
   (orphan risk)               │                   user via                │
       │                       │                   mpcManager.createAccount │
       ▼                       │                   — orphan risk on        │
  db.transaction(              │                   new-user branch only)   │
    doRegistration:            │                        │                  │
      adapter.createUser       │                        ▼                  │
      adapter.createPasskey    │                  db.linkOAuthProvider     │
      ░░░ Phase 14 hook ░░░    │                  OR db.createOAuthUser    │
      sessionManager.          │                        │                  │
        createSession  ◄───────┼────  ░░░ Phase 14 hook fires HERE ░░░     │
  )                            │                        │                  │
       │                       │                        ▼                  │
       │                       ▼                  sessionManager.          │
       │                   ░░░ Phase 14 hook ░░░  createSession            │
       │                       │                                           │
       │                       ▼                                           │
       │                   sessionManager.                                 │
       │                   createSession                                   │
       ▼                       ▼                        ▼
  res.json({                res.json({              return res.json({
    success: true,            success: true,           success: true,
    codename,                 codename,                user: { ... },
    nearAccountId,            passkey: { ... }         isNewUser
    passkey: { ... }          ...secondFactor?         ...secondFactor?
    ...secondFactor?        })                       })
  })

  (When hook returns continue:false:
    - early-return with res.status(status).json({ ...body, secondFactor: { status, body } })
    - sessionManager.createSession is NEVER called
    - no Set-Cookie header issued)

  (When hook throws:
    - register/finish: db.transaction() catches the throw → rollback DB rows
                       MPC `createAccount` already ran outside the tx → orphan
                       error propagated to outer try/catch → 500 response
                       analytics 'register.finish.failure' fires with reason: 'internal-error'
    - login/finish:    no transaction wrapper; throw propagates to outer try/catch → 500
                       no DB writes between verify and session, so no rollback needed
    - oauth/callback:  no transaction wrapper; throw propagates → 500
                       MPC `createAccount` already ran in new-user branch → orphan
  )
```

### Recommended Project Structure

No directory changes. **Two source files modified, one types file modified, four test files added.**

```
src/
├── server/
│   ├── router.ts            # MODIFY — POST /register/finish + POST /login/finish hook fire points
│   ├── oauth/
│   │   └── router.ts        # MODIFY — POST /:provider/callback × 3 success branches
│   └── (no new file)        # Helper inlined OR co-located in oauth/router.ts (no new module)
├── types/
│   └── index.ts             # MODIFY — tighten AnonAuthHooks.afterAuthSuccess signature; add `secondFactor?` to RegistrationFinishResponse + AuthenticationFinishResponse
└── __tests__/
    ├── second-factor-register.test.ts    # CREATE — passkey register-finish hook fire (HOOK-02 + HOOK-05)
    ├── second-factor-login.test.ts       # CREATE — passkey login-finish hook fire (HOOK-03 + HOOK-05)
    ├── second-factor-oauth.test.ts       # CREATE — OAuth callback × 3 branches hook fire (HOOK-04 + HOOK-05)
    └── second-factor-orphan.test.ts      # CREATE — register-finish hook throw → DB rollback + orphan-MPC documentation test (HOOK-06)
```

The 4-file test split mirrors Phase 13's pattern (`analytics-lifecycle.test.ts`, `analytics-oauth.test.ts`, `analytics-latency.test.ts` — split by concern, not by requirement). Alternative: one `second-factor.test.ts` with 4 `describe` blocks. Recommendation: 4 files for Phase 14 because the OAuth fixture (with full OAuthManager mock) is materially different from the passkey fixture, and the orphan-MPC test needs to mock `mpcManager.createAccount` to track its call.

### Pattern 1: Tighten `AnonAuthHooks.afterAuthSuccess` signature (HOOK-02 type contract)

**What:** Replace the Phase 11 placeholder `(ctx: unknown) => Promise<unknown>` with the locked discriminated-union ctx and return-shape contract.

**Current (`src/types/index.ts:53-64`):**
```typescript
export interface AnonAuthHooks {
  /** Phase 14 — fires inside /register/finish, /login/finish, OAuth callback. */
  afterAuthSuccess?: (ctx: unknown) => Promise<unknown>;
  // ...
}
```

**Phase 14 change:**
```typescript
import type { Request } from 'express';

/** OAuth provider literal — mirror of OauthProvider in src/server/analytics.ts:38-39
 *  to avoid a circular import between types/index.ts and server/analytics.ts. */
export type AfterAuthSuccessProvider = 'google' | 'github' | 'twitter';

/** Discriminated union over `authMethod`. Each variant carries the fields the
 *  consumer needs to make a second-factor decision. `req` is the bare Express
 *  Request — consumer reads cookies, headers, body, etc. The library does NOT
 *  sanitize this surface; consumer's hook is consumer's code. */
export type AfterAuthSuccessCtx =
  | {
      authMethod: 'passkey-register';
      userId: string;
      codename: string;
      nearAccountId: string;
      req: Request;
    }
  | {
      authMethod: 'passkey-login';
      userId: string;
      codename: string;
      nearAccountId: string;
      req: Request;
    }
  | {
      authMethod: 'oauth-google' | 'oauth-github' | 'oauth-twitter';
      userId: string;
      codename: string;       // see Open Question #2 — OAuth users have no codename
      nearAccountId: string;
      provider: AfterAuthSuccessProvider;
      req: Request;
    };

/** Hook return — `continue: true` allows normal response; `continue: false`
 *  short-circuits with consumer's body (echoed under `secondFactor`) and
 *  NO session cookie. */
export type AfterAuthSuccessResult =
  | { continue: true }
  | { continue: false; status: number; body: Record<string, unknown> };

export interface AnonAuthHooks {
  /** Phase 14 — fires inside /register/finish, /login/finish, and OAuth callback
   *  AFTER passkey verify + DB persist + MPC funding, BEFORE
   *  `sessionManager.createSession`. A returned `{ continue: false, status, body }`
   *  short-circuits the response with consumer's body and NO session cookie.
   *  A throw triggers DB rollback (existing `db.transaction()` wrapper) on the
   *  register-finish path; on login and OAuth, a throw produces a 500 response
   *  but no DB writes were made between verify and session, so no rollback is
   *  needed.
   *
   *  WARNING — MPC orphan: `mpcManager.createAccount` runs BEFORE the DB
   *  transaction opens (router.ts:225) on register-finish; on the OAuth
   *  new-user branch (oauth/router.ts:304) it runs without any transaction
   *  wrapper. A hook throw or a `continue: false` AFTER MPC funding leaves
   *  an orphaned funded NEAR implicit account with no DB record. Consumers
   *  must be idempotent and prefer `continue: false` over throwing for soft
   *  failures (HOOK-06). */
  afterAuthSuccess?: (ctx: AfterAuthSuccessCtx) => Promise<AfterAuthSuccessResult>;
  // ... backfillKeyBundle, onAuthEvent unchanged
}
```

**Why discriminated union over `authMethod`:** REQUIREMENTS lines 28-30 enumerate three `authMethod` literal values (`'passkey-register'`, `'passkey-login'`, `'oauth-google' | 'oauth-github' | 'oauth-twitter'`). The discriminated union lets the consumer's hook narrow safely (`if (ctx.authMethod === 'oauth-google') { ctx.provider; }`) and gives the planner a type-checked surface to thread through.

**Why `provider` only on OAuth variants:** Type narrowing — register/login variants do not carry `provider`. Putting it on every variant as `provider?: ...` would defeat the discriminated union.

**Why `Promise<AfterAuthSuccessResult>` not `void | Promise<void>`:** The hook MUST return a discriminated result (`continue: true` or `false`). Synchronous return is allowed (TypeScript wraps it into a Promise via `Promise<AfterAuthSuccessResult>`), but the type signature ensures the consumer cannot forget the return value.

[VERIFIED: REQUIREMENTS.md line 28-30; STATE.md line 79; ROADMAP line 129] — Discriminated union shape and short-circuit semantics are explicitly locked.

[ASSUMED] — `Record<string, unknown>` over `object` for `body`. Tighter type, identical runtime behavior. Risk: low; if consumer wants `body: SomeNestedType`, structural compatibility lets it pass.

### Pattern 2: Fire-point inside `POST /register/finish` (HOOK-02)

**What:** Insert hook call INSIDE `doRegistration` callback, AFTER `adapter.createPasskey` (line 246) and BEFORE `sessionManager.createSession` (line 248).

**Current (`src/server/router.ts:230-258`):**
```typescript
const doRegistration = async (adapter: DatabaseAdapter) => {
  const user = await adapter.createUser({ ... });

  await adapter.createPasskey({ ... });

  const session = await sessionManager.createSession(user.id, res, {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return { user, session };
};

const { user } = db.transaction
  ? await db.transaction(doRegistration)
  : await doRegistration(db);

await emit({ type: 'register.finish.success', ... });

res.json({ ... });
```

**Phase 14 change:**
```typescript
const doRegistration = async (adapter: DatabaseAdapter) => {
  const user = await adapter.createUser({ ... });

  await adapter.createPasskey({ ... });

  // ░░ Phase 14 HOOK-02 fire point ░░
  // Inside the transaction so a hook throw rolls back createUser + createPasskey.
  // MPC createAccount already ran at line 225 (BEFORE this callback) — orphan risk
  // documented in README; consumer mitigation is idempotent + non-throwing hooks.
  let secondFactor: { status: number; body: Record<string, unknown> } | undefined;
  if (config.hooks?.afterAuthSuccess) {
    const result = await config.hooks.afterAuthSuccess({
      authMethod: 'passkey-register',
      userId: user.id,
      codename: user.codename,
      nearAccountId: user.nearAccountId,
      req,
    });
    if (!result.continue) {
      secondFactor = { status: result.status, body: result.body };
      // SHORT-CIRCUIT — return without session creation. The transaction wrapper
      // sees a successful return (no throw), so the createUser + createPasskey
      // rows COMMIT. The session is NOT created.
      return { user, session: undefined as undefined, secondFactor };
    }
  }

  const session = await sessionManager.createSession(user.id, res, {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return { user, session, secondFactor: undefined };
};

const { user, session, secondFactor } = db.transaction
  ? await db.transaction(doRegistration)
  : await doRegistration(db);

await emit({ type: 'register.finish.success', ... });

if (secondFactor) {
  // HOOK-05 — short-circuit response. NOTE: Cookie-Set is NOT issued because
  // sessionManager.createSession was never called.
  return res.status(secondFactor.status).json({
    ...secondFactor.body,
    secondFactor,
  });
}

res.json({
  success: true,
  codename: user.codename,
  nearAccountId: user.nearAccountId,
  passkey: { ... },
});
```

**Why hook fires INSIDE `doRegistration` not outside:**
- INSIDE: a hook throw triggers `db.transaction(fn)` rollback (Postgres `ROLLBACK` on async fn throw — see `postgres.ts:185-300` transaction adapter). `createUser` + `createPasskey` rows are wiped. MPC orphan remains (out-of-scope for rollback).
- OUTSIDE: a hook throw cannot roll back DB writes; consumer would have a DB user with no second-factor enrolment. Locked decision (REQUIREMENTS line 9): **inside.**

**Why `secondFactor` carried out of `doRegistration` via the return tuple:** The transaction wrapper expects a successful return (no throw) for both `continue: true` and `continue: false` cases — `continue: false` is NOT a rollback condition (consumer chose to short-circuit, not to fail). Carrying `secondFactor` out lets the outer code make the response decision after the transaction commits.

**Why we still call `emit({ type: 'register.finish.success', ... })` even on short-circuit:** The auth itself succeeded — passkey verified, MPC funded, DB persisted. The consumer's second-factor decision is observability surface, not a re-classification. See Pitfall 4 below for the planner's confirmation point.

**Why register/finish does NOT use a helper:** Inline keeps the fire site close to surrounding logic; the closure over `req`, `user`, and the response state is non-trivial. Extraction would force a complicated signature.

[VERIFIED: file:line locations confirmed by direct read of `src/server/router.ts:201-281` on 2026-04-30]

### Pattern 3: Fire-point inside `POST /login/finish` (HOOK-03)

**What:** Insert hook call AFTER `db.getUserById` resolves successfully (line 345-350) and BEFORE `sessionManager.createSession` (line 353).

**Current (`src/server/router.ts:328-385`):**
```typescript
router.post('/login/finish', authLimiter, async (req: Request, res: Response) => {
  try {
    // ... validateBody, finishAuthentication ...
    if (!verified || !userId) { /* failure emit + 401 */ }
    const user = await db.getUserById(userId);
    if (!user) { /* failure emit + 404 */ }

    // Create session
    await sessionManager.createSession(user.id, res, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    // ... emit success + res.json
  }
});
```

**Phase 14 change:**
```typescript
const user = await db.getUserById(userId);
if (!user) { /* unchanged */ }

// ░░ Phase 14 HOOK-03 fire point ░░
// No transaction wrapper here — login does no multi-write DB operation between
// verify and session. A hook throw produces a 500; no rollback needed.
let secondFactor: { status: number; body: Record<string, unknown> } | undefined;
if (config.hooks?.afterAuthSuccess) {
  const result = await config.hooks.afterAuthSuccess({
    authMethod: 'passkey-login',
    userId: user.id,
    codename: user.codename,
    nearAccountId: user.nearAccountId,
    req,
  });
  if (!result.continue) {
    secondFactor = { status: result.status, body: result.body };
  }
}

if (secondFactor) {
  // HOOK-05 — short-circuit. No session created, no Set-Cookie issued.
  // Login analytics: should success still fire? See Pitfall 4 — recommendation:
  // YES, fire login.finish.success because passkey verify succeeded.
  if (passkeyData) {
    await emit({
      type: 'login.finish.success',
      rpId,
      timestamp: Date.now(),
      backupEligible: deriveBackupEligibility(passkeyData.deviceType),
    });
  }
  return res.status(secondFactor.status).json({
    ...secondFactor.body,
    secondFactor,
  });
}

await sessionManager.createSession(user.id, res, { /* unchanged */ });
// ... rest unchanged (existing emit success + res.json)
```

**Why no transaction wrapper:** `passkey.ts:finishAuthentication` already wrote `updatePasskeyCounter` + (optional) `updatePasskeyBackedUp` BEFORE the handler returns. Those writes are unrelated to the session — by the time the hook fires, the verify-side state is committed. A login hook throw does NOT roll back those writes (and SHOULDN'T — counter increments are replay-protection state that must persist). The handler's outer try/catch handles the 500 path.

**Why `db.getUserById` happens BEFORE the hook fires:** The hook needs `user.codename` and `user.nearAccountId`; both come from the user row. Re-ordering would break the ctx contract.

[VERIFIED: file:line locations confirmed by direct read of `src/server/router.ts:328-385` on 2026-04-30]

### Pattern 4: Fire-point inside OAuth `POST /:provider/callback` × 3 branches (HOOK-04)

**What:** Insert hook call BEFORE `sessionManager.createSession` in EACH of the three success branches in `oauth/router.ts:202-388`.

**The three branches:**
1. **Existing user, same provider** (lines 241-262) — `db.getOAuthUserByProvider` returns a user; `sessionManager.createSession` at line 243-246; response at line 250-261.
2. **Existing user, link by email** (lines 264-300) — `db.getOAuthUserByEmail` returns a user, then `db.linkOAuthProvider` at line 277, then `sessionManager.createSession` at line 279-282; response at line 286-298.
3. **New user** (lines 302-383) — `mpcManager.createAccount` at line 304 (orphan risk), `db.createOAuthUser` at line 315-323, optional IPFS recovery setup (lines 326-362), then `sessionManager.createSession` at line 365-368; response at line 372-383.

**Phase 14 change — Branch 1 (existing user, same provider):**
```typescript
if (user) {
  // ░░ Phase 14 HOOK-04 fire point — Branch 1 ░░
  const secondFactor = await runOAuthHook(config.hooks?.afterAuthSuccess, {
    authMethod: `oauth-${provider}` as const,
    userId: user.id,
    codename: user.codename ?? '',     // OAuth users have no codename — see Open Question #2
    nearAccountId: user.nearAccountId,
    provider,
    req,
  });
  if (secondFactor) {
    await emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });
    return res.status(secondFactor.status).json({ ...secondFactor.body, secondFactor });
  }

  await sessionManager.createSession(user.id, res, { ... });
  await emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });
  return res.json({ ... });   // existing response shape unchanged for continue:true
}
```

(Branches 2 and 3 follow the same pattern; helper `runOAuthHook` extracts the shared block.)

**Helper definition (inlined at top of `createOAuthRouter` factory, after `emit` capture):**
```typescript
// Helper for HOOK-04 — encapsulates the 3 IDENTICAL fire blocks.
// Returns secondFactor descriptor on continue:false, undefined on continue:true.
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

**Why a helper here but inline at register/login:** OAuth has 3 IDENTICAL fire sites — extraction prevents drift and keeps the branch bodies readable. Register and login have ONE site each with different ctx shapes; extraction adds indirection without dedup.

**MPC orphan trade-off in OAuth:** Only the **new-user** branch runs `mpcManager.createAccount` (line 304). Branches 1 and 2 use existing users — no orphan risk. README MUST call this out: "OAuth orphan applies to NEW users only; existing-user-same-provider and link-by-email branches do not fund a new MPC account."

[VERIFIED: file:line locations confirmed by direct read of `src/server/oauth/router.ts:202-388` on 2026-04-30]

### Pattern 5: Response type extensions for `secondFactor?` (HOOK-05)

**What:** Add `secondFactor?: { status: number; body: Record<string, unknown> }` to the three response types.

**`src/types/index.ts:523-543` change:**
```typescript
export interface RegistrationFinishResponse {
  success: boolean;
  codename: string;
  nearAccountId: string;
  /** v0.7.0 — BACKUP-01 additive nested key. */
  passkey?: { backedUp: boolean; backupEligible: boolean };
  /** v0.7.0 — HOOK-05 echo of consumer's hook short-circuit. Present when
   *  `hooks.afterAuthSuccess` returned `{ continue: false, status, body }`;
   *  absent on `continue: true`. The library spreads consumer's `body`
   *  fields into the response AND echoes the structured descriptor here so
   *  consumers can detect short-circuit on the response body alone. */
  secondFactor?: { status: number; body: Record<string, unknown> };
}

export interface AuthenticationFinishResponse {
  success: boolean;
  codename: string;
  /** v0.7.0 — BACKUP-02 additive nested key. */
  passkey?: { backedUp: boolean; backupEligible: boolean };
  /** v0.7.0 — HOOK-05 echo. Same contract as RegistrationFinishResponse. */
  secondFactor?: { status: number; body: Record<string, unknown> };
}
```

**OAuth callback response (currently inline-typed in `oauth/router.ts:250-261, 286-298, 372-383`):** Phase 14 should extract the OAuth callback response shape into `src/types/index.ts` for symmetry, OR add `secondFactor?` inline in each branch. Recommendation: extract a `OAuthCallbackResponse` interface to types/index.ts now (Phase 16 RELEASE-03 will care about exported types for autocomplete) — but only if the planner wants to expand scope. Minimum viable: add `secondFactor` inline in each of the 3 OAuth response objects. **Recommendation: minimum viable for Phase 14; type extraction can be a follow-up.**

### Pattern 6: Optional WARN log on hook throw (mitigation only)

**What:** Phase 14 hook is INLINE (not fire-and-forget) — a throw propagates and triggers DB rollback (register/finish) or 500 response (login, oauth). The library does NOT swallow the throw. But the existing handler's outer try/catch at `router.ts:276-280, 380-384` and `oauth/router.ts:384-387` already catches and logs `log.error({ err: error }, '...')`. Phase 14 inherits this — no new log code needed.

**Optional defense:** A WARN log immediately before the throw propagates would aid consumer debugging. Recommendation: NOT required for Phase 14 — the existing `log.error` already logs the throw. Adding a more specific log line ("hooks.afterAuthSuccess threw") is a Phase 16 nice-to-have.

### Pattern 7: Helper extraction trade-off (Pattern 4 hybrid)

**What:** Use a helper for OAuth (3 identical fire sites); inline for register/login (1 site each).

**Why hybrid:** REQUIREMENTS Out-of-Scope row "EventEmitter for analytics" rules out generic emitter abstractions, but a small `runOAuthHook` helper local to `oauth/router.ts` is just dedup, not abstraction. The 3 OAuth branches MUST stay in lockstep — drift between them is a correctness risk (one branch missing the hook fire). Helper enforces lockstep by construction.

**Alternative considered:** Single `runAfterAuthSuccess(hook, ctx, res)` helper used by all 5 fire sites. Rejected: register/finish has special handling (carry `secondFactor` out of `doRegistration` callback so the transaction sees a clean return); login/finish handles analytics emit ordering with the short-circuit; OAuth has 3 branches with different surrounding logic. A unified helper either grows in scope or hides the differences. Hybrid is cleaner.

### Anti-Patterns to Avoid

- **Don't fire the hook OUTSIDE `doRegistration`** — locked decision is INSIDE for DB rollback. Outside means a hook throw cannot roll back DB writes; consumer is left with a committed user row but no second-factor enrolment.
- **Don't call `sessionManager.createSession` BEFORE the hook fires** — short-circuit MUST skip session creation; calling it first leaks a session cookie that the consumer cannot revoke from inside the hook.
- **Don't return `{ continue: false }` without `status` and `body`** — type signature requires both fields for the `continue: false` branch. TypeScript enforces this; planner verifies via type narrowing in test.
- **Don't pass a sanitized `req` subset to the hook** — REQUIREMENTS line 28 says `req` literally. Consumer needs full Express Request for cookies/headers/body access. JSDoc the responsibility.
- **Don't suppress analytics events on short-circuit** — `register.finish.success` / `login.finish.success` / `oauth.callback.success` STILL fire even when the hook short-circuits. The auth itself succeeded; the consumer's second-factor decision is downstream observability. Pitfall 4 below — confirm this with the planner.
- **Don't add a `provider` field to register/login ctx variants** — discriminated union requires `provider` ONLY on OAuth variants. Type narrowing breaks if `provider` is on every variant.
- **Don't extract a generic emitter helper for all 5 sites** — register and login have special handling (transaction carry-out, analytics ordering). Helper for OAuth only.
- **Don't make `body: object`** — too loose. Use `Record<string, unknown>` for `res.json()` compat.
- **Don't fire the hook on `/logout`, `/account` DELETE, recovery flows** — REQUIREMENTS HOOK-02..04 limit to register-finish, login-finish, oauth-callback success only. Adding extra fire sites is scope creep.
- **Don't call the hook synchronously** — must be `await`ed. The hook may run network I/O (TOTP verification against an external service, push notification to a phone). Async-by-default is the contract.
- **Don't omit `secondFactor` echo when hook returned `continue: false`** — HOOK-05 requires the echo. Without it, consumers cannot detect short-circuit by inspecting the response body alone.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DB rollback on hook throw | Manual `BEGIN; ... ROLLBACK` calls in handler | Existing `db.transaction(fn)` wrapper at `postgres.ts:185-300` | Wrapper handles async throw → rollback automatically; INFRA-02 since Phase 5; new code would duplicate and risk drift |
| Discriminated-union ctx narrowing | Custom type guards (`isPasskeyRegisterCtx(ctx)`) | TypeScript discriminated union over `authMethod` literal | Type narrowing is automatic when consumer checks `ctx.authMethod === 'passkey-register'`; type guards add code with no upside |
| Response-type extension for `secondFactor` | New top-level response interface (e.g., `SecondFactorShortCircuitResponse`) | Optional `secondFactor?` field on existing `RegistrationFinishResponse` / `AuthenticationFinishResponse` | Additive — preserves existing field shape; consumers who do not use the hook see no diff |
| OAuth × 3 branches dedup | Copy-paste the hook block 3 times | Local `runOAuthHook` helper (Pattern 7) | Drift between branches is a correctness risk; helper is `<` 8 lines and enforces lockstep by construction |
| WARN log for hook throw | New `pino` logger init in handler | Existing `log.error({ err }, '...')` in outer try/catch | Already logs all throws via existing handler-level error handling; specific hook log line is Phase 16 nice-to-have |

**Key insight:** Phase 14 is a pure CALL-SITE WIRING — types are already scaffolded by Phase 11, transaction wrapper exists since Phase 5 (INFRA-02), test harness exists in Phase 13's `analytics-lifecycle.test.ts`. The only NEW concept is the `secondFactor` echo and the `AfterAuthSuccessCtx` discriminated union. Build on existing infrastructure; do not introduce new modules.

---

## Runtime State Inventory

> Phase 14 is additive code-only. No string is renamed, no schema is migrated, no service is reconfigured. The `db.transaction()` wrapper already exists; the `hooks` field already threads through both router factories. No DDL change.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB schema changes; no DB rows reference any Phase 14 string | None |
| Live service config | None — no external service config carries Phase 14 strings | None |
| OS-registered state | None — no OS-level registrations affected | None |
| Secrets/env vars | None — Phase 14 introduces no new secrets and renames none | None |
| Build artifacts | tsup ESM/CJS rebuild required (additive types/exports). No stale-artifact concern beyond `npm run build` | `nvm use 20 && npm run build` |

**The canonical question:** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?* — **Nothing.** Phase 14 wires call sites in 2 source files, modifies 1 types file, adds 4 test files. No string is renamed. No identifier collides with existing state.

**Out-of-band orphan-MPC artifacts (DOCUMENTED, NOT MIGRATED):** A consumer who upgrades to v0.7.0 and starts returning `continue: false` (or whose hook throws) on register-finish will accumulate orphan MPC-funded accounts on the NEAR network. These are **out-of-scope for the library** to clean up — they are on-chain artifacts owned by the consumer's treasury. README MUST document the trade-off and recommend idempotent + non-throwing hooks.

---

## Common Pitfalls

### Pitfall 1: MPC-funded-but-rolled-back orphan account (HOOK-06)

**What goes wrong:** `mpcManager.createAccount(tempUserId)` at `router.ts:225` runs BEFORE `db.transaction()` opens at line 230. If the hook throws (or if the transaction rolls back for any reason after MPC succeeded), the on-chain implicit account remains funded with no DB row. The library has no way to recover the funds.

**Why it happens:** MPC funding is an external on-chain effect — it cannot be wrapped in the same transaction as DB writes. The current ordering (MPC first, then DB transaction) is intentional: MPC has its own idempotency checks (`accountExists` short-circuit at `mpc.ts:456-465`), so retries are safe; if MPC ran INSIDE the DB transaction, a DB rollback would still leave the on-chain effect.

**How to avoid:** Document the trade-off in the README (HOOK-06). Recommend idempotent + non-throwing hooks: consumer's hook should detect failures internally and return `{ continue: false, status: 4xx, body: { error: '...' } }` instead of throwing. With non-throwing hooks, no rollback occurs — the user IS persisted, the session is NOT created, and the consumer can replay the rest of the flow when the second-factor is supplied.

**Warning signs:** A test that mocks `afterAuthSuccess` to throw and asserts `mpcManager.createAccount` was called but `db.createUser` was not — confirms the orphan-MPC condition. Recommend Phase 14 explicitly include this assertion in `second-factor-orphan.test.ts` so the trade-off is encoded in CI.

### Pitfall 2: Cookie-Set leak on `continue: false`

**What goes wrong:** A naive implementation calls `sessionManager.createSession(user.id, res, ...)` BEFORE the hook fires — `createSession` sets the `anon_session` cookie via `res.cookie(cookieName, signedId, { ... })` (`session.ts:141-145`). If the hook then short-circuits (`continue: false`), the response includes a `Set-Cookie` header that the client persists, but no session row exists in the DB (or, with the current setup, IS in the DB — the session was just created). Either way, the cookie outlives its purpose and may cause silent re-authentication in subsequent requests.

**Why it happens:** Easy to call `createSession` first and then check the hook result.

**How to avoid:** Hook MUST fire BEFORE `sessionManager.createSession`. The session is created ONLY on `continue: true`. On `continue: false`, the response carries no `Set-Cookie` header. Test: assert `res.headers['set-cookie']` is undefined when `continue: false`.

**Warning signs:** A short-circuit response that includes `Set-Cookie: anon_session=...` — bug. Reorder to fire hook first.

### Pitfall 3: Async hook in sync transaction wrapper

**What goes wrong:** The `db.transaction(fn)` wrapper in `postgres.ts:185-300` wraps an `async` callback. Async throw propagates correctly to the wrapper, which calls `ROLLBACK`. But a buggy custom adapter that wraps the callback in `Promise.resolve(fn(client))` without `await`-ing it would silently DROP a hook throw — DB rollback would NOT happen.

**Why it happens:** Custom adapters can be wrong. The Postgres reference adapter is correct; consumers who write custom adapters may not handle async throws.

**How to avoid:** README `DatabaseAdapter` documentation MUST specify that `transaction(fn)` MUST `await` `fn(client)` and propagate throws. This is already implicit in the type signature (`transaction?<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>` — `Promise<T>` return means async throw propagates), but a docstring callout would help.

**Warning signs:** A custom-adapter test that injects a throwing hook and asserts DB state was NOT rolled back — adapter bug.

### Pitfall 4: Analytics double-fire or wrong-event on hook short-circuit

**What goes wrong:** Phase 13 emits `register.finish.success` AFTER `db.transaction()` returns and BEFORE `res.json()` (line 260-265). If Phase 14 fires the hook INSIDE `doRegistration` and the hook short-circuits, the planner has a choice:
- **Option A:** Still fire `register.finish.success` because the auth itself succeeded (passkey verified, MPC funded, DB persisted).
- **Option B:** Fire a separate `register.finish.blocked` event (NEW variant — would require Phase 13 type union extension).
- **Option C:** Suppress all events on short-circuit.

**Recommendation:** Option A. The auth event and the consumer-side decision to short-circuit are orthogonal. The consumer's analytics pipeline can correlate `register.finish.success` with the absence of a session-cookie if needed.

**Why it matters:** Inconsistent ordering across the 5 fire sites would silently break observability. Lock this in Plan 01 and verify via test.

**How to avoid:** Plan 01 MUST explicitly state: "register.finish.success / login.finish.success / oauth.callback.success fire even when afterAuthSuccess returns continue:false. failure events fire only on hook THROW (caught by outer try/catch → 500 emit) or on the existing failure paths."

**Warning signs:** A test asserting `register.finish.success` event count = 0 on short-circuit — wrong; should be 1.

### Pitfall 5: Type-narrowing breakage if `provider` lives on every ctx variant

**What goes wrong:** Defining `AfterAuthSuccessCtx` with `provider?: AfterAuthSuccessProvider` on every variant (instead of only on OAuth variants) means consumer's hook cannot narrow:
```typescript
// Bad — provider exists on every variant
if (ctx.authMethod === 'passkey-register') {
  ctx.provider; // type: AfterAuthSuccessProvider | undefined — must check
}
```

**Why it happens:** Easy to put `provider?` on the parent shape.

**How to avoid:** Discriminated union with `provider` ONLY on OAuth variants:
```typescript
export type AfterAuthSuccessCtx =
  | { authMethod: 'passkey-register'; userId; codename; nearAccountId; req }
  | { authMethod: 'passkey-login'; userId; codename; nearAccountId; req }
  | { authMethod: 'oauth-google' | 'oauth-github' | 'oauth-twitter';
      userId; codename; nearAccountId; provider: AfterAuthSuccessProvider; req };
```

**Warning signs:** Consumer's `if (ctx.authMethod === 'passkey-register') { ctx.provider; }` compiles — bug; should fail to compile (`provider` not in narrowed type).

### Pitfall 6: Hook-throw in OAuth new-user branch leaves orphan IPFS recovery blob

**What goes wrong:** OAuth new-user branch (`oauth/router.ts:302-383`) calls `mpcManager.createAccount` (line 304), then `db.createOAuthUser` (line 315), then optionally `ipfsRecovery.createRecoveryBackup` + `db.storeRecoveryData` (lines 326-356), then `sessionManager.createSession` (line 365). If Phase 14 fires the hook between line 362 (after IPFS setup) and line 365 (createSession), and the hook throws, the IPFS recovery blob is pinned to IPFS and the CID is in the DB — but the user is committed (no transaction wrapper around new-user branch). A consumer who throws on this branch leaves the user, the MPC account, AND the IPFS blob committed.

**Why it happens:** OAuth new-user has no transaction wrapper at all (verified by reading `oauth/router.ts:302-383` — no `db.transaction(fn)` call).

**How to avoid:** Plan 03 MUST explicitly note that OAuth new-user branch has NO rollback mechanism. The hook can short-circuit (`continue: false`) cleanly — user + MPC + IPFS are all committed, just no session. A throw on this branch is uglier — same state as `continue: false` plus a 500 response. Mitigation: same as HOOK-06 — recommend idempotent + non-throwing hooks.

**Warning signs:** A test that mocks `afterAuthSuccess` to throw on OAuth new-user and asserts the CID is NOT in the DB — wrong; the CID IS in the DB. Test should assert the CID IS in the DB and document the trade-off.

### Pitfall 7: Hook never fires when `hooks` is `undefined` vs. when `afterAuthSuccess` is undefined

**What goes wrong:** Conditional check `if (config.hooks?.afterAuthSuccess)` correctly handles both `hooks: undefined` and `hooks: { afterAuthSuccess: undefined }`. But a buggy `if (config.hooks)` that does NOT check `afterAuthSuccess` would attempt to call `undefined()` and throw.

**Why it happens:** Easy to forget the inner check.

**How to avoid:** Use `if (config.hooks?.afterAuthSuccess)` (with optional chaining). Phase 11 hooks-scaffolding test (`hooks-scaffolding.test.ts:81-82`) verifies that `hooks: {}` compiles — Phase 14 must verify that `hooks: {}` does NOT throw at runtime either.

**Warning signs:** A test that constructs `createAnonAuth({ ..., hooks: {} })` and exercises the auth flow — must succeed without throwing.

### Pitfall 8: Hook return value ignored (missing `await`)

**What goes wrong:** A handler that calls `config.hooks.afterAuthSuccess(ctx)` without `await` — the hook starts executing but the handler proceeds to `sessionManager.createSession` immediately. Short-circuit semantics are broken.

**Why it happens:** Hook is `Promise<...>`-returning; easy to drop the `await`.

**How to avoid:** Always `await` the hook. Type signature `Promise<AfterAuthSuccessResult>` requires the consumer to either `await` or handle the Promise — but the LIBRARY's call site MUST `await`. ESLint rule `no-floating-promises` (if added) would catch this.

**Warning signs:** A test where `afterAuthSuccess` returns a Promise that never resolves and the response still completes — bug; should hang forever.

---

## Code Examples

Verified patterns derived from existing codebase. Every example is ready for the planner to lift verbatim.

### Example 1: Tightening `AnonAuthHooks.afterAuthSuccess` signature

```typescript
// File: src/types/index.ts
// Lines: 53-64 (replace existing afterAuthSuccess line; keep backfillKeyBundle, onAuthEvent unchanged)
// Source: locked decision REQUIREMENTS.md line 28-30; ROADMAP line 129
import type { Request } from 'express';

export type AfterAuthSuccessProvider = 'google' | 'github' | 'twitter';

export type AfterAuthSuccessCtx =
  | {
      authMethod: 'passkey-register';
      userId: string;
      codename: string;
      nearAccountId: string;
      req: Request;
    }
  | {
      authMethod: 'passkey-login';
      userId: string;
      codename: string;
      nearAccountId: string;
      req: Request;
    }
  | {
      authMethod: 'oauth-google' | 'oauth-github' | 'oauth-twitter';
      userId: string;
      codename: string;
      nearAccountId: string;
      provider: AfterAuthSuccessProvider;
      req: Request;
    };

export type AfterAuthSuccessResult =
  | { continue: true }
  | { continue: false; status: number; body: Record<string, unknown> };

export interface AnonAuthHooks {
  afterAuthSuccess?: (ctx: AfterAuthSuccessCtx) => Promise<AfterAuthSuccessResult>;
  backfillKeyBundle?: (ctx: unknown) => Promise<unknown>;     // unchanged — Phase 15 owns
  onAuthEvent?: (event: AnalyticsEvent) => void | Promise<void>; // unchanged
}
```

### Example 2: Register-finish fire point

```typescript
// File: src/server/router.ts
// Lines: 230-275 (replace doRegistration body and post-transaction handling)
// Source: existing transaction wrapper preserved; hook fires inside callback
const doRegistration = async (adapter: DatabaseAdapter) => {
  const user = await adapter.createUser({
    codename,
    nearAccountId: mpcAccount.nearAccountId,
    mpcPublicKey: mpcAccount.mpcPublicKey,
    derivationPath: mpcAccount.derivationPath,
  });

  await adapter.createPasskey({
    credentialId: passkeyData.credentialId,
    userId: user.id,
    publicKey: passkeyData.publicKey,
    counter: passkeyData.counter,
    deviceType: passkeyData.deviceType,
    backedUp: passkeyData.backedUp,
    transports: passkeyData.transports,
  });

  // ░░ Phase 14 HOOK-02 fire point ░░
  let secondFactor: { status: number; body: Record<string, unknown> } | undefined;
  if (config.hooks?.afterAuthSuccess) {
    const result = await config.hooks.afterAuthSuccess({
      authMethod: 'passkey-register',
      userId: user.id,
      codename: user.codename,
      nearAccountId: user.nearAccountId,
      req,
    });
    if (!result.continue) {
      secondFactor = { status: result.status, body: result.body };
      return { user, session: undefined, secondFactor };
    }
  }

  const session = await sessionManager.createSession(user.id, res, {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return { user, session, secondFactor: undefined };
};

const { user, secondFactor } = db.transaction
  ? await db.transaction(doRegistration)
  : await doRegistration(db);

await emit({
  type: 'register.finish.success',
  rpId,
  timestamp: Date.now(),
  backupEligible: deriveBackupEligibility(passkeyData.deviceType),
});

if (secondFactor) {
  // HOOK-05 — short-circuit response. No Set-Cookie because no session created.
  return res.status(secondFactor.status).json({
    ...secondFactor.body,
    secondFactor,
  });
}

res.json({
  success: true,
  codename: user.codename,
  nearAccountId: user.nearAccountId,
  passkey: {
    backedUp: passkeyData.backedUp,
    backupEligible: deriveBackupEligibility(passkeyData.deviceType),
  },
});
```

### Example 3: Login-finish fire point

```typescript
// File: src/server/router.ts
// Lines: 345-379 (insert hook block between getUserById and createSession;
//                  reorder existing emit + res.json to handle short-circuit)
const user = await db.getUserById(userId);

if (!user) {
  await emit({ type: 'login.finish.failure', rpId, timestamp: Date.now(), reason: 'user-not-found' });
  return res.status(404).json({ error: 'User not found' });
}

// ░░ Phase 14 HOOK-03 fire point ░░
let secondFactor: { status: number; body: Record<string, unknown> } | undefined;
if (config.hooks?.afterAuthSuccess) {
  const result = await config.hooks.afterAuthSuccess({
    authMethod: 'passkey-login',
    userId: user.id,
    codename: user.codename,
    nearAccountId: user.nearAccountId,
    req,
  });
  if (!result.continue) {
    secondFactor = { status: result.status, body: result.body };
  }
}

if (passkeyData) {
  await emit({
    type: 'login.finish.success',
    rpId,
    timestamp: Date.now(),
    backupEligible: deriveBackupEligibility(passkeyData.deviceType),
  });
}

if (secondFactor) {
  return res.status(secondFactor.status).json({
    ...secondFactor.body,
    secondFactor,
  });
}

await sessionManager.createSession(user.id, res, {
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});

res.json({
  success: true,
  codename: user.codename,
  ...(passkeyData && {
    passkey: {
      backedUp: passkeyData.backedUp,
      backupEligible: deriveBackupEligibility(passkeyData.deviceType),
    },
  }),
});
```

### Example 4: OAuth helper + 3-branch fire

```typescript
// File: src/server/oauth/router.ts
// Insert near the top of createOAuthRouter, after the `emit` capture block (~line 71):
async function runOAuthHook(
  hook: AnonAuthHooks['afterAuthSuccess'],
  ctx: Extract<AfterAuthSuccessCtx, { authMethod: `oauth-${string}` }>,
): Promise<{ status: number; body: Record<string, unknown> } | undefined> {
  if (!hook) return undefined;
  const result = await hook(ctx);
  if (result.continue) return undefined;
  return { status: result.status, body: result.body };
}

// Branch 1 (existing user, same provider) — replace lines 241-261:
if (user) {
  const sf = await runOAuthHook(config.hooks?.afterAuthSuccess, {
    authMethod: `oauth-${provider}` as `oauth-${typeof provider}`,
    userId: user.id,
    codename: user.codename ?? '',     // OAuth users may not have a codename
    nearAccountId: user.nearAccountId,
    provider,
    req,
  });
  if (sf) {
    await emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });
    return res.status(sf.status).json({ ...sf.body, secondFactor: sf });
  }

  await sessionManager.createSession(user.id, res, {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  await emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });

  return res.json({
    success: true,
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, nearAccountId: user.nearAccountId, type: 'standard' },
    isNewUser: false,
  });
}

// Branch 2 (existing user, link by email) — same shape, after db.linkOAuthProvider, before createSession.
// Branch 3 (new user) — same shape, after IPFS recovery setup (line 362), before createSession (line 365).
```

### Example 5: Test fixture — register-finish hook short-circuit

```typescript
// File: src/__tests__/second-factor-register.test.ts (CREATE)
// Source: harness lifted verbatim from analytics-lifecycle.test.ts:184-207
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRouter } from '../server/router.js';
import type { DatabaseAdapter } from '../types/index.js';
// ... mock harness identical to analytics-lifecycle.test.ts ...

function makeApp(overrides: Record<string, unknown> = {}) {
  const afterAuthSuccess = vi.fn();
  const onAuthEvent = vi.fn();
  const app = express();
  app.use(express.json());
  const router = createRouter({
    db: mockDb,
    sessionManager: mockSessionManager as any,
    passkeyManager: mockPasskeyManager as any,
    mpcManager: mockMpcManager as any,
    rateLimiting: { auth: { limit: 1000, windowMs: 60000 } },
    rpId: 'localhost',
    hooks: { afterAuthSuccess, onAuthEvent },
    ...overrides,
  } as any);
  app.use(router);
  return { app, afterAuthSuccess, onAuthEvent };
}

describe('HOOK-02: afterAuthSuccess fires on /register/finish', () => {
  it('hook receives passkey-register ctx', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });

    await request(app)
      .post('/register/finish')
      .send({
        challengeId: 'chal-reg-1',
        response: validRegistrationResponse,
        tempUserId: 'temp-user-1',
        codename: 'ALPHA-BRAVO-7',
      })
      .expect(200);

    expect(afterAuthSuccess).toHaveBeenCalledTimes(1);
    expect(afterAuthSuccess.mock.calls[0][0]).toMatchObject({
      authMethod: 'passkey-register',
      userId: 'user-1',
      codename: 'ALPHA-BRAVO-7',
      nearAccountId: 'abc123def456',
    });
    expect(afterAuthSuccess.mock.calls[0][0].req).toBeDefined();
  });

  it('continue:true allows session creation and normal response', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({ continue: true });

    const res = await request(app)
      .post('/register/finish')
      .send({ challengeId: 'chal-reg-1', response: validRegistrationResponse, tempUserId: 'temp-user-1', codename: 'ALPHA-BRAVO-7' })
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('codename', 'ALPHA-BRAVO-7');
    expect(res.body.secondFactor).toBeUndefined();
    expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
  });

  it('continue:false short-circuits with status, body, and secondFactor echo; no session', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockResolvedValue({
      continue: false,
      status: 202,
      body: { needsSecondFactor: true, totpUri: 'otpauth://totp/...' },
    });

    const res = await request(app)
      .post('/register/finish')
      .send({ challengeId: 'chal-reg-1', response: validRegistrationResponse, tempUserId: 'temp-user-1', codename: 'ALPHA-BRAVO-7' })
      .expect(202);

    expect(res.body.needsSecondFactor).toBe(true);
    expect(res.body.totpUri).toBe('otpauth://totp/...');
    expect(res.body.secondFactor).toMatchObject({
      status: 202,
      body: { needsSecondFactor: true, totpUri: 'otpauth://totp/...' },
    });
    expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    // No Set-Cookie header for session
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeUndefined();
  });

  it('hook throw triggers DB transaction rollback (orphan-MPC trade-off)', async () => {
    const { app, afterAuthSuccess } = makeApp();
    afterAuthSuccess.mockRejectedValue(new Error('hook deliberately threw'));

    // Configure mockDb to expose transaction-aware createUser/createPasskey
    // (when db.transaction is implemented, the throw should trigger rollback —
    //  in this mock, we assert createUser was called inside the transaction
    //  callback, MPC was called BEFORE, and the response is 500)

    await request(app)
      .post('/register/finish')
      .send({ challengeId: 'chal-reg-1', response: validRegistrationResponse, tempUserId: 'temp-user-1', codename: 'ALPHA-BRAVO-7' })
      .expect(500);

    // MPC was called BEFORE the hook → orphan
    expect(mockMpcManager.createAccount).toHaveBeenCalledTimes(1);
    // No session created
    expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    // Documents the trade-off in CI: this test is a CHANGE DETECTOR for the
    // orphan-MPC contract. If MPC moves inside the transaction, this test
    // breaks — and the planner reviews HOOK-06 README copy.
  });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `afterPasskeyVerify(ctx)` (passkey-only) | `hooks.afterAuthSuccess(ctx)` (passkey + OAuth, discriminated by `authMethod`) | v0.7.0 spec — REQUIREMENTS line 10 | Phase 14 implements the renamed surface; no v0.6.x equivalent |
| Library-managed 2FA state column on `anon_users` | Pass-through hook only — consumer owns 2FA state | v0.7.0 — Out-of-Scope row "2FA enrolment state column on anon_users" | Library has no schema migration; consumer brings own factor + storage |
| Hook outside transaction (commit-then-hook) | Hook inside `doRegistration` (DB rollback on throw) | v0.7.0 — REQUIREMENTS line 9 | Trade-off: cleaner DB rollback, accepts orphan MPC; documented in HOOK-06 |
| Sync-only hook signature | `Promise<AfterAuthSuccessResult>` | v0.7.0 — async-by-default for network-bound 2FA verification | Allows TOTP push, push notifications, external 2FA service calls |

**Deprecated/outdated:**
- The earlier `afterPasskeyVerify` name (never shipped) is replaced by `hooks.afterAuthSuccess`. Phase 11 reserved the latter name from day one — there is no migration concern.

---

## Assumptions Log

> Claims tagged `[ASSUMED]` need user / planner confirmation before becoming locked decisions.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `body: Record<string, unknown>` is the right type for the hook's short-circuit body (vs. `object` literal). | Pattern 1 | Low — both types accept `res.json()` shapes; tightening to `Record<string, unknown>` is forwards-compatible. |
| A2 | The hook fires AFTER `register.finish.success` analytics event on short-circuit (Pitfall 4 — Option A). | Pitfall 4 | Medium — if planner picks Option B (separate `register.finish.blocked` event), Phase 13's `AnalyticsEvent` union must extend. Planner MUST confirm in Plan 01. |
| A3 | A small `runOAuthHook` helper local to `oauth/router.ts` is acceptable scope (vs. fully inlined OR a globally extracted helper module). | Pattern 7 | Low — helper is `<` 8 lines; planner can choose either. Recommendation is hybrid. |
| A4 | OAuth callback response shape extension (`secondFactor?` field) can stay inline in `oauth/router.ts` (vs. extracted to `OAuthCallbackResponse` interface in types/index.ts). | Pattern 5 | Low — extraction can be a Phase 16 follow-up. Keeping inline is minimum viable. |
| A5 | OAuth users have a `codename` field on the user row (`OAuthUser.codename`). | Pattern 4 + Open Question #2 | High — verified by reading `types/index.ts:410-422` — `OAuthUser` does NOT have `codename`. The hook ctx for OAuth requires `codename: string`; planner must decide: (a) add `codename` to `OAuthUser` row, (b) make `codename` optional in `AfterAuthSuccessCtx` for OAuth variants, or (c) pass empty string (current example). See Open Question #2. |
| A6 | The hook fires AFTER `db.linkOAuthProvider` in OAuth Branch 2 (link by email). | Pattern 4 | Low — matches the locked decision "after token exchange + user resolution". `linkOAuthProvider` is part of user resolution. |
| A7 | The hook fires AFTER `ipfsRecovery.createRecoveryBackup` + `db.storeRecoveryData` in OAuth new-user branch. | Pitfall 6 | Low — same locked decision. Trade-off: a hook short-circuit on this branch leaves user + IPFS blob committed; documented in Pitfall 6. |
| A8 | The library does NOT provide a "fire fire-and-forget mode" for `afterAuthSuccess` (unlike `onAuthEvent`'s `awaitAnalytics`). | Pattern 1 | Low — REQUIREMENTS HOOK-02..04 do not mention fire-and-forget. Hook is inline-blocking. |

---

## Open Questions

1. **Pitfall 4 — Analytics ordering on short-circuit (Option A vs. B vs. C).**
   - What we know: REQUIREMENTS does not specify whether `register.finish.success` fires when the hook short-circuits. Phase 13 emits success events AFTER the transaction commits but BEFORE `res.json`. Phase 14 inserts the hook fire INSIDE the transaction.
   - What's unclear: Should the success event still fire on `continue: false`?
   - Recommendation: **Option A — fire the success event regardless.** The auth itself succeeded. Lock this in Plan 01 and write a test that asserts `onAuthEvent` was called with `register.finish.success` even when `afterAuthSuccess` returned `continue: false`.

2. **OAuth users have no `codename` — what does `AfterAuthSuccessCtx` carry?**
   - What we know: `OAuthUser` interface in `types/index.ts:410-422` does NOT have a `codename` field. The current OAuth callback handler does not generate one (`createOAuthUser` in `oauth/router.ts:315-323` does not set codename). The discriminated-union hook ctx requires `codename: string` on every variant.
   - What's unclear: Three options:
     - **(a) Add `codename` to `OAuthUser`** — schema change, generate at user creation. Out of scope for Phase 14 (touches DB schema).
     - **(b) Make `codename` optional on OAuth variants** — `codename?: string` on the OAuth ctx variant. Type narrowing still works; consumer accepts that OAuth users may not have a codename.
     - **(c) Pass empty string** — `codename: ''`. Type-clean, semantically muddy.
   - Recommendation: **Option (b) — make `codename` optional on OAuth variants.** Aligns with the actual data model. Document in JSDoc that "OAuth users do not currently have codenames in v0.7.0; field reserved for future homogenization."
   - Planner MUST resolve in Plan 01 — this affects the `AfterAuthSuccessCtx` type definition.

3. **Should the hook ctx include a `nearAccountId` for OAuth users on Branch 1 (existing user)?**
   - What we know: `OAuthUser` in `types/index.ts:410-422` HAS `nearAccountId`. The lookup at `oauth/router.ts:239` returns `user.nearAccountId`. So yes — verified.
   - What's unclear: Nothing — verified by direct read.
   - Recommendation: Lock in.

4. **Should the OAuth callback response shape be extracted into types/index.ts now or later?**
   - What we know: The 3 inline response shapes in `oauth/router.ts:250-261, 286-298, 372-383` differ slightly (Branch 2 has `linkedProvider`, Branch 3 has `isNewUser: true`). Extraction would unify them into a discriminated union.
   - What's unclear: Adds scope to Phase 14.
   - Recommendation: **Defer to Phase 16 RELEASE-03** (which cares about exported types for autocomplete). Phase 14 ships `secondFactor?` inline in each branch.

5. **Should Phase 14 add an exported `AfterAuthSuccessCtx` and `AfterAuthSuccessResult` type to the `/server` barrel?**
   - What we know: Phase 11 re-exported `AnonAuthHooks` from `/server` (`src/server/index.ts:264`). Phase 13 re-exported `AnalyticsEvent` (line 277).
   - What's unclear: Should the new ctx and result types be re-exported?
   - Recommendation: **Yes** — consumer's hook signature requires these types for explicit annotation (`(ctx: AfterAuthSuccessCtx) => Promise<AfterAuthSuccessResult>`). Add to the type re-export block in `src/server/index.ts:262-276`.

6. **Should the hook fire BEFORE or AFTER the `register.finish.success` emit when `continue: true`?**
   - What we know: Existing flow fires the emit AFTER the transaction returns (line 260) and BEFORE `res.json` (line 267). With Phase 14, the hook fires INSIDE the transaction. So:
     - Hook (inside tx) → tx commits → emit → res.json
   - What's unclear: Nothing — natural ordering.
   - Recommendation: Lock in — the existing emit position remains correct; Phase 14 changes nothing about emit timing on the success path.

---

## Environment Availability

> Phase 14 is code-only — no new external dependencies are introduced. All commands run via the existing `nvm use 20 && npm ...` invocation (system Node is v12; v0.7.0 toolchain requires Node 20 — see USER memory `feedback_nvm.md`).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 20+ | All test/build commands (system Node is v12) | ✓ via nvm | 20.x [VERIFIED: USER memory feedback_nvm.md] | — |
| npm | Install, test, build | ✓ via Node 20 | bundled | — |
| TypeScript ^5.9.3 | Type-checks AfterAuthSuccessCtx narrowing | ✓ | 5.9.3 [VERIFIED: package.json:90] | — |
| Vitest ^4.0.18 | All Phase 14 test files | ✓ | 4.0.18 [VERIFIED: package.json:91] | — |
| Supertest ^7.2.2 | Integration tests for hook fire-point assertions | ✓ | 7.2.2 [VERIFIED: package.json:88] | — |
| `@simplewebauthn/server` ^13.2.3 | Existing passkey verify path (NOT touched by Phase 14) | ✓ | 13.2.3 | — |
| `db.transaction()` wrapper | Register-finish DB rollback on hook throw | ✓ | Existing since Phase 5 INFRA-02 (postgres.ts:185-300) | If absent: handler falls back to `await doRegistration(db)` — sequential calls, no atomicity. Throw STILL propagates to handler's outer try/catch → 500 response. Hook short-circuit (`continue: false`) is unaffected. **No new fallback work for Phase 14.** |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None — `db.transaction` fallback is documented and existing.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 [VERIFIED: package.json:91] |
| Config file | `vitest.config.ts` (root) — `globals: true, environment: 'node'` |
| Quick run command | `nvm use 20 && npm test -- --run src/__tests__/<file>.test.ts` |
| Full suite command | `nvm use 20 && npm test -- --run` |
| Type check | `nvm use 20 && npm run typecheck` |
| Estimated runtime | ~30s full suite (4 new test files add ~5s) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOOK-02 | `afterAuthSuccess` fires inside `/register/finish` AFTER MPC + DB persist, BEFORE session creation; ctx is `passkey-register` variant; `continue:true` allows session; `continue:false` short-circuits with no session. | integration (supertest + spy) | `nvm use 20 && npm test -- --run src/__tests__/second-factor-register.test.ts` | ❌ Wave 0 |
| HOOK-03 | Same fires inside `/login/finish`; ctx is `passkey-login` variant; same short-circuit semantics. | integration (supertest + spy) | `nvm use 20 && npm test -- --run src/__tests__/second-factor-login.test.ts` | ❌ Wave 0 |
| HOOK-04 | Same fires inside OAuth `/callback` × 3 branches (existing-user-same-provider, link-by-email, new-user); ctx is `oauth-google` / `oauth-github` / `oauth-twitter` variant with `provider`. | integration (supertest + spy on OAuth router) | `nvm use 20 && npm test -- --run src/__tests__/second-factor-oauth.test.ts` | ❌ Wave 0 |
| HOOK-05 | `continue:false` response includes `secondFactor: { status, body }` echo; `continue:true` omits the field. Same body fields are spread into the response top-level. | integration (response body assertion) | (covered in second-factor-register.test.ts + second-factor-login.test.ts + second-factor-oauth.test.ts) | ❌ Wave 0 |
| HOOK-06 | A throwing hook on `/register/finish` triggers DB rollback (no `createUser` row persists when transaction is wired); MPC `createAccount` was called BEFORE the throw (orphan); response is 500. | integration (supertest + spy on db.transaction wrapper + mockMpcManager) | `nvm use 20 && npm test -- --run src/__tests__/second-factor-orphan.test.ts` | ❌ Wave 0 |
| HOOK-02..04 (no PII leak) | Hook ctx receives `userId`, `codename`, `nearAccountId` — these are intended for the consumer; library does NOT log or telemetrize them. | integration (response body + analytics spy) | (covered as a sub-assertion in each of the 3 fire-point tests) | ❌ Wave 0 |
| Type contract | `AfterAuthSuccessCtx` discriminates over `authMethod`; `provider` only on OAuth variants; `AfterAuthSuccessResult` is the discriminated `continue: true \| false` shape. | unit (compile-time / `expectTypeOf`) | (one-block addition to `second-factor-register.test.ts`) | ❌ Wave 0 |
| Backwards compat | Consumer passing `hooks: {}` or omitting `hooks` sees behavior byte-identical to v0.7.0-pre-Phase-14 (i.e., Phase 13 behavior). | integration (full register/login/oauth flow with no hook) | (covered in existing `registration-auth.test.ts` + new fixture run) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `nvm use 20 && npm test -- --run src/__tests__/second-factor-<file you touched>.test.ts && npm run typecheck`
- **Per wave merge:** `nvm use 20 && npm test -- --run` (full suite)
- **Phase gate:** Full suite green + typecheck green + 4 new test files all passing before `/gsd-verify-work 14`

### Wave 0 Gaps
- [ ] `src/__tests__/second-factor-register.test.ts` — covers HOOK-02 + HOOK-05 (passkey register fire + short-circuit)
- [ ] `src/__tests__/second-factor-login.test.ts` — covers HOOK-03 + HOOK-05 (passkey login fire + short-circuit)
- [ ] `src/__tests__/second-factor-oauth.test.ts` — covers HOOK-04 + HOOK-05 (OAuth × 3 branches fire + short-circuit)
- [ ] `src/__tests__/second-factor-orphan.test.ts` — covers HOOK-06 (DB rollback on throw + orphan-MPC contract test)

No framework install needed — vitest, supertest, pino are already in `package.json`.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | The hook is a SECOND-FACTOR enforcement surface. Library does NOT prescribe the factor (TOTP, push, hardware token) — consumer's hook owns it. Library guarantees the hook fires BEFORE session creation, so a `continue: false` blocks session issuance. |
| V3 Session Management | yes | `sessionManager.createSession` is gated by `continue: true`. On `continue: false`, no session row is created and no Set-Cookie header is emitted. Test asserts `res.headers['set-cookie']` is undefined on short-circuit. |
| V4 Access Control | n/a | Phase 14 surfaces an extension point; access control decisions are consumer's responsibility. |
| V5 Input Validation | n/a — already enforced at `validateBody` upstream | Hook receives validated body; no new input handling. |
| V6 Cryptography | n/a | No crypto changes — passkey verify path unchanged; MPC `createAccount` unchanged. |

### Known Threat Patterns for {Express + WebAuthn + OAuth + MPC}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hook bypass via async race (handler issues session before hook resolves) | Spoofing / Elevation of Privilege | `await` the hook explicitly at every fire site; ESLint `no-floating-promises` if available; tests assert `mockSessionManager.createSession` was NOT called when hook short-circuits |
| Cookie-Set leak on short-circuit (session created before hook resolves) | Information Disclosure / Session Fixation | Hook fires BEFORE `sessionManager.createSession`; test asserts `res.headers['set-cookie']` undefined on `continue: false` |
| Orphan MPC account on hook throw (HOOK-06 trade-off) | Repudiation / financial loss to consumer | README documents the orphan condition; recommend idempotent + non-throwing hooks; test is a CHANGE DETECTOR for MPC ordering |
| Hook receives unsanitized `req` and accidentally logs PII | Information Disclosure | JSDoc on `AfterAuthSuccessCtx.req` notes "consumer's responsibility to sanitize"; library does NOT log `req` |
| Type narrowing breakage allows consumer to read `provider` on register/login variants | Spoofing | Discriminated union with `provider` ONLY on OAuth variants; type-level test (`expectTypeOf`) asserts the narrowing |
| Hook errors silently dropped (consumer hangs on a Promise that never resolves) | Denial of Service (consumer-induced) | No timeout in v0.7.0 — out-of-scope; consumer's hook MUST resolve in finite time. README documents this. |
| Replay of a `continue: false` body (consumer accepts a previously-issued short-circuit body) | Replay | Consumer's responsibility — library has no idempotency key on the hook; recommend consumer's hook generate an enrolment-ceremony nonce |

---

## Project Constraints (from CLAUDE.md)

> No `./CLAUDE.md` exists in the working directory (verified — `Read` returned ENOENT).

The constraints below come from STATE.md "Decisions" + REQUIREMENTS.md "Locked decisions" + USER memory:

- **System Node is v12; ALL test/build commands MUST use `nvm use 20 && ...`** [USER memory: `feedback_nvm.md`]
- Anonymity invariant non-negotiable; library does NOT log/telemetrize `userId`, `codename`, `nearAccountId`, `email`, raw `ip`, raw `userAgent`. Hook ctx surfaces these to consumer (intended).
- `MPCAccountManager` contract FROZEN by consumer pin — no field/method/return-shape renames.
- Zero new dependencies in v0.7.0.
- Optional `DatabaseAdapter` methods are added with internal fallbacks (Init decision, STATE.md line 91). Phase 14 adds NO new DB adapter methods — pure call-site wiring.
- `tsup` ESM/CJS rebuild required after types/exports change (`npm run build`).

---

## Sources

### Primary (HIGH confidence)
- `/home/vitalpointai/projects/near-phantom-auth/src/server/router.ts` — passkey router; verified all fire-point line numbers (201-281 register, 328-385 login)
- `/home/vitalpointai/projects/near-phantom-auth/src/server/oauth/router.ts` — OAuth router; verified all 3 callback branches (lines 241-262, 264-300, 302-383)
- `/home/vitalpointai/projects/near-phantom-auth/src/server/mpc.ts:437-525` — `createAccount` source; verified MPC funding precedes DB transaction
- `/home/vitalpointai/projects/near-phantom-auth/src/server/analytics.ts` — `wrapAnalytics` envelope, `AnalyticsEvent` discriminated union; verified Phase 13 hook patterns
- `/home/vitalpointai/projects/near-phantom-auth/src/types/index.ts` — `AnonAuthHooks` (lines 53-64), `AnonAuthConfig` (lines 98-208), `RegistrationFinishResponse` / `AuthenticationFinishResponse` (lines 523-543); verified Phase 11 scaffolding present
- `/home/vitalpointai/projects/near-phantom-auth/src/server/index.ts:91-255` — `createAnonAuth` factory; verified `hooks: config.hooks` already threaded into both router factories
- `/home/vitalpointai/projects/near-phantom-auth/src/server/session.ts:120-148` — `createSession` cookie-set behavior; verified Set-Cookie ordering
- `/home/vitalpointai/projects/near-phantom-auth/src/server/passkey.ts:263-348` — `finishAuthentication` return shape; verified `passkeyData` carries fresh BE/BS values
- `/home/vitalpointai/projects/near-phantom-auth/src/__tests__/registration-auth.test.ts:14-211` — canonical mock-router harness
- `/home/vitalpointai/projects/near-phantom-auth/src/__tests__/analytics-lifecycle.test.ts:184-207` — Phase 13 spy-and-assert pattern; canonical for Phase 14 reuse
- `/home/vitalpointai/projects/near-phantom-auth/src/__tests__/analytics-oauth.test.ts:108-150` — OAuth × 3 branches harness
- `/home/vitalpointai/projects/near-phantom-auth/src/__tests__/hooks-scaffolding.test.ts:71-130` — Phase 11 `hooks: {}` compile + behavior contract
- `/home/vitalpointai/projects/near-phantom-auth/.planning/REQUIREMENTS.md:25-32` — HOOK-02..06 verbatim
- `/home/vitalpointai/projects/near-phantom-auth/.planning/STATE.md:79-82` — locked decisions
- `/home/vitalpointai/projects/near-phantom-auth/.planning/ROADMAP.md:123-134` — Phase 14 success criteria
- `/home/vitalpointai/projects/near-phantom-auth/.planning/phases/11-backup-eligibility-flags-hooks-scaffolding/11-RESEARCH.md` — Pattern 6 (AnonAuthHooks scaffolding)
- `/home/vitalpointai/projects/near-phantom-auth/.planning/phases/13-registration-analytics-hook/13-RESEARCH.md` — Phase 13 emit point inventory; canonical pattern reference
- `/home/vitalpointai/projects/near-phantom-auth/package.json:79-91` — version verification of all v0.7.0 deps

### Secondary (MEDIUM confidence)
- USER memory `feedback_nvm.md` — system Node v12, must use nvm v20 for all commands

### Tertiary (LOW confidence)
- None. Phase 14 is fully grounded in direct codebase inspection; no web/Context7 lookups were required.

---

## Metadata

**Confidence breakdown:**
- Architecture / fire-point ordering: **HIGH** — every file:line verified
- Type contract (AfterAuthSuccessCtx + AfterAuthSuccessResult): **HIGH** — derived from REQUIREMENTS line 28 verbatim; one open question on OAuth `codename` (Open Question #2)
- Short-circuit response shape: **HIGH** — REQUIREMENTS HOOK-05 verbatim
- MPC orphan trade-off: **HIGH** — verified by reading `mpc.ts:437` (createAccount called before transaction)
- Test patterns: **HIGH** — direct re-use of `analytics-lifecycle.test.ts` harness
- Analytics ordering on short-circuit (Pitfall 4): **MEDIUM** — recommendation is Option A; planner MUST confirm

**Research date:** 2026-04-30
**Valid until:** 2026-05-30 (30 days; v0.7.0 surface is stable; Phase 13 just shipped, Phase 14 is the next adjacent wiring)

---

## Pre-Submission Checklist

- [x] All domains investigated (stack, patterns, pitfalls, security, validation)
- [x] No negative claims without evidence — every "X does not happen" is verified by direct codebase read
- [x] Multiple sources for critical claims — REQUIREMENTS + ROADMAP + STATE + source code cross-checked
- [x] File:line numbers provided for all fire points (verified)
- [x] Confidence levels assigned honestly
- [x] "What might I have missed?" review:
  - Cookie-Set leak (Pitfall 2)
  - Async hook in sync transaction (Pitfall 3)
  - Analytics ordering ambiguity (Pitfall 4 — Open Question #1)
  - OAuth `codename` field gap (Open Question #2)
  - OAuth new-user IPFS recovery commitment (Pitfall 6)
- [x] Phase 14 is rename/refactor? **No** — additive call-site wiring; Runtime State Inventory section confirms no string is renamed
- [x] Security domain included with ASVS categories applied to phase tech stack
- [x] Validation Architecture section included for Nyquist enforcement
- [x] Project Constraints section included (CLAUDE.md absent; nvm-v20 constraint surfaced from USER memory)
