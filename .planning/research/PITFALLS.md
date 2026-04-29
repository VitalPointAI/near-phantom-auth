# Domain Pitfalls — v0.7.0 Consumer Hooks & Recovery Hardening

**Domain:** Adding 5 consumer-facing extension points to a shipped privacy-first WebAuthn auth library
**Project:** `@vitalpoint/near-phantom-auth` v0.7.0 (current shipped: v0.6.1)
**Researched:** 2026-04-29
**Confidence:** HIGH for codebase-specific pitfalls (read against current source); MEDIUM for upstream WebAuthn behavior (verified against `@simplewebauthn/server` v13 docs and W3C/passkeys.dev guidance)

> **NOTE:** This file replaces the v0.5.x-era PITFALLS.md. Pitfalls listed here are scoped to the five v0.7.0 features and how they interact with this codebase's existing surface (frozen `MPCAccountManager` contract, anonymity invariant, zero-dep tradition, NULL `key_bundle`/`sealing_key` for pre-v0.6.0 rows).

---

## Top 3 Highest-Risk Pitfalls

These three become explicit Phase 1 / pre-merge gates. Every other pitfall in this file is contained by a smaller test or a doc note; these three can corrupt user state, leak PII, or open a phishing surface and must be designed against from day one.

| # | Pitfall | Why top-3 | Pre-merge gate |
|---|---------|-----------|----------------|
| **R1** | **Lazy backfill mid-write partial state** (Pitfall 3-B) | Concurrent logins or a mid-write crash leave a user with `sealing_key` set but `key_bundle` NULL (or vice versa). User is now permanently broken — their PRF-derived DEK can't decrypt the old password-derived blob, and there's no signal to retry. Worse than no backfill. | Backfill writes MUST be wrapped in `db.transaction()` AND guarded by an idempotency token (e.g., `WHERE key_bundle IS NULL` predicate on the UPDATE). Test: concurrent backfill calls produce one final write, never two. |
| **R2** | **Registration analytics hook leaking PII via shape, not just by accident** (Pitfall 5-A) | If the hook's event type is `{ codename, nearAccountId, …}` then the consumer can passively observe the very identifiers we promise are anonymous. Once a single consumer logs `event.codename` to Datadog/Splunk, the anonymity invariant is broken for every downstream user of that consumer. The defense must be at the **type level**, not at runtime. | The event payload TYPE must not contain `codename`, `nearAccountId`, raw `ip`, or `userAgent`. A tsc-fail fixture must verify that `event.codename` does not type-check. Runtime redaction is a backup, not the primary defense. |
| **R3** | **Multi-RP_ID origin-spoofing via mis-configured `expectedRPID` array** (Pitfall 4-C) | `@simplewebauthn/server` v13 accepts `expectedRPID: string \| string[]`. If the consumer passes a wildcard or unvalidated array element, an attacker on `evil.com` can complete a ceremony that the server accepts as valid for `example.com`. This compounds with Related Origin Requests (the `/.well-known/webauthn` JSON file), which widens the trust surface to a list — getting the list wrong is permanent until rotated. | Library MUST validate the `expectedRPID` array at config time (every entry must match `^[a-z0-9.-]+$`, no wildcards, no leading/trailing dots, must register against eTLD+1). Test: spoofed origin with mismatched RPID → `verified: false`. |

---

## Critical Pitfalls

### Pitfall 1: Backup-eligibility flag exposure

#### 1-A: Treating `backedUp` as a stable property of the user, not the credential

**What goes wrong:**
The `credentialBackedUp` flag is a property of the **credential's authenticator state at the moment of the assertion**, not a property of the user. A credential can be created on a passkey-roaming-disabled device (e.g., a Windows Hello account before the user signs into iCloud/Google) and roam later. On subsequent logins, the same `credentialId` returns `backedUp: true`. If the consumer cached `backedUp` from `register()` as the user-level flag (e.g., to drive a "set up backup recovery" upsell), the UI is permanently stale.

**Why it happens:**
Developers see `backedUp: boolean` on `RegisterResult` and assume monotonic semantics. There is no eventing for "this credential just became backed-up."

**Warning sign:** Consumer code reads `backedUp` from a response object once and persists it as a user-level field. UI never re-checks on login.

**Prevention strategy:** Document explicitly that `backedUp` reflects the **last assertion's** state. Always expose it on BOTH `register()` AND `login()` results so consumers can refresh on every authentication. Add to README under "Backup-eligibility": "This flag may transition from false to true between sessions when a user enables passkey sync. Always read the latest value from the most recent `register()` or `login()` response — do not cache it as a user attribute."

**Phase to address:** Phase 1 (define the response shape and document the lifecycle).

---

#### 1-B: Privacy implication — `backedUp` leaks authenticator class

**What goes wrong:**
`backedUp: false` strongly implies a hardware key (YubiKey, single-device) or a non-syncing platform key. `backedUp: true` implies an iCloud Keychain / Google Password Manager / 1Password / etc. passkey. Combined with `transports` (also exposed by today's `passkeyData` shape — see `src/server/passkey.ts:198`), this fingerprints the user's authenticator class. For the anonymous-codename use case where users may pseudonymously register, exposing this in analytics or in client-readable response fields shrinks the anonymity set.

**Why it happens:**
Consumer-driven UI work asks "tell us if the user has a backup-eligible passkey so we can upsell IPFS recovery." Library complies without thinking about whether the **client** also receives the flag (it shouldn't — only the server-side consumer hook needs it for upsell logic).

**Warning sign:** Response JSON sent to the browser contains `backedUp` AND `transports` AND any session correlation ID — together these form a stable browser-side fingerprint.

**Prevention strategy:** Two scopes — make it explicit which one we're shipping:
1. **Server-only flag** (recommended): `backedUp` is exposed in the consumer hook payload (server-side) but NOT in the JSON response sent to the client. Add an integration test: `POST /register/finish` response body MUST NOT contain `backedUp` or `transports` keys.
2. **Client-exposed flag** (only if explicitly requested): document the fingerprinting risk in README.

**Phase to address:** Phase 1 (decide scope before shaping the response). Default to server-only.

---

#### 1-C: Type drift between client and server SDKs

**What goes wrong:**
`src/server/passkey.ts` returns `passkeyData.backedUp: boolean`, but the client API (`src/client/api.ts`) currently doesn't surface a `backedUp` field on `register()` / `login()` return types. If only the server route response is updated, the client `useAnonAuth` hook's typed return shape won't include the flag — consumers get `result.backedUp` as `any` (TypeScript strict mode is OFF — see PROJECT.md context line 122) and silently miss the field at compile time.

**Why it happens:**
Two SDKs in one repo, one published artifact. Easy to update the wire format without updating both type surfaces. Strict mode being off mutes the warning.

**Warning sign:** A `git diff` for the backup-eligibility change touches `src/server/router.ts` but not `src/client/api.ts` or `src/client/hooks/useAnonAuth.ts`.

**Prevention strategy:** Add the field to both client and server result types in the same commit. Add a type-level test (a `.d.ts` fixture or a `tsd`-style assertion in tests) that pins `result.backedUp` as `boolean` on the public client export. Phase deliverable checklist must include "client return shape updated."

**Phase to address:** Phase 1 (one diff covers both surfaces).

---

### Pitfall 2: Second-factor enrolment hook

#### 2-A: Hook fails AFTER session is created — user is "logged in but not enrolled"

**What goes wrong:**
Today's `POST /register/finish` flow (router.ts:178-244) creates the user, the passkey, AND the session inside a `db.transaction(...)` block (line 231). If the v0.7.0 second-factor hook runs **after** that transaction commits and **inside** the same request handler, and the hook throws, the user already has a valid signed session cookie. The browser thinks the user is authenticated; the consumer's "must have 2FA before access" gate is now stuck (no 2FA was set up, but the session cookie says "yes you're in"). On retry, the hook may run again with a now-existing user — idempotency must be defined.

**Why it happens:**
The session is created inside the registration transaction by design (atomic registration → session). Adding a hook after the transaction is the simplest insertion point. The failure mode is that "session created" and "2FA enrolled" are not the same atomic act, but the consumer's mental model assumes they are.

**Warning sign:** A failing hook returns 5xx but the response has already set a `Set-Cookie: session=…` header. `curl -i` reproducer shows `HTTP/1.1 500` with a cookie header.

**Prevention strategy:** Three layers:
1. **Defer session creation until after the hook resolves.** Move `sessionManager.createSession()` out of the registration transaction and after the hook callback. The hook signature returns `{ allow: true } | { allow: false, reason: string }` (or throws — treat as `allow: false`). On `allow: false`, do NOT set the session cookie; return 202 Accepted with a `nextStep: 'second-factor-enrolment'` body.
2. **Document the contract:** "If you provide an `onPasskeyRegistered` hook, the user is NOT signed in until the hook returns `{ allow: true }`. If the hook throws, the user is NOT signed in and the passkey IS recorded — they will need to retry the second-factor step on next login."
3. **Idempotency token:** Hook receives a `registrationId` (the user's row id, which is stable). Consumer is responsible for `INSERT … ON CONFLICT DO NOTHING` semantics.

**Phase to address:** Phase 2 (this is the structural decision for the hook). Must be designed before Phase 3 ships the hook surface.

---

#### 2-B: Hook callback throws — Express returns 500 with confusing semantics

**What goes wrong:**
Today's handler wraps the whole flow in `try { … } catch (error) { res.status(500) }`. If the hook throws, the catch block returns "Registration failed" — but the passkey row may already exist. The consumer's user database now has a passkey for a user who can't log in (because the user row exists, but the consumer's "fully-enrolled" flag is false).

**Why it happens:**
Default Express handler error path is one undifferentiated 500. No distinction between "passkey verification failed" (no rows written) and "second-factor hook failed after passkey was written" (rows written, user partially provisioned).

**Warning sign:** Production error logs show `Registration failed` with no breadcrumb pointing to the hook. Consumer cannot distinguish "user has a partial account" from "no account exists."

**Prevention strategy:** Wrap the hook call in its own try/catch. On hook failure, return a discriminated error response:
```typescript
{ success: false, stage: 'second-factor-enrolment', recoverable: true, error: '<sanitized>' }
```
plus a 422 status (NOT 500 — 500 means consumer should retry, 422 means the request was understood but the enrolment step did not complete). Hook errors are logged with `module: 'router', stage: '2fa-hook'` so they're filterable. Add an integration test: hook that throws → response is 422, response body has `stage: 'second-factor-enrolment'`, passkey IS in DB (or rolled back, depending on the Phase 2 decision above), session cookie is NOT set.

**Phase to address:** Phase 2 (response shape) + Phase 5 (integration test).

---

#### 2-C: Anonymity break — 2FA requires a confirmed channel

**What goes wrong:**
Traditional 2FA = SMS or TOTP. SMS requires a phone number (PII). TOTP requires the user to scan a QR code and confirm — fine in principle, but if the consumer's hook implementation also stores "user X has phone Y" or "user X has TOTP secret Z," the anonymity invariant collapses. For the anonymous-codename use case, the only privacy-preserving second factor is **another passkey** (cross-device or hardware key) or a **recovery passphrase** (stored client-side). Email is similarly PII.

**Why it happens:**
Consumers see "2FA hook" and reach for SMS/TOTP because that's what the rest of their stack does. The library has no way to enforce what the consumer does inside their hook.

**Warning sign:** Documentation example uses Twilio or any phone-number-bearing service. Consumer's example code stores a `phoneNumber` on the codename user.

**Prevention strategy:** Document explicitly in the hook README: "This hook fires for ALL user types (anonymous codename and OAuth). For anonymous-codename users, ANY second factor that ties to a phone number, email address, or other PII breaks the anonymity contract. Use additional passkeys, hardware keys, or a recovery passphrase for anonymous users." Provide an example using a second passkey enrolment as the canonical 2FA. Optionally, add a `userType: 'anonymous' | 'oauth'` discriminator to the hook payload so consumers can branch.

**Phase to address:** Phase 2 (hook payload includes `userType`) + Phase 6 (README hook examples).

---

#### 2-D: Replay / hook fires twice on retry

**What goes wrong:**
Express does not give the consumer hook idempotency by default. If a client retries `POST /register/finish` (network blip, double-tap), the second request fails challenge validation (good) — but if the retry happens AFTER passkey creation but BEFORE the hook, OR if the hook is called from `/login/finish` on a re-registration path, the consumer may receive the same `userId` twice. If the consumer's hook does `INSERT INTO 2fa_state (user_id, status) VALUES (…, 'pending')`, a duplicate-key error explodes.

**Why it happens:**
Idempotency in HTTP retries is the consumer's responsibility, but the library can make it easier by passing a stable, unique-per-registration token.

**Warning sign:** Consumer reports duplicate-key errors in their 2FA store. Hook fires twice with same `userId` on the same logical registration.

**Prevention strategy:** Pass an `idempotencyKey` (UUID, stable across retries of the same logical registration — derived from the challenge ID, which is already stable per ceremony) into the hook payload. Document: "Use this key for INSERT-ON-CONFLICT-DO-NOTHING semantics." Add to the example.

**Phase to address:** Phase 2 (hook payload schema) + Phase 5 (test: same idempotencyKey across retries).

---

### Pitfall 3: Lazy-backfill hook for pre-v0.6.0 accounts

#### 3-A: No `key_bundle` / `sealing_key` columns exist yet

**What goes wrong:**
The current PostgreSQL schema (`src/server/db/adapters/postgres.ts:30-132`) does NOT have `key_bundle` or `sealing_key` columns. The PRF `sealingKeyHex` is currently validated by zod (schemas.ts:43) but never persisted server-side. The "lazy backfill" feature implies these columns will be added — but adding columns to a published database adapter is a breaking change for consumers running migrations (custom adapters won't have the columns; the postgres adapter must add them via `POSTGRES_SCHEMA` ALTER TABLE; migration ordering matters).

**Why it happens:**
The v0.7.0 spec says "lazy-backfill hook for pre-v0.6.0 accounts with NULL key bundles" — assuming the columns exist. They don't.

**Warning sign:** Phase plan references `key_bundle IS NULL` predicate but `git grep key_bundle src/` returns nothing.

**Prevention strategy:** Phase 1 deliverable must include the schema change AND a migration path. Concrete steps: (a) add `key_bundle BYTEA` and `sealing_key_hex TEXT` columns nullable to `anon_users` in `POSTGRES_SCHEMA`; (b) document for custom-adapter consumers that they must add the columns; (c) make the `DatabaseAdapter` methods `getUserKeyBundle` and `setUserKeyBundle` OPTIONAL (`?`) so existing custom adapters compile (consistent with prior pattern — see PROJECT.md key decision "Make new DatabaseAdapter methods optional"); (d) update `POSTGRES_SCHEMA` with `IF NOT EXISTS` on `ALTER TABLE … ADD COLUMN` so re-running `initialize()` on an existing DB is safe.

**Phase to address:** Phase 1 (schema + types). Blocks every other backfill task.

---

#### 3-B: Concurrent logins both trigger backfill — partial-write corruption

**What goes wrong:**
User opens two tabs, logs in on both. Both requests hit `/login/finish`, both detect `key_bundle IS NULL`, both call the consumer's backfill hook, both write to the DB. Outcome A: last write wins (silent overwrite — losses if hook is non-deterministic). Outcome B: the writes interleave — request 1 writes `key_bundle`, request 2 writes `sealing_key_hex` derived from a DIFFERENT PRF ceremony (request 2's challenge), and now `key_bundle` is encrypted under request 1's DEK but `sealing_key_hex` is request 2's — the user can never decrypt their bundle again.

**Why it happens:**
The PRF `sealingKeyHex` is per-ceremony. Two ceremonies = two different sealing keys (the PRF input, `prfSalt`, is byte-identical across ceremonies — see `src/types/index.ts:71-76` — so the SAME credential should produce the SAME `sealingKeyHex`; but a different credential, or a re-registered passkey, produces a different key). For an anonymous-codename user with one passkey, the keys *should* match — but if the passkey was re-registered after recovery (STUB-03 surface), they won't.

**Warning sign:** User reports "I can't decrypt my recovery blob anymore" after using two browsers in parallel. Logs show two backfill events for the same `userId` within seconds of each other.

**Prevention strategy:** This is **R1 in the Top-3** — strongest prevention required:
1. Wrap the entire backfill in `db.transaction()` AND guard the write with `WHERE key_bundle IS NULL`. The second concurrent transaction sees zero rows updated and skips.
2. Make the hook return value structurally pure — the consumer returns the bytes to write, library does the writing inside the transaction. Hook does not perform the DB write itself.
3. Idempotency: the hook receives the user's `id` and a `ceremonyId` (the challengeId). If the hook is called twice with the same `userId`, library can dedupe via the `IS NULL` predicate.
4. **Do not** allow the hook to fire on EVERY login — only on the first login that observes `key_bundle IS NULL`. Subsequent logins must NOT call the hook even if it failed last time (state machine: NULL → IN_PROGRESS → SET, with IN_PROGRESS persisted as a sentinel — though this risks a stuck state on crash; alternative: only the WHERE-IS-NULL predicate is the source of truth, hook is allowed to fire repeatedly until it succeeds).
5. Test: spawn two concurrent `/login/finish` calls for a user with NULL bundle, assert exactly ONE write happens, both responses return successfully.

**Phase to address:** Phase 3 (backfill design). Top-3 priority.

---

#### 3-C: Backfill on session refresh vs first login — semantics drift

**What goes wrong:**
`session.test.ts` and existing session refresh logic (DEBT — `updateSessionExpiry` exists in adapter) extend session lifetime on activity. If the backfill hook is triggered on every session refresh (mistakenly), the consumer's hook fires hundreds of times per active user. If it's only on `/login/finish`, then a long-lived session never gets backfilled until logout+login.

**Why it happens:**
"Lazy backfill" is ambiguous. Does "lazy" mean "first login that observes NULL" or "any moment we have access to the user's PRF output"?

**Warning sign:** Consumer hook receives the same `userId` repeatedly within an hour. Consumer's analytics show "backfill events" >> "active users."

**Prevention strategy:** Define the trigger explicitly: hook fires ONLY in `/login/finish` (or `/register/finish` for a recover-then-register flow), NOT in `/session` reads or session refresh. PRF output is only available at login (when the WebAuthn ceremony runs); session refresh has no PRF output to backfill with. Document: "The backfill hook fires once per login on accounts with NULL `key_bundle`. Once written, it does not fire again. It does NOT fire on session refresh, GET /session, or wallet/IPFS recovery flows."

**Phase to address:** Phase 3 (hook contract).

---

#### 3-D: Old IPFS recovery blob keyed to password becomes orphaned post-backfill

**What goes wrong:**
A pre-v0.6.0 user has an IPFS recovery blob created with `encryptRecoveryData(payload, password)` — encrypted under a scrypt-derived key from their password (`src/server/recovery/ipfs.ts:59-91`). The blob's CID is stored in `anon_recovery`. The backfill upgrades them to PRF: `key_bundle` is now sealed under PRF-derived DEK. But the OLD IPFS blob still exists, still references the user's `userId` and `nearAccountId`, and is still recoverable with the original password. The user's "recovery story" is now split: PRF for normal login, password+CID for recovery — both work, but the PRF DEK protects different ciphertext than the password did. If the consumer rotates the IPFS blob to use the new sealing key, the user's existing IPFS recovery (with the password they wrote down) breaks silently.

**Why it happens:**
Two key-derivation paths (password-derived vs PRF-derived) cannot both encrypt the same blob. The "upgrade" must either (a) keep both blobs and document the dual-recovery story, or (b) re-encrypt the IPFS blob with the new sealing key and invalidate the password — a migration step that needs explicit user consent (the user's written-down password is now useless).

**Warning sign:** Plan claims "lazy backfill upgrades to PRF" without specifying what happens to the existing recovery blob. User reports "my old recovery password doesn't work" after a transparent upgrade.

**Prevention strategy:** Make explicit in the v0.7.0 spec: "Backfill writes a NEW `key_bundle` derived from PRF. It does NOT touch existing IPFS recovery blobs. Users' password-based recovery continues to work AGAINST THE OLD BLOB. The library does not auto-migrate existing recovery blobs; that is a separate, explicit user action (tracked as a future feature)." Add a documentation section: "Migrating existing IPFS recovery to PRF-derived sealing." Add a test: backfill on a user with existing IPFS recovery — recovery still works with the old password, no transparent rewrite of the blob.

**Phase to address:** Phase 3 (decide migration semantics) + Phase 6 (README).

---

#### 3-E: Pre-v0.6.0 accounts created with simple-codename mode (DEBT-01) — collision space

**What goes wrong:**
DEBT-01 (Phase 6, v0.5.x) introduced compound codenames (ALPHA-BRAVO-42). Before that, codenames were single-word + suffix (ALPHA-7) — see `isValidCodename` in `src/server/codename.ts` which still accepts both formats (state.md line 115). Pre-v0.6.0 accounts with single-word codenames may now collide with new compound codenames if a backfill operation re-derives codenames from any source. (The backfill spec doesn't say it touches codenames, but a careless implementation that "regenerates user data" might.)

**Why it happens:**
The codename module accepts both formats forever, but new generation always uses compound. A backfill that touches user data and accidentally re-runs `generateCodename` would produce a new compound codename that doesn't match the user's stored one — breaking the user's identity.

**Warning sign:** Backfill code calls `generateCodename` at all. User reports "my codename changed."

**Prevention strategy:** Backfill MUST NOT touch `codename`, `near_account_id`, `mpc_public_key`, or `derivation_path`. The columns it writes are EXACTLY `key_bundle` and `sealing_key_hex`. Test: backfill on a legacy single-word codename user — codename is unchanged after the operation.

**Phase to address:** Phase 3 (backfill scope). Low likelihood but easy to gate.

---

### Pitfall 4: Multi-RP_ID verification

#### 4-A: Browser doesn't support Related Origin Requests — silent fallback

**What goes wrong:**
Related Origin Requests (the `/.well-known/webauthn` JSON file mechanism) are supported in Chrome 128+ and Safari 18+ but NOT in Firefox (as of early 2026 — PROJECT.md STATE.md confirms Firefox PRF gaps already deferred). If the consumer configures multi-RP_ID and a Firefox user tries to authenticate cross-origin, the browser ignores the related-origins file and the ceremony fails — but the failure mode looks like a generic "credential not found." The user's mental model is "passkeys are broken" rather than "cross-origin passkeys are not supported in this browser."

**Why it happens:**
WebAuthn returns `NotAllowedError` for both "no credentials match" and "browser doesn't support related origins." The library can't distinguish these client-side without a UA sniff (which is fragile).

**Warning sign:** Cross-origin login works in Chrome but mysteriously fails in Firefox with no error detail. Support requests cluster around Firefox.

**Prevention strategy:** Document the browser support matrix in README. Add a `relatedOrigins` config validation: if the consumer configures multi-RP_ID, log a warning at server startup: "Related Origin Requests require Chrome 128+, Safari 18+, or Edge 128+. Firefox users will fail cross-origin authentication." Provide a feature-detection example for the client-side that gracefully falls back to single-origin login. Track Firefox status in `STATE.md > Deferred Items` alongside the PRF gap (same browser, same user-population reach).

**Phase to address:** Phase 4 (multi-RP_ID design) + Phase 6 (README).

---

#### 4-B: User registered on `app.example.com` (rpId: `example.com`), consumer adds `auth.example.com` (rpId: `auth.example.com`)

**What goes wrong:**
RP ID is BAKED into the credential at registration time. A passkey registered against `rpId: 'example.com'` will NOT work for `rpId: 'auth.example.com'` — different RP ID, different scope. If the consumer expects "passkey works on any subdomain," they must use `rpId: 'example.com'` (the eTLD+1) consistently. Multi-RP_ID is a different feature: it's about supporting MULTIPLE eTLD+1s (e.g., `example.com` AND `example.org`) via the related-origins JSON file, not about one RP with subdomains.

**Why it happens:**
Consumers conflate "subdomain support" (which is a single rpId at eTLD+1) with "multi-domain support" (which is multi-RP_ID via related origins).

**Warning sign:** Consumer asks for "multi-RP_ID" but their actual need is "passkey works on `app.example.com` and `auth.example.com`" — that's a single-rpId-at-eTLD+1 problem, not a multi-RP_ID problem.

**Prevention strategy:** Pre-Phase-4 design doc clarifies the two scenarios. Multi-RP_ID is for cross-eTLD+1 (e.g., a SaaS that owns `example.com` and `example-app.io`). Subdomain coverage is achieved by setting rpId to the parent domain. Add a config-time validation: if `rpId` in the related-origins list shares an eTLD+1 with the primary `rpId`, log a warning: "Subdomains do not require multi-RP_ID. Consider using the parent domain as your single rpId."

**Phase to address:** Phase 4 (config validation + design doc).

---

#### 4-C: Origin spoofing — `evil.com` claims rpId `example.com`

**What goes wrong:**
This is **R3 in the Top-3**. With `expectedRPID: string[]`, an attacker on `evil.com` can craft an authenticatorData with `rpIdHash = SHA256('example.com')` (because they know the target rpId). `verifyAuthenticationResponse` checks the `rpIdHash` against the array — if `'example.com'` is in the array, it matches. The remaining defense is `expectedOrigin`: the clientDataJSON must contain `origin: 'https://example.com'`. The attacker, if they can MitM or trick the client into running on `evil.com` with a forged clientDataJSON, defeats this only if they also bypass TLS — which requires a CA compromise. So the defense IS adequate IF and ONLY IF `expectedOrigin` is also an array that matches the `expectedRPID` array element-wise, OR if every origin in the array is independently TLS-protected and the attacker has no CA capability.

**Why it happens:**
The library's current code (`webauthn.ts:243`, `passkey.ts:170`) passes a single string for both `expectedOrigin` and `expectedRPID`. Naively widening to an array on both without ensuring the pairing is correct is the spoofing vector.

**Warning sign:** Code that does `expectedRPID: rpIds.split(',')` and `expectedOrigin: origins.split(',')` without enforcing that origin[i] matches rpId[i].

**Prevention strategy:** Top-3 priority gates:
1. Library config takes a `relatedOrigins: Array<{ origin: string; rpId: string }>` — paired tuples, not two parallel arrays.
2. At config time, validate every entry: origin starts with `https://`, host part of origin's URL has rpId as a suffix-domain (or equal to rpId), no wildcards, no leading dots.
3. In `verifyAuthentication`, pass `expectedOrigin: relatedOrigins.map(r => r.origin)` and `expectedRPID: relatedOrigins.map(r => r.rpId)` — `@simplewebauthn/server` v13 supports both as arrays.
4. Test: spoofed `clientDataJSON.origin: 'https://evil.com'` with an authenticatorData containing `rpIdHash = SHA256('example.com')` → `verified: false`. (This should already work in v13; we're regression-guarding.)
5. Test: passing `relatedOrigins: [{ origin: 'http://example.com', rpId: 'example.com' }]` (note: `http`, not `https`) → config validation throws at startup.

**Phase to address:** Phase 4 (config + verification). **TOP-3.**

---

#### 4-D: Cookie domain interaction — session cookie not readable across rpIds

**What goes wrong:**
Multi-RP_ID lets the user sign in with the same passkey on `example.com` and `example.org`. But the session cookie is signed and set with a specific `Domain=` attribute (or no Domain — defaulting to the request host). A cookie set on `example.com` is unreadable on `example.org`. Result: user successfully completes WebAuthn assertion on `example.org`, server creates a session, but the browser never sends the cookie back on subsequent requests because cookies don't cross eTLD+1 boundaries. Multi-RP_ID without a corresponding session strategy (federated sign-in handoff via redirect, or a token-based session model) is half a feature.

**Why it happens:**
WebAuthn and HTTP cookies have different cross-domain semantics. Cookies don't follow related-origins.

**Warning sign:** User reports "I logged in on example.org but it kicked me out on the next page load."

**Prevention strategy:** Document the limitation prominently in README: "Multi-RP_ID lets users authenticate with the same passkey across origins, but session cookies are still per-origin. Each related origin needs its own session establishment after assertion." Optionally provide a helper for cross-origin session bootstrap (out of scope for v0.7.0; document as a deferred item). Add a test that documents the boundary: "session cookie set on one origin is not used on a related origin" — this is expected behavior, not a bug.

**Phase to address:** Phase 4 (document boundary) + Phase 6 (README).

---

#### 4-E: Phishing surface widens — security review checklist

**What goes wrong:**
With multi-RP_ID, a credential trusts a list of origins. Adding an origin to the list grants it credential-binding power. If the list is misconfigured (typo: `examp1e.com` instead of `example.com`), or if the consumer's `/.well-known/webauthn` JSON file is publicly writeable (e.g., served from a misconfigured S3 bucket), an attacker can add their own origin and harvest assertions.

**Why it happens:**
The trust list is an external dependency with no library-side validation.

**Warning sign:** Consumer's `/.well-known/webauthn` JSON file is served with `s-maxage=0` and write permissions on the bucket. Or: the list contains origins the consumer doesn't control (e.g., a partner domain that may change ownership).

**Prevention strategy:** Library-side: at startup, fetch the consumer's configured `/.well-known/webauthn` JSON and compare it to the configured `relatedOrigins` list. If they don't match, log an error and refuse to start (or warn loudly). Document a security-review checklist in README:
- [ ] Every origin in the list is owned by the same legal entity.
- [ ] The `/.well-known/webauthn` JSON file is served read-only.
- [ ] The list is reviewed quarterly.
- [ ] Adding an origin requires PR review by a security owner.
- [ ] No partner / vendor / third-party origins in the list.

**Phase to address:** Phase 4 (config validation) + Phase 6 (README security review section).

---

### Pitfall 5: Registration analytics hook

#### 5-A: PII leak via event SHAPE — type-level defense required

**What goes wrong:**
**R2 in the Top-3.** If the analytics event payload type is `{ codename: string, nearAccountId: string, ip: string, userAgent: string, registeredAt: Date }`, then EVEN IF the consumer carefully filters at runtime, the type system says these fields are present and accessible. A consumer using a generic "send event to Datadog/Splunk/Honeycomb" wrapper will pass the WHOLE event object — every field in the type. The PII is leaked by SHAPE, not by accident. This breaks the anonymity invariant for every downstream user of that consumer's product.

**Why it happens:**
"Anonymity" is interpreted as "the library doesn't store PII." But the library exposes a hook that hands PII to a consumer who will then store it elsewhere. The library's contract must extend to "we don't HAND OUT PII either."

**Warning sign:** Hook event type contains `codename`, `nearAccountId`, `ip`, `userAgent`, or any user-display-name-equivalent field. README example shows `analytics.track('user_registered', event)` with the whole object passed.

**Prevention strategy:** Top-3 priority gates:
1. **The event type MUST NOT contain `codename`, `nearAccountId`, `ip`, `userAgent`, `email`, or `userId`.** Allowed fields:
   - `eventType: 'register' | 'login' | 'logout'`
   - `userType: 'anonymous' | 'oauth'`
   - `timestamp: Date`
   - `success: boolean`
   - `failureReason?: 'challenge_expired' | 'verification_failed' | 'rate_limited' | 'invalid_input'` (controlled enum, no free-text)
   - `userIdHash?: string` (SHA256 of userId, NOT the userId itself — for funnel analysis without re-identification)
   - `ipHash?: string` (SHA256 of IP with a server-side salt — for unique-visitor metrics without IP storage)
   - `userAgentClass?: 'desktop' | 'mobile' | 'bot'` (class, not raw string)
2. Add a tsc-fail fixture: `event.codename` MUST NOT type-check (the field doesn't exist on the type). This is the same pattern used for `MPCAccountManagerConfig.derivationSalt` (MPC-07 in v0.6.1).
3. Runtime defense (defense-in-depth): when constructing the event object, only the whitelisted keys are copied — even if a future code change accidentally adds `codename` to the source, it's not propagated. Add a test: hook receives an event for a registration; `Object.keys(event)` contains ONLY the whitelisted keys; `event.codename` is undefined; no PII keys leak through.

**Phase to address:** Phase 5 (hook payload schema). **TOP-3.**

---

#### 5-B: Sync hook stalls every login by 200ms

**What goes wrong:**
The hook is called in the request path. Consumer's analytics service is a synchronous HTTP POST to a remote endpoint. Their endpoint is slow (200ms p99). Every login is now 200ms slower, blocking the response.

**Why it happens:**
Default Express handler is sequential. A `await analyticsHook(event)` in the path adds the hook's latency directly to user-perceived latency.

**Warning sign:** P99 login latency increases after enabling analytics hook. Synthetic monitor times out.

**Prevention strategy:** Library-side: invoke the hook with `setImmediate` (or `queueMicrotask`, or simply don't `await`) — fire-and-forget. Document: "The analytics hook is invoked AFTER the response is sent. It does NOT block the request. Errors thrown from the hook are logged via the library's logger but do not affect the user." Test: hook that takes 5 seconds — login latency is unchanged. Add a default timeout (e.g., 5s) with a logged warning if exceeded — still doesn't block, just bounds resource use.

**Phase to address:** Phase 5 (hook semantics).

---

#### 5-C: Hook throws — login returns 500 because of a logging side-effect

**What goes wrong:**
Related to 5-B. If the hook is `await`-ed and throws, the login response is now 500. User sees "Login failed" because of a logging side-effect, not because of an actual auth failure.

**Why it happens:**
Hooks in Express handlers are tempting to `await` for clarity. But analytics is observability, not auth — its failures must not affect auth success.

**Warning sign:** Login fails when the analytics endpoint is down. Status page shows "auth degraded" when the issue is "Datadog is degraded."

**Prevention strategy:** Same as 5-B — don't `await` the hook in the auth path. If we DO await for backpressure reasons, wrap in try/catch and ignore errors (log them). Test: hook that throws — login still returns 200, error is logged with `module: 'router', stage: 'analytics-hook'`.

**Phase to address:** Phase 5.

---

#### 5-D: IP is PII for anonymous users — must be hashed or omitted

**What goes wrong:**
For OAuth users, IP is "operational metadata, sensitive but not identifying" (the email already identifies them). For anonymous-codename users, IP is the strongest re-identification signal we have — combined with timestamp and user-agent it's enough to deanonymize. If the analytics hook receives `event.ip`, the consumer's analytics warehouse now contains anonymous-user IPs.

**Why it happens:**
Convenient field. Already in `req.ip`. Easy to add to the event.

**Warning sign:** Event payload includes `ip: string` or `ipAddress: string`.

**Prevention strategy:** Forbid raw IP in the event type (covered by 5-A). If unique-visitor metrics are needed, expose `ipHash: SHA256(ip + serverSalt)` — the salt is per-instance, rotates monthly, makes cross-instance correlation impossible. Document the rationale in README. Test: event for a registration with a known IP — `event.ipHash` is present, `event.ip` is undefined and not type-accessible.

**Phase to address:** Phase 5 (covered by 5-A's type-level defense).

---

#### 5-E: Hook fires on failed login attempts — credential stuffing data leaks

**What goes wrong:**
If the hook fires on EVERY auth event including failures, the consumer's analytics now contains the IPs (or ipHashes) and timestamps of credential-stuffing attempts. The consumer didn't ask for this. Worse: if the hook payload includes the attempted `codename` (in the failure case, an attacker is GUESSING codenames — those guesses are not PII of any real user, but they're attack signal that the consumer may not realize they're storing).

**Why it happens:**
"Fire on every event" is the easiest implementation. Distinguishing "real user activity" from "attack noise" is more nuanced.

**Warning sign:** Consumer's analytics show 100x the registration volume after a credential-stuffing attack. Consumer asks "what is this traffic?"

**Prevention strategy:** Make failure events OPT-IN. Default: hook fires only on `success: true` events. Consumer can opt in to failure events for security-monitoring purposes via `{ events: ['register.success', 'register.failure', 'login.success', 'login.failure'] }`. Document: "By default, only successful events are emitted. Failure events include credential-stuffing noise — opt in only if you're consuming them for security monitoring, not product analytics."

**Phase to address:** Phase 5 (event subscription model).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Add hooks as required config (not optional) | Forces consumers to think about them | Breaking change for existing consumers — violates additive-only constraint | **NEVER for v0.7.0.** All hooks must be optional. |
| Pass the whole `req` or `res` object to the hook | Maximally flexible for consumer | Consumer can read cookies/IP/headers, leak PII; library has no defense | Never — pass a curated, typed event payload only. |
| Skip transaction wrapping on backfill ("just one column") | Simpler implementation | Concurrent-write corruption (Pitfall 3-B) | Never — transaction is the only correctness boundary. |
| Run analytics hook synchronously to "make sure it lands" | Easier mental model | 200ms latency hit per request (Pitfall 5-B) | Only if the consumer explicitly opts in to sync mode AND understands the latency cost. |
| Validate `relatedOrigins` only at first use | Skips startup cost | Silent misconfiguration in production until first cross-origin attempt (Pitfall 4-C) | Never — validate at server startup, fail fast. |
| Allow `expectedOrigin` and `expectedRPID` as separate parallel arrays | Mirrors `@simplewebauthn/server` API directly | Pairing mismatch is a spoofing vector (Pitfall 4-C) | Never — wrap in a paired-tuple type. |
| Cache `backedUp` from registration on the user record | Consumer doesn't need to re-fetch | Stale on credential roam (Pitfall 1-A) | Only if the cache is invalidated on every login. |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `@simplewebauthn/server` v13 multi-RP_ID | Pass parallel `string[]` arrays for origin and rpId | Use a paired `relatedOrigins: Array<{ origin, rpId }>` type, derive the two arrays at call site |
| Existing `db.transaction()` (postgres adapter) | Backfill outside transaction "because it's just one update" | Wrap backfill in `db.transaction()` AND use `WHERE key_bundle IS NULL` predicate |
| Custom `DatabaseAdapter` consumers | Add new required methods (`getUserKeyBundle`, `setUserKeyBundle`) | Follow established pattern from Phase 5 — make them OPTIONAL with `?`, library falls back gracefully (state.md line 109) |
| Existing v0.6.0 PRF flow (`sealingKeyHex` validated but not persisted) | Add column without migration — break existing DBs | Use `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in `POSTGRES_SCHEMA`; document migration for custom adapters |
| Express request lifecycle | Run analytics hook before `res.json()` | Run analytics hook AFTER response sent (`setImmediate` or response-completed event) |
| Existing IPFS recovery (password-derived) | Auto-rotate to PRF-derived sealing key on backfill | Leave existing blobs untouched; document migration as a separate user-initiated action |
| Pino logger | Use `console.log` in new hook code | Use the injected logger from the existing factory pattern (router.ts:53) — `log.info({ module: 'router', stage: '<x>' }, ...)` |
| `/.well-known/webauthn` JSON | Library generates the file | Library validates the consumer's published file matches config; consumer owns the file |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sync analytics hook in request path | P99 login latency tracks consumer's analytics endpoint latency | Fire-and-forget hook with `setImmediate` (Pitfall 5-B) | At first scale event when analytics service slows |
| `getUserKeyBundle` on every `/session` GET | DB load doubles when frontends poll session | Cache `key_bundle` in the session row at login; don't re-fetch on session reads | At ~1k concurrent users polling /session every 30s |
| Backfill hook invoked on every login | DB write per active session | Gate backfill on `key_bundle IS NULL` predicate; once written, never fires again | At first login of every backfill-eligible user (acceptable if one-shot) |
| Re-running config validation on every request | Adds parse overhead per request | Validate at `createAnonAuth(...)` time; reject early; reuse parsed config | At >1000 RPS |
| Loading the consumer's `/.well-known/webauthn` JSON on every multi-RP_ID verification | External HTTP fetch in the hot path | Fetch once at startup, cache in memory, refresh on consumer-driven SIGHUP or scheduled reload | Always — never fetch per request |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `expectedRPID` and `expectedOrigin` not paired | Origin spoofing (Pitfall 4-C) | Paired-tuple config + element-wise array passing |
| Hook payload type contains PII fields | Anonymity invariant broken (Pitfall 5-A) | Type-level whitelist + tsc-fail fixture |
| Backfill writes outside transaction | Partial-write corruption (Pitfall 3-B) | `db.transaction()` + IS NULL predicate |
| Session cookie set on hook failure | User logged in without 2FA (Pitfall 2-A) | Hook returns `{ allow }` before session creation |
| Failed-login analytics events on by default | Credential-stuffing noise leaks to consumer's warehouse (Pitfall 5-E) | Failure events opt-in; success-only default |
| `backedUp` exposed on client-side response without rationale | Authenticator class fingerprinting (Pitfall 1-B) | Server-side hook only; not in JSON response to browser |
| Multi-RP_ID config accepts wildcards or malformed entries | Trust-list compromise | Strict validation at startup; reject `*`, leading dots, http (vs https), invalid hostnames |
| IP forwarded to analytics raw | Anonymous-user re-identification (Pitfall 5-D) | Hash with rotating salt; never raw IP in event |
| Hook receives `req` or `res` directly | Consumer can read arbitrary headers, cookies | Pass curated typed event payload only |
| Consumer's `/.well-known/webauthn` file out of sync with library config | Trust-list mismatch, silent verification surface drift | Library checks at startup that fetched file matches config |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Backfill failure is silent | User logs in normally but their old recovery blob is now orphaned and they don't know | Surface backfill status in the session response: `{ recoveryUpgrade: 'pending' \| 'complete' \| 'failed' }` so consumer UI can show "we tried to upgrade your security; please re-set up recovery" |
| 2FA hook says "set up 2FA" but offers SMS for an anonymous user | User must give phone number to use a privacy-first product — contradiction | Hook payload includes `userType`; consumer documentation explicitly recommends passkey-as-2FA for `userType: 'anonymous'` |
| Cross-origin login cookie not set, user kicked out | "Why am I logged out on example.org?" | Document the limitation in consumer-facing UI; consider redirect-based session handoff (post-v0.7.0) |
| `backedUp: false` triggers a "back up your account" upsell on every login | Annoying nag for hardware-key users who chose non-syncing on purpose | UI dismissibility persisted via `localStorage`; consumer UI responsibility, but document the recommendation |
| Multi-RP_ID Firefox user gets generic "passkey not found" | Looks like the credential is gone | Library returns a discriminated error code (`unsupported_browser_for_related_origins`) so consumer UI can show the right message |
| Pre-v0.6.0 user backfill prompts password re-entry | "Why is it asking for my password just to log in?" | Backfill is server-side and silent — uses PRF output from the same login ceremony, no extra prompt; only fails if PRF unsupported, in which case skip silently |

---

## "Looks Done But Isn't" Checklist

- [ ] **Backup-eligibility flag:** Server response shape updated, but client `useAnonAuth` return type also updated? Strict mode is OFF — verify both surfaces compile and the field is reachable from consumer code.
- [ ] **Backup-eligibility flag:** Documented as per-credential and per-assertion (not user-level)? README has the lifecycle paragraph?
- [ ] **2FA hook:** Session creation deferred until hook resolves? Verified by test that asserts no `Set-Cookie` header on hook failure.
- [ ] **2FA hook:** Hook receives `userType` discriminator so consumers can branch for anonymous-vs-OAuth? Verified by hook payload type test.
- [ ] **2FA hook:** Idempotency key in payload? Verified by retry test (same key, hook idempotent).
- [ ] **Backfill:** `key_bundle` and `sealing_key_hex` columns added to schema with `IF NOT EXISTS`? Custom-adapter pattern (optional methods on `DatabaseAdapter`) followed?
- [ ] **Backfill:** Concurrent-login test exists and passes (one write, both responses succeed)?
- [ ] **Backfill:** Existing IPFS recovery blob untouched after backfill? Verified by test that recovers via the original password post-backfill.
- [ ] **Multi-RP_ID:** Paired-tuple config (`Array<{ origin, rpId }>`) used, not parallel string arrays? Verified by config-validation test.
- [ ] **Multi-RP_ID:** Origin spoofing test passes (evil origin + correct rpIdHash → `verified: false`)?
- [ ] **Multi-RP_ID:** Firefox/unsupported-browser path returns a discriminated error code, not a generic 401?
- [ ] **Multi-RP_ID:** README has the security review checklist?
- [ ] **Analytics hook:** Event payload type does NOT include `codename`, `nearAccountId`, `ip`, `userAgent`? Verified by tsc-fail fixture.
- [ ] **Analytics hook:** Hook is fire-and-forget? Verified by latency test (slow hook does not slow login).
- [ ] **Analytics hook:** Failure events opt-in, success-only default? Verified by subscription model test.
- [ ] **Analytics hook:** Hook errors logged but do not propagate to response? Verified by throwing-hook test.
- [ ] **All hooks:** Optional in config (not required)? Existing consumers without hooks still work? Verified by integration test that omits all hook config.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| **R1** Lazy backfill partial-write (3-B) | HIGH — user data corruption | (1) Identify affected users via `SELECT id FROM anon_users WHERE key_bundle IS NOT NULL AND sealing_key_hex IS NULL OR key_bundle IS NULL AND sealing_key_hex IS NOT NULL`; (2) NULL-out the inconsistent column for these rows; (3) On their next login, the backfill predicate re-fires; (4) Document the incident; users with already-encrypted blobs need a re-recovery flow. |
| **R2** Analytics PII leak (5-A) | HIGH — anonymity broken irreversibly for affected users | (1) Patch the event type; (2) Notify consumer to purge analytics warehouse of leaked fields; (3) Coordinated disclosure if user-facing impact; (4) Cannot un-leak data already in third-party warehouses — apologize, document, post-mortem. |
| **R3** Multi-RP_ID origin spoofing (4-C) | HIGH — credential-binding compromise | (1) Patch `relatedOrigins` config validation; (2) Rotate any credentials that were potentially compromised (consumer-driven re-registration); (3) Audit `/.well-known/webauthn` for unauthorized origins; (4) CVE assessment. |
| 2FA hook session-without-enrolment (2-A) | MEDIUM — user-state inconsistency | (1) Identify affected users (passkey exists, 2FA state missing); (2) Force them through 2FA enrolment on next login via consumer-side gate; (3) Patch hook to defer session creation. |
| Backfill IPFS blob mismatch (3-D) | MEDIUM — recovery confusion | (1) Document the dual-recovery story; (2) Add UI hint: "Your account was upgraded. Both your old recovery password AND your new passkey-based recovery will work." (3) Provide explicit migration tool when consumer requests it. |
| Backup-eligibility cached stale (1-A) | LOW — UI annoyance | (1) Push patch documenting the lifecycle; (2) Consumers update their cache invalidation. |

---

## Pitfall-to-Phase Mapping

How v0.7.0 phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1-A `backedUp` lifecycle confusion | Phase 1 | README lifecycle paragraph; flag exposed on BOTH register and login responses |
| 1-B Authenticator-class fingerprinting | Phase 1 | Integration test: client-facing JSON does not contain `backedUp` (server-only) |
| 1-C Type drift between client/server | Phase 1 | Type-level test: `client.register()` return type includes `backedUp: boolean` |
| 2-A Session-without-2FA | Phase 2 | Test: throwing hook → no Set-Cookie; passing hook → Set-Cookie present |
| 2-B Hook 500 vs 422 confusion | Phase 2 | Test: hook throws → 422 with `stage: 'second-factor-enrolment'` |
| 2-C 2FA breaking anonymity | Phase 2 | `userType` discriminator in hook payload; README example uses passkey-as-2FA |
| 2-D Hook replay | Phase 2 | `idempotencyKey` in hook payload; retry test |
| 3-A Schema columns missing | Phase 1 | Migration fixture: fresh DB after `initialize()` has both columns |
| **R1** 3-B Backfill partial-write | **Phase 3** | **Concurrent-login test: exactly one write** |
| 3-C Backfill on session refresh | Phase 3 | Test: session-refresh path does not invoke hook |
| 3-D IPFS blob orphaned | Phase 3 | Test: post-backfill, original-password IPFS recovery still succeeds |
| 3-E Codename collision risk | Phase 3 | Test: legacy single-word codename user — codename unchanged after backfill |
| 4-A Firefox silent failure | Phase 4 | Server-startup warning logged when `relatedOrigins` configured |
| 4-B Subdomain vs cross-eTLD+1 confusion | Phase 4 | Config-time warning if `relatedOrigins` entries share eTLD+1 |
| **R3** 4-C Origin spoofing via array | **Phase 4** | **Spoofing test + paired-tuple type** |
| 4-D Cookie domain boundary | Phase 4 | Test documenting boundary; README limitation note |
| 4-E Trust-list misconfiguration | Phase 4 | Startup check that `/.well-known/webauthn` matches config |
| **R2** 5-A Event PII via shape | **Phase 5** | **tsc-fail fixture: `event.codename` does not type-check** |
| 5-B Sync hook latency | Phase 5 | Latency test: 5s hook → unchanged login latency |
| 5-C Hook error propagates | Phase 5 | Test: throwing hook → 200 OK login |
| 5-D Raw IP in event | Phase 5 | Covered by 5-A type-level whitelist |
| 5-E Failure events leak | Phase 5 | Default subscription test: failure events not delivered without opt-in |

---

## Sources

- `src/server/passkey.ts:170` — current `expectedRPID` is `string` (single)
- `src/server/passkey.ts:198` — `passkeyData` shape currently includes `backedUp` and `transports`
- `src/server/router.ts:178-244` — registration flow with session creation INSIDE the transaction
- `src/server/db/adapters/postgres.ts:30-132` — current schema; **no `key_bundle` or `sealing_key_hex` columns**
- `src/server/recovery/ipfs.ts:59-91` — password-scrypt-derived encryption key for IPFS blobs
- `src/server/validation/schemas.ts:38-43` — `sealingKeyHex` validated server-side but NOT persisted
- `src/types/index.ts:71-96` — PRF salt and `requirePrf` configuration; documents the post-credential-creation orphan-passkey risk (WR-03 trade-off)
- `src/server/codename.ts` — codename module accepts both legacy single-word and new compound formats
- `.planning/PROJECT.md` Key Decisions — frozen `MPCAccountManager` contract, anonymity invariant, additive-only
- `.planning/RETROSPECTIVE.md` — zero-dep tradition (3 milestones), plan-as-spec pattern, sandbox advisory pattern
- `.planning/STATE.md` — Firefox PRF gap deferred; `STATE.md > Deferred Items` table
- [SimpleWebAuthn v13 — multiple expectedRPID supported as array](https://github.com/MasterKale/SimpleWebAuthn/issues/90)
- [passkeys.dev — Related Origin Requests](https://passkeys.dev/docs/advanced/related-origins/)
- [SimpleWebAuthn server CHANGELOG](https://github.com/MasterKale/SimpleWebAuthn/blob/master/CHANGELOG.md)

---

*Pitfalls research for: v0.7.0 Consumer Hooks & Recovery Hardening*
*Researched: 2026-04-29*
*Confidence: HIGH (codebase-grounded), MEDIUM (upstream WebAuthn behavior verified against v13 docs)*
