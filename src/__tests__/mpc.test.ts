/**
 * MPC Module Tests
 *
 * DEBT-02: Replace custom base58Encode with bs58 library
 * BUG-01: yoctoNEAR conversion precision
 * BUG-02: buildSignedTransaction byte layout
 * SEC-04: Derivation salt prevents account ID prediction
 */

import { describe, it } from 'vitest';

// ============================================
// DEBT-02: base58Encode replacement
// ============================================

describe('base58Encode replacement - DEBT-02', () => {
  it.todo('bs58.encode produces same output as base58Encode for known inputs');
});

// ============================================
// BUG-01: yoctoNEAR conversion
// ============================================

describe('yoctoNEAR conversion - BUG-01', () => {
  it.todo("converts '1' NEAR to exactly 10^24 yoctoNEAR");
  it.todo("converts '0.01' NEAR without floating-point error");
  it.todo("converts '0.000000000000000000000001' (1 yoctoNEAR) correctly");
});

// ============================================
// BUG-02: buildSignedTransaction byte layout
// ============================================

describe('buildSignedTransaction - BUG-02', () => {
  it.todo('output includes 32-byte public key after key type byte');
  it.todo('total signature section is 97 bytes (1 type + 32 pubkey + 64 sig)');
});

// ============================================
// SEC-04: Derivation salt
// ============================================

describe('derivation salt - SEC-04', () => {
  it.todo('unsalted derivation produces same result as current code');
  it.todo('salted derivation produces different result than unsalted');
  it.todo('same userId with different salts produces different accounts');
});
