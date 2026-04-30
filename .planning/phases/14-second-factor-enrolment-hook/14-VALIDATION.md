---
phase: 14
slug: second-factor-enrolment-hook
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-30
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 [VERIFIED: package.json:91] |
| **Config file** | `vitest.config.ts` (root) — `globals: true, environment: 'node'` |
| **Quick run command** | `nvm use 20 && npm test -- --run src/__tests__/<file>.test.ts` |
| **Full suite command** | `nvm use 20 && npm test -- --run` |
| **Type check** | `nvm use 20 && npm run typecheck` |
| **Estimated runtime** | ~30s full suite (4 new test files add ~5s) |

---

## Sampling Rate

- **After every task commit:** `nvm use 20 && npm test -- --run src/__tests__/second-factor-<file>.test.ts && npm run typecheck`
- **After every plan wave:** `nvm use 20 && npm test -- --run` (full suite)
- **Before `/gsd-verify-work`:** Full suite green + typecheck green + 4 new test files passing
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

> Populated by gsd-planner during plan generation. Each task in each PLAN.md must map to a row here so feedback sampling has a known automated command per commit.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD     | TBD  | TBD  | TBD         | TBD        | TBD             | TBD       | TBD               | TBD         | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/second-factor-register.test.ts` — covers HOOK-02 + HOOK-05 (passkey register fire + short-circuit)
- [ ] `src/__tests__/second-factor-login.test.ts` — covers HOOK-03 + HOOK-05 (passkey login fire + short-circuit)
- [ ] `src/__tests__/second-factor-oauth.test.ts` — covers HOOK-04 + HOOK-05 (OAuth × 3 branches fire + short-circuit)
- [ ] `src/__tests__/second-factor-orphan.test.ts` — covers HOOK-06 (DB rollback on throw + orphan-MPC contract test)

No framework install needed — vitest, supertest, pino already in `package.json`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| README documents the MPC-funded-but-rolled-back failure mode and idempotent-hook mitigation | HOOK-06 (Success Criterion 5) | Documentation accuracy is human-judgement; automated grep can confirm presence of key phrases but cannot validate clarity | (1) Open `README.md`, locate the `hooks.afterAuthSuccess` section. (2) Confirm it includes: (a) explicit statement that MPC `createAccount` runs BEFORE `db.transaction()`, (b) the orphan-MPC scenario (hook throw → DB rollback → orphan funded MPC account), (c) recommended mitigation (idempotent, non-throwing hooks; return `{ continue: false }` for soft failures). (3) Confirm a `grep -E "MPC|orphan|rollback|idempotent" README.md` returns the relevant lines. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (4 new test files)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
