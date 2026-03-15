/**
 * Passkey Manager Unit Tests (TEST-02)
 *
 * Tests registration and authentication lifecycles with mocked @simplewebauthn/server.
 * Covers: startRegistration, finishRegistration, startAuthentication, finishAuthentication.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPasskeyManager } from '../server/passkey.js';
import type { DatabaseAdapter, Challenge, Passkey } from '../types/index.js';

// ============================================
// Module-level mock for @simplewebauthn/server
// ============================================

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    challenge: 'test-challenge-base64',
    rp: { name: 'Test', id: 'localhost' },
    user: { id: 'dXNlci0x', name: 'user-1', displayName: 'user-1' },
    pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    timeout: 60000,
    attestation: 'none',
  }),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'credential-id-1',
        publicKey: new Uint8Array(32).fill(0xAB),
        counter: 0,
      },
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
    },
  }),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: 'test-auth-challenge',
    rpId: 'localhost',
    allowCredentials: [],
    timeout: 60000,
  }),
  verifyAuthenticationResponse: vi.fn().mockResolvedValue({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  }),
}));

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

// ============================================
// Mock helpers
// ============================================

const MOCK_PASSKEY: Passkey = {
  credentialId: 'credential-id-1',
  userId: 'user-1',
  publicKey: new Uint8Array(32).fill(0xAB),
  counter: 0,
  deviceType: 'singleDevice',
  backedUp: false,
  transports: ['internal'],
  createdAt: new Date(),
};

function makeMockDb(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
  const challenges = new Map<string, Challenge>();

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
    getPasskeyById: vi.fn().mockResolvedValue(MOCK_PASSKEY),
    getPasskeysByUserId: vi.fn().mockResolvedValue([MOCK_PASSKEY]),
    updatePasskeyCounter: vi.fn().mockResolvedValue(undefined),
    deletePasskey: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    deleteUserSessions: vi.fn().mockResolvedValue(undefined),
    cleanExpiredSessions: vi.fn().mockResolvedValue(0),
    storeChallenge: vi.fn().mockImplementation(async (challenge: Challenge) => {
      challenges.set(challenge.id, challenge);
    }),
    getChallenge: vi.fn().mockImplementation(async (challengeId: string) => {
      return challenges.get(challengeId) ?? null;
    }),
    deleteChallenge: vi.fn().mockImplementation(async (challengeId: string) => {
      challenges.delete(challengeId);
    }),
    storeRecoveryData: vi.fn(),
    getRecoveryData: vi.fn(),
    ...overrides,
  };
}

const testConfig = { rpName: 'Test', rpId: 'localhost', origin: 'http://localhost:3000' };

// ============================================
// 1. startRegistration
// ============================================

describe('startRegistration', () => {
  let db: DatabaseAdapter;

  beforeEach(() => {
    db = makeMockDb();
    vi.clearAllMocks();
    // Re-apply default mocks after clearAllMocks
    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge: 'test-challenge-base64',
      rp: { name: 'Test', id: 'localhost' },
      user: { id: 'dXNlci0x', name: 'user-1', displayName: 'user-1' },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      timeout: 60000,
      attestation: 'none',
    } as any);
  });

  it('returns challengeId and options', async () => {
    const manager = createPasskeyManager(db, testConfig);
    const result = await manager.startRegistration('user-1', 'user-1');

    expect(result).toHaveProperty('challengeId');
    expect(result).toHaveProperty('options');
    expect(typeof result.challengeId).toBe('string');
    expect(result.challengeId.length).toBeGreaterThan(0);
  });

  it('stores challenge via db.storeChallenge with type registration', async () => {
    const manager = createPasskeyManager(db, testConfig);
    await manager.startRegistration('user-1', 'user-1');

    expect(db.storeChallenge).toHaveBeenCalledOnce();
    const stored = vi.mocked(db.storeChallenge).mock.calls[0][0];
    expect(stored.type).toBe('registration');
    expect(stored.metadata).toMatchObject({ tempUserId: 'user-1' });
  });

  it('stores challenge with future expiresAt', async () => {
    const beforeCall = Date.now();
    const manager = createPasskeyManager(db, testConfig);
    await manager.startRegistration('user-1', 'user-1');

    const stored = vi.mocked(db.storeChallenge).mock.calls[0][0];
    expect(stored.expiresAt.getTime()).toBeGreaterThan(beforeCall);
  });
});

// ============================================
// 2. finishRegistration
// ============================================

describe('finishRegistration', () => {
  let db: DatabaseAdapter;

  beforeEach(() => {
    db = makeMockDb();
    vi.clearAllMocks();
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'credential-id-1',
          publicKey: new Uint8Array(32).fill(0xAB),
          counter: 0,
        },
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
      },
    } as any);
  });

  it('returns verified:true with passkeyData when verification succeeds', async () => {
    const manager = createPasskeyManager(db, testConfig);

    // First start registration to store challenge
    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge: 'test-challenge-base64',
    } as any);
    const { challengeId } = await manager.startRegistration('user-1', 'user-1');

    const result = await manager.finishRegistration(challengeId, {
      id: 'credential-id-1',
      rawId: 'credential-id-1',
      response: {
        clientDataJSON: 'test',
        attestationObject: 'test',
        transports: ['internal'],
      },
      type: 'public-key',
      clientExtensionResults: {},
    } as any);

    expect(result.verified).toBe(true);
    expect(result.passkeyData).toBeDefined();
    expect(result.passkeyData?.credentialId).toBe('credential-id-1');
    expect(result.tempUserId).toBe('user-1');
  });

  it('returns verified:false when verifyRegistrationResponse throws', async () => {
    vi.mocked(verifyRegistrationResponse).mockRejectedValueOnce(new Error('Invalid attestation'));

    const manager = createPasskeyManager(db, testConfig);
    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge: 'test-challenge-base64',
    } as any);
    const { challengeId } = await manager.startRegistration('user-1', 'user-1');

    const result = await manager.finishRegistration(challengeId, {} as any);

    expect(result.verified).toBe(false);
    expect(result.passkeyData).toBeUndefined();
  });

  it('throws "Challenge not found or expired" when challenge does not exist', async () => {
    const manager = createPasskeyManager(db, testConfig);

    await expect(
      manager.finishRegistration('nonexistent-challenge-id', {} as any)
    ).rejects.toThrow('Challenge not found or expired');
  });

  it('throws "Challenge expired" when challenge.expiresAt is in the past', async () => {
    const expiredChallenge: Challenge = {
      id: 'expired-challenge',
      challenge: 'test-challenge',
      type: 'registration',
      userId: undefined,
      expiresAt: new Date(Date.now() - 1000),
      metadata: { tempUserId: 'user-1' },
    };

    const dbWithExpired = makeMockDb({
      getChallenge: vi.fn().mockResolvedValue(expiredChallenge),
      deleteChallenge: vi.fn().mockResolvedValue(undefined),
    });

    const manager = createPasskeyManager(dbWithExpired, testConfig);

    await expect(
      manager.finishRegistration('expired-challenge', {} as any)
    ).rejects.toThrow('Challenge expired');
  });

  it('throws "Invalid challenge type" when challenge type is authentication', async () => {
    const wrongTypeChallenge: Challenge = {
      id: 'auth-challenge',
      challenge: 'test-challenge',
      type: 'authentication',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60000),
    };

    const dbWithWrongType = makeMockDb({
      getChallenge: vi.fn().mockResolvedValue(wrongTypeChallenge),
    });

    const manager = createPasskeyManager(dbWithWrongType, testConfig);

    await expect(
      manager.finishRegistration('auth-challenge', {} as any)
    ).rejects.toThrow('Invalid challenge type');
  });
});

// ============================================
// 3. startAuthentication
// ============================================

describe('startAuthentication', () => {
  let db: DatabaseAdapter;

  beforeEach(() => {
    db = makeMockDb();
    vi.clearAllMocks();
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({
      challenge: 'test-auth-challenge',
      rpId: 'localhost',
      allowCredentials: [],
      timeout: 60000,
    } as any);
  });

  it('returns challengeId and options', async () => {
    const manager = createPasskeyManager(db, testConfig);
    const result = await manager.startAuthentication();

    expect(result).toHaveProperty('challengeId');
    expect(result).toHaveProperty('options');
    expect(typeof result.challengeId).toBe('string');
  });

  it('fetches passkeys by userId when userId is provided', async () => {
    const manager = createPasskeyManager(db, testConfig);
    await manager.startAuthentication('user-1');

    expect(db.getPasskeysByUserId).toHaveBeenCalledWith('user-1');
  });

  it('does not fetch passkeys when no userId is provided', async () => {
    const manager = createPasskeyManager(db, testConfig);
    await manager.startAuthentication();

    expect(db.getPasskeysByUserId).not.toHaveBeenCalled();
  });

  it('stores challenge with type authentication', async () => {
    const manager = createPasskeyManager(db, testConfig);
    await manager.startAuthentication('user-1');

    expect(db.storeChallenge).toHaveBeenCalledOnce();
    const stored = vi.mocked(db.storeChallenge).mock.calls[0][0];
    expect(stored.type).toBe('authentication');
    expect(stored.userId).toBe('user-1');
  });
});

// ============================================
// 4. finishAuthentication
// ============================================

describe('finishAuthentication', () => {
  let db: DatabaseAdapter;

  beforeEach(() => {
    db = makeMockDb();
    vi.clearAllMocks();
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({
      challenge: 'test-auth-challenge',
      rpId: 'localhost',
      allowCredentials: [],
      timeout: 60000,
    } as any);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    } as any);
  });

  it('returns verified:true with userId and passkey when verification succeeds', async () => {
    const manager = createPasskeyManager(db, testConfig);
    const { challengeId } = await manager.startAuthentication('user-1');

    const result = await manager.finishAuthentication(challengeId, {
      id: 'credential-id-1',
      rawId: 'credential-id-1',
      response: {
        clientDataJSON: 'test',
        authenticatorData: 'test',
        signature: 'test',
      },
      type: 'public-key',
      clientExtensionResults: {},
    } as any);

    expect(result.verified).toBe(true);
    expect(result.userId).toBe('user-1');
    expect(result.passkey).toBeDefined();
  });

  it('calls db.updatePasskeyCounter after successful authentication', async () => {
    const manager = createPasskeyManager(db, testConfig);
    const { challengeId } = await manager.startAuthentication('user-1');

    await manager.finishAuthentication(challengeId, {
      id: 'credential-id-1',
      rawId: 'credential-id-1',
      response: {
        clientDataJSON: 'test',
        authenticatorData: 'test',
        signature: 'test',
      },
      type: 'public-key',
      clientExtensionResults: {},
    } as any);

    expect(db.updatePasskeyCounter).toHaveBeenCalledWith('credential-id-1', 1);
  });

  it('returns verified:false when verifyAuthenticationResponse throws', async () => {
    vi.mocked(verifyAuthenticationResponse).mockRejectedValueOnce(new Error('Bad signature'));

    const manager = createPasskeyManager(db, testConfig);
    const { challengeId } = await manager.startAuthentication('user-1');

    const result = await manager.finishAuthentication(challengeId, {
      id: 'credential-id-1',
      rawId: 'credential-id-1',
      response: {
        clientDataJSON: 'test',
        authenticatorData: 'test',
        signature: 'bad-sig',
      },
      type: 'public-key',
      clientExtensionResults: {},
    } as any);

    expect(result.verified).toBe(false);
  });

  it('throws "Passkey not found" when credential is not in db', async () => {
    const dbNoCred = makeMockDb({
      getPasskeyById: vi.fn().mockResolvedValue(null),
    });

    const manager = createPasskeyManager(dbNoCred, testConfig);
    // Start auth to store the challenge
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({
      challenge: 'test-auth-challenge',
      rpId: 'localhost',
      allowCredentials: [],
      timeout: 60000,
    } as any);
    const { challengeId } = await manager.startAuthentication('user-1');

    await expect(
      manager.finishAuthentication(challengeId, {
        id: 'nonexistent-credential',
        rawId: 'nonexistent-credential',
        response: {
          clientDataJSON: 'test',
          authenticatorData: 'test',
          signature: 'test',
        },
        type: 'public-key',
        clientExtensionResults: {},
      } as any)
    ).rejects.toThrow('Passkey not found');
  });

  it('throws "Challenge not found or expired" when challenge does not exist', async () => {
    const manager = createPasskeyManager(db, testConfig);

    await expect(
      manager.finishAuthentication('nonexistent-challenge', {} as any)
    ).rejects.toThrow('Challenge not found or expired');
  });

  it('throws "Challenge expired" when challenge.expiresAt is in the past', async () => {
    const expiredChallenge: Challenge = {
      id: 'expired-auth-challenge',
      challenge: 'test-challenge',
      type: 'authentication',
      userId: 'user-1',
      expiresAt: new Date(Date.now() - 1000),
    };

    const dbWithExpired = makeMockDb({
      getChallenge: vi.fn().mockResolvedValue(expiredChallenge),
      deleteChallenge: vi.fn().mockResolvedValue(undefined),
    });

    const manager = createPasskeyManager(dbWithExpired, testConfig);

    await expect(
      manager.finishAuthentication('expired-auth-challenge', {} as any)
    ).rejects.toThrow('Challenge expired');
  });
});
