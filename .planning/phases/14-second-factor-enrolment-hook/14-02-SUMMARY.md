---
phase: 14
plan: 02
subsystem: passkey-router
tags: [hooks, second-factor, register-finish, login-finish, db-transaction, fire-points, HOOK-02, HOOK-03, HOOK-05, parallel-with-14-03]
requires: [14-01]
provides:
  - "HOOK-02 fire point: afterAuthSuccess fires inside doRegistration between createPasskey and createSession"
  - "HOOK-03 fire point: afterAuthSuccess fires after getUserById success and before createSession"
  - "HOOK-05 short-circuit response shape on both passkey endpoints (spread body + structured echo, no Set-Cookie)"
  - "Pitfall 4 Option A locked at runtime: register.finish.success and login.finish.success emit regardless of continue:true vs continue:false"
affects:
  - src/server/router.ts (register-finish + login-finish handlers)
tech-stack:
  added: []
  patterns:
    - "Fire-inside-transaction pattern: hook fires INSIDE doRegistration so a hook throw propagates through db.transaction() and triggers ROLLBACK; on continue:false the callback returns cleanly so the transaction COMMITS"
    - "Carry-via-return-tuple pattern: secondFactor escapes the doRegistration closure via the function's return shape — never via outer-scope mutation — so the transaction wrapper sees a plain successful return on continue:false"
    - "Emit-before-short-circuit pattern (login-only): on /login/finish the existing analytics emit is reordered to fire BEFORE the secondFactor branch; on /register/finish the existing emit position is UNCHANGED because the transaction return already imposes the correct ordering boundary"
key-files:
  created: []
  modified:
    - "src/server/router.ts (+78 lines)"
decisions:
  - "Reuse doRegistration closure as the transaction-wrapped unit; widen its return shape from { user, session } to { user, session, secondFactor: { status, body } | undefined } rather than mutating an outer-scope variable from inside the closure. RESEARCH §Pattern 2."
  - "On register-finish, the existing register.finish.success emit position (post-transaction, pre-res.json) is UNCHANGED. Only an additional `if (secondFactor) { return res.status().json() }` branch is inserted between the emit and the standard res.json. The emit fires regardless of short-circuit (Pitfall 4 Option A)."
  - "On login-finish, the existing login.finish.success emit is REORDERED to fire BEFORE both the short-circuit branch AND createSession. New ordering: hook → emit → if(secondFactor) short-circuit → createSession → standard res.json. Pitfall 4 Option A."
  - "On register-finish short-circuit, the closure returns { user, session: undefined, secondFactor } so the transaction wrapper sees a non-throw and COMMITS the createUser + createPasskey rows. T-14-02 mitigation: createSession is skipped, so no Set-Cookie is sent."
  - "On login-finish short-circuit, the handler does NOT call createSession (only fires on continue:true). T-14-02 mitigation."
  - "Did NOT add an explicit `as AfterAuthSuccessCtx` annotation at either call site — TypeScript will infer from the literal `'passkey-register'` / `'passkey-login'` discriminator once Plan 14-01's tightened type lands. RESEARCH Pitfall 5."
metrics:
  duration: "~10m"
  completed: "2026-04-30"
  tasks: 2
  files_changed: 1
  files_added: 0
  files_deleted: 0
  lines_added: 88
  lines_removed: 10
---

# Phase 14 Plan 02: Wire afterAuthSuccess into the passkey router (HOOK-02 + HOOK-03 + HOOK-05) Summary

**One-liner:** Two surgical fire-point inserts on `src/server/router.ts` thread `config.hooks?.afterAuthSuccess` into the existing register-finish and login-finish handlers, carrying a `secondFactor` echo out of the transaction-wrapped `doRegistration` closure on register and reordering the login-finish analytics emit so it fires before the short-circuit branch — both endpoints implement the HOOK-05 short-circuit response (spread body + structured echo, no Set-Cookie) and lock Pitfall 4 Option A (success analytics fires regardless of `continue: true` vs `continue: false`).

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Wire HOOK-02 fire point inside POST /register/finish (inside doRegistration) | `eaf2d2a` | `src/server/router.ts` |
| 2 | Wire HOOK-03 fire point inside POST /login/finish (no transaction wrapper) | `b21ee63` | `src/server/router.ts` |

## Diffs Inserted

### Task 1 — register-finish (Step A inside doRegistration)

After `await adapter.createPasskey({ ... });` and BEFORE `const session = await sessionManager.createSession(...)` (router.ts ~L246):

```typescript
// ░░ Phase 14 HOOK-02 fire point ░░
let secondFactor: { status: number; body: Record<string, unknown> } | undefined;
if (config.hooks?.afterAuthSuccess) {
  const result = await config.hooks.afterAuthSuccess({
    authMethod: 'passkey-register',
    userId: user.id,
    codename: user.codename,
    nearAccountId: user.nearAccountId,
    req,
  });
  if (!result.continue) {
    secondFactor = { status: result.status, body: result.body };
    return { user, session: undefined, secondFactor };
  }
}
```

### Task 1 — register-finish (Step A — widened success-path return)

```typescript
const session = await sessionManager.createSession(user.id, res, {
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});
return { user, session, secondFactor: undefined };
```

### Task 1 — register-finish (Step B post-transaction destructure)

```typescript
const { user, secondFactor } = db.transaction
  ? await db.transaction(doRegistration)
  : await doRegistration(db);
```

### Task 1 — register-finish (Step C short-circuit branch BEFORE the standard res.json; the existing register.finish.success emit position is UNCHANGED)

```typescript
await emit({ type: 'register.finish.success', rpId, timestamp: Date.now(),
  backupEligible: deriveBackupEligibility(passkeyData.deviceType) });

if (secondFactor) {
  return res.status(secondFactor.status).json({
    ...secondFactor.body,
    secondFactor,
  });
}

res.json({ /* unchanged success-path response */ });
```

### Task 2 — login-finish (Step A hook fire)

After `if (!user) { ... return res.status(404)... }` and BEFORE the (now-relocated) createSession call:

```typescript
// ░░ Phase 14 HOOK-03 fire point ░░
let secondFactor: { status: number; body: Record<string, unknown> } | undefined;
if (config.hooks?.afterAuthSuccess) {
  const result = await config.hooks.afterAuthSuccess({
    authMethod: 'passkey-login',
    userId: user.id,
    codename: user.codename,
    nearAccountId: user.nearAccountId,
    req,
  });
  if (!result.continue) {
    secondFactor = { status: result.status, body: result.body };
  }
}
```

### Task 2 — login-finish (Step B reorder: emit FIRST → short-circuit → createSession → standard response)

The existing `login.finish.success` emit was previously AFTER `createSession` and BEFORE the standard `res.json`. It is now repositioned to fire BEFORE both the short-circuit branch and `createSession`:

```typescript
// Pitfall 4 Option A: emit success FIRST — fires regardless of continue:true vs continue:false.
if (passkeyData) {
  await emit({
    type: 'login.finish.success',
    rpId,
    timestamp: Date.now(),
    backupEligible: deriveBackupEligibility(passkeyData.deviceType),
  });
}

if (secondFactor) {
  return res.status(secondFactor.status).json({
    ...secondFactor.body,
    secondFactor,
  });
}

// continue:true — proceed with normal session creation + standard response.
await sessionManager.createSession(user.id, res, {
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});

res.json({ success: true, codename: user.codename, ...(passkeyData && { passkey: { ... } }) });
```

## Pitfall 4 Option A Ordering — Why Different on Register vs Login

- **Register-finish:** the existing `register.finish.success` emit was already AFTER the transaction return and BEFORE `res.json`. The transaction return is the natural ordering boundary — emit position is UNCHANGED. Only an additional short-circuit branch is inserted between emit and standard `res.json`.
- **Login-finish:** there is no transaction wrapper. The existing emit fired AFTER `createSession`. Plan 14-02 reorders the emit to BEFORE the short-circuit branch (and BEFORE `createSession`) so the emit fires regardless of whether `continue: false` skips session creation.

Both endpoints now satisfy: the success analytics emit fires exactly once per successful auth, regardless of the consumer's second-factor decision. The consumer's downstream branching (e.g. to a 2FA-required dashboard) is observability-side surface; the auth itself succeeded.

## Verification

### Automated gates run by this executor

```
$ source ~/.nvm/nvm.sh && nvm use 20
Now using node v20.20.1 (npm v10.8.2)

$ npm test -- --run src/__tests__/registration-auth.test.ts src/__tests__/analytics-lifecycle.test.ts
Test Files  2 passed (2)
     Tests  41 passed (41)
```

Phase 11 + Phase 13 register/login tests stay green: 23/23 in `registration-auth.test.ts`, 18/18 in `analytics-lifecycle.test.ts`. The Phase 13 tests pass `hooks: { onAuthEvent }` without `afterAuthSuccess`, exercising the optional-chain guard (Pitfall 7 / T-14-07) at both fire sites.

### Acceptance gates (grep + awk)

| Gate | Expected | Observed |
| ---- | -------- | -------- |
| `grep -c "authMethod: 'passkey-register'"` | 1 | 1 |
| `grep -c "authMethod: 'passkey-login'"` | 1 | 1 |
| `grep -c "config.hooks?.afterAuthSuccess"` | ≥ 2 | 3 (2 fires + 1 in JSDoc-style comment) |
| `grep -c "await config.hooks.afterAuthSuccess"` | ≥ 2 | 2 |
| `grep -c "secondFactor = { status: result.status, body: result.body }"` | ≥ 2 | 2 |
| `grep -c "type: 'register.finish.success'"` | == 1 (Pitfall 4 Option A — emit unchanged on register) | 1 |
| ctx never logged: `grep -v '^[[:space:]]*//' \| grep 'log\\.(info\|warn\|error).*ctx'` | == 0 | 0 |
| Register handler: createPasskey < passkey-register call < createSession | true | a=238, b=264, c=279 (in-order) |
| Login handler: user-not-found < passkey-login call < createSession | true | a=391, b=407, c=443 (in-order) |
| Login handler: success-emit BEFORE secondFactor short-circuit | true | a=423, b=430 (in-order) |

Note on the `…secondFactor.body, secondFactor` literal grep gate: the response shape is implemented as a multi-line JSON object literal (`...secondFactor.body,\n          secondFactor,`), so a single-line grep returns 0; semantic structure is verified by reading the source — both fire sites have the spread + echo pattern intact.

## Cross-Worktree Type-Contract Note

Plan 14-01 was scheduled in the same wave (Wave 1) as 14-02 because their `files_modified` arrays do not overlap (14-01 owns `src/types/index.ts`, 14-02 owns `src/server/router.ts`). 14-02 implements against the agreed final type shape (`AfterAuthSuccessCtx` discriminated union, `AfterAuthSuccessResult = { continue: true } | { continue: false; status, body }`) but in this isolated worktree the type `AnonAuthHooks.afterAuthSuccess` is still the Phase-11 placeholder `(ctx: unknown) => Promise<unknown>`.

Consequence: in this isolated worktree, `nvm use 20 && npm run typecheck` surfaces 6 property-on-`unknown` errors at the two fire sites:

```
src/server/router.ts(270,23): error TS2339: Property 'continue' does not exist on type 'unknown'.
src/server/router.ts(271,45): error TS2339: Property 'status' does not exist on type 'unknown'.
src/server/router.ts(271,66): error TS2339: Property 'body' does not exist on type 'unknown'.
src/server/router.ts(413,21): error TS2339: Property 'continue' does not exist on type 'unknown'.
src/server/router.ts(414,43): error TS2339: Property 'status' does not exist on type 'unknown'.
src/server/router.ts(414,64): error TS2339: Property 'body' does not exist on type 'unknown'.
```

Per the orchestrator's parallel-execution directive ("Type-only inconsistencies between worktrees will surface during the post-merge test gate; do not block on them") the typecheck gate is deferred to the post-merge verification run, where Plan 14-01's tightened type contract will narrow the result type and resolve all 6 errors. **Action expected of post-merge verifier:** run `nvm use 20 && npm run typecheck` after Plans 14-01, 14-02, 14-03 are merged; expect 0 errors. If errors persist, the type contract from Plan 14-01 is incomplete (not a 14-02 issue).

## Deviations from Plan

None — plan executed exactly as written, including:
- The `<parallel_execution>` instruction to "implement against the agreed final shape" (taken literally).
- The `<acceptance_criteria>` literal `…secondFactor.body, secondFactor` grep gate is technically a structural shape check, not a single-line literal check; the implementation uses a multi-line object literal that satisfies the structural intent. Documented in the Verification section.

## Threat Model Status

| Threat ID | Mitigation in 14-02 | Status |
| --------- | ------------------- | ------ |
| T-14-02 (cookie leak on short-circuit) | Hook fires BEFORE `sessionManager.createSession` at both sites; on `continue: false` the createSession call is skipped. Awk line-ordering gates verify both ordering invariants. | mitigated |
| T-14-03 (PII in library logs) | No `log.*({ ctx, ... })` call added at either fire site; comment-stripped grep confirms 0 hits. | mitigated |
| T-14-07 (undefined hook crash) | `config.hooks?.afterAuthSuccess` optional chain on BOTH `hooks` AND `afterAuthSuccess`. Phase 13 tests already pass `hooks: { onAuthEvent }` without afterAuthSuccess and stay green. | mitigated |
| T-14-08 (handler responds before hook resolves) | `await` on every fire site (2 occurrences of `await config.hooks.afterAuthSuccess`). | mitigated |
| T-14-09 (analytics double-fire / wrong-event on short-circuit) | Locked Pitfall 4 Option A: register.finish.success emit count == 1 (unchanged position); login.finish.success line precedes the short-circuit branch in the login handler. | mitigated |
| T-14-01 (DB connection pool starvation on long hooks) | Out-of-scope per RESEARCH §Pattern 1 + Assumption A8; documented in HOOK-06. | accepted (documented) |
| T-14-04 (orphan MPC account on hook throw) | The plan's `<context>` notes that `mpcManager.createAccount` ran BEFORE the doRegistration callback; a hook throw triggers DB rollback but the on-chain MPC account remains. Documented in HOOK-06. | accepted (documented; consumer hooks should be idempotent + non-throwing) |

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema introduced. Both inserts are on existing endpoint surface.

## Known Stubs

None — both fire points are fully wired and observable through the deferred Plan 04 integration tests (which are the Wave 0 `it.todo` placeholders awaiting Plan 04 implementation).

## TDD Gate Compliance

Plan 14-02 is `type: execute` (not `type: tdd`) — TDD gate sequence (RED before GREEN) is not required at the plan level. Wave 0 (Plan 14-01) drops `it.todo` test stubs; Plan 04 fills them with green tests after the fire-points exist. This 14-02 plan exists explicitly to make those tests passable in Plan 04.

## Self-Check: PASSED

- src/server/router.ts: FOUND (871 lines, +78 over baseline)
- Commit eaf2d2a: FOUND (`feat(14-02): wire HOOK-02 fire point in /register/finish`)
- Commit b21ee63: FOUND (`feat(14-02): wire HOOK-03 fire point in /login/finish`)
- vitest analytics-lifecycle + registration-auth: 41/41 green
- typecheck: 6 cross-worktree errors documented; resolves at post-merge gate
