# Requirements: near-phantom-auth v0.7.0 — Consumer Hooks & Recovery Hardening

**Defined:** 2026-04-29
**Core Value:** Every security-sensitive code path must be correct, tested, and production-safe. v0.7.0 expands the consumer surface (hooks, multi-domain, analytics) without compromising the anonymity invariant or breaking the frozen `MPCAccountManager` contract.

## Locked decisions (resolved before requirements drafting)

- **F3 lazy-backfill ownership:** **Pass-through hook**. Library invokes consumer's hook on `/login/finish`; consumer owns the schema and DB transaction. **No library schema migration in this milestone.**
- **F2 2FA hook timing:** **Inline, blocks session creation.** Hook fires after passkey verify + DB persist + MPC funding, BEFORE `sessionManager.createSession`. Hook throw → DB rollback (existing transaction wrapper).
- **F2 OAuth integration:** **Hook fires for OAuth too.** Renamed from `afterPasskeyVerify` to `hooks.afterAuthSuccess`. Fires on `/register/finish`, `/login/finish`, and OAuth `/callback` success.
- **F5 sync mode:** **`awaitAnalytics: boolean`** opt-in flag at top level of `AnonAuthConfig`. Default false (fire-and-forget).

## v1 Requirements

Requirements for v0.7.0. Each maps to roadmap phases.

### Backup-Eligibility Flag Exposure (F1)

- [ ] **BACKUP-01**: `/register/finish` response includes `passkey: { backedUp: boolean; backupEligible: boolean }` (additive optional nested key); existing fields unchanged.
- [ ] **BACKUP-02**: `/login/finish` response includes the same `passkey: { backedUp; backupEligible }` shape; library re-reads `backedUp` from the assertion (BS bit can flip 0→1 over the credential lifetime) and persists fresh value to `anon_passkeys.backed_up` on each successful login.
- [ ] **BACKUP-03**: Standalone `verifyRegistration()` (`src/server/webauthn.ts`) returns `credential.backupEligible` (computed `deviceType === 'multiDevice'`) alongside existing `credential.backedUp`; documented in JSDoc.
- [ ] **BACKUP-04**: React `useAnonAuth` hook surfaces `passkeyBackedUp: boolean | null` and `passkeyBackupEligible: boolean | null` on `AnonAuthState`; populated from `register()` and `login()` response.
- [x] **BACKUP-05**: Internal `deriveBackupEligibility(passkeyData)` helper in `src/server/backup.ts` is the single source of truth for the deviceType→backupEligible mapping; used by both router and standalone webauthn entry.

### Hooks Scaffolding + 2FA Enrolment Hook (F2)

- [x] **HOOK-01**: `AnonAuthConfig.hooks` field accepts an optional callbacks object: `{ afterAuthSuccess?, backfillKeyBundle?, onAuthEvent? }`. Threaded through `createAnonAuth → createRouter / createOAuthRouter`. All callbacks optional; absent hooks → behavior identical to v0.6.1.
- [ ] **HOOK-02**: `hooks.afterAuthSuccess(ctx)` fires inside `/register/finish` after DB persist + MPC funding, before `sessionManager.createSession`. Hook receives `{ userId, codename, nearAccountId, authMethod: 'passkey-register', req }` and returns `Promise<{ continue: true } | { continue: false; status: number; body: object }>`. `continue: false` returns the consumer's `body` with the supplied `status` and skips session creation. Hook throw → DB rollback via existing `db.transaction()` wrapper.
- [ ] **HOOK-03**: Same hook fires inside `/login/finish` (`authMethod: 'passkey-login'`) after passkey verify, before session creation. Same return-shape contract.
- [ ] **HOOK-04**: Same hook fires inside OAuth `/callback` (`authMethod: 'oauth-google' | 'oauth-github' | 'oauth-twitter'`) after token exchange + user resolution, before session creation. `provider` exposed on `ctx`.
- [ ] **HOOK-05**: `/register/finish`, `/login/finish`, and OAuth callback responses include `secondFactor?: { status: number; body: object }` echo when hook returned `continue: false`; absent on `continue: true`.
- [ ] **HOOK-06**: README documents the MPC-funded-but-rolled-back failure mode (MPC `createAccount` runs BEFORE the transaction, so a hook throw leaves an orphaned MPC account with no DB record). Recommended mitigation: hook is idempotent and non-throwing, returning `{ continue: false }` for soft failures.

### Lazy-Backfill Hook (F3 — pass-through)

- [ ] **BACKFILL-01**: `hooks.backfillKeyBundle(ctx)` fires inside `/login/finish` after passkey verify, before session creation, ONLY when `sealingKeyHex` was supplied in the request body (no PRF → no fresh sealing key → skip). Hook receives `{ userId, codename, nearAccountId, sealingKeyHex, req }`.
- [ ] **BACKFILL-02**: Hook returns `Promise<{ backfilled: boolean; reason?: 'already-current' | 'no-legacy-data' | 'completed' | 'skipped' }>`. Result echoed on response under `backfill?: { backfilled, reason }` (additive).
- [ ] **BACKFILL-03**: Hook errors are contained — failure does NOT block login. Library catches the throw, logs WARN with redacted error, returns response with `backfill: { backfilled: false, reason: 'skipped' }`. (Anti-pitfall: backfill failure must never lock a user out.)
- [ ] **BACKFILL-04**: README documents the consumer-owns-schema contract: library does not persist key bundles, does not run a transaction around backfill, does not migrate existing IPFS recovery blobs (those remain consumer-owned and may be orphaned if the consumer's backfill replaces the recovery method).

### Multi-RP_ID Verification (F4)

- [ ] **RPID-01**: `AnonAuthConfig.rp.relatedOrigins?: Array<{ origin: string; rpId: string }>` accepts paired tuples (NOT two parallel arrays). Default: `[]` → behavior identical to v0.6.1 (single rpId).
- [ ] **RPID-02**: Library validates `relatedOrigins` at `createAnonAuth()` startup: each `origin` must be `https://` (or `http://localhost` for dev), no wildcards, host must be a suffix-domain of the `rpId`. Validation throws with classified message; max 5 entries.
- [ ] **RPID-03**: `verifyRegistrationResponse` and `verifyAuthenticationResponse` calls in `src/server/passkey.ts` and `src/server/webauthn.ts` pass paired arrays: `expectedOrigin: [primaryOrigin, ...relatedOrigins.map(o => o.origin)]` and `expectedRPID: [primaryRpId, ...relatedOrigins.map(o => o.rpId)]`. The pairing is preserved by index — library docstring asserts this contract.
- [ ] **RPID-04**: Standalone `verifyRegistration()` and `verifyAuthentication()` types widen `expectedRPID` and `expectedOrigin` to `string | string[]`; `string` form preserved for backwards compatibility.
- [ ] **RPID-05**: README documents the `/.well-known/webauthn` consumer responsibility (library does NOT auto-host); links to passkeys.dev and the W3C Passkey Endpoints spec; provides a copy-pasteable JSON skeleton.

### Registration Analytics Hook (F5)

- [ ] **ANALYTICS-01**: `hooks.onAuthEvent(event)` fires at lifecycle boundaries on the passkey router, OAuth router, recovery endpoints, and account-deletion endpoint. Events: `register.{start, finish.success, finish.failure}`, `login.{start, finish.success, finish.failure}`, `recovery.{wallet.link.success, wallet.recover.success, ipfs.setup.success, ipfs.recover.success}`, `oauth.callback.success`, `account.delete`.
- [ ] **ANALYTICS-02**: `AnalyticsEvent` is a discriminated union in `src/server/analytics.ts`. Type forbids `userId`, `codename`, `nearAccountId`, `email`, raw `ip`, raw `userAgent` on every variant. Allowed fields: `type`, `rpId`, `timestamp`, `provider` (OAuth only), `backupEligible` (success events only), static-enum `reason` (failure events only — never `Error.message`), `codenameProvided: boolean` (login.start only — does NOT include the codename itself).
- [ ] **ANALYTICS-03**: Type-level enforcement via tsc-fail fixture (mirroring v0.6.1 MPC-07 pattern): a `__tsc_fail/analytics-pii-leak.test.ts` file demonstrates that adding `codename` or `nearAccountId` to the event union causes `tsc --noEmit` to fail. Verified via child-process tsc invocation in vitest.
- [ ] **ANALYTICS-04**: `wrapAnalytics(hook, opts)` in `src/server/analytics.ts` provides safe emit: fire-and-forget by default (does not block response), errors swallowed with WARN-level pino log carrying redacted error message. `opts.await: true` (driven by `AnonAuthConfig.awaitAnalytics`) switches to awaited emit.
- [ ] **ANALYTICS-05**: PII assertion test snapshots all event variants, asserts each variant's keys are a subset of the allowed-fields whitelist. Test fails if a future change adds a key not in the whitelist.
- [ ] **ANALYTICS-06**: Failure events (`*.finish.failure`) are emitted by default. README documents that consumers consuming analytics in privacy-restricted environments may filter by `event.type` if they want success-only.

### Release Prep

- [ ] **RELEASE-01**: README updated with new "Hooks (v0.7.0)" top-level section covering `hooks.afterAuthSuccess`, `hooks.backfillKeyBundle`, `hooks.onAuthEvent`, `rp.relatedOrigins`, `awaitAnalytics`. Includes consumer-owns-schema callout, MPC orphan trade-off note, anonymity-invariant guarantee, and 5-origin cap.
- [ ] **RELEASE-02**: CHANGELOG entry for v0.7.0 with feature highlights and additive-only callout.
- [ ] **RELEASE-03**: `package.json` version bumped to `0.7.0`; `npm run build` succeeds; `npm pack` smoke-installs into a fresh-consumer fixture and `import { createAnonAuth } from '@vitalpoint/near-phantom-auth/server'` resolves with new hook surface visible in TypeScript autocomplete.
- [ ] **RELEASE-04**: `npm publish @vitalpoint/near-phantom-auth@0.7.0` succeeds; git tag `v0.7.0` pushed to origin; existing v0.6.1 consumer fixtures continue to compile and run without changes (backwards-compat assertion).

## v2 Requirements (deferred to v0.8+)

These are valuable but explicitly out of scope for v0.7.0.

### Hooks Surface

- **HOOK-V2-01**: `hooks.beforePasskeyVerify` — pre-verification hook for rate-limit overrides or custom challenge inspection.
- **HOOK-V2-02**: EventEmitter-style multi-subscriber API on `onAuthEvent`.

### Analytics Differentiators

- **ANALYTICS-V2-01**: `event.userAgentFamily` derived field requires a UA-parser dependency — defer; revisit if a consumer asks.
- **ANALYTICS-V2-02**: `event.latencyMs` — server-side latency observation per request lifecycle.
- **ANALYTICS-V2-03**: `event.capabilities` exposing PRF / multi-device / synced-passkey capability bits per session.

### Multi-RP_ID Helpers

- **RPID-V2-01**: `generateWellKnownWebauthn(config)` pure-function helper that builds the JSON document consumers serve at `/.well-known/webauthn`.
- **RPID-V2-02**: `mountWellKnownWebauthn(app, config)` opt-in Express middleware.
- **RPID-V2-03**: Client-side capability probe via `PublicKeyCredential.getClientCapabilities()`.

### Backfill Differentiators

- **BACKFILL-V2-01**: `idempotencyKey` parameter on backfill ceremonies for retried requests.
- **BACKFILL-V2-02**: Backfill telemetry counters threaded through F5 analytics.

## Out of Scope

Explicitly excluded from v0.7.0. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Library-managed `key_bundle` schema migration | Decided pass-through ownership; consumer owns key-bundle persistence (see Locked Decisions) |
| TOTP / SMS / email second-factor implementation | Library is not in the secret-storage business; consumer brings own factor |
| 2FA enrolment state column on `anon_users` | Library does NOT track 2FA state; consumer persists it (anti-feature AF-06) |
| Auto-hosting `/.well-known/webauthn` route | Library would need request-routing concerns it doesn't own; consumer hosts |
| Wildcard origins in `rp.relatedOrigins` | Origin-spoofing attack surface; library validates and rejects |
| EventEmitter for analytics | Wrong semantics — leaks listener errors silently, no Promise contract |
| `req`, `res`, or `AnonUser` passed to analytics hooks | PII leak surface; only sanitized fields in event payload |
| Open-ended `metadata: Record<string, unknown>` on analytics events | PII leak temptation; bounded enum only |
| Synchronous-by-default analytics | Latency leakage on every auth call; fire-and-forget by default |
| OAuth router PII in events | OAuth has email/profile data; analytics events emit `provider` only, never user-identifying fields |
| Backfill blocking login on hook error | Backfill failure must never lock a user out; hook errors contained |
| Renaming any `MPCAccountManager` field, method, or return-shape key | FROZEN by consumer pin; would require coordinated PR |
| Resolving the 6 cross-browser PRF UAT scenarios | Carry-over from v0.6.0; needs physical Firefox/Safari/hardware key devices; tracked in `STATE.md > Deferred Items` |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BACKUP-01 | Phase 11 | Pending |
| BACKUP-02 | Phase 11 | Pending |
| BACKUP-03 | Phase 11 | Pending |
| BACKUP-04 | Phase 11 | Pending |
| BACKUP-05 | Phase 11 | Complete |
| HOOK-01 | Phase 11 | Complete |
| HOOK-02 | Phase 14 | Pending |
| HOOK-03 | Phase 14 | Pending |
| HOOK-04 | Phase 14 | Pending |
| HOOK-05 | Phase 14 | Pending |
| HOOK-06 | Phase 14 | Pending |
| BACKFILL-01 | Phase 15 | Pending |
| BACKFILL-02 | Phase 15 | Pending |
| BACKFILL-03 | Phase 15 | Pending |
| BACKFILL-04 | Phase 15 | Pending |
| RPID-01 | Phase 12 | Pending |
| RPID-02 | Phase 12 | Pending |
| RPID-03 | Phase 12 | Pending |
| RPID-04 | Phase 12 | Pending |
| RPID-05 | Phase 12 | Pending |
| ANALYTICS-01 | Phase 13 | Pending |
| ANALYTICS-02 | Phase 13 | Pending |
| ANALYTICS-03 | Phase 13 | Pending |
| ANALYTICS-04 | Phase 13 | Pending |
| ANALYTICS-05 | Phase 13 | Pending |
| ANALYTICS-06 | Phase 13 | Pending |
| RELEASE-01 | Phase 16 | Pending |
| RELEASE-02 | Phase 16 | Pending |
| RELEASE-03 | Phase 16 | Pending |
| RELEASE-04 | Phase 16 | Pending |

**Coverage:**
- v1 requirements: 30 total
- Mapped to phases: 30 ✓
- Unmapped: 0 ✓
- Double-mapped: 0 ✓

**Phase coverage breakdown:**
- Phase 11 (Backup-Eligibility + Hooks Scaffolding): 6 reqs (BACKUP-01..05, HOOK-01)
- Phase 12 (Multi-RP_ID): 5 reqs (RPID-01..05)
- Phase 13 (Analytics Hook): 6 reqs (ANALYTICS-01..06)
- Phase 14 (2FA Hook): 5 reqs (HOOK-02..06)
- Phase 15 (Lazy-Backfill): 4 reqs (BACKFILL-01..04)
- Phase 16 (Release Prep): 4 reqs (RELEASE-01..04)
- Total: 30 ✓

---
*Requirements defined: 2026-04-29*
*Last updated: 2026-04-29 — roadmap created; 30 v1 requirements mapped across Phases 11–16; coverage 100%.*
