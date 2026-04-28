# Phase 10: MPCAccountManager - Research

**Researched:** 2026-04-28
**Domain:** NEAR RPC, MPC account derivation, TypeScript class export, pino redaction, vitest mocking
**Confidence:** HIGH — all findings verified by direct codebase inspection and node_modules introspection

---

## Summary

Phase 10 is an additive hotfix on top of the v0.6.0 baseline. The `MPCAccountManager` class already exists in `src/server/mpc.ts` and is functionally correct for its internal use (provisioning accounts inside `createAnonAuth`). The production restart loop in the downstream Ledgera mpc-sidecar is caused by a **type-only export gap**: `src/server/index.ts` uses `export type { MPCAccountManager }`, which means the class constructor is absent from the compiled ESM/CJS runtime output even though the `.d.ts` declarations include it. The consumer's `import { MPCAccountManager }` resolves to `undefined` at runtime.

Beyond the export fix, MPC-01 through MPC-12 require six surgical changes to `mpc.ts` and `recovery/wallet.ts`, two new type aliases (`MPCAccountManagerConfig`, `CreateAccountResult`), new T1–T12 tests, a version bump to 0.6.1, and a README/CHANGELOG addition. No new npm dependencies are needed — all required NEAR utilities (`parseNearAmount`, `InMemoryKeyStore`, `@near-js/types`) are already installed.

**Primary recommendation:** Fix the export gap and six behavioral gaps in mpc.ts, add the new public types, write T1–T12 tests in a new `mpcaccountmanager.test.ts` file, bump to 0.6.1, and publish. The internal `MPCConfig` and `MPCAccount` types remain unchanged to avoid breaking the internal `createAnonAuth` wiring.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| NEAR account derivation (userId → 64-hex implicitId) | API / Backend | — | Pure deterministic computation; no network required |
| Treasury transfer (fund implicit account) | API / Backend | NEAR RPC | Signing happens in-process; RPC is an external boundary |
| Idempotency guard (view_account check) | API / Backend | NEAR RPC | Logic lives in the class; RPC call is a read-only probe |
| Full-access key discrimination (verifyRecoveryWallet) | API / Backend | NEAR RPC | Parse the `permission` field returned by view_access_key |
| Treasury key isolation (InMemoryKeyStore) | API / Backend | — | Keeps private key inside keystore abstraction; never in log context |
| Pino redaction (treasuryPrivateKey scrubbing) | API / Backend | — | Redact paths configured at logger construction time |
| Consumer-facing type contracts (MPCAccountManagerConfig, CreateAccountResult) | API / Backend | — | TypeScript-only; shapes the public API surface |
| Build/publish (ESM + CJS + d.ts) | CDN / Static | — | tsup handles; fix is a one-line import change in index.ts |

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MPC-01 | Export MPCAccountManager class + MPCAccountManagerConfig + CreateAccountResult from /server | Class exists in mpc.ts; fix: change `export type` to `export` in index.ts; add two new type aliases |
| MPC-02 | createAccount is a pure function of (treasuryAccount, userId, derivationSalt) | Already deterministic; derivation is SHA-256(salt+userId); document in README |
| MPC-03 | createAccount is idempotent; view_account check short-circuits on second call | Already implemented; verify it returns onChain:true and skips transfer |
| MPC-04 | nearAccountId matches /^[a-f0-9]{64}$/ (64-char hex implicit account) | Already correct; publicKeyBytes.toString('hex') produces this |
| MPC-05 | verifyRecoveryWallet checks FullAccess permission, not just key existence | BUG: checkWalletAccess only checks !result.error; must also check result.result.permission === 'FullAccess' |
| MPC-06 | Concurrent createAccount calls converge; nonce-race loser retries view_account once | Missing: no retry logic today; add one retry after broadcast error |
| MPC-07 | MPCAccountManagerConfig.derivationSalt is REQUIRED | New type alias of MPCConfig with derivationSalt required (not optional) |
| MPC-08 | fundingAmount uses parseNearAmount from @near-js/utils; networkId drives RPC URL | Current BN method produces identical output; can switch to parseNearAmount cleanly |
| MPC-09 | treasury private key never logged; pino redaction covers config.treasuryPrivateKey; InMemoryKeyStore per instance | InMemoryKeyStore from @near-js/keystores is installed; add redact config |
| MPC-10 | Error paths throw with cause (RPC unreachable, transfer failed, treasury underfunded); verifyRecoveryWallet swallows account-not-found | createAccount currently returns degraded result on error — must throw instead |
| MPC-11 | T1–T12 test scenarios (11 unit/mock + testnet integration for T1, T2, T7, T11) | New test file `mpcaccountmanager.test.ts`; testnet tests guard-skipped without env vars |
| MPC-12 | README doc, CHANGELOG entry, npm publish at v0.6.1 | CHANGELOG.md does not exist; create it; bump version in package.json |
</phase_requirements>

---

## Standard Stack

### Core (already installed — no new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@near-js/utils` | 2.5.1 | `parseNearAmount` for NEAR→yoctoNEAR | Already installed; replaces BN-based manual conversion |
| `@near-js/keystores` | 2.5.1 | `InMemoryKeyStore` for treasury key isolation | Already installed; satisfies MPC-09 "single KeyStore per instance" |
| `@near-js/crypto` | 2.5.1 | `KeyPair.fromString`, `PublicKey.fromString` | Already used in addRecoveryWallet |
| `@near-js/signers` | 2.5.1 | `KeyPairSigner` for signing transactions | Already used in addRecoveryWallet |
| `@near-js/transactions` | 2.5.1 | `createTransaction`, `actionCreators` | Already used in addRecoveryWallet |
| `@near-js/types` | 2.5.1 | `AccessKeyViewRaw`, `FunctionCallPermissionView` type shapes | Already installed; use for RPC response typing |
| `pino` | 10.3.1 | Structured logging with redaction | Already used throughout; add redact paths for treasury key |
| `vitest` | 4.0.18 | Test runner | Already configured; tests run in `node` environment |

**Version verification:** [VERIFIED: node_modules introspection] All packages above are installed at the stated versions.

**Installation:** No new packages required. Zero `npm install` steps.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `parseNearAmount` (@near-js/utils) | BN-based manual conversion (current) | Both produce identical output (verified); parseNearAmount is canonical; switch satisfies MPC-08 literal text |
| `InMemoryKeyStore` | raw `KeyPair.fromString` string (current) | KeyStore provides isolation abstraction; raw approach works but fails MPC-09 "single KeyStore" requirement |

---

## Architecture Patterns

### System Architecture Diagram

```
Consumer code
    │
    │ import { MPCAccountManager } from '@vitalpoint/near-phantom-auth/server'
    │
    ▼
MPCAccountManager (src/server/mpc.ts — exported as value, not type-only)
    │
    ├─ constructor(MPCAccountManagerConfig)
    │      ├── derivationSalt: string  [REQUIRED]
    │      ├── treasuryAccount: string
    │      ├── treasuryPrivateKey: string  → stored only in InMemoryKeyStore
    │      ├── networkId: 'testnet' | 'mainnet'
    │      ├── fundingAmount: string (default "0.01")
    │      └── logger?: pino.Logger   → pino with redact: ['config.treasuryPrivateKey']
    │
    ├─ createAccount(userId: string): Promise<CreateAccountResult>
    │      │
    │      ├── 1. Derive: SHA-256(`implicit-{derivationSalt}-{userId}`) → publicKeyBytes
    │      ├── 2. implicitAccountId = publicKeyBytes.toString('hex')  [64 hex chars]
    │      ├── 3. view_account RPC → exists?
    │      │       YES → return { nearAccountId, mpcPublicKey, derivationPath, onChain: true }
    │      │       NO  → continue
    │      ├── 4. fundAccountFromTreasury (transfer + broadcast_tx_commit)
    │      │       SUCCESS → return { ..., onChain: true }
    │      │       NONCE_RACE → retry view_account once → return success (MPC-06)
    │      │       RPC_UNREACHABLE → throw Error('RPC unreachable', { cause })
    │      │       TREASURY_UNDERFUNDED → throw Error('Treasury underfunded', { cause })
    │      │       OTHER_FAILURE → throw Error('Transfer failed', { cause })
    │      └── (never swallow errors — MPC-10)
    │
    ├─ verifyRecoveryWallet(nearAccountId, publicKey): Promise<boolean>
    │      │
    │      ├── view_access_key RPC → result
    │      │       error present → return false  (includes UNKNOWN_ACCOUNT = deleted account)
    │      │       result.permission === 'FullAccess' → return true
    │      │       result.permission is FunctionCallPermissionView → return false
    │      │       fetch throws → throw Error (only RPC unreachable re-throws)
    │      └── never throws for missing/deleted accounts
    │
    └─ (dist/server/index.js ESM + dist/server/index.cjs CJS + dist/server/index.d.ts)
           │
           └─ NEAR RPC (https://rpc.testnet.near.org / https://rpc.mainnet.near.org)
```

### Recommended Project Structure

No new directories required. All changes are in existing files plus one new test file:

```
src/
├── server/
│   ├── mpc.ts              # MODIFY: 6 behavioral gaps + new MPCAccountManagerConfig/CreateAccountResult types
│   ├── index.ts            # MODIFY: export MPCAccountManager as value; re-export new types
│   └── recovery/
│       └── wallet.ts       # MODIFY: checkWalletAccess adds permission === 'FullAccess' check
└── __tests__/
    ├── mpcaccountmanager.test.ts  # CREATE: T1–T12 scenarios
    └── mpc.test.ts                # EXISTING: no modification needed (stays green)

package.json               # MODIFY: version 0.6.0 → 0.6.1
CHANGELOG.md               # CREATE: first entry for v0.6.1
README.md                  # MODIFY: add MPCAccountManager section
```

### Pattern 1: Value Export Fix (MPC-01)

**What:** Change the type-only re-export in `index.ts` to a value export so the class constructor is present at runtime.

**Current (BROKEN — class is undefined at consumer runtime):**
```typescript
// src/server/index.ts line 260
export type { MPCAccountManager, MPCConfig, MPCAccount } from './mpc.js';
```

**Fixed:**
```typescript
// Export MPCAccountManager as a value (class constructor) so consumers can instantiate it.
// MPCAccountManagerConfig and CreateAccountResult are the new consumer-facing type aliases.
export { MPCAccountManager } from './mpc.js';
export type { MPCAccountManagerConfig, CreateAccountResult, MPCConfig, MPCAccount } from './mpc.js';
```

[VERIFIED: dist inspection] — confirmed `dist/server/index.js` exports list does NOT include `MPCAccountManager`; the d.ts includes it as a value export but JS runtime is missing it.

### Pattern 2: New Consumer-Facing Types (MPC-01, MPC-07)

**What:** Two type aliases that form the frozen consumer contract. These live in `mpc.ts` alongside the existing types.

```typescript
// src/server/mpc.ts — add after MPCConfig

/**
 * Consumer-facing configuration for standalone MPCAccountManager usage.
 * derivationSalt is REQUIRED for cross-tenant isolation (MPC-07).
 */
export interface MPCAccountManagerConfig {
  networkId: 'testnet' | 'mainnet';
  treasuryAccount: string;
  treasuryPrivateKey: string;
  derivationSalt: string;           // REQUIRED — was optional in MPCConfig
  fundingAmount?: string;           // decimal-string in NEAR, default "0.01"
  logger?: Logger;
}

/**
 * Consumer-facing return type from createAccount().
 * Alias of MPCAccount for the frozen public contract.
 */
export type CreateAccountResult = MPCAccount;
```

**Why separate from MPCConfig:** The internal `MPCConfig` (used by `createAnonAuth`) has `derivationSalt?: string` (optional for backward compat). The consumer-facing `MPCAccountManagerConfig` makes it required, enforced at the TypeScript type level.

[ASSUMED] — The constructor will accept either `MPCConfig` or `MPCAccountManagerConfig`. The cleanest implementation is an overloaded constructor or accepting `MPCAccountManagerConfig` and using it internally. Risk: if internal uses of `createMPCManager(MPCConfig)` need to stay optional-salt, we should keep the internal constructor accepting `MPCConfig` and only enforce required salt through the new type alias.

### Pattern 3: FullAccess Permission Check (MPC-05)

**What:** Fix `checkWalletAccess` in `recovery/wallet.ts` to read the `permission` field.

**Current (BROKEN — returns true for function-call keys):**
```typescript
const result = await response.json() as { error?: unknown };
return !result.error;
```

**Fixed:**
```typescript
// Source: @near-js/types AccessKeyViewRaw shape
const result = await response.json() as {
  result?: { permission: 'FullAccess' | { FunctionCall: unknown } };
  error?: unknown;
};
if (result.error || !result.result) return false;
return result.result.permission === 'FullAccess';
```

**NEAR RPC view_access_key response shapes:**
- Key exists with FullAccess: `{ result: { nonce: N, permission: 'FullAccess', block_height: N } }`
- Key exists with FunctionCall only: `{ result: { nonce: N, permission: { FunctionCall: { allowance, receiver_id, method_names } } } }`
- Key not found: `{ error: { cause: { name: 'UNKNOWN_ACCESS_KEY' }, ... } }`
- Account deleted/not found: `{ error: { cause: { name: 'UNKNOWN_ACCOUNT' }, ... } }`

[VERIFIED: node_modules/@near-js/types/lib/esm/provider/response.d.ts]

### Pattern 4: Error-Throwing Paths (MPC-10)

**What:** Replace degraded-return patterns with thrown errors so consumer routes can catch and return 500.

**Current (BROKEN — returns garbage object on failure):**
```typescript
} catch (error) {
  this.log.error({ err: error }, 'Mainnet implicit account creation failed');
  return { nearAccountId, derivationPath, mpcPublicKey: 'creation-failed', onChain: false };
}
```

**Fixed:**
```typescript
} catch (error) {
  this.log.error({ err: error }, 'createAccount failed');
  throw new Error('Account creation failed', { cause: error });
}
```

**Error taxonomy the planner must implement:**
| Condition | Error message | When |
|-----------|--------------|------|
| RPC unreachable | `'RPC unreachable'` | `fetch` throws (network failure) |
| Treasury underfunded | `'Treasury underfunded'` | broadcast_tx_commit error contains "Sender does not have enough funds" |
| Transfer failed | `'Transfer failed'` | Any other broadcast_tx_commit error |
| `verifyRecoveryWallet` + account not found | (swallow, return false) | UNKNOWN_ACCOUNT or UNKNOWN_ACCESS_KEY in error |
| `verifyRecoveryWallet` + RPC unreachable | throw | `fetch` throws — only this re-throws |

### Pattern 5: Concurrent-Call Convergence (MPC-06)

**What:** After a nonce-race broadcast failure, retry `view_account` once before giving up. The loser's transfer was rejected because the winner already funded the account.

**Pseudocode (add to createAccount after fundAccountFromTreasury failure path):**
```typescript
// If broadcast failed with nonce error or account-already-funded, 
// it may be because a concurrent call already provisioned it.
if (isNonceOrFundedError(fundResult.error)) {
  const existsNow = await accountExists(implicitAccountId, this.networkId);
  if (existsNow) {
    this.log.info({ accountId: implicitAccountId }, 'Concurrent provisioning detected; account now exists');
    return { nearAccountId: implicitAccountId, derivationPath, mpcPublicKey: publicKey, onChain: true };
  }
}
throw new Error('Transfer failed', { cause: new Error(fundResult.error) });
```

**Why this is sufficient for MPC-06:** Idempotent derivation ensures both callers compute the same `implicitAccountId`. Only one can win the nonce race. The loser sees a broadcast error, re-checks view_account, and finds the winner already provisioned it. [ASSUMED: the NEAR testnet broadcast error on nonce collision contains distinguishable text like "nonce" or "InvalidNonce"; we need to check empirically or treat any broadcast error as a potential concurrency loss]

### Pattern 6: parseNearAmount Migration (MPC-08)

**What:** Replace BN-based yoctoNEAR conversion with `parseNearAmount` from `@near-js/utils`.

```typescript
// Before (mpc.ts fundAccountFromTreasury):
const [whole, fraction = ''] = amountNear.split('.');
const paddedFraction = fraction.padEnd(24, '0').slice(0, 24);
const yoctoStr = (whole + paddedFraction).replace(/^0+/, '') || '0';
const amountYocto = BigInt(new BN(yoctoStr).toString());

// After:
import { parseNearAmount } from '@near-js/utils';
const yoctoStr = parseNearAmount(amountNear);  // returns string | null
if (!yoctoStr) throw new Error(`Invalid NEAR amount: ${amountNear}`);
const amountYocto = BigInt(yoctoStr);
```

[VERIFIED: node_modules] — `parseNearAmount` exists in `@near-js/utils` and produces identical output to the BN method (confirmed via inline test across 5 amount values including edge cases).

### Pattern 7: InMemoryKeyStore for Treasury Key Isolation (MPC-09)

**What:** In the MPCAccountManager constructor, store the treasury private key in an `InMemoryKeyStore` instead of as a raw `string` instance field. The raw string field is never passed to a logger.

```typescript
// src/server/mpc.ts constructor
import { InMemoryKeyStore } from '@near-js/keystores';

private keyStore: InMemoryKeyStore;  // replaces private treasuryPrivateKey: string

constructor(config: MPCConfig) {
  // ... other setup ...
  this.keyStore = new InMemoryKeyStore();
  if (config.treasuryAccount && config.treasuryPrivateKey) {
    const keyPair = KeyPair.fromString(config.treasuryPrivateKey as `ed25519:${string}`);
    await this.keyStore.setKey(config.networkId, config.treasuryAccount, keyPair);
    // config.treasuryPrivateKey string is discarded after this point
  }
}

// Usage in fundAccountFromTreasury: retrieve from keyStore at call time
const keyPair = await this.keyStore.getKey(this.networkId, this.treasuryAccount);
```

**Note:** `keyStore.setKey` is async, making the constructor async — or this setup must happen in a static factory. [ASSUMED: the safest approach is a static `MPCAccountManager.create(config)` async factory, but this changes the consumer API. Alternatively, store the keyPair object (not the raw key string) in the constructor synchronously.]

**Simpler approach that avoids async constructor:** Store the `KeyPair` object (not the raw string) as an instance field. The `KeyPair` object doesn't serialize to the private key value in logs; only the string representation does. The `InMemoryKeyStore` wraps a Map; using it directly is equivalent to keeping the KeyPair.

```typescript
private keyPair: KeyPair | undefined;  // replaces private treasuryPrivateKey: string

constructor(config: MPCConfig) {
  if (config.treasuryAccount && config.treasuryPrivateKey) {
    this.keyPair = KeyPair.fromString(config.treasuryPrivateKey as `ed25519:${string}`);
    // raw string is not retained
  }
}
```

**Pino redaction:** Add to the child logger creation or the pino instance at construction:
```typescript
this.log = (config.logger ?? pino({ level: 'silent', redact: ['config.treasuryPrivateKey'] }))
  .child({ module: 'mpcaccountmanager' });
```

The existing `logging.test.ts` source-grep test already checks that `treasuryPrivateKey` does not appear in any `log.*` call — that test MUST remain green.

### Anti-Patterns to Avoid

- **Don't export type-only when a value export is needed:** `export type { MPCAccountManager }` strips the class constructor from the runtime bundle. This is the root cause of the production restart loop.
- **Don't check `!result.error` as FullAccess proof:** NEAR RPC returns a successful `result` for FunctionCall keys too; `!result.error` returns true for both FullAccess and FunctionCall. Must read `result.permission`.
- **Don't swallow errors from createAccount:** Returning a degraded `{ mpcPublicKey: 'creation-failed' }` object gives consumer no way to distinguish success from failure. Always throw.
- **Don't use `console.*` in any new code:** `logging.test.ts` greps `src/server/` and fails on any `console.` call.
- **Don't install near-api-js:** The monolithic package is replaced by `@near-js/*` scoped packages that are already installed.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NEAR→yoctoNEAR conversion | Custom BN string splitting | `parseNearAmount` from `@near-js/utils` | Already installed; handles edge cases (null input, >24 decimal places) |
| Key storage/retrieval | Raw string field | `InMemoryKeyStore` from `@near-js/keystores` | Provides abstraction; satisfies MPC-09 "single KeyStore per instance" |
| Transaction serialization | Custom borsh | Existing borsh helpers in mpc.ts | Already correct (tested in mpc.test.ts BUG-02); no changes needed |
| Access key type checking | Custom RPC result parser | `@near-js/types` `AccessKeyViewRaw` shape | Type-safe; documents the permission discriminant |

---

## Runtime State Inventory

> Phase 10 is additive code-only. No runtime state is renamed or migrated. Omitting this section.

---

## Common Pitfalls

### Pitfall 1: export type vs export (the root bug)

**What goes wrong:** TypeScript `export type { MPCAccountManager }` emits nothing to the compiled JS. tsup treeshakes the class out of the bundle because it's type-only. Consumer `import { MPCAccountManager }` resolves to `undefined`. Attempting `new MPCAccountManager(config)` throws `TypeError: MPCAccountManager is not a constructor`.

**Why it happens:** The class exists in `mpc.ts` as a value export, but `index.ts` re-exports it with the `type` modifier, which TypeScript erases at compile time.

**How to avoid:** Use `export { MPCAccountManager }` (without `type`) in index.ts. [VERIFIED: dist/server/index.js inspection confirms the class is defined in the bundle but absent from the exports list]

**Warning signs:** `grep "MPCAccountManager" dist/server/index.js` shows `var MPCAccountManager = class` but the final `export { ... }` line does not include it.

### Pitfall 2: FunctionCall keys pass the old `!result.error` check

**What goes wrong:** A consumer's recovery wallet is a FunctionCall key (common for dApp integrations). `verifyRecoveryWallet` returns `true` even though the key cannot sign arbitrary transactions. Security check is bypassed.

**Why it happens:** The NEAR RPC returns a successful response for FunctionCall keys. The existing `checkWalletAccess` only checks `!result.error`, ignoring the `permission` field.

**How to avoid:** After `!result.error`, also assert `result.result.permission === 'FullAccess'`. [VERIFIED: @near-js/types AccessKeyViewRaw shape]

**Warning signs:** T7/T8 tests — `verifyRecoveryWallet(account, functionCallKey)` returns `true` instead of `false`.

### Pitfall 3: Async constructor for InMemoryKeyStore

**What goes wrong:** `InMemoryKeyStore.setKey` is async. If the constructor tries to await it, TypeScript rejects `async constructor`. If `setKey` is called without await, the key may not be stored before the first RPC call.

**How to avoid:** Store the `KeyPair` object directly in a private field (synchronous) rather than using `InMemoryKeyStore.setKey`. The KeyPair object does not serialize the private key to log output. This satisfies the spirit of MPC-09 (no raw key string floating in a log context) without requiring an async factory.

**Alternative if InMemoryKeyStore is mandated literally:** Use a static async factory method `MPCAccountManager.create(config)` that returns an initialized instance. Document this in README.

### Pitfall 4: Concurrent-call retry on any error (too broad)

**What goes wrong:** Retrying `view_account` after any broadcast failure (e.g., treasury underfunded) wastes time and misleads the caller into thinking the account was provisioned by a concurrent call.

**How to avoid:** Only retry `view_account` after errors that plausibly indicate nonce collision (INVALID_NONCE, transaction already exists, or similar). Treasury-underfunded errors should still throw immediately. [ASSUMED: NEAR testnet error text for nonce collision contains "InvalidNonce" or similar; confirm with a real testnet retry test]

### Pitfall 5: Existing mpc.test.ts tests break on behavioral changes

**What goes wrong:** The existing `mpc.test.ts` tests mock RPC to return `{ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }` for `accountExists`. If `createAccount` now throws instead of returning a degraded result, those tests will fail.

**How to avoid:** Review `mpc.test.ts` derivation-salt tests — they mock `accountExists` returning "not found" and call `createAccount` without treasury credentials. The new code path (no treasury = no transfer = return dormant result) should still work without throwing. Only the treasury-funded path needs to throw on failure. The non-treasury path can still return `{ onChain: false }` as a safe degraded state.

### Pitfall 6: `logging.test.ts` source-grep fails on new file

**What goes wrong:** A new file `src/server/mpcaccountmanager.ts` (if we create one) or changes to `mpc.ts` accidentally include `console.log` calls.

**How to avoid:** `logging.test.ts` greps `src/server/**/*.ts` for `console.`. Always use `this.log.*` (pino). Verified 0 console calls in current mpc.ts.

---

## Code Examples

### Complete createAccount algorithm (pseudocode)

```typescript
// Source: derived from existing mpc.ts lines 365-443, modified per MPC-03/06/10

async createAccount(userId: string): Promise<CreateAccountResult> {
  // Step 1: Deterministic derivation (MPC-02, MPC-04)
  const seedInput = `implicit-${this.derivationSalt}-${userId}`;
  const seed = createHash('sha256').update(seedInput).digest();
  const publicKeyBytes = derivePublicKey(seed);                    // SHA-512 → first 32 bytes
  const implicitAccountId = publicKeyBytes.toString('hex');        // 64 hex chars (MPC-04)
  const mpcPublicKey = `ed25519:${bs58.encode(publicKeyBytes)}`;
  const derivationPath = `near-anon-auth,${userId}`;

  this.log.info({ accountId: implicitAccountId }, 'createAccount called');

  // Step 2: Idempotency check (MPC-03)
  const alreadyExists = await accountExists(implicitAccountId, this.networkId);
  if (alreadyExists) {
    this.log.info({ accountId: implicitAccountId }, 'Account already on-chain, short-circuiting');
    return { nearAccountId: implicitAccountId, derivationPath, mpcPublicKey, onChain: true };
  }

  // Step 3: Fund from treasury (or return dormant if no treasury)
  if (!this.treasuryAccount || !this.keyPair) {
    this.log.warn('No treasury configured, account will be dormant');
    return { nearAccountId: implicitAccountId, derivationPath, mpcPublicKey, onChain: false };
  }

  const fundResult = await fundAccountFromTreasury(
    implicitAccountId, this.treasuryAccount, this.keyPair,
    this.fundingAmount, this.networkId, this.log
  );

  if (fundResult.success) {
    this.log.info({ txHash: fundResult.txHash }, 'Account funded');
    return { nearAccountId: implicitAccountId, derivationPath, mpcPublicKey, onChain: true };
  }

  // Step 4: Concurrent-call convergence (MPC-06)
  if (isLikelyNonceRace(fundResult.error)) {
    const existsNow = await accountExists(implicitAccountId, this.networkId);
    if (existsNow) {
      this.log.info({ accountId: implicitAccountId }, 'Concurrent provisioning; account now exists');
      return { nearAccountId: implicitAccountId, derivationPath, mpcPublicKey, onChain: true };
    }
  }

  // Step 5: Classify error and throw (MPC-10)
  if (isRpcUnreachable(fundResult.error)) {
    throw new Error('RPC unreachable', { cause: new Error(fundResult.error) });
  }
  if (isTreasuryUnderfunded(fundResult.error)) {
    throw new Error('Treasury underfunded', { cause: new Error(fundResult.error) });
  }
  throw new Error('Transfer failed', { cause: new Error(fundResult.error) });
}
```

### Complete verifyRecoveryWallet algorithm

```typescript
// Source: derived from existing mpc.ts line 574-584, 
//         checkWalletAccess in recovery/wallet.ts lines 84-115

async verifyRecoveryWallet(nearAccountId: string, publicKey: string): Promise<boolean> {
  // (MPC-05): Never throws for account-not-found (swallow); throws only if RPC unreachable.
  // (MPC-05): Returns true ONLY for FullAccess keys.
  try {
    const rpcUrl = getRPCUrl(this.networkId);
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'verify-key', method: 'query',
        params: {
          request_type: 'view_access_key',
          finality: 'final',
          account_id: nearAccountId,
          public_key: publicKey,
        },
      }),
    });
    const result = await response.json() as {
      result?: { permission: 'FullAccess' | { FunctionCall: unknown } };
      error?: unknown;
    };
    // error = UNKNOWN_ACCESS_KEY (key absent) or UNKNOWN_ACCOUNT (deleted) → false
    if (result.error || !result.result) return false;
    // FunctionCall keys → false (MPC-05)
    return result.result.permission === 'FullAccess';
  } catch (fetchError) {
    // fetch() itself threw → RPC unreachable → re-throw (MPC-10)
    throw new Error('RPC unreachable', { cause: fetchError });
  }
}
```

### T1–T12 test pattern (vitest, RPC-mocked for unit tests)

```typescript
// Source: existing mpc.test.ts vi.stubGlobal('fetch') pattern (verified)

describe('MPCAccountManager — T1: first call provisions', () => {
  beforeEach(() => {
    // view_account: not exists, then broadcast success
    let callIdx = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === 'query' && body.params.request_type === 'view_account') {
        return Promise.resolve({ json: async () => ({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }) });
      }
      if (body.method === 'query' && body.params.request_type === 'view_access_key') {
        return Promise.resolve({ json: async () => ({ result: { nonce: 100, block_hash: 'GJ2rnFKj...' } }) });
      }
      if (body.method === 'broadcast_tx_commit') {
        return Promise.resolve({ json: async () => ({ result: { transaction: { hash: 'txhash123' } } }) });
      }
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('T1: provisions account on first call and returns onChain:true', async () => {
    const manager = new MPCAccountManager({ /* ... */ });
    const result = await manager.createAccount('user-alice');
    expect(result.onChain).toBe(true);
    expect(result.nearAccountId).toMatch(/^[a-f0-9]{64}$/);  // T12 hex format
  });
});
```

---

## File-by-File Map

| File | Action | Changes Required |
|------|--------|-----------------|
| `src/server/mpc.ts` | MODIFY | Add `MPCAccountManagerConfig` interface (derivationSalt required); add `CreateAccountResult = MPCAccount` type alias; fix `createAccount` error paths to throw; add concurrent-call retry; switch to `parseNearAmount`; store `KeyPair` object instead of raw string; update constructor to accept `MPCAccountManagerConfig` |
| `src/server/recovery/wallet.ts` | MODIFY | Fix `checkWalletAccess`: add `result.result.permission === 'FullAccess'` check after the error check |
| `src/server/index.ts` | MODIFY | Change `export type { MPCAccountManager }` to `export { MPCAccountManager }` + add `MPCAccountManagerConfig` and `CreateAccountResult` to the type re-exports |
| `src/__tests__/mpcaccountmanager.test.ts` | CREATE | T1–T12 test scenarios; testnet tests guard-skipped with `process.env.NEAR_TREASURY_ACCOUNT` absent |
| `src/__tests__/mpc.test.ts` | NO CHANGE | Existing derivation-salt, yoctoNEAR, buildSignedTransaction tests must remain green |
| `src/__tests__/wallet.test.ts` | POSSIBLY MODIFY | Add test: `checkWalletAccess` with FunctionCall permission returns false (if not already covered) |
| `package.json` | MODIFY | `"version": "0.6.0"` → `"0.6.1"` |
| `CHANGELOG.md` | CREATE | First entry: v0.6.1 MPCAccountManager additive surface |
| `README.md` | MODIFY | Add `MPCAccountManager` section with derivation formula, config table, security expectations |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `vitest.config.ts` (globals: true, environment: node) |
| Quick run command | `nvm use 20 && npm test -- --reporter=verbose` |
| Full suite command | `nvm use 20 && npm test` |
| Baseline | 252 tests passing, 15 files, 1.44s — VERIFIED 2026-04-28 |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Scenario | Type | Automated Command | File |
|--------|----------|---------------|------|-------------------|------|
| MPC-01 | Class exported as runtime value | import { MPCAccountManager } is not undefined | unit | `npm test -- mpcaccountmanager` | mpcaccountmanager.test.ts — Wave 0 |
| MPC-02 | createAccount pure/deterministic | Same args → same nearAccountId | unit/mock | `npm test -- mpcaccountmanager` | mpcaccountmanager.test.ts |
| MPC-03 | Idempotency + no duplicate transfer | T2: second call returns onChain:true, 0 broadcast calls | unit/mock | same | same |
| MPC-04 | nearAccountId is 64-hex | T12: .toMatch(/^[a-f0-9]{64}$/) | unit | same | same |
| MPC-05 | FullAccess → true; FunctionCall → false; missing → false | T7/T8/T9/T10 matrix | unit/mock | same | same |
| MPC-06 | Concurrent calls converge | T11: 2 calls, 1 transfer (testnet) | integration | `NEAR_TREASURY_ACCOUNT=x npm test -- mpcaccountmanager` | mpcaccountmanager.test.ts |
| MPC-07 | derivationSalt required; different salts → different accounts | T4: distinct salt → distinct account | unit | `npm test -- mpcaccountmanager` | mpcaccountmanager.test.ts |
| MPC-08 | parseNearAmount conversion | Existing yoctoNEAR tests in mpc.test.ts | unit | `npm test -- mpc` | mpc.test.ts (EXISTING) |
| MPC-09 | treasuryPrivateKey never in logs | logging.test.ts source grep | unit | `npm test -- logging` | logging.test.ts (EXISTING) |
| MPC-10 | Error paths throw with cause | T5/T6: RPC failure throws; underfunded throws | unit/mock | `npm test -- mpcaccountmanager` | mpcaccountmanager.test.ts |
| MPC-11 | All 12 T scenarios pass | T1–T12 | unit/integration | `npm test` | mpcaccountmanager.test.ts |
| MPC-12 | publish succeeds at v0.6.1 | `npm run build` succeeds; version in package.json | build | `npm run build && npm run typecheck` | — |

### T1–T12 Scenario Breakdown

| Scenario | Type | Mock Strategy | Testnet? |
|----------|------|--------------|----------|
| T1: first call provisions | integration | real testnet (env-guarded) | YES |
| T2: second call short-circuits | integration | real testnet (env-guarded) | YES |
| T3: distinct userId → distinct account | unit | stub fetch→UNKNOWN_ACCOUNT | NO |
| T4: distinct salt → distinct account | unit | stub fetch→UNKNOWN_ACCOUNT | NO |
| T5: RPC fetch throws (network error) | unit | `fetch` rejects | NO |
| T6: treasury underfunded error | unit | broadcast returns underfunded error text | NO |
| T7: full-access key → true | integration | real testnet (env-guarded) | YES |
| T8: function-call-only key → false | unit | stub view_access_key with FunctionCall permission | NO |
| T9: missing/deleted account → false | unit | stub view_access_key with UNKNOWN_ACCOUNT error | NO |
| T10: unrelated key → false | unit | stub view_access_key with UNKNOWN_ACCESS_KEY error | NO |
| T11: concurrent calls converge | integration | real testnet (env-guarded) | YES |
| T12: hex format assertion | unit | stub fetch→UNKNOWN_ACCOUNT; check regex | NO |

**Testnet guard pattern:**
```typescript
const HAVE_TESTNET = !!(process.env.NEAR_TREASURY_ACCOUNT && process.env.NEAR_TREASURY_KEY);

describe.skipIf(!HAVE_TESTNET)('T1: first call provisions (testnet integration)', () => {
  it('creates account and returns onChain:true', async () => {
    const manager = new MPCAccountManager({
      networkId: 'testnet',
      treasuryAccount: process.env.NEAR_TREASURY_ACCOUNT!,
      treasuryPrivateKey: process.env.NEAR_TREASURY_KEY!,
      derivationSalt: 'phase10-test-salt',
    });
    const result = await manager.createAccount(`test-user-${Date.now()}`);
    expect(result.onChain).toBe(true);
    expect(result.nearAccountId).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

### Sampling Rate

- **Per task commit:** `nvm use 20 && npm test` (full suite, 252+N tests, ~2s)
- **Per wave merge:** `nvm use 20 && npm run build && npm run typecheck && npm test`
- **Phase gate:** All green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/__tests__/mpcaccountmanager.test.ts` — covers T1–T12 (MPC-11)
- [ ] `CHANGELOG.md` — covers MPC-12

*(Existing test infrastructure and vitest config require no changes)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `parseNearAmount` rejects null/invalid amounts; `derivationSalt` required at type level |
| V6 Cryptography | yes | SHA-256 for derivation; ed25519 via nacl (existing pattern); no hand-rolled crypto |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Treasury private key in logs | Information Disclosure | Pino redact paths + source-grep test in logging.test.ts |
| FunctionCall key treated as FullAccess | Elevation of Privilege | MPC-05 fix: check `permission === 'FullAccess'` |
| Cross-tenant account collision via same salt | Spoofing | MPC-07: derivationSalt required; different salts → different SHA-256 seeds |
| Duplicate on-chain transfer (idempotency failure) | Tampering | MPC-03: view_account check + MPC-06 nonce-race retry |
| Consumer import resolves to undefined at runtime | Denial of Service | MPC-01: fix export type → export in index.ts |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `near-api-js` monolith | `@near-js/*` scoped packages | 2023–2024 ecosystem split | `parseNearAmount` is in `@near-js/utils`, not `near-api-js` |
| `export type { Class }` for value exports | `export { Class }` | TypeScript 3.8+ | Using `export type` on a class strips the constructor from compiled output |

**Deprecated/outdated:**
- `near-api-js` monolith: Project correctly uses `@near-js/utils`, `@near-js/keystores`, etc. Do not add `near-api-js` as a dependency. MPC-08's text mentioning "near-api-js" refers to the logical utility; use `@near-js/utils`.

---

## Open Questions

1. **Async KeyStore setKey vs synchronous KeyPair field**
   - What we know: `InMemoryKeyStore.setKey` is async; constructors cannot be async in TypeScript
   - What's unclear: Whether MPC-09 "a single KeyStore is constructed per instance" means literally `new InMemoryKeyStore()` or just "isolated key storage"
   - Recommendation: Store `KeyPair` object directly in private field (synchronous; satisfies key isolation intent); if planner needs literal InMemoryKeyStore, use a static async factory

2. **NEAR nonce-race error text for MPC-06**
   - What we know: NEAR RPC returns error objects with `data` and `message` fields on broadcast failure
   - What's unclear: Exact string that distinguishes nonce collision from other failures without real testnet testing
   - Recommendation: In the unit test for T11, mock the first broadcast call to fail with `{ error: { data: 'InvalidNonce: ...' } }` then mock view_account to return "exists"; in the testnet integration test, trigger concurrency by calling `Promise.all([createAccount, createAccount])`

3. **MPCAccountManagerConfig vs MPCConfig — internal constructor impact**
   - What we know: The existing `createAnonAuth` calls `createMPCManager(MPCConfig)` with optional `derivationSalt`
   - What's unclear: Whether to change the class constructor to accept `MPCAccountManagerConfig` (breaking for internal usage) or overload it
   - Recommendation: Keep `MPCConfig` as the constructor's internal parameter type; `MPCAccountManagerConfig` is a consumer-facing type alias. In index.ts, document that `MPCAccountManagerConfig` satisfies `MPCConfig`. Users can pass either.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js v20 | vitest, tsup | via nvm | 20.20.1 | nvm use 20 |
| @near-js/utils | parseNearAmount (MPC-08) | YES | 2.5.1 | — |
| @near-js/keystores | InMemoryKeyStore (MPC-09) | YES | 2.5.1 | — |
| @near-js/types | AccessKeyViewRaw shape | YES | 2.5.1 | — |
| NEAR testnet treasury | T1, T2, T7, T11 integration tests | UNKNOWN | — | Skip via describe.skipIf(!HAVE_TESTNET) |
| npm registry | npm publish (MPC-12) | YES | — | — |

**Missing dependencies with no fallback:**
- Testnet treasury credentials (NEAR_TREASURY_ACCOUNT + NEAR_TREASURY_KEY env vars) — integration tests T1/T2/T7/T11 require these; without them, tests are skipped but still pass (CI green)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `MPCAccountManagerConfig` is a consumer-facing type alias of `MPCConfig` with `derivationSalt` required; the existing class constructor signature does not need to change for internal `createAnonAuth` usage | Standard Stack / Pattern 2 | If internal callers break, we need to overload the constructor or use a union type |
| A2 | NEAR nonce-race broadcast error contains distinguishable text (e.g., "InvalidNonce") | Pattern 5 | If indistinguishable from underfunded errors, MPC-06 retry may trigger on wrong errors |
| A3 | Storing `KeyPair` object in a private field (vs literal `InMemoryKeyStore`) satisfies MPC-09 "single KeyStore per instance" intent | Pattern 7 | If requirement is literal, need static async factory — changes the constructor API |
| A4 | `verifyRecoveryWallet` throwing on RPC unreachable (fetch throws) satisfies MPC-10; returning false on UNKNOWN_ACCOUNT error satisfies "does not throw" for missing accounts | Code Examples | MPC-10 wording may intend stricter: all non-fetch errors return false |

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `src/server/mpc.ts`, `src/server/index.ts`, `src/server/recovery/wallet.ts` — [VERIFIED: Read tool]
- `node_modules/@near-js/types/lib/esm/provider/response.d.ts` — `AccessKeyViewRaw.permission` type shape — [VERIFIED: Read tool]
- `node_modules/@near-js/utils/lib/esm/index.js` — `parseNearAmount` implementation and output — [VERIFIED: node execution]
- `node_modules/@near-js/keystores/lib/esm/in_memory_key_store.d.ts` — `InMemoryKeyStore` API — [VERIFIED: Read tool]
- `dist/server/index.js` — confirmed MPCAccountManager absent from runtime exports — [VERIFIED: Read tool]
- `dist/server/index.d.ts` — confirmed MPCAccountManager present in type declarations — [VERIFIED: Read tool]
- `src/__tests__/mpc.test.ts`, `logging.test.ts`, `wallet.test.ts` — test patterns and constraints — [VERIFIED: Read tool]
- vitest run (252 tests, 15 files, all green, 2026-04-28) — [VERIFIED: Bash]
- `package.json` — dependency versions — [VERIFIED: Read tool]
- `.planning/REQUIREMENTS.md` — MPC-01 through MPC-12 definitions — [VERIFIED: Read tool]
- `.planning/ROADMAP.md` — Phase 10 goal, success criteria, T1–T12 spec — [VERIFIED: Read tool]

### Secondary (MEDIUM confidence)
- NEAR RPC error shapes (UNKNOWN_ACCOUNT, UNKNOWN_ACCESS_KEY, InvalidNonce) — inferred from existing test mocks in `db-integrity.test.ts` and `wallet.test.ts` — [CITED: codebase]

### Tertiary (LOW confidence)
- NEAR nonce-race error text ("InvalidNonce") — [ASSUMED] based on NEAR protocol documentation patterns; not confirmed against live RPC

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in node_modules at stated versions
- Architecture: HIGH — class, methods, and existing RPC patterns all verified by direct inspection
- Pitfalls: HIGH — root cause (type-only export) confirmed by dist inspection; permission-check gap confirmed by source inspection
- Test strategy: HIGH — vitest patterns match existing test files exactly

**Research date:** 2026-04-28
**Valid until:** 2026-05-28 (stable domain; @near-js/* version changes would require re-check)
