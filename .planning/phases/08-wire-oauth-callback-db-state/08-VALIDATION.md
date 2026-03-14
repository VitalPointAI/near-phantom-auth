---
phase: 8
slug: wire-oauth-callback-db-state
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/__tests__/oauth-cookie-guard.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/__tests__/oauth-cookie-guard.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | INFRA-03 | integration | `npx vitest run src/__tests__/oauth-cookie-guard.test.ts` | Partial | ⬜ pending |
| 08-01-02 | 01 | 1 | INFRA-03 | unit | `npx vitest run src/__tests__/oauth-cookie-guard.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | INFRA-03 | unit | `npx vitest run src/__tests__/oauth-cookie-guard.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-04 | 01 | 1 | INFRA-03 | integration | `npx vitest run src/__tests__/oauth-cookie-guard.test.ts` | Partial | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New test cases in `src/__tests__/oauth-cookie-guard.test.ts`:
  - DB-backed `validateState()` called (mock `db.getOAuthState` returns valid record)
  - Atomic delete verified (`db.deleteOAuthState` called with the state key)
  - Replay rejected (second call returns 400 — `db.getOAuthState` returns null)
  - `cookieParser` works without CSRF enabled
  - `codeVerifier` comes from `oauthState.codeVerifier`, not cookie

*Existing infrastructure covers framework install — vitest and supertest already installed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
