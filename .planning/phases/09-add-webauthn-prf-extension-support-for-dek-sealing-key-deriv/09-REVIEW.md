---
phase: 09-add-webauthn-prf-extension-support-for-dek-sealing-key-deriv
reviewed: 2026-04-19T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/types/index.ts
  - src/server/validation/schemas.ts
  - src/server/index.ts
  - src/__tests__/validation.test.ts
  - src/__tests__/prf.test.ts
  - src/client/passkey.ts
  - src/client/api.ts
  - src/client/hooks/useAnonAuth.tsx
findings:
  critical: 0
  warning: 3
  info: 5
  total: 8
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-04-19
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 9 introduces the WebAuthn Level 3 PRF extension for deterministic DEK sealing-key
derivation. The implementation is thoughtful and well-documented: PRF is optional by
default (graceful degradation), `requirePrf` is checked on both the register and login
paths, `DEFAULT_PRF_SALT` is a module-level immutable value, and the server-side zod
schemas correctly validate `sealingKeyHex` as 64-char lowercase hex. The localized
`PRFExtensionInput`/`PRFExtensionOutput` typing avoids a broad `as any` escape and keeps
strict typing at call sites.

No Critical issues were found. The sealing key is never logged, `DEFAULT_PRF_SALT` is
frozen at module scope, the regex validator is tight (exactly 64 chars, lowercase-only),
and body threading correctly omits the key when undefined (no `null` leak).

Three Warnings are worth addressing before this is considered production-ready:

1. The PRF output byte-length is not validated on the client — a non-compliant
   authenticator returning a non-32-byte PRF result would silently produce a
   `sealingKeyHex` of arbitrary length that would then fail server-side zod validation
   with no actionable error.
2. The server accepts and validates `sealingKeyHex`, but no route handler currently
   reads it. This is by design per the docs, but future consumers must be aware the
   field is effectively discarded today; the attack surface of accepting unused data
   from authenticated POSTs is minor but worth flagging.
3. The `requirePrf` guard runs *after* `navigator.credentials.create()`/`.get()`. The
   user has already consented to the ceremony and, on registration, a credential has
   been provisioned on the authenticator before we throw. This leaves an orphaned
   credential on the device with no server-side record. Non-blocking (downstream
   pruning possible) but counter-intuitive.

The remaining Info items are minor: dependency array coverage for `isLikelyCloudSynced`,
defensive clearing of the hex buffer, a regex alignment detail, and duplicated
`getClientExtensionResults()` calls.

---

## Warnings

### WR-01: Client does not verify PRF output is exactly 32 bytes before hex-encoding

**File:** `src/client/passkey.ts:138-140`, `src/client/passkey.ts:226-228`
**Issue:**
`arrayBufferToHex(prfResult)` is called unconditionally when `ext.prf?.results?.first`
is truthy. The WebAuthn Level 3 spec mandates a 32-byte PRF output, but there is no
client-side assertion of that invariant. A non-compliant or malicious authenticator
(or a future spec amendment) that returned, say, 16 bytes would produce a 32-char hex
string; 64 bytes would produce a 128-char hex string. Both would be rejected
server-side by the zod regex (`/^[0-9a-f]{64}$/`) with a generic 400 — but:

- The user sees an opaque "Request failed: 400" from `api.ts:113` instead of a clear
  "PRF output wrong length" error.
- The crypto invariant (32-byte sealing key) is only enforced transitively through
  string-length validation on the server, which is a weaker contract than the type
  intent ("this represents a 32-byte key").

Given this is a security-sensitive path, a local invariant check is worth a few lines.

**Fix:**
```ts
// in createPasskey and authenticateWithPasskey, right where prfResult is extracted:
const ext = credential.getClientExtensionResults() as PRFExtensionOutput;
const prfResult: ArrayBuffer | undefined = ext.prf?.results?.first;
if (prfResult && prfResult.byteLength !== 32) {
  // Never happens with spec-compliant authenticators; guards against misbehaving
  // authenticators and anchors the 32-byte invariant at the source.
  throw new Error(
    `PRF_UNEXPECTED_LENGTH: expected 32 bytes, got ${prfResult.byteLength}`,
  );
}
const sealingKeyHex: string | undefined = prfResult
  ? arrayBufferToHex(prfResult)
  : undefined;
```

---

### WR-02: Server accepts `sealingKeyHex` but no route handler consumes it

**File:** `src/server/validation/schemas.ts:38`, `src/server/validation/schemas.ts:79`
**Issue:**
Both `registerFinishBodySchema` and `loginFinishBodySchema` declare
`sealingKeyHex: z.string().regex(/^[0-9a-f]{64}$/).optional()`, and the client code
threads the value into POST bodies, but a workspace grep shows `sealingKeyHex` is not
referenced anywhere under `src/server/` outside of `schemas.ts`. Neither the router
nor the passkey manager currently stores or forwards this value. The JSDoc on
`AnonAuthConfig.passkey` (`src/types/index.ts:74-75`) explicitly notes "the library
does not use this value at runtime on the server" — so this is intentional for Phase 9.

Concerns:
1. Future phases that wire the server consumer will need to be aware that
   `registerFinishBodySchema` strips unknown fields by default (zod default behavior) —
   but `sealingKeyHex` is *known* here, so it survives parsing and ends up on the
   validated object. A downstream maintainer may assume "if it's on the validated
   body, somebody uses it." Good surprise — but worth a comment on the schema.
2. Accepting but discarding a client-provided key material field (even one derived
   client-side) on an authenticated endpoint is a minor SEC concern only if the value
   ever ends up in logs. A quick check of `src/server/router.ts` would confirm the
   validated body is not spread into a logger call — please verify as part of the
   fix, since the router was not in scope for this review.

**Fix:**
Add a code comment in `schemas.ts` near each `sealingKeyHex` line explaining the
phased rollout:
```ts
// PRF-08: sealingKeyHex is validated here for Phase 9 but not consumed by any route
// handler yet. Future phases will forward this to the DEK storage layer. Do NOT
// log the validated body as-is — treat sealingKeyHex as key material.
sealingKeyHex: z.string().regex(/^[0-9a-f]{64}$/).optional(),
```

Additionally, audit `src/server/router.ts` (out of this review's scope) to confirm
`registerFinishBodySchema.parse(req.body)` output is never passed whole to
`logger.info` / `logger.debug` — extract fields individually.

---

### WR-03: `requirePrf` guard runs after credential provisioning, leaving orphaned credentials

**File:** `src/client/hooks/useAnonAuth.tsx:207-210`, `src/client/hooks/useAnonAuth.tsx:257-260`
**Issue:**
In `register()`:
```ts
const credential = await createPasskey(options, { salt: prfSalt });  // line 207 — authenticator provisions the credential
if (passkey?.requirePrf && !credential.sealingKeyHex) {
  throw new Error('PRF_NOT_SUPPORTED: ...');                          // line 209 — user's authenticator now holds a passkey we will never register
}
```

When `requirePrf: true` and the authenticator does not support PRF, the credential has
already been created on the device (platform keychain entry, hardware key slot, etc.)
by the time we throw. The server-side `register/finish` is never called, so the user
now has an orphaned passkey on their authenticator with no corresponding account —
which cannot be cleaned up remotely and will confuse users at next login ("I see a
passkey for this site but can't sign in with it").

For `login()` (line 257-260) the concern is smaller — `authenticateWithPasskey` does
not create a new credential — but the ceremony still prompted the user for biometrics
and the authenticator's counter has advanced.

Current behavior is not incorrect per WebAuthn spec (once `create()` resolves, the
credential exists), but the UX/cleanup implications are worth flagging for the
`requirePrf: true` path specifically.

**Fix:**
Two options — pick based on Phase 9 intent:

Option A (preferred, pre-flight check): Detect PRF support *before* calling
`createPasskey` by inspecting `PublicKeyCredential.getClientCapabilities?.()` (where
available) or probing via a throwaway `create()` with `extensions.prf.eval.first` and
checking `getClientExtensionResults().prf?.enabled`. Gate the real ceremony on that.

Option B (document the trade-off): Keep the current check and add a JSDoc note on the
`requirePrf` prop and a comment at the throw site explaining that the user's
authenticator will hold an orphaned credential. Also consider not throwing at all on
the login path if the PRF was absent — the counter bump is harmless, but the UX of
"login failed because of PRF" when the user's credential is otherwise valid is odd.

```ts
// Suggested Option B comment:
// NOTE: requirePrf is enforced AFTER navigator.credentials.create() resolves, so the
// authenticator has already provisioned the credential. If rejection happens here, the
// user will have an orphaned passkey on their device with no server-side account. This
// is an acceptable trade-off because PRF support is detectable only via a real
// ceremony in most browsers today; a pre-flight probe should be added when browser
// support for PublicKeyCredential.getClientCapabilities() is mainstream.
if (passkey?.requirePrf && !credential.sealingKeyHex) {
  throw new Error('PRF_NOT_SUPPORTED: ...');
}
```

---

## Info

### IN-01: `isLikelyCloudSynced` not in `register` useCallback dependency array

**File:** `src/client/hooks/useAnonAuth.tsx:213`, `src/client/hooks/useAnonAuth.tsx:246`
**Issue:**
`register` captures `isLikelyCloudSynced` (imported module function, line 213), but
it is a stable module-level import, so omitting it from the dependency array is
correct. However, the explicit dep array `[api, passkey]` on line 246 does not match
what PRF test `prf.test.ts:427` checks: `/\},\s*\[\s*api,\s*passkey\s*\]/g`. The test
and implementation agree, so this is fine. Noting only because other imported hooks
(`createPasskey`, `authenticateWithPasskey`) are also captured and deliberately
omitted from deps — a one-line comment explaining the choice would save future
maintainers from a "should this be in deps?" detour.

**Fix:**
Add a brief comment above the closing bracket of `register`/`login`:
```ts
  // Module-imported helpers (createPasskey, authenticateWithPasskey,
  // isLikelyCloudSynced) are stable and intentionally omitted from deps.
}, [api, passkey]);
```

---

### IN-02: `getClientExtensionResults()` called twice in both passkey functions

**File:** `src/client/passkey.ts:138,152`, `src/client/passkey.ts:226,241`
**Issue:**
In `createPasskey`:
```ts
const ext = credential.getClientExtensionResults() as PRFExtensionOutput;  // line 138
...
clientExtensionResults: credential.getClientExtensionResults() as Record<string, unknown>,  // line 152
```
Same pattern on lines 226 and 241 of `authenticateWithPasskey`. Not a correctness
issue (the method is idempotent and returns fresh objects), but it's wasted work and
potentially a subtle hazard: if a future browser returned a different object on the
second call (non-spec but conceivable), the serialized `clientExtensionResults`
shipped to the server would disagree with the one used to extract `prfResult`
locally. Re-use the first result.

**Fix:**
```ts
const ext = credential.getClientExtensionResults() as PRFExtensionOutput;
const prfResult: ArrayBuffer | undefined = ext.prf?.results?.first;
const sealingKeyHex: string | undefined = prfResult ? arrayBufferToHex(prfResult) : undefined;
...
return {
  ...
  clientExtensionResults: ext as unknown as Record<string, unknown>,
  ...
};
```

---

### IN-03: Sealing key material lives in JS strings (no zeroization)

**File:** `src/client/passkey.ts:140`, `src/client/hooks/useAnonAuth.tsx:222,263`
**Issue:**
`sealingKeyHex` is a JavaScript `string`, which is immutable and cannot be zeroed
from memory. Even the underlying `Uint8Array` from `new Uint8Array(prfResult)` inside
`arrayBufferToHex` is not wiped. This is standard for web crypto (the platform
doesn't offer `sodium_memzero`), and `DEFAULT_PRF_SALT` is non-secret, so this is
not a Critical gap — but it's worth documenting so that downstream consumers of
`credential.sealingKeyHex` know the value may persist in memory until GC.

Downstream phases that store or forward this value should:
- Avoid placing it in long-lived closures / React state.
- Pass it directly to the crypto primitive and let the reference drop.
- Consider using a transient `Uint8Array` for the raw bytes and calling `.fill(0)`
  before it goes out of scope, although strings derived from it can't be wiped.

**Fix:**
Add a JSDoc on the returned shape in `passkey.ts`:
```ts
/**
 * @property sealingKeyHex - 64-char lowercase hex (32-byte PRF output). SECURITY:
 * This is key material; avoid placing in long-lived state or logs. Strings cannot
 * be memory-wiped in JS; scope consumers as tightly as possible.
 */
```

---

### IN-04: Regex could allow length-check alternative for clearer errors

**File:** `src/server/validation/schemas.ts:38,79`
**Issue:**
`z.string().regex(/^[0-9a-f]{64}$/)` correctly enforces both length (64 chars) and
charset (lowercase hex), but the error message from zod is a generic "Invalid" with
the regex string. A user who sends an uppercase-hex `sealingKeyHex` gets the same
error as one who sends a 63-char one. Splitting the check would produce more
actionable errors and make the intent explicit:

**Fix:**
```ts
sealingKeyHex: z
  .string()
  .length(64, 'sealingKeyHex must be exactly 64 hex characters (32 bytes)')
  .regex(/^[0-9a-f]+$/, 'sealingKeyHex must contain only lowercase hex characters')
  .optional(),
```

This is cosmetic — the security posture is identical — but it surfaces clearer
errors to the client, which helps debug the rare case of a misbehaving authenticator
(see WR-01).

---

### IN-05: `clientExtensionResults` shipped to server retains raw PRF output ArrayBuffer reference

**File:** `src/client/passkey.ts:152`, `src/client/passkey.ts:241`
**Issue:**
`credential.getClientExtensionResults()` returns an object that, when PRF is active,
contains `prf.results.first` as an `ArrayBuffer`. This object is passed through as
`clientExtensionResults: credential.getClientExtensionResults() as Record<string, unknown>`
to `JSON.stringify` in `api.ts:108`. `JSON.stringify` serializes an `ArrayBuffer` as
`{}` (no enumerable own properties), so the raw PRF bytes are *not* leaked to the
server — good, this is the correct silent behavior.

However, this depends on an implementation detail of `JSON.stringify` + `ArrayBuffer`.
Worth a unit test pinning the behavior, and/or explicitly stripping `prf` from
`clientExtensionResults` before shipping to be defensive:

**Fix (defensive):**
```ts
// Strip raw PRF output from the extension results we ship — we've already extracted
// sealingKeyHex; the server has no need for the raw ArrayBuffer and future JSON
// serialization behavior changes could inadvertently leak it.
const rawExt = credential.getClientExtensionResults() as Record<string, unknown> & {
  prf?: unknown;
};
const { prf: _prf, ...extWithoutPrf } = rawExt;
...
return {
  ...
  clientExtensionResults: extWithoutPrf,
  ...
};
```

---

_Reviewed: 2026-04-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
