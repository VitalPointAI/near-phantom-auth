---
phase: 11
slug: backup-eligibility-flags-hooks-scaffolding
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-29
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 (globals: true, environment: node) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `nvm use 20 && npm test -- --run` |
| **Full suite command** | `nvm use 20 && npm test -- --run && npm run build && npm run typecheck` |
| **Estimated runtime** | ~30 seconds (test suite); ~60 seconds with build + typecheck |

---

## Sampling Rate

- **After every task commit:** Run `nvm use 20 && npm test -- --run`
- **After every plan wave:** Run full suite (`npm test -- --run && npm run build && npm run typecheck`)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds (test-only); ~60 seconds (full)

---

## Per-Task Verification Map

> Filled by gsd-planner during plan generation. Each task in every PLAN.md must map to a row here. Status updates by gsd-executor as work lands.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD     | TBD  | TBD  | TBD         | TBD        | TBD             | TBD       | TBD               | TBD         | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/server/backup.ts` — implementation file for `deriveBackupEligibility(deviceType)` (single source of truth for BACKUP-05)
- [ ] `src/__tests__/backup.test.ts` — covers BACKUP-05 (deriveBackupEligibility unit tests for both `singleDevice` and `multiDevice` inputs)
- [ ] `src/__tests__/hooks-scaffolding.test.ts` — covers HOOK-01 (compile fixtures for `hooks: {}`, threading spy through `createAnonAuth → createRouter / createOAuthRouter`, grep assertion that no call sites exist for hook callbacks in Phase 11 scope)

*Existing infrastructure (`vitest.config.ts`, `supertest` pattern in `registration-auth.test.ts`, mock factories) covers all other Phase 11 verifications without changes.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| JSDoc BE/BS lifecycle on `verifyRegistration()` reads correctly to a human consumer | BACKUP-03 | Doc-quality assertion is subjective; tsc only verifies the doc compiles, not that it explains BE vs BS clearly | Read `src/server/webauthn.ts` JSDoc on `verifyRegistration`; confirm the comment explicitly distinguishes BE (capability, immutable post-registration) vs BS (state, can flip 0→1 on subsequent authentications) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (full); < 30s (test-only)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
