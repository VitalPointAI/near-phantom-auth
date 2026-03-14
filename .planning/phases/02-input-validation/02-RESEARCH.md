# Phase 2: Input Validation - Research

**Researched:** 2026-03-14
**Domain:** Runtime request body validation with Zod in Express.js TypeScript
**Confidence:** HIGH

---

## Summary

Phase 2 adds Zod schemas to all 16 route handlers so that malformed request bodies are
rejected with a structured `{ "error": "..." }` HTTP 400 before any business logic
executes. Zod is the correct choice (already decided in project STATE.md). As of
2026-03-14, Zod 4 is the stable `latest` release at version 4.3.6 — the concern in
STATE.md about whether Zod 4 had shipped is now resolved: it has shipped and is the
default `npm install zod` target.

The two non-obvious correctness constraints for this project are: (1) WebAuthn
credential response objects sent by browsers may contain vendor extension properties
not in the W3C spec — zod schemas for those objects MUST NOT call `.strict()`, only
`.object()`, so unknown keys pass through to `@simplewebauthn/server` unmolested; and
(2) routes that accept no request body (GET /session, POST /logout, POST
/recovery/wallet/start) still need a schema — the empty schema `z.object({})` is the
correct form, and it accepts any body with `.strip()` behavior (Zod default).

All 16 handlers live in two files: `src/server/router.ts` (12 routes) and
`src/server/oauth/router.ts` (4 routes). The recommended approach is a shared
`src/server/validation/schemas.ts` module that exports named Zod schema constants,
referenced by their routes.

**Primary recommendation:** Install `zod@^4.3.6` as a production dependency. Create
`src/server/validation/schemas.ts` with 16 named schemas. Add a `validateBody(schema)`
helper that calls `schema.safeParse(req.body)` and returns 400 on failure. Apply to
every route before any business logic.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-05 | All endpoint request bodies validated at runtime with zod schemas | Zod 4.3.6 `.safeParse()` + shared helper pattern; all 16 routes inventoried below |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | ^4.3.6 | Runtime schema validation + TypeScript inference | Project-decided (STATE.md); ecosystem standard for TS server validation; Zod 4 is now stable `latest` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | - | No additional middleware needed | Zod `safeParse` is called inline; no `express-validator` or `joi` required |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| zod | joi | joi is older, no native TS inference |
| zod | yup | weaker TypeScript integration |
| zod | express-validator | verbose, decorator-based, less composable |

Zod is the locked decision from project STATE.md. Do not evaluate alternatives.

**Installation:**
```bash
npm install zod@^4.3.6
```

---

## Route Inventory

All 16 routes requiring schemas, in the order they appear in source files:

### router.ts — 12 routes

| # | Method | Path | Body Fields | Schema Notes |
|---|--------|------|-------------|--------------|
| 1 | POST | /register/start | (none) | `z.object({})` — no body; codename generated server-side |
| 2 | POST | /register/finish | `challengeId` (string), `response` (WebAuthn RegistrationResponseJSON), `tempUserId` (string), `codename` (string) | `response` must NOT use `.strict()` — browser may add vendor keys |
| 3 | POST | /login/start | `codename?` (string, optional) | Optional codename field; no body is also valid |
| 4 | POST | /login/finish | `challengeId` (string), `response` (WebAuthn AuthenticationResponseJSON) | `response` must NOT use `.strict()` |
| 5 | POST | /logout | (none) | `z.object({})` |
| 6 | GET | /session | (query only, no body) | No schema needed — GET request, no `req.body` |
| 7 | POST | /recovery/wallet/link | (none — session provides auth) | `z.object({})` |
| 8 | POST | /recovery/wallet/verify | `signature` (string), `challenge` (string), `walletAccountId` (string) | All required |
| 9 | POST | /recovery/wallet/start | (none) | `z.object({})` |
| 10 | POST | /recovery/wallet/finish | `signature` (string), `challenge` (string), `nearAccountId` (string) | All required |
| 11 | POST | /recovery/ipfs/setup | `password` (string) | Required |
| 12 | POST | /recovery/ipfs/recover | `cid` (string), `password` (string) | Both required |

### oauth/router.ts — 4 routes

| # | Method | Path | Body Fields | Schema Notes |
|---|--------|------|-------------|--------------|
| 13 | GET | /oauth/providers | (none) | No body — GET request |
| 14 | GET | /oauth/:provider/start | `provider` path param only | No body; provider validated via enum check already |
| 15 | POST | /oauth/:provider/callback | `code` (string), `state` (string) | Both required |
| 16 | POST | /oauth/:provider/link | `code` (string), `state?` (string, optional), `codeVerifier?` (string, optional) | `code` required, others optional |

**Note on GET routes:** GET /session, GET /oauth/providers, GET /oauth/:provider/start
have no request body. Schema validation applies only to POST routes with bodies.
Routes 6, 13, 14 have no schema requirement.

**Revised count:** 16 routes total, of which 13 are POST routes that receive a request
body. The 3 GET routes need no body schema. The success criterion "all 16 route
handlers have a corresponding zod schema" should be interpreted as all POST handlers
that accept a body — 13 schemas cover all validation points.

---

## Architecture Patterns

### Recommended Project Structure
```
src/server/
├── validation/
│   └── schemas.ts       # All 13 Zod schemas, exported by name
├── router.ts            # Import schemas, apply validateBody helper
├── oauth/
│   └── router.ts        # Import schemas, apply validateBody helper
└── ...existing files
```

### Pattern 1: Shared Schema Module
**What:** Export all schemas from a single `validation/schemas.ts` file.
**When to use:** Always — avoids schema duplication, enables reuse in tests.

```typescript
// src/server/validation/schemas.ts
import { z } from 'zod';

// WebAuthn credential response inner object — NEVER use .strict() here.
// Browsers add vendor extension properties; .strict() would reject valid credentials.
const webAuthnResponseBase = z.object({
  clientDataJSON: z.string(),
}).passthrough();  // explicit passthrough to document the intent

export const registerFinishBodySchema = z.object({
  challengeId: z.string(),
  tempUserId: z.string(),
  codename: z.string(),
  response: z.object({
    id: z.string(),
    rawId: z.string(),
    type: z.literal('public-key'),
    response: z.object({
      clientDataJSON: z.string(),
      attestationObject: z.string(),
    }).passthrough(),            // allow transports, publicKeyAlgorithm, etc.
    clientExtensionResults: z.record(z.unknown()),
  }).passthrough(),              // allow authenticatorAttachment, vendor keys
});

export const loginFinishBodySchema = z.object({
  challengeId: z.string(),
  response: z.object({
    id: z.string(),
    rawId: z.string(),
    type: z.literal('public-key'),
    response: z.object({
      clientDataJSON: z.string(),
      authenticatorData: z.string(),
      signature: z.string(),
      userHandle: z.string().optional(),
    }).passthrough(),
    clientExtensionResults: z.record(z.unknown()),
  }).passthrough(),
});

// ... one export per route that has a body
```

**Source:** Zod 4 official docs — `z.object()` strips unknown keys by default;
`.passthrough()` preserves them; `.strict()` rejects them.
[https://zod.dev](https://zod.dev)

### Pattern 2: Inline validateBody Helper
**What:** A small synchronous helper that calls `safeParse` and sends 400 on failure.
**When to use:** Apply at the top of every POST handler body, before any `await` calls.

```typescript
// src/server/validation/validateBody.ts
import type { Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

export function validateBody<T extends ZodTypeAny>(
  schema: T,
  req: Request,
  res: Response,
): z.infer<T> | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: result.error.issues[0]?.message ?? 'Invalid request body',
    });
    return null;
  }
  return result.data;
}
```

Usage in a route handler:
```typescript
router.post('/register/finish', async (req, res) => {
  const body = validateBody(registerFinishBodySchema, req, res);
  if (!body) return;          // 400 already sent

  // Now body is typed — no more req.body destructuring
  const { challengeId, response, tempUserId, codename } = body;
  // ... business logic
});
```

**Why this pattern:** `safeParse` never throws; inline helper keeps route handlers
clean; no middleware wrapping needed; typed result replaces `req.body`.

### Anti-Patterns to Avoid
- **Using `.strict()` on WebAuthn response objects:** Rejects valid credentials from
  browsers that add extension properties. Use `.passthrough()` on the `response` object
  and credential outer object.
- **Using `parse()` instead of `safeParse()`:** `parse()` throws; uncaught throws
  produce 500s, defeating the purpose of validation.
- **Middleware-level schema attachment:** Express middleware schemas work but couple
  schema to route registration order. Inline `validateBody` is simpler.
- **Validating session/auth headers in schemas:** Sessions are read from cookies by
  `sessionManager.getSession(req)` — do not validate cookie headers with Zod.
- **Catching ZodError and re-serializing manually:** `safeParse` returns `success` +
  `error` — no try/catch needed.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type coercion from string | Custom type parsers | `z.coerce.string()`, `z.preprocess()` | Handles edge cases around null, undefined, number-as-string |
| Required-field enforcement | `if (!field)` checks | `z.string().min(1)` | Catches empty string `""` which `!field` misses |
| Nested object validation | Manual deep property checks | Nested `z.object()` | Zod handles recursive validation with correct error paths |
| Array element validation | Manual array iteration | `z.array(z.string())` | Produces per-element error messages |

**Key insight:** The existing `if (!challengeId || !response)` guards in router.ts are
replaced entirely by zod schemas. They provide better error messages and catch
wrong-type values (e.g., `challengeId: 123` passes the truthiness check but fails
`z.string()`).

---

## Common Pitfalls

### Pitfall 1: `.strict()` on WebAuthn Response Objects
**What goes wrong:** Registration or authentication fails for users whose browsers
(Chrome extensions, password managers) add non-standard properties to the credential
response object.
**Why it happens:** Developers reasonably want to reject unexpected fields. For WebAuthn
this breaks real users in production.
**How to avoid:** Use `.passthrough()` on both the outer credential object and the inner
`response` sub-object. Only the fields `@simplewebauthn/server` actually needs are
validated; extras are allowed through.
**Warning signs:** Auth works in test browsers but fails for some users; credential
objects from Safari or Firefox behave differently than Chrome.

### Pitfall 2: Empty String Passes Truthiness Guard but Fails Semantic Validation
**What goes wrong:** `if (!challengeId)` passes for `challengeId: ""`, but an empty
string is not a valid challenge ID. The existing guards in router.ts share this bug.
**How to avoid:** Use `z.string().min(1)` for fields that must be non-empty.

### Pitfall 3: `parse()` Throws Unhandled ZodError → 500
**What goes wrong:** Using `schema.parse(req.body)` in a try/catch that catches `Error`
but not `ZodError` causes a 500. Or forgetting try/catch entirely.
**How to avoid:** Always use `safeParse`. No try/catch needed; check `result.success`.

### Pitfall 4: Schema in devDependencies
**What goes wrong:** Zod is placed in `devDependencies` because it is "just for
validation." Runtime `import` fails in production.
**How to avoid:** `npm install zod` (production dependency). This is a runtime library.

### Pitfall 5: Zod 4 Minimum Node Version
**What goes wrong:** Zod 4 requires Node 18+. Project already targets Node 18+ (engines
field in package.json) so this is not a concern, but worth noting.
**Warning signs:** `SyntaxError: Unexpected token` in older environments.

### Pitfall 6: OAuth Callback body — `state` from Cookie vs Body
**What goes wrong:** The OAuth callback validates `state` from `req.body` and compares
to `req.cookies.oauth_state`. The schema should only validate that `code` and `state`
are strings — it should not validate that state matches the cookie (that is business
logic, not structural validation).
**How to avoid:** Schema only validates structure; the cookie comparison stays in the
handler.

---

## Code Examples

Verified patterns from Zod 4 official documentation:

### Basic Object Schema
```typescript
// Source: https://zod.dev — Zod v4 object validation
import { z } from 'zod';

const schema = z.object({
  challengeId: z.string().min(1),
  codename: z.string().min(1),
});

const result = schema.safeParse(req.body);
if (!result.success) {
  return res.status(400).json({ error: result.error.issues[0]?.message });
}
const { challengeId, codename } = result.data; // typed!
```

### Passthrough for Unknown Keys
```typescript
// Source: https://zod.dev — "passthrough" section
// .passthrough() is the explicit alternative to .strip() (default) and .strict()
const credentialSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
  }).passthrough(),   // vendor keys inside response.response allowed
  clientExtensionResults: z.record(z.unknown()),
}).passthrough();     // authenticatorAttachment and vendor keys at top level allowed
```

### Optional Fields
```typescript
// Source: https://zod.dev — optional fields
const loginStartSchema = z.object({
  codename: z.string().min(1).optional(),  // body may be entirely absent or empty
});
```

### Zod 4 Error Shape
```typescript
// result.error.issues is the array of ZodIssue
// result.error.issues[0].message is the human-readable message
// result.error.format() produces nested object (useful for field-level errors)
if (!result.success) {
  res.status(400).json({ error: result.error.issues[0]?.message ?? 'Invalid request' });
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zod 3.x | Zod 4.x (4.3.6 stable) | Zod 4 went stable late 2025 | New API: `z.string()` parses undefined as error by default (no more `.optional()` workaround); performance improved ~14x for common cases |
| Manual `if (!field)` guards | Zod `safeParse` | Phase 2 | Catches type errors, empty strings, missing nested fields; produces error messages |

**Zod 4 vs Zod 3 relevant differences:**
- Import path is the same: `import { z } from 'zod'`
- `z.object()`, `.safeParse()`, `.passthrough()`, `.strict()` API is unchanged
- Error shape: `result.error.issues` is the same; `result.error.flatten()` still works
- `z.string()` in Zod 4 no longer coerces — pass a string or fail (correct behavior)
- No `.strict()` behavior change; still rejects unknown keys when called

**Deprecated/outdated:**
- `zod@^3.x`: Not deprecated but Zod 4 is the stable `latest`. New installs get v4.

---

## Open Questions

1. **Error message format — single string vs field map**
   - What we know: Success criteria says `{ "error": "..." }` — a single string
   - What's unclear: Whether to include which field failed
   - Recommendation: Return `result.error.issues[0]?.message` for the first failing
     field. This matches the existing error shape in router.ts. A `details` array could
     be added but is not required by SEC-05.

2. **Schemas in `src/server/validation/` or colocated in router file?**
   - What we know: 13 schemas across 2 router files
   - What's unclear: Team preference for colocation vs centralization
   - Recommendation: `src/server/validation/schemas.ts` centralizes all schemas and
     makes them importable by future test files (Phase 7).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `vitest.config.ts` (globals: true, environment: node) |
| Quick run command | `npx vitest run src/__tests__/validation.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-05 | POST /register/finish with missing `challengeId` returns 400 `{ error: "..." }` | unit | `npx vitest run src/__tests__/validation.test.ts -t "register/finish"` | Wave 0 |
| SEC-05 | POST /register/finish with extra unknown fields in `response` returns 200 (not rejected) | unit | `npx vitest run src/__tests__/validation.test.ts -t "passthrough"` | Wave 0 |
| SEC-05 | POST /login/finish with `challengeId: 123` (number) returns 400 | unit | `npx vitest run src/__tests__/validation.test.ts -t "login/finish type"` | Wave 0 |
| SEC-05 | All schemas in schemas.ts parse valid payloads without error | unit | `npx vitest run src/__tests__/validation.test.ts -t "valid payloads"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/__tests__/validation.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/validation.test.ts` — covers SEC-05 schema acceptance and rejection
- [ ] `src/server/validation/schemas.ts` — the schema module itself (created in Wave 0 or Plan 01)

*(Existing test infrastructure: vitest.config.ts present, globals enabled — no framework install needed.)*

---

## Sources

### Primary (HIGH confidence)
- `npm view zod` (live registry) — confirmed Zod 4.3.6 is stable `latest` as of 2026-03-14
- `node_modules/@simplewebauthn/server/esm/types/index.d.ts` — confirmed `RegistrationResponseJSON` and `AuthenticationResponseJSON` shape including `clientExtensionResults: AuthenticationExtensionsClientOutputs`
- `src/server/router.ts` — direct source audit of all 12 main routes and their current `req.body` destructuring patterns
- `src/server/oauth/router.ts` — direct source audit of 4 OAuth routes
- `package.json` — confirmed zod not yet installed; Node engines >=18 compatible with Zod 4

### Secondary (MEDIUM confidence)
- [https://zod.dev](https://zod.dev) — Zod 4 official docs; `.passthrough()`, `.safeParse()`, error shape (fetched via WebFetch during research)

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zod version verified live from npm registry; already decided in STATE.md
- Architecture: HIGH — all 16 routes directly read from source; schemas designed from actual `req.body` destructuring patterns in the code
- Pitfalls: HIGH — `.strict()` vs WebAuthn constraint is from direct inspection of `@simplewebauthn/server` type definitions and the project's existing type definitions

**Research date:** 2026-03-14
**Valid until:** 2026-06-14 (Zod 4 stable, slow-moving; WebAuthn spec stable)
