---
phase: 04-http-defenses
plan: "03"
subsystem: server/csrf
tags: [csrf, security, oauth, cookie-parser, middleware]
dependency_graph:
  requires: [04-02]
  provides: [csrf-protection, infra-05-guard]
  affects: [src/server/router.ts, src/server/oauth/router.ts]
tech_stack:
  added: [csrf-csrf@4.0.3]
  patterns: [double-submit-cookie, opt-in-middleware, oauth-csrf-exemption]
key_files:
  created:
    - src/__tests__/csrf.test.ts
    - src/__tests__/oauth-cookie-guard.test.ts
  modified:
    - src/server/router.ts
    - src/server/oauth/router.ts
decisions:
  - getCsrfTokenFromRequest replaces getTokenFromRequest (csrf-csrf v4 renamed field)
  - generateCsrfToken replaces generateToken (csrf-csrf v4 renamed field)
  - getSessionIdentifier uses req.ip — required by csrf-csrf v4; IP-based session binding is appropriate for stateless CSRF validation
  - skipCsrfProtection regex is ^\/[^/]+\/callback$ not ^\/oauth\/... — req.path is relative to mount point inside Express sub-router
  - INFRA-05 guard fires for all consumers regardless of CSRF setting — consumer may disable CSRF but also forget cookie-parser
metrics:
  duration_minutes: 5
  completed_date: "2026-03-14"
  tasks_completed: 2
  files_changed: 4
---

# Phase 04 Plan 03: CSRF Protection and INFRA-05 Cookie Guard Summary

**One-liner:** Opt-in Double Submit Cookie CSRF protection via csrf-csrf with OAuth callback exemption and runtime cookie-parser detection guard (INFRA-05).

## What Was Built

CSRF protection using the Double Submit Cookie Pattern (csrf-csrf library), activated only when `config.csrf` is provided. A `/csrf-token` GET endpoint is exposed on the main router to retrieve tokens. The OAuth callback is exempt from CSRF via `skipCsrfProtection` since it arrives cross-origin from the OAuth provider (state parameter validation serves as its own CSRF defense). A runtime guard in the OAuth callback returns a clear 500 error when `req.cookies` is undefined, detecting missing `cookie-parser` middleware before silent failures can occur.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement CSRF protection and INFRA-05 cookie guard | 1ed0b67 | src/server/router.ts, src/server/oauth/router.ts |
| 2 | Implement CSRF and cookie guard tests | 19ee440 | src/__tests__/csrf.test.ts, src/__tests__/oauth-cookie-guard.test.ts |

## Verification

- `npx vitest run src/__tests__/csrf.test.ts src/__tests__/oauth-cookie-guard.test.ts` — 9 tests pass
- `npx vitest run` — 92 tests pass, zero failures
- CSRF-protected POST without token returns 403 when enabled
- POST with valid token (x-csrf-token header + CSRF cookie) returns non-403
- CSRF disabled by default — no behavior change for existing consumers
- OAuth callback not blocked by CSRF (skipCsrfProtection exemption)
- OAuth callback returns 500 with "cookie-parser" in error when req.cookies undefined
- OAuth callback with cookie-parser mounted returns non-500

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] csrf-csrf v4 renamed API fields**
- **Found during:** Task 1 implementation
- **Issue:** Plan used csrf-csrf v3 field names: `getTokenFromRequest` and `generateToken`. These don't exist in v4. Also `getSessionIdentifier` is required in v4 but not documented in plan.
- **Fix:** Used v4 names: `getCsrfTokenFromRequest`, `generateCsrfToken`, added `getSessionIdentifier: (req) => req.ip ?? ''`
- **Files modified:** src/server/router.ts, src/server/oauth/router.ts
- **Commit:** 1ed0b67

## Self-Check: PASSED

Files exist:
- src/server/router.ts — FOUND
- src/server/oauth/router.ts — FOUND
- src/__tests__/csrf.test.ts — FOUND
- src/__tests__/oauth-cookie-guard.test.ts — FOUND

Commits exist:
- 1ed0b67 — FOUND
- 19ee440 — FOUND
