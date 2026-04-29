# Requirements: near-phantom-auth

**Originally defined:** 2026-03-14
**v0.6.1 milestone added:** 2026-04-28
**Core Value:** Every security-sensitive code path must be correct, tested, and production-safe

## v0.6.1 Requirements (Active)

Hotfix milestone — single-phase, additive only. Ships missing `MPCAccountManager` to unblock Ledgera mpc-sidecar production restart loop. Contract is FROZEN by consumer pin: renaming any field, method, or return-shape key requires a coordinated PR with the consumer.

### MPCAccountManager Class (MPC)

- [x] **MPC-01**: `MPCAccountManager` class is exported from `@vitalpoint/near-phantom-auth/server` in both ESM (`dist/server/index.js`) and CJS (`dist/server/index.cjs`); `MPCAccountManager`, `MPCAccountManagerConfig`, and `CreateAccountResult` types are exported from `dist/server/index.d.ts`. All v0.6.0 exports remain unchanged.
- [x] **MPC-02**: `createAccount(userId)` is a pure function of `(treasuryAccount, userId, derivationSalt)` — calling it twice with the same `userId` returns identical `nearAccountId`, `mpcPublicKey`, and `derivationPath`. The derivation function is documented in the README.
- [x] **MPC-03**: `createAccount(userId)` is idempotent and atomic. The implementation queries `view_account` first and short-circuits with `onChain=true` when the account already exists. A second call against a provisioned account does NOT issue a duplicate funding transfer.
- [x] **MPC-04**: `nearAccountId` returned from every `createAccount` call matches `/^[a-f0-9]{64}$/` (64-char lowercase-hex implicit-account ID). Named accounts are NOT supported in this version.
- [x] **MPC-05**: `verifyRecoveryWallet(nearAccountId, publicKey)` returns `true` if and only if the public key is currently registered on the account's access-key list AND has full-access permissions. Function-call-only access keys return `false`. Non-existent accounts return `false` (do NOT throw). Signature verification is NOT performed by this method — that is the consumer's second step.
- [x] **MPC-06**: Concurrent `createAccount(sameUserId)` calls from two replicas converge to identical results with exactly one on-chain transfer. The loser of a nonce race retries `view_account` once and returns success.

### Configuration & Conversion

- [x] **MPC-07**: `MPCAccountManagerConfig.derivationSalt` is REQUIRED. Two consumers using the same treasury but different salts produce distinct `nearAccountId` values for the same `userId` (cross-tenant isolation).
- [x] **MPC-08**: `fundingAmount` is a decimal-string in NEAR (default `"0.01"`); the implementation converts to yoctoNEAR via `parseNearAmount` from `near-api-js`. RPC URL selection is driven by `networkId` (`mainnet`/`testnet`).

### Security

- [ ] **MPC-09 (Treasury key isolation)**: The treasury private key MUST be held in memory only for the lifetime of the `MPCAccountManager` instance.
    1. The constructor MUST be synchronous; the manager MUST be usable for `createAccount` / `verifyRecoveryWallet` calls on the line immediately following `new MPCAccountManager(config)`.
    2. The key MUST NOT be written to disk, logged in pino structured output, included in error messages, or appear in stack traces.
    3. Pino redaction config covers `config.treasuryPrivateKey` and any nested holder; transactions are signed in-process — no `near-cli` shell-out.
    4. A single key-state lives per instance (one materialized representation, not multiple copies stored separately).
    5. Implementation MAY use a `KeyPair` private field, an `InMemoryKeyStore`, or any other primitive that satisfies (1)–(4). The choice is **opaque to consumers** — the consumer instantiation API stays `new MPCAccountManager(config)` and methods are usable immediately. (Reconciled 2026-04-28: original wording pinned the `@near-js` `KeyStore` abstraction; the consumer pins synchronous instantiation at module load, so the requirement now specifies security/lifecycle properties instead of an internal abstraction. The selected implementation in Plan 10-04 is a `private keyPair: KeyPair` field, with both signing call sites — `fundAccountFromTreasury` and `addRecoveryWallet` — accepting the `KeyPair` object directly so the raw private-key string never re-appears on the call stack after constructor materialization.)
- [x] **MPC-10**: Error paths throw with cause where appropriate (RPC unreachable, transfer failed, treasury underfunded) so consumer routes can return 500. `verifyRecoveryWallet` swallows "account not found" (returns `false`); only RPC unreachable throws.

### Testing

- [x] **MPC-11**: Test suite covers all 12 scenarios from the spec (T1–T12): first call provisions, second call short-circuits, distinct userIds and salts produce distinct accounts, RPC failure throws, treasury-underfunded throws, recovery wallet verification matrix (full-access true / function-call-only false / missing account false / unrelated key false), concurrent-call convergence, and hex-format assertion. Testnet integration tests for T1, T2, T7, T11; unit tests with RPC mocks for the remainder.

### Release

- [x] **MPC-12**: README documents the class, derivation function, and security expectations. CHANGELOG entry calls out the additive surface. `npm publish` succeeds at v0.6.1, and a fresh consumer can `npm install`, `import { MPCAccountManager } from '@vitalpoint/near-phantom-auth/server'`, instantiate, and call `createAccount` against a testnet treasury — succeeds end-to-end.

## v0.5 Requirements (Shipped)

Hardening milestone — 35/35 satisfied per `.planning/v0.5-MILESTONE-AUDIT.md` (2026-03-15).

### Security

- [x] **SEC-01**: Session signature verification uses constant-time comparison (`crypto.timingSafeEqual`)
- [x] **SEC-02**: All auth and recovery endpoints have rate limiting (stricter limits on recovery)
- [x] **SEC-03**: CSRF token verification for state-changing endpoints when sameSite is not strict
- [x] **SEC-04**: Account derivation uses server-side secret salt to prevent account ID prediction
- [x] **SEC-05**: All endpoint request bodies validated at runtime with zod schemas
- [x] **SEC-06**: Sensitive data (treasury keys, derivation paths, MPC public keys) redacted from production logs

### Bug Fixes

- [x] **BUG-01**: NEAR amount conversion uses BigInt-based math instead of floating-point
- [x] **BUG-02**: Signed transaction format includes public key in signature wrapper
- [x] **BUG-03**: Session refresh updates `expiresAt` in database (not just cookie)
- [x] **BUG-04**: `verifyRecoveryWallet()` checks specific wallet public key against access key list
- [x] **BUG-05**: OAuth recovery password either delivered to user via email or auto-recovery skipped until email works

### Stubs & Incomplete

- [x] **STUB-01**: `addRecoveryWallet()` implements real MPC signing for AddKey transaction
- [x] **STUB-02**: Passkey re-registration endpoint exists for post-recovery users
- [x] **STUB-03**: Account deletion endpoint removes user and all associated data

### Infrastructure

- [x] **INFRA-01**: Structured logging replaces all console.log/error statements (pino or similar)
- [x] **INFRA-02**: Registration flow wrapped in database transaction (no partial user creation)
- [x] **INFRA-03**: OAuth state stored in database instead of in-memory Map
- [x] **INFRA-04**: Automatic expired session and challenge cleanup mechanism
- [x] **INFRA-05**: Explicit cookie-parser dependency check in OAuth callback

### Tech Debt

- [x] **DEBT-01**: Codename system uses compound codenames (ALPHA-BRAVO-42) for larger namespace
- [x] **DEBT-02**: Custom `base58Encode()` replaced with `bs58.encode()` consistently
- [x] **DEBT-03**: SQLite removed from DatabaseConfig union type
- [x] **DEBT-04**: Dead testnet helper API code removed or cleaned up

### Performance

- [x] **PERF-01**: OAuth user lookups use JOIN queries instead of N+1 sequential queries
- [x] **PERF-02**: IPFS gateway fallback uses `Promise.any()` for concurrent requests

### Email Integration

- [x] **EMAIL-01**: AWS SES integration for email delivery
- [x] **EMAIL-02**: OAuth recovery password delivered to user via email after SES integration

### Testing

- [x] **TEST-01**: Unit tests for session signing/verification (`src/server/session.ts`)
- [x] **TEST-02**: Unit tests for WebAuthn passkey flow (`src/server/passkey.ts`)
- [x] **TEST-03**: Unit tests for MPC/borsh serialization and account creation (`src/server/mpc.ts`)
- [x] **TEST-04**: Unit tests for IPFS encryption/decryption roundtrip (`src/server/recovery/ipfs.ts`)
- [x] **TEST-05**: Unit tests for wallet recovery signature verification (`src/server/recovery/wallet.ts`)
- [x] **TEST-06**: Unit tests for codename generation/validation (`src/server/codename.ts`)
- [x] **TEST-07**: Integration tests for registration and authentication flows
- [x] **TEST-08**: Integration tests for recovery flows

### v0.6.0 (PRF Extension — Phase 9)

12 PRF-* requirements satisfied; library bumped from v0.5.x to v0.6.0. See `.planning/phases/09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv/` for traceability.

## Future Requirements (post-v0.6.1)

Deferred to future milestones. Tracked but not in current roadmap.

### v0.7.0 — Forward-looking additive items (next milestone)

- **V07-01**: Backup-eligibility flag exposure (Ledgera spec)
- **V07-02**: Second-factor enrolment hook (Ledgera spec)
- **V07-03**: Lazy-backfill hook (Ledgera spec)
- **V07-04**: Multi-RP_ID verification (Ledgera spec)
- **V07-05**: Registration analytics hook (Ledgera spec)

### Enhanced Security (v2 / undated)

- **ESEC-01**: Pluggable rate limit store (Redis) for multi-instance deployments
- **ESEC-02**: WebAuthn `userVerification: 'required'` configuration option
- **ESEC-03**: TypeScript strict mode enabled across codebase

### User Management (v2 / undated)

- **UMGT-01**: Passkey management endpoint (list and revoke individual passkeys)
- **UMGT-02**: Session management endpoint (list active sessions, revoke specific devices)

### MPCAccountManager — additive options (post-v0.6.1)

- **MPC-EXT-01**: Optional `rpcUrl?: string` config field for self-hosted RPC override (cheap to include in v0.7.x)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Renaming any field/method/return-shape on `MPCAccountManager` | Contract FROZEN by consumer pin |
| Returning named accounts (e.g. `user.namespace.near`) from `createAccount` | Consumer's contract test greps for `/^[a-f0-9]{64}$/`; would be major-version break |
| Performing signature verification inside `verifyRecoveryWallet` | Consumer's two-step flow runs `tweetnacl.sign.detached.verify` separately |
| Shelling out to `near-cli` for transaction signing | Keys must not be reachable via `process.exec` injection |
| New authentication methods | Hardening existing, not expanding attack surface |
| SQLite adapter | Type declaration removed in v0.5 |
| Mobile/native SDK | Web-only library |
| UI components | Library provides hooks, consumers own UI |
| Real-time features | Not relevant to auth |
| Attestation verification | Breaks privacy model for anonymous auth |
| PII collection in anonymous track | Core privacy constraint |

## Traceability

### v0.6.1 (Active)

| Requirement | Phase | Status |
|-------------|-------|--------|
| MPC-01 | Phase 10 | Complete |
| MPC-02 | Phase 10 | Complete |
| MPC-03 | Phase 10 | Complete |
| MPC-04 | Phase 10 | Complete |
| MPC-05 | Phase 10 | Complete |
| MPC-06 | Phase 10 | Complete |
| MPC-07 | Phase 10 | Complete |
| MPC-08 | Phase 10 | Complete |
| MPC-09 | Phase 10 | Complete |
| MPC-10 | Phase 10 | Complete |
| MPC-11 | Phase 10 | Complete |
| MPC-12 | Phase 10 | Complete |

### v0.5 (Shipped)

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1 | Complete |
| SEC-02 | Phase 4 | Complete |
| SEC-03 | Phase 4 | Complete |
| SEC-04 | Phase 1 | Complete |
| SEC-05 | Phase 2 | Complete — 02-01 |
| SEC-06 | Phase 3 | Complete |
| BUG-01 | Phase 1 | Complete |
| BUG-02 | Phase 1 | Complete |
| BUG-03 | Phase 1 | Complete |
| BUG-04 | Phase 5 | Complete |
| BUG-05 | Phase 6 | Complete |
| STUB-01 | Phase 5 | Complete |
| STUB-02 | Phase 5 | Complete |
| STUB-03 | Phase 5 | Complete |
| INFRA-01 | Phase 3 | Complete |
| INFRA-02 | Phase 5 | Complete |
| INFRA-03 | Phase 8 | Complete |
| INFRA-04 | Phase 6 | Complete |
| INFRA-05 | Phase 4 | Complete |
| DEBT-01 | Phase 6 | Complete |
| DEBT-02 | Phase 1 | Complete |
| DEBT-03 | Phase 6 | Complete |
| DEBT-04 | Phase 6 | Complete |
| PERF-01 | Phase 6 | Complete |
| PERF-02 | Phase 6 | Complete |
| EMAIL-01 | Phase 6 | Complete |
| EMAIL-02 | Phase 6 | Complete |
| TEST-01 | Phase 7 | Complete |
| TEST-02 | Phase 7 | Complete |
| TEST-03 | Phase 7 | Complete |
| TEST-04 | Phase 7 | Complete |
| TEST-05 | Phase 7 | Complete |
| TEST-06 | Phase 7 | Complete |
| TEST-07 | Phase 7 | Complete |
| TEST-08 | Phase 7 | Complete |
| PRF-* (12) | Phase 9 | Complete |

**Coverage:**
- v0.5: 35 / 35 mapped (Phase 9 added 12 PRF-*; total satisfied = 47)
- v0.6.1: 12 / 12 mapped — all to Phase 10

---
*v0.5 milestone defined: 2026-03-14, closed 2026-03-15 audit*
*v0.6.1 milestone defined: 2026-04-28*
