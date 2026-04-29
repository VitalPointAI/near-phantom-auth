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

import { describe, it, expect } from 'vitest';
import { validateRelatedOrigins } from '../server/relatedOrigins.js';
import type { RelatedOrigin } from '../types/index.js';

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
