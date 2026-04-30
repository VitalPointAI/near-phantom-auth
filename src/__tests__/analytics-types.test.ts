/**
 * Phase 13 Plan 02 — ANALYTICS-02 implementation.
 *
 * Compile-via-assignment pattern (analog: src/__tests__/exports.test.ts:48-82).
 * If a variant's required field is missing, tsc --noEmit fails before this
 * test runs. Runtime assertions are minimal — the type system does the work.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AnalyticsEvent } from '../server/analytics.js';
// Verify the type is exported from the public surface (Assumption A8).
import type { AnalyticsEvent as AnalyticsEventPublic } from '../server/index.js';

describe('ANALYTICS-02: AnalyticsEvent discriminated union', () => {
  it('register.start variant assigns from { type, rpId, timestamp }', () => {
    const e: AnalyticsEvent = { type: 'register.start', rpId: 'localhost', timestamp: 0 };
    expect(e.type).toBe('register.start');
  });

  it('register.finish.success variant requires backupEligible: boolean', () => {
    const e: AnalyticsEvent = {
      type: 'register.finish.success',
      rpId: 'localhost',
      timestamp: 0,
      backupEligible: true,
    };
    expect(e.type).toBe('register.finish.success');
  });

  it('register.finish.failure variant requires reason: RegisterFailureReason', () => {
    const reasons = ['invalid-codename', 'passkey-verification-failed', 'internal-error'] as const;
    for (const reason of reasons) {
      const e: AnalyticsEvent = { type: 'register.finish.failure', rpId: 'localhost', timestamp: 0, reason };
      expect(e.reason).toBe(reason);
    }
  });

  it('login.start variant requires codenameProvided: boolean', () => {
    const e: AnalyticsEvent = { type: 'login.start', rpId: 'localhost', timestamp: 0, codenameProvided: false };
    expect(e.codenameProvided).toBe(false);
  });

  it('login.finish.success variant requires backupEligible: boolean', () => {
    const e: AnalyticsEvent = { type: 'login.finish.success', rpId: 'localhost', timestamp: 0, backupEligible: false };
    expect(e.backupEligible).toBe(false);
  });

  it('login.finish.failure variant requires reason: LoginFailureReason', () => {
    const reasons = ['auth-failed', 'user-not-found', 'internal-error'] as const;
    for (const reason of reasons) {
      const e: AnalyticsEvent = { type: 'login.finish.failure', rpId: 'localhost', timestamp: 0, reason };
      expect(e.reason).toBe(reason);
    }
  });

  it('all four recovery.*.success variants accept exactly { type, rpId, timestamp }', () => {
    const types = [
      'recovery.wallet.link.success',
      'recovery.wallet.recover.success',
      'recovery.ipfs.setup.success',
      'recovery.ipfs.recover.success',
    ] as const;
    for (const type of types) {
      const e: AnalyticsEvent = { type, rpId: 'localhost', timestamp: 0 };
      expect(e.type).toBe(type);
    }
  });

  it('oauth.callback.success variant requires provider: OauthProvider', () => {
    const providers = ['google', 'github', 'twitter'] as const;
    for (const provider of providers) {
      const e: AnalyticsEvent = { type: 'oauth.callback.success', rpId: 'localhost', timestamp: 0, provider };
      expect(e.provider).toBe(provider);
    }
  });

  it('account.delete variant accepts exactly { type, rpId, timestamp }', () => {
    const e: AnalyticsEvent = { type: 'account.delete', rpId: 'localhost', timestamp: 0 };
    expect(e.type).toBe('account.delete');
  });

  it('switch (event.type) exhausts the union (never assertion in default)', () => {
    const handle = (event: AnalyticsEvent): string => {
      switch (event.type) {
        case 'register.start':
        case 'register.finish.success':
        case 'register.finish.failure':
        case 'login.start':
        case 'login.finish.success':
        case 'login.finish.failure':
        case 'recovery.wallet.link.success':
        case 'recovery.wallet.recover.success':
        case 'recovery.ipfs.setup.success':
        case 'recovery.ipfs.recover.success':
        case 'oauth.callback.success':
        case 'account.delete':
          return event.type;
        default: {
          // If a new variant is added without updating this switch, tsc fails here.
          const _exhaustive: never = event;
          throw new Error(`Unhandled event: ${_exhaustive as unknown as string}`);
        }
      }
    };
    expect(handle({ type: 'register.start', rpId: 'localhost', timestamp: 0 })).toBe('register.start');
  });

  it('AnalyticsEvent is re-exported from ../server/index.js (public surface)', () => {
    // Compile-time check via type alias above.
    const _typeAlias: AnalyticsEventPublic = {
      type: 'register.start',
      rpId: 'localhost',
      timestamp: 0,
    };
    expect(_typeAlias.type).toBe('register.start');

    // Source-level check (mirrors src/__tests__/exports.test.ts:84-89 pattern).
    const source = readFileSync(join(process.cwd(), 'src/server/index.ts'), 'utf-8');
    expect(source).toMatch(/AnalyticsEvent/);
  });
});
