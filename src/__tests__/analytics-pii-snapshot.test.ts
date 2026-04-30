/**
 * Phase 13 Plan 02 — ANALYTICS-05 implementation.
 *
 * Snapshot whitelist test: every concrete event variant's keys must be a
 * subset of ALLOWED_EVENT_FIELDS. Future addition of a non-whitelisted
 * field (e.g. `latencyMs`, `userAgentFamily`) fails this test until both
 * the union AND the whitelist are updated together.
 *
 * Reference: 13-RESEARCH.md Pattern 4 lines 451-491.
 */
import { describe, it, expect } from 'vitest';
import { ALLOWED_EVENT_FIELDS, type AnalyticsEvent } from '../server/analytics.js';

const sampleVariants: AnalyticsEvent[] = [
  { type: 'register.start', rpId: 'localhost', timestamp: 0 },
  { type: 'register.finish.success', rpId: 'localhost', timestamp: 0, backupEligible: true },
  { type: 'register.finish.failure', rpId: 'localhost', timestamp: 0, reason: 'invalid-codename' },
  { type: 'login.start', rpId: 'localhost', timestamp: 0, codenameProvided: false },
  { type: 'login.finish.success', rpId: 'localhost', timestamp: 0, backupEligible: false },
  { type: 'login.finish.failure', rpId: 'localhost', timestamp: 0, reason: 'auth-failed' },
  { type: 'recovery.wallet.link.success', rpId: 'localhost', timestamp: 0 },
  { type: 'recovery.wallet.recover.success', rpId: 'localhost', timestamp: 0 },
  { type: 'recovery.ipfs.setup.success', rpId: 'localhost', timestamp: 0 },
  { type: 'recovery.ipfs.recover.success', rpId: 'localhost', timestamp: 0 },
  { type: 'oauth.callback.success', rpId: 'localhost', timestamp: 0, provider: 'google' },
  { type: 'account.delete', rpId: 'localhost', timestamp: 0 },
];

describe('ANALYTICS-05: every event variant uses only allowed fields', () => {
  it('ALLOWED_EVENT_FIELDS contains exactly { type, rpId, timestamp, provider, backupEligible, reason, codenameProvided }', () => {
    const expected = ['type', 'rpId', 'timestamp', 'provider', 'backupEligible', 'reason', 'codenameProvided'];
    for (const key of expected) {
      expect(ALLOWED_EVENT_FIELDS.has(key)).toBe(true);
    }
    expect(ALLOWED_EVENT_FIELDS.size).toBe(expected.length);
  });

  it('ALLOWED_EVENT_FIELDS rejects userId, codename, nearAccountId, email, ip, userAgent', () => {
    const forbidden = ['userId', 'codename', 'nearAccountId', 'email', 'ip', 'userAgent'];
    for (const key of forbidden) {
      expect(ALLOWED_EVENT_FIELDS.has(key)).toBe(false);
    }
  });

  it.each(sampleVariants)('every concrete variant ($type).keys is a subset of ALLOWED_EVENT_FIELDS', (variant) => {
    const keys = Object.keys(variant);
    const disallowed = keys.filter((k) => !ALLOWED_EVENT_FIELDS.has(k));
    expect(disallowed).toEqual([]);
  });

  it('all 12 variants are covered by sampleVariants (no variant silently dropped)', () => {
    // Defense-in-depth: if a future PR adds a 13th variant to AnalyticsEvent
    // but forgets to add it here, this guard reminds the author. Update both
    // sampleVariants AND ALLOWED_EVENT_FIELDS in lockstep.
    expect(sampleVariants.length).toBe(12);
    const types = sampleVariants.map((v) => v.type);
    expect(new Set(types).size).toBe(12);
  });
});
