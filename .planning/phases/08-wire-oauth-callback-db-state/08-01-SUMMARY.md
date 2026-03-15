---
phase: 08-wire-oauth-callback-db-state
plan: "01"
subsystem: oauth
tags: [oauth, db-state, csrf, cookieParser, replay-protection, infra-03, infra-05]
dependency_graph:
  requires: [06-01]  # OAuthManager.validateState() built in Phase 6
  provides: [INFRA-03]  # DB-backed OAuth state validation wired end-to-end
  affects: [oauth-router, oauth-manager]
tech_stack:
  added: []
  patterns:
    - DB-backed OAuth state validation replaces cookie comparison
    - Unconditional cookieParser mounting inside router
    - Atomic state consume (getOAuthState + deleteOAuthState) for replay protection
key_files:
  created: []
  modified:
    - src/server/oauth/router.ts
    - src/__tests__/oauth-cookie-guard.test.ts
decisions:
  - "cookieParser mounted unconditionally inside createOAuthRouter — consumers no longer need external cookieParser for OAuth to work; CSRF middleware also benefits since cookieParser is already present"
  - "INFRA-05 defense-in-depth guard retained — fires only in sub-app isolation edge cases where outer middleware strips req.cookies after router's own cookieParser ran; standard path goes through 400 state validation"
  - "Existing tests restructured for unconditional cookieParser: former 500-expectation tests now assert 400 (state validation), confirming cookieParser is internal to router"
metrics:
  duration_minutes: 3
  completed_date: "2026-03-14"
  tasks_completed: 2
  files_modified: 2
---

# Phase 08 Plan 01: Wire OAuth Callback to DB-backed State Validation Summary

**One-liner:** Replaced cookie-comparison state validation with `oauthManager.validateState()` (DB-backed, atomic, replay-safe) and moved `cookieParser()` unconditionally above the CSRF block in `oauth/router.ts`.

## What Was Built

### Task 1: Wire DB-backed state validation and unconditional cookieParser

Two surgical edits to `src/server/oauth/router.ts`:

**Edit 1 — Unconditional cookieParser:**
- Moved `router.use(cookieParser())` above the `if (config.csrf)` block
- Removed `router.use(cookieParser())` from inside the CSRF block (was duplicated)
- Result: exactly 1 `cookieParser()` call, unconditional, before any CSRF middleware

**Edit 2 — DB-backed state validation:**
- Removed: `const storedState = req.cookies?.oauth_state; if (state !== storedState) { ... }`
- Removed: `const codeVerifier = req.cookies?.oauth_code_verifier;`
- Added: `const oauthState = await oauthManager.validateState(state);`
- Added: `const codeVerifier = oauthState.codeVerifier;`
- Kept `clearCookie` calls for hygiene (browser cookies set during /start are cleaned up)
- INFRA-05 guard (`if (req.cookies === undefined)`) retained as defense-in-depth

**Commit:** `8dc0dfd`

### Task 2: Add DB-backed state validation tests and update existing cookie-guard tests (TDD)

Complete rewrite of `src/__tests__/oauth-cookie-guard.test.ts`:

**Updated INFRA-05 guard tests (3 tests):**
- Restructured for unconditional cookieParser: tests now assert 400 (state validation), not 500
- Sub-app isolation scenario documented as defense-in-depth (not normal path)
- Verified: no 500 from cookie guard when router used without external cookieParser

**New INFRA-03 DB-backed validation tests (7 tests):**
- Unknown state → 400 "Invalid state" (DB returns null)
- Valid DB record → passes state validation (status not 400, getOAuthState called)
- Atomic delete → `deleteOAuthState` called with state key on every valid callback
- Replay attack → second identical state returns 400 (state consumed on first use)
- codeVerifier from DB record → `getOAuthState` used, not cookie comparison
- No CSRF config → no 500 (cookieParser is internal, returns 400 from state validation)
- With CSRF enabled → callback exempt, cookieParser + CSRF coexist, no 500

**Commit:** `3a3fcbe`

## Test Results

```
Test Files   14 passed (14)
Tests        214 passed (214)
```

Previous baseline: 207 tests. Added 7 net new tests (10 in file vs 3 before).

## Verification

```
grep -n "oauthManager.validateState" src/server/oauth/router.ts
203:      const oauthState = await oauthManager.validateState(state);  ✓

grep -n "req.cookies?.oauth_state" src/server/oauth/router.ts
(no matches)  ✓

grep -c "router.use(cookieParser())" src/server/oauth/router.ts
1  ✓
```

## Deviations from Plan

None — plan executed exactly as written.

The test restructuring for the INFRA-05 guard (converting 500-expectation tests to 400-expectation tests) was explicitly anticipated in the plan under Task 2's action section ("The first two tests... need to be restructured").

## Self-Check: PASSED

Files created/modified:
- `src/server/oauth/router.ts` — FOUND
- `src/__tests__/oauth-cookie-guard.test.ts` — FOUND
- `.planning/phases/08-wire-oauth-callback-db-state/08-01-SUMMARY.md` — FOUND

Commits verified:
- `8dc0dfd` — FOUND (feat(08-01): wire DB-backed state validation and unconditional cookieParser)
- `3a3fcbe` — FOUND (test(08-01): add DB-backed state validation tests; update INFRA-05 guard tests)
