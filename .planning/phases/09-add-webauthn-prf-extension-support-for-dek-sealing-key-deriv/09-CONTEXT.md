# Phase 9 Context — WebAuthn PRF Extension Support

Source: user requirements message provided 2026-04-19 when this phase was added.

---

## Wire format the auth-service expects

On every passkey register/finish and login/finish POST, include in the request body:

```json
{
  "sealingKeyHex": "<64 hex chars = 32 bytes>",
  "...other existing fields": null
}
```

That's it. If present, `auth-service/src/server.ts:121` reads it and calls `resolveSessionDek()`; for first-time users it also triggers `provisionUserKeys()` via `user-bridge.ts:170-180`. Currently the field is never sent, so both paths silently no-op.

## Where the 32 bytes must come from

The WebAuthn PRF extension (W3C WebAuthn Level 3, §10.1.4 / RFC). The authenticator computes HMAC-SHA-256 over an RP-supplied salt, deterministically per credential. Result: 32 bytes that:

- Are stable across every login with the same credential (so registration `sealingKey` == login `sealingKey` for the same passkey) — required so `internalUnwrapSessionDek` can decrypt what `internalKeygen` sealed
- Never leave the authenticator's secure enclave in raw form (the salt does, the key doesn't)
- Are different per credential / per RP (built-in differentiation; don't need to mix in `user_id`)

Spec: https://w3c.github.io/webauthn/#prf-extension

Browser support: Chrome/Edge ≥116, Safari ≥18 (iOS 18 / macOS 15), Firefox not yet — gracefully degrade where unsupported.

## Required library changes — client side

### 1. During WebAuthn `navigator.credentials.create()` (registration)

```js
const credential = await navigator.credentials.create({
  publicKey: {
    ...existingOptions,
    extensions: {
      ...existingOptions.extensions,
      prf: {
        eval: { first: PRF_SALT },  // 32-byte Uint8Array, see below
      },
    },
  },
});

const ext = credential.getClientExtensionResults();
const prfResult = ext.prf?.results?.first;  // ArrayBuffer | undefined

let sealingKeyHex: string | undefined;
if (prfResult) {
  sealingKeyHex = Array.from(new Uint8Array(prfResult))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

### 2. During `navigator.credentials.get()` (login)

Identical PRF extension request, same salt, same extraction. Required because login finish needs to derive the SAME sealingKey to unwrap the DEK provisioned at registration.

### 3. POST `sealingKeyHex` to the finish endpoints

Whatever the library currently posts to `/auth/register/finish` and `/auth/login/finish`, add the field to the body if defined.

## The salt — design recommendation

```js
// Stable, RP-specific, version-tagged so we can rotate later.
const PRF_SALT = new TextEncoder().encode(
  'ledgera-passkey-prf-sealing-key-v1'
);  // 38 bytes — PRF spec accepts arbitrary length, hashes internally
```

Constraints:

- MUST be byte-identical between registration and every login — even one byte off and PRF returns a different 32 bytes and the DEK won't decrypt
- Per-RP differentiation is automatic (the authenticator includes its own RP-binding); don't need to mix in `RP_ID`
- Per-credential differentiation is automatic (different passkey = different output)
- Don't mix in `user_id`, `sessionId`, or anything time-varying — must be stable forever for that credential or you lose access to that user's encrypted data

Make it configurable via `createAnonAuth({ passkey: { prfSalt: Uint8Array } })` so apps with different salts (or rotation needs) can override; default to a library-internal `'near-phantom-auth-prf-v1'` constant for apps that don't care.

## Graceful degradation

If `ext.prf?.results?.first` is undefined, the authenticator doesn't support PRF (older Safari, hardware key without PRF, etc.). Two options:

1. **Recommended:** still complete login/registration, just don't send `sealingKeyHex`. Auth-service silently skips DEK provisioning (current state) — user can use unencrypted features but encrypted endpoints 401. Show a UI warning.
2. **Alternative:** refuse registration. Forces users onto PRF-capable authenticators. Cleaner privacy story but locks out Firefox users entirely until Firefox ships PRF.

A `passkey.requirePrf: boolean` option on `createAnonAuth` would let apps choose.

## Migration for already-registered users

(Existing accounts, currently `key-bundle-NULL`.)

Once the library ships `sealingKeyHex` on login, any login finish for a user with `users.mlkem_ek IS NULL` should route through provisioning instead of unwrap. Two approaches:

1. **Server-side detection (preferred — no library change):** modify `auth-service/src/user-bridge.ts:170` so `provisionUserKeys()` fires on every login when `getUserKeyBundle(userId)` returns null, not just `isNewUser`. Existing accounts get auto-bootstrapped on next passkey login.
2. **Library-side (more explicit):** library calls `getUserKeyBundle` via a new endpoint and decides whether to send `sealingKeyHex` to `/register/finish` semantics or `/login/finish`. More moving parts.

Prefer patching `user-bridge.ts` server-side once the library ships PRF — single-line change.

## Test vectors (add to library test suite)

```js
// Given:
const salt = new TextEncoder().encode('ledgera-passkey-prf-sealing-key-v1');
// And a mocked authenticator that returns deterministic PRF output of HMAC-SHA-256(credentialKey, salt):
// → sealingKeyHex must be exactly 64 chars, all [0-9a-f], length 32 bytes after Buffer.from(hex, 'hex').
// → Same credential + same salt + new login → identical sealingKeyHex.
// → Different credential + same salt → different sealingKeyHex.
// → Same credential + different salt → different sealingKeyHex.
```

The `internalKeygen` and `internalUnwrapSessionDek` IPC contracts on the FastAPI side (`auth-service/src/internal-crypto-client.ts:110-151`) require exactly 32 bytes — `internalKeygen` validates `sealingKey.length !== 32` and throws. Library tests should assert this.

## Reference checklist for the library PR

- [ ] Add `passkey.prfSalt?: Uint8Array` and `passkey.requirePrf?: boolean` to `createAnonAuth` options
- [ ] Pass `extensions: { prf: { eval: { first: salt } } }` on every `credentials.create` and `credentials.get`
- [ ] Extract `getClientExtensionResults().prf?.results?.first` from credential
- [ ] Hex-encode the 32-byte ArrayBuffer to `sealingKeyHex`
- [ ] Add `sealingKeyHex` to the POST body of `register/finish` AND `login/finish` endpoints (don't include if PRF unsupported)
- [ ] Detect PRF support attempt-pattern (no synchronous `isPRFSupported()`; check `ext.prf?.results?.first` after the credential ceremony)
- [ ] Bump library version (0.5.x → 0.6.0; this is a feature-add, not a breaking API change)
- [ ] README: document the salt requirement + browser support matrix + the migration note for existing users
