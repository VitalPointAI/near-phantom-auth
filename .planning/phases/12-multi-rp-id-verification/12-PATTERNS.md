# Phase 12: Multi-RP_ID Verification — Pattern Map

**Mapped:** 2026-04-29
**Files analyzed:** 7 (2 new + 5 modified; README counted as 1 modify)
**Analogs found:** 7 / 7 (all in-repo, all VERIFIED by direct Read)

All Phase 12 changes are pure plumbing on top of `@simplewebauthn/server@13.x`. Phase 11 is the most-recent precedent for "additive optional config field that threads from `AnonAuthConfig` through factories into managers" and is reused throughout. Nearly every pattern here is **self-match** (the file already contains the canonical idiom that Phase 12 must extend).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/server/relatedOrigins.ts` (CREATE) | utility (pure validator) | transform | `src/server/codename.ts:isValidCodename` (pure validator) + `src/server/backup.ts` (single-source-of-truth helper, also Phase 11 precedent) | exact (pure-func server helper, no I/O, no logger) |
| `src/__tests__/related-origins.test.ts` (CREATE) | test (unit + attack simulation) | request-response (none — pure func) | `src/__tests__/codename.test.ts` (positive/negative branches) + `src/__tests__/backup.test.ts` (minimal pure-func) + `src/__tests__/registration-auth.test.ts:18-118` (mock-DB factory if integration test added) + `src/__tests__/mpc-treasury-leak.test.ts:211-241` (tsc-fail fixture, opt-in) | exact (pure-func unit test) + role-match (attack-simulation extension) |
| `src/types/index.ts` (MODIFY) | model (type definitions) | n/a (types only) | self — `AnonAuthConfig.hooks?: AnonAuthHooks` field added in Phase 11 (lines 158-161); `AnonAuthHooks` interface declared at lines 52-59; `rp` block lines 84-92 | self-match (extend `rp` sub-block; declare `RelatedOrigin` near top) |
| `src/server/index.ts` (MODIFY — startup validation + factory thread + re-export) | factory + entry point | request-response | self — `if (!config.database.connectionString) throw new Error(...)` startup validation idiom (lines 102-105); `createPasskeyManager(...)` factory call (lines 132-137); `hooks: config.hooks` thread-through added in Phase 11 (lines 199, 219); type re-export block (lines 247-260) | self-match (4 distinct sub-templates, all in this file) |
| `src/server/passkey.ts` (MODIFY) | service (manager factory) | request-response | self — current `verifyRegistrationResponse` call (lines 172-177); current `verifyAuthenticationResponse` call (lines 279-290); `PasskeyConfig` interface (lines 36-47) | self-match (4 call-site spreads + 1 interface field) |
| `src/server/webauthn.ts` (MODIFY — type widening) | utility (standalone framework-agnostic) | request-response | self — `VerifyRegistrationInput` interface (lines 89-98); `VerifyAuthenticationInput` interface (lines 159-170); `verifyRegistration` body pass-through (lines 256-294); `verifyAuthentication` body pass-through (lines 337-371) | self-match (additive type widening; bodies require zero change) |
| `README.md` (MODIFY — docs) | config | n/a (prose) | self — existing `## Configuration` block (lines 424-510), specifically the `rp:` sub-block (lines 441-446); existing top-level `## Feature reference` (line 21); existing `## Why use this?` (line 7) — note: there is NO existing "Hooks (v0.7.0)" section in README to mirror, so Phase 12 introduces the v0.7.0 section convention | role-match (extend Configuration block; add new top-level "Cross-Domain Passkeys" section) |

---

## Pattern Assignments

### 1. `src/server/relatedOrigins.ts` (CREATE — utility, transform)

**Analog:** `src/server/codename.ts` (lines 83-90 — `isValidCodename` pure validator) and `src/server/backup.ts` (full file, 33 lines — Phase 11 precedent for "single source of truth" helpers consumed by both `passkey.ts` and `webauthn.ts`).

**Imports pattern (`backup.ts` has zero imports — purest case; `codename.ts` only imports `randomBytes` from `crypto`). For `relatedOrigins.ts` we need only `RelatedOrigin` from `../types/index.js`:**

```typescript
// Mirror src/server/backup.ts:1-6 — module header doc + zero/one local import
import type { RelatedOrigin } from '../types/index.js';
```

**Module-doc-block pattern (verbatim shape from `backup.ts:1-28`):**

```typescript
// src/server/relatedOrigins.ts
//
// Single source of truth for the rp.relatedOrigins startup-config validator.
// Source: WebAuthn Level 3 §5.10.3 (Related Origin Requests),
// passkeys.dev/docs/advanced/related-origins/, web.dev/articles/webauthn-related-origin-requests.

/**
 * Validate `rp.relatedOrigins` config at createAnonAuth() startup.
 *
 * Throws with a classified message on the first failure encountered.
 *
 * Rules (RPID-02): ...
 */
export function validateRelatedOrigins(...): RelatedOrigin[] { ... }
```

**Core pattern — pure synchronous function returning a frozen value, throwing classified errors. Mirrors the Phase 11 `deriveBackupEligibility` shape (single export, no async, no I/O), extended with the more elaborate per-entry validation loop documented in 12-RESEARCH.md "Architecture Patterns / Pattern 2" (lines 252-345 of 12-RESEARCH.md). Key conventions to copy:**

- **Single named export**, function-style (not class-style) — like `isValidCodename`, `deriveBackupEligibility`, `generateCodename`.
- **JSDoc above the function** explains rules + fallback semantics (mirrors `backup.ts:7-28` "BE/BS bit lifecycle" block).
- **Throws `new Error(...)`** with templated message (mirrors `index.ts:104` `throw new Error('PostgreSQL requires connectionString')` — the project's startup-validation idiom, not a custom error class).
- **Returns frozen / copied array** (`[...entries]`) so a downstream `Object.freeze`-style consumer can't observe a mutated input.

**Why this analog:** `codename.ts` is the canonical pure validator (`isValidCodename(codename: string): boolean`); `backup.ts` is the canonical "single source of truth helper consumed by both router and webauthn" pure helper. `relatedOrigins.ts` combines both roles — pure validator + central helper. No new file conventions needed.

**Reusable convention:** Server-side pure helpers under `src/server/` use module-level header comment + JSDoc + single named export + zero logger. `pino` import is forbidden in this file class (confirmed by absence in both `codename.ts` and `backup.ts`).

---

### 2. `src/__tests__/related-origins.test.ts` (CREATE — unit test)

**Analog A — minimal pure-func unit test:** `src/__tests__/backup.test.ts` (full file, 19 lines).
**Analog B — branchy positive/negative validator test:** `src/__tests__/codename.test.ts:98-138` (`isValidCodename` describe block).
**Analog C — mock-DB factory if any "validate at createAnonAuth() startup" integration test added:** `src/__tests__/registration-auth.test.ts:18-67` (`makeMockDb`) + `src/__tests__/hooks-scaffolding.test.ts:29-67` (the simpler `makeMinimalDb` variant — preferred since Phase 12 doesn't exercise DB methods).
**Analog D — opt-in tsc-fail fixture for "wrong shape rejected at compile time":** `src/__tests__/mpc-treasury-leak.test.ts:211-241`.

**Imports pattern (mirroring `backup.test.ts:1-2` for the basic shape; extend with `vi`, `execSync`, `createAnonAuth` for the integration tests):**

```typescript
// backup.test.ts:1-2 — minimal shape
import { describe, it, expect } from 'vitest';
import { validateRelatedOrigins } from '../server/relatedOrigins.js';

// hooks-scaffolding.test.ts:14-21 — extended shape if integration tests added
import { describe, it, expect, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { createAnonAuth, type AnonAuthConfig } from '../server/index.js';
import type { DatabaseAdapter } from '../types/index.js';
```

**Core pattern — Wave 0 unit-test scaffold (mirroring `backup.test.ts:4-19`):**

```typescript
// backup.test.ts:4-19 — copy this describe/it/expect-only shape for happy/sad paths
describe('validateRelatedOrigins (RPID-02)', () => {
  it('accepts an empty/undefined list and returns []', () => {
    expect(validateRelatedOrigins(undefined, 'shopping.com', 'https://shopping.com')).toEqual([]);
    expect(validateRelatedOrigins([], 'shopping.com', 'https://shopping.com')).toEqual([]);
  });

  it('accepts a valid paired-tuple list', () => {
    const entries = [{ origin: 'https://shopping.co.uk', rpId: 'shopping.co.uk' }];
    expect(validateRelatedOrigins(entries, 'shopping.com', 'https://shopping.com'))
      .toEqual(entries);
  });

  it('throws with a classified message when count exceeds 5', () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({
      origin: `https://shop${i}.com`,
      rpId: `shop${i}.com`,
    }));
    expect(() => validateRelatedOrigins(entries, 'shopping.com', 'https://shopping.com'))
      .toThrow(/max 5 entries/);
  });
  // ...one it() per branch (wildcards, http://non-localhost, suffix-domain, primary duplicate)
});
```

**Attack-simulation pattern (additive — no in-repo precedent for "passkey verification crosses RPs"; closest is `mpc-treasury-leak.test.ts` for adversarial framing). Recommended: build a minimal "valid for primary RP, rejected for non-pair" assertion using `verifyAuthentication()` standalone export with deliberately mismatched paired tuples.**

```typescript
// Pattern A: pure unit (recommended for Wave 0 — mirrors backup.test.ts simplicity)
// Pattern B: integration via createAnonAuth (mirrors hooks-scaffolding.test.ts:71-87)
//   — exercises the index.ts:103-104 throw idiom for misconfig

it('createAnonAuth throws when rp.relatedOrigins has > 5 entries', () => {
  const tooMany = Array.from({ length: 6 }, (_, i) => ({
    origin: `https://shop${i}.com`,
    rpId: `shop${i}.com`,
  }));
  expect(() => createAnonAuth({
    nearNetwork: 'testnet',
    sessionSecret: 'test-secret-32-chars-long-enough-12345',
    database: { type: 'custom', adapter: makeMinimalDb() },
    rp: { name: 'Test', id: 'shopping.com', origin: 'https://shopping.com',
          relatedOrigins: tooMany },
  })).toThrow(/max 5 entries/);
});
```

**TSC-fail fixture (opt-in per 12-RESEARCH.md Open Question recommendation — usage of mpc-treasury-leak.test.ts:211-241 verbatim shape):**

```typescript
// mpc-treasury-leak.test.ts:211-241 — copy this scaffold to verify "parallel string[] arrays do NOT compile"
const fixturePath = join(process.cwd(), 'src/__tests__/_related-origins-shape-fixture.ts');
const fixtureSrc = `
  import type { AnonAuthConfig } from '../server/index.js';
  const _bad: AnonAuthConfig = {
    nearNetwork: 'testnet',
    sessionSecret: 'x'.repeat(32),
    database: { type: 'postgres', connectionString: 'postgres://x/y' },
    rp: { name: 'X', id: 'a.com', origin: 'https://a.com',
          relatedOrigins: ['https://b.com'] as any },  // wrong shape — must fail tsc
  };
  export {};
  void _bad;
`;
writeFileSync(fixturePath, fixtureSrc, 'utf-8');
let tscFailed = false;
try {
  execSync(`npx tsc --noEmit ${fixturePath}`, { encoding: 'utf-8', cwd: process.cwd(), stdio: 'pipe' });
} catch { tscFailed = true; }
finally { if (existsSync(fixturePath)) unlinkSync(fixturePath); }
expect(tscFailed).toBe(true);
```

**Why these analogs:** `backup.test.ts` is the lightest in-repo test shape — same complexity profile as `validateRelatedOrigins` for the happy paths. `codename.test.ts` provides the multi-branch validator pattern (one `it()` per rejection branch). `hooks-scaffolding.test.ts` is the most-recent precedent for "construct `createAnonAuth` with an invalid optional field, expect throw"; its `makeMinimalDb()` factory (lines 29-57) is the right shape — Phase 12 does not need the full `makeMockDb` from `registration-auth.test.ts`. `mpc-treasury-leak.test.ts:211-241` is the only tsc-fail fixture in the repo and is the canonical pattern if RPID-04's array shape needs a compile-time guarantee.

**Reusable convention:** Pure-func test files use `describe('functionName (REQ-ID)')` as the outer block (see `backup.test.ts:4` "deriveBackupEligibility (BACKUP-05)") — copy this for `describe('validateRelatedOrigins (RPID-02)')`.

---

### 3. `src/types/index.ts` (MODIFY — model)

**Analog:** Self. Three modification sites use three distinct internal templates:

**(a) Top-level `RelatedOrigin` interface — declare near `AnonAuthHooks` (lines 52-59) since both are v0.7.0 additive types. Mirror `AnonAuthHooks`'s JSDoc-on-interface style:**

```typescript
// types/index.ts:37-59 — AnonAuthHooks shape; mirror for RelatedOrigin
/**
 * Optional consumer-facing hooks for extending auth lifecycle behavior.
 *
 * All callbacks are OPTIONAL. ...
 */
export interface AnonAuthHooks {
  /** Phase 14 — fires inside /register/finish, /login/finish, OAuth callback. */
  afterAuthSuccess?: (ctx: unknown) => Promise<unknown>;
  // ...
}
```

**Phase 12 addition (declare immediately after `AnonAuthHooks` so the v0.7.0 types cluster):**

```typescript
/**
 * Paired tuple binding a related origin to its rpId for cross-domain passkey
 * support (WebAuthn Related Origin Requests, v0.7.0 RPID-01).
 *
 * Pairing is structural — the array is a list of pairs, NOT two parallel arrays.
 * `@simplewebauthn/server` does NOT cross-check origin↔rpId; pairing intent is
 * preserved by tuple order at the call-site spread. See `validateRelatedOrigins`
 * for startup validation rules (https-only, suffix-domain, max 5 entries).
 */
export interface RelatedOrigin {
  /** Origin for the related domain (https://, or http://localhost in dev only). */
  origin: string;
  /** RP ID for the related domain. Must be a registrable suffix of `origin`'s host. */
  rpId: string;
}
```

**(b) `AnonAuthConfig.rp` extension — mirror the existing `rp` block at lines 84-92. Add `relatedOrigins?: RelatedOrigin[]` as the last field of the inline `rp?` object (additive, optional, JSDoc rationale per Pattern S1 from Phase 11):**

```typescript
// types/index.ts:84-92 — current rp block (target of modification)
/** WebAuthn relying party configuration */
rp?: {
  /** Relying party name (shown to users) */
  name: string;
  /** Relying party ID (usually your domain) */
  id: string;
  /** Origin for WebAuthn (e.g., https://example.com) */
  origin: string;
};
```

**Phase 12 addition (one new optional field):**

```typescript
rp?: {
  name: string;
  id: string;
  origin: string;
  /** Optional related origins for cross-domain passkey support (v0.7.0 RPID-01).
   *  Max 5 entries; each origin's host MUST be a suffix-domain of its paired rpId.
   *  Validated at createAnonAuth() startup. The library does NOT host
   *  /.well-known/webauthn — consumer responsibility (see README "Cross-Domain Passkeys"). */
  relatedOrigins?: RelatedOrigin[];
};
```

**Why self-match:** `AnonAuthConfig.hooks?: AnonAuthHooks` (lines 158-161, added in Phase 11) is the literal precedent — same pattern: top-level type declared once, optional field added, JSDoc explaining absent-field fallback. The `rp` sub-block also already has the "all-fields-required-but-block-itself-optional" shape, which Phase 12 leaves unchanged for the existing 3 fields and extends with one optional 4th.

**Reusable convention (Pattern S1 from Phase 11):** Every new optional config field gets (1) `?` modifier, (2) JSDoc rationale explaining the absent-field behavior, (3) zero behavioral change when absent. `relatedOrigins?: RelatedOrigin[]` defaulting to `[]` satisfies (3).

---

### 4. `src/server/index.ts` (MODIFY — factory + entry point)

**Analog:** Self. Four sub-templates inside this single file:

**(a) Startup config validation — analog at lines 102-105 (`if (!config.database.connectionString) throw new Error(...)`). This is the project's idiomatic "throw on misconfig at construction time, not at request time":**

```typescript
// index.ts:102-105 — current startup-validation idiom
} else if (config.database.type === 'postgres') {
  if (!config.database.connectionString) {
    throw new Error('PostgreSQL requires connectionString');
  }
```

**Phase 12 addition — call `validateRelatedOrigins` immediately AFTER `rpConfig` is resolved (lines 126-130) and BEFORE `createPasskeyManager` (lines 132-137). Throw propagates out of `createAnonAuth` before any factory runs:**

```typescript
// AFTER index.ts:130 (after `const rpConfig = config.rp || { ... }`):
const validatedRelatedOrigins = validateRelatedOrigins(
  rpConfig.relatedOrigins,   // undefined-safe (validateRelatedOrigins handles it)
  rpConfig.id,
  rpConfig.origin,
);
```

**Note on import:** The `import { validateRelatedOrigins } from './relatedOrigins.js'` line is added near the existing local-server-module imports (lines 37-47). Mirrors `index.ts:47` `import { createRouter } from './router.js'` style.

**(b) Thread-through into `createPasskeyManager` factory — analog at lines 132-137 (current call). Phase 11 precedent at lines 199 + 219 for the same pattern (`hooks: config.hooks`):**

```typescript
// index.ts:132-137 — current createPasskeyManager call (target of modification)
const passkeyManager = createPasskeyManager(db, {
  rpName: rpConfig.name,
  rpId: rpConfig.id,
  origin: rpConfig.origin,
  logger,
});
```

**Phase 12 addition — append `relatedOrigins: validatedRelatedOrigins` (mirrors the Phase 11 `hooks: config.hooks` add at line 199 — append at end, no reorder):**

```typescript
const passkeyManager = createPasskeyManager(db, {
  rpName: rpConfig.name,
  rpId: rpConfig.id,
  origin: rpConfig.origin,
  logger,
  relatedOrigins: validatedRelatedOrigins,   // Phase 12 RPID-03
});
```

**(c) Type re-export of `RelatedOrigin` — analog at lines 247-260 (`AnonAuthHooks` re-export at line 249, added in Phase 11):**

```typescript
// index.ts:247-260 — current re-export block
export type {
  AnonAuthConfig,
  AnonAuthHooks,        // Phase 11 HOOK-01 re-export
  DatabaseAdapter,
  AnonUser,
  // ...
  RateLimitConfig,
  CsrfConfig
} from '../types/index.js';
```

**Phase 12 addition — append `RelatedOrigin` to the same block (consumers need the type to construct `relatedOrigins: [...]`):**

```typescript
export type {
  AnonAuthConfig,
  AnonAuthHooks,
  RelatedOrigin,         // Phase 12 RPID-01 re-export
  DatabaseAdapter,
  // ...
} from '../types/index.js';
```

**(d) Default-rpConfig fallback — note that the `config.rp || { name: 'Anonymous Auth', id: 'localhost', origin: 'http://localhost:3000' }` fallback at lines 126-130 has NO `relatedOrigins`. `validateRelatedOrigins(undefined, ...)` returns `[]`, so no change needed to the fallback shape; the "happy path with no rp config" continues to work byte-identically.**

**Why self-match:** All four sub-templates already exist in this file (startup-validation throw, factory-thread-through, type-re-export, default-rpConfig fallback). Phase 12 extends each by exactly one line/field — no new idioms.

**Reusable convention (Pattern S3 from Phase 11):** Threading a new field through the `createAnonAuth → createX` factory boundary means (1) extend the manager's `Config` interface, (2) add the field to the factory call site in `index.ts`, (3) destructure inside the factory body when read. Phase 12 hits all three for `relatedOrigins`.

---

### 5. `src/server/passkey.ts` (MODIFY — service, request-response)

**Analog:** Self. Five distinct sub-modifications, all using existing in-file conventions:

**(a) `PasskeyConfig` interface extension — analog at lines 36-47. Mirrors the existing optional-field convention (`challengeTimeoutMs?`, `logger?`):**

```typescript
// passkey.ts:36-47 — current PasskeyConfig (target of modification)
export interface PasskeyConfig {
  rpName: string;
  rpId: string;
  origin: string;
  challengeTimeoutMs?: number;
  logger?: Logger;
}
```

**Phase 12 addition — append `relatedOrigins?: RelatedOrigin[]` (additive optional; absent → empty array semantics inside the call sites):**

```typescript
import type { RelatedOrigin } from '../types/index.js';   // ADD to existing type import at line 24-34

export interface PasskeyConfig {
  rpName: string;
  rpId: string;
  origin: string;
  challengeTimeoutMs?: number;
  logger?: Logger;
  /** Phase 12 RPID-01 — validated paired tuples threaded from createAnonAuth.
   *  The validator runs upstream (src/server/index.ts startup); this field is
   *  never validated here. Spread by index into expectedOrigin / expectedRPID. */
  relatedOrigins?: RelatedOrigin[];
}
```

**(b) `verifyRegistrationResponse` call-site spread — analog at lines 172-177 (current call):**

```typescript
// passkey.ts:172-177 — current call (target of modification)
verification = await verifyRegistrationResponse({
  response: response as unknown as Parameters<typeof verifyRegistrationResponse>[0]['response'],
  expectedChallenge: challenge.challenge,
  expectedOrigin: config.origin,
  expectedRPID: config.rpId,
} as VerifyRegistrationResponseOpts);
```

**Phase 12 change — paired-array spread by tuple order (preserves R3 origin-spoofing defense):**

```typescript
const related = config.relatedOrigins ?? [];
verification = await verifyRegistrationResponse({
  response: response as unknown as Parameters<typeof verifyRegistrationResponse>[0]['response'],
  expectedChallenge: challenge.challenge,
  expectedOrigin: related.length === 0
    ? config.origin
    : [config.origin, ...related.map(r => r.origin)],
  expectedRPID: related.length === 0
    ? config.rpId
    : [config.rpId, ...related.map(r => r.rpId)],
} as VerifyRegistrationResponseOpts);
```

**Conditional-spread idiom rationale:** When `related.length === 0`, the call passes `string` (preserves byte-identical v0.6.1 behavior — same library code path, same logs). When `related.length > 0`, it passes `string[]` (the multi-RP code path). This is the "additive-only, byte-identical when feature disabled" invariant from STATE.md.

**(c) `verifyAuthenticationResponse` call-site spread — analog at lines 279-290 (current call). Identical conditional-spread shape as (b).**

**(d) Imports — extend existing type import block (lines 24-34) with `RelatedOrigin`. Mirrors how Phase 11 added types to the same block style.**

**Why self-match:** The current call sites at lines 172-177 and 279-290 are the literal mod targets. The conditional-spread idiom is a small extension of existing argument-construction patterns; `@simplewebauthn/server@13.x` already accepts both `string` and `string[]` shapes [VERIFIED in 12-RESEARCH.md], so passing through verbatim works with zero library-side change.

**Reusable convention:** Use conditional spread (`related.length === 0 ? string : [primary, ...mapped]`) for "additive multi-value field" so that the no-feature-configured path is bit-identical to the prior version. This is novel for this repo but aligns with the Pattern S4 "additive shape, never replace" Phase 11 convention.

---

### 6. `src/server/webauthn.ts` (MODIFY — utility, type widening)

**Analog:** Self. The interfaces at lines 89-98 (`VerifyRegistrationInput`) and 159-170 (`VerifyAuthenticationInput`) are the literal mod targets. The function bodies at lines 256-294 and 337-371 require **zero changes** because the destructured values (`expectedOrigin`, `expectedRPID`) pass through to the underlying `verifyRegistrationResponse` / `verifyAuthenticationResponse` calls verbatim — and those library functions already accept `string | string[]`.

**Current `VerifyRegistrationInput` (lines 89-98 — target of modification):**

```typescript
// webauthn.ts:89-98 — current type
export interface VerifyRegistrationInput {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  /** Expected origin (e.g., 'https://example.com') */
  expectedOrigin: string;
  /** Expected RP ID (e.g., 'example.com') */
  expectedRPID: string;
}
```

**Phase 12 change — widen both fields to `string | string[]` (RPID-04). The `string` form remains valid for all existing callers (additive widening):**

```typescript
export interface VerifyRegistrationInput {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  /** Expected origin (e.g., 'https://example.com'). v0.7.0: pass an array to
   *  accept assertions from related domains. The library validates origin
   *  membership via Array.includes; pair-with-rpID enforcement is the caller's
   *  responsibility. See README "Cross-Domain Passkeys (v0.7.0)". */
  expectedOrigin: string | string[];
  /** Expected RP ID (e.g., 'example.com'). v0.7.0: pass an array for cross-domain
   *  passkey support; pair the array elements 1:1 with `expectedOrigin` by index. */
  expectedRPID: string | string[];
}
```

**`VerifyAuthenticationInput` gets the identical widening (lines 159-170). Both function bodies (`verifyRegistration` lines 256-294, `verifyAuthentication` lines 337-371) are already pass-through — destructured `expectedOrigin` / `expectedRPID` are passed verbatim into the library call — no body change needed:**

```typescript
// webauthn.ts:262-267 — current body (NO Phase 12 change required; library accepts both shapes)
const verification: VerifiedRegistrationResponse = await verifyRegistrationResponse({
  response: response as unknown as Parameters<typeof verifyRegistrationResponse>[0]['response'],
  expectedChallenge,
  expectedOrigin,    // string | string[] — passed through verbatim post-widening
  expectedRPID,      // string | string[] — passed through verbatim post-widening
});
```

**Why self-match:** The wrapper-tighter-than-library mismatch (wrapper said `string`, library accepts `string | string[]`) is purely a defensive declaration that's now blocking RPID-04. Widening is the minimal change that unblocks consumers who hand-roll their multi-RP allowlist via the standalone exports.

**Reusable convention:** When the underlying library accepts a wider type than the wrapper currently declares, **widen the wrapper input** in lockstep (additive on the input side; original `string` form remains a valid subtype of `string | string[]`). Update JSDoc to point at the README section for the new use case.

---

### 7. `README.md` (MODIFY — docs)

**Analog A — `## Configuration` section (lines 424-510):** existing `rp:` sub-block at lines 441-446 is the target of modification (add `relatedOrigins` example). Mirrors the prose style of every other config sub-block in this file.
**Analog B — top-level feature section style:** existing `## WebAuthn PRF Extension (DEK Sealing Key)` at line 39 is the closest precedent for a "v0.X.0 added this WebAuthn-feature-specific section" top-level doc. There is NO existing "Hooks (v0.7.0)" section to mirror (Phase 11 deferred the README write — confirmed by `grep -n "v0.7.0\|## .*Hooks"` returning no v0.7.0 mentions).

**Existing `rp:` config example (README:441-446 — target of modification):**

```markdown
  // === WebAuthn Relying Party ===
  rp: {
    name: 'My App',
    id: 'myapp.com',
    origin: 'https://myapp.com',
  },
```

**Phase 12 addition — extend with optional `relatedOrigins` example:**

```markdown
  // === WebAuthn Relying Party ===
  rp: {
    name: 'My App',
    id: 'myapp.com',
    origin: 'https://myapp.com',
    // Optional v0.7.0: cross-domain passkey support (paired tuples; max 5 entries)
    // relatedOrigins: [
    //   { origin: 'https://myapp.co.uk', rpId: 'myapp.co.uk' },
    //   { origin: 'https://myapp.de',    rpId: 'myapp.de' },
    // ],
  },
```

**New top-level section — insert after `## WebAuthn PRF Extension (DEK Sealing Key)` (after line ~90, before `## Installation`). Title: `## Cross-Domain Passkeys (v0.7.0)`. Required content per RPID-05:**

1. Two-paragraph "what / why" (single-domain default vs multi-RP browsers via Related Origin Requests).
2. The library's role (validate config + spread into `verify*Response` opts).
3. The consumer's role: host `/.well-known/webauthn` JSON allowlist at `https://{rpId}/.well-known/webauthn` with `Content-Type: application/json` — library does NOT auto-host.
4. Copy-pasteable JSON skeleton (verbatim from passkeys.dev with attribution).
5. Example `rp.relatedOrigins` config (cross-link to `## Configuration`).
6. Reference links: passkeys.dev/docs/advanced/related-origins/ + W3C Passkey Endpoints spec.

**Existing top-level section style to mirror (README:39-90, the PRF section header line + intro paragraph + code block + caveat box). No content extracted here — just confirming the format precedent.**

**Why self-match:** README structure follows top-level `## Section` per discrete WebAuthn feature, with code examples matching the project's actual API surface. The PRF section is the most-recent precedent for a "WebAuthn-internal feature with consumer-side responsibility" prose block.

**Reusable convention:** When adding a v0.X.0 README section, (1) tag the heading with `(v0.X.0)`, (2) explain library's role vs consumer's role explicitly, (3) include copy-pasteable code/JSON skeleton, (4) link the underlying spec. Phase 12 is the first time this convention is fully exercised (Phase 11 deferred the README — Phase 12 establishes the template that Phases 13–15 will reuse).

---

## Shared Patterns

### Pattern S1 (carried from Phase 11): Optional config field with JSDoc rationale + `?` modifier

**Source:** `src/types/index.ts:158-161` (`hooks?: AnonAuthHooks`); `src/types/index.ts:84-92` (`rp?: { ... }`); `src/server/passkey.ts:43-46` (`challengeTimeoutMs?`, `logger?`).

**Apply to:**
- `AnonAuthConfig.rp.relatedOrigins?: RelatedOrigin[]` (RPID-01)
- `PasskeyConfig.relatedOrigins?: RelatedOrigin[]` (RPID-03 thread-through)

**Concrete excerpt (the canonical optional-field-with-fallback-rationale shape, types/index.ts:158-161):**

```typescript
/** Optional consumer hooks (v0.7.0). All callbacks optional;
 *  absent or `hooks: {}` → behavior identical to v0.6.1.
 *  Phase 11 lands the type; call sites wired in Phases 13–15. */
hooks?: AnonAuthHooks;
```

**Rule:** Every new optional field gets (1) `?` modifier, (2) JSDoc with `v0.X.0` tag and explicit absent-field fallback semantics, (3) zero behavioral change when absent (verified by a "feature off" path test).

---

### Pattern S2 (carried from Phase 11): Single-source-of-truth pure helper file

**Source:** `src/server/codename.ts:isValidCodename` + `src/server/backup.ts:deriveBackupEligibility` (both pure validators, both with corresponding `__tests__/<name>.test.ts`).

**Apply to:** `src/server/relatedOrigins.ts:validateRelatedOrigins`.

**Rule:** A new file under `src/server/` exports a pure function (no DB, no logger, no async, no I/O), is consumed by `src/server/index.ts` (and possibly other server files), and has a `__tests__/<name>.test.ts` with describe/it/expect-only structure (no mocks). Module header comment doc-block + per-function JSDoc.

---

### Pattern S3 (carried from Phase 11): Factory-with-config-object thread-through

**Source:** `src/server/index.ts:132-137` (createPasskeyManager call); `src/server/index.ts:199, 219` (Phase 11 `hooks: config.hooks` precedent in two factory calls).

**Apply to:** Threading `relatedOrigins` from `createAnonAuth` → `createPasskeyManager`.

**Concrete excerpt (the canonical "append new field at end of factory call" shape, index.ts:132-137 post-extension):**

```typescript
const passkeyManager = createPasskeyManager(db, {
  rpName: rpConfig.name,
  rpId: rpConfig.id,
  origin: rpConfig.origin,
  logger,
  relatedOrigins: validatedRelatedOrigins,   // Phase 12 RPID-03 — append at end
});
```

**Rule:** Threading a new config field through the factory boundary requires (1) extend the manager's `Config` interface, (2) **append** (never reorder) the new field at the end of the factory call site in `index.ts`, (3) destructure (or read directly via `config.X`) inside the factory body when first read. **Phase 12 only threads to one factory** (`createPasskeyManager`); `createOAuthRouter` and `createRouter` do NOT need this field — only the passkey path uses `verifyRegistrationResponse` / `verifyAuthenticationResponse`. This is a Phase 12-specific deviation from the Phase 11 "thread to BOTH factories" rule (Pitfall 4 of Phase 11 does not apply here).

---

### Pattern S4 (carried from Phase 11): Additive shape — never replace, never reorder

**Source:** `src/server/router.ts:235-239` (`/register/finish` response); response-body shape in 11-PATTERNS.md "Pattern S4".

**Apply to:** `RelatedOrigin` field added to end of `rp` block; `relatedOrigins: validatedRelatedOrigins` appended to end of `createPasskeyManager` call; `RelatedOrigin` re-export appended to end of the type re-export block in `index.ts`.

**Rule:** New fields go at the END of every interface, factory call, and re-export list. Existing fields keep their order, name, and value. Verified by snapshot/regex tests where applicable.

---

### Pattern S5 (carried from Phase 11): tsc-fail compile fixture (heavyweight, opt-in)

**Source:** `src/__tests__/mpc-treasury-leak.test.ts:211-241` (the only tsc-fail fixture in the repo).

**Apply to:** `src/__tests__/related-origins.test.ts` IF the planner opts in to a compile-time guarantee that "parallel `string[]` arrays do NOT typecheck as `RelatedOrigin[]`" — recommendation in 12-RESEARCH.md is YES for the structural-pairing R3 defense, NO for the suffix-domain check (which is runtime-only).

**Concrete excerpt (the canonical write-temp-file → execSync → assert-failure shape, lines 211-241):** see Pattern Assignment #2 (`related-origins.test.ts`) above.

**Rule:** Use this pattern only when the test must verify "this code DOES NOT compile". For "this code compiles when X is in the right shape", a positive vitest assertion (the file compiles under the project's tsc) is sufficient. For Phase 12, the candidate compile-fail check is "raw `string[]` cannot satisfy `RelatedOrigin[]`" — opt-in, planner's discretion.

---

### Pattern S6: Startup-validation throw idiom (NEW for Phase 12, but precedent exists)

**Source:** `src/server/index.ts:102-105` (`if (!config.database.connectionString) throw new Error('PostgreSQL requires connectionString')`); `src/server/index.ts:111` (`throw new Error('Custom database type requires adapter')`); `src/server/index.ts:115` (`throw new Error(\`Unsupported database type: ${config.database.type}\`)`).

**Apply to:** `validateRelatedOrigins` throws inside `createAnonAuth` body, before any factory runs.

**Concrete excerpt (the canonical throw-on-misconfig idiom, index.ts:102-105):**

```typescript
} else if (config.database.type === 'postgres') {
  if (!config.database.connectionString) {
    throw new Error('PostgreSQL requires connectionString');
  }
```

**Rule:** Misconfiguration that would silently produce a security regression is rejected at construction time with a classified `new Error(...)` (no custom error class — project does not use them at this layer). The error message must include enough context for the consumer to fix the config without reading the source. `validateRelatedOrigins` follows this convention with per-entry-indexed messages (`rp.relatedOrigins[3]: ...`).

---

### Pattern S7: Conditional-spread idiom (NEW for Phase 12)

**Source:** No prior in-repo precedent. Closest analog is `src/server/router.ts` lines 369-374 from Phase 11 (`...(passkeyData && { passkey: { ... } })` — additive nested key with a conditional spread to keep the field absent when no data).

**Apply to:** `passkey.ts:172-177` and `passkey.ts:279-290` — pass `string` when `related.length === 0`, else `string[]`.

**Concrete excerpt:**

```typescript
const related = config.relatedOrigins ?? [];
const expectedOrigin = related.length === 0
  ? config.origin                                                  // string — v0.6.1 path
  : [config.origin, ...related.map(r => r.origin)];                // string[] — multi-RP path
const expectedRPID = related.length === 0
  ? config.rpId
  : [config.rpId, ...related.map(r => r.rpId)];
```

**Rule:** When a feature is gated by an optional empty-array config, prefer the conditional shape that produces the **byte-identical pre-feature input** when the array is empty. This guarantees the no-feature path produces no observable behavior change (logs, types, library code paths) — important for additive-only contract.

---

## No Analog Found

**None.** Every Phase 12 file has a clear in-repo analog. Pattern S7 (conditional spread for the `string | string[]` shape decision) is novel for this repo but is a tiny extension of the established Pattern S4 "additive shape" rule from Phase 11.

The /.well-known/webauthn JSON skeleton in the README is the only piece of content with no in-repo analog, but it is normative content (copied from passkeys.dev with attribution) — there is no internal pattern to mirror, and 12-RESEARCH.md provides the verbatim text.

---

## Metadata

**Analog search scope:**
- `src/server/` (codename.ts, backup.ts, passkey.ts, webauthn.ts, index.ts) — pure-helper + factory + manager + standalone-export patterns
- `src/types/index.ts` (lines 1-205) — interface-extension + AnonAuthHooks precedent
- `src/__tests__/` (backup.test.ts, codename.test.ts, exports.test.ts, hooks-scaffolding.test.ts, registration-auth.test.ts, mpc-treasury-leak.test.ts) — vitest patterns: pure-func, mock-DB, makeMinimalDb, tsc-fail fixture
- `README.md` (lines 7-90, 424-510) — top-level feature-section style + Configuration block
- `.planning/phases/11-backup-eligibility-flags-hooks-scaffolding/11-PATTERNS.md` — explicit Phase 11 PATTERNS reused (S1, S2, S3, S4, S5)

**Files scanned (Read tool, non-overlapping ranges):**
- `src/server/codename.ts` (full file, 90 lines)
- `src/server/backup.ts` (full file, 33 lines)
- `src/server/index.ts` (full file, 291 lines)
- `src/server/passkey.ts` (lines 1-110, 155-285)
- `src/server/webauthn.ts` (full file, 399 lines)
- `src/types/index.ts` (lines 1-205)
- `src/__tests__/backup.test.ts` (full file, 19 lines)
- `src/__tests__/codename.test.ts` (full file, 159 lines)
- `src/__tests__/exports.test.ts` (full file, 113 lines)
- `src/__tests__/hooks-scaffolding.test.ts` (full file, 137 lines)
- `src/__tests__/registration-auth.test.ts` (lines 1-120)
- `src/__tests__/mpc-treasury-leak.test.ts` (lines 200-244)
- `README.md` (configuration block + grep for v0.7.0 / Hooks sections)

**Pattern extraction date:** 2026-04-29

**Confidence:** HIGH — every analog is in-repo and was Read directly. Phase 11 PATTERNS.md (37KB, 906 lines) was Read in full and Patterns S1–S5 are reused verbatim where applicable. All citations match line ranges in the live source on `main` (commit `74d5b11`).
