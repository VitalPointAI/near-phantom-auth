# near-phantom-auth Hardening

## What This Is

A privacy-first authentication SDK (`@vitalpoint/near-phantom-auth`) providing anonymous passkey auth with NEAR MPC accounts, codename-based identities, and decentralized recovery. Published as an npm package with server (Express), client (React), and standalone WebAuthn entry points. This project is a hardening and refactoring pass to address all known concerns — security gaps, bugs, stubs, performance issues, and zero test coverage.

## Core Value

Every security-sensitive code path must be correct, tested, and production-safe. A security-focused auth library with bugs and stubs erodes trust in the entire system.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from existing codebase. -->

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

### Active

<!-- Current scope. Hardening pass — fix everything in CONCERNS.md. -->

**Security Fixes:**
- [ ] Add constant-time session signature comparison (`crypto.timingSafeEqual`)
- [ ] Add rate limiting to all auth and recovery endpoints
- [ ] Add CSRF token verification for state-changing endpoints
- [ ] Add server-side secret salt to deterministic account derivation
- [ ] Add runtime input validation (zod) for all endpoint request bodies
- [ ] Replace console logging with structured logger, redact sensitive data in production

**Bug Fixes:**
- [ ] Fix floating-point NEAR amount conversion (use string-based yoctoNEAR math)
- [ ] Fix signed transaction format to include public key in signature wrapper
- [ ] Fix session refresh to update expiry in database (not just cookie)

**Tech Debt — Stubs & Incomplete Code:**
- [ ] Implement real MPC signing flow for `addRecoveryWallet()` (currently returns fake txHash)
- [ ] Fix `verifyRecoveryWallet()` to check specific wallet public key (not just "any keys exist")
- [ ] Implement passkey re-registration endpoint for post-recovery users
- [ ] Add account deletion endpoint (GDPR/privacy compliance)
- [ ] Remove SQLite from `DatabaseConfig` union type (no adapter exists)
- [ ] Replace custom `base58Encode()` with `bs58.encode()` consistently

**Tech Debt — Scalability & Robustness:**
- [ ] Expand codename system to compound codenames (ALPHA-BRAVO-42) for larger namespace
- [ ] Move OAuth state from in-memory Map to database-backed storage
- [ ] Add automatic expired session/challenge cleanup mechanism
- [ ] Wrap registration flow in database transaction (prevent partial user creation)
- [ ] Add explicit cookie-parser dependency check for OAuth callback

**Performance:**
- [ ] Fix N+1 queries in OAuth user lookups (use JOINs)
- [ ] Use `Promise.any()` for concurrent IPFS gateway fallback

**Email & Recovery:**
- [ ] Integrate AWS SES for email delivery
- [ ] Deliver OAuth recovery password to user via email
- [ ] Remove/clean up dead testnet helper API code

**Testing:**
- [ ] Unit tests for session signing/verification (`src/server/session.ts`)
- [ ] Unit tests for WebAuthn passkey flow (`src/server/passkey.ts`)
- [ ] Unit tests for MPC/borsh serialization and account creation (`src/server/mpc.ts`)
- [ ] Unit tests for IPFS encryption/decryption roundtrip (`src/server/recovery/ipfs.ts`)
- [ ] Unit tests for wallet recovery signature verification (`src/server/recovery/wallet.ts`)
- [ ] Unit tests for codename generation/validation (`src/server/codename.ts`)
- [ ] Integration tests for registration and authentication flows
- [ ] Integration tests for recovery flows

### Out of Scope

- New authentication methods — hardening existing, not adding features
- SQLite adapter implementation — removing the type declaration instead
- Mobile app or native SDK — web-only library
- Real-time features — not relevant to auth
- UI components — library provides hooks, not UI

## Context

- This is a published npm package at version 0.5.2
- TypeScript strict mode is currently disabled — not changing that in this pass
- The codebase has zero test files despite vitest being configured
- Several critical code paths are stubs that return fake success responses
- Node.js >= 18 required; development environment has Node 12 (use nvm)
- Codebase map available at `.planning/codebase/` with detailed analysis of all concerns

## Constraints

- **Tech stack**: Must remain Express + React compatible, no framework changes
- **API compatibility**: Public API surface (`createAnonAuth`, hooks, routes) must not break existing consumers
- **Dependencies**: Minimize new dependencies — zod for validation, AWS SES SDK for email, express-rate-limit for rate limiting, structured logger (pino or similar)
- **No PII**: The anonymous auth track must never collect or store personally identifiable information

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| AWS SES for email | User preference, scalable, cost-effective | — Pending |
| Compound codenames (ALPHA-BRAVO-42) | Expands namespace from ~2.5K to millions, more memorable than hash-based | — Pending |
| Remove SQLite type instead of implementing adapter | Clean up lies in types, SQLite not needed for this library's use case | — Pending |
| Skip auto-recovery for OAuth until email works | Can't deliver recovery passwords without email service | — Pending |
| zod for runtime validation | Lightweight, TypeScript-native, good DX | — Pending |

---
*Last updated: 2026-04-19 after Phase 9 (WebAuthn PRF Extension) — library bumped to v0.6.0; 12 PRF-* requirements satisfied; automated verification 8/8 pass (252 tests); 6 real-browser scenarios tracked in 09-HUMAN-UAT.md*
