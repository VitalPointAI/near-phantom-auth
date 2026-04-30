---
gsd_state_version: 1.0
milestone: v0.7.0
milestone_name: Consumer Hooks & Recovery Hardening
status: executing
stopped_at: Phase 13 verified — ANALYTICS-01..06 closed, 11/11 must-haves, suite green (397/4/0). Ready to plan Phase 14 or run /gsd-extract-learnings 13.
last_updated: "2026-04-30T10:49:43.765Z"
last_activity: 2026-04-30 -- Phase 14 planning complete
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 19
  completed_plans: 15
  percent: 79
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-29)

**Core value:** Every security-sensitive code path must be correct, tested, and production-safe
**Current focus:** Phase 13 — registration-analytics-hook

## Current Position

Phase: 13 (registration-analytics-hook) — VERIFIED COMPLETE
Plan: 5 of 5 (all verified)
Status: Ready to execute
Last activity: 2026-04-30 -- Phase 14 planning complete

## Performance Metrics

**Velocity:**

- Total plans completed: 19 (v0.5.x: Phases 1–8) + 6 (v0.6.1 Phase 10) + 3 (v0.6.0 Phase 9) = 18 across all milestones
- Average duration: -
- Total execution time: 0 hours (v0.7.0 not started)

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 09 | 3 | - | - |
| 10 | 6 | - | - |
| 11 | 6 | - | - |
| 12 | 4 | - | - |
| 13 | TBD | - | - |
| 14 | TBD | - | - |
| 15 | TBD | - | - |
| 16 | TBD | - | - |

**Recent Trend:**

- Last 5 plans: Phase 10-01 through 10-06 (v0.6.1 hotfix)
- Trend: Sequential clean execution after worktree-base-mismatch + sandbox issues recovered in Phase 10

*Updated after each plan completion*
| Phase 11 P03 | 5min | 1 tasks | 1 files |
| Phase 11 P04 | 9min | 2 tasks | 2 files |
| Phase 11 P05 | 8min | 3 tasks | 6 files |
| Phase 11 P06 | 2min | 1 tasks | 1 files |
| Phase 13 P01 | 3min | 2 tasks | 6 files |
| Phase 13 P02 | 14min | 5 tasks | 8 files |
| Phase 13 P03 | 11m | 3 tasks | 2 files |
| Phase 13 P04 | 5min | 2 tasks | 2 files |
| Phase 13 P05 | 6m31s | - tasks | - files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

**v0.7.0 locked decisions (resolved before requirements drafting, 2026-04-29):**

- [v0.7.0]: F3 lazy-backfill ownership = **pass-through hook** (NOT library-managed schema). Library invokes consumer's hook on `/login/finish`; consumer owns the schema and DB transaction. **No library schema migration in this milestone.**
- [v0.7.0]: F2 2FA hook timing = **inline, blocks session creation**. Hook fires after passkey verify + DB persist + MPC funding, BEFORE `sessionManager.createSession`. Hook throw → DB rollback (existing transaction wrapper).
- [v0.7.0]: F2 OAuth integration = **hook fires for OAuth too**. Renamed from `afterPasskeyVerify` to `hooks.afterAuthSuccess`. Fires on `/register/finish`, `/login/finish`, AND OAuth `/callback` success.
- [v0.7.0]: F5 sync mode = **`awaitAnalytics: boolean`** opt-in flag at top level of `AnonAuthConfig`. Default `false` (fire-and-forget).
- [v0.7.0]: Anonymity invariant non-negotiable; `MPCAccountManager` FROZEN; no new dependencies.
- [v0.7.0]: Phase 13 (Analytics) promoted earlier than Architecture researcher's suggested order — R2 type-level PII whitelist is highest-priority defense; landing it before F2/F3 means subsequent features are tested against it from day one.
- [v0.7.0]: R3 origin-spoofing defense (paired-tuple `relatedOrigins: Array<{ origin, rpId }>` type + startup validation) is load-bearing for Phase 12.
- [v0.7.0]: BACKFILL-03 contract: backfill failure must NEVER block login — hook errors caught, WARN-logged, response continues with `backfill: { backfilled: false, reason: 'skipped' }`.

**Recent v0.6.1 decisions affecting current work (carried forward):**

- [Phase 10]: `MPCAccountManager` contract is FROZEN by consumer pin — no field/method/return-shape renames in v0.7.0
- [Phase 10]: `derivationSalt` REQUIRED at the type level via tsc-fail fixture pattern (mirrored in ANALYTICS-03)
- [Init]: Make new DatabaseAdapter methods optional with internal fallbacks to avoid hard breaking changes (Phase 5) — but pass-through F3 framing means NO new adapter methods in v0.7.0
- [Init]: zod for runtime validation (Phase 2)
- [Init]: pino externalized in tsup.config.ts (Phase 3-01) — consumers provide their own pino instance
- [Phase 11]: backupEligible placed between backedUp and transports in verifyRegistration() credential shape — semantic adjacency, existing field order preserved — Mirrors plan spec for BACKUP-03; field-level JSDoc on each of deviceType/backedUp/backupEligible chosen over function-level only (Pitfall 7 defense at call-site)
- [Phase ?]: passkey field appended at END of /register/finish literal per Pattern S4 (additive, no reorder)
- [Phase ?]: BACKUP-04: AnonAuthState passkeyBackedUp/passkeyBackupEligible populated from result.passkey on register/login finish — no /session round-trip needed
- [Phase 13]: Phase 13 Wave 0 stub pattern: 6 analytics test files with 51 it.todo placeholders, header docblocks citing requirement IDs and analog files, only 'import { describe, it } from vitest' allowed (no production imports). Locks requirement->test-file 1:1 map for Plans 02-05 — Vitest registers it.todo as skipped, so stubs prove the file is wired without false-positive assertions; header docblocks pre-cite the analog (mpc-treasury-leak.test.ts:197-242, exports.test.ts:48-82, registration-auth.test.ts:18-211) so Wave 1+ executors do 1:1 swap, no re-discovery
- [Phase ?]: [Phase 13]: AnalyticsEvent union lives in src/server/analytics.ts (not types/index.ts) — co-located with runtime helpers (ALLOWED_EVENT_FIELDS, wrapAnalytics, redactErrorMessage); types/index.ts imports the union for AnonAuthHooks.onAuthEvent narrowing. Mirrors MPCAccountManagerConfig precedent in src/server/mpc.ts.
- [Phase ?]: [Phase 13]: awaitAnalytics?: boolean placed at TOP LEVEL of AnonAuthConfig (sibling of hooks), NOT nested under hooks. Locked decision per REQUIREMENTS line 11; controls library behavior, not hook behavior.
- [Phase ?]: [Phase 13]: tsc-fail fixture in analytics-pii-leak.test.ts uses ForbiddenCase interface (not as-const tuple) to make extraPrefix optional across union members; variant strings template-interpolated into fixture source, so loss of literal narrowing is acceptable.
- [Phase ?]: [Phase 13]: emit closure captured ONCE at createRouter() factory entry (Pitfall 2 — never per-request); 15 inline emit() call sites across all 11 unique lifecycle event variants; static-enum reasons at every catch site (NEVER Error.message); login.start emits boolean codenameProvided, never codename string.
- [Phase ?]: [Phase 13]: analytics-lifecycle.test.ts mock harness mirrors registration-auth.test.ts + recovery.test.ts verbatim — onAuthEvent vi.fn() spy passed via hooks, findEvent(spy, type) helper + expectNoPII(event) defense-in-depth scan for 6 forbidden PII keys. Sets canonical pattern for Plan 04 (OAuth) + Plan 05 (latency) test harnesses.
- [Phase ?]: [Phase 13]: redactErrorMessage frame-line filter (V8 stack format quirk) — original slice(0,2) was leaking Error.message via line 1 of err.stack; fixed to filter /^\s+at\s/ frame lines before slicing 2 entries; T-13-25 mitigation now actually mitigates
- [Phase ?]: [Phase 13]: await emit() applied to all 18 lifecycle call sites (15 in router.ts + 3 in oauth/router.ts) — wrapAnalytics returns Promise<void> in await mode; without await, awaitAnalytics:true silently degraded to fire-and-forget; fire-and-forget unaffected; test asserts elapsed > 4500ms in await mode
- [Phase ?]: [Phase 13]: pino capture stream uses level: 'warn' to filter non-WARN noise; setImmediate yield required after fire-and-forget rejected-Promise tests to flush .catch handler before assertion
- [Phase ?]: [Phase 13]: end-to-end latency contract pattern (performance.now() bounds with 5s hook < 500ms FF / > 4500ms await) is canonical for v0.7.0 hook surfaces; Phase 14 afterAuthSuccess and Phase 15 backfillKeyBundle should mirror

### Roadmap Evolution

- v0.5.x → v0.6.0: Phase 9 added (WebAuthn PRF extension)
- v0.6.0 → v0.6.1: Phase 10 added (MPCAccountManager hotfix; contract FROZEN)
- v0.6.1 → v0.7.0: Phases 11–16 added (Consumer Hooks & Recovery Hardening; 30 v1 requirements; additive minor bump):
  - Phase 11: Backup-Eligibility Flags + Hooks Scaffolding (BACKUP-01..05, HOOK-01)
  - Phase 12: Multi-RP_ID Verification (RPID-01..05)
  - Phase 13: Registration Analytics Hook (ANALYTICS-01..06) — promoted earlier for R2 PII defense
  - Phase 14: Second-Factor Enrolment Hook (HOOK-02..06)
  - Phase 15: Lazy-Backfill Hook (BACKFILL-01..04)
  - Phase 16: Release Prep (RELEASE-01..04)

### Pending Todos

None yet — Phase 11 planning is the next step.

## Deferred Items

Items acknowledged and deferred at v0.6.1 milestone close on 2026-04-29.
Carried over from v0.6.0 (which was never formally closed via /gsd-complete-milestone).
These require physical devices for cross-browser PRF testing and are orthogonal
to v0.7.0 Consumer Hooks scope.

| Category | Phase | Item | Status | Open scenarios | Reason deferred |
|----------|-------|------|--------|----------------|-----------------|
| uat_gap | 09 | 09-HUMAN-UAT.md | partial | 6 | WebAuthn PRF cross-browser testing — needs Firefox/Safari/hardware keys |
| verification_gap | 09 | 09-VERIFICATION.md | human_needed | n/a | Final PRF browser-support verification awaiting hardware availability |

To resolve later: run `/gsd-verify-work 09` against each scenario in 09-HUMAN-UAT.md, then re-run the verifier on phase 09.

### Blockers/Concerns

**v0.7.0 cross-cutting risks (from research synthesis):**

- **R1 (Phase 15):** Lazy backfill mid-write partial state. Mitigated by pass-through framing (consumer owns the transaction). Library contract: backfill failure NEVER blocks login (BACKFILL-03).
- **R2 (Phase 13):** Analytics PII leak via event SHAPE. Defended at type level with `__tsc_fail/analytics-pii-leak.test.ts` fixture (mirroring v0.6.1 MPC-07). Runtime whitelist as defense-in-depth.
- **R3 (Phase 12):** Multi-RP_ID origin spoofing via mis-paired arrays. Defended by `relatedOrigins: Array<{ origin: string; rpId: string }>` paired-tuple config + startup validation (https only, no wildcards, host suffix-domain of rpId, max 5 entries).

**Phases likely needing `/gsd-research-phase` during planning:**

- **Phase 15 (F3 Lazy-backfill):** IPFS dual-recovery semantics; concurrent-write defense even under pass-through framing; consumer-side schema contract examples for the README.
- **Phase 14 (F2 2FA hook):** MPC-funded-but-rolled-back trade-off articulation; OAuth router instrumentation pattern; hook ctx shape for the 3 instrumentation sites.

**Phases with well-documented patterns (likely skip research):**

- Phase 11 — pure plumbing of already-extracted values; tsc-fail fixture pattern proven in v0.6.1.
- Phase 12 — `@simplewebauthn/server@^13.2.3` already supports array form; paired-tuple is the only design decision.
- Phase 13 — pattern established (Better Auth, Authsignal); type-level whitelist follows v0.6.1 MPC-07 tsc-fail pattern.
- Phase 16 — standard close-out, done 3x before (v0.5.x informally, v0.6.0, v0.6.1).

## Session Continuity

Last session: 2026-04-30T03:30:00.000Z
Stopped at: Phase 13 verified — ANALYTICS-01..06 closed, 11/11 must-haves, suite green (397/4/0). Ready to plan Phase 14 or run /gsd-extract-learnings 13.
Resume file: None
