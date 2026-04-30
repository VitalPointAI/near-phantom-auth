# Phase 14: Second-Factor Enrolment Hook — Pattern Map

**Mapped:** 2026-04-30
**Files analyzed:** 9 (5 modified + 4 created)
**Analogs found:** 9 / 9

> Phase 14 is **pure call-site wiring on already-scaffolded types in already-instrumented routers.** Every analog is in-tree; no external pattern mining required. The dominant analogs are:
> - **Phase 11** for the `AnonAuthHooks` type-contract pattern (placeholder → tightened signature, with re-export from `src/server/index.ts`).
> - **Phase 13** for the inline emit-point wiring inside `router.ts` and `oauth/router.ts` (5 fire sites at exactly the same call sites Phase 14 needs).
> - **Phase 13** for the test harness — `analytics-lifecycle.test.ts` (passkey) and `analytics-oauth.test.ts` (OAuth × 3 branches) — which already exercise every fire-point Phase 14 will instrument.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/types/index.ts` (MODIFY) | type-contract | declaration | Phase 11 `AnonAuthHooks` (same file, lines 53-64) + Phase 13 `AnalyticsEvent` discriminated union (`src/server/analytics.ts`) | exact (in-place tighten of own placeholder) |
| `src/server/router.ts` (MODIFY) | controller / route handler | request-response (sync hook gate) | Phase 13 emit points in same file (lines 209, 220, 260-265, 341, 348, 362-367, 382) | exact (same file, same handlers, same locations) |
| `src/server/oauth/router.ts` (MODIFY) | controller / route handler | request-response (sync hook gate × 3 branches) | Phase 13 OAuth emit points in same file (lines 248, 284, 370) | exact (same file, same 3 branches) |
| `src/server/index.ts` (MODIFY) | barrel re-export | declaration | Phase 11 `AnonAuthHooks` re-export (line 264) + Phase 13 `AnalyticsEvent` re-export (line 277) | exact |
| `README.md` (MODIFY) | documentation | n/a | Phase 13 README "Analytics Hook" section (precedent for hooks doc layout) | role-match |
| `src/__tests__/second-factor-register.test.ts` (CREATE) | integration test | request-response with vi.fn spy | `src/__tests__/analytics-lifecycle.test.ts` (passkey register/login mock-router harness, lines 1-230) | exact |
| `src/__tests__/second-factor-login.test.ts` (CREATE) | integration test | request-response with vi.fn spy | `src/__tests__/analytics-lifecycle.test.ts` (login describe blocks) | exact |
| `src/__tests__/second-factor-oauth.test.ts` (CREATE) | integration test | request-response × 3 OAuth branches | `src/__tests__/analytics-oauth.test.ts` (3-branch OAuth harness, lines 1-200) | exact |
| `src/__tests__/second-factor-orphan.test.ts` (CREATE) | integration test (change detector) | request-response + mock-call-order assertion | `src/__tests__/analytics-lifecycle.test.ts` + new MPC-call-order assertion (no exact prior) | role-match |

---

## Pattern Assignments

### `src/types/index.ts` (type-contract, declaration)

**Analog:** Same file — Phase 11 placeholder at lines 53-64, plus Phase 13 `AnalyticsEvent` discriminated union pattern at `src/server/analytics.ts` (re-exported from this barrel).

**Current placeholder pattern** (`src/types/index.ts:53-64` — to be replaced):
```typescript
export interface AnonAuthHooks {
  /** Phase 14 — fires inside /register/finish, /login/finish, OAuth callback. */
  afterAuthSuccess?: (ctx: unknown) => Promise<unknown>;
  /** Phase 15 — fires inside /login/finish when sealingKeyHex was supplied. */
  backfillKeyBundle?: (ctx: unknown) => Promise<unknown>;
  /** Phase 13 — fires fire-and-forget at lifecycle boundaries on the
   *  passkey router, OAuth router, recovery endpoints, and account-delete.
   *  Errors / rejected Promises are caught by the library and logged WARN
   *  with redacted payload — they NEVER break the auth response. Default
   *  fire-and-forget; opt-in to awaited emit via `AnonAuthConfig.awaitAnalytics`. */
  onAuthEvent?: (event: AnalyticsEvent) => void | Promise<void>;
}
```

**Discriminated-union pattern to copy** (analog: same shape Phase 13 used for `AnalyticsEvent` — lift the discriminator-by-literal style):
- One variant per `authMethod` literal (`'passkey-register'`, `'passkey-login'`, `'oauth-google' | 'oauth-github' | 'oauth-twitter'`).
- `provider` field exists ONLY on OAuth variants (Pitfall 5 in RESEARCH).
- Result type is the locked `{ continue: true } | { continue: false; status: number; body: Record<string, unknown> }`.

**Existing `RegistrationFinishResponse` / `AuthenticationFinishResponse` extension pattern** (`src/types/index.ts:523-543`) — additive optional field with JSDoc explaining version + behavior:
```typescript
export interface RegistrationFinishResponse {
  success: boolean;
  codename: string;
  nearAccountId: string;
  /** v0.7.0 — BACKUP-01 additive nested key. Optional for forward-compat with
   *  degraded-path responses that may omit the flags. */
  passkey?: { backedUp: boolean; backupEligible: boolean };
}
```

**Pattern to apply:** Add `secondFactor?: { status: number; body: Record<string, unknown> }` immediately after the existing `passkey?` field with the same JSDoc style ("v0.7.0 — HOOK-05 echo of consumer's hook short-circuit. Present when ..."). Copy the additive-nested-key style verbatim — same precedent as Phase 12 BACKUP-01.

**Import requirement:** Add `import type { Request } from 'express';` to the import block (top of file). Verify no existing `express` import in `types/index.ts` — if absent, add it; if present, augment.

**OAuth `codename` resolution (Open Question #2):** The codebase verifies `OAuthUser` (`src/types/index.ts:410-422`) does NOT have a `codename` field. Recommendation per RESEARCH §Open Question #2 Option (b): make `codename` OPTIONAL on the OAuth variants only:
```typescript
| {
    authMethod: 'oauth-google' | 'oauth-github' | 'oauth-twitter';
    userId: string;
    codename?: string;        // OAuth users may not have a codename in v0.7.0
    nearAccountId: string;
    provider: AfterAuthSuccessProvider;
    req: Request;
  };
```

---

### `src/server/router.ts` (controller, request-response — register-finish + login-finish)

**Analog:** Same file — Phase 13 inline emit pattern AT THE SAME CALL SITES Phase 14 will fire from. The `emit()` closure pattern (lines 80-83) is identical to what Phase 14 needs for the conditional hook check (`if (config.hooks?.afterAuthSuccess) { ... }`).

**Imports / module setup pattern** (`src/server/router.ts:7-22`) — already imports everything Phase 14 needs:
```typescript
import { Router, json } from 'express';
import type { Request, Response } from 'express';
import type { DatabaseAdapter, CodenameConfig, RateLimitConfig, CsrfConfig, AnonAuthHooks } from '../types/index.js';
import pino from 'pino';
import { wrapAnalytics } from './analytics.js';
```

**Pattern to apply:** Phase 14 needs NO new imports for register/login fire points (the existing `AnonAuthHooks` import already covers `config.hooks?.afterAuthSuccess`). The only new symbol is `AfterAuthSuccessCtx` if Phase 14 chooses an explicit type annotation for the ctx object — recommend NOT adding it (TypeScript infers from the literal `'passkey-register'` discriminator).

**Phase 13 emit closure capture** (`src/server/router.ts:79-83` — copy alongside, do not modify):
```typescript
const rpId = config.rpId ?? 'localhost';
const emit = wrapAnalytics(config.hooks?.onAuthEvent, {
  logger: config.logger,
  await: config.awaitAnalytics === true,
});
```

**Pattern note:** Phase 14 does NOT need a similar closure — `afterAuthSuccess` is called inline (fire-and-forget is OFF for this hook per RESEARCH §Pattern 1 + Assumption A8). Just dereference `config.hooks?.afterAuthSuccess` directly at each fire site.

#### Register-finish fire point (HOOK-02) — `src/server/router.ts:201-281`

**Existing handler structure to interleave with** (lines 201-281):
```typescript
router.post('/register/finish', authLimiter, async (req: Request, res: Response) => {
  try {
    const body = validateBody(registerFinishBodySchema, req, res);
    if (!body) return;
    const { challengeId, response, tempUserId, codename } = body;

    if (!isValidCodename(codename)) {
      await emit({ type: 'register.finish.failure', rpId, timestamp: Date.now(), reason: 'invalid-codename' });
      return res.status(400).json({ error: 'Invalid codename format' });
    }

    const { verified, passkeyData } = await passkeyManager.finishRegistration(challengeId, response);
    if (!verified || !passkeyData) {
      await emit({ type: 'register.finish.failure', rpId, timestamp: Date.now(), reason: 'passkey-verification-failed' });
      return res.status(400).json({ error: 'Passkey verification failed' });
    }

    // Create NEAR account via MPC  (←  line 225 — MPC orphan boundary)
    const mpcAccount = await mpcManager.createAccount(tempUserId);

    // INFRA-02: Wrap DB operations in a transaction when available.
    const doRegistration = async (adapter: DatabaseAdapter) => {
      const user = await adapter.createUser({ codename, nearAccountId: mpcAccount.nearAccountId,
        mpcPublicKey: mpcAccount.mpcPublicKey, derivationPath: mpcAccount.derivationPath });

      await adapter.createPasskey({ credentialId: passkeyData.credentialId, userId: user.id,
        publicKey: passkeyData.publicKey, counter: passkeyData.counter,
        deviceType: passkeyData.deviceType, backedUp: passkeyData.backedUp,
        transports: passkeyData.transports });

      // ░░ Phase 14 HOOK-02 fire point goes HERE (between createPasskey and createSession) ░░

      const session = await sessionManager.createSession(user.id, res, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return { user, session };
    };

    const { user } = db.transaction
      ? await db.transaction(doRegistration)
      : await doRegistration(db);

    await emit({ type: 'register.finish.success', rpId, timestamp: Date.now(),
      backupEligible: deriveBackupEligibility(passkeyData.deviceType) });

    res.json({ success: true, codename: user.codename, nearAccountId: user.nearAccountId,
      passkey: { backedUp: passkeyData.backedUp,
        backupEligible: deriveBackupEligibility(passkeyData.deviceType) } });
  } catch (error) {
    log.error({ err: error }, 'Registration finish error');
    await emit({ type: 'register.finish.failure', rpId, timestamp: Date.now(), reason: 'internal-error' });
    res.status(500).json({ error: 'Registration failed' });
  }
});
```

**Transaction wrapper signature** (verified from `src/types/index.ts:324-326`):
```typescript
transaction?<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;
```
Async fn, returns generic `Promise<T>`, throws propagate (Postgres adapter calls `ROLLBACK`). Phase 14 reuses this signature unchanged. The wrapped fn returns whatever shape `doRegistration` returns — Phase 14 widens that return to `{ user, session, secondFactor: ... }` so the outer scope can branch on `secondFactor` after the transaction commits.

**Phase 13 / Phase 14 ordering at this fire site:**
1. Phase 13 emit `register.finish.success` (line 260-265) fires AFTER the transaction returns and BEFORE `res.json` (line 267).
2. Phase 14 hook fires INSIDE the transaction, between `adapter.createPasskey` (line 246) and `sessionManager.createSession` (line 248).
3. **Locked ordering:** Phase 14 hook → tx commits → Phase 13 emit → res.json. Phase 13 emit fires regardless of `continue: true` vs `continue: false` (RESEARCH Pitfall 4 Option A).

**Pattern to apply (Phase 14 insert):**
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

Then post-transaction (replace lines 256-275):
```typescript
const { user, secondFactor } = db.transaction
  ? await db.transaction(doRegistration)
  : await doRegistration(db);

await emit({ type: 'register.finish.success', rpId, timestamp: Date.now(),
  backupEligible: deriveBackupEligibility(passkeyData.deviceType) });

if (secondFactor) {
  return res.status(secondFactor.status).json({ ...secondFactor.body, secondFactor });
}

res.json({ /* unchanged */ });
```

**Error handling pattern** (lines 276-280) — UNCHANGED. The existing outer `try/catch` already handles hook throw:
```typescript
} catch (error) {
  log.error({ err: error }, 'Registration finish error');
  await emit({ type: 'register.finish.failure', rpId, timestamp: Date.now(), reason: 'internal-error' });
  res.status(500).json({ error: 'Registration failed' });
}
```
A hook throw inside `doRegistration` triggers `db.transaction` rollback (DB rows reverted), then propagates to this catch block, which emits `register.finish.failure` and 500s. MPC orphan remains (`mpcManager.createAccount` already ran at line 225, BEFORE `doRegistration`). HOOK-06 contract.

#### Login-finish fire point (HOOK-03) — `src/server/router.ts:328-385`

**Existing handler structure** (lines 328-385):
```typescript
router.post('/login/finish', authLimiter, async (req: Request, res: Response) => {
  try {
    const body = validateBody(loginFinishBodySchema, req, res);
    if (!body) return;
    const { challengeId, response } = body;

    const { verified, userId, passkeyData } = await passkeyManager.finishAuthentication(challengeId, response);

    if (!verified || !userId) {
      await emit({ type: 'login.finish.failure', rpId, timestamp: Date.now(), reason: 'auth-failed' });
      return res.status(401).json({ error: 'Authentication failed' });
    }

    const user = await db.getUserById(userId);

    if (!user) {
      await emit({ type: 'login.finish.failure', rpId, timestamp: Date.now(), reason: 'user-not-found' });
      return res.status(404).json({ error: 'User not found' });
    }

    // ░░ Phase 14 HOOK-03 fire point goes HERE (between getUserById success and createSession) ░░

    // Create session
    await sessionManager.createSession(user.id, res, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    if (passkeyData) {
      await emit({ type: 'login.finish.success', rpId, timestamp: Date.now(),
        backupEligible: deriveBackupEligibility(passkeyData.deviceType) });
    }

    res.json({ success: true, codename: user.codename,
      ...(passkeyData && {
        passkey: { backedUp: passkeyData.backedUp,
          backupEligible: deriveBackupEligibility(passkeyData.deviceType) },
      }),
    });
  } catch (error) {
    log.error({ err: error }, 'Login finish error');
    await emit({ type: 'login.finish.failure', rpId, timestamp: Date.now(), reason: 'internal-error' });
    res.status(500).json({ error: 'Authentication failed' });
  }
});
```

**Pattern to apply (Phase 14 insert):** Same conditional pattern as register-finish, but **NO transaction wrapper** (login does no multi-write DB op between verify and session). Insert between line 350 (`if (!user)` early-return) and line 353 (`sessionManager.createSession`):
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

Then re-order Phase 13 `login.finish.success` emit + short-circuit response (replace lines 352-379):
```typescript
// HOOK-04 Pitfall 4 Option A: emit success regardless of short-circuit (auth itself succeeded)
if (passkeyData) {
  await emit({ type: 'login.finish.success', rpId, timestamp: Date.now(),
    backupEligible: deriveBackupEligibility(passkeyData.deviceType) });
}

if (secondFactor) {
  return res.status(secondFactor.status).json({ ...secondFactor.body, secondFactor });
}

await sessionManager.createSession(user.id, res, {
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});

res.json({ /* unchanged */ });
```

**Note on emit ordering at login:** RESEARCH §Pitfall 4 Option A means emit fires for both `continue: true` (before createSession) and `continue: false` (before short-circuit response). Test asserts `login.finish.success` fired exactly once in BOTH branches.

---

### `src/server/oauth/router.ts` (controller, request-response × 3 branches)

**Analog:** Same file — Phase 13 inline `await emit(...)` pattern at all 3 success branches (lines 248, 284, 370). Phase 14 wires hook calls IMMEDIATELY BEFORE each existing `await emit({ type: 'oauth.callback.success', ... })` and BEFORE each `sessionManager.createSession`.

**Imports / module setup pattern** (`src/server/oauth/router.ts:7-25`) — already imports everything Phase 14 needs:
```typescript
import type { Request, Response } from 'express';
import type { DatabaseAdapter, OAuthConfig, OAuthProvider, RateLimitConfig, CsrfConfig, AnonAuthHooks } from '../../types/index.js';
import { wrapAnalytics } from '../analytics.js';
```

**Pattern to apply:** Phase 14 will need to import the new types from `../../types/index.js`. Add to the existing type-import block:
```typescript
import type { ..., AnonAuthHooks, AfterAuthSuccessCtx } from '../../types/index.js';
```

#### OAuth Branch 1 — Existing user, same provider (`oauth/router.ts:241-262`)

**Existing structure:**
```typescript
let user = await db.getOAuthUserByProvider(provider, profile.providerId);

if (user) {
  // Existing user - update last active and create session
  await sessionManager.createSession(user.id, res, {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  await emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });

  return res.json({
    success: true,
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl,
      nearAccountId: user.nearAccountId, type: 'standard' },
    isNewUser: false,
  });
}
```

**Pattern to apply** (Phase 14 — replace this whole block):
```typescript
if (user) {
  // ░░ Phase 14 HOOK-04 fire point — Branch 1 ░░
  const sf = await runOAuthHook(config.hooks?.afterAuthSuccess, {
    authMethod: `oauth-${provider}` as const,
    userId: user.id,
    nearAccountId: user.nearAccountId,
    provider,
    req,
  });

  if (sf) {
    await emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });
    return res.status(sf.status).json({ ...sf.body, secondFactor: sf });
  }

  await sessionManager.createSession(user.id, res, {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  await emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });

  return res.json({ /* unchanged */ });
}
```

#### OAuth Branch 2 — Existing user, link by email (`oauth/router.ts:264-300`)

**Existing structure:**
```typescript
if (profile.email) {
  user = await db.getOAuthUserByEmail(profile.email);
  if (user) {
    const providerData: OAuthProvider = { /* ... */ };
    await db.linkOAuthProvider(user.id, providerData);

    await sessionManager.createSession(user.id, res, { /* ... */ });

    await emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });

    return res.json({ /* ... */ });
  }
}
```

**Pattern to apply:** Insert hook fire AFTER `db.linkOAuthProvider` (line 277), BEFORE `sessionManager.createSession` (line 279):
```typescript
await db.linkOAuthProvider(user.id, providerData);

// ░░ Phase 14 HOOK-04 fire point — Branch 2 ░░
const sf = await runOAuthHook(config.hooks?.afterAuthSuccess, {
  authMethod: `oauth-${provider}` as const,
  userId: user.id,
  nearAccountId: user.nearAccountId,
  provider,
  req,
});

if (sf) {
  await emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });
  return res.status(sf.status).json({ ...sf.body, secondFactor: sf });
}

await sessionManager.createSession(user.id, res, { /* unchanged */ });
await emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });
return res.json({ /* unchanged */ });
```

#### OAuth Branch 3 — New user (`oauth/router.ts:302-383`)

**Existing structure:**
```typescript
// New user - create account with MPC
const tempUserId = crypto.randomUUID();
const mpcAccount = await mpcManager.createAccount(tempUserId);     // ← line 304 — MPC orphan boundary

const newUser = await db.createOAuthUser({ /* ... */ });            // line 315-323

// Create IPFS recovery backup automatically for OAuth users
if (ipfsRecovery && profile.email) {
  try {
    /* ... lines 326-362: createRecoveryBackup + storeRecoveryData + sendRecoveryPassword ... */
  } catch (error) { log.error({ err: error }, 'Failed to create recovery backup'); }
}

// Create session
await sessionManager.createSession(newUser.id, res, { /* ... */ });   // line 365-368

await emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });  // line 370

return res.json({
  success: true,
  user: { id: newUser.id, email: newUser.email, name: newUser.name,
    avatarUrl: newUser.avatarUrl, nearAccountId: newUser.nearAccountId, type: 'standard' },
  isNewUser: true,
});
```

**Pattern to apply:** Insert hook fire AFTER IPFS recovery setup (line 362, end of `if (ipfsRecovery)` block), BEFORE `sessionManager.createSession` (line 365):
```typescript
// ... IPFS recovery setup (unchanged) ...

// ░░ Phase 14 HOOK-04 fire point — Branch 3 (new user) ░░
const sf = await runOAuthHook(config.hooks?.afterAuthSuccess, {
  authMethod: `oauth-${provider}` as const,
  userId: newUser.id,
  nearAccountId: newUser.nearAccountId,
  provider,
  req,
});

if (sf) {
  await emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });
  return res.status(sf.status).json({ ...sf.body, secondFactor: sf });
}

await sessionManager.createSession(newUser.id, res, { /* unchanged */ });
await emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });
return res.json({ /* unchanged */ });
```

**Helper definition** (insert near top of `createOAuthRouter`, after Phase 13's `emit` capture at line 71):
```typescript
// Phase 14 HOOK-04 — encapsulates the 3 IDENTICAL fire blocks. Returns
// a secondFactor descriptor on continue:false; undefined on continue:true.
async function runOAuthHook(
  hook: AnonAuthHooks['afterAuthSuccess'],
  ctx: Extract<AfterAuthSuccessCtx, { authMethod: `oauth-${string}` }>,
): Promise<{ status: number; body: Record<string, unknown> } | undefined> {
  if (!hook) return undefined;
  const result = await hook(ctx);
  if (result.continue) return undefined;
  return { status: result.status, body: result.body };
}
```

**Why a helper here (not at register/login):** The 3 OAuth branches have IDENTICAL ctx shapes and hook bodies — drift is a correctness risk. Helper enforces lockstep by construction. Register/login each have ONE site with different ctx variants — inline keeps the closure tight.

**OAuth `codename` resolution at call site:** `OAuthUser` (`src/types/index.ts:410-422`) has no `codename` field — the helper ctx must omit `codename` (RESEARCH Open Question #2 Option (b): make `codename?: string` optional on the OAuth ctx variant). All 3 OAuth call sites above OMIT the `codename` key — TypeScript permits this when the type variant marks it optional.

**Error handling pattern** (`oauth/router.ts:384-387`) — UNCHANGED. The outer `try/catch` already catches hook throw:
```typescript
} catch (error) {
  log.error({ err: error }, 'OAuth callback error');
  return res.status(500).json({ error: 'OAuth authentication failed' });
}
```
Hook throw on Branch 3 (new user) → user + MPC + IPFS already committed (no transaction wrapper); same ugly state as `continue: false` plus a 500 response. RESEARCH §Pitfall 6.

---

### `src/server/index.ts` (barrel re-export, declaration)

**Analog:** Same file — Phase 11 `AnonAuthHooks` re-export at line 264 + Phase 13 `AnalyticsEvent` re-export at line 277.

**Existing re-export pattern** (`src/server/index.ts:262-277`):
```typescript
export type {
  AnonAuthConfig,
  AnonAuthHooks,        // Phase 11 HOOK-01 re-export
  RelatedOrigin,        // Phase 12 RPID-01 re-export
  DatabaseAdapter,
  AnonUser,
  OAuthUser,
  User,
  UserType,
  OAuthProvider,
  OAuthConfig,
  Session,
  RateLimitConfig,
  CsrfConfig
} from '../types/index.js';
export type { AnalyticsEvent } from './analytics.js';        // Phase 13 ANALYTICS-02 re-export
```

**Pattern to apply:** Add new types to the existing block (RESEARCH §Open Question #5 — recommendation YES, re-export):
```typescript
export type {
  AnonAuthConfig,
  AnonAuthHooks,
  AfterAuthSuccessCtx,           // Phase 14 HOOK-02 re-export
  AfterAuthSuccessResult,        // Phase 14 HOOK-02 re-export
  AfterAuthSuccessProvider,      // Phase 14 HOOK-04 re-export (helper for narrowing)
  RelatedOrigin,
  /* ... rest unchanged ... */
} from '../types/index.js';
```

---

### `README.md` (documentation)

**Analog:** Phase 13 README "Analytics Hook" section (precedent for the docs layout — search for the section title in the current README to verify location and trim style).

**Pattern to apply:** Append a new "Hooks (v0.7.0) — `afterAuthSuccess`" subsection after Phase 13's analytics section. Required content (per HOOK-06 + RESEARCH §Pitfall 1):

1. **Signature** — show the discriminated-union ctx + result type, copy-paste from `src/types/index.ts` post-tighten.
2. **Fire points** — list all 5 (passkey register, passkey login, OAuth × 3 branches).
3. **MPC orphan trade-off paragraph** — copy from RESEARCH HOOK-06 Pitfall 1 verbatim (the canonical paragraph already exists in the research doc — Phase 16 RELEASE-01 will lift it later, but Phase 14 must produce the prose now).
4. **Recommended mitigation** — idempotent + non-throwing hooks; prefer `continue: false` over `throw` for soft failures.
5. **Cookie semantics** — short-circuit (`continue: false`) emits NO `Set-Cookie`; consumer detects via `res.headers['set-cookie']` undefined.
6. **WARNING on `req`** — JSDoc-style note that `ctx.req` is the bare Express `Request`; consumer is responsible for sanitizing what they read/log.

---

### `src/__tests__/second-factor-register.test.ts` (CREATE — integration test)

**Analog:** `src/__tests__/analytics-lifecycle.test.ts` lines 1-230 (mock harness verbatim).

**Imports / harness pattern** (`analytics-lifecycle.test.ts:14-19`):
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRouter } from '../server/router.js';
import type { DatabaseAdapter } from '../types/index.js';
```

**Mock DB factory pattern** (`analytics-lifecycle.test.ts:26-84`) — copy verbatim. The `makeMockDb` factory returns a fully-populated `DatabaseAdapter` mock. Phase 14's orphan test will additionally inject a `transaction` mock that emulates Postgres behavior (calls fn; on async throw, asserts no rows persisted).

**Mock managers pattern** (`analytics-lifecycle.test.ts:91-142`) — copy `mockPasskeyManager`, `mockSessionManager`, `mockMpcManager` verbatim.

**App factory + spy pattern** (`analytics-lifecycle.test.ts:184-207`) — adapt by replacing `onAuthEvent` with `afterAuthSuccess` (or carry both):
```typescript
function makeApp(overrides: Record<string, unknown> = {}) {
  const afterAuthSuccess = vi.fn();
  const onAuthEvent = vi.fn();
  const app = express();
  app.use(express.json());
  const router = createRouter({
    db: mockDb,
    sessionManager: mockSessionManager as any,
    passkeyManager: mockPasskeyManager as any,
    mpcManager: mockMpcManager as any,
    rateLimiting: { auth: { limit: 1000, windowMs: 60000 } },
    rpId: 'localhost',
    hooks: { afterAuthSuccess, onAuthEvent },
    ...overrides,
  } as any);
  app.use(router);
  return { app, afterAuthSuccess, onAuthEvent };
}
```

**Test cases to cover** (HOOK-02 + HOOK-05):
- `afterAuthSuccess` is called exactly once per request, with the correct `passkey-register` ctx including `req` field.
- `continue: true` allows `sessionManager.createSession` to be called; response is the standard `RegistrationFinishResponse`; `secondFactor` is undefined.
- `continue: false` short-circuits: response status matches consumer's `status`, body fields are SPREAD into the response top-level, `secondFactor: { status, body }` echo is present, `sessionManager.createSession` is NOT called, `res.headers['set-cookie']` is undefined.
- Backwards compat: `hooks: {}` (no `afterAuthSuccess`) → flow runs unchanged; `mockSessionManager.createSession` called.
- Pitfall 4 Option A: `register.finish.success` analytics event fires REGARDLESS of `continue: true` vs `continue: false`.

---

### `src/__tests__/second-factor-login.test.ts` (CREATE — integration test)

**Analog:** Same `analytics-lifecycle.test.ts` harness as register; the login describe blocks already exist there as a model for fire-point assertions.

**Pattern to apply:** Same mock harness as register-finish test. Test cases cover HOOK-03 + HOOK-05 with these specifics:
- `passkeyManager.finishAuthentication` mock returns `{ verified: true, userId: 'user-1', passkeyData: {...} }` (existing pattern at `analytics-lifecycle.test.ts:111-121`).
- `db.getUserById` mock returns the user row (existing pattern at lines 37-44).
- `afterAuthSuccess` is called with `authMethod: 'passkey-login'` ctx.
- Same short-circuit semantics; `mockSessionManager.createSession` NOT called on `continue: false`.
- Pitfall 4 Option A: `login.finish.success` fires regardless.
- No transaction wrapper involved (verify by asserting `mockDb.transaction` is NOT called even when present).

---

### `src/__tests__/second-factor-oauth.test.ts` (CREATE — integration test)

**Analog:** `src/__tests__/analytics-oauth.test.ts` lines 1-200 (3-branch harness verbatim).

**Imports / harness pattern** (`analytics-oauth.test.ts:18-27`):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOAuthRouter } from '../server/oauth/router.js';
import type { DatabaseAdapter, OAuthStateRecord, OAuthConfig } from '../types/index.js';
import type { OAuthManager, OAuthProfile } from '../server/oauth/index.js';
```

**Mock OAuthManager pattern** (`analytics-oauth.test.ts:102-132`) — copy `makeMockOAuthManager` verbatim. The fixture controls `validateState`, `exchangeCode`, `getProfile` directly so the test never hits Google/GitHub/Twitter.

**App factory pattern** (`analytics-oauth.test.ts:138-161`) — adapt by adding `afterAuthSuccess` spy alongside `onAuthEvent`:
```typescript
function makeOAuthApp(overrides: AppOverrides = {}) {
  const afterAuthSuccess = vi.fn();
  const onAuthEvent = vi.fn();
  const app = express();
  app.use(express.json());
  const router = createOAuthRouter({
    db: overrides.mockDb ?? makeMockDb(),
    sessionManager: mockSessionManager,
    mpcManager: mockMpcManager,
    oauthConfig: mockOAuthConfig,
    oauthManager: overrides.oauthManager ?? makeMockOAuthManager(),
    rpId: overrides.rpId ?? 'localhost',
    awaitAnalytics: overrides.awaitAnalytics ?? false,
    hooks: { afterAuthSuccess, onAuthEvent },
  });
  app.use(router);
  return { app, afterAuthSuccess, onAuthEvent };
}
```

**Branch selection pattern** (`analytics-oauth.test.ts:188-200`) — drives each branch by mocking `getOAuthUserByProvider` / `getOAuthUserByEmail` / both-null to hit the desired branch:
- **Branch 1:** `mockDb.getOAuthUserByProvider.mockResolvedValue(<existing user>)` → existing-user-same-provider.
- **Branch 2:** `mockDb.getOAuthUserByProvider.mockResolvedValue(null)` + `mockDb.getOAuthUserByEmail.mockResolvedValue(<existing user>)` → link-by-email.
- **Branch 3:** both return null → new-user (will trigger `mpcManager.createAccount`).

**Test cases to cover** (HOOK-04 + HOOK-05) — 3 branches × 2 outcomes (continue:true / continue:false) = 6 base cases plus:
- ctx assertion: `authMethod` is the correct `oauth-google` / `oauth-github` / `oauth-twitter` literal; `provider` is the matching string; `codename` is OMITTED (per Open Question #2 resolution).
- short-circuit emits no `Set-Cookie`; `mockSessionManager.createSession` not called.
- Pitfall 4 Option A: `oauth.callback.success` fires regardless.

---

### `src/__tests__/second-factor-orphan.test.ts` (CREATE — integration / change detector)

**Analog:** `analytics-lifecycle.test.ts` mock harness (passkey register only) + new MPC-call-order assertion.

**Pattern to apply:** Subset of the `second-factor-register.test.ts` harness (passkey only — no OAuth), with one critical addition: the test injects a `mockDb.transaction` that EMULATES Postgres rollback semantics (call fn, on throw rethrow without committing rows).

**Critical mock injection** (NEW pattern Phase 14 introduces):
```typescript
const mockTransaction = vi.fn(async <T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> => {
  // Emulates Postgres BEGIN/COMMIT/ROLLBACK: pass the same adapter; on throw, rethrow.
  // Phase 14's HOOK-06 contract: hook throw → DB rollback → outer catch → 500.
  try {
    return await fn(mockDb);
  } catch (err) {
    // Postgres adapter would call ROLLBACK here. In-mock equivalent: nothing to do —
    // the test asserts call ORDER / call COUNT, not row state.
    throw err;
  }
});
const mockDb = makeMockDb({ transaction: mockTransaction });
```

**Test cases to cover** (HOOK-06):
- `afterAuthSuccess.mockRejectedValue(new Error('hook deliberately threw'))`.
- Response is 500.
- `mockMpcManager.createAccount` was called EXACTLY ONCE — the orphan-MPC contract.
- `mockSessionManager.createSession` was NOT called (hook threw before session creation).
- Optionally: assert `mockTransaction` was called and the throw propagated through it (call-order assertion: `mpcManager.createAccount` BEFORE `mockTransaction`).
- Documentation comment on the test: "this is a CHANGE DETECTOR — if MPC moves inside the transaction, this test breaks; the planner reviews HOOK-06 README copy."

---

## Shared Patterns

### Conditional hook fire (applies to register/login fire sites)

**Source:** New pattern Phase 14 introduces; closest analog is Phase 13's `wrapAnalytics` capture (`router.ts:80-83`).

**Apply to:** `src/server/router.ts` register-finish + login-finish.

```typescript
let secondFactor: { status: number; body: Record<string, unknown> } | undefined;
if (config.hooks?.afterAuthSuccess) {
  const result = await config.hooks.afterAuthSuccess({
    authMethod: '<literal>',
    userId: user.id,
    codename: user.codename,
    nearAccountId: user.nearAccountId,
    req,
    /* + provider on OAuth variant only */
  });
  if (!result.continue) {
    secondFactor = { status: result.status, body: result.body };
  }
}
```

**Optional-chaining guard:** Use `config.hooks?.afterAuthSuccess` (NOT `config.hooks` alone) — handles both `hooks: undefined` and `hooks: { afterAuthSuccess: undefined }`. RESEARCH §Pitfall 7.

### Helper extraction (applies to OAuth fire sites only)

**Source:** New pattern Phase 14 introduces; closest analog is Phase 13's `wrapAnalytics` factory function (`src/server/analytics.ts`).

**Apply to:** `src/server/oauth/router.ts` × 3 branches.

```typescript
async function runOAuthHook(
  hook: AnonAuthHooks['afterAuthSuccess'],
  ctx: Extract<AfterAuthSuccessCtx, { authMethod: `oauth-${string}` }>,
): Promise<{ status: number; body: Record<string, unknown> } | undefined> {
  if (!hook) return undefined;
  const result = await hook(ctx);
  if (result.continue) return undefined;
  return { status: result.status, body: result.body };
}
```

**Why hybrid (helper for OAuth, inline for register/login):** RESEARCH §Pattern 7 — register/login each have ONE fire site with different ctx shapes; OAuth has THREE IDENTICAL fire sites where drift is a correctness risk.

### Short-circuit response shape (applies to all 5 fire sites)

**Source:** REQUIREMENTS HOOK-05; locked at the contract level.

**Apply to:** All 5 fire sites.

```typescript
if (secondFactor /* or `sf` from helper */) {
  return res.status(secondFactor.status).json({
    ...secondFactor.body,
    secondFactor,
  });
}
```

**Spread pattern note:** Consumer's `body` is spread FIRST, `secondFactor` echo added LAST. If consumer's body happens to include a key named `secondFactor`, the echo wins (intentional — the echo is the canonical source of short-circuit metadata). Document this in JSDoc.

### Test mock harness (applies to all 4 new test files)

**Source:** `src/__tests__/analytics-lifecycle.test.ts:14-230` (passkey) + `src/__tests__/analytics-oauth.test.ts:1-180` (OAuth).

**Apply to:** All 4 new test files.

**Pattern:**
1. `makeMockDb()` factory with `vi.fn()`-backed methods returning canned shapes.
2. Module-level `mockPasskeyManager`, `mockSessionManager`, `mockMpcManager`, `mockOAuthManager` constants.
3. `makeApp()` / `makeOAuthApp()` factory that wires `vi.fn()` spies for `afterAuthSuccess` and `onAuthEvent` into `hooks: { ... }`.
4. `beforeEach(() => { vi.clearAllMocks(); /* reset mockSessionManager.createSession defaults */ })` to isolate test runs.
5. Use `request(app).post('/...').send({...}).expect(<status>)` — supertest-driven.
6. Assert on spy call count + spy call args via `mock.calls[0][0]` and `expect(...).toMatchObject(...)`.

### Anti-pattern to avoid (applies to all fire sites)

**Source:** RESEARCH §Pitfall 2 + §Pitfall 8.

- **Don't call `sessionManager.createSession` BEFORE the hook fires** — short-circuit MUST skip session creation; calling it first leaks a `Set-Cookie` header that consumer cannot revoke.
- **Don't drop the `await` on the hook call** — type signature is `Promise<AfterAuthSuccessResult>`; missing `await` means handler proceeds before hook resolves and short-circuit is broken.
- **Don't fire the hook OUTSIDE `doRegistration`** — locked at REQUIREMENTS line 9; hook MUST live inside the transaction callback so a throw triggers DB rollback.
- **Don't add `provider` to register/login ctx variants** — discriminated-union narrowing requires `provider` ONLY on OAuth variants. RESEARCH §Pitfall 5.
- **Don't suppress `register.finish.success` / `login.finish.success` / `oauth.callback.success` analytics on short-circuit** — RESEARCH §Pitfall 4 Option A; auth itself succeeded.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every Phase 14 file has a strong analog in-tree. The closest "no-analog" surface is the `runOAuthHook` helper itself, which is a NEW micro-helper local to `oauth/router.ts` — but it is structurally identical to Phase 13's `wrapAnalytics` factory pattern (`src/server/analytics.ts`), and to the `validateBody` middleware-helper pattern (`src/server/validation/validateBody.ts`). |

The `second-factor-orphan.test.ts` `mockTransaction` injection is the only NEW test pattern Phase 14 introduces — no prior test mocks `db.transaction` to verify rollback semantics. Planner should consider this a small but honest extension of the test analog.

---

## Metadata

**Analog search scope:**
- `src/server/router.ts` (Phase 13 emit points)
- `src/server/oauth/router.ts` (Phase 13 OAuth × 3 branches)
- `src/types/index.ts` (Phase 11 `AnonAuthHooks` + `RegistrationFinishResponse` / `AuthenticationFinishResponse`)
- `src/server/index.ts` (Phase 11/13 re-export pattern)
- `src/__tests__/analytics-lifecycle.test.ts` (passkey test harness)
- `src/__tests__/analytics-oauth.test.ts` (OAuth × 3 branches test harness)
- `src/__tests__/hooks-scaffolding.test.ts` (Phase 11 `hooks: {}` compile contract)
- `src/server/db/adapters/postgres.ts` (transaction wrapper signature verification)

**Files scanned:** 8

**Pattern extraction date:** 2026-04-30
