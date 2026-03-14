---
phase: 06-scalability-tech-debt-and-email
plan: "01"
subsystem: oauth
tags: [oauth, database, performance, scalability, join-queries]
dependency_graph:
  requires: []
  provides: [INFRA-03, PERF-01]
  affects: [src/server/oauth/index.ts, src/server/db/adapters/postgres.ts]
tech_stack:
  added: []
  patterns: [db-backed-oauth-state, atomic-consume, join-aggregation, fallback-map]
key_files:
  created: []
  modified:
    - src/types/index.ts
    - src/server/db/adapters/postgres.ts
    - src/server/oauth/index.ts
decisions:
  - "OAuthStateRecord defined in types/index.ts to avoid circular imports between types and oauth/index.ts"
  - "stateStore Map kept as fallback for custom adapters that do not implement DB state methods"
  - "Cleanup loop (expired state eviction) only runs in the in-memory fallback path; DB cleanup is handled by cleanExpiredOAuthStates scheduler"
  - "getOAuthUserByProvider uses subquery pattern: subquery finds user_id, main query fetches user + all providers in one round-trip"
  - "mapOAuthUserRows() shared helper eliminates duplicated row-to-OAuthUser mapping across three methods"
metrics:
  duration_minutes: 7
  completed: "2026-03-14"
  tasks_completed: 2
  files_modified: 3
---

# Phase 6 Plan 01: OAuth State DB Migration and JOIN Query Optimization Summary

**One-liner:** DB-backed OAuth state with atomic consume using oauth_state table + single JOIN queries replacing N+1 patterns in all three getOAuthUser* methods.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add OAuth state DB methods and oauth_state table; rewrite OAuth user lookups with JOINs | 848e572 | src/types/index.ts, src/server/db/adapters/postgres.ts |
| 2 | Replace in-memory Map with DB-backed state in createOAuthManager | 28560ca | src/server/oauth/index.ts |

## What Was Built

### oauth_state Table
Added `CREATE TABLE IF NOT EXISTS oauth_state` to POSTGRES_SCHEMA with columns: `state` (PK), `provider`, `code_verifier`, `redirect_uri`, `expires_at`, `created_at`. Added `idx_oauth_state_expires` index for cleanup queries.

### DatabaseAdapter Interface Extensions (src/types/index.ts)
Five new optional methods added:
- `storeOAuthState?(state: OAuthStateRecord): void | Promise<void>`
- `getOAuthState?(stateKey: string): Promise<OAuthStateRecord | null>`
- `deleteOAuthState?(stateKey: string): Promise<void>`
- `cleanExpiredChallenges?(): Promise<number>`
- `cleanExpiredOAuthStates?(): Promise<number>`

New `OAuthStateRecord` interface added (avoids circular imports — does not import from `oauth/index.ts`).

### Postgres Adapter (src/server/db/adapters/postgres.ts)
- `mapOAuthUserRows()`: shared helper that aggregates JOIN result rows into `OAuthUser | null`
- `getOAuthUserById`: single LEFT JOIN query replaces 2 sequential queries
- `getOAuthUserByEmail`: single LEFT JOIN query replaces 2 sequential queries
- `getOAuthUserByProvider`: subquery + JOIN replaces 2 sequential queries (one via `getOAuthUserById`)
- `storeOAuthState`: INSERT with ON CONFLICT DO NOTHING (idempotent)
- `getOAuthState`: SELECT with `expires_at > NOW()` filter
- `deleteOAuthState`: DELETE by state key
- `cleanExpiredChallenges`: DELETE from anon_challenges where expired
- `cleanExpiredOAuthStates`: DELETE from oauth_state where expired

### OAuth Manager (src/server/oauth/index.ts)
- `getAuthUrl`: stores state via `db.storeOAuthState` when available; falls back to in-memory Map with cleanup loop
- `validateState`: atomic consume via `db.getOAuthState` + `db.deleteOAuthState` when available; falls back to Map delete-on-read

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- TypeScript: 0 errors in source files (`npx tsc --noEmit` — pre-existing test errors only)
- Tests: 92 passed, 14 todo, 1 skipped (all green — no regressions)
- `grep stateStore.set` confirms it only appears in the `else` fallback branch
- All three `getOAuthUser*` methods confirmed to use single JOIN queries (no sequential `SELECT * FROM oauth_providers`)

## Self-Check: PASSED

- [x] 848e572 commit exists: `feat(06-01): add oauth_state table, JOIN-based OAuth lookups, DB state methods`
- [x] 28560ca commit exists: `feat(06-01): replace in-memory Map with DB-backed state in createOAuthManager`
- [x] `src/server/db/adapters/postgres.ts` contains `oauth_state` table and all 5 new methods
- [x] `src/server/oauth/index.ts` contains `db.storeOAuthState` and `db.getOAuthState` calls
- [x] `src/types/index.ts` contains `OAuthStateRecord` interface and 5 optional adapter methods
