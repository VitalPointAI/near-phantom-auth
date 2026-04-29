/**
 * Wallet Recovery Tests
 *
 * TEST-05: Real ed25519 signature verification
 * Adversarial case: NEAR account with unrelated key returns false
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createHash } from 'crypto';
import {
  generateWalletChallenge,
  verifyWalletSignature,
  publicKeyToImplicitAccount,
  checkWalletAccess,
  createWalletRecoveryManager,
} from '../server/recovery/wallet.js';

// ============================================
// Helper
// ============================================

function buildValidWalletSignature(message: string) {
  const keyPair = nacl.sign.keyPair();
  const messageHash = createHash('sha256').update(message).digest();
  const sigBytes = nacl.sign.detached(messageHash, keyPair.secretKey);
  return {
    signature: Buffer.from(sigBytes).toString('base64'),
    publicKey: `ed25519:${bs58.encode(Buffer.from(keyPair.publicKey))}`,
    message,
    _keyPair: keyPair, // exposed for reuse in tests
  };
}

// ============================================
// generateWalletChallenge
// ============================================

describe('generateWalletChallenge', () => {
  it('returns the expected challenge format', () => {
    const result = generateWalletChallenge('link-recovery', 1234567890);
    expect(result).toBe('near-anon-auth:link-recovery:1234567890');
  });

  it('encodes different actions correctly', () => {
    const result = generateWalletChallenge('recover-account', 9999);
    expect(result).toBe('near-anon-auth:recover-account:9999');
  });
});

// ============================================
// verifyWalletSignature
// ============================================

describe('verifyWalletSignature', () => {
  it('returns true for a valid ed25519 signature', () => {
    const message = 'near-anon-auth:link-recovery:1234567890';
    const walletSig = buildValidWalletSignature(message);

    const result = verifyWalletSignature(
      { signature: walletSig.signature, publicKey: walletSig.publicKey, message },
      message
    );
    expect(result).toBe(true);
  });

  it('returns false when signature.message does not match expectedMessage', () => {
    const message = 'near-anon-auth:link-recovery:1234567890';
    const walletSig = buildValidWalletSignature(message);

    const result = verifyWalletSignature(
      { signature: walletSig.signature, publicKey: walletSig.publicKey, message },
      'near-anon-auth:link-recovery:9999999999' // different expected message
    );
    expect(result).toBe(false);
  });

  it('returns false for a corrupted signature (altered bytes)', () => {
    const message = 'near-anon-auth:link-recovery:1234567890';
    const walletSig = buildValidWalletSignature(message);

    // Decode, flip a byte, re-encode
    const sigBytes = Buffer.from(walletSig.signature, 'base64');
    sigBytes[0] = sigBytes[0] ^ 0xff;
    const corruptedSig = sigBytes.toString('base64');

    const result = verifyWalletSignature(
      { signature: corruptedSig, publicKey: walletSig.publicKey, message },
      message
    );
    expect(result).toBe(false);
  });

  it('returns false for a wrong public key', () => {
    const message = 'near-anon-auth:link-recovery:1234567890';
    const walletSig = buildValidWalletSignature(message);

    // Different keypair's public key
    const otherKeyPair = nacl.sign.keyPair();
    const wrongPublicKey = `ed25519:${bs58.encode(Buffer.from(otherKeyPair.publicKey))}`;

    const result = verifyWalletSignature(
      { signature: walletSig.signature, publicKey: wrongPublicKey, message },
      message
    );
    expect(result).toBe(false);
  });
});

// ============================================
// publicKeyToImplicitAccount
// ============================================

describe('publicKeyToImplicitAccount', () => {
  it('returns hex-encoded public key bytes for a known keypair', () => {
    const keyPair = nacl.sign.keyPair();
    const publicKey = `ed25519:${bs58.encode(Buffer.from(keyPair.publicKey))}`;
    const expected = Buffer.from(keyPair.publicKey).toString('hex');

    const result = publicKeyToImplicitAccount(publicKey);
    expect(result).toBe(expected);
  });

  it('produces a 64-character hex string (32 bytes)', () => {
    const keyPair = nacl.sign.keyPair();
    const publicKey = `ed25519:${bs58.encode(Buffer.from(keyPair.publicKey))}`;

    const result = publicKeyToImplicitAccount(publicKey);
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });
});

// ============================================
// checkWalletAccess (fetch mocked)
// ============================================

describe('checkWalletAccess', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns true when RPC response has no error (key exists)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ result: { nonce: 0, permission: 'FullAccess', block_height: 1 } }),
    }));

    const result = await checkWalletAccess(
      'alice.testnet',
      'ed25519:somePublicKey',
      'testnet'
    );
    expect(result).toBe(true);
  });

  it('returns false when RPC returns UNKNOWN_ACCESS_KEY error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        error: { cause: { name: 'UNKNOWN_ACCESS_KEY' }, code: -32000 },
      }),
    }));

    const result = await checkWalletAccess(
      'alice.testnet',
      'ed25519:somePublicKey',
      'testnet'
    );
    expect(result).toBe(false);
  });

  it('throws when fetch fails (RPC unreachable — MPC-10 propagation)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    await expect(
      checkWalletAccess('alice.testnet', 'ed25519:somePublicKey', 'testnet')
    ).rejects.toThrow('Network error');
  });

  it('uses mainnet RPC URL when networkId is mainnet', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => ({ result: {} }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await checkWalletAccess('alice.near', 'ed25519:somePublicKey', 'mainnet');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://rpc.mainnet.near.org',
      expect.any(Object)
    );
  });
});

// ============================================
// checkWalletAccess — MPC-05: FullAccess permission gate
// ============================================

describe('checkWalletAccess — MPC-05: FullAccess permission gate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns false for FunctionCall-only permission (security gate — not FullAccess)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        result: {
          nonce: 5,
          permission: {
            FunctionCall: {
              allowance: '1000000000000000000000000',
              receiver_id: 'app.testnet',
              method_names: [],
            },
          },
          block_height: 1,
        },
      }),
    }));

    const result = await checkWalletAccess(
      'alice.testnet',
      'ed25519:functionCallKey',
      'testnet'
    );
    expect(result).toBe(false);
  });

  it('returns true when access key is FullAccess (regression — existing behavior preserved)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        result: { nonce: 0, permission: 'FullAccess', block_height: 1 },
      }),
    }));

    const result = await checkWalletAccess(
      'alice.testnet',
      'ed25519:fullAccessKey',
      'testnet'
    );
    expect(result).toBe(true);
  });

  it('returns false (does not throw) when account is deleted (UNKNOWN_ACCOUNT — MPC-04)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        error: { cause: { name: 'UNKNOWN_ACCOUNT' }, code: -32000 },
      }),
    }));

    const result = await checkWalletAccess(
      'deleted.testnet',
      'ed25519:anyKey',
      'testnet'
    );
    expect(result).toBe(false);
  });
});

// ============================================
// createWalletRecoveryManager
// ============================================

describe('createWalletRecoveryManager', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('verifyRecoverySignature returns { verified: false } for bad signature', async () => {
    const manager = createWalletRecoveryManager({ nearNetwork: 'testnet' });
    const { challenge } = manager.generateRecoveryChallenge();

    const keyPair = nacl.sign.keyPair();
    const publicKey = `ed25519:${bs58.encode(Buffer.from(keyPair.publicKey))}`;

    // Build signature for a DIFFERENT challenge (mismatch)
    const messageHash = createHash('sha256').update('wrong-challenge').digest();
    const sigBytes = nacl.sign.detached(messageHash, keyPair.secretKey);
    const badSig = Buffer.from(sigBytes).toString('base64');

    const result = await manager.verifyRecoverySignature(
      { signature: badSig, publicKey, message: 'wrong-challenge' },
      challenge,
      'alice.testnet'
    );
    expect(result).toEqual({ verified: false });
  });

  it('verifyRecoverySignature returns { verified: false } for valid sig but unrelated key on account (adversarial case)', async () => {
    // Mock fetch: key not found on account (adversarial case)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        error: { cause: { name: 'UNKNOWN_ACCESS_KEY' }, code: -32000 },
      }),
    }));

    const manager = createWalletRecoveryManager({ nearNetwork: 'testnet' });
    const { challenge } = manager.generateRecoveryChallenge();

    // Build a VALID signature (keypair A signs the correct challenge)
    const keyPair = nacl.sign.keyPair();
    const messageHash = createHash('sha256').update(challenge).digest();
    const sigBytes = nacl.sign.detached(messageHash, keyPair.secretKey);
    const validSig = Buffer.from(sigBytes).toString('base64');
    const publicKey = `ed25519:${bs58.encode(Buffer.from(keyPair.publicKey))}`;

    // Keypair A signed correctly but is NOT an access key on alice.testnet
    const result = await manager.verifyRecoverySignature(
      { signature: validSig, publicKey, message: challenge },
      challenge,
      'alice.testnet'
    );
    // Valid crypto sig, but no on-chain access → verified: false
    expect(result).toEqual({ verified: false });
  });

  it('verifyRecoverySignature returns { verified: true } when sig valid and key is on account', async () => {
    // Mock fetch: key exists on account
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ result: { nonce: 0, permission: 'FullAccess' } }),
    }));

    const manager = createWalletRecoveryManager({ nearNetwork: 'testnet' });
    const { challenge } = manager.generateRecoveryChallenge();

    const keyPair = nacl.sign.keyPair();
    const messageHash = createHash('sha256').update(challenge).digest();
    const sigBytes = nacl.sign.detached(messageHash, keyPair.secretKey);
    const validSig = Buffer.from(sigBytes).toString('base64');
    const publicKey = `ed25519:${bs58.encode(Buffer.from(keyPair.publicKey))}`;

    const result = await manager.verifyRecoverySignature(
      { signature: validSig, publicKey, message: challenge },
      challenge,
      'alice.testnet'
    );
    expect(result).toEqual({ verified: true });
  });
});
