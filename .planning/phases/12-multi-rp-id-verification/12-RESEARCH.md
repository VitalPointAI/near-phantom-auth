# Phase 12: Multi-RP_ID Verification — Research

**Researched:** 2026-04-29
**Domain:** WebAuthn Related Origin Requests (cross-domain passkey verification) on top of `@simplewebauthn/server@13.2.3`
**Confidence:** HIGH (every load-bearing claim verified against installed library source, official W3C/passkeys.dev documentation, or in-repo Phase 11 prior art)

---

## Summary

Phase 12 adds an **optional, paired-tuple** `rp.relatedOrigins?: Array<{ origin: string; rpId: string }>` config field that lets a single deployment of `@vitalpoint/near-phantom-auth` accept passkey assertions across multiple registrable domains (e.g. `shopping.com` + `shopping.co.uk` + `shopping.ie`). The browser-side machinery — fetching `/.well-known/webauthn` from the claimed RP ID and authorising the originating domain — is **not** something the library participates in. Phase 12's entire scope is:

1. Accept and **validate** the consumer's `relatedOrigins` config at `createAnonAuth()` startup (https-only, no wildcards, suffix-domain check, max 5 entries).
2. Pass the **paired arrays** through to `verifyRegistrationResponse` / `verifyAuthenticationResponse` at the call sites in `src/server/passkey.ts` and `src/server/router.ts` paths.
3. Widen the standalone `verifyRegistration()` / `verifyAuthentication()` exports' `expectedRPID` and `expectedOrigin` parameters from `string` to `string | string[]` (additive — `string` form preserved).
4. **Document** the `/.well-known/webauthn` consumer responsibility in the README — the library does NOT auto-host this endpoint. RPID-V2-01 (`generateWellKnownWebauthn` helper) is explicitly deferred.

**Critical, non-obvious finding** — the installed `@simplewebauthn/server@13.2.3` does **NOT** verify origin↔rpId pairing. `verifyAuthenticationResponse` does `expectedOrigin.includes(origin)` (independent membership) and `matchExpectedRPID(rpIdHash, expectedRPIDs)` does `Promise.any` over candidates (also independent). [VERIFIED: `node_modules/@simplewebauthn/server/esm/authentication/verifyAuthenticationResponse.js` lines 71-81, 104-111] If the consumer accidentally supplies `origins=[A, B]` and `rpIds=[idA, idB]` as parallel arrays where the indexes drift (e.g. by `.map()` ordering), the library will accept `originA + idB` as valid even though the consumer's intent was "A pairs with idA". **The paired-tuple `Array<{ origin, rpId }>` config shape is the entire R3 origin-spoofing defense.** It moves pairing enforcement upstream of the array spread; once the spread happens at the call site, pairing intent is lost.

**Primary recommendation:** Mirror Phase 11's `AnonAuthHooks` pattern — add a top-level type (`RelatedOrigin`), add `rp.relatedOrigins?` to `AnonAuthConfig.rp`, validate at `createAnonAuth()` startup with a dedicated pure-function helper (`validateRelatedOrigins`) that throws with a classified error, thread the validated list through to `PasskeyConfig`, spread to `expectedOrigin: [primaryOrigin, ...related.map(r => r.origin)]` and `expectedRPID: [primaryRpId, ...related.map(r => r.rpId)]` at the four call sites (register-verify, auth-verify in `passkey.ts`; standalone `verifyRegistration` / `verifyAuthentication` in `webauthn.ts`).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

CONTEXT.md does NOT exist for Phase 12 (`has_context: false` per init query). All decisions for this phase derive from:

### Locked Decisions (from STATE.md and REQUIREMENTS.md)

- **R3 origin-spoofing defense** — `relatedOrigins: Array<{ origin: string; rpId: string }>` paired-tuple config + startup validation (https only, no wildcards, host suffix-domain of rpId, max 5 entries) — load-bearing for Phase 12 [STATE.md > Decisions > v0.7.0]
- **Phase 11 dependency** — shared `AnonAuthConfig` extension pattern from Phase 11 (the `AnonAuthHooks` precedent) is the reference shape for adding `rp.relatedOrigins`
- **`MPCAccountManager` contract FROZEN** — no field/method/return-shape renames in v0.7.0 (Phase 12 does not touch `mpc.ts`)
- **Anonymity invariant non-negotiable** — no PII in any new field
- **Zero new dependencies**
- **Additive-only contract** — every existing v0.6.1 export, response shape, and behavior must be preserved
- **System Node is v12; must use `nvm use 20`** for any vitest run [MEMORY.md feedback]
- **zod for runtime validation** — Phase 2 established this convention; Phase 12 uses zod where applicable for the relatedOrigins schema
- **pino externalized** — consumers provide their own pino instance

### Claude's Discretion

- Whether to colocate `validateRelatedOrigins` in `src/server/index.ts` (where validation runs) or extract to a sibling helper file (e.g. `src/server/rp.ts` or `src/server/relatedOrigins.ts`) for testability
- Whether to use a zod schema or hand-rolled validation for the `relatedOrigins` shape — recommendation: zod for the shape (paired-tuple, https/http://localhost regex), hand-rolled for the suffix-domain check (zod cannot easily encode "host of `.origin` is a suffix-domain of `.rpId`")
- Whether the standalone `verifyAuthentication()` (which currently takes `string` only for `expectedRPID` / `expectedOrigin`) gets its types widened to `string | string[]` symmetrically with `verifyRegistration()` — recommendation: YES, RPID-04 explicitly applies to both standalone exports
- Tsd / type-level test approach — RECOMMEND skip `tsd` (it's a separate dependency); reuse the `__tsc_fail/`-style pattern from `mpc-treasury-leak.test.ts:212-241` if a tsc-level guarantee is desired, otherwise rely on positive vitest compile fixtures (existing pattern from `hooks-scaffolding.test.ts`)
- The exact prose of the README `/.well-known/webauthn` skeleton — recommendation: copy verbatim from passkeys.dev (with attribution) since the JSON shape is normative

### Deferred Ideas (OUT OF SCOPE — DO NOT IMPLEMENT)

- **RPID-V2-01:** `generateWellKnownWebauthn(config)` pure-function helper that builds the JSON document — deferred to v0.8+
- **RPID-V2-02:** `mountWellKnownWebauthn(app, config)` opt-in Express middleware — deferred to v0.8+
- **RPID-V2-03:** Client-side capability probe via `PublicKeyCredential.getClientCapabilities()` — deferred to v0.8+
- **Auto-hosting `/.well-known/webauthn` route** — explicitly listed in REQUIREMENTS.md "Out of Scope" table ("library would need request-routing concerns it doesn't own; consumer hosts")
- **Wildcard origins in `rp.relatedOrigins`** — REQUIREMENTS.md "Out of Scope" ("origin-spoofing attack surface; library validates and rejects")
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RPID-01 | `AnonAuthConfig.rp.relatedOrigins?: Array<{ origin: string; rpId: string }>` paired tuples (NOT parallel arrays). Default `[]` → behavior identical to v0.6.1. | Pattern S1 (optional config field) + Pitfall 1 (paired-tuple invariant); see "Architecture Patterns / Pattern 1" below. |
| RPID-02 | Library validates at `createAnonAuth()` startup: each `origin` must be `https://` (or `http://localhost` for dev), no wildcards, host must be suffix-domain of `rpId`, max 5 entries. Throws with classified message. | "Standard Stack / Validation" + "Architecture Patterns / Pattern 2" (validateRelatedOrigins helper) + "Common Pitfalls / Pitfall 2" (suffix-domain check). |
| RPID-03 | `verifyRegistrationResponse` and `verifyAuthenticationResponse` calls in `src/server/passkey.ts` pass paired arrays: `expectedOrigin: [primary, ...related.map(o => o.origin)]` and `expectedRPID: [primaryRpId, ...related.map(o => o.rpId)]`. Pairing preserved by index — docstring asserts contract. | "Code Examples / Spread at call site" + Pitfall 1 (origin spoofing through index drift). |
| RPID-04 | Standalone `verifyRegistration()` and `verifyAuthentication()` widen `expectedRPID` and `expectedOrigin` to `string \| string[]`; `string` form preserved. | "Architecture Patterns / Pattern 3" (type widening) — library already supports both forms internally; only the wrapper input types need widening. |
| RPID-05 | README documents `/.well-known/webauthn` consumer responsibility (library does NOT auto-host); links to passkeys.dev and W3C Passkey Endpoints spec; provides copy-pasteable JSON skeleton. | "Don't Hand-Roll" entry + "Code Examples / .well-known JSON skeleton" below. |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `relatedOrigins` config validation (paired-tuple shape, suffix-domain, https) | API / Backend (`src/server/index.ts` or sibling helper) | — | Validation must run at server startup before any request handler is wired; it's a fail-fast misconfiguration guard — does not belong in the browser or in middleware |
| Spreading paired arrays into `expectedOrigin` / `expectedRPID` for `@simplewebauthn/server` | API / Backend (`src/server/passkey.ts:172-177`, `:279-290`; `src/server/webauthn.ts:262-267`, `:343-354`) | — | Verification crypto runs server-side; this is purely a parameter-shape adjustment at the existing call sites |
| Type widening for standalone `verifyRegistration` / `verifyAuthentication` exports | API / Backend (`src/server/webauthn.ts` interface block) | — | Standalone framework-agnostic surface; consumers using Next.js route handlers call directly |
| Browser-side `/.well-known/webauthn` fetch + allowlist check | Browser / Client | — | Pure browser feature; the library has no role. The browser fetches `https://{rpId}/.well-known/webauthn` when an origin doesn't match the rpId, validates the originating page is in the `origins` array, and only then proceeds with the WebAuthn ceremony [CITED: passkeys.dev/docs/advanced/related-origins/] |
| Hosting `/.well-known/webauthn` JSON | CDN / Static (consumer infrastructure) | Frontend Server (consumer's choice) | Consumer responsibility — library does NOT auto-host (locked decision; RPID-V2-01/02 deferred). The file lives at `https://{rpId}/.well-known/webauthn` with `Content-Type: application/json` |
| Client-side capability probe | Browser / Client | — | `PublicKeyCredential.getClientCapabilities()` not yet broadly available; explicitly deferred (RPID-V2-03) |

**Why this matters for Phase 12 task assignment:** The phase touches only the Backend tier. There is no React hook change, no new Express middleware, no `/.well-known` route handler, no `oauth/router.ts` change (OAuth flow doesn't go through `verify*Response`), and no DB schema change. Five files are modified; zero are created (validateRelatedOrigins MAY be a new file at the planner's discretion).

---

## Standard Stack

### Core (already installed — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@simplewebauthn/server` | 13.2.3 | Verification crypto + array-form support for `expectedRPID` / `expectedOrigin` | Already pinned; multi-value support confirmed at the type level (both fields typed as `string \| string[]`) and the runtime level (`expectedOrigin.includes(origin)` + `matchExpectedRPID` Promise.any) [VERIFIED: installed `node_modules/@simplewebauthn/server/esm/authentication/verifyAuthenticationResponse.{js,d.ts}`] |
| `zod` | 3.x (already installed; see `src/server/validation/schemas.ts`) | Optional — schema-validate the `relatedOrigins` array at startup | Project convention for runtime validation [VERIFIED: STATE.md "zod for runtime validation"] |
| `pino` | already installed (peer dep) | Optional — log a `warn` on suspicious config (e.g. `http://` non-localhost — but Phase 12 throws instead, so logging is for post-validation telemetry only) | Project convention; externalized via tsup |

### Supporting (none required)

No new dependencies. Phase 12 is pure plumbing on top of an existing library that already supports the array form.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled paired-tuple zod schema | A `tsd` dev dependency for type-level test of `string \| string[]` widening | `tsd` adds a dev dep; the existing `mpc-treasury-leak.test.ts:212-241` pattern (`writeFileSync` + `execSync('npx tsc --noEmit')`) is in-repo and zero-dep — recommendation: reuse it |
| Validation in `createAnonAuth` body | A zod schema applied uniformly to the whole `AnonAuthConfig` | Project does not currently validate the rest of `AnonAuthConfig` with zod (only request bodies). Adding a comprehensive config schema is out of scope; localised paired-tuple validation matches existing style (e.g. lines 103-104 `if (!config.database.connectionString) throw new Error(...)`) |
| Throwing on validation failure | Logging + silent-skip | The phase requirement says "throws with classified message" — silent-skip would mean a misconfigured production deploys with `relatedOrigins=[]` and silently fails to recognise the supposed-related domain. Throw is the locked behavior. |

**Installation:**
```bash
# No new dependencies — all required packages already installed
# Verification:
npm ls @simplewebauthn/server zod pino
```

**Version verification:** `@simplewebauthn/server@13.2.3` is the installed version per `node_modules/@simplewebauthn/server/package.json`. The npm registry lookup via `npm view @simplewebauthn/server version` errored on this machine (Node v24 + globally installed npm v6 mismatch — see MEMORY.md feedback about node version handling). However, the type definitions (`expectedOrigin: string | string[]`, `expectedRPID: string | string[]`) confirm 13.x supports the multi-value form. [VERIFIED: installed source]

---

## Architecture Patterns

### System Architecture Diagram

```
                                          ┌──────────────────────────────────┐
                                          │ /.well-known/webauthn (consumer) │
                                          │  hosted at https://{rpId}/.well- │
                                          │  known/webauthn — JSON allowlist │
                                          │  Library does NOT auto-host      │
                                          └─────────────▲────────────────────┘
                                                        │
                              fetched by browser when ──┘
                              page-origin ≠ rpId
                                                                                                                   
[Consumer config]                          [near-phantom-auth library]                              [@simplewebauthn/server]
   AnonAuthConfig                                                                                                  
   ├ rp.id: 'shopping.com'                                                                                         
   ├ rp.origin: 'https://shopping.com'                                                                             
   └ rp.relatedOrigins:                                                                                            
     [                                                                                                             
       { o: 'https://shopping.co.uk',                                                                              
         id: 'shopping.co.uk' },                                                                                   
       { o: 'https://shopping.ie',                                                                                 
         id: 'shopping.ie' }                                                                                       
     ]                                                                                                             
        │                                                                                                          
        │                                                                                                          
        ▼                                                                                                          
   createAnonAuth()                                                                                                
        │                                                                                                          
        │  validateRelatedOrigins(rp.relatedOrigins, rp.id, rp.origin)                                             
        │    ├ shape:        each entry has { origin, rpId } strings                                              
        │    ├ count:        ≤ 5 entries                                                                          
        │    ├ scheme:       https:// (or http://localhost when rpId === 'localhost')                            
        │    ├ no wildcards: '*' not allowed in origin or rpId                                                    
        │    ├ suffix check: host(origin) ends with rpId                                                          
        │    └ throw new Error(`relatedOrigins[${i}]: <classified reason>`)                                       
        │                                                                                                          
        ▼                                                                                                          
   PasskeyConfig                                                                                                   
   ├ rpId: 'shopping.com'                                                                                          
   ├ origin: 'https://shopping.com'                                                                                
   └ relatedOrigins: [validated tuples]                                                                            
        │                                                                                                          
        │                                                                                                          
        ▼  POST /register/finish                                                                                   
   passkey.ts: finishRegistration                                                                                  
        │                                                                                                          
        │  expectedOrigin: ['https://shopping.com',                                                               
        │                   'https://shopping.co.uk',     ──┐                                                     
        │                   'https://shopping.ie']           │  spread by index — pairing                          
        │  expectedRPID:   ['shopping.com',                  │  is preserved BY THE TUPLE                          
        │                   'shopping.co.uk',     ──────────┘  ORDER, not by the library                          
        │                   'shopping.ie']                                                                         
        │                                                                                                          
        ▼                                                                                                          
   verifyRegistrationResponse() ────────────────────────────────────────────►                                     
                                                                                  Validates:                       
                                                                                  ├ origin ∈ expectedOrigin (any) 
                                                                                  └ rpIdHash ∈ expectedRPIDs (any)
                                                                                                                   
                                                                                  ⚠ Library does NOT cross-check  
                                                                                  origin↔rpId pairing — it's       
                                                                                  pure independent membership.     
                                                                                  Pairing must be enforced         
                                                                                  by the CONFIG SHAPE upstream.   
```

**Reading guide:** Data flows top-down. The browser-side `/.well-known/webauthn` fetch is annotated as *out-of-band* — it happens in the browser before the assertion ever reaches the server, and the library plays no role. The library's role begins at `createAnonAuth()` validation and ends at the spread of paired arrays into `verify*Response` opts.

### Recommended Project Structure

```
src/
├── server/
│   ├── index.ts            # MODIFY — add validateRelatedOrigins call after rpConfig resolution; thread validated list to PasskeyConfig
│   ├── passkey.ts          # MODIFY — extend PasskeyConfig with relatedOrigins; spread paired arrays at lines 172-177 and 279-290
│   ├── webauthn.ts         # MODIFY — widen VerifyRegistrationInput.expectedRPID/expectedOrigin types; pass through to verifyRegistrationResponse / verifyAuthenticationResponse (which already accept arrays)
│   ├── relatedOrigins.ts   # CREATE (recommended) — pure-function validateRelatedOrigins(entries, primaryRpId, primaryOrigin); mirrors src/server/codename.ts and src/server/backup.ts pattern
│   └── ... (no other server files touched)
├── types/
│   └── index.ts            # MODIFY — add RelatedOrigin type; extend AnonAuthConfig.rp with relatedOrigins?: RelatedOrigin[]
└── __tests__/
    ├── related-origins.test.ts    # CREATE (Wave 0) — covers validateRelatedOrigins + multi-RPID end-to-end + attack-simulation tests
    └── exports.test.ts            # MODIFY — extend with type-export assertion for RelatedOrigin
```

### Pattern 1: Paired-tuple at the config layer (R3 defense)

**What:** Express the per-RP-ID + per-origin association as `Array<{ origin, rpId }>` instead of two parallel arrays.

**When to use:** Whenever two arrays must move together as logically-related pairs and any consuming function takes them as separate parameters where index drift is invisible.

**Why this is load-bearing for Phase 12:** `@simplewebauthn/server` does NOT enforce origin↔rpId pairing — it does independent membership tests on each list. [VERIFIED: `verifyAuthenticationResponse.js:71-81` (origin includes), `matchExpectedRPID.js:9-23` (Promise.any over rpIds)] If the consumer passes `origins=[A, B]` and `rpIds=[idA, idB]` and during a later refactor someone reorders one array, the library will accept assertions where `originA + idB` is signed, even though that combination never had a `.well-known/webauthn` allowlist relationship. The paired-tuple shape makes the pairing intent **structural** — it cannot be silently broken by a `.map()` reorder because the array IS the list of pairs.

**Example:**
```typescript
// ❌ DON'T: parallel arrays — index drift is invisible and silently catastrophic
interface AnonAuthConfig {
  rp?: {
    id: string;
    origin: string;
    relatedRpIds?: string[];      // ← two arrays, drift risk
    relatedOrigins?: string[];    //
  };
}

// ✅ DO: paired tuple — drift is a type error
interface RelatedOrigin {
  /** Origin for the related domain (https://, or http://localhost in dev) */
  origin: string;
  /** RP ID for the related domain (must be eTLD+1 or registrable suffix of `origin`'s host) */
  rpId: string;
}

interface AnonAuthConfig {
  rp?: {
    id: string;
    origin: string;
    /** Optional related origins for cross-domain passkey support (RPID-01).
     *  Max 5 entries. Each origin's host MUST be a suffix-domain of its paired rpId.
     *  Library does NOT host /.well-known/webauthn — consumer responsibility. */
    relatedOrigins?: RelatedOrigin[];
  };
}
```

[CITED: passkeys.dev/docs/advanced/related-origins/, web.dev/articles/webauthn-related-origin-requests, REQUIREMENTS.md RPID-01]

### Pattern 2: Pure-function validation helper colocated under `src/server/`

**What:** Express startup config validation as a pure exportable function in a sibling file, with a corresponding `__tests__/<name>.test.ts`. Mirrors `src/server/codename.ts:isValidCodename` and `src/server/backup.ts:deriveBackupEligibility` (both established in v0.6.x and Phase 11 respectively).

**When to use:** When validation logic has multiple branches and deserves dedicated unit tests separate from the integration path that consumes it.

**Example:**
```typescript
// src/server/relatedOrigins.ts (NEW — recommended location)

import type { RelatedOrigin } from '../types/index.js';

const MAX_RELATED_ORIGINS = 5;
const HTTPS_RE = /^https:\/\/[^*\s/?#]+(:[0-9]+)?$/;
const LOCALHOST_HTTP_RE = /^http:\/\/localhost(:[0-9]+)?$/;
const RPID_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * Validate `rp.relatedOrigins` config at startup.
 *
 * Throws with a classified message on the first failure encountered.
 *
 * Rules:
 *   1. Max 5 entries (RPID-02 cap, aligned with browser ROR 5-label minimum).
 *   2. Each `origin` is a syntactically-valid URL with scheme `https:` (or
 *      `http:` only when `rpId === 'localhost'`).
 *   3. No wildcards (`*`) anywhere in origin or rpId.
 *   4. Each `rpId` is a syntactically-valid host (no scheme, no path).
 *   5. The host extracted from `origin` MUST end with `rpId` and the boundary
 *      MUST be at a label (i.e. either equal or preceded by `.`). This is the
 *      "registrable suffix" check — eTLD+1 awareness is OUT of scope for this
 *      helper (zero-dep implementation; see Pitfall 2).
 */
export function validateRelatedOrigins(
  entries: readonly RelatedOrigin[] | undefined,
  primaryRpId: string,
  primaryOrigin: string,
): RelatedOrigin[] {
  if (!entries || entries.length === 0) return [];
  if (entries.length > MAX_RELATED_ORIGINS) {
    throw new Error(
      `rp.relatedOrigins: max ${MAX_RELATED_ORIGINS} entries allowed (got ${entries.length}). ` +
      `Browser Related Origin Requests support a minimum of 5 unique labels; ` +
      `more entries are silently ignored by Chrome/Safari.`,
    );
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== 'object' || typeof e.origin !== 'string' || typeof e.rpId !== 'string') {
      throw new Error(`rp.relatedOrigins[${i}]: must be { origin: string; rpId: string }`);
    }
    if (e.origin.includes('*') || e.rpId.includes('*')) {
      throw new Error(`rp.relatedOrigins[${i}]: wildcards are not permitted (got origin="${e.origin}" rpId="${e.rpId}")`);
    }
    const isHttps = HTTPS_RE.test(e.origin);
    const isLocalhostHttp = LOCALHOST_HTTP_RE.test(e.origin) && e.rpId === 'localhost';
    if (!isHttps && !isLocalhostHttp) {
      throw new Error(
        `rp.relatedOrigins[${i}]: origin must be https:// (got "${e.origin}"). ` +
        `http:// is only permitted when rpId === "localhost".`,
      );
    }
    if (!RPID_RE.test(e.rpId)) {
      throw new Error(`rp.relatedOrigins[${i}]: rpId "${e.rpId}" is not a valid host`);
    }
    // Suffix-domain check: host(origin) ends with rpId at a label boundary
    let host: string;
    try {
      host = new URL(e.origin).hostname.toLowerCase();
    } catch {
      throw new Error(`rp.relatedOrigins[${i}]: origin "${e.origin}" is not a valid URL`);
    }
    const rpIdLower = e.rpId.toLowerCase();
    const isExact = host === rpIdLower;
    const isSubdomain = host.endsWith('.' + rpIdLower);
    if (!isExact && !isSubdomain) {
      throw new Error(
        `rp.relatedOrigins[${i}]: origin host "${host}" is not a suffix-domain of rpId "${e.rpId}". ` +
        `WebAuthn requires the assertion's effective domain be equal to or a subdomain of rpId.`,
      );
    }
    // Reject duplicates of the primary rp (silently dropping is an anti-pattern; reject loudly).
    if (e.origin === primaryOrigin && e.rpId === primaryRpId) {
      throw new Error(
        `rp.relatedOrigins[${i}]: duplicates the primary rp { origin: "${primaryOrigin}", rpId: "${primaryRpId}" }. ` +
        `The primary rp is implicit; do not list it in relatedOrigins.`,
      );
    }
  }
  return [...entries];  // freeze the array for downstream callers
}
```

**Why this analog:** `src/server/codename.ts:isValidCodename` and `src/server/backup.ts:deriveBackupEligibility` are the project's two precedents for pure-function server helpers with no DB, no logger, no I/O. Both have corresponding `__tests__/<name>.test.ts` files with describe/it/expect-only structure. `validateRelatedOrigins` fits this exact mould — it's slightly larger but still pure, still synchronous, still testable in isolation.

[CITED: src/server/codename.ts:1-30, src/server/backup.ts:1-40, .planning/phases/11-backup-eligibility-flags-hooks-scaffolding/11-PATTERNS.md "Pattern S2"]

### Pattern 3: Type widening for backwards compatibility — `string` → `string | string[]`

**What:** Widen a parameter type from `string` to `string | string[]` while leaving the existing `string` callers compiling unchanged.

**When to use:** When the underlying library already accepts both forms (as `@simplewebauthn/server@13.x` does for `expectedOrigin` / `expectedRPID`), and the wrapper's stricter type was a defensive choice that's now blocking a feature.

**Example (RPID-04 — both standalone exports):**
```typescript
// src/server/webauthn.ts — BEFORE (lines 89-98)
export interface VerifyRegistrationInput {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  /** Expected origin (e.g., 'https://example.com') */
  expectedOrigin: string;
  /** Expected RP ID (e.g., 'example.com') */
  expectedRPID: string;
}

// src/server/webauthn.ts — AFTER (Phase 12)
export interface VerifyRegistrationInput {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  /** Expected origin (e.g., 'https://example.com'). Pass an array for cross-domain
   *  passkey support — see RPID-04 in CHANGELOG. The library validates origin
   *  membership via `Array.includes`; pair-with-rpID enforcement is the caller's
   *  responsibility (see Phase 12 README "Multi-RP_ID Verification"). */
  expectedOrigin: string | string[];
  /** Expected RP ID (e.g., 'example.com'). Pass an array for cross-domain support. */
  expectedRPID: string | string[];
}
// VerifyAuthenticationInput gets the identical change.

export async function verifyRegistration(input: VerifyRegistrationInput): Promise<VerifyRegistrationResult> {
  const { response, expectedChallenge, expectedOrigin, expectedRPID } = input;
  // No transformation needed — pass through directly. The library handles both shapes.
  const verification = await verifyRegistrationResponse({
    response: response as ...,
    expectedChallenge,
    expectedOrigin,    // string | string[] — passed through verbatim
    expectedRPID,      // string | string[] — passed through verbatim
  });
  // ... unchanged
}
```

**Why this is safe:** [VERIFIED: `node_modules/@simplewebauthn/server/esm/registration/verifyRegistrationResponse.d.ts:25-26`] The library's published types already accept `expectedOrigin: string | string[]` and `expectedRPID?: string | string[]`. The Phase 12 type widening is a **wrapper-side relaxation** — the underlying capability has been there since v8.

[CITED: REQUIREMENTS.md RPID-04, src/server/webauthn.ts:89-127]

### Anti-Patterns to Avoid

- **Parallel arrays for related origins/rpIds:** see Pattern 1. The whole R3 defense rests on the paired-tuple shape; any "for ergonomics, accept two arrays too" overload reintroduces drift risk.
- **Silent-skip on validation failure:** `relatedOrigins` validation MUST throw, not log-and-continue. The locked decision (REQUIREMENTS.md RPID-02) is "throws with classified message at startup". A misconfigured production deploy with silently-dropped related origins fails *open* — passkeys from the supposed-related domain stop working with no signal until users complain.
- **Auto-hosting `/.well-known/webauthn`:** explicitly out of scope (REQUIREMENTS.md "Out of Scope" table). The library does not own request routing for arbitrary `.well-known/*` paths; injecting one into the consumer's Express app is a layering violation. Defer to RPID-V2-01/02.
- **Trusting `verify*Response`'s independent membership for pairing:** the library does NOT enforce origin↔rpId pairing. If Phase 12 ever needed to expose a "raw two-array" passthrough, it would have to add a runtime tuple check before spreading; the paired-tuple config avoids this entirely.
- **Mutating `config.rp.relatedOrigins` in place:** validation should return a fresh array (or be no-op and let downstream code use the original). Mutation in-place is non-idiomatic for the codebase and hostile to consumers passing a frozen config object.
- **Adding `relatedOrigins` to non-passkey verification paths:** OAuth callbacks, recovery flows, and session validation do NOT call `verify*Response`. There is no parallel "OAuth multi-domain" surface in this phase. The only call sites are register-verify and auth-verify in `passkey.ts` and the two standalone exports in `webauthn.ts`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Verifying multiple origins / rpIds against an assertion | Custom rpIdHash matching, custom origin string compare | `@simplewebauthn/server@13.2.3` already accepts `expectedOrigin: string \| string[]` and `expectedRPID: string \| string[]` and does `Promise.any(matchExpectedRPID(...))` internally | Hand-rolling rpIdHash matching means hand-rolling SHA-256-of-rpId-hash comparison; the library's `matchExpectedRPID` helper handles AggregateError unwrapping and constant-time concerns. [VERIFIED: matchExpectedRPID.js:9-34] |
| `/.well-known/webauthn` HTTP serving | Custom Express route, custom CDN edge worker | The consumer's existing static file pipeline (Next.js `public/`, Vercel/Cloudflare static asset, S3+CloudFront, etc.) | Hosting `.well-known/*` is a per-deployment concern; the library has no view into the consumer's hosting topology. RPID-V2-01/02 explicitly defer in-library helpers; the library's job is to document the contract. [CITED: REQUIREMENTS.md "Out of Scope"] |
| Browser-side allowlist enforcement | Custom JavaScript fetching the well-known doc | Native browser support — Chrome/Edge ≥ 128 and Safari 18 implement Related Origin Requests; the browser fetches and validates the JSON automatically when an RP-ID-mismatch occurs | The browser is the only correct place to enforce this; client-side JS would be trivially bypassable. [CITED: web.dev/articles/webauthn-related-origin-requests, passkeys.dev/docs/advanced/related-origins/] |
| eTLD+1 / Public Suffix List parsing | Custom suffix-list-aware host parser | Library does NOT need PSL awareness for Phase 12. The "host is a suffix-domain of rpId" check (string suffix at a label boundary) is sufficient because: (a) browser ROR enforces eTLD+1 ≤ 5 labels server-side independently of the library, (b) the library's rpId is consumer-supplied — the consumer's deployment choice is what makes it valid, not the library's PSL parsing | Dragging in `psl` or `tldjs` is a new dependency for a check the browser does anyway. The library's job is shape validation (https, no wildcards, suffix-domain, count). [VERIFIED: REQUIREMENTS.md "Zero new dependencies"] |
| URL parsing | Regex-only validation of origin URLs | `new URL(origin)` from the standard library, throw on invalid | `URL` is in Node's standard library (no dep); regex-only origin validation has too many edge cases (Punycode, port handling, IPv6 brackets, fragment/query injection). Use `new URL(...)` for the host extraction step inside `validateRelatedOrigins`. |

**Key insight:** The library's contribution to multi-RP-ID verification is **config shape + validation + parameter spread**. The crypto, the browser allowlist, and the static file hosting are all owned by other layers. Phase 12 should resist the temptation to add anything beyond those three responsibilities — every additional concern is either defended elsewhere or explicitly deferred.

---

## Common Pitfalls

### Pitfall 1: Origin-spoofing via parallel-array index drift (R3 — load-bearing defense)

**What goes wrong:** A consumer (or a future refactor) passes `origins=[A, B]` and `rpIds=[idA, idB]` as parallel arrays. Some `.map()` or `.filter()` between config and call site reorders one array. `verifyAuthenticationResponse` accepts because origin and rpId memberships are checked independently. The result: a passkey registered for `(originB, idB)` succeeds when presented from `originA + idA` — assuming an attacker can get `originA`'s `.well-known/webauthn` to allowlist `originB`. The library has no way to detect the mis-pairing.

**Why it happens:** `@simplewebauthn/server@13.x` does NOT cross-check origin↔rpId pairing. [VERIFIED: `verifyAuthenticationResponse.js:71-81` — `expectedOrigin.includes(origin)`; `matchExpectedRPID.js:9-23` — `Promise.any` over rpIds]. The two checks are fully independent.

**How to avoid:** Use the `Array<{ origin, rpId }>` paired-tuple shape **at the config layer**. The pairing is preserved by the tuple's structural identity until the spread at the call site. The spread itself can't drift because the paired-tuple iteration is one-pass: `expectedOrigin: [primary.origin, ...related.map(r => r.origin)]` and `expectedRPID: [primary.rpId, ...related.map(r => r.rpId)]` derive from the same `related` array in the same order. **No intermediate `.filter()` or `.sort()` is permitted** between validation and spread — Phase 12 plans should make this an explicit comment in `validateRelatedOrigins`'s return-value docstring.

**Warning signs:** Any code path that takes `relatedOrigins.map(r => r.origin)` and `relatedOrigins.map(r => r.rpId)` separately, stores them in different config fields, then spreads them at the call site. If the planner sees this shape, raise it immediately — pairing must be preserved end-to-end.

[CITED: REQUIREMENTS.md RPID-01 "paired tuples (NOT two parallel arrays)", STATE.md "R3 origin-spoofing defense", VERIFIED: installed library source]

### Pitfall 2: Suffix-domain check without eTLD+1 awareness

**What goes wrong:** A consumer configures `{ origin: 'https://attacker-shopping.com.evil.example', rpId: 'shopping.com' }`. A naïve suffix check (`host.endsWith(rpId)`) accepts because `'attacker-shopping.com.evil.example'.endsWith('shopping.com')` returns `false` actually — but `'evil.shopping.com'.endsWith('shopping.com')` returns `true`. The naïve check passes the second case (correct: `evil.shopping.com` IS a subdomain of `shopping.com`). The actual subtler attack: `host.endsWith('shopping.com')` matches `notshopping.com`. **Mitigation:** require the boundary to be either an exact match OR preceded by `.` — i.e., `host === rpIdLower || host.endsWith('.' + rpIdLower)`.

**Why it happens:** `String.prototype.endsWith` is a string operation, not a domain operation. It has no concept of label boundaries.

**How to avoid:** Use the boundary check shown in `validateRelatedOrigins` (Pattern 2 example): `host === rpIdLower || host.endsWith('.' + rpIdLower)`. Do NOT rely on PSL parsing for Phase 12 (locked: zero new deps); the boundary check is sufficient for shape validation, and the consumer is responsible for not configuring pathological RP IDs (e.g. an RP ID equal to a public suffix like `co.uk` would be self-defeating but the browser's own validation rejects this anyway — RP ID must not be on the Public Suffix List per WebAuthn spec).

**Warning signs:** A regex-only validator with no `new URL(...)` host extraction; a `endsWith(rpId)` without the leading `.` boundary.

[CITED: web.dev/articles/webauthn-rp-id, ASSUMED: the boundary check + consumer-supplied rpId is sufficient for Phase 12 shape validation — full PSL parsing is correctly deferred to the browser]

### Pitfall 3: `http://localhost` slipping into a non-localhost rpId

**What goes wrong:** A consumer copy-pastes a dev config snippet into prod: `{ origin: 'http://localhost:3000', rpId: 'shopping.com' }`. The HTTPS check fails, but if the validator only checks "scheme is https OR localhost" without coupling to `rpId === 'localhost'`, a misconfigured prod still passes.

**Why it happens:** Schema-level checks treat scheme and rpId as independent fields.

**How to avoid:** Couple the localhost-http exception to `rpId === 'localhost'` in a single conjunction (see `LOCALHOST_HTTP_RE` regex + `&& e.rpId === 'localhost'` in Pattern 2). Phase 12 should NOT permit `http://anything-not-localhost`.

**Warning signs:** Two separate `if` branches — `if (!isHttps)` and `if (!isLocalhost)` — without conjunction.

### Pitfall 4: Validation runs at request-time instead of startup

**What goes wrong:** Validation logic placed in `passkey.ts` (per-request) instead of `index.ts` (startup) means a misconfigured deploy boots successfully and only fails on the first registration/login attempt — which may be days or weeks later.

**Why it happens:** The "natural" place to put validation feels like "next to the consumer of the validated value", but that's the request handler.

**How to avoid:** Call `validateRelatedOrigins` inside `createAnonAuth` BEFORE any router/manager is constructed. Throw immediately. This matches the project's existing pattern at `src/server/index.ts:103-104` — `if (!config.database.connectionString) throw new Error(...)` — startup-fail-fast.

**Warning signs:** Validation logic inside `passkey.ts` or `router.ts`. Validation logic that returns `{ valid, errors }` instead of throwing.

### Pitfall 5: Stripping the primary rp from the spread, double-counting it, or muddling the order

**What goes wrong:** The expected arrays MUST include the primary rp first. If the spread is `[...related.map(r => r.origin)]` (omitting primary), the original single-domain consumer breaks. If it's `[primary, ...related, primary]`, it's wasteful (correct but ugly). If `[primary]` is appended at the END instead of the start, all existing tests still pass but the docstring contract "primary is index 0" is violated and the next refactor that depends on index ordering misbehaves.

**Why it happens:** The spread is a one-line code change; it's easy to get the ordering wrong on autopilot.

**How to avoid:** Use exactly this idiom at every call site:
```typescript
expectedOrigin: relatedOrigins.length > 0
  ? [config.origin, ...relatedOrigins.map(r => r.origin)]
  : config.origin,
expectedRPID: relatedOrigins.length > 0
  ? [config.rpId, ...relatedOrigins.map(r => r.rpId)]
  : config.rpId,
```
The conditional preserves backwards compatibility for the standalone single-domain case (the `string` form) while adding the array form only when needed. Tests assert primary at index 0.

**Warning signs:** Spread order varies between register and auth call sites; primary missing entirely from one site; `string` form replaced with single-element array unconditionally.

### Pitfall 6: BS bit re-read interaction with `relatedOrigins` (no interaction — but worth noting)

**What goes wrong:** A reader unfamiliar with Phase 11 might assume `relatedOrigins` somehow affects the BE/BS bit handling.

**Why it happens:** Phase 11 also touched `passkey.ts` and `webauthn.ts`; both phases' diffs land in close proximity.

**How to avoid:** State explicitly in the Phase 12 plan that the BS bit re-read pattern (Phase 11, BACKUP-02) is **independent** of `relatedOrigins`. The fresh `verification.authenticationInfo.credentialBackedUp` and `credentialDeviceType` are read regardless of which rpId / origin matched. No cross-phase test interaction exists.

**Warning signs:** A test that toggles `relatedOrigins` and asserts something about `passkey.backedUp`. There should be none.

---

## Code Examples

Verified patterns from official sources and in-repo precedent.

### Spread paired arrays at the verifyRegistrationResponse call site (RPID-03)

```typescript
// src/server/passkey.ts — finishRegistration (lines 169-182, MODIFY)
// Source: existing call site + REQUIREMENTS.md RPID-03
//
// Before Phase 12:
//   expectedOrigin: config.origin,
//   expectedRPID: config.rpId,
//
// After Phase 12: paired-tuple spread, primary at index 0.
verification = await verifyRegistrationResponse({
  response: response as unknown as Parameters<typeof verifyRegistrationResponse>[0]['response'],
  expectedChallenge: challenge.challenge,
  expectedOrigin: config.relatedOrigins.length > 0
    ? [config.origin, ...config.relatedOrigins.map(r => r.origin)]
    : config.origin,
  expectedRPID: config.relatedOrigins.length > 0
    ? [config.rpId, ...config.relatedOrigins.map(r => r.rpId)]
    : config.rpId,
} as VerifyRegistrationResponseOpts);
```

```typescript
// src/server/passkey.ts — finishAuthentication (lines 277-290, MODIFY)
verification = await verifyAuthenticationResponse({
  response: response as unknown as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
  expectedChallenge: challenge.challenge,
  expectedOrigin: config.relatedOrigins.length > 0
    ? [config.origin, ...config.relatedOrigins.map(r => r.origin)]
    : config.origin,
  expectedRPID: config.relatedOrigins.length > 0
    ? [config.rpId, ...config.relatedOrigins.map(r => r.rpId)]
    : config.rpId,
  credential: { id: passkey.credentialId, publicKey: passkey.publicKey, counter: passkey.counter, transports: passkey.transports },
} as VerifyAuthenticationResponseOpts);
```

**Why the conditional:** Backwards compatibility — the `string` form preserves the v0.6.1 behavior byte-identically when `relatedOrigins.length === 0`. Existing snapshot/golden tests do not need to change.

### `PasskeyConfig` extension (passkey.ts:36-47)

```typescript
// src/server/passkey.ts — PasskeyConfig (MODIFY)
import type { RelatedOrigin } from '../types/index.js';

export interface PasskeyConfig {
  rpName: string;
  rpId: string;
  origin: string;
  /** Phase 12 — already-validated related origins (paired tuples). Empty array
   *  for single-domain deployments. Populated by createAnonAuth() after
   *  validateRelatedOrigins() succeeds. Required (not optional) because
   *  createAnonAuth always passes at least []. */
  relatedOrigins: readonly RelatedOrigin[];
  challengeTimeoutMs?: number;
  logger?: Logger;
}
```

**Note:** `relatedOrigins` is **required** in `PasskeyConfig` (not `?:`) but the factory always passes `[]` when the consumer's `AnonAuthConfig.rp.relatedOrigins` is undefined. This makes the spread logic at call sites cleaner (no `?? []`) and makes "consumer didn't supply" indistinguishable from "consumer supplied empty array".

### `createAnonAuth` validation hook (index.ts:125-137)

```typescript
// src/server/index.ts — createAnonAuth (MODIFY around lines 125-137)
import { validateRelatedOrigins } from './relatedOrigins.js';

const rpConfig = config.rp || {
  name: 'Anonymous Auth',
  id: 'localhost',
  origin: 'http://localhost:3000',
};

// Phase 12 RPID-02: throw at startup on misconfiguration.
const relatedOrigins = validateRelatedOrigins(
  config.rp?.relatedOrigins,
  rpConfig.id,
  rpConfig.origin,
);

const passkeyManager = createPasskeyManager(db, {
  rpName: rpConfig.name,
  rpId: rpConfig.id,
  origin: rpConfig.origin,
  relatedOrigins,                  // ← Phase 12 thread-through
  logger,
});
```

### `/.well-known/webauthn` JSON skeleton (RPID-05 README)

```json
{
  "origins": [
    "https://shopping.co.uk",
    "https://shopping.ie",
    "https://shopping.ca"
  ]
}
```

**Hosting requirements (consumer responsibility):**
- URL: `https://{primaryRpId}/.well-known/webauthn` — e.g. `https://shopping.com/.well-known/webauthn`
- `Content-Type: application/json`
- HTTPS only (browsers will not fetch over plain HTTP for a non-localhost rpId)
- Origins matching the primary RP ID itself MUST NOT be included — the primary is implicit
- Maximum 5 unique eTLD+1 labels — entries beyond the 5-label cap are silently ignored by Chrome/Safari
- No wildcards in the array

[CITED: passkeys.dev/docs/advanced/related-origins/, web.dev/articles/webauthn-related-origin-requests]

### Backwards-compat assertion test pattern

```typescript
// src/__tests__/related-origins.test.ts — backwards-compat shape
describe('RPID-04: standalone verifyRegistration backwards compat (string form)', () => {
  it('compiles and runs unchanged when expectedRPID and expectedOrigin are strings', async () => {
    // Existing v0.6.1 caller pattern continues to type-check.
    const _input: VerifyRegistrationInput = {
      response: makeFakeRegistrationResponse(),
      expectedChallenge: 'abc',
      expectedOrigin: 'https://example.com',  // string form
      expectedRPID: 'example.com',             // string form
    };
    expect(_input.expectedOrigin).toBe('https://example.com');
  });

  it('compiles when expectedRPID and expectedOrigin are arrays', () => {
    const _input: VerifyRegistrationInput = {
      response: makeFakeRegistrationResponse(),
      expectedChallenge: 'abc',
      expectedOrigin: ['https://example.com', 'https://example.co.uk'],
      expectedRPID: ['example.com', 'example.co.uk'],
    };
    expect(_input.expectedOrigin).toHaveLength(2);
  });
});
```

### Attack-simulation test pattern (R3 defense verification)

```typescript
// src/__tests__/related-origins.test.ts — origin-spoofing attack
describe('RPID-03: forged clientDataJSON.origin from evil.com is rejected', () => {
  it('returns verified: false when assertion origin is not in expectedOrigin array', async () => {
    // Construct an assertion whose clientDataJSON.origin is 'https://evil.com'
    // and submit it to a multi-RP-ID-configured library instance.
    const evilAssertion = makeAssertionWithForgedOrigin({
      forgedOrigin: 'https://evil.com',
      legitChallenge: 'b64-challenge',
    });
    const result = await verifyAuthentication({
      response: evilAssertion,
      expectedChallenge: 'b64-challenge',
      expectedOrigin: ['https://shopping.com', 'https://shopping.co.uk'],  // 'evil.com' NOT in list
      expectedRPID: ['shopping.com', 'shopping.co.uk'],
      credential: makeStoredCredential(),
    });
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/Unexpected.*origin/i);
  });
});
```

This exercises the library's `expectedOrigin.includes(origin)` rejection path. [VERIFIED: verifyAuthenticationResponse.js:71-75 throws `Unexpected authentication response origin "${origin}", expected one of: ...`]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `expectedRPID: string` only — single-domain passkey deployments | `expectedRPID: string \| string[]` accepted by `@simplewebauthn/server` | Library v8+ (current 13.2.3) | Phase 12 type-widens the wrapper; the underlying capability has been there for years |
| Cross-domain passkey via separate registrations on each domain (UX nightmare) | Browser-side Related Origin Requests (`/.well-known/webauthn`) | Chrome 128 (Aug 2024) and Safari 18 (Sep 2024) shipped support; Firefox standards-position positive (March 2026), no implementation timeline | Single passkey works across allowlisted related domains. Firefox users see `SecurityError` — graceful degradation: those users register a separate passkey per domain |
| Server-side allowlist as a parallel-array config | Paired-tuple `Array<{ origin, rpId }>` | This phase (Phase 12 of `near-phantom-auth`) | R3 origin-spoofing defense; eliminates index-drift attack surface |

**Deprecated/outdated:** None applicable. All approaches recommended in this research are current as of 2026-04-29 against `@simplewebauthn/server@13.2.3`, browser support matrix as of Q1 2026, and W3C WebAuthn Level 3 working drafts.

---

## Project Constraints (from REQUIREMENTS.md / STATE.md)

These directives carry the same authority as locked decisions:

- **Anonymity invariant non-negotiable** — `relatedOrigins` is configuration, not user data; no PII implications, but Phase 13 analytics events that include `rpId` must remain in the existing whitelist (no new PII surface)
- **`MPCAccountManager` contract FROZEN** — Phase 12 does not touch `mpc.ts`
- **Zero new dependencies** — `validateRelatedOrigins` is hand-rolled (no `psl`, `tldjs`, `tsd`); reuses existing `URL` (Node std), `zod` (already installed), and the `__tsc_fail/`-style fixture pattern from `mpc-treasury-leak.test.ts`
- **Additive-only contract** — `relatedOrigins?` is optional; absence == `[]` == v0.6.1 behavior byte-identical
- **System Node is v12; must use `nvm use 20`** for `npm test` and any GSD tool — applies to every Phase 12 task that runs vitest
- **zod for runtime validation** — recommended for the structural shape check inside `validateRelatedOrigins` if the planner prefers it over hand-rolled type guards
- **pino externalized** — no new log lines required by Phase 12 (validation throws; failure surfaces as Error not log)

---

## Runtime State Inventory

Phase 12 is NOT a rename/refactor/migration phase — it adds a new optional config field and a validation helper. No existing strings, identifiers, or stored data change names or values. The Runtime State Inventory categories therefore evaluate as:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB schema change. Existing `anon_passkeys` rows continue to verify against the (newly-array-typed) primary rpId. | None |
| Live service config | None — the library does not read external service config. The consumer hosts `/.well-known/webauthn`, but that's deployment configuration not in scope here. | None — RPID-05 README documents the consumer responsibility |
| OS-registered state | None | None |
| Secrets/env vars | None — `relatedOrigins` is non-secret config | None |
| Build artifacts | None — additive optional types do not change the dist's runtime shape | None — verify via `npm run build` after changes that the `dist/server/index.{js,d.ts}` build succeeds and the new `RelatedOrigin` type is exported |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | `vitest.config.ts` (globals: true, environment: node) |
| Quick run command | `nvm use 20 && npm test -- --run src/__tests__/related-origins.test.ts` |
| Full suite command | `nvm use 20 && npm test -- --run` |
| Baseline | 252+ tests passing as of Phase 11 close (re-baseline before starting Phase 12 via `nvm use 20 && npm test -- --run` to capture exact count) |
| Estimated runtime | ~30 seconds |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RPID-01 | `AnonAuthConfig.rp.relatedOrigins` accepts `Array<{ origin, rpId }>`; `[]` is default; absent === `[]` | unit (compile fixture + assert) | `npm test -- --run src/__tests__/related-origins.test.ts` | ❌ Wave 0 |
| RPID-02 (max 5) | 6 entries throws | unit | `npm test -- --run src/__tests__/related-origins.test.ts` | ❌ Wave 0 |
| RPID-02 (https) | `http://example.com` (non-localhost) throws | unit | (same) | ❌ Wave 0 |
| RPID-02 (localhost-http) | `http://localhost` with `rpId: 'localhost'` is accepted; `http://localhost` with `rpId: 'shopping.com'` throws | unit | (same) | ❌ Wave 0 |
| RPID-02 (no wildcards) | `https://*.example.com` throws | unit | (same) | ❌ Wave 0 |
| RPID-02 (suffix-domain) | `{ origin: 'https://attacker.com', rpId: 'shopping.com' }` throws; `{ origin: 'https://shopping.co.uk', rpId: 'shopping.co.uk' }` accepted; `{ origin: 'https://login.shopping.co.uk', rpId: 'shopping.co.uk' }` accepted; `{ origin: 'https://notshopping.com', rpId: 'shopping.com' }` throws (boundary check) | unit | (same) | ❌ Wave 0 |
| RPID-03 (passkey.ts spread) | `verifyRegistrationResponse` and `verifyAuthenticationResponse` receive arrays when `relatedOrigins.length > 0`, primary at index 0 | unit (mock the library; spy on call args) | `npm test -- --run src/__tests__/related-origins.test.ts` | ❌ Wave 0 |
| RPID-03 (string form preserved) | When `relatedOrigins.length === 0`, `verifyRegistrationResponse` receives `string` form for both fields (backwards compat) | unit (spy + arg shape assertion) | (same) | ❌ Wave 0 |
| RPID-03 (attack simulation) | Forged `clientDataJSON.origin: 'evil.com'` against a multi-RPID instance returns `verified: false` | unit (build forged assertion or use library mock) | (same) | ❌ Wave 0 |
| RPID-04 (verifyRegistration types) | `expectedRPID: string \| string[]` and `expectedOrigin: string \| string[]` compile in both forms | unit (positive compile fixture) | `npm test -- --run src/__tests__/related-origins.test.ts` | ❌ Wave 0 (or extend `passkey.test.ts` if planner prefers) |
| RPID-04 (verifyAuthentication types) | Same widening on standalone `verifyAuthentication` | unit (positive compile fixture) | (same) | ❌ Wave 0 |
| RPID-04 (backwards compat) | Existing `string`-form callers in `src/__tests__/passkey.test.ts` continue to pass without changes | unit (rerun existing) | `npm test -- --run src/__tests__/passkey.test.ts` | ✅ existing |
| RPID-04 (tsc-fail — optional) | A fixture that supplies `expectedRPID: number` fails tsc | unit (tsc-fail fixture) | `npm test -- --run src/__tests__/related-origins.test.ts` | ❌ Wave 0 — OPTIONAL, planner's discretion |
| RPID-05 (README skeleton) | README contains `/.well-known/webauthn` JSON skeleton + passkeys.dev link + W3C link + "library does NOT auto-host" callout | doc snapshot / grep test | `npm test -- --run src/__tests__/exports.test.ts` (extend with grep on `README.md`) | partial — exports.test grep pattern is in repo |
| Backwards-compat (single-RP) | Existing single-domain consumer (no `rp.relatedOrigins`) sees byte-identical `verify*Response` opts shape (string, not array) | unit (mock spy on opts shape) | `npm test -- --run src/__tests__/registration-auth.test.ts` | ✅ existing — extend |

### Sampling Rate

- **Per task commit:** `nvm use 20 && npm test -- --run src/__tests__/related-origins.test.ts` (~3s, focused)
- **Per wave merge:** `nvm use 20 && npm run build && npm run typecheck && npm test -- --run` (full suite + build + tsc)
- **Phase gate:** Full suite green + `npm run build` succeeds + `npm run typecheck` succeeds before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/__tests__/related-origins.test.ts` — covers RPID-01 / RPID-02 / RPID-03 / RPID-04 (positive + negative cases, paired-tuple spread, attack simulation)
- [ ] `src/server/relatedOrigins.ts` — pure-function `validateRelatedOrigins` helper (CREATE). Depends on `src/types/index.ts` having the `RelatedOrigin` type — task ordering: types first, helper second, integration third.
- [ ] (Optional) `__tsc_fail/`-style fixture inside `related-origins.test.ts` — only if the planner wants tsc-level "non-paired-tuple shape rejected" guarantee. Recommendation: SKIP; the positive vitest type-check (file compiles → contract held) is sufficient because RPID-01 does not impose required-field constraints (the field itself is `?:`).

*(Existing test infrastructure — vitest config, supertest pattern, mock factories from `registration-auth.test.ts`, `__tsc_fail` precedent from `mpc-treasury-leak.test.ts:212-241` — covers all other Phase 12 verifications without changes.)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `@simplewebauthn/server` performs all crypto verification — Phase 12 only widens the input shape. The fundamental anti-phishing guarantee (origin embedded in signed clientDataJSON) is preserved [CITED: web.dev/articles/webauthn-related-origin-requests "ROR does not weaken phishing protection"] |
| V3 Session Management | no — session creation untouched | — |
| V4 Access Control | yes (peripheral) | The set of allowed RP IDs/origins is the access-control surface; misconfiguration could allow unintended cross-domain access. Mitigated by RPID-02 startup validation |
| V5 Input Validation | yes | `validateRelatedOrigins` performs server-side input validation on a config field; it MUST throw rather than log-and-skip (RPID-02 contract) |
| V6 Cryptography | no — no new crypto | — |
| V8 Data Protection | no — `relatedOrigins` is non-sensitive config | — |
| V11 Business Logic | yes | The paired-tuple invariant is a business-logic constraint enforced by the type system + startup validation (R3 defense — see Pitfall 1) |

### Known Threat Patterns for `near-phantom-auth + multi-RPID config`

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Origin-spoofing via parallel-array index drift | Tampering | RPID-01 paired-tuple config + RPID-03 in-place spread (no intermediate `.filter`/`.sort`) — see Pitfall 1 |
| `http://` non-localhost slipping into prod | Tampering / Spoofing | RPID-02 `LOCALHOST_HTTP_RE && rpId === 'localhost'` conjunction — see Pitfall 3 |
| Wildcard origin (e.g., `https://*.example.com`) accepted | Tampering | RPID-02 explicit wildcard rejection (`e.origin.includes('*')`) |
| Non-suffix-domain origin paired with rpId | Tampering | RPID-02 boundary-aware suffix check (`host === rpId \|\| host.endsWith('.' + rpId)`) — see Pitfall 2 |
| Validation deferred to request-time | DoS (delayed-fail-late) | RPID-02 startup validation — see Pitfall 4 |
| Misconfigured `/.well-known/webauthn` (consumer-hosted, library cannot validate) | Tampering / Information Disclosure | RPID-05 README documents the contract; consumer owns the file. Browser ROR validation is the ultimate enforcement point |
| Auto-hosting `.well-known` route accidentally introduced | Confused Deputy | OUT OF SCOPE per REQUIREMENTS.md; no Express route changes in Phase 12 |
| Anonymity invariant breach via `rpId` analytics | Information Disclosure | `rpId` is already in the Phase 13 analytics whitelist (per ANALYTICS-02); no new PII surface |

---

## Sources

### Primary (HIGH confidence)

- `node_modules/@simplewebauthn/server/esm/authentication/verifyAuthenticationResponse.js` lines 71-81 (origin includes), 100-111 (matchExpectedRPID call) — verified library does NOT cross-check origin↔rpId pairing
- `node_modules/@simplewebauthn/server/esm/authentication/verifyAuthenticationResponse.d.ts` lines 22-33 — confirms `expectedOrigin: string | string[]`, `expectedRPID: string | string[]` typed
- `node_modules/@simplewebauthn/server/esm/registration/verifyRegistrationResponse.d.ts` lines 25-26 — same multi-value support on registration
- `node_modules/@simplewebauthn/server/esm/helpers/matchExpectedRPID.js` lines 9-34 — `Promise.any` over rpId candidates (independent membership)
- `node_modules/@simplewebauthn/server/package.json` — version 13.2.3 confirmed installed
- `src/server/passkey.ts` lines 36-47, 100-137, 169-182, 277-290 — current call sites + PasskeyConfig interface
- `src/server/webauthn.ts` lines 89-127, 159-179, 256-294, 337-371 — current standalone surface + JSDoc patterns
- `src/server/index.ts` lines 90-220 — current `createAnonAuth` flow + factory thread-through pattern
- `src/types/index.ts` lines 65-162 — current `AnonAuthConfig` shape + Phase 11 `AnonAuthHooks` precedent
- `.planning/phases/11-backup-eligibility-flags-hooks-scaffolding/11-PATTERNS.md` — full pattern map for Phase 11; Phase 12 mirrors S1 (optional config field), S2 (pure helper), S3 (factory thread-through), S5 (tsc-fail fixture)
- `.planning/REQUIREMENTS.md` lines 41-47 (RPID-01..05), lines 82-84 (V2 deferred items), lines 100-105 ("Out of Scope" callouts)
- `.planning/STATE.md` lines 79-81 (R3 origin-spoofing locked decision)
- `src/__tests__/mpc-treasury-leak.test.ts` lines 211-241 — `__tsc_fail/`-style fixture precedent
- `src/__tests__/exports.test.ts` lines 47-95 — type re-export and source-grep precedent
- [passkeys.dev/docs/advanced/related-origins/](https://passkeys.dev/docs/advanced/related-origins/) — JSON skeleton, label rule, RP relationship rule, content-type rule
- [web.dev/articles/webauthn-related-origin-requests](https://web.dev/articles/webauthn-related-origin-requests) — browser support matrix, server vs browser responsibility split, anti-phishing guarantee preserved
- [web.dev/articles/webauthn-rp-id](https://web.dev/articles/webauthn-rp-id) — registrable suffix definition, eTLD+1 explanation, RP ID validation rules

### Secondary (MEDIUM confidence — cross-verified with primary)

- [github.com/MasterKale/SimpleWebAuthn/issues/90](https://github.com/MasterKale/SimpleWebAuthn/issues/90) — historical context: multi-RPID/origin support was added by user request (PR#91) early in the library's history
- [corbado.com/blog/webauthn-related-origins-cross-domain-passkeys](https://www.corbado.com/blog/webauthn-related-origins-cross-domain-passkeys) — independent confirmation of HTTPS requirement, label-counting rule, server-side origin verification mandate
- [corbado.com/blog/webauthn-relying-party-id-rpid-passkeys](https://www.corbado.com/blog/webauthn-relying-party-id-rpid-passkeys) — RP ID + Public Suffix List interaction (used to confirm "library does not need PSL parsing")
- [developer.chrome.com/blog/passkeys-updates-chrome-129](https://developer.chrome.com/blog/passkeys-updates-chrome-129) — Chrome's ROR shipping context (Chrome 128/129 generation)
- [simplewebauthn.dev/docs/packages/server](https://simplewebauthn.dev/docs/packages/server) — official confirmation that v13 documents array-form support

### Tertiary (LOW confidence — informational only)

- [github.com/w3c/webauthn/issues/2319](https://github.com/w3c/webauthn/issues/2319) — historical W3C discussion on related-origins enabling sharing across RPs

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `validateRelatedOrigins` should live in a new sibling file (`src/server/relatedOrigins.ts`) rather than inlined in `src/server/index.ts` | Pattern 2 | Low — if planner prefers inlining, the existing `database.connectionString` startup check is the analog; inlining works but reduces unit-test isolation |
| A2 | The boundary-aware suffix check (`host === rpIdLower \|\| host.endsWith('.' + rpIdLower)`) is sufficient without PSL parsing | Pitfall 2 | Medium — a misconfigured rpId equal to a public suffix (e.g., `co.uk`) would be self-defeating but not blocked by the helper. Mitigation: the WebAuthn spec already forbids RP IDs on the PSL [CITED: web.dev/articles/webauthn-rp-id]; browsers reject the registration before assertion ever reaches the server. The helper does not need to re-enforce. |
| A3 | The duplicate-of-primary check (rejecting `relatedOrigins[i] === { origin: primaryOrigin, rpId: primaryRpId }`) should THROW rather than silently dedupe | Pattern 2 | Low — the planner could choose silent dedupe; throwing is more "fail loud", aligned with the rest of RPID-02's contract. |
| A4 | `PasskeyConfig.relatedOrigins` should be required (not `?:`), with the factory always passing `[]` for absent consumer config | "Code Examples / PasskeyConfig extension" | Low — cleaner downstream call sites (no `?? []`); preserves a single normal form |
| A5 | The standalone `verifyAuthentication()` widens types in this phase even though only RPID-04's text mentions "verifyRegistration() and verifyAuthentication()" — both standalone exports get the widening | RPID-04 mapping | Low — the requirement explicitly names both; no risk |
| A6 | Browser caching of `/.well-known/webauthn` is intentionally undocumented in passkeys.dev / web.dev as of 2026-04 — the library should not rely on any specific caching behavior in its README | "Sources / browser caching" | Low — README's only guidance is "consumer hosts the file"; cache control headers are out of scope |
| A7 | `tsd` is NOT a worthwhile dev dependency for Phase 12; reuse the in-repo `__tsc_fail/`-style fixture pattern from `mpc-treasury-leak.test.ts:212-241` | Validation Architecture | Low — saves a dev dep; risk is the fixture pattern's slight runtime cost (~10s extra per tsc-fail test). Skipping the optional tsc-fail entirely is also acceptable. |
| A8 | No new validation-related zod schema is required at the request body level (since `relatedOrigins` is config, not request data); existing `registerFinishBodySchema` / `loginFinishBodySchema` are unchanged | "Standard Stack" | Low — verified by reading current schemas |

If the planner finds any A-row uncomfortable, the cheapest mitigation is to flag the decision in `/gsd-discuss-phase` before plan creation.

---

## Open Questions

1. **Validation helper file location**
   - What we know: Phase 11 created `src/server/backup.ts` as a sibling helper; Phase 12 has a similarly pure-function helper.
   - What's unclear: Whether a single phase 12 helper warrants its own file (`src/server/relatedOrigins.ts`) or should live inside `src/server/index.ts` next to the database validation.
   - Recommendation: NEW file, mirroring `backup.ts` pattern. Better testability, single responsibility. Planner can override to inline if the team prefers fewer files.

2. **Whether a tsc-fail fixture is required**
   - What we know: `mpc-treasury-leak.test.ts:211-241` established the pattern; Phase 11 chose to skip it for `hooks-scaffolding.test.ts` (positive vitest fixture sufficed).
   - What's unclear: Whether RPID-04's "type widening" warrants a tsc-fail fixture for "non-paired-tuple shape rejected".
   - Recommendation: SKIP. RPID-01 doesn't impose required-field constraints (`relatedOrigins?:` is optional); a positive compile fixture demonstrating "the paired-tuple shape compiles, the parallel-array shape would be a different field name and therefore wouldn't compile because that field doesn't exist" is sufficient.

3. **Attack-simulation test fidelity**
   - What we know: Constructing a forged WebAuthn assertion with a custom `clientDataJSON.origin` is non-trivial — it requires either (a) a full crypto-signing flow with a test keypair (heavyweight) or (b) mocking `verifyAuthenticationResponse` to assert it would reject (lightweight, but tests the wrapper not the library).
   - What's unclear: Whether the planner wants (a) a high-fidelity end-to-end test that signs a forged assertion or (b) a lightweight "the library throws on `expectedOrigin.includes(badOrigin) === false`" test.
   - Recommendation: (b). The library's rejection logic is already proven; Phase 12's contribution is ensuring the wrapper PASSES the array form correctly. A lightweight mock that asserts `verifyAuthenticationResponse` was called with the array form (and that bad-origin inputs would be rejected by `Array.includes`) is sufficient.

4. **Should Phase 12 emit a startup log line on `relatedOrigins.length > 0`?**
   - What we know: The locked behavior is "throw on misconfiguration"; success is silent.
   - What's unclear: Whether a `log.info({ rpId, relatedRpIds: [...] }, 'Multi-RP-ID enabled')` line is desirable for operator observability.
   - Recommendation: SKIP for Phase 12. Phase 13 analytics will own observability for runtime events; startup-time config logging is not the library's pattern (zero existing log.info on `createAnonAuth` for other config branches). The planner can revisit if operator feedback requests it.

5. **README placement of `/.well-known/webauthn` skeleton**
   - What we know: RPID-05 says "README documents". The current README does not have a "Multi-RP-ID" section.
   - What's unclear: Whether the section goes under "Hooks (v0.7.0)" (the new top-level section per RELEASE-01) or under a new "Cross-Domain Passkeys (v0.7.0)" section.
   - Recommendation: NEW section "Cross-Domain Passkeys (v0.7.0) — Multi-RP-ID Verification" parallel to "Hooks (v0.7.0)". The two features are orthogonal and a single README can hold both.

---

## Environment Availability

This phase depends only on tools and packages already installed and verified by Phase 11.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (via nvm) | vitest, build | ✓ (via `nvm use 20`) | v20.x | None — Node v12 is the system default per MEMORY.md and CANNOT run vitest 4.x |
| `@simplewebauthn/server` | Multi-RPID array support | ✓ | 13.2.3 | None |
| `vitest` | Test framework | ✓ | ^4.0.18 | None |
| `zod` | Optional structural validation | ✓ | (already installed) | Hand-rolled type guards |
| `tsup` | Build (dist/server) | ✓ | (already installed) | None |
| `tsc` (TypeScript compiler) | Typecheck + tsc-fail fixture | ✓ (via `npx tsc`) | 5.x | None |
| `pino` | Logger (peer dep) | ✓ | (peer dep, consumer-supplied) | None |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

**Known environment caveat (carried from Phase 11):** System Node is v12, which cannot run vitest 4.x. All `npm test`, `npm run build`, `npm run typecheck`, and any GSD CLI invocations must be prefixed with `nvm use 20`. Each plan task that runs a vitest command MUST encode this prefix; tasks that omit it will fail with a `node:path` resolution error (already observed once during this research session).

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — `@simplewebauthn/server@13.2.3` already supports `string | string[]`, verified at the type-definition level and the runtime level (independent membership checks confirmed in the installed source)
- Architecture: HIGH — Phase 11 established the `AnonAuthConfig` extension pattern (`AnonAuthHooks`); Phase 12 mirrors it for `RelatedOrigin[]` with one additional concern (startup validation) that already has an analog (`database.connectionString` check at `index.ts:103-104`)
- Validation strategy: HIGH — Phase 11's Wave 0 + tsc-fail fixture precedent (`mpc-treasury-leak.test.ts:212-241`) is fully reusable; only one new test file is needed
- Pitfalls: HIGH — the central R3 defense (paired-tuple to defeat parallel-array index drift) is grounded in directly-verified library behavior (independent membership in `verifyAuthenticationResponse.js:71-81` and `matchExpectedRPID.js:9-23`)
- Browser support / `.well-known` semantics: HIGH for the JSON shape (passkeys.dev is normative), MEDIUM for caching behavior (intentionally undocumented; not a Phase 12 concern)

**Research date:** 2026-04-29

**Valid until:** ~2026-07-29 (90 days for a stable area — `@simplewebauthn/server@13.x` line; W3C ROR spec stable; no imminent browser-side rule changes signaled). Re-research before v0.8 milestone if deferred RPID-V2-* items are activated.
