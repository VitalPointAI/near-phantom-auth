---
phase: 10
slug: mpcaccountmanager
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-28
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- --run` |
| **Full suite command** | `npm test -- --run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run`
- **After every plan wave:** Run `npm test -- --run` (full suite — same as quick for this repo)
- **Before `/gsd-verify-work`:** Full suite must be green; existing 252 tests must remain green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> Filled by planner (per-plan task IDs map here). T1–T12 spec scenarios each get one `expect`-level assertion in test files; the planner is responsible for assigning T1–T12 to plan tasks and citing the test command per task.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _TBD by planner_ | — | — | MPC-01..12 | — | — | unit / integration | `npm test -- --run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/server/mpc-account-manager.test.ts` — T1–T12 scenarios for createAccount + verifyRecoveryWallet (mock NEAR RPC fetch)
- [ ] `tests/server/exports.test.ts` — assert `MPCAccountManager` is a value (constructor) at runtime, not type-only
- [ ] `tests/server/logging.test.ts` — extend (or rely on existing) source-grep for `treasuryPrivateKey` / `console.` calls
- [ ] Optional: `tests/server/integration.testnet.test.ts` — guarded by `describe.skipIf(!process.env.NEAR_TREASURY_ACCOUNT)` for T1/T2/T7/T11

*If none: "Existing infrastructure covers all phase requirements." — does NOT apply; new test files are required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `npm publish` of v0.6.1 | Phase success criterion #6 | Requires npm token + version bump + tag push; not automatable in CI gate | `npm version 0.6.1 && npm publish && git push --tags` |
| Fresh consumer install + import smoke | Phase success criterion #6 | Requires creating a throwaway directory and `npm install @vitalpoint/near-phantom-auth@0.6.1` | Create temp dir, `npm init -y`, `npm i @vitalpoint/near-phantom-auth@0.6.1`, run `node -e "import('@vitalpoint/near-phantom-auth/server').then(m => console.log(typeof m.MPCAccountManager))"` and confirm `function` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (test files for T1–T12)
- [ ] No watch-mode flags (`--run` enforced)
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
