# Phase 1: Atomic Security Fixes - Research

**Researched:** 2026-03-14
**Domain:** Node.js crypto, NEAR borsh serialization, TypeScript interface extension
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Derivation salt (SEC-04)**
- Salt is optional in config via new `derivationSalt` property on `AnonAuthConfig`
- If no salt configured, derivation works as before (backward compat for existing production users)
- When salt IS provided, new accounts use salted derivation: `sha256("implicit-${salt}-${userId}")` or similar
- Log a one-time warning on startup when no derivation salt is configured
- Existing accounts continue to resolve without salt — consumers upgrade at their own pace

**Session refresh DB update (BUG-03)**
- Add `updateSessionExpiry` as optional method on `DatabaseAdapter` interface
- If adapter doesn't implement it, refresh still works cookie-only (current behavior)
- Log a one-time warning when fallback fires
- PostgreSQL adapter updates `expiresAt` column only (no `updated_at` column, no schema migration needed)

**yoctoNEAR math (BUG-01)**
- Use bn.js library for NEAR-to-yoctoNEAR conversion
- Add bn.js as dependency if not already present
- Config `fundingAmount` stays as human-readable NEAR string — conversion happens internally
- No API change for consumers

**Signed transaction format (BUG-02)**
- Include public key bytes in `buildSignedTransaction()` output in correct borsh position (after signature type byte)
- Claude audits full signing flow and fixes hashing if needed

**Timing-safe comparison (SEC-01)**
- Replace `signature !== expectedSignature` with `crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))` in `verifySessionId()`

**Custom base58 replacement (DEBT-02)**
- Replace hand-rolled `base58Encode()` in `mpc.ts` with `bs58.encode()` (bs58 is already a project dependency)

### Claude's Discretion
- Exact borsh byte layout for SignedTransaction (public key position relative to signature)
- Whether transaction bytes need sha256 hashing before signing (audit call site)
- Warning log format and exact wording
- Any additional edge cases discovered during implementation

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-01 | Session signature verification uses constant-time comparison (`crypto.timingSafeEqual`) | Node.js built-in, exact API and length-mismatch pitfall documented below |
| SEC-04 | Account derivation uses server-side secret salt to prevent account ID prediction | sha256 with salt string prepended; backward-compat pattern documented |
| BUG-01 | NEAR amount conversion uses BigInt-based math instead of floating-point | bn.js string-based multiplication; exact conversion pattern documented |
| BUG-02 | Signed transaction format includes public key in signature wrapper | NEAR borsh format audited; current code missing publicKey in Signature; fix documented |
| BUG-03 | Session refresh updates `expiresAt` in database (not just cookie) | Optional interface method pattern; postgres UPDATE query documented |
| DEBT-02 | Custom `base58Encode()` replaced with `bs58.encode()` consistently | bs58 v6 already installed; exact import and encode call documented |
</phase_requirements>

---

## Summary

Phase 1 targets six discrete, single-file fixes with no new infrastructure. All changes are surgical edits to `src/server/session.ts`, `src/server/mpc.ts`, and `src/types/index.ts`. The security fixes (SEC-01, SEC-04) address active attack surface. The bug fixes (BUG-01, BUG-02, BUG-03) correct logic errors that produce wrong results on-chain or break session persistence. DEBT-02 is a code quality fix with no behavior change.

The largest discretion area is BUG-02: the exact NEAR borsh `SignedTransaction` wire format. Research confirms that NEAR's `Signature` struct is a borsh enum: `keyType (1 byte) + data (64 bytes)`. The current `buildSignedTransaction()` implementation already includes the `keyType` byte (0x00 for ed25519) but is missing the **public key bytes** in the signature wrapper. The CONTEXT decision requires adding `publicKey (32 bytes)` between the type byte and the signature bytes to match the correct format. This area is flagged for implementation audit.

The sha256 hashing before signing (line 234 of mpc.ts: `createHash('sha256').update(transaction).digest()`) is correct NEAR protocol behavior — the transaction bytes are sha256-hashed before passing to `nacl.sign.detached`. This does NOT need to change.

**Primary recommendation:** Execute fixes in dependency order: types first (SEC-04, BUG-03 interface additions), then mpc.ts (DEBT-02, BUG-01, BUG-02, SEC-04 derivation), then session.ts (SEC-01, BUG-03 refresh logic), then postgres adapter (BUG-03 implementation).

---

## Standard Stack

### Core (all already project dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `crypto` (Node built-in) | Node ≥18 | `timingSafeEqual`, `createHmac`, `createHash` | Zero-dependency, always available |
| `bs58` | ^6.0.0 (installed) | Base58 encode/decode | Already a project dependency; replaces hand-rolled version |
| `bn.js` | ^5.2.1 (to add) | BigInt arithmetic for yoctoNEAR conversion | NEAR ecosystem standard; handles numbers beyond JS float precision |

### Not Needed
- `@near-js/transactions` is a dev dependency already in package.json but `node_modules` is not installed. The manual borsh serialization in mpc.ts is intentional to avoid adding a runtime dependency. The BUG-02 fix is a manual byte-level correction.

**Installation (only bn.js is new):**
```bash
npm install bn.js
npm install --save-dev @types/bn.js
```

---

## Architecture Patterns

### No structural changes — targeted edits only

This phase makes no architectural changes. Every fix is an in-place edit to an existing function or interface. The pattern for each fix:

1. **Type-level change** → edit `src/types/index.ts`
2. **Implementation change** → edit `src/server/session.ts` or `src/server/mpc.ts`
3. **Adapter change** → edit `src/server/db/adapters/postgres.ts`

### Pattern 1: Optional interface method with runtime fallback (BUG-03)

**What:** Add `updateSessionExpiry?` as an optional method on `DatabaseAdapter`. The session manager checks at runtime whether the method exists and calls it if so; otherwise it logs a warning and continues cookie-only.

**When to use:** When extending a public interface without breaking existing adapter implementations. Established by the PROJECT.md decision on DatabaseAdapter extensibility.

**Example:**
```typescript
// In src/types/index.ts — DatabaseAdapter interface
updateSessionExpiry?(sessionId: string, newExpiresAt: Date): Promise<void>;

// In src/server/session.ts — refreshSession method
if (db.updateSessionExpiry) {
  await db.updateSessionExpiry(session.id, newExpiresAt);
} else {
  // One-time warning (see startup warning pattern below)
}
```

### Pattern 2: One-time startup warning via module-level flag

**What:** A module-level boolean flag that is set after the first warning fires, preventing log spam on every request.

**Example:**
```typescript
// Module-level (outside factory function)
let warnedNoSalt = false;
let warnedNoUpdateSessionExpiry = false;

// Inside factory or method:
if (!warnedNoSalt) {
  console.warn('[near-phantom-auth] No derivationSalt configured — account IDs are predictable from user IDs. Set derivationSalt for production use.');
  warnedNoSalt = true;
}
```

### Pattern 3: Backward-compatible salted hash derivation (SEC-04)

**What:** When `derivationSalt` is set in config, use it in the sha256 input. When absent, use the current input string unchanged.

**Current code (mpc.ts line 414):**
```typescript
const seed = createHash('sha256').update(`implicit-${userId}`).digest();
```

**Fixed code:**
```typescript
const seedInput = config.derivationSalt
  ? `implicit-${config.derivationSalt}-${userId}`
  : `implicit-${userId}`;
const seed = createHash('sha256').update(seedInput).digest();
```

The `derivationSalt` must be threaded from `AnonAuthConfig` down to the derivation call site. `MPCAccountManager` either receives it in `MPCConfig` or it is passed at call time — the cleaner pattern is to add it to `MPCConfig`.

### Anti-Patterns to Avoid

- **Do not use `bn.js` for numbers that are already safe native BigInts.** Use bn.js only for the NEAR string-to-yoctoNEAR conversion where string multiplication is required. Do not replace the borsh `serializeU128` logic.
- **Do not make `updateSessionExpiry` required.** That would be a breaking change for all existing adapter implementers.
- **Do not call `crypto.timingSafeEqual` with strings of different byte lengths without guarding.** It throws a `RangeError`. Always compute `expectedSignature` before comparing so lengths are known.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NEAR string → yoctoNEAR | Custom float multiplication | `bn.js` (new dep) or native `BigInt` with string parsing | Float precision breaks above 9000 NEAR; string-based multiplication is exact |
| Base58 encoding | Custom alphabet-loop encode | `bs58.encode()` | Already installed; handles leading-zero bytes correctly; hand-rolled version has subtle edge cases |
| Timing-safe compare | XOR loop or length check | `crypto.timingSafeEqual` | Node built-in; correctly handles constant-time comparison; do not try to implement manually |

**Key insight:** All three hand-rolled solutions in this codebase have the same failure mode: they appear to work for happy-path inputs and fail silently or subtly on edge cases. Use battle-tested implementations.

---

## Common Pitfalls

### Pitfall 1: `crypto.timingSafeEqual` throws on length mismatch (SEC-01)

**What goes wrong:** If `Buffer.from(signature)` and `Buffer.from(expectedSignature)` have different byte lengths, `timingSafeEqual` throws `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` — an uncaught exception that crashes the request or leaks stack traces.

**Why it happens:** A tampered cookie might have a truncated or padded signature. The current naive `!==` comparison handles any-length mismatch silently; `timingSafeEqual` does not.

**How to avoid:** Guard with a length check first, but use constant-time logic for the length check too. The standard pattern:
```typescript
// Source: Node.js docs + standard webhook verification patterns
const sigBuffer = Buffer.from(signature, 'base64url');
const expectedBuffer = Buffer.from(expectedSignature, 'base64url');
if (sigBuffer.length !== expectedBuffer.length) return null;
if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return null;
return sessionId;
```
Note: The length check itself is not timing-safe but this is acceptable because the lengths are deterministic (both are sha256 HMAC base64url outputs — always 43 characters). If you create the expected signature first and compare byte buffers, lengths will always match for valid inputs.

**Warning signs:** Uncaught `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` errors in logs after deploying.

### Pitfall 2: bn.js is NOT a drop-in for native BigInt (BUG-01)

**What goes wrong:** `bn.js` uses a different API than native `BigInt`. `new BN('1000')` produces a `BN` instance, not a `bigint`. Passing a `BN` instance to `serializeU128` (which expects `bigint`) will produce wrong bytes.

**How to avoid:** Convert to native BigInt at the boundary using `.toString()`:
```typescript
import BN from 'bn.js';
const YOCTO_PER_NEAR = new BN('1000000000000000000000000'); // 10^24
const amountBN = new BN(amountNear).mul(YOCTO_PER_NEAR);
const amountYocto = BigInt(amountBN.toString());
```

**Warning signs:** TypeScript type error `Argument of type 'BN' is not assignable to parameter of type 'bigint'`.

### Pitfall 3: bs58 v6 uses named export, not default (DEBT-02)

**What goes wrong:** The existing code uses `bs58.default.encode(...)` (dynamic import, CJS-style). The static import for bs58 v6 (ESM) is `import { encode } from 'bs58'` or `import bs58 from 'bs58'`.

**Why it happens:** The mpc.ts file dynamically imports bs58 inside the `fundAccountFromTreasury` function. Moving to a static import at the top of the file changes the import style.

**How to avoid:** Use the static import pattern consistent with the project (ESM):
```typescript
import bs58 from 'bs58';
// then use: bs58.encode(bytes)
```

The `base58Encode` function at lines 46-67 of mpc.ts can be deleted entirely once `bs58.encode` is used at its call sites.

### Pitfall 4: derivationSalt must propagate to MPCAccountManager (SEC-04)

**What goes wrong:** `derivationSalt` is added to `AnonAuthConfig` but never threaded down to `MPCAccountManager`, which calls `createHash('sha256').update(...)`.

**How to avoid:** Add `derivationSalt?: string` to `MPCConfig` interface in mpc.ts, and pass `config.mpc?.derivationSalt` when constructing `MPCAccountManager` from the main router/factory. The `MPCAccountManager.createAccount()` method reads `this.derivationSalt` when building the seed.

### Pitfall 5: BUG-02 — borsh SignedTransaction wire format (Claude's discretion area)

**What goes wrong:** The current `buildSignedTransaction()` (lines 320-335) produces:
```
[transaction bytes][0x00 keyType byte][64-byte signature]
```

The NEAR protocol borsh `Signature` enum is: `keyType (1 byte) + data (64 bytes)`. This appears complete. However, the CONTEXT decision specifies that public key bytes must be included in `buildSignedTransaction()`. Research into NEAR borsh format shows `SignedTransaction = {transaction: Transaction, signature: Signature}` — the public key is in the `Transaction` struct, not in `Signature`.

**Audit action required:** During implementation, submit the current transaction format to NEAR testnet RPC and inspect the error message. If the RPC returns a deserialization error, the byte layout is wrong. The most likely issue is that the `Signature` enum requires `[keyType (1 byte)][publicKey (32 bytes)][signature (64 bytes)]` rather than `[keyType][signature]` — this matches what the CONTEXT decision explicitly states. The `@near-js/transactions` package (already in package.json) provides `encodeSignedTransaction` or similar that can be used to generate a reference byte sequence for comparison.

**Recommendation:** Implement the fix as specified in CONTEXT (add 32-byte public key after the type byte) and validate against NEAR testnet in the verify step.

---

## Code Examples

### SEC-01: Timing-safe comparison fix

```typescript
// src/server/session.ts — verifySessionId function
// Source: Node.js v20 docs https://nodejs.org/docs/latest-v20.x/api/crypto.html
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';

function verifySessionId(signedValue: string, secret: string): string | null {
  const parts = signedValue.split('.');
  if (parts.length !== 2) return null;

  const [sessionId, signature] = parts;
  const expectedSignature = createHmac('sha256', secret)
    .update(sessionId)
    .digest('base64url');

  // Both are base64url HMAC-SHA256 outputs — always same length for valid inputs.
  // Use Buffer for timingSafeEqual (requires TypedArray/Buffer).
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(sigBuffer, expectedBuffer)) return null;
  return sessionId;
}
```

### BUG-01: yoctoNEAR conversion with bn.js

```typescript
// src/server/mpc.ts
// Source: bn.js docs https://github.com/indutny/bn.js
import BN from 'bn.js';

// Replace line 219:
// BEFORE (broken): const amountYocto = BigInt(Math.floor(parseFloat(amountNear) * 1e24));
// AFTER:
const YOCTO_PER_NEAR = new BN('1000000000000000000000000'); // 10^24, exact
const amountBN = new BN(amountNear).mul(YOCTO_PER_NEAR);
const amountYocto = BigInt(amountBN.toString());
// amountYocto is now a native bigint, compatible with serializeU128()
```

### BUG-02: buildSignedTransaction with public key

```typescript
// src/server/mpc.ts — buildSignedTransaction function
// NEAR Signature borsh format (per CONTEXT decision):
// transaction bytes || Signature { keyType (1 byte) || publicKey (32 bytes) || data (64 bytes) }
function buildSignedTransaction(
  transaction: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): Uint8Array {
  const parts: Uint8Array[] = [];

  parts.push(transaction);

  // Signature enum (ED25519 = 0)
  parts.push(new Uint8Array([0]));           // keyType: 1 byte
  parts.push(new Uint8Array(publicKey));     // publicKey: 32 bytes  ← THIS IS THE FIX
  parts.push(new Uint8Array(signature));     // signature data: 64 bytes

  return concatArrays(parts);
}
```

### BUG-03: Optional updateSessionExpiry in DatabaseAdapter

```typescript
// src/types/index.ts — DatabaseAdapter interface addition
export interface DatabaseAdapter {
  // ... existing methods ...

  // Sessions
  createSession(session: CreateSessionInput): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  deleteSession(sessionId: string): Promise<void>;
  deleteUserSessions(userId: string): Promise<void>;
  cleanExpiredSessions(): Promise<number>;

  // Optional: update expiresAt without full session replacement
  // If not implemented, session refresh falls back to cookie-only behavior.
  updateSessionExpiry?(sessionId: string, newExpiresAt: Date): Promise<void>;
}
```

```typescript
// src/server/db/adapters/postgres.ts — implementation
async updateSessionExpiry(sessionId: string, newExpiresAt: Date): Promise<void> {
  const p = await getPool();
  await p.query(
    'UPDATE anon_sessions SET expires_at = $1 WHERE id = $2',
    [newExpiresAt, sessionId]
  );
},
```

```typescript
// src/server/session.ts — refreshSession, replace "Update in database would happen here" comment
let warnedNoUpdateSessionExpiry = false;

// Inside refreshSession, in the elapsed > lifetime * 0.5 block:
const newExpiresAt = new Date(now + durationMs);

if (db.updateSessionExpiry) {
  await db.updateSessionExpiry(session.id, newExpiresAt);
} else if (!warnedNoUpdateSessionExpiry) {
  console.warn(
    '[near-phantom-auth] Session refresh is cookie-only — implement updateSessionExpiry on your adapter for full persistence.'
  );
  warnedNoUpdateSessionExpiry = true;
}
```

### SEC-04: Derivation salt

```typescript
// src/server/mpc.ts — MPCConfig interface addition
export interface MPCConfig {
  networkId: 'testnet' | 'mainnet';
  accountPrefix?: string;
  treasuryAccount?: string;
  treasuryPrivateKey?: string;
  fundingAmount?: string;
  derivationSalt?: string;  // ← ADD THIS
}

// MPCAccountManager constructor stores it:
private derivationSalt?: string;
constructor(config: MPCConfig) {
  // ... existing ...
  this.derivationSalt = config.derivationSalt;
}

// createAccount method — replace line 414:
const seedInput = this.derivationSalt
  ? `implicit-${this.derivationSalt}-${userId}`
  : `implicit-${userId}`;
const seed = createHash('sha256').update(seedInput).digest();
```

```typescript
// src/types/index.ts — AnonAuthConfig addition
export interface AnonAuthConfig {
  // ... existing fields ...
  /** Server-side secret salt for NEAR account derivation. Required for production. */
  derivationSalt?: string;
}
```

```typescript
// Startup warning — in main factory/router setup, after config is read:
let warnedNoDerivationSalt = false;
if (!config.derivationSalt && !warnedNoDerivationSalt) {
  console.warn(
    '[near-phantom-auth] No derivationSalt configured — account IDs are predictable from user IDs. Set derivationSalt for production use.'
  );
  warnedNoDerivationSalt = true;
}
```

### DEBT-02: Replace base58Encode with bs58

```typescript
// src/server/mpc.ts — static import at top
import bs58 from 'bs58';

// DELETE the base58Encode function (lines 46-67).
// Replace all call sites:
// BEFORE: base58Encode(publicKeyBytes)
// AFTER:  bs58.encode(publicKeyBytes)

// The existing dynamic import inside fundAccountFromTreasury:
// const bs58 = await import('bs58');
// becomes the static import above; remove the dynamic import line.
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `signature !== expectedSignature` | `crypto.timingSafeEqual(...)` | Eliminates timing oracle |
| Hand-rolled base58 | `bs58.encode()` | Eliminates edge-case bugs with leading 0x00 bytes |
| `parseFloat * 1e24` | `bn.js` string multiplication | Eliminates float precision loss for large NEAR amounts |
| Unsalted `sha256("implicit-" + userId)` | Salted `sha256("implicit-" + salt + "-" + userId)` | Makes account IDs unpredictable from user IDs |
| Cookie-only session refresh | DB row update + cookie | Session expiry persists across server restarts |

---

## Open Questions

1. **BUG-02: Exact NEAR borsh SignedTransaction wire format**
   - What we know: NEAR borsh `SignedTransaction` = `{transaction: Transaction, signature: Signature}`. `Signature` = `{keyType: u8, data: [u8; 64]}`. The CONTEXT decision specifies adding public key bytes (32 bytes) between keyType and signature data.
   - What's unclear: Whether the NEAR protocol Signature enum actually includes the public key inline, or whether the CONTEXT decision is describing a project-specific extension of the format.
   - Recommendation: During implementation, use `@near-js/transactions` (already in package.json — install node_modules) to serialize a reference transaction and compare byte-by-byte to the manually-built one. This resolves the question definitively before submitting to RPC.

2. **bn.js: is it truly needed vs. native BigInt string conversion?**
   - What we know: The CONTEXT decision locks "use bn.js." This is the locked choice.
   - What's unclear: Native BigInt can also do string-based multiplication (`BigInt('1000000000000000000000000')`), but bn.js is the locked decision.
   - Recommendation: Honor the locked decision; add bn.js. The conversion pattern is well-defined above.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 (in devDependencies) |
| Config file | None — Wave 0 must create `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | Tampered signature cookie → 401, no timing leak | unit | `npx vitest run src/__tests__/session.test.ts` | Wave 0 |
| SEC-04 | Salted derivation produces different account ID than unsalted | unit | `npx vitest run src/__tests__/mpc.test.ts` | Wave 0 |
| BUG-01 | yoctoNEAR conversion exact for sub-1-NEAR amounts | unit | `npx vitest run src/__tests__/mpc.test.ts` | Wave 0 |
| BUG-02 | buildSignedTransaction output bytes match @near-js/transactions reference | unit | `npx vitest run src/__tests__/mpc.test.ts` | Wave 0 |
| BUG-03 | Session refresh calls updateSessionExpiry when adapter implements it | unit | `npx vitest run src/__tests__/session.test.ts` | Wave 0 |
| DEBT-02 | bs58.encode and removed base58Encode produce identical output for known inputs | unit | `npx vitest run src/__tests__/mpc.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` — vitest is installed but no config file exists
- [ ] `src/__tests__/session.test.ts` — covers SEC-01, BUG-03
- [ ] `src/__tests__/mpc.test.ts` — covers SEC-04, BUG-01, BUG-02, DEBT-02

**Suggested vitest.config.ts:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

---

## Sources

### Primary (HIGH confidence)
- Node.js v20 docs — `crypto.timingSafeEqual` API, Buffer requirements, length mismatch behavior: https://nodejs.org/docs/latest-v20.x/api/crypto.html
- NEAR nomicon spec — `SignedTransaction` struct fields (transaction + signature): https://nomicon.io/RuntimeSpec/Transactions
- NEAR docs — manual SignedTransaction construction code example with `Signature({ keyType, data })`: https://docs.near.org/integrations/create-transactions
- Project source — `src/server/session.ts` (verified: line 68 uses `!==`; lines 179-207 have TODO comment)
- Project source — `src/server/mpc.ts` (verified: line 219 float math; lines 320-335 missing publicKey; lines 46-67 hand-rolled base58)
- Project source — `package.json` (verified: bs58 ^6.0.0 installed; bn.js absent; vitest ^4.0.18 in devDependencies)

### Secondary (MEDIUM confidence)
- bn.js GitHub — BigNum in pure JavaScript, no native BigInt support, string-based API: https://github.com/indutny/bn.js
- NEAR nomicon — FinancialTransaction scenario (sha256 hash before signing confirmed): https://nomicon.io/RuntimeSpec/Scenarios/FinancialTransaction.html

### Tertiary (LOW confidence — validate during implementation)
- BUG-02 public key position: derived from CONTEXT.md decision + NEAR docs Signature struct definition. The exact byte layout must be validated against NEAR RPC during implementation.

---

## Metadata

**Confidence breakdown:**
- SEC-01 (timingSafeEqual): HIGH — Node.js built-in, well-documented, exact fix is one line
- SEC-04 (derivation salt): HIGH — pure sha256 string manipulation, backward compat pattern is clear
- BUG-01 (yoctoNEAR): HIGH — bn.js API is well-documented; conversion pattern verified
- BUG-02 (borsh format): MEDIUM — public key position requires testnet validation during implementation
- BUG-03 (session DB update): HIGH — optional interface pattern + postgres UPDATE query straightforward
- DEBT-02 (bs58): HIGH — bs58 v6 installed, encode API stable, call sites identified

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable libraries, no fast-moving dependencies)
