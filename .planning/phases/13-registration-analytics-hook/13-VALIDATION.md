---
phase: 13
slug: registration-analytics-hook
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-29
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source of truth for the validation map: `13-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 (devDep; latest 4.1.5 — upgrade out of scope) |
| **Config file** | `vitest.config.ts` (root) — `globals: true, environment: 'node'` |
| **Quick run command** | `nvm use 20 && npm test -- --run src/__tests__/<file>.test.ts` |
| **Full suite command** | `nvm use 20 && npm test -- --run` |
| **Type check** | `nvm use 20 && npm run typecheck` |
| **Estimated runtime** | ~30s full suite + ~10s tsc-fail fixture |

---

## Sampling Rate

- **After every task commit:** `nvm use 20 && npm test -- --run src/__tests__/<file you touched>.test.ts && npm run typecheck`
- **After every plan wave:** `nvm use 20 && npm test -- --run`
- **Before `/gsd-verify-work`:** Full suite must be green AND `npm run typecheck` clean
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| ANALYTICS-01 | All 13 lifecycle events emitted at correct boundaries with bounded payloads (passkey + recovery + account-delete) | integration (supertest) | `nvm use 20 && npm test -- --run src/__tests__/analytics-lifecycle.test.ts` | ❌ W0 | ⬜ pending |
| ANALYTICS-01 | `oauth.callback.success` fires from all 3 OAuth code paths | integration (supertest) | `nvm use 20 && npm test -- --run src/__tests__/analytics-oauth.test.ts` | ❌ W0 | ⬜ pending |
| ANALYTICS-02 | Discriminated-union forbids PII keys (compile-time narrowing assertions) | unit (`expectTypeOf`) | `nvm use 20 && npm test -- --run src/__tests__/analytics-types.test.ts` | ❌ W0 | ⬜ pending |
| ANALYTICS-03 | Fixture declaring an event variant with `codename` / `userId` / `nearAccountId` / `email` / `ip` / `userAgent` fails `tsc --noEmit` | type-level fail (child-process tsc) | `nvm use 20 && npm test -- --run src/__tests__/analytics-pii-leak.test.ts` | ❌ W0 | ⬜ pending |
| ANALYTICS-04 | A 5-second `onAuthEvent` adds < 100ms to login latency in fire-and-forget mode | latency assertion (supertest + perf timing) | `nvm use 20 && npm test -- --run src/__tests__/analytics-latency.test.ts` | ❌ W0 | ⬜ pending |
| ANALYTICS-04 | Throwing `onAuthEvent` still produces 200 OK; pino WARN emitted with redacted message | integration (supertest + captured pino stream) | `nvm use 20 && npm test -- --run src/__tests__/analytics-latency.test.ts` | ❌ W0 | ⬜ pending |
| ANALYTICS-04 | `awaitAnalytics: true` makes the same 5s hook ADD ~5s to login latency (await path is wired) | latency assertion | `nvm use 20 && npm test -- --run src/__tests__/analytics-latency.test.ts` | ❌ W0 | ⬜ pending |
| ANALYTICS-05 | Each event variant's `Object.keys(variant)` is a subset of the allowed-fields whitelist; future addition of a non-whitelisted key fails the test | snapshot/whitelist | `nvm use 20 && npm test -- --run src/__tests__/analytics-pii-snapshot.test.ts` | ❌ W0 | ⬜ pending |
| ANALYTICS-06 | Default-emit failure events fire on `register.finish.failure` and `login.finish.failure` paths | integration (supertest, mocked verification rejection) | `nvm use 20 && npm test -- --run src/__tests__/analytics-lifecycle.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Per-task IDs (e.g., `13-01-01`) will be filled in by the planner; this table tracks coverage at the requirement level so the planner can trace `requirements_addressed` directly to a verification command.

---

## Wave 0 Requirements

- [ ] `src/__tests__/analytics-types.test.ts` — covers ANALYTICS-02 (compile-time narrowing assertions via `expectTypeOf`)
- [ ] `src/__tests__/analytics-pii-leak.test.ts` — covers ANALYTICS-03 (tsc-fail fixture, mirrors `src/__tests__/mpc-treasury-leak.test.ts:197-242`)
- [ ] `src/__tests__/analytics-pii-snapshot.test.ts` — covers ANALYTICS-05 (allowlist whitelist)
- [ ] `src/__tests__/analytics-lifecycle.test.ts` — covers ANALYTICS-01 + ANALYTICS-06 (passkey + recovery + account-delete + failure events)
- [ ] `src/__tests__/analytics-oauth.test.ts` — covers ANALYTICS-01 (oauth callback × 3 paths)
- [ ] `src/__tests__/analytics-latency.test.ts` — covers ANALYTICS-04 (latency + error-swallow + await mode)

No framework install required — `vitest`, `supertest`, `pino`, `typescript` are all pinned in `package.json`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| README "Hooks (v0.7.0)" docs accurately describe `onAuthEvent`, `awaitAnalytics`, allowed fields | (RELEASE-01 — Phase 16 owns this) | Documentation prose; out of Phase 13 scope | Phase 16 review |

*All Phase 13 functional behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All Phase 13 tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all `❌ W0` references in the verification map
- [ ] No watch-mode flags (`--watch`, `--ui`) — `--run` only
- [ ] Feedback latency < 60s (target: 30s quick run, 10s tsc-fail fixture)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
