---
phase: 6
slug: scalability-tech-debt-and-email
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green + `npx tsc --noEmit`
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 1 | INFRA-03 | unit | `npx vitest run src/__tests__/oauth-state.test.ts` | ❌ W0 | ⬜ pending |
| 6-01-02 | 01 | 1 | INFRA-04 | unit | `npx vitest run src/__tests__/cleanup.test.ts` | ❌ W0 | ⬜ pending |
| 6-01-03 | 01 | 1 | DEBT-01 | unit | `npx vitest run src/__tests__/codename.test.ts` | ❌ W0 | ⬜ pending |
| 6-02-01 | 02 | 1 | DEBT-03 | type check | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 6-02-02 | 02 | 1 | DEBT-04 | manual/grep | `grep -n createTestnetAccount src/server/mpc.ts` | ✅ | ⬜ pending |
| 6-02-03 | 02 | 1 | PERF-01 | unit | `npx vitest run src/__tests__/db-integrity.test.ts` | ✅ extend | ⬜ pending |
| 6-02-04 | 02 | 1 | PERF-02 | unit | `npx vitest run src/__tests__/ipfs.test.ts` | ❌ W0 | ⬜ pending |
| 6-03-01 | 03 | 2 | EMAIL-01 | unit | `npx vitest run src/__tests__/email.test.ts` | ❌ W0 | ⬜ pending |
| 6-03-02 | 03 | 2 | EMAIL-02 | unit | `npx vitest run src/__tests__/oauth-email.test.ts` | ❌ W0 | ⬜ pending |
| 6-03-03 | 03 | 2 | BUG-05 | unit | `npx vitest run src/__tests__/oauth-email.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/oauth-state.test.ts` — stubs for INFRA-03
- [ ] `src/__tests__/cleanup.test.ts` — stubs for INFRA-04
- [ ] `src/__tests__/codename.test.ts` — stubs for DEBT-01
- [ ] `src/__tests__/ipfs.test.ts` — stubs for PERF-02
- [ ] `src/__tests__/email.test.ts` — stubs for EMAIL-01
- [ ] `src/__tests__/oauth-email.test.ts` — stubs for EMAIL-02 + BUG-05

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `createTestnetAccount` absent from mpc.ts | DEBT-04 | Absence check — grep confirms | `grep -n createTestnetAccount src/server/mpc.ts` should return empty |
| TypeScript rejects `type: 'sqlite'` | DEBT-03 | Compile-time check | `npx tsc --noEmit` with a test file using `type: 'sqlite'` should fail |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
