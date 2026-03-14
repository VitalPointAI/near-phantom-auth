# Codebase Concerns

**Analysis Date:** 2026-03-14

## Tech Debt

**Incomplete MPC Signing Flow:**
- Issue: `addRecoveryWallet()` is a stub that returns a fake txHash (`pending-${Date.now()}`). No actual on-chain AddKey transaction is constructed or submitted.
- Files: `src/server/mpc.ts` (lines 478-505)
- Impact: Wallet recovery linking is non-functional. Users who "link" a recovery wallet have no actual on-chain recovery mechanism. The API returns `success: true` misleadingly.
- Fix approach: Implement full MPC signing flow using the existing borsh serialization helpers (`buildTransferTransaction` pattern) to construct an AddKey transaction. Requires signing via MPC contract or treasury key.

**Incomplete Recovery Wallet Verification:**
- Issue: `verifyRecoveryWallet()` does not actually verify that a specific wallet's key is in the access key list. It returns `true` if the account has any keys at all.
- Files: `src/server/mpc.ts` (lines 510-543)
- Impact: Any existing NEAR account would pass recovery verification regardless of whether the specific wallet was linked. This is a security-relevant stub.
- Fix approach: Accept the recovery wallet's public key as a parameter and check it against the returned access key list from the RPC response.

**OAuth Recovery Password Discarded:**
- Issue: When a new OAuth user is created, an auto-generated recovery password (`crypto.randomUUID()`) is used for IPFS backup encryption, but the password is never delivered to the user. The TODO comment says "Send recovery info to user's email" but no email service exists.
- Files: `src/server/oauth/router.ts` (lines 233-252)
- Impact: OAuth users have IPFS recovery backups they can never decrypt. The recovery data is permanently inaccessible.
- Fix approach: Either integrate an email service to deliver the recovery password, or skip auto-recovery creation for OAuth users until email delivery is implemented.

**Session Refresh Does Not Update Database:**
- Issue: `refreshSession()` extends the cookie expiration but does not update the session's `expiresAt` in the database. Comment says "Update in database would happen here."
- Files: `src/server/session.ts` (lines 179-207)
- Impact: Sessions that are refreshed via cookie still expire at their original database time. After the original expiry, `getSession()` deletes the session from the DB even though the cookie is still valid. Users experience unexpected logouts.
- Fix approach: Add `db.updateSessionExpiry(sessionId, newExpiresAt)` to the DatabaseAdapter interface and call it in `refreshSession()`.

**OAuth State Stored In-Memory:**
- Issue: The OAuth manager stores state/PKCE verification data in a `Map<string, OAuthState>()` in process memory.
- Files: `src/server/oauth/index.ts` (line 96)
- Impact: State is lost on server restart. Multi-instance deployments cannot share OAuth state, causing callback failures. Not production-safe.
- Fix approach: Store OAuth state in the database using the existing `storeChallenge`/`getChallenge` pattern, or provide a pluggable state store.

**Only PostgreSQL Adapter Implemented:**
- Issue: `DatabaseConfig` type declares support for `'postgres' | 'sqlite' | 'custom'`, but only the PostgreSQL adapter exists. No SQLite adapter is provided.
- Files: `src/types/index.ts` (line 80), `src/server/db/adapters/postgres.ts`
- Impact: Users expecting SQLite support (useful for development/prototyping) will hit a dead end.
- Fix approach: Either implement a SQLite adapter or remove `'sqlite'` from the union type to avoid confusion.

**Custom Base58 Implementation:**
- Issue: A hand-rolled `base58Encode()` function exists in `mpc.ts` despite `bs58` being a project dependency and used elsewhere in the same file.
- Files: `src/server/mpc.ts` (lines 46-67)
- Impact: Duplication and potential encoding bugs. The hand-rolled version is used for public key encoding in account creation, while `bs58` is used in treasury operations.
- Fix approach: Replace `base58Encode()` with `bs58.encode()` consistently throughout the file.

**Codename Collision Risk:**
- Issue: Codename generation uses a retry loop (max 10 attempts) to find a unique codename. NATO phonetic codenames have only ~2,574 possible values (26 words * 99 numbers).
- Files: `src/server/router.ts` (lines 65-73), `src/server/codename.ts`
- Impact: At scale, codename collisions become frequent, and registration failures will increase. The 10-attempt limit makes this fragile.
- Fix approach: Use a larger suffix range, compound codenames by default, or use a deterministic hash-based approach that guarantees uniqueness.

## Known Bugs

**Floating-Point NEAR Amount Conversion:**
- Symptoms: Converting NEAR to yoctoNEAR uses `parseFloat(amountNear) * 1e24` which loses precision for amounts that are not simple fractions.
- Files: `src/server/mpc.ts` (line 219)
- Trigger: Funding amount like `"0.015"` would produce imprecise yoctoNEAR values.
- Workaround: Use only simple amounts like `"0.01"` or `"0.1"`.

**Signed Transaction Format Missing Public Key:**
- Symptoms: `buildSignedTransaction()` accepts a `publicKey` parameter but only appends the transaction bytes and signature. The public key is accepted but unused in the output. NEAR signed transactions require the public key in the signature wrapper.
- Files: `src/server/mpc.ts` (lines 320-335)
- Trigger: Any treasury-funded account creation transaction.
- Workaround: None apparent -- this may cause transaction submission failures.

## Security Considerations

**No Rate Limiting:**
- Risk: All authentication endpoints (`/register/start`, `/login/start`, `/recovery/*`) have no rate limiting. Brute-force attacks on codename enumeration, challenge flooding, and recovery attempts are unrestricted.
- Files: `src/server/router.ts`, `src/server/oauth/router.ts`
- Current mitigation: None.
- Recommendations: Add rate limiting middleware (e.g., `express-rate-limit`) to all auth endpoints. Apply stricter limits to recovery endpoints.

**No CSRF Protection:**
- Risk: State-changing POST endpoints rely solely on cookie-based sessions with no CSRF tokens. While `SameSite=strict` cookies provide partial protection, this is insufficient for `SameSite=lax` or `SameSite=none` configurations.
- Files: `src/server/session.ts` (line 106, `sameSite` defaults to `'strict'`), `src/server/router.ts`
- Current mitigation: Default `SameSite=strict` cookie setting.
- Recommendations: Add CSRF token verification for state-changing endpoints, especially if `sameSite` is configured as `'lax'` or `'none'`.

**Timing-Unsafe Session Signature Comparison:**
- Risk: Session ID signature verification uses string equality (`===`) rather than constant-time comparison (`crypto.timingSafeEqual`). This could leak session signature bytes via timing side-channels.
- Files: `src/server/session.ts` (line 68)
- Current mitigation: None.
- Recommendations: Replace `signature !== expectedSignature` with `crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))`.

**Console Logging of Sensitive Data:**
- Risk: Treasury public keys, account IDs, derivation paths, and transaction hashes are logged to console. In production, these logs may be captured and expose account relationships.
- Files: `src/server/mpc.ts` (40 console statements across server code, 14 in `mpc.ts` alone)
- Current mitigation: None.
- Recommendations: Use a structured logger with log levels. Redact sensitive data in production. Remove or gate debug-level logging behind a configuration flag.

**Deterministic Account Derivation from User ID:**
- Risk: Implicit account IDs are derived deterministically from `sha256("implicit-${userId}")`. If `userId` (a UUID) is predictable or leaked, an attacker can compute the associated NEAR account.
- Files: `src/server/mpc.ts` (line 414)
- Current mitigation: UUIDs are random but transmitted to the client during registration (`tempUserId` in response).
- Recommendations: Add a server-side secret salt to the derivation input to prevent account ID prediction from leaked user IDs.

**No Input Sanitization on Request Bodies:**
- Risk: Route handlers destructure `req.body` fields without sanitizing or validating types beyond basic presence checks. Malformed inputs could cause unexpected behavior.
- Files: `src/server/router.ts`, `src/server/oauth/router.ts`
- Current mitigation: TypeScript types at compile time only; no runtime validation.
- Recommendations: Add runtime input validation using a library like `zod` or `joi` for all endpoint request bodies.

## Performance Bottlenecks

**N+1 Queries in OAuth User Lookups:**
- Problem: `getOAuthUserById` and `getOAuthUserByEmail` perform two sequential queries: one for the user, then another for providers. `getOAuthUserByProvider` performs three queries (provider lookup, then calls `getOAuthUserById` which does two more).
- Files: `src/server/db/adapters/postgres.ts` (lines 291-384)
- Cause: No JOIN queries; providers are always fetched separately.
- Improvement path: Use a single JOIN query to fetch user and providers together, or use `array_agg`/`json_agg` in PostgreSQL.

**Sequential IPFS Gateway Fallback:**
- Problem: `fetchFromIPFS()` tries 6 gateways sequentially, waiting for each to fail before trying the next.
- Files: `src/server/recovery/ipfs.ts` (lines 217-244)
- Cause: Serial `for...of` loop with `await fetch()` per gateway.
- Improvement path: Use `Promise.any()` to race all gateways concurrently, with the first successful response winning.

**No Expired Session/Challenge Cleanup Automation:**
- Problem: `cleanExpiredSessions()` and expired challenge cleanup exist as methods but are never called automatically. Expired records accumulate indefinitely.
- Files: `src/server/db/adapters/postgres.ts` (lines 534-538), `src/types/index.ts` (line 141)
- Cause: No scheduled cleanup mechanism.
- Improvement path: Document that consumers should call `cleanExpiredSessions()` on a schedule, or provide a built-in interval-based cleanup option in server initialization.

## Fragile Areas

**Registration Flow (Multi-Step with No Rollback):**
- Files: `src/server/router.ts` (lines 96-155)
- Why fragile: Registration `/finish` performs 4 sequential operations: verify passkey, create MPC account, create user in DB, store passkey credential. If any step after user creation fails (e.g., `createPasskey` throws), the user exists in the DB without a linked passkey and cannot authenticate.
- Safe modification: Wrap the entire sequence in a database transaction. If using the PostgreSQL adapter, use `BEGIN/COMMIT/ROLLBACK` as done in `createOAuthUser`.
- Test coverage: No tests exist.

**OAuth Callback State Validation:**
- Files: `src/server/oauth/router.ts` (lines 118-280)
- Why fragile: State validation reads from `req.cookies?.oauth_state` but the cookie parsing depends on Express cookie-parser middleware being configured. If cookie-parser is not installed by the consumer, `req.cookies` is `undefined` and state validation silently fails (comparing against `undefined`).
- Safe modification: Add explicit check for cookie-parser middleware presence or document it as a requirement.
- Test coverage: No tests exist.

**Type Casting in Database Adapter:**
- Files: `src/server/db/adapters/postgres.ts` (lines 308-315, 349-355, 457-466)
- Why fragile: PostgreSQL query results are cast with `as` type assertions throughout. Column name changes in the schema would silently produce `undefined` values at runtime with no type-safety.
- Safe modification: Use a query builder or ORM, or add runtime validation of row shapes.
- Test coverage: No tests exist.

## Scaling Limits

**Codename Namespace:**
- Current capacity: ~2,574 unique NATO codenames (26 * 99), ~58,000 animal codenames (23 * 23 * 99 + overlap handling).
- Limit: Registration failures begin when namespace is ~90% full due to birthday-paradox collision rates.
- Scaling path: Increase number suffix range (1-9999), add more word lists, or switch to deterministic hash-based codenames.

**In-Memory OAuth State:**
- Current capacity: Bounded only by server memory.
- Limit: Memory leak risk if many OAuth flows are started but never completed (stale entries cleaned only on next `getAuthUrl` call).
- Scaling path: Move to database-backed state storage.

## Dependencies at Risk

**web3.storage API:**
- Risk: web3.storage has undergone significant API changes and service model shifts. The upload endpoint (`https://api.web3.storage/upload`) used in the code may be deprecated.
- Impact: IPFS recovery backup creation fails for web3.storage users.
- Migration plan: Update to web3.storage's current API or recommend Pinata as the default provider.

**NEAR Testnet Helper API:**
- Risk: The testnet helper (`https://helper.testnet.near.org/account`) is an unofficial endpoint that may be removed or changed without notice.
- Impact: Testnet named account creation would break (though the code currently uses implicit accounts for both networks).
- Migration plan: The `createTestnetAccount()` function exists but is not called in the current flow. Consider removing dead code.

## Missing Critical Features

**No Email Delivery Service:**
- Problem: OAuth recovery generates a password that should be emailed to users, but no email integration exists.
- Blocks: OAuth user recovery is non-functional.

**No Passkey Re-Registration After Recovery:**
- Problem: After wallet or IPFS recovery, users are told "You can now register a new passkey" but no dedicated endpoint exists for adding a passkey to an existing account (registration creates a new account).
- Blocks: Recovered users cannot actually complete the recovery flow by re-establishing passkey access.

**No Account Deletion:**
- Problem: No endpoint or database method exists for deleting user accounts or associated data.
- Blocks: GDPR/privacy compliance for applications using this library.

## Test Coverage Gaps

**No Tests Exist:**
- What's not tested: The entire codebase has zero test files. No unit tests, integration tests, or e2e tests.
- Files: All files in `src/` are untested. `vitest` is configured as a dev dependency and `npm test` script exists, but no test files have been written.
- Risk: Any code change could introduce regressions with no safety net. The authentication and cryptographic operations are especially dangerous to modify without test coverage.
- Priority: High -- critical for a security-focused authentication library. Priority testing targets:
  1. `src/server/session.ts` - Session signing/verification
  2. `src/server/passkey.ts` - WebAuthn flow
  3. `src/server/mpc.ts` - Borsh serialization, account creation
  4. `src/server/recovery/ipfs.ts` - Encryption/decryption roundtrip
  5. `src/server/recovery/wallet.ts` - Signature verification
  6. `src/server/codename.ts` - Codename generation/validation

---

*Concerns audit: 2026-03-14*
