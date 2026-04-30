# Phase 13: Registration Analytics Hook - Pattern Map

**Mapped:** 2026-04-29
**Files analyzed:** 11 (4 modified + 7 new)
**Analogs found:** 11 / 11 (100%)
**Source research:** `.planning/phases/13-registration-analytics-hook/13-RESEARCH.md` (Lifecycle Boundary Inventory at lines 127-157, Wave 0 Gaps at lines 116-122)

---

## File Classification

### New files

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/server/analytics.ts` | service (envelope/factory + type-only union) | event-driven | `src/server/mpc.ts` (logger init pattern, lines 395-414) + `src/types/index.ts` (RelatedOrigin literal-typed interface, lines 80-87) | role-match (best available — no existing analytics module; closest is the manager-with-injectable-logger pattern) |
| `src/__tests__/analytics-pii-leak.test.ts` | test (type-level / tsc-fail fixture) | child-process tsc | `src/__tests__/mpc-treasury-leak.test.ts` lines 197-242 (Gate 4 / MPC-07) | exact (RESEARCH.md explicitly cites this as the canonical pattern) |
| `src/__tests__/analytics-pii-snapshot.test.ts` | test (snapshot/whitelist) | runtime structural assertion | `src/__tests__/exports.test.ts` (compile + runtime cross-checks, lines 48-82) | role-match (no `toMatchSnapshot` users in repo — closest is the structural-keys cross-check pattern) |
| `src/__tests__/analytics-lifecycle.test.ts` | test (integration / supertest) | request-response | `src/__tests__/registration-auth.test.ts` (lines 1-211 mock harness, 213+ describe blocks) + `src/__tests__/recovery.test.ts` (lines 254-541 wallet+IPFS+account-delete coverage) | exact |
| `src/__tests__/analytics-oauth.test.ts` | test (integration / supertest) | request-response | `src/__tests__/oauth-cookie-guard.test.ts` (closest existing OAuth-router supertest harness) | role-match |
| `src/__tests__/analytics-types.test.ts` | test (type re-export + compile-time literal assignability) | compile-time | `src/__tests__/exports.test.ts` lines 48-82 (compile-time + runtime type re-export cross-check) | exact |
| `src/__tests__/analytics-latency.test.ts` | test (latency / perf timing assertion) | request-response + performance.now | `src/__tests__/registration-auth.test.ts` mock harness + RESEARCH.md Code Examples §"Latency assertion test pattern" (lines 705-721) | role-match (no existing latency tests in suite — pattern is synthesized) |

### Modified files

| Modified File | Role | Data Flow | Existing Analog Inside Same File | Edit Target |
|---|---|---|---|---|
| `src/server/router.ts` | controller (Express router) | request-response | Existing logger init at line 56; existing handler structure at lines 131-175 (register/start), 181-251 (register/finish), 261-285 (login/start), 291-336 (login/finish), 432-546 (recovery/wallet), 558-657 (recovery/ipfs), 700-731 (account delete) | Add `rpId` capture + `emit` closure at top of `createRouter`; add 11 inline `emit({ ... })` calls at lifecycle boundaries |
| `src/server/oauth/router.ts` | controller (Express router) | request-response | Existing logger init at line 47; OAuth callback handler structure at lines 187-367 (3 success branches at 226-244, 248-280, 296-362) | Add `rpId` + `emit` closure at top of `createOAuthRouter`; add 3 inline `emit({ type: 'oauth.callback.success', ... })` calls (one per success branch) |
| `src/server/index.ts` | factory (createAnonAuth) | configuration assembly | `hooks: config.hooks` threaded into both factories at lines 210 (OAuth) and 230 (passkey); rpConfig captured at line 127-131 | Thread `rpId: rpConfig.id` and `awaitAnalytics: config.awaitAnalytics` through both `createOAuthRouter` (line 199-211) and `createRouter` (line 219-231) calls |
| `src/types/index.ts` | type definition | n/a | `AnonAuthConfig` interface lines 93-196; existing `hooks?: AnonAuthHooks` at line 195 | Add `awaitAnalytics?: boolean` field at the same nesting level as `hooks` (top-level of `AnonAuthConfig`); update `AnonAuthHooks.onAuthEvent` at line 58 to use `AnalyticsEvent` type |
| `src/server/index.ts` (re-exports block, lines 258-272) | barrel export | n/a | Existing `AnonAuthHooks` re-export at line 260 (Phase 11), `RelatedOrigin` re-export at line 261 (Phase 12) | Add `AnalyticsEvent` to the type re-export list |
| `src/index.ts` (root re-export) | barrel export | n/a | Existing `AnonAuthConfig` re-export at lines 56-71 | (Optional — recommended) Add `AnalyticsEvent` if root-level autocomplete is desired; per Assumption A8 in RESEARCH, the canonical surface is `/server` only |

---

## Pattern Assignments

### `src/server/analytics.ts` (NEW — service / event-driven envelope + type-only union)

**Primary analog 1 — logger init with injectable logger fallback:** `src/server/mpc.ts` lines 404-414

**Imports pattern** (mirror this exact shape):
```typescript
// src/server/mpc.ts:1-N (relevant excerpts) + src/server/router.ts:18-19
import pino from 'pino';
import type { Logger } from 'pino';
```

**Logger-init pattern to copy** (`src/server/mpc.ts:404-414`):
```typescript
this.log = (config.logger ?? pino({
  level: 'silent',
  redact: {
    paths: [
      'config.treasuryPrivateKey',
      '*.treasuryPrivateKey',
      'treasuryPrivateKey',
    ],
    censor: '[Redacted]',
  },
})).child({ module: 'mpc' });
```

For `wrapAnalytics`, mirror this but the redact paths are unnecessary (no secret payloads in events) — copy ONLY the `(opts.logger ?? pino({ level: 'silent' })).child({ module: 'analytics' })` shape. RESEARCH.md "Claude's Discretion" point 5 (line 69) explicitly recommends `child({ module: 'analytics' })`.

**Primary analog 2 — discriminated literal-typed interface:** `src/types/index.ts` lines 80-87

**Pattern to copy (literal-string-typed required fields drive type-level invariant):**
```typescript
// src/types/index.ts:80-87
export interface RelatedOrigin {
  /** Origin for the related domain. Must be `https://...` (or
   *  `http://localhost...` only when paired rpId === 'localhost'). */
  origin: string;
  /** RP ID for the related domain. Origin's host MUST be a suffix-domain
   *  of this rpId (`host === rpId || host.endsWith('.' + rpId)`). */
  rpId: string;
}
```

The full `AnalyticsEvent` discriminated union shape to construct is in RESEARCH.md Pattern 1 (lines 240-313). The `ALLOWED_EVENT_FIELDS` constant export is at RESEARCH.md lines 308-312.

**Primary analog 3 — fire-and-forget catch+log on a non-blocking operation:** `src/server/oauth/router.ts:332-336`

```typescript
// src/server/oauth/router.ts:332-336 — pattern: invoke side-effect, log warn on failure, do NOT propagate
} catch (emailErr) {
  // Email failure should not fail the registration
  log.warn({ err: emailErr }, 'Recovery email send failed — user registered but password not emailed');
}
```

The `wrapAnalytics` function should mirror this exact "swallow + warn" semantic. Full reference implementation is in RESEARCH.md Pattern 2 (lines 322-403).

**Why this analog:** No analytics module exists today. The closest project conventions are: (a) MPC manager's `(config.logger ?? pino({ level: 'silent' })).child({ module: '...' })` pattern, replicated identically in `session.ts`, `passkey.ts:22`, `router.ts:56`, `oauth/router.ts:47` — universal across all managers; and (b) the OAuth router's email-failure swallow. Together they fully define the `wrapAnalytics` envelope shape.

---

### `src/server/router.ts` (MODIFIED — controller, 11 inline emit calls)

**Analog (same file):** existing logger setup at line 56; existing inline-success and inline-failure paths.

**Edit target 1 — top of `createRouter()` (line 56-65):**
```typescript
// src/server/router.ts:55-65 (existing)
export function createRouter(config: RouterConfig): Router {
  const log = (config.logger ?? pino({ level: 'silent' })).child({ module: 'router' });
  const router = Router();
  const {
    db,
    sessionManager,
    passkeyManager,
    mpcManager,
    walletRecovery,
    ipfsRecovery,
  } = config;
```

**Insert AFTER line 65** (per RESEARCH Pattern 3 / Pitfall 2 — single closure, not per-request):
```typescript
// Phase 13 — captured ONCE at router construction, not per-request.
const rpId = config.rpId ?? 'localhost';
const emit = wrapAnalytics(config.hooks?.onAuthEvent, {
  logger: config.logger,
  await: config.awaitAnalytics === true,
});
```

**Edit target 2 — register/start (line 134, after `if (!body) return;`):**
```typescript
// src/server/router.ts:131-135 (existing)
router.post('/register/start', authLimiter, async (req: Request, res: Response) => {
  try {
    const body = validateBody(registerStartBodySchema, req, res);
    if (!body) return;
    // INSERT HERE: emit({ type: 'register.start', rpId, timestamp: Date.now() });
```

**Edit target 3 — register/finish.failure × 3** (lines 188-189, 198-199, 247-248):
```typescript
// src/server/router.ts:188-189 (existing — invalid codename early return)
if (!isValidCodename(codename)) {
  return res.status(400).json({ error: 'Invalid codename format' });
}
// INSERT BEFORE return: emit({ type: 'register.finish.failure', rpId, timestamp: Date.now(), reason: 'invalid-codename' });

// src/server/router.ts:198-199 (existing — verification failure early return)
if (!verified || !passkeyData) {
  return res.status(400).json({ error: 'Passkey verification failed' });
}
// INSERT BEFORE return: emit({ type: 'register.finish.failure', rpId, timestamp: Date.now(), reason: 'passkey-verification-failed' });

// src/server/router.ts:247-250 (existing — catch block)
} catch (error) {
  log.error({ err: error }, 'Registration finish error');
  res.status(500).json({ error: 'Registration failed' });
}
// INSERT INSIDE catch: emit({ type: 'register.finish.failure', rpId, timestamp: Date.now(), reason: 'internal-error' });
```

Per Pitfall 1 in RESEARCH.md (lines 584-591): EVERY exit path must emit. Acceptance criterion: `grep -c "type: 'register.finish.failure'" src/server/router.ts` returns 3.

**Edit target 4 — register/finish.success (line 238, just before `res.json(...)`):**
```typescript
// src/server/router.ts:238-246 (existing)
res.json({
  success: true,
  codename: user.codename,
  nearAccountId: user.nearAccountId,
  passkey: {
    backedUp: passkeyData.backedUp,
    backupEligible: deriveBackupEligibility(passkeyData.deviceType),
  },
});
// INSERT BEFORE res.json:
// emit({
//   type: 'register.finish.success',
//   rpId,
//   timestamp: Date.now(),
//   backupEligible: deriveBackupEligibility(passkeyData.deviceType),
// });
```

**Edit target 5 — login/start (line 264, after `if (!body) return;`):**
```typescript
// src/server/router.ts:261-266 (existing)
router.post('/login/start', authLimiter, async (req: Request, res: Response) => {
  try {
    const body = validateBody(loginStartBodySchema, req, res);
    if (!body) return;
    const { codename } = body;
    // INSERT HERE: emit({ type: 'login.start', rpId, timestamp: Date.now(), codenameProvided: !!codename });
```

Note `codenameProvided: !!codename` — the boolean flag, not the codename itself (REQUIREMENTS line 52, ANALYTICS-02).

**Edit target 6 — login/finish.failure × 3** (lines 303-304, 309-310, 332-333):
```typescript
// src/server/router.ts:303-305 (existing)
if (!verified || !userId) {
  return res.status(401).json({ error: 'Authentication failed' });
}
// INSERT BEFORE return: emit({ type: 'login.finish.failure', rpId, timestamp: Date.now(), reason: 'auth-failed' });

// src/server/router.ts:309-311 (existing)
if (!user) {
  return res.status(404).json({ error: 'User not found' });
}
// INSERT BEFORE return: emit({ type: 'login.finish.failure', rpId, timestamp: Date.now(), reason: 'user-not-found' });

// src/server/router.ts:332-335 (existing — catch)
} catch (error) {
  log.error({ err: error }, 'Login finish error');
  res.status(500).json({ error: 'Authentication failed' });
}
// INSERT INSIDE catch: emit({ type: 'login.finish.failure', rpId, timestamp: Date.now(), reason: 'internal-error' });
```

**Edit target 7 — login/finish.success (line 322, just before `res.json(...)`):**
```typescript
// src/server/router.ts:322-331 (existing)
res.json({
  success: true,
  codename: user.codename,
  ...(passkeyData && {
    passkey: {
      backedUp: passkeyData.backedUp,
      backupEligible: deriveBackupEligibility(passkeyData.deviceType),
    },
  }),
});
// INSERT BEFORE res.json:
// if (passkeyData) emit({
//   type: 'login.finish.success',
//   rpId,
//   timestamp: Date.now(),
//   backupEligible: deriveBackupEligibility(passkeyData.deviceType),
// });
```

**Edit target 8 — recovery.wallet.link.success (line 472, just before `res.json(...)` inside `/recovery/wallet/verify`):**
```typescript
// src/server/router.ts:465-475 (existing)
await db.storeRecoveryData({
  userId: user.id,
  type: 'wallet',
  reference: signature.publicKey,
  createdAt: new Date(),
});

res.json({
  success: true,
  message: 'Wallet linked for recovery. The link is stored on-chain, not in our database.',
});
// INSERT BEFORE res.json: emit({ type: 'recovery.wallet.link.success', rpId, timestamp: Date.now() });
```

Per RESEARCH line 141: emit on `/recovery/wallet/verify`, NOT `/recovery/wallet/link` (that's just challenge generation, not link success).

**Edit target 9 — recovery.wallet.recover.success (line 537, inside `/recovery/wallet/finish`):**
```typescript
// src/server/router.ts:531-541 (existing)
// Create session for recovered user
await sessionManager.createSession(user.id, res, {
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});

res.json({
  success: true,
  codename: user.codename,
  message: 'Recovery successful. You can now register a new passkey.',
});
// INSERT BEFORE res.json: emit({ type: 'recovery.wallet.recover.success', rpId, timestamp: Date.now() });
```

**Edit target 10 — recovery.ipfs.setup.success (line 605, inside `/recovery/ipfs/setup`):**
```typescript
// src/server/router.ts:598-609 (existing)
await db.storeRecoveryData({
  userId: user.id,
  type: 'ipfs',
  reference: cid,
  createdAt: new Date(),
});

res.json({
  success: true,
  cid,
  message: 'Backup created. Save this CID with your password - you need both to recover.',
});
// INSERT BEFORE res.json: emit({ type: 'recovery.ipfs.setup.success', rpId, timestamp: Date.now() });
```

**Edit target 11 — recovery.ipfs.recover.success (line 648, inside `/recovery/ipfs/recover`):**
```typescript
// src/server/router.ts:642-652 (existing)
await sessionManager.createSession(user.id, res, {
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});

res.json({
  success: true,
  codename: user.codename,
  message: 'Recovery successful. You can now register a new passkey.',
});
// INSERT BEFORE res.json: emit({ type: 'recovery.ipfs.recover.success', rpId, timestamp: Date.now() });
```

**Edit target 12 — account.delete (line 725, inside `DELETE /account`):**
```typescript
// src/server/router.ts:723-726 (existing)
// Delete user — passkeys cascade via FK ON DELETE CASCADE.
await db.deleteUser(userId);

res.json({ success: true });
// INSERT BEFORE res.json: emit({ type: 'account.delete', rpId, timestamp: Date.now() });
```

**Edit target 13 — `RouterConfig` interface (lines 37-53):** Add two optional fields next to existing `hooks?: AnonAuthHooks` on line 52:
```typescript
// EXISTING (lines 37-53):
export interface RouterConfig {
  db: DatabaseAdapter;
  // ... existing fields ...
  /** Phase 11 scaffolding — accepted and stored; call sites wired in Phases 13–15. */
  hooks?: AnonAuthHooks;
  // ADD (Phase 13):
  /** Primary RP ID, captured for analytics events. Phase 13. */
  rpId?: string;
  /** When true, await consumer's onAuthEvent hook before sending response. Phase 13. */
  awaitAnalytics?: boolean;
}
```

---

### `src/server/oauth/router.ts` (MODIFIED — controller, 3 inline emit calls)

**Analog (same file):** existing logger setup at line 47 — same pattern as `router.ts:56`.

**Edit target 1 — top of `createOAuthRouter()` (line 47-56):** mirror the closure-once pattern from passkey router. Insert AFTER line 56:
```typescript
// src/server/oauth/router.ts:46-56 (existing)
export function createOAuthRouter(config: OAuthRouterConfig): Router {
  const log = (config.logger ?? pino({ level: 'silent' })).child({ module: 'oauth' });
  const router = Router();
  const {
    db,
    sessionManager,
    mpcManager,
    oauthConfig,
    ipfsRecovery,
    emailService,
  } = config;
  // INSERT:
  // const rpId = config.rpId ?? 'localhost';
  // const emit = wrapAnalytics(config.hooks?.onAuthEvent, {
  //   logger: config.logger,
  //   await: config.awaitAnalytics === true,
  // });
```

**Edit target 2 — `oauth.callback.success` × 3 (lines 232, 266, 350)** — emit at all three success branches (per RESEARCH Open Question #2 / Assumption A3):

```typescript
// src/server/oauth/router.ts:226-244 (existing — branch 1: existing user same provider)
if (user) {
  await sessionManager.createSession(user.id, res, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  // INSERT BEFORE return: emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });
  return res.json({ success: true, user: { ... }, isNewUser: false });
}

// src/server/oauth/router.ts:248-280 (existing — branch 2: link by email)
if (profile.email) {
  user = await db.getOAuthUserByEmail(profile.email);
  if (user) {
    // ... linkOAuthProvider, createSession ...
    // INSERT BEFORE return: emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });
    return res.json({ success: true, user: { ... }, isNewUser: false, linkedProvider: provider });
  }
}

// src/server/oauth/router.ts:296-362 (existing — branch 3: new user)
const newUser = await db.createOAuthUser({ ... });
// ... ipfsRecovery setup ...
await sessionManager.createSession(newUser.id, res, { ... });
// INSERT BEFORE return: emit({ type: 'oauth.callback.success', rpId, timestamp: Date.now(), provider });
return res.json({ success: true, user: { ... }, isNewUser: true });
```

`provider` already typed `'google' | 'github' | 'twitter'` at line 203. Per RESEARCH line 155: do NOT emit `oauth.callback.failure` (not in REQUIREMENTS).

**Edit target 3 — `OAuthRouterConfig` interface (lines 26-44):** Add two optional fields next to existing `hooks?: AnonAuthHooks` on line 43:
```typescript
export interface OAuthRouterConfig {
  // ... existing fields ...
  hooks?: AnonAuthHooks;
  // ADD (Phase 13):
  rpId?: string;
  awaitAnalytics?: boolean;
}
```

---

### `src/server/index.ts` (MODIFIED — factory wiring)

**Analog (same file):** Phase 11's `hooks: config.hooks` threading at lines 210 and 230 (the canonical "thread once into both factories" reference).

**Edit target 1 — `createOAuthRouter` call (lines 199-211):**
```typescript
// src/server/index.ts:199-211 (existing)
oauthRouter = createOAuthRouter({
  db,
  sessionManager,
  mpcManager,
  oauthConfig: config.oauth,
  ipfsRecovery,
  emailService,
  logger,
  rateLimiting: config.rateLimiting,
  csrf: config.csrf,
  oauthManager,
  hooks: config.hooks,                        // Phase 11 HOOK-01
  // ADD (Phase 13):
  // rpId: rpConfig.id,
  // awaitAnalytics: config.awaitAnalytics,
});
```

**Edit target 2 — `createRouter` call (lines 219-231):**
```typescript
// src/server/index.ts:219-231 (existing)
const router = createRouter({
  db,
  sessionManager,
  passkeyManager,
  mpcManager,
  walletRecovery,
  ipfsRecovery,
  codename: config.codename,
  logger,
  rateLimiting: config.rateLimiting,
  csrf: config.csrf,
  hooks: config.hooks,                          // Phase 11 HOOK-01
  // ADD (Phase 13):
  // rpId: rpConfig.id,
  // awaitAnalytics: config.awaitAnalytics,
});
```

`rpConfig.id` is already in scope (computed at line 127-131). Per RESEARCH Pitfall 3 (lines 600-605): both factories must be threaded — `grep -c "awaitAnalytics" src/server/index.ts` should return ≥ 2.

**Edit target 3 — re-export block (lines 258-272):**
```typescript
// src/server/index.ts:258-272 (existing)
export type {
  AnonAuthConfig,
  AnonAuthHooks,        // Phase 11 HOOK-01 re-export
  RelatedOrigin,        // Phase 12 RPID-01 re-export
  // ADD: AnalyticsEvent,    // Phase 13 ANALYTICS-02 re-export
  DatabaseAdapter,
  // ... etc
} from '../types/index.js';
```

`AnalyticsEvent` lives in `src/server/analytics.ts`, not `../types/index.js` — add a separate `export type { AnalyticsEvent } from './analytics.js';` line OR add the export at the bottom of the existing type list block. Per Assumption A8 (line 790): `/server` is the canonical surface (mirrors `AnonAuthHooks` re-export shape).

---

### `src/types/index.ts` (MODIFIED — type definition)

**Analog (same file):** existing `hooks?: AnonAuthHooks` at line 195 (the most recently added optional field on `AnonAuthConfig`, Phase 11).

**Edit target 1 — `AnonAuthConfig` (lines 192-196):**
```typescript
// src/types/index.ts:192-196 (existing)
/** Optional consumer hooks (v0.7.0). All callbacks optional;
 *  absent or `hooks: {}` → behavior identical to v0.6.1.
 *  Phase 11 lands the type; call sites wired in Phases 13–15. */
hooks?: AnonAuthHooks;
// ADD (Phase 13 — top-level per REQUIREMENTS line 11 locked decision):
/** When true, the library awaits hooks.onAuthEvent before responding.
 *  Default false (fire-and-forget). Adds latency proportional to hook
 *  execution time when enabled. Phase 13 ANALYTICS-04. */
awaitAnalytics?: boolean;
```

Position matters: per REQUIREMENTS line 11 (locked decision) and RESEARCH Assumption A2 (line 784), `awaitAnalytics` is at the **top level of `AnonAuthConfig`**, NOT nested under `hooks`.

**Edit target 2 — `AnonAuthHooks.onAuthEvent` (line 58):**
```typescript
// src/types/index.ts:57-58 (existing — Phase 11 placeholder)
/** Phase 13 — fires fire-and-forget at lifecycle boundaries. */
onAuthEvent?: (event: unknown) => void | Promise<void>;
```
Replace `(event: unknown)` with `(event: AnalyticsEvent)` and add an import of `AnalyticsEvent` from `'../server/analytics.js'` at the top of `src/types/index.ts`. NOTE: this creates a `types → server` import edge — mirror Phase 12's `RelatedOrigin` placement: `RelatedOrigin` was added to `src/types/index.ts` (line 80-87) to AVOID such an edge. Recommended alternative: define `AnalyticsEvent` in `src/types/index.ts` next to `RelatedOrigin` and re-export from `src/server/analytics.ts`. Planner should choose; either preserves type-level safety.

---

### `src/__tests__/analytics-pii-leak.test.ts` (NEW — type-level tsc-fail fixture)

**Exact analog:** `src/__tests__/mpc-treasury-leak.test.ts` lines 197-242 (Gate 4 / MPC-07).

**Imports pattern to mirror** (`src/__tests__/mpc-treasury-leak.test.ts:17-22`):
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import pino from 'pino';
import { MPCAccountManager, type MPCAccountManagerConfig } from '../server/mpc.js';
```

For Phase 13: replace `MPCAccountManagerConfig` with `AnalyticsEvent` (`import type { AnalyticsEvent } from '../server/analytics.js'`).

**Fixture-write + tsc shell-out + assert pattern** (`src/__tests__/mpc-treasury-leak.test.ts:211-241`):
```typescript
it('a config literal WITHOUT derivationSalt fails tsc on a fixture file', () => {
  const fixturePath = join(process.cwd(), 'src/__tests__/_mpc-config-fixture.ts');
  const fixtureSrc = `
    import type { MPCAccountManagerConfig } from '../server/mpc.js';
    const _bad: MPCAccountManagerConfig = {
      networkId: 'testnet',
      treasuryAccount: 'treasury.testnet',
      treasuryPrivateKey: 'ed25519:placeholder',
      // derivationSalt OMITTED — this MUST fail tsc
    };
    export {};
    void _bad;
  `;
  writeFileSync(fixturePath, fixtureSrc, 'utf-8');
  let tscFailed = false;
  let tscOutput = '';
  try {
    execSync(`npx tsc --noEmit ${fixturePath}`, { encoding: 'utf-8', cwd: process.cwd(), stdio: 'pipe' });
  } catch (err) {
    tscFailed = true;
    const e = err as { stdout?: string; stderr?: string };
    tscOutput = (e.stdout || '') + (e.stderr || '');
  } finally {
    if (existsSync(fixturePath)) unlinkSync(fixturePath);
  }
  expect(tscFailed).toBe(true);
  expect(tscOutput).toMatch(/derivationSalt/);
}, 30_000);
```

For Phase 13: parameterize the fixture body with `it.each(['userId', 'codename', 'nearAccountId', 'email', 'ip', 'userAgent'])` per RESEARCH lines 547-553. Per Pitfall 5 (lines 614-619): use a per-test UUID suffix in `fixturePath` (`_analytics-pii-fixture-${randomUUID()}.ts`) to avoid the parallel-test-runner race condition — MPC-07's deterministic name works only because there's a single `it()` block. Recommended location: `src/__tests__/analytics-pii-leak.test.ts` (per Open Question #5 / Assumption A7 — mirrors MPC-07 actual location, not the literal `__tsc_fail/` from REQUIREMENTS line 53).

---

### `src/__tests__/analytics-pii-snapshot.test.ts` (NEW — runtime keys-whitelist)

**Closest analog:** `src/__tests__/exports.test.ts` (compile-time + runtime structural cross-check pattern, lines 48-82).

**Pattern:** Construct one literal of every variant. Walk `Object.keys(variant)`. Assert membership in `ALLOWED_EVENT_FIELDS`. Full reference implementation in RESEARCH.md Pattern 4 (lines 451-491).

**Imports** (mirror `src/__tests__/exports.test.ts:13-23`):
```typescript
import { describe, it, expect } from 'vitest';
import { ALLOWED_EVENT_FIELDS, type AnalyticsEvent } from '../server/analytics.js';
```

**Test body** (per RESEARCH lines 460-490 — already written; copy verbatim into the planner's task).

---

### `src/__tests__/analytics-lifecycle.test.ts` (NEW — supertest integration)

**Exact analog:** `src/__tests__/registration-auth.test.ts` (full structure: lines 1-211 mock harness, 213-end test bodies).

**Mock harness pattern to copy** (`src/__tests__/registration-auth.test.ts:18-67` — `makeMockDb()`):
```typescript
function makeMockDb(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    createUser: vi.fn().mockResolvedValue({
      id: 'user-1',
      codename: 'ALPHA-BRAVO-7',
      // ... full DatabaseAdapter shape ...
    }),
    // ... all 22 adapter methods stubbed ...
    ...overrides,
  };
}
```

**Mock-managers pattern** (`src/__tests__/registration-auth.test.ts:73-118`): copy the four `mockPasskeyManager`, `mockSessionManager`, `mockMpcManager` blocks verbatim.

**App factory pattern** (`src/__tests__/registration-auth.test.ts:154-167`):
```typescript
function createTestApp(overrides: Record<string, unknown> = {}) {
  const app = express();
  app.use(express.json());
  const router = createRouter({
    db: mockDb,
    sessionManager: mockSessionManager as any,
    passkeyManager: mockPasskeyManager as any,
    mpcManager: mockMpcManager as any,
    rateLimiting: { auth: { limit: 1000, windowMs: 60000 } }, // high limit for tests
    ...overrides,
  } as any);
  app.use(router);
  return app;
}
```

For analytics tests: extend `createTestApp` with an `onAuthEvent` spy (`vi.fn()`) passed via `hooks` and assert spy call args. Recovery + account-delete coverage uses the exact same shape — see `src/__tests__/recovery.test.ts` lines 254-541 for the wallet/IPFS/account-delete describe blocks.

---

### `src/__tests__/analytics-oauth.test.ts` (NEW — OAuth supertest integration)

**Closest analog:** `src/__tests__/oauth-cookie-guard.test.ts` (the only existing OAuth-router supertest harness in the suite).

**Pattern:** mirror the `createTestApp` shape from `registration-auth.test.ts` but use `createOAuthRouter` instead of `createRouter`. The 3 success branches in `oauth/router.ts:226-244, 248-280, 296-362` map to 3 separate `it()` blocks asserting `emit` was called with the correct `provider` and `type: 'oauth.callback.success'`.

---

### `src/__tests__/analytics-types.test.ts` (NEW — compile + runtime type re-export check)

**Exact analog:** `src/__tests__/exports.test.ts` lines 48-82.

**Pattern to copy** (`src/__tests__/exports.test.ts:48-82`):
```typescript
describe('MPC-01: type aliases are re-exported', () => {
  it('MPCAccountManagerConfig type is re-exported from /server', () => {
    // Compile-time check — if the type is not re-exported, tsc --noEmit
    // fails before this test runs.
    const cfg: MPCAccountManagerConfig = {
      networkId: 'testnet',
      treasuryAccount: 't.testnet',
      treasuryPrivateKey: 'ed25519:placeholder',
      derivationSalt: 'salt',
    };
    expect(cfg.derivationSalt).toBe('salt');
  });
  // ... more variants ...
});
```

For Phase 13: import `AnalyticsEvent` from `../server/index.js` (the public-API surface) and assign one literal of each variant. There are no `expectTypeOf` users in the existing test suite — this compile-via-assignment pattern IS the project convention. Per RESEARCH.md line 102: cover "discriminated-union type forbids PII keys via narrowing" by adding a `switch (event.type)` block with `never` exhaustiveness assertion at the default branch.

**Source-level export shape check** (`src/__tests__/exports.test.ts:84-89`) — also worth mirroring:
```typescript
it('src/server/index.ts contains a re-export of AnalyticsEvent', () => {
  const source = readFileSync(join(process.cwd(), 'src/server/index.ts'), 'utf-8');
  expect(source).toMatch(/AnalyticsEvent/);
});
```

---

### `src/__tests__/analytics-latency.test.ts` (NEW — latency assertion)

**No exact analog** — no existing latency tests in the suite. Pattern is synthesized from:
- supertest integration harness: `src/__tests__/registration-auth.test.ts`
- timing primitive: `performance.now()` (Node.js global, no import needed in vitest 4.x)

**Reference implementation** (RESEARCH.md lines 705-721, copy verbatim):
```typescript
it('a 5-second onAuthEvent hook does NOT delay the response in fire-and-forget mode', async () => {
  let hookResolved = false;
  const slowHook = async () => {
    await new Promise((r) => setTimeout(r, 5000));
    hookResolved = true;
  };

  const app = makeAppWithAuth({ hooks: { onAuthEvent: slowHook }, awaitAnalytics: false });

  const t0 = performance.now();
  const res = await request(app).post('/register/start').send({ /* ... */ });
  const elapsed = performance.now() - t0;

  expect(res.status).toBe(200);
  expect(elapsed).toBeLessThan(500);   // response time well under hook's 5s
  expect(hookResolved).toBe(false);    // hook still running in background
});
```

Three describe blocks needed (per RESEARCH lines 104-107):
1. Fire-and-forget latency (< 500ms)
2. Error swallow (throwing hook → 200 OK + WARN log via captured pino stream — pattern from `src/__tests__/logging.test.ts:31-40`)
3. Await mode latency (`awaitAnalytics: true` → ~5s elapsed)

Pino-stream-capture pattern to copy (`src/__tests__/logging.test.ts:31-40`):
```typescript
it('injectable logger receives log calls', () => {
  const entries: any[] = [];
  const stream = { write: (msg: string) => entries.push(JSON.parse(msg)) };
  const logger = pino({ level: 'info' }, stream as any);
  const child = logger.child({ module: 'test' });
  child.info({ action: 'test' }, 'hello');
  expect(entries.length).toBe(1);
  expect(entries[0].module).toBe('test');
  expect(entries[0].msg).toBe('hello');
});
```

---

## Shared Patterns

### Logger init (consumer-injectable, silent default, child module name)

**Source:** `src/server/mpc.ts:404-414`, mirrored identically in `src/server/router.ts:56`, `src/server/oauth/router.ts:47`, `src/server/passkey.ts:22`, and every other manager.

**Apply to:** `src/server/analytics.ts` (`wrapAnalytics` envelope).

**Universal excerpt (no redaction needed for analytics):**
```typescript
const log = (config.logger ?? pino({ level: 'silent' })).child({ module: 'analytics' });
```

### Hook closure captured ONCE at factory start

**Source:** `src/server/router.ts:55-65`, `src/server/oauth/router.ts:46-56` (existing logger init pattern — ANY config-derived helper is computed at factory entry, NEVER per-request).

**Apply to:** `src/server/router.ts` and `src/server/oauth/router.ts` `emit` closures.

**Excerpt (pattern):**
```typescript
export function createRouter(config: RouterConfig): Router {
  const log = (config.logger ?? pino({ level: 'silent' })).child({ module: 'router' });
  const router = Router();
  // ... destructure config ...

  // NEW Phase 13: closures captured at factory entry
  const rpId = config.rpId ?? 'localhost';
  const emit = wrapAnalytics(config.hooks?.onAuthEvent, {
    logger: config.logger,
    await: config.awaitAnalytics === true,
  });

  // ... route registrations use the captured `emit` ...
}
```

Per RESEARCH Pitfall 2 (lines 593-598): acceptance criterion is `grep -c "wrapAnalytics(" src/server/router.ts` returns 1 and `grep -c "wrapAnalytics(" src/server/oauth/router.ts` returns 1.

### Phase-11 hook threading mirror (factory→router config wiring)

**Source:** `src/server/index.ts:210, 230` (Phase 11 HOOK-01 — `hooks: config.hooks` on BOTH `createOAuthRouter` and `createRouter` calls).

**Apply to:** `src/server/index.ts` Phase 13 additions — `awaitAnalytics: config.awaitAnalytics` and `rpId: rpConfig.id` MUST appear on both factory call sites in lockstep. Per RESEARCH Pitfall 3 (lines 600-605): `grep -c "awaitAnalytics" src/server/index.ts` ≥ 2.

**Existing pattern:**
```typescript
// src/server/index.ts:199-211 (OAuth factory call)
oauthRouter = createOAuthRouter({
  // ... existing fields ...
  hooks: config.hooks,                        // Phase 11 HOOK-01
});

// src/server/index.ts:219-231 (passkey factory call)
const router = createRouter({
  // ... existing fields ...
  hooks: config.hooks,                          // Phase 11 HOOK-01
});
```

### Try/catch error-swallow with WARN log (non-blocking side effect)

**Source:** `src/server/oauth/router.ts:332-336` (recovery email send — fails-but-doesn't-fail-registration).

**Apply to:** `src/server/analytics.ts` `wrapAnalytics` envelope.

**Excerpt:**
```typescript
} catch (emailErr) {
  // Email failure should not fail the registration
  log.warn({ err: emailErr }, 'Recovery email send failed — user registered but password not emailed');
}
```

For analytics: replace `err: emailErr` with `err: redactErrorMessage(err)` (per RESEARCH Pattern 2 lines 396-402 — strips `Error.message` to prevent PII leak via thrown error strings).

### Mocked-DB + supertest integration test harness

**Source:** `src/__tests__/registration-auth.test.ts:18-211` (canonical) + `src/__tests__/recovery.test.ts:21-253` (recovery extension).

**Apply to:** All four new integration test files (`analytics-lifecycle.test.ts`, `analytics-oauth.test.ts`, `analytics-latency.test.ts`, and the integration parts of `analytics-pii-snapshot.test.ts` if needed).

**Key reusable pieces:**
- `makeMockDb(overrides)` factory (lines 18-67)
- `mockPasskeyManager`, `mockSessionManager`, `mockMpcManager` constants (lines 73-118)
- `validRegistrationResponse` / `validAuthenticationResponse` literals (lines 124-146)
- `createTestApp(overrides)` factory (lines 154-167)
- `beforeEach` re-setup of mock return values (lines 173-211)

### tsc-fail child-process fixture

**Source:** `src/__tests__/mpc-treasury-leak.test.ts:197-242` (only fixture of its kind in the project — RESEARCH explicitly cites as the canonical pattern).

**Apply to:** `src/__tests__/analytics-pii-leak.test.ts`.

Already excerpted above under that file's section. Key adaptation for Phase 13: per-test UUID fixture path (Pitfall 5).

---

## No Analog Found

| File | Reason | Mitigation |
|------|--------|------------|
| (none) | All 11 files have at least a role-match analog in the codebase. | n/a |

---

## Metadata

**Analog search scope:**
- `src/server/**/*.ts` (router, oauth/router, mpc, session, passkey, types, recovery)
- `src/__tests__/**/*.test.ts` (registration-auth, recovery, mpc-treasury-leak, exports, hooks-scaffolding, oauth-cookie-guard, logging)
- `src/types/index.ts`
- `src/index.ts` (root barrel)
- `tsup.config.ts` (externals verification)

**Files scanned:** 14 source files + 7 test files + 2 config files = 23 files.

**Pattern extraction date:** 2026-04-29.

**Verified line ranges (no re-reads, all ranges non-overlapping):**
- `src/server/router.ts` lines 1-90, 120-390, 440-720, 720-735 — all 11 emit points found at the lines RESEARCH.md predicted.
- `src/server/oauth/router.ts` lines 1-100, 100-200, 200-370 — all 3 success branches verified at lines 226-244, 248-280, 296-362.
- `src/server/index.ts` lines 85-205, 200-280 — factory wiring verified at lines 199-211 (OAuth) and 219-231 (passkey).
- `src/types/index.ts` lines 52-251 — `AnonAuthHooks` (lines 52-59), `AnonAuthConfig` (lines 93-196), `RelatedOrigin` (lines 80-87) all verified.
- `src/server/mpc.ts` lines 390-414 — logger init pattern verified.
- `src/__tests__/mpc-treasury-leak.test.ts` lines 1-30, 180-243 — MPC-07 fixture pattern verified.
- `src/__tests__/registration-auth.test.ts` lines 1-250 — supertest harness verified.
- `src/__tests__/exports.test.ts` lines 1-90 — compile+runtime cross-check pattern verified.
- `src/__tests__/hooks-scaffolding.test.ts` lines 1-137 — Phase 11 hooks plumbing test verified.
- `src/__tests__/logging.test.ts` lines 1-80 — pino-stream-capture pattern verified.
- `src/__tests__/recovery.test.ts` lines 1-50 + describe titles 254-541 — recovery integration coverage verified.
- `src/index.ts` lines 1-72 — root re-export surface verified.
- `tsup.config.ts` lines 11, 16 — `pino` externalized confirmed.
