/**
 * Codename Generator Tests
 *
 * TEST-06: Unit tests for codename generation and validation
 */

import { describe, it, expect } from 'vitest';
import {
  generateNatoCodename,
  generateAnimalCodename,
  generateCodename,
  isValidCodename,
} from '../server/codename.js';

// ============================================
// generateNatoCodename
// ============================================

describe('generateNatoCodename', () => {
  it('returns a string in WORD-WORD-NN format', () => {
    const codename = generateNatoCodename();
    expect(typeof codename).toBe('string');
    expect(codename).toMatch(/^[A-Z]+-[A-Z]+-\d{1,2}$/);
  });

  it('returns uppercase letters only in the word segments', () => {
    for (let i = 0; i < 10; i++) {
      const codename = generateNatoCodename();
      const parts = codename.split('-');
      // Last part is numeric suffix, first two are words
      expect(parts.length).toBe(3);
      expect(parts[0]).toMatch(/^[A-Z]+$/);
      expect(parts[1]).toMatch(/^[A-Z]+$/);
      expect(Number(parts[2])).toBeGreaterThanOrEqual(1);
      expect(Number(parts[2])).toBeLessThanOrEqual(99);
    }
  });

  it('returns a numeric suffix between 1 and 99', () => {
    for (let i = 0; i < 20; i++) {
      const codename = generateNatoCodename();
      const suffix = Number(codename.split('-').pop());
      expect(suffix).toBeGreaterThanOrEqual(1);
      expect(suffix).toBeLessThanOrEqual(99);
    }
  });
});

// ============================================
// generateAnimalCodename
// ============================================

describe('generateAnimalCodename', () => {
  it('returns a string in WORD-WORD-NN format', () => {
    const codename = generateAnimalCodename();
    expect(typeof codename).toBe('string');
    expect(codename).toMatch(/^[A-Z]+-[A-Z]+-\d{1,2}$/);
  });

  it('returns uppercase letters only in the word segments', () => {
    for (let i = 0; i < 10; i++) {
      const codename = generateAnimalCodename();
      const parts = codename.split('-');
      expect(parts.length).toBe(3);
      expect(parts[0]).toMatch(/^[A-Z]+$/);
      expect(parts[1]).toMatch(/^[A-Z]+$/);
      expect(Number(parts[2])).toBeGreaterThanOrEqual(1);
      expect(Number(parts[2])).toBeLessThanOrEqual(99);
    }
  });
});

// ============================================
// generateCodename
// ============================================

describe('generateCodename', () => {
  it("delegates to generateNatoCodename when style is 'nato-phonetic'", () => {
    const codename = generateCodename('nato-phonetic');
    expect(codename).toMatch(/^[A-Z]+-[A-Z]+-\d{1,2}$/);
  });

  it("delegates to generateAnimalCodename when style is 'animals'", () => {
    const codename = generateCodename('animals');
    expect(codename).toMatch(/^[A-Z]+-[A-Z]+-\d{1,2}$/);
  });

  it('defaults to nato-phonetic format when no style is provided', () => {
    const codename = generateCodename();
    expect(codename).toMatch(/^[A-Z]+-[A-Z]+-\d{1,2}$/);
  });
});

// ============================================
// isValidCodename
// ============================================

describe('isValidCodename', () => {
  it("returns true for compound WORD-WORD-NN format (e.g., 'ALPHA-BRAVO-42')", () => {
    expect(isValidCodename('ALPHA-BRAVO-42')).toBe(true);
  });

  it("returns true for legacy single-word format (e.g., 'ALPHA-7')", () => {
    expect(isValidCodename('ALPHA-7')).toBe(true);
  });

  it("returns false for lowercase input (e.g., 'alpha-7')", () => {
    expect(isValidCodename('alpha-7')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidCodename('')).toBe(false);
  });

  it("returns false when there is no number suffix (e.g., 'ALPHA')", () => {
    expect(isValidCodename('ALPHA')).toBe(false);
  });

  it("returns false for too many segments (e.g., 'ALPHA-BRAVO-CHARLIE-42')", () => {
    expect(isValidCodename('ALPHA-BRAVO-CHARLIE-42')).toBe(false);
  });

  it("returns false for mixed-case input (e.g., 'Alpha-7')", () => {
    expect(isValidCodename('Alpha-7')).toBe(false);
  });

  it("returns false when suffix is missing entirely (e.g., 'ALPHA-BRAVO')", () => {
    expect(isValidCodename('ALPHA-BRAVO')).toBe(false);
  });

  it("returns true for valid compound with single-digit suffix (e.g., 'SIERRA-TANGO-5')", () => {
    expect(isValidCodename('SIERRA-TANGO-5')).toBe(true);
  });

  it("returns true for valid legacy with two-digit suffix (e.g., 'ZULU-99')", () => {
    expect(isValidCodename('ZULU-99')).toBe(true);
  });
});

// ============================================
// Uniqueness (statistical)
// ============================================

describe('uniqueness', () => {
  it('generates at least 40 unique codenames out of 50 (low collision probability)', () => {
    const codenames = Array.from({ length: 50 }, () => generateNatoCodename());
    const unique = new Set(codenames);
    // Crypto randomness: 26 words * 26 words * 99 = 66924 possible values
    // Probability of any collision in 50 draws is very low
    expect(unique.size).toBeGreaterThanOrEqual(40);
  });

  it('generates at least 40 unique animal codenames out of 50', () => {
    const codenames = Array.from({ length: 50 }, () => generateAnimalCodename());
    const unique = new Set(codenames);
    // 23 adjectives * 23 animals * 99 = 52371 possible values
    expect(unique.size).toBeGreaterThanOrEqual(40);
  });
});
