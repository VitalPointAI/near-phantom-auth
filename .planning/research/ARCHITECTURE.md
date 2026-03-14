# Architecture: Security Hardening Integration Patterns

**Project:** near-phantom-auth (hardening milestone)
**Researched:** 2026-03-14
**Scope:** How rate limiting, input validation, CSRF protection, transaction integrity, and structured logging each integrate with the existing factory pattern and Express router architecture.

---

## Structural Context: This is a Library, Not a Server

The single most important architectural constraint for every hardening decision:
`@vitalpoint/near-phantom-auth` is a published npm library. Consuming applications do `app.use('/auth', auth.router)`. The library **cannot** install global Express middleware without the consumer's knowledge and consent, and it **cannot** assume what other middleware the consumer has configured.

Every hardening concern must be either:
1. Self-contained within the routers the library controls (`createRouter`, `createOAuthRouter`), or
2. Exposed as opt-in middleware/config via `AnonAuthConfig` and `AnonAuthInstance`.

This rules out approaches like "install rate limiting at the Express app level" — the library only owns its own sub-routers.

---

## Existing Architecture: Where Things Live

```
createAnonAuth(config)               ← Factory entry point (src/server/index.ts)
  ├── createPostgresAdapter()        ← Database layer (pure data)
  ├── createSessionManager()         ← Session domain logic
  ├── createPasskeyManager()         ← WebAuthn domain logic
  ├── createMPCManager()             ← NEAR domain logic
  ├── createWalletRecoveryManager()  ← Recovery domain logic
  ├── createIPFSRecoveryManager()    ← Recovery domain logic
  ├── createOAuthManager()           ← OAuth domain logic
  ├── createAuthMiddleware()  → middleware   ← Exported to consumers
  ├── createRequireAuth()     → requireAuth  ← Exported to consumers
  ├── createRouter()          → router       ← Exported to consumers
  └── createOAuthRouter()     → oauthRouter  ← Exported to consumers
```

**Route handlers** live in `createRouter()` and `createOAuthRouter()`. These are the two routers the library registers all its own routes on. Hardening middleware inserted into these routers is invisible to consumers and does not break the public API.

**The public API surface is:**
- `createAnonAuth(config: AnonAuthConfig): AnonAuthInstance` — the factory
- `anonAuth.router`, `anonAuth.oauthRouter` — Express routers (consumed via `app.use`)
- `anonAuth.middleware`, `anonAuth.requireAuth` — middleware handlers
- `anonAuth.db`, `anonAuth.sessionManager`, etc. — manager instances for advanced use

---

## Hardening Concern 1: Rate Limiting

### Where it fits

Rate limiting is HTTP-layer middleware. In Express, `express-rate-limit` creates `RequestHandler` functions that can be applied to a router or specific routes with `router.use()` or inline as `router.post('/login/start', limiter, handler)`.

**Correct placement: inside `createRouter()` and `createOAuthRouter()`, applied before route handlers.**

The library owns both routers completely. Adding `router.use(createRateLimiter(...))` at the top of `createRouter()` (after `router.use(json())`) is fully contained.

### Granularity: global router vs per-route

A blanket per-router rate limit is insufficient. Recovery endpoints need much stricter limits than session checks. The architecture calls for per-route or per-group limits:

```
Strict (5 req/15 min per IP):  /register/start, /login/start, /recovery/**
Normal (20 req/15 min per IP): /register/finish, /login/finish
Relaxed (60 req/min per IP):   /session (GET, read-only)
OAuth-specific (10 req/15 min): /:provider/start, /:provider/callback
```

### Integration pattern: factory receives limiter config

`AnonAuthConfig` gains an optional `rateLimiting` key. `createRouter()` and `createOAuthRouter()` receive the config and construct their own limiters internally. This keeps `express-rate-limit` as a direct dependency of the library (not a peer dep) and consumers do not need to know about it.

```typescript
// AnonAuthConfig addition (src/types/index.ts)
rateLimiting?: {
  enabled?: boolean;            // default: true
  windowMs?: number;            // default: 15 * 60 * 1000
  maxRegistration?: number;     // default: 5
  maxLogin?: number;            // default: 20
  maxRecovery?: number;         // default: 5
  keyGenerator?: (req: Request) => string;  // default: req.ip
};
```

### Cross-cutting vs localized

Rate limiting is **cross-cutting across both routers** but **localized within the HTTP layer**. It does not touch domain logic (managers), the database layer, or the session layer. Zero changes to `SessionManager`, `PasskeyManager`, or any domain module.

### API compatibility

No breaking change. The `router` and `oauthRouter` interfaces on `AnonAuthInstance` are unchanged — they remain `Router` objects. Rate limiters are internal to the router construction. Existing consumers who do `app.use('/auth', auth.router)` get rate limiting automatically.

---

## Hardening Concern 2: Input Validation (zod)

### Where it fits

Input validation belongs in route handlers, before any manager method is called. It is **not** a middleware — it is logic inside each route handler that runs `schema.parse(req.body)` and returns 400 on failure.

**Current state:** Route handlers do ad-hoc presence checks:
```typescript
if (!challengeId || !response || !tempUserId || !codename) {
  return res.status(400).json({ error: 'Missing required fields' });
}
```

This only checks for truthiness, not shape, type, or length constraints.

### Integration pattern: schema-per-route, inline in handler

Each route handler gets a corresponding zod schema at the top of the file. The parse replaces the manual checks:

```typescript
// At top of router.ts
import { z } from 'zod';

const RegisterFinishSchema = z.object({
  challengeId: z.string().uuid(),
  response: z.object({ ... }),  // WebAuthn RegistrationResponseJSON shape
  tempUserId: z.string().uuid(),
  codename: z.string().min(1).max(100),
});

// Inside handler:
const parsed = RegisterFinishSchema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
}
const { challengeId, response, tempUserId, codename } = parsed.data;
```

**Alternatively** (slightly cleaner for many routes): a shared validation middleware factory:

```typescript
function validate<T>(schema: z.ZodSchema<T>): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request', details: result.error.flatten() });
    }
    req.body = result.data;  // Replace with parsed/coerced data
    next();
  };
}

router.post('/register/finish', validate(RegisterFinishSchema), async (req, res) => { ... });
```

The middleware factory approach is cleaner for `router.ts` and `oauth/router.ts` because routes are well-defined. It also strips unknown fields automatically (zod's `.strict()` mode) which is a security property worth having.

### Schemas needed (full route inventory)

**src/server/router.ts:**
- `POST /register/start` — no body (codename style from config, not request)
- `POST /register/finish` — `{ challengeId: uuid, response: WebAuthn shape, tempUserId: uuid, codename: string }`
- `POST /login/start` — `{ codename?: string }`
- `POST /login/finish` — `{ challengeId: uuid, response: WebAuthn shape }`
- `POST /logout` — no body
- `GET /session` — no body
- `POST /recovery/wallet/link` — no body (requires session)
- `POST /recovery/wallet/verify` — `{ signature: string, challenge: string, walletAccountId: string }`
- `POST /recovery/wallet/start` — no body
- `POST /recovery/wallet/finish` — `{ signature: string, challenge: string, nearAccountId: string }`
- `POST /recovery/ipfs/setup` — `{ password: string }`
- `POST /recovery/ipfs/recover` — `{ cid: string, password: string }`

**src/server/oauth/router.ts:**
- `GET /providers` — no body
- `GET /:provider/start` — param validation (`google|github|twitter`)
- `POST /:provider/callback` — `{ code: string, state: string }`
- `POST /:provider/link` — `{ code: string, state?: string, codeVerifier?: string }`

### Cross-cutting vs localized

Input validation is **localized to the HTTP layer** (route handlers). It does not touch managers, the database, or session management. The schemas live alongside their routes in `router.ts` and `oauth/router.ts`. No changes to `src/types/index.ts` interface or any manager.

### API compatibility

No breaking change. The validation only affects what reaches the handler logic — consumers calling valid requests see no difference. Error response format changes (more structured 400 bodies) are backward compatible since error responses were never part of the documented API contract.

---

## Hardening Concern 3: CSRF Protection

### The actual threat model for this library

The library defaults to `SameSite=strict` session cookies. `SameSite=strict` is a strong CSRF defense on its own for the default configuration. However:

1. `sameSite` is configurable in `SessionConfig` — a consumer could set `'lax'` or `'none'`
2. The library should not rely solely on consumer not misconfiguring this
3. The OAuth callback uses `SameSite=lax` (required for OAuth redirect flows)

### Where CSRF tokens fit

CSRF token verification is a middleware concern. The pattern for a library is:

1. **For state-changing routes on `router` (passkey):** The routes use `SameSite=strict` cookies. Add a `csrfProtection` opt-in to `AnonAuthConfig` that, when enabled, verifies a `X-CSRF-Token` header on all mutating routes. The library generates the CSRF token at session creation time and stores it in a separate non-HttpOnly cookie (readable by JS) or in the session payload.

2. **For OAuth callback:** The existing state parameter in the OAuth flow already provides CSRF protection for the OAuth redirect. The `oauth_state` cookie + state comparison in the callback is the correct CSRF defense for that flow. No additional token needed there.

### Implementation pattern: router-level middleware with header check

```typescript
// In createRouter(), if CSRF enabled:
const csrfMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
router.use((req, res, next) => {
  if (!csrfMethods.has(req.method)) return next();
  const token = req.headers['x-csrf-token'];
  const expected = getCsrfTokenForSession(req, config.secret);
  if (!token || !timingSafeEqual(Buffer.from(token as string), Buffer.from(expected))) {
    return res.status(403).json({ error: 'CSRF validation failed' });
  }
  next();
});
```

The CSRF token generation derives from the session cookie value + a server secret (double-submit cookie pattern without a separate cookie). This requires no database storage.

**Alternatively:** Use the simpler double-submit cookie pattern — the library sets a readable `csrf_token` cookie alongside the session, and verifies `req.headers['x-csrf-token'] === req.cookies.csrf_token`. This requires `cookie-parser` to be installed, but the OAuth router already depends on it.

**Recommended approach:** Double-submit cookie with HMAC. Token = `HMAC(sessionId, secret)`. Client reads the `csrf_token` cookie (not HttpOnly) and echoes it as `X-CSRF-Token` header. Server recomputes and compares with `timingSafeEqual`.

### CSRF is opt-in for API-only consumers

Many consumers of this library use it as a pure API backend with clients that handle CSRF themselves (e.g., SPA with their own CSRF framework). CSRF protection should be opt-in via `AnonAuthConfig.csrf.enabled`.

```typescript
csrf?: {
  enabled?: boolean;            // default: false (opt-in, breaking to existing)
  cookieName?: string;          // default: 'csrf_token'
  headerName?: string;          // default: 'x-csrf-token'
};
```

### Cross-cutting vs localized

CSRF is **cross-cutting across both routers** and the session layer (token derivation). The middleware goes into the router. Session token generation adds one step to `createSession()`. **The session manager interface does not change** — CSRF token generation can be a separate utility function that operates on session IDs.

---

## Hardening Concern 4: Transaction Integrity (Registration Flow)

### The problem

`POST /register/finish` in `src/server/router.ts` (lines 96-155) performs four sequential writes:
1. `passkeyManager.finishRegistration()` — writes a challenge deletion
2. `mpcManager.createAccount()` — creates a NEAR MPC account (external, irreversible)
3. `db.createUser()` — inserts user row
4. `db.createPasskey()` — inserts passkey row
5. `sessionManager.createSession()` — inserts session row

If step 4 fails after step 3, the database contains a user record with no associated passkey. The user cannot authenticate and cannot re-register (codename is taken). If step 3 fails after step 2, a NEAR MPC account was created but is not referenced in any database record (orphaned on-chain account).

### The partial transaction boundary

The NEAR MPC account creation (step 2) is an external, non-transactional call. It **cannot** be included in a database transaction. This creates an irreducible partial-atomicity boundary:

```
[NEAR MPC account creation]  ← External, cannot roll back
        ↓
[DB transaction: createUser + createPasskey + createSession]
```

The database transaction can be wrapped but the NEAR call cannot. If the DB transaction fails after the NEAR call, the MPC account is orphaned. This is an acceptable risk given NEAR accounts are cheap and low-stakes (no funded accounts for testnet, minimal funding for mainnet).

### Integration pattern: PostgreSQL transaction wrapper

The `DatabaseAdapter` interface needs a `transaction()` method or the PostgreSQL adapter needs to expose a transaction-capable variant for multi-step flows.

**Option A: Add `transaction()` to `DatabaseAdapter` interface**
```typescript
// DatabaseAdapter addition
transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;
```
This is the clean approach but adds to the interface contract that custom adapters must implement.

**Option B: Router accepts a `transactionFn` from config (PostgreSQL-specific)**
The PostgreSQL adapter wraps the three write steps in `BEGIN/COMMIT/ROLLBACK` internally through a specialized method like `createUserWithPasskey(input)`.

**Option C: Restructure the registration handler to retry cleanly on partial failure**
On any error after `createUser`, attempt to delete the partially-created user. This is not true atomicity but reduces the orphan window.

**Recommended: Option A** — add `transaction()` to `DatabaseAdapter`. This is a clean extension that custom adapters can implement however they want. The existing PostgreSQL adapter already has `BEGIN/COMMIT/ROLLBACK` usage in `createOAuthUser()` (around line 386-440), so the pattern already exists.

```typescript
// Registration handler after change:
const mpcAccount = await mpcManager.createAccount(tempUserId);  // External, before tx

await db.transaction(async (tx) => {
  const user = await tx.createUser({ ... });
  await tx.createPasskey({ ... });
  await sessionManager.createSession(user.id, res, { ... });
  // Note: session.createSession writes a cookie but the DB session write goes into tx
});
```

### Cross-cutting vs localized

Transaction wrapping is **localized to the registration route handler** in `router.ts` and requires an **interface change to `DatabaseAdapter`**. It does not affect the `PasskeyManager`, `MPCAccountManager`, or session cookie logic. The database adapter interface change is additive — existing custom adapters that don't implement `transaction()` can throw `new Error('transaction() not supported')` or the type can mark it optional initially.

---

## Hardening Concern 5: Structured Logging (pino)

### The current state

Every module uses `console.error('[ComponentTag] message', error)` and `console.log('[ComponentTag] message')`. There are ~40 console statements across server code. Many log sensitive data: treasury public keys, account IDs, derivation paths, transaction hashes.

### Why a library must not force a logger on consumers

Calling `pino()` directly inside the library and logging to stdout would interfere with consumer logging setup. The correct pattern for a library is **dependency injection** — accept a logger interface, default to a silent or minimal logger.

### Integration pattern: injectable logger with default no-op

```typescript
// In AnonAuthConfig (src/types/index.ts)
logger?: {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, err?: Error | unknown, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
};
```

The default is a no-op logger (no output). Consumers who want pino can pass one:
```typescript
import pino from 'pino';
const auth = createAnonAuth({
  ...config,
  logger: pino({ level: 'info', redact: ['nearAccountId', 'derivationPath'] }),
});
```

Inside the library, all `console.error` and `console.log` calls are replaced with calls to the injected logger instance. The logger instance is passed into each manager factory and each router factory as part of the config/context.

### Logger propagation through the factory

`createAnonAuth()` creates the logger (or no-op default), then passes it to:
- `createRouter(config)` — added to `RouterConfig`
- `createOAuthRouter(config)` — added to `OAuthRouterConfig`
- `createSessionManager(db, config)` — added to `SessionConfig`
- Each manager factory that currently logs

This is a **pervasive but mechanical change** — find-and-replace `console.error/log` with `logger.error/info`, no logic changes required.

### Sensitive data redaction

The logger interface should define a `redact` option understood by pino. Critical fields to redact in production:
- `derivationPath` — links anonymous identity to NEAR account
- `mpcPublicKey` — unnecessary to log
- `treasuryPrivateKey` — must never be logged (not currently logged, but guard against future accidents)
- `nearAccountId` — acceptable at debug level, not in production info/warn logs
- `tempUserId` — transmitted to client during registration, but no need to log

Redaction is a pino configuration concern, not a library concern. The library's logger interface is log-level-aware but field-redaction is left to the consumer's pino config.

### Cross-cutting vs localized

Logging is **fully cross-cutting** — it touches every module. However, the changes are mechanical: no logic changes, only substituting `console.*` calls with `logger.*` calls. The logger instance flows through config injection. No module gets a new dependency on a logging framework; each module only depends on the abstract logger interface.

---

## Hardening Concern 6: Timing-Safe Session Verification

### Where it fits

A single line change in `src/server/session.ts`, `verifySessionId()`:

```typescript
// Current (unsafe):
if (signature !== expectedSignature) return null;

// Fixed:
const sigBuf = Buffer.from(signature);
const expBuf = Buffer.from(expectedSignature);
if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
```

This is **localized to session.ts** and has zero architectural implications.

---

## Hardening Concern 7: Server-Side Secret Salt for Account Derivation

### Where it fits

`src/server/mpc.ts` derives accounts as `sha256("implicit-${userId}")`. The `tempUserId` is sent to the client in the registration start response, making the derivation predictable.

Fix: `sha256("implicit-${userId}-${config.derivationSalt}")` where `derivationSalt` is a server-side secret from `AnonAuthConfig.mpc.derivationSalt`.

This is **localized to `mpc.ts`** and requires one addition to `MPCAccountConfig`. New deployments must set this config value; existing deployments should not rotate it (doing so would invalidate all existing MPC account associations).

---

## Implementation Order and Dependencies

The hardening tasks are ordered below by dependency and risk:

### Layer 1: Atomic, zero-dependency changes (do first)

These changes have no dependencies on other hardening work and can be done independently:

| Change | File | Scope |
|--------|------|-------|
| Timing-safe session comparison | `session.ts` | 1 line |
| Fix session refresh DB update | `session.ts` | Add `db.updateSessionExpiry()` |
| Server-side MPC derivation salt | `mpc.ts`, `types/index.ts` | Localized |
| Replace custom `base58Encode` | `mpc.ts` | Localized |
| Fix NEAR float precision | `mpc.ts` | Localized |
| Fix signed transaction public key | `mpc.ts` | Localized |

**Why first:** No new dependencies, smallest diffs, highest security-to-effort ratio. All localized to single files. Tests can be written immediately after.

### Layer 2: Input validation (builds on stable types, enables safer higher layers)

| Change | Files | Dependencies |
|--------|-------|--------------|
| Add zod dependency | `package.json` | none |
| Define schemas per route | `router.ts`, `oauth/router.ts` | zod |
| Replace manual checks with schema parse | `router.ts`, `oauth/router.ts` | schemas |

**Why second:** Establishes trusted data shapes before adding rate limiting (limiters may inspect request fields for key generation). Also makes subsequent handler changes safer since inputs are guaranteed structured.

### Layer 3: Structured logging (pervasive but mechanical)

| Change | Files | Dependencies |
|--------|-------|--------------|
| Add logger interface to types | `types/index.ts` | none |
| Thread logger through all factories | `server/index.ts`, all managers | interface |
| Replace console.* calls | all server modules | logger instance |

**Why third:** Logging changes are mechanical and large in diff size but low in logic risk. Doing it after Layer 1 means the corrected logic is already in place, so logging shows correct behavior. Doing it before rate limiting and CSRF means those new features can use the logger from the start.

### Layer 4: Rate limiting (depends on routing structure being stable)

| Change | Files | Dependencies |
|--------|-------|--------------|
| Add express-rate-limit dependency | `package.json` | none |
| Add `rateLimiting` to `AnonAuthConfig` | `types/index.ts` | none |
| Create limiter instances in `createRouter` | `router.ts` | config |
| Create limiter instances in `createOAuthRouter` | `oauth/router.ts` | config |

**Why fourth:** Depends on route structure, which should be stable after Layer 1-3 changes. Rate limiting is also easier to test once logging is in place (can see limiter activity in test logs).

### Layer 5: Transaction integrity (requires database interface change)

| Change | Files | Dependencies |
|--------|-------|--------------|
| Add `transaction()` to DatabaseAdapter | `types/index.ts` | none |
| Implement `transaction()` in PostgreSQL adapter | `db/adapters/postgres.ts` | interface |
| Wrap registration finish handler | `router.ts` | transaction API |

**Why fifth:** Interface changes have downstream implications. Custom adapter users need to implement `transaction()`. This is the highest-impact interface change in the hardening pass and should be done after other route handler changes are stable.

### Layer 6: CSRF (depends on session + routing being stable)

| Change | Files | Dependencies |
|--------|-------|--------------|
| Add `csrf` to `AnonAuthConfig` | `types/index.ts` | none |
| Add CSRF token generation to session creation | `session.ts` | config |
| Add CSRF verification middleware to routers | `router.ts` | session + config |

**Why last:** Most complex hardening task (involves session, routing, and client-side changes). Also the most likely to require iteration if consumer patterns vary. Client (`useAnonAuth` hook) also needs updating to send the CSRF header, which crosses the client/server boundary.

---

## Component Boundary Map: Before and After

### Current: Cross-cutting concerns scattered

```
HTTP Layer (router.ts)
  ├── Ad-hoc presence checks (validation)
  ├── console.error calls (logging)
  └── No rate limiting, no CSRF, no transactions

Session Layer (session.ts)
  ├── console.error calls (logging)
  └── String equality signature comparison (timing-unsafe)

Manager Layer (mpc.ts, passkey.ts, etc.)
  └── console.error/log calls (logging)
```

### After: Concerns properly layered

```
HTTP Layer (router.ts, oauth/router.ts)
  ├── express-rate-limit middleware [NEW - rate limiting]
  ├── CSRF verification middleware [NEW - CSRF]
  ├── validate() middleware (zod) [NEW - input validation]
  ├── db.transaction() wrapping [NEW - transaction integrity]
  └── logger.info/error calls [NEW - structured logging]

Session Layer (session.ts)
  ├── timingSafeEqual comparison [FIXED]
  ├── db.updateSessionExpiry() call [FIXED]
  └── logger.error calls [UPDATED]

Manager Layer (mpc.ts, passkey.ts, etc.)
  ├── Derivation salt in account creation [FIXED - mpc.ts]
  └── logger.info/error calls [UPDATED]

Types Layer (types/index.ts)
  ├── AnonAuthConfig.rateLimiting [NEW]
  ├── AnonAuthConfig.csrf [NEW]
  ├── AnonAuthConfig.logger [NEW]
  ├── MPCAccountConfig.derivationSalt [NEW]
  └── DatabaseAdapter.transaction() [NEW]
```

---

## Data Flow: Where Each Hardening Layer Intercepts

```
Incoming Request
      │
      ▼
[Rate Limiter Middleware]          ← Layer 4, pre-handler, drops 429
      │
      ▼
[CSRF Verification Middleware]     ← Layer 6, pre-handler, drops 403
      │
      ▼
[JSON body-parser]                 ← existing, req.body populated
      │
      ▼
[validate() Middleware (zod)]      ← Layer 2, pre-handler, drops 400
      │
      ▼
[Route Handler]
  ├── [logger.info]                ← Layer 3, throughout handler
  ├── [sessionManager calls]       ← Layer 1 (timing-safe, refresh fixed)
  ├── [db.transaction()]           ← Layer 5, for registration/finish only
  │     ├── db.createUser()
  │     └── db.createPasskey()
  └── [mpcManager calls]           ← Layer 1 (derivation salt added)
      │
      ▼
Response
```

---

## Backward Compatibility Analysis

| Change | Breaking? | Notes |
|--------|-----------|-------|
| Rate limiting added | No | New behavior, existing requests still work unless rate exceeded |
| Zod validation | No | Valid requests are unchanged; error messages for invalid requests become more structured |
| CSRF (opt-in default false) | No | Must be explicitly enabled, off by default |
| `AnonAuthConfig` new optional fields | No | All new config fields are optional |
| `DatabaseAdapter.transaction()` | Potentially | Custom adapters must implement it or mark it optional with a default implementation |
| Logger injection | No | Default is no-op, no console output change without consumer action |
| Timing-safe comparison | No | Internal fix, same external behavior |
| Session DB refresh fix | No | Bug fix, not a behavior regression |
| MPC derivation salt | No for new deploys | Existing deploys must NOT set this (would invalidate existing account associations); document clearly |

The only genuinely risky change is `DatabaseAdapter.transaction()`. Mitigation: make it optional in the interface with a default no-op that falls back to sequential operations, upgrading to atomic transaction only when implemented.

---

## Sources

- Direct codebase analysis: `src/server/router.ts`, `src/server/oauth/router.ts`, `src/server/session.ts`, `src/server/index.ts`, `src/server/middleware.ts`, `src/types/index.ts`
- `.planning/codebase/CONCERNS.md` — security audit findings
- `.planning/codebase/ARCHITECTURE.md` — existing architecture analysis
- Confidence: HIGH — all findings are grounded in the actual codebase. Pattern recommendations (injectable logger, per-route validators, double-submit CSRF) are well-established Express library patterns.

*Research date: 2026-03-14*
