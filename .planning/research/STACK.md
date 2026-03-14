# Technology Stack — Hardening Dependencies

**Project:** near-phantom-auth (hardening pass)
**Researched:** 2026-03-14
**Scope:** New dependencies required for security hardening, testing, and email delivery. Does not re-document the existing stack (see `.planning/codebase/STACK.md`).

---

## Hardening Additions — Recommended Stack

### Runtime Validation

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `zod` | `^3.23.x` | Schema-based runtime validation of all `req.body` inputs | TypeScript-native; schemas produce inferred types, eliminating the dual-maintenance problem of a separate TS interface + a runtime check. Smaller bundle than `joi`. No runtime deps. The project already names it in `PROJECT.md` constraints. MEDIUM confidence on exact version — verify with `npm view zod version` before pinning. |

**Confidence:** MEDIUM — version from training data (August 2025 cutoff). Zod 3.x is the stable series. Zod 4 was in development pre-cutoff but not stable; do not use `^4.x` without explicit verification.

**NOT zod 4.x:** Pre-release as of knowledge cutoff. Breaking API changes; wait for stable release.
**NOT joi:** Heavier, no native TypeScript inference, does not emit TS types from schema.
**NOT yup:** Less popular in the Node/Express server-side space; fewer ecosystem integrations.

**Usage pattern — validate at route entry, type flows down:**
```typescript
import { z } from 'zod';

const RegisterStartSchema = z.object({
  username: z.string().min(1).max(64),
});

// In route handler:
const result = RegisterStartSchema.safeParse(req.body);
if (!result.success) {
  return res.status(400).json({ error: 'Invalid input', issues: result.error.issues });
}
const { username } = result.data; // fully typed
```

---

### Rate Limiting

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `express-rate-limit` | `^7.x` | Per-IP rate limiting on auth and recovery endpoints | The de-facto standard for Express rate limiting. Zero non-Express runtime deps. Configurable store (in-memory default; swap to Redis store for multi-instance). Project constraints name it explicitly. MEDIUM confidence on version. |

**Confidence:** MEDIUM — version from training data. `express-rate-limit` v7 is the current major as of mid-2025.

**NOT `rate-limiter-flexible`:** More powerful but significantly more complex; overkill for this library's usage pattern. Appropriate if Redis/distributed limiting is added later.
**NOT `express-slow-down`:** A companion library for graduated slowdown, not a replacement. Can be added alongside `express-rate-limit` as a secondary defense if desired.

**Usage pattern — tiered limits by endpoint sensitivity:**
```typescript
import rateLimit from 'express-rate-limit';

// Standard auth endpoints: 10 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Recovery endpoints: tighter — 5 per hour
const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});
```

**Note on multi-instance deployments:** The default in-memory store loses counts on restart and does not share across processes. The library exposes a `store` option. If consumers run multiple Node processes, document that they should provide a `rate-limit-redis` store. Do not add Redis as a hard dependency — keep it as a documented integration option.

---

### Structured Logging

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `pino` | `^9.x` | Structured JSON logging with log levels and field redaction | Fastest JSON logger for Node.js (JSON.stringify throughput benchmarks consistently favor pino over winston, bunyan). First-class log level support. Built-in `redact` option for sensitive field paths — critical for this codebase which currently logs treasury keys and account IDs to console. MEDIUM confidence on version. |

**Confidence:** MEDIUM — version from training data. Pino 9 is the current major as of mid-2025. API is stable; v8→v9 had only minor breaking changes.

**NOT winston:** Slower, more complex configuration, no built-in field redaction. Widely used but pino is the correct choice for a performance-sensitive library.
**NOT bunyan:** Effectively unmaintained. Do not use.
**NOT console.log:** Zero log levels, no redaction, cannot be silenced in production, no structured output.

**Usage pattern — library-safe logger factory:**
```typescript
import pino from 'pino';

// Library creates a child logger — consumers can pass their own parent logger
export function createLogger(options: { level?: string; redact?: string[] } = {}) {
  return pino({
    level: options.level ?? (process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
    redact: {
      paths: [
        'publicKey',
        'treasuryKey',
        'derivationPath',
        'password',
        'sessionId',
        ...(options.redact ?? []),
      ],
      censor: '[REDACTED]',
    },
  });
}
```

**Library packaging note:** pino is a runtime dependency (`dependencies`), not `devDependencies`, because the server entry point uses it at runtime. However, expose a `logger` option in `AnonAuthConfig` so consuming applications can inject their own pino instance — this avoids duplicate pino instances and lets consumers route logs through their existing infrastructure.

---

### Constant-Time Comparison

| Approach | Source | Why |
|----------|--------|-----|
| `crypto.timingSafeEqual` (Node.js built-in) | Node.js `crypto` module, no npm install | The correct fix for the timing side-channel in `session.ts` line 68. Already available in Node.js >= 15. No new dependency needed. |

**Confidence:** HIGH — Node.js built-in, documented API, no version uncertainty.

**NOT a third-party `safe-compare` or `secure-compare` package:** Node.js provides `crypto.timingSafeEqual` natively. Adding a wrapper npm package for something this simple increases supply-chain attack surface for no benefit.

**Fix pattern for `session.ts`:**
```typescript
import { timingSafeEqual } from 'crypto';

// Replace:
if (signature !== expectedSignature) { ... }

// With:
const sigBuf = Buffer.from(signature, 'utf8');
const expBuf = Buffer.from(expectedSignature, 'utf8');
if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
  // reject
}
```

Note: `timingSafeEqual` requires equal-length buffers. Always check length first — a length mismatch is itself a safe early rejection (the lengths of HMAC outputs are constant, so length varies only on malformed input, which can be rejected without timing concerns).

---

### CSRF Protection

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `csrf-csrf` | `^3.x` | Double-submit CSRF token pattern for Express | Implements the double-submit cookie pattern (recommended by OWASP). Works correctly with `SameSite=strict` as defense-in-depth, and is required when `SameSite=lax` or `none` is configured. Actively maintained. Integrates cleanly with Express cookie-based sessions. MEDIUM confidence on version. |

**Confidence:** MEDIUM — version from training data. `csrf-csrf` is the current recommended package post-deprecation of the older `csurf` package.

**NOT `csurf`:** Deprecated and removed from npm. Do not use — it has known vulnerabilities and is no longer maintained.
**NOT custom token implementation:** Implementing CSRF token generation and validation manually introduces error risk on a security-sensitive feature.

**Important scoping note:** CSRF protection should be applied only to state-changing endpoints (`POST`, `PATCH`, `DELETE`). The library should expose a `csrfMiddleware` factory that consuming applications mount. Do not force CSRF on all routes — GET requests should remain unprotected per CSRF best practices, and WebAuthn flows have their own challenge-based protection.

**Configuration guidance:**
```typescript
import { doubleCsrf } from 'csrf-csrf';

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET!,
  cookieName: '__Host-csrf',
  cookieOptions: {
    sameSite: 'strict',
    secure: true,
    httpOnly: true,
  },
});
```

---

### AWS SES Email Delivery

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `@aws-sdk/client-ses` | `^3.x` | Send transactional email via AWS SES | AWS SDK v3 (modular) is the current standard. The `client-ses` module is the minimal SES-only package — do not install the monolithic `aws-sdk` v2. V3 is fully tree-shakeable, supports ESM natively, and is the AWS-recommended approach. MEDIUM confidence on exact minor version. |

**Confidence:** MEDIUM — AWS SDK v3 is well-established; the modular package pattern is stable. Minor version moves frequently; pin to `^3.x` and let npm resolve.

**NOT `aws-sdk` (v2):** Deprecated. AWS has stated v2 will only receive critical security patches. V3 is the migration target.
**NOT `nodemailer` with SES transport:** Adds an unnecessary abstraction layer. Direct `@aws-sdk/client-ses` is simpler for a library that only sends one type of email (recovery password delivery).
**NOT SendGrid/Mailgun/Postmark SDKs:** Project constraints specify AWS SES. These are alternatives only if the user changes their mind.

**Usage pattern:**
```typescript
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

export async function sendRecoveryEmail(to: string, recoveryPassword: string): Promise<void> {
  const command = new SendEmailCommand({
    Source: process.env.SES_FROM_ADDRESS!,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: 'Your account recovery password' },
      Body: {
        Text: { Data: `Your recovery password is: ${recoveryPassword}\n\nStore this securely.` },
      },
    },
  });
  await sesClient.send(command);
}
```

**Packaging note:** `@aws-sdk/client-ses` must be listed in `dependencies` (not `devDependencies`) since it is called at runtime. However, it should be guarded behind a check — if no SES config is provided, skip email delivery gracefully rather than throwing at startup. Email delivery is optional infrastructure; the library should not hard-fail if SES credentials are absent.

---

### Testing — No New Framework Needed

| Decision | Rationale |
|----------|-----------|
| Vitest (already installed at `^4.0.18`) | Do not add Jest. The project already has Vitest configured. Writing tests is the task; the framework is already present. |

**Confidence:** HIGH — confirmed from existing `package.json`.

The existing `vitest` devDependency at `^4.0.18` is sufficient for all required test types:

- **Unit tests** (session, passkey, MPC, codename): `vitest` with `vi.mock()` for module mocking
- **Crypto mocking**: `vi.spyOn(crypto, 'timingSafeEqual')` etc.
- **Integration tests**: Vitest supports async/await natively; use `supertest` for HTTP-level testing

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `supertest` | `^7.x` | HTTP integration testing for Express routes | The standard for testing Express apps without starting a real server. Works with Vitest via `describe/it`. No alternative is as well-adopted for Express. MEDIUM confidence on version. |
| `@types/supertest` | `^6.x` | TypeScript types for supertest | Dev dependency companion. |

**NOT `@vitest/browser`:** Not needed — server-side library, no DOM testing required.
**NOT Playwright/Cypress:** E2E browser testing is out of scope for a server-side library.

---

## Dependency Classification

| Library | Type | Rationale |
|---------|------|-----------|
| `zod` | `dependencies` | Used at runtime to validate request bodies in Express middleware |
| `express-rate-limit` | `dependencies` | Runtime Express middleware |
| `pino` | `dependencies` | Runtime logging in all server-side code paths |
| `@aws-sdk/client-ses` | `dependencies` | Runtime email delivery for OAuth recovery |
| `csrf-csrf` | `dependencies` | Runtime Express middleware |
| `supertest` | `devDependencies` | Test-only HTTP integration tool |
| `@types/supertest` | `devDependencies` | Test-only types |
| `crypto.timingSafeEqual` | Built-in | No install needed |

---

## What NOT to Add

| Package | Reason to Avoid |
|---------|-----------------|
| `helmet` | Useful for Express apps; but this is a library, not an app. Consumers should configure helmet themselves. Adding it here forces it on consumers who may already have their own security headers. |
| `express-validator` | Redundant with zod. zod is strictly better for TypeScript projects. |
| `jsonwebtoken` | Not needed — existing session system uses HMAC-signed cookies, not JWTs. Adding JWT would be a scope change. |
| `bcrypt` / `argon2` | Not needed — no passwords stored (passkey auth). Recovery passwords are single-use random values, not user-chosen secrets that need hashing. |
| `uuid` | Already available as `crypto.randomUUID()` in Node.js >= 14.17. Adding this package would be redundant. |
| `dotenv` | Library, not app. Consumers manage their own environment. |
| `ioredis` | Not needed for this milestone. Rate-limit Redis store is a consumer concern, documented as optional. |

---

## Installation Commands

```bash
# Runtime dependencies
npm install zod express-rate-limit pino csrf-csrf @aws-sdk/client-ses

# Dev/test dependencies
npm install -D supertest @types/supertest
```

---

## Version Confidence Summary

| Library | Version | Confidence | Notes |
|---------|---------|------------|-------|
| `zod` | `^3.23.x` | MEDIUM | Training data cutoff Aug 2025. Verify: `npm view zod version`. Do not use v4 until stable release confirmed. |
| `express-rate-limit` | `^7.x` | MEDIUM | V7 stable as of mid-2025. Verify: `npm view express-rate-limit version`. |
| `pino` | `^9.x` | MEDIUM | V9 current major as of mid-2025. Verify: `npm view pino version`. |
| `csrf-csrf` | `^3.x` | MEDIUM | Training data. Verify: `npm view csrf-csrf version`. |
| `@aws-sdk/client-ses` | `^3.x` | MEDIUM | V3 is the stable AWS SDK modular release; minor version changes frequently. |
| `supertest` | `^7.x` | MEDIUM | Training data. Verify: `npm view supertest version`. |
| `crypto.timingSafeEqual` | Node.js built-in | HIGH | Available since Node.js 15; project requires >= 18. No install. |
| `vitest` | `^4.0.18` | HIGH | Confirmed in existing `package.json`. |

**Verification command (run before finalizing installs):**
```bash
npm view zod version && \
npm view express-rate-limit version && \
npm view pino version && \
npm view csrf-csrf version && \
npm view @aws-sdk/client-ses version && \
npm view supertest version
```

---

## Sources

- Project constraints: `.planning/PROJECT.md` (HIGH confidence — primary source)
- Existing stack: `.planning/codebase/STACK.md` (HIGH confidence — ground truth)
- Security concerns: `.planning/codebase/CONCERNS.md` (HIGH confidence — ground truth)
- Node.js `crypto.timingSafeEqual` API: Node.js >= 15 built-in (HIGH confidence)
- Library selections: Training data (knowledge cutoff August 2025), unverified against live registry (MEDIUM confidence on versions)
- OWASP CSRF cheat sheet: double-submit cookie pattern recommendation (HIGH confidence — stable security guidance)
- AWS SDK v2 deprecation: AWS officially announced v3 as the migration target (HIGH confidence)
- `csurf` deprecation: Removed from npm registry due to abandonment and known issues (HIGH confidence)

---

*Research date: 2026-03-14 | All version claims MEDIUM confidence — verify with npm registry before pinning*
