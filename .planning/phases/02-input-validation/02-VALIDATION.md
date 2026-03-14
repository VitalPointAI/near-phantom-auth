---
phase: 2
slug: input-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/__tests__/validation.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/__tests__/validation.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | SEC-05 | unit | `npx vitest run src/__tests__/validation.test.ts -t "register/finish"` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | SEC-05 | unit | `npx vitest run src/__tests__/validation.test.ts -t "passthrough"` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | SEC-05 | unit | `npx vitest run src/__tests__/validation.test.ts -t "login/finish type"` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | SEC-05 | unit | `npx vitest run src/__tests__/validation.test.ts -t "valid payloads"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/validation.test.ts` — stubs for SEC-05 schema acceptance and rejection tests
- [ ] `src/server/validation/schemas.ts` — the schema module (created in Wave 0 or Plan 01)

*Existing infrastructure covers framework install — vitest.config.ts present, globals enabled.*

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
