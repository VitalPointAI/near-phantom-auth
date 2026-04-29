---
phase: 12
slug: multi-rp-id-verification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-29
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | `vitest.config.ts` (globals: true, environment: node) |
| **Quick run command** | `npm test -- --run src/__tests__/related-origins.test.ts` |
| **Full suite command** | `npm test -- --run` |
| **Estimated runtime** | ~30 seconds full suite; ~3 seconds focused |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run src/__tests__/related-origins.test.ts`
- **After every plan wave:** Run `npm run build && npm run typecheck && npm test -- --run`
- **Before `/gsd-verify-work`:** Full suite must be green; build + typecheck must succeed
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

Filled in by gsd-planner during plan generation. Each task in `*-PLAN.md` MUST map to a row here with: Task ID, Plan, Wave, Requirement (RPID-XX), Threat Ref (T-12-XX or —), Secure Behavior, Test Type, Automated Command, File Exists (✅ existing / ❌ Wave 0), Status.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | RPID-01 | — | Type accepts paired tuples; absent === [] | unit (compile fixture) | `npm test -- --run src/__tests__/related-origins.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RPID-02 | T-12-01 / T-12-02 | startup validation throws on malformed entries | unit | `npm test -- --run src/__tests__/related-origins.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RPID-03 | T-12-03 | paired arrays preserved by index in spread | unit (spy on lib args) | `npm test -- --run src/__tests__/related-origins.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RPID-03 | T-12-04 | forged origin returns verified: false | unit (mock library) | `npm test -- --run src/__tests__/related-origins.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RPID-04 | — | standalone exports widen string \| string[] | unit (positive compile) | `npm test -- --run src/__tests__/related-origins.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RPID-04 | — | existing string-form callers still pass | unit (rerun existing) | `npm test -- --run src/__tests__/passkey.test.ts` | ✅ existing | ⬜ pending |
| TBD | TBD | TBD | RPID-05 | — | README contains skeleton + links + non-hosting callout | doc snapshot grep | `npm test -- --run src/__tests__/exports.test.ts` (extend) | partial | ⬜ pending |
| TBD | TBD | TBD | All | — | Single-RP backwards-compat: opts shape stays string when relatedOrigins=[] | unit (spy on opts) | `npm test -- --run src/__tests__/registration-auth.test.ts` | ✅ existing — extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/related-origins.test.ts` — stubs for RPID-01, RPID-02, RPID-03, RPID-04, RPID-05 (positive + negative + paired-tuple spread + attack simulation)
- [ ] `src/server/relatedOrigins.ts` — pure-function `validateRelatedOrigins` helper file MUST exist (created by Wave 1 implementation, referenced by Wave 0 test imports — order: stub the helper first or use TDD red-state import errors)
- [ ] No vitest framework install needed (already present)

*Existing infrastructure — vitest config, supertest pattern, mock factories from `registration-auth.test.ts`, `__tsc_fail` precedent from `mpc-treasury-leak.test.ts:212-241` — covers all other Phase 12 verifications.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real cross-domain passkey roundtrip in a browser | RPID-03, RPID-05 | Requires two real https origins + a deployed `/.well-known/webauthn` document; cannot be CI-gated | Optional smoke: deploy two test domains (e.g., `a.example.io`, `b.example.io`), serve the documented JSON skeleton, register a passkey on origin A, authenticate on origin B, expect success |

*All other Phase 12 behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`related-origins.test.ts`, `relatedOrigins.ts`)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
