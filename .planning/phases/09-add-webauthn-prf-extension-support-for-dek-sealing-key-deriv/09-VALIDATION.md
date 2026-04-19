---
phase: 9
slug: add-webauthn-prf-extension-support-for-dek-sealing-key-deriv
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-19
last_updated: 2026-04-19
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.4 |
| **Config file** | vitest.config.ts (existing, root) |
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
| 09-01-T1 | 09-01 | 1 | PRF-01 | T-09-04 | AnonAuthConfig accepts passkey nested config (type-only, no runtime forwarding) | unit (typecheck) | `npm run typecheck` | ✅ src/types/index.ts, src/server/index.ts | ⬜ pending |
| 09-01-T2 | 09-01 | 1 | PRF-08 | T-09-01, T-09-02, T-09-05, T-09-06 | sealingKeyHex zod schema validates 64-char lowercase hex; rejects wrong length, uppercase, non-hex; outer object stays non-passthrough | unit (schema) | `npm test -- --run src/__tests__/validation.test.ts` | ✅ src/server/validation/schemas.ts, src/__tests__/validation.test.ts | ⬜ pending |
| 09-01-T3 | 09-01 | 1 | PRF-11 | — | prf.test.ts scaffold with deterministic HMAC mock factory; 5 sanity tests + 14+ it.todo placeholders | unit (test infra) | `npm test -- --run src/__tests__/prf.test.ts` | 🆕 src/__tests__/prf.test.ts | ⬜ pending |
| 09-02-T1 | 09-02 | 2 | PRF-02, PRF-03, PRF-04, PRF-05, PRF-11 | T-09-07, T-09-08, T-09-11, T-09-13 | createPasskey + authenticateWithPasskey accept prfOptions; pass extensions.prf.eval.first; extract sealingKeyHex via hex encoding; round-trip determinism through HMAC mock | unit | `npm test -- --run src/__tests__/prf.test.ts` | ✅ src/client/passkey.ts, src/__tests__/prf.test.ts | ⬜ pending |
| 09-02-T2 | 09-02 | 2 | PRF-06, PRF-07 | T-09-09 | finishRegistration and finishAuthentication thread sealingKeyHex via spread-conditional; serialized POST body OMITS field entirely when undefined (verified via raw-string assertion) | unit (fetch mock) | `npm test -- --run src/__tests__/prf.test.ts` | ✅ src/client/api.ts, src/__tests__/prf.test.ts | ⬜ pending |
| 09-03-T1 | 09-03 | 3 | PRF-01, PRF-09 | T-09-15, T-09-16, T-09-19 | useAnonAuth wires PRF salt; throws PRF_NOT_SUPPORTED when requirePrf=true and no sealingKeyHex; sources sealingKeyHex into both finish API calls; DEFAULT_PRF_SALT is module-level constant | unit (source-pattern) | `npm test -- --run src/__tests__/prf.test.ts` | ✅ src/client/hooks/useAnonAuth.tsx, src/__tests__/prf.test.ts | ⬜ pending |
| 09-03-T2 | 09-03 | 3 | PRF-10, PRF-12 | T-09-14, T-09-17, T-09-18, T-09-20 | package.json + lockfile bumped to 0.6.0; README documents salt immutability, browser matrix, NULL key-bundle migration | smoke + docs grep | `node -e "require('./package.json').version==='0.6.0' \|\| process.exit(1)" && grep -q 'WebAuthn PRF Extension' README.md && npm run build` | ✅ package.json, package-lock.json, README.md | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/__tests__/prf.test.ts` — created in 09-01-T3 (consolidated test file; replaces the original three proposed files)
- [x] Mock factory consolidated into `src/__tests__/prf.test.ts` (exported `makeMockCredentialWithPrf` and `makeMockCredentialNoPrf`); no separate `__mocks__/` directory needed since `vi.fn()` mocking suffices
- [x] Validation schema tests added to existing `src/__tests__/validation.test.ts` in 09-01-T2; no separate `api-finish-payloads.test.ts` needed since fetch-mock body assertions live in `prf.test.ts`

*Consolidated per the original VALIDATION.md note: "If existing test infra already covers WebAuthn ceremony mocking, planner may consolidate."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real authenticator PRF on Chrome 116+ | PRF wire correctness end-to-end | Headless test runners and the vitest Node environment cannot exercise a real WebAuthn authenticator | After all 3 plans complete: build a sample app linking to the local v0.6.0 build, run on Chrome 116+, register passkey, verify `sealingKeyHex` appears in the POST body in DevTools Network tab and that the auth-service provisions a DEK |
| Real authenticator PRF on Safari 18+ | PRF wire correctness on iCloud Keychain | Headless can't reach iOS Safari authenticator | Same flow on Safari 18+ (iOS 18 / macOS 15) — PRF should fire on both create() and get() (iCloud Keychain returns results.first on registration) |
| Firefox graceful degradation | requirePrf:false default path | Firefox lacks PRF support and Vitest cannot reproduce the absence | Run sample app on current Firefox, verify registration completes, no `sealingKeyHex` sent in request body, encrypted endpoints 401 with the documented UI warning |
| requirePrf:true rejection on Firefox | PRF-09 hard-fail path | Same — needs real Firefox | Set `requirePrf: true`, attempt registration on Firefox, verify state.error contains `PRF_NOT_SUPPORTED` |
| caBLE / hybrid transport PRF survival | PRF cross-device | Requires phone-as-authenticator pairing | Cross-device passkey ceremony (phone scanning desktop QR), verify PRF result still surfaces on the desktop side |
| Hardware key (YubiKey) PRF on get() but not create() | RESEARCH.md spec clarification | Real YubiKey required | Register on YubiKey 5 series with PRF firmware, confirm no `sealingKeyHex` on registration POST, then confirm `sealingKeyHex` appears on first login POST |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify with concrete commands (no MISSING references)
- [x] Sampling continuity: every task has automated verification (no 3-task gap)
- [x] Wave 0 covered by 09-01-T3 (prf.test.ts scaffold) — no separate Wave 0 plan needed
- [x] No watch-mode flags (all use `--run`)
- [x] Feedback latency < 15s (vitest full suite ~10s on this codebase)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved — ready for execution
