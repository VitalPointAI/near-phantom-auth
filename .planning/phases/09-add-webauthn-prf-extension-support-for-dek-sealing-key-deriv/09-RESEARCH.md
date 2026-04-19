# Phase 9: Add WebAuthn PRF Extension Support — Research

**Researched:** 2026-04-19
**Domain:** WebAuthn PRF extension, client-side passkey ceremonies, server-side POST-body augmentation
**Confidence:** HIGH (spec confirmed via MDN + Yubico guides; codebase verified via direct inspection)

---

<user_constraints>
## User Constraints (from CONTEXT.md — fully spec'd, all decisions locked)

### Locked Decisions

**Wire format:**
- POST bodies for `/register/finish` and `/login/finish` gain an optional `sealingKeyHex: string` field (64 hex chars = 32 bytes). Present only when PRF succeeds; absent (not null) when unsupported.

**PRF salt:**
- Default: `new TextEncoder().encode('near-phantom-auth-prf-v1')` (library-internal constant)
- Configurable via `createAnonAuth({ passkey: { prfSalt: Uint8Array } })` override
- Salt MUST be byte-identical between every registration and every login for the same credential — one byte difference produces a different 32-byte PRF output and destroys DEK access

**Extension input shape (both `create()` and `get()`):**
```js
extensions: { prf: { eval: { first: prfSalt } } }
```

**Result extraction:**
```js
const prfResult = credential.getClientExtensionResults()?.prf?.results?.first;
// type: ArrayBuffer | undefined
```

**Hex encoding:**
```js
sealingKeyHex = Array.from(new Uint8Array(prfResult))
  .map(b => b.toString(16).padStart(2, '0'))
  .join('');
```

**Graceful degradation:**
- If `prfResult` is undefined: complete registration/login normally, omit `sealingKeyHex` from POST body, show UI warning
- `passkey.requirePrf: boolean` option on `createAnonAuth` lets apps refuse non-PRF registrations

**Versioning:** 0.5.3 → 0.6.0 (feature-add, not breaking API change)

**Migration for existing accounts:** server-side only — modify `user-bridge.ts:170` to fire `provisionUserKeys()` on login when `getUserKeyBundle()` returns null; no library change required

### Claude's Discretion

None explicitly stated. All decisions above are fully locked.

### Deferred Ideas (OUT OF SCOPE)

- `evalByCredential` multi-input PRF patterns
- Server-side PRF verification
- Rotation of PRF salt (noted as future capability via version tagging)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

Derived from CONTEXT.md "Reference checklist for the library PR" — no formal REQ-IDs exist.

| ID | Description | Research Support |
|----|-------------|------------------|
| PRF-01 | Add `passkey.prfSalt?: Uint8Array` and `passkey.requirePrf?: boolean` to `createAnonAuth` options | Types live in `src/types/index.ts` → `AnonAuthConfig`; config is threaded through `createAnonAuth()` in `src/server/index.ts` |
| PRF-02 | Pass `extensions: { prf: { eval: { first: salt } } }` on every `credentials.create()` | Lives in `src/client/passkey.ts:createPasskey()` — no extension field today |
| PRF-03 | Pass `extensions: { prf: { eval: { first: salt } } }` on every `credentials.get()` | Lives in `src/client/passkey.ts:authenticateWithPasskey()` — no extension field today |
| PRF-04 | Extract `getClientExtensionResults().prf?.results?.first` (ArrayBuffer) from credential | Both functions in `src/client/passkey.ts`; result is already forwarded via `clientExtensionResults` but not acted upon |
| PRF-05 | Hex-encode 32-byte ArrayBuffer to `sealingKeyHex` string (64 chars, lowercase hex) | Client-side, pure computation, no library dependency |
| PRF-06 | Add `sealingKeyHex` to POST body of `finishRegistration()` in `src/client/api.ts` | `finishRegistration` posts `{ challengeId, response, tempUserId, codename, username }` — add optional `sealingKeyHex` |
| PRF-07 | Add `sealingKeyHex` to POST body of `finishAuthentication()` in `src/client/api.ts` | `finishAuthentication` posts `{ challengeId, response }` — add optional `sealingKeyHex` |
| PRF-08 | Update Zod schemas: `registerFinishBodySchema` and `loginFinishBodySchema` accept optional `sealingKeyHex` | `src/server/validation/schemas.ts` — add `z.string().optional()` field |
| PRF-09 | Handle `passkey.requirePrf` rejection path (throw / error state) | React hook `useAnonAuth.tsx` — surface as `state.error`; raw API path throws `Error` |
| PRF-10 | Bump version 0.5.3 → 0.6.0 | `package.json` |
| PRF-11 | Tests: 32-byte length, determinism per credential, divergence across credentials/salts, hex format | `src/__tests__/` — new test file `prf.test.ts` |
| PRF-12 | README: salt requirement, browser support matrix, migration note for NULL key-bundle accounts | `README.md` |
</phase_requirements>

---

## Summary

Phase 9 adds WebAuthn PRF (Pseudo-Random Function) extension support to derive a stable 32-byte `sealingKey` during passkey registration and authentication. The key is hex-encoded and sent to the server as `sealingKeyHex` in the `/register/finish` and `/login/finish` POST bodies so `auth-service` can provision or unwrap per-user DEKs.

The implementation touches four files in the library: `src/client/passkey.ts` (add PRF extension to both ceremonies, extract + hex-encode result), `src/client/api.ts` (thread `sealingKeyHex` into finish POST bodies), `src/server/validation/schemas.ts` (accept optional `sealingKeyHex` field), and `src/types/index.ts` plus `src/server/index.ts` (new `passkey.prfSalt` and `passkey.requirePrf` config options). The React hook `src/client/hooks/useAnonAuth.tsx` needs minor wiring to surface PRF state and pass options down.

A critical spec clarification is documented below: `prf.results.first` is available during `create()` on newer passkey backends (iCloud Keychain, Google Password Manager, Chrome 147+ with Windows Hello), but returns only `prf.enabled: true` (no `results`) on older authenticators and hardware keys. The CONTEXT.md spec does check `ext.prf?.results?.first` after `create()` which handles both cases correctly — if `results.first` is absent on create(), the server receives no `sealingKeyHex` and the session still completes (graceful degradation). The user can then re-derive the key on next login when `get()` always returns `results.first` for PRF-enabled credentials.

**Primary recommendation:** Implement PRF extraction symmetrically in both `createPasskey()` and `authenticateWithPasskey()`, default the salt to `'near-phantom-auth-prf-v1'`, and omit `sealingKeyHex` from POST bodies when `prfResult` is undefined. This is the locked spec; no deviation needed.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PRF extension request (create/get) | Browser / Client | — | `navigator.credentials.create/get` is a client-only Web API |
| sealingKeyHex extraction + encoding | Browser / Client | — | `getClientExtensionResults()` is client-side; ArrayBuffer → hex is pure JS |
| sealingKeyHex transport to server | Frontend → API | — | Added to existing POST bodies |
| Schema validation of sealingKeyHex | API / Backend | — | Zod schemas in `src/server/validation/schemas.ts` |
| DEK provisioning / unwrapping | API / Backend (auth-service) | — | `resolveSessionDek()` / `provisionUserKeys()` in auth-service — OUT OF SCOPE for library PR |
| PRF config options (prfSalt, requirePrf) | Library config | — | `AnonAuthConfig` → threaded through `createAnonAuth` |
| requirePrf rejection error surfacing | Browser / Client | — | React hook state.error or thrown Error in raw API |

---

## Standard Stack

### Core (all already in project, no new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `navigator.credentials` (Web API) | Browser native | `create()` / `get()` ceremonies with PRF extension | W3C WebAuthn Level 3 — the only API for this |
| `typescript` | 5.9.3 [VERIFIED: npm registry] | Type-safe PRF option shapes | Already in project |
| `zod` | 4.3.6 [VERIFIED: npm registry] | Schema validation for new optional field | Already wired in `src/server/validation/schemas.ts` |
| `vitest` | 4.1.4 [VERIFIED: npm registry] | Test framework | Already configured in `vitest.config.ts` |

### Supporting (testing only)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node `crypto` (built-in) | — | HMAC-SHA-256 for deterministic test mock PRF output | Generate fixed PRF test vectors in test file |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled hex encoding | `Buffer.from(ab).toString('hex')` (Node) | Node Buffer works in tests; browser uses `Array.from` + `padStart` per spec. The spec approach works in both environments. |
| `@simplewebauthn/browser` | None needed | Library does NOT use `@simplewebauthn/browser`; it implements `createPasskey()` and `authenticateWithPasskey()` manually in `src/client/passkey.ts`. PRF extension must be added there directly. |

**Installation:** No new packages required.

---

## Architecture Patterns

### System Architecture Diagram

```
useAnonAuth.tsx (React hook)
    │
    ├─ register() ──────────────────────────────────────────────────┐
    │   1. api.startRegistration() → challengeId + options           │
    │   2. createPasskey(options, { prfSalt })                       │
    │       └─ navigator.credentials.create({                       │
    │               extensions: { prf: { eval: { first: salt } } }  │
    │          })                                                    │
    │       └─ getClientExtensionResults().prf?.results?.first       │
    │          → ArrayBuffer (or undefined if unsupported)           │
    │       └─ hex-encode → sealingKeyHex (or undefined)            │
    │   3. api.finishRegistration(... , sealingKeyHex?)             │
    │       └─ POST /register/finish { ...existing, sealingKeyHex } │
    │                                                                │
    └─ login() ─────────────────────────────────────────────────────┘
        1. api.startAuthentication() → challengeId + options
        2. authenticateWithPasskey(options, { prfSalt })
            └─ navigator.credentials.get({
                    extensions: { prf: { eval: { first: salt } } }
               })
            └─ getClientExtensionResults().prf?.results?.first
               → ArrayBuffer (always present for PRF-enabled credential)
            └─ hex-encode → sealingKeyHex (or undefined)
        3. api.finishAuthentication(... , sealingKeyHex?)
            └─ POST /login/finish { ...existing, sealingKeyHex }

Server (router.ts)  ────────────────────────────────────────────────
    POST /register/finish
        validateBody(registerFinishBodySchema)  ← add sealingKeyHex?: z.string()
        ── existing passkey + user + session creation unchanged ──
        (sealingKeyHex forwarded in body but not processed in library)

    POST /login/finish
        validateBody(loginFinishBodySchema)  ← add sealingKeyHex?: z.string()
        ── existing auth verification + session creation unchanged ──
        (sealingKeyHex forwarded in body but not processed in library)

auth-service (OUT OF SCOPE for this PR)
    server.ts:121 reads sealingKeyHex → resolveSessionDek()
    user-bridge.ts:170 → provisionUserKeys() for NULL key-bundle accounts
```

### Recommended Project Structure

No structural changes needed. All modifications are within existing files:

```
src/
├── client/
│   ├── passkey.ts        ← add PRF extension to createPasskey() + authenticateWithPasskey()
│   ├── api.ts            ← add sealingKeyHex? to finishRegistration + finishAuthentication
│   └── hooks/
│       └── useAnonAuth.tsx ← thread prfSalt/requirePrf config; surface PRF state
├── server/
│   ├── index.ts          ← add passkey?: { prfSalt?, requirePrf? } to createAnonAuth config
│   └── validation/
│       └── schemas.ts    ← add sealingKeyHex?: z.string() to 2 schemas
├── types/
│   └── index.ts          ← add PasskeyConfig interface with prfSalt/requirePrf fields
└── __tests__/
    └── prf.test.ts       ← NEW: PRF extraction unit tests (no DOM needed; mock only)
```

### Pattern 1: PRF Extension on `credentials.create()`

```typescript
// Source: MDN Web Docs — WebAuthn extensions (verified via WebFetch 2026-04-19)
// In src/client/passkey.ts:createPasskey()
const publicKeyOptions: PublicKeyCredentialCreationOptions = {
  // ...existing options...
  extensions: {
    prf: {
      eval: { first: prfSalt },  // Uint8Array (arbitrary length; spec hashes internally)
    },
  },
};

const credential = await navigator.credentials.create({ publicKey: publicKeyOptions }) as PublicKeyCredential;

const ext = credential.getClientExtensionResults();
// After create(): prf.enabled === true means authenticator supports PRF
// prf.results?.first is an ArrayBuffer (32 bytes) IF authenticator returns on create
// (iCloud Keychain, Google Password Manager, Chrome 147+/Windows Hello)
// Hardware keys + older browsers return enabled:true but no results.first on create
const prfResult: ArrayBuffer | undefined = (ext as any).prf?.results?.first;
```

### Pattern 2: PRF Extension on `credentials.get()`

```typescript
// Source: MDN Web Docs — WebAuthn extensions (verified via WebFetch 2026-04-19)
// In src/client/passkey.ts:authenticateWithPasskey()
const publicKeyOptions: PublicKeyCredentialRequestOptions = {
  // ...existing options...
  extensions: {
    prf: {
      eval: { first: prfSalt },  // Same salt as registration — MUST be byte-identical
    },
  },
};

const credential = await navigator.credentials.get({ publicKey: publicKeyOptions }) as PublicKeyCredential;

const ext = credential.getClientExtensionResults();
// After get(): prf.results.first is always present for PRF-enabled credentials
// (no prf.enabled field in get() responses per MDN spec)
const prfResult: ArrayBuffer | undefined = (ext as any).prf?.results?.first;
```

### Pattern 3: Hex Encoding

```typescript
// Source: CONTEXT.md (project spec, locked decision)
function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
// Output: 64-character lowercase hex string for 32-byte input
```

### Pattern 4: Default PRF Salt

```typescript
// Source: CONTEXT.md (locked decision)
const DEFAULT_PRF_SALT = new TextEncoder().encode('near-phantom-auth-prf-v1');
// Length: 23 bytes — spec accepts arbitrary length, hashes internally (HMAC-SHA-256 internally)
// Stable: must never change for the lifetime of the deployment or all DEKs become inaccessible
```

### Pattern 5: requirePrf Rejection

```typescript
// In useAnonAuth.tsx register():
if (config.passkey?.requirePrf && !sealingKeyHex) {
  throw new Error('PRF_NOT_SUPPORTED: This authenticator does not support the PRF extension required for encrypted storage.');
}
// Surfaces as state.error via existing error handling in the hook
```

### Pattern 6: Zod Schema Update

```typescript
// Source: src/server/validation/schemas.ts (existing pattern)
// Both registerFinishBodySchema and loginFinishBodySchema get:
sealingKeyHex: z.string().regex(/^[0-9a-f]{64}$/).optional(),
// Validates hex format if present; absent when PRF not supported
```

### Anti-Patterns to Avoid

- **Sending `sealingKeyHex: null`:** Omit the field entirely when PRF fails — the server checks `if (body.sealingKeyHex)` not `!== null`. Sending `null` breaks the server-side guard.
- **Mixing in `userId` or session data into the salt:** The salt must be fully static. Adding dynamic data breaks determinism between registration and login.
- **Using `prf.enabled` on `get()` responses:** The `enabled` key only appears on `create()` responses. On `get()`, absence of `prf.results.first` means unsupported.
- **Expecting `prfResult` on first `create()` universally:** Hardware keys and pre-2024 browser/OS combos return `prf.enabled: true` but no `results.first` on `create()`. The first actual 32 bytes arrive on the first `get()` for those users.
- **Assuming `prfResult` is `Uint8Array`:** `getClientExtensionResults()` returns `ArrayBuffer` for PRF results per MDN spec. Wrap in `new Uint8Array(prfResult)` for iteration.

---

## Critical Spec Clarification: PRF on First `create()` vs Subsequent `get()`

**[VERIFIED: MDN WebAuthn extensions docs + Yubico Developer Guide + Corbado PRF guide, 2026-04-19]**

This is the most important nuance for planning:

| Authenticator Type | `create()` returns `results.first`? | `get()` returns `results.first`? |
|---|---|---|
| iCloud Keychain (macOS 15+, iOS 18+) | YES (if PRF requested) | YES |
| Google Password Manager passkeys | YES (if PRF requested) | YES |
| Chrome 147+ Windows Hello | YES (new WEBAUTHN_API_VERSION_8) | YES |
| Hardware keys (YubiKey, etc.) | NO (returns `enabled: true` only) | YES |
| Chrome ≤146 Windows Hello | NO (returns `enabled: true` only or nothing) | YES |
| Firefox (any) | NO (PRF not yet implemented as of mid-2025) | NO |

**Impact on CONTEXT.md spec:** The spec checks `ext.prf?.results?.first` after `create()`, which naturally handles both cases:
- If `results.first` is defined (synced passkeys on modern browsers): `sealingKeyHex` is sent at registration — ideal UX, DEK is provisioned immediately.
- If `results.first` is undefined (hardware keys, older browsers): `sealingKeyHex` is absent at registration, sent at first successful `get()` — server provisions DEK on first login instead. This is correct behavior with server-side migration patch.

**No special code needed** to handle this split — the existing graceful degradation path covers hardware keys on first registration automatically.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ArrayBuffer → hex | Custom encoder | `Array.from(new Uint8Array(ab)).map(b => b.toString(16).padStart(2, '0')).join('')` | This IS the idiom; no library needed |
| PRF spec compliance | Custom HMAC | The authenticator's secure enclave | The entire point of PRF — you never have access to the raw HMAC key |
| Browser support detection | `navigator.credentials.prf` check (doesn't exist) | Run the ceremony and check `ext.prf?.results?.first` after | There is no synchronous `isPRFSupported()` — you discover support by attempting and observing the result |
| Test PRF output | Virtual authenticator (CDP) | Hand-rolled mock returning `createHmac('sha256', credKey).update(salt).digest()` as ArrayBuffer | Deterministic, no browser needed, asserts fixed vectors |

**Key insight:** PRF support is discovered post-hoc, not pre-checked. Plan tasks accordingly — the PRF check happens after the credential ceremony, not before.

---

## Common Pitfalls

### Pitfall 1: Salt Mutation Between Deployments
**What goes wrong:** App updates the default salt string (e.g., bumps from `v1` to `v2`). All existing users lose access to their encrypted data because PRF output changes even though credential is the same.
**Why it happens:** Developers treat version tags as "we should always use the latest version."
**How to avoid:** The salt is a permanent commitment, not a semantic version. The `v1` suffix means "first rotation key" not "version 1 to be upgraded." Document explicitly in README.
**Warning signs:** Any PR that changes the default salt constant.

### Pitfall 2: Sending `sealingKeyHex` on PRF-Unsupported Browsers
**What goes wrong:** Code sends `sealingKeyHex: undefined` serialized as `"sealingKeyHex": null` in JSON, breaking server-side `if (body.sealingKeyHex)` guard.
**Why it happens:** JS `{ sealingKeyHex: undefined }` is omitted from `JSON.stringify`, but explicitly setting `undefined` via a conditional merge can cause serialization differences.
**How to avoid:** Use `...(sealingKeyHex ? { sealingKeyHex } : {})` spread pattern rather than assigning `undefined`.
**Warning signs:** Server unexpectedly attempts DEK provisioning with empty key.

### Pitfall 3: TypeScript Type for `getClientExtensionResults()`
**What goes wrong:** TypeScript DOM types for `AuthenticationExtensionsClientOutputs` don't include `prf` (it's a Level 3 extension). Access via untyped path fails `tsc`.
**Why it happens:** `lib: ["ES2022", "DOM"]` in tsconfig doesn't include Level 3 WebAuthn extensions.
**How to avoid:** Cast `credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } }` or add a local type augmentation.
**Warning signs:** `tsc --noEmit` errors on `.prf?.results?.first`.

### Pitfall 4: Missing PRF Extension in `AnonAuthProviderProps` Passthrough
**What goes wrong:** `prfSalt` and `requirePrf` options are added to `AnonAuthConfig` but not threaded to the client-side `createPasskey()` / `authenticateWithPasskey()` calls. The server knows nothing about PRF; the client must own the salt.
**Why it happens:** The library has a client/server split. `createAnonAuth()` config is server-side only. PRF salt must be passed through `AnonAuthProviderProps` on the client.
**How to avoid:** `AnonAuthProviderProps` needs its own `passkey?: { prfSalt?: Uint8Array; requirePrf?: boolean }` prop. Server `AnonAuthConfig.passkey` options are for symmetry/documentation but the actual PRF logic is purely client-side.
**Warning signs:** Tests pass server-side but PRF never fires in browser.

### Pitfall 5: `prfSalt` in `AnonAuthConfig` vs Client Props
**What goes wrong:** Salt is defined in `AnonAuthConfig` (server) but needs to be available at client call sites. The library's server config is not shipped to the browser.
**Why it happens:** Architectural split: `src/server/index.ts` is Express-side; `src/client/hooks/useAnonAuth.tsx` is browser-side.
**How to avoid:** Two config surfaces: `AnonAuthConfig.passkey` (server types for documentation) and `AnonAuthProviderProps.passkey` (runtime browser config). The server validation schemas just need to accept the optional field; the server never reads or uses `prfSalt`.

---

## Existing Code Touchpoints (verified by direct inspection)

### Files That Need Modification

| File | Change Required |
|------|----------------|
| `src/client/passkey.ts` | `createPasskey()`: add `extensions: { prf: ... }` to `publicKeyOptions`; extract + hex-encode PRF result and return it alongside existing response. `authenticateWithPasskey()`: same. Both functions need a new optional config param `prfOptions?: { salt: Uint8Array }`. |
| `src/client/api.ts` | `finishRegistration()`: add optional `sealingKeyHex?: string` param; spread into POST body. `finishAuthentication()`: same. |
| `src/client/hooks/useAnonAuth.tsx` | `AnonAuthProviderProps`: add `passkey?: { prfSalt?: Uint8Array; requirePrf?: boolean }`. `register()` and `login()` callbacks: pass `prfOptions` to `createPasskey`/`authenticateWithPasskey`, handle `sealingKeyHex` return, pass to API finish calls, handle `requirePrf` rejection. |
| `src/server/validation/schemas.ts` | `registerFinishBodySchema` and `loginFinishBodySchema`: add `sealingKeyHex: z.string().regex(/^[0-9a-f]{64}$/).optional()`. |
| `src/types/index.ts` | Add `passkey?: { prfSalt?: Uint8Array; requirePrf?: boolean }` field to `AnonAuthConfig`. |
| `src/server/index.ts` | Accept new `passkey` field in `createAnonAuth()` (type-only; server does not use it at runtime). |
| `package.json` | Version bump 0.5.3 → 0.6.0. |
| `README.md` | Add PRF section: salt requirement, browser support matrix, migration note. |

### Files That Do NOT Need Modification

| File | Reason |
|------|--------|
| `src/server/router.ts` | Server receives `sealingKeyHex` in POST body but passes it through to auth-service untouched. No routing logic change needed. |
| `src/server/passkey.ts` | Server-side passkey manager handles cryptographic verification only; PRF is client-side. |
| `src/server/webauthn.ts` | Standalone verification utilities; not involved in PRF. |
| `src/server/db/` | No DB schema changes in this library; auth-service DB is out of scope. |
| `src/client/api.ts` `ApiClient` interface | The `finishRegistration` and `finishAuthentication` signatures expand by one optional param. |

### How `navigator.credentials.create()` Is Called Today

`src/client/passkey.ts:createPasskey()` at line 95 calls `navigator.credentials.create({ publicKey: publicKeyOptions })` where `publicKeyOptions` is built from `PublicKeyCredentialCreationOptionsJSON` options. The `extensions` field on `publicKeyOptions` is currently absent — no `extensions` key exists in the current construction.

### How `navigator.credentials.get()` Is Called Today

`src/client/passkey.ts:authenticateWithPasskey()` at line 170 calls `navigator.credentials.get({ publicKey: publicKeyOptions })`. Again, no `extensions` field is set today.

### How POST Bodies Are Constructed Today

- `finishRegistration`: `src/client/api.ts:123` posts `{ challengeId, response, tempUserId, codename, username }` — no extensible field.
- `finishAuthentication`: `src/client/api.ts:143` posts `{ challengeId, response }` — no extensible field.

### Where `createAnonAuth` Options Are Threaded

`src/server/index.ts:90` — `createAnonAuth(config: AnonAuthConfig)`. The `config` object is expanded inline to sub-managers. The `passkey` config option does not exist today. Adding it requires: (1) type in `AnonAuthConfig`, (2) acceptance in `createAnonAuth()` function signature, (3) forwarding to client-side (cannot be forwarded — see Pitfall 4 above).

### Existing Test Infrastructure

- **Framework:** vitest 4.1.4, node environment (not jsdom)
- **Config:** `vitest.config.ts` — `globals: true, environment: 'node'`
- **Pattern:** `vi.mock()` for module-level mocks of `@simplewebauthn/server`; `makeMockDb()` factory pattern for DatabaseAdapter
- **Test files:** `src/__tests__/*.test.ts`
- **Run command:** `npm test` (vitest)
- **All 214 tests pass** [VERIFIED: direct test run 2026-04-19]
- **Note:** No `jsdom` environment — PRF tests must mock `navigator.credentials` manually (not available in Node). Use a functional mock that returns a deterministic HMAC-SHA-256 result.

---

## Validation Architecture

Nyquist validation is enabled (`workflow.nyquist_validation: true` in `.planning/config.json`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.4 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npm test -- --reporter=verbose src/__tests__/prf.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PRF-05 | `arrayBufferToHex()` produces 64-char lowercase hex for 32-byte input | unit | `npm test -- src/__tests__/prf.test.ts` | ❌ Wave 0 |
| PRF-05 | `arrayBufferToHex()` produces correct hex for known input (test vector) | unit | `npm test -- src/__tests__/prf.test.ts` | ❌ Wave 0 |
| PRF-02/03 | PRF extension is included in `createPasskey()` credential create options | unit | `npm test -- src/__tests__/prf.test.ts` | ❌ Wave 0 |
| PRF-02/03 | PRF extension is included in `authenticateWithPasskey()` credential get options | unit | `npm test -- src/__tests__/prf.test.ts` | ❌ Wave 0 |
| PRF-04+05 | Same credential + same salt → identical `sealingKeyHex` (determinism) | unit | `npm test -- src/__tests__/prf.test.ts` | ❌ Wave 0 |
| PRF-04+05 | Different mock credential (different credKey) + same salt → different `sealingKeyHex` | unit | `npm test -- src/__tests__/prf.test.ts` | ❌ Wave 0 |
| PRF-04+05 | Same credential + different salt → different `sealingKeyHex` | unit | `npm test -- src/__tests__/prf.test.ts` | ❌ Wave 0 |
| PRF-04 | PRF unsupported (mock returns no `prf.results.first`) → `sealingKeyHex` is `undefined` | unit | `npm test -- src/__tests__/prf.test.ts` | ❌ Wave 0 |
| PRF-09 | `requirePrf: true` + PRF unsupported → `register()` rejects with PRF error | unit | `npm test -- src/__tests__/prf.test.ts` | ❌ Wave 0 |
| PRF-06/07 | `finishRegistration` POST body includes `sealingKeyHex` when PRF succeeds | unit | `npm test -- src/__tests__/prf.test.ts` | ❌ Wave 0 |
| PRF-06/07 | `finishAuthentication` POST body includes `sealingKeyHex` when PRF succeeds | unit | `npm test -- src/__tests__/prf.test.ts` | ❌ Wave 0 |
| PRF-06/07 | `finishRegistration` POST body omits `sealingKeyHex` key when PRF absent | unit | `npm test -- src/__tests__/prf.test.ts` | ❌ Wave 0 |
| PRF-08 | Server schema validates `sealingKeyHex` with regex `/^[0-9a-f]{64}$/` if present | unit | `npm test -- src/__tests__/validation.test.ts` | ❌ add to existing |
| PRF-08 | Server schema rejects `sealingKeyHex` of wrong length (63 or 65 chars) | unit | `npm test -- src/__tests__/validation.test.ts` | ❌ add to existing |

### Mock Strategy for PRF Tests (vitest, Node environment)

Since vitest runs in Node (no DOM), `navigator.credentials` is undefined. Mock pattern:

```typescript
// Deterministic test mock: HMAC-SHA-256(credentialKey, salt)
import { createHmac } from 'node:crypto';

function makeMockCredential(credKey: Buffer, prfSalt: Uint8Array): PublicKeyCredential {
  const hmac = createHmac('sha256', credKey).update(prfSalt).digest();
  return {
    id: credKey.toString('hex').slice(0, 32),
    rawId: credKey,
    type: 'public-key',
    response: { ... },
    getClientExtensionResults: () => ({
      prf: { results: { first: hmac.buffer } }
    }),
  } as unknown as PublicKeyCredential;
}
```

This produces deterministic 32-byte ArrayBuffer output per (credKey, salt) pair, enabling all four test vectors from CONTEXT.md.

### Sampling Rate

- **Per task commit:** `npm test -- src/__tests__/prf.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green (all 214+ tests) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/__tests__/prf.test.ts` — new file covering all PRF-* requirements above
- [ ] Add `sealingKeyHex` schema tests to `src/__tests__/validation.test.ts` (existing file)
- [ ] No framework config changes needed (vitest.config.ts already correct)

---

## Security Domain

`security_enforcement` is not set to false in config; default is enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | PRF only supplements auth ceremony; existing WebAuthn auth unchanged |
| V3 Session Management | no | Session management unmodified |
| V4 Access Control | no | No new access control logic |
| V5 Input Validation | yes | Zod schema validates `sealingKeyHex` format when present |
| V6 Cryptography | yes | Cryptographic key material (sealingKeyHex) in transit; the 32 bytes never stored by the library — only forwarded |

### Known Threat Patterns for PRF

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Salt oracle attack (correlating sealingKeyHex across users) | Information Disclosure | Per-credential differentiation is automatic (authenticator binds to credential); no extra per-user salt needed |
| Salt rotation without migration | Tampering | Version-tagged salt constant (`v1`) + documented immutability; app must never change default salt |
| `sealingKeyHex` replay | Elevation of Privilege | Server-side: tied to passkey challenge; the 32 bytes are deterministic but useless without the auth-service DEK context |
| PRF bypass (send fake hex) | Tampering | Auth-service validates the key when unwrapping DEK — wrong key = failed decryption, not silent acceptance |
| `sealingKeyHex` in logs | Information Disclosure | Existing pino redaction patterns in `src/server/router.ts` — review that request body logging does not include it |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No PRF extension in WebAuthn | PRF extension in WebAuthn Level 3 §10.1.4 | Chrome 116 (2023), Safari 18 (2024), Firefox 148+ (2025) | First standard way to derive stable per-credential key material |
| PRF only on hardware keys (CTAP 2.2) | PRF on synced passkeys (iCloud Keychain, Google Password Manager) | 2024-2025 | PRF coverage is now majority of mobile users |
| PRF result only on `get()` | PRF result available on `create()` for synced passkeys | Chrome 147 / Windows Hello 2025 | Registration can provision DEK immediately for most users |

**Deprecated/outdated:**
- Chrome profile authenticator (pre-2024): Did not support PRF. Replaced by Google Password Manager passkeys which do.
- iOS/iPadOS <18: No PRF support. iOS 18.4+ includes PRF for both platform passkeys and (with limitations) roaming keys.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥18 | Test execution | ✓ | v20.20.1 [VERIFIED] | — |
| vitest | Test framework | ✓ | 4.1.4 [VERIFIED] | — |
| typescript | Typecheck | ✓ | 5.9.3 [VERIFIED] | — |
| `navigator.credentials` (browser) | PRF ceremonies | N/A in tests | Browser API | Mocked in vitest with `vi.fn()` |
| `crypto.createHmac` (Node built-in) | Test mock PRF output | ✓ | Node built-in | — |

No missing dependencies. All test infrastructure is present.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | auth-service `server.ts:121` reads `sealingKeyHex` from POST body and calls `resolveSessionDek()` without library changes | CONTEXT.md (locked) | If server needs library changes to accept the field, scope expands |
| A2 | The `AnonAuthConfig` `passkey` option is added for type documentation/symmetry but the library does not use `prfSalt` server-side | Architecture section | If server needs to echo salt back to client, a new endpoint would be needed |
| A3 | caBLE (cross-device hybrid transport) PRF support is not guaranteed — Google Pixel → Chrome Desktop may or may not forward PRF output over caBLE | Security Domain | If caBLE PRF works universally, browser matrix is more favorable; if not, hybrid transport users fall back to graceful degradation |

---

## Open Questions

1. **Does the router need to forward `sealingKeyHex` explicitly to auth-service?**
   - What we know: The library's router accepts and validates the POST body; auth-service reads the body directly (same service boundary per CONTEXT.md description).
   - What's unclear: Whether the router passes the raw body, a parsed subset, or a typed DTO to auth-service internals.
   - Recommendation: This is server-side and out of library scope. Treat as locked per CONTEXT.md.

2. **Should `sealingKeyHex` be logged anywhere?**
   - What we know: Existing pino redaction is by field name; the new field name `sealingKeyHex` would need to be added to the redact list.
   - What's unclear: Whether the current router logs full request bodies.
   - Recommendation: Add `sealingKeyHex` to pino redaction paths at logger init time, or ensure the router does not log body fields that may contain key material.

---

## Sources

### Primary (HIGH confidence)
- MDN Web Docs — WebAuthn Extensions (fetched 2026-04-19) — PRF shape for create/get, ArrayBuffer type confirmation
- Yubico Developer Guide to PRF (fetched 2026-04-19) — PRF enabled vs results on create, browser support matrix
- Direct codebase inspection — all file paths, function signatures, test infrastructure verified by Read tool

### Secondary (MEDIUM confidence)
- Corbado blog "Passkeys & WebAuthn PRF for End-to-End Encryption" (fetched 2026-04-19) — PRF on create() availability per authenticator type; synced passkey PRF-on-create confirmation
- Matt Miller blog "Encrypting Data in the Browser Using WebAuthn" (fetched 2026-04-19) — Registration returns `enabled:true` not `results.first` for hardware keys

### Tertiary (LOW confidence)
- WebSearch results for Chrome 147 PRF-on-create support — cross-verified with Corbado article, elevated to MEDIUM

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already in project, no new deps
- Architecture: HIGH — every file path verified by direct Read; exact function signatures confirmed
- WebAuthn PRF spec: HIGH — MDN + Yubico official sources
- Pitfalls: HIGH — derived from spec behavior + codebase patterns
- Browser matrix: MEDIUM — Corbado/Yubico sources from 2025-2026; fast-moving area

**Research date:** 2026-04-19
**Valid until:** 2026-07-19 (90 days; PRF browser support is stabilizing but still evolving)
