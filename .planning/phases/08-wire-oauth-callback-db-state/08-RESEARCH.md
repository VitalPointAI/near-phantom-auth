# Phase 8: Wire OAuth Callback to DB-Backed State Validation — Research

**Researched:** 2026-03-14
**Domain:** Express OAuth router surgery — wiring existing `oauthManager.validateState()` into callback handler; unconditional `cookieParser` mounting
**Confidence:** HIGH — all findings derived directly from reading codebase source files; no speculation required

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-03 | OAuth state stored in database instead of in-memory Map | DB storage side is complete. Callback consumption side is the gap. `oauthManager.validateState()` performs DB lookup + atomic deletion but is never called in `oauth/router.ts`. Two code changes close the requirement fully. |

</phase_requirements>

---

## Summary

Phase 8 is a targeted gap-closure phase identified by the v0.5 milestone audit. It requires exactly two surgical changes to `src/server/oauth/router.ts`:

1. Move `router.use(cookieParser())` outside the `if (config.csrf)` block so it mounts unconditionally — fixing the case where the INFRA-05 guard fires HTTP 500 when CSRF is disabled (because `req.cookies` is `undefined`).

2. Replace the inline cookie-comparison state validation (`state !== req.cookies?.oauth_state`) with a call to `oauthManager.validateState(state)` — the method already exists in `src/server/oauth/index.ts`, is fully implemented, performs DB lookup with expiry check, and atomically deletes the record on consume (replay protection).

The DB schema (`oauth_state` table), the adapter methods (`storeOAuthState`, `getOAuthState`, `deleteOAuthState`), and the `OAuthManager.validateState()` method are all already implemented and tested in isolation. This phase only wires them together in the router callback.

**Primary recommendation:** Two edits to `oauth/router.ts` and new/updated tests in `oauth-cookie-guard.test.ts` (or a new `oauth-state-validation.test.ts`). No new dependencies, no schema changes, no new interfaces.

---

## Standard Stack

All dependencies are already installed. No new packages needed.

### Core (already present)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `cookie-parser` | ^1.4.7 | Parse `Cookie` header into `req.cookies` | Already in deps; already imported in `oauth/router.ts` |
| `vitest` | ^4.0.18 | Test runner | Project standard; all 14 test files use it |
| `supertest` | ^7.2.2 | HTTP integration testing | Used in `oauth-cookie-guard.test.ts` and `registration-auth.test.ts` |

### No New Dependencies
This phase requires zero `npm install` commands. Every piece of infrastructure is already in place.

---

## Architecture Patterns

### Current State (the gap)

`src/server/oauth/router.ts` — two problems in sequence:

**Problem 1 (lines 68-92):** `cookieParser()` is only mounted inside the CSRF conditional:

```typescript
// CURRENT — cookieParser only mounted when csrf is configured
if (config.csrf) {
  // ...doubleCsrf setup...
  router.use(cookieParser()); // line 88 — only runs when csrf is truthy
  router.use(doubleCsrfProtection);
}
```

**Problem 2 (lines 199-209):** The callback reads `req.cookies.oauth_state` directly instead of calling `oauthManager.validateState()`:

```typescript
// CURRENT — cookie comparison; does not use DB
const storedState = req.cookies?.oauth_state;
if (state !== storedState) {
  return res.status(400).json({ error: 'Invalid state' });
}
const codeVerifier = req.cookies?.oauth_code_verifier;
res.clearCookie('oauth_state');
res.clearCookie('oauth_code_verifier');
```

### Target State (the fix)

**Fix 1:** Move `router.use(cookieParser())` before the CSRF conditional so it always mounts:

```typescript
// Target — cookieParser always mounts
router.use(cookieParser()); // unconditional

if (config.csrf) {
  const { doubleCsrfProtection } = doubleCsrf({ ... });
  // cookieParser already mounted above; doubleCsrfProtection needs it
  router.use(doubleCsrfProtection);
  log.info('CSRF protection enabled for OAuth router (callback exempt)');
}
```

**Fix 2:** Replace cookie comparison with `oauthManager.validateState(state)`:

```typescript
// Target — DB-backed validation; atomic consume
const oauthState = await oauthManager.validateState(state);
if (!oauthState) {
  return res.status(400).json({ error: 'Invalid state' });
}
const codeVerifier = oauthState.codeVerifier;
// No clearCookie calls needed — state was consumed from DB, not cookie
// Cookie-based oauth_state and oauth_code_verifier cookies become vestigial
// for the DB path; they may still be cleared for hygiene but are not consulted
```

### What `oauthManager.validateState()` already does

Source: `src/server/oauth/index.ts` lines 367-398

When `db.getOAuthState` exists (postgres adapter):
1. Calls `db.getOAuthState(state)` — queries `oauth_state WHERE state = $1 AND expires_at > NOW()`
2. Double-checks expiry (belt-and-suspenders)
3. Calls `db.deleteOAuthState(state)` — atomic consume, prevents replay
4. Returns the `OAuthState` object including `codeVerifier`, `provider`, `redirectUri`, `expiresAt`

When `db.getOAuthState` does not exist (custom adapter fallback):
- Falls back to in-memory `stateStore` Map with the same semantics

This means **PKCE `codeVerifier` also migrates to DB-backed retrieval** — fixing the cross-instance PKCE bug identified in the audit (if state is on server A and callback hits server B, the cookie-stored `oauth_code_verifier` from server A is not present on server B; DB-backed `validateState` returns `codeVerifier` from the record stored at flow-start time).

### Cookie behavior after the fix

After switching to DB-backed `validateState()`:
- `oauth_state` cookie is still written in `/start` (needed for PKCE binding and can serve as fallback context; harmless)
- `oauth_code_verifier` cookie is still written in `/start` (same reason)
- In the callback, these cookies are no longer consulted for validation
- `clearCookie` calls can remain for hygiene (clean up cookies that were set) OR be removed; either is correct
- Recommendation: keep `clearCookie` calls to avoid stale cookies persisting in the browser

### Anti-Patterns to Avoid

- **Removing `router.use(cookieParser())` from inside the CSRF block without adding it above** — would break CSRF middleware since `doubleCsrf` requires cookie parsing. Always add it above the conditional, then remove the one inside.
- **Calling `validateState()` after cookie check** — introduces a TOCTOU race. Call `validateState()` exclusively; eliminate cookie comparison entirely.
- **Not clearing cookies after DB validation** — stale `oauth_state` / `oauth_code_verifier` cookies would persist in the browser. Clear them for hygiene even though they are no longer used for validation.
- **Making `codeVerifier` extraction depend on cookies** after the fix — `codeVerifier` must come from `oauthState.codeVerifier` (the DB record), not `req.cookies.oauth_code_verifier`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State validation | Custom cookie-parse + compare logic | `oauthManager.validateState(state)` | Already implemented, DB-backed, includes expiry check and atomic delete |
| Atomic state deletion | Manual DELETE after GET | `db.deleteOAuthState()` called inside `validateState()` | Race-free; called within the same server operation |
| Cookie parsing | `req.headers.cookie` parsing | `cookieParser()` middleware | Already imported; just needs to be moved outside the conditional |

**Key insight:** Every infrastructure piece for this phase was built in Phase 6 and left unconnected. This phase is pure wiring, not building.

---

## Common Pitfalls

### Pitfall 1: Forgetting `codeVerifier` source change
**What goes wrong:** After removing cookie comparison, developer forgets to update `const codeVerifier = req.cookies?.oauth_code_verifier` to `oauthState.codeVerifier`, causing PKCE to fail for providers that require it (Google, Twitter).
**Why it happens:** Two separate changes required; easy to update state check but miss codeVerifier.
**How to avoid:** Update both in the same edit: state check AND codeVerifier extraction.
**Warning signs:** Token exchange failing for Google/Twitter but not GitHub (GitHub doesn't use PKCE).

### Pitfall 2: Leaving `router.use(cookieParser())` inside CSRF block AND adding it above
**What goes wrong:** `cookieParser()` mounted twice; harmless in practice but creates subtle double-parse confusion.
**Why it happens:** Adding above without removing inside.
**How to avoid:** Remove the `cookieParser()` call from inside `if (config.csrf)` when adding it above.

### Pitfall 3: Test still asserts cookie-based behavior
**What goes wrong:** `oauth-cookie-guard.test.ts` test "proceeds normally when cookie-parser is mounted" asserts `res.status !== 500` — this test will still pass. But new tests for DB-backed validation need a `mockDb` with `getOAuthState`/`deleteOAuthState` methods, otherwise `validateState()` falls back to in-memory Map (which is fine for testing but doesn't verify the DB path).
**Why it happens:** Test mocks that omit optional DB methods silently fall through to Map fallback.
**How to avoid:** In new tests for the DB path, mock `db.getOAuthState` and `db.deleteOAuthState` explicitly. Assert they are called.

### Pitfall 4: CSRF middleware breaking after cookieParser move
**What goes wrong:** `doubleCsrfProtection` middleware depends on `req.cookies` being populated. Moving `cookieParser()` above the CSRF conditional should preserve this — the middleware chain still encounters `cookieParser` before `doubleCsrfProtection` — but only if the unconditional `router.use(cookieParser())` appears before the `if (config.csrf)` block.
**Why it happens:** Incorrect ordering when refactoring.
**How to avoid:** Verify order: `router.use(cookieParser())` first, then `if (config.csrf) { router.use(doubleCsrfProtection) }`.

---

## Code Examples

### Verified: `validateState()` signature and return type

Source: `src/server/oauth/index.ts` — `OAuthManager` interface (line 66) and implementation (lines 367-398)

```typescript
// Interface signature — already exported
validateState(state: string): Promise<OAuthState | null>;

// OAuthState — already defined in oauth/index.ts
export interface OAuthState {
  provider: 'google' | 'github' | 'twitter';
  state: string;
  codeVerifier?: string;
  redirectUri: string;
  expiresAt: Date;
}
```

### Verified: DB adapter methods that back validateState()

Source: `src/server/db/adapters/postgres.ts` — lines 821-853

```typescript
// Already implemented; postgres adapter exposes all three:
async storeOAuthState(state: OAuthStateRecord): Promise<void>   // called in getAuthUrl
async getOAuthState(stateKey: string): Promise<OAuthStateRecord | null>   // queries expires_at > NOW()
async deleteOAuthState(stateKey: string): Promise<void>   // atomic consume
```

### Verified: Exact lines to change in `oauth/router.ts`

Line 88 (inside `if (config.csrf)`):
```typescript
router.use(cookieParser()); // MOVE THIS ABOVE the if block, then remove from here
```

Lines 199-209 (inside POST callback handler):
```typescript
// REMOVE:
const storedState = req.cookies?.oauth_state;
if (state !== storedState) {
  return res.status(400).json({ error: 'Invalid state' });
}
const codeVerifier = req.cookies?.oauth_code_verifier;
res.clearCookie('oauth_state');
res.clearCookie('oauth_code_verifier');

// REPLACE WITH:
const oauthState = await oauthManager.validateState(state);
if (!oauthState) {
  return res.status(400).json({ error: 'Invalid state' });
}
const codeVerifier = oauthState.codeVerifier;
res.clearCookie('oauth_state');       // hygiene — clear stale cookie
res.clearCookie('oauth_code_verifier'); // hygiene — clear stale cookie
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cookie comparison for OAuth state | DB-backed `validateState()` | Phase 8 (this phase) | Cross-instance OAuth works; replay protection active |
| `cookieParser()` inside CSRF guard | `cookieParser()` unconditional | Phase 8 (this phase) | OAuth works without CSRF enabled |
| In-memory Map fallback for state | DB table `oauth_state` (postgres adapter) | Phase 6 — but wiring missed | State survives restart and load-balancing |

---

## Open Questions

1. **Should `oauth_state` cookie be removed from `/start` handler?**
   - What we know: After the fix, the callback no longer reads `req.cookies.oauth_state` for validation
   - What's unclear: The cookie still provides redundant client-side state context; removing it is cleaner but optional
   - Recommendation: Keep the cookie write in `/start` for now. It causes no harm and removal is a separate concern not in scope for INFRA-03. The planner may choose to defer cookie removal.

2. **Should `clearCookie` calls be removed since cookies are no longer validated?**
   - What we know: `clearCookie` in the callback cleans up cookies set during `/start`
   - What's unclear: Whether leaving stale cookies matters for the use case
   - Recommendation: Keep `clearCookie` calls for hygiene. They are harmless and avoid stale cookies persisting.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | `vitest.config.ts` (inferred from `"test": "vitest"` in package.json) |
| Quick run command | `npx vitest run src/__tests__/oauth-cookie-guard.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-03 | DB-backed `validateState()` called in callback (not cookie comparison) | unit/integration | `npx vitest run src/__tests__/oauth-cookie-guard.test.ts` | Partial — file exists, new tests needed |
| INFRA-03 | DB state consumed (deleted) atomically during callback | unit | Same file | No — Wave 0 gap |
| INFRA-03 | Cross-instance flow: state created on one mock, consumed via DB lookup | integration | Same file | No — Wave 0 gap |
| INFRA-03 | Replay protection: second callback with same state returns 400 | unit | Same file | No — Wave 0 gap |
| INFRA-03 | `cookieParser` mounted unconditionally (without CSRF) | integration | Same file | Partial — existing test covers 500 guard, not unconditional mounting |

### Sampling Rate
- **Per task commit:** `npx vitest run src/__tests__/oauth-cookie-guard.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green (currently 207 tests) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] New test cases in `src/__tests__/oauth-cookie-guard.test.ts` (or new `oauth-state-validation.test.ts`):
  - DB-backed `validateState()` called (mock `db.getOAuthState` returns valid record)
  - Atomic delete verified (`db.deleteOAuthState` called with the state key)
  - Replay rejected (second call returns 400 — `db.getOAuthState` returns null)
  - `cookieParser` works without CSRF enabled (extends existing test — verify `oauthState` path, not cookie path)
  - `codeVerifier` comes from `oauthState.codeVerifier`, not cookie

No framework install gap — vitest and supertest are already installed.

---

## Sources

### Primary (HIGH confidence)
- `src/server/oauth/router.ts` — full file read; exact lines identified for both changes
- `src/server/oauth/index.ts` — full file read; `validateState()` implementation verified complete
- `src/server/db/adapters/postgres.ts` — full file read; `storeOAuthState`, `getOAuthState`, `deleteOAuthState` verified implemented
- `src/types/index.ts` — full file read; `DatabaseAdapter` interface optional methods verified
- `src/__tests__/oauth-cookie-guard.test.ts` — full file read; existing tests identified, gaps mapped
- `.planning/v0.5-MILESTONE-AUDIT.md` — primary gap source; exact line numbers and root cause documented
- `.planning/REQUIREMENTS.md` — INFRA-03 status confirmed `[ ]` (pending)

### Secondary (MEDIUM confidence)
None needed — all findings come from direct code inspection.

### Tertiary (LOW confidence)
None.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all existing
- Architecture: HIGH — exact lines identified from source; no ambiguity
- Pitfalls: HIGH — derived from audit findings and code patterns in existing test file

**Research date:** 2026-03-14
**Valid until:** This phase targets specific line numbers in specific files. Valid until those files change.
