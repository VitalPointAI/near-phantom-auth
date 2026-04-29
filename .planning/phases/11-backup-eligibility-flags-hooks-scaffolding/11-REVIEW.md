---
phase: 11-backup-eligibility-flags-hooks-scaffolding
reviewed: 2026-04-29T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/__tests__/backup.test.ts
  - src/__tests__/hooks-scaffolding.test.ts
  - src/__tests__/passkey.test.ts
  - src/__tests__/registration-auth.test.ts
  - src/client/hooks/useAnonAuth.tsx
  - src/server/backup.ts
  - src/server/db/adapters/postgres.ts
  - src/server/index.ts
  - src/server/oauth/router.ts
  - src/server/passkey.ts
  - src/server/router.ts
  - src/server/webauthn.ts
  - src/types/index.ts
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-04-29
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Phase 11 lands four artifacts:
1. `deriveBackupEligibility(deviceType)` — pure helper, single source of truth for BE-bit translation.
2. Surfacing `passkey: { backedUp, backupEligible }` on `/register/finish` and `/login/finish` responses, with `backedUp` re-read FRESH from each assertion (not the stored DB row) on login.
3. Optional `DatabaseAdapter.updatePasskeyBackedUp` (Postgres impl) for persisting BS-bit drift on every login.
4. `AnonAuthHooks` interface scaffolded and threaded through `createAnonAuth` → `createRouter` / `createOAuthRouter`, with zero call sites yet (Phase 11 invariant).
5. React hook exposes `passkeyBackedUp` / `passkeyBackupEligible` from finish-response.

The BE/BS bit handling in `passkey.ts` correctly reads FRESH values from `verification.authenticationInfo` and persists conditionally only on change. The `/login/finish` route preserves the anonymity invariant (no `nearAccountId` in body) — verified by tests at registration-auth.test.ts:516-518. The hooks scaffold is wired symmetrically through both routers in `index.ts`.

However, several quality and robustness issues need attention before this is shippable as a stable contract:

- BS-bit persistence failure can break login (no try/catch around the optional adapter write).
- The hooks invariant grep-guard tests are brittle and would not detect realistic call-site patterns (destructuring, optional chaining, indirect refs).
- React state retains the previous user's passkey backup flags across logout/login.
- A silent no-op when a custom adapter omits `updatePasskeyBackedUp` provides zero observability for an arguably important "drift correction" code path.

No critical issues (no security vulnerabilities, no SQL-injection risk in the new adapter method, no anonymity invariant violations, no auth bypasses).

## Warnings

### WR-01: BS-bit persistence failure can break successful login

**File:** `src/server/passkey.ts:316-318`
**Issue:** The conditional persistence call is unguarded:

```ts
if (freshBackedUp !== passkey.backedUp && db.updatePasskeyBackedUp) {
  await db.updatePasskeyBackedUp(passkey.credentialId, freshBackedUp);
}
```

If `db.updatePasskeyBackedUp` rejects (DB transient failure, deadlock, network blip), the rejection propagates up through `finishAuthentication` → `router.ts:298`. The router's outer catch at `router.ts:332-335` swallows this and returns HTTP 500 with `{ error: 'Authentication failed' }`. The user is forced to retry an otherwise-successful login because of an opportunistic drift-correction write — counter has already been advanced (`updatePasskeyCounter` at line 308 ran first), challenge was already validated, the assertion is cryptographically valid. The BS-bit field is by design tolerant of staleness (next login will retry the drift-correction); a transient failure here should NOT fail the login.

**Fix:** Wrap the optional persistence in a non-failing path, log on error, and continue:

```ts
if (freshBackedUp !== passkey.backedUp && db.updatePasskeyBackedUp) {
  try {
    await db.updatePasskeyBackedUp(passkey.credentialId, freshBackedUp);
  } catch (err) {
    log.warn({ err, credentialId: passkey.credentialId },
      'BS-bit persistence failed; login proceeds with stale stored value');
  }
}
```

---

### WR-02: Hooks invariant grep-guard misses realistic call-site patterns

**File:** `src/__tests__/hooks-scaffolding.test.ts:113-135`
**Issue:** The Phase 11 invariant ("zero call sites for hooks.<name>(") is enforced with three `grep -r "hooks\\.afterAuthSuccess(" src/server | wc -l` patterns. This regex only catches the literal substring `hooks.afterAuthSuccess(`. The test will return zero — and silently pass — for any of these realistic future patterns:

- Optional chaining (very likely how hooks WILL be invoked once wired): `hooks?.afterAuthSuccess?.(ctx)`
- Destructured locals: `const { afterAuthSuccess } = config.hooks ?? {}; afterAuthSuccess?.(ctx);`
- Renamed / aliased: `const cb = config.hooks?.afterAuthSuccess; cb?.(ctx);`
- Spread/forwarding: `await Promise.allSettled([config.hooks?.afterAuthSuccess?.(ctx)])`

Per the comment at lines 110-111, this guard is meant to fail loudly when call sites are wired in Phase 13/14/15 so the test author remembers to update it. With the current grep, the most likely future implementation (`hooks?.afterAuthSuccess?.(...)`) will silently bypass it.

**Fix:** Either widen the regex to cover both `.` and `?.` access, or invert the strategy and grep for property reads on a `hooks` object:

```ts
// Match: hooks.afterAuthSuccess( OR hooks?.afterAuthSuccess?.( OR hooks?.afterAuthSuccess(
const out = execSync(
  String.raw`grep -rEn 'hooks\??\.afterAuthSuccess\??\(' src/server | wc -l`,
  { encoding: 'utf-8' }
).trim();
expect(out).toBe('0');
```

Better still, complement the grep with a positive runtime-spy test: pass real `vi.fn()` hooks to `createAnonAuth`, drive a full register/login cycle through the router, and assert `expect(afterAuthSuccess).not.toHaveBeenCalled()`. The current threading test (lines 89-106) only checks construction-time invocation, not request-handling-time invocation.

---

### WR-03: Silent no-op when custom adapter omits `updatePasskeyBackedUp`

**File:** `src/server/passkey.ts:316`
**Issue:** When a consumer ships a custom `DatabaseAdapter` that does not implement the new optional `updatePasskeyBackedUp`, the BS-bit-flip detection runs on every login but the change is silently dropped — there is no log line, no metric, no warning. The JSDoc on `DatabaseAdapter.updatePasskeyBackedUp` (types/index.ts:299-303) documents this trade-off, but there is no operational signal that the drift correction is being lost.

This becomes opaque in two scenarios:
1. A consumer migrates from `createPostgresAdapter` to a custom adapter and inadvertently doesn't carry the optional method forward — they lose backup-state observability across their entire user base with no error.
2. Operators looking at `/login/finish` response shape and seeing `backedUp: true` reasonably assume that's the persisted DB state. It isn't, when the adapter is missing this method.

**Fix:** Log a one-shot warn when a bit-flip is detected but the adapter does not implement the persistence method. Cache a flag on the manager closure to avoid repetitive logging:

```ts
if (freshBackedUp !== passkey.backedUp) {
  if (db.updatePasskeyBackedUp) {
    try { await db.updatePasskeyBackedUp(passkey.credentialId, freshBackedUp); }
    catch (err) { log.warn({ err }, 'BS-bit persistence failed'); }
  } else if (!warnedMissingBackedUpMethod) {
    log.warn(
      'BS-bit drift detected but DatabaseAdapter.updatePasskeyBackedUp is not implemented; ' +
      'response will reflect fresh value but DB row will remain stale on subsequent logins.'
    );
    warnedMissingBackedUpMethod = true;
  }
}
```

---

### WR-04: React state leaks `passkeyBackedUp` / `passkeyBackupEligible` across logout

**File:** `src/client/hooks/useAnonAuth.tsx:311-328`
**Issue:** The `logout` callback resets only `isAuthenticated`, `codename`, `nearAccountId`, `expiresAt`. It does NOT reset the new `passkeyBackedUp` / `passkeyBackupEligible` fields (added at lines 49-52). After User A logs out and the page is left open, those flags reflect User A's last passkey state. If User B then registers/logs in on the same browser, the values are correctly overwritten on success — but on the post-logout / pre-login window any UI that reads `passkeyBackedUp` / `passkeyBackupEligible` shows stale data attributable to the previous session.

This is mostly a UX/privacy hygiene concern (the flags themselves are not strongly identifying — they describe authenticator class, not the user), but the same logout already takes care to clear other identity fields. Inconsistent.

The same critique applies to existing fields not cleared on logout (`username`, `email`, `authMethod`, `credentialCloudSynced`) — those are pre-existing, but this phase adds two more to the list.

**Fix:** Reset both fields in `logout`:

```ts
setState((prev) => ({
  ...prev,
  isAuthenticated: false,
  codename: null,
  nearAccountId: null,
  expiresAt: null,
  passkeyBackedUp: null,
  passkeyBackupEligible: null,
  // Optional cleanup — pre-existing fields:
  username: null,
  email: null,
  authMethod: null,
  credentialCloudSynced: null,
}));
```

---

### WR-05: `passkeyData` name overloaded between register and authenticate paths

**File:** `src/server/passkey.ts:60-72,84-94`
**Issue:** The `PasskeyManager` interface uses the same field name `passkeyData` for two structurally different shapes:

- `finishRegistration` returns `passkeyData: { credentialId, publicKey, counter, deviceType, backedUp, transports? }`
- `finishAuthentication` returns `passkeyData: { backedUp, deviceType }` (no `credentialId`, `publicKey`, `counter`)

A caller refactoring from one path to the other and accidentally treating one shape as the other will get a runtime undefined access (`result.passkeyData.credentialId` → `undefined`). The router currently dispatches them correctly (router.ts:218 reads `passkeyData.credentialId` only on the registration path; line 327 reads `passkeyData.backedUp` only on the auth path), but the type-level overlap invites a future bug.

**Fix:** Rename the auth-path field to disambiguate:

```ts
finishAuthentication(...): Promise<{
  verified: boolean;
  userId?: string;
  passkey?: Passkey;
  /** Fresh BE/BS values re-read from the assertion. */
  freshBackup?: { backedUp: boolean; deviceType: 'singleDevice' | 'multiDevice' };
}>;
```

Update the router call site and tests accordingly. (registration-auth.test.ts:502, 532 will need to pass `freshBackup` instead of `passkeyData`.)

## Info

### IN-01: Hooks-scaffolding test depends on shell CWD

**File:** `src/__tests__/hooks-scaffolding.test.ts:113-135`
**Issue:** The grep guards use `execSync('grep -r "..." src/server | wc -l')` with a relative `src/server` path. This depends on the test runner's CWD being the repo root. Vitest defaults to the project root, so this works today, but a CI job that `cd`s into a subdirectory before running tests, or a developer running tests from a worktree, would silently see "0" (because `src/server` does not exist relative to that CWD — `grep -r` returns no matches) and the test would falsely pass.

**Fix:** Resolve relative to the test file:

```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcServer = resolve(__dirname, '../server');
const out = execSync(`grep -rE 'hooks\\??\\.afterAuthSuccess\\??\\(' "${srcServer}" | wc -l`, ...);
```

---

### IN-02: `updatePasskeyBackedUp` not added to transaction-scoped client adapter

**File:** `src/server/db/adapters/postgres.ts:195-355`
**Issue:** The `buildClientAdapter` (used inside `db.transaction()` to route ops through a single PoolClient) does not implement `updatePasskeyBackedUp`. Today this is fine — the call site in passkey.ts:316 invokes it on the top-level adapter, never inside `db.transaction()`. But Phase 14's `afterAuthSuccess` hook may want to wrap login-time actions (including BS-bit persistence) in a transaction, and at that point the missing method would surface as `db.updatePasskeyBackedUp is not a function` from inside a transaction context, rather than a graceful fallback.

**Fix:** When you're about to wire Phase 14 hooks, add `updatePasskeyBackedUp` to `buildClientAdapter` for symmetry. No change needed in this phase, but note it for the hook-wiring phase.

---

### IN-03: Test fixture overrides not idempotent across test files

**File:** `src/__tests__/passkey.test.ts:121-131`
**Issue:** After `vi.clearAllMocks()` in each `beforeEach`, the test re-applies default mock returns for `generateRegistrationOptions`, `verifyRegistrationResponse`, etc. This is a known vitest pattern, but the registration-auth.test.ts file shares no setup with passkey.test.ts even though both depend on the same `@simplewebauthn/server` module mock. If a future test mutates module-level mock state without restoring it, cross-file ordering would matter. Pre-existing pattern, but noted because Phase 11 added more `mockResolvedValueOnce` calls (passkey.test.ts:478, 511, 546, 578) that are correctly scoped to a single `it()` — good practice to keep.

**Fix:** No action needed; flagged as documentation-of-pattern for Phase 13+ contributors.

---

### IN-04: `RegistrationFinishResponse.passkey` is documented as optional but always present in the happy path

**File:** `src/types/index.ts:477-484`, `src/server/router.ts:238-246`
**Issue:** The type `RegistrationFinishResponse.passkey` is `?: { backedUp: boolean; backupEligible: boolean }` (optional). But the router unconditionally includes it in the response body for the success path (router.ts:242-245, no spread guard). The optionality is justified by "forward-compat with degraded-path responses" per the JSDoc comment, but no current code path produces a degraded response — the only way `passkey` is absent is if `verified` is false, which returns 400 instead.

By contrast, `/login/finish` (router.ts:325-330) DOES use a spread guard `...(passkeyData && {...})`, so the field is genuinely optional there.

This asymmetry is mildly confusing for consumers reading the response types. Either tighten the registration response type (drop `?:`) or add the same spread guard to `/register/finish` for consistency.

**Fix:** Choose one of:

(a) Tighten the type — registration always returns the field on 200:
```ts
export interface RegistrationFinishResponse {
  success: boolean;
  codename: string;
  nearAccountId: string;
  passkey: { backedUp: boolean; backupEligible: boolean };  // not optional
}
```

(b) Make the router consistent with /login/finish:
```ts
res.json({
  success: true,
  codename: user.codename,
  nearAccountId: user.nearAccountId,
  ...(passkeyData && {
    passkey: {
      backedUp: passkeyData.backedUp,
      backupEligible: deriveBackupEligibility(passkeyData.deviceType),
    },
  }),
});
```

---

_Reviewed: 2026-04-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
