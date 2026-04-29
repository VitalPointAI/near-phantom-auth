// src/server/backup.ts
//
// Single source of truth for the BE-bit lifecycle mapping.
// Source: derived from @simplewebauthn/server parseBackupFlags
// (node_modules/@simplewebauthn/server/esm/helpers/parseBackupFlags.js)

/**
 * BE/BS bit lifecycle (WebAuthn Level 2 §6.1.3):
 *
 * BE (Backup Eligibility) — bit 3 of authenticator flags. Set ONCE at credential
 *   creation. Indicates whether the authenticator class supports backup (e.g.,
 *   iCloud Keychain, Google Password Manager). Cannot change for the lifetime
 *   of the credential. Encoded by @simplewebauthn/server as
 *   `credentialDeviceType === 'multiDevice'`.
 *
 * BS (Backup State) — bit 4 of authenticator flags. May FLIP from 0→1 (or, in
 *   theory, 1→0) over the credential's lifetime as the authenticator backs up
 *   or evicts the key. Re-read on every authentication assertion. Encoded by
 *   @simplewebauthn/server as `credentialBackedUp` (boolean).
 *
 * Invariant (enforced by @simplewebauthn/server): BE === false implies BS === false.
 *   A single-device credential cannot be backed up.
 *
 * This helper is the single source of truth for the deviceType → backupEligible
 * translation. Used by:
 *   - `src/server/router.ts` (POST /register/finish, POST /login/finish responses)
 *   - `src/server/webauthn.ts` (standalone verifyRegistration result)
 */
export function deriveBackupEligibility(
  deviceType: 'singleDevice' | 'multiDevice'
): boolean {
  return deviceType === 'multiDevice';
}
