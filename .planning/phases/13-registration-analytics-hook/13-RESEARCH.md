# Phase 13: Registration Analytics Hook - Research

**Researched:** 2026-04-29
**Domain:** Discriminated-union event types, type-level PII whitelist (tsc-fail fixture), fire-and-forget hook envelope, lifecycle-boundary instrumentation across passkey/OAuth/recovery/account-delete handlers
**Confidence:** HIGH — every load-bearing fact verified by direct codebase inspection (handler source, MPC-07 tsc-fail fixture, tsup externalization config, type files).

---

## Summary

Phase 13 lands the **third and last** call-site wiring for `AnonAuthConfig.hooks` (Phase 11 reserved the type, Phase 12 was orthogonal). Phase 11 already plumbed `hooks?: AnonAuthHooks` into both `RouterConfig` and `OAuthRouterConfig`, and `createAnonAuth` threads `config.hooks` into both factory call sites — there is **zero plumbing work** in Phase 13. The work is: (1) create a brand-new module `src/server/analytics.ts` with the `AnalyticsEvent` discriminated union and a `wrapAnalytics(hook, opts)` envelope, (2) install ~13 emit points across the existing handlers, (3) ship the tsc-fail fixture mirroring v0.6.1 MPC-07, (4) ship the snapshot-based PII whitelist test, (5) document `awaitAnalytics: boolean` at the top level of `AnonAuthConfig`. No new dependencies — `pino@^10.3.1` is already a runtime dep, externalized in `tsup.config.ts`, and exposed via `config.logger` on every existing manager.

The strongest defense is **type-level**, not runtime: the discriminated union `AnalyticsEvent = RegisterStart | RegisterFinishSuccess | RegisterFinishFailure | LoginStart | LoginFinishSuccess | LoginFinishFailure | RecoveryWalletLink | RecoveryWalletRecover | RecoveryIpfsSetup | RecoveryIpfsRecover | OauthCallbackSuccess | AccountDelete` exhaustively enumerates allowed keys per variant. The MPC-07 pattern in `src/__tests__/mpc-treasury-leak.test.ts` (lines 197-242) shells out to `npx tsc --noEmit <fixture>` and asserts both `tscFailed === true` AND `tscOutput` matches a regex on the offending field name — this is the exact fixture mechanic Phase 13 must mirror for `analytics-pii-leak.test.ts`. The snapshot-based PII assertion (ANALYTICS-05) is defense-in-depth: each variant is constructed at runtime in the test and `Object.keys(variant)` is compared to a hard-coded allowlist (`type`, `rpId`, `timestamp`, `provider`, `backupEligible`, `reason`, `codenameProvided`).

For fire-and-forget mode (default), the hook is invoked **without `await`** inside an inner `try/catch` and any thrown error or returned rejected Promise is caught by `.catch(...)` attached to the returned Promise. This is materially different from `setImmediate` or `queueMicrotask` — the hook starts executing immediately on the same tick, and only the **wait for it** is skipped. A 5-second hook does not block the response because the response is emitted on the next line of the handler regardless of hook completion. For `awaitAnalytics: true`, the same envelope `await`s the hook (and still swallows errors with WARN log).

**Primary recommendation:** Land the `analytics.ts` module first (types + `wrapAnalytics` + tsc-fail fixture + snapshot test). Then wire emit points handler-by-handler in a second wave (passkey router → OAuth router → recovery → account-delete). Use **inline emit calls** (`hooks?.onAuthEvent && wrapAnalytics(hooks.onAuthEvent, { await: !!awaitAnalytics })({ type: 'register.start', rpId, timestamp: Date.now() })`) rather than introducing an intermediate `EventEmitter` or per-router emitter helper — the latter adds an indirection layer with no upside and is explicitly listed in REQUIREMENTS Out-of-Scope as the wrong semantics.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Define `AnalyticsEvent` discriminated union with type-level PII whitelist | API / Backend | — | Pure type-only; lives in `src/server/analytics.ts` and is re-exported from `/server` for consumer IDE autocomplete |
| Construct event objects at lifecycle boundaries | API / Backend | — | Constructed in `router.ts`, `oauth/router.ts` after the precise success/failure decision is made; the handler is the only context that knows `type` and `reason` |
| Invoke consumer's `onAuthEvent` callback safely | API / Backend | — | `wrapAnalytics(hook, opts)` envelope; emits inline (fire-and-forget) or `await`s (sync mode); errors swallowed with WARN log |
| Persist analytics elsewhere | Consumer infrastructure | — | Library does NOT store events — the hook is the boundary; consumer's pipeline (Datadog, Segment, Snowflake, etc.) owns persistence |
| Verify PII cannot leak via event SHAPE | CI (tsc + vitest) | — | tsc-fail fixture (`__tsc_fail/analytics-pii-leak.test.ts` shelling out to `npx tsc --noEmit`) + snapshot whitelist test |
| Source `rpId` for emission | API / Backend | — | `config.rp.id` is captured at `createAnonAuth()` startup; same value emitted on every event for that instance — see Open Question #1 below |
| Source `timestamp` for emission | API / Backend | — | `Date.now()` at the emit call site; never re-derived from `req` |

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ANALYTICS-01 | `hooks.onAuthEvent(event)` fires at every lifecycle boundary across passkey router, OAuth router, recovery endpoints, and account-deletion endpoint. 13 distinct event types (see Section "Lifecycle Boundary Inventory" below). | Every emit point identified by direct file:line inspection of `src/server/router.ts` (passkey + recovery + account-delete) and `src/server/oauth/router.ts`. No new endpoints needed. |
| ANALYTICS-02 | `AnalyticsEvent` is a discriminated union; type forbids `userId`, `codename`, `nearAccountId`, `email`, raw `ip`, raw `userAgent`. Allowed: `type`, `rpId`, `timestamp`, `provider`, `backupEligible`, `reason`, `codenameProvided`. | Pattern 1 below. New file `src/server/analytics.ts`. Existing pattern reference: `RelatedOrigin` (12-RPID-01) in `src/types/index.ts` lines 80-87. |
| ANALYTICS-03 | Type-level enforcement via `__tsc_fail/analytics-pii-leak.test.ts` — child-process tsc invocation that asserts adding `codename` or `nearAccountId` to event union causes `tsc --noEmit` to fail. | Mirror MPC-07 fixture at `src/__tsc_fail/mpc-treasury-leak.test.ts` lines 197-242 (the test code lives there, not in a separate `__tsc_fail/` directory — ROADMAP and REQUIREMENTS use `__tsc_fail/` as a logical name; the actual location is `src/__tests__/`). See Open Question #5 below for directory placement. |
| ANALYTICS-04 | `wrapAnalytics(hook, opts)` in `src/server/analytics.ts`. Fire-and-forget by default (does not block response); errors swallowed with WARN-level pino log carrying redacted error message. `opts.await: true` (driven by `AnonAuthConfig.awaitAnalytics`) switches to awaited emit. | Pattern 2 below. Pino is already a runtime dep (`package.json` line 79: `"pino": "^10.3.1"`) and externalized (`tsup.config.ts` line 16). The library's existing pattern: every manager (mpc, session, passkey, recovery/wallet, recovery/ipfs) accepts `config.logger?: Logger` and falls back to `pino({ level: 'silent' })`. Mirror that. |
| ANALYTICS-05 | Snapshot-based PII assertion: every event variant's keys are a subset of the allowed-fields whitelist. Test fails if a future change adds a non-whitelisted key. | Pattern 4 below. Implementation: construct one instance of each variant in the test, `Object.keys(variant).every(k => ALLOWED.has(k))`, assert true. |
| ANALYTICS-06 | Failure events (`*.finish.failure`) emitted by default. README documents that consumers may filter by `event.type` for success-only mode. | Phase 13 emits the events; README copy is owned by Phase 16 (RELEASE-01) but Phase 13 should ship the implementation that supports it. No code change needed beyond emitting `register.finish.failure` and `login.finish.failure` events — handler error paths are already in place. |
</phase_requirements>

---

## User Constraints (from CONTEXT.md)

> No `*-CONTEXT.md` exists for Phase 13 (no `/gsd-discuss-phase` was run — confirmed by `ls .planning/phases/13-registration-analytics-hook/` returning empty). Constraints below are derived verbatim from STATE.md "Decisions" + REQUIREMENTS.md "Locked decisions" and "Out of Scope" — they bind this phase identically.

### Locked Decisions (from milestone scope)

- **`awaitAnalytics: boolean`** opt-in flag at the **top level** of `AnonAuthConfig` (NOT inside `hooks`). Default `false` (fire-and-forget). [STATE.md line 76; REQUIREMENTS line 11]
- **R2 highest-priority defense:** type-level PII whitelist via tsc-fail fixture (ANALYTICS-03). Mirrors v0.6.1 MPC-07 pattern. [STATE.md line 78; STATE.md line 128]
- **Phase 13 promoted earlier than Architecture researcher's suggested order** so the type-level PII whitelist is in place BEFORE F2/F3 land. [STATE.md line 78] Implication: emit-point inventory must include `oauth.callback.success` and the recovery events even though the F2 hook lands later — this phase is the source of truth for what events exist.
- **Anonymity invariant non-negotiable.** Events MUST NOT carry `userId`, `codename`, `nearAccountId`, `email`, raw `ip`, raw `userAgent`. [STATE.md line 77; REQUIREMENTS line 52]
- **Failure event `reason` is a static enum literal**, NEVER `Error.message`. [REQUIREMENTS line 52]
- **Zero new dependencies.** [STATE.md line 77]

### Claude's Discretion

- **Directory placement of the tsc-fail fixture** — REQUIREMENTS line 53 says `__tsc_fail/analytics-pii-leak.test.ts`, but the existing MPC-07 test (`src/__tests__/mpc-treasury-leak.test.ts`) does NOT live in a `__tsc_fail/` directory. It writes the fixture file inline (`writeFileSync`) and shells out to tsc. Recommendation: create the test as `src/__tests__/analytics-pii-leak.test.ts` to mirror MPC-07's actual location, OR create a new `src/__tsc_fail/` directory if the planner wants the literal path from REQUIREMENTS. Either is defensible; the REQUIREMENTS text uses `__tsc_fail/` as a *category name*, not a filesystem path (the literal path that exists today is `src/__tests__/`). See Open Question #5.
- **Whether to emit `oauth.callback.success` from all THREE OAuth code paths** (existing-user same-provider, existing-user link-by-email, new-user create) or only the new-user path. Recommendation: emit on ALL THREE because each one creates a session and matches "callback succeeded"; treating new-user-only as "the success" hides login telemetry. The event payload is identical in all three (no `isNewUser` flag — that would leak shape, not PII, but is unnecessary).
- **Whether to capture the timestamp at the START of the handler or at the EMIT call site** — recommendation: at the emit call site (`Date.now()`). Capturing at handler start would invite a `latencyMs` field on success events (deferred per ANALYTICS-V2-02) and adds a request-scoped variable to thread through.
- **Whether `register.start` and `login.start` events are emitted before or after rate-limit / validation gate** — recommendation: AFTER successful body validation (`if (!body) return;`) but BEFORE business logic. Emitting before rate-limiter would let an attacker probe the analytics pipeline with junk requests. Emitting after passkey ceremony defeats the "start" semantic.
- **Whether `wrapAnalytics` calls `child({ module: 'analytics' })` on the logger** — recommendation: yes, mirroring every other manager's pattern (`mpc.ts:404`, `router.ts:56`, etc.).

### Deferred Ideas (OUT OF SCOPE for Phase 13)

- **`event.userAgentFamily`** derived field — REQUIREMENTS ANALYTICS-V2-01; needs a UA-parser dep; explicitly deferred.
- **`event.latencyMs`** server-side latency observation — ANALYTICS-V2-02; deferred.
- **`event.capabilities`** PRF/multi-device/synced-passkey bits — ANALYTICS-V2-03; deferred.
- **EventEmitter-style multi-subscriber API** on `onAuthEvent` — REQUIREMENTS HOOK-V2-02 + Out-of-Scope row "EventEmitter for analytics — Wrong semantics — leaks listener errors silently, no Promise contract". Single callback only.
- **Open-ended `metadata: Record<string, unknown>`** on events — Out-of-Scope row "PII leak temptation; bounded enum only".
- **`req`, `res`, or `AnonUser` passed to event payload** — Out-of-Scope row "PII leak surface; only sanitized fields".
- **Emitting events on OAuth router PII** — Out-of-Scope row "OAuth has email/profile data; analytics events emit `provider` only, never user-identifying fields".
- **Phase 14 hook firing inside the analytics envelope** — Phase 14 lands `hooks.afterAuthSuccess` separately; Phase 13 ONLY wires `onAuthEvent`.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 (devDep; latest is 4.1.5 — upgrade is OUT OF SCOPE for Phase 13) |
| Config file | `vitest.config.ts` (root) — `globals: true, environment: 'node'` |
| Quick run command | `nvm use 20 && npm test -- --run src/__tests__/<file>.test.ts` |
| Full suite command | `nvm use 20 && npm test -- --run` |
| Type check | `nvm use 20 && npm run typecheck` (= `tsc --noEmit`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ANALYTICS-01 | All 13 lifecycle events emitted at correct boundaries with bounded payloads | integration (supertest) | `nvm use 20 && npm test -- --run src/__tests__/analytics-lifecycle.test.ts` | ❌ Wave 0 |
| ANALYTICS-01 (recovery) | 4 recovery events fire at the correct points (after on-chain/IPFS persistence) | integration (supertest) | (same file as above; separate `describe` block) | ❌ Wave 0 |
| ANALYTICS-01 (oauth) | `oauth.callback.success` fires from all 3 OAuth code paths (existing, link-by-email, new) | integration (supertest) | `nvm use 20 && npm test -- --run src/__tests__/analytics-oauth.test.ts` | ❌ Wave 0 |
| ANALYTICS-02 | Discriminated-union type forbids PII keys (verified at compile time when consumer uses `event.type === 'register.start'` narrowing) | unit (vitest with type-level assertions) | `nvm use 20 && npm test -- --run src/__tests__/analytics-types.test.ts` | ❌ Wave 0 |
| ANALYTICS-03 | A fixture file declaring an event variant with `codename` (or `userId`, `nearAccountId`, `email`, `ip`, `userAgent`) fails `tsc --noEmit` | type-level fail (child-process tsc) | `nvm use 20 && npm test -- --run src/__tests__/analytics-pii-leak.test.ts` | ❌ Wave 0 |
| ANALYTICS-04 (latency) | A 5-second `onAuthEvent` hook adds < 100ms to login latency in fire-and-forget mode | latency assertion (supertest + perf timing) | `nvm use 20 && npm test -- --run src/__tests__/analytics-latency.test.ts` | ❌ Wave 0 |
| ANALYTICS-04 (error swallow) | A throwing `onAuthEvent` hook still produces a 200 OK response; pino WARN is emitted with `[Redacted]` for any field containing PII | integration (supertest + captured pino stream) | (same file as analytics-latency.test.ts; separate `describe`) | ❌ Wave 0 |
| ANALYTICS-04 (await mode) | Setting `awaitAnalytics: true` makes the same 5-second hook ADD ~5s to login latency (proves the await path is wired) | latency assertion | (same file) | ❌ Wave 0 |
| ANALYTICS-05 | Each event variant's `Object.keys(variant)` is a subset of the allowed-fields whitelist; future addition of a non-whitelisted key fails the test | snapshot/whitelist | `nvm use 20 && npm test -- --run src/__tests__/analytics-pii-snapshot.test.ts` | ❌ Wave 0 |
| ANALYTICS-06 | Default-emit failure events fire on `register.finish.failure` and `login.finish.failure` paths | integration (supertest, mocked passkey verification rejection) | (covered in `analytics-lifecycle.test.ts`) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `nvm use 20 && npm test -- --run src/__tests__/<the file you touched>.test.ts && npm run typecheck`
- **Per wave merge:** `nvm use 20 && npm test -- --run` (full suite)
- **Phase gate:** Full suite green + typecheck green before `/gsd-verify-work`. The tsc-fail fixture (`analytics-pii-leak.test.ts`) is itself part of the suite — it shells out to `npx tsc --noEmit <fixture>` so it's automated.

### Wave 0 Gaps
- [ ] `src/__tests__/analytics-types.test.ts` — covers ANALYTICS-02 (type narrowing + variant keys). Pure type assertions via `expectTypeOf` from vitest 4.x.
- [ ] `src/__tests__/analytics-pii-leak.test.ts` — covers ANALYTICS-03 (tsc-fail fixture, mirrors MPC-07).
- [ ] `src/__tests__/analytics-pii-snapshot.test.ts` — covers ANALYTICS-05 (allowlist whitelist).
- [ ] `src/__tests__/analytics-lifecycle.test.ts` — covers ANALYTICS-01 (passkey + recovery + account-delete) + ANALYTICS-06 (failure events).
- [ ] `src/__tests__/analytics-oauth.test.ts` — covers ANALYTICS-01 (oauth callback). Separate file because OAuth router has its own mock harness.
- [ ] `src/__tests__/analytics-latency.test.ts` — covers ANALYTICS-04 (latency + error-swallow + await mode).

No framework install needed — vitest, supertest, pino are already in `package.json`.

---

## Lifecycle Boundary Inventory (file:line for every emit point)

This is the canonical map. Each row is one emit point; the planner builds tasks from this directly.

### Passkey Router (`src/server/router.ts`)

| Event Type | Emit Point | File:Line | Payload (allowed fields) |
|-----------|------------|-----------|--------------------------|
| `register.start` | After `validateBody` succeeds, before codename generation | `src/server/router.ts:135` (after line 134's `if (!body) return;`) | `type, rpId, timestamp` |
| `register.finish.success` | After successful response (`res.json(...)` on line 238) | `src/server/router.ts:246` (just before the closing `}` of res.json) | `type, rpId, timestamp, backupEligible` |
| `register.finish.failure` | Inside `if (!verified || !passkeyData)` (line 198), inside `if (!isValidCodename(codename))` (line 188), inside `catch` (line 247) | `src/server/router.ts:189, 199, 248` | `type, rpId, timestamp, reason` (`'invalid-codename' \| 'passkey-verification-failed' \| 'internal-error'`) |
| `login.start` | After `validateBody` succeeds (line 264), before codename lookup | `src/server/router.ts:265` | `type, rpId, timestamp, codenameProvided: boolean` (whether a `codename` was supplied — does NOT include the codename itself) |
| `login.finish.success` | Just before `res.json(...)` on line 322 | `src/server/router.ts:321` | `type, rpId, timestamp, backupEligible` (when `passkeyData` present) |
| `login.finish.failure` | Inside `if (!verified || !userId)` (line 303), inside `if (!user)` (line 309), inside `catch` (line 332) | `src/server/router.ts:304, 310, 333` | `type, rpId, timestamp, reason` (`'auth-failed' \| 'user-not-found' \| 'internal-error'`) |
| `recovery.wallet.link.success` | After `db.storeRecoveryData(...)` on line 465-470 in `/recovery/wallet/verify` (NOT `/recovery/wallet/link` — that's just challenge generation) | `src/server/router.ts:472` (inside the res.json call) | `type, rpId, timestamp` |
| `recovery.wallet.recover.success` | After `sessionManager.createSession` succeeds in `/recovery/wallet/finish` | `src/server/router.ts:537` | `type, rpId, timestamp` |
| `recovery.ipfs.setup.success` | After `db.storeRecoveryData(...)` on line 598-603 in `/recovery/ipfs/setup` | `src/server/router.ts:605` | `type, rpId, timestamp` |
| `recovery.ipfs.recover.success` | After `sessionManager.createSession` succeeds in `/recovery/ipfs/recover` | `src/server/router.ts:648` | `type, rpId, timestamp` |
| `account.delete` | After `db.deleteUser(userId)` succeeds in `DELETE /account` | `src/server/router.ts:725` (just before `res.json({ success: true })`) | `type, rpId, timestamp` |

### OAuth Router (`src/server/oauth/router.ts`)

| Event Type | Emit Point | File:Line | Payload (allowed fields) |
|-----------|------------|-----------|--------------------------|
| `oauth.callback.success` (existing user, same provider) | After `sessionManager.createSession` (line 228), before the `return res.json(...)` (line 233) | `src/server/oauth/router.ts:232` | `type, rpId, timestamp, provider` |
| `oauth.callback.success` (existing user, link by email) | After `sessionManager.createSession` (line 262), before the `return res.json(...)` (line 267) | `src/server/oauth/router.ts:266` | `type, rpId, timestamp, provider` |
| `oauth.callback.success` (new user) | After `sessionManager.createSession(newUser.id, ...)` (line 346), before the final `return res.json(...)` (line 351) | `src/server/oauth/router.ts:350` | `type, rpId, timestamp, provider` |

**Failure events for OAuth callback:** REQUIREMENTS line 51 lists `oauth.callback.success` only (no failure variant). Recommendation: do NOT add `oauth.callback.failure` — it's not in the requirement set. The OAuth flow's failure paths (invalid state, exchange error) are already covered by 500/400 responses; if a consumer wants to count them they can fall back to HTTP-status telemetry or wait for an ANALYTICS-V2 enhancement.

### Total: 13 distinct event variants (counting all four `oauth.callback.success` emit sites as ONE variant). All 13 are visible in the discriminated union. Three of those 13 are emitted from MULTIPLE call sites (register.finish.failure × 3, login.finish.failure × 3, oauth.callback.success × 3) — same payload shape, different physical line.

---

## Standard Stack

### Core (already installed; verified)
| Library | Version (verified `npm view`) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pino | 10.3.1 [VERIFIED: npm view pino version, 2026-04-29] | WARN-level redacted error log inside `wrapAnalytics` | Already a runtime dep (`package.json:79`); externalized in `tsup.config.ts:16`; same logger pattern used by every other manager (`mpc.ts:404-414`, `session.ts`, `passkey.ts:22`) |
| vitest | 4.0.18 (devDep; latest 4.1.5 [VERIFIED]) | All Phase 13 tests | Already pinned (`package.json:91`); Phase 12 tests use it; upgrade out of scope |
| supertest | 7.2.2 (devDep) | Integration tests for emit-point coverage | `package.json:88`; existing integration pattern in `registration-auth.test.ts`, `recovery.test.ts` |
| typescript | 5.9.3 (devDep) | tsc-fail fixture invoked via `npx tsc --noEmit` | `package.json:90`; same version MPC-07 uses |

**No new dependencies.** Verified by reading `package.json` end-to-end. The full stack for Phase 13 is already installed.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline `try { hook(event); } catch {...}` envelope | EventEmitter | Listed in REQUIREMENTS Out-of-Scope — wrong semantics (silent listener errors, no Promise contract) |
| `Date.now()` for `timestamp` | `performance.now()` | `Date.now()` returns wall-clock ms-since-epoch; `performance.now()` returns ms-since-process-start. Consumers want wall-clock for ingestion pipelines (Datadog, Snowflake) — use `Date.now()` |
| Single allowlist `Set<string>` constant in `analytics.ts` | Per-variant inline constants | Single allowlist makes the snapshot test trivial and gives ANALYTICS-05 a single source of truth |

### Already-Installed Tooling
The library uses a tree of `Logger` (pino) instances created via `.child({ module: '...' })` from a root logger that's either (a) the consumer's `config.logger`, or (b) `pino({ level: 'silent' })`. `wrapAnalytics` MUST follow this pattern: accept a `Logger` parameter, call `.child({ module: 'analytics' })`, and emit `log.warn({ err: redacted }, 'analytics hook threw')` on hook failure.

---

## Architecture Patterns

### System Architecture Diagram

```
                 ┌──────────────────────────────────────────┐
                 │            createAnonAuth(config)         │
                 │  config.hooks?.onAuthEvent (Phase 11)     │
                 │  config.awaitAnalytics? (Phase 13 NEW)    │
                 └─────────────────┬────────────────────────┘
                                   │
                  ┌────────────────┼─────────────────┐
                  │                │                 │
                  ▼                ▼                 ▼
        ┌─────────────────┐ ┌──────────────┐ ┌────────────────┐
        │ createRouter    │ │ createOAuth  │ │ analytics.ts   │
        │ (passkey +      │ │   Router     │ │ (NEW MODULE)   │
        │  recovery +     │ │              │ │                │
        │  account-del)   │ │              │ │ AnalyticsEvent │
        │                 │ │              │ │   (union)      │
        │                 │ │              │ │                │
        │                 │ │              │ │ wrapAnalytics( │
        │                 │ │              │ │   hook, opts)  │
        └────────┬────────┘ └──────┬───────┘ └────────┬───────┘
                 │                 │                  │
   handler enters lifecycle boundary                  │
                 │                 │                  │
                 ▼                 ▼                  │
       ┌─────────────────────────────────────┐        │
       │   construct AnalyticsEvent literal  │        │
       │   { type, rpId, timestamp, ... }    │        │
       └─────────────────┬───────────────────┘        │
                         │                            │
                         ▼                            │
              ┌──────────────────────┐                │
              │ wrapAnalytics(hook,  │◄───────────────┘
              │   { await: false })  │
              │   .catch(err =>      │
              │     log.warn(...))   │
              └──────────────────────┘
                         │
                         │ (does NOT block response — fire-and-forget)
                         │
                         ▼
                ┌────────────────┐
                │ res.json(...)  │  ← response emitted on next tick
                └────────────────┘
                         │
                         ▼
              [consumer's analytics pipeline:
               Datadog / Segment / Snowflake / etc.]
```

**Key flow:** the handler is the only context that knows `type` and `reason`, so events are constructed inline at each emit point. `wrapAnalytics` is a thin envelope (no I/O, no buffering) that returns immediately in fire-and-forget mode.

### Pattern 1: `AnalyticsEvent` discriminated union with type-level PII whitelist

**What:** A discriminated union where every variant has `type` as a literal-string discriminant. Adding `codename` (or any PII field) to a variant fails compilation because the union member is `infer`-ed from the variant's literal shape — there's no `Record<string, unknown>` escape hatch.

**File:** `src/server/analytics.ts` (NEW)

**Example:**
```typescript
// Source: pattern derived from MPCAccountManagerConfig (src/server/mpc.ts) +
// RelatedOrigin (src/types/index.ts) — both use literal-typed required fields
// to drive type-level invariants.

/**
 * Static enum of failure reasons. NEVER use `Error.message` — those strings
 * may contain user-supplied input (codename fragments, request body data) and
 * leak PII into the analytics pipeline. Always map an exception to one of
 * these enum values at the catch site.
 */
export type RegisterFailureReason =
  | 'invalid-codename'
  | 'passkey-verification-failed'
  | 'internal-error';

export type LoginFailureReason =
  | 'auth-failed'
  | 'user-not-found'
  | 'internal-error';

export type OauthProvider = 'google' | 'github' | 'twitter';

/**
 * AnalyticsEvent — the discriminated union emitted by hooks.onAuthEvent.
 *
 * INVARIANT: NO variant carries `userId`, `codename`, `nearAccountId`,
 * `email`, raw `ip`, raw `userAgent`. Adding any of those keys to ANY
 * variant fails the tsc-fail fixture in __tests__/analytics-pii-leak.test.ts
 * AND fails the snapshot whitelist in __tests__/analytics-pii-snapshot.test.ts.
 *
 * Every variant has:
 *   - `type`: literal string discriminant
 *   - `rpId`: the RP ID this createAnonAuth instance is configured for
 *   - `timestamp`: Date.now() at the emit call site
 *
 * Optional per-variant fields (NEVER added to other variants):
 *   - `provider`: OAuth provider (oauth.callback.success only)
 *   - `backupEligible`: deviceType === 'multiDevice' (success events only)
 *   - `reason`: static enum (failure events only)
 *   - `codenameProvided`: boolean (login.start only)
 */
export type AnalyticsEvent =
  // --- register lifecycle ---
  | { type: 'register.start'; rpId: string; timestamp: number; }
  | { type: 'register.finish.success'; rpId: string; timestamp: number; backupEligible: boolean; }
  | { type: 'register.finish.failure'; rpId: string; timestamp: number; reason: RegisterFailureReason; }
  // --- login lifecycle ---
  | { type: 'login.start'; rpId: string; timestamp: number; codenameProvided: boolean; }
  | { type: 'login.finish.success'; rpId: string; timestamp: number; backupEligible: boolean; }
  | { type: 'login.finish.failure'; rpId: string; timestamp: number; reason: LoginFailureReason; }
  // --- recovery (4 variants) ---
  | { type: 'recovery.wallet.link.success'; rpId: string; timestamp: number; }
  | { type: 'recovery.wallet.recover.success'; rpId: string; timestamp: number; }
  | { type: 'recovery.ipfs.setup.success'; rpId: string; timestamp: number; }
  | { type: 'recovery.ipfs.recover.success'; rpId: string; timestamp: number; }
  // --- oauth ---
  | { type: 'oauth.callback.success'; rpId: string; timestamp: number; provider: OauthProvider; }
  // --- account ---
  | { type: 'account.delete'; rpId: string; timestamp: number; };

/** Allowed event fields — single source of truth for the snapshot whitelist test (ANALYTICS-05). */
export const ALLOWED_EVENT_FIELDS = new Set([
  'type', 'rpId', 'timestamp',
  'provider', 'backupEligible', 'reason', 'codenameProvided',
]);
```

### Pattern 2: `wrapAnalytics` envelope (fire-and-forget by default; await on opt-in)

**What:** A factory that takes the consumer's `onAuthEvent` callback and returns a function `(event: AnalyticsEvent) => void` that invokes the hook safely. Errors are caught and logged with WARN at a `[Redacted]` level. In awaited mode, returns `Promise<void>` instead.

**File:** `src/server/analytics.ts` (NEW, same file as Pattern 1)

**Example:**
```typescript
// Source: pattern derived from src/server/mpc.ts:404-414 (logger fallback) +
// src/server/oauth/router.ts:332-336 (catch + log.warn for non-blocking failure)

import type { Logger } from 'pino';
import pino from 'pino';

export interface WrapAnalyticsOpts {
  /** Logger instance (typically the same one threaded through createAnonAuth). */
  logger?: Logger;
  /** When true, the wrapper awaits the hook's resolution. Driven by
   *  AnonAuthConfig.awaitAnalytics. Default false. */
  await?: boolean;
}

/**
 * Wrap a consumer's onAuthEvent hook into a safe emitter.
 *
 * Fire-and-forget mode (default):
 *   - returns void synchronously
 *   - hook starts executing immediately on the same tick
 *   - hook errors / rejected Promises are caught and logged via WARN
 *   - response is NOT delayed by hook execution time
 *
 * Awaited mode (opts.await === true):
 *   - returns Promise<void> that resolves when the hook resolves
 *   - hook errors / rejected Promises are STILL caught (never propagate)
 *   - response IS delayed by hook execution time (synchronous-guarantee
 *     use cases — e.g. consumer wants the event to land before responding)
 */
export function wrapAnalytics(
  hook: ((event: AnalyticsEvent) => void | Promise<void>) | undefined,
  opts: WrapAnalyticsOpts = {},
): (event: AnalyticsEvent) => void | Promise<void> {
  const log = (opts.logger ?? pino({ level: 'silent' })).child({ module: 'analytics' });
  const shouldAwait = opts.await === true;

  if (!hook) {
    // No hook configured → no-op (matches Phase 11 "absent hooks → behavior identical to v0.6.1")
    return () => {};
  }

  return (event: AnalyticsEvent) => {
    try {
      // Invoke synchronously — hook starts now, regardless of await mode.
      const ret = hook(event);

      if (shouldAwait && ret && typeof (ret as Promise<void>).then === 'function') {
        // Awaited mode: caller will `await` this returned Promise.
        return (ret as Promise<void>).catch((err) => {
          log.warn({ err: redactErrorMessage(err) }, 'analytics hook rejected (await mode)');
        });
      }

      if (ret && typeof (ret as Promise<void>).then === 'function') {
        // Fire-and-forget: attach .catch so an unhandled rejection doesn't crash the process.
        (ret as Promise<void>).catch((err) => {
          log.warn({ err: redactErrorMessage(err) }, 'analytics hook rejected');
        });
      }
    } catch (err) {
      // Synchronous throw — log and swallow.
      log.warn({ err: redactErrorMessage(err) }, 'analytics hook threw');
    }
  };
}

/**
 * Redact an Error so its message cannot leak PII into the analytics WARN log.
 *
 * Strategy: keep the error class name (e.g. 'TypeError') and stack-trace top
 * frame (file:line, no values). Drop `message` entirely — consumer-facing
 * error strings may contain codenames, account IDs, or other request data.
 */
function redactErrorMessage(err: unknown): { name: string; stackHead?: string } {
  if (err instanceof Error) {
    const stackHead = err.stack?.split('\n').slice(0, 2).join(' | ');
    return { name: err.name, stackHead };
  }
  return { name: typeof err };
}
```

**Why redaction matters:** Consumer hooks live in their codebase; a thrown error might say `"Failed to lookup user codename ALPHA-7-BRAVO"`. Logging that verbatim leaks the codename into the library's pino stream. Redacting to `{ name: 'Error' }` is conservative; if consumers want richer telemetry they can add it inside their own hook.

### Pattern 3: Inline emit at every lifecycle boundary

**What:** Where the handler decides "this is the success/failure point", construct the event literal and pass it to `wrapAnalytics(hook, opts)` synchronously. Do NOT factor through a per-router emitter helper — that obscures which event fires from which line.

**File:** `src/server/router.ts`, `src/server/oauth/router.ts` (BOTH MODIFIED — but small diff; ~13 inline calls)

**Example:**
```typescript
// In createRouter():
const emit = wrapAnalytics(config.hooks?.onAuthEvent, {
  logger: config.logger,
  await: config.awaitAnalytics === true,
});

// At /register/start emit point (line ~135):
emit({ type: 'register.start', rpId, timestamp: Date.now() });

// At /register/finish success (line ~246):
emit({
  type: 'register.finish.success',
  rpId,
  timestamp: Date.now(),
  backupEligible: deriveBackupEligibility(passkeyData.deviceType),
});

// At /register/finish failure (line ~189, 199, 248):
emit({
  type: 'register.finish.failure',
  rpId,
  timestamp: Date.now(),
  reason: 'invalid-codename', // or 'passkey-verification-failed', 'internal-error'
});
```

The `rpId` is captured ONCE at `createRouter` start (closed over by `emit`'s wrapper); same for the `await` mode flag. This keeps each emit-point line short.

**Threading note:** `RouterConfig` and `OAuthRouterConfig` already accept `hooks?: AnonAuthHooks` (Phase 11 plumbing). Phase 13 adds an `awaitAnalytics?: boolean` field to BOTH configs (or just reads `config.awaitAnalytics` from a parent shape — depends on the planner's preferred wiring). Per locked decision, `awaitAnalytics` is a TOP-LEVEL `AnonAuthConfig` field (not nested under `hooks`).

### Pattern 4: Snapshot-based whitelist test (ANALYTICS-05)

**What:** Construct one instance of every variant, walk `Object.keys`, assert membership in `ALLOWED_EVENT_FIELDS`. Future addition of a non-whitelisted field fails the test.

**File:** `src/__tests__/analytics-pii-snapshot.test.ts` (NEW)

**Example:**
```typescript
// Source: pattern derived from src/__tests__/exports.test.ts (compile-time
// + runtime cross-checks) and the structural-snapshot pattern in
// src/__tests__/mpc-account-manager.test.ts.

import { describe, it, expect } from 'vitest';
import { ALLOWED_EVENT_FIELDS, type AnalyticsEvent } from '../server/analytics.js';

const sampleVariants: AnalyticsEvent[] = [
  { type: 'register.start', rpId: 'localhost', timestamp: 0 },
  { type: 'register.finish.success', rpId: 'localhost', timestamp: 0, backupEligible: true },
  { type: 'register.finish.failure', rpId: 'localhost', timestamp: 0, reason: 'invalid-codename' },
  { type: 'login.start', rpId: 'localhost', timestamp: 0, codenameProvided: false },
  { type: 'login.finish.success', rpId: 'localhost', timestamp: 0, backupEligible: false },
  { type: 'login.finish.failure', rpId: 'localhost', timestamp: 0, reason: 'auth-failed' },
  { type: 'recovery.wallet.link.success', rpId: 'localhost', timestamp: 0 },
  { type: 'recovery.wallet.recover.success', rpId: 'localhost', timestamp: 0 },
  { type: 'recovery.ipfs.setup.success', rpId: 'localhost', timestamp: 0 },
  { type: 'recovery.ipfs.recover.success', rpId: 'localhost', timestamp: 0 },
  { type: 'oauth.callback.success', rpId: 'localhost', timestamp: 0, provider: 'google' },
  { type: 'account.delete', rpId: 'localhost', timestamp: 0 },
];

describe('ANALYTICS-05: every event variant uses only allowed fields', () => {
  it.each(sampleVariants)('variant $type contains no PII fields', (variant) => {
    const keys = Object.keys(variant);
    const disallowed = keys.filter((k) => !ALLOWED_EVENT_FIELDS.has(k));
    expect(disallowed).toEqual([]);
  });

  it('forbids userId, codename, nearAccountId, email, ip, userAgent in the allowed set', () => {
    expect(ALLOWED_EVENT_FIELDS.has('userId')).toBe(false);
    expect(ALLOWED_EVENT_FIELDS.has('codename')).toBe(false);
    expect(ALLOWED_EVENT_FIELDS.has('nearAccountId')).toBe(false);
    expect(ALLOWED_EVENT_FIELDS.has('email')).toBe(false);
    expect(ALLOWED_EVENT_FIELDS.has('ip')).toBe(false);
    expect(ALLOWED_EVENT_FIELDS.has('userAgent')).toBe(false);
  });
});
```

### Pattern 5: tsc-fail fixture (ANALYTICS-03), mirroring MPC-07

**What:** Write a temporary `.ts` fixture that adds `codename: string` to one of the `AnalyticsEvent` variants, shell out to `npx tsc --noEmit <fixture>`, assert the process exits non-zero AND the stderr/stdout contains `codename`.

**File:** `src/__tests__/analytics-pii-leak.test.ts` (NEW — directory placement per Open Question #5; recommended location mirrors MPC-07).

**Example:**
```typescript
// Source: direct mirror of src/__tests__/mpc-treasury-leak.test.ts:197-242

import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

describe('ANALYTICS-03: AnalyticsEvent forbids PII fields at the type level', () => {
  it('a fixture adding `codename` to a variant fails tsc on a fixture file', () => {
    const fixturePath = join(process.cwd(), 'src/__tests__/_analytics-pii-fixture.ts');
    const fixtureSrc = `
      import type { AnalyticsEvent } from '../server/analytics.js';
      // The discriminated union does NOT have a 'codename' field on register.start.
      // Asserting that the literal { type: 'register.start', codename: 'X' } is
      // assignable to AnalyticsEvent must fail.
      const _bad: AnalyticsEvent = {
        type: 'register.start',
        rpId: 'localhost',
        timestamp: 0,
        codename: 'ALPHA-7-BRAVO', // <-- this MUST fail tsc
      };
      export {};
      void _bad;
    `;
    writeFileSync(fixturePath, fixtureSrc, 'utf-8');
    let tscFailed = false;
    let tscOutput = '';
    try {
      execSync(`npx tsc --noEmit ${fixturePath}`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
        stdio: 'pipe',
      });
    } catch (err) {
      tscFailed = true;
      const e = err as { stdout?: string; stderr?: string };
      tscOutput = (e.stdout || '') + (e.stderr || '');
    } finally {
      if (existsSync(fixturePath)) unlinkSync(fixturePath);
    }
    expect(tscFailed).toBe(true);
    expect(tscOutput).toMatch(/codename/);
  }, 30_000);

  // Same pattern repeated for userId, nearAccountId, email, ip, userAgent —
  // either as separate it() blocks or a parameterised it.each.
  it.each(['userId', 'nearAccountId', 'email', 'ip', 'userAgent'] as const)(
    'a fixture adding `%s` to a variant fails tsc',
    (forbiddenField) => {
      // ... same pattern ...
    },
    30_000,
  );
});
```

### Anti-Patterns to Avoid

- **EventEmitter or Pub/Sub.** REQUIREMENTS Out-of-Scope. Wrong semantics for this contract.
- **`metadata: Record<string, unknown>` escape hatch.** REQUIREMENTS Out-of-Scope. Defeats the type-level whitelist.
- **Passing `req` or `res` into the event payload.** REQUIREMENTS Out-of-Scope. PII leak surface.
- **Logging `Error.message` directly in the WARN.** Consumer error strings often contain user-supplied data; redact to `{ name, stackHead }` only.
- **Emitting events from `passkey.ts` or `webauthn.ts` directly.** Those are stateless verifiers — the handler is the right context (it knows whether the verify result is being USED to register/login or to diagnose). Keep emit at the handler boundary.
- **Sharing `wrapAnalytics(hook, opts)` between routers via module-level state.** Each router constructs its own `emit` closure from its own config. (`config.hooks?.onAuthEvent` and `config.awaitAnalytics` are passed into both factories; instantiate the wrapper inside each.)
- **`setImmediate`/`queueMicrotask` for fire-and-forget.** Calling the hook synchronously and dropping the returned Promise is sufficient. `setImmediate` would defer hook EXECUTION, increasing the chance the response is sent before the hook runs at all (which is fine for fire-and-forget) but adds a layer of indirection that complicates testing. Just don't `await` it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Logger with redaction | A custom logger or `console.warn` shim | pino's existing `redact: { paths: [...] }` config (already used in `mpc.ts:404-414`) | pino is already in the dep tree; consumers expect pino-shaped logs; redaction-by-path is battle-tested |
| Discriminated-union exhaustiveness check | Custom enumeration in tests | TypeScript's native `never` exhaustiveness in `switch (event.type)` | The compiler enforces it for free; testing it adds maintenance |
| Whitelist enforcement | Runtime regex on key names | Two layers: (1) discriminated-union literal types catch it at compile, (2) `Object.keys` ⊆ `ALLOWED_EVENT_FIELDS` snapshot test catches it at CI | Defense-in-depth; runtime check is cheap and catches the case where someone adds a key in `analytics.ts` and updates `ALLOWED_EVENT_FIELDS` but a type bug lets a non-whitelisted field through |
| Per-event timestamp sourcing | Threading `req.requestStartTime` through 13 emit points | `Date.now()` at the call site | Pure simplicity; `latencyMs` is deferred to ANALYTICS-V2-02 |

**Key insight:** Phase 13 does NOT add new infrastructure. Every primitive needed (logger, vitest, supertest, tsc-fail fixture pattern) is already in the codebase. The phase is type-design + emit-point installation + tests.

---

## Common Pitfalls

### Pitfall 1: Emit point inside the `try { }` block, not the `catch { }` block, for failure events
**What goes wrong:** The handler's try/catch is structured so the success path emits before `res.json(...)` and the error path catches in `catch`. If `register.finish.failure` is emitted ONLY from the early `if (!verified)` returns (lines 189, 199) and NOT from the `catch (error)` on line 247, then a `passkeyManager.finishRegistration` throw produces a 500 with no analytics event.

**Why it happens:** Easy to miss the catch block when scanning success-path code.

**How to avoid:** For every `*.finish.failure` event, the executor must emit from EVERY non-success exit: explicit `return res.status(...)` paths AND the catch block. The acceptance criterion in the plan should be a grep count: `grep -c "type: 'register.finish.failure'" src/server/router.ts` returns 3 (matching the three exit points: line 189, line 199, line 248).

**Warning signs:** A 500 error in a manual smoke test produces no event in the consumer's analytics pipeline.

### Pitfall 2: `wrapAnalytics` re-resolved on every request
**What goes wrong:** If the executor places `const emit = wrapAnalytics(config.hooks?.onAuthEvent, ...)` INSIDE the `router.post(...)` handler instead of at `createRouter()` start, every request reads `config.hooks?.onAuthEvent` and constructs a new logger child. Performance is non-zero; more importantly, hot-reload during testing (where `hooks` changes between calls in the same test file) hides bugs.

**Why it happens:** Misreading "captured at start" as "captured per request".

**How to avoid:** The plan's acceptance criterion: `grep -c "const emit = wrapAnalytics" src/server/router.ts` returns 1 (single call at top of `createRouter`). The same for `oauth/router.ts`.

### Pitfall 3: `awaitAnalytics: true` not threaded into the OAuth router
**What goes wrong:** The locked decision puts `awaitAnalytics` at the TOP LEVEL of `AnonAuthConfig`. Phase 11 already threaded `hooks` into both `createRouter` and `createOAuthRouter` (a Pattern-4-style mistake would be to forget the OAuth side). Phase 13 must do the same threading for `awaitAnalytics`. If only the passkey router awaits and the OAuth router does not, OAuth callbacks fire-and-forget regardless of consumer's setting.

**Why it happens:** This is the EXACT pitfall flagged in Phase 11 RESEARCH.md Pitfall 4 ("Hook threading drops at the OAuth router boundary").

**How to avoid:** Acceptance criterion: `grep -c "awaitAnalytics" src/server/index.ts` returns at least 2 (one for each factory call). Phase 13 mirrors Phase 11's lockstep-threading test pattern.

### Pitfall 4: Capturing `rpId` from `req` instead of `config.rp.id`
**What goes wrong:** Multi-RP_ID is now supported (Phase 12). A naive implementation might try to determine which `rpId` the assertion was verified against and emit it. But `@simplewebauthn/server@13.x` does NOT return the matched rpId from `verifyAuthenticationResponse` — only `verified: true | false` (verified by reading `node_modules/@simplewebauthn/server/esm/authentication/verifyAuthenticationResponse.d.ts`). Trying to derive the matched rpId from `req.headers.host` or similar leaks the actual originating domain, which (combined with timestamp) could de-anonymize a session.

**Why it happens:** "RP ID" sounds per-request because in a multi-domain deployment it varies; the library design just doesn't surface that.

**How to avoid:** Always emit `config.rp.id` (the PRIMARY rpId, captured at `createRouter()` start as a closed-over `const rpId = config.rp?.id ?? 'localhost';`). See Open Question #1.

### Pitfall 5: tsc-fail fixture race with CI's parallel test runner
**What goes wrong:** The tsc-fail fixture writes a `.ts` file at a deterministic path (`src/__tests__/_analytics-pii-fixture.ts`). If two parallel vitest workers both try to write/read/unlink it, the test flakes.

**Why it happens:** vitest 4.x runs files in parallel by default.

**How to avoid:** Use a UUID in the fixture path (`_analytics-pii-fixture-${randomUUID()}.ts`) OR ensure each `it()` writes to a unique file. The MPC-07 fixture in the existing codebase uses a deterministic name and gets away with it because there's only one `it()` block writing it; Phase 13 will have multiple (one per forbidden field), so per-test UUID paths are required.

### Pitfall 6: Capturing the timestamp at handler start, not at emit
**What goes wrong:** Two related issues. (a) For long-running handlers (`/oauth/:provider/callback` does multi-second token exchange), capturing `timestamp` at handler start makes `register.finish.success.timestamp` show the time of the START call, not the success — confusing for ingestion pipelines that bucket by event type. (b) Threading a `requestStartTime` variable through every emit point is invasive.

**Why it happens:** Habit from request-lifecycle middleware.

**How to avoid:** Capture `timestamp: Date.now()` at the literal-construction site for each event. The cost is one syscall per emit; negligible.

---

## Runtime State Inventory

> Phase 13 is greenfield (new module + emit-point additions + new tests). No rename, no migration, no refactor of existing string identifiers. **Section omitted intentionally — not applicable.**

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All build/test | ✓ | v20 (via nvm — see CLAUDE.md / MEMORY feedback_nvm.md) | None — Node 20 required for `npm run build`/`npm test` |
| pino | `wrapAnalytics` WARN log | ✓ | 10.3.1 (already in `package.json`) | None needed |
| vitest | Test framework | ✓ | 4.0.18 (already in devDeps) | None needed |
| supertest | Integration tests | ✓ | 7.2.2 (already in devDeps) | None needed |
| typescript | tsc-fail fixture (`npx tsc --noEmit`) | ✓ | 5.9.3 (already in devDeps) | None needed |

**Missing dependencies:** None. All tooling is in place.

---

## Code Examples

### Wiring a single emit point (passkey `/register/start`)

```typescript
// Source: synthesized from src/server/router.ts:131-175 + Pattern 3 above

router.post('/register/start', authLimiter, async (req: Request, res: Response) => {
  try {
    const body = validateBody(registerStartBodySchema, req, res);
    if (!body) return;

    // Emit lifecycle boundary — fire-and-forget (default) or awaited (opt-in).
    emit({ type: 'register.start', rpId, timestamp: Date.now() });

    // ... existing handler logic unchanged ...
  } catch (error) {
    log.error({ err: error }, 'Registration start error');
    res.status(500).json({ error: 'Registration failed' });
  }
});
```

### Wiring emit at the top of `createRouter`

```typescript
// Source: src/server/router.ts:55-65 (existing) + Pattern 3 above

export function createRouter(config: RouterConfig): Router {
  const log = (config.logger ?? pino({ level: 'silent' })).child({ module: 'router' });
  const router = Router();
  const {
    db, sessionManager, passkeyManager, mpcManager,
    walletRecovery, ipfsRecovery,
  } = config;

  // NEW: Phase 13. Captured once at router construction.
  const rpId = config.rpId; // or threaded through from createAnonAuth — see Section "Threading"
  const emit = wrapAnalytics(config.hooks?.onAuthEvent, {
    logger: config.logger,
    await: config.awaitAnalytics === true,
  });

  // ... existing rate-limiter / CSRF setup unchanged ...
}
```

**Threading:** `RouterConfig` and `OAuthRouterConfig` need TWO new optional fields: `rpId?: string` (so the router knows what to put in the event without re-deriving from `passkeyManager`) AND `awaitAnalytics?: boolean`. Both are added to the existing config interfaces; `createAnonAuth` threads them in alongside the existing `hooks: config.hooks` line (in `src/server/index.ts:210` and `:230`).

### Latency assertion test pattern

```typescript
// Source: synthesized from src/__tests__/registration-auth.test.ts patterns
// + standard supertest + performance.now timing

it('a 5-second onAuthEvent hook does NOT delay the response in fire-and-forget mode', async () => {
  let hookResolved = false;
  const slowHook = async () => {
    await new Promise((r) => setTimeout(r, 5000));
    hookResolved = true;
  };

  const app = makeAppWithAuth({ hooks: { onAuthEvent: slowHook }, awaitAnalytics: false });

  const t0 = performance.now();
  const res = await request(app).post('/register/start').send({ /* ... */ });
  const elapsed = performance.now() - t0;

  expect(res.status).toBe(200);
  expect(elapsed).toBeLessThan(500);   // response time well under hook's 5s
  expect(hookResolved).toBe(false);    // hook still running in background
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| EventEmitter for telemetry | Single-callback `onAuthEvent` with discriminated union | This phase (Phase 13) | Simpler error-handling contract; no listener-error swallowing |
| `metadata: Record<string, unknown>` analytics payload | Bounded discriminated union with type-level whitelist | Locked at v0.7.0 design | Type system is the PII gate; consumers cannot accidentally extend |
| `Error.message` in WARN logs | `redactErrorMessage(err) → { name, stackHead }` | This phase | No PII leak via thrown error strings |
| Per-router event-bus indirection | Inline `emit({ type, ... })` at boundary | This phase | Each event's source line is grep-able; no layer to debug through |

**Deprecated/outdated:**
- None — Phase 13 is greenfield within v0.7.0.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | indirect | Phase 13 instruments existing auth flows; does not change the verification chain |
| V3 Session Management | indirect | Emit AFTER `sessionManager.createSession` for success; AFTER `destroySession` for delete |
| V4 Access Control | no | Events are emitted by the library to the consumer's hook; there's no access decision |
| V5 Input Validation | yes | Emit AFTER `validateBody` returns truthy — never fire on malformed input (defense against pipeline-poisoning) |
| V6 Cryptography | no | No new crypto; reuses pino's redaction primitive |
| V7 Error Handling | yes | `wrapAnalytics` swallows hook errors; logs WARN with redacted payload; never propagates to handler |
| V8 Data Protection | yes | The PII whitelist IS the data-protection boundary. Type-level + runtime defense-in-depth |
| V9 Comm Security | no | Events stay in-process; no network egress from library |
| V14 Configuration | yes | `awaitAnalytics: true/false` is a security-impacting config (latency leakage in await mode) — README must call this out (RELEASE-01) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PII leak via event SHAPE (consumer mistakenly adds `codename` to a variant) | Information Disclosure | tsc-fail fixture (ANALYTICS-03) + snapshot whitelist (ANALYTICS-05) — defense in depth |
| PII leak via thrown `Error.message` in hook | Information Disclosure | `redactErrorMessage` strips message; logs `{ name, stackHead }` only |
| Latency-side-channel timing attack via `awaitAnalytics: true` | Information Disclosure (timing) | README documents that await mode adds hook-execution time to response latency; recommend fire-and-forget for production unless consumer specifically needs sync semantics |
| Pipeline DoS — attacker floods `/register/start` to spam consumer's analytics ingest | Denial of Service | Existing `authLimiter` rate-limit (20 req / 15 min per IP) caps emission; events fire AFTER rate-limit check |
| Hook injection — consumer hook code runs in-process | Tampering / DoS | `wrapAnalytics` envelope catches throws; fire-and-forget mode prevents blocking. Library does not validate hook contents (consumer responsibility) |
| Process crash on unhandled rejection | Denial of Service | `wrapAnalytics` attaches `.catch` to every returned Promise; no unhandled rejection escapes |

---

## Project Constraints (from CLAUDE.md)

> No `./CLAUDE.md` exists at the project root (verified: `Read /home/vitalpointai/projects/near-phantom-auth/CLAUDE.md` returned "File does not exist").

The project DOES have a user-level memory at `$HOME/.claude/projects/.../MEMORY.md` with one feedback item: **"System Node is v12; must use nvm (v20) for GSD tools"**. Every test/build command in this research uses `nvm use 20 && ...` to honor this.

No `.claude/skills/` or `.agents/skills/` directories exist (verified by ls).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `rpId` for emission is always `config.rp.id` (the PRIMARY rpId), never derived per-request | Pitfall 4, Pattern 3, Open Question #1 | If consumers expect the matched rpId for multi-RP_ID flows, they'll see `localhost` (or the primary domain) on every event regardless of which related origin actually authenticated. **Verification needed.** [ASSUMED — derived from reading `passkey.ts` lines 180-195 + 290-310, which show `@simplewebauthn/server` is called with arrays but does not return the matched rpId. NOT verified by consumer interview.] |
| A2 | `awaitAnalytics` is a top-level `AnonAuthConfig` field, NOT nested inside `hooks` | Locked Decisions, Pattern 3 | If consumers expect `hooks.awaitAnalytics`, the type contract changes (rejected as breaking by REQUIREMENTS line 11). [VERIFIED: REQUIREMENTS.md line 11 explicitly says "top level of `AnonAuthConfig`"] |
| A3 | OAuth callback emits `oauth.callback.success` from ALL THREE code paths (existing-user, link-by-email, new-user) | Lifecycle Boundary Inventory § OAuth | If only the new-user path emits, login telemetry from returning users is silently dropped. **Confirmation needed during planning.** [ASSUMED — REQUIREMENTS line 51 lists `oauth.callback.success` once; doesn't disambiguate.] |
| A4 | `register.start` and `login.start` emit AFTER body validation but BEFORE business logic | Claude's Discretion | If they emit before validation, attackers can spam the analytics pipeline with malformed bodies. If they emit AFTER all logic, the "start" semantic is lost. [ASSUMED — REQUIREMENTS does not specify; recommendation is grounded in Pitfall analysis but not consumer-confirmed.] |
| A5 | Failure events emit from EVERY non-success exit (early returns + catch block), not just one | Pitfall 1, Lifecycle Boundary Inventory | If only one exit point emits, certain failure modes are silently un-observed. [ASSUMED — REQUIREMENTS is silent on this; recommendation is grounded in defensive instrumentation.] |
| A6 | `redactErrorMessage` strips `Error.message` entirely; keeps only `name` + first 2 stack frames | Pattern 2 | If consumers want the message for debugging, they have to log it themselves inside their hook. [ASSUMED — REQUIREMENTS line 54 says "redacted error message" but does not specify redaction strategy.] |
| A7 | tsc-fail fixture lives at `src/__tests__/analytics-pii-leak.test.ts`, NOT `src/__tsc_fail/...` | Open Question #5 | If REQUIREMENTS' literal path `__tsc_fail/` is enforced, the test must live in a new directory. [ASSUMED — REQUIREMENTS uses `__tsc_fail/` as a category name, but MPC-07 (the explicit pattern reference) lives in `src/__tests__/`.] |
| A8 | The consumer-facing module boundary for `AnalyticsEvent` re-export is `@vitalpoint/near-phantom-auth/server` | Phase requirement Q7 | If consumers expect the type from `@vitalpoint/near-phantom-auth` (root), they get an autocomplete miss. [VERIFIED: existing pattern — `AnonAuthHooks` is re-exported from `/server` (`src/server/index.ts:260`), not from root; AnalyticsEvent should follow the same path.] |

---

## Open Questions

1. **`rpId` source for emission — primary only, or attempt per-request matching?**
   - **What we know:** `@simplewebauthn/server@13.2.3` accepts arrays for `expectedRPID` and `expectedOrigin` but does NOT return the matched value (verified by reading `node_modules/@simplewebauthn/server/esm/authentication/verifyAuthenticationResponse.d.ts`). The library only knows the PRIMARY `config.rp.id` at the handler level.
   - **What's unclear:** Is emitting `rpId: config.rp.id` (primary) acceptable for multi-RP_ID consumers, or must Phase 13 figure out which related origin matched?
   - **Recommendation:** Emit the PRIMARY. A future `event.matchedRpId` is a v2 concern (would require a SimpleWebAuthn upstream change or post-verify origin parse from `clientDataJSON`). Confirm with consumer in `/gsd-discuss-phase` if Phase 13 enters that flow; otherwise lock to PRIMARY in `/gsd-plan-phase`.

2. **Should `oauth.callback.success` emit for ALL THREE OAuth code paths?**
   - **What we know:** REQUIREMENTS lists the event ONCE; the OAuth router has three success-yielding code paths (existing-user same-provider, existing-user link-by-email, new-user create).
   - **What's unclear:** Which of those three is "the success"?
   - **Recommendation:** All three. They're indistinguishable to the consumer's analytics pipeline if the payload is just `{ type, rpId, timestamp, provider }`. Adding `isNewUser: boolean` is a future enhancement; for v0.7.0 keep it simple. Plan should explicitly call out the 3 emit points in OAuth router tasks.

3. **Should `wrapAnalytics`'s WARN log include the EVENT TYPE that failed?**
   - **What we know:** Logging `{ event: { type: 'register.start' } }` reveals which lifecycle boundary failed. Logging only `{ err: { name, stackHead } }` is more conservative.
   - **What's unclear:** Is `event.type` itself considered safe to log? (The string is library-controlled; not consumer-input.)
   - **Recommendation:** Include `event.type` in the WARN — it's a static enum literal and tells the operator which emit failed. Do NOT include the rest of the event payload (no `rpId`, `provider`, etc., to keep the WARN minimal).

4. **Snapshot test — single allowlist or per-variant allowlist?**
   - **What we know:** Pattern 4 uses a single `ALLOWED_EVENT_FIELDS` set (7 keys total).
   - **What's unclear:** Should `provider` be allowed on `register.start`? It isn't defined there, but the snapshot test's "subset" check would PASS if a future change adds `provider` to `register.start`.
   - **Recommendation:** Single allowlist is sufficient because the discriminated union itself prevents `provider` from being added to `register.start` (the variant's literal type doesn't include it). The whitelist test is defense-in-depth against a future hand-rolled object that bypasses the type system; it doesn't need per-variant strictness. Plan-checker review should validate this trade-off.

5. **tsc-fail fixture directory placement: `src/__tests__/` or `src/__tsc_fail/`?**
   - **What we know:** REQUIREMENTS line 53 references the path as `__tsc_fail/analytics-pii-leak.test.ts`. The existing MPC-07 fixture is at `src/__tests__/mpc-treasury-leak.test.ts` — NOT in a `__tsc_fail/` directory.
   - **What's unclear:** Is `__tsc_fail/` a literal directory or a category name?
   - **Recommendation:** Treat as a category name. Place the file at `src/__tests__/analytics-pii-leak.test.ts` to mirror MPC-07's actual location. The vitest config (`globals: true, environment: 'node'`) picks up tests from `src/**/*.test.ts` — both locations would work, but `src/__tests__/` is the established convention. Lock this in `/gsd-plan-phase`.

6. **Should `awaitAnalytics: true` cause the request handler to fail if the hook rejects?**
   - **What we know:** REQUIREMENTS line 54 says "errors swallowed with WARN-level pino log" without distinguishing fire-and-forget vs awaited mode.
   - **What's unclear:** In sync mode, should a thrown hook actually fail the request (synchronous-guarantee semantics) or still swallow?
   - **Recommendation:** Always swallow. The locked decision treats `awaitAnalytics` as a latency-control switch ("synchronous-guarantee use cases"), not an error-propagation switch. Failing the request because analytics ingest threw makes the analytics path a hard dependency of auth — exactly what the library doesn't want. Pattern 2 above swallows in BOTH modes.

7. **Is there a need for an `analytics.disabled: true` config short-circuit?**
   - **What we know:** When `hooks.onAuthEvent` is undefined, `wrapAnalytics` returns a no-op function (Pattern 2). No explicit disable flag is needed.
   - **Recommendation:** No. Absent hook IS the disable flag. Adding `analytics.disabled: true` is API surface for no behavioral gain. Out-of-scope unless requested.

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)

- `src/types/index.ts` lines 37-196 — `AnonAuthHooks` interface; `AnonAuthConfig.hooks?` field
- `src/server/router.ts` lines 17-735 — every passkey/recovery/account-delete emit point identified by file:line
- `src/server/oauth/router.ts` lines 15-426 — OAuth callback emit points (3 paths)
- `src/server/index.ts` lines 88-272 — `createAnonAuth` factory wiring; existing `hooks: config.hooks` threading on lines 210, 230 (Phase 11); type re-export block on lines 258-272
- `src/server/passkey.ts` lines 30-310 — `rpId` is config-time-only, never per-request; `relatedOrigins` array spread on lines 183-188 and 294-299; `verifyAuthenticationResponse` does NOT return matched rpId
- `src/__tests__/mpc-treasury-leak.test.ts` lines 197-242 — canonical MPC-07 tsc-fail fixture pattern (Pattern 5)
- `src/__tests__/registration-auth.test.ts` lines 18-118 — canonical `makeMockDb()` + supertest pattern for integration tests
- `src/server/mpc.ts` lines 395-414 — pino redaction config pattern (`redact: { paths: [...], censor: '[Redacted]' }`)
- `package.json` — pino@^10.3.1, vitest@^4.0.18, supertest@^7.2.2, typescript@^5.9.3 verified
- `tsup.config.ts` line 16 — pino externalized (consumer provides instance)
- `vitest.config.ts` — `globals: true, environment: 'node'`
- `.planning/REQUIREMENTS.md` — ANALYTICS-01..06 verbatim
- `.planning/STATE.md` — locked decisions for v0.7.0
- `.planning/ROADMAP.md` — Phase 13 success criteria
- `.planning/phases/11-backup-eligibility-flags-hooks-scaffolding/11-RESEARCH.md` — Pattern 6 and Pitfall 4 (threading) reference
- `.planning/phases/11-backup-eligibility-flags-hooks-scaffolding/11-02-PLAN.md` — actual landed Phase 11 plumbing (the foundation Phase 13 builds on)

### Secondary (MEDIUM confidence — verified against npm registry / official docs)

- `npm view pino version` → 10.3.1 [VERIFIED 2026-04-29]
- `npm view vitest version` → 4.1.5 [VERIFIED 2026-04-29] — newer than installed 4.0.18; upgrade out of scope
- pino redact-paths documentation: standard pino feature, used in MPC-09 [CITED: docs.pino.io — pattern is in active use in `src/server/mpc.ts:404-414`]

### Tertiary (LOW confidence — none required)

- All findings load-bearing for planning are HIGH confidence (codebase inspection or version verification).

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep verified in `package.json` and `npm view`
- Architecture (emit points): HIGH — every emit point verified by file:line in `router.ts` and `oauth/router.ts`
- Pitfalls: HIGH — Pitfalls 1-3 are direct extrapolations of MPC-07 and Phase 11 Pitfall 4; Pitfalls 4-6 derive from reading `@simplewebauthn/server` source and library handler structure
- Type design (Pattern 1): HIGH — discriminated unions are TypeScript bedrock, MPC-07 is the proven precedent
- Open Questions: MEDIUM (some require consumer confirmation in `/gsd-discuss-phase`)

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 (30 days — stable codebase, no major upstream releases pending)
