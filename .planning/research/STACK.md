# Stack Research — v0.7.0 Consumer Hooks & Recovery Hardening

**Domain:** Authentication SDK addition (npm library: `@vitalpoint/near-phantom-auth`)
**Researched:** 2026-04-29
**Confidence:** HIGH

**Headline:** **Zero new dependencies. Zero version bumps required.** v0.7.0 maintains the project's track record of additive feature work without dependency churn (consistent with v0.5.x, v0.6.0, v0.6.1). One *optional* patch bump (`@simplewebauthn/server` 13.2.3 → 13.3.0) is available if better punycode error messages are wanted, but not required for any of the 5 features.

---

## TL;DR Per Feature

| # | Feature | New Dep? | Version Bump? | Lib Sufficiency |
|---|---------|----------|---------------|-----------------|
| 1 | Backup-eligibility flag exposure | No | No | `backedUp` already returned by `@simplewebauthn/server` (`registrationInfo.credentialBackedUp`); already passed through `passkey.ts` line 197 — pure plumbing fix. |
| 2 | Second-factor enrolment hook | No | No | Pure config callback; no library does this for us. Use `AnonAuthConfig` extension. |
| 3 | Lazy-backfill hook | No | No | Pure config callback; existing `db.getPasskeyById` + `db.updatePasskey*` cover persistence. |
| 4 | Multi-RP_ID verification | No | **No** | `@simplewebauthn/server@^13.2.3` (currently pinned) **already accepts `string \| string[]` for `expectedRPID` and `expectedOrigin`** — feature has shipped since v1.0.0. We just stop hard-coding scalars. |
| 5 | Registration analytics hook | No | No | Pure config callback. Hash op via Node built-in `crypto.createHash('sha256')` — no lib needed. |

---

## Recommended Stack (v0.7.0)

### Core Technologies — Already Pinned, Sufficient

| Technology | Pinned Version | Purpose for v0.7.0 | Why No Change |
|------------|---------------|---------------------|---------------|
| `@simplewebauthn/server` | `^13.2.3` | Multi-RP_ID via `expectedRPID: string[]` | API has accepted `string \| string[]` since v1.0.0; verified against current master `verifyAuthenticationResponse.ts` and v13 docs. Latest is v13.3.0 (2025-03-10) — patch bump only, no API changes. |
| `zod` | `^4.3.6` | Validate consumer-supplied hook return shapes (e.g., second-factor enrolment result) | Already the project's runtime validator (Phase 2). Hook input/output types described as zod schemas keeps the hardening pattern consistent. |
| `pino` | `^10.3.1` | Log hook invocations + analytics callback errors with redaction | Already wired with redact paths (Phase 3 + MPC-09). Consumer-supplied callbacks should be `try/catch`ed and logged via the project's logger — no separate hook-error library needed. |
| Node built-in `crypto` | n/a (Node ≥ 18 required) | SHA-256 hash of codename for the analytics hook (if consumer opts in to a hashed identifier) | `crypto.createHash('sha256').update(codename).digest('hex')` — built-in, no dependency. Avoids adding `bcrypt`/`argon2` (overkill for non-secret hashing). |

### Supporting Libraries — Not Needed

| Library | Why Considered | Why Rejected |
|---------|---------------|--------------|
| `@simplewebauthn/server@^14.x` | Future major release | **Does not exist as of 2026-04-29.** Latest is v13.3.0 (2025-03-10). Multi-RP_ID is in v13.2.3 already. Speculative. |
| `bcrypt` / `argon2` | Hashing the codename in the analytics hook | Codename is not a secret, hashing here is for cross-event correlation only — SHA-256 is fast, deterministic, dependency-free. Adding native bindings would break tsup's pure-JS dist guarantee. |
| `eventemitter3` / `mitt` | Event-bus for hooks (registration, login, backfill, 2FA) | The 5 hooks are a small, fixed set. A typed `AnonAuthConfig.hooks` object with optional callbacks is simpler, type-safer, and avoids runtime registration order issues. No dependency justified. |
| `rxjs` / observable libs | Reactive analytics pipeline | Same reason — out of scope. Consumer's analytics tool (Segment, Posthog, etc.) handles streaming; we just hand them an event object once. |
| `tsyringe` / DI containers | Wiring hooks into the manager graph | The project already does manual DI via `createAnonAuth()` factory. Fine for 5 hooks. |
| `ulid` / `uuid` (different) | Event correlation IDs in the analytics hook | `crypto.randomUUID()` (Node ≥ 18 built-in, already used in `passkey.ts:122`) is sufficient. |

### Development Tools — No Change

| Tool | Pinned Version | Notes |
|------|---------------|-------|
| `tsup` | `^8.5.1` | Already externalises `pino`, `express`, `react`. **No new externals** since no new deps. Existing `tsup.config.ts` continues to produce 4 entry points × 2 formats = 8 outputs. |
| `vitest` | `^4.0.18` | Existing 280-test suite extends with hook-invocation specs. No new test runner. |
| `typescript` | `^5.9.3` | Strict mode stays disabled (per `PROJECT.md` constraint). New hook callback types use existing patterns. |
| `@types/express` | `^5.0.6` | Already covers `Request` augmentation if any hook needs `req` access. |

---

## Installation

```bash
# v0.7.0 install delta:
# (none)
```

No `npm install` needed for v0.7.0 stack. The existing `package.json` dependencies are sufficient. **Optional** patch bump for upstream punycode improvements:

```bash
# Optional, NOT required for any v0.7.0 feature:
npm install @simplewebauthn/server@^13.3.0
```

---

## Per-Feature Stack Justification

### Feature 1 — Backup-eligibility flag exposure

**Library involvement:** Already covered by current `@simplewebauthn/server@^13.2.3`. The `verifyRegistrationResponse()` returns `registrationInfo.credentialBackedUp: boolean` (verified in `src/server/passkey.ts:197` — value is already extracted and passed to `passkeyData.backedUp`). The `verifyAuthenticationResponse()` does not return this directly because backup state is per-credential and persisted at registration time; for `/login/finish`, the value comes from the stored `passkeys` row.

**Code shape (no new deps):**
```typescript
// /register/finish → already has passkeyData.backedUp
return res.json({ ..., backedUp: passkeyData.backedUp });

// /login/finish → join the persisted row
const stored = await db.getPasskeyById(response.id);
return res.json({ ..., backedUp: stored.backedUp });
```

**Schema check:** Confirm `passkeys.backed_up` column exists in the Postgres adapter (it does — added with credential persistence). No migration.

**Confidence:** HIGH — verified by reading `webauthn.ts:259` and `passkey.ts:197`.

---

### Feature 2 — Second-factor enrolment hook

**Library involvement:** None. This is a config-extension feature.

**Stack pattern:**
```typescript
// New optional field on AnonAuthConfig
interface AnonAuthConfig {
  // ... existing fields
  hooks?: {
    afterPasskeyRegistration?: (ctx: {
      userId: string;
      codename: string;
      backedUp: boolean;
    }) => Promise<{ enrolled: boolean; reason?: string }>;
  };
}
```

The `/register/finish` route awaits the hook (if defined) before returning `{ verified: true }`. Hook errors are logged via existing `pino` logger and surface as 500 to the client (consumer's choice to throw or return `enrolled: false`).

**Why no library:** The 2FA implementation lives in the consumer's app (Twilio for SMS, `otplib` for TOTP, etc.). Our job is to **expose the hook point**, not to implement 2FA. Adding a 2FA library here would force a choice on consumers and bloat the dist.

**Validation:** Use `zod.object({ enrolled: z.boolean(), reason: z.string().optional() })` to validate the hook's return value at runtime — consistent with the Phase 2 input-validation pattern. No new dep (`zod` already pinned).

---

### Feature 3 — Lazy-backfill hook

**Library involvement:** None. Same config-callback pattern as Feature 2.

**Stack pattern:**
```typescript
interface AnonAuthConfig {
  hooks?: {
    backfillKeyBundle?: (ctx: {
      userId: string;
      codename: string;
    }) => Promise<{
      sealingKeyHex: string;       // PRF-derived, supplied by consumer or re-prompted via WebAuthn
      encryptedBackup?: string;    // Optional — IPFS CID + encrypted blob
    } | null>;
  };
}
```

Invoked from `/login/finish` when the persisted row has `NULL` for `sealing_key_wrapped` (or the legacy v0.5 `key_bundle` column). On success, the hook's result is persisted via existing `db.updatePasskey*` / `db.upsertKeyBundle` methods (already shipped in v0.6.0).

**Why no library:** The backfill content is already produced by existing code paths (PRF extension on the client, AES-256-GCM via Node `crypto` — both already shipped). No new crypto, network, or storage primitive needed.

**Database:** Schema already accommodates nullable `sealing_key_wrapped` (added in v0.6.0). No migration in v0.7.0 unless we add a `backfilled_at` audit column — defer to Requirements phase.

---

### Feature 4 — Multi-RP_ID verification

**Library involvement:** **`@simplewebauthn/server@^13.2.3` (current pin) is sufficient.** Verified three ways:

1. **Official docs** ([simplewebauthn.dev/docs/packages/server](https://simplewebauthn.dev/docs/packages/server)): "SimpleWebAuthn optionally supports verifying registrations from multiple origins and RP IDs! Simply pass in an **array** of possible origins and IDs for `expectedOrigin` and `expectedRPID` respectively."
2. **Source code** ([master/verifyAuthenticationResponse.ts](https://github.com/MasterKale/SimpleWebAuthn/blob/master/packages/server/src/authentication/verifyAuthenticationResponse.ts)): Type signature is `expectedOrigin: string | string[]; expectedRPID: string | string[];`.
3. **Changelog**: Multi-RPID/multi-origin support has been in the library since **v1.0.0** — predates our pin by years.

**Code shape (no version bump):**
```typescript
// PasskeyConfig accepts array
interface PasskeyConfig {
  rpName: string;
  rpId: string | string[];      // was: string
  origin: string | string[];    // was: string
  // ...
}

// Pass through to @simplewebauthn/server unchanged
verifyAuthenticationResponse({
  expectedRPID: config.rpId,
  expectedOrigin: config.origin,
  // ...
});
```

**Knock-on:** The `generateRegistrationOptions` / `generateAuthenticationOptions` calls accept only a **single** `rpID` (you register a credential against one RP ID, you can verify against many). So `PasskeyConfig` needs both:
- `rpId: string` (used for `generate*Options`) — call this `primaryRpId`
- `acceptedRpIds: string[]` (used for `verify*Response`) — superset including `primaryRpId`

This is a config-shape decision, not a dependency decision.

**Hosting requirement (NOT a stack item, but flagged for PITFALLS):** Browsers (Chrome/Edge 128+, Safari 18+) require a `/.well-known/webauthn` JSON document at the primary RP ID's origin listing the related origins. The library does not host this — it's the consumer's responsibility. Roadmap should include README guidance + a helper function `buildWellKnownWebAuthnJson(origins: string[])` — pure function, no dep.

**Optional bump rationale:** `@simplewebauthn/server@13.3.0` (2025-03-10) added punycode-aware error messages. Helpful if any consumer has IDN domains, but not required. Patch bump is safe.

**Confidence:** HIGH — verified against three independent sources (docs, source, changelog) plus current master.

---

### Feature 5 — Registration analytics hook

**Library involvement:** None.

**Stack pattern:**
```typescript
interface AnonAuthConfig {
  hooks?: {
    onAuthEvent?: (event: {
      type: 'register' | 'login' | 'backfill' | '2fa-enrolled';
      timestamp: number;
      codenameHash?: string;   // SHA-256(codename), only if consumer set hashCodename: true
      backedUp?: boolean;
      // EXPLICITLY ABSENT: codename, nearAccountId, userId, ipAddress, userAgent
    }) => void | Promise<void>;
  };
}
```

**Hashing:** Node built-in `crypto.createHash('sha256').update(codename).digest('hex')` — no dep. Codename is not secret; SHA-256 is appropriate (collision-resistant, deterministic for cross-event linking, fast).

**Why fire-and-forget by default:** Analytics must not block auth. Wrap the hook in `setImmediate(() => Promise.resolve(consumerHook(event)).catch(log.error))` or similar. Consumer that wants strict-ordering can return a Promise we await — opt-in via config flag.

**Anti-PII guardrail:** The `event` object's TypeScript type is the contract. We `Object.freeze()` it before passing. Defensive: type-level `Exclude<keyof T, 'codename' | 'userId' | 'nearAccountId'>` enforced via a branded `AnalyticsEvent` type. Tests assert no PII fields are present in the runtime payload (string match against payload JSON).

**No analytics-vendor libraries:** We do not import Segment, Posthog, Mixpanel, etc. The consumer's hook implementation calls those. Keeping us vendor-neutral is the whole point.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Optional callback fields on `AnonAuthConfig.hooks` | Event emitter (`EventEmitter`/`mitt`) | If we expected dynamic registration of multiple subscribers per event. We don't — each consumer wires one handler at config time. Skip. |
| `@simplewebauthn/server` array-form `expectedRPID` | Custom multi-pass verification (call `verifyAuthenticationResponse` once per RP ID) | Only if we wanted the assertion verified against fallback RP IDs in priority order with custom branching. Library handles it natively — no benefit to rolling our own. |
| Node built-in `crypto.createHash('sha256')` for codename hashing | `bcrypt`, `argon2`, `scrypt` | Use a slow KDF only if the input were a secret needing brute-force resistance. Codename is not secret — it's a public anonymous identifier. Wrong tool. |
| Synchronous hook contract with optional `await` | Background queue (BullMQ/Redis) | Only if analytics fan-out becomes hot enough to bottleneck auth. Not a v0.7.0 concern; consumer can offload from inside their hook. |
| Stay on `@simplewebauthn/server@13.2.3` | Bump to `13.3.0` | Consumers operating IDN/punycode domains (rare). Patch bump is safe but not required. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Speculative `@simplewebauthn/server@^14.x` | Does not exist (latest is 13.3.0 as of 2026-04-29). Don't pre-bump for an unreleased major. | Stay on `^13.2.3`. |
| `bcrypt` / `argon2` for codename hashing in analytics | Adds native bindings, breaks pure-JS dist, wrong primitive (codename is not a secret). | Node `crypto.createHash('sha256')`. |
| 2FA libraries (`speakeasy`, `otplib`, `twilio`) bundled into this SDK | Forces a 2FA choice on consumers; bloats dist; breaks vendor neutrality (the whole point of the hook). | Hook-only — consumer brings their own 2FA stack. |
| Analytics SDKs (`@segment/analytics-node`, `posthog-node`) bundled | Same reason — vendor neutrality. | Hook-only — consumer pipes events to their tool. |
| Storing `codename` or `nearAccountId` on the analytics event | Violates the project-wide "anonymous" invariant; would leak PII to the consumer's analytics pipeline. | Hash codename (opt-in) or omit identity entirely. |
| Adding a new logger | `pino` is already wired with redact paths. | Reuse `config.logger`. |

---

## Stack Patterns by Variant

**If consumer uses single RP ID (the common case):**
- `rp.id: 'myapp.com'` (string) — backwards compatible, no change required.
- No `/.well-known/webauthn` needed.

**If consumer uses multi RP ID (cross-subdomain passkeys):**
- `rp.id: 'app.example.com'` (string — primary, used for credential creation)
- `rp.acceptedIds: ['app.example.com', 'auth.example.com']` (array — used for verification)
- Host `https://app.example.com/.well-known/webauthn` with `{ "origins": [...] }`
- Browser support: Chrome/Edge 128+, Safari 18+. Firefox: positive standards position (March 2026), no shipping date.

**If consumer wants fully-anonymous analytics:**
- `hooks.onAuthEvent` receives `{ type, timestamp }` only. No identifier.

**If consumer wants cross-event correlation without PII:**
- `hooks.onAuthEvent` receives `{ type, timestamp, codenameHash }` (SHA-256 of codename). Hash is stable per-user but reveals nothing PII-adjacent.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@simplewebauthn/server@^13.2.3` | Node ≥ 18 (already required), browser support: Chrome 67+, Safari 14+, Firefox 60+ | Multi-RP_ID **verification** has no browser-version floor (server-only); ROR **hosting/discovery** requires Chrome/Edge 128+ or Safari 18+. |
| `pino@^10.3.1` | Node ≥ 14 | Already redact-configured (Phase 3 + MPC-09). New hook errors should be logged with the same logger to inherit redaction. |
| `zod@^4.3.6` | TypeScript ≥ 4.5 (we're on 5.9.3) | Use for hook return-value validation — consistent with Phase 2 pattern. |
| Node ≥ 18 | `crypto.createHash`, `crypto.randomUUID`, WebCrypto | All needed primitives are native. No polyfill. |

---

## Integration Notes (Knock-On Effects)

- **`tsup` externalisation:** No change. We add no new deps, so the externals list stays as-is.
- **Type exports:** Five new exported types from `/server`: `AnonAuthHooks` (interface), `AuthEvent` (branded type), `BackfillResult`, `SecondFactorResult`, `OnAuthEventHandler`. All additive — does not break the v0.6.1 frozen contract.
- **CJS/ESM dual build:** No change. New types are pure TypeScript; no runtime code requires module-format-specific handling.
- **Test infrastructure:** `vitest@^4.0.18` already installed. New test files extend the existing 280-test suite; no new mock library needed (`vi.fn()` covers hook callback assertions).
- **Frozen `MPCAccountManager` contract:** Untouched. None of these features modify MPC paths.
- **Backwards compatibility:** All hook fields are optional. v0.6.1 consumers upgrade to v0.7.0 with no config changes; new features are opt-in.

---

## Sources

- **Context7:** Not used — `@simplewebauthn/server` API verified directly from upstream source and docs (more authoritative for this specific question).
- **[@simplewebauthn/server official docs](https://simplewebauthn.dev/docs/packages/server)** — confirmed `expectedRPID: string \| string[]` and `expectedOrigin: string \| string[]`. (HIGH)
- **[SimpleWebAuthn CHANGELOG.md (master)](https://github.com/MasterKale/SimpleWebAuthn/blob/master/CHANGELOG.md)** — multi-RPID/multi-origin verification shipped in v1.0.0; latest release is v13.3.0 (2025-03-10). (HIGH)
- **[verifyAuthenticationResponse.ts (master)](https://github.com/MasterKale/SimpleWebAuthn/blob/master/packages/server/src/authentication/verifyAuthenticationResponse.ts)** — current source confirms array-form parameter signature. (HIGH)
- **[GitHub Releases — MasterKale/SimpleWebAuthn](https://github.com/MasterKale/SimpleWebAuthn/releases)** — v13.x release timeline; no API changes between 13.2.3 and 13.3.0. (HIGH)
- **[Related Origin Requests — passkeys.dev](https://passkeys.dev/docs/advanced/related-origins/)** — `.well-known/webauthn` JSON structure, `origins` array contract, eTLD+1 processing rules. (HIGH)
- **[Allow passkey reuse with ROR — web.dev](https://web.dev/articles/webauthn-related-origin-requests)** — Chrome/Edge 128+ shipped support; setup walkthrough. (HIGH)
- **[Chrome 129 ROR announcement — developer.chrome.com](https://developer.chrome.com/blog/passkeys-updates-chrome-129)** — Chrome browser support timeline. (HIGH)
- **[WebAuthn ROR explainer — w3c/webauthn wiki](https://github.com/w3c/webauthn/wiki/Explainer:-Related-origin-requests)** — spec rationale and security model. (HIGH)
- **Project files read:** `package.json` (current pins), `src/server/webauthn.ts` (standalone API), `src/server/passkey.ts` (managed API — `backedUp` already extracted line 197), `src/server/index.ts` (`createAnonAuth` config surface), `.planning/PROJECT.md` (constraints, frozen-contract). (HIGH — direct source reading)

---

*Stack research for: v0.7.0 Consumer Hooks & Recovery Hardening*
*Researched: 2026-04-29*
