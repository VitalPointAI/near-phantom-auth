# near-phantom-auth Hardening

## What This Is

A privacy-first authentication SDK (`@vitalpoint/near-phantom-auth`) providing anonymous passkey auth with NEAR MPC accounts, codename-based identities, and decentralized recovery. Published as an npm package with server (Express), client (React), and standalone WebAuthn entry points. This project is a hardening and refactoring pass to address all known concerns — security gaps, bugs, stubs, performance issues, and zero test coverage.

## Core Value

Every security-sensitive code path must be correct, tested, and production-safe. A security-focused auth library with bugs and stubs erodes trust in the entire system.

## Current State

**Shipped version: v0.6.1** (2026-04-29) — `@vitalpoint/near-phantom-auth@0.6.1` is live on the npm registry.

**Active milestone:** v0.7.0 — Consumer Hooks & Recovery Hardening (Phase 12 complete: multi-RP_ID verification — paired-tuple `relatedOrigins` config, startup-validator with 6 failure branches, standalone-export type widening, README cross-domain contract).

## Current Milestone: v0.7.0 Consumer Hooks & Recovery Hardening

**Goal:** Expose backup-eligibility, post-passkey 2FA, multi-RP_ID, and analytics hooks for consumers, plus a lazy-backfill path for pre-v0.6.0 accounts with NULL key bundles.

**Target features:**
- Backup-eligibility flag exposure on `register()` / `login()` results
- Second-factor enrolment hook (consumer-defined post-passkey step)
- Lazy-backfill hook for pre-v0.6.0 accounts with NULL key bundles
- Multi-RP_ID verification (cross-domain passkey support)
- Registration analytics hook (without compromising anonymity)

**Constraints carried into this milestone:**
- Additive only — the `MPCAccountManager` contract is FROZEN by consumer pin; no field/method/return-shape renames
- Anonymity invariant must hold — the registration analytics hook cannot leak PII
- Next semver bump: minor (v0.7.0) — new public surface, backwards compatible

**Carry-over from v0.6.0 PRF milestone (NOT in this milestone's scope — see `STATE.md > Deferred Items`):**
- 6 cross-browser PRF UAT scenarios (Firefox, Safari, hardware keys) — needs physical devices
- 1 verification gap on Phase 09 (`human_needed` until PRF UAT clears)

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Passkey registration and authentication via WebAuthn — existing
- ✓ NEAR MPC implicit account creation (testnet + mainnet with treasury funding) — existing
- ✓ Anonymous codename identity generation (NATO phonetic + animal styles) — existing
- ✓ HttpOnly signed cookie session management — existing
- ✓ IPFS + password recovery (AES-256-GCM encrypted backups) — existing
- ✓ Wallet recovery flow (link wallet, recover via signature) — existing (partially stubbed)
- ✓ OAuth authentication (Google, GitHub, Twitter) with PKCE — existing
- ✓ React hooks (`useAnonAuth`, `useOAuth`) and vanilla API client — existing
- ✓ PostgreSQL database adapter with pluggable interface — existing
- ✓ Standalone WebAuthn entry point (framework-agnostic) — existing
- ✓ Dual ESM/CJS builds with 4 entry points — existing
- ✓ Constant-time session signature comparison (SEC-01, Phase 1)
- ✓ Server-side secret salt for deterministic NEAR account derivation (SEC-04, Phase 1)
- ✓ Floating-point NEAR amount conversion fix (BUG-01, Phase 1)
- ✓ Signed transaction includes public key in wrapper (BUG-02, Phase 1)
- ✓ Session refresh persists expiresAt in DB (BUG-03, Phase 1)
- ✓ `bs58.encode()` consistently replaces custom `base58Encode()` (DEBT-02, Phase 1)
- ✓ Runtime input validation (zod) on all 16 route handlers (SEC-05, Phase 2)
- ✓ Structured logging via injectable pino with redaction (SEC-06, INFRA-01, Phase 3)
- ✓ Tiered rate limiting on auth + recovery endpoints (SEC-02, INFRA-05, Phase 4)
- ✓ Opt-in CSRF protection inside library-owned routers (SEC-03, Phase 4)
- ✓ Real MPC signing flow for `addRecoveryWallet()` (STUB-01, Phase 5)
- ✓ Specific-key verification in `verifyRecoveryWallet()` (STUB-02, Phase 5)
- ✓ Passkey re-registration endpoint (STUB-03, Phase 5)
- ✓ Account deletion endpoint (INFRA-02, Phase 5)
- ✓ Registration wrapped in DB transaction (BUG-04, Phase 5)
- ✓ Compound codenames (ALPHA-BRAVO-42) (DEBT-01, Phase 6)
- ✓ OAuth state moved to DB-backed storage (DEBT-03, Phase 6 + INFRA-03 closed in Phase 8)
- ✓ Expired session/challenge cleanup scheduler (DEBT-04, Phase 6)
- ✓ SQLite removed from `DatabaseConfig` union (DEBT-05, Phase 6)
- ✓ N+1 OAuth lookup fix via JOINs (PERF-01, Phase 6)
- ✓ `Promise.any()` IPFS gateway fallback (BUG-05, Phase 6)
- ✓ AWS SES email delivery + OAuth recovery password email (EMAIL-01, EMAIL-02, Phase 6)
- ✓ Test coverage across hardened modules — 252 tests, 8/8 automated verifications (Phase 7)
- ✓ OAuth callback wired to DB-backed `validateState()`, single `cookieParser` mount (Phase 8)
- ✓ WebAuthn PRF extension for DEK sealing-key derivation — `sealingKeyHex` threaded through finish endpoints, library bumped to v0.6.0 (12 PRF-* requirements, Phase 9)
- ✓ **Multi-RP_ID verification (cross-domain passkeys)** — Phase 12 (5/5 RPID-* requirements): `RelatedOrigin` paired-tuple type + `AnonAuthConfig.rp.relatedOrigins` config field; `validateRelatedOrigins` startup helper with 6 classified failure branches (count cap, wildcard, https, localhost-coupling, suffix-domain boundary, duplicate-of-primary); standalone `VerifyRegistrationInput`/`VerifyAuthenticationInput` widened to `string | string[]` (backwards compat preserved); conditional-spread idiom in `passkey.ts` preserves paired tuple by index; README documents consumer-owned `/.well-known/webauthn` contract
- ✓ **v0.6.1 MPCAccountManager hotfix** — Phase 10 (12/12 MPC-* requirements):
  - ✓ MPC-01: `MPCAccountManager` value-exported from `/server`; consumer can `import { MPCAccountManager }` and instantiate at runtime
  - ✓ MPC-02: deterministic derivation — same `(treasuryAccount, userId, derivationSalt)` always produces the same `nearAccountId / mpcPublicKey / derivationPath`
  - ✓ MPC-03: `createAccount` idempotent — second call short-circuits via `view_account`, zero duplicate broadcasts
  - ✓ MPC-04: `nearAccountId` matches `/^[a-f0-9]{64}$/`; `verifyRecoveryWallet` returns false (no throw) for UNKNOWN_ACCOUNT
  - ✓ MPC-05: `verifyRecoveryWallet` returns true ONLY for FullAccess keys; FunctionCall and UNKNOWN_ACCESS_KEY return false
  - ✓ MPC-06: concurrent `createAccount` calls converge — nonce-race losers retry `view_account` once
  - ✓ MPC-07: `MPCAccountManagerConfig.derivationSalt` REQUIRED at the type level (tsc-fail fixture verifies)
  - ✓ MPC-08: yoctoNEAR conversion uses `parseNearAmount` from `@near-js/utils`
  - ✓ MPC-09: KeyPair object replaces raw private-key string field; pino redact paths wired into default logger; dist bundle leak-audited
  - ✓ MPC-10: classified throws (`RPC unreachable` / `Treasury underfunded` / `Transfer failed`) with `cause` set
  - ✓ MPC-11: T1–T12 test scaffold populated with real assertions + 3 bonus cases
  - ✓ MPC-12: `npm publish @vitalpoint/near-phantom-auth@0.6.1` succeeded; smoke install confirms; git tag `v0.6.1` pushed

### Active

<!-- v0.7.0 scope. REQ-IDs assigned in REQUIREMENTS.md after roadmap approval. -->

- Second-factor enrolment hook (consumer-defined post-passkey step)
- Lazy-backfill hook for pre-v0.6.0 accounts with NULL key bundles
- Registration analytics hook (without compromising anonymity)

### Out of Scope

- Renaming any field, method, or return-shape key on `MPCAccountManager` — contract is FROZEN by consumer pin (would require coordinated PR)
- Returning named accounts (e.g. `user.namespace.near`) from `createAccount` — consumer's contract test greps for `/^[a-f0-9]{64}$/`; named-account support would be a major-version break
- Performing signature verification inside `verifyRecoveryWallet` — consumer's two-step flow runs `tweetnacl.sign.detached.verify` after; keep separate so consumer can swap signature library
- Shelling out to `near-cli` for transaction signing — keys must not be reachable via `process.exec` injection
- New authentication methods — hardening existing, not adding features
- SQLite adapter implementation — type declaration removed in v0.5
- Mobile app or native SDK — web-only library
- Real-time features — not relevant to auth
- UI components — library provides hooks, not UI

## Context

- Published npm package; **current shipped version is v0.6.1** (latest, 2026-04-29).
- The Ledgera mpc-sidecar restart loop is resolved — fresh-consumer smoke install confirmed `typeof MPCAccountManager === 'function'` and instantiation succeeds.
- v0.6.1 `/server` export surface (additive only — all v0.6.0 exports preserved):
  `POSTGRES_SCHEMA, base64urlToUint8Array, createAnonAuth, createAuthenticationOptions, createCleanupScheduler, createEmailService, createOAuthManager, createOAuthRouter, createPostgresAdapter, createRegistrationOptions, generateCodename, isValidCodename, uint8ArrayToBase64url, verifyAuthentication, verifyRegistration`
  **+ new in v0.6.1:** `MPCAccountManager` (class, value export), `MPCAccountManagerConfig` (type), `CreateAccountResult` (type), `MPCConfig` (type, internal), `MPCAccount` (type).
- TypeScript strict mode remains disabled — not changing.
- vitest test suite: 280 (252 v0.5.x baseline + 12 PRF in v0.6.0 + 28 MPC + leak-audit + exports in v0.6.1) + 4 testnet-skipped = 286 total, 0 failures.
- Node.js >= 18 required; development environment has Node 12 (use nvm to switch to 20).
- Codebase map at `.planning/codebase/`; v0.5 audit at `.planning/v0.5-MILESTONE-AUDIT.md`; v0.6.1 archive at `.planning/milestones/v0.6.1-ROADMAP.md` and `v0.6.1-REQUIREMENTS.md`.
- **Known deferred:** 6 cross-browser PRF UAT scenarios + 1 verification gap on Phase 09 (carried over from v0.6.0; needs physical Firefox / Safari / hardware key devices). Tracked in `STATE.md > Deferred Items`.

## Constraints

- **Tech stack**: Must remain Express + React compatible, no framework changes
- **API compatibility**: Public API surface (`createAnonAuth`, hooks, routes) must not break existing consumers
- **Dependencies**: Minimize new dependencies — zod for validation, AWS SES SDK for email, express-rate-limit for rate limiting, structured logger (pino or similar)
- **No PII**: The anonymous auth track must never collect or store personally identifiable information

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| AWS SES for email | User preference, scalable, cost-effective | Shipped (Phase 6) |
| Compound codenames (ALPHA-BRAVO-42) | Expands namespace from ~2.5K to millions, more memorable than hash-based | Shipped (Phase 6) |
| Remove SQLite type instead of implementing adapter | Clean up lies in types, SQLite not needed for this library's use case | Shipped (Phase 6) |
| Skip auto-recovery for OAuth until email works | Can't deliver recovery passwords without email service | Resolved via Phase 6 SES |
| zod for runtime validation | Lightweight, TypeScript-native, good DX | Shipped (Phase 2) |
| WebAuthn PRF extension for DEK sealing key | Cryptographic key derivation tied to passkey, stronger than password-derived | Shipped (Phase 9) |
| v0.6.1 ships as patch (additive only) instead of bundling with v0.7.0 | Consumer is in production restart loop NOW; bundling holds the BLOCKING fix behind the slowest of 5 forward-looking items | ✓ Good (Phase 10) — patch shipped 2026-04-29; consumer unblocked |
| `MPCAccountManager` contract is FROZEN by consumer pin | Renaming any field/method/return-shape key requires coordinated PR with downstream consumer | ✓ Good (Phase 10) — contract documented in README under "Frozen contract" |
| `nearAccountId` returned as 64-char lowercase-hex implicit account | Consumer's contract test greps for `/^[a-f0-9]{64}$/`; named-account support would be a major-version break | ✓ Good (Phase 10) — every test in `mpc-account-manager.test.ts` asserts the regex |
| `verifyRecoveryWallet` does NOT verify signatures | Consumer's two-step flow runs `tweetnacl.sign.detached.verify` after; separation lets consumer choose signature library | ✓ Good (Phase 10) — wrapper delegates only to `checkWalletAccess` (FullAccess gate); signatures stay consumer-side |
| `derivationSalt` is REQUIRED in `MPCAccountManagerConfig` | Treasury alone is not sufficient entropy when consumers may share treasuries during staging or multi-tenant deploys | ✓ Good (Phase 10) — enforced at the TypeScript type level; tsc-fail fixture verifies |
| MPC-10 throws over degraded returns | Returning `mpcPublicKey: 'creation-failed'` masks failures; classified throws let callers branch on `cause` | ✓ Good (Phase 10) — `RPC unreachable` / `Treasury underfunded` / `Transfer failed` |
| MPC-09 KeyPair field replaces raw treasury string | Holding a raw private-key string as a class field invites accidental serialization (logs, JSON.stringify) | ✓ Good (Phase 10) — `keyPair?: KeyPair`; pino redact paths wired; dist leak-audited |
| Plan 10-05 Gate 1 wording softened: gate VALUE leaks only | Field NAME `treasuryPrivateKey` is unavoidable in property-access patterns (constructor must read `config.treasuryPrivateKey`); only key VALUE leaks are real | ✓ Good (Phase 10) — `ed25519:<base58>` literal scan stays at zero matches |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-29 — Phase 12 complete (RPID-01..05 shipped: `RelatedOrigin` paired-tuple type, `AnonAuthConfig.rp.relatedOrigins`, `validateRelatedOrigins` startup helper, conditional-spread integration in `passkey.ts`, standalone-export widening to `string | string[]`, README Cross-Domain Passkeys section with consumer-owned `/.well-known/webauthn` contract). Last shipped: v0.6.1 (2026-04-29). Next: Phase 13 registration analytics hook.*
