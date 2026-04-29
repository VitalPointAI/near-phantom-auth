# Feature Research — v0.7.0 Consumer Hooks & Recovery Hardening

**Domain:** Privacy-first passkey auth library (npm package `@vitalpoint/near-phantom-auth`)
**Milestone:** v0.7.0 — additive minor bump on top of shipped v0.6.1
**Researched:** 2026-04-29
**Confidence:** HIGH (existing surface inspected directly; W3C spec / browser support / Better-Auth / SimpleWebAuthn / Authsignal / NIST conventions cross-referenced)

---

## Context: What v0.7.0 Is Solving

v0.6.1 shipped `MPCAccountManager` to unblock a downstream consumer in a production restart loop. v0.7.0 turns five known consumer-facing gaps into a coherent surface:

1. **Backup-eligibility flag exposure** — consumers want to render "Set up cloud backup" prompts and recovery-method selection based on whether the user's passkey is multi-device / synced.
2. **Second-factor enrolment hook** — consumers want to layer their own 2FA (TOTP, OTP, additional passkey, hardware key) after the primary passkey ceremony without forking the library.
3. **Lazy-backfill hook** — pre-v0.6.0 users have NULL `sealingKeyHex` / wrapped DEK material; consumers need a way to backfill at next login without a forced flag-day migration.
4. **Multi-RP_ID verification** — consumers operating on related domains (e.g. `app.example.com` + `example.io` + `example.app`) want one passkey to work across all of them via WebAuthn Related Origin Requests (ROR).
5. **Registration analytics hook** — consumers want product metrics (registration funnel, success/failure ratios, browser PRF support rates) without leaking PII and without breaking the anonymity invariant.

Every item is **additive** — the `MPCAccountManager` and `/register/finish` / `/login/finish` response shapes are FROZEN by consumer pin (per `PROJECT.md > Key Decisions`). New fields may be added; existing fields cannot be renamed, retyped, or removed.

The current frozen response shapes (from `src/server/router.ts`):
- `POST /register/finish` → `{ success: boolean, codename: string, nearAccountId: string }`
- `POST /login/finish` → `{ success: boolean, codename: string }`
- `GET /session` → `{ authenticated: boolean, codename, nearAccountId, expiresAt }`

---

## Per-Feature Research

Each feature is researched against industry conventions, then classified into Table Stakes (must-have to call the feature done) / Differentiators (nice-to-have, ship-if-cheap) / Anti-features (DO NOT include — explicit out-of-scope).

---

### 1. Backup-Eligibility Flag Exposure

**Industry convention.** The W3C WebAuthn Level 3 spec defines two distinct flags carried in `authenticatorData`:

- **BE (Backup Eligibility)** — a *permanent property of the credential*, set at creation. `BE=1` means the credential is allowed to be backed up / synced (e.g. iCloud Keychain, Google Password Manager). `BE=0` means device-bound (hardware key, single-device platform credential).
- **BS (Backed Up / Backup State)** — *current state*, can change over time. `BS=1` means the credential is presently replicated to at least one other device or cloud store; `BS=0` means it is currently only on this authenticator.

`BE=1, BS=0` is valid (eligible but not yet synced — the user hasn't enabled iCloud Keychain). `BE=0, BS=1` is *invalid* and SimpleWebAuthn throws on this combination at verification time. `BE=0, BS=0` is a single-device credential. `BE=1, BS=1` is a fully synced credential. (Sources: [W3C Issue #1933](https://github.com/w3c/webauthn/issues/1933), [SimpleWebAuthn Passkeys docs](https://simplewebauthn.dev/docs/advanced/passkeys), [W3C Issue #1692](https://github.com/w3c/webauthn/issues/1692).)

**What consumers do with these flags.** From W3C and Yubico discussion + Corbado UX guides:
- `BE=0` (device-bound) → prompt user to enrol a *second* credential or set up account recovery, because losing the device is fatal.
- `BE=1, BS=0` (eligible but not synced) → prompt "Enable iCloud Keychain / Google Password Manager to back up your passkey".
- `BE=1, BS=1` (fully synced) → no recovery prompt necessary; user has cloud-side redundancy.
- Some RPs use `BE=1, BS=1` as the gate for "you may now remove your password" or "you may skip 2FA".

**Existing state in this library.** `passkeyData.backedUp` is **already stored in the DB** (`src/types/index.ts:386`, `src/types/index.ts:398`, and `router.ts:219`). The `Passkey` and `CreatePasskeyInput` types include `backedUp: boolean` and `deviceType: 'singleDevice' | 'multiDevice'`. `deviceType === 'multiDevice'` is functionally equivalent to `backupEligible === true` — SimpleWebAuthn maps the BE flag onto this field. **The flags are persisted but never returned to the consumer.** That is the gap.

**Naming convention to choose.** Two camps:
- **Yubico java-webauthn-server / W3C wire spec** uses `backupEligible` + `backedUp` (BE/BS literal naming).
- **SimpleWebAuthn** uses `credentialDeviceType` (`'singleDevice' | 'multiDevice'`) + `credentialBackedUp` (boolean).

This library already imports SimpleWebAuthn (`src/types/index.ts` uses `deviceType` / `backedUp`). **Recommendation: stay aligned with SimpleWebAuthn naming on the wire — `deviceType` and `backedUp`** — because (a) consumers reading the codebase already see those fields, (b) the DB schema already uses them, (c) renaming would create two parallel vocabularies for the same flag.

**Should we expose one flag or both?** Both. They mean different things:
- `deviceType: 'multiDevice'` (BE=1) → "this credential *can* be backed up" → drives "enable backup" prompts.
- `backedUp: true` (BS=1) → "this credential *is currently* backed up" → drives "you may skip secondary recovery" decisions.

A consumer that exposes only one flag cannot distinguish "user has not enabled iCloud Keychain yet" from "user is on a hardware key and physically cannot back up". This distinction is the whole point of the BE/BS split. Don't collapse it.

**Where to surface them.** Three response sites:
- `POST /register/finish` — at first ceremony, tell the consumer what they're working with.
- `POST /login/finish` — at every login, BS may have flipped (user just enabled iCloud Keychain).
- `GET /session` — for already-authenticated UIs that want to show a "set up backup" banner.

All three are additive: append `deviceType` and `backedUp` to the existing JSON. Consumer code that doesn't read the new fields is unaffected.

| Category | Item |
|---|---|
| **Table Stakes** | Add `deviceType: 'singleDevice' \| 'multiDevice'` and `backedUp: boolean` to `/register/finish` JSON response |
| **Table Stakes** | Add the same two fields to `/login/finish` JSON response |
| **Table Stakes** | Update BS state on every login (re-read from `authenticatorData.flags`, persist via `updatePasskeyCounter` companion or new `updatePasskeyBackupState`) — BS can flip from 0→1 over the credential lifetime |
| **Table Stakes** | TypeScript public-type updates: `AuthenticationFinishResponse` and `RegistrationFinishResponse` gain optional `deviceType` + `backedUp` fields (optional in the type so old consumers keep compiling, but always populated at runtime) |
| **Differentiator** | Add the same fields to `GET /session` response so post-login UIs can render backup prompts without re-querying |
| **Differentiator** | Provide a typed enum/constant for `deviceType` values exported from `/server` and `/client` — consumers can `import { CredentialDeviceType }` instead of stringly-typing |
| **Differentiator** | Document recommended consumer reactions: `'singleDevice'` → recovery enrolment prompt; `'multiDevice' && !backedUp` → cloud-backup prompt; `'multiDevice' && backedUp` → no prompt. Lives in README, not code. |
| **Anti-feature** | Returning the raw BE/BS bits from authenticator data — consumers should not have to parse flags themselves; surface decoded booleans/enums |
| **Anti-feature** | Auto-rejecting `deviceType === 'singleDevice'` registrations (some consumers WANT hardware-key-only flows for high-security users) — leave the policy decision to the consumer |
| **Anti-feature** | Computing a derived `needsBackup: boolean` server-side — different consumers have different policies (hardware-key only? backup mandatory? mandatory after 30 days?). Surface raw flags; let consumer decide. |
| **Anti-feature** | Renaming `backedUp` to `backupState` to be "more accurate" — frozen contract; the existing `Passkey.backedUp` field has been wire-stable since v0.5 |

**Complexity:** **LOW**. ~50 LOC: thread two existing booleans from `passkeyData` / `authenticationInfo` through the response JSON, plumb a `updatePasskeyBackupState` adapter method (optional, default no-op), update three TypeScript response types, write 4–6 vitest cases (single-device register, multi-device register, login flips BS=0→1, login flips BS=1→0). **1-day phase.**

---

### 2. Second-Factor Enrolment Hook

**Industry convention.** Step-up auth has three established library patterns:

| Pattern | Examples | Shape |
|---|---|---|
| **OAuth 2.0 Step-Up Challenge (RFC 9470)** | Auth0, Keycloak, Okta | Server returns `WWW-Authenticate: Bearer error="insufficient_user_authentication"` with required `acr_values`; client re-runs auth with elevated scope. |
| **Promise-based callback** | Authsignal SDK, Stytch | Primary auth resolves with a token + `step_up_required: true`; client awaits a second `await client.passkey.signUp({ token })` before it gets a session. |
| **Lifecycle hooks** | Better Auth (`before` / `after` middleware on `/register` and `/sign-in`) | Library exposes named hooks; consumer registers async functions that run pre-/post-endpoint with a typed `ctx`. Better Auth's `after` hook receives `ctx.context.newSession`. |

(Sources: [RFC 9470 / Auth0 step-up](https://auth0.com/docs/secure/multi-factor-authentication/step-up-authentication), [Authsignal passkey step-up](https://www.authsignal.com/blog/articles/how-to-add-passkey-step-up-auth-in-your-app), [Better Auth Hooks](https://better-auth.com/docs/concepts/hooks).)

**Which pattern fits this library.** The Better Auth `after` hook pattern is the closest match. The library is Express-based and already exposes `createAnonAuth(config)` → `{ router, middleware }`. Consumers don't run an OAuth authorization server, so RFC 9470 is overkill. Promise-based callbacks (Authsignal) imply a *client-side* flow, but the consumer-defined 2FA logic typically wants to run *server-side* (issue OTPs, persist 2FA secrets, gate session creation).

**Recommendation:** Add an optional `hooks.afterPasskeyVerify(ctx)` async callback to `AnonAuthConfig`. It runs *after* passkey verification succeeds but *before* session creation. The hook receives a typed context (user, request, response, ceremony type: `'register' | 'login'`, deviceType, backedUp). The hook can:
- Return `{ continue: true }` → library proceeds to create the session and respond normally.
- Return `{ continue: false, status: 202, body: {...} }` → library returns the consumer's body without creating a session. Consumer's frontend then drives the user through 2FA enrolment / verification, then calls a consumer-owned endpoint that uses the library's `sessionManager.createSession()` directly.
- `throw` → library returns a generic 500 (or an error the consumer constructs); session is NOT created. Failed 2FA leaves the user unauthenticated.

**State semantics.** Critical decision: should the user be **"pending 2FA"** (no session, must complete enrolment) or **"enrolled-no-2FA"** (session created, 2FA optional)?

- **Pending-2FA** (no session until 2FA done) is the safer default. Failure to complete 2FA = no session = no exposure if the user walks away. This matches Authsignal's pattern.
- **Enrolled-no-2FA** (session immediately, 2FA layered on later) matches Better Auth's `after` hook, which has `newSession` already on the context.

These are different products. **Recommendation: support both via the return shape**:
- If the hook returns `{ continue: true }` (default if not provided): session is created, library responds normally. Consumer's 2FA enrolment is post-hoc / opportunistic.
- If the hook returns `{ continue: false, ... }`: library does NOT create a session. Consumer is responsible for the rest of the flow (and for eventually calling `sessionManager.createSession()` once 2FA passes).

This preserves the v0.6.1 default behaviour (session created on success) when no hook is configured — zero change for existing consumers.

**Failure handling.** If the hook throws:
1. Session is NOT created (hook runs *before* `sessionManager.createSession()`).
2. The thrown error is logged via the configured pino logger (existing convention).
3. The library returns 500 with a generic error message — the same shape consumers already expect from `try { ... } catch (error) { res.status(500).json({ error: 'Registration failed' }) }`.

This means a buggy 2FA hook fails *closed* (no session, user must retry) — the right default for a security library. If the consumer wants to fail open, they catch inside their hook and return `{ continue: true }`.

| Category | Item |
|---|---|
| **Table Stakes** | New optional `hooks.afterPasskeyVerify` async callback in `AnonAuthConfig` |
| **Table Stakes** | Hook receives typed context: `{ ceremony: 'register' \| 'login', user: AnonUser, deviceType, backedUp, req, res }` (req/res for cookie/CSRF access) |
| **Table Stakes** | Hook can return `{ continue: true }` (proceed) or `{ continue: false, status, body }` (short-circuit) |
| **Table Stakes** | Hook throws → no session created, 500 response, error logged with redaction |
| **Table Stakes** | When hook is omitted / undefined, behaviour is byte-identical to v0.6.1 (frozen-contract requirement) |
| **Table Stakes** | Library exposes `sessionManager.createSession(userId, res, opts)` as a public-typed method so consumers running a custom 2FA tail can issue the session themselves (already exposed on `AnonAuthInstance`; just needs to be type-stable for v0.7.0) |
| **Differentiator** | A symmetric `hooks.beforePasskeyVerify` for pre-checks (e.g. is this codename on a deny list?) — consumers can already do this with Express middleware, so this is duplicative; defer unless cheap |
| **Differentiator** | Pre-built `passkey-as-2nd-factor` recipe in README: how to register *another* passkey credential via this library after primary (TOTP / OAuth / wallet) auth completes — documentation, not code |
| **Anti-feature** | Building a TOTP / OTP / SMS implementation into the library — consumer is responsible for the actual second factor; the library only provides the hook |
| **Anti-feature** | Persisting "2FA pending" state in the library's DB schema — that's consumer-owned state and would force a schema migration on every consumer |
| **Anti-feature** | Defining a `User.is2FAEnrolled` field on `AnonUser` — consumer policy varies (some require 2FA for some user roles only); `AnonUser` shape is frozen |
| **Anti-feature** | Synchronous hook — must be async; some 2FA enrolment operations are HTTP calls to external providers (Authsignal, Twilio Verify, etc.) |
| **Anti-feature** | EventEmitter-based hook (`auth.on('register:done', ...)`) — it would suggest fire-and-forget, but 2FA enrolment must *block* session creation; emitter semantics are wrong here. (EventEmitter is a fine fit for the analytics hook; see Item 5.) |

**Complexity:** **MEDIUM**. ~150–250 LOC: define `HooksConfig` type, plumb hook invocation into `/register/finish` and `/login/finish` (and the OAuth router's success path — must decide if OAuth login fires the same hook), define short-circuit semantics, error path, vitest cases for: hook absent (default), hook returns `continue:true`, hook returns `continue:false`, hook throws, hook is async-slow (does the request time out?). **2-day phase.** Touches `router.ts`, `index.ts`, types, and OAuth router — wider surface than items 1, 3, 5.

---

### 3. Lazy-Backfill Hook

**Industry convention.** "Lazy migration" / "trickle migration" is the canonical pattern for migrating user records on the user's next successful login rather than in a flag-day batch job. Auth0 calls this "automatic migration"; SuperTokens, Authing, and the open-source `auth0-account-migration` repo all implement it the same way:

1. User attempts login.
2. New auth system checks: does this user exist in *new* schema with all required fields?
3. If yes → authenticate normally.
4. If no → check the legacy data source / detect missing fields. Fetch / compute the missing data. Persist it. Then continue authentication.

The user sees no difference; ops gets gradual migration without downtime. (Sources: [Auth0 automatic migration](https://auth0.com/docs/manage-users/user-migration/configure-automatic-migration-from-your-database), [SuperTokens lazy migration](https://supertokens.com/blog/migrating-users-without-downtime-in-your-service), [auth0-account-migration](https://github.com/abbaspour/auth0-account-migration).)

**This library's specific need.** Pre-v0.6.0 accounts have NULL key bundles — they were created before the WebAuthn PRF extension was wired in (v0.6.0, Phase 9). At next login on v0.7.0+, if the consumer wants those accounts to gain a sealing key + wrapped DEK, *something* has to:
1. Detect the NULL state on the user record.
2. Re-derive (or freshly generate) the missing material.
3. Persist it.
4. Continue the login.

The PRF extension can derive a sealing key from the existing passkey at any login (the credential supports PRF if the authenticator does). What's missing is the wrapped DEK / IPFS recovery blob, which depends on user-supplied entropy (a recovery password). That's the rub: **the backfill cannot be silent for the IPFS-recovery branch** — it needs the user to supply the recovery password (or accept a regenerated one delivered out-of-band, e.g. SES email for OAuth users).

This forces an explicit design choice: **transparent vs. flag-driven**.

| Approach | UX | Complexity | When appropriate |
|---|---|---|---|
| **Transparent** — consumer provides a `hooks.backfillKeyBundle(user, ctx)` async callback; library calls it during `/login/finish` if the user record has a NULL bundle, awaits it, then proceeds | User sees no extra screens; some logins take +200ms while backfill runs | Medium — library has to decide what "NULL bundle" means and pass that to the hook | Sealing-key-only backfill (no user input needed) |
| **Flag-driven** — library returns `needsBackfill: true` in `/login/finish` response; consumer's frontend renders a "set up recovery" screen; consumer calls `POST /account/backfill` to complete | Consumer sees the explicit flag and can route the user; one extra HTTP round-trip | Lower — library only needs the flag and the explicit endpoint | IPFS recovery blob backfill (needs user-supplied password) |

**Recommendation: support both.** They cover different sub-cases:

- **Transparent path** for sealing-key-only backfill: if the consumer configures `hooks.backfillKeyBundle`, the library calls it inside `/login/finish` between PRF derivation and session creation. The hook signature is `(ctx: { user, sealingKeyHex, transaction }) => Promise<{ keyBundle: SerializedKeyBundle }>`. Consumer returns the new bundle; library persists it via the provided transaction handle. Hook errors abort the login (fail closed) **unless** consumer sets `backfillFailureMode: 'continue-without-bundle'`.
- **Flag-driven path** for everything else: the `/login/finish` response gains an optional `needsBackfill: 'recovery-blob' | 'sealing-key' | null` field. Consumer reads it and drives the next screen. A new `POST /account/backfill` endpoint accepts the consumer-supplied material (e.g. recovery password for IPFS) and writes the blob.

These compose: the transparent hook handles the sealing key (no user input), the flag tells the consumer "you still need to collect a recovery password before this account is fully recoverable".

**Mismatch case (consumer's question 3).** If the user has a *new* key bundle but an *old* IPFS recovery blob (the blob was encrypted under the old password-derived key, not the new PRF-derived sealing key), the right behaviour is `needsBackfill: 'recovery-blob'`. The library detects the mismatch by checking that the IPFS blob's metadata indicates the old encryption scheme. The blob version field needs to be persisted at IPFS-setup time — this is a NEW requirement (see Table Stakes below).

| Category | Item |
|---|---|
| **Table Stakes** | New optional `hooks.backfillKeyBundle(ctx)` async callback in `AnonAuthConfig` for transparent sealing-key backfill |
| **Table Stakes** | New optional `needsBackfill: 'recovery-blob' \| 'sealing-key' \| null` field on `/login/finish` response |
| **Table Stakes** | Detection logic: library reads the user record + recovery records and decides which (if any) backfill is required |
| **Table Stakes** | New endpoint `POST /account/backfill` (authenticated) that accepts consumer-supplied material and persists the missing bundle / re-encrypts the IPFS blob |
| **Table Stakes** | Blob version metadata: when the IPFS recovery blob is created, store a `schemaVersion: 'v1' \| 'v2'` field inside the encrypted payload so the library can detect old-blob/new-bundle mismatch on login |
| **Table Stakes** | Default `backfillFailureMode: 'fail-closed'` — if the configured `backfillKeyBundle` hook throws, the login fails and the user is told to try again. Opt-in `'continue-without-bundle'` for consumers that prefer graceful degradation |
| **Differentiator** | Telemetry counters on the analytics hook (Item 5): `backfill.attempted`, `backfill.succeeded`, `backfill.failed` — lets consumers monitor the rollout |
| **Differentiator** | Idempotency on `POST /account/backfill` — calling it twice on an already-backfilled user is a no-op `200`, not an error |
| **Anti-feature** | Forced flag-day migration / database bulk update on library upgrade — explicitly rejected; lazy is the whole point |
| **Anti-feature** | Auto-prompting users for a recovery password inside the library (the consumer owns UI; the library cannot render anything) |
| **Anti-feature** | Storing a "needs backfill" flag on the user row in the library schema — the detection is computable from existing fields (`sealingKeyHex IS NULL`, `recovery.schemaVersion < current`); a denormalised flag drifts |
| **Anti-feature** | Mid-login user prompts (e.g. `WWW-Authenticate: PromptForPassword`) — out of scope; library returns the flag; consumer's UI handles prompting |
| **Anti-feature** | Backfilling on the **first** v0.7.0 deploy via a startup migration script — that's a flag-day disguised as automation; forces ops to reason about all old users at once. Lazy = at next login = bounded blast radius |

**Complexity:** **MEDIUM-HIGH**. ~300–500 LOC: detection logic across user / recovery / passkey records, new endpoint with validation, blob versioning (touches `recovery/ipfs.ts`), failure-mode config, hook plumbing, vitest cases for: NULL sealing key + transparent hook present, NULL sealing key + no hook (returns flag), old-version IPFS blob (returns flag), happy path (no backfill needed), hook throws + fail-closed, hook throws + continue-without-bundle, double-backfill idempotency. **3–5 day phase.** This is the most complex of the five items and likely warrants its own multi-plan phase.

---

### 4. Multi-RP_ID Verification (Related Origin Requests)

**Browser support as of April 2026.** From [web.dev/articles/webauthn-related-origin-requests](https://web.dev/articles/webauthn-related-origin-requests), [passkeys.dev advanced/related-origins](https://passkeys.dev/docs/advanced/related-origins/), [levischuck.com](https://levischuck.com/blog/2024-07-related-origins), and [Chrome 129 release notes](https://developer.chrome.com/blog/passkeys-updates-chrome-129):

| Browser | ROR support | Since |
|---|---|---|
| Chrome / Edge | YES | 128 (Sep 2024) |
| Safari (macOS 15+, iOS 18+) | YES | 18 (Sep 2024) |
| Firefox | NO (positive standards position March 2026; no shipping timeline) | — |

Detection: `PublicKeyCredential.getClientCapabilities()` returns a `relatedOrigins: true` capability when supported. Where unsupported, the credential ceremony fails with `NotAllowedError` if the origin doesn't match the rpID — the standard pre-ROR behaviour.

**Spec format.** The RP hosts `/.well-known/webauthn` as an `application/json` document on the rpID's domain:
```json
{ "origins": ["https://app.example.io", "https://example.app", "https://my-example.com"] }
```
The path is exactly `/.well-known/webauthn` (no `.json` extension). Origins matching the rpID itself are not listed. The browser fetches this file during the ceremony and validates that the requesting origin is in the list. Hard limit: **5 unique labels** (where "label" = the registrable-domain prefix, e.g. `example`, `myexampledelivery`, `myexamplecars`). Five is the spec floor that all current browsers honour as the ceiling.

**Server-side verification.** The interesting half. SimpleWebAuthn's `verifyRegistrationResponse` and `verifyAuthenticationResponse` accept either:
- `expectedOrigin: string` (single — current library behaviour, see `passkey.ts`)
- `expectedOrigin: string[]` (array — allows the server to accept assertions from any of the listed origins)

For ROR to actually work end-to-end, the server must accept assertions where `clientDataJSON.origin` is any of the *related* origins. So the library config must accept multiple origins.

**Consumer config shape — convention check.** Two options:
- **Flat array**: `rp: { id, name, origin: string | string[] }`
- **Primary + alternates**: `rp: { id, name, origin, relatedOrigins?: string[] }`

The "primary + alternates" shape is structurally more honest: there's exactly one rpID (the one in the `.well-known` file is the source of truth), exactly one *primary* origin (the one whose `.well-known` is fetched), and zero or more alternates. The flat array hides the asymmetry. Two passkeys.dev / Levi Schuck blog examples both prefer the explicit alternates field. (No strong industry consensus yet — both shapes appear in the wild; this is a judgement call.)

**Recommendation.** Add `rp.relatedOrigins?: string[]` (optional — default empty). When set, the library:
1. Passes `expectedOrigin: [origin, ...relatedOrigins]` to SimpleWebAuthn at verify time.
2. Continues to set the single `rp.id` field in the WebAuthn options (the credentials are scoped to the primary rpID).
3. Documents that the consumer is responsible for serving `/.well-known/webauthn` at the primary rpID's domain — the library does NOT host this file. (Anti-feature — see below.)

**Behaviour on browsers without ROR.** If a credential was registered against `app.example.com` (primary rpID) and the user visits `example.io` (related origin) on Firefox, the browser will fail the ceremony. The library cannot fix this; ROR is a browser-side feature. The library's responsibility is to:
- Accept ROR assertions when they DO arrive (expand `expectedOrigin` to the array).
- Document the Firefox gap so consumers know to feature-detect (`PublicKeyCredential.getClientCapabilities()`) and fall back to an "identifier-first" flow (user enters codename → server returns the correct primary rpID → frontend redirects to that domain for the ceremony).

| Category | Item |
|---|---|
| **Table Stakes** | New optional `rp.relatedOrigins?: string[]` config field |
| **Table Stakes** | Pass the joined origin list to SimpleWebAuthn `verifyRegistrationResponse` / `verifyAuthenticationResponse` as `expectedOrigin: string[]` |
| **Table Stakes** | Validate at config load: `relatedOrigins` is an array of valid HTTPS URLs, distinct from `rp.origin`, and the total count (origin + relatedOrigins) ≤ 5 — fail fast at `createAnonAuth(config)` |
| **Table Stakes** | README section explaining (a) the consumer must host `/.well-known/webauthn` at primary rpID, (b) the 5-label limit, (c) Firefox does not support ROR and the recommended fallback (identifier-first flow), (d) the JSON file format |
| **Differentiator** | Helper function exported from `/server`: `generateWellKnownWebauthn(config) => string` returning the JSON the consumer should host — saves them a copy-paste error |
| **Differentiator** | Express middleware `mountWellKnownWebauthn(app, config)` that serves `/.well-known/webauthn` at the right path with correct content-type — *opt-in* (consumers may want CDN-level hosting) |
| **Differentiator** | Client-side capability probe helper exported from `/client`: `async function detectRelatedOriginsSupport(): Promise<boolean>` wrapping `PublicKeyCredential.getClientCapabilities()` so consumer apps can render fallback UI |
| **Anti-feature** | Auto-hosting `.well-known/webauthn` as a default mount — not all consumers want the library answering on that path; some have it CDN-served; some have multiple Express apps. Make it opt-in. |
| **Anti-feature** | Per-credential origin restriction (e.g. "this credential is locked to app.example.com only") — that's the opposite of what ROR exists for; the whole feature is "this credential works across these origins" |
| **Anti-feature** | Auto-detecting related origins from the request `Host` header — the source of truth is the consumer's deliberate config, not whatever DNS resolves to the server |
| **Anti-feature** | Silent acceptance of any origin matching some regex (e.g. `*.example.com`) — origins must be enumerated explicitly per spec |
| **Anti-feature** | Server-side polyfill of ROR for Firefox — impossible (it's a browser-side ceremony validation step) |

**Complexity:** **LOW-MEDIUM**. ~80–150 LOC: config validation, origin-array plumbing through `passkey.ts` (two call sites: `finishRegistration`, `finishAuthentication`), README, vitest cases for: single-origin config (existing behaviour unchanged), 2-origin config (assertion from primary accepted, assertion from related accepted, assertion from unrelated rejected), 6-origin config (rejected at startup), invalid URL (rejected at startup). Optional helpers (`generateWellKnownWebauthn`, `mountWellKnownWebauthn`) add 50 LOC if included. **1–2 day phase.**

---

### 5. Registration Analytics Hook

**Industry convention.** From [Better Auth Hooks](https://better-auth.com/docs/concepts/hooks), [Privacy-Preserving Data Analytics](https://securityboulevard.com/2026/04/privacy-preserving-data-analytics-stop-collecting-what-you-do-not-need/), [hoop.dev anonymization tracking](https://hoop.dev/blog/data-anonymization-analytics-tracking-best-practices-for-privacy-and-integrity), and [arxiv.org salt-based hashing of system event logs](https://arxiv.org/html/2507.21904v1):

The canonical "no-PII analytics event" shape is a flat object:
- `event: string` — bounded enum like `'register.success'`, `'register.failure'`, `'login.success'`, `'login.failure'`, `'recovery.attempt'`, `'recovery.success'`, `'recovery.failure'`
- `timestamp: number` — milliseconds since epoch
- `latencyMs?: number` — operation duration (server-side, end of request - start of request)
- `success: boolean` — outcome
- `failureReason?: string` — bounded enum (`'challenge_expired' | 'verification_failed' | 'rate_limited' | 'database_error' | 'other'`); never contains free-text user input
- `capabilities?: { prfSupported?: boolean, deviceType?: 'singleDevice' | 'multiDevice', backedUp?: boolean }` — feature flags from the ceremony
- Aggregated request metadata: `userAgentFamily?: string` (not full UA — `'Chrome'`, `'Safari'`, etc., extracted via UA parser), `countryCode?: string` (not full IP — derived if consumer wires geo-IP)

What MUST be redacted (the anonymity invariant):
- `codename` — the *only* identifier this library has for anon users; leaking it to analytics breaks anonymity
- `nearAccountId` — can be reverse-mapped to a codename via DB join
- `userId` — same problem
- `email` (for OAuth users) — direct PII
- Full IP address — the consumer's logger is allowed to see this with redaction; analytics is not
- Full user-agent string — fingerprint surface
- Challenge / signature material — never goes off the server

**Hook shape — sync vs async, blocking vs fire-and-forget.** The Better Auth `after` hook is async and *runs in the request lifecycle*. That's the wrong choice for analytics: a slow analytics provider (e.g. a 2-second timeout to a hosted endpoint) blocks the user's login. Auth library convention for analytics specifically is **fire-and-forget**:
- Hook signature is `(event: AnalyticsEvent) => void | Promise<void>`.
- Library calls it via `setImmediate(() => hook(event).catch(swallowError))` or equivalent — caller never awaits.
- Hook errors are caught and logged at WARN level; they do NOT fail the request.
- Hook latency does NOT add to user-facing request latency.

This is what the question text correctly identifies as "fire-and-forget". Confirmed convention.

**Where the hook fires.** Several lifecycle moments:
- After `/register/finish` succeeds → `register.success`
- After `/register/finish` fails → `register.failure` (with bounded reason)
- After `/login/finish` succeeds → `login.success`
- After `/login/finish` fails → `login.failure`
- After `/recovery/wallet/finish` or `/recovery/ipfs/recover` → `recovery.success` / `recovery.failure`
- Optionally: after rate limiter rejects → `rate_limited` (helps consumers catch attack patterns)

The hook should NOT fire for `/register/start` or `/login/start` (those don't have a user-meaningful outcome yet) — wait until the ceremony resolves.

**Failure handling.** The hook is in user-supplied code; it can throw. The library:
1. Catches every hook invocation.
2. Logs the error via the configured pino logger at WARN level (not ERROR — analytics failure is non-critical).
3. Never lets the error propagate to the response.

A buggy or slow analytics hook never crashes a registration / login.

**EventEmitter vs callback?** EventEmitter (`auth.on('register:success', ...)`) is idiomatic Node and lets multiple listeners coexist (e.g. one for Mixpanel, one for Datadog). Single callback is simpler. **Recommendation: single async callback** for v0.7.0 (`hooks.onAuthEvent`) — one consumer, one place. EventEmitter can be a v0.8 enhancement if multiple-subscriber demand emerges. Keeps the surface minimal.

| Category | Item |
|---|---|
| **Table Stakes** | New optional `hooks.onAuthEvent(event)` async callback in `AnonAuthConfig` |
| **Table Stakes** | Bounded `event` enum: `'register.success' \| 'register.failure' \| 'login.success' \| 'login.failure' \| 'recovery.success' \| 'recovery.failure'` (start with these six; expand only with explicit demand) |
| **Table Stakes** | Bounded `failureReason` enum (no free-text); the library is the source of truth for what reasons exist |
| **Table Stakes** | Fire-and-forget invocation: library calls hook via `queueMicrotask` / `setImmediate`, NEVER awaits it during the request, NEVER lets it fail the response |
| **Table Stakes** | Hook errors are caught and logged at WARN with `err: error` and `event: event.event`; never propagate |
| **Table Stakes** | TypeScript: `AnalyticsEvent` type exported from `/server`; consumer can write `(event: AnalyticsEvent) => void` with full type-checking |
| **Table Stakes** | Anonymity invariant: explicit unit test that the event payload contains NONE of: `codename`, `nearAccountId`, `userId`, `email`, full IP, full UA, challenge, signature. Test fails any future code path that adds a forbidden field |
| **Table Stakes** | Documented payload schema in README with exhaustive field list and what consumers MAY join with the event (e.g. consumer-side userIDs are allowed because the consumer already has them — but the *library* never provides them) |
| **Differentiator** | Capability sub-object: `event.capabilities` carries `prfSupported`, `deviceType`, `backedUp` — directly answers "what % of our users have synced passkeys?" without needing to query the DB |
| **Differentiator** | Latency field: `event.latencyMs` — server-side ceremony duration; useful for dashboards |
| **Differentiator** | UA-family extraction: `event.userAgentFamily?` — `'Chrome'` / `'Safari'` / `'Firefox'` / `'Other'`; computed from `req.headers['user-agent']` via the existing structured logger's UA parsing (if any) or a tiny inline regex. Optional; default off because pulling in `ua-parser-js` is a dep weight some consumers will refuse |
| **Anti-feature** | Synchronous / blocking hook semantics — analytics latency must not add to request latency |
| **Anti-feature** | Hook receives `req` / `res` — too much surface; tempts consumers to write `req.headers['x-real-ip']` into the event and break anonymity |
| **Anti-feature** | Hook receives `user: AnonUser` directly — the entire object is forbidden PII (codename, nearAccountId). Pass *only* the bounded event payload |
| **Anti-feature** | Open-ended `metadata: Record<string, unknown>` field on the event — invites consumers to dump PII; bounded shape only |
| **Anti-feature** | Built-in transports (Mixpanel adapter, Datadog adapter) — consumer brings their own analytics SDK; the library ships a hook, not an adapter |
| **Anti-feature** | Logging the event via the library's pino logger by default — that creates a duplicate stream of events; consumer's analytics is consumer-owned |
| **Anti-feature** | Sampling / rate-limiting analytics events server-side — consumer's analytics provider does this if needed |
| **Anti-feature** | EventEmitter with arbitrary event names (`auth.emit('whatever', {})`) — keep the event vocabulary closed |

**Complexity:** **LOW**. ~100–150 LOC: define `AnalyticsEvent` discriminated union type, plumb 6 fire-and-forget call sites (`/register/finish` success/failure, `/login/finish` success/failure, `/recovery/*/finish` success/failure), error-swallowing wrapper, vitest cases for: hook absent (no-op), hook present + happy path, hook throws (request still succeeds, error logged), forbidden-field test (the anonymity invariant guard). **1–2 day phase.**

---

## Feature Dependencies

```
[1] Backup-eligibility flags
        │
        ├──enables──> [5] Analytics hook capability sub-object
        │                  (analytics events MAY include deviceType + backedUp;
        │                  not strict dep — analytics works without it but is less useful)
        │
        ├──informs──> [3] Lazy-backfill detection
        │                  (single-device passkey reaching backfill is a
        │                  high-priority recovery prompt)
        │
        └──informs──> [2] 2FA hook context
                           (hook receives deviceType so consumer can require
                           2FA only for backed-up credentials, etc.)

[4] Multi-RP_ID  ──independent──>  (no dependency on any other v0.7.0 item)

[2] 2FA hook  ──── independent ────  (uses [1]'s data if present, but works alone)

[3] Lazy-backfill ─── independent ──  (uses [5]'s analytics if present, but works alone)

[5] Analytics hook ─── enriched-by ──> [1] (gets capability fields)
                ─── enriched-by ──> [3] (gets backfill counters)
                ─── enriched-by ──> [2] (gets a 2fa.required event)
```

### Dependency Notes

- **Strict ordering: [1] before [2] / [3] / [5]** — if all four ship in the same milestone, exposing flags first means the other three can consume them as plain hook context fields, not future TODOs. If [1] slipped, [2]/[3]/[5] still ship but with reduced richness (no `deviceType` in 2FA hook context, no `capabilities` in analytics events).
- **[4] is fully orthogonal** — Multi-RP_ID touches `passkey.ts` config validation and SimpleWebAuthn calls; nothing else. Can ship in any phase position.
- **[2], [3], [5] are mutually independent** but **structurally similar** (all three add `hooks.X` to `AnonAuthConfig`). Sharing the `hooks: HooksConfig` type definition across all three is the point of leverage — define `HooksConfig { afterPasskeyVerify?, backfillKeyBundle?, onAuthEvent? }` in one place; each phase populates one field. This argues for a small "hooks-scaffolding" sub-task that lands first, followed by the three hook implementations.
- **No conflicts** — none of the five features mutually exclude. They are additive, layer cleanly, and share types but not state.

### Consumer's question 5 explicitly asked: does the analytics hook depend on backup-eligibility being exposed first?

**Answer:** Soft dependency, not strict. The analytics hook can ship without [1] — events without `capabilities` are still useful for funnel metrics (success/failure ratios). But the marginal value of [1]→[5] is high: "what % of our users have synced passkeys?" is the question every consumer will ask first, and answering it requires capabilities in the event. **Recommended phase order: [1] before [5]**, but they can ship in different phases or the same phase without issue.

---

## v0.7.0 Scope Definition

### Launch With (v0.7.0 — table stakes only)

The minimum surface that justifies the minor bump:

- [x] **[1] Backup-eligibility flags** on `/register/finish`, `/login/finish`, `/session` — all five table-stakes items
- [x] **[2] Second-factor enrolment hook** — `hooks.afterPasskeyVerify` callback with continue/short-circuit semantics
- [x] **[3] Lazy-backfill** — both transparent hook AND `needsBackfill` flag + `POST /account/backfill`
- [x] **[4] Multi-RP_ID** — `rp.relatedOrigins` config + array-origin verification + 5-origin cap + README
- [x] **[5] Analytics hook** — `hooks.onAuthEvent` fire-and-forget callback with bounded event/reason enums and the anonymity-invariant unit test

### Add If Cheap (v0.7.0 — differentiators that fit)

Worth picking up if the corresponding phase has slack; cut without remorse if it doesn't:

- [ ] [4] `generateWellKnownWebauthn(config)` helper export
- [ ] [4] `mountWellKnownWebauthn(app, config)` opt-in middleware
- [ ] [4] Client-side `detectRelatedOriginsSupport()` capability probe helper
- [ ] [5] `event.capabilities` sub-object (depends on [1])
- [ ] [5] `event.latencyMs`
- [ ] [5] `event.userAgentFamily` (only if no new dep)
- [ ] [3] Idempotency on `POST /account/backfill`
- [ ] [3] Backfill telemetry counters threaded through [5]
- [ ] [1] `CredentialDeviceType` enum export from `/server` and `/client`
- [ ] [1] `deviceType` + `backedUp` on `GET /session` (in addition to register/login)

### Defer to v0.8+ (out of v0.7.0 scope)

- [ ] [2] `hooks.beforePasskeyVerify` (consumers can use Express middleware today)
- [ ] [5] EventEmitter-style multi-subscriber analytics (`auth.on('register:success', ...)`)
- [ ] [5] UA-family extraction *with* a UA-parser dep
- [ ] Pre-flight PRF / ROR capability probe via `getClientCapabilities()` (browser-side helper; depends on broader API availability — same browser-availability problem as v0.6.0 PRF probe)

---

## Feature Prioritisation Matrix

| Feature | Consumer Value | Implementation Cost | Risk | Priority |
|---|---|---|---|---|
| [1] Backup-eligibility flags | HIGH (drives every consumer's recovery UX) | LOW (~50 LOC, 1-day phase) | LOW | **P1** |
| [2] 2FA enrolment hook | HIGH (unblocks consumer-side step-up) | MEDIUM (~150–250 LOC, 2-day phase) | MEDIUM (touches OAuth router too) | **P1** |
| [3] Lazy-backfill hook | HIGH (without it pre-v0.6 users are stuck) | MEDIUM-HIGH (~300–500 LOC, 3–5 day phase) | MEDIUM (blob versioning is new persisted state) | **P1** |
| [4] Multi-RP_ID | MEDIUM (only valuable for multi-domain consumers) | LOW-MEDIUM (~80–150 LOC, 1–2 day phase) | LOW (config validation + SimpleWebAuthn knob) | **P1** |
| [5] Analytics hook | MEDIUM (consumers can roll their own with Express middleware today) | LOW (~100–150 LOC, 1–2 day phase) | LOW-MEDIUM (anonymity-invariant unit test is the load-bearing assertion) | **P1** |
| [1+5] Capabilities sub-object | MEDIUM (deepens analytics value once both ship) | TRIVIAL once both lands | LOW | **P2** |
| [4] `generateWellKnownWebauthn` helper | LOW (consumer can write 5 lines themselves) | TRIVIAL | LOW | **P2** |
| [3] Backfill idempotency | LOW (real-world flow is single-shot) | LOW | LOW | **P2** |
| [2] `beforePasskeyVerify` | LOW (Express middleware handles it) | LOW | LOW | **P3** |
| [5] EventEmitter multi-sub | LOW (no current consumer asking) | MEDIUM | LOW | **P3** |

All five primary items are P1 because the milestone goal is "ship the five capabilities". Differentiators are P2/P3.

---

## Phase Ordering Recommendation (input to ROADMAP.md)

Based on dependencies, complexity, and risk:

1. **Phase 1 — Hook scaffolding + [1] Backup flags** (LOW; 1 day)
   Lands the `HooksConfig` type, exports the new fields on `/register/finish` + `/login/finish` + `/session`, and the BS-update on login path. Smallest, lowest-risk, prerequisite for [2] and [5]'s richer payloads.

2. **Phase 2 — [4] Multi-RP_ID** (LOW-MEDIUM; 1–2 days)
   Fully orthogonal; can land in parallel with Phase 1 if work is split. Includes README + helper exports if cheap.

3. **Phase 3 — [5] Analytics hook** (LOW; 1–2 days)
   Now that [1] is landed, capabilities sub-object is trivial. Anonymity-invariant unit test is the load-bearing piece — write it first.

4. **Phase 4 — [2] 2FA enrolment hook** (MEDIUM; 2 days)
   Touches both `/register/finish`, `/login/finish`, and the OAuth router success path. Hook scaffolding from Phase 1 already exists; this phase just adds the third hook field and the short-circuit semantics.

5. **Phase 5 — [3] Lazy-backfill** (MEDIUM-HIGH; 3–5 days)
   Most complex. Blob versioning is the only piece of *new persisted state* in v0.7.0 — handled last so the rest of the milestone is locked down before this work starts. Multi-plan phase likely.

6. **Phase 6 — Release prep, README polish, npm publish, smoke install**

This order frontloads low-risk, high-leverage work and pushes the most complex item to the end where it has the most context.

---

## Anti-Features Summary (Explicit DO NOT BUILD)

Cross-cutting list for the requirements doc — every item below was considered, weighed, and rejected:

| # | Anti-feature | Why rejected |
|---|---|---|
| AF-01 | Returning raw BE/BS bits to consumers | Consumers want decoded booleans, not bit-twiddling |
| AF-02 | Auto-rejecting single-device registrations | Policy decision belongs to consumer |
| AF-03 | Computing a server-side `needsBackup: boolean` | Different consumer policies; surface raw flags |
| AF-04 | Renaming `backedUp` field for clarity | Frozen contract |
| AF-05 | Building TOTP / OTP / SMS into the library | Consumer brings their own second factor |
| AF-06 | Persisting "2FA pending" state in library schema | Consumer-owned state |
| AF-07 | Adding `is2FAEnrolled` to `AnonUser` | Frozen `AnonUser` shape |
| AF-08 | Synchronous 2FA hook | Async-only — external HTTP calls expected |
| AF-09 | EventEmitter for 2FA hook | Wrong semantics — must block session creation |
| AF-10 | Forced flag-day migration on v0.7 deploy | Lazy is the whole point |
| AF-11 | UI rendering inside the library for backfill prompts | Library has no UI |
| AF-12 | Persisting `needs_backfill` flag on user row | Computable from existing fields |
| AF-13 | Auto-hosting `/.well-known/webauthn` | Consumer choice — make it opt-in |
| AF-14 | Per-credential origin lock | Opposite of ROR's purpose |
| AF-15 | Auto-detecting related origins from Host header | Source of truth is config, not DNS |
| AF-16 | Wildcard origin patterns | Spec requires explicit enumeration |
| AF-17 | Server-side ROR polyfill for Firefox | Impossible — browser-side ceremony |
| AF-18 | Synchronous / blocking analytics hook | Adds latency to user requests |
| AF-19 | Passing `req` / `res` to analytics hook | Tempts PII leakage |
| AF-20 | Passing `AnonUser` to analytics hook | Entire object is forbidden PII |
| AF-21 | Open-ended `metadata` field on analytics events | Invites PII; bounded shape only |
| AF-22 | Built-in Mixpanel/Datadog adapters | Consumer brings own SDK |
| AF-23 | Auto-logging analytics events to pino | Duplicates consumer's stream |
| AF-24 | Server-side analytics rate-limiting | Consumer's provider handles it |
| AF-25 | Open-ended event names | Bounded enum only |

---

## Sources

### Backup eligibility flags (BE / BS)
- [W3C webauthn Issue #1933 — Indicate that the credential could be backed up and restored, but not synchronized](https://github.com/w3c/webauthn/issues/1933)
- [W3C webauthn Issue #1791 — Enforce backup eligibility during assertion](https://github.com/w3c/webauthn/issues/1791)
- [W3C webauthn Issue #1788 — Add ability to query for feasibility of registering a credential that is backup eligible](https://github.com/w3c/webauthn/issues/1788)
- [W3C webauthn Issue #1692 — Backup state of credentials](https://github.com/w3c/webauthn/issues/1692)
- [W3C webauthn PR #1695 — backup states in authenticator data](https://github.com/w3c/webauthn/pull/1695)
- [SimpleWebAuthn — Passkeys / credentialDeviceType + credentialBackedUp](https://simplewebauthn.dev/docs/advanced/passkeys)
- [SimpleWebAuthn server source — verifyRegistrationResponse.ts](https://github.com/MasterKale/SimpleWebAuthn/blob/master/packages/server/src/registration/verifyRegistrationResponse.ts)
- [Yubico java-webauthn-server — RegisteredCredential builder (backupEligible / backupState)](https://developers.yubico.com/java-webauthn-server/JavaDoc/webauthn-server-core/2.4.0/com/yubico/webauthn/RegisteredCredential.RegisteredCredentialBuilder.html)
- [NIST SP 800-63-4 — Syncable Authenticators](https://pages.nist.gov/800-63-4/sp800-63b/syncable/)
- [Corbado — Device-Bound vs. Synced Passkeys](https://www.corbado.com/blog/device-bound-synced-passkeys)

### Step-up / 2FA enrolment hook patterns
- [Authsignal — How to add passkey step-up auth in your app](https://www.authsignal.com/blog/articles/how-to-add-passkey-step-up-auth-in-your-app)
- [Auth0 — Add Step-up Authentication](https://auth0.com/docs/secure/multi-factor-authentication/step-up-authentication)
- [Better Auth — Hooks documentation](https://better-auth.com/docs/concepts/hooks)
- [Better Auth — Issue #8071 (passkey re-authentication / step-up)](https://github.com/better-auth/better-auth/issues/8071)
- [Keycloak Workshop — Step-Up MFA Biometrics with Passkeys](https://github.com/embesozzi/keycloak-workshop-stepup-mfa-biometrics)
- [Curity — Using Passkeys for Strong Passwordless MFA](https://curity.io/resources/learn/passkeys-authenticator/)

### Lazy migration / login-time backfill patterns
- [Auth0 — Configure Automatic Migration from Your Database](https://auth0.com/docs/manage-users/user-migration/configure-automatic-migration-from-your-database)
- [SuperTokens — Migrating users without downtime (Lazy Migration Strategy)](https://supertokens.com/blog/migrating-users-without-downtime-in-your-service)
- [Authing — Lazy Migration guide](https://docs.authing.co/v2/en/guides/database-connection/lazy-migration.html)
- [auth0-account-migration GitHub repo](https://github.com/abbaspour/auth0-account-migration)

### Multi-RP_ID / Related Origin Requests
- [web.dev — Allow passkey reuse across your sites with Related Origin Requests](https://web.dev/articles/webauthn-related-origin-requests)
- [passkeys.dev — Related Origin Requests advanced docs](https://passkeys.dev/docs/advanced/related-origins/)
- [W3C — A Well-Known URL for Relying Party Passkey Endpoints](https://www.w3.org/TR/passkey-endpoints/)
- [Chrome for Developers — Introducing hints, Related Origin Requests and JSON serialization for WebAuthn (Chrome 129)](https://developer.chrome.com/blog/passkeys-updates-chrome-129)
- [Levi Schuck — Coming soon to Chrome and Safari: WebAuthn related origins](https://levischuck.com/blog/2024-07-related-origins)
- [Corbado — WebAuthn Related Origins (ROR): Cross-Domain Passkey Guide](https://www.corbado.com/blog/webauthn-related-origins-cross-domain-passkeys)
- [Yubico — WebAuthn Browser Support](https://developers.yubico.com/WebAuthn/WebAuthn_Browser_Support/)

### Privacy-preserving analytics hooks
- [Better Auth — Hooks (after-hook event tracking)](https://better-auth.com/docs/concepts/hooks)
- [Security Boulevard — Privacy-Preserving Data Analytics: Stop Collecting What You Do Not Need](https://securityboulevard.com/2026/04/privacy-preserving-data-analytics-stop-collecting-what-you-do-not-need/)
- [hoop.dev — Data Anonymization Analytics Tracking: Best Practices](https://hoop.dev/blog/data-anonymization-analytics-tracking-best-practices-for-privacy-and-integrity)
- [hoop.dev — PII Anonymization in Analytics Tracking](https://hoop.dev/blog/pii-anonymization-in-analytics-tracking-a-must-have-for-privacy-and-security)
- [arxiv 2507.21904 — Privacy-Preserving Anonymization of System and Network Event Logs Using Salt-Based Hashing and Temporal Noise](https://arxiv.org/html/2507.21904v1)

---

*Feature research for: v0.7.0 Consumer Hooks & Recovery Hardening (`@vitalpoint/near-phantom-auth`)*
*Researched: 2026-04-29*
*Confidence: HIGH — surface inspected directly; conventions cross-referenced against W3C spec, browser release notes, Better-Auth / SimpleWebAuthn / Authsignal / Auth0 / SuperTokens / NIST*
