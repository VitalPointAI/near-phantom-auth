/**
 * validateRelatedOrigins (RPID-01, RPID-02) Wave 0 unit tests
 *
 * TDD spec for src/server/relatedOrigins.ts. Covers:
 *   - Happy path (P1, P2, P3, P4-cap, P6-subdomain)
 *   - Negative branches (N1 max-5, N2/N3 wildcards, N4 https,
 *     N5 localhost-coupling, N6 suffix-mismatch, N7 boundary attack,
 *     N8 duplicate-of-primary, N9 invalid rpId, N10 wrong-shape)
 *   - Invariant I1 (returned array is a fresh defensive copy)
 *
 * No mocks — pure-function test only.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateRelatedOrigins } from '../server/relatedOrigins.js';
import { createAnonAuth } from '../server/index.js';
import type {
  VerifyRegistrationInput,
  VerifyAuthenticationInput,
} from '../server/webauthn.js';
import type { RelatedOrigin, AnonAuthConfig, DatabaseAdapter } from '../types/index.js';

const PRIMARY_RP_ID = 'shopping.com';
const PRIMARY_ORIGIN = 'https://shopping.com';

describe('validateRelatedOrigins (RPID-01, RPID-02) — happy path', () => {
  it('returns [] when entries is undefined', () => {
    expect(validateRelatedOrigins(undefined, PRIMARY_RP_ID, PRIMARY_ORIGIN)).toEqual([]);
  });

  it('returns [] when entries is []', () => {
    expect(validateRelatedOrigins([], PRIMARY_RP_ID, PRIMARY_ORIGIN)).toEqual([]);
  });

  it('accepts a single valid paired tuple (primary domain at .co.uk)', () => {
    const entries: RelatedOrigin[] = [
      { origin: 'https://shopping.co.uk', rpId: 'shopping.co.uk' },
    ];
    expect(validateRelatedOrigins(entries, PRIMARY_RP_ID, PRIMARY_ORIGIN)).toEqual(entries);
  });

  it('accepts an entry where origin host is a SUBDOMAIN of rpId (boundary check passes via leading dot)', () => {
    const entries: RelatedOrigin[] = [
      { origin: 'https://login.shopping.co.uk', rpId: 'shopping.co.uk' },
    ];
    expect(validateRelatedOrigins(entries, PRIMARY_RP_ID, PRIMARY_ORIGIN)).toEqual(entries);
  });

  it('accepts exactly 5 entries (count cap = 5, inclusive)', () => {
    const entries: RelatedOrigin[] = [
      { origin: 'https://shopping.co.uk', rpId: 'shopping.co.uk' },
      { origin: 'https://shopping.ie',    rpId: 'shopping.ie' },
      { origin: 'https://shopping.de',    rpId: 'shopping.de' },
      { origin: 'https://shopping.ca',    rpId: 'shopping.ca' },
      { origin: 'https://shopping.fr',    rpId: 'shopping.fr' },
    ];
    expect(validateRelatedOrigins(entries, PRIMARY_RP_ID, PRIMARY_ORIGIN)).toHaveLength(5);
  });
});

describe('validateRelatedOrigins (RPID-02) — negative cases', () => {
  it('throws when entries.length > 5 (count cap)', () => {
    const entries: RelatedOrigin[] = Array.from({ length: 6 }, (_, i) => ({
      origin: `https://shop${i}.com`,
      rpId: `shop${i}.com`,
    }));
    expect(() => validateRelatedOrigins(entries, PRIMARY_RP_ID, PRIMARY_ORIGIN))
      .toThrow(/max 5/i);
  });

  it('throws on wildcard in origin', () => {
    const entries: RelatedOrigin[] = [
      { origin: 'https://*.shopping.com', rpId: 'shopping.com' },
    ];
    expect(() => validateRelatedOrigins(entries, PRIMARY_RP_ID, PRIMARY_ORIGIN))
      .toThrow(/wildcard/i);
  });

  it('throws on wildcard in rpId', () => {
    const entries: RelatedOrigin[] = [
      { origin: 'https://shopping.com', rpId: '*.shopping.com' },
    ];
    expect(() => validateRelatedOrigins(entries, PRIMARY_RP_ID, PRIMARY_ORIGIN))
      .toThrow(/wildcard/i);
  });

  it('throws on non-https origin (and message references localhost exception)', () => {
    const entries: RelatedOrigin[] = [
      { origin: 'http://shopping.co.uk', rpId: 'shopping.co.uk' },
    ];
    expect(() => validateRelatedOrigins(entries, PRIMARY_RP_ID, PRIMARY_ORIGIN))
      .toThrow(/https/i);
  });

  it('throws when http://localhost is paired with a non-localhost rpId (Pitfall 3)', () => {
    const entries: RelatedOrigin[] = [
      { origin: 'http://localhost:3000', rpId: 'shopping.com' },
    ];
    expect(() => validateRelatedOrigins(entries, PRIMARY_RP_ID, PRIMARY_ORIGIN))
      .toThrow(/https|localhost/i);
  });

  it('throws when origin host is not a suffix-domain of rpId (boundary mismatch)', () => {
    const entries: RelatedOrigin[] = [
      { origin: 'https://attacker.com', rpId: 'shopping.com' },
    ];
    expect(() => validateRelatedOrigins(entries, PRIMARY_RP_ID, PRIMARY_ORIGIN))
      .toThrow(/suffix|host/i);
  });

  it('throws on boundary attack: "notshopping.com" does not end with ".shopping.com"', () => {
    // Pitfall 2: naive String.prototype.endsWith would falsely pass this;
    // the label-boundary check requires `.` prefix.
    const entries: RelatedOrigin[] = [
      { origin: 'https://notshopping.com', rpId: 'shopping.com' },
    ];
    expect(() => validateRelatedOrigins(entries, PRIMARY_RP_ID, PRIMARY_ORIGIN))
      .toThrow(/suffix|host/i);
  });

  it('throws when an entry duplicates the primary { origin, rpId }', () => {
    const entries: RelatedOrigin[] = [
      { origin: PRIMARY_ORIGIN, rpId: PRIMARY_RP_ID },
    ];
    expect(() => validateRelatedOrigins(entries, PRIMARY_RP_ID, PRIMARY_ORIGIN))
      .toThrow(/primary/i);
  });

  it('throws when rpId contains a scheme (invalid host)', () => {
    const entries: RelatedOrigin[] = [
      { origin: 'https://shopping.com', rpId: 'https://shopping.com' },
    ];
    expect(() => validateRelatedOrigins(entries, PRIMARY_RP_ID, PRIMARY_ORIGIN))
      .toThrow();
  });

  it('throws when an entry is missing the rpId field (wrong shape)', () => {
    const entries = [{ origin: 'https://shopping.co.uk' }] as unknown as RelatedOrigin[];
    expect(() => validateRelatedOrigins(entries, PRIMARY_RP_ID, PRIMARY_ORIGIN))
      .toThrow(/origin.*rpId|shape|rpId/i);
  });
});

describe('validateRelatedOrigins (invariant) — returns a fresh array', () => {
  it('returns a copy; mutating the returned array does not mutate the input', () => {
    const input: RelatedOrigin[] = [
      { origin: 'https://shopping.co.uk', rpId: 'shopping.co.uk' },
    ];
    const out = validateRelatedOrigins(input, PRIMARY_RP_ID, PRIMARY_ORIGIN);
    expect(out).not.toBe(input);
    out.length = 0;
    expect(input).toHaveLength(1);
  });
});

// ============================================================
// Block 4: Integration — createAnonAuth-level startup throws (RPID-02 / RPID-03)
// ============================================================

function makeMinimalDb(): DatabaseAdapter {
  // Minimal DatabaseAdapter shape sufficient for createAnonAuth construction.
  // Mirrors src/__tests__/hooks-scaffolding.test.ts:makeMinimalDb — createAnonAuth
  // stores the adapter but does NOT invoke any method at construction time.
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    createUser: vi.fn(),
    getUserById: vi.fn(),
    getUserByCodename: vi.fn(),
    getUserByNearAccount: vi.fn(),
    createOAuthUser: vi.fn(),
    getOAuthUserById: vi.fn(),
    getOAuthUserByEmail: vi.fn(),
    getOAuthUserByProvider: vi.fn(),
    linkOAuthProvider: vi.fn(),
    createPasskey: vi.fn(),
    getPasskeyById: vi.fn(),
    getPasskeysByUserId: vi.fn(),
    updatePasskeyCounter: vi.fn(),
    deletePasskey: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    deleteUserSessions: vi.fn(),
    cleanExpiredSessions: vi.fn(),
    storeChallenge: vi.fn(),
    getChallenge: vi.fn(),
    deleteChallenge: vi.fn(),
    storeRecoveryData: vi.fn(),
    getRecoveryData: vi.fn(),
  } as unknown as DatabaseAdapter;
}

const baseValidConfig: AnonAuthConfig = {
  nearNetwork: 'testnet',
  sessionSecret: 'test-secret-32-chars-long-enough-12345',
  database: { type: 'custom', adapter: makeMinimalDb() },
  rp: {
    name: 'Test',
    id: 'shopping.com',
    origin: 'https://shopping.com',
  },
};

describe('RPID-02 / RPID-03: createAnonAuth startup validation (fail-fast)', () => {
  it('createAnonAuth succeeds when rp.relatedOrigins is omitted (v0.6.1 byte-identical path)', () => {
    expect(() => createAnonAuth(baseValidConfig)).not.toThrow();
  });

  it('createAnonAuth succeeds when rp.relatedOrigins is []', () => {
    expect(() => createAnonAuth({
      ...baseValidConfig,
      rp: { ...baseValidConfig.rp!, relatedOrigins: [] },
    })).not.toThrow();
  });

  it('createAnonAuth succeeds with a valid 1-entry list', () => {
    expect(() => createAnonAuth({
      ...baseValidConfig,
      rp: {
        ...baseValidConfig.rp!,
        relatedOrigins: [{ origin: 'https://shopping.co.uk', rpId: 'shopping.co.uk' }],
      },
    })).not.toThrow();
  });

  it('createAnonAuth THROWS at construction when relatedOrigins has 6 entries (count cap)', () => {
    const tooMany = Array.from({ length: 6 }, (_, i) => ({
      origin: `https://shop${i}.com`,
      rpId: `shop${i}.com`,
    }));
    expect(() => createAnonAuth({
      ...baseValidConfig,
      rp: { ...baseValidConfig.rp!, relatedOrigins: tooMany },
    })).toThrow(/max 5/i);
  });

  it('createAnonAuth THROWS at construction when an entry has a wildcard', () => {
    expect(() => createAnonAuth({
      ...baseValidConfig,
      rp: {
        ...baseValidConfig.rp!,
        relatedOrigins: [{ origin: 'https://*.shopping.com', rpId: 'shopping.com' }],
      },
    })).toThrow(/wildcard/i);
  });

  it('createAnonAuth THROWS at construction on suffix-domain mismatch', () => {
    expect(() => createAnonAuth({
      ...baseValidConfig,
      rp: {
        ...baseValidConfig.rp!,
        relatedOrigins: [{ origin: 'https://attacker.com', rpId: 'shopping.com' }],
      },
    })).toThrow(/suffix|host/i);
  });
});

// ============================================================
// Block 5: Source-level invariant — conditional-spread shape (RPID-03)
// ============================================================

describe('RPID-03: conditional-spread shape preserved (source-level invariant)', () => {
  it('passkey.ts contains the conditional-spread idiom for verifyRegistrationResponse', () => {
    const source = readFileSync(join(process.cwd(), 'src/server/passkey.ts'), 'utf-8');
    // Both call sites must use config.relatedOrigins.length === 0 ? string : string[]
    expect(source).toMatch(/expectedOrigin:\s*config\.relatedOrigins\.length === 0/);
    expect(source).toMatch(/expectedRPID:\s*config\.relatedOrigins\.length === 0/);
    // Primary at index 0 of array form (Pitfall 5)
    expect(source).toMatch(/\[config\.origin,\s*\.\.\.config\.relatedOrigins\.map\(r => r\.origin\)\]/);
    expect(source).toMatch(/\[config\.rpId,\s*\.\.\.config\.relatedOrigins\.map\(r => r\.rpId\)\]/);
  });

  it('passkey.ts has the conditional-spread idiom in EXACTLY two places (register + auth)', () => {
    const source = readFileSync(join(process.cwd(), 'src/server/passkey.ts'), 'utf-8');
    // Count occurrences — should be 4 total (2 fields × 2 call sites)
    const matches = source.match(/config\.relatedOrigins\.length === 0/g) ?? [];
    expect(matches.length).toBe(4);
  });

  it('passkey.ts does NOT contain a nullish-coalescing fallback (catches dropped factory field)', () => {
    const source = readFileSync(join(process.cwd(), 'src/server/passkey.ts'), 'utf-8');
    expect(source).not.toMatch(/config\.relatedOrigins\s*\?\?\s*\[\]/);
  });
});

// ============================================================
// Block 6: RPID-04 standalone-export compile fixtures
// ============================================================

describe('RPID-04: standalone verifyRegistration / verifyAuthentication accept string | string[]', () => {
  // Compile-fixture only — runtime crypto path is covered by src/__tests__/passkey.test.ts.
  const fakeRegistrationResponse = {
    id: 'cred-id',
    rawId: 'cred-id',
    response: {
      clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
      attestationObject: 'fake',
    },
    type: 'public-key' as const,
    clientExtensionResults: {},
  };
  const fakeAuthenticationResponse = {
    id: 'cred-id',
    rawId: 'cred-id',
    response: {
      clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
      authenticatorData: 'fake',
      signature: 'fake',
    },
    type: 'public-key' as const,
    clientExtensionResults: {},
  };
  const fakeStoredCredential = {
    id: 'cred-id',
    publicKey: new Uint8Array([1, 2, 3]),
    counter: 0,
  };

      it('VerifyRegistrationInput accepts the string form (backwards compat)', () => {
        const input: VerifyRegistrationInput = {
          response: fakeRegistrationResponse as unknown as VerifyRegistrationInput['response'],
          expectedChallenge: 'challenge',
          expectedOrigin: 'https://shopping.com',
          expectedRPID: 'shopping.com',
        };
        expect(input.expectedOrigin).toBe('https://shopping.com');
        expect(input.expectedRPID).toBe('shopping.com');
      });

      it('VerifyRegistrationInput accepts the string[] form (RPID-04 widening)', () => {
        const input: VerifyRegistrationInput = {
          response: fakeRegistrationResponse as unknown as VerifyRegistrationInput['response'],
          expectedChallenge: 'challenge',
          expectedOrigin: ['https://shopping.com', 'https://shopping.co.uk'],
          expectedRPID: ['shopping.com', 'shopping.co.uk'],
        };
        expect(Array.isArray(input.expectedOrigin)).toBe(true);
        expect(Array.isArray(input.expectedRPID)).toBe(true);
        expect(input.expectedOrigin).toHaveLength(2);
        expect(input.expectedRPID).toHaveLength(2);
      });

      it('VerifyAuthenticationInput accepts the string form (backwards compat)', () => {
        const input: VerifyAuthenticationInput = {
          response: fakeAuthenticationResponse as unknown as VerifyAuthenticationInput['response'],
          expectedChallenge: 'challenge',
          expectedOrigin: 'https://shopping.com',
          expectedRPID: 'shopping.com',
          credential: fakeStoredCredential,
        };
        expect(input.expectedOrigin).toBe('https://shopping.com');
        expect(input.expectedRPID).toBe('shopping.com');
      });

      it('VerifyAuthenticationInput accepts the string[] form (RPID-04 widening)', () => {
        const input: VerifyAuthenticationInput = {
          response: fakeAuthenticationResponse as unknown as VerifyAuthenticationInput['response'],
          expectedChallenge: 'challenge',
          expectedOrigin: ['https://shopping.com', 'https://shopping.co.uk'],
          expectedRPID: ['shopping.com', 'shopping.co.uk'],
          credential: fakeStoredCredential,
        };
        expect(Array.isArray(input.expectedOrigin)).toBe(true);
        expect(Array.isArray(input.expectedRPID)).toBe(true);
      });
});
