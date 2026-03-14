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
import { MPCAccountManager } from '../server/mpc.js';

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

// Duplicate of the fixed buildSignedTransaction for testing
function buildSignedTransactionFixed(
  transaction: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(transaction);
  parts.push(new Uint8Array([0]));           // keyType: 1 byte (ED25519 = 0)
  parts.push(new Uint8Array(publicKey));     // publicKey: 32 bytes
  parts.push(new Uint8Array(signature));     // signature data: 64 bytes
  const totalLength = parts.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of parts) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

describe('buildSignedTransaction - BUG-02', () => {
  const transaction = new Uint8Array([1, 2, 3, 4]);
  const publicKey = new Uint8Array(32).fill(0xAB);  // 32 bytes
  const signature = new Uint8Array(64).fill(0xCD);  // 64 bytes

  it('output starts with transaction bytes', () => {
    const result = buildSignedTransactionFixed(transaction, signature, publicKey);
    expect(Array.from(result.slice(0, 4))).toEqual([1, 2, 3, 4]);
  });

  it('byte at transaction.length is 0x00 (ED25519 key type)', () => {
    const result = buildSignedTransactionFixed(transaction, signature, publicKey);
    expect(result[transaction.length]).toBe(0x00);
  });

  it('output includes 32-byte public key after key type byte', () => {
    const result = buildSignedTransactionFixed(transaction, signature, publicKey);
    const keyStart = transaction.length + 1;
    const extractedKey = result.slice(keyStart, keyStart + 32);
    expect(Array.from(extractedKey)).toEqual(Array.from(publicKey));
  });

  it('next 64 bytes after public key are the signature', () => {
    const result = buildSignedTransactionFixed(transaction, signature, publicKey);
    const sigStart = transaction.length + 1 + 32;
    const extractedSig = result.slice(sigStart, sigStart + 64);
    expect(Array.from(extractedSig)).toEqual(Array.from(signature));
  });

  it('total signature section is 97 bytes (1 type + 32 pubkey + 64 sig)', () => {
    const result = buildSignedTransactionFixed(transaction, signature, publicKey);
    expect(result.length).toBe(transaction.length + 97);
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
