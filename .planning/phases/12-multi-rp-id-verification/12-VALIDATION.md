---
phase: 12
slug: multi-rp-id-verification
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-29
updated: 2026-04-29
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | `vitest.config.ts` (globals: true, environment: node) |
| **Quick run command** | `nvm use 20 && npm test -- --run src/__tests__/related-origins.test.ts` |
| **Full suite command** | `nvm use 20 && npm test -- --run` |
| **Estimated runtime** | ~30 seconds full suite; ~3 seconds focused |

---

## Sampling Rate

- **After every task commit:** Run `nvm use 20 && npm test -- --run src/__tests__/related-origins.test.ts`
- **After every plan wave:** Run `nvm use 20 && npm run build && npm run typecheck && npm test -- --run`
- **Before `/gsd-verify-work`:** Full suite must be green; build + typecheck must succeed
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

Each task in `12-NN-PLAN.md` maps to a row below. Plan IDs:
- **12-01:** Types + RelatedOrigin export (Wave 1)
- **12-02:** Validator helper + Wave-0 unit tests (Wave 2)
- **12-03:** Standalone-export type widening (Wave 2)
- **12-04:** Integration (passkey.ts + index.ts + README + integration tests) (Wave 3)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-T1 | 01 | 1 | RPID-01 | T-12-01 / T-12-04 | RelatedOrigin paired-tuple type with both fields required; AnonAuthConfig.rp.relatedOrigins?: optional | typecheck + structural grep | `nvm use 20 && npm run typecheck` | ✅ existing — extend | ⬜ pending |
| 12-01-T2 | 01 | 1 | RPID-01 | — | RelatedOrigin re-exported from /server public surface | unit (compile fixture + source grep) | `nvm use 20 && npm test -- --run src/__tests__/exports.test.ts` | ✅ existing — extend | ⬜ pending |
| 12-02-T1 | 02 | 2 | RPID-01 / RPID-02 | T-12-01 / T-12-02 | Wave-0 RED tests for every validateRelatedOrigins branch (≥12 it() blocks) | unit (TDD RED state) | `nvm use 20 && npm test -- --run src/__tests__/related-origins.test.ts; test $? -ne 0` | ❌ W0 — created by this task | ⬜ pending |
| 12-02-T2 | 02 | 2 | RPID-02 | T-12-01 / T-12-02 / T-12-04 | validateRelatedOrigins implementation: throws on malformed entries (count, wildcard, https, localhost-coupling, suffix-domain boundary, duplicate-of-primary); returns fresh copy on success | unit (RED → GREEN) | `nvm use 20 && npm test -- --run src/__tests__/related-origins.test.ts` | ❌ W0 — created by this task | ⬜ pending |
| 12-03-T1 | 03 | 2 | RPID-04 | T-12-04 | Standalone VerifyRegistrationInput / VerifyAuthenticationInput widened to `string \| string[]`; function bodies unchanged | typecheck + grep | `nvm use 20 && npm run typecheck && npm test -- --run src/__tests__/passkey.test.ts` | ✅ existing | ⬜ pending |
| 12-04-T4-B3 | 04 | 3 | RPID-04 | — | RPID-04 compile fixtures (Plan 04 Task 4 Block 3): both string and string[] forms compile for VerifyRegistrationInput AND VerifyAuthenticationInput | unit (positive compile) | `nvm use 20 && npm test -- --run src/__tests__/related-origins.test.ts` | ✅ extends Plan 02's file | ⬜ pending |
| 12-04-T1 | 04 | 3 | RPID-03 | T-12-01 / T-12-03 / T-12-04 | passkey.ts conditional-spread idiom: string when empty, [primary, ...mapped] when populated; primary at index 0; both call sites mirror | unit (existing tests + source grep — Plan 04 Task 4 Block 2) | `nvm use 20 && npm run typecheck && npm test -- --run src/__tests__/passkey.test.ts` | ✅ existing | ⬜ pending |
| 12-04-T2 | 04 | 3 | RPID-02 / RPID-03 | T-12-02 | createAnonAuth calls validateRelatedOrigins at startup before createPasskeyManager; throws on misconfig at construction time | typecheck + build | `nvm use 20 && npm run typecheck && npm run build` | ✅ existing | ⬜ pending |
| 12-04-T3 | 04 | 3 | RPID-05 | T-12-05 | README has Cross-Domain Passkeys (v0.7.0) section with /.well-known/webauthn skeleton, passkeys.dev + web.dev/W3C links, "library does NOT auto-host" callout, 5-origin cap | doc snapshot grep | `grep -q "## Cross-Domain Passkeys (v0.7.0)" README.md && grep -q "/.well-known/webauthn" README.md && grep -q "passkeys.dev" README.md && grep -q "library does NOT auto-host" README.md` | ✅ existing — extend | ⬜ pending |
| 12-04-T4 | 04 | 3 | RPID-02 / RPID-03 | T-12-01 / T-12-02 / T-12-NEW-03 | Integration tests: createAnonAuth-throws-on-misconfig (≥5 it() blocks); source-level conditional-spread invariant grep guards Pitfall 1 + Pitfall 5 | unit (integration + source grep) | `nvm use 20 && npm test -- --run src/__tests__/related-origins.test.ts` | ✅ extends Plan 02's file | ⬜ pending |
| RPID-04-COMPAT | 03 | 2 | RPID-04 | T-12-04 | Existing string-form callers in passkey.test.ts continue to compile and pass without changes (backwards-compat) | unit (rerun existing) | `nvm use 20 && npm test -- --run src/__tests__/passkey.test.ts` | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/__tests__/related-origins.test.ts` — created by Plan 02 Task 1 (RED state); extended by Plan 04 Task 4 (createAnonAuth integration + source-level invariant + RPID-04 compile fixtures)
- [x] `src/server/relatedOrigins.ts` — created by Plan 02 Task 2; transitions Plan 02 Task 1's tests from RED to GREEN
- [x] No vitest framework install needed (already present)

*Existing infrastructure — vitest config, mock factories from `registration-auth.test.ts` and `hooks-scaffolding.test.ts`, `__tsc_fail` precedent from `mpc-treasury-leak.test.ts:212-241` — covers all Phase 12 verifications without additional setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real cross-domain passkey roundtrip in a browser | RPID-03, RPID-05 | Requires two real https origins + a deployed `/.well-known/webauthn` document; cannot be CI-gated | Optional smoke: deploy two test domains (e.g., `a.example.io`, `b.example.io`), serve the documented JSON skeleton, register a passkey on origin A, authenticate on origin B, expect success |

*All other Phase 12 behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (`related-origins.test.ts`, `relatedOrigins.ts`)
- [x] No watch-mode flags
- [x] Feedback latency < 30s (~3s focused, ~30s full suite)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (Plans 12-01..12-04 generated; Per-Task Verification Map populated; Wave 0 dependencies created within Plans 02 and 04)
</content>
</invoke>
