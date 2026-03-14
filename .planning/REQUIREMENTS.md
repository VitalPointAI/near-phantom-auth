# Requirements: near-phantom-auth Hardening

**Defined:** 2026-03-14
**Core Value:** Every security-sensitive code path must be correct, tested, and production-safe

## v1 Requirements

Requirements for this hardening milestone. Each maps to roadmap phases.

### Security

- [ ] **SEC-01**: Session signature verification uses constant-time comparison (`crypto.timingSafeEqual`)
- [ ] **SEC-02**: All auth and recovery endpoints have rate limiting (stricter limits on recovery)
- [ ] **SEC-03**: CSRF token verification for state-changing endpoints when sameSite is not strict
- [ ] **SEC-04**: Account derivation uses server-side secret salt to prevent account ID prediction
- [ ] **SEC-05**: All endpoint request bodies validated at runtime with zod schemas
- [ ] **SEC-06**: Sensitive data (treasury keys, derivation paths, MPC public keys) redacted from production logs

### Bug Fixes

- [ ] **BUG-01**: NEAR amount conversion uses BigInt-based math instead of floating-point
- [ ] **BUG-02**: Signed transaction format includes public key in signature wrapper
- [ ] **BUG-03**: Session refresh updates `expiresAt` in database (not just cookie)
- [ ] **BUG-04**: `verifyRecoveryWallet()` checks specific wallet public key against access key list
- [ ] **BUG-05**: OAuth recovery password either delivered to user via email or auto-recovery skipped until email works

### Stubs & Incomplete

- [ ] **STUB-01**: `addRecoveryWallet()` implements real MPC signing for AddKey transaction
- [ ] **STUB-02**: Passkey re-registration endpoint exists for post-recovery users
- [ ] **STUB-03**: Account deletion endpoint removes user and all associated data

### Infrastructure

- [ ] **INFRA-01**: Structured logging replaces all console.log/error statements (pino or similar)
- [ ] **INFRA-02**: Registration flow wrapped in database transaction (no partial user creation)
- [ ] **INFRA-03**: OAuth state stored in database instead of in-memory Map
- [ ] **INFRA-04**: Automatic expired session and challenge cleanup mechanism
- [ ] **INFRA-05**: Explicit cookie-parser dependency check in OAuth callback

### Tech Debt

- [ ] **DEBT-01**: Codename system uses compound codenames (ALPHA-BRAVO-42) for larger namespace
- [ ] **DEBT-02**: Custom `base58Encode()` replaced with `bs58.encode()` consistently
- [ ] **DEBT-03**: SQLite removed from DatabaseConfig union type
- [ ] **DEBT-04**: Dead testnet helper API code removed or cleaned up

### Performance

- [ ] **PERF-01**: OAuth user lookups use JOIN queries instead of N+1 sequential queries
- [ ] **PERF-02**: IPFS gateway fallback uses `Promise.any()` for concurrent requests

### Email Integration

- [ ] **EMAIL-01**: AWS SES integration for email delivery
- [ ] **EMAIL-02**: OAuth recovery password delivered to user via email after SES integration

### Testing

- [ ] **TEST-01**: Unit tests for session signing/verification (`src/server/session.ts`)
- [ ] **TEST-02**: Unit tests for WebAuthn passkey flow (`src/server/passkey.ts`)
- [ ] **TEST-03**: Unit tests for MPC/borsh serialization and account creation (`src/server/mpc.ts`)
- [ ] **TEST-04**: Unit tests for IPFS encryption/decryption roundtrip (`src/server/recovery/ipfs.ts`)
- [ ] **TEST-05**: Unit tests for wallet recovery signature verification (`src/server/recovery/wallet.ts`)
- [ ] **TEST-06**: Unit tests for codename generation/validation (`src/server/codename.ts`)
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
| SEC-01 | TBD | Pending |
| SEC-02 | TBD | Pending |
| SEC-03 | TBD | Pending |
| SEC-04 | TBD | Pending |
| SEC-05 | TBD | Pending |
| SEC-06 | TBD | Pending |
| BUG-01 | TBD | Pending |
| BUG-02 | TBD | Pending |
| BUG-03 | TBD | Pending |
| BUG-04 | TBD | Pending |
| BUG-05 | TBD | Pending |
| STUB-01 | TBD | Pending |
| STUB-02 | TBD | Pending |
| STUB-03 | TBD | Pending |
| INFRA-01 | TBD | Pending |
| INFRA-02 | TBD | Pending |
| INFRA-03 | TBD | Pending |
| INFRA-04 | TBD | Pending |
| INFRA-05 | TBD | Pending |
| DEBT-01 | TBD | Pending |
| DEBT-02 | TBD | Pending |
| DEBT-03 | TBD | Pending |
| DEBT-04 | TBD | Pending |
| PERF-01 | TBD | Pending |
| PERF-02 | TBD | Pending |
| EMAIL-01 | TBD | Pending |
| EMAIL-02 | TBD | Pending |
| TEST-01 | TBD | Pending |
| TEST-02 | TBD | Pending |
| TEST-03 | TBD | Pending |
| TEST-04 | TBD | Pending |
| TEST-05 | TBD | Pending |
| TEST-06 | TBD | Pending |
| TEST-07 | TBD | Pending |
| TEST-08 | TBD | Pending |

**Coverage:**
- v1 requirements: 31 total
- Mapped to phases: 0
- Unmapped: 31

---
*Requirements defined: 2026-03-14*
*Last updated: 2026-03-14 after initial definition*
