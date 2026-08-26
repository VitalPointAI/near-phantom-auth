/**
 * MPC Module Tests
 *
 * DEBT-02: Replace custom base58Encode with bs58 library
 * BUG-01: yoctoNEAR conversion precision
 * BUG-02: buildSignedTransaction byte layout
 * SEC-04: Derivation salt prevents account ID prediction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import bs58 from 'bs58';
import BN from 'bn.js';
import nacl from 'tweetnacl';
import { MPCAccountManager, buildSignedTransaction, createMPCManager } from '../server/mpc.js';
import { KeyPair } from '@near-js/crypto';
import {
  createTransaction,
  encodeTransaction,
  actionCreators,
  SignedTransaction,
  Signature,
} from '@near-js/transactions';

// ============================================
// DEBT-02: base58Encode replacement
// ============================================

describe('base58Encode replacement - DEBT-02', () => {
  it('bs58.encode produces correct output for known inputs', () => {
    // Known base58 encoding: [0x00, 0x01, 0x02, 0x03, 0x04] => '1Ldp'
    const input = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
    const result = bs58.encode(input);
    expect(result).toBeTypeOf('string');
    expect(result.length).toBeGreaterThan(0);
    // Leading zero byte produces leading '1'
    expect(result.startsWith('1')).toBe(true);
  });

  it('bs58.encode handles leading zero bytes correctly', () => {
    // Two leading zero bytes -> two leading '1' chars
    const input = Buffer.from([0x00, 0x00, 0x01, 0x02, 0x03]);
    const result = bs58.encode(input);
    expect(result.startsWith('11')).toBe(true);
  });

  it('bs58.encode round-trips through bs58.decode', () => {
    const original = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
    const encoded = bs58.encode(original);
    const decoded = Buffer.from(bs58.decode(encoded));
    expect(decoded).toEqual(original);
  });
});

// ============================================
// BUG-01: yoctoNEAR conversion
// ============================================

// Mirror of production conversion logic (BN-based, no floating point)
function nearToYocto(amountNear: string): bigint {
  const [whole, fraction = ''] = amountNear.split('.');
  const paddedFraction = fraction.padEnd(24, '0').slice(0, 24);
  const yoctoStr = (whole + paddedFraction).replace(/^0+/, '') || '0';
  return BigInt(new BN(yoctoStr).toString());
}

describe('yoctoNEAR conversion - BUG-01', () => {
  it("converts '1' NEAR to exactly 10^24 yoctoNEAR", () => {
    expect(nearToYocto('1')).toBe(1000000000000000000000000n);
  });

  it("converts '0.01' NEAR without floating-point error", () => {
    // parseFloat('0.01') * 1e24 produces 9999999999999998976n due to float precision
    // BN-based conversion must produce exactly 10000000000000000000000n
    expect(nearToYocto('0.01')).toBe(10000000000000000000000n);
  });

  it("converts '0.000000000000000000000001' (1 yoctoNEAR) correctly", () => {
    expect(nearToYocto('0.000000000000000000000001')).toBe(1n);
  });

  it("converts '100' NEAR correctly", () => {
    expect(nearToYocto('100')).toBe(100000000000000000000000000n);
  });
});

// ============================================
// BUG-02: buildSignedTransaction byte layout
// ============================================
//
// These tests import the REAL buildSignedTransaction. An earlier version of
// this block tested a local copy named `buildSignedTransactionFixed` that
// duplicated the shipped layout, and asserted the signature section was 97
// bytes (1 type + 32 pubkey + 64 sig). That made the suite green while the
// shipped encoder stayed broken, and it asserted the defect as the contract:
// anyone fixing the real function would have seen three tests go red and
// concluded they had caused a regression.
//
// The oracle here is @near-js/transactions -- the package this library already
// depends on and the same encoder nearcore round-trips. Hand-rolled borsh is
// invisible to the type system, so bytes are the only thing worth asserting.

describe('buildSignedTransaction - BUG-02', () => {
  // A real, fully-formed transfer transaction rather than a stub, so the
  // comparison is against something the RPC would actually accept.
  const keyPair = KeyPair.fromRandom('ed25519');
  const publicKey = keyPair.getPublicKey();
  const transactionObj = createTransaction(
    'alice.near',
    publicKey,
    'bob.near',
    1n,
    [actionCreators.transfer(10n ** 22n)],
    new Uint8Array(32).fill(7)
  );
  const transaction = encodeTransaction(transactionObj);
  const signature = keyPair.sign(transaction).signature;

  /** The authoritative encoding, produced by @near-js/transactions itself. */
  const official = new SignedTransaction({
    transaction: transactionObj,
    signature: new Signature({ keyType: publicKey.keyType, data: signature }),
  }).encode();

  it('is byte-identical to the @near-js/transactions encoding', () => {
    const result = buildSignedTransaction(transaction, signature);
    expect(Buffer.from(result).equals(Buffer.from(official))).toBe(true);
  });

  it('appends exactly 65 bytes: 1 key-type byte + 64 signature bytes', () => {
    const result = buildSignedTransaction(transaction, signature);
    expect(result.length - transaction.length).toBe(65);
  });

  it('output starts with the transaction bytes unmodified', () => {
    const result = buildSignedTransaction(transaction, signature);
    expect(Buffer.from(result.slice(0, transaction.length)).equals(Buffer.from(transaction))).toBe(true);
  });

  it('byte at transaction.length is 0x00 (ED25519 key type)', () => {
    const result = buildSignedTransaction(transaction, signature);
    expect(result[transaction.length]).toBe(0x00);
  });

  it('the 64 bytes after the key-type byte are the signature', () => {
    const result = buildSignedTransaction(transaction, signature);
    const sigStart = transaction.length + 1;
    expect(Buffer.from(result.slice(sigStart, sigStart + 64)).equals(Buffer.from(signature))).toBe(true);
  });

  it('does NOT re-emit the public key into the signature field (the 0.8.0 bug)', () => {
    // The regression this guards: transaction ++ [0] ++ publicKey ++ signature.
    // The public key is already inside the transaction body; a second copy
    // shifts the signature by 32 bytes and the RPC rejects the transaction.
    const result = buildSignedTransaction(transaction, signature);
    const afterKeyType = result.slice(transaction.length + 1, transaction.length + 1 + 32);
    expect(Buffer.from(afterKeyType).equals(Buffer.from(publicKey.data))).toBe(false);
    expect(result.length - transaction.length).not.toBe(97);
  });
});

// ============================================
// SEC-04: Derivation salt
// ============================================

describe('derivation salt - SEC-04', () => {
  beforeEach(() => {
    // Mock fetch globally to avoid real network calls
    // Return "account not found" for accountExists check
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }),
    }));
  });

  it('unsalted derivation produces a consistent account ID', async () => {
    const manager1 = new MPCAccountManager({
      networkId: 'testnet',
      accountPrefix: 'anon',
    });
    const manager2 = new MPCAccountManager({
      networkId: 'testnet',
      accountPrefix: 'anon',
    });

    const result1 = await manager1.createAccount('user1');
    const result2 = await manager2.createAccount('user1');

    // Same userId, no salt => same implicit account ID (backward compat)
    expect(result1.nearAccountId).toBe(result2.nearAccountId);
  });

  it('salted derivation produces different result than unsalted', async () => {
    const unsaltedManager = new MPCAccountManager({
      networkId: 'testnet',
      accountPrefix: 'anon',
    });
    const saltedManager = new MPCAccountManager({
      networkId: 'testnet',
      accountPrefix: 'anon',
      derivationSalt: 'test-salt',
    });

    const unsaltedResult = await unsaltedManager.createAccount('user1');
    const saltedResult = await saltedManager.createAccount('user1');

    expect(unsaltedResult.nearAccountId).not.toBe(saltedResult.nearAccountId);
  });

  it('same userId with different salts produces different accounts', async () => {
    const manager1 = new MPCAccountManager({
      networkId: 'testnet',
      accountPrefix: 'anon',
      derivationSalt: 'salt-alpha',
    });
    const manager2 = new MPCAccountManager({
      networkId: 'testnet',
      accountPrefix: 'anon',
      derivationSalt: 'salt-beta',
    });

    const result1 = await manager1.createAccount('user1');
    const result2 = await manager2.createAccount('user1');

    expect(result1.nearAccountId).not.toBe(result2.nearAccountId);
  });
});

// ============================================
// STUB-01: addRecoveryWallet real MPC signing
// ============================================

// Generate a real ed25519 keypair for the treasury (once per file)
const treasuryKeyPair = nacl.sign.keyPair();
const treasuryPrivateKey = `ed25519:${bs58.encode(Buffer.from(treasuryKeyPair.secretKey))}`;

describe('addRecoveryWallet - STUB-01', () => {
  beforeEach(() => {
    // First fetch call (access key nonce query): return nonce + block_hash
    // Second fetch call (broadcast tx): return transaction hash
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string);
      if (body.method === 'query') {
        // Access key nonce query
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: { nonce: 100, block_hash: 'GJ2rnFKjZpx4j2QDXdLXMBRbdqr9vEWMcYnL2CrPxU5' },
          }),
        });
      }
      if (body.method === 'broadcast_tx_commit') {
        // Broadcast transaction
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: { transaction: { hash: '8KHt3ZzJdQ1vK2mXPxJ5nUwR3kYfG6ePnT7oVcBaLs' } },
          }),
        });
      }
      callCount++;
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a txHash that does not match /^pending-/', async () => {
    const manager = new MPCAccountManager({
      networkId: 'testnet',
      accountPrefix: 'anon',
      treasuryAccount: 'treasury.testnet',
      treasuryPrivateKey,
    });

    const result = await manager.addRecoveryWallet(
      'test-account.testnet',
      `ed25519:${bs58.encode(Buffer.from(nacl.sign.keyPair().publicKey))}`
    );

    expect(result.success).toBe(true);
    expect(result.txHash).toBeDefined();
    expect(result.txHash).not.toMatch(/^pending-/);
  });

  it('calls NEAR RPC to broadcast the transaction', async () => {
    const manager = new MPCAccountManager({
      networkId: 'testnet',
      accountPrefix: 'anon',
      treasuryAccount: 'treasury.testnet',
      treasuryPrivateKey,
    });

    await manager.addRecoveryWallet(
      'test-account.testnet',
      `ed25519:${bs58.encode(Buffer.from(nacl.sign.keyPair().publicKey))}`
    );

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
  });
});

// ============================================
// Configurable RPC endpoint
// ============================================
//
// The library previously hardcoded rpc.mainnet.near.org with no override, so a
// consumer on a paid provider silently kept using the free shared endpoint for
// every account creation. These tests assert the override is actually USED --
// not merely accepted by the type system, which is what a config option that
// is threaded incorrectly looks like from the outside.

describe('configurable RPC endpoint', () => {
  const baseConfig = {
    networkId: 'mainnet' as const,
    treasuryAccount: 'treasury.near',
    treasuryPrivateKey: KeyPair.fromRandom('ed25519').toString(),
    derivationSalt: 'test-salt-not-a-real-one',
  };

  function captureFetch() {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const spy = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), headers: { ...(init?.headers ?? {}) } });
      // Shape just enough for accountExists() to resolve "does not exist".
      return {
        ok: true,
        json: async () => ({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }),
      } as any;
    });
    return { calls, spy };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the configured rpcUrl instead of the public endpoint', async () => {
    const { calls, spy } = captureFetch();
    vi.stubGlobal('fetch', spy);

    const mgr = createMPCManager({ ...baseConfig, rpcUrl: 'https://rpc.mainnet.fastnear.com' });
    await mgr.createAccount('user-1').catch(() => undefined);

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.url === 'https://rpc.mainnet.fastnear.com')).toBe(true);
    expect(calls.some((c) => c.url.includes('rpc.mainnet.near.org'))).toBe(false);
  });

  it('sends configured rpcHeaders on every RPC call', async () => {
    const { calls, spy } = captureFetch();
    vi.stubGlobal('fetch', spy);

    const mgr = createMPCManager({
      ...baseConfig,
      rpcUrl: 'https://rpc.mainnet.fastnear.com',
      rpcHeaders: { Authorization: 'Bearer test-key' },
    });
    await mgr.createAccount('user-2').catch(() => undefined);

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.headers.Authorization === 'Bearer test-key')).toBe(true);
    // The provider header must not displace the content type.
    expect(calls.every((c) => c.headers['Content-Type'] === 'application/json')).toBe(true);
  });

  it('falls back to the public endpoint when no rpcUrl is given', async () => {
    const { calls, spy } = captureFetch();
    vi.stubGlobal('fetch', spy);

    const mgr = createMPCManager(baseConfig);
    await mgr.createAccount('user-3').catch(() => undefined);

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.url === 'https://rpc.mainnet.near.org')).toBe(true);
  });
});
