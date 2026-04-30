# Roadmap: near-phantom-auth

## Milestones

- ✅ **v0.5.x Hardening** — Phases 1–8 (shipped 2026-03-14 to 2026-03-15; not formally closed at the time)
- ✅ **v0.6.0 PRF Extension** — Phase 9 (shipped 2026-03-15; deferred PRF browser-test items remain — see `STATE.md > Deferred Items`)
- ✅ **v0.6.1 MPCAccountManager hotfix** — Phase 10 (shipped 2026-04-29; published as `@vitalpoint/near-phantom-auth@0.6.1`) — see [milestones/v0.6.1-ROADMAP.md](milestones/v0.6.1-ROADMAP.md)
- 🚧 **v0.7.0 Consumer Hooks & Recovery Hardening** — Phases 11–16 (planning 2026-04-29; 30 v1 requirements across 6 phases; additive minor bump on top of v0.6.1)

## Phases

<details>
<summary>✅ v0.5.x Hardening (Phases 1–8) — SHIPPED 2026-03-15</summary>

The initial hardening milestone (35 requirements covering input validation, CSRF, structured logging, rate limiting, OAuth state DB-backing, email integration, and test coverage). Phases were not formally closed via `/gsd-complete-milestone` at the time — they're archived alongside Phase 10 in `milestones/v0.6.1-ROADMAP.md` for historical traceability.

- [x] Phase 1: Atomic Security Fixes (3/3 plans) — completed 2026-03-14
- [x] Phase 2: Input Validation (2/2 plans) — completed 2026-03-14
- [x] Phase 3: Structured Logging (2/2 plans) — completed 2026-03-14
- [x] Phase 4: HTTP Defenses (3/3 plans) — completed 2026-03-14
- [x] Phase 5: DB Integrity and Functional Stubs (3/3 plans) — completed 2026-03-14
- [x] Phase 6: Scalability, Tech Debt, and Email (4/4 plans) — completed 2026-03-14
- [x] Phase 7: Test Coverage (4/4 plans) — completed 2026-03-15
- [x] Phase 8: Wire OAuth Callback to DB-Backed State Validation (1/1 plan) — completed 2026-03-15

</details>

<details>
<summary>✅ v0.6.0 PRF Extension (Phase 9) — SHIPPED 2026-03-15</summary>

WebAuthn PRF (Pseudo-Random Function) extension for DEK sealing key derivation. PRF-capable authenticators return a deterministic 32-byte sealing key per credential, hex-encoded as `sealingKeyHex` on `/register/finish` and `/login/finish`. Graceful degradation on Firefox / older authenticators; opt-in `requirePrf` enforcement available.

- [x] Phase 9: WebAuthn PRF Extension for DEK Sealing Key (3/3 plans) — completed 2026-03-15

**Deferred items at close:** 2 (cross-browser PRF testing on Firefox/Safari/hardware keys — needs physical devices). Tracked in `STATE.md > Deferred Items`.

</details>

<details>
<summary>✅ v0.6.1 MPCAccountManager hotfix (Phase 10) — SHIPPED 2026-04-29</summary>

Surgical hotfix for the v0.6.0 production bug where `MPCAccountManager` was `export type`-stripped to `undefined` at runtime, breaking the Ledgera mpc-sidecar consumer. Additive only: all v0.6.0 exports unchanged; 12 new MPC-* requirements (MPC-01 through MPC-12) closed.

- [x] Phase 10: MPCAccountManager (6/6 plans) — completed 2026-04-29

**Published:** `@vitalpoint/near-phantom-auth@0.6.1` to npm; git tag `v0.6.1` pushed to origin.

</details>

<details>
<summary>🚧 v0.7.0 Consumer Hooks & Recovery Hardening (Phases 11–16) — PLANNING 2026-04-29</summary>

Additive minor bump exposing five consumer-facing extension points: backup-eligibility flag exposure, second-factor enrolment hook (`hooks.afterAuthSuccess`, fires on passkey AND OAuth), lazy-backfill hook for pre-v0.6.0 NULL-bundle accounts (pass-through framing — library does NOT touch its schema), multi-RP_ID verification (cross-domain passkey support), and a privacy-preserving registration analytics hook (`hooks.onAuthEvent`). 30 v1 requirements across 6 phases. **Anonymity invariant non-negotiable. `MPCAccountManager` contract FROZEN. Zero new dependencies.**

- [ ] **Phase 11: Backup-Eligibility Flags + Hooks Scaffolding** (6 plans) — surfaces `passkey: { backedUp, backupEligible }` on register/login responses; lands shared `AnonAuthConfig.hooks` callback-object type that F2/F3/F5 plug into
- [ ] **Phase 12: Multi-RP_ID Verification** (TBD plans) — `rp.relatedOrigins` paired-tuple config; `expectedOrigin` / `expectedRPID` widened to array form; R3 origin-spoofing defense (startup validation, max 5 entries)
- [ ] **Phase 13: Registration Analytics Hook** (TBD plans) — `hooks.onAuthEvent` fire-and-forget callback with type-level PII whitelist; tsc-fail fixture (R2 highest-priority defense, lands before F2/F3 so subsequent phases are tested against it); `awaitAnalytics: boolean` opt-in
- [ ] **Phase 14: Second-Factor Enrolment Hook** (TBD plans) — `hooks.afterAuthSuccess` fires inline inside transaction, blocks session creation, on passkey-register / passkey-login / oauth-callback (3 instrumentation sites); MPC-funded-but-rolled-back trade-off documented
- [ ] **Phase 15: Lazy-Backfill Hook** (TBD plans) — `hooks.backfillKeyBundle` pass-through; library does NOT persist bundles or migrate IPFS recovery blobs; backfill failure NEVER blocks login (BACKFILL-03 contract)
- [ ] **Phase 16: Release Prep** (TBD plans) — README "Hooks (v0.7.0)" section, CHANGELOG, version bump to 0.7.0, build, smoke install, npm publish, git tag, backwards-compat assertion

**Total v1 requirements:** 30 (BACKUP-01..05, HOOK-01..06, BACKFILL-01..04, RPID-01..05, ANALYTICS-01..06, RELEASE-01..04)

</details>

## Phase Details

### Phase 11: Backup-Eligibility Flags + Hooks Scaffolding
**Milestone:** v0.7.0
**Goal:** Surface backup-eligibility flags on register/login responses and land the shared `AnonAuthConfig.hooks` scaffolding type that subsequent phases (F2 2FA, F3 backfill, F5 analytics) plug into. Smallest blast radius — pure plumbing of values already extracted from `passkeyData`.
**Depends on:** v0.6.1 (shipped — `MPCAccountManager` contract FROZEN)
**Requirements:** BACKUP-01, BACKUP-02, BACKUP-03, BACKUP-04, BACKUP-05, HOOK-01
**Success Criteria** (what must be TRUE):
  1. A consumer calling `POST /register/finish` receives an additive `passkey: { backedUp: boolean; backupEligible: boolean }` nested key alongside the existing `{ success, codename, nearAccountId }` response — old fields unchanged, no breaking diff.
  2. A consumer calling `POST /login/finish` receives the same `passkey: { backedUp; backupEligible }` shape, with `backedUp` re-read from the assertion on every login (BS bit can flip 0→1) and persisted to `anon_passkeys.backed_up`.
  3. A consumer importing the standalone `verifyRegistration()` from `/server` sees `credential.backupEligible` (computed `deviceType === 'multiDevice'`) on the result, with JSDoc documenting the BE/BS lifecycle.
  4. A React consumer using `useAnonAuth` reads `passkeyBackedUp` and `passkeyBackupEligible` (both `boolean | null`) from `AnonAuthState` after `register()` or `login()` resolves.
  5. A consumer who passes `hooks: {}` (or omits the field) to `createAnonAuth` sees behavior byte-identical to v0.6.1 — `AnonAuthConfig.hooks` is fully optional and absent hooks short-circuit.
**Plans:** 6/6 plans complete
- [x] 11-01-PLAN.md — BACKUP-05 helper + types: deriveBackupEligibility helper, unit tests, RegistrationFinishResponse/AuthenticationFinishResponse passkey? extension
- [x] 11-02-PLAN.md — HOOK-01 scaffolding: AnonAuthHooks type, AnonAuthConfig.hooks?, threading through createRouter + createOAuthRouter, Wave 0 hooks-scaffolding test (compile fixtures + grep guard)
- [x] 11-03-PLAN.md — BACKUP-03 standalone webauthn surface: verifyRegistration() result.credential.backupEligible + BE/BS JSDoc
- [x] 11-04-PLAN.md — BACKUP-01 register response: /register/finish passkey: { backedUp, backupEligible } + supertest
- [x] 11-05-PLAN.md — BACKUP-02 login response + DB persistence: passkey.ts:finishAuthentication FRESH read + optional updatePasskeyBackedUp adapter, /login/finish response, BS-bit-flip-on-login test
- [x] 11-06-PLAN.md — BACKUP-04 React state: useAnonAuth AnonAuthState gains passkeyBackedUp + passkeyBackupEligible (boolean | null)

### Phase 12: Multi-RP_ID Verification
**Milestone:** v0.7.0
**Goal:** Accept passkey assertions from multiple related origins (cross-domain passkey support via WebAuthn Related Origin Requests) without opening an origin-spoofing surface. Fully orthogonal to the hook phases.
**Depends on:** Phase 11 (shared `AnonAuthConfig` extension pattern)
**Requirements:** RPID-01, RPID-02, RPID-03, RPID-04, RPID-05
**Success Criteria** (what must be TRUE):
  1. A consumer configuring `rp.relatedOrigins: [{ origin: 'https://example.io', rpId: 'example.io' }]` (paired-tuple form, NOT two parallel arrays) at `createAnonAuth()` startup successfully verifies passkey assertions arriving from any listed origin.
  2. A consumer passing a malformed `relatedOrigins` (wildcard, non-https, host not suffix-domain of rpId, more than 5 entries) sees `createAnonAuth()` throw with a classified message at startup — no silent acceptance into production.
  3. An attacker on `evil.com` forging an assertion with a spoofed `clientDataJSON.origin` against a multi-RP_ID-enabled instance gets `verified: false` from `verifyAuthenticationResponse` — the paired tuple is preserved by index through to `@simplewebauthn/server`.
  4. A consumer importing standalone `verifyRegistration()` / `verifyAuthentication()` can pass `expectedRPID` and `expectedOrigin` as `string | string[]`; the existing `string` form continues to compile and verify identically (backwards compat).
  5. A consumer reading the README finds the `/.well-known/webauthn` consumer responsibility documented (library does NOT auto-host) with links to passkeys.dev and the W3C Passkey Endpoints spec, plus a copy-pasteable JSON skeleton.
**Plans:** 4/4 plans complete

- [x] 12-01-PLAN.md (Wave 1) — RPID-01 type foundation: RelatedOrigin paired-tuple interface, AnonAuthConfig.rp.relatedOrigins?: optional field, /server re-export, exports.test.ts regression
- [x] 12-02-PLAN.md (Wave 2) — RPID-02 startup-validator helper: pure-function validateRelatedOrigins (https-only, no wildcards, suffix-domain boundary, max 5, duplicate-of-primary) + Wave-0 unit tests (>=12 it() blocks)
- [x] 12-03-PLAN.md (Wave 2) — RPID-04 standalone exports: widen VerifyRegistrationInput / VerifyAuthenticationInput expectedOrigin and expectedRPID to string | string[]; positive compile fixtures
- [x] 12-04-PLAN.md (Wave 3) — RPID-03 + RPID-05 integration: PasskeyConfig.relatedOrigins, createAnonAuth startup-validate, conditional-spread idiom in passkey.ts (preserves string form when empty), README Cross-Domain Passkeys (v0.7.0) section

### Phase 13: Registration Analytics Hook
**Milestone:** v0.7.0
**Goal:** Expose a fire-and-forget `hooks.onAuthEvent` callback that emits bounded lifecycle events to the consumer's analytics pipeline WITHOUT compromising the anonymity invariant. Promoted earlier than Architecture researcher's order so the type-level PII whitelist (R2 highest-priority defense) is in place before F2/F3 land.
**Depends on:** Phase 11 (`AnonAuthConfig.hooks` scaffolding)
**Requirements:** ANALYTICS-01, ANALYTICS-02, ANALYTICS-03, ANALYTICS-04, ANALYTICS-05, ANALYTICS-06
**Success Criteria** (what must be TRUE):
  1. A consumer wiring `hooks.onAuthEvent` receives bounded events at every lifecycle boundary on the passkey router, OAuth router, recovery endpoints, and account-deletion endpoint — `register.{start,finish.success,finish.failure}`, `login.{start,finish.success,finish.failure}`, `recovery.{wallet.link.success, wallet.recover.success, ipfs.setup.success, ipfs.recover.success}`, `oauth.callback.success`, `account.delete`.
  2. A consumer attempting to add `codename`, `userId`, `nearAccountId`, `email`, raw `ip`, or raw `userAgent` to the `AnalyticsEvent` discriminated union sees `tsc --noEmit` fail — verified via the `__tsc_fail/analytics-pii-leak.test.ts` child-process fixture (mirroring v0.6.1 MPC-07).
  3. A consumer whose `onAuthEvent` hook throws or hangs sees their auth requests succeed normally — `wrapAnalytics` swallows errors with a redacted WARN-level pino log; a 5-second hook does NOT add 5 seconds to login latency.
  4. A consumer setting `awaitAnalytics: true` at the top level of `AnonAuthConfig` switches `wrapAnalytics` into awaited-emit mode for synchronous-guarantee use cases; default `false` (fire-and-forget).
  5. A future change that adds a key not in the allowed-fields whitelist (`type`, `rpId`, `timestamp`, `provider`, `backupEligible`, static-enum `reason`, `codenameProvided`) to any event variant fails the snapshot-based PII assertion test in CI.
**Plans:** 2/5 plans executed
- [x] 13-01-PLAN.md (Wave 0) — Test scaffolding: 6 stub test files (analytics-types/pii-leak/pii-snapshot/lifecycle/oauth/latency) with `it.todo` slots covering all ANALYTICS-01..06 assertions
- [x] 13-02-PLAN.md (Wave 1) — Analytics module + config threading: `src/server/analytics.ts` (AnalyticsEvent union, ALLOWED_EVENT_FIELDS, wrapAnalytics, redactErrorMessage); `awaitAnalytics?` top-level config; lockstep threading into both router factories; replace 3 Wave-0 stubs (types/pii-leak/pii-snapshot)
- [ ] 13-03-PLAN.md (Wave 2) — Passkey router emit points: 11 emit calls in `src/server/router.ts` (register × 5, login × 5, recovery × 4, account.delete) + analytics-lifecycle.test.ts implementation; covers ANALYTICS-01 (passkey/recovery/delete) + ANALYTICS-06
- [ ] 13-04-PLAN.md (Wave 2) — OAuth router emit points: 3 `oauth.callback.success` calls in `src/server/oauth/router.ts` (existing-same-provider, link-by-email, new-user) + analytics-oauth.test.ts implementation; parallel with 13-03
- [ ] 13-05-PLAN.md (Wave 3) — Latency + error-swallow + await-mode tests: analytics-latency.test.ts implementation (5s hook < 500ms in FF, throw → 200 OK + redacted WARN, await mode adds ~5s, errors still swallowed in await); covers ANALYTICS-04 in full

### Phase 14: Second-Factor Enrolment Hook
**Milestone:** v0.7.0
**Goal:** Expose `hooks.afterAuthSuccess` that fires inline inside the registration transaction (after passkey verify + DB persist + MPC funding, before `sessionManager.createSession`) on passkey register, passkey login, AND OAuth callback success. Most-invasive cross-cutting phase — sits inside `db.transaction()`, defers session creation, has the MPC-funded-but-rolled-back trade-off.
**Depends on:** Phase 11 (hooks scaffolding), Phase 13 (analytics events used as observability surface for hook firings)
**Requirements:** HOOK-02, HOOK-03, HOOK-04, HOOK-05, HOOK-06
**Success Criteria** (what must be TRUE):
  1. A consumer wiring `hooks.afterAuthSuccess` sees the hook fire after passkey verify + DB persist + MPC funding but BEFORE `sessionManager.createSession` on `POST /register/finish` (`authMethod: 'passkey-register'`); a hook returning `{ continue: false, status, body }` short-circuits with the consumer's body and NO session cookie.
  2. The same hook fires inside `POST /login/finish` (`authMethod: 'passkey-login'`) after passkey verify, before session creation — same return-shape contract; same short-circuit semantics.
  3. The same hook fires inside the OAuth callback (`authMethod: 'oauth-google' | 'oauth-github' | 'oauth-twitter'`) after token exchange + user resolution, before session creation — `provider` is exposed on the hook context.
  4. A hook returning `{ continue: false, status, body }` produces a response that includes a `secondFactor: { status, body }` echo on the corresponding endpoint; `continue: true` omits the echo.
  5. A consumer reading the README finds the MPC-funded-but-rolled-back failure mode explicitly documented (MPC `createAccount` runs BEFORE the transaction, so a hook throw leaves an orphaned MPC account with no DB record), with the recommended mitigation (idempotent, non-throwing hooks returning `{ continue: false }` for soft failures).
**Plans**: TBD

### Phase 15: Lazy-Backfill Hook
**Milestone:** v0.7.0
**Goal:** Expose `hooks.backfillKeyBundle` as a pass-through hook that fires inside `/login/finish` when `sealingKeyHex` was supplied — letting consumers run their own key-bundle migration for pre-v0.6.0 NULL-bundle accounts. Library does NOT persist bundles, does NOT manage transactions for the hook, does NOT migrate existing IPFS recovery blobs. Critical contract: backfill failure must NEVER block login.
**Depends on:** Phase 11 (hooks scaffolding), Phase 14 (validates the hook-firing inside auth lifecycle pattern)
**Requirements:** BACKFILL-01, BACKFILL-02, BACKFILL-03, BACKFILL-04
**Success Criteria** (what must be TRUE):
  1. A consumer wiring `hooks.backfillKeyBundle` sees the hook fire inside `POST /login/finish` after passkey verify, before session creation, ONLY when `sealingKeyHex` was supplied in the request body — no PRF means no fresh sealing key means no hook invocation (silent skip).
  2. A consumer's hook returning `{ backfilled: true, reason: 'completed' }` (or any of `'already-current' | 'no-legacy-data' | 'completed' | 'skipped'`) sees that result echoed on the response under an additive `backfill: { backfilled, reason }` key.
  3. A hook that throws does NOT block login — the library catches, logs WARN with redacted error, and returns the normal login response with `backfill: { backfilled: false, reason: 'skipped' }`. Verified by a test that asserts a throwing hook still produces a 200 OK login.
  4. A consumer reading the README finds the consumer-owns-schema contract documented: library does not persist key bundles, does not run a transaction around backfill, and does not migrate existing IPFS recovery blobs (those remain consumer-owned and may be orphaned if the consumer's backfill replaces the recovery method — dual-recovery semantics explicit).
**Plans**: TBD

### Phase 16: Release Prep
**Milestone:** v0.7.0
**Goal:** Land documentation, CHANGELOG, version bump, build, smoke install, npm publish, and git tag for `@vitalpoint/near-phantom-auth@0.7.0`. Backwards-compat assertion: existing v0.6.1 consumer fixtures continue to compile and run without changes.
**Depends on:** Phases 11, 12, 13, 14, 15 (all feature work landed)
**Requirements:** RELEASE-01, RELEASE-02, RELEASE-03, RELEASE-04
**Success Criteria** (what must be TRUE):
  1. A reader of the v0.7.0 README finds a top-level "Hooks (v0.7.0)" section covering `hooks.afterAuthSuccess`, `hooks.backfillKeyBundle`, `hooks.onAuthEvent`, `rp.relatedOrigins`, and `awaitAnalytics` — including consumer-owns-schema callout, MPC orphan trade-off, anonymity-invariant guarantee, and the 5-origin cap.
  2. A reader of CHANGELOG.md finds a v0.7.0 entry with feature highlights (5 hooks/features) and an explicit additive-only callout (no breaking changes from v0.6.1).
  3. A consumer running `npm install @vitalpoint/near-phantom-auth@0.7.0` in a fresh fixture sees `import { createAnonAuth } from '@vitalpoint/near-phantom-auth/server'` resolve, with the new hook surface (`hooks.afterAuthSuccess`, `hooks.backfillKeyBundle`, `hooks.onAuthEvent`, `awaitAnalytics`, `rp.relatedOrigins`) visible in TypeScript autocomplete.
  4. The `@vitalpoint/near-phantom-auth@0.7.0` artifact is published on the npm registry (latest dist-tag), the `v0.7.0` git tag is pushed to origin, and existing v0.6.1 consumer fixtures continue to compile and run unchanged (backwards-compat assertion via re-running prior contract tests against the new dist).
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Atomic Security Fixes | v0.5.x | 3/3 | Complete | 2026-03-14 |
| 2. Input Validation | v0.5.x | 2/2 | Complete | 2026-03-14 |
| 3. Structured Logging | v0.5.x | 2/2 | Complete | 2026-03-14 |
| 4. HTTP Defenses | v0.5.x | 3/3 | Complete | 2026-03-14 |
| 5. DB Integrity and Functional Stubs | v0.5.x | 3/3 | Complete | 2026-03-14 |
| 6. Scalability, Tech Debt, and Email | v0.5.x | 4/4 | Complete | 2026-03-14 |
| 7. Test Coverage | v0.5.x | 4/4 | Complete | 2026-03-15 |
| 8. Wire OAuth Callback DB State | v0.5.x | 1/1 | Complete | 2026-03-15 |
| 9. WebAuthn PRF Extension | v0.6.0 | 3/3 | Complete | 2026-03-15 |
| 10. MPCAccountManager | v0.6.1 | 6/6 | Complete | 2026-04-29 |
| 11. Backup-Eligibility Flags + Hooks Scaffolding | v0.7.0 | 6/6 | Complete    | 2026-04-29 |
| 12. Multi-RP_ID Verification | v0.7.0 | 4/4 | Complete    | 2026-04-29 |
| 13. Registration Analytics Hook | v0.7.0 | 2/5 | In Progress|  |
| 14. Second-Factor Enrolment Hook | v0.7.0 | 0/TBD | Not started | - |
| 15. Lazy-Backfill Hook | v0.7.0 | 0/TBD | Not started | - |
| 16. Release Prep | v0.7.0 | 0/TBD | Not started | - |
