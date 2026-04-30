import { f as AuthenticatorTransport, P as PublicKeyCredentialRequestOptionsJSON, e as PublicKeyCredentialCreationOptionsJSON, c as AuthenticationResponseJSON, a as RegistrationResponseJSON } from '../index-C-jQo7Jq.cjs';
import 'pino';
import 'express';

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

interface CreateRegistrationOptionsInput {
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
interface CreateRegistrationOptionsResult {
    /** Options to send to client */
    options: PublicKeyCredentialCreationOptionsJSON;
    /** Challenge to store server-side for verification */
    challenge: string;
}
interface VerifyRegistrationInput {
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
interface VerifyRegistrationResult {
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
interface CreateAuthenticationOptionsInput {
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
interface CreateAuthenticationOptionsResult {
    /** Options to send to client */
    options: PublicKeyCredentialRequestOptionsJSON;
    /** Challenge to store server-side for verification */
    challenge: string;
}
interface StoredCredential {
    /** Credential ID (base64url) */
    id: string;
    /** Public key */
    publicKey: Uint8Array;
    /** Current counter value */
    counter: number;
    /** Transport methods */
    transports?: AuthenticatorTransport[];
}
interface VerifyAuthenticationInput {
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
interface VerifyAuthenticationResult {
    /** Whether verification succeeded */
    verified: boolean;
    /** New counter value to store (only if verified) */
    newCounter?: number;
    /** Error message if verification failed */
    error?: string;
}
/**
 * Generate WebAuthn registration options
 *
 * Call this to start the registration flow. Store the challenge
 * server-side and send options to the client.
 */
declare function createRegistrationOptions(input: CreateRegistrationOptionsInput): Promise<CreateRegistrationOptionsResult>;
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
declare function verifyRegistration(input: VerifyRegistrationInput): Promise<VerifyRegistrationResult>;
/**
 * Generate WebAuthn authentication options
 *
 * Call this to start the login flow. Store the challenge
 * server-side and send options to the client.
 *
 * For discoverable credential login (no username needed),
 * omit allowCredentials.
 */
declare function createAuthenticationOptions(input: CreateAuthenticationOptionsInput): Promise<CreateAuthenticationOptionsResult>;
/**
 * Verify WebAuthn authentication response
 *
 * Call this when the client sends back their assertion.
 * If verified, update the counter in your database.
 */
declare function verifyAuthentication(input: VerifyAuthenticationInput): Promise<VerifyAuthenticationResult>;
/**
 * Convert base64url string to Uint8Array
 */
declare function base64urlToUint8Array(base64url: string): Uint8Array;
/**
 * Convert Uint8Array to base64url string
 */
declare function uint8ArrayToBase64url(bytes: Uint8Array): string;

export { type CreateAuthenticationOptionsInput, type CreateAuthenticationOptionsResult, type CreateRegistrationOptionsInput, type CreateRegistrationOptionsResult, type StoredCredential, type VerifyAuthenticationInput, type VerifyAuthenticationResult, type VerifyRegistrationInput, type VerifyRegistrationResult, base64urlToUint8Array, createAuthenticationOptions, createRegistrationOptions, uint8ArrayToBase64url, verifyAuthentication, verifyRegistration };
