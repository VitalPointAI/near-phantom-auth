---
phase: 7
slug: test-coverage
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` (root) — `globals: true`, `environment: 'node'` |
| **Quick run command** | `npx vitest run src/__tests__/<file>.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/__tests__/<relevant-file>.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 7-01-01 | 01 | 1 | TEST-02 | unit | `npx vitest run src/__tests__/passkey.test.ts` | ❌ W0 | ⬜ pending |
| 7-01-02 | 01 | 1 | TEST-04 | unit | `npx vitest run src/__tests__/ipfs.test.ts` | ❌ W0 | ⬜ pending |
| 7-01-03 | 01 | 1 | TEST-05 | unit | `npx vitest run src/__tests__/wallet.test.ts` | ❌ W0 | ⬜ pending |
| 7-01-04 | 01 | 1 | TEST-06 | unit | `npx vitest run src/__tests__/codename.test.ts` | ❌ W0 | ⬜ pending |
| 7-02-01 | 02 | 1 | TEST-03 | unit | `npx vitest run src/__tests__/mpc.test.ts` | ✅ | ⬜ pending |
| 7-02-02 | 02 | 1 | TEST-03 | unit | `npx vitest run src/__tests__/db-integrity.test.ts` | ✅ | ⬜ pending |
| 7-03-01 | 03 | 2 | TEST-07 | integration | `npx vitest run src/__tests__/registration-auth.test.ts` | ❌ W0 | ⬜ pending |
| 7-03-02 | 03 | 2 | TEST-08 | integration | `npx vitest run src/__tests__/recovery.test.ts` | ❌ W0 | ⬜ pending |
| 7-04-01 | 04 | 2 | TEST-01 | adversarial | `npx vitest run src/__tests__/session.test.ts` | ✅ | ⬜ pending |
| 7-04-02 | 04 | 2 | TEST-02 | adversarial | `npx vitest run src/__tests__/passkey.test.ts` | ❌ W0 | ⬜ pending |
| 7-04-03 | 04 | 2 | TEST-05 | adversarial | `npx vitest run src/__tests__/wallet.test.ts` | ❌ W0 | ⬜ pending |
| 7-04-04 | 04 | 2 | TEST-03 | adversarial | `npx vitest run src/__tests__/mpc.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/passkey.test.ts` — stubs for TEST-02
- [ ] `src/__tests__/ipfs.test.ts` — stubs for TEST-04
- [ ] `src/__tests__/wallet.test.ts` — stubs for TEST-05
- [ ] `src/__tests__/codename.test.ts` — stubs for TEST-06
- [ ] `src/__tests__/registration-auth.test.ts` — stubs for TEST-07
- [ ] `src/__tests__/recovery.test.ts` — stubs for TEST-08

*Existing infrastructure: vitest configured, supertest installed, node_modules present — no framework install needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
