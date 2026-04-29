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
import { deriveBackupEligibility } from './backup.js';
import pino from 'pino';

// Module-level silent logger — errors are still re-thrown, so consumers see them
const log = pino({ level: 'silent' }).child({ module: 'webauthn' });

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
  /** Expected origin (e.g., 'https://example.com'). v0.7.0 (RPID-04): pass an
   *  array of strings to accept assertions from related domains. The library
   *  validates origin membership via Array.includes; pair-with-rpID enforcement
   *  is the caller's responsibility (see README "Cross-Domain Passkeys"). */
  expectedOrigin: string | string[];
  /** Expected RP ID (e.g., 'example.com'). v0.7.0 (RPID-04): pass an array for
   *  cross-domain passkey support; pair the array elements 1:1 with
   *  `expectedOrigin` by index — `@simplewebauthn/server` does NOT cross-check
   *  pairing. */
  expectedRPID: string | string[];
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
    /** BE bit — set ONCE at credential creation. `'multiDevice'` if the
     *  authenticator supports backup; `'singleDevice'` if not. Immutable. */
    deviceType: 'singleDevice' | 'multiDevice';
    /** BS bit — current backup state. May FLIP from 0→1 over the credential's
     *  lifetime. Re-read on every authentication assertion. */
    backedUp: boolean;
    /** Convenience derived from BE bit: `deviceType === 'multiDevice'`.
     *  Capability flag — does NOT mean the credential is currently backed up.
     *  See `backedUp` for current state. Invariant: `backupEligible === false`
     *  implies `backedUp === false`. */
    backupEligible: boolean;
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
  /** Expected origin (e.g., 'https://example.com'). v0.7.0 (RPID-04): see
   *  VerifyRegistrationInput.expectedOrigin for the array form contract. */
  expectedOrigin: string | string[];
  /** Expected RP ID (e.g., 'example.com'). v0.7.0 (RPID-04): see
   *  VerifyRegistrationInput.expectedRPID for the array form contract. */
  expectedRPID: string | string[];
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
 *
 * @remarks
 * Backup eligibility / state (WebAuthn Level 2 §6.1.3):
 * - `result.credential.deviceType` reflects the BE bit (Backup Eligibility).
 *   Set ONCE at credential creation; immutable for the credential's lifetime.
 *   `'multiDevice'` means the authenticator class supports backup
 *   (e.g., iCloud Keychain, Google Password Manager).
 * - `result.credential.backedUp` reflects the BS bit (Backup State).
 *   Current backup state; MAY FLIP 0→1 over the credential's lifetime as
 *   the authenticator backs up the key. Re-read on every authentication.
 * - `result.credential.backupEligible` is a convenience derived from BE
 *   (`deviceType === 'multiDevice'`). Independent of `backedUp`: a multi-device
 *   credential MAY not yet be backed up (`backupEligible: true, backedUp: false`).
 * - Invariant: `backupEligible === false` implies `backedUp === false`
 *   (a single-device credential cannot be backed up).
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
        backupEligible: deriveBackupEligibility(registrationInfo.credentialDeviceType),
        transports: response.response.transports,
      },
    };
  } catch (error) {
    log.error({ err: error }, 'Registration verification error');
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
    log.error({ err: error }, 'Authentication verification error');
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
