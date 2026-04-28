# near-phantom-auth Hardening

## What This Is

A privacy-first authentication SDK (`@vitalpoint/near-phantom-auth`) providing anonymous passkey auth with NEAR MPC accounts, codename-based identities, and decentralized recovery. Published as an npm package with server (Express), client (React), and standalone WebAuthn entry points. This project is a hardening and refactoring pass to address all known concerns — security gaps, bugs, stubs, performance issues, and zero test coverage.

## Core Value

Every security-sensitive code path must be correct, tested, and production-safe. A security-focused auth library with bugs and stubs erodes trust in the entire system.

## Current Milestone: v0.6.1 Unblock Ledgera mpc-sidecar (MPCAccountManager)

**Goal:** Ship the missing `MPCAccountManager` class on `@vitalpoint/near-phantom-auth/server` so a downstream consumer (Ledgera mpc-sidecar) stops crash-looping in production. Pure additive surface — no v0.6.0 export changes.

**Target features:**
- Export `MPCAccountManager` class with FROZEN contract: `createAccount(userId)` and `verifyRecoveryWallet(nearAccountId, publicKey)`
- Idempotent, atomic NEAR account provisioning (deterministic derivation + funding transfer; second call short-circuits via `view_account`)
- Recovery wallet verification via `view_access_key_list` (full-access keys only; signature verification stays consumer-side)
- Test coverage for all 12 scenarios (T1–T12) — concurrency, cross-tenant isolation, RPC failure, function-call-only access keys, hex format, etc.
- Treasury private key never logged, never written to disk; in-process signing only
- README + CHANGELOG; `npm publish` v0.6.1

**Single-phase hotfix milestone.** v0.7.0 (5 forward-looking items: backup-eligibility flag, second-factor enrolment hook, lazy-backfill hook, multi-RP_ID, registration analytics) is a separate future milestone.

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

### Active

<!-- Current scope: v0.6.1 hotfix — additive only, contract FROZEN. -->

**v0.6.1 — MPCAccountManager hotfix:**
- [ ] **MPC-01**: Export `MPCAccountManager` class from `@vitalpoint/near-phantom-auth/server` (ESM + CJS + types)
- [ ] **MPC-02**: `createAccount(userId)` is a pure function of `(treasuryAccount, userId, derivationSalt)` — same input → same `nearAccountId/mpcPublicKey/derivationPath` across calls
- [ ] **MPC-03**: `createAccount(userId)` is idempotent and atomic — second call short-circuits via `view_account` and does NOT issue a duplicate funding transfer
- [ ] **MPC-04**: `nearAccountId` returned from `createAccount` matches `/^[a-f0-9]{64}$/` (implicit-account hex format)
- [ ] **MPC-05**: `verifyRecoveryWallet(nearAccountId, publicKey)` returns `true` only when key is in `view_access_key_list` AND has full-access permissions (function-call-only access → `false`; missing account → `false`; does NOT verify signatures)
- [ ] **MPC-06**: Concurrent `createAccount(sameUserId)` calls converge to identical results with exactly one on-chain transfer (loser of nonce race retries `view_account`)
- [ ] **MPC-07**: Treasury private key never logged, never persisted to disk, signed in-process only (no `near-cli` shell-out); pino redaction covers `treasuryPrivateKey` and any nested holders
- [ ] **MPC-08**: Test suite covers T1–T12 from spec (mix of testnet integration + unit tests with RPC mocks)
- [ ] **MPC-09**: README documents the class, derivation function, security expectations; CHANGELOG entry calls out additive surface; `npm publish` v0.6.1 succeeds and a fresh consumer can import + instantiate + call `createAccount` against testnet end-to-end

### Out of Scope

- **v0.7.0 forward-looking items (deferred to next milestone):** backup-eligibility flag exposure, second-factor enrolment hook, lazy-backfill hook, multi-RP_ID verification, registration analytics hook
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

- Published npm package; current shipped version is **v0.6.0** (bumped at end of Phase 9). Next release is **v0.6.1** (this milestone)
- A downstream consumer (Ledgera mpc-sidecar) is in a production restart loop on v0.6.0 because `MPCAccountManager` is not exported from `/server` — fixing that is the BLOCKING reason for this milestone
- v0.6.0 `/server` export surface (must be preserved unchanged): `POSTGRES_SCHEMA, base64urlToUint8Array, createAnonAuth, createAuthenticationOptions, createCleanupScheduler, createEmailService, createOAuthManager, createOAuthRouter, createPostgresAdapter, createRegistrationOptions, generateCodename, isValidCodename, uint8ArrayToBase64url, verifyAuthentication, verifyRegistration`
- TypeScript strict mode remains disabled — not changing in this milestone
- vitest configured; v0.5 added 252 tests (Phase 7); v0.6.1 adds T1–T12 for `MPCAccountManager`
- Node.js >= 18 required; development environment has Node 12 (use nvm to switch to 20)
- Codebase map available at `.planning/codebase/`; v0.5 audit at `.planning/v0.5-MILESTONE-AUDIT.md`

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
| v0.6.1 ships as patch (additive only) instead of bundling with v0.7.0 | Consumer is in production restart loop NOW; bundling holds the BLOCKING fix behind the slowest of 5 forward-looking items | — Pending |
| `MPCAccountManager` contract is FROZEN by consumer pin | Renaming any field/method/return-shape key requires coordinated PR with downstream consumer | — Pending |
| `nearAccountId` returned as 64-char lowercase-hex implicit account | Consumer's contract test greps for `/^[a-f0-9]{64}$/`; named-account support would be a major-version break | — Pending |
| `verifyRecoveryWallet` does NOT verify signatures | Consumer's two-step flow runs `tweetnacl.sign.detached.verify` after; separation lets consumer choose signature library | — Pending |
| `derivationSalt` is REQUIRED in `MPCAccountManagerConfig` | Treasury alone is not sufficient entropy when consumers may share treasuries during staging or multi-tenant deploys | — Pending |

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
*Last updated: 2026-04-28 — milestone v0.6.1 started: ship `MPCAccountManager` to unblock Ledgera mpc-sidecar production restart loop. v0.5 milestone closed (35/35 requirements satisfied per audit; library at v0.6.0). v0.7.0 forward-looking items deferred to a separate future milestone.*
