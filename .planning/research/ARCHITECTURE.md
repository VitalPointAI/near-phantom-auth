# Project Research — Architecture for v0.7.0 Consumer Hooks & Recovery Hardening

**Project:** `@vitalpoint/near-phantom-auth` v0.6.1 → v0.7.0
**Researched:** 2026-04-29
**Confidence:** HIGH (sourced directly from current source; no speculation)
**Critical pre-frame:** `MPCAccountManager` is FROZEN by consumer pin. None of the v0.7.0 features touch `mpc.ts` directly — they all live above it (router, passkey manager, webauthn standalone, type config). All response/config shape changes below are ADDITIVE (new optional fields or new top-level keys).

---

## Feature 1 — Backup-Eligibility Flag Exposure

### Current Data Flow (verified)

`@simplewebauthn/server` `verifyRegistrationResponse()` returns `registrationInfo.credentialBackedUp` (boolean) and `registrationInfo.credentialDeviceType` (`'singleDevice' | 'multiDevice'`). The `'multiDevice'` deviceType is the de-facto "backup-eligible" flag — backup-eligible authenticators are allowed to be backed up; `backedUp` reflects whether they ARE backed up.

- `src/server/passkey.ts:182-201` — `finishRegistration()` already extracts `backedUp` and `deviceType`, returns them in `passkeyData`.
- `src/server/webauthn.ts:233-270` — `verifyRegistration()` (standalone) already returns `credential.backedUp` and `credential.deviceType` in its `VerifyRegistrationResult`.
- `src/server/router.ts:213-221` — router persists `passkeyData.backedUp` to `anon_passkeys.backed_up` column.
- `src/server/router.ts:235-239` — `/register/finish` response is `{ success, codename, nearAccountId }` — does NOT surface `backedUp`.
- `src/server/router.ts:312-315` — `/login/finish` response is `{ success, codename }` — also does NOT surface `backedUp`.
- During login, `passkeyManager.finishAuthentication()` returns the `passkey` (which has `backedUp` from DB), but `router.ts:307` ignores it.

**Note:** `credentialBackedUp` / `'multiDevice'` are the only signals. The WebAuthn AuthenticatorData `flags.BE` (Backup Eligibility) and `flags.BS` (Backup State) bits are folded by `@simplewebauthn/server` into `credentialDeviceType` (`'multiDevice'` implies BE=1) and `credentialBackedUp` (BS bit) respectively — there is no separate `backupEligible` boolean on the library shape today.

### Integration Points (modify)

| File | Function | Change |
|---|---|---|
| `src/server/router.ts` | `POST /register/finish` handler | Read `passkeyData.deviceType` and `passkeyData.backedUp` (already in scope); add to response under a new `passkey` key (additive nested object) |
| `src/server/router.ts` | `POST /login/finish` handler | Capture `passkey` from `passkeyManager.finishAuthentication()` return (already has it but discards), add to response under same nested `passkey` key |
| `src/types/index.ts` | `RegistrationFinishResponse`, `AuthenticationFinishResponse` | Add optional `passkey?: { backedUp: boolean; backupEligible: boolean }` |
| `src/server/webauthn.ts` | `VerifyRegistrationResult.credential` | Add a derived `backupEligible: boolean` (computed: `deviceType === 'multiDevice'`) |
| `src/client/api.ts` | `RegistrationFinishResponse`, `AuthenticationFinishResponse` reflected types | Already imported from `src/types`; gets the field automatically |
| `src/client/hooks/useAnonAuth.tsx` | `AnonAuthState` | Add optional `passkeyBackedUp: boolean \| null`, `passkeyBackupEligible: boolean \| null` |
| `src/client/hooks/useAnonAuth.tsx` | `register` and `login` callbacks | Read `result.passkey?.backedUp` / `.backupEligible`, store in state |

### New Components (add)

- **Type:** `BackupEligibility` in `src/types/index.ts`:
  ```ts
  export interface BackupEligibility {
    backupEligible: boolean;  // BE bit (multi-device authenticator)
    backedUp: boolean;        // BS bit (currently synced to cloud / hardware backed up)
  }
  ```
- **Helper (internal):** `deriveBackupEligibility(passkeyData)` in a new `src/server/backup.ts` (single-source-of-truth for the deviceType→backupEligible mapping, used by both router and webauthn.ts).

### Data Flow Changes

**Request shapes:** unchanged.
**Response shapes (additive only):**
- `/register/finish`: `{ success, codename, nearAccountId, passkey?: { backupEligible, backedUp } }`
- `/login/finish`: `{ success, codename, passkey?: { backupEligible, backedUp } }`
- standalone `verifyRegistration()` result `.credential.backupEligible` (computed)

### Backwards Compat

- `passkey` is a new optional nested key on the response. Existing consumers ignore unknown keys → safe.
- No DB schema changes (column already exists since v0.5).
- Optional in `AnonAuthState` → React consumers reading the old shape unaffected.

### Build Order Within Feature

1. Add `BackupEligibility` type + `deriveBackupEligibility()` helper.
2. Wire into `verifyRegistration()` result (standalone webauthn.ts).
3. Wire into `/register/finish` response.
4. Wire into `/login/finish` response (requires capturing `passkey` from `finishAuthentication` — minor refactor).
5. Update React hook state.
6. Tests: unit on helper; integration on both endpoints.

### Tsup / Externalization

No new deps. No bundle change.

---

## Feature 2 — Second-Factor Enrolment Hook

### Required Decision (call out for roadmap)

Two competing shapes — pick before implementation:

**Option A (recommended): Inline hook inside `/register/finish`, async-await, BEFORE session creation.**
- Hook fires AFTER `verifyRegistration` succeeds AND AFTER `mpcManager.createAccount` AND AFTER `db.createUser` + `db.createPasskey`, BUT BEFORE `sessionManager.createSession`.
- Rationale: gives the hook the full `userId` (so it can store its own 2FA enrolment record) but withholds the session cookie until it returns. If the hook throws, registration is rolled back via the existing transaction wrapper.
- Hook contract: `(ctx: { userId, codename, nearAccountId, req, res }) => Promise<{ enrolled: boolean; metadata?: Record<string, unknown> }>`.
- Response gains: `secondFactor?: { enrolled: boolean; metadata?: ... }`.

**Option B: Separate post-register endpoint.**
- Consumer calls `/register/finish` (gets session), then calls their own `/2fa/enrol` route.
- Library's role: just expose a config flag `requireSecondFactor: true` and a session-claim `secondFactorPending: true` until consumer signals completion.
- More flexible, but requires session-claim plumbing → more invasive.

**Recommendation:** Option A unless a later research finding argues otherwise.

### Integration Points (Option A — modify)

| File | Function | Change |
|---|---|---|
| `src/server/index.ts` | `createAnonAuth(config)` | Accept new `config.secondFactor?: SecondFactorHook` and pass to `createRouter` |
| `src/server/router.ts` | `RouterConfig` | Add `secondFactor?: SecondFactorHook` |
| `src/server/router.ts` | `POST /register/finish` handler (line ~178) | After user+passkey persisted, before `sessionManager.createSession`, await hook if configured. On throw → rollback (already wrapped in `db.transaction` per BUG-04 from v0.5) |
| `src/types/index.ts` | `AnonAuthConfig` | Add `secondFactor?: SecondFactorHook` |

### New Components (add)

- **Type** in `src/types/index.ts`:
  ```ts
  export interface SecondFactorContext {
    userId: string;
    codename: string;
    nearAccountId: string;
    req: Request;
  }
  export interface SecondFactorResult {
    enrolled: boolean;
    metadata?: Record<string, unknown>;
  }
  export type SecondFactorHook = (ctx: SecondFactorContext) => Promise<SecondFactorResult>;
  ```
- **No new DB column on `anon_users`** — the library should NOT track 2FA state. The hook returns `metadata`; consumers persist it in their own table.
- **No new endpoint** — sits inside register/finish.

### Data Flow Changes

- Adds an awaited callback boundary inside the existing transaction.
- Response gains `secondFactor?: { enrolled, metadata }`.
- If hook throws and `db.transaction` is implemented, the user/passkey insert is rolled back. **Critical:** the `mpcManager.createAccount` call happens BEFORE the transaction (line 200) — already fund-on-chain at that point. The hook running INSIDE the transaction means an MPC account exists with no DB record on hook failure. Document this trade-off in JSDoc and recommend hooks be idempotent + non-throwing if MPC funding has occurred. (Same issue exists today with `db.createUser` failure — not a regression.)

### Standalone webauthn entry?

NO — this is router-only. Standalone `webauthn.ts` has no concept of "user", "session", or "MPC account" — adding 2FA there would conflate concerns. Document in JSDoc that consumers using standalone webauthn implement 2FA themselves.

### Backwards Compat

All optional. Without `config.secondFactor`, behavior identical to v0.6.1.

### Build Order Within Feature

1. Add types in `src/types/index.ts`.
2. Add config plumbing through `createAnonAuth` → `createRouter`.
3. Wire hook call site inside `/register/finish` (inside transaction, before `createSession`).
4. Document MPC-funded-but-rolled-back failure mode in JSDoc.
5. Tests: hook fires once on success; hook throw rolls back DB; hook absent = identity behavior; hook receives correct `userId`.

---

## Feature 3 — Lazy-Backfill Hook for pre-v0.6.0 Accounts

### Domain Clarification

The columns referenced as `key_bundle_iv` / `sealing_key_hex` do **NOT** exist in this library's `anon_users` schema (`src/server/db/adapters/postgres.ts:32-40`). They exist (if at all) in the **consumer's** application DB. The library never stored sealing keys — `sealingKeyHex` is validated and forwarded but never persisted (`src/server/validation/schemas.ts:38-43`).

So this hook is a **pass-through hook** — the library invokes it during `/login/finish` to let the consumer determine whether their account record is missing key material and, if so, run a backfill ceremony.

(See Pitfalls research for an alternate framing where the library DOES introduce a `key_bundle` column. The roadmap should resolve which framing applies — pass-through vs library-managed — at requirements time.)

### Integration Points (modify)

| File | Function | Change |
|---|---|---|
| `src/server/router.ts` | `POST /login/finish` (line 284) | After `verified && userId` confirmed, before `sessionManager.createSession`, optionally invoke `config.recoveryBackfill?.(ctx)` if hook configured AND `sealingKeyHex` was supplied in body |
| `src/server/index.ts` | `createAnonAuth` | Accept `config.recoveryBackfill?: RecoveryBackfillHook` |
| `src/server/router.ts` | `RouterConfig` | Add `recoveryBackfill?: RecoveryBackfillHook` |
| `src/types/index.ts` | `AnonAuthConfig` | Add `recoveryBackfill?: RecoveryBackfillHook` |

### New Components (add)

- **Type:**
  ```ts
  export interface RecoveryBackfillContext {
    userId: string;
    codename: string;
    nearAccountId: string;
    sealingKeyHex: string;  // required — backfill only meaningful when PRF available this login
    req: Request;
  }
  export interface RecoveryBackfillResult {
    backfilled: boolean;
    reason?: 'already-current' | 'no-legacy-data' | 'completed' | 'skipped';
  }
  export type RecoveryBackfillHook = (ctx: RecoveryBackfillContext) => Promise<RecoveryBackfillResult>;
  ```

### Data Flow Changes

- Request: unchanged (already accepts `sealingKeyHex` per PRF-08).
- Response: optional `backfill?: { backfilled, reason }` (additive).
- Library does NOT manage transactions for the hook — consumer manages their own DB tx (since it's their schema).

### PRF Interaction

- Backfill hook ONLY fires if `sealingKeyHex` was present in the login body. No PRF → no fresh sealing key → cannot backfill → skip silently.
- Backfill is NOT an alternative to PRF; it's **complementary**: it's the migration path for accounts created before PRF was supported, run opportunistically when those accounts log in with a PRF-capable authenticator for the first time.
- Document explicitly: backfill requires both (a) `requirePrf` is configured OR the authenticator happens to support PRF, AND (b) the consumer's hook detects legacy state.

### Backwards Compat

Optional config + optional response key. Safe.

### Build Order Within Feature

1. Add types.
2. Add config plumbing.
3. Wire hook in `/login/finish` after auth success (before session creation, so consumer can use `req` headers).
4. Tests: no hook = identity; hook fires only when `sealingKeyHex` present; hook errors propagate as 500 (or define a contained-error mode where backfill failure does NOT block login — recommended).

---

## Feature 4 — Multi-RP_ID Verification

### Current Surface

Single `rpId: string` everywhere:
- `AnonAuthConfig.rp.id: string` (`src/types/index.ts:60`)
- `PasskeyConfig.rpId: string` (`src/server/passkey.ts:39`)
- `CreateRegistrationOptionsInput.rpId: string` (`src/server/webauthn.ts:64`)
- `CreateAuthenticationOptionsInput.rpId: string` (`src/server/webauthn.ts:122`)
- `VerifyRegistrationInput.expectedRPID: string` (`src/server/webauthn.ts:96`)
- `VerifyAuthenticationInput.expectedRPID: string` (`src/server/webauthn.ts:159`)

Threaded into `@simplewebauthn/server` calls at:
- `src/server/passkey.ts:108` — `rpID: config.rpId` (registration options)
- `src/server/passkey.ts:170` — `expectedRPID: config.rpId` (registration verify)
- `src/server/passkey.ts:222` — `rpID: config.rpId` (authentication options)
- `src/server/passkey.ts:277` — `expectedRPID: config.rpId` (authentication verify)
- Same 4 sites in `src/server/webauthn.ts`.

### `@simplewebauthn/server` Capability

`verifyRegistrationResponse` and `verifyAuthenticationResponse` accept `expectedRPID: string | string[]` (array form supported since simplewebauthn v8 — verified by Stack research; current pin is v13.2.3 which supports). `generateRegistrationOptions` and `generateAuthenticationOptions` take a single `rpID` — registration MUST pin to one RP_ID at creation time (the credential is bound to that RP_ID hash).

**Implication:** Generation = single. Verification = array allowed.

### Two paths (pick at requirements time)

**Path A (minimal): array on verification only.** Registration stays single. Verification accepts `string | string[]`. Use case: cross-domain login when an apex domain change happened.

**Path B (full): registration also supports per-credential RP_ID + array on verification.** More invasive — would need a new column to remember which RPID a given credential was minted under. YAGNI for the stated goal.

**Recommendation:** Path A.

### Integration Points (Path A — modify)

| File | Function | Change |
|---|---|---|
| `src/types/index.ts` | `AnonAuthConfig.rp.id` | Keep as `string`. Add adjacent optional `rp.allowedIds?: string[]` (verification-time accepted RP_IDs, defaults to `[rp.id]`) |
| `src/server/passkey.ts` | `PasskeyConfig` | Add `allowedRpIds?: string[]` |
| `src/server/passkey.ts:170` | `finishRegistration` | `expectedRPID: config.allowedRpIds ?? config.rpId` |
| `src/server/passkey.ts:277` | `finishAuthentication` | `expectedRPID: config.allowedRpIds ?? config.rpId` |
| `src/server/index.ts:132-137` | `createPasskeyManager` call | Pass `allowedRpIds: rpConfig.allowedIds` |
| `src/server/webauthn.ts` | `VerifyRegistrationInput.expectedRPID` | Widen type to `string \| string[]` |
| `src/server/webauthn.ts` | `VerifyAuthenticationInput.expectedRPID` | Widen type to `string \| string[]` |
| `src/server/webauthn.ts` | `verifyRegistrationResponse` / `verifyAuthenticationResponse` calls | Pass through unchanged (already supports both) |
| `src/server/webauthn.ts` | `CreateRegistrationOptionsInput.rpId` | Keep as `string` |
| `src/server/webauthn.ts` | `CreateAuthenticationOptionsInput.rpId` | Keep as `string` |

### Critical Pitfall (cross-reference Pitfalls research R3)

Naively widening to two parallel arrays for `expectedOrigin` and `expectedRPID` is an **origin-spoofing vector** — if origins and RP_IDs are not paired, a consumer accepting `origin=app.evil.com` for `rpId=example.com` will incorrectly verify. Pair-tuple pattern: `relatedOrigins: Array<{ origin: string; rpId: string }>` with startup validation.

### Backwards Compat

- `expectedRPID: string | string[]` — `string` still accepted, no caller changes.
- `rp.id: string` unchanged; `rp.allowedIds` is new optional.
- Default behavior: if `allowedIds` not provided, behaves exactly as v0.6.1.

### Build Order Within Feature

1. Verify simplewebauthn v13 (current pin) accepts array on verify (Stack research confirmed).
2. Widen types in `webauthn.ts` (standalone path).
3. Add `allowedRpIds` config to `PasskeyConfig` + thread to verify calls.
4. Add `rp.allowedIds` to `AnonAuthConfig`, wire through `createAnonAuth`.
5. Tests: single-string still works; array with current RPID at index N still verifies; array without matching RPID rejects; spoofed origin rejected (R3 from Pitfalls).

### Tsup / Externalization

No new deps. No bundle change.

---

## Feature 5 — Registration Analytics Hook (Anonymity-Preserving)

### Constraint Reminder

The anonymity invariant from PROJECT.md is non-negotiable: **the analytics hook MUST NOT receive or be able to derive PII for anonymous-track users.** It can receive: timestamps, event types, RP_ID, success/failure. It MUST NOT include `userId`, raw `codename`, `nearAccountId`, raw `email`, full IP, or full UA.

### Recommended Architecture

**Single injectable analytics object via DI** (NOT EventEmitter — EventEmitter leaks listener errors silently and has no Promise contract). Pattern matches existing `logger`/`emailService` injection.

```ts
export interface AnalyticsHook {
  emit(event: AnalyticsEvent): void | Promise<void>;
}
export type AnalyticsEvent =
  | { type: 'register.start'; rpId: string; timestamp: Date }
  | { type: 'register.finish.success'; rpId: string; timestamp: Date; backupEligible: boolean }
  | { type: 'register.finish.failure'; rpId: string; timestamp: Date; reason: string }
  | { type: 'login.start'; rpId: string; timestamp: Date; codenameProvided: boolean }
  | { type: 'login.finish.success'; rpId: string; timestamp: Date; backupEligible: boolean }
  | { type: 'login.finish.failure'; rpId: string; timestamp: Date; reason: string }
  | { type: 'recovery.wallet.link.success'; timestamp: Date }
  | { type: 'recovery.wallet.recover.success'; timestamp: Date }
  | { type: 'recovery.ipfs.setup.success'; timestamp: Date }
  | { type: 'recovery.ipfs.recover.success'; timestamp: Date }
  | { type: 'oauth.callback.success'; provider: string; timestamp: Date }
  | { type: 'account.delete'; timestamp: Date };
```

**Critical anonymity gates (cross-reference Pitfalls R2):**
- NO `userId`, NO `codename`, NO `nearAccountId`, NO `email` in any event payload.
- `req.ip` and `req.headers['user-agent']` MUST NOT be added.
- Failure `reason` is a static enum, never an `Error.message` (which can echo input).
- Type-level enforcement via tsc-fail fixture (mirroring v0.6.1 MPC-07 pattern).

### Execution Mode

**Fire-and-forget by default.** Wrapped in:
```ts
Promise.resolve(analytics?.emit(event)).catch(err => log.warn({ err }, 'analytics hook failed'));
```
Reason: analytics latency or failure must not block auth. Document explicitly that hooks should be fast and non-throwing; library will swallow errors with a warn-level log.

Optional `awaitAnalytics: boolean` config flag for consumers who need synchronous guarantees (default: false).

### Integration Points (modify)

| File | Function | Change |
|---|---|---|
| `src/server/index.ts` | `createAnonAuth` | Accept `config.analytics?: AnalyticsHook` and pass to both routers |
| `src/server/router.ts` | `RouterConfig` | Add `analytics?: AnalyticsHook` |
| `src/server/router.ts` | All endpoints | Insert event emit at entry (start) and exit (success/failure) |
| `src/server/oauth/router.ts` | `OAuthRouterConfig` | Add `analytics?: AnalyticsHook` |
| `src/server/oauth/router.ts` | OAuth callback, link endpoints | Insert emits |
| `src/types/index.ts` | `AnonAuthConfig` | Add `analytics?: AnalyticsHook`, `awaitAnalytics?: boolean` |

### New Components (add)

- **`src/server/analytics.ts`** — new module:
  - Defines `AnalyticsHook`, `AnalyticsEvent` discriminated union.
  - Exports `wrapAnalytics(hook?, opts)` — returns a safe `emit(event)` that handles fire-and-forget + error suppression + opt-in await.
  - Single source for the event-shape type, used by both routers.

### Data Flow Changes

- No request/response shape changes.
- New side-effect: events emitted during request lifecycle.
- The shared `wrapAnalytics()` helper is the integration point; routers don't deal with try/catch directly.

### Build Order Within Feature

1. Build `src/server/analytics.ts` with type + safe emitter.
2. Thread `analytics` config through `createAnonAuth` → both routers.
3. Instrument passkey router endpoints (high-touch).
4. Instrument OAuth router endpoints.
5. Instrument recovery + account-deletion endpoints.
6. Tests: emit fires on each path; emit failure does not break request; PII assertion test (snapshot of all event shapes — no userId/codename/email keys); tsc-fail fixture for type-level enforcement.

### Tsup / Externalization

No new deps. No bundle change.

---

## Cross-Feature Build Order (Roadmap Recommendation)

Dependency analysis between features:
- Feature 1 (backup-eligibility) is foundational — its derived types feed into Feature 5's analytics events (`backupEligible` field on success events).
- Feature 5 (analytics) needs Feature 1's `BackupEligibility` shape if events reference it.
- Features 2 (2FA hook), 3 (backfill hook), 4 (multi-RPID) are independent.

**Recommended phase order (architecture-perspective):**

| Phase | Feature | Rationale |
|---|---|---|
| **Phase 1** | **Backup-Eligibility (F1)** | Smallest blast radius; pure additive response field; produces the `BackupEligibility` type that F5 references. Validates the additive-response pattern that all subsequent phases reuse. |
| **Phase 2** | **Multi-RP_ID (F4)** | Independent of others. Stack research confirms simplewebauthn v13 array support — no research split needed. |
| **Phase 3** | **Lazy-Backfill Hook (F3)** | Established hook pattern (config-driven optional callback in router). Lighter than 2FA — no transaction interaction. Builds the hook-injection muscle memory before F2's more invasive transaction-boundary work. |
| **Phase 4** | **2nd-Factor Enrolment Hook (F2)** | Most invasive (sits inside transaction, blocks session creation, has MPC-funding-orphan edge case). Do this AFTER Phase 3 to reuse the hook-injection pattern and AFTER Phase 1 so hook ctx can include `backupEligible`. |
| **Phase 5** | **Analytics Hook (F5)** | Last. Touches the most files (every endpoint). References `BackupEligibility` from Phase 1. Sweeps OAuth router too. Doing it last avoids re-instrumenting endpoints modified by phases 1–4. |

(Note: Pitfalls and Features researchers proposed slightly different orders. Roadmapper to reconcile at requirements time.)

### Cross-Cutting Risks

1. **Test surface explosion** — every phase adds endpoint-response variants. Phase 5 (analytics) needs assertion that prior phases' new fields don't leak through events. Allocate test-writing time per phase, not just impl.
2. **Type widening churn** — `RegistrationFinishResponse` / `AuthenticationFinishResponse` get new optional keys in Phase 1, possibly Phase 4 (`secondFactor`) and Phase 3 (`backfill`). Consider a single union of optional add-ons in Phase 1's design to avoid each later phase touching `src/types/index.ts` independently.
3. **Tsup externalization** — none of the 5 features add a new runtime dependency. No `tsup.config.ts` change required.
4. **Frozen MPCAccountManager contract** — none of these features touch `mpc.ts`, `MPCAccountManagerConfig`, or `CreateAccountResult`. Verified: features 1–5 all live above the MPC layer.
5. **Standalone webauthn entry exposure** — only Features 1 (backupEligibility helper) and 4 (multi-RPID verify) touch `src/server/webauthn.ts`. Features 2, 3, 5 are router-only. Document this in the README "What's in standalone vs router" matrix.

### Files Touched Summary (all 5 features)

| File | F1 | F2 | F3 | F4 | F5 |
|---|---|---|---|---|---|
| `src/types/index.ts` | mod | mod | mod | mod | mod |
| `src/server/index.ts` | — | mod | mod | — | mod |
| `src/server/router.ts` | mod | mod | mod | — | mod |
| `src/server/passkey.ts` | — | — | — | mod | — |
| `src/server/webauthn.ts` | mod | — | — | mod | — |
| `src/server/oauth/router.ts` | — | — | — | — | mod |
| `src/server/backup.ts` (new) | NEW | — | — | — | — |
| `src/server/analytics.ts` (new) | — | — | — | — | NEW |
| `src/client/api.ts` | mod | (opt) | (opt) | — | — |
| `src/client/hooks/useAnonAuth.tsx` | mod | (opt) | (opt) | — | — |
| `src/server/db/adapters/postgres.ts` | — | — | — | — | — |
| `src/server/validation/schemas.ts` | — | — | — | — | — |

No DB schema migration required (under the pass-through framing of F3; library-managed framing would add a `key_bundle` column — see Pitfalls 3-A).
No validation schema changes (request bodies don't change).

---

## Files Read for This Analysis

- `.planning/PROJECT.md`
- `.planning/codebase/ARCHITECTURE.md`
- `src/server/index.ts`
- `src/server/router.ts`
- `src/server/passkey.ts`
- `src/server/webauthn.ts`
- `src/server/validation/schemas.ts`
- `src/server/db/adapters/postgres.ts`
- `src/server/oauth/router.ts` (route shape only)
- `src/types/index.ts`
- `src/client/index.ts`
- `src/client/api.ts`
- `src/client/passkey.ts`
- `src/client/hooks/useAnonAuth.tsx`
- `src/webauthn/index.ts`
- `package.json`
