/**
 * Validation Tests
 *
 * Tests for Zod schemas (SEC-05) and validateBody helper.
 * Schema tests call .safeParse() directly — no HTTP mocking needed.
 * validateBody tests use minimal mock req/res objects.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  registerStartBodySchema,
  registerFinishBodySchema,
  loginStartBodySchema,
  loginFinishBodySchema,
  logoutBodySchema,
  walletLinkBodySchema,
  walletVerifyBodySchema,
  walletStartBodySchema,
  walletFinishBodySchema,
  ipfsSetupBodySchema,
  ipfsRecoverBodySchema,
  oauthCallbackBodySchema,
  oauthLinkBodySchema,
} from '../server/validation/schemas.js';
import { validateBody } from '../server/validation/validateBody.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as import('express').Response;
}

function makeReq(body: unknown) {
  return { body } as import('express').Request;
}

// ---------------------------------------------------------------------------
// registerStartBodySchema — no body required
// ---------------------------------------------------------------------------

describe('registerStartBodySchema', () => {
  it('accepts empty object {}', () => {
    const result = registerStartBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts object with extra unknown fields (strip)', () => {
    const result = registerStartBodySchema.safeParse({ foo: 'bar' });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registerFinishBodySchema
// ---------------------------------------------------------------------------

const validRegisterFinishBody = {
  challengeId: 'abc123',
  tempUserId: 'xyz456',
  codename: 'ALPHA',
  response: {
    id: 'cred-id',
    rawId: 'cred-raw-id',
    type: 'public-key',
    response: {
      clientDataJSON: 'base64-client-data',
      attestationObject: 'base64-attestation',
    },
    clientExtensionResults: {},
  },
};

describe('registerFinishBodySchema', () => {
  it('accepts valid full payload', () => {
    const result = registerFinishBodySchema.safeParse(validRegisterFinishBody);
    expect(result.success).toBe(true);
  });

  it('accepts response with extra unknown browser extension properties (passthrough)', () => {
    const bodyWithExtras = {
      ...validRegisterFinishBody,
      response: {
        ...validRegisterFinishBody.response,
        authenticatorAttachment: 'platform', // vendor key at outer level
        response: {
          ...validRegisterFinishBody.response.response,
          transports: ['internal'], // vendor key in inner response
          publicKeyAlgorithm: -7,
        },
        clientExtensionResults: { credProps: { rk: true } },
      },
    };
    const result = registerFinishBodySchema.safeParse(bodyWithExtras);
    expect(result.success).toBe(true);
    // Extra keys should be preserved (passthrough)
    if (result.success) {
      expect((result.data.response as Record<string, unknown>).authenticatorAttachment).toBe('platform');
    }
  });

  it('rejects missing challengeId', () => {
    const { challengeId: _, ...body } = validRegisterFinishBody;
    const result = registerFinishBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rejects missing tempUserId', () => {
    const { tempUserId: _, ...body } = validRegisterFinishBody;
    const result = registerFinishBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rejects missing codename', () => {
    const { codename: _, ...body } = validRegisterFinishBody;
    const result = registerFinishBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rejects missing response', () => {
    const { response: _, ...body } = validRegisterFinishBody;
    const result = registerFinishBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rejects empty string challengeId', () => {
    const result = registerFinishBodySchema.safeParse({ ...validRegisterFinishBody, challengeId: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loginStartBodySchema — codename optional
// ---------------------------------------------------------------------------

describe('loginStartBodySchema', () => {
  it('accepts empty object {}', () => {
    const result = loginStartBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts { codename: "ALPHA" }', () => {
    const result = loginStartBodySchema.safeParse({ codename: 'ALPHA' });
    expect(result.success).toBe(true);
  });

  it('rejects codename as empty string', () => {
    const result = loginStartBodySchema.safeParse({ codename: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loginFinishBodySchema
// ---------------------------------------------------------------------------

const validLoginFinishBody = {
  challengeId: 'chal-123',
  response: {
    id: 'cred-id',
    rawId: 'cred-raw-id',
    type: 'public-key',
    response: {
      clientDataJSON: 'base64-client-data',
      authenticatorData: 'base64-auth-data',
      signature: 'base64-sig',
    },
    clientExtensionResults: {},
  },
};

describe('loginFinishBodySchema', () => {
  it('accepts valid full payload', () => {
    const result = loginFinishBodySchema.safeParse(validLoginFinishBody);
    expect(result.success).toBe(true);
  });

  it('accepts response with userHandle as optional', () => {
    const body = {
      ...validLoginFinishBody,
      response: {
        ...validLoginFinishBody.response,
        response: { ...validLoginFinishBody.response.response, userHandle: 'handle-val' },
      },
    };
    const result = loginFinishBodySchema.safeParse(body);
    expect(result.success).toBe(true);
  });

  it('rejects challengeId: 123 (number instead of string)', () => {
    const result = loginFinishBodySchema.safeParse({ ...validLoginFinishBody, challengeId: 123 });
    expect(result.success).toBe(false);
  });

  it('rejects missing challengeId', () => {
    const { challengeId: _, ...body } = validLoginFinishBody;
    const result = loginFinishBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('allows passthrough extra fields on credential response', () => {
    const body = {
      ...validLoginFinishBody,
      response: { ...validLoginFinishBody.response, authenticatorAttachment: 'cross-platform' },
    };
    const result = loginFinishBodySchema.safeParse(body);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// logoutBodySchema — no body
// ---------------------------------------------------------------------------

describe('logoutBodySchema', () => {
  it('accepts empty object {}', () => {
    const result = logoutBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// walletLinkBodySchema — no body
// ---------------------------------------------------------------------------

describe('walletLinkBodySchema', () => {
  it('accepts empty object {}', () => {
    const result = walletLinkBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// walletVerifyBodySchema — signature, challenge, walletAccountId required
// ---------------------------------------------------------------------------

const validWalletVerifyBody = {
  signature: 'base64sig',
  challenge: 'challenge-string',
  walletAccountId: 'alice.near',
};

describe('walletVerifyBodySchema', () => {
  it('accepts valid payload', () => {
    const result = walletVerifyBodySchema.safeParse(validWalletVerifyBody);
    expect(result.success).toBe(true);
  });

  it('rejects missing signature', () => {
    const { signature: _, ...body } = validWalletVerifyBody;
    const result = walletVerifyBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rejects missing challenge', () => {
    const { challenge: _, ...body } = validWalletVerifyBody;
    const result = walletVerifyBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rejects missing walletAccountId', () => {
    const { walletAccountId: _, ...body } = validWalletVerifyBody;
    const result = walletVerifyBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// walletStartBodySchema — no body
// ---------------------------------------------------------------------------

describe('walletStartBodySchema', () => {
  it('accepts empty object {}', () => {
    const result = walletStartBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// walletFinishBodySchema — signature, challenge, nearAccountId required
// ---------------------------------------------------------------------------

const validWalletFinishBody = {
  signature: 'base64sig',
  challenge: 'challenge-string',
  nearAccountId: 'alice.near',
};

describe('walletFinishBodySchema', () => {
  it('accepts valid payload', () => {
    const result = walletFinishBodySchema.safeParse(validWalletFinishBody);
    expect(result.success).toBe(true);
  });

  it('rejects missing signature', () => {
    const { signature: _, ...body } = validWalletFinishBody;
    const result = walletFinishBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rejects missing challenge', () => {
    const { challenge: _, ...body } = validWalletFinishBody;
    const result = walletFinishBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rejects missing nearAccountId', () => {
    const { nearAccountId: _, ...body } = validWalletFinishBody;
    const result = walletFinishBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ipfsSetupBodySchema — password required
// ---------------------------------------------------------------------------

describe('ipfsSetupBodySchema', () => {
  it('accepts valid payload with password', () => {
    const result = ipfsSetupBodySchema.safeParse({ password: 'super-secret-123' });
    expect(result.success).toBe(true);
  });

  it('rejects missing password', () => {
    const result = ipfsSetupBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty string password', () => {
    const result = ipfsSetupBodySchema.safeParse({ password: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ipfsRecoverBodySchema — cid and password required
// ---------------------------------------------------------------------------

describe('ipfsRecoverBodySchema', () => {
  it('accepts valid payload with cid and password', () => {
    const result = ipfsRecoverBodySchema.safeParse({ cid: 'QmXxx', password: 'secret' });
    expect(result.success).toBe(true);
  });

  it('rejects missing cid', () => {
    const result = ipfsRecoverBodySchema.safeParse({ password: 'secret' });
    expect(result.success).toBe(false);
  });

  it('rejects missing password', () => {
    const result = ipfsRecoverBodySchema.safeParse({ cid: 'QmXxx' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// oauthCallbackBodySchema — code and state required
// ---------------------------------------------------------------------------

describe('oauthCallbackBodySchema', () => {
  it('accepts valid payload with code and state', () => {
    const result = oauthCallbackBodySchema.safeParse({ code: 'auth-code', state: 'state-val' });
    expect(result.success).toBe(true);
  });

  it('rejects missing code', () => {
    const result = oauthCallbackBodySchema.safeParse({ state: 'state-val' });
    expect(result.success).toBe(false);
  });

  it('rejects missing state', () => {
    const result = oauthCallbackBodySchema.safeParse({ code: 'auth-code' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// oauthLinkBodySchema — code required, state and codeVerifier optional
// ---------------------------------------------------------------------------

describe('oauthLinkBodySchema', () => {
  it('accepts payload with only code', () => {
    const result = oauthLinkBodySchema.safeParse({ code: 'auth-code' });
    expect(result.success).toBe(true);
  });

  it('accepts payload with code, state, and codeVerifier', () => {
    const result = oauthLinkBodySchema.safeParse({
      code: 'auth-code',
      state: 'state-val',
      codeVerifier: 'verifier-val',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing code', () => {
    const result = oauthLinkBodySchema.safeParse({ state: 'state-val' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateBody helper
// ---------------------------------------------------------------------------

describe('validateBody', () => {
  it('returns typed data when schema passes', () => {
    const req = makeReq({ password: 'correct-pass' });
    const res = makeRes();
    const data = validateBody(ipfsSetupBodySchema, req, res);
    expect(data).not.toBeNull();
    expect(data?.password).toBe('correct-pass');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('sends res.status(400).json({ error }) and returns null on failure', () => {
    const req = makeReq({}); // missing password
    const res = makeRes();
    const data = validateBody(ipfsSetupBodySchema, req, res);
    expect(data).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it('returns null and sends 400 for type mismatch', () => {
    const req = makeReq({ challengeId: 123, response: {} }); // number instead of string
    const res = makeRes();
    const data = validateBody(loginFinishBodySchema, req, res);
    expect(data).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
