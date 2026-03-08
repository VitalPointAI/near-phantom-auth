/**
 * Standalone WebAuthn Verification Utilities
 * 
 * Simple, secure passkey verification for Next.js and other frameworks.
 * Uses @simplewebauthn/server for cryptographic verification.
 * 
 * @example
 * ```typescript
 * import { 
 *   createRegistrationOptions, 
 *   verifyRegistration,
 *   createAuthenticationOptions,
 *   verifyAuthentication 
 * } from '@vitalpoint/near-phantom-auth/server';
 * 
 * // Registration flow
 * const { options, challenge } = await createRegistrationOptions({
 *   rpName: 'My App',
 *   rpId: 'myapp.com',
 *   userName: 'alice',
 * });
 * // Store challenge, send options to client
 * 
 * // On client response:
 * const result = await verifyRegistration({
 *   response: clientResponse,
 *   expectedChallenge: storedChallenge,
 *   expectedOrigin: 'https://myapp.com',
 *   expectedRPID: 'myapp.com',
 * });
 * if (result.verified) {
 *   // Save result.credential to database
 * }
 * ```
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransport,
} from '../types/index.js';

// ============================================
// Types
// ============================================

export interface CreateRegistrationOptionsInput {
  /** Relying Party name (shown to users) */
  rpName: string;
  /** Relying Party ID (your domain, e.g., 'example.com') */
  rpId: string;
  /** Username to register */
  userName: string;
  /** User display name (defaults to userName) */
  userDisplayName?: string;
  /** User ID (defaults to random bytes) */
  userId?: string;
  /** Existing credentials to exclude */
  excludeCredentials?: Array<{
    id: string;
    transports?: AuthenticatorTransport[];
  }>;
  /** Challenge timeout in ms (default: 60000) */
  timeout?: number;
}

export interface CreateRegistrationOptionsResult {
  /** Options to send to client */
  options: PublicKeyCredentialCreationOptionsJSON;
  /** Challenge to store server-side for verification */
  challenge: string;
}

export interface VerifyRegistrationInput {
  /** Response from client's navigator.credentials.create() */
  response: RegistrationResponseJSON;
  /** The challenge that was sent to client */
  expectedChallenge: string;
  /** Expected origin (e.g., 'https://example.com') */
  expectedOrigin: string;
  /** Expected RP ID (e.g., 'example.com') */
  expectedRPID: string;
}

export interface VerifyRegistrationResult {
  /** Whether verification succeeded */
  verified: boolean;
  /** Credential data to store (only if verified) */
  credential?: {
    /** Credential ID (base64url) - use as primary key */
    id: string;
    /** Public key (Uint8Array) - store as bytea/blob */
    publicKey: Uint8Array;
    /** Counter - store and update for replay protection */
    counter: number;
    /** Device type */
    deviceType: 'singleDevice' | 'multiDevice';
    /** Whether backed up to cloud */
    backedUp: boolean;
    /** Transport methods */
    transports?: AuthenticatorTransport[];
  };
  /** Error message if verification failed */
  error?: string;
}

export interface CreateAuthenticationOptionsInput {
  /** Relying Party ID (your domain) */
  rpId: string;
  /** Allow credentials (empty for discoverable/resident key login) */
  allowCredentials?: Array<{
    id: string;
    transports?: AuthenticatorTransport[];
  }>;
  /** Challenge timeout in ms (default: 60000) */
  timeout?: number;
}

export interface CreateAuthenticationOptionsResult {
  /** Options to send to client */
  options: PublicKeyCredentialRequestOptionsJSON;
  /** Challenge to store server-side for verification */
  challenge: string;
}

export interface StoredCredential {
  /** Credential ID (base64url) */
  id: string;
  /** Public key */
  publicKey: Uint8Array;
  /** Current counter value */
  counter: number;
  /** Transport methods */
  transports?: AuthenticatorTransport[];
}

export interface VerifyAuthenticationInput {
  /** Response from client's navigator.credentials.get() */
  response: AuthenticationResponseJSON;
  /** The challenge that was sent to client */
  expectedChallenge: string;
  /** Expected origin (e.g., 'https://example.com') */
  expectedOrigin: string;
  /** Expected RP ID (e.g., 'example.com') */
  expectedRPID: string;
  /** The stored credential for this user */
  credential: StoredCredential;
}

export interface VerifyAuthenticationResult {
  /** Whether verification succeeded */
  verified: boolean;
  /** New counter value to store (only if verified) */
  newCounter?: number;
  /** Error message if verification failed */
  error?: string;
}

// ============================================
// Registration
// ============================================

/**
 * Generate WebAuthn registration options
 * 
 * Call this to start the registration flow. Store the challenge
 * server-side and send options to the client.
 */
export async function createRegistrationOptions(
  input: CreateRegistrationOptionsInput
): Promise<CreateRegistrationOptionsResult> {
  const {
    rpName,
    rpId,
    userName,
    userDisplayName = userName,
    userId,
    excludeCredentials = [],
    timeout = 60000,
  } = input;

  // Generate user ID if not provided
  const userIdBytes = userId 
    ? new TextEncoder().encode(userId)
    : crypto.getRandomValues(new Uint8Array(32));

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userName,
    userDisplayName,
    userID: userIdBytes,
    attestationType: 'none', // We don't need attestation for most use cases
    excludeCredentials: excludeCredentials.map(cred => ({
      id: cred.id,
      type: 'public-key' as const,
      transports: cred.transports,
    })),
    authenticatorSelection: {
      residentKey: 'required', // Enable discoverable credentials (login without username)
      userVerification: 'preferred',
      // Don't restrict authenticator attachment - allow both platform and hardware keys
    },
    timeout,
  });

  return {
    options: options as unknown as PublicKeyCredentialCreationOptionsJSON,
    challenge: options.challenge,
  };
}

/**
 * Verify WebAuthn registration response
 * 
 * Call this when the client sends back their credential.
 * If verified, store the credential data in your database.
 */
export async function verifyRegistration(
  input: VerifyRegistrationInput
): Promise<VerifyRegistrationResult> {
  const { response, expectedChallenge, expectedOrigin, expectedRPID } = input;

  try {
    const verification: VerifiedRegistrationResponse = await verifyRegistrationResponse({
      response: response as unknown as Parameters<typeof verifyRegistrationResponse>[0]['response'],
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return { verified: false, error: 'Verification failed' };
    }

    const { registrationInfo } = verification;

    return {
      verified: true,
      credential: {
        id: registrationInfo.credential.id,
        publicKey: registrationInfo.credential.publicKey,
        counter: registrationInfo.credential.counter,
        deviceType: registrationInfo.credentialDeviceType,
        backedUp: registrationInfo.credentialBackedUp,
        transports: response.response.transports,
      },
    };
  } catch (error) {
    console.error('[WebAuthn] Registration verification error:', error);
    return {
      verified: false,
      error: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}

// ============================================
// Authentication
// ============================================

/**
 * Generate WebAuthn authentication options
 * 
 * Call this to start the login flow. Store the challenge
 * server-side and send options to the client.
 * 
 * For discoverable credential login (no username needed),
 * omit allowCredentials.
 */
export async function createAuthenticationOptions(
  input: CreateAuthenticationOptionsInput
): Promise<CreateAuthenticationOptionsResult> {
  const { rpId, allowCredentials, timeout = 60000 } = input;

  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: 'preferred',
    allowCredentials: allowCredentials?.map(cred => ({
      id: cred.id,
      type: 'public-key' as const,
      transports: cred.transports,
    })),
    timeout,
  });

  return {
    options: options as unknown as PublicKeyCredentialRequestOptionsJSON,
    challenge: options.challenge,
  };
}

/**
 * Verify WebAuthn authentication response
 * 
 * Call this when the client sends back their assertion.
 * If verified, update the counter in your database.
 */
export async function verifyAuthentication(
  input: VerifyAuthenticationInput
): Promise<VerifyAuthenticationResult> {
  const { response, expectedChallenge, expectedOrigin, expectedRPID, credential } = input;

  try {
    const verification: VerifiedAuthenticationResponse = await verifyAuthenticationResponse({
      response: response as unknown as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
      },
    });

    if (!verification.verified) {
      return { verified: false, error: 'Verification failed' };
    }

    return {
      verified: true,
      newCounter: verification.authenticationInfo.newCounter,
    };
  } catch (error) {
    console.error('[WebAuthn] Authentication verification error:', error);
    return {
      verified: false,
      error: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}

// ============================================
// Utilities
// ============================================

/**
 * Convert base64url string to Uint8Array
 */
export function base64urlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to base64url string
 */
export function uint8ArrayToBase64url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
