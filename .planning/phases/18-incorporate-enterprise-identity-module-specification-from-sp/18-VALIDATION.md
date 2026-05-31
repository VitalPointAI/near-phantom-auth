---
phase: 18
slug: incorporate-enterprise-identity-module-specification-from-sp
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-31
---

# Phase 18 - Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | vitest |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test -- --run src/__tests__/enterprise-config.test.ts src/__tests__/enterprise-binding.test.ts src/__tests__/enterprise-session.test.ts src/__tests__/scim-users.test.ts src/__tests__/scim-groups.test.ts src/__tests__/enterprise-anonymity.test.ts src/__tests__/enterprise-docs.test.ts` |
| Full suite command | `npm test -- --run` |
| Typecheck command | `npm run typecheck` |
| Estimated runtime | ~30-60 seconds for focused tests; full suite project-dependent |

## Sampling Rate

- After every task commit: run the focused test file for that plan.
- After every plan wave: run the full Phase 18 focused command.
- Before `$gsd-verify-work`: run `npm test -- --run`, `npm run typecheck`, and `npm run build`.
- Max feedback latency: 60 seconds for focused tests.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 0 | ENT-01 | T-18-01 | Enterprise config is optional and default-off. | unit/type | `npm test -- --run src/__tests__/enterprise-config.test.ts` | W0 | pending |
| 18-01-02 | 01 | 0 | ENT-01, ENT-07 | T-18-01 | Exports are additive and absent config returns no SCIM router. | unit/type | `npm run typecheck` | W0 | pending |
| 18-02-01 | 02 | 1 | ENT-02 | T-18-01, T-18-02 | Enterprise schema is conditional and separate from anonymous schema. | unit | `npm test -- --run src/__tests__/enterprise-binding.test.ts` | W0 | pending |
| 18-02-02 | 02 | 1 | ENT-02 | T-18-05 | Link/resolve/status CRUD is idempotent and track-isolated. | unit | `npm test -- --run src/__tests__/enterprise-binding.test.ts` | W0 | pending |
| 18-03-01 | 03 | 1 | ENT-03 | T-18-05 | Binding service mints only when needed and emits secret-free events. | unit | `npm test -- --run src/__tests__/enterprise-binding.test.ts` | W0 | pending |
| 18-04-01 | 04 | 2 | ENT-04 | T-18-03 | Enterprise sessions carry track discriminator. | unit | `npm test -- --run src/__tests__/enterprise-session.test.ts` | W0 | pending |
| 18-04-02 | 04 | 2 | ENT-04 | T-18-03 | Suspended/deprovisioned enterprise sessions are rejected and deleted. | integration | `npm test -- --run src/__tests__/enterprise-session.test.ts` | W0 | pending |
| 18-05-01 | 05 | 3 | ENT-05 | T-18-04 | Every SCIM Users request requires bearer auth. | integration | `npm test -- --run src/__tests__/scim-users.test.ts` | W0 | pending |
| 18-05-02 | 05 | 3 | ENT-05 | T-18-03, T-18-05 | SCIM active:false deprovisions and kills live sessions. | integration | `npm test -- --run src/__tests__/scim-users.test.ts` | W0 | pending |
| 18-06-01 | 06 | 3 | ENT-06 | T-18-02 | Groups mutate external attributes only; no role policy is encoded. | integration | `npm test -- --run src/__tests__/scim-groups.test.ts` | W0 | pending |
| 18-07-01 | 07 | 4 | ENT-08 | T-18-01, T-18-02 | README and anonymity audit describe opt-in three-track model. | docs/test | `npm test -- --run src/__tests__/enterprise-docs.test.ts` | W0 | pending |

## Wave 0 Requirements

- `src/__tests__/enterprise-config.test.ts` - stubs for ENT-01 and ENT-07.
- `src/__tests__/enterprise-binding.test.ts` - stubs for ENT-02 and ENT-03.
- `src/__tests__/enterprise-session.test.ts` - stubs for ENT-04.
- `src/__tests__/scim-users.test.ts` - stubs for ENT-05.
- `src/__tests__/scim-groups.test.ts` - stubs for ENT-06.
- `src/__tests__/enterprise-anonymity.test.ts` - cross-track isolation assertions for ENT-01, ENT-02, ENT-08.
- `src/__tests__/enterprise-docs.test.ts` - docs grep assertions for ENT-07 and ENT-08.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Okta/Entra SCIM compatibility | ENT-05, ENT-06 | Requires external IdP tenant credentials and callback configuration. | Configure a test IdP SCIM app against `/scim/v2`; provision, update active=false, delete, and group update. Record any provider-specific payload differences as follow-up docs or tests. |

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target under 60 seconds for focused tests.
- [x] `nyquist_compliant: true` set in frontmatter.

Approval: pending

