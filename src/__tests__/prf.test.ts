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

describe('createPasskey PRF extraction (PRF-02, PRF-04, PRF-05) — filled by Plan 02', () => {
  it.todo('includes extensions.prf.eval.first in navigator.credentials.create publicKey options');
  it.todo('returns 64-char lowercase hex sealingKeyHex for 32-byte PRF output');
  it.todo('returns undefined sealingKeyHex when ext.prf.results.first is absent');
  it.todo('same credKey + same salt → identical sealingKeyHex (determinism)');
  it.todo('different credKey → different sealingKeyHex (divergence)');
  it.todo('same credKey + different salt → different sealingKeyHex (divergence)');
});

describe('authenticateWithPasskey PRF extraction (PRF-03, PRF-04, PRF-05) — filled by Plan 02', () => {
  it.todo('includes extensions.prf.eval.first in navigator.credentials.get publicKey options');
  it.todo('returns 64-char lowercase hex sealingKeyHex for 32-byte PRF output');
  it.todo('returns undefined sealingKeyHex when ext.prf.results.first is absent');
});

describe('api.finishRegistration body threading (PRF-06) — filled by Plan 02', () => {
  it.todo('includes sealingKeyHex in POST /register/finish body when defined');
  it.todo('omits sealingKeyHex key entirely from POST body when undefined (not sent as null)');
});

describe('api.finishAuthentication body threading (PRF-07) — filled by Plan 02', () => {
  it.todo('includes sealingKeyHex in POST /login/finish body when defined');
  it.todo('omits sealingKeyHex key entirely from POST body when undefined');
});

describe('useAnonAuth requirePrf rejection (PRF-09) — filled by Plan 03', () => {
  it.todo('rejects register() with Error when passkey.requirePrf=true and PRF unsupported');
  it.todo('completes register() silently when passkey.requirePrf=false and PRF unsupported');
});
