# Requirements: near-phantom-auth Hardening

**Defined:** 2026-03-14
**Core Value:** Every security-sensitive code path must be correct, tested, and production-safe

## v1 Requirements

Requirements for this hardening milestone. Each maps to roadmap phases.

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

- [ ] **TEST-01**: Unit tests for session signing/verification (`src/server/session.ts`)
- [ ] **TEST-02**: Unit tests for WebAuthn passkey flow (`src/server/passkey.ts`)
- [ ] **TEST-03**: Unit tests for MPC/borsh serialization and account creation (`src/server/mpc.ts`)
- [x] **TEST-04**: Unit tests for IPFS encryption/decryption roundtrip (`src/server/recovery/ipfs.ts`)
- [ ] **TEST-05**: Unit tests for wallet recovery signature verification (`src/server/recovery/wallet.ts`)
- [x] **TEST-06**: Unit tests for codename generation/validation (`src/server/codename.ts`)
- [ ] **TEST-07**: Integration tests for registration and authentication flows
- [ ] **TEST-08**: Integration tests for recovery flows

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhanced Security

- **ESEC-01**: Pluggable rate limit store (Redis) for multi-instance deployments
- **ESEC-02**: WebAuthn `userVerification: 'required'` configuration option
- **ESEC-03**: TypeScript strict mode enabled across codebase

### User Management

- **UMGT-01**: Passkey management endpoint (list and revoke individual passkeys)
- **UMGT-02**: Session management endpoint (list active sessions, revoke specific devices)

## Out of Scope

| Feature | Reason |
|---------|--------|
| New authentication methods | Hardening existing, not expanding attack surface |
| SQLite adapter | Removing the type declaration instead |
| Mobile/native SDK | Web-only library |
| UI components | Library provides hooks, consumers own UI |
| Real-time features | Not relevant to auth |
| Attestation verification | Breaks privacy model for anonymous auth |
| PII collection in anonymous track | Core privacy constraint |

## Traceability

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
| INFRA-03 | Phase 6 | Complete |
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
| TEST-01 | Phase 7 | Pending |
| TEST-02 | Phase 7 | Pending |
| TEST-03 | Phase 7 | Pending |
| TEST-04 | Phase 7 | Complete |
| TEST-05 | Phase 7 | Pending |
| TEST-06 | Phase 7 | Complete |
| TEST-07 | Phase 7 | Pending |
| TEST-08 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0

---
*Requirements defined: 2026-03-14*
*Last updated: 2026-03-14 after roadmap creation — all 35 requirements mapped*
