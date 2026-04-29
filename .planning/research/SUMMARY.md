# Project Research Summary

**Project:** `@vitalpoint/near-phantom-auth` v0.6.1 → v0.7.0 — "Consumer Hooks & Recovery Hardening"
**Domain:** Privacy-first WebAuthn / passkey authentication SDK (npm library, frozen `MPCAccountManager` contract)
**Researched:** 2026-04-29
**Confidence:** HIGH

## Executive Summary

v0.7.0 is an **additive minor bump** that turns five known consumer-facing gaps into a coherent surface: backup-eligibility flag exposure, second-factor enrolment hook, lazy-backfill hook for pre-v0.6.0 accounts, multi-RP_ID verification, and an anonymity-preserving registration analytics hook. All four researchers converge on a striking conclusion: **zero new dependencies, zero version bumps, no MPC-layer changes** — the milestone fits within the codebase's existing architecture (config-driven optional callbacks on `AnonAuthConfig`), the existing `@simplewebauthn/server@^13.2.3` pin already supports multi-RP_ID arrays, and the existing pino/zod/postgres-adapter stack is sufficient. This continues the zero-dep tradition held across v0.5.x, v0.6.0, and v0.6.1.

The recommended implementation pattern is **a typed `AnonAuthConfig.hooks` object with optional async callbacks** (rather than EventEmitter or DI containers), backed by a small new `src/server/analytics.ts` module for the load-bearing PII guards. Three pitfalls dominate risk: (R1) lazy-backfill partial-write corruption from concurrent logins — must be guarded by `db.transaction()` plus `WHERE … IS NULL` predicate; (R2) analytics PII leak via *event shape* — defended at the type level with a tsc-fail fixture, not just runtime redaction; (R3) multi-RP_ID origin spoofing via mis-paired `expectedOrigin` / `expectedRPID` arrays — defended by a paired-tuple config type. These three become explicit pre-merge gates.

The most contentious open question is the **lazy-backfill data-ownership framing**: the Architecture researcher treats it as a *pass-through hook* (consumer owns the schema, library never persists key bundles) while the Pitfalls researcher writes prevention as if the library will *add `key_bundle` and `sealing_key_hex` columns* to its `anon_users` table. Both framings have legitimate claims. **Roadmapper must resolve this at requirements time** before Phase 3/5 (whichever scopes F3) — the architectural ramifications cascade through schema migration, custom-adapter compatibility, and the partial-write-corruption defense.

## Key Findings

### Recommended Stack

**Headline: no install delta required.** Every v0.7.0 feature is implementable with the dependencies already pinned in v0.6.1. One *optional* patch bump (`@simplewebauthn/server` 13.2.3 → 13.3.0) is available for IDN/punycode improvements but unnecessary.

**Core technologies (all already pinned):**
- `@simplewebauthn/server` `^13.2.3` — already accepts `expectedRPID: string | string[]` and `expectedOrigin: string | string[]` (multi-RP_ID supported since library v1.0.0).
- `zod` `^4.3.6` — validates consumer-supplied hook return shapes.
- `pino` `^10.3.1` — already wired with redact paths; reused for hook-error logging and analytics-failure WARN-level logs.
- Node built-in `crypto` — `createHash('sha256')` for any hashed analytics fields; `randomUUID()` for idempotency keys.
- Existing tooling unchanged — `tsup@^8.5.1`, `vitest@^4.0.18`, `typescript@^5.9.3` (strict OFF), `@types/express@^5.0.6`. No externalisation changes.

**Explicitly rejected:** `bcrypt`/`argon2` (codename is not a secret); `eventemitter3`/`mitt` (5 hooks is a small fixed set, callback object is type-safer); `tsyringe`/DI (manual DI via `createAnonAuth()` factory is sufficient); `ua-parser-js` (forces a dep just for analytics UA-family extraction — defer).

### Expected Features

All five candidate features are P1.

**Must have (table stakes):**
- F1 Backup-eligibility flags — expose `deviceType: 'singleDevice' | 'multiDevice'` and `backedUp: boolean` on `/register/finish` and `/login/finish`; persist BS state on every login (it can flip 0→1 over the credential lifetime).
- F2 Second-factor enrolment hook — optional `hooks.afterPasskeyVerify(ctx)` async callback running after passkey verification but before session creation; `{ continue: true }` proceeds, `{ continue: false, status, body }` short-circuits.
- F3 Lazy-backfill hook — optional `hooks.backfillKeyBundle(ctx)` for pre-v0.6.0 NULL-bundle accounts, fires once per login on accounts that need it, gated by `WHERE key_bundle IS NULL` predicate. **Note: data-ownership framing unresolved.**
- F4 Multi-RP_ID — `rp.relatedOrigins` config field accepting paired tuples (`Array<{ origin, rpId }>`); 5-origin cap; consumer hosts `/.well-known/webauthn`; library validates at startup.
- F5 Registration analytics hook — fire-and-forget `hooks.onAuthEvent(event)` with bounded event/reason enums; type-level PII whitelist (no `codename`, `nearAccountId`, `userId`, `ip`, `userAgent`); anonymity-invariant unit test.

**Should have (differentiators — ship if cheap per phase):**
- F1 same flags on `GET /session`; `CredentialDeviceType` enum export.
- F4 `generateWellKnownWebauthn(config)` helper; `mountWellKnownWebauthn(app, config)` opt-in middleware; client-side capability probe.
- F5 `event.capabilities` (depends on F1); `event.latencyMs`; `event.userAgentFamily` (only without new dep).
- F3 idempotency on backfill endpoint; backfill telemetry counters threaded through F5.

**Defer (v0.8+):** F2 `hooks.beforePasskeyVerify`; F5 EventEmitter multi-subscriber; F5 UA-family extraction with parser dep; pre-flight `getClientCapabilities()` probes.

**25 explicit anti-features** (no TOTP/SMS bundling; no 2FA state in library schema; no auto-host `.well-known`; no wildcard origins; no synchronous analytics hooks; no `req`/`res`/`AnonUser` to analytics; no open-ended `metadata` fields).

### Architecture Approach

All five features live above the frozen `MPCAccountManager` contract — none touch `mpc.ts`. Pattern is uniform: extend `AnonAuthConfig` with optional fields, thread through `createAnonAuth → createRouter → handler`, invoke at well-defined lifecycle points.

**Major components:**
1. `AnonAuthConfig.hooks` extension (cross-cutting) — optional callback object holding `afterPasskeyVerify`, `backfillKeyBundle`, `onAuthEvent`. Single shared type.
2. `src/server/router.ts` (modified for F1, F2, F3, F5) — primary insertion point.
3. `src/server/passkey.ts` + `src/server/webauthn.ts` (modified for F1, F4) — F4 widens `expectedRPID`/`expectedOrigin` to array form; F1 surfaces existing `passkeyData.backedUp` and `.deviceType` (already extracted, currently discarded).
4. `src/server/backup.ts` (new for F1) — `deriveBackupEligibility(passkeyData)` helper; single source of truth.
5. `src/server/analytics.ts` (new for F5) — `AnalyticsHook`, `AnalyticsEvent` discriminated union, `wrapAnalytics(hook, opts)` safe emitter (fire-and-forget + error suppression + opt-in await).
6. `AnonAuthConfig.rp.relatedOrigins` (new for F4) — `Array<{ origin: string; rpId: string }>` paired-tuple type (NOT two parallel string arrays — see R3).

**File-touch summary:** `src/types/index.ts` (all 5); `src/server/router.ts` (F1, F2, F3, F5); `src/server/passkey.ts`/`webauthn.ts` (F1, F4); `src/server/oauth/router.ts` (F5 only); new `backup.ts` (F1) + `analytics.ts` (F5); client `api.ts` + `useAnonAuth.tsx` (F1 mandatory, F2/F3 optional); `db/adapters/postgres.ts` — **NO CHANGE under pass-through F3 framing; SCHEMA MIGRATION under library-managed F3 framing.**

### Critical Pitfalls

21 pitfalls catalogued across 5 features; 3 elevated to top-3 status (pre-merge gates):

1. **R1 — Lazy backfill partial-write corruption (3-B).** Concurrent logins or mid-write crash leave a user with `sealing_key` set but `key_bundle` NULL — permanent decryption failure, worse than no backfill. **Prevention:** wrap in `db.transaction()`; guard with `WHERE key_bundle IS NULL` predicate (idempotent); concurrent-login test asserts exactly one write.
2. **R2 — Analytics PII leak via event SHAPE (5-A).** If event type contains `codename`/`nearAccountId`/`ip`/`userAgent`, even careful runtime filtering loses to a consumer piping the whole event to Datadog/Splunk. Once leaked to third-party warehouse, anonymity broken irreversibly. **Prevention:** type-level whitelist (`AnalyticsEvent` is a discriminated union with no PII fields); tsc-fail fixture asserts `event.codename` does not type-check; runtime whitelist as defense-in-depth.
3. **R3 — Multi-RP_ID origin spoofing via mis-configured array (4-C).** Naively widening `expectedRPID` and `expectedOrigin` to two parallel arrays creates a pairing-mismatch attack. **Prevention:** `relatedOrigins: Array<{ origin, rpId }>` paired-tuple type; startup validation (https only, no wildcards, host has rpId as suffix-domain); regression test asserts spoofed origin → `verified: false`.

**Other notable pitfalls:** 1-A (`backedUp` is per-credential, per-assertion — document lifecycle); 1-B (`backedUp` + `transports` together fingerprint authenticator class — server-side only by default); 2-A (2FA hook firing after session creation = "logged in but not enrolled" — defer `sessionManager.createSession()` until hook resolves); 2-C (SMS/email 2FA breaks anonymity invariant — `userType` discriminator + passkey-as-2FA canonical example); 3-D (pre-v0.6.0 IPFS recovery blob orphaned — leave existing blobs untouched, document dual-recovery); 4-D (cookie domain doesn't follow related-origins — document boundary); 5-E (analytics on failed events leaks credential-stuffing data — failure events opt-in, success-only default).

## Implications for Roadmap

### Researcher Phase-Order Comparison

**Areas of agreement (HIGH-confidence input to roadmapper):**
- F1 first — universal: smallest blast radius, produces shared `BackupEligibility` type.
- F4 fully orthogonal — can land anywhere, no dependency.
- F2 and F3 most invasive — should land after simpler features.
- F5 should be late so it can instrument prior fields without re-instrumentation.

**Areas of disagreement (roadmapper to decide):**

| Source | Phase order | Trade-off |
|---|---|---|
| Features researcher | F1 → F4 → F5 → F2 → F3 | Frontloads low-risk; pushes most-complex (F3) to last for max context |
| Architecture researcher | F1 → F4 → F3 → F2 → F5 | Builds hook-injection muscle on F3 first (no transaction interaction) before F2; F5 last to sweep prior fields |
| Pitfalls researcher | F1 (with F3 schema in P1) → F2 → F3 → F4 → F5 | Treats schema migration as P1 prereq under library-managed F3; orders by pitfall-resolution gates |

Pitfalls' P1 schema-migration framing only applies under library-managed F3.

### Open Questions for Requirements (must resolve before roadmap)

**F3 Lazy-backfill data-ownership framing.** Two incompatible spec readings:

| Framing | Source | Implication |
|---|---|---|
| Pass-through hook (consumer owns schema) | Architecture | No library DB change; library invokes consumer's `hooks.backfillKeyBundle`; consumer manages own DB tx; hook return is a structural pure value. |
| Library-managed schema (library owns columns) | Pitfalls | Library adds `key_bundle BYTEA` + `sealing_key_hex TEXT` via `ALTER TABLE … IF NOT EXISTS`; new optional `getUserKeyBundle`/`setUserKeyBundle` `DatabaseAdapter` methods (matching Phase 5 optional-method pattern); library wraps backfill in own transaction with `WHERE key_bundle IS NULL` predicate. |

**Recommendation for roadmapper:** Surface as the first decision in REQUIREMENTS.md.

**Other open questions:**
- F2 hook timing — Architecture's Option A (inline hook inside `/register/finish`, recommended) vs Option B (session-claim with `secondFactorPending`).
- F2 OAuth router integration — does OAuth login fire same hook? Hook may need renaming from `afterPasskeyVerify` to `afterAuthSuccess`.
- F4 startup-fetch validation of `/.well-known/webauthn` — table-stakes (Pitfalls leans this way) vs differentiator (Features lists it as differentiator).
- F5 `awaitAnalytics` opt-in name — pick canonical form in requirements.

### Suggested Phase Structure (synthesized)

**Phase 1 — Backup-Eligibility Flags + Hooks Scaffolding.** Pure plumbing (~50 LOC; values already extracted from `passkeyData`, currently discarded). Lands shared `HooksConfig` type for F2/F3/F5. Produces `BackupEligibility` for F5 capabilities. Validates "additive optional response field" pattern. **If F3 is library-managed, schema migration also lands here.**

**Phase 2 — Multi-RP_ID Verification (F4).** Fully orthogonal; Stack confirms `^13.2.3` already supports array form (no version bump). Doing this early frees later phases from cross-cutting RPID concern. **R3 origin-spoofing defense is load-bearing.**

**Phase 3 — Registration Analytics Hook (F5).** *Promoted earlier than Architecture researcher's order* because R2 type-level PII whitelist is the highest-priority defense in the milestone — landing it before F2/F3 means subsequent features are tested against it from the start. ~100–150 LOC; reuses Phase 1 scaffolding.

**Phase 4 — Second-Factor Enrolment Hook (F2).** Most-invasive cross-cutting. Sits inside existing `db.transaction()` block; defers session creation; has MPC-funding-orphan edge case. After F4/F5 to leverage mature scaffolding and Phase 3 analytics events.

**Phase 5 — Lazy-Backfill Hook (F3).** Most complex (3–5 day phase). Lands last so rest of milestone is locked down. **R1 partial-write defense is load-bearing.**

**Phase 6 — Release Prep.** README polish, CHANGELOG, version bump, npm publish dry-run, smoke install in downstream consumer fixture, retrospective.

### Phase Ordering Rationale

This synthesis (F1 → F4 → F5 → F2 → F3 → release prep) is identical in shape to the Features researcher's order. F5 promotion is the single highest-leverage move: R2 has the worst recovery cost (irreversibly leaked to third-party warehouses) of any pitfall — landing the type-level whitelist early means F2/F3 are tested against it, not retrofitted. Roadmapper may legitimately prefer Architecture researcher's F1→F4→F3→F2→F5 instead.

### Research Flags

**Phases likely needing `/gsd-research-phase` during planning:**
- **Phase 5 (F3 Lazy-backfill)** — open data-ownership question; concurrent-write corruption defense has no precedent in this codebase; IPFS blob versioning is new persisted state.
- **Phase 4 (F2 2FA hook)** — MPC-funded-but-rolled-back trade-off needs JSDoc + test articulation; `userType` payload discriminator design; OAuth router integration; idempotency-key derivation strategy.

**Phases with well-documented patterns (likely skip research):**
- Phase 1 — pure plumbing of already-extracted values.
- Phase 2 — `@simplewebauthn/server` API verified; paired-tuple is the only design decision.
- Phase 3 — pattern established (Better Auth, Authsignal, Auth0); type-level whitelist follows existing v0.6.1 MPC-07 tsc-fail pattern.
- Phase 6 — standard close-out, done 3x before.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified directly against `package.json`, `@simplewebauthn/server` master source, official docs, changelog. Three independent sources confirm multi-RP_ID array support. Zero new deps required. |
| Features | HIGH | Direct surface inspection. Industry conventions cross-referenced against W3C, browser release notes, Better-Auth, SimpleWebAuthn, Authsignal, Auth0, SuperTokens, NIST. 25 anti-features explicit. |
| Architecture | HIGH | Codebase inspection identified exact line numbers for every modification site. Frozen `MPCAccountManager` contract verified intact. Two architectural decisions surfaced for requirements. |
| Pitfalls | HIGH | 21 pitfalls catalogued, 3 elevated with pre-merge gates. Codebase-specific HIGH; upstream WebAuthn behavior MEDIUM. Pitfall-to-phase mapping complete. |

**Overall confidence: HIGH.** All four researchers agree on major recommendations.

### Gaps to Address at Requirements Time

- **F3 data-ownership framing (CRITICAL).** Pass-through vs library-managed.
- **F2 hook timing.** Inline (Option A, recommended) vs session-claim (Option B).
- **F2 OAuth router integration.** Same hook for OAuth login?
- **F4 helper-export differentiators.** Startup `/.well-known/webauthn` validation as table-stake or differentiator.
- **F5 UA-family extraction.** Defer-to-v0.8 is the safe call.
- **F5 sync vs async semantics.** Fire-and-forget by default; opt-in flag name to be picked.

## Sources

### Primary (HIGH confidence)
- Direct source reads: `package.json`; `src/server/passkey.ts:170, 197, 198, 277`; `src/server/webauthn.ts:64, 96, 122, 159, 233-270`; `src/server/router.ts:178-244, 213-221, 235-239, 284, 307, 312-315`; `src/server/db/adapters/postgres.ts:30-132`; `src/server/recovery/ipfs.ts:59-91`; `src/server/validation/schemas.ts:38-43`; `src/types/index.ts:60, 71-96, 386, 398`; `src/server/codename.ts`.
- [@simplewebauthn/server official docs](https://simplewebauthn.dev/docs/packages/server)
- [SimpleWebAuthn server source — verifyAuthenticationResponse.ts](https://github.com/MasterKale/SimpleWebAuthn/blob/master/packages/server/src/authentication/verifyAuthenticationResponse.ts)
- [SimpleWebAuthn CHANGELOG.md](https://github.com/MasterKale/SimpleWebAuthn/blob/master/CHANGELOG.md)
- [W3C webauthn issues #1933, #1791, #1788, #1692, PR #1695](https://github.com/w3c/webauthn)
- [NIST SP 800-63-4 — Syncable Authenticators](https://pages.nist.gov/800-63-4/sp800-63b/syncable/)
- [Related Origin Requests — passkeys.dev](https://passkeys.dev/docs/advanced/related-origins/)
- [web.dev — Allow passkey reuse with ROR](https://web.dev/articles/webauthn-related-origin-requests)
- [W3C — Well-Known URL for Relying Party Passkey Endpoints](https://www.w3.org/TR/passkey-endpoints/)

### Secondary (MEDIUM confidence)
- [Better Auth — Hooks documentation](https://better-auth.com/docs/concepts/hooks)
- [Authsignal — passkey step-up auth](https://www.authsignal.com/blog/articles/how-to-add-passkey-step-up-auth-in-your-app)
- [Auth0 — Step-up Authentication (RFC 9470)](https://auth0.com/docs/secure/multi-factor-authentication/step-up-authentication)
- [Auth0 — Configure Automatic Migration](https://auth0.com/docs/manage-users/user-migration/configure-automatic-migration-from-your-database)
- [SuperTokens — Migrating users without downtime](https://supertokens.com/blog/migrating-users-without-downtime-in-your-service)
- [Levi Schuck — WebAuthn related origins](https://levischuck.com/blog/2024-07-related-origins)
- [Corbado — Device-Bound vs. Synced Passkeys](https://www.corbado.com/blog/device-bound-synced-passkeys)
- [Yubico — WebAuthn Browser Support](https://developers.yubico.com/WebAuthn/WebAuthn_Browser_Support/)
