# Roadmap: near-phantom-auth Hardening (v0.5.x → v0.6.x)

## Overview

This milestone hardens a published anonymous passkey authentication SDK from functional-but-unsafe to production-safe. Every phase addresses a specific layer of correctness: atomic security bug fixes first (no new dependencies, highest safety-to-effort ratio), then input validation infrastructure, then observability, then HTTP-layer defenses, then database integrity plus functional stubs, then scalability and tech debt cleanup, and finally comprehensive test coverage. Each phase delivers a verifiable safety improvement; no phase ships partially-working security.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Atomic Security Fixes** - Eliminate timing side-channel, fix session persistence, correct MPC math and transaction format
- [x] **Phase 2: Input Validation** - Add zod schemas to all 16 route endpoints; reject malformed requests before they reach handlers (completed 2026-03-14)
- [x] **Phase 3: Structured Logging** - Replace 40+ console statements with injectable pino logger with redaction of sensitive fields (completed 2026-03-14)
- [x] **Phase 4: HTTP Defenses** - Add tiered rate limiting and opt-in CSRF protection inside library-owned routers (completed 2026-03-14)
- [x] **Phase 5: DB Integrity and Functional Stubs** - Wrap registration in a database transaction; implement real MPC signing and missing endpoints (completed 2026-03-14)
- [ ] **Phase 6: Scalability, Tech Debt, and Email** - Move OAuth state to DB, add cleanup, expand codenames, fix N+1 queries, wire AWS SES
- [ ] **Phase 7: Test Coverage** - Unit and integration tests for all hardened code paths; zero gaps in security-critical modules

## Phase Details

### Phase 1: Atomic Security Fixes
**Goal**: Known security bugs and correctness defects in single files are eliminated before any new infrastructure is added
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-04, BUG-01, BUG-02, BUG-03, DEBT-02
**Success Criteria** (what must be TRUE):
  1. A session cookie with a tampered signature produces a 401, not a 200, and does not reveal timing information (constant-time comparison active in `session.ts`)
  2. NEAR account derivation produces a different output when a derivation salt is configured versus when it is absent — same userId no longer maps to the same account ID
  3. A session refresh request updates the `expiresAt` timestamp in the database row, not only the Set-Cookie header
  4. `buildSignedTransaction()` returns an object that includes the signer's public key in the signature wrapper, not just the signature bytes
  5. Treasury funding calls use integer yoctoNEAR math; no floating-point rounding errors occur for amounts smaller than 1 NEAR
**Plans**: 3 plans
Plans:
- [x] 01-01-PLAN.md — Test infrastructure, type contracts (vitest config, test stubs, interface additions)
- [x] 01-02-PLAN.md — Session security fixes (SEC-01 timing-safe comparison, BUG-03 refresh DB persistence)
- [x] 01-03-PLAN.md — MPC correctness fixes (DEBT-02 bs58, BUG-01 yoctoNEAR, BUG-02 signed tx, SEC-04 derivation salt)

### Phase 2: Input Validation
**Goal**: All 16 route handlers reject structurally invalid or missing request fields with a structured 400 before any business logic executes
**Depends on**: Phase 1
**Requirements**: SEC-05
**Success Criteria** (what must be TRUE):
  1. Sending a registration request with a missing or wrong-type field returns `{ "error": "..." }` with HTTP 400, not an unhandled exception or 500
  2. WebAuthn credential response fields with extra unknown browser-extension properties are accepted, not rejected (zod does not use `.strict()` on response fields)
  3. All 16 route handlers have a corresponding zod schema; no route destructures `req.body` without prior validation
**Plans**: 2 plans
Plans:
- [x] 02-01-PLAN.md — Install Zod 4, create 13 request body schemas, validateBody helper, and unit tests
- [x] 02-02-PLAN.md — Wire validation into router.ts and oauth/router.ts, replacing manual guards

### Phase 3: Structured Logging
**Goal**: No `console.*` call remains in server code; all log output is structured JSON via an injectable pino instance with sensitive fields redacted
**Depends on**: Phase 2
**Requirements**: SEC-06, INFRA-01
**Success Criteria** (what must be TRUE):
  1. A production log stream for a full registration flow contains no treasury private key, derivation path, MPC public key, session secret, or raw request body fields
  2. A consumer who passes their own pino instance via `AnonAuthConfig.logger` sees all library log output in their instance — no duplicate logger instances
  3. A consumer who provides no logger sees no log output (default no-op logger); the library does not install a global logger
  4. All `console.log`, `console.error`, and `console.warn` calls are absent from `src/server/` source files
**Plans**: 2 plans
Plans:
- [ ] 03-01-PLAN.md — Install pino, add logger to all config interfaces, thread through createAnonAuth, test scaffold
- [ ] 03-02-PLAN.md — Replace all console.* calls with pino logger calls, sensitive field audit, complete test suite

### Phase 4: HTTP Defenses
**Goal**: All auth and recovery endpoints are protected by rate limiting; state-changing endpoints can be protected by CSRF verification when consumers opt in
**Depends on**: Phase 3
**Requirements**: SEC-02, SEC-03, INFRA-05
**Success Criteria** (what must be TRUE):
  1. Sending more than the configured threshold of login attempts from the same IP within the rate limit window returns HTTP 429
  2. Recovery endpoints have a stricter rate limit than standard auth endpoints — the recovery limit is hit before the auth limit at the same request rate
  3. When CSRF protection is enabled in config, a state-changing request without a valid CSRF token returns HTTP 403
  4. CSRF protection defaults to disabled; existing consumers who do not set `config.csrf` observe no behavior change
  5. The OAuth callback route is exempt from CSRF verification (OAuth redirects arrive cross-origin and cannot carry a CSRF cookie)
**Plans**: 3 plans
Plans:
- [ ] 04-01-PLAN.md — Install deps, config types, test stubs, wire createAnonAuth forwarding
- [ ] 04-02-PLAN.md — Implement tiered rate limiting in both routers with tests
- [ ] 04-03-PLAN.md — Implement opt-in CSRF protection, OAuth exemption, INFRA-05 cookie guard with tests

### Phase 5: DB Integrity and Functional Stubs
**Goal**: Registration cannot leave the database in a partial state; wallet recovery linking uses real MPC signing; passkey re-registration and account deletion endpoints exist and work
**Depends on**: Phase 4
**Requirements**: INFRA-02, BUG-04, STUB-01, STUB-02, STUB-03
**Success Criteria** (what must be TRUE):
  1. If any step of registration finish fails after user creation, no orphaned user row, passkey row, or session row remains in the database
  2. `addRecoveryWallet()` returns a real NEAR transaction hash (does not match `/^pending-/`) that is verifiable on NEAR explorer
  3. `verifyRecoveryWallet()` returns false for a NEAR account that has keys, but none of which match the registered recovery wallet's public key
  4. A user who completed recovery can call the passkey re-registration endpoint and receive a new credential registration challenge
  5. Calling the account deletion endpoint removes the user row and all associated passkeys, sessions, and challenges — a subsequent login attempt with the deleted account's credentials returns 401
**Plans**: 3 plans
Plans:
- [ ] 05-01-PLAN.md — Type contracts (DatabaseAdapter extensions), postgres adapter implementations, test scaffold
- [ ] 05-02-PLAN.md — Real MPC AddKey signing (STUB-01) and wallet verification fix (BUG-04) in mpc.ts
- [ ] 05-03-PLAN.md — Transaction-wrapped registration (INFRA-02), wallet/verify fix, re-registration and deletion routes (STUB-02, STUB-03)

### Phase 6: Scalability, Tech Debt, and Email
**Goal**: The library works correctly across server restarts and multi-instance deployments; code contains no false type claims, dead code, or avoidable inefficiencies; OAuth recovery passwords are delivered via email
**Depends on**: Phase 5
**Requirements**: INFRA-03, INFRA-04, DEBT-01, DEBT-03, DEBT-04, PERF-01, PERF-02, EMAIL-01, EMAIL-02, BUG-05
**Success Criteria** (what must be TRUE):
  1. An OAuth login flow that starts on one server instance and completes on a different instance (after the first restarts) succeeds — OAuth state survives restart because it is stored in the database
  2. Expired sessions and challenges do not accumulate indefinitely — a cleanup mechanism removes records past their expiry
  3. The codename generation system produces unique codenames beyond ~50 users without collision; compound codenames (ALPHA-BRAVO-42 style) are generated and validated correctly
  4. The `DatabaseConfig` type union does not include `'sqlite'`; `TypeScript` compilation fails if a consumer passes `type: 'sqlite'`
  5. An OAuth user lookup executes one JOIN query, not three sequential queries — observable via query logging
  6. IPFS recovery backup retrieval uses concurrent gateway requests; the first successful response is returned without waiting for slower gateways
  7. After a successful OAuth registration, the user receives an email containing their recovery password (when AWS SES is configured)
**Plans**: 4 plans
Plans:
- [ ] 06-01-PLAN.md — OAuth state to DB (INFRA-03) and JOIN-based OAuth user lookups (PERF-01)
- [ ] 06-02-PLAN.md — Compound codenames (DEBT-01), remove sqlite type (DEBT-03), remove dead code (DEBT-04), concurrent IPFS fetch (PERF-02)
- [ ] 06-03-PLAN.md — AWS SES email service (EMAIL-01), OAuth recovery email wiring (EMAIL-02, BUG-05)
- [ ] 06-04-PLAN.md — Automatic cleanup scheduler for expired sessions, challenges, and OAuth states (INFRA-04)

### Phase 7: Test Coverage
**Goal**: Every security-critical module has unit tests; every route handler has integration tests; adversarial inputs are tested explicitly
**Depends on**: Phase 6
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07, TEST-08
**Success Criteria** (what must be TRUE):
  1. `vitest run` passes with zero failures across unit tests for `session.ts`, `passkey.ts`, `mpc.ts`, `recovery/ipfs.ts`, `recovery/wallet.ts`, and `codename.ts`
  2. Integration tests cover the full registration flow and the full authentication flow end-to-end via `supertest`; both flows pass against the real route handlers
  3. Integration tests cover the IPFS recovery flow and the wallet recovery flow; both pass
  4. Adversarial test cases pass: a tampered session cookie returns 401, an expired challenge returns 400, a truncated session cookie is handled without throwing, and a NEAR account with an unrelated key returns false from wallet verification
  5. No test asserts a stub return value — tests for `addRecoveryWallet` assert the txHash does NOT match `/^pending-/`
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Atomic Security Fixes | 3/3 | Complete | 2026-03-14 |
| 2. Input Validation | 2/2 | Complete   | 2026-03-14 |
| 3. Structured Logging | 2/2 | Complete   | 2026-03-14 |
| 4. HTTP Defenses | 3/3 | Complete   | 2026-03-14 |
| 5. DB Integrity and Functional Stubs | 3/3 | Complete   | 2026-03-14 |
| 6. Scalability, Tech Debt, and Email | 1/4 | In Progress|  |
| 7. Test Coverage | 0/TBD | Not started | - |
