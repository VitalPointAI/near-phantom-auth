# Phase 10: MPCAccountManager - Pattern Map

**Mapped:** 2026-04-28
**Files analyzed:** 7 (3 MODIFY, 1 CREATE, 1 POSSIBLY MODIFY, 1 CREATE docs, 1 MODIFY docs)
**Analogs found:** 7 / 7

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/server/mpc.ts` | service / class | request-response + CRUD | `src/server/mpc.ts` (self) | exact — modify in place |
| `src/server/recovery/wallet.ts` | utility / function | request-response | `src/server/recovery/wallet.ts` (self) | exact — surgical fix |
| `src/server/index.ts` | config / barrel | — | `src/server/index.ts` (self) | exact — one-line change |
| `src/__tests__/mpcaccountmanager.test.ts` | test | request-response + event-driven | `src/__tests__/mpc.test.ts` | exact role+flow match |
| `src/__tests__/wallet.test.ts` | test | request-response | `src/__tests__/wallet.test.ts` (self) | exact — add describe block |
| `CHANGELOG.md` | config / docs | — | none | no analog |
| `README.md` | docs | — | `README.md` (self) | exact — append section |

---

## Pattern Assignments

### `src/server/index.ts` (barrel, export fix)

**Analog:** `src/server/index.ts` itself (lines 260-264)

**Current broken export** (line 260):
```typescript
export type { MPCAccountManager, MPCConfig, MPCAccount } from './mpc.js';
```

**Fixed export pattern** — replace line 260 with two lines:
```typescript
export { MPCAccountManager } from './mpc.js';
export type { MPCAccountManagerConfig, CreateAccountResult, MPCConfig, MPCAccount } from './mpc.js';
```

**Surrounding value-export style to copy** (lines 241-243 and 264-268):
```typescript
// Value exports use bare `export { Name }` — no `type` modifier
export { createCleanupScheduler, type CleanupScheduler } from './cleanup.js';
export { generateCodename, isValidCodename } from './codename.js';
export { createPostgresAdapter, POSTGRES_SCHEMA } from './db/adapters/postgres.js';
export { createOAuthManager } from './oauth/index.js';
export { createOAuthRouter } from './oauth/router.js';
```

**Type-only export style to copy** (lines 244-263):
```typescript
// Type-only exports use `export type { ... }`
export type {
  AnonAuthConfig,
  DatabaseAdapter,
  ...
} from '../types/index.js';
export type { SessionManager, SessionConfig } from './session.js';
export type { PasskeyManager, PasskeyConfig } from './passkey.js';
// MPCAccountManager must NOT be in this block — it must be a value export
export type { MPCConfig, MPCAccount } from './mpc.js';
```

---

### `src/server/mpc.ts` (service class, MODIFY)

**Analog:** `src/server/mpc.ts` itself — read in full above.

#### New type aliases to add after `MPCConfig` (after line 34)

**Pattern from RESEARCH.md Pattern 2:**
```typescript
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

#### parseNearAmount migration (MPC-08) — replace lines 176-179

**Before** (lines 176-179):
```typescript
const [whole, fraction = ''] = amountNear.split('.');
const paddedFraction = fraction.padEnd(24, '0').slice(0, 24);
const yoctoStr = (whole + paddedFraction).replace(/^0+/, '') || '0';
const amountYocto = BigInt(new BN(yoctoStr).toString());
```

**After:**
```typescript
import { parseNearAmount } from '@near-js/utils';
// ...
const yoctoStr = parseNearAmount(amountNear);
if (!yoctoStr) throw new Error(`Invalid NEAR amount: ${amountNear}`);
const amountYocto = BigInt(yoctoStr);
```

#### KeyPair field instead of raw string (MPC-09) — replace private field and constructor

**Before** (lines 346-359):
```typescript
private treasuryPrivateKey?: string;
// ...
this.treasuryPrivateKey = config.treasuryPrivateKey;
```

**After** — private field and constructor change:
```typescript
private keyPair: KeyPair | undefined;  // replaces private treasuryPrivateKey: string

constructor(config: MPCConfig) {
  // ...
  if (config.treasuryPrivateKey) {
    this.keyPair = KeyPair.fromString(config.treasuryPrivateKey as `ed25519:${string}`);
    // raw string is not retained as a field
  }
  this.log = (config.logger ?? pino({ level: 'silent' })).child({ module: 'mpc' });
}
```

**Existing KeyPair.fromString usage to copy** (lines 469-470 — addRecoveryWallet already does this):
```typescript
const keyPair = KeyPair.fromString(this.treasuryPrivateKey as `ed25519:${string}`);
const signer = new KeyPairSigner(keyPair);
```

#### createAccount error-throwing rewrite (MPC-10) — replace lines 406-442

**Before** (lines 406-442 — logs warn and returns degraded object on fund failure):
```typescript
if (fundResult.success) {
  this.log.info({ txHash: fundResult.txHash }, 'Account funded');
  onChain = true;
} else {
  this.log.warn({ err: new Error(fundResult.error) }, 'Funding failed, account will be dormant');
}
// ...
} catch (error) {
  this.log.error({ err: error }, 'Mainnet implicit account creation failed');
  return { nearAccountId, derivationPath, mpcPublicKey: 'creation-failed', onChain: false };
}
```

**After — throw pattern from RESEARCH.md Pattern 4:**
```typescript
if (fundResult.success) {
  this.log.info({ txHash: fundResult.txHash }, 'Account funded');
  return { nearAccountId: implicitAccountId, derivationPath, mpcPublicKey: publicKey, onChain: true };
}

// MPC-06: Concurrent-call convergence — retry view_account once on nonce race
if (isLikelyNonceRace(fundResult.error)) {
  const existsNow = await accountExists(implicitAccountId, this.networkId);
  if (existsNow) {
    this.log.info({ accountId: implicitAccountId }, 'Concurrent provisioning; account now exists');
    return { nearAccountId: implicitAccountId, derivationPath, mpcPublicKey: publicKey, onChain: true };
  }
}

// MPC-10: classify error and throw
if (isRpcUnreachable(fundResult.error)) {
  throw new Error('RPC unreachable', { cause: new Error(fundResult.error) });
}
if (isTreasuryUnderfunded(fundResult.error)) {
  throw new Error('Treasury underfunded', { cause: new Error(fundResult.error) });
}
throw new Error('Transfer failed', { cause: new Error(fundResult.error) });
```

**Helper predicates to add (private or module-level functions):**
```typescript
function isLikelyNonceRace(error?: string): boolean {
  return !!error && /InvalidNonce|nonce/i.test(error);
}
function isRpcUnreachable(error?: string): boolean {
  return !!error && /unreachable|ECONNREFUSED|fetch/i.test(error);
}
function isTreasuryUnderfunded(error?: string): boolean {
  return !!error && /not have enough funds|insufficient/i.test(error);
}
```

**Logging convention in this file** (lines 373, 391, 419 — always `this.log.*`, never `console.*`):
```typescript
this.log.info({ nearAccountId, network: this.networkId }, 'Creating NEAR account');
this.log.info({ accountId: implicitAccountId, network: this.networkId }, 'Created implicit account');
this.log.info({ txHash: fundResult.txHash }, 'Account funded');
// NEVER: console.log / console.error / console.warn
```

**Treasury key safety rule enforced by logging.test.ts** (line 68-74 of logging.test.ts):
```typescript
// grep pattern that must find ZERO matches in log.* calls in mpc.ts:
it('treasuryPrivateKey never appears in log.* calls in mpc.ts', () => {
  const logCalls = source.match(/log\.(info|warn|error|debug)\([^)]+\)/g) || [];
  for (const call of logCalls) {
    expect(call).not.toContain('treasuryPrivateKey');
  }
});
// Also: derivationPath and mpcPublicKey must not appear in log calls (lines 76-89)
```

#### fundAccountFromTreasury signature change (MPC-09)

The function currently takes `treasuryPrivateKey: string` (line 108). After MPC-09, the class holds `this.keyPair: KeyPair | undefined` instead. Two options that preserve the existing internal function signature:

Option A — pass `keyPair.toString()` into the existing function (no signature change needed).
Option B — change the function parameter to `keyPair: KeyPair` and remove the internal `KeyPair.fromString(...)` call.

**Option B is cleaner. Existing KeyPair usage pattern in addRecoveryWallet** (lines 469-471):
```typescript
const keyPair = KeyPair.fromString(this.treasuryPrivateKey as `ed25519:${string}`);
const signer = new KeyPairSigner(keyPair);
const signerPublicKey = await signer.getPublicKey();
```

---

### `src/server/recovery/wallet.ts` (utility, MODIFY — MPC-05)

**Analog:** `src/server/recovery/wallet.ts` itself (lines 84-115).

**Current broken check** (lines 110-111):
```typescript
const result = await response.json() as { error?: unknown };
return !result.error;
```

**Fixed check — copy @near-js/types AccessKeyViewRaw shape:**
```typescript
const result = await response.json() as {
  result?: { permission: 'FullAccess' | { FunctionCall: unknown } };
  error?: unknown;
};
// error = UNKNOWN_ACCESS_KEY (key absent) or UNKNOWN_ACCOUNT (deleted) → false
if (result.error || !result.result) return false;
// FunctionCall keys → false (MPC-05)
return result.result.permission === 'FullAccess';
```

**Note:** The outer try/catch at lines 89-114 already swallows thrown errors and returns `false`, which satisfies MPC-10 ("swallow account-not-found, only re-throw if RPC unreachable"). The `fetch` throw path is inside the catch and returns `false` — this is existing behavior.

However RESEARCH.md Pattern 4 says `verifyRecoveryWallet` should **re-throw** when `fetch()` itself throws (RPC unreachable). The current `checkWalletAccess` swallows all exceptions. After MPC-10, the wrapper in `mpc.ts` at line 578-583 must be updated to not swallow:

**Before** (lines 574-583 of mpc.ts):
```typescript
async verifyRecoveryWallet(nearAccountId, recoveryWalletPublicKey) {
  try {
    return await checkWalletAccess(nearAccountId, recoveryWalletPublicKey, this.networkId);
  } catch {
    this.log.error({ nearAccountId }, 'Recovery wallet verification failed');
    return false;
  }
}
```

**After** — `checkWalletAccess` itself must distinguish fetch-throw from result-error:
```typescript
// In checkWalletAccess (wallet.ts): let fetch() throws propagate up
export async function checkWalletAccess(...): Promise<boolean> {
  // Note: NO try/catch around the fetch call itself
  // fetch() throw → propagates to caller (RPC unreachable)
  const response = await fetch(rpcUrl, { ... });
  const result = await response.json() as { result?: ...; error?: unknown };
  if (result.error || !result.result) return false;
  return result.result.permission === 'FullAccess';
}

// In mpc.ts verifyRecoveryWallet: only swallow non-fetch errors
async verifyRecoveryWallet(nearAccountId, recoveryWalletPublicKey) {
  // fetch() throws (RPC unreachable) → re-throw (MPC-10)
  return await checkWalletAccess(nearAccountId, recoveryWalletPublicKey, this.networkId);
}
```

---

### `src/__tests__/mpcaccountmanager.test.ts` (test, CREATE)

**Primary analog:** `src/__tests__/mpc.test.ts` — same describe/it/vi.stubGlobal pattern.
**Secondary analog:** `src/__tests__/wallet.test.ts` — same fetch-mock + afterEach(vi.unstubAllGlobals) pattern.

#### File header and imports (copy from mpc.test.ts lines 1-14):
```typescript
/**
 * MPCAccountManager Tests — T1–T12
 *
 * MPC-01: runtime value export check
 * MPC-02/04: deterministic derivation + hex format
 * MPC-03: idempotency
 * MPC-05: FullAccess permission check
 * MPC-06: concurrent-call convergence
 * MPC-07: derivationSalt required
 * MPC-10: error-throwing paths
 * MPC-11: all T scenarios pass
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MPCAccountManager } from '../server/mpc.js';
import type { MPCAccountManagerConfig } from '../server/mpc.js';
```

#### vi.stubGlobal('fetch') pattern (copy from mpc.test.ts lines 146-150):
```typescript
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }),
  }));
});
afterEach(() => vi.unstubAllGlobals());
```

#### Multi-method fetch dispatch pattern (copy from mpc.test.ts lines 218-240):
```typescript
vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
  const body = JSON.parse(opts.body as string);
  if (body.method === 'query' && body.params.request_type === 'view_account') {
    return Promise.resolve({
      ok: true,
      json: async () => ({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }),
    });
  }
  if (body.method === 'query' && body.params.request_type === 'view_access_key') {
    return Promise.resolve({
      ok: true,
      json: async () => ({ result: { nonce: 100, block_hash: 'GJ2rnFKjZpx4j2QDXdLXMBRbdqr9vEWMcYnL2CrPxU5' } }),
    });
  }
  if (body.method === 'broadcast_tx_commit') {
    return Promise.resolve({
      ok: true,
      json: async () => ({ result: { transaction: { hash: 'txhash123' } } }),
    });
  }
  return Promise.resolve({ ok: true, json: async () => ({}) });
}));
```

#### testnet guard pattern (copy from RESEARCH.md Validation Architecture):
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

#### MPC-01 runtime export check (new pattern — no existing analog, use this):
```typescript
describe('MPC-01: MPCAccountManager is a runtime value (not type-erased)', () => {
  it('import resolves to a class constructor', () => {
    expect(MPCAccountManager).toBeDefined();
    expect(typeof MPCAccountManager).toBe('function');
  });

  it('can be instantiated without throwing', () => {
    expect(() => new MPCAccountManager({
      networkId: 'testnet',
      derivationSalt: 'test-salt',
    })).not.toThrow();
  });
});
```

#### describe block naming convention (copy from mpc.test.ts and wallet.test.ts):
```typescript
// Pattern: 'Behavior — TICKET-ID' or 'T{N}: short description'
describe('derivation salt - SEC-04', () => { ... });     // mpc.test.ts style
describe('checkWalletAccess', () => { ... });             // wallet.test.ts style
// For this file use T-number style:
describe('T3: distinct userId → distinct account', () => { ... });
describe('T5: RPC fetch throws → createAccount throws', () => { ... });
```

#### Error assertion pattern for throw tests (MPC-10):
```typescript
// vitest toThrow pattern — use rejects.toThrow for async
it('T5: throws when RPC is unreachable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
  const manager = new MPCAccountManager({
    networkId: 'testnet',
    treasuryAccount: 'treasury.testnet',
    treasuryPrivateKey: 'ed25519:somekeyhere',
    derivationSalt: 'test-salt',
  });
  await expect(manager.createAccount('user-alice')).rejects.toThrow('RPC unreachable');
});
```

#### Fetch call count assertion (copy from mpc.test.ts lines 278-289):
```typescript
const fetchMock = vi.mocked(global.fetch);
const broadcastCall = fetchMock.mock.calls.find(([, opts]) => {
  try {
    const body = JSON.parse((opts as RequestInit).body as string);
    return body.method === 'broadcast_tx_commit';
  } catch {
    return false;
  }
});
expect(broadcastCall).toBeDefined();
// For idempotency (T2/T3): assert broadcastCall is undefined (no transfer call)
expect(broadcastCall).toBeUndefined();
```

---

### `src/__tests__/wallet.test.ts` (test, POSSIBLY MODIFY — MPC-05)

**Analog:** `src/__tests__/wallet.test.ts` itself — the existing `checkWalletAccess` describe block (lines 139-194).

**New describe block to append after line 194:**
```typescript
describe('checkWalletAccess — MPC-05: FullAccess permission gate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns false for FunctionCall-only permission (not FullAccess)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        result: {
          nonce: 5,
          permission: { FunctionCall: { allowance: '1000000000', receiver_id: 'app.testnet', method_names: [] } },
          block_height: 1,
        },
      }),
    }));

    const result = await checkWalletAccess('alice.testnet', 'ed25519:someKey', 'testnet');
    expect(result).toBe(false);
  });

  it('still returns true for FullAccess permission (existing behavior preserved)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        result: { nonce: 0, permission: 'FullAccess', block_height: 1 },
      }),
    }));

    const result = await checkWalletAccess('alice.testnet', 'ed25519:someKey', 'testnet');
    expect(result).toBe(true);
  });
});
```

---

## Shared Patterns

### Pino logger construction (apply to mpc.ts constructor)

**Source:** `src/server/mpc.ts` line 359; `src/server/recovery/wallet.ts` lines 15 and 152.

```typescript
// Constructor: accept optional logger, child it with module name
this.log = (config.logger ?? pino({ level: 'silent' })).child({ module: 'mpc' });

// Standalone function: module-level silent logger
const _log = pino({ level: 'silent' }).child({ module: 'wallet-recovery' });
```

**Redaction path to add for MPC-09** (add to the pino() call when no logger is provided):
```typescript
this.log = (config.logger ?? pino({ level: 'silent', redact: ['config.treasuryPrivateKey'] }))
  .child({ module: 'mpc' });
```

### Fetch mock teardown (apply to all describe blocks that stub fetch)

**Source:** `src/__tests__/mpc.test.ts` line 243; `src/__tests__/wallet.test.ts` line 140.

```typescript
afterEach(() => vi.unstubAllGlobals());
```

### RPC JSON-RPC request body shape (apply to any new fetch calls)

**Source:** `src/server/mpc.ts` lines 71-85 (accountExists), lines 142-156 (access key query).

```typescript
body: JSON.stringify({
  jsonrpc: '2.0',
  id: 'descriptive-id-string',   // unique per call type
  method: 'query',
  params: {
    request_type: 'view_account' | 'view_access_key',
    finality: 'final',
    account_id: accountId,
    // + public_key for view_access_key
  },
}),
```

### console.* prohibition (apply to all src/server/ files)

**Source:** `src/__tests__/logging.test.ts` lines 47-55.

The test greps `src/server/**/*.ts` and expects zero `console.` matches. Any new code in `src/server/` must use `this.log.*` or `_log.*` only. This test runs on every `npm test` invocation.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `CHANGELOG.md` | docs | — | No CHANGELOG exists in the repo; create from scratch with standard Keep A Changelog format |

---

## Key Observations for Planner

1. **The export fix is a one-line change on line 260 of `src/server/index.ts`:** `export type { MPCAccountManager, ... }` → `export { MPCAccountManager } from './mpc.js';` + a new `export type` line for the two new type aliases.

2. **`mpc.test.ts` must stay green:** The SEC-04 derivation salt tests (lines 142-203) call `createAccount` with no treasury configured. After the MPC-10 throw change, the no-treasury path must still return `{ onChain: false }` (not throw). Only the treasury-funded failure path throws.

3. **`logging.test.ts` source-grep has three enforced patterns:** `treasuryPrivateKey`, `derivationPath`, and `mpcPublicKey` must never appear inside `log.*()` call arguments in `mpc.ts`. These are checked line-by-line via regex, not by running the code.

4. **`vi.unstubAllGlobals()` in afterEach is mandatory:** Every describe block that calls `vi.stubGlobal('fetch', ...)` must have this teardown; see mpc.test.ts line 243 and wallet.test.ts line 140.

5. **`describe.skipIf(!HAVE_TESTNET)` is the guard for integration tests:** Unit tests (T3, T4, T5, T6, T8, T9, T10, T12) use stubbed fetch and always run. Testnet tests (T1, T2, T7, T11) are inside `describe.skipIf(!HAVE_TESTNET)` blocks and are skipped in CI without treasury env vars.

---

## Metadata

**Analog search scope:** `src/server/`, `src/__tests__/`, `vitest.config.ts`
**Files scanned:** 9 source files read in full
**Pattern extraction date:** 2026-04-28
