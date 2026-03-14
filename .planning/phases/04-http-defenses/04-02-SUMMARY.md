---
phase: 04-http-defenses
plan: 02
subsystem: rate-limiting
tags: [security, rate-limiting, brute-force-protection, express-rate-limit]
dependency_graph:
  requires: [04-01]
  provides: [SEC-02]
  affects: [src/server/router.ts, src/server/oauth/router.ts]
tech_stack:
  added: [supertest@7.2.2, "@types/supertest"]
  patterns: [tiered-rate-limiting, per-route-middleware, configurable-thresholds]
key_files:
  created: [src/__tests__/rate-limiting.test.ts]
  modified: [src/server/router.ts, src/server/oauth/router.ts, package.json]
decisions:
  - "Separate limiter instances per router (router.ts vs oauth/router.ts) — independent per-IP counters; intentional isolation matching Phase 04-01 design"
  - "Recovery routes inside walletRecovery/ipfsRecovery conditional blocks still get recoveryLimiter — limiter registered at route-definition time, not call-time"
  - "Test helpers assert status !== 429 for under-limit requests — handlers may return 400/500 but that is correct test behavior"
metrics:
  duration_minutes: 5
  completed_date: "2026-03-14"
  tasks_completed: 2
  files_modified: 4
---

# Phase 04 Plan 02: Rate Limiting Implementation Summary

Tiered rate limiting with `express-rate-limit` applied to all auth and recovery routes via `authLimiter` (20 req/15min) and `recoveryLimiter` (5 req/1hr), both configurable through `RateLimitConfig`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement rate limiting in both routers | a3b1c9a | src/server/router.ts, src/server/oauth/router.ts, package.json |
| 2 | Implement rate limiting test suite | c0a8a98 | src/__tests__/rate-limiting.test.ts |

## What Was Built

### Task 1: Rate Limiting Implementation

**src/server/router.ts:**
- Added `import { rateLimit } from 'express-rate-limit'`
- Created `authLimiter` (default: 20 req/15min) reading from `config.rateLimiting?.auth`
- Created `recoveryLimiter` (default: 5 req/1hr) reading from `config.rateLimiting?.recovery`
- Both use `standardHeaders: 'draft-8'`, `legacyHeaders: false`, custom 429 JSON handler with pino warn log
- Applied `authLimiter` as first middleware argument on: `/register/start`, `/register/finish`, `/login/start`, `/login/finish`, `/logout`
- Applied `recoveryLimiter` on: `/recovery/wallet/link`, `/recovery/wallet/verify`, `/recovery/wallet/start`, `/recovery/wallet/finish`, `/recovery/ipfs/setup`, `/recovery/ipfs/recover`
- GET `/session` has no limiter (read-only, exempt by design)

**src/server/oauth/router.ts:**
- Added `import { rateLimit } from 'express-rate-limit'`
- Created `authLimiter` with identical config pattern (independent counter from router.ts)
- Applied `authLimiter` on: `GET /:provider/start`, `POST /:provider/callback`, `POST /:provider/link`

### Task 2: Rate Limiting Tests

**src/__tests__/rate-limiting.test.ts** — replaced all 6 `it.todo` stubs with 9 passing tests:

1. Auth limit exceeded returns 429 on (limit+1)th request
2. Configurable auth limits override defaults
3. Auth limiter applied to all 5 expected routes
4. Recovery limit exceeded returns 429 on (limit+1)th request
5. Recovery limiter fires before auth limiter at equal request rate (recovery limit=2, auth limit=5, 3 recovery requests get 429, 3 auth requests do not)
6. Configurable recovery limits override defaults
7. Recovery limiter applied to all /recovery/wallet/* routes
8. Default limits apply when rateLimiting config omitted (sends 21 requests to hit default of 20)
9. GET /session is exempt — never returns 429 even when auth limit is set low

## Verification Results

```
vitest run src/__tests__/rate-limiting.test.ts
✓ 9 tests passed (209ms)

vitest run (full suite)
5 passed | 2 skipped (CSRF + OAuth cookie guard — not yet implemented)
83 passed | 9 todo | 0 failed
```

TypeScript check: no new errors introduced (2 pre-existing WalletSignature type errors in router.ts unchanged from before Plan 02).

## Deviations from Plan

### Auto-added Dependencies

**[Rule 2 - Missing Dependency] Installed supertest and @types/supertest**
- Found during: Task 2 setup
- Issue: supertest was not in devDependencies, required for HTTP integration testing
- Fix: `npm install --save-dev supertest @types/supertest`
- Files modified: package.json, package-lock.json
- Commit: a3b1c9a

No other deviations — plan executed exactly as written.

## Self-Check

### Files Exist
- [x] src/server/router.ts — modified
- [x] src/server/oauth/router.ts — modified
- [x] src/__tests__/rate-limiting.test.ts — created

### Commits Exist
- [x] a3b1c9a — feat(04-02): implement tiered rate limiting on auth and recovery routes
- [x] c0a8a98 — feat(04-02): implement rate limiting test suite replacing all it.todo stubs

## Self-Check: PASSED
