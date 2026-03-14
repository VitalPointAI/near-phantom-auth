# Phase 5: DB Integrity and Functional Stubs - Research

**Researched:** 2026-03-14
**Domain:** Database transactions (pg), NEAR borsh AddKey transaction signing, passkey re-registration, account deletion
**Confidence:** HIGH

## Summary

Phase 5 addresses five requirements across two distinct problem spaces. The first is database atomicity: the registration flow in `router.ts` (`/register/finish`) currently creates a user row, a passkey row, and a session row in three separate `await db.*` calls with no transaction wrapper — any failure after the first insert leaves orphaned rows. The second is three stub implementations: `addRecoveryWallet()` returns a `pending-${Date.now()}` placeholder, `verifyRecoveryWallet()` checks only for the presence of any key (not the specific recovery wallet's key), and no passkey re-registration or account deletion endpoints exist.

The PostgreSQL adapter (`createPostgresAdapter`) already uses `pool.connect()` / `BEGIN` / `COMMIT` / `ROLLBACK` for `createOAuthUser`. The same pattern must be applied to the registration finish flow. The key design decision flagged in STATE.md — whether `DatabaseAdapter.transaction()` absent is a hard error or a no-op fallback — must be resolved before implementing INFRA-02. The project decision was "make new `DatabaseAdapter` methods optional with internal fallbacks," so adding an optional `transaction?()` method to `DatabaseAdapter` and falling back to sequential calls is the locked approach.

For STUB-01, the `@near-js/transactions` and `@near-js/signers` packages are already installed (v2.5.1) and provide `createTransaction`, `addKey`, `fullAccessKey`, `encodeTransaction`, `KeyPairSigner`, `SignedTransaction`, and `Signature` — the full borsh serialization toolchain. The existing hand-rolled borsh code for Transfer transactions can serve as a reference for understanding the format, but the new AddKey transaction should use `@near-js` packages to avoid hand-rolling complex permission serialization. For BUG-04, `verifyRecoveryWallet()` must look up the specific public key using `view_access_key` RPC (already implemented in `wallet.ts` as `checkWalletAccess`), not `view_access_key_list`. The fix requires threading the recovery wallet's public key (stored as `walletId` in `db.storeRecoveryData`) through to the verification call.

**Primary recommendation:** Add `transaction?()` to `DatabaseAdapter` as an optional method, implement it in the postgres adapter using `pool.connect()` pattern already in use, wrap `register/finish` in that transaction, implement AddKey via `@near-js/transactions`+`@near-js/signers`, fix `verifyRecoveryWallet` to use `view_access_key` with the specific key, and add two new Express routes (`POST /account/reregister-passkey` and `DELETE /account`).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-02 | Registration flow wrapped in database transaction (no partial user creation) | `createOAuthUser` in postgres adapter already shows the `BEGIN`/`COMMIT`/`ROLLBACK` pattern; must be lifted to the router layer via an optional `DatabaseAdapter.transaction()` method |
| BUG-04 | `verifyRecoveryWallet()` checks specific wallet public key against access key list | `view_access_key` RPC with `account_id` + `public_key` params already exists in `wallet.ts:checkWalletAccess` — `verifyRecoveryWallet` just uses the wrong RPC method (`view_access_key_list`) and doesn't compare against a specific key |
| STUB-01 | `addRecoveryWallet()` implements real MPC signing for AddKey transaction | `@near-js/transactions` v2.5.1 (installed) has `createTransaction`, `addKey`, `fullAccessKey`; `@near-js/signers` has `KeyPairSigner.signTransaction`; pattern mirrors `fundAccountFromTreasury` but with AddKey action and the recovery wallet's public key |
| STUB-02 | Passkey re-registration endpoint exists for post-recovery users | New route `POST /account/reregister-passkey` calling `passkeyManager.startRegistration()` — requires active session; calls existing passkey infrastructure with no new DB methods needed |
| STUB-03 | Account deletion endpoint removes user row and all associated data | New route `DELETE /account` with cascade deletes; `anon_passkeys` and `anon_sessions` have `ON DELETE CASCADE` on `user_id`; `anon_recovery` does not — must be explicit; `anon_users` row delete suffices for passkeys and sessions but recovery needs explicit delete or schema migration |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@near-js/transactions` | ^2.5.1 (installed) | Borsh-serialize NEAR transactions including AddKey | Official NEAR JS SDK; handles schema complexity including permission enums |
| `@near-js/signers` | ^2.5.1 (installed) | Sign transactions via `KeyPairSigner.signTransaction` | Official; uses `@noble/hashes/sha256` + NEAR key pairs correctly |
| `@near-js/crypto` | ^2.5.1 (installed) | `PublicKey.fromString('ed25519:...')`, `KeyPair.fromString` | Official; correct enum construction for borsh |
| `pg` | peer dep (consumer installs) | PostgreSQL client; `pool.connect()` for transactions | Already in use; `client.query('BEGIN')` pattern proven in `createOAuthUser` |
| `vitest` | ^4.0.18 (installed) | Test framework; all existing tests use it | Project standard |

### No Additional Installs Required
All libraries needed for Phase 5 are already installed. No `npm install` needed.

## Architecture Patterns

### Recommended Project Structure
No new directories needed. Changes are:
```
src/
├── server/
│   ├── mpc.ts              # addRecoveryWallet + verifyRecoveryWallet fixes (STUB-01, BUG-04)
│   ├── router.ts           # INFRA-02 transaction wrap + STUB-02 + STUB-03 new routes
│   └── db/
│       └── adapters/
│           └── postgres.ts # Add transaction() method
src/
└── types/
    └── index.ts            # Add optional transaction() to DatabaseAdapter
src/
└── __tests__/
    └── db-integrity.test.ts  # New test file for this phase
```

### Pattern 1: Optional `transaction()` on DatabaseAdapter

The locked project decision: new `DatabaseAdapter` methods must be optional with internal fallbacks. The recommended approach is:

```typescript
// In src/types/index.ts — add to DatabaseAdapter
transaction?<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;
```

When `transaction()` is absent, the router falls back to sequential calls (existing behavior). When present (as in the postgres adapter), all operations run in a single DB transaction.

**PostgreSQL implementation:**
```typescript
// In postgres.ts — add to the returned adapter object
async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
  const p = await getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    // Build a transaction-scoped adapter that uses `client` instead of pool
    const txAdapter = buildTxAdapter(client); // see below
    const result = await fn(txAdapter);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

The `buildTxAdapter(client)` is a local helper that returns a partial `DatabaseAdapter` containing only the methods the registration flow needs (createUser, createPasskey, createSession), each using the same `client` reference instead of calling `getPool()`.

**Router usage (INFRA-02):**
```typescript
// In /register/finish handler, replace current sequential calls:
const doRegistration = async (adapter: DatabaseAdapter) => {
  const user = await adapter.createUser({ ... });
  await adapter.createPasskey({ ..., userId: user.id });
  const session = await adapter.createSession(user.id, res, { ... });
  return { user, session };
};

if (db.transaction) {
  await db.transaction(doRegistration);
} else {
  await doRegistration(db); // fallback: sequential, no atomicity
}
```

### Pattern 2: AddKey Transaction via @near-js packages (STUB-01)

The existing `fundAccountFromTreasury` hand-rolls borsh for a Transfer action. For AddKey, use the official SDK to avoid hand-rolling the complex AccessKey/Permission enum structure:

```typescript
// Source: @near-js/transactions lib/esm/action_creators.js + lib/esm/schema.js
import { createTransaction, addKey, fullAccessKey } from '@near-js/transactions';
import { KeyPairSigner } from '@near-js/signers';
import { PublicKey, KeyPair } from '@near-js/crypto';

async function addRecoveryWallet(
  nearAccountId: string,
  recoveryWalletPublicKey: string  // ed25519:BASE58 format
): Promise<{ success: boolean; txHash?: string }> {
  // 1. Get treasury key pair for signing
  const signerKeyPair = KeyPair.fromString(this.treasuryPrivateKey);
  const signer = new KeyPairSigner(signerKeyPair);
  const signerPublicKey = await signer.getPublicKey();

  // 2. Fetch nonce + block hash
  const { nonce, blockHash } = await getAccessKeyInfo(nearAccountId, signerPublicKey.toString(), this.networkId);

  // 3. Build AddKey action
  const recoveryPublicKey = PublicKey.fromString(recoveryWalletPublicKey);
  const action = addKey(recoveryPublicKey, fullAccessKey());

  // 4. Create and sign transaction
  const tx = createTransaction(
    nearAccountId,         // signerId
    signerPublicKey,       // signer's public key
    nearAccountId,         // receiverId (same account - adding key to self)
    nonce + 1n,
    [action],
    blockHash              // Uint8Array from bs58.decode(blockHashStr)
  );
  const [, signedTx] = await signer.signTransaction(tx);

  // 5. Encode and broadcast
  const encoded = Buffer.from(signedTx.encode()).toString('base64');
  const result = await broadcastTx(encoded, this.networkId);
  return { success: true, txHash: result.transaction.hash };
}
```

**Critical note:** `blockHash` must be a `Uint8Array` of the 32 raw bytes (bs58-decoded), not the base58 string itself. `signer.signTransaction` requires the transaction's `publicKey` field to exactly match the signer's key — the check `transaction.publicKey.toString() !== pk.toString()` is in the signer source and will throw if mismatched.

### Pattern 3: BUG-04 Fix — Specific Key Verification

The current `verifyRecoveryWallet()` uses `view_access_key_list` and returns `true` if any key exists. The fix uses `view_access_key` with the specific key:

```typescript
// The function wallet.ts:checkWalletAccess already does the right thing —
// it calls view_access_key with both account_id AND public_key.
// The bug is in MPCAccountManager.verifyRecoveryWallet which doesn't use it.

async verifyRecoveryWallet(
  nearAccountId: string,
  recoveryWalletPublicKey: string  // must be ed25519:BASE58 format
): Promise<boolean> {
  return checkWalletAccess(nearAccountId, recoveryWalletPublicKey, this.networkId);
}
```

The problem is that the router currently calls `mpcManager.addRecoveryWallet(user.nearAccountId, walletAccountId)` where `walletAccountId` is a NEAR account name (e.g., `alice.near`), not a public key. But `verifyRecoveryWallet` needs a public key to check. The fix requires storing the recovery wallet's **public key** (not just `'enabled'`) in `anon_recovery.reference`.

### Pattern 4: Passkey Re-Registration Route (STUB-02)

```typescript
// POST /account/reregister-passkey
router.post('/account/reregister-passkey', authLimiter, async (req, res) => {
  const session = await sessionManager.getSession(req);
  if (!session) return res.status(401).json({ error: 'Authentication required' });

  const user = await db.getUserById(session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { challengeId, options } = await passkeyManager.startRegistration(
    user.id,
    user.codename
  );

  res.json({ challengeId, options });
});
```

Note: `startRegistration` already stores the challenge with `tempUserId` in metadata; for re-registration the user already exists. The `finishRegistration` path in the existing `POST /register/finish` handler can be reused or a dedicated finish endpoint added. The success criteria only requires "receive a new credential registration challenge" — so `start` only suffices for the STUB-02 test.

### Pattern 5: Account Deletion Route (STUB-03)

```typescript
// DELETE /account
router.delete('/account', authLimiter, async (req, res) => {
  const session = await sessionManager.getSession(req);
  if (!session) return res.status(401).json({ error: 'Authentication required' });

  const userId = session.userId;

  // Order matters: delete session first (invalidates auth), then cascade
  await sessionManager.destroySession(req, res);  // deletes session cookie + DB row
  await db.deleteUserSessions(userId);            // belt-and-suspenders on other sessions
  // Passkeys and sessions have ON DELETE CASCADE; recovery does not
  await db.deleteRecoveryData(userId);            // need new method or raw delete
  await db.deleteUser(userId);                    // triggers cascades for passkeys/sessions

  res.json({ success: true });
});
```

**CRITICAL schema finding:** `anon_passkeys` has `ON DELETE CASCADE` on `user_id`. `anon_sessions` does NOT have `ON DELETE CASCADE` (the FK references `user_id UUID NOT NULL` but no cascade clause in the schema). `anon_recovery` also has no cascade. This means `deleteUser` alone is insufficient — sessions and recovery data must be explicitly deleted first, or the schema must be migrated.

Actually re-reading the schema:
- `anon_passkeys.user_id` — `REFERENCES anon_users(id) ON DELETE CASCADE` ✓
- `anon_sessions` — has `user_id UUID NOT NULL` but NO foreign key constraint and NO `REFERENCES` clause — sessions are not FK-constrained to anon_users
- `anon_recovery` — has `user_id UUID NOT NULL` but NO foreign key constraint

This means deleting the `anon_users` row will NOT cascade to sessions or recovery. The deletion route must:
1. Delete all sessions for user
2. Delete all recovery data for user
3. Delete the user row (which cascades passkeys)

Two options for `deleteRecoveryData`:
- Add `deleteRecoveryData(userId: string): Promise<void>` to `DatabaseAdapter` (optional method with no-op fallback)
- Reuse existing `deleteUserSessions(userId)` which already exists, and add `deleteRecoveryData` the same way

### Anti-Patterns to Avoid

- **Using `view_access_key_list` for key verification:** Returns all keys; `true` if account has any key at all. Use `view_access_key` with the specific public key string.
- **Hand-rolling AddKey borsh serialization:** The AccessKey struct has nested permission enums (FullAccess vs FunctionCall) that are tricky. Use `@near-js/transactions`.
- **Catching and ignoring ROLLBACK errors:** Always let the original error propagate after rollback; ROLLBACK failures in the `catch` block should be logged but not swallowed.
- **Deleting user before sessions:** The cookie is still valid after user row deletion if session row persists. Destroy session first.
- **fullAccessKey vs functionCallAccessKey:** Recovery wallets with `fullAccessKey` can drain funds from the NEAR account. If the account holds no significant balance (newly funded implicit accounts with 0.01 NEAR), this is acceptable. For mainnet production, consider `functionCallAccessKey` restricted to a recovery contract. This phase should use `fullAccessKey` consistent with the existing recovery model.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AddKey borsh serialization | Custom byte packing for AccessKey/Permission enums | `@near-js/transactions`: `addKey`, `fullAccessKey`, `createTransaction`, `encodeTransaction` | AccessKey has nested optional permission enum; hand-rolling requires replicating all 7 action type variants |
| Transaction signing | Custom sha256 + nacl.sign | `@near-js/signers`: `KeyPairSigner.signTransaction` | Already handles `encodeTransaction` → sha256 → sign → `SignedTransaction` with correct `Signature` enum |
| Key format construction | Manual `{ ed25519Key: { data: bytes } }` objects | `PublicKey.fromString('ed25519:...')` from `@near-js/crypto` | Enum construction with keyType must match borsh schema exactly |
| PostgreSQL transaction scoping | New pool per transaction | `pool.connect()` → client scoped queries | Already proven pattern in `createOAuthUser` |

**Key insight:** The `@near-js` packages (already in `package.json` dependencies) were added precisely for this phase's MPC work. Using them for AddKey removes ~100 lines of fragile hand-written borsh.

## Common Pitfalls

### Pitfall 1: blockHash type mismatch
**What goes wrong:** `createTransaction` receives a base58 string instead of `Uint8Array` for `blockHash`; borsh serialization produces wrong bytes; RPC returns `InvalidTxError`.
**Why it happens:** RPC returns `blockHash` as a base58 string; `createTransaction` expects raw bytes.
**How to avoid:** `bs58.decode(blockHashStr)` before passing to `createTransaction`.
**Warning signs:** RPC returns `InvalidTxError: Transaction has expired` or hash mismatch errors.

### Pitfall 2: KeyPairSigner public key mismatch
**What goes wrong:** `signer.signTransaction(tx)` throws `"The public key doesn't match the signer's key"`.
**Why it happens:** The `publicKey` field in the `Transaction` object must exactly match what `signer.getPublicKey()` returns. If different key pair is used to fetch the nonce vs. sign, they diverge.
**How to avoid:** Call `signer.getPublicKey()` once, use the result for both the access key nonce fetch AND the `createTransaction` call.
**Warning signs:** Error thrown synchronously from `signTransaction`.

### Pitfall 3: Transaction executor is the signerId (not mpcManager target)
**What goes wrong:** `addRecoveryWallet` uses the treasury account as both signer AND receiver, but the intent is to add a key to the USER's NEAR account. The treasury doesn't have signing authority over the user's account.
**Why it happens:** The recovery wallet add-key conceptually works like: the user's account must sign a tx to add a recovery key to itself. But in this library's model, the user's account key is the treasury-derived key — so the treasury private key IS the signing authority for the user's implicit account.
**How to avoid:** The `signerId` AND `receiverId` in the AddKey transaction are BOTH the `nearAccountId` (user's implicit account). The treasury key signs on behalf of that account because the treasury funded it and holds the key. This matches the existing Transfer transaction pattern in `fundAccountFromTreasury`.
**Warning signs:** RPC returns `InvalidSignature` or `SignerNotFound`.

### Pitfall 4: Registration rollback must also clean up challenges
**What goes wrong:** A challenge is stored in `anon_challenges` before registration begins; if registration fails and is rolled back, the challenge row remains (it's created outside the transaction in `startRegistration`).
**Why it happens:** The challenge is stored in `/register/start`, the transaction wraps only `/register/finish` actions (createUser, createPasskey, createSession). `deleteChallenge` inside `finishRegistration` is part of the passkey manager, not the router transaction.
**How to avoid:** The challenge deletion in `passkey.ts:finishRegistration` happens before `createUser` is called (challenge is consumed immediately on verification). This is fine — expired/unused challenges are harmless and are cleaned up by `cleanExpiredSessions` equivalent. No special handling needed.
**Warning signs:** Not a real problem; orphaned challenge rows are harmless.

### Pitfall 5: anon_sessions has no FK constraint — cascade won't work
**What goes wrong:** Deleting `anon_users` row and expecting sessions to be gone via cascade; subsequent login attempt with deleted account's credentials returns 200 instead of 401.
**Why it happens:** The `anon_sessions` schema does NOT have `REFERENCES anon_users(id) ON DELETE CASCADE`. The `user_id` column is just a plain UUID.
**How to avoid:** Explicit `DELETE FROM anon_sessions WHERE user_id = $1` before `DELETE FROM anon_users WHERE id = $1`. Call `db.deleteUserSessions(userId)` which already exists.
**Warning signs:** Test shows post-deletion login returns 200 instead of 401.

### Pitfall 6: verifyRecoveryWallet needs the public key, not the account name
**What goes wrong:** `addRecoveryWallet` is called with `walletAccountId` (a NEAR account name like `alice.near`); `verifyRecoveryWallet` needs the PUBLIC KEY of that wallet to call `view_access_key`. These are different things.
**Why it happens:** Named NEAR accounts can have multiple keys; on-chain key lookup requires the specific public key, not just the account name.
**How to avoid:** During the `wallet/verify` flow, the wallet's signature already contains the public key (`signature.publicKey`). Store the PUBLIC KEY in `anon_recovery.reference`, not `'enabled'` or the wallet account name. Then `verifyRecoveryWallet` can use that stored public key.
**Warning signs:** `view_access_key` RPC call with an account name instead of `ed25519:...` format key returns an error; function always returns `false`.

## Code Examples

Verified patterns from official sources:

### AddKey Transaction (from @near-js/transactions source)
```typescript
// Source: node_modules/@near-js/transactions/lib/esm/action_creators.js
// Source: node_modules/@near-js/signers/lib/esm/key_pair_signer.js

import { createTransaction, addKey, fullAccessKey } from '@near-js/transactions';
import { KeyPairSigner } from '@near-js/signers';
import { PublicKey, KeyPair } from '@near-js/crypto';
import bs58 from 'bs58';

// Get access key info (nonce + block hash) via RPC
const accessKeyResult = await fetch(rpcUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 'get-access-key',
    method: 'query',
    params: {
      request_type: 'view_access_key',
      finality: 'final',
      account_id: nearAccountId,          // user's account
      public_key: signerPublicKeyStr,     // treasury public key (ed25519:...)
    },
  }),
});

// Build signer from treasury key
const keyPair = KeyPair.fromString(treasuryPrivateKey); // 'ed25519:BASE58'
const signer = new KeyPairSigner(keyPair);
const signerPublicKey = await signer.getPublicKey();    // PublicKey object

// Parse block hash: must be Uint8Array
const blockHashBytes = bs58.decode(accessKeyResult.result.block_hash);

// Build transaction
const recoveryPublicKey = PublicKey.fromString(walletPublicKey); // ed25519:BASE58
const tx = createTransaction(
  nearAccountId,           // signerId
  signerPublicKey,         // publicKey (must match signer)
  nearAccountId,           // receiverId (same account — adding key to self)
  BigInt(accessKeyResult.result.nonce + 1),
  [addKey(recoveryPublicKey, fullAccessKey())],
  blockHashBytes           // Uint8Array (NOT base58 string)
);

// Sign (internally: sha256(encodeTransaction(tx)) then signs)
const [, signedTx] = await signer.signTransaction(tx);

// Encode for broadcast
const encoded = Buffer.from(signedTx.encode()).toString('base64');
```

### PostgreSQL Transaction Wrapper
```typescript
// Source: existing pattern in src/server/db/adapters/postgres.ts:createOAuthUser
async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
  const p = await getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const txAdapter = buildClientAdapter(client); // subset adapter using client
    const result = await fn(txAdapter);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error; // always re-throw
  } finally {
    client.release(); // always release
  }
}
```

### view_access_key for specific key verification (BUG-04)
```typescript
// Source: wallet.ts:checkWalletAccess (already correct)
const response = await fetch(rpcUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 'check-access-key',
    method: 'query',
    params: {
      request_type: 'view_access_key',  // NOT view_access_key_list
      finality: 'final',
      account_id: nearAccountId,
      public_key: walletPublicKey,      // ed25519:BASE58 — specific key
    },
  }),
});
const result = await response.json();
return !result.error; // error means key not found; no error means key exists
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-roll borsh for Transfer | Use `@near-js/transactions` for AddKey | Phase 5 | Eliminates risk of enum/schema drift |
| `pending-${Date.now()}` stub | Real broadcast_tx_commit + txHash | Phase 5 | Verifiable on explorer |
| `view_access_key_list` + truthy check | `view_access_key` with specific key | Phase 5 | Correct verification per BUG-04 spec |
| No rollback on registration fail | `BEGIN`/`ROLLBACK`/`COMMIT` wrapping | Phase 5 | INFRA-02 satisfied |

**Deprecated/outdated:**
- `pending-${Date.now()}` txHash pattern in `addRecoveryWallet`: replaced with real RPC broadcast.
- `return !!result.result?.keys?.length` in `verifyRecoveryWallet`: replaced with `checkWalletAccess`.

## Open Questions

1. **Treasury key authority over user accounts**
   - What we know: `fundAccountFromTreasury` signs Transfer transactions from the treasury TO the user's account. But to sign an AddKey ON the user's account, the treasury needs a key WITH signing authority on that account.
   - What's unclear: When an implicit account is funded via Transfer, does the treasury key automatically have access-key authority on the implicit account? No — the implicit account is controlled by whoever holds the private key that matches the implicit account's public key (derived from the same seed). The treasury is the funder, not the key holder.
   - Recommendation: Verify whether the library's architecture allows the MPC manager to sign AddKey transactions. In the current implicit account creation (`createAccount`), the account's controlling key is derived from `sha256(derivationSalt + userId)` — the LIBRARY holds this key (via the same derivation). The treasury key is separate. The AddKey transaction must be signed with the ACCOUNT'S controlling key, not the treasury key. This requires using the derived key pair, not `treasuryPrivateKey`.

2. **`deleteRecoveryData` not in DatabaseAdapter**
   - What we know: The `DatabaseAdapter` interface has no `deleteRecoveryData(userId)` method.
   - What's unclear: Whether to add it as optional (consistent with project pattern) or just call it from the postgres adapter's `deleteUser` method.
   - Recommendation: Add optional `deleteRecoveryData?(userId: string): Promise<void>` to the interface. The account deletion route calls it explicitly before `deleteUser`.

3. **`deleteUser` not in DatabaseAdapter**
   - What we know: The `DatabaseAdapter` interface has no `deleteUser(userId)` method.
   - What's unclear: Same as above.
   - Recommendation: Add optional `deleteUser?(userId: string): Promise<void>`. If absent, the account deletion route cannot function and should return 501 Not Implemented.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | `/home/vitalpointai/projects/near-phantom-auth/vitest.config.ts` |
| Quick run command | `npx vitest run src/__tests__/db-integrity.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-02 | Registration finish failure after user creation leaves no orphaned rows | unit (mock db) | `npx vitest run src/__tests__/db-integrity.test.ts` | ❌ Wave 0 |
| BUG-04 | `verifyRecoveryWallet` returns false when key exists on account but doesn't match registered wallet key | unit (mock fetch) | `npx vitest run src/__tests__/db-integrity.test.ts` | ❌ Wave 0 |
| STUB-01 | `addRecoveryWallet()` returns txHash not matching `/^pending-/` | unit (mock fetch + RPC) | `npx vitest run src/__tests__/db-integrity.test.ts` | ❌ Wave 0 |
| STUB-02 | `/account/reregister-passkey` returns 200 with `challengeId` and `options` for authenticated user | integration (supertest) | `npx vitest run src/__tests__/db-integrity.test.ts` | ❌ Wave 0 |
| STUB-03 | `DELETE /account` removes user + passkeys + sessions; subsequent login returns 401 | integration (supertest) | `npx vitest run src/__tests__/db-integrity.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/__tests__/db-integrity.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/db-integrity.test.ts` — covers all 5 phase requirements (INFRA-02, BUG-04, STUB-01, STUB-02, STUB-03)

## Sources

### Primary (HIGH confidence)
- `node_modules/@near-js/transactions/lib/esm/` — action_creators, schema, create_transaction, signature verified by direct file read
- `node_modules/@near-js/signers/lib/esm/key_pair_signer.js` — `signTransaction` implementation verified by direct file read
- `node_modules/@near-js/crypto/lib/esm/public_key.js` — `PublicKey.fromString` verified by direct file read
- `src/server/db/adapters/postgres.ts` — `createOAuthUser` transaction pattern verified by direct file read
- `src/types/index.ts` — `DatabaseAdapter` interface verified by direct file read; missing deleteUser/deleteRecoveryData confirmed
- `src/server/mpc.ts` — stub implementations confirmed by direct file read
- `src/server/recovery/wallet.ts` — `checkWalletAccess` correct pattern confirmed by direct file read
- `src/server/router.ts` — registration flow steps (createUser → createPasskey → createSession) confirmed by direct file read

### Secondary (MEDIUM confidence)
- `anon_sessions` FK analysis: schema from `postgres.ts:POSTGRES_SCHEMA` — no `REFERENCES` clause on `anon_sessions.user_id` confirmed by direct file read (no cascade)

### Tertiary (LOW confidence)
- Treasury key authority over user accounts: reasoning from code structure; needs runtime validation on NEAR testnet before Phase 5 ships (flagged in STATE.md blockers)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed installed at correct versions
- Architecture patterns: HIGH — postgres transaction pattern copied from existing adapter; @near-js API verified in source
- Pitfalls: HIGH for DB/cascade issues (verified from schema); MEDIUM for NEAR key authority question (needs testnet validation)
- Open questions: documented — key authority question and missing DatabaseAdapter methods need resolution in Wave 0

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (NEAR JS SDK stable; @near-js/transactions 2.x API unlikely to change)
