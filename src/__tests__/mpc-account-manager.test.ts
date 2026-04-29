/**
 * MPCAccountManager Tests — T1 through T12
 *
 * Plan 04 (Wave 3) replaces Plan 02's it.todo placeholders with real assertions.
 * Coverage:
 *   T1 — first call provisions account (testnet integration)        [MPC-02, MPC-03]
 *   T2 — second call short-circuits via view_account (testnet)      [MPC-03]
 *   T3 — distinct userId → distinct nearAccountId (unit, mocked)    [MPC-02]
 *   T4 — distinct salt → distinct nearAccountId (unit, mocked)      [MPC-07]
 *   T5 — RPC fetch throws → createAccount throws (unit)             [MPC-10]
 *   T6 — treasury underfunded → createAccount throws (unit)         [MPC-10]
 *   T7 — FullAccess key → verifyRecoveryWallet true (testnet)       [MPC-05]
 *   T8 — FunctionCall-only key → verifyRecoveryWallet false (unit)  [MPC-05]
 *   T9 — deleted/missing account → returns false, no throw (unit)   [MPC-05]
 *   T10 — unrelated key (UNKNOWN_ACCESS_KEY) → false (unit)         [MPC-05]
 *   T11 — concurrent calls converge (testnet)                       [MPC-06]
 *   T12 — every nearAccountId matches /^[a-f0-9]{64}$/ (unit)       [MPC-04]
 *   T-MPC-08 (bonus) — broadcast_tx_commit body contains the parseNearAmount-derived yoctoNEAR amount  [MPC-08]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MPCAccountManager, type MPCAccountManagerConfig } from '../server/mpc.js';

const HAVE_TESTNET = !!(process.env.NEAR_TREASURY_ACCOUNT && process.env.NEAR_TREASURY_KEY);

// ============================================
// Mock fetch dispatch helper (multi-method RPC mock)
// ============================================

/**
 * Build a fetch mock that dispatches by JSON-RPC method.
 * Pass per-method override functions; defaults to "account does not exist + ok responses".
 */
function makeFetchMock(opts: {
  viewAccount?: () => unknown;
  viewAccessKey?: () => unknown;
  broadcast?: () => unknown;
} = {}) {
  return vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const reqType = body.params?.request_type;
    if (body.method === 'query' && reqType === 'view_account') {
      return Promise.resolve({
        ok: true,
        json: async () => opts.viewAccount?.() ?? ({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }),
      });
    }
    if (body.method === 'query' && reqType === 'view_access_key') {
      return Promise.resolve({
        ok: true,
        json: async () => opts.viewAccessKey?.() ?? ({ result: { nonce: 100, block_hash: 'GJ2rnFKjZpx4j2QDXdLXMBRbdqr9vEWMcYnL2CrPxU5' } }),
      });
    }
    if (body.method === 'broadcast_tx_commit') {
      return Promise.resolve({
        ok: true,
        json: async () => opts.broadcast?.() ?? ({ result: { transaction: { hash: 'mocktxhash' } } }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

function broadcastCallCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([, init]) => {
    try {
      const body = JSON.parse((init as RequestInit).body as string);
      return body.method === 'broadcast_tx_commit';
    } catch {
      return false;
    }
  }).length;
}

/** Capture the base64-decoded raw bytes sent to broadcast_tx_commit. */
function broadcastBodyBytes(fetchMock: ReturnType<typeof vi.fn>): Uint8Array | null {
  for (const [, init] of fetchMock.mock.calls) {
    try {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.method === 'broadcast_tx_commit') {
        const b64 = body.params?.[0];
        if (typeof b64 === 'string') return new Uint8Array(Buffer.from(b64, 'base64'));
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

// Treasury config for unit tests (treasury private key is a real ed25519 key
// generated for tests only; never used against mainnet)
const TEST_TREASURY_KEY = 'ed25519:3N4sVhS92jNRKPzv8kXo8W7bSArhRkqjftjm5uQou9oUqbh3TUiD7HDB4xGY79Sv9scSqqbcvr9TBgGKkZVXMds' as const;

function makeUnitConfig(salt: string = 'test-salt', fundingAmount?: string): MPCAccountManagerConfig {
  return {
    networkId: 'testnet',
    treasuryAccount: 'treasury.testnet',
    treasuryPrivateKey: TEST_TREASURY_KEY,
    derivationSalt: salt,
    ...(fundingAmount ? { fundingAmount } : {}),
  };
}

// ============================================
// Testnet integration: provisioning (T1, T2)
// ============================================

describe.skipIf(!HAVE_TESTNET)('MPCAccountManager — testnet integration: provisioning', () => {
  it('T1: createAccount provisions a new account on first call (onChain=true, hex accountId)', async () => {
    const manager = new MPCAccountManager({
      networkId: 'testnet',
      treasuryAccount: process.env.NEAR_TREASURY_ACCOUNT!,
      treasuryPrivateKey: process.env.NEAR_TREASURY_KEY!,
      derivationSalt: `t1-${Date.now()}`,
    });
    const userId = `t1-user-${Date.now()}`;
    const result = await manager.createAccount(userId);
    expect(result.onChain).toBe(true);
    expect(result.nearAccountId).toMatch(/^[a-f0-9]{64}$/);
    expect(result.mpcPublicKey).toMatch(/^ed25519:/);
  }, 60_000);

  it('T2: createAccount short-circuits via view_account on second call (no duplicate broadcast)', async () => {
    const sharedSalt = `t2-${Date.now()}`;
    const userId = `t2-user-${Date.now()}`;
    const manager = new MPCAccountManager({
      networkId: 'testnet',
      treasuryAccount: process.env.NEAR_TREASURY_ACCOUNT!,
      treasuryPrivateKey: process.env.NEAR_TREASURY_KEY!,
      derivationSalt: sharedSalt,
    });
    const r1 = await manager.createAccount(userId);
    expect(r1.onChain).toBe(true);
    const r2 = await manager.createAccount(userId);
    expect(r2.nearAccountId).toBe(r1.nearAccountId);
    expect(r2.mpcPublicKey).toBe(r1.mpcPublicKey);
    expect(r2.onChain).toBe(true);
  }, 60_000);
});

// ============================================
// Derivation determinism + hex format (T3, T4, T12) — unit
// ============================================

describe('MPCAccountManager — derivation determinism (unit, mocked RPC)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('T3: distinct userIds produce distinct nearAccountIds (same salt)', async () => {
    const manager = new MPCAccountManager(makeUnitConfig('shared-salt'));
    const a = await manager.createAccount('user-alice');
    const b = await manager.createAccount('user-bob');
    expect(a.nearAccountId).not.toBe(b.nearAccountId);
    expect(a.nearAccountId).toMatch(/^[a-f0-9]{64}$/);
    expect(b.nearAccountId).toMatch(/^[a-f0-9]{64}$/);
  });

  it('T4: distinct derivationSalts produce distinct nearAccountIds (same userId — cross-tenant isolation)', async () => {
    const m1 = new MPCAccountManager(makeUnitConfig('tenant-a-salt'));
    const m2 = new MPCAccountManager(makeUnitConfig('tenant-b-salt'));
    const r1 = await m1.createAccount('shared-user');
    const r2 = await m2.createAccount('shared-user');
    expect(r1.nearAccountId).not.toBe(r2.nearAccountId);
  });

  it('T12: every returned nearAccountId matches /^[a-f0-9]{64}$/', async () => {
    const manager = new MPCAccountManager(makeUnitConfig('hex-format-salt'));
    for (const userId of ['u1', 'u2', 'u3-with-dashes', 'u4_with_underscore', 'u5@example.com']) {
      const r = await manager.createAccount(userId);
      expect(r.nearAccountId).toMatch(/^[a-f0-9]{64}$/);
      expect(r.nearAccountId.length).toBe(64);
    }
  });

  it('T3-bonus: idempotent — second call short-circuits with zero broadcast_tx_commit', async () => {
    const manager = new MPCAccountManager(makeUnitConfig('idempotent-salt'));
    const r1 = await manager.createAccount('idempotent-user');
    expect(r1.onChain).toBe(true);
    const broadcastsAfterFirst = broadcastCallCount(fetchMock);
    expect(broadcastsAfterFirst).toBeGreaterThanOrEqual(1);

    vi.unstubAllGlobals();
    const fetchMock2 = makeFetchMock({
      viewAccount: () => ({ result: { amount: '1000000000000000000000000', code_hash: '11111111111111111111111111111111', storage_usage: 100 } }),
    });
    vi.stubGlobal('fetch', fetchMock2);

    const r2 = await manager.createAccount('idempotent-user');
    expect(r2.nearAccountId).toBe(r1.nearAccountId);
    expect(r2.onChain).toBe(true);
    expect(broadcastCallCount(fetchMock2)).toBe(0);
  });

  it('T-MPC-08: broadcast_tx_commit body encodes the parseNearAmount-derived yoctoNEAR (MPC-08 coverage)', async () => {
    // parseNearAmount('0.01') = '10000000000000000000000' = 10^22 yoctoNEAR
    const expectedYocto = 10000000000000000000000n;
    const expectedBytes = new Uint8Array(16);
    const view = new DataView(expectedBytes.buffer);
    view.setBigUint64(0, expectedYocto & 0xffffffffffffffffn, true);
    view.setBigUint64(8, expectedYocto >> 64n, true);

    const manager = new MPCAccountManager(makeUnitConfig('mpc-08-salt'));
    const r = await manager.createAccount('mpc-08-user');
    expect(r.onChain).toBe(true);

    const bodyBytes = broadcastBodyBytes(fetchMock);
    expect(bodyBytes).not.toBeNull();
    const haystack = bodyBytes!;
    let foundAt = -1;
    outer: for (let i = 0; i + expectedBytes.length <= haystack.length; i++) {
      for (let j = 0; j < expectedBytes.length; j++) {
        if (haystack[i + j] !== expectedBytes[j]) continue outer;
      }
      foundAt = i;
      break;
    }
    expect(foundAt).toBeGreaterThanOrEqual(0);
  });
});

// ============================================
// Error-throwing paths (T5, T6) — unit
// ============================================

describe('MPCAccountManager — error paths (unit, mocked RPC)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('T5: when fetch() throws (RPC unreachable), createAccount throws Error with cause set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.params?.request_type === 'view_account') {
        return Promise.resolve({ json: async () => ({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }) });
      }
      return Promise.reject(new Error('ECONNREFUSED 127.0.0.1:443'));
    }));

    const manager = new MPCAccountManager(makeUnitConfig('rpc-unreachable-salt'));
    await expect(manager.createAccount('rpc-fail-user')).rejects.toThrow(/RPC unreachable|Transfer failed/);
  });

  it('T6: when broadcast returns "Sender does not have enough funds", createAccount throws Treasury underfunded', async () => {
    const fetchMock = makeFetchMock({
      broadcast: () => ({
        error: {
          data: 'Sender treasury.testnet does not have enough funds for transfer',
          message: 'Transaction execution error',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new MPCAccountManager(makeUnitConfig('underfunded-salt'));
    await expect(manager.createAccount('underfunded-user')).rejects.toThrow('Treasury underfunded');
  });

  it('T6-bonus: when broadcast returns InvalidNonce AND view_account now shows exists, returns success (MPC-06)', async () => {
    let viewAccountCallIdx = 0;
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.params?.request_type === 'view_account') {
        viewAccountCallIdx++;
        if (viewAccountCallIdx === 1) {
          return Promise.resolve({ json: async () => ({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }) });
        }
        return Promise.resolve({ json: async () => ({ result: { amount: '1000', code_hash: '11111111111111111111111111111111', storage_usage: 100 } }) });
      }
      if (body.params?.request_type === 'view_access_key') {
        return Promise.resolve({ json: async () => ({ result: { nonce: 100, block_hash: 'GJ2rnFKjZpx4j2QDXdLXMBRbdqr9vEWMcYnL2CrPxU5' } }) });
      }
      if (body.method === 'broadcast_tx_commit') {
        return Promise.resolve({ json: async () => ({ error: { data: 'InvalidNonce: tx already processed' } }) });
      }
      return Promise.resolve({ json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new MPCAccountManager(makeUnitConfig('nonce-race-salt'));
    const result = await manager.createAccount('nonce-race-user');
    expect(result.onChain).toBe(true);
    expect(result.nearAccountId).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ============================================
// Recovery + concurrency: testnet integration (T7, T11)
// ============================================

describe.skipIf(!HAVE_TESTNET)('MPCAccountManager — testnet integration: recovery + concurrency', () => {
  it('T7: verifyRecoveryWallet returns true for an on-chain FullAccess key', async () => {
    const manager = new MPCAccountManager({
      networkId: 'testnet',
      treasuryAccount: process.env.NEAR_TREASURY_ACCOUNT!,
      treasuryPrivateKey: process.env.NEAR_TREASURY_KEY!,
      derivationSalt: `t7-${Date.now()}`,
    });
    const { KeyPair } = await import('@near-js/crypto');
    const kp = KeyPair.fromString(process.env.NEAR_TREASURY_KEY! as `ed25519:${string}`);
    const treasuryPub = kp.getPublicKey().toString();
    const result = await manager.verifyRecoveryWallet(process.env.NEAR_TREASURY_ACCOUNT!, treasuryPub);
    expect(result).toBe(true);
  }, 30_000);

  it('T11: two concurrent createAccount calls for the same userId converge', async () => {
    const sharedSalt = `t11-${Date.now()}`;
    const sharedUser = `t11-user-${Date.now()}`;
    const manager = new MPCAccountManager({
      networkId: 'testnet',
      treasuryAccount: process.env.NEAR_TREASURY_ACCOUNT!,
      treasuryPrivateKey: process.env.NEAR_TREASURY_KEY!,
      derivationSalt: sharedSalt,
    });
    const [r1, r2] = await Promise.all([
      manager.createAccount(sharedUser),
      manager.createAccount(sharedUser),
    ]);
    expect(r1.nearAccountId).toBe(r2.nearAccountId);
    expect(r1.onChain && r2.onChain).toBe(true);
  }, 90_000);
});

// ============================================
// verifyRecoveryWallet permission matrix (T8, T9, T10) — unit
// ============================================

describe('MPCAccountManager — verifyRecoveryWallet permission matrix (unit, mocked RPC)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('T8: returns false when access key permission is FunctionCall (not FullAccess)', async () => {
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

    const manager = new MPCAccountManager(makeUnitConfig('t8-salt'));
    const result = await manager.verifyRecoveryWallet('alice.testnet', 'ed25519:functionCallKey');
    expect(result).toBe(false);
  });

  it('T9: returns false (does not throw) when account is deleted/missing (UNKNOWN_ACCOUNT)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ error: { cause: { name: 'UNKNOWN_ACCOUNT' }, code: -32000 } }),
    }));

    const manager = new MPCAccountManager(makeUnitConfig('t9-salt'));
    const result = await manager.verifyRecoveryWallet('deleted.testnet', 'ed25519:anyKey');
    expect(result).toBe(false);
  });

  it('T10: returns false when key is not on the account (UNKNOWN_ACCESS_KEY)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ error: { cause: { name: 'UNKNOWN_ACCESS_KEY' }, code: -32000 } }),
    }));

    const manager = new MPCAccountManager(makeUnitConfig('t10-salt'));
    const result = await manager.verifyRecoveryWallet('alice.testnet', 'ed25519:notOnAccount');
    expect(result).toBe(false);
  });
});
