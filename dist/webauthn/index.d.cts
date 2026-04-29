import { f as AuthenticatorTransport, P as PublicKeyCredentialRequestOptionsJSON, e as PublicKeyCredentialCreationOptionsJSON, c as AuthenticationResponseJSON, a as RegistrationResponseJSON } from '../index-DExFbKyH.cjs';
import 'pino';

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
    /** Expected origin (e.g., 'https://example.com') */
    expectedOrigin: string;
    /** Expected RP ID (e.g., 'example.com') */
    expectedRPID: string;
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
    /** Expected origin (e.g., 'https://example.com') */
    expectedOrigin: string;
    /** Expected RP ID (e.g., 'example.com') */
    expectedRPID: string;
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
