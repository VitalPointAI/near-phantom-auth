---
phase: 12-multi-rp-id-verification
reviewed: 2026-04-29T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - README.md
  - src/__tests__/exports.test.ts
  - src/__tests__/passkey.test.ts
  - src/__tests__/related-origins.test.ts
  - src/server/index.ts
  - src/server/passkey.ts
  - src/server/relatedOrigins.ts
  - src/server/webauthn.ts
  - src/types/index.ts
findings:
  critical: 0
  warning: 6
  info: 4
  total: 10
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-04-29T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 12 ships WebAuthn Related Origin Requests (ROR) support via a paired-tuple
`{origin, rpId}` model, a startup validator (`validateRelatedOrigins`), and
conditional-spread idioms in `passkey.ts`. The core security property — that
pairing intent cannot be silently broken by a refactor — is preserved by the
tuple-shaped input and stable `.map()` projection at the call sites. No
exploitable origin-spoof was identified.

However, the `validateRelatedOrigins` function has a number of validator
permissiveness issues that admit malformed configs which then silently fail
to authenticate at runtime, plus several missing-symmetry defects (no
inter-entry duplicate detection, case-sensitive primary-duplicate check,
no normalization between primary rpId and entry rpId). The standalone
`verifyRegistration`/`verifyAuthentication` API also exposes parallel
`string[]` arrays for `expectedOrigin`/`expectedRPID` even though the README
expressly warns against parallel-array consumer surfaces — an API design
inconsistency the consumer can easily get wrong.

All findings are WARNING-class (degrade quality, robustness, or DX) or INFO.
None are BLOCKER-class (no exploit, no data loss, no crash on supported input).
The phase is shippable, but the warnings should be addressed before this
becomes a stable v0.7.0 surface that consumers pin against.

## Warnings

### WR-01: HTTPS_RE regex permits `userinfo` (`user:pass@`) in origin

**File:** `src/server/relatedOrigins.ts:15`
**Issue:**
The character class `[^*\s/?#]+` does NOT exclude the `@` character. Inputs like
`https://attacker.com@shopping.co.uk` pass `HTTPS_RE.test()`. After parsing
through `new URL(...)`, the hostname normalizes to `shopping.co.uk` (the part
after `@`), and the suffix-domain check then PASSES because the entry's `rpId`
is `shopping.co.uk`. Net effect: the validator admits an `e.origin` string that
will never literally equal any browser-produced origin (browsers strip
userinfo from `clientDataJSON.origin`), so authentication for that "related
domain" silently fails at runtime instead of failing fast at startup. Not
exploitable — but a misconfiguration that completely defeats the
"throws with a classified message — no silent acceptance into production"
contract documented at the top of the file.

`HTTPS_RE` also accepts other syntactically-suspect inputs that a stricter
parse would reject, e.g.:
- `https://shopping.com:99999` (port > 65535)
- `https://[evil]` (square brackets — non-IPv6 garbage)
- `https://shopping.com:abc` is correctly rejected, but `https://:8080` (no
  host) is accepted.

**Fix:**
Drop the regex and lean on `new URL(e.origin)` for parsing, then assert the
serialized form matches a normalized origin (no path, no query, no fragment,
no userinfo, no trailing slash):

```typescript
let u: URL;
try {
  u = new URL(e.origin);
} catch {
  throw new Error(`rp.relatedOrigins[${i}]: origin "${e.origin}" is not a valid URL`);
}
if (u.username || u.password) {
  throw new Error(`rp.relatedOrigins[${i}]: origin must not contain userinfo`);
}
if (u.pathname !== '/' && u.pathname !== '') {
  throw new Error(`rp.relatedOrigins[${i}]: origin must not contain a path`);
}
if (u.search || u.hash) {
  throw new Error(`rp.relatedOrigins[${i}]: origin must not contain query/fragment`);
}
const isHttps = u.protocol === 'https:';
const isLocalhostHttp = u.protocol === 'http:' && u.hostname === 'localhost' && e.rpId === 'localhost';
if (!isHttps && !isLocalhostHttp) { /* existing throw */ }
// And use u.origin (or u.protocol + '//' + u.host) downstream so the
// subsequent comparison works on a normalized form.
```

---

### WR-02: Primary-duplicate check is case-sensitive on both `origin` and `rpId`

**File:** `src/server/relatedOrigins.ts:96-101`
**Issue:**
The check uses strict equality:
```typescript
if (e.origin === primaryOrigin && e.rpId === primaryRpId) { throw ... }
```
A consumer who configures `rp: { id: 'Shopping.com', origin: 'https://Shopping.com' }`
and then lists `{ origin: 'https://shopping.com', rpId: 'shopping.com' }` as a
related origin sees NO duplicate-of-primary error — even though the browser
treats both as the same origin. The entry sails into the
`expectedOrigin`/`expectedRPID` arrays at verify time and looks like a valid
"different" origin to the validator, but is functionally a duplicate.

The suffix-domain check operates on lowercased values, so it passes too —
masking the issue at startup.

**Fix:**
Normalize both sides before comparison and reject case-only differences:

```typescript
const entryOriginLower = e.origin.toLowerCase();
const entryRpIdLower = e.rpId.toLowerCase();
const primaryOriginLower = primaryOrigin.toLowerCase();
const primaryRpIdLower = primaryRpId.toLowerCase();
if (entryOriginLower === primaryOriginLower && entryRpIdLower === primaryRpIdLower) {
  throw new Error(/* existing message */);
}
```

(Better: define a shared `normalizeOrigin(s)` helper used by both the suffix
check and the duplicate check so they stay in lock-step.)

---

### WR-03: No duplicate detection between RELATED entries

**File:** `src/server/relatedOrigins.ts:58-102`
**Issue:**
The validator loops entries one-by-one, checking each in isolation. A consumer
who writes:
```typescript
relatedOrigins: [
  { origin: 'https://shopping.co.uk', rpId: 'shopping.co.uk' },
  { origin: 'https://shopping.co.uk', rpId: 'shopping.co.uk' },  // copy-paste dup
  { origin: 'https://shopping.ie',    rpId: 'shopping.ie' },
],
```
sees no error. The dup wastes one of the 5-entry cap slots and bloats the
`expectedOrigin`/`expectedRPID` arrays without adding any new origin coverage.
Browser ROR support has a 5-LABEL minimum guarantee — duplicates inside the
config eat into that budget silently.

The phase comment block explicitly calls out "loud-fail, do NOT silent-dedupe"
as the design intent for primary duplicates (line 95); the same intent should
apply to inter-entry duplicates.

**Fix:**
Track seen tuples as you iterate:

```typescript
const seen = new Set<string>();
for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  // ... existing shape/wildcard/scheme/suffix checks ...
  const key = `${e.origin.toLowerCase()}|${e.rpId.toLowerCase()}`;
  if (seen.has(key)) {
    throw new Error(
      `rp.relatedOrigins[${i}]: duplicate entry { origin: "${e.origin}", rpId: "${e.rpId}" } already appears earlier in the list`,
    );
  }
  seen.add(key);
  // ... existing primary-duplicate check ...
}
```

---

### WR-04: Standalone `VerifyRegistrationInput`/`VerifyAuthenticationInput` expose parallel `string[]` despite README warning against parallel arrays

**File:** `src/server/webauthn.ts:98,103,172,175`
**Issue:**
The README's "Security: paired tuple vs parallel arrays" section (lines 173-184)
explicitly warns:
> The library uses an Array<{origin, rpId}> paired-tuple shape — NOT two
> parallel arrays — because @simplewebauthn/server does not cross-check
> origin↔rpId pairing. ... If your config drifted (e.g. via a .map() reorder
> of one array), the library would accept assertions where originA was signed
> under rpIdB.

But the standalone `verifyRegistration` / `verifyAuthentication` API (the
ones documented at `src/server/index.ts:286-302` for framework-agnostic use)
ship exactly that anti-pattern: `expectedOrigin: string | string[]` and
`expectedRPID: string | string[]` as two independent fields. The doc-comment
even concedes the risk:
> pair-with-rpID enforcement is the caller's responsibility

This is a structural inversion from the consumer-facing `createAnonAuth` path,
which forces pairing by tuple shape. Consumers who reach for the standalone
helpers (e.g., for Next.js route handlers, per the JSDoc example at line 8-19)
get the exact footgun the README warns against.

**Fix:**
One of:

1. Add a paired-tuple alternative input shape and prefer it in docs:

```typescript
export type AllowedOriginRpId =
  | { expectedOrigin: string; expectedRPID: string }
  | { expectedOrigins: ReadonlyArray<{ origin: string; rpId: string }> };
```

Then in the implementation, `Array.isArray(input.expectedOrigins)` projects to
two parallel arrays at the @simplewebauthn boundary, but the consumer never
holds parallel arrays themselves.

2. (Cheaper) Document the same R3 origin-spoofing concern in the JSDoc on
`VerifyRegistrationInput.expectedOrigin` with the same severity as the README,
and add a runtime length-mismatch check inside `verifyRegistration` /
`verifyAuthentication`:

```typescript
if (Array.isArray(expectedOrigin) !== Array.isArray(expectedRPID)) {
  return { verified: false, error: 'expectedOrigin/expectedRPID must be both string OR both array' };
}
if (Array.isArray(expectedOrigin) && expectedOrigin.length !== expectedRPID.length) {
  return { verified: false, error: 'expectedOrigin and expectedRPID must have equal length when arrays' };
}
```

---

### WR-05: `validateRelatedOrigins` does NOT verify entry rpIds align with the primary registrable-domain set

**File:** `src/server/relatedOrigins.ts:45-104`
**Issue:**
WebAuthn ROR semantics require that browsers fetch
`https://{primaryRpId}/.well-known/webauthn` and accept assertions whose
effective domain matches an entry from that document's `origins` array. A
consumer who configures `relatedOrigins` server-side but forgets to update
the `/.well-known/webauthn` JSON document on the primary domain will see all
authentication attempts from related domains silently fail in-browser
(SecurityError). The validator has zero hooks to detect this drift —
neither at startup nor at first request — even though the consumer-owned
`/.well-known/webauthn` contract is THE critical pairing the library
requires for the feature to work.

This is a documentation+runtime gap, not a security bug: the symptoms are
"my passkey works on the primary domain but not on the .co.uk domain."

**Fix:**
Add a startup-time fetch (gated behind an opt-in flag like
`rp.verifyWellKnown: true`) that:

```typescript
async function verifyWellKnownConsistency(primaryOrigin: string, entries: RelatedOrigin[]) {
  const url = `${primaryOrigin}/.well-known/webauthn`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`/.well-known/webauthn returned ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new Error(`/.well-known/webauthn must serve Content-Type: application/json, got "${ct}"`);
  }
  const body = await res.json() as { origins?: string[] };
  if (!Array.isArray(body.origins)) throw new Error(`/.well-known/webauthn missing "origins" array`);
  const documented = new Set(body.origins.map(o => o.toLowerCase()));
  for (const e of entries) {
    if (!documented.has(e.origin.toLowerCase())) {
      throw new Error(
        `rp.relatedOrigins entry "${e.origin}" is NOT listed in ${url}. ` +
        `Browsers will reject cross-domain passkeys for this origin.`,
      );
    }
  }
}
```

Even without runtime fetching, the README should be amplified to the
"production checklist" with: "MUST verify your /.well-known/webauthn
matches your `relatedOrigins` config — drift causes silent SecurityError."

---

### WR-06: `LOCALHOST_HTTP_RE` is case-sensitive but `RPID_RE` accepts uppercase, breaking the localhost coupling for case-mixed configs

**File:** `src/server/relatedOrigins.ts:16,69`
**Issue:**
`LOCALHOST_HTTP_RE = /^http:\/\/localhost(:[0-9]+)?$/` has no `/i` flag, so
`http://LOCALHOST:3000` is NOT matched. The coupled rpId check uses strict
equality `e.rpId === 'localhost'`, which also rejects `'Localhost'`.

Meanwhile, `RPID_RE` uses `/i` so an entry like
`{ origin: 'http://localhost:3000', rpId: 'Localhost' }` passes RPID validation.
The localhost-coupling check then compares `'Localhost' === 'localhost'` →
false, falls through, fails the `isHttps` check, and throws a "must be https://"
error — even though the consumer's intent was clearly localhost dev.

The error message is misleading (says "use https://" when the actual fix is
"lowercase your localhost rpId").

**Fix:**
Lowercase both sides before the localhost coupling test:

```typescript
const originLower = e.origin.toLowerCase();
const rpIdLower = e.rpId.toLowerCase();
const isHttps = HTTPS_RE.test(originLower);
const isLocalhostHttp = LOCALHOST_HTTP_RE.test(originLower) && rpIdLower === 'localhost';
```

(This dovetails with the WR-01 fix that uses `URL` parsing — the parsed
hostname is already lowercased.)

## Info

### IN-01: Source-level test invariants are brittle and forbid future maintenance

**File:** `src/__tests__/related-origins.test.ts:265-285`
**Issue:**
Three regex-on-source assertions check for very specific syntactic forms:

- Lines 268-269: requires the literal string `expectedOrigin: config.relatedOrigins.length === 0` (no whitespace tolerance, no helper-extraction permitted).
- Line 271: requires the literal pattern `[config.origin, ...config.relatedOrigins.map(r => r.origin)]` — refactoring this into a helper like `buildExpectedOrigins(config)` breaks the test.
- Line 279: hard-codes `expect(matches.length).toBe(4)`.

Future maintenance that pulls the spread into a shared helper (entirely
sensible for a 2-call-site duplication that exists today) will trip these
tests with no actual behavioral regression. Source-shape tests are
load-bearing here for "no .filter()/.sort() drift" — a finer-grained guard
would express that semantic without freezing the literal text.

**Fix:**
Either:
- Replace source-level assertions with behavioral integration tests that
  feed a paired-tuple config through `createAnonAuth` and assert the resulting
  call to `verifyRegistrationResponse` / `verifyAuthenticationResponse` was
  invoked with `expectedOrigin = [primary, ...others]` in the right order
  (vi.mocked spy assertions are already in scope).
- Or relax the regexes to permit whitespace-insensitive matches and helper
  extraction.

---

### IN-02: `RPID_RE` accepts IPv4 literals as rpIds

**File:** `src/server/relatedOrigins.ts:18`
**Issue:**
`RPID_RE` accepts `1.2.3.4` as a valid rpId — each segment is `[a-z0-9]...`
which matches numeric labels. WebAuthn rpIds MUST be valid registrable
domains; bare IPv4 literals fail browser-side checks (no eTLD+1) and also
cannot satisfy `/.well-known/webauthn` hosting (no TLS cert for an IP without
extra setup). The library would accept the config and silently fail at
runtime.

Not a security issue (browsers reject anyway), but a fail-fast opportunity
the validator misses.

**Fix:**
Reject all-numeric labels:

```typescript
if (/^(\d+\.){3}\d+$/.test(e.rpId)) {
  throw new Error(`rp.relatedOrigins[${i}]: rpId "${e.rpId}" looks like an IPv4 literal — WebAuthn requires a registrable domain`);
}
```

Or check for at least one alphabetic character per label.

---

### IN-03: Trailing-slash origins are silently rejected with a misleading error

**File:** `src/server/relatedOrigins.ts:15,68-74`
**Issue:**
`HTTPS_RE.test('https://shopping.co.uk/')` returns false (because `/` is in
the exclusion class). The consumer sees: `origin must be https:// (got
"https://shopping.co.uk/"). http:// is only permitted when rpId === "localhost".`

The error message is wrong — the origin IS `https://`, the issue is the
trailing slash. WebAuthn origins per spec have no trailing slash (the path
component is empty), but a consumer copy-pasting from a browser address bar
will frequently include one. The error message should call out the actual
problem.

**Fix:**
Add an explicit trailing-slash branch with its own classified message:

```typescript
if (e.origin.endsWith('/') && e.origin !== 'http://localhost/' /* etc */) {
  throw new Error(`rp.relatedOrigins[${i}]: origin "${e.origin}" must not have a trailing slash`);
}
```

Or, per WR-01's fix, parse with `URL` and reject `pathname !== ''` with a
specific message.

---

### IN-04: README has stale phrasing that contradicts validator behavior

**File:** `README.md:130-137`
**Issue:**
The "Hosting requirements" bullet list states:
> - Maximum 5 unique eTLD+1 labels — entries beyond the cap are silently ignored

This describes the BROWSER's behavior (Chrome/Safari silently truncate to 5).
But the library's `validateRelatedOrigins` THROWS on `entries.length > 5`
(see `relatedOrigins.ts:51-57`). A reader of the README would assume that
shipping 6+ entries is harmless ("they're just silently ignored"), but the
consumer's `createAnonAuth(config)` will throw at startup.

The two paragraphs (browser limit vs library limit) are describing different
enforcement layers and need to be distinguished, otherwise the docs
contradict the code.

**Fix:**
Reword the README:

```
- Maximum 5 unique eTLD+1 labels — the library REJECTS configs with more
  than 5 entries at createAnonAuth() startup (validateRelatedOrigins
  throws with a classified message). This matches the browser-side
  guarantee that Chrome/Safari support a minimum of 5 labels; entries
  beyond the cap would be silently ignored by browsers anyway.
```

---

_Reviewed: 2026-04-29T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
