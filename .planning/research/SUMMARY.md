# Project Research Summary

**Project:** near-phantom-auth (hardening pass — v0.5.x → v0.6.x)
**Domain:** Security hardening of a published npm library providing anonymous passkey + NEAR MPC authentication
**Researched:** 2026-03-14
**Confidence:** HIGH (all research grounded in direct codebase analysis + established security standards)

---

## Executive Summary

`@vitalpoint/near-phantom-auth` is a published npm package that provides anonymous passkey authentication backed by NEAR MPC accounts. The library has a coherent design and a working architecture, but the current codebase is not production-safe: it has an active timing side-channel in session verification, no rate limiting, no input validation, 40+ console statements that can expose treasury keys, registration flows that leave the database in an unrecoverable partial state on failure, multiple functional stubs that return fake success, and zero test coverage. This hardening pass must fix all of these before the library can be recommended for production use.

The recommended approach is a layered, dependency-ordered execution: atomic single-file security fixes first (timing-safe comparison, MPC derivation salt, session refresh persistence), then input validation infrastructure (zod), then observability (structured logging via injectable pino), then HTTP-layer defenses (rate limiting, CSRF), then database integrity (transaction wrapping), then the two functional stubs that require significant implementation effort (real MPC signing for `addRecoveryWallet`, account deletion endpoint). New dependencies are minimal and deliberate: `zod`, `express-rate-limit`, `pino`, `csrf-csrf`, `@aws-sdk/client-ses`, and `supertest` (test only). The `crypto.timingSafeEqual` fix requires no new dependency at all.

The primary risks are: (1) breaking the `DatabaseAdapter` public interface without a version bump — prevent by making new interface methods optional with internal fallbacks; (2) PostgreSQL connection pool exhaustion from wrapping the NEAR MPC HTTP call inside a database transaction — prevent by strictly ordering the external call before the transaction boundary; (3) logging the treasury private key via structured log calls — prevent by configuring pino `redact` paths comprehensively and never spreading config objects into log calls. All three risks are fully preventable with explicit awareness during implementation.

---

## Key Findings

### Recommended Stack

The existing project already has Vitest (`^4.0.18`) and `bs58` installed. The hardening pass requires six additions. Five are runtime dependencies because they operate in active request paths; one is test-only. All version recommendations carry MEDIUM confidence (training cutoff August 2025) and should be verified with `npm view <package> version` before pinning.

**Core technologies to add:**

- `zod ^3.23.x`: Runtime request body validation — TypeScript-native schema-to-type inference, no dual-maintenance of TS interfaces plus runtime checks. Do NOT use v4 until stable release is confirmed.
- `express-rate-limit ^7.x`: Per-IP rate limiting on auth and recovery endpoints — de-facto standard, zero non-Express dependencies, configurable store for Redis if consumers need multi-instance support.
- `pino ^9.x`: Structured JSON logging with field redaction — fastest Node.js JSON logger, built-in `redact` option for sensitive field paths, injectable by consumers to avoid duplicate instances.
- `csrf-csrf ^3.x`: Double-submit CSRF token pattern — OWASP-recommended approach, replacement for the deprecated `csurf` package.
- `@aws-sdk/client-ses ^3.x`: AWS SES email delivery for OAuth recovery passwords — AWS SDK v3 modular package only (never v2, which is deprecated).
- `crypto.timingSafeEqual`: Node.js built-in — no install needed, HIGH confidence, available since Node.js 15 (project requires >= 18).
- `supertest ^7.x` (devDependency): HTTP integration testing for Express routes.

See `.planning/research/STACK.md` for full rationale, usage patterns, and what NOT to add (helmet, jsonwebtoken, bcrypt, uuid — all explicitly out of scope).

---

### Expected Features

This is a hardening pass, not a feature pass. The feature landscape is dominated by security gaps and correctness bugs that block production safety, not missing capabilities. Features are classified by their urgency.

**Must have — critical security (table stakes for production):**
- Constant-time session signature comparison — timing side-channel in `session.ts` line 68
- Rate limiting on all auth endpoints — tiered by sensitivity (stricter on `/recovery/*`)
- Server-side secret salt for NEAR account ID derivation — predictable derivation from userId
- zod runtime input validation on all route handlers — `req.body` is currently destructured raw
- CSRF token verification — opt-in, required when `sameSite` is not `strict`

**Must have — correctness bugs that break existing functionality:**
- Session refresh must persist `expiresAt` to the database — currently only refreshes the cookie
- Registration finish must be database-transactional — 4 sequential DB writes with no rollback
- Fix `buildSignedTransaction()` to include public key in output — blocks all mainnet usage
- Fix floating-point yoctoNEAR conversion — use `BigInt`-based math or `@near-js/utils parseNearAmount`
- `verifyRecoveryWallet()` must check the specific wallet public key — currently passes any account with any keys
- Real MPC signing for `addRecoveryWallet()` — currently returns `pending-${Date.now()}` fake txHash

**Must have — observability:**
- Structured logging via injectable pino — replace 40+ `console.*` calls; redact treasury keys, derivation paths, session secrets

**Must have — missing endpoints:**
- Passkey re-registration post-recovery — the recovery success message promises this but the endpoint does not exist
- Account deletion (`DELETE /account`) — GDPR compliance requirement

**Should have — scalability and cleanup:**
- OAuth state persisted to database — in-memory `Map` loses state on restart and fails multi-instance
- Expired session and challenge cleanup — records accumulate indefinitely
- Compound codenames — NATO codename namespace exhausts at ~50 users (birthday paradox)
- N+1 query fix for OAuth user lookups — 3 sequential queries, should be a single JOIN
- Concurrent IPFS gateway fallback with `Promise.any()`

**Technical debt (do in this pass):**
- Replace hand-rolled `base58Encode()` with `bs58.encode()` consistently
- Remove false `'sqlite'` from `DatabaseConfig` type union
- Fix OAuth recovery password delivery (currently discarded after generation)
- Add explicit cookie-parser peer dependency documentation

**Defer to post-hardening:**
- TypeScript strict mode — explicitly deferred in PROJECT.md, significant effort
- SQLite adapter — explicitly out of scope
- Passkey management and session management endpoints (list/revoke individual passkeys or devices)

See `.planning/research/FEATURES.md` for the full feature inventory with complexity, status, and dependency graph.

---

### Architecture Approach

The single most important architectural constraint is that this is a library, not an application. Every hardening concern must be self-contained within the routers the library controls (`createRouter`, `createOAuthRouter`) or exposed as opt-in configuration via `AnonAuthConfig`. The library cannot install global Express middleware without the consumer's knowledge. This rules out "install rate limiting at the app level" and mandates that all middleware goes inside `createRouter()` and `createOAuthRouter()`.

Hardening integrates across six architectural layers in a specific dependency order. The existing factory architecture (`createAnonAuth(config)` → manager factories → router factories) supports clean injection: the logger, rate limiter config, CSRF config, and derivation salt all flow in through `AnonAuthConfig` and are threaded down through manager and router factories. No public API surface changes are required for any of the security fixes — only additive optional config fields and one interface extension (`DatabaseAdapter.transaction()`).

**Major components and their hardening touchpoints:**

1. `src/types/index.ts` — New optional config fields: `AnonAuthConfig.rateLimiting`, `.csrf`, `.logger`, `MPCAccountConfig.derivationSalt`, `DatabaseAdapter.transaction()` (additive, all optional with fallbacks)
2. `src/server/router.ts` + `src/server/oauth/router.ts` — Rate limiter middleware (per-route granularity), CSRF verification middleware, zod `validate()` middleware factory, `db.transaction()` wrapping for registration finish
3. `src/server/session.ts` — `crypto.timingSafeEqual` replacement (1 line), `db.updateSessionExpiry()` call in session refresh
4. `src/server/mpc.ts` — Derivation salt, `bs58.encode()` replacement, `BigInt` yoctoNEAR fix, real borsh MPC signing, transaction public key in output
5. `src/server/index.ts` + all manager factories — Logger injection (mechanical find-and-replace of `console.*` calls)
6. `src/db/adapters/postgres.ts` — `transaction()` implementation (pattern already exists in `createOAuthUser`)

The data flow post-hardening is: Rate Limiter → CSRF Verification → JSON body-parser → zod `validate()` → Route Handler → (optionally) `db.transaction()`. See `.planning/research/ARCHITECTURE.md` for the full implementation order across 6 dependency layers and backward compatibility analysis.

---

### Critical Pitfalls

1. **Breaking `DatabaseAdapter` interface without versioning** — Adding `updateSessionExpiry()` or `transaction()` to the interface breaks all custom adapter implementations at runtime with `TypeError: db.X is not a function`. Prevention: make all new interface methods optional (`?`) with internal fallbacks in the calling code. Document as soft breaking changes in CHANGELOG.

2. **PostgreSQL transaction wrapping the NEAR MPC HTTP call** — Wrapping `createAccount()` (external NEAR RPC call) inside a `BEGIN/COMMIT` block holds the PostgreSQL connection open while waiting for a potentially slow testnet response, exhausting the connection pool under load. Prevention: execute `mpcManager.createAccount()` BEFORE opening the database transaction. The MPC call is intentionally outside the transaction boundary.

3. **Logging the treasury private key via structured log context** — `logger.info({ ...config }, ...)` or `logger.error({ err: error }, ...)` where `err.context` contains config will expose `treasuryPrivateKey` to the log stream. Prevention: configure pino `redact` paths comprehensively (`['*.treasuryPrivateKey', '*.secret', '*.password', '*.apiKey', 'req.body.password', 'req.body.cid']`); never spread req.body or config objects into log calls directly.

4. **Zod `.strict()` on WebAuthn response objects breaks cross-browser compatibility** — WebAuthn browser implementations add non-standard fields to `clientExtensionResults`. Any strict schema rejects real Safari/Firefox registrations. Prevention: validate only presence and top-level shape for WebAuthn `response` fields; use `z.object({...})` (default strips unknown keys) or `.passthrough()`, never `.strict()` on the `response` field.

5. **`crypto.timingSafeEqual` throws (not returns false) on length mismatch** — A truncated attacker cookie causes an unhandled 500 instead of a clean 401, and the 500 is itself a behavioral oracle. Prevention: always length-check buffers before calling `timingSafeEqual`; a length mismatch is a safe early `return null`.

6. **Tests that pass against stubs provide false confidence** — `addRecoveryWallet()` returns `pending-${Date.now()}` and `verifyRecoveryWallet()` returns `true` for any account with any keys. Tests written to current behavior will still pass after the stub, providing zero verification of the real implementation. Prevention: write failing tests before fixing stubs (e.g., assert txHash does NOT match `/^pending-/`; assert a NEAR account with an unrelated key returns `false`).

See `.planning/research/PITFALLS.md` for 8 additional moderate and minor pitfalls with phase-specific warnings.

---

## Implications for Roadmap

Based on the dependency graph in ARCHITECTURE.md and the priority ordering in FEATURES.md, the recommended phase structure is as follows. The ordering is strict: each phase either has no dependencies on later phases, or explicitly depends on the output of a prior phase.

### Phase 1: Atomic Security Fixes

**Rationale:** These are single-file changes with no new dependencies and the highest security-to-effort ratio. They can be implemented, reviewed, and tested independently. Doing them first establishes a safe baseline before adding new middleware layers.

**Delivers:** Elimination of the timing side-channel, correct session persistence, correct MPC account derivation, correct floating-point precision, correct transaction format, and consistent base58 encoding.

**Addresses features:** Constant-time session comparison, server-side derivation salt, session refresh DB persistence, fix `buildSignedTransaction()`, fix yoctoNEAR conversion, replace custom `base58Encode`.

**Avoids pitfalls:** `timingSafeEqual` length pre-check (Pitfall 8), base58 output parity test before replacing (Pitfall 11).

**Files touched:** `session.ts`, `mpc.ts`, `types/index.ts` (derivation salt config field only).

---

### Phase 2: Input Validation (zod)

**Rationale:** Establishing validated, typed request data before adding rate limiting and CSRF means higher layers operate on known-good shapes. Also makes all subsequent handler changes safer.

**Delivers:** zod schemas for all 16 route endpoints; structured 400 responses; automatic stripping of unknown request fields.

**Addresses features:** Runtime input validation on all route handlers; WebAuthn response shape validation.

**Avoids pitfalls:** No `.strict()` on WebAuthn response fields (Pitfall 2); map zod errors to `{ error: string }` format, never expose raw `ZodError` (Pitfall 9).

**Files touched:** `router.ts`, `oauth/router.ts`, `package.json`.

---

### Phase 3: Structured Logging

**Rationale:** Logging changes are pervasive (40+ files) but purely mechanical — no logic changes, only `console.*` → `logger.*` substitutions. Doing this before rate limiting and CSRF means those new features can log from the start. After Phase 1, the corrected logic is in place, so logs will reflect correct behavior.

**Delivers:** Injectable pino logger throughout all managers and routers; `console.*` eliminated from all server code; sensitive field redaction configured.

**Addresses features:** Structured logging with sensitive data redaction; library-safe logger factory (default no-op).

**Avoids pitfalls:** Comprehensive pino `redact` configuration (Pitfall 5); never spread `req.body` or config into log calls.

**Files touched:** `types/index.ts` (logger interface), `server/index.ts`, all manager files, `router.ts`, `oauth/router.ts`, `session.ts`.

---

### Phase 4: Rate Limiting and CSRF

**Rationale:** HTTP-layer defenses are added after input validation and logging are stable. Rate limiting needs stable route structure; CSRF needs stable session layer. Both can be implemented in the same phase since they are independent middleware layers in the same routers.

**Delivers:** Tiered rate limiters per endpoint sensitivity (strict on recovery, normal on login/register, relaxed on read-only); opt-in CSRF double-submit cookie protection.

**Addresses features:** Rate limiting on all auth endpoints; CSRF token verification.

**Avoids pitfalls:** Separate rate limiter instances for recovery vs authentication (Pitfall 3); CSRF middleware must explicitly exempt OAuth callback route (Pitfall 4); CSRF defaults to `enabled: false` to avoid breaking existing consumers.

**Files touched:** `router.ts`, `oauth/router.ts`, `types/index.ts` (config additions), `package.json`.

---

### Phase 5: Database Transaction Integrity

**Rationale:** Interface changes to `DatabaseAdapter` have the widest consumer impact and should be done after route handler changes are stable. The `transaction()` interface addition is the only potentially breaking change in the entire hardening pass and requires careful versioning communication.

**Delivers:** Atomic registration finish (user + passkey creation in a single DB transaction); session expiry update on refresh.

**Addresses features:** Registration flow database transaction, session refresh DB persistence (already fixed in Phase 1, but full transaction API needed here).

**Avoids pitfalls:** Make `transaction()` optional in interface with no-op fallback (Pitfall 1); execute `mpcManager.createAccount()` BEFORE `db.transaction()` — never inside it (Pitfall 7).

**Files touched:** `types/index.ts` (DatabaseAdapter interface), `db/adapters/postgres.ts`, `router.ts`.

---

### Phase 6: Functional Stubs and Missing Endpoints

**Rationale:** The two major stubs (`addRecoveryWallet`, `verifyRecoveryWallet`) and the two missing endpoints (passkey re-registration, account deletion) are deferred to last because they require the most implementation effort and are independent of the hardening infrastructure. The stubs must be approached test-first to avoid locking in stub behavior.

**Delivers:** Real MPC borsh transaction signing for wallet recovery linking; correct specific-key verification for wallet recovery; passkey re-registration post-recovery endpoint; account deletion endpoint with cascade deletes.

**Addresses features:** Real MPC signing for `addRecoveryWallet()`, `verifyRecoveryWallet()` specific key check, passkey re-registration endpoint, account deletion (GDPR).

**Avoids pitfalls:** Write failing tests before implementing stubs (Pitfall 6); `verifyRecoveryWallet()` test must assert false for unrelated keys specifically.

**Files touched:** `mpc.ts`, `router.ts`, `types/index.ts`, `db/adapters/postgres.ts`.

---

### Phase 7: Observability, Scalability, and Tech Debt Cleanup

**Rationale:** These items improve the library's production characteristics but do not block any of the above phases. They are grouped together as a cleanup sprint.

**Delivers:** OAuth state persisted to database (survives restarts, works multi-instance); expired record cleanup (auto or documented consumer responsibility); compound codenames (namespace expansion); N+1 query fix for OAuth lookups; concurrent IPFS gateway fallback; removal of false SQLite type; OAuth recovery password delivery deferred correctly; cookie-parser peer dependency documented; scrypt params versioned in `EncryptedRecoveryData`.

**Addresses features:** OAuth state → DB, expired session cleanup, compound codenames, N+1 fix, IPFS concurrent fallback, SQLite type removal, scrypt params versioning.

**Avoids pitfalls:** Remove in-memory OAuth `Map` in the same PR as DB storage addition — no dual-store transition (Pitfall 10); `isValidCodename()` must accept both old and new codename formats (Pitfall 13); cleanup scheduler guarded with `NODE_ENV !== 'test'` (Pitfall 12); add scrypt params to `EncryptedRecoveryData` struct (Pitfall 14).

---

### Phase 8: Test Coverage

**Rationale:** A dedicated test pass after all implementation is complete, using `vitest` (already installed) and `supertest` (added in Phase 2). Test writing is identified as a cross-cutting concern but is most effective as a final verification pass. Per Pitfall 6, critical tests for stubs must be written in Phase 6 before implementing the fix, not here.

**Delivers:** Unit tests for session, passkey, MPC, codename, and IPFS modules; integration tests via `supertest` for all route handlers; adversarial test cases (wrong password, invalid signature, expired challenge, truncated session cookie, unrelated recovery key).

**Addresses features:** Zero test coverage gap; test coverage for all hardening changes.

**Avoids pitfalls:** Tests for `addRecoveryWallet`/`verifyRecoveryWallet` mock RPC responses; no tests that assert stub return values (Pitfall 6); challenge expiry set to long timeout in test environment (Pitfall 12).

---

### Phase Ordering Rationale

- Phases 1-3 have no new infrastructure dependencies and can proceed immediately.
- Phase 4 depends on Phase 2 (stable route structure) and Phase 3 (logger available for new middleware).
- Phase 5 depends on Phase 4 (route handlers stable before adding interface changes).
- Phase 6 depends on Phase 5 (full DB transaction API available for cascade deletes in account deletion).
- Phase 7 is independent of Phase 6 and could be parallelized, but cleanup naturally follows core correctness work.
- Phase 8 is most effective as a final verification pass, though Phase 6's stub tests must be written before Phase 6's implementation (test-first).

---

### Research Flags

Phases likely needing deeper research or careful validation during execution:

- **Phase 6 (MPC signing):** Real borsh transaction serialization for NEAR AddKey transactions is the most complex implementation item. The borsh helpers in `mpc.ts` already exist, but the exact serialization for an AddKey transaction should be validated against NEAR protocol test vectors or nearcore source before shipping. Consider capturing a real AddKey transaction from NEAR testnet explorer to use as a verification fixture.
- **Phase 5 (DatabaseAdapter interface change):** The versioning and consumer migration communication needs explicit thought before this ships. Recommend reviewing semver implications: this is technically a patch or minor bump on a 0.x package but has real consumer impact.

Phases with well-established patterns (additional research unlikely to add value):

- **Phase 1** — Single-file fixes to known bugs; Node.js built-ins; no research needed.
- **Phase 2** — Zod schema-per-route is a documented, well-established pattern; ARCHITECTURE.md has complete schema inventory for all 16 routes.
- **Phase 3** — Injectable logger pattern for npm libraries is standard; ARCHITECTURE.md has the complete propagation map.
- **Phase 4** — express-rate-limit and csrf-csrf have comprehensive documentation; ARCHITECTURE.md has the exact middleware insertion points.
- **Phase 8** — Vitest + supertest for Express is thoroughly documented; test patterns are standard.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Library selections from training data (Aug 2025 cutoff). Framework choices (zod, pino, express-rate-limit) are HIGH confidence; exact minor versions are MEDIUM. Run `npm view` verification commands before pinning. |
| Features | HIGH | All findings from direct codebase analysis + `.planning/codebase/CONCERNS.md` + established security standards (OWASP, WebAuthn spec, Node.js crypto docs). No inference required. |
| Architecture | HIGH | All integration patterns derived from direct analysis of the actual source files. Factory pattern, router structure, existing transaction usage in `createOAuthUser` — all verified in codebase. No speculation. |
| Pitfalls | HIGH | 7 critical pitfalls, each with a specific code location and verified root cause. Node.js `timingSafeEqual` throw-on-length-mismatch behavior is documented in Node.js >= 18 source. PostgreSQL connection-pool-exhaustion from in-transaction HTTP calls is a well-known and well-documented antipattern. |

**Overall confidence:** HIGH

### Gaps to Address

- **Zod version:** Do not pin to `^3.23.x` without running `npm view zod version` first. Zod 4 was in development pre-cutoff; if it has shipped stable, evaluate whether to migrate. Do not assume v3 is current without verification.
- **Real borsh MPC signing (Phase 6):** The exact byte format for an AddKey transaction must be validated against a real NEAR testnet transaction before Phase 6 ships. The existing borsh helpers in `mpc.ts` give a starting point but the serialization correctness has not been verified in this research pass.
- **AWS SES configuration:** The email delivery feature (`@aws-sdk/client-ses`) requires `SES_FROM_ADDRESS` and AWS credentials to be documented as required environment variables when SES is enabled. The failure mode when SES credentials are absent should be graceful (skip delivery with a warning log) rather than a hard startup crash.
- **`DatabaseAdapter.transaction()` optional vs required:** The recommendation is to make this optional with a sequential no-op fallback. The team should decide whether partial-atomicity (no transaction support) is acceptable as a documented limitation for custom adapter implementors, or whether it should be a runtime requirement (hard error if absent). This decision affects whether Phase 5 introduces a soft breaking change or a hard one.

---

## Sources

### Primary (HIGH confidence — direct codebase analysis)

- `src/server/session.ts` — timing side-channel, session refresh bug
- `src/server/router.ts` — route handler inventory, registration transaction gap
- `src/server/mpc.ts` — derivation determinism, float precision, transaction format bug, base58 inconsistency, MPC signing stubs
- `src/server/oauth/router.ts` — in-memory OAuth state, N+1 queries, cookie-parser dependency
- `src/server/recovery/ipfs.ts` — scrypt params omission, IPFS sequential fallback
- `src/types/index.ts` — public interface surface, false SQLite type
- `.planning/PROJECT.md` — project requirements and explicit constraints
- `.planning/codebase/CONCERNS.md` — security audit findings
- `.planning/codebase/STACK.md` — existing stack baseline
- `.planning/codebase/ARCHITECTURE.md` — existing architecture analysis

### Secondary (HIGH confidence — established standards)

- OWASP Session Management Cheat Sheet — timing-safe comparison, HttpOnly+SameSite cookies, session invalidation
- OWASP Rate Limiting / Brute Force Prevention — per-endpoint limits, stricter on recovery
- OWASP CSRF Cheat Sheet — double-submit cookie pattern recommendation
- WebAuthn Level 3 spec — attestation type, userVerification, single-use challenge enforcement, counter monotonicity
- Node.js `crypto.timingSafeEqual` docs — throws `TypeError` on length mismatch (Node.js >= 18 verified)
- PostgreSQL transaction isolation documentation — open transactions hold row locks; external HTTP inside transactions is a known antipattern
- OAuth 2.0 RFC 6749 — redirect callbacks arrive from cross-origin context; `SameSite=Strict` cookies not sent on cross-origin navigation
- AWS SDK v2 deprecation notice — AWS official announcement of v3 as migration target
- `csurf` package deprecation — removed from npm due to known vulnerabilities and abandonment

### Tertiary (MEDIUM confidence — training data, versions unverified)

- npm registry versions for `zod`, `express-rate-limit`, `pino`, `csrf-csrf`, `@aws-sdk/client-ses`, `supertest` — verify with `npm view <package> version` before pinning

---

*Research completed: 2026-03-14*
*Ready for roadmap: yes*
