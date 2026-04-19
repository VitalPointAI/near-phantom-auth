# Phase 9: Add WebAuthn PRF Extension Support — Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 8 modified + 1 new (9 total)
**Analogs found:** 8 / 9 (1 new file with no codebase analog)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/client/passkey.ts` | utility (browser WebAuthn) | request-response | `src/client/passkey.ts` itself (modify, not replace) | self |
| `src/client/api.ts` | service (fetch client) | request-response | `src/client/api.ts` itself (modify, not replace) | self |
| `src/client/hooks/useAnonAuth.tsx` | hook/provider | request-response | `src/client/hooks/useAnonAuth.tsx` itself (modify, not replace) | self |
| `src/server/validation/schemas.ts` | validation | CRUD | `src/server/validation/schemas.ts` itself — add optional field same as `userHandle` pattern | self |
| `src/types/index.ts` | type definitions | — | `src/types/index.ts` — pattern: top-level optional nested config interfaces (`rp?`, `mpc?`, `recovery?`, `oauth?`) | self |
| `src/server/index.ts` | config entry point | — | `src/server/index.ts` — pattern: accept top-level config field, forward to sub-managers | self |
| `package.json` | config | — | `package.json` version bump: `b7cc565` changes only `"version"` field | self |
| `README.md` | documentation | — | existing README (append section) | self |
| `src/__tests__/prf.test.ts` | test (new file) | — | `src/__tests__/passkey.test.ts` + `src/__tests__/validation.test.ts` | role-match |

---

## Pattern Assignments

### `src/client/passkey.ts` — add PRF extension to `createPasskey()` and `authenticateWithPasskey()`

**Analog:** self (lines 67–125 for `createPasskey`, lines 149–193 for `authenticateWithPasskey`)

**Function signature pattern — existing (lines 67–69):**
```typescript
export async function createPasskey(
  options: PublicKeyCredentialCreationOptionsJSON
): Promise<RegistrationResponseJSON> {
```

**New signature — add optional `prfOptions` second param following same optional-config-object convention used throughout the file:**
```typescript
export async function createPasskey(
  options: PublicKeyCredentialCreationOptionsJSON,
  prfOptions?: { salt: Uint8Array }
): Promise<RegistrationResponseJSON & { sealingKeyHex?: string }> {
```

**publicKeyOptions construction pattern (lines 75–92) — the extensions field is appended after existing fields using the same spread shape:**
```typescript
const publicKeyOptions: PublicKeyCredentialCreationOptions = {
  challenge: base64urlToBuffer(options.challenge),
  rp: options.rp,
  user: { ... },
  pubKeyCredParams: options.pubKeyCredParams,
  timeout: options.timeout,
  authenticatorSelection: options.authenticatorSelection,
  attestation: options.attestation || 'none',
  excludeCredentials: options.excludeCredentials?.map(...),
  // ADD AFTER ALL EXISTING FIELDS:
  ...(prfOptions ? {
    extensions: {
      prf: { eval: { first: prfOptions.salt } },
    } as AuthenticationExtensionsPRFInputs,
  } : {}),
};
```

**`navigator.credentials.create()` call (lines 95–97) — no change to the call itself, but PRF extraction follows immediately after `credential.response` cast:**
```typescript
const credential = await navigator.credentials.create({
  publicKey: publicKeyOptions,
}) as PublicKeyCredential;
```

**PRF extraction and hex encoding — insert before the `return` at line 111:**
```typescript
// Extract PRF result if available (Level 3 WebAuthn extension)
type PRFOutputs = AuthenticationExtensionsClientOutputs & {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
};
const ext = credential.getClientExtensionResults() as PRFOutputs;
const prfResult: ArrayBuffer | undefined = ext.prf?.results?.first;
const sealingKeyHex: string | undefined = prfResult
  ? Array.from(new Uint8Array(prfResult))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  : undefined;
```

**Return shape (lines 111–124) — `clientExtensionResults` is already returned; add `sealingKeyHex` alongside existing fields:**
```typescript
return {
  id: credential.id,
  rawId: bufferToBase64url(credential.rawId),
  type: 'public-key',
  response: { clientDataJSON: ..., attestationObject: ..., transports },
  clientExtensionResults: credential.getClientExtensionResults() as Record<string, unknown>,
  authenticatorAttachment,
  transports,
  // ADD:
  sealingKeyHex,
};
```

**`authenticateWithPasskey` — same pattern at lines 149–193. New signature:**
```typescript
export async function authenticateWithPasskey(
  options: PublicKeyCredentialRequestOptionsJSON,
  prfOptions?: { salt: Uint8Array }
): Promise<AuthenticationResponseJSON & { sealingKeyHex?: string }> {
```

**publicKeyOptions for `get()` (lines 157–167) — add extensions after `allowCredentials`:**
```typescript
const publicKeyOptions: PublicKeyCredentialRequestOptions = {
  challenge: base64urlToBuffer(options.challenge),
  timeout: options.timeout,
  rpId: options.rpId,
  userVerification: options.userVerification,
  allowCredentials: options.allowCredentials?.map(...),
  // ADD:
  ...(prfOptions ? {
    extensions: {
      prf: { eval: { first: prfOptions.salt } },
    } as AuthenticationExtensionsPRFInputs,
  } : {}),
};
```

**Return shape (lines 181–192) — add `sealingKeyHex` to existing return alongside `clientExtensionResults`:**
```typescript
return {
  id: credential.id,
  rawId: bufferToBase64url(credential.rawId),
  type: 'public-key',
  response: { clientDataJSON: ..., authenticatorData: ..., signature: ..., userHandle: ... },
  clientExtensionResults: credential.getClientExtensionResults() as Record<string, unknown>,
  // ADD:
  sealingKeyHex,
};
```

**Helper function — add near top of file alongside existing buffer helpers (`base64urlToBuffer`, `bufferToBase64url` at lines 39–62):**
```typescript
/**
 * Encode ArrayBuffer to lowercase hex string
 */
function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

**TypeScript caveat — `AuthenticationExtensionsPRFInputs` is not in DOM lib. Add local type at top of file:**
```typescript
// WebAuthn Level 3 PRF extension — not yet in TypeScript DOM lib
type AuthenticationExtensionsPRFInputs = {
  prf: { eval: { first: Uint8Array } };
};
```

---

### `src/client/api.ts` — add `sealingKeyHex?` to `finishRegistration` and `finishAuthentication`

**Analog:** self (lines 36–86 for `ApiClient` interface; lines 117–148 for implementations)

**Interface pattern — `finishRegistration` (lines 39–45):**
```typescript
finishRegistration(
  challengeId: string,
  response: RegistrationResponseJSON,
  tempUserId: string,
  codename: string,
  username?: string  // ← existing optional param
): Promise<RegistrationFinishResponse & { username?: string }>;
```

**New signature — add `sealingKeyHex?` following the same trailing-optional pattern:**
```typescript
finishRegistration(
  challengeId: string,
  response: RegistrationResponseJSON,
  tempUserId: string,
  codename: string,
  username?: string,
  sealingKeyHex?: string     // ADD
): Promise<RegistrationFinishResponse & { username?: string }>;
```

**Interface pattern — `finishAuthentication` (lines 52–55):**
```typescript
finishAuthentication(
  challengeId: string,
  response: AuthenticationResponseJSON
): Promise<AuthenticationFinishResponse>;
```

**New signature:**
```typescript
finishAuthentication(
  challengeId: string,
  response: AuthenticationResponseJSON,
  sealingKeyHex?: string     // ADD
): Promise<AuthenticationFinishResponse>;
```

**POST body construction pattern (lines 123–130) — uses object literal, not `JSON.stringify` manually:**
```typescript
async finishRegistration(challengeId, response, tempUserId, codename, username?: string) {
  return request('POST', '/register/finish', {
    challengeId,
    response,
    tempUserId,
    codename,
    username,
  });
},
```

**New body — use spread-conditional to omit key when undefined (avoids `JSON.stringify` emitting `"sealingKeyHex":null`):**
```typescript
async finishRegistration(challengeId, response, tempUserId, codename, username?: string, sealingKeyHex?: string) {
  return request('POST', '/register/finish', {
    challengeId,
    response,
    tempUserId,
    codename,
    username,
    ...(sealingKeyHex ? { sealingKeyHex } : {}),
  });
},
```

**Same spread-conditional pattern for `finishAuthentication` (lines 143–147):**
```typescript
async finishAuthentication(challengeId, response, sealingKeyHex?: string) {
  return request('POST', '/login/finish', {
    challengeId,
    response,
    ...(sealingKeyHex ? { sealingKeyHex } : {}),
  });
},
```

**Why spread-conditional, not `sealingKeyHex: sealingKeyHex`:** `JSON.stringify` omits `undefined` values in object literals BUT only at top level; to be safe and explicit, use `...(sealingKeyHex ? { sealingKeyHex } : {})`. The field must be absent (not `null`) when PRF is unsupported, because the server guard is `if (body.sealingKeyHex)`.

---

### `src/client/hooks/useAnonAuth.tsx` — thread `prfSalt`/`requirePrf` config through `register()` and `login()`

**Analog:** self (lines 89–94 for `AnonAuthProviderProps`; lines 96–417 for `AnonAuthProvider`)

**`AnonAuthProviderProps` (lines 89–94) — existing shape:**
```typescript
export interface AnonAuthProviderProps {
  /** API URL (e.g., '/auth') */
  apiUrl: string;
  /** Children */
  children: ReactNode;
}
```

**New shape — add `passkey?` following the existing `rp?`/`oauth?`/`mpc?` optional-nested-config pattern in `AnonAuthConfig`:**
```typescript
export interface AnonAuthProviderProps {
  /** API URL (e.g., '/auth') */
  apiUrl: string;
  /** Passkey / PRF configuration */
  passkey?: {
    /** PRF salt for DEK sealing key derivation. Must be byte-identical for all registrations and logins. */
    prfSalt?: Uint8Array;
    /** If true, refuse registration when PRF is not supported */
    requirePrf?: boolean;
  };
  /** Children */
  children: ReactNode;
}
```

**Provider function signature (line 96) — destructure the new prop:**
```typescript
export function AnonAuthProvider({ apiUrl, passkey, children }: AnonAuthProviderProps) {
```

**`register()` callback (lines 170–213) — existing call sites to thread:**
```typescript
// EXISTING (line 178):
const credential = await createPasskey(options);

// BECOMES:
const DEFAULT_PRF_SALT = new TextEncoder().encode('near-phantom-auth-prf-v1');
const prfSalt = passkey?.prfSalt ?? DEFAULT_PRF_SALT;
const credential = await createPasskey(options, { salt: prfSalt });
const { sealingKeyHex } = credential;

// requirePrf guard — insert after credential creation, before finishRegistration:
if (passkey?.requirePrf && !sealingKeyHex) {
  throw new Error(
    'PRF_NOT_SUPPORTED: This authenticator does not support the PRF extension required for encrypted storage.'
  );
}

// EXISTING (lines 184–190):
const result = await api.finishRegistration(
  challengeId,
  credential,
  tempUserId,
  codename,
  username
);

// BECOMES:
const result = await api.finishRegistration(
  challengeId,
  credential,
  tempUserId,
  codename,
  username,
  sealingKeyHex
);
```

**`login()` callback (lines 215–250) — same threading pattern:**
```typescript
// EXISTING (line 223):
const credential = await authenticateWithPasskey(options);

// BECOMES:
const prfSalt = passkey?.prfSalt ?? DEFAULT_PRF_SALT;
const credential = await authenticateWithPasskey(options, { salt: prfSalt });
const { sealingKeyHex } = credential;

// EXISTING (line 226):
const result = await api.finishAuthentication(challengeId, credential);

// BECOMES:
const result = await api.finishAuthentication(challengeId, credential, sealingKeyHex);
```

**Error surfacing pattern — already established at lines 206–212:**
```typescript
} catch (error) {
  setState((prev) => ({
    ...prev,
    isLoading: false,
    error: error instanceof Error ? error.message : 'Registration failed',
  }));
}
```

The `PRF_NOT_SUPPORTED` `throw` in the try block follows this same catch path — no new error surfacing code needed.

**`DEFAULT_PRF_SALT` placement** — declare as module-level constant above `AnonAuthProvider`, following the same convention as `AnonAuthContext` at line 87:
```typescript
const DEFAULT_PRF_SALT = new TextEncoder().encode('near-phantom-auth-prf-v1');
```

---

### `src/server/validation/schemas.ts` — add `sealingKeyHex?` to two schemas

**Analog:** self — existing optional field pattern from `loginFinishBodySchema` (line 88):
```typescript
userHandle: z.string().optional(),
```

And from `oauthLinkBodySchema` (lines 193–196):
```typescript
state: z.string().min(1).optional(),
codeVerifier: z.string().min(1).optional(),
```

**`registerFinishBodySchema` (lines 34–55) — add `sealingKeyHex` as a top-level optional field alongside `challengeId`, `tempUserId`, `codename`, `response`:**
```typescript
export const registerFinishBodySchema = z.object({
  challengeId: z.string().min(1),
  tempUserId: z.string().min(1),
  codename: z.string().min(1),
  username: z.string().min(1).optional(),  // already accepted via passthrough; add explicitly
  sealingKeyHex: z.string().regex(/^[0-9a-f]{64}$/).optional(),  // ADD
  response: z.object({ ... }).passthrough(),
});
```

**`loginFinishBodySchema` (lines 76–94) — same addition at top level:**
```typescript
export const loginFinishBodySchema = z.object({
  challengeId: z.string().min(1),
  sealingKeyHex: z.string().regex(/^[0-9a-f]{64}$/).optional(),  // ADD
  response: z.object({ ... }).passthrough(),
});
```

**Note on passthrough:** The outer `z.object({})` for these schemas does NOT use `.passthrough()` today — unknown top-level fields are stripped. Adding `sealingKeyHex` as an explicit optional field is the correct pattern (same as `username` in `registerFinishBodySchema`), not adding `.passthrough()` to the outer object.

---

### `src/types/index.ts` — add `PasskeyConfig` interface and `passkey?` field on `AnonAuthConfig`

**Analog:** self — existing optional nested-object fields on `AnonAuthConfig` (lines 50–95). Pattern to copy from `rp?` block (lines 57–64):
```typescript
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

**New field — add in `AnonAuthConfig` after `rp?`, before `oauth?`:**
```typescript
/** Passkey / PRF configuration */
passkey?: {
  /**
   * PRF salt for DEK sealing key derivation.
   * Must be byte-identical across all registrations and logins for the same credential.
   * Defaults to the library-internal constant 'near-phantom-auth-prf-v1'.
   * Server-side documentation only — the library does not use this value at runtime on the server.
   */
  prfSalt?: Uint8Array;
  /**
   * If true, refuse registration/login when the authenticator does not support the PRF extension.
   * Defaults to false (graceful degradation — complete ceremony without sealingKeyHex).
   */
  requirePrf?: boolean;
};
```

---

### `src/server/index.ts` — accept `passkey?` in `createAnonAuth()` (type-only, no runtime use)

**Analog:** self (lines 90–235). No runtime change needed — `AnonAuthConfig` already carries the new field after the type update above. The `createAnonAuth(config: AnonAuthConfig)` signature accepts it automatically.

**Confirm no forwarding is needed:** `config.passkey` is not passed to any sub-manager because PRF logic is purely client-side. The only server-side effect is schema validation of `sealingKeyHex` in the POST body.

**Pattern to confirm:** other optional config fields not forwarded to sub-managers include `derivationSalt?` (line 73) which is accepted and forwarded only to `createMPCManager`. Pattern for type-only server fields: simply document in JSDoc and leave unused, same as current `config.logger` fallback at line 92.

---

### `package.json` — version bump 0.5.3 → 0.6.0

**Analog:** commit `b7cc565` (chore: bump version to 0.5.3) modifies only:
- `package.json` line 3: `"version": "0.5.3"`
- `package-lock.json` two occurrences of `"version": "0.5.3"` and `"@vitalpoint/near-phantom-auth": "0.5.3"`

**No CHANGELOG file exists** — version bumps are commit-message only.

**Change:**
```json
"version": "0.6.0"
```

---

### `src/__tests__/prf.test.ts` — new test file (no codebase analog; use `passkey.test.ts` structure)

**Closest analog for file structure:** `src/__tests__/passkey.test.ts` (lines 1–473) and `src/__tests__/validation.test.ts` (lines 1–447).

**File header pattern (passkey.test.ts lines 1–10):**
```typescript
/**
 * [Description] (TEST-XX)
 *
 * [What is tested and how]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
```

**vitest config:** `globals: true, environment: 'node'` — no DOM, no jsdom. `navigator.credentials` does not exist in Node.

**Module mock pattern (passkey.test.ts lines 16–47) — module-level `vi.mock()` before imports:**
```typescript
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({ ... }),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({ ... }),
}));
```

**For PRF tests, no `vi.mock()` of a module is needed** — `navigator.credentials` is injected via a hand-built mock object, not a module. Mimic the pattern of `makeMockDb()` factory:

```typescript
import { createHmac } from 'node:crypto';

type MockPublicKeyCredential = {
  id: string;
  rawId: ArrayBuffer;
  type: 'public-key';
  response: { clientDataJSON: ArrayBuffer; attestationObject?: ArrayBuffer; authenticatorData?: ArrayBuffer; signature?: ArrayBuffer; userHandle?: null };
  getClientExtensionResults(): { prf?: { results?: { first: ArrayBuffer } } };
};

function makeMockCredentialWithPrf(credKey: Buffer, prfSalt: Uint8Array): MockPublicKeyCredential {
  const hmac = createHmac('sha256', credKey).update(prfSalt).digest();
  return {
    id: credKey.toString('hex').slice(0, 32),
    rawId: credKey.buffer,
    type: 'public-key',
    response: {
      clientDataJSON: new ArrayBuffer(0),
      attestationObject: new ArrayBuffer(0),
    },
    getClientExtensionResults: () => ({
      prf: { results: { first: hmac.buffer as ArrayBuffer } },
    }),
  };
}

function makeMockCredentialNoPrf(credKey: Buffer): MockPublicKeyCredential {
  return {
    id: credKey.toString('hex').slice(0, 32),
    rawId: credKey.buffer,
    type: 'public-key',
    response: { clientDataJSON: new ArrayBuffer(0), attestationObject: new ArrayBuffer(0) },
    getClientExtensionResults: () => ({}),  // no prf key
  };
}
```

**`navigator.credentials` mock injection pattern** — `createPasskey` and `authenticateWithPasskey` call `navigator.credentials.create/get` directly. Since this is Node, assign to `global`:
```typescript
beforeEach(() => {
  global.navigator = {
    credentials: {
      create: vi.fn(),
      get: vi.fn(),
    },
  } as unknown as Navigator;
  // assign btoa/atob globals used by passkey.ts buffer helpers
  global.atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
  global.btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
});
```

**describe/it pattern (passkey.test.ts lines 116–161):**
```typescript
describe('createPasskey PRF extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 64-char lowercase hex sealingKeyHex for 32-byte PRF output', async () => {
    const credKey = Buffer.alloc(32, 0xAB);
    const salt = new TextEncoder().encode('near-phantom-auth-prf-v1');
    vi.mocked(global.navigator.credentials.create).mockResolvedValue(
      makeMockCredentialWithPrf(credKey, salt) as unknown as PublicKeyCredential
    );

    const result = await createPasskey(minimalCreateOptions, { salt });
    expect(result.sealingKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns undefined sealingKeyHex when PRF not supported', async () => {
    const credKey = Buffer.alloc(32, 0xCD);
    vi.mocked(global.navigator.credentials.create).mockResolvedValue(
      makeMockCredentialNoPrf(credKey) as unknown as PublicKeyCredential
    );

    const result = await createPasskey(minimalCreateOptions, {
      salt: new TextEncoder().encode('near-phantom-auth-prf-v1'),
    });
    expect(result.sealingKeyHex).toBeUndefined();
  });
});
```

**Validation schema tests in existing `validation.test.ts`** — follow the existing `safeParse` pattern (lines 79–135):
```typescript
describe('registerFinishBodySchema — sealingKeyHex', () => {
  it('accepts body without sealingKeyHex (PRF unsupported)', () => {
    const result = registerFinishBodySchema.safeParse(validRegisterFinishBody);
    expect(result.success).toBe(true);
  });

  it('accepts body with valid 64-char hex sealingKeyHex', () => {
    const result = registerFinishBodySchema.safeParse({
      ...validRegisterFinishBody,
      sealingKeyHex: 'a'.repeat(64),
    });
    expect(result.success).toBe(true);
  });

  it('rejects sealingKeyHex of 63 chars', () => {
    const result = registerFinishBodySchema.safeParse({
      ...validRegisterFinishBody,
      sealingKeyHex: 'a'.repeat(63),
    });
    expect(result.success).toBe(false);
  });

  it('rejects sealingKeyHex with uppercase hex', () => {
    const result = registerFinishBodySchema.safeParse({
      ...validRegisterFinishBody,
      sealingKeyHex: 'A'.repeat(64),
    });
    expect(result.success).toBe(false);
  });
});
```

---

## Shared Patterns

### Optional param threading (all modified functions)

**Source:** `src/client/api.ts` lines 39–45 (`username?: string`) and `src/client/passkey.ts` lines 87–91 (`excludeCredentials?.map`)

All new params (`prfOptions`, `sealingKeyHex`) follow the trailing-optional convention: new optional params go at the end of the function signature, never before existing required params.

### Error surfacing in React hook

**Source:** `src/client/hooks/useAnonAuth.tsx` lines 206–212 (register catch) and 243–249 (login catch)

```typescript
} catch (error) {
  setState((prev) => ({
    ...prev,
    isLoading: false,
    error: error instanceof Error ? error.message : 'Registration failed',
  }));
}
```

The `requirePrf` guard throws `new Error(...)` inside the try block, which this catch block converts to `state.error`. No new catch/error infrastructure needed.

### Conditional POST body field (critical anti-pattern avoidance)

**Source:** `src/client/api.ts` line 130 (`username` is included even when undefined — JS strips `undefined` from JSON but only at top level)

**For `sealingKeyHex` specifically**, use the spread-conditional pattern per RESEARCH.md Pitfall 2:
```typescript
...(sealingKeyHex ? { sealingKeyHex } : {})
```
This guarantees the key is absent from the serialized body, not present as `null`.

### Zod optional field with validation

**Source:** `src/server/validation/schemas.ts` lines 193–196

```typescript
state: z.string().min(1).optional(),
```

For `sealingKeyHex`, use regex validation instead of `.min(1)` to enforce 64-char lowercase hex:
```typescript
sealingKeyHex: z.string().regex(/^[0-9a-f]{64}$/).optional(),
```

### TypeScript `as unknown as X` cast for mock objects in tests

**Source:** `src/__tests__/passkey.test.ts` lines 130, 193 — `{} as any` for credential objects

For PRF tests, use `makeMockCredentialWithPrf(...) as unknown as PublicKeyCredential` to satisfy TypeScript without `as any`. The `as unknown as` double-cast is the existing codebase convention for test fixtures.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/__tests__/prf.test.ts` | test (new) | — | No existing test that mocks `navigator.credentials` in Node environment; closest analog is `passkey.test.ts` for structure and `validation.test.ts` for schema assertion shape |

---

## Key Observations for Planner

1. **`DEFAULT_PRF_SALT` location:** Define as module-level constant in `useAnonAuth.tsx` (above `AnonAuthProvider`), not inside the function. This matches `AnonAuthContext` declaration at line 87. The same constant should NOT be in `passkey.ts` — the salt flows in from the hook, not from the WebAuthn layer.

2. **Two TypeScript type surfaces for PRF:** `src/types/index.ts` gets `AnonAuthConfig.passkey` (server-side type documentation only). `AnonAuthProviderProps` in `useAnonAuth.tsx` gets the same shape (runtime browser config). These must be kept in sync.

3. **`RegistrationResponseJSON` / `AuthenticationResponseJSON` type extension:** `createPasskey` and `authenticateWithPasskey` now return `& { sealingKeyHex?: string }`. This extended return type must be reflected in the type definitions if these types are exported. Currently `RegistrationResponseJSON` (line 479 of `types/index.ts`) and `AuthenticationResponseJSON` (line 495) do not include `sealingKeyHex`. The planner should decide whether to add it to the shared types or use intersection types locally.

4. **`username?` in `registerFinishBodySchema`:** Currently `username` is NOT explicitly in the schema but is accepted via the POST body (sent by `finishRegistration`). When adding `sealingKeyHex`, also consider making `username` explicit (currently stripped/ignored by schema). Not required for PRF but worth noting.

5. **`package-lock.json`:** Version bump must also update `package-lock.json` — see commit `b7cc565` which modifies both files.

---

## Metadata

**Analog search scope:** `src/client/`, `src/server/`, `src/__tests__/`, root config files
**Files scanned:** 14 source files + vitest.config.ts + package.json
**Pattern extraction date:** 2026-04-19
