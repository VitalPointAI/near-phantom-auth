# Phase 4: HTTP Defenses - Research

**Researched:** 2026-03-14
**Domain:** Express middleware — rate limiting, CSRF protection, cookie-parser dependency
**Confidence:** HIGH

## Summary

Phase 4 adds two independent HTTP-layer defenses to the Express router: rate limiting (SEC-02) and optional CSRF verification (SEC-03), plus an explicit dependency check for cookie-parser in the OAuth callback (INFRA-05).

Rate limiting uses `express-rate-limit` v8 (latest: 8.3.1). Two separate limiter instances are applied: one for standard auth endpoints and a stricter one for recovery endpoints. Both are configured per-IP using `req.ip` as the key, applied as route-specific middleware rather than global middleware.

CSRF uses `csrf-csrf` v4 (latest: 4.0.3), which implements the stateless Double Submit Cookie Pattern. CSRF protection is opt-in via `config.csrf` and defaults to disabled. The OAuth callback route (`/:provider/callback`) is structurally exempt because OAuth redirects are cross-origin and cannot carry a same-site CSRF cookie. The `skipCsrfProtection` callback handles this exemption cleanly.

INFRA-05 is a targeted check: the OAuth callback handler reads `req.cookies?.oauth_state` and `req.cookies?.oauth_code_verifier`, but `cookie-parser` is a consumer-provided peer dependency. If a consumer mounts the OAuth router without `cookie-parser`, `req.cookies` is `undefined` and state validation silently fails. The fix is a startup assertion (guard at `createOAuthRouter` time) that throws if `req.cookies` is not populated when expected.

**Primary recommendation:** Add `express-rate-limit` (two instances) and `csrf-csrf` (opt-in, OAuth-exempt) as new dependencies. Fix the `cookie-parser` gap with a startup-time guard inside `createOAuthRouter`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-02 | All auth and recovery endpoints have rate limiting (stricter limits on recovery) | `express-rate-limit` v8 applied per-route: standard limiter on `/register/*`, `/login/*`, `/logout`; strict limiter on `/recovery/*`. |
| SEC-03 | CSRF token verification for state-changing endpoints when sameSite is not strict | `csrf-csrf` v4 `doubleCsrfProtection` middleware applied to the router, with `skipCsrfProtection` exempting the OAuth callback. Enabled only when `config.csrf` is set. |
| INFRA-05 | Explicit cookie-parser dependency check in OAuth callback | Guard inside `createOAuthRouter` that detects whether `cookie-parser` has populated `req.cookies` and throws a clear startup error if not. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express-rate-limit | 8.3.1 | Per-IP rate limiting for Express routes | Official Express ecosystem package; built-in memory store; no external dependencies for in-process use |
| csrf-csrf | 4.0.3 | Stateless CSRF (Double Submit Cookie Pattern) | Replacement for deprecated `csurf`; HMAC-signed tokens; ESM-native; TypeScript-first |
| cookie-parser | 1.4.7 | Parse Cookie header into `req.cookies` | Required peer for `csrf-csrf`; already needed by OAuth callback; standard Express middleware |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/cookie-parser | 1.4.10 | TypeScript types for cookie-parser | Always — devDependency when adding cookie-parser |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| express-rate-limit | rate-limiter-flexible | `rate-limiter-flexible` is more powerful and Redis-ready, but adds complexity. `express-rate-limit` is simpler for in-process use (v2 requirement ESEC-01 defers Redis). |
| csrf-csrf | csrf-sync | `csrf-sync` uses the Synchronizer Token Pattern (stateful, server-side token store). The session here is stored in DB but the library is stateless. Double Submit Cookie is the correct choice for stateless CSRF. |
| cookie-parser | manual `req.headers.cookie` parsing | session.ts already does manual parsing for session cookies; but `csrf-csrf` requires `req.cookies` to be populated via `cookie-parser`. Cannot hand-roll this for csrf-csrf. |

**Installation:**
```bash
npm install express-rate-limit csrf-csrf cookie-parser
npm install --save-dev @types/cookie-parser
```

## Architecture Patterns

### Recommended Project Structure
```
src/server/
├── router.ts              # Apply standard rate limiter; conditionally apply doubleCsrfProtection
├── oauth/
│   └── router.ts          # Apply strict rate limiter on recovery routes; skipCsrfProtection for callback
├── middleware.ts           # No change needed (rate limiting is route-level, not middleware-level)
└── index.ts               # Extend AnonAuthConfig with optional csrf and rateLimiting config fields
src/types/
└── index.ts               # Add RateLimitConfig and CsrfConfig to AnonAuthConfig
```

### Pattern 1: Two-Limiter Strategy

**What:** Create two `rateLimit()` instances with distinct thresholds. Apply the standard limiter to auth routes; apply the strict limiter to recovery routes. Both use `req.ip` as key (default keyGenerator).

**When to use:** Whenever two groups of routes need different rate thresholds.

**Example:**
```typescript
// Source: express-rate-limit v8 docs — https://github.com/express-rate-limit/express-rate-limit
import { rateLimit } from 'express-rate-limit';

// Standard: login/register — generous window
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  limit: 20,                    // 20 attempts per window
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    log.warn({ limit: options.limit }, 'auth rate limit exceeded');
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
  },
});

// Strict: recovery — tighter window
const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hour
  limit: 5,                    // 5 attempts per window
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    log.warn({ limit: options.limit }, 'recovery rate limit exceeded');
    res.status(429).json({ error: 'Too many recovery attempts. Please try again later.' });
  },
});

// Apply per-route (before handler)
router.post('/login/start', authLimiter, async (req, res) => { ... });
router.post('/recovery/wallet/start', recoveryLimiter, async (req, res) => { ... });
```

### Pattern 2: Opt-In CSRF with OAuth Exemption

**What:** `doubleCsrfProtection` middleware applied to the router when `config.csrf` is set. `skipCsrfProtection` exempts the OAuth callback route, which arrives cross-origin from the provider.

**When to use:** When consumer sets `config.csrf.secret`. Default is disabled, so existing consumers observe no change.

**Example:**
```typescript
// Source: csrf-csrf v4 — https://github.com/Psifi-Solutions/csrf-csrf
import { doubleCsrf } from 'csrf-csrf';
import cookieParser from 'cookie-parser';

// In createRouter():
if (config.csrf) {
  const { doubleCsrfProtection } = doubleCsrf({
    getSecret: () => config.csrf!.secret,
    cookieName: '__Host-csrf',
    cookieOptions: {
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
      path: '/',
    },
    ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
    // Exempt OAuth callback — arrives cross-origin, no CSRF cookie possible
    skipCsrfProtection: (req) => {
      return /^\/oauth\/[^/]+\/callback$/.test(req.path);
    },
  });

  router.use(cookieParser());
  router.use(doubleCsrfProtection);
}
```

### Pattern 3: cookie-parser Startup Guard (INFRA-05)

**What:** The OAuth callback reads `req.cookies?.oauth_state` and `req.cookies?.oauth_code_verifier`. Without `cookie-parser`, `req.cookies` is `undefined` and state validation fails silently. Add a one-time check early in the OAuth callback that emits a clear error if `req.cookies` is `undefined`.

**When to use:** Inside `createOAuthRouter`, before any route registration or as the first thing in the callback handler.

**Example:**
```typescript
// In createOAuthRouter() — early guard on callback route
router.post('/:provider/callback', async (req: Request, res: Response) => {
  // INFRA-05: Detect missing cookie-parser middleware
  if (req.cookies === undefined) {
    log.error(
      'OAuth callback received request without req.cookies. ' +
      'Mount cookie-parser middleware before the OAuth router: app.use(cookieParser())'
    );
    return res.status(500).json({
      error: 'Server configuration error: cookie-parser middleware is required',
    });
  }
  // ... rest of handler
});
```

### Route Map — Which Limiter Applies Where

| Route | Method | Limiter | Rationale |
|-------|--------|---------|-----------|
| `/register/start` | POST | authLimiter | Standard auth |
| `/register/finish` | POST | authLimiter | Standard auth |
| `/login/start` | POST | authLimiter | Standard auth — primary brute-force target |
| `/login/finish` | POST | authLimiter | Standard auth |
| `/logout` | POST | authLimiter | Standard auth |
| `/recovery/wallet/link` | POST | recoveryLimiter | Recovery — stricter |
| `/recovery/wallet/verify` | POST | recoveryLimiter | Recovery — stricter |
| `/recovery/wallet/start` | POST | recoveryLimiter | Recovery — stricter |
| `/recovery/wallet/finish` | POST | recoveryLimiter | Recovery — stricter |
| `/recovery/ipfs/setup` | POST | recoveryLimiter | Recovery — stricter |
| `/recovery/ipfs/recover` | POST | recoveryLimiter | Recovery — stricter |
| `/oauth/:provider/start` | GET | authLimiter | Auth initiation |
| `/oauth/:provider/callback` | POST | authLimiter | Auth completion |
| `/oauth/:provider/link` | POST | authLimiter | Auth link |
| `/session` | GET | none | Read-only, no state change |

### Anti-Patterns to Avoid

- **Global `app.use(limiter)`:** Applies to all routes including health checks and static assets. Use per-route application instead.
- **Returning the cookie value from `getTokenFromRequest` in csrf-csrf:** This nullifies CSRF protection entirely — always read from request header or body, never from the cookie.
- **Applying `doubleCsrfProtection` before `cookieParser()`:** csrf-csrf requires `req.cookies` to be populated first.
- **Hardcoding rate limit thresholds as constants without config exposure:** Consumers deploying to high-traffic environments need to tune these. Expose via `RouterConfig`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Request counting per IP | Custom in-memory counter + setTimeout reset | express-rate-limit | Sliding vs fixed window subtlety, memory leak on high cardinality IPs, proper 429 header formatting, `Retry-After` header |
| CSRF token generation + validation | Custom HMAC cookie roundtrip | csrf-csrf | Cookie tossing attacks, token binding to session, constant-time comparison, cookie prefix security (`__Host-`) |
| Cookie parsing | Manual header split | cookie-parser | URL-encoded values, JSON cookies, signed cookie verification, edge cases in cookie string format |

**Key insight:** CSRF token handling has subtle security properties (HMAC binding, cookie prefix scoping) that a hand-rolled solution will likely get wrong in ways that are difficult to detect in testing.

## Common Pitfalls

### Pitfall 1: `req.ip` is `undefined` or `::ffff:127.0.0.1` Behind a Proxy

**What goes wrong:** `express-rate-limit` uses `req.ip` as the default key. If the Express app is behind a reverse proxy (nginx, AWS ALB) and `app.set('trust proxy', 1)` is not set, `req.ip` is the proxy's IP and all clients share one rate limit bucket.

**Why it happens:** Express does not trust the `X-Forwarded-For` header by default.

**How to avoid:** The library checks for this and emits a warning. Consumers mounting the library must set `app.set('trust proxy', N)` where N is the number of proxy hops. Document this requirement in the `RouterConfig` JSDoc.

**Warning signs:** All requests from different clients hit the rate limit simultaneously.

### Pitfall 2: CSRF Protection Breaks OAuth Callback

**What goes wrong:** The OAuth callback (`POST /:provider/callback`) is invoked by a redirect from the OAuth provider. The provider cannot set our CSRF cookie in that redirect, so `doubleCsrfProtection` will return 403 for every OAuth callback.

**Why it happens:** Double Submit Cookie Pattern requires both a cookie (set in the browser by our server) and a matching token in the request. Cross-origin redirects cannot carry the cookie set by a different origin.

**How to avoid:** Use `skipCsrfProtection` in the `doubleCsrf` options to exempt the OAuth callback route. This is safe because the OAuth flow uses `state` parameter validation (already implemented) as its CSRF defense.

**Warning signs:** OAuth logins return 403 after enabling CSRF protection.

### Pitfall 3: `cookie-parser` Applied Twice

**What goes wrong:** If the consumer already has `app.use(cookieParser())` globally, and `createRouter()` also calls `router.use(cookieParser())`, cookies are parsed twice. This is harmless but redundant and can cause confusion.

**Why it happens:** The library adds cookie-parser defensively, but doesn't know what the consumer has already mounted.

**How to avoid:** Only add `router.use(cookieParser())` inside the `if (config.csrf)` block — CSRF is the only feature that requires it. The session manager already does its own cookie parsing manually (see `parseCookies()` in session.ts).

### Pitfall 4: Rate Limit Thresholds Not Configurable

**What goes wrong:** Hardcoded limits (e.g., `limit: 20`) are wrong for some consumers — a low-traffic internal tool might want 5; a high-volume API might want 100.

**Why it happens:** Convenience defaults that are never overridable.

**How to avoid:** Expose `rateLimiting?: { auth?: { windowMs, limit }, recovery?: { windowMs, limit } }` in `RouterConfig`. Use sensible defaults that are secure (conservative) for first-time consumers.

### Pitfall 5: CSRF Secret Not Isolated

**What goes wrong:** Using `config.sessionSecret` as the CSRF secret. If either secret is compromised, both session and CSRF are broken.

**Why it happens:** Re-using existing config fields for convenience.

**How to avoid:** Require a separate `config.csrf.secret` string. The consumer generates it independently.

## Code Examples

Verified patterns from official sources:

### express-rate-limit v8 — TypeScript
```typescript
// Source: https://github.com/express-rate-limit/express-rate-limit (v8.3.1)
import { rateLimit } from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).json({ error: 'Too many requests' });
  },
});
```

### csrf-csrf v4 — TypeScript with ESM
```typescript
// Source: https://github.com/Psifi-Solutions/csrf-csrf (v4.0.3)
import { doubleCsrf } from 'csrf-csrf';
import cookieParser from 'cookie-parser';

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET!,
  cookieName: '__Host-csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: true,
    path: '/',
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req) => req.headers['x-csrf-token'] as string,
  skipCsrfProtection: (req) => false, // override per-use-case
});

// Register middleware
app.use(cookieParser());
app.use(doubleCsrfProtection);

// Expose token endpoint (GET — not CSRF-protected)
app.get('/csrf-token', (req, res) => {
  res.json({ token: generateToken(req, res) });
});
```

### AnonAuthConfig Extension — New Fields
```typescript
// Add to src/types/index.ts
export interface RateLimitConfig {
  auth?: {
    windowMs?: number;   // default: 15 * 60 * 1000 (15 min)
    limit?: number;      // default: 20
  };
  recovery?: {
    windowMs?: number;   // default: 60 * 60 * 1000 (1 hour)
    limit?: number;      // default: 5
  };
}

export interface CsrfConfig {
  /** Secret for HMAC token signing. Must not be the same as sessionSecret. */
  secret: string;
}

// In AnonAuthConfig:
export interface AnonAuthConfig {
  // ... existing fields
  /** Optional rate limiting configuration. Defaults applied if omitted. */
  rateLimiting?: RateLimitConfig;
  /** Optional CSRF protection. Disabled by default; set to enable. */
  csrf?: CsrfConfig;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `csurf` npm package | `csrf-csrf` (Double Submit Cookie) or `csrf-sync` (Sync Token) | csurf deprecated 2023 | csurf had a vulnerability with cookie tossing; csrf-csrf uses HMAC binding |
| `max` option in express-rate-limit | `limit` option | express-rate-limit v6/v7 | `max` still works but `limit` aligns with IETF draft terminology |
| `X-RateLimit-*` headers | Combined `RateLimit` header (draft-8) | express-rate-limit v7+ | `standardHeaders: 'draft-8'` gives single standardized header |

**Deprecated/outdated:**
- `csurf`: Deprecated, not maintained. Do not use.
- `legacyHeaders: true` in express-rate-limit: Sends `X-RateLimit-Limit` etc. Disable these; use `standardHeaders: 'draft-8'` instead.
- `onLimitReached` callback in express-rate-limit: Removed in v7. Use `handler` instead.

## Open Questions

1. **Trust proxy setting**
   - What we know: The library emits a warning if `req.ip` is not set correctly; but the library itself cannot call `app.set('trust proxy', 1)` — it doesn't have access to the Express app instance.
   - What's unclear: Whether to document this as a consumer responsibility in the JSDoc or add a startup-time check in `createRouter`.
   - Recommendation: Add a JSDoc warning on `RouterConfig` and log a `warn` if `req.ip` equals `::1` or `127.0.0.1` on the first rate-limited request, suggesting the consumer may need `trust proxy`.

2. **CSRF token endpoint**
   - What we know: csrf-csrf requires consumers to call `generateToken(req, res)` to mint a token and set the cookie. There must be a GET endpoint that returns this token for SPA clients.
   - What's unclear: Whether this library should expose a `/csrf-token` endpoint or leave it to the consumer.
   - Recommendation: Expose `GET /csrf-token` on the router when CSRF is enabled. This is the standard pattern. Keep it simple: `res.json({ token: generateToken(req, res) })`.

3. **INFRA-05 guard timing**
   - What we know: The guard must fire before state validation (`if (state !== storedState)`). Early `return 500` is appropriate.
   - What's unclear: Whether to throw at router creation time (passing a test request) or at runtime on first request.
   - Recommendation: Runtime check in the callback handler — it's simpler and avoids needing a mock request at construction time. Log at `error` level with a clear message pointing to `app.use(cookieParser())`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run src/__tests__/rate-limiting.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-02 | Login endpoint returns 429 after N+1 requests from same IP | unit | `npx vitest run src/__tests__/rate-limiting.test.ts` | Wave 0 |
| SEC-02 | Recovery limiter fires before auth limiter at equal request rate | unit | `npx vitest run src/__tests__/rate-limiting.test.ts` | Wave 0 |
| SEC-03 | State-changing request without CSRF token returns 403 when csrf enabled | unit | `npx vitest run src/__tests__/csrf.test.ts` | Wave 0 |
| SEC-03 | CSRF disabled by default — no behavior change for consumers without config.csrf | unit | `npx vitest run src/__tests__/csrf.test.ts` | Wave 0 |
| SEC-03 | OAuth callback exempt from CSRF check even when csrf enabled | unit | `npx vitest run src/__tests__/csrf.test.ts` | Wave 0 |
| INFRA-05 | OAuth callback logs error and returns 500 when req.cookies is undefined | unit | `npx vitest run src/__tests__/oauth-cookie-guard.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/__tests__/rate-limiting.test.ts src/__tests__/csrf.test.ts src/__tests__/oauth-cookie-guard.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/rate-limiting.test.ts` — covers SEC-02 (429 threshold, recovery stricter than auth)
- [ ] `src/__tests__/csrf.test.ts` — covers SEC-03 (403 without token, default disabled, OAuth exempt)
- [ ] `src/__tests__/oauth-cookie-guard.test.ts` — covers INFRA-05 (missing cookie-parser guard)

## Sources

### Primary (HIGH confidence)
- `express-rate-limit` GitHub (v8.3.1) — version, `windowMs`, `limit`, `keyGenerator`, `skip`, `handler`, `standardHeaders: 'draft-8'`, TypeScript support
- `csrf-csrf` npm/GitHub (v4.0.3) — `doubleCsrf` API, `getSecret`, `cookieName`, `cookieOptions`, `ignoredMethods`, `skipCsrfProtection`, `getTokenFromRequest`
- `cookie-parser` npm (v1.4.7) — `req.cookies` population, ordering requirement with `doubleCsrfProtection`
- Direct source code inspection: `src/server/session.ts` (manual cookie parsing), `src/server/oauth/router.ts` (req.cookies usage), `src/server/router.ts` (route structure), `src/types/index.ts` (AnonAuthConfig shape)

### Secondary (MEDIUM confidence)
- WebSearch: express-rate-limit v8 changelog confirming `limit` over `max`, `standardHeaders: 'draft-8'` — consistent with GitHub README
- WebSearch: csrf-csrf v4 Double Submit Cookie Pattern setup steps — consistent with GitHub README summary

### Tertiary (LOW confidence)
- Specific default threshold values (20 auth / 5 recovery) are project judgment calls, not sourced from a standard. They are conservative and configurable.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — both libraries verified at exact versions via npm registry; source code inspected
- Architecture: HIGH — route structure extracted from actual router.ts; cookie gap confirmed in actual source
- Pitfalls: HIGH for proxy/CSRF/cookie pitfalls (verified against library docs); MEDIUM for threshold pitfall (judgment-based)

**Research date:** 2026-03-14
**Valid until:** 2026-06-14 (express-rate-limit and csrf-csrf are stable; 90-day window is safe)
