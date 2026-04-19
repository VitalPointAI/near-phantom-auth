/**
 * Client-side Passkey (WebAuthn) operations
 */

import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '../types/index.js';

// WebAuthn Level 3 PRF extension — not yet in TypeScript DOM lib (lib.dom.d.ts pre-ES2025).
// Do NOT replace with `as any` — this localized augmentation keeps strict typing at call sites.
type PRFExtensionInput = { prf: { eval: { first: Uint8Array } } };
type PRFExtensionOutput = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

/**
 * Check if WebAuthn is supported
 */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof window.navigator.credentials !== 'undefined'
  );
}

/**
 * Check if platform authenticator is available
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Decode base64url string to ArrayBuffer
 */
function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Encode ArrayBuffer to base64url string
 */
function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Encode ArrayBuffer to lowercase hex string.
 * For 32-byte input (e.g., WebAuthn PRF output), produces a 64-character string.
 */
function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a new passkey (registration)
 */
export async function createPasskey(
  options: PublicKeyCredentialCreationOptionsJSON,
  prfOptions?: { salt: Uint8Array }
): Promise<RegistrationResponseJSON & { sealingKeyHex?: string }> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  // Convert JSON options to WebAuthn format
  const publicKeyOptions: PublicKeyCredentialCreationOptions = {
    challenge: base64urlToBuffer(options.challenge),
    rp: options.rp,
    user: {
      id: base64urlToBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    authenticatorSelection: options.authenticatorSelection,
    attestation: options.attestation || 'none',
    excludeCredentials: options.excludeCredentials?.map((cred) => ({
      id: base64urlToBuffer(cred.id),
      type: cred.type,
      transports: cred.transports,
    })),
    ...(prfOptions
      ? {
          // PRF extension is WebAuthn Level 3; not in lib.dom.d.ts. Build the value
          // with the PRFExtensionInput local shape (keeps strict typing at construction),
          // then double-cast through `unknown` to satisfy the broader DOM extensions type
          // (which lacks a `prf` field in pre-ES2025 lib.dom.d.ts).
          extensions: ({
            prf: { eval: { first: prfOptions.salt } },
          } satisfies PRFExtensionInput) as unknown as PublicKeyCredentialCreationOptions['extensions'],
        }
      : {}),
  };

  // Create credential
  const credential = await navigator.credentials.create({
    publicKey: publicKeyOptions,
  }) as PublicKeyCredential;

  if (!credential) {
    throw new Error('Credential creation failed');
  }

  const response = credential.response as AuthenticatorAttestationResponse;

  // Get authenticator attachment (platform = likely synced, cross-platform = hardware key)
  const rawAttachment = (credential as PublicKeyCredential & { authenticatorAttachment?: string }).authenticatorAttachment;
  const authenticatorAttachment = rawAttachment as 'platform' | 'cross-platform' | undefined;
  const transports = response.getTransports?.() as RegistrationResponseJSON['response']['transports'];

  // Extract PRF result if PRF was requested and authenticator returned one.
  const ext = credential.getClientExtensionResults() as PRFExtensionOutput;
  const prfResult: ArrayBuffer | undefined = ext.prf?.results?.first;
  // WR-01: Anchor the 32-byte invariant at the source. The WebAuthn Level 3 spec
  // mandates a 32-byte PRF output; a non-compliant authenticator returning a
  // different length would otherwise silently produce a malformed sealingKeyHex
  // that only surfaces as a generic server 400. Throw a clear local error instead.
  if (prfResult && prfResult.byteLength !== 32) {
    throw new Error(
      `PRF_UNEXPECTED_LENGTH: expected 32 bytes, got ${prfResult.byteLength}`,
    );
  }
  const sealingKeyHex: string | undefined = prfResult ? arrayBufferToHex(prfResult) : undefined;

  // Convert response to JSON format
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: bufferToBase64url(response.attestationObject),
      transports,
    },
    clientExtensionResults: credential.getClientExtensionResults() as Record<string, unknown>,
    // Privacy metadata
    authenticatorAttachment,
    transports,
    sealingKeyHex,
  };
}

/**
 * Check if credential appears to use cloud-synced storage
 * Returns true if likely synced (platform authenticator), false if likely safe (hardware key)
 */
export function isLikelyCloudSynced(credential: RegistrationResponseJSON): boolean {
  const { authenticatorAttachment, transports } = credential;
  
  // Hardware keys are safe
  if (authenticatorAttachment === 'cross-platform') return false;
  if (transports?.includes('usb') || transports?.includes('nfc')) return false;
  
  // Platform authenticator with internal transport = likely synced
  if (authenticatorAttachment === 'platform') return true;
  if (transports?.includes('internal')) return true;
  
  // Default to warning (safer)
  return true;
}

/**
 * Authenticate with existing passkey
 */
export async function authenticateWithPasskey(
  options: PublicKeyCredentialRequestOptionsJSON,
  prfOptions?: { salt: Uint8Array }
): Promise<AuthenticationResponseJSON & { sealingKeyHex?: string }> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  // Convert JSON options to WebAuthn format
  const publicKeyOptions: PublicKeyCredentialRequestOptions = {
    challenge: base64urlToBuffer(options.challenge),
    timeout: options.timeout,
    rpId: options.rpId,
    userVerification: options.userVerification,
    allowCredentials: options.allowCredentials?.map((cred) => ({
      id: base64urlToBuffer(cred.id),
      type: cred.type,
      transports: cred.transports,
    })),
    ...(prfOptions
      ? {
          // PRF extension is WebAuthn Level 3; not in lib.dom.d.ts. Build the value
          // with the PRFExtensionInput local shape (keeps strict typing at construction),
          // then double-cast through `unknown` to satisfy the broader DOM extensions type
          // (which lacks a `prf` field in pre-ES2025 lib.dom.d.ts).
          extensions: ({
            prf: { eval: { first: prfOptions.salt } },
          } satisfies PRFExtensionInput) as unknown as PublicKeyCredentialRequestOptions['extensions'],
        }
      : {}),
  };

  // Get credential
  const credential = await navigator.credentials.get({
    publicKey: publicKeyOptions,
  }) as PublicKeyCredential;

  if (!credential) {
    throw new Error('Authentication failed');
  }

  const response = credential.response as AuthenticatorAssertionResponse;

  // Extract PRF result if PRF was requested and authenticator returned one.
  const ext = credential.getClientExtensionResults() as PRFExtensionOutput;
  const prfResult: ArrayBuffer | undefined = ext.prf?.results?.first;
  // WR-01: Anchor the 32-byte invariant at the source. The WebAuthn Level 3 spec
  // mandates a 32-byte PRF output; a non-compliant authenticator returning a
  // different length would otherwise silently produce a malformed sealingKeyHex
  // that only surfaces as a generic server 400. Throw a clear local error instead.
  if (prfResult && prfResult.byteLength !== 32) {
    throw new Error(
      `PRF_UNEXPECTED_LENGTH: expected 32 bytes, got ${prfResult.byteLength}`,
    );
  }
  const sealingKeyHex: string | undefined = prfResult ? arrayBufferToHex(prfResult) : undefined;

  // Convert response to JSON format
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults() as Record<string, unknown>,
    sealingKeyHex,
  };
}
