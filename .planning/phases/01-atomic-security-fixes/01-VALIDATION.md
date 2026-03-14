---
phase: 1
slug: atomic-security-fixes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | none — Wave 0 installs `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| W0-01 | 00 | 0 | — | infra | `npx vitest run` | ❌ W0 | ⬜ pending |
| 01-01 | 01 | 1 | SEC-01 | unit | `npx vitest run src/__tests__/session.test.ts` | ❌ W0 | ⬜ pending |
| 01-02 | 01 | 1 | BUG-03 | unit | `npx vitest run src/__tests__/session.test.ts` | ❌ W0 | ⬜ pending |
| 02-01 | 02 | 1 | SEC-04 | unit | `npx vitest run src/__tests__/mpc.test.ts` | ❌ W0 | ⬜ pending |
| 02-02 | 02 | 1 | BUG-01 | unit | `npx vitest run src/__tests__/mpc.test.ts` | ❌ W0 | ⬜ pending |
| 02-03 | 02 | 1 | BUG-02 | unit | `npx vitest run src/__tests__/mpc.test.ts` | ❌ W0 | ⬜ pending |
| 02-04 | 02 | 1 | DEBT-02 | unit | `npx vitest run src/__tests__/mpc.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — vitest config (framework installed but no config)
- [ ] `src/__tests__/session.test.ts` — stubs for SEC-01, BUG-03
- [ ] `src/__tests__/mpc.test.ts` — stubs for SEC-04, BUG-01, BUG-02, DEBT-02

*Wave 0 creates test infrastructure before implementation begins.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| BUG-02 byte layout matches NEAR RPC | BUG-02 | Borsh encoding must match on-chain expectation | Submit test transaction to NEAR testnet and verify acceptance |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
