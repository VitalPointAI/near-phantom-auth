---
phase: 10
slug: mpcaccountmanager
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-28
updated: 2026-04-28
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
| 10-01-T1 | 10-01 | 1 | MPC-01 | T-export-bug | `MPCAccountManager` resolves to a constructor at runtime (not type-only) | unit | `npm test -- --run src/__tests__/exports.test.ts` | ✅ | ⬜ pending |
| 10-01-T2 | 10-01 | 1 | MPC-01 | T-export-bug | Forward-compatible types `MPCAccountManagerConfig`, `CreateAccountResult` exported | unit | `npm test -- --run src/__tests__/exports.test.ts` | ✅ | ⬜ pending |
| 10-02-T1 | 10-02 | 1 | MPC-11 (scaffold) | — | T1–T12 scaffold present as `it.todo` | unit | `npm test -- --run src/__tests__/mpc-account-manager.test.ts` | ✅ | ⬜ pending |
| 10-03-T1 | 10-03 | 2 | MPC-05 | T-permission-bypass | `checkWalletAccess` distinguishes FullAccess from FunctionCall | unit | `npm test -- --run src/__tests__/wallet.test.ts` | ✅ | ⬜ pending |
| 10-03-T2 | 10-03 | 2 | MPC-04 | T-deleted-account-throw | `verifyRecoveryWallet` returns false for deleted accounts | unit | `npm test -- --run src/__tests__/wallet.test.ts` | ✅ | ⬜ pending |
| 10-04-T1 | 10-04 | 3 | MPC-02, MPC-03, MPC-06, MPC-08, MPC-09, MPC-10 | T-double-provision | createAccount idempotency + concurrent retry + parseNearAmount + KeyPair field | unit | `npm test -- --run src/__tests__/mpc-account-manager.test.ts src/__tests__/mpc.test.ts src/__tests__/logging.test.ts` | ✅ | ⬜ pending |
| 10-04-T2 | 10-04 | 3 | MPC-11 | — | T1–T12 fully populated and passing (testnet-gated for T1/T2/T7/T11) | unit + integration | `npm test -- --run src/__tests__/mpc-account-manager.test.ts` | ✅ | ⬜ pending |
| 10-05-T1 | 10-05 | 4 | MPC-07, MPC-09 | T-private-key-leak | grep dist/ for treasuryPrivateKey + runtime log capture fixture | source-grep + unit | `grep -rn treasuryPrivateKey dist/server/ --include="*.js" --include="*.cjs"` + `npm test -- --run src/__tests__/mpc-treasury-leak.test.ts` | ✅ | ⬜ pending |
| 10-06-T1 | 10-06 | 5 | MPC-12 | — | Version bump, CHANGELOG, README updates | manual + automated | `npm run build && grep -E '0\.6\.1' CHANGELOG.md package.json` | ✅ | ⬜ pending |
| 10-06-T2 | 10-06 | 5 | MPC-12 | T-supply-chain | npm publish + fresh-consumer smoke install | manual (autonomous: false) | see Plan 10-06 Task 2 checkpoint steps | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Project convention is `src/__tests__/` (15 existing test files all live there). All Wave 0 paths reconciled to that convention.

- [x] `src/__tests__/mpc-account-manager.test.ts` — T1–T12 scenarios for createAccount + verifyRecoveryWallet (mock NEAR RPC fetch). Created as scaffolded `it.todo` placeholders by Plan 10-02 (Wave 1); populated with assertions by Plan 10-04 (Wave 3).
- [x] `src/__tests__/exports.test.ts` — assert `MPCAccountManager` is a value (constructor) at runtime, not type-only. Created by Plan 10-01 (Wave 1).
- [x] `src/__tests__/mpc-treasury-leak.test.ts` — runtime log-stream fixture asserting treasuryPrivateKey is never serialized. Created by Plan 10-05 (Wave 4).
- [x] `src/__tests__/logging.test.ts` (existing) — source-grep for `treasuryPrivateKey` / `console.` calls; remains green throughout the phase.
- [x] Optional: `src/__tests__/mpc-account-manager.test.ts` integration block guarded by `describe.skipIf(!process.env.NEAR_TREASURY_ACCOUNT)` for T1/T2/T7/T11.

*Existing 252-test baseline must remain green at every wave boundary.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `npm publish` of v0.6.1 | Phase success criterion #6 | Requires npm token + version bump + tag push; not automatable in CI gate | `npm version 0.6.1 && npm publish && git push --tags` |
| Fresh consumer install + import smoke | Phase success criterion #6 | Requires creating a throwaway directory and `npm install @vitalpoint/near-phantom-auth@0.6.1` | Create temp dir, `npm init -y`, `npm i @vitalpoint/near-phantom-auth@0.6.1`, run `node -e "import('@vitalpoint/near-phantom-auth/server').then(m => console.log(typeof m.MPCAccountManager))"` and confirm `function` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (test files for T1–T12)
- [x] No watch-mode flags (`--run` enforced)
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-28 (orchestrator reconciled paths to project convention `src/__tests__/`)
