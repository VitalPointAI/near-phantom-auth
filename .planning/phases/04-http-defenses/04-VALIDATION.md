---
phase: 4
slug: http-defenses
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/__tests__/rate-limiting.test.ts src/__tests__/csrf.test.ts src/__tests__/oauth-cookie-guard.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/__tests__/rate-limiting.test.ts src/__tests__/csrf.test.ts src/__tests__/oauth-cookie-guard.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 8 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 0 | SEC-02 | stub | `npx vitest run src/__tests__/rate-limiting.test.ts` | W0 | pending |
| 04-01-02 | 01 | 0 | SEC-03 | stub | `npx vitest run src/__tests__/csrf.test.ts` | W0 | pending |
| 04-01-03 | 01 | 0 | INFRA-05 | stub | `npx vitest run src/__tests__/oauth-cookie-guard.test.ts` | W0 | pending |
| 04-02-01 | 02 | 1 | SEC-02 | unit | `npx vitest run src/__tests__/rate-limiting.test.ts` | W0 | pending |
| 04-03-01 | 03 | 1 | SEC-03 | unit | `npx vitest run src/__tests__/csrf.test.ts` | W0 | pending |
| 04-04-01 | 04 | 1 | INFRA-05 | unit | `npx vitest run src/__tests__/oauth-cookie-guard.test.ts` | W0 | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/rate-limiting.test.ts` — stubs for SEC-02 (429 threshold, recovery stricter than auth)
- [ ] `src/__tests__/csrf.test.ts` — stubs for SEC-03 (403 without token, default disabled, OAuth exempt)
- [ ] `src/__tests__/oauth-cookie-guard.test.ts` — stubs for INFRA-05 (missing cookie-parser guard)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Trust proxy warning logged when req.ip is loopback | SEC-02 | Environment-specific; depends on proxy config | Deploy behind proxy without `trust proxy` set; observe log warning |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 8s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
