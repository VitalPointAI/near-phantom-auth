/**
 * IPFS Encrypt/Decrypt Unit Tests
 *
 * TEST-04: Roundtrip, wrong password, and tampered-data scenarios for
 * encryptRecoveryData / decryptRecoveryData (pure crypto functions).
 */

import { describe, it, expect } from 'vitest';
import {
  encryptRecoveryData,
  decryptRecoveryData,
} from '../server/recovery/ipfs.js';
import type { RecoveryPayload } from '../server/recovery/ipfs.js';

// ============================================
// Shared test payload
// ============================================

const testPayload: RecoveryPayload = {
  userId: 'test-user-1',
  nearAccountId: 'abc123def456.testnet',
  derivationPath: 'near-anon-auth,test-user-1',
  createdAt: 1700000000000,
};

const CORRECT_PASSWORD = 'CorrectPass1!SecureEnough';
const WRONG_PASSWORD = 'WrongPass1!NotTheSame';

// ============================================
// encryptRecoveryData — output shape
// ============================================

describe('encryptRecoveryData', () => {
  it('returns an object with ciphertext, iv, salt, authTag, version=1', async () => {
    const result = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);

    expect(result).toHaveProperty('ciphertext');
    expect(result).toHaveProperty('iv');
    expect(result).toHaveProperty('salt');
    expect(result).toHaveProperty('authTag');
    expect(result.version).toBe(1);
  });

  it('all string fields are non-empty', async () => {
    const result = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);

    expect(result.ciphertext.length).toBeGreaterThan(0);
    expect(result.iv.length).toBeGreaterThan(0);
    expect(result.salt.length).toBeGreaterThan(0);
    expect(result.authTag.length).toBeGreaterThan(0);
  });

  it('all string fields are valid base64 (decodable without throwing)', async () => {
    const result = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);

    expect(() => Buffer.from(result.ciphertext, 'base64')).not.toThrow();
    expect(() => Buffer.from(result.iv, 'base64')).not.toThrow();
    expect(() => Buffer.from(result.salt, 'base64')).not.toThrow();
    expect(() => Buffer.from(result.authTag, 'base64')).not.toThrow();
  });
});

// ============================================
// Roundtrip — encrypt then decrypt
// ============================================

describe('encrypt/decrypt roundtrip', () => {
  it('decrypts to exact original payload with correct password', async () => {
    const encrypted = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);
    const decrypted = await decryptRecoveryData(encrypted, CORRECT_PASSWORD);

    expect(decrypted.userId).toBe(testPayload.userId);
    expect(decrypted.nearAccountId).toBe(testPayload.nearAccountId);
    expect(decrypted.derivationPath).toBe(testPayload.derivationPath);
    expect(decrypted.createdAt).toBe(testPayload.createdAt);
  });

  it('roundtrip preserves all payload fields without modification', async () => {
    const encrypted = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);
    const decrypted = await decryptRecoveryData(encrypted, CORRECT_PASSWORD);

    expect(decrypted).toEqual(testPayload);
  });
});

// ============================================
// Wrong password
// ============================================

describe('wrong password', () => {
  it('throws when decrypting with a wrong password', async () => {
    const encrypted = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);

    await expect(
      decryptRecoveryData(encrypted, WRONG_PASSWORD)
    ).rejects.toThrow();
  });

  it("throws with a message containing 'Invalid password or corrupted data'", async () => {
    const encrypted = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);

    await expect(
      decryptRecoveryData(encrypted, WRONG_PASSWORD)
    ).rejects.toThrow('Invalid password or corrupted data');
  });
});

// ============================================
// Unique encryption (random salt/IV)
// ============================================

describe('unique encryption', () => {
  it('produces different ciphertext for two encryptions of the same payload', async () => {
    const enc1 = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);
    const enc2 = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);

    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it('produces different IV and salt for two encryptions', async () => {
    const enc1 = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);
    const enc2 = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.salt).not.toBe(enc2.salt);
  });
});

// ============================================
// Tampered ciphertext
// ============================================

describe('tampered ciphertext', () => {
  it('throws when ciphertext has a flipped character', async () => {
    const encrypted = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);

    // Flip the first character of the ciphertext
    const ciphertextChars = encrypted.ciphertext.split('');
    ciphertextChars[0] = ciphertextChars[0] === 'A' ? 'B' : 'A';
    const tampered = {
      ...encrypted,
      ciphertext: ciphertextChars.join(''),
    };

    await expect(
      decryptRecoveryData(tampered, CORRECT_PASSWORD)
    ).rejects.toThrow();
  });

  it('throws when ciphertext is completely replaced with garbage', async () => {
    const encrypted = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);
    const tampered = {
      ...encrypted,
      ciphertext: Buffer.from('totally-wrong-garbage-data').toString('base64'),
    };

    await expect(
      decryptRecoveryData(tampered, CORRECT_PASSWORD)
    ).rejects.toThrow();
  });
});

// ============================================
// Tampered authTag
// ============================================

describe('tampered authTag', () => {
  it('throws when authTag has a flipped character', async () => {
    const encrypted = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);

    // Flip the first character of the authTag
    const tagChars = encrypted.authTag.split('');
    tagChars[0] = tagChars[0] === 'A' ? 'B' : 'A';
    const tampered = {
      ...encrypted,
      authTag: tagChars.join(''),
    };

    await expect(
      decryptRecoveryData(tampered, CORRECT_PASSWORD)
    ).rejects.toThrow();
  });

  it('throws when authTag is replaced with zeros (all-null tag)', async () => {
    const encrypted = await encryptRecoveryData(testPayload, CORRECT_PASSWORD);
    const tampered = {
      ...encrypted,
      authTag: Buffer.alloc(16, 0).toString('base64'),
    };

    await expect(
      decryptRecoveryData(tampered, CORRECT_PASSWORD)
    ).rejects.toThrow();
  });
});
