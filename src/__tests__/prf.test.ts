/**
 * WebAuthn PRF Extension Tests (PRF-02 through PRF-11)
 *
 * Covers:
 *   - PRF-02/03: extension request shape on create()/get()
 *   - PRF-04: getClientExtensionResults().prf.results.first extraction
 *   - PRF-05: ArrayBuffer → 64-char lowercase hex encoding
 *   - PRF-06/07: sealingKeyHex threading into /register/finish and /login/finish POST bodies
 *   - PRF-09: requirePrf:true rejection path
 *   - PRF-11: determinism per credential + divergence across credentials/salts
 *
 * Mock strategy: vitest runs in Node (no DOM). navigator.credentials is assigned to
 * globalThis in beforeEach. PRF output is deterministic HMAC-SHA-256(credKey, salt)
 * via node:crypto — same inputs always produce the same 32-byte ArrayBuffer.
 *
 * NOTE: The actual test bodies for createPasskey / authenticateWithPasskey / api.ts /
 * useAnonAuth assertions are fleshed out in Plans 02 and 03. This file is the Wave 0
 * scaffold: mock factories + globals setup + it.todo() placeholders for every PRF-* req.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

// ---------------------------------------------------------------------------
// Mock factories — deterministic HMAC-SHA-256 PRF output per (credKey, salt)
// ---------------------------------------------------------------------------

export type MockPublicKeyCredential = {
  id: string;
  rawId: ArrayBuffer;
  type: 'public-key';
  response: {
    clientDataJSON: ArrayBuffer;
    attestationObject?: ArrayBuffer;
    authenticatorData?: ArrayBuffer;
    signature?: ArrayBuffer;
    userHandle?: ArrayBuffer | null;
    getTransports?: () => string[];
  };
  getClientExtensionResults(): { prf?: { enabled?: boolean; results?: { first: ArrayBuffer } } };
  authenticatorAttachment?: 'platform' | 'cross-platform';
};

/**
 * Build a mock PublicKeyCredential whose getClientExtensionResults() returns
 * a deterministic PRF result: HMAC-SHA-256(credKey, prfSalt).
 */
export function makeMockCredentialWithPrf(credKey: Buffer, prfSalt: Uint8Array): MockPublicKeyCredential {
  const hmac = createHmac('sha256', credKey).update(prfSalt).digest();
  // Clone into a fresh ArrayBuffer so consumer code can read via new Uint8Array(prfResult).
  const prfArrayBuffer = hmac.buffer.slice(hmac.byteOffset, hmac.byteOffset + hmac.byteLength) as ArrayBuffer;
  return {
    id: credKey.toString('hex').slice(0, 32),
    rawId: credKey.buffer.slice(credKey.byteOffset, credKey.byteOffset + credKey.byteLength) as ArrayBuffer,
    type: 'public-key',
    response: {
      clientDataJSON: new ArrayBuffer(0),
      attestationObject: new ArrayBuffer(0),
      authenticatorData: new ArrayBuffer(0),
      signature: new ArrayBuffer(0),
      userHandle: null,
      getTransports: () => ['internal'],
    },
    getClientExtensionResults: () => ({
      prf: { results: { first: prfArrayBuffer } },
    }),
    authenticatorAttachment: 'platform',
  };
}

/**
 * Build a mock PublicKeyCredential whose getClientExtensionResults() returns no prf field —
 * simulates a Firefox-class authenticator where PRF is unsupported.
 */
export function makeMockCredentialNoPrf(credKey: Buffer): MockPublicKeyCredential {
  return {
    id: credKey.toString('hex').slice(0, 32),
    rawId: credKey.buffer.slice(credKey.byteOffset, credKey.byteOffset + credKey.byteLength) as ArrayBuffer,
    type: 'public-key',
    response: {
      clientDataJSON: new ArrayBuffer(0),
      attestationObject: new ArrayBuffer(0),
      authenticatorData: new ArrayBuffer(0),
      signature: new ArrayBuffer(0),
      userHandle: null,
      getTransports: () => ['internal'],
    },
    getClientExtensionResults: () => ({}),
    authenticatorAttachment: 'platform',
  };
}

// ---------------------------------------------------------------------------
// Global DOM stubs — vitest runs in Node; navigator.credentials is absent
// ---------------------------------------------------------------------------

beforeEach(() => {
  (globalThis as unknown as { navigator: Navigator }).navigator = {
    credentials: {
      create: vi.fn(),
      get: vi.fn(),
    },
  } as unknown as Navigator;
  (globalThis as unknown as { atob: typeof atob }).atob = (s: string) =>
    Buffer.from(s, 'base64').toString('binary');
  (globalThis as unknown as { btoa: typeof btoa }).btoa = (s: string) =>
    Buffer.from(s, 'binary').toString('base64');
  (globalThis as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = class {
    static isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(true);
  };
  (globalThis as unknown as { window: unknown }).window = {
    PublicKeyCredential: (globalThis as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential,
    navigator: (globalThis as unknown as { navigator: Navigator }).navigator,
  };
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Sanity — mock factory determinism (baseline assertions, always run)
// ---------------------------------------------------------------------------

describe('mock factory sanity (PRF-11 baseline)', () => {
  const salt = new TextEncoder().encode('near-phantom-auth-prf-v1');

  it('makeMockCredentialWithPrf returns 32-byte ArrayBuffer at prf.results.first', () => {
    const credKey = Buffer.alloc(32, 0xAB);
    const cred = makeMockCredentialWithPrf(credKey, salt);
    const result = cred.getClientExtensionResults().prf?.results?.first;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result?.byteLength).toBe(32);
  });

  it('same credKey + same salt → identical PRF bytes', () => {
    const credKey = Buffer.alloc(32, 0xAB);
    const a = makeMockCredentialWithPrf(credKey, salt).getClientExtensionResults().prf?.results?.first;
    const b = makeMockCredentialWithPrf(credKey, salt).getClientExtensionResults().prf?.results?.first;
    expect(Buffer.from(a!).toString('hex')).toBe(Buffer.from(b!).toString('hex'));
  });

  it('different credKey → different PRF bytes', () => {
    const a = makeMockCredentialWithPrf(Buffer.alloc(32, 0xAB), salt).getClientExtensionResults().prf?.results?.first;
    const b = makeMockCredentialWithPrf(Buffer.alloc(32, 0xCD), salt).getClientExtensionResults().prf?.results?.first;
    expect(Buffer.from(a!).toString('hex')).not.toBe(Buffer.from(b!).toString('hex'));
  });

  it('same credKey + different salt → different PRF bytes', () => {
    const credKey = Buffer.alloc(32, 0xAB);
    const altSalt = new TextEncoder().encode('different-salt-v2');
    const a = makeMockCredentialWithPrf(credKey, salt).getClientExtensionResults().prf?.results?.first;
    const b = makeMockCredentialWithPrf(credKey, altSalt).getClientExtensionResults().prf?.results?.first;
    expect(Buffer.from(a!).toString('hex')).not.toBe(Buffer.from(b!).toString('hex'));
  });

  it('makeMockCredentialNoPrf returns empty extension results', () => {
    const cred = makeMockCredentialNoPrf(Buffer.alloc(32, 0xEF));
    expect(cred.getClientExtensionResults().prf).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Placeholders — bodies filled by Plan 02 and Plan 03
// ---------------------------------------------------------------------------

describe('createPasskey PRF extraction (PRF-02, PRF-04, PRF-05, PRF-11)', () => {
  const salt = new TextEncoder().encode('near-phantom-auth-prf-v1');
  const minimalCreateOptions = {
    challenge: 'Y2hhbGxlbmdl',
    rp: { name: 'Test', id: 'localhost' },
    user: { id: 'dXNlcjE', name: 'user1', displayName: 'user1' },
    pubKeyCredParams: [{ alg: -7, type: 'public-key' as const }],
  };

  it('includes extensions.prf.eval.first in navigator.credentials.create publicKey options', async () => {
    const credKey = Buffer.alloc(32, 0x11);
    vi.mocked(globalThis.navigator.credentials.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMockCredentialWithPrf(credKey, salt) as unknown as PublicKeyCredential,
    );
    const { createPasskey } = await import('../client/passkey.js');
    await createPasskey(minimalCreateOptions, { salt });
    const createFn = globalThis.navigator.credentials.create as unknown as ReturnType<typeof vi.fn>;
    const arg = createFn.mock.calls[0][0];
    expect(arg.publicKey.extensions?.prf?.eval?.first).toBe(salt);
  });

  it('does NOT set extensions when prfOptions is omitted', async () => {
    const credKey = Buffer.alloc(32, 0x22);
    vi.mocked(globalThis.navigator.credentials.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMockCredentialNoPrf(credKey) as unknown as PublicKeyCredential,
    );
    const { createPasskey } = await import('../client/passkey.js');
    await createPasskey(minimalCreateOptions);
    const createFn = globalThis.navigator.credentials.create as unknown as ReturnType<typeof vi.fn>;
    const arg = createFn.mock.calls[0][0];
    expect(arg.publicKey.extensions).toBeUndefined();
  });

  it('returns 64-char lowercase hex sealingKeyHex for 32-byte PRF output', async () => {
    const credKey = Buffer.alloc(32, 0x33);
    vi.mocked(globalThis.navigator.credentials.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMockCredentialWithPrf(credKey, salt) as unknown as PublicKeyCredential,
    );
    const { createPasskey } = await import('../client/passkey.js');
    const result = await createPasskey(minimalCreateOptions, { salt });
    expect(result.sealingKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns undefined sealingKeyHex when ext.prf.results.first is absent', async () => {
    const credKey = Buffer.alloc(32, 0x44);
    vi.mocked(globalThis.navigator.credentials.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMockCredentialNoPrf(credKey) as unknown as PublicKeyCredential,
    );
    const { createPasskey } = await import('../client/passkey.js');
    const result = await createPasskey(minimalCreateOptions, { salt });
    expect(result.sealingKeyHex).toBeUndefined();
  });

  it('same credKey + same salt → identical sealingKeyHex (determinism)', async () => {
    const credKey = Buffer.alloc(32, 0x55);
    const createMock = vi.mocked(globalThis.navigator.credentials.create as unknown as ReturnType<typeof vi.fn>);
    const { createPasskey } = await import('../client/passkey.js');

    createMock.mockResolvedValueOnce(makeMockCredentialWithPrf(credKey, salt) as unknown as PublicKeyCredential);
    const a = await createPasskey(minimalCreateOptions, { salt });
    createMock.mockResolvedValueOnce(makeMockCredentialWithPrf(credKey, salt) as unknown as PublicKeyCredential);
    const b = await createPasskey(minimalCreateOptions, { salt });
    expect(a.sealingKeyHex).toBe(b.sealingKeyHex);
  });

  it('different credKey → different sealingKeyHex (divergence)', async () => {
    const createMock = vi.mocked(globalThis.navigator.credentials.create as unknown as ReturnType<typeof vi.fn>);
    const { createPasskey } = await import('../client/passkey.js');

    createMock.mockResolvedValueOnce(makeMockCredentialWithPrf(Buffer.alloc(32, 0x66), salt) as unknown as PublicKeyCredential);
    const a = await createPasskey(minimalCreateOptions, { salt });
    createMock.mockResolvedValueOnce(makeMockCredentialWithPrf(Buffer.alloc(32, 0x77), salt) as unknown as PublicKeyCredential);
    const b = await createPasskey(minimalCreateOptions, { salt });
    expect(a.sealingKeyHex).not.toBe(b.sealingKeyHex);
  });

  it('same credKey + different salt → different sealingKeyHex (divergence)', async () => {
    const credKey = Buffer.alloc(32, 0x88);
    const altSalt = new TextEncoder().encode('different-salt-v2');
    const createMock = vi.mocked(globalThis.navigator.credentials.create as unknown as ReturnType<typeof vi.fn>);
    const { createPasskey } = await import('../client/passkey.js');

    createMock.mockResolvedValueOnce(makeMockCredentialWithPrf(credKey, salt) as unknown as PublicKeyCredential);
    const a = await createPasskey(minimalCreateOptions, { salt });
    createMock.mockResolvedValueOnce(makeMockCredentialWithPrf(credKey, altSalt) as unknown as PublicKeyCredential);
    const b = await createPasskey(minimalCreateOptions, { salt: altSalt });
    expect(a.sealingKeyHex).not.toBe(b.sealingKeyHex);
  });
});

describe('authenticateWithPasskey PRF extraction (PRF-03, PRF-04, PRF-05)', () => {
  const salt = new TextEncoder().encode('near-phantom-auth-prf-v1');
  const minimalGetOptions = { challenge: 'Y2hhbGxlbmdl' };

  it('includes extensions.prf.eval.first in navigator.credentials.get publicKey options', async () => {
    const credKey = Buffer.alloc(32, 0xA1);
    vi.mocked(globalThis.navigator.credentials.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMockCredentialWithPrf(credKey, salt) as unknown as PublicKeyCredential,
    );
    const { authenticateWithPasskey } = await import('../client/passkey.js');
    await authenticateWithPasskey(minimalGetOptions, { salt });
    const getFn = globalThis.navigator.credentials.get as unknown as ReturnType<typeof vi.fn>;
    const arg = getFn.mock.calls[0][0];
    expect(arg.publicKey.extensions?.prf?.eval?.first).toBe(salt);
  });

  it('returns 64-char lowercase hex sealingKeyHex for 32-byte PRF output', async () => {
    const credKey = Buffer.alloc(32, 0xA2);
    vi.mocked(globalThis.navigator.credentials.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMockCredentialWithPrf(credKey, salt) as unknown as PublicKeyCredential,
    );
    const { authenticateWithPasskey } = await import('../client/passkey.js');
    const result = await authenticateWithPasskey(minimalGetOptions, { salt });
    expect(result.sealingKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns undefined sealingKeyHex when ext.prf.results.first is absent', async () => {
    const credKey = Buffer.alloc(32, 0xA3);
    vi.mocked(globalThis.navigator.credentials.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMockCredentialNoPrf(credKey) as unknown as PublicKeyCredential,
    );
    const { authenticateWithPasskey } = await import('../client/passkey.js');
    const result = await authenticateWithPasskey(minimalGetOptions, { salt });
    expect(result.sealingKeyHex).toBeUndefined();
  });
});

describe('api.finishRegistration body threading (PRF-06)', () => {
  it('includes sealingKeyHex in POST /register/finish body when defined', async () => {
    const { createApiClient } = await import('../client/api.js');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, codename: 'ALPHA-7', nearAccountId: 'alpha7.testnet' }),
    });
    const api = createApiClient({ baseUrl: '/auth', fetch: fetchMock as unknown as typeof fetch });

    await api.finishRegistration('ch-1', {} as unknown as Parameters<typeof api.finishRegistration>[1], 'tmp-1', 'ALPHA-7', 'myuser', 'a'.repeat(64));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.sealingKeyHex).toBe('a'.repeat(64));
    expect(body.challengeId).toBe('ch-1');
    expect(body.tempUserId).toBe('tmp-1');
    expect(body.codename).toBe('ALPHA-7');
    expect(body.username).toBe('myuser');
  });

  it('omits sealingKeyHex key entirely from POST body when undefined (not sent as null)', async () => {
    const { createApiClient } = await import('../client/api.js');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, codename: 'ALPHA-7', nearAccountId: 'alpha7.testnet' }),
    });
    const api = createApiClient({ baseUrl: '/auth', fetch: fetchMock as unknown as typeof fetch });

    await api.finishRegistration('ch-1', {} as unknown as Parameters<typeof api.finishRegistration>[1], 'tmp-1', 'ALPHA-7', 'myuser');

    const rawBody: string = fetchMock.mock.calls[0][1].body;
    expect(rawBody).not.toContain('sealingKeyHex');
    const parsed = JSON.parse(rawBody);
    expect('sealingKeyHex' in parsed).toBe(false);
  });

  it('omits sealingKeyHex key when passed undefined explicitly', async () => {
    const { createApiClient } = await import('../client/api.js');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, codename: 'ALPHA-7', nearAccountId: 'alpha7.testnet' }),
    });
    const api = createApiClient({ baseUrl: '/auth', fetch: fetchMock as unknown as typeof fetch });

    await api.finishRegistration('ch-1', {} as unknown as Parameters<typeof api.finishRegistration>[1], 'tmp-1', 'ALPHA-7', 'myuser', undefined);

    const rawBody: string = fetchMock.mock.calls[0][1].body;
    expect(rawBody).not.toContain('sealingKeyHex');
  });
});

describe('api.finishAuthentication body threading (PRF-07)', () => {
  it('includes sealingKeyHex in POST /login/finish body when defined', async () => {
    const { createApiClient } = await import('../client/api.js');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, codename: 'ALPHA-7' }),
    });
    const api = createApiClient({ baseUrl: '/auth', fetch: fetchMock as unknown as typeof fetch });

    await api.finishAuthentication('ch-2', {} as unknown as Parameters<typeof api.finishAuthentication>[1], 'b'.repeat(64));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.sealingKeyHex).toBe('b'.repeat(64));
    expect(body.challengeId).toBe('ch-2');
  });

  it('omits sealingKeyHex key entirely from POST body when undefined', async () => {
    const { createApiClient } = await import('../client/api.js');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, codename: 'ALPHA-7' }),
    });
    const api = createApiClient({ baseUrl: '/auth', fetch: fetchMock as unknown as typeof fetch });

    await api.finishAuthentication('ch-2', {} as unknown as Parameters<typeof api.finishAuthentication>[1]);

    const rawBody: string = fetchMock.mock.calls[0][1].body;
    expect(rawBody).not.toContain('sealingKeyHex');
  });
});

describe('useAnonAuth requirePrf rejection (PRF-09) — filled by Plan 03', () => {
  it.todo('rejects register() with Error when passkey.requirePrf=true and PRF unsupported');
  it.todo('completes register() silently when passkey.requirePrf=false and PRF unsupported');
});
