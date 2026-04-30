/**
 * HOOK-01: AnonAuthHooks scaffolding tests
 *
 * Covers:
 *   1. Compile fixture: hooks omitted — AnonAuthConfig is valid, createAnonAuth does not throw
 *   2. Compile fixture: hooks: {} — all callbacks optional, empty object compiles
 *   3. Threading: hooks accepted at construction time but NEVER invoked (Phase 11 invariant)
 *   4. Invariant grep guard: zero call sites for hook callbacks in src/server
 *
 * Per 11-RESEARCH.md Open Question #3 recommendation.
 * Per 11-VALIDATION.md Wave 0 requirement.
 */

import { describe, it, expect, vi } from 'vitest';
import { execSync } from 'node:child_process';
import {
  createAnonAuth,
  type AnonAuthConfig,
  type AnonAuthHooks,
} from '../server/index.js';
import type { DatabaseAdapter } from '../types/index.js';

// ---------------------------------------------------------------------------
// Minimal mock DB — satisfies DatabaseAdapter for createAnonAuth construction.
// createAnonAuth only stores the adapter; no methods are called during construction.
// Shape copied from registration-auth.test.ts makeMockDb().
// ---------------------------------------------------------------------------

function makeMinimalDb(): DatabaseAdapter {
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
  };
}

// baseConfig uses Omit<AnonAuthConfig, 'hooks'> intentionally so that
// the `{ ...baseConfig, hooks: {} }` spread in test 2 does NOT inherit
// a pre-existing hooks field from baseConfig.
const baseConfig: Omit<AnonAuthConfig, 'hooks'> = {
  nearNetwork: 'testnet',
  sessionSecret: 'test-secret-32-chars-long-enough-12345',
  database: { type: 'custom', adapter: makeMinimalDb() },
  rp: { name: 'Test', id: 'localhost', origin: 'http://localhost:3000' },
};

// ---------------------------------------------------------------------------

describe('HOOK-01: AnonAuthConfig.hooks is fully optional', () => {
  it('compiles and constructs with hooks omitted', () => {
    const cfg: AnonAuthConfig = { ...baseConfig };
    expect(cfg.hooks).toBeUndefined();
    const auth = createAnonAuth(cfg);
    expect(auth).toBeDefined();
    expect(auth.router).toBeDefined();
  });

  it('compiles and constructs with hooks: {}', () => {
    const cfg: AnonAuthConfig = { ...baseConfig, hooks: {} };
    expect(cfg.hooks).toStrictEqual({});
    const auth = createAnonAuth(cfg);
    expect(auth).toBeDefined();
    expect(auth.router).toBeDefined();
  });
});

describe('HOOK-01: hooks threaded through createAnonAuth (no call sites wired)', () => {
  it('createAnonAuth accepts hooks without invoking them at construction time', () => {
    const afterAuthSuccess = vi.fn();
    const backfillKeyBundle = vi.fn();
    const onAuthEvent = vi.fn();
    const hooks: AnonAuthHooks = { afterAuthSuccess, backfillKeyBundle, onAuthEvent };

    const auth = createAnonAuth({ ...baseConfig, hooks });
    expect(auth).toBeDefined();

    // Phase 11 contract: hooks are accepted but NOT invoked during construction.
    // Call sites are installed in Phases 14 (afterAuthSuccess), 15 (backfillKeyBundle),
    // 13 (onAuthEvent). Until those phases land, all three must be silent here.
    expect(afterAuthSuccess).not.toHaveBeenCalled();
    expect(backfillKeyBundle).not.toHaveBeenCalled();
    expect(onAuthEvent).not.toHaveBeenCalled();
  });
});

describe('HOOK-01: hook call-site invariants (evolving across phases)', () => {
  // Per 11-RESEARCH.md Open Question #3 recommendation.
  // Originally a Phase 11 zero-invariant; updated as call sites land:
  //   - Phase 14: afterAuthSuccess wired in router.ts (register-finish + login-finish).
  //     OAuth router invokes via a local helper (runOAuthHook), which does not match this grep.
  //   - Phase 15: backfillKeyBundle will be wired (still 0 here).
  //   - Phase 13: onAuthEvent is invoked via wrapAnalytics(), not as hooks.onAuthEvent(...),
  //     so this grep still returns 0.

  it('grep finds 2 direct call sites for hooks.afterAuthSuccess( in src/server (Phase 14 wired)', () => {
    const out = execSync(
      'grep -r "hooks\\.afterAuthSuccess(" src/server | wc -l',
      { encoding: 'utf-8' }
    ).trim();
    expect(out).toBe('2');
  });

  it('grep finds zero call sites for hooks.backfillKeyBundle( (lands in Phase 15)', () => {
    const out = execSync(
      'grep -r "hooks\\.backfillKeyBundle(" src/server | wc -l',
      { encoding: 'utf-8' }
    ).trim();
    expect(out).toBe('0');
  });

  it('grep finds zero direct call sites for hooks.onAuthEvent( (Phase 13 invokes via wrapAnalytics)', () => {
    const out = execSync(
      'grep -r "hooks\\.onAuthEvent(" src/server | wc -l',
      { encoding: 'utf-8' }
    ).trim();
    expect(out).toBe('0');
  });
});
