---
phase: 5
slug: db-integrity-and-functional-stubs
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/__tests__/db-integrity.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/__tests__/db-integrity.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 1 | INFRA-02 | unit (mock db) | `npx vitest run src/__tests__/db-integrity.test.ts` | ❌ W0 | ⬜ pending |
| 5-02-01 | 02 | 1 | BUG-04 | unit (mock fetch) | `npx vitest run src/__tests__/db-integrity.test.ts` | ❌ W0 | ⬜ pending |
| 5-02-02 | 02 | 1 | STUB-01 | unit (mock fetch + RPC) | `npx vitest run src/__tests__/db-integrity.test.ts` | ❌ W0 | ⬜ pending |
| 5-03-01 | 03 | 2 | STUB-02 | integration (supertest) | `npx vitest run src/__tests__/db-integrity.test.ts` | ❌ W0 | ⬜ pending |
| 5-03-02 | 03 | 2 | STUB-03 | integration (supertest) | `npx vitest run src/__tests__/db-integrity.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/db-integrity.test.ts` — stubs for INFRA-02, BUG-04, STUB-01, STUB-02, STUB-03

*Existing infrastructure covers test framework; only test file stubs needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `addRecoveryWallet()` txHash verifiable on NEAR explorer | STUB-01 | Requires real testnet broadcast | After test passes, paste txHash into explorer.testnet.near.org |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
