---
phase: 9
slug: add-webauthn-prf-extension-support-for-dek-sealing-key-deriv
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (existing) |
| **Quick run command** | `npm test -- --run <pattern>` |
| **Full suite command** | `npm test -- --run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run <pattern>`
- **After every plan wave:** Run `npm test -- --run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| To be filled by planner | — | — | — | — | — | — | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/passkey-prf.test.ts` — PRF extension request shape, hex encoding, 32-byte length, determinism, divergence
- [ ] `tests/__mocks__/webauthn-prf.ts` — deterministic Node `crypto.createHmac` mock for `navigator.credentials`
- [ ] `tests/api-finish-payloads.test.ts` — POST body schema for `/register/finish` and `/login/finish` with and without `sealingKeyHex`

*If existing test infra already covers WebAuthn ceremony mocking, planner may consolidate.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real authenticator PRF on Chrome 116+ | PRF wire correctness | Headless browsers don't expose real authenticator | Run sample app on Chrome 116+/Safari 18+, register passkey, verify `sealingKeyHex` in network tab and DEK provisioned in auth-service |
| Firefox graceful degradation | requirePrf:false default path | Firefox lacks PRF support | Run sample app on current Firefox, verify registration completes, no `sealingKeyHex` sent, encrypted endpoints 401 with clear UI warning |
| caBLE / hybrid transport PRF survival | PRF cross-device | Requires phone-as-authenticator pairing | Cross-device passkey ceremony, verify PRF result still surfaces |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
