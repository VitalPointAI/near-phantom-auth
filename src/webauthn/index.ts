/**
 * Standalone WebAuthn Verification Utilities
 * 
 * Lightweight export with no database dependencies.
 * Use this for Next.js apps that manage their own sessions.
 * 
 * @example
 * ```typescript
 * import { 
 *   createRegistrationOptions, 
 *   verifyRegistration,
 *   createAuthenticationOptions,
 *   verifyAuthentication 
 * } from '@vitalpoint/near-phantom-auth/webauthn';
 * ```
 */

export {
  createRegistrationOptions,
  verifyRegistration,
  createAuthenticationOptions,
  verifyAuthentication,
  base64urlToUint8Array,
  uint8ArrayToBase64url,
  type CreateRegistrationOptionsInput,
  type CreateRegistrationOptionsResult,
  type VerifyRegistrationInput,
  type VerifyRegistrationResult,
  type CreateAuthenticationOptionsInput,
  type CreateAuthenticationOptionsResult,
  type StoredCredential,
  type VerifyAuthenticationInput,
  type VerifyAuthenticationResult,
} from '../server/webauthn.js';
