# Feature Landscape

**Domain:** Security-focused anonymous passkey auth library (npm package)
**Project:** near-phantom-auth hardening pass
**Researched:** 2026-03-14
**Confidence:** HIGH (derived from direct codebase analysis + known security standards)

---

## Context: What This Library Is

This is a published npm package providing anonymous passkey authentication with NEAR MPC accounts.
It is consumed by application developers, not end users directly. The hardening pass fixes known
security gaps, bugs, stubs, and zero test coverage without changing the public API surface or
adding new authentication methods.

The feature classification below distinguishes between:
- What the library **already has** (existing)
- What it **must have to be production-safe** (table stakes for hardening)
- What would **differentiate it** beyond the immediate hardening scope
- What it should **explicitly not have** (anti-features)

---

## Table Stakes

Features that must exist or users cannot safely ship the library in production.
Missing any of these means the library is not production-ready.

| Feature | Why Expected | Complexity | Status | Notes |
|---------|--------------|------------|--------|-------|
| Constant-time session signature comparison | Timing side-channel on `===` allows byte-by-byte signature reconstruction | Low | Missing | Replace `signature !== expectedSignature` with `crypto.timingSafeEqual`. One-line fix, zero API change. |
| Rate limiting on all auth endpoints | Unrestricted `/register/start`, `/login/start`, `/recovery/*` enables brute-force, challenge flooding, codename enumeration | Low | Missing | `express-rate-limit` on all POST auth endpoints. Recovery endpoints need stricter limits (e.g., 5/hour by IP) than registration (e.g., 20/hour). |
| CSRF token verification for state-changing endpoints | SameSite=strict is partial mitigation only; lax/none configurations are unsupported without explicit CSRF defense | Medium | Missing | Required when consumers configure `sameSite: 'lax'` or `'none'` (e.g., cross-origin OAuth flows). Custom CSRF middleware using double-submit cookie or synchronizer token pattern. |
| Runtime input validation on all request bodies | `req.body` is destructured without runtime type checking; malformed input causes undefined behavior | Medium | Missing | zod schemas for every endpoint. Rejects unexpected types early; prevents injection-style inputs reaching deeper logic. |
| Session refresh persists to database | Cookie is refreshed but `expiresAt` in DB is not updated; sessions expire at original time despite valid cookie | Low | Bug | `db.updateSessionExpiry()` must be called in `refreshSession()`. Requires DatabaseAdapter interface extension. |
| Server-side secret salt for account derivation | NEAR account IDs are derived deterministically from userId (`sha256("implicit-${userId}")`); leaked userId lets attacker precompute account IDs | Low | Missing | Add salt from server-side secret to derivation input. API-compatible (internal implementation change only). |
| Structured logging with sensitive data redaction | 40+ `console.log/error` statements expose treasury keys, account IDs, derivation paths to stdout | Medium | Missing | Replace with pino or similar; redact fields like `treasuryKey`, `derivationPath`, `mpcPublicKey` in production. Must be configurable (debug vs production). |
| Registration flow database transaction | 4 sequential DB ops in `/register/finish` with no rollback; partial user creation (user exists, no passkey) leaves account in unrecoverable state | Medium | Bug/Missing | Wrap `createUser` + `createPasskey` in a single transaction. PostgreSQL adapter already uses transactions elsewhere (`createOAuthUser`). |
| Passkey re-registration endpoint | Post-recovery users have no way to re-establish passkey access despite success message saying "you can now register a new passkey" | Medium | Missing | `POST /recovery/passkey/register` — authenticated endpoint allowing passkey addition to existing account without creating a new user. |
| Account deletion endpoint (GDPR compliance) | Applications collecting any user data need account deletion. Privacy-first library must support it | Medium | Missing | `DELETE /account` — authenticated; delete user, sessions, passkeys, recovery data. Codename must be releasable back to the pool or tombstoned. |
| Correct WebAuthn challenge handling | Challenges must be single-use; currently challenges are deleted after use (correct), but expiry check happens in application code, not at DB read time — race possible | Low | Existing (verify) | Single-use enforcement is present. Verify no TOCTOU gap between `getChallenge` and `deleteChallenge` under concurrent requests. |
| Passkey counter enforcement | Counter monotonicity check detects cloned authenticators; `simplewebauthn` handles this, but counter must be persisted correctly | Low | Existing (verify) | Counter is updated in `updatePasskeyCounter`. Verify counter regression causes authentication rejection (simplewebauthn default behavior). |
| Correct signed transaction format (public key in wrapper) | `buildSignedTransaction()` accepts `publicKey` but does not include it in output; NEAR requires public key in signature wrapper | Low | Bug | This is a silent failure in treasury-funded account creation. Fix before any mainnet usage. |
| Fix floating-point yoctoNEAR conversion | `parseFloat(amountNear) * 1e24` loses precision; funding amounts may be wrong on-chain | Low | Bug | Use `BigInt`-based string math: `BigInt(Math.round(parseFloat(amount) * 1e6)) * BigInt(1e18)` or the `@near-js/utils` `parseNearAmount` helper. |
| Real MPC signing for `addRecoveryWallet()` | Currently returns `pending-${Date.now()}` fake txHash; wallet recovery linking is entirely non-functional | High | Stub | Implement full AddKey transaction construction using existing borsh helpers. Most complex item in this pass. |
| `verifyRecoveryWallet()` must check specific public key | Currently returns `true` if account has any keys; any NEAR account passes recovery regardless of whether the specific wallet was linked | Medium | Bug | Pass recovery wallet's public key as parameter; check it against the RPC access key list. |
| OAuth state persisted to database | In-memory `Map` loses state on restart; multi-instance deployments fail OAuth callbacks silently | Medium | Missing | Use existing `storeChallenge`/`getChallenge` pattern or dedicated OAuth state table. |
| Expired session and challenge cleanup | No automatic cleanup; expired records accumulate indefinitely, growing the database | Low | Missing | Either document that consumers must schedule `cleanExpiredSessions()`, or provide an interval-based option in server initialization. |
| Fix custom base58 implementation | Hand-rolled `base58Encode()` exists alongside `bs58` dependency; inconsistent usage risks encoding bugs | Low | Tech Debt | Replace with `bs58.encode()` consistently. `bs58` is already a project dependency. |
| Remove false SQLite type declaration | `DatabaseConfig` declares `'sqlite'` but no adapter exists; misleads consumers | Low | Tech Debt | Remove `'sqlite'` from the union type. Only `'postgres'` and `'custom'` are valid. |
| Fix OAuth recovery password not delivered | Recovery password for OAuth users is generated, used to encrypt IPFS backup, then discarded — backup is permanently inaccessible | Medium | Bug | Either skip auto-recovery creation until email delivery works, or integrate AWS SES to deliver the password. |
| OAuth callback requires cookie-parser | `req.cookies` is read without verifying cookie-parser is installed; state validation silently fails (comparing against `undefined`) | Low | Fragile | Add explicit middleware check or document cookie-parser as a required peer dependency. |
| N+1 query fix for OAuth user lookups | `getOAuthUserByProvider` executes 3 sequential queries; at scale this is a performance and correctness risk | Medium | Tech Debt | Single JOIN query with `json_agg` for providers. |
| Concurrent IPFS gateway fallback | Sequential gateway attempts waste 30+ seconds on failure paths | Low | Performance | Replace `for...of` with `Promise.any()` to race all gateways. |
| Compound codenames to prevent namespace exhaustion | NATO codenames have ~2,574 possible values; collisions become frequent well before that (birthday paradox ~50% at ~50 users) | Medium | Scaling | Compound codenames (ALPHA-BRAVO-42) expand namespace to millions. |

---

## Differentiators

Features beyond the hardening scope that would meaningfully distinguish this library.
Not required for this milestone but inform later phases.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Email delivery via AWS SES | OAuth users can receive recovery passwords; enables functional recovery for the OAuth track | Medium | Blocked by: no email integration. Project already decided on AWS SES. |
| Pluggable rate limit store | Default in-memory rate limiting does not work for multi-instance deployments; pluggable store (Redis) enables horizontal scaling | Medium | `express-rate-limit` supports custom stores. Not required for MVP hardening. |
| Passkey management endpoint | Allow users to list and revoke individual passkeys (not just all sessions) | Medium | Useful for multi-device users. Out of scope for this pass. |
| Session management endpoint | Expose active sessions list to users so they can revoke specific devices | Medium | Privacy-forward feature matching the library's anonymous identity model. |
| TypeScript strict mode | Currently disabled; enabling catches an entire class of null-deref bugs at compile time | High | Explicitly deferred in PROJECT.md constraints. Significant effort. |
| WebAuthn `userVerification: 'required'` option | Downgrades from `'preferred'` to `'required'` enforces biometric/PIN on every auth | Low | Configuration flag only. Tradeoff: breaks low-security devices. |
| Dedicated passkey re-registration flow post-recovery | Recovery currently leaves users in a half-state ("you can register a new passkey" but no endpoint exists) | Medium | This bridges table stakes (missing endpoint) and differentiator (polished UX flow). |
| SQLite adapter for development environments | Allows contributors and consumers to run the library locally without a full PostgreSQL setup | High | Explicitly out of scope (PROJECT.md). Mentioned only for later evaluation. |

---

## Anti-Features

Features to explicitly NOT build in this hardening pass.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| New authentication methods | This is a hardening pass; new methods would expand the attack surface before existing paths are secure | Fix the existing passkey and OAuth flows completely first |
| TypeScript strict mode in this pass | Enabling strict mode across the codebase risks introducing regressions and is explicitly deferred | Fix type safety only where security-relevant (e.g., runtime zod validation replaces compile-time-only checks) |
| SQLite adapter | Explicitly out of scope; implementing it adds testing surface with no production value for this library's use case | Remove the `'sqlite'` type declaration to eliminate the false promise |
| Mobile/native SDK | Web-only library; adding native would require new dependencies, new auth flows, and a separate security review | Stay web-only |
| Real-time features (WebSockets, SSE) | Not relevant to auth; would bloat the library | Not applicable |
| UI components | Library provides hooks and API clients; consumer apps own their UI | Provide React hooks only, never ship UI |
| Storing recovery wallet ID in the database | The privacy model explicitly avoids linking wallet IDs to user records server-side | Recovery wallet is an on-chain access key only; DB stores only a boolean `wallet-recovery: enabled` |
| PII collection in anonymous track | The anonymous auth path must never store email, name, device fingerprints, or any PII | Only store: codename, NEAR account ID, passkey credential, session metadata |
| Attestation verification (WebAuthn) | Attestation adds complexity and breaks privacy (can fingerprint device/manufacturer); current `attestationType: 'none'` is correct for anonymous auth | Keep `attestationType: 'none'` |

---

## Feature Dependencies

```
Rate limiting → express-rate-limit (new dependency)
Input validation (zod) → zod (new dependency)
Structured logging → pino (new dependency)
Email delivery (AWS SES) → @aws-sdk/client-ses (new dependency)

Session refresh DB fix → DatabaseAdapter.updateSessionExpiry() interface extension
Account deletion → DatabaseAdapter.deleteUser() + cascade deletes for sessions/passkeys/recovery

Registration transaction → PostgreSQL adapter transaction support (already exists for OAuth)
Passkey re-registration endpoint → Account deletion (share the cascade delete logic)

OAuth state → DB → storeChallenge/getChallenge (already exists)
OAuth cookie-parser guard → cookie-parser peer dependency documentation

CSRF tokens → Only needed when sameSite != 'strict' (conditional on consumer config)
Compound codenames → codename.ts refactor (no DB schema changes needed)

verifyRecoveryWallet() fix → addRecoveryWallet() fix (both touch the same MPC flow)
Real MPC signing (addRecoveryWallet) → Borsh serialization helpers (already exist in mpc.ts)
Floating-point fix → @near-js/utils parseNearAmount (already a dependency)
```

---

## MVP Recommendation for Hardening Pass

Prioritize in this order:

**Critical security (must ship together, all low-medium complexity):**
1. Constant-time session comparison (`crypto.timingSafeEqual`) — one-line fix
2. Rate limiting via `express-rate-limit` — middleware, no API change
3. CSRF token verification — conditional on sameSite config
4. Server-side secret salt for account derivation — internal change only
5. zod runtime input validation — all endpoints

**Correctness bugs (breaks existing functionality):**
6. Session refresh database persistence — requires DatabaseAdapter interface extension
7. Registration transaction wrapping — use existing PostgreSQL transaction pattern
8. Fix signed transaction format (public key in wrapper) — blocks mainnet usage
9. Fix floating-point yoctoNEAR conversion — precision bug
10. `verifyRecoveryWallet()` specific key check — security stub
11. Real MPC signing for `addRecoveryWallet()` — functional stub (most complex)

**Observability:**
12. Structured logging with sensitive data redaction — pino, production-only redaction

**Missing endpoints:**
13. Passkey re-registration post-recovery — unblocks recovered users
14. Account deletion — GDPR compliance

**Scalability/cleanup:**
15. OAuth state → DB-backed storage
16. OAuth recovery password: skip auto-creation until email works
17. Expired session/challenge cleanup automation
18. Compound codenames for namespace expansion
19. N+1 query fix (JOIN for OAuth user lookups)
20. Concurrent IPFS gateway fallback (`Promise.any`)
21. Remove false SQLite type
22. Replace custom `base58Encode` with `bs58.encode`
23. Explicit cookie-parser dependency check

**Defer (post-hardening):**
- AWS SES email integration — enables OAuth recovery but is a new external dependency
- TypeScript strict mode — separate refactoring pass
- SQLite adapter — explicitly out of scope

---

## Sources

- Direct codebase analysis: `src/server/session.ts`, `src/server/router.ts`, `src/server/passkey.ts`,
  `src/server/mpc.ts`, `src/server/middleware.ts`, `src/server/oauth/router.ts`,
  `src/server/recovery/ipfs.ts`
- `.planning/PROJECT.md` — project requirements and constraints (HIGH confidence, authoritative)
- `.planning/codebase/CONCERNS.md` — security audit findings (HIGH confidence, direct analysis)
- WebAuthn Level 3 spec standard practices: `attestationType: 'none'`, `userVerification: 'preferred'`,
  single-use challenge enforcement, counter monotonicity — HIGH confidence (standards-based)
- OWASP Session Management Cheat Sheet: timing-safe comparison, HttpOnly+SameSite cookies,
  session invalidation on logout — HIGH confidence (established standard)
- OWASP Rate Limiting / Brute Force Prevention: per-endpoint limits, stricter on recovery paths,
  IP-based fallback — HIGH confidence (established standard)
- Node.js crypto module: `crypto.timingSafeEqual` for constant-time comparison — HIGH confidence
  (Node.js built-in, widely documented)
