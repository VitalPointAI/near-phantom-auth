# Phase 1: Atomic Security Fixes - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Eliminate timing side-channel, fix session persistence, correct MPC math and transaction format, add derivation salt, replace custom base58. All fixes are in single files with no new infrastructure. Requirements: SEC-01, SEC-04, BUG-01, BUG-02, BUG-03, DEBT-02.

</domain>

<decisions>
## Implementation Decisions

### Derivation salt (SEC-04)
- Salt is **optional** in config via new `derivationSalt` property on `AnonAuthConfig`
- If no salt configured, derivation works as before (backward compat for existing production users)
- When salt IS provided, new accounts use salted derivation: `sha256("implicit-${salt}-${userId}")` or similar
- Existing accounts continue to resolve without salt — consumers upgrade at their own pace
- Log a **one-time warning on startup** when no derivation salt is configured: "No derivationSalt configured — account IDs are predictable from user IDs. Set derivationSalt for production use."
- **Critical context:** SDK has real production users with existing derived accounts — cannot break existing derivations

### Session refresh DB update (BUG-03)
- Add `updateSessionExpiry` as **optional** method on `DatabaseAdapter` interface (follows PROJECT.md decision on optional methods with fallbacks)
- If adapter doesn't implement it, refresh still works cookie-only (current behavior) — no breaking change
- Log a **one-time warning** when fallback fires: "Session refresh is cookie-only — implement updateSessionExpiry on your adapter for full persistence."
- PostgreSQL adapter implementation updates `expiresAt` column only (no `updated_at` column change, no schema migration)

### yoctoNEAR math (BUG-01)
- Use **bn.js** library for NEAR-to-yoctoNEAR conversion (standard in NEAR ecosystem)
- Add bn.js as dependency if not already present
- Config `fundingAmount` stays as human-readable NEAR string (e.g., `'0.01'`) — conversion to yoctoNEAR happens internally
- No API change for consumers

### Signed transaction format (BUG-02)
- Include public key bytes in the `buildSignedTransaction()` output in correct borsh position (after signature type byte)
- Straightforward fix matching NEAR's borsh SignedTransaction format
- Claude audits the full signing flow and fixes hashing if needed (Claude's discretion)

### Timing-safe comparison (SEC-01)
- Replace `signature !== expectedSignature` with `crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))` in `verifySessionId()`
- Straightforward, no decisions needed

### Custom base58 replacement (DEBT-02)
- Replace hand-rolled `base58Encode()` in `mpc.ts` with `bs58.encode()` (bs58 is already a project dependency)
- Straightforward, no decisions needed

### Claude's Discretion
- Exact borsh byte layout for SignedTransaction (public key position relative to signature)
- Whether transaction bytes need sha256 hashing before signing (audit call site)
- Warning log format and exact wording
- Any additional edge cases discovered during implementation

</decisions>

<specifics>
## Specific Ideas

- Existing production users must not be orphaned — backward compatibility is non-negotiable for derivation salt
- Warning logs should help custom adapter authors and new consumers discover security best practices without being noisy

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bs58` package: Already a dependency, used in treasury operations — reuse for DEBT-02
- `crypto.timingSafeEqual`: Node built-in, available in all supported versions
- `createHmac` from crypto: Already used in session.ts for HMAC signing

### Established Patterns
- Factory function pattern with config objects: `createSessionManager(db, config)` — new config properties (like `derivationSalt`) fit naturally
- Error handling: try/catch with console.error and generic error responses — follows existing pattern
- Optional interface methods: PROJECT.md decided on optional with fallback pattern for DatabaseAdapter

### Integration Points
- `AnonAuthConfig` type in `src/types/index.ts`: Add `derivationSalt?: string`
- `DatabaseAdapter` interface in `src/types/index.ts`: Add optional `updateSessionExpiry?()` method
- `src/server/session.ts` line 68: timingSafeEqual fix
- `src/server/session.ts` lines 179-207: refreshSession DB update
- `src/server/mpc.ts` line 219: floating-point to bn.js conversion
- `src/server/mpc.ts` lines 320-335: signed transaction format fix
- `src/server/mpc.ts` lines 46-67: base58Encode removal
- `src/server/mpc.ts` line 414: derivation salt integration

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-atomic-security-fixes*
*Context gathered: 2026-03-14*
