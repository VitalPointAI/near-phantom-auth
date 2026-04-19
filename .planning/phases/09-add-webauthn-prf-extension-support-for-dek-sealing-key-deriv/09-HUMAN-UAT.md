---
status: partial
phase: 09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv
source: [09-VERIFICATION.md]
started: 2026-04-19T19:34:00Z
updated: 2026-04-19T19:34:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Real authenticator PRF on Chrome 116+ (iCloud Keychain / Google Password Manager / Windows Hello)
expected: Register passkey, verify `sealingKeyHex` appears in POST /register/finish body in DevTools Network tab; same credential on login produces identical `sealingKeyHex` in POST /login/finish body; downstream auth-service successfully provisions DEK
result: [pending]

### 2. Real authenticator PRF on Safari 18+ (iOS 18 / macOS 15)
expected: Register and login both emit `sealingKeyHex` (iCloud Keychain returns results.first on registration)
result: [pending]

### 3. Firefox graceful degradation
expected: Registration completes without `sealingKeyHex` in POST body; no 400 from server; encrypted endpoints respond as expected (e.g., 401 with documented UI warning) when requirePrf=false
result: [pending]

### 4. requirePrf:true rejection on Firefox
expected: `register()` and `login()` reject; `state.error` contains `PRF_NOT_SUPPORTED`
result: [pending]

### 5. caBLE / hybrid transport PRF survival (phone-as-authenticator)
expected: Cross-device passkey ceremony (phone scanning desktop QR) still surfaces `sealingKeyHex` on the desktop side
result: [pending]

### 6. Hardware key (YubiKey with PRF firmware) PRF on get() but not create()
expected: No `sealingKeyHex` on registration POST body; `sealingKeyHex` appears on first login POST body (per WebAuthn spec — hardware keys return enabled:true only on create)
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
