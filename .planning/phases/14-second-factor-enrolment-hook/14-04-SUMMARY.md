---
phase: 14
plan: 04
status: complete
requirements: [HOOK-02, HOOK-03, HOOK-04, HOOK-05, HOOK-06]
completed: 2026-04-30
---

# Plan 14-04 Summary — Second-Factor Hook Tests + README Documentation

## What was built

Converted the 4 Wave-0 stub test files (47 `it.todo` placeholders) into 47 passing `it()` blocks covering HOOK-02 through HOOK-06, and added the canonical README section for `hooks.afterAuthSuccess` that Phase 16 RELEASE-01 will lift verbatim.

## Final tally — `it()` blocks per file

| File | it() blocks | Coverage |
|------|-------------|----------|
| `src/__tests__/second-factor-register.test.ts` | 12 | HOOK-02 + HOOK-05 + Pitfall 4 Option A + T-14-02 + backcompat × 2 |
| `src/__tests__/second-factor-login.test.ts`    | 11 | HOOK-03 + HOOK-05 + no-transaction-wrapper + Pitfall 4 + T-14-02 + backcompat |
| `src/__tests__/second-factor-oauth.test.ts`    | 17 | HOOK-04 × 3 branches + HOOK-05 + Pitfall 4 + Pitfall 6 / T-14-04 + call-order × 2 + backcompat × 2 |
| `src/__tests__/second-factor-orphan.test.ts`   |  7 | HOOK-06 change-detector + DB rollback + call-order |
| **Total**                                      | **47** | All it.todo placeholders converted to passing it() blocks |

Wave-0 stub count was 47 across the 4 files (12 + 11 + 17 + 7) — 1:1 stub→assertion map preserved.

## Test execution

- `nvm use 20 && npm test -- --run` — **444 passed / 4 skipped / 0 failed**
  - Phase 13 baseline: 397 passed / 4 skipped / 47 todo
  - Phase 14 delta: 47 new it() (replaces 47 it.todo); net 444 / 4
- `nvm use 20 && npm run typecheck` — exit 0

## The mockDb.transaction emulator pattern (orphan test)

```typescript
mockTransaction = vi.fn(async <T,>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> => {
  return await fn(mockDb);
});
mockDb = makeMockDb({ transaction: mockTransaction } as any);
```

Mirrors Postgres `BEGIN/COMMIT/ROLLBACK` semantics: pass the same adapter to `fn`, and on async throw, the rethrow IS the rollback signal (the outer catch handler in `router.ts` sees the throw, returns 500, no commit happened).

The default `makeMockDb` for the register/login tests omits `transaction`, so `db.transaction ? await db.transaction(doRegistration) : await doRegistration(db)` falls through to the direct call — the orphan test injects the emulator only when DB-rollback semantics need to be exercised.

## The change-detector call-order assertion (most important line in `second-factor-orphan.test.ts`)

```typescript
const mpcCallOrder = (mockMpcManager.createAccount.mock as any).invocationCallOrder[0];
const txCallOrder = (mockTransaction.mock as any).invocationCallOrder[0];
expect(mpcCallOrder).toBeLessThan(txCallOrder);
```

This encodes the locked HOOK-06 decision in CI: `mpcManager.createAccount` runs BEFORE `db.transaction` opens. If a future PR moves MPC inside the transaction (e.g., refactoring for atomicity at the cost of ON-CHAIN funds being held inside an aborted transaction), this assertion FAILS — and the planner is forced to revisit the README "MPC orphan trade-off" copy.

The change-detector intent is intentionally surfaced TWICE in the test runner output:
1. Line ~196: structural call-order assertion
2. Line ~217: docstring `it()` block that mirrors the assertion + explains WHY the planner must intervene when it breaks

## OAuth call-order assertions (Branches 2 + 3)

Branch 2 (link by email):
```typescript
linkOrder < hookOrder < sessionOrder
```

Branch 3 (new user):
```typescript
mpcOrder < userOrder < ipfsOrder < hookOrder < sessionOrder
```

These prove the fire-point placement in `src/server/oauth/router.ts` for the planner, not just the assertion that the hook is called.

## T-14-02 cookie leak guard for OAuth

The OAuth callback always emits `clearCookie` hygiene for `oauth_state` and `oauth_code_verifier` (expired Set-Cookie entries — `Expires=Thu, 01 Jan 1970`). T-14-02 is about no LIVE session cookie being set on `continue: false`. Helper:

```typescript
function noLiveSessionCookie(setCookieHeader: string[] | string | undefined): boolean {
  if (!setCookieHeader) return true;
  const entries = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return entries.every((c) => /Expires=Thu, 01 Jan 1970/i.test(c));
}
```

Used at all three OAuth `continue: false` short-circuit assertions.

## README section anchor + line range

- Section: `## Second-Factor Enrolment Hook (v0.7.0)`
- Inserted between `## Cross-Domain Passkeys (v0.7.0)` (line 91) and `## Installation` (line 317)
- Covers all 7 required topics:
  1. Discriminated-union signature (`AfterAuthSuccessCtx`, `AfterAuthSuccessResult`, `AfterAuthSuccessProvider`)
  2. Five fire points with file refs (`src/server/router.ts` × 2, `src/server/oauth/router.ts` × 3)
  3. MPC orphan trade-off (HOOK-06 verbatim canonical copy)
  4. Recommended mitigation (idempotent + non-throwing hooks; prefer `continue: false` over throw)
  5. Cookie semantics (`Set-Cookie` skipped on short-circuit; OAuth state hygiene clarified)
  6. `req` is bare Express Request — consumer responsibility to sanitize
  7. OAuth Branch 3 widened trade-off (IPFS recovery blob committed alongside user + MPC + recovery row)

## Phase 16 lift handoff

Phase 16 RELEASE-01 must verify the README section between `## Cross-Domain Passkeys (v0.7.0)` and `## Installation` is unchanged (or carry forward verbatim). The discriminated-union signature, fire-point list, and orphan trade-off paragraph are the load-bearing prose that consumer integration teams will rely on.

## Notable post-Wave-1 fix that landed before Plan 14-04

Wave 1 merge introduced 6 typecheck errors at the three hook narrow sites in `src/server/router.ts` and `src/server/oauth/router.ts`. The repo's tsconfig has `strict: false`, which makes truthiness-based discriminated-union narrowing (`if (!result.continue)` / `if (result.continue)`) unreliable. The orchestrator applied a post-merge fix swapping all three narrow sites to explicit literal-equality narrowing (`=== false` / `=== true`) — committed in `f80376e` BEFORE Plan 14-04 began. Plan 14-04 tests use the same explicit narrowing pattern in any TypeScript code paths.

## Threats mitigated

- **T-14-02 (cookie leak on short-circuit)** — asserted in register, login, all 3 OAuth branches (5 sites)
- **T-14-04 (orphan-MPC documentation gap)** — asserted by both the `second-factor-orphan.test.ts` change-detector AND the README MPC orphan paragraph
- **T-14-09 (Pitfall 4 regression — analytics ordering)** — explicitly asserted in register, login, and OAuth Branch 1 (representative)
- **T-14-10 (README drift)** — accepted as a Phase 16 process risk; Plan 14-04 produces the canonical version that RELEASE-01 lifts

## Self-Check: PASSED

- All 47 it.todo placeholders converted to passing it() blocks ✓
- Wave-0 1:1 stub→assertion map preserved (no new it() blocks added beyond what stubs anticipated; orphan test added one extra `CHANGE-DETECTOR DOC` block as planned) ✓
- All grep + awk acceptance gates from the plan satisfy ✓
- Full suite green (444/4) ✓
- Typecheck green ✓
- README section between Cross-Domain Passkeys and Installation, all 7 topics covered ✓
