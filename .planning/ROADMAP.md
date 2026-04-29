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
- [x] **Phase 6: Scalability, Tech Debt, and Email** - Move OAuth state to DB, add cleanup, expand codenames, fix N+1 queries, wire AWS SES (completed 2026-03-14)
- [x] **Phase 7: Test Coverage** - Unit and integration tests for all hardened code paths; zero gaps in security-critical modules
- [ ] **Phase 8: Wire OAuth Callback to DB-Backed State Validation** - Replace cookie-based OAuth state comparison with DB-backed validateState(); fix unconditional cookieParser mounting
- [ ] **Phase 9: WebAuthn PRF Extension for DEK Sealing Key** - Derive 32-byte sealing key per credential via WebAuthn PRF extension; thread sealingKeyHex through finish endpoints; bump 0.5.3 to 0.6.0

### Milestone v0.6.1 — MPCAccountManager Hotfix

- [ ] **Phase 10: MPCAccountManager** - Ship the missing MPCAccountManager class to unblock Ledgera mpc-sidecar production restart loop; additive only, contract FROZEN by consumer pin

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
**Plans**: 4 plans
Plans:
- [x] 07-01-PLAN.md — Pure function unit tests: codename (TEST-06) and IPFS encrypt/decrypt (TEST-04)
- [x] 07-02-PLAN.md — Wallet recovery unit tests (TEST-05) and session adversarial verification (TEST-01)
- [x] 07-03-PLAN.md — Passkey unit tests (TEST-02), MPC addRecoveryWallet + db-integrity stubs (TEST-03)
- [x] 07-04-PLAN.md — Integration tests: registration/auth flows (TEST-07) and recovery flows (TEST-08)

### Phase 8: Wire OAuth Callback to DB-Backed State Validation
**Goal**: The OAuth callback handler uses DB-backed state validation instead of cookie comparison; cookieParser is mounted unconditionally so OAuth works with or without CSRF enabled
**Depends on**: Phase 6, Phase 7
**Requirements**: INFRA-03
**Gap Closure:** Closes gaps from v0.5 audit
**Success Criteria** (what must be TRUE):
  1. An OAuth login flow that starts on one server instance and completes on a different instance succeeds — `oauthManager.validateState(state)` is called in the callback, not cookie comparison
  2. `cookieParser()` is mounted unconditionally in the OAuth router — OAuth callback works regardless of CSRF configuration
  3. DB-stored OAuth state is consumed and atomically deleted during callback (replay protection works)
  4. Tests verify DB-backed state validation and cookieParser availability without CSRF
**Plans**: 1 plans
Plans:
- [ ] 08-01-PLAN.md — Wire DB-backed validateState() into OAuth callback, mount cookieParser unconditionally, add tests

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Atomic Security Fixes | 3/3 | Complete | 2026-03-14 |
| 2. Input Validation | 2/2 | Complete   | 2026-03-14 |
| 3. Structured Logging | 2/2 | Complete   | 2026-03-14 |
| 4. HTTP Defenses | 3/3 | Complete   | 2026-03-14 |
| 5. DB Integrity and Functional Stubs | 3/3 | Complete   | 2026-03-14 |
| 6. Scalability, Tech Debt, and Email | 4/4 | Complete   | 2026-03-14 |
| 7. Test Coverage | 4/4 | Complete   | 2026-03-14 |
| 8. Wire OAuth Callback to DB-Backed State Validation | 0/1 | Not Started | — |
| 9. WebAuthn PRF Extension for DEK Sealing Key | 0/3 | Not Started | — |

### Phase 9: WebAuthn PRF Extension for DEK Sealing Key
**Goal**: Library derives a stable 32-byte sealing key per credential via the WebAuthn PRF extension, hex-encodes it, and includes `sealingKeyHex` in POST bodies to `/register/finish` and `/login/finish` so a downstream auth-service can provision and unwrap per-user DEKs. Gracefully degrades on PRF-unsupported browsers; opt-in `requirePrf` enforcement available.
**Depends on**: Phase 8
**Requirements**: PRF-01, PRF-02, PRF-03, PRF-04, PRF-05, PRF-06, PRF-07, PRF-08, PRF-09, PRF-10, PRF-11, PRF-12
**Success Criteria** (what must be TRUE):
  1. `createPasskey()` and `authenticateWithPasskey()` request the PRF extension when called with `prfOptions.salt` and return `sealingKeyHex` (64 lowercase hex chars) for PRF-supported authenticators
  2. The same credential + same salt produces identical `sealingKeyHex` across registration and every subsequent login (round-trip determinism via deterministic HMAC test mock)
  3. POST `/register/finish` and POST `/login/finish` bodies include `sealingKeyHex` ONLY when defined; the field is OMITTED entirely (not sent as `null`) when PRF is unsupported
  4. Server-side zod schema validates `sealingKeyHex` as `/^[0-9a-f]{64}$/` and rejects wrong length, uppercase hex, or non-hex characters
  5. `<AnonAuthProvider passkey={{ requirePrf: true }}>` causes `register()`/`login()` to throw an error starting with `PRF_NOT_SUPPORTED` when the authenticator returns no PRF result; default `requirePrf=false` completes the ceremony without `sealingKeyHex`
  6. Default salt `near-phantom-auth-prf-v1` is a module-level constant in `useAnonAuth.tsx` and documented as a permanent deployment commitment
  7. `package.json` version is `0.6.0`; `package-lock.json` contains zero `0.5.3` references
  8. README documents salt immutability, browser support matrix, and the NULL key-bundle migration approach
**Plans**: 3 plans
Plans:
- [x] 09-01-PLAN.md — Type contracts (PasskeyConfig), zod schema validation for sealingKeyHex, prf.test.ts scaffold with deterministic HMAC mock factory
- [x] 09-02-PLAN.md — Client PRF ceremony (createPasskey + authenticateWithPasskey extension wiring + hex extraction); api.ts spread-conditional body threading
- [x] 09-03-PLAN.md — useAnonAuth.tsx PRF wiring + requirePrf rejection + DEFAULT_PRF_SALT; package.json/lockfile bump 0.5.3 -> 0.6.0; README PRF section

---

## Milestone v0.6.1 — MPCAccountManager Hotfix

**Context:** v0.5 milestone closed 35/35 requirements satisfied (library at v0.6.0). v0.6.1 is a single-phase, additive-only hotfix to unblock a downstream consumer (Ledgera mpc-sidecar) in a production restart loop. The `MPCAccountManager` class was missing from `@vitalpoint/near-phantom-auth/server`. Contract is FROZEN by consumer pin — no field, method, or return-shape renames.

**Phases:**

- [ ] **Phase 10: MPCAccountManager** - Ship the missing MPCAccountManager class (createAccount + verifyRecoveryWallet) with idempotency, nonce safety, treasury key redaction, T1-T12 test coverage, and npm publish v0.6.1

### Phase 10: MPCAccountManager

**Goal**: A downstream consumer can `import { MPCAccountManager } from '@vitalpoint/near-phantom-auth/server'`, instantiate with treasury credentials and a derivation salt, call `createAccount(userId)` idempotently, call `verifyRecoveryWallet(nearAccountId, publicKey)` safely, and never risk leaking the treasury private key — all covered by T1–T12 tests and published as v0.6.1
**Depends on**: Phase 9 (v0.6.0 base; this phase extends /server exports additively)
**Requirements**: MPC-01, MPC-02, MPC-03, MPC-04, MPC-05, MPC-06, MPC-07, MPC-08, MPC-09, MPC-10, MPC-11, MPC-12
**Success Criteria** (what must be TRUE):
  1. A consumer can `import { MPCAccountManager } from '@vitalpoint/near-phantom-auth/server'` and the class is defined with the FROZEN contract (`createAccount`, `verifyRecoveryWallet`, `MPCAccountManagerConfig`, `CreateAccountResult` types); all v0.6.0 exports remain unchanged
  2. Calling `createAccount('alice')` twice with the same config returns identical `nearAccountId`, `mpcPublicKey`, and `derivationPath`; the `nearAccountId` matches `/^[a-f0-9]{64}$/`; the second call short-circuits via `view_account` and issues exactly zero additional on-chain transfers
  3. `verifyRecoveryWallet(account, functionCallKey)` returns `false`; `verifyRecoveryWallet(deletedAccount, key)` returns `false` without throwing; `verifyRecoveryWallet(account, fullAccessKey)` returns `true`
  4. `grep -r treasuryPrivateKey dist/` produces no log or console calls; a structured-log fixture captured during `createAccount` excludes the treasury private key at every log level; no `near-cli` shell-out occurs
  5. All 12 spec scenarios T1–T12 pass under `npm test` (first-call provision, second-call idempotency, distinct userId/salt isolation, RPC failure throws, treasury-underfunded throws, recovery verification matrix, concurrent-call convergence, hex-format assertion)
  6. `npm publish` succeeds at v0.6.1 and a fresh consumer can `npm install`, import, instantiate, and call `createAccount` against a testnet treasury end-to-end
**Plans**: 6 plans
Plans:
- [x] 10-01-PLAN.md — Surgical export fix in src/server/index.ts + exports.test.ts regression gate (MPC-01)
- [x] 10-02-PLAN.md — Wave-0 mpc-account-manager.test.ts scaffold with T1-T12 it.todo placeholders (test infra for MPC-02..MPC-06, MPC-10, MPC-11)
- [x] 10-03-PLAN.md — checkWalletAccess FullAccess permission gate + wallet.test.ts MPC-05 cases (MPC-04, MPC-05)
- [x] 10-04-PLAN.md — MPCAccountManager class hardening (KeyPair field, parseNearAmount, throw paths, nonce-race convergence) + populate T1-T12 (MPC-02, MPC-03, MPC-06, MPC-08, MPC-09, MPC-10, MPC-11)
- [x] 10-05-PLAN.md — Treasury leak audit (Pino redact + dist grep + log-stream fixture + type-level salt enforcement) (MPC-07, MPC-09)
- [ ] 10-06-PLAN.md — Bump to 0.6.1, CHANGELOG.md, README.md MPCAccountManager section, npm publish, smoke install (MPC-12; autonomous: false)

### v0.6.1 Progress

**Execution Order:**
Phase 10 is the sole phase of milestone v0.6.1.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 10. MPCAccountManager | 5/6 | In Progress|  |
