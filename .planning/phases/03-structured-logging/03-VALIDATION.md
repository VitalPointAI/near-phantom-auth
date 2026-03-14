---
phase: 3
slug: structured-logging
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/__tests__/logging.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `grep -rn "console\." src/server/ --include="*.ts" | wc -l` (expect 0) + `npx vitest run src/__tests__/logging.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green + grep clean
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 0 | INFRA-01 | unit | `npx vitest run src/__tests__/logging.test.ts` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | INFRA-01 | unit | `npx vitest run src/__tests__/logging.test.ts` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | INFRA-01, SEC-06 | unit | `npx vitest run src/__tests__/logging.test.ts` | ❌ W0 | ⬜ pending |
| 3-01-04 | 01 | 2 | INFRA-01 | static | `grep -rn "console\." src/server/ --include="*.ts" \| wc -l` | ✅ | ⬜ pending |
| 3-01-05 | 01 | 2 | SEC-06 | unit | `npx vitest run src/__tests__/logging.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/logging.test.ts` — stubs for INFRA-01 (no-op default, injectable logger, child loggers) and SEC-06 (no sensitive fields in output)
- [ ] No framework install needed — vitest already present

*Existing infrastructure covers framework requirements.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
