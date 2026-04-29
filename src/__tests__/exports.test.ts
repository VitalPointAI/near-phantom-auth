/**
 * Exports Regression Tests — MPC-01
 *
 * Locks in the v0.6.1 hotfix: MPCAccountManager must be a runtime VALUE
 * export from '@vitalpoint/near-phantom-auth/server', not a type-only export.
 *
 * Bug history: v0.6.0 shipped with `export type { MPCAccountManager }` in
 * src/server/index.ts line 260. TypeScript stripped the class constructor at
 * compile time, leaving consumers with `import { MPCAccountManager }` resolving
 * to undefined at runtime. This file guards against regression.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  MPCAccountManager,
  type MPCAccountManagerConfig,
  type CreateAccountResult,
  type MPCConfig,
  type MPCAccount,
  type RelatedOrigin,         // Phase 12 RPID-01
} from '../server/index.js';

describe('MPC-01: MPCAccountManager runtime export', () => {
  it('imports as a function (class constructor), not undefined', () => {
    expect(MPCAccountManager).toBeDefined();
    expect(typeof MPCAccountManager).toBe('function');
  });

  it('can be instantiated without throwing', () => {
    expect(() => new MPCAccountManager({
      networkId: 'testnet',
      derivationSalt: 'phase10-export-test-salt',
    })).not.toThrow();
  });

  it('exposes createAccount and verifyRecoveryWallet methods on instances', () => {
    const m = new MPCAccountManager({
      networkId: 'testnet',
      derivationSalt: 'phase10-export-test-salt',
    });
    expect(typeof m.createAccount).toBe('function');
    expect(typeof m.verifyRecoveryWallet).toBe('function');
  });
});

describe('MPC-01: type aliases are re-exported', () => {
  it('MPCAccountManagerConfig type is re-exported from /server', () => {
    // Compile-time check — if the type is not re-exported, tsc --noEmit
    // fails before this test runs.
    const cfg: MPCAccountManagerConfig = {
      networkId: 'testnet',
      treasuryAccount: 't.testnet',
      treasuryPrivateKey: 'ed25519:placeholder',
      derivationSalt: 'salt',
    };
    expect(cfg.derivationSalt).toBe('salt');
  });

  it('CreateAccountResult type is re-exported from /server', () => {
    const r: CreateAccountResult = {
      nearAccountId: '0'.repeat(64),
      derivationPath: 'near-anon-auth,test',
      mpcPublicKey: 'ed25519:abc',
      onChain: false,
    };
    expect(r.nearAccountId).toHaveLength(64);
  });

  it('MPCConfig and MPCAccount types remain exported (v0.6.0 backward compat)', () => {
    const c: MPCConfig = { networkId: 'testnet' };
    const a: MPCAccount = {
      nearAccountId: '0'.repeat(64),
      derivationPath: 'p',
      mpcPublicKey: 'ed25519:k',
      onChain: false,
    };
    expect(c.networkId).toBe('testnet');
    expect(a.onChain).toBe(false);
  });
});

describe('MPC-01: source-level export shape', () => {
  it('src/server/index.ts contains a VALUE export of MPCAccountManager', () => {
    const source = readFileSync(join(process.cwd(), 'src/server/index.ts'), 'utf-8');
    // Must contain `export { MPCAccountManager }` — value export, not `export type`
    expect(source).toMatch(/^export \{ MPCAccountManager.*\} from '\.\/mpc\.js';/m);
  });

  it('src/server/index.ts does NOT contain a type-only export of MPCAccountManager', () => {
    const source = readFileSync(join(process.cwd(), 'src/server/index.ts'), 'utf-8');
    // Should not match `export type { MPCAccountManager,` (the old broken form)
    expect(source).not.toMatch(/^export type \{ MPCAccountManager,/m);
  });
});

describe('RPID-01: RelatedOrigin type is re-exported from /server', () => {
  it('RelatedOrigin type is importable as a type alias', () => {
    // Compile-time check — if the type is not re-exported, tsc --noEmit
    // fails before this test runs.
    const ro: RelatedOrigin = {
      origin: 'https://shopping.co.uk',
      rpId: 'shopping.co.uk',
    };
    expect(ro.origin).toBe('https://shopping.co.uk');
    expect(ro.rpId).toBe('shopping.co.uk');
  });

  it('src/server/index.ts contains a type re-export of RelatedOrigin', () => {
    const source = readFileSync(join(process.cwd(), 'src/server/index.ts'), 'utf-8');
    // Must appear inside the `export type { ... }` block alongside AnonAuthHooks
    expect(source).toMatch(/export type \{[^}]*\bRelatedOrigin\b[^}]*\} from '\.\.\/types\/index\.js';/s);
  });
});

const distPath = join(process.cwd(), 'dist/server/index.js');
const haveDist = existsSync(distPath);

describe.skipIf(!haveDist)('MPC-01: build artifact contains the runtime export', () => {
  it('dist/server/index.js exports MPCAccountManager (value, not type-erased)', () => {
    const distSource = readFileSync(distPath, 'utf-8');
    const hasNamedExport = /export\s*\{[^}]*\bMPCAccountManager\b[^}]*\}/.test(distSource);
    const hasModuleExport = /\bMPCAccountManager\s*[:=]/.test(distSource);
    expect(hasNamedExport || hasModuleExport).toBe(true);
  });

  it('imported from dist, MPCAccountManager is a function at runtime', async () => {
    const mod = await import(distPath);
    expect(typeof mod.MPCAccountManager).toBe('function');
  });
});
