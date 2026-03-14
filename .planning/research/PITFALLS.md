# Domain Pitfalls

**Domain:** Auth library hardening — adding security, tests, and validation to a published npm package
**Project:** @vitalpoint/near-phantom-auth v0.5.2
**Researched:** 2026-03-14

---

## Critical Pitfalls

Mistakes that cause consumer-facing breakage, security regressions, or irreversible data loss.

---

### Pitfall 1: Breaking the DatabaseAdapter Interface Without a Major Version Bump

**What goes wrong:**
The `DatabaseAdapter` interface (in `src/types/index.ts`) is part of the published public API. Any consumer who wrote a custom database adapter (`database.type: 'custom'`) will have their adapter break silently at compile time if a new method is added — and break at runtime if they rely on duck-typing. Adding `updateSessionExpiry()` (required for the session refresh fix) adds a method to the interface. Existing custom adapters won't implement it. TypeScript won't complain on the consumer side until they rebuild. At runtime, calling `.updateSessionExpiry()` on a custom adapter that doesn't have it throws `TypeError: db.updateSessionExpiry is not a function`.

**Why it happens:**
The fix for session refresh (a clearly correct bug fix) requires adding `updateSessionExpiry` to `DatabaseAdapter`. The team does it because it's necessary, ships a patch version, and consumers' custom adapters break.

**Consequences:**
- All custom-adapter consumers broken on upgrade
- Runtime crash in production session refresh path
- Trust erosion in a security library

**Prevention:**
- Make new required interface methods optional with `?` if they can be gracefully absent, or provide a default no-op fallback inside `createSessionManager` if the method is missing:
  ```typescript
  if (db.updateSessionExpiry) {
    await db.updateSessionExpiry(session.id, newExpiresAt);
  }
  ```
- Document any interface additions in CHANGELOG as a "soft breaking change" with migration instructions
- This is a 0.x package — communicate clearly that 0.5.x → 0.6.x may include interface changes, so consumers should pin and review

**Warning signs:**
- Any PR that adds a method to `DatabaseAdapter`, `SessionManager`, `PasskeyManager`, or `MPCAccountManager` interfaces
- CHANGELOG entry missing for interface change

**Phase:** Security fixes phase (session refresh fix requires this interface addition)

---

### Pitfall 2: Zod Validation That Rejects Valid Existing Client Payloads

**What goes wrong:**
Adding `zod` validation to all route handlers is correct, but if the schema is written too strictly it rejects payloads that existing clients already send. The current `register/finish` handler accepts `{ challengeId, response, tempUserId, codename }` with a basic presence check. If the zod schema for `response` validates the exact shape of `RegistrationResponseJSON` and the actual browser WebAuthn API returns extra fields (which it does — `authenticatorAttachment`, `clientExtensionResults` shape varies by browser), the schema rejects legitimate registrations.

**Why it happens:**
Developer writes `z.object({ ... }).strict()` (or forgets `.passthrough()`) and locks down more than needed. Browser sends a conforming-but-extended WebAuthn response object. `strict()` mode rejects unknown keys.

**Consequences:**
- Registration fails in certain browsers (Safari vs Chrome have different `clientExtensionResults`)
- Intermittent failures that look like auth bugs, not validation bugs
- Extremely hard to debug because the error surfaces as "Registration failed" with no detail

**Prevention:**
- Use `z.object({ ... })` (default — strips unknown keys) or `.passthrough()` for WebAuthn response bodies; never `.strict()`
- For the `response` field on `/register/finish` and `/login/finish`, validate only presence and top-level shape (it is an opaque browser object that `@simplewebauthn/server` validates internally)
- Test validation schemas against actual browser-captured WebAuthn responses, not hand-written test fixtures

**Warning signs:**
- Zod schemas using `.strict()` on any WebAuthn `response` field
- Unit tests that use hand-written JSON fixtures instead of captured browser output
- "Registration failed" errors with `ZodError` detail hidden in 400 responses

**Phase:** Input validation phase

---

### Pitfall 3: Rate Limiting That Blocks Legitimate Passkey Re-use Patterns

**What goes wrong:**
Rate limiting on `/login/start` and `/login/finish` is necessary. But passkey authentication can appear "suspicious" to naive rate limiters: a user on a slow connection retrying a timed-out challenge creates multiple requests from the same IP in quick succession. Worse, if `express-rate-limit` is configured by IP alone, a corporate NAT or shared VPN exit node causes all users behind that IP to hit the limit simultaneously.

Specifically for this library: `/register/start` issues challenges with a 10-attempt codename uniqueness retry loop that generates multiple DB hits in a tight loop. If rate limiting counts at the request level, this is fine. But if future refactors put the retry inside a loop of route handler calls, rate limiting can trigger mid-registration.

**Why it happens:**
Rate limits are set conservatively (e.g., 5 req/min on login) without considering that passkey flows generate 2 requests per auth attempt (start + finish). A user who misplaces their passkey and tries multiple devices can hit the limit after 2-3 natural attempts.

**Consequences:**
- Legitimate users get 429 during active recovery flows (the worst possible time)
- Recovery endpoints especially punishing: a user locked out of their account can't recover because recovery rate limit fires

**Prevention:**
- Rate limit login endpoints at 10 req/5min (5 full passkey attempts) not 5 req/min
- Rate limit recovery endpoints separately and more generously (30 req/hour) — rate limiting recovery is about preventing brute force, not blocking users in crisis
- Use sliding window rate limiting (express-rate-limit default) not fixed window
- Consider user-ID-scoped limits after authentication, not just IP-scoped limits before
- Do not share the same rate limiter instance between `/login/*` and `/recovery/*`

**Warning signs:**
- A single `rateLimiter` middleware applied globally to all auth routes
- Rate limit set to requests-per-minute without accounting for multi-step flows
- No separate, more lenient limit for recovery endpoints

**Phase:** Rate limiting phase

---

### Pitfall 4: CSRF Tokens That Break When `sameSite: 'lax'` Is Needed for OAuth

**What goes wrong:**
The current code defaults `sameSite: 'strict'` for session cookies, which provides CSRF protection for most flows. OAuth callbacks _require_ `sameSite: 'lax'` or `'none'` because the OAuth provider redirects back to the app from a cross-origin context — a strict cookie won't be sent on that redirect, breaking OAuth callback state validation.

If CSRF token middleware is added globally (e.g., via a `csurf`-style middleware), it will intercept OAuth callback POSTs, which have no CSRF token from the provider. Alternatively, if the `sameSite` config is changed to `'lax'` to accommodate OAuth, the CSRF argument for not needing explicit tokens weakens.

**Why it happens:**
CSRF middleware is added to the main router to protect all state-changing POST endpoints. The OAuth callback (`/oauth/:provider/callback`) is also a POST or GET that sets a session. The two requirements conflict: session cookie strictness that protects CSRF vs session cookie laxness that allows OAuth redirect flow.

**Consequences:**
- OAuth login silently fails if CSRF middleware blocks the callback
- Removing CSRF middleware to fix OAuth reintroduces CSRF risk on passkey endpoints
- Session cookie `sameSite` config is a footgun — changing it for OAuth breaks CSRF guarantees

**Prevention:**
- Keep passkey session cookies at `sameSite: 'strict'`
- Issue a separate, shorter-lived `sameSite: 'lax'` cookie only for OAuth state validation (the `oauth_state` cookie already does this — keep it separate from the session cookie)
- If adding CSRF token verification, exclude the OAuth callback route explicitly: `router.post('/callback', csrfExempt, oauthCallbackHandler)`
- Document explicitly: "sameSite: 'none' requires HTTPS and explicit CSRF tokens on all endpoints"

**Warning signs:**
- A single CSRF middleware applied to all routes without explicit OAuth exclusion
- Session cookie `sameSite` changed to `'lax'` globally to fix OAuth redirect issues
- OAuth callback handler disappears from integration tests after CSRF is added

**Phase:** CSRF protection phase

---

### Pitfall 5: Logging Structured Data That Still Leaks Secrets

**What goes wrong:**
Replacing `console.log` with `pino` or similar is correct. The pitfall is that structured loggers make it _easier_ to accidentally log sensitive fields: an object spread like `logger.info({ ...req.body }, 'request received')` logs the entire request body including passwords, challenge responses, and IPFS CIDs. The same happens with error objects that contain stack traces referencing secret values.

This library specifically has `treasuryPrivateKey` in the MPC config. If an error occurs during treasury operations and the error handler logs `error.context` or the full config object, the private key hits the log stream.

**Why it happens:**
Developer replaces `console.error('[AnonAuth] error:', error)` with `logger.error({ err: error }, 'error')` and the `err` serializer in pino logs `error.cause` and any attached context. The config object passed to `createMPCManager` contains `treasuryPrivateKey`. If that object gets attached to an error (or passed to a log call as context), the key is logged.

**Consequences:**
- Treasury private key in log files = full account compromise
- IPFS CIDs + user IDs in logs = recovery data correlation that breaks anonymity guarantee
- Session secrets in logs = session forgery

**Prevention:**
- Create an explicit redaction list for pino: `redact: ['*.treasuryPrivateKey', '*.secret', '*.password', '*.apiKey', '*.apiSecret', 'req.body.password', 'req.body.cid']`
- Never log `req.body` wholesale — log only specific known-safe fields
- Log config object shapes at startup in debug mode only, never values of secret fields
- Add a dedicated `sanitizeForLog()` utility that strips known-sensitive keys before any object is passed to a log call
- In MPC error handlers, catch and re-throw with a sanitized error message rather than propagating the original error that may contain config context

**Warning signs:**
- Log calls that spread `req.body` or `config` objects: `logger.info({ ...config }, ...)`
- Error handlers that log `err.cause` or `err.context` without a redaction filter
- Pino configured without a `redact` option
- Test logs showing treasury key or session secret values in output

**Phase:** Logging replacement phase

---

### Pitfall 6: Tests Written After the Fix Lock In the Buggy Behavior

**What goes wrong:**
This codebase has zero tests and multiple stubs that return fake success. When tests are written _after_ fixing the stubs, the risk is writing tests that verify the new behavior. But the dangerous variant is writing tests _before_ or _alongside_ fixes for stubs and accidentally testing the stub behavior (which returns `success: true` with a fake txHash) rather than the real behavior.

More concretely: `addRecoveryWallet()` currently returns `{ txHash: 'pending-1234', success: true }`. A test written now to verify this function will pass against the stub. After the real MPC signing is implemented, the test should still pass — but only if the interface contract was correctly captured. If the test checks `expect(result.txHash).toMatch(/^pending-/)`, it will fail correctly after the fix. But if the test checks `expect(result.success).toBe(true)`, it will pass both before and after, providing false confidence.

Similarly, `verifyRecoveryWallet()` currently returns `true` if any keys exist. A test that asserts `it('returns true for account with keys')` will pass for the stub and for the correct implementation — but a test that asserts `it('returns false when the specific wallet key is not present')` would catch the bug.

**Why it happens:**
Tests are written to what the code does now, not to what the spec says it should do. With crypto and blockchain code, the developer may not fully understand the contract when writing tests.

**Consequences:**
- Tests pass against stub, pass against real implementation, but don't actually verify correctness
- False confidence: 100% test coverage of code that is silently wrong
- Real MPC bugs (wrong borsh serialization, wrong key derivation) slip through

**Prevention:**
- Write test cases that will FAIL against the current stub before writing the fix:
  - For `addRecoveryWallet()`: test that it calls an RPC endpoint and returns a real txHash (not matching `/^pending-/`)
  - For `verifyRecoveryWallet()`: test that a NEAR account with an unrelated key returns `false`
- For MPC/borsh serialization: test against known good transaction bytes (capture from NEAR Explorer or nearcore test vectors)
- For `encryptRecoveryData`/`decryptRecoveryData`: test the roundtrip with adversarial inputs (wrong password, corrupted IV, tampered ciphertext)
- Use test-driven order: write failing test → implement fix → verify test passes

**Warning signs:**
- Tests that assert `.success === true` on currently-stubbed endpoints
- No test cases with negative/adversarial inputs (wrong password, invalid signature, expired challenge)
- Tests for `addRecoveryWallet` or `verifyRecoveryWallet` that don't mock RPC responses

**Phase:** Testing phase (all test writing)

---

### Pitfall 7: Registration Transaction Atomicity Fix Introduces Deadlock Risk

**What goes wrong:**
The correct fix for the non-atomic registration flow is to wrap the 4 steps (verify passkey → create MPC account → create user → store passkey) in a database transaction. The PostgreSQL adapter's `createOAuthUser` already uses a transaction as a pattern. But wrapping the registration flow creates a deadlock risk: the `createAccount()` call inside the transaction makes an outbound HTTP request to the NEAR RPC/treasury API. PostgreSQL holds an open transaction while an external HTTP request is in flight.

If the NEAR RPC is slow (common on testnet) or the treasury funding call times out, the PostgreSQL transaction stays open for seconds or minutes, holding locks. Under load, this exhausts the connection pool.

**Why it happens:**
Developer wraps the whole registration sequence in `BEGIN/COMMIT` for correctness without noticing the external HTTP call (`mpcManager.createAccount()`) in the middle.

**Consequences:**
- Postgres connection pool exhaustion under concurrent registrations
- Cascading failures: all auth operations fail when the pool is exhausted
- Harder to detect: works fine in development with single registrations, fails in production

**Prevention:**
- Execute `mpcManager.createAccount()` BEFORE the database transaction begins
- Structure the flow as: (1) create MPC account on-chain, (2) open DB transaction, (3) insert user + passkey, (4) commit
- If MPC account creation succeeds but DB transaction fails, the on-chain account exists without a DB record — this is a known trade-off and is recoverable (the account can be re-linked or simply abandoned as a dust account)
- Add a comment explaining why the external call is outside the transaction

**Warning signs:**
- `BEGIN` called before `mpcManager.createAccount()` in the registration finish handler
- Connection pool errors under concurrent registration load in staging
- Transaction timeout errors in logs

**Phase:** Database transaction phase (tech debt fix)

---

## Moderate Pitfalls

Mistakes that cause correctness issues, consumer confusion, or gradual degradation.

---

### Pitfall 8: `crypto.timingSafeEqual` Throws on Length Mismatch

**What goes wrong:**
Replacing `signature !== expectedSignature` with `crypto.timingSafeEqual()` is the correct fix for the timing side-channel. But `timingSafeEqual` throws a `TypeError` if the two buffers have different lengths — it does not return `false`. The current code returns `null` for a non-matching signature. If the replacement is written as:

```typescript
if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;
```

...it will throw when an attacker submits a cookie with a truncated or extended signature, converting a safe `null` return into an unhandled exception that becomes a 500 response. The 500 is distinguishable from the normal `null`/401 path and is itself a timing/behavioral oracle.

**Why it happens:**
Developer reads the `timingSafeEqual` docs but misses the length constraint, writes the comparison without a length pre-check.

**Prevention:**
Always pre-check length before calling `timingSafeEqual`:
```typescript
const sigBuf = Buffer.from(signature, 'base64url');
const expBuf = Buffer.from(expectedSignature, 'base64url');
if (sigBuf.length !== expBuf.length) return null;
if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
```

**Warning signs:**
- `timingSafeEqual` called without a preceding length check
- Error logs showing `TypeError: Input buffers must have the same byte length` from session verification

**Phase:** Security fixes phase (timing-safe comparison)

---

### Pitfall 9: Zod Validation Changes Error Response Shape and Breaks Existing Clients

**What goes wrong:**
The current router returns `{ error: 'Missing required fields' }` for bad inputs. After zod is added, validation errors return `{ error: 'Validation failed', details: z.ZodError }` with a deeply nested issues array. Existing consumers that parse error responses to show user-facing messages will need to be updated. Since this is a library, those consumers are external.

**Why it happens:**
The validation error shape from zod is very different from the hand-written error strings the routes currently return. It's tempting to return the full `ZodError` for dev ergonomics.

**Prevention:**
- Decide on one error response format before writing validation: `{ error: string, field?: string }`
- Map zod errors to the existing `{ error: string }` format: `res.status(400).json({ error: z.issues[0].message })`
- Never expose raw `ZodError` to API consumers — it reveals internal schema structure
- Document the error format as stable in the library's API contract

**Warning signs:**
- Route handlers returning `err.issues` or `err.errors` directly
- Error response shape differs between validated and non-validated endpoints

**Phase:** Input validation phase

---

### Pitfall 10: In-Memory OAuth State Migration Loses In-Flight OAuth Sessions

**What goes wrong:**
Moving OAuth state from an in-memory `Map` to the database is the correct fix. But the migration must handle the transition moment: if an OAuth flow was started (state stored in memory), then the server restarts (state lost), and then the OAuth callback arrives, the state lookup fails and the user gets an error. This is expected behavior. The risk is the opposite: if the migration is done incorrectly and state is stored in BOTH memory and database during a transition period, the lookup order matters and divergence causes subtle failures.

**Why it happens:**
Developer adds DB storage but leaves the in-memory Map as a fallback "for compatibility," creating two sources of truth.

**Prevention:**
- Remove the in-memory Map entirely in the same PR that adds DB storage — no dual-store transition period
- Accept that in-flight OAuth flows at deploy time will fail (users will retry — this is expected behavior for OAuth)
- Add cleanup: use the existing `storeChallenge`/`getChallenge` pattern which already handles expiry, rather than a new separate table

**Warning signs:**
- Code that checks in-memory Map first, then falls back to DB (or vice versa)
- `stateStore` Map still referenced after DB storage is added

**Phase:** Tech debt — scalability phase

---

### Pitfall 11: Replacing Custom `base58Encode` Without Verifying Identical Output

**What goes wrong:**
The hand-rolled `base58Encode()` in `mpc.ts` is used for public key encoding in account creation. The fix is to replace it with `bs58.encode()`. This is correct — but only if the two produce identical output for all inputs. If there is any difference (e.g., leading zero handling), existing on-chain accounts derived using the hand-rolled encoder will not be reachable using the new encoder, because the derived account ID would be different.

**Why it happens:**
Developer replaces the custom function assuming `bs58` is a drop-in replacement. The base58 alphabet is standard so this is almost certainly correct, but the leading-zero handling differs between naive implementations.

**Prevention:**
- Before replacing, write a test that runs both implementations against 1000 random inputs and asserts identical output
- Check the specific case of buffers with leading zero bytes (which the hand-rolled implementation handles via the `if (byte === 0)` loop)
- Verify that existing NEAR account IDs (stored in the DB as `nearAccountId`) can still be derived with the new encoder

**Warning signs:**
- Replacement done without a parity test
- No test asserting that DB-stored account IDs match newly-derived account IDs

**Phase:** Tech debt — base58 replacement phase

---

## Minor Pitfalls

Correctness and DX issues that don't cause immediate breakage.

---

### Pitfall 12: Expired Challenge Cleanup Timing Creates Race Condition in Tests

**What goes wrong:**
Integration tests that test the registration or authentication flow will create challenges. If `cleanExpiredSessions()` or challenge cleanup runs automatically (once the scheduler is implemented), it may delete challenges during a slow test, causing the test to fail non-deterministically.

**Prevention:**
- In test environments, set challenge expiry to a long timeout (5+ minutes)
- Do not start the cleanup scheduler in test environments (`process.env.NODE_ENV === 'test'` guard)
- Prefer manual cleanup calls in test teardown over automatic scheduling

**Phase:** Testing phase and cleanup scheduler phase

---

### Pitfall 13: Compound Codename Format Change Breaks `isValidCodename()`

**What goes wrong:**
The existing `isValidCodename()` function in `codename.ts` validates codename format. If the codename format changes from `ALPHA-42` to `ALPHA-BRAVO-42`, all existing validation logic (route handler uses it at line 104 of `router.ts`) will reject the new format until it is updated. Users with old-format codenames stored in the database must still be able to authenticate.

**Prevention:**
- `isValidCodename()` must accept both old and new formats during the transition
- New codenames generated with the compound format, old codenames in DB validated with either format
- Do not remove old format validation until confirmed all existing users have been migrated (likely never — old accounts remain)

**Phase:** Tech debt — codename expansion phase

---

### Pitfall 14: `scrypt` Parameters Not Documented — Future Changes Will Break Existing Encrypted Backups

**What goes wrong:**
`encryptRecoveryData()` uses `scrypt(password, salt, 32)` with default Node.js scrypt parameters (`N=16384, r=8, p=1`). The `EncryptedRecoveryData` struct has a `version: 1` field but no field for scrypt parameters. If the parameters are ever tuned for security (higher N), existing backups encrypted with the old parameters cannot be decrypted with the new parameters.

**Prevention:**
- Add `scryptParams: { N: number, r: number, p: number }` to `EncryptedRecoveryData` before shipping any changes
- This is a forward-only concern — existing backups work with current code — but the `version` field was presumably added for exactly this migration path. Use it.

**Phase:** Testing phase (when writing decryption roundtrip tests — this is when the omission becomes obvious)

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Session refresh DB fix | Breaking `DatabaseAdapter` interface (Pitfall 1) | Make `updateSessionExpiry` optional with internal fallback |
| `timingSafeEqual` | Throws on length mismatch → 500 response (Pitfall 8) | Length pre-check before calling |
| Rate limiting | Too aggressive on recovery; shared limiter (Pitfall 3) | Separate limiters, generous recovery limits |
| CSRF protection | Breaks OAuth callback flow (Pitfall 4) | Exempt OAuth callback; keep separate `oauth_state` cookie |
| Zod validation | Rejects real browser WebAuthn payloads (Pitfall 2) | No `.strict()` on WebAuthn response fields |
| Zod validation | Changes error response shape (Pitfall 9) | Map to existing `{ error: string }` format |
| Structured logging | Logs treasury private key via error context (Pitfall 5) | pino `redact` config; sanitize before logging |
| Test writing | Tests lock in stub behavior (Pitfall 6) | Write failing tests first, before fixing stubs |
| DB transaction wrap | External HTTP call inside transaction (Pitfall 7) | MPC call before transaction, not inside it |
| base58 replacement | Output divergence for existing accounts (Pitfall 11) | Parity test before replacing |
| OAuth state to DB | Dual-store transition causes split brain (Pitfall 10) | Remove in-memory Map in same PR as DB addition |
| Codename expansion | `isValidCodename()` rejects new format (Pitfall 13) | Accept both formats; never remove old |
| Cleanup scheduler | Deletes challenges during integration tests (Pitfall 12) | Guard behind `NODE_ENV !== 'test'` |
| IPFS encryption | scrypt params not versioned (Pitfall 14) | Add params to encrypted data struct before shipping |

---

## Sources

- Direct codebase analysis: `src/server/session.ts`, `src/server/router.ts`, `src/server/mpc.ts`, `src/server/recovery/ipfs.ts`, `src/server/middleware.ts`, `src/server/oauth/router.ts`
- Concerns audit: `.planning/codebase/CONCERNS.md`
- Node.js `crypto.timingSafeEqual` docs: throws `TypeError` on length mismatch (verified behavior in Node.js >= 18)
- PostgreSQL transaction isolation: open transactions hold row locks; external HTTP calls inside transactions are a well-known antipattern
- WebAuthn spec: browser implementations add non-standard fields to `clientExtensionResults` — strict schema validation will break cross-browser compatibility
- OAuth 2.0 RFC 6749: redirect-based callbacks arrive from cross-origin context; `SameSite=Strict` cookies are not sent on cross-origin navigation
