# Phase 11: Backup-Eligibility Flags + Hooks Scaffolding - Research

**Researched:** 2026-04-29
**Domain:** WebAuthn BE/BS flag plumbing, additive response shape, optional callback type scaffolding, React state propagation
**Confidence:** HIGH — every load-bearing fact verified by direct codebase inspection or `node_modules/@simplewebauthn/server` source

---

## Summary

Phase 11 is pure additive plumbing on top of v0.6.1. `@simplewebauthn/server@13.2.3` already exposes `credentialBackedUp` and `credentialDeviceType` on BOTH `verifyRegistrationResponse` and `verifyAuthenticationResponse` results — the gap is end-to-end propagation from those library returns to (a) the JSON response body, (b) the `anon_passkeys.backed_up` column, and (c) `useAnonAuth` React state. The `anon_passkeys.backed_up` BOOLEAN column already exists in `POSTGRES_SCHEMA` and is written at registration; it is NOT updated on login today (that's the BACKUP-02 gap).

`AnonAuthConfig.hooks` does not exist anywhere in the codebase (verified by grep — zero matches for `hooks:`, `afterAuthSuccess`, `afterPasskeyVerify`). Phase 11 lands the optional `hooks?: AnonAuthHooks` type on `AnonAuthConfig` and threads it through `createAnonAuth → createRouter / createOAuthRouter` so subsequent phases (F2/F3/F5) can install call sites without a config-shape churn. No call sites are wired in this phase — that is OUT OF SCOPE per ROADMAP and REQUIREMENTS Locked Decisions.

The single-source-of-truth helper `src/server/backup.ts` does not exist — Phase 11 creates it. It is a one-line pure function `deriveBackupEligibility(deviceType) → boolean` consumed by both the router (`/register/finish`, `/login/finish`) and the standalone `verifyRegistration()` so the BE/BS lifecycle invariant is encoded in one place.

**Primary recommendation:** Land BACKUP-05 helper FIRST (`src/server/backup.ts`), then thread `passkey: { backedUp; backupEligible }` through both `passkey.ts` (manager return shape) and `router.ts` (response body) in lockstep. Add the `backed_up` column update path to `passkey.ts:finishAuthentication` (re-read from `verification.authenticationInfo.credentialBackedUp` and call a new optional `db.updatePasskeyBackedUp` adapter method, falling back to a counter-update if absent). Land the `AnonAuthConfig.hooks` type and threading in a separate task — it has zero behavioral impact and can be written and reviewed independently. Drive type contracts with a vitest snapshot test; one tsc-fail fixture verifying `hooks: {}` compiles is sufficient (full PII-whitelist tsc-fail is Phase 13).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Parse BE/BS bits from authenticator data | API / Backend | — | `@simplewebauthn/server` does this internally; library returns parsed flags |
| Derive `backupEligible` from `deviceType === 'multiDevice'` | API / Backend | — | Pure function; encoded in `src/server/backup.ts` (BACKUP-05) |
| Persist `backed_up` to `anon_passkeys` on registration | API / Backend | Database | Already done; existing `createPasskey` adapter call writes it |
| Re-read `backed_up` on every login + persist fresh | API / Backend | Database | NEW: `passkey.ts:finishAuthentication` must call a new adapter method (or extend an existing one) to update `anon_passkeys.backed_up` |
| Surface `passkey: { backedUp; backupEligible }` on `/register/finish` JSON | API / Backend | — | Additive nested key; existing top-level fields preserved verbatim |
| Surface same shape on `/login/finish` JSON | API / Backend | — | Additive; existing top-level fields preserved verbatim |
| Surface flags on standalone `verifyRegistration()` result | API / Backend | — | `result.credential.backedUp` already returned; ADD `backupEligible` |
| Propagate flags into `useAnonAuth` `AnonAuthState` | Browser / Client | — | New `passkeyBackedUp`, `passkeyBackupEligible` state fields populated by `register()` / `login()` |
| Define `AnonAuthHooks` shape and thread through factories | API / Backend | — | Type-only + parameter passing; no call sites wired |
| Validate that absent `hooks` is byte-identical to v0.6.1 | API / Backend | — | Vitest snapshot of response body for both `register()` and `login()` flows with `hooks` omitted |

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BACKUP-01 | `/register/finish` response includes additive `passkey: { backedUp; backupEligible }` nested key | `passkeyData.backedUp` and `passkeyData.deviceType` already extracted in `passkey.ts:finishRegistration` (lines 192-200); router currently ignores them. Plumbing is one-line `passkey: { backedUp: passkeyData.backedUp, backupEligible: deriveBackupEligibility(passkeyData.deviceType) }` in `router.ts` line ~235. |
| BACKUP-02 | `/login/finish` response includes same shape; library re-reads `backedUp` from assertion and persists to `anon_passkeys.backed_up` | `verifyAuthenticationResponse` returns `credentialBackedUp` and `credentialDeviceType` on `authenticationInfo` ([VERIFIED: node_modules/@simplewebauthn/server/esm/authentication/verifyAuthenticationResponse.d.ts]). `passkey.ts:finishAuthentication` does NOT currently surface these — must extend the return shape and add an adapter method to update `anon_passkeys.backed_up`. |
| BACKUP-03 | Standalone `verifyRegistration()` returns `credential.backupEligible`; JSDoc documents BE/BS lifecycle | `verifyRegistration` already returns `credential.backedUp` and `credential.deviceType` (`webauthn.ts` lines 252-262). Add `backupEligible: deriveBackupEligibility(deviceType)` and JSDoc on the result type. |
| BACKUP-04 | React `useAnonAuth` hook surfaces `passkeyBackedUp: boolean \| null` and `passkeyBackupEligible: boolean \| null` on `AnonAuthState` | `AnonAuthState` interface lives in `src/client/hooks/useAnonAuth.tsx` lines 22-49. Add two fields, populate in `register()` and `login()` from API response. |
| BACKUP-05 | Internal `deriveBackupEligibility(passkeyData)` helper in `src/server/backup.ts` is single source of truth | New file. Pure function. Used by `router.ts` (twice — register + login) and `webauthn.ts:verifyRegistration` (once). |
| HOOK-01 | `AnonAuthConfig.hooks?: { afterAuthSuccess?, backfillKeyBundle?, onAuthEvent? }` accepted; threaded through `createAnonAuth → createRouter / createOAuthRouter`; absent → behavior identical to v0.6.1 | `AnonAuthConfig` lives at `src/types/index.ts` lines 37-129. `createAnonAuth` instantiates routers in `src/server/index.ts` lines 188-218. Three call signatures must change to accept (and pass through) an optional `hooks` parameter. **No call sites wired.** |
</phase_requirements>

---

## User Constraints (from CONTEXT.md)

> No CONTEXT.md exists for Phase 11 (no `/gsd-discuss-phase` was run). Constraints below are derived from REQUIREMENTS.md "Locked decisions" and ROADMAP.md Phase 11 success criteria — they bind this phase identically.

### Locked Decisions (from milestone scope)

- **`hooks.afterAuthSuccess`** is the canonical name (renamed from earlier `afterPasskeyVerify` per F2 OAuth integration decision); type lands in Phase 11, call sites in Phase 14.
- **`hooks` is fully optional**. Consumer who omits the field — or who passes `hooks: {}` — sees behavior byte-identical to v0.6.1. No required keys inside the hooks object.
- **Anonymity invariant non-negotiable** — Phase 11 does not introduce any field that could leak `codename`, `userId`, `nearAccountId`, `email`, raw `ip`, or raw `userAgent`. The `passkey: { backedUp; backupEligible }` shape is two booleans only.
- **`MPCAccountManager` contract FROZEN** by consumer pin — no changes to MPC types or factories.
- **Zero new dependencies** — `@simplewebauthn/server@13.2.3` already exposes everything needed.

### Claude's Discretion

- Adapter method shape for the login-time `backed_up` update — `updatePasskeyBackedUp(credentialId, backedUp)` (new optional method) vs. extending `updatePasskeyCounter` to take both fields. Recommendation in Pattern 4 below.
- Whether to add `nearAccountId` to `/login/finish` response body. The current shape is `{ success, codename }` (no `nearAccountId`). The phase goal text says "additive `passkey: { backedUp; backupEligible }` nested key alongside the existing `{ success, codename, nearAccountId }` response" — the existing `/login/finish` shape does NOT have `nearAccountId`. Two readings: (a) the phase goal silently corrects an oversight by adding `nearAccountId`, or (b) the goal is normative for `/register/finish` only and we should match the actual existing `/login/finish` shape. Recommendation: keep `/login/finish` exactly as-is (`{ success, codename, passkey: { backedUp, backupEligible } }`) to minimize blast radius and let the consumer fetch `nearAccountId` via `/session` as `useAnonAuth` already does. Flag this for confirmation in the planning step.
- Whether `useAnonAuth.login()` should also refresh `passkeyBackedUp/passkeyBackupEligible` from the API response or wait for the `/session` round-trip. Recommendation: populate from the `/login/finish` response directly (no extra round-trip).

### Deferred Ideas (OUT OF SCOPE for Phase 11)

- Wiring `hooks.afterAuthSuccess` call sites — that's Phase 14 (HOOK-02..06).
- Wiring `hooks.backfillKeyBundle` call sites — that's Phase 15 (BACKFILL-01..04).
- Wiring `hooks.onAuthEvent` call sites — that's Phase 13 (ANALYTICS-01..06).
- Multi-RP_ID `relatedOrigins` config — Phase 12.
- `awaitAnalytics: boolean` config — Phase 13.
- Surfacing BE/BS on `useAnonAuth.recovery.recoverWithWallet` / `recoverWithPassword` results — out of scope; recovery flows do not produce passkey assertions.
- BE/BS on standalone `verifyAuthentication()` result — REQUIREMENTS BACKUP-03 only mentions `verifyRegistration()`. Out of scope unless a planner wants to add it as a discretionary symmetry move (low risk; mention but do not lock in).
- `nearAccountId` on `/login/finish` response — see Claude's Discretion above; flagged for human confirmation but recommended against.

---

## Standard Stack

### Core (already installed — no new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@simplewebauthn/server` | 13.2.3 | Returns `credentialBackedUp` (BS bit) + `credentialDeviceType` (BE bit derived) on BOTH register and authenticate verification results | Already installed; no upgrade needed. [VERIFIED: node_modules/@simplewebauthn/server/package.json] |
| `zod` | ^4.3.6 | Request body validation. Phase 11 makes no schema changes (request bodies unchanged) | Already used throughout. |
| `vitest` | ^4.0.18 | Test runner; supports `expect.toMatchInlineSnapshot()` for additive contract tests | Already used throughout (15 test files). |
| `pino` | ^10.3.1 | Structured logging | Already wired; no new log lines required for this phase. |
| `react` (peer dep, consumer's) | — | `useAnonAuth` hook lives in client export; React state shape extends additively | Existing client surface. No version change. |

**Version verification:** [VERIFIED] `cat /home/vitalpointai/projects/near-phantom-auth/node_modules/@simplewebauthn/server/package.json` → `"version": "13.2.3"`. [VERIFIED] `package.json` lists `"@simplewebauthn/server": "^13.2.3"` and the project pin matches.

**Installation:** No new packages required.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `updatePasskeyBackedUp(credentialId, backedUp)` adapter method | Extend `updatePasskeyCounter(credentialId, counter, backedUp?)` | New method is cleaner (separation of concerns; counter is replay-protection state, backed_up is BS-bit observation). Extending the existing method risks a breaking change to consumers with custom adapters even if the new arg is optional. **Recommendation: new optional method with a fallback path.** |
| New file `src/server/backup.ts` for `deriveBackupEligibility` | Inline the one-liner in `router.ts` and `webauthn.ts` | BACKUP-05 explicitly requires a single source of truth file. Inline duplication risks drift. **Recommendation: ship the new file.** |
| Type-level snapshot via `__tsc_fail/` fixture | Vitest inline snapshot of response body | The full tsc-fail PII-whitelist fixture pattern is Phase 13's responsibility (ANALYTICS-03). Phase 11's contract is "additive — old fields unchanged"; a vitest snapshot of the JSON response is sufficient. The `mpc-treasury-leak.test.ts` tsc-fail pattern can be reused for one targeted check: "consumer who omits `hooks` from `AnonAuthConfig` compiles". |

---

## Architecture Patterns

### System Architecture Diagram

```
                       ┌───────────────────────────────────────────────────┐
                       │ Browser: useAnonAuth.register() / login()         │
                       │ AnonAuthState.passkeyBackedUp     : boolean|null  │
                       │ AnonAuthState.passkeyBackupEligible : boolean|null│
                       └────────────────────┬──────────────────────────────┘
                                            │ HTTP POST
                                            ▼
              ┌─────────────────────────────────────────────────────────────┐
              │ Express Router (createRouter)                               │
              │   POST /register/finish  →  { ..., passkey: {bU, bE} }      │
              │   POST /login/finish     →  { ..., passkey: {bU, bE} }      │
              └─────────────────────┬───────────────────────────────────────┘
                                    │
                  ┌─────────────────┼─────────────────┐
                  ▼                 ▼                 ▼
   ┌──────────────────────┐  ┌─────────────────┐  ┌─────────────────────┐
   │ PasskeyManager       │  │ deriveBackup    │  │ DatabaseAdapter     │
   │ .finishRegistration  │  │ Eligibility()   │  │ .createPasskey      │
   │ .finishAuthentication│  │ (backup.ts)     │  │ .updatePasskey      │
   │                      │  │                 │  │   BackedUp (NEW)    │
   │ verifyRegistration   │  │ deviceType ──▶  │  └────────┬────────────┘
   │ Response (BE+BS)     │  │  multiDevice    │           │
   │ verifyAuthentication │  │   ? true        │           ▼
   │ Response (BE+BS)     │  │   : false       │  ┌─────────────────────┐
   └──────────┬───────────┘  └─────────────────┘  │ anon_passkeys table │
              │                                   │   backed_up BOOLEAN │
              ▼                                   │   (re-read on login)│
   ┌──────────────────────┐                       └─────────────────────┘
   │ @simplewebauthn/     │
   │ server v13.2.3       │
   │  parseBackupFlags    │
   │  (be → deviceType,   │
   │   bs → backedUp)     │
   └──────────────────────┘

   Hooks scaffolding (orthogonal threading — no call sites wired):

   AnonAuthConfig
     └─ hooks?: AnonAuthHooks { afterAuthSuccess?, backfillKeyBundle?, onAuthEvent? }
            │
            ▼ passed by createAnonAuth(config) to:
     ├── createRouter({ ..., hooks })          (router.ts factory — accepts, ignores)
     └── createOAuthRouter({ ..., hooks })     (oauth/router.ts factory — accepts, ignores)

   Phase 14 will install `if (hooks?.afterAuthSuccess) await hooks.afterAuthSuccess(ctx)` call sites.
```

### Recommended Project Structure

No directory changes. Six existing files modified, one new file, one new test file:

```
src/
├── server/
│   ├── backup.ts            # CREATE — deriveBackupEligibility() helper [BACKUP-05]
│   ├── passkey.ts           # MODIFY — finishAuthentication returns passkeyData re-read; finishRegistration shape unchanged (already returns deviceType + backedUp)
│   ├── router.ts            # MODIFY — /register/finish and /login/finish responses include `passkey: { backedUp, backupEligible }`
│   ├── webauthn.ts          # MODIFY — verifyRegistration result.credential.backupEligible added; JSDoc updated
│   ├── index.ts             # MODIFY — createAnonAuth accepts config.hooks; threads through; re-export AnonAuthHooks type
│   ├── oauth/router.ts      # MODIFY — createOAuthRouter accepts hooks (no call sites wired)
│   └── db/adapters/postgres.ts  # MODIFY — implement new optional `updatePasskeyBackedUp` adapter method
├── client/
│   └── hooks/
│       └── useAnonAuth.tsx  # MODIFY — AnonAuthState gains passkeyBackedUp + passkeyBackupEligible; register()/login() populate them
├── client/
│   └── api.ts               # MODIFY — RegistrationFinishResponse + AuthenticationFinishResponse types include `passkey?: { backedUp; backupEligible }` (read from response)
├── types/
│   └── index.ts             # MODIFY — AnonAuthConfig adds hooks?: AnonAuthHooks; new AnonAuthHooks type; RegistrationFinishResponse + AuthenticationFinishResponse include passkey field; DatabaseAdapter gains optional updatePasskeyBackedUp
└── __tests__/
    ├── backup.test.ts       # CREATE — deriveBackupEligibility unit tests [BACKUP-05]
    ├── registration-auth.test.ts  # MODIFY — assert `passkey: { backedUp, backupEligible }` on both finish responses
    ├── exports.test.ts      # MODIFY — assert AnonAuthHooks type re-exported from /server
    └── hooks-scaffolding.test.ts  # CREATE — type compile fixture: hooks omitted compiles; hooks: {} compiles; backwards-compat snapshot
```

### Pattern 1: `deriveBackupEligibility` helper (BACKUP-05)

**What:** New file `src/server/backup.ts`. Pure function. The single source of truth for the BE-bit → `backupEligible` mapping.

**Why this is critical:** [VERIFIED: node_modules/@simplewebauthn/server/esm/helpers/parseBackupFlags.js]
- The library parses BE bit (`be`) and BS bit (`bs`) from authenticator data:
  - `be === true` → `credentialDeviceType = 'multiDevice'`
  - `be === false` → `credentialDeviceType = 'singleDevice'`
  - `credentialBackedUp = bs` (the raw BS bit)
- Therefore `backupEligible === (deviceType === 'multiDevice')` — encoded once, used three times.

**Implementation:**
```typescript
// src/server/backup.ts
//
// Source: derived from @simplewebauthn/server parseBackupFlags
// (node_modules/@simplewebauthn/server/esm/helpers/parseBackupFlags.js)

/**
 * BE/BS bit lifecycle (WebAuthn Level 2 §6.1.3):
 *
 * BE (Backup Eligibility) — bit 3 of authenticator flags. Set ONCE at credential
 *   creation. Indicates whether the authenticator class supports backup (e.g.,
 *   iCloud Keychain, Google Password Manager). Cannot change for the lifetime of
 *   the credential. Encoded by @simplewebauthn/server as
 *   `credentialDeviceType === 'multiDevice'`.
 *
 * BS (Backup State) — bit 4 of authenticator flags. May FLIP from 0→1 (or, in
 *   theory, 1→0) over the credential's lifetime as the authenticator backs up
 *   or evicts the key. Re-read on every authentication assertion. Encoded by
 *   @simplewebauthn/server as `credentialBackedUp` (boolean).
 *
 * Invariant (enforced by @simplewebauthn/server): BE === false implies BS === false.
 *   A single-device credential cannot be backed up.
 *
 * This helper exists so the `deviceType → backupEligible` translation is encoded
 * in exactly one place. Used by:
 *   - `src/server/router.ts` (POST /register/finish, POST /login/finish responses)
 *   - `src/server/webauthn.ts` (standalone verifyRegistration result)
 */
export function deriveBackupEligibility(
  deviceType: 'singleDevice' | 'multiDevice'
): boolean {
  return deviceType === 'multiDevice';
}
```

**Why a function and not a constant lookup:** The function signature can be widened later (e.g., to accept a struct with `aaguid` or transports) without churning call sites.

[VERIFIED: parseBackupFlags source] — confirms `be → deviceType` mapping; this helper is the inverse direction.

### Pattern 2: Additive response shape (BACKUP-01, BACKUP-02)

**What:** Insert `passkey: { backedUp, backupEligible }` into the response body. No existing fields touched.

**Current (`router.ts:235-239`):**
```typescript
res.json({
  success: true,
  codename: user.codename,
  nearAccountId: user.nearAccountId,
});
```

**Phase 11 change:**
```typescript
import { deriveBackupEligibility } from './backup.js';
// ... after passkeyData destructure:
res.json({
  success: true,
  codename: user.codename,
  nearAccountId: user.nearAccountId,
  passkey: {
    backedUp: passkeyData.backedUp,
    backupEligible: deriveBackupEligibility(passkeyData.deviceType),
  },
});
```

**Login finish (`router.ts:312-315`):**
```typescript
res.json({
  success: true,
  codename: user.codename,
});
```

**Phase 11 change:** First, `passkey.ts:finishAuthentication` must surface `passkeyData` (currently returns `passkey: Passkey` from the DB row, NOT re-read flags). Then:
```typescript
const { verified, userId, passkeyData } = await passkeyManager.finishAuthentication(...);
// ...
res.json({
  success: true,
  codename: user.codename,
  passkey: {
    backedUp: passkeyData.backedUp,
    backupEligible: deriveBackupEligibility(passkeyData.deviceType),
  },
});
```

**Type updates** (`src/types/index.ts`):
```typescript
export interface RegistrationFinishResponse {
  success: boolean;
  codename: string;
  nearAccountId: string;
  passkey?: { backedUp: boolean; backupEligible: boolean };  // additive
}

export interface AuthenticationFinishResponse {
  success: boolean;
  codename: string;
  passkey?: { backedUp: boolean; backupEligible: boolean };  // additive
}
```

**Why optional (`?`):** Defensive — if a future degraded-path response (e.g., a fallback for assertion verification edge cases) does not have the flags, the type still allows it. In the happy path it is always present.

### Pattern 3: PasskeyManager re-reads BE/BS on authentication (BACKUP-02)

**What:** Extend `passkey.ts:finishAuthentication` to surface `credentialBackedUp` and `credentialDeviceType` from the verification result.

**Current return shape (`passkey.ts:84-89`):**
```typescript
finishAuthentication(...): Promise<{
  verified: boolean;
  userId?: string;
  passkey?: Passkey;
}>;
```

**The `Passkey` returned today** is the DB row read BEFORE verification — it carries the `backed_up` value as it was last persisted. That value is stale: BS may have flipped during the assertion. We need the FRESH value from `verification.authenticationInfo`.

**Phase 11 change:** Add `passkeyData` field to the return shape carrying the freshly-read flags:
```typescript
finishAuthentication(...): Promise<{
  verified: boolean;
  userId?: string;
  passkey?: Passkey;
  passkeyData?: {
    backedUp: boolean;
    deviceType: 'singleDevice' | 'multiDevice';
  };
}>;
```

**Implementation (after `verification` is set on success path):**
```typescript
// In passkey.ts:finishAuthentication, after successful verification:
const freshBackedUp = verification.authenticationInfo.credentialBackedUp;
const freshDeviceType = verification.authenticationInfo.credentialDeviceType;

// Update counter (existing)
await db.updatePasskeyCounter(passkey.credentialId, verification.authenticationInfo.newCounter);

// NEW: persist re-read backed_up if it changed (avoids spurious writes)
if (freshBackedUp !== passkey.backedUp && db.updatePasskeyBackedUp) {
  await db.updatePasskeyBackedUp(passkey.credentialId, freshBackedUp);
}

return {
  verified: true,
  userId: passkey.userId,
  passkey,
  passkeyData: { backedUp: freshBackedUp, deviceType: freshDeviceType },
};
```

[VERIFIED: node_modules/@simplewebauthn/server/esm/authentication/verifyAuthenticationResponse.d.ts:60-61] — `credentialDeviceType: CredentialDeviceType; credentialBackedUp: boolean` are present on `authenticationInfo`.

### Pattern 4: New optional adapter method `updatePasskeyBackedUp` (BACKUP-02)

**What:** Add an optional adapter method to `DatabaseAdapter`. Mirrors the existing `updatePasskeyCounter` pattern. Optional with a graceful fallback for consumers with custom adapters that don't implement it.

**`src/types/index.ts` (add to `DatabaseAdapter`):**
```typescript
/** Optional: update the backed_up (BS bit) flag on a passkey record.
 *  If not implemented, the BS bit re-read at login is reflected in the
 *  response body but NOT persisted; the next session start will see the
 *  stale stored value. Implementing this keeps `anon_passkeys.backed_up`
 *  in sync with the credential's actual backup state.
 */
updatePasskeyBackedUp?(credentialId: string, backedUp: boolean): Promise<void>;
```

**`src/server/db/adapters/postgres.ts` (implement):**
```typescript
async updatePasskeyBackedUp(credentialId: string, backedUp: boolean): Promise<void> {
  const p = await getPool();
  await p.query(
    'UPDATE anon_passkeys SET backed_up = $1 WHERE credential_id = $2',
    [backedUp, credentialId]
  );
},
```

**Why optional:** [Pattern from existing codebase — see `DatabaseAdapter.updateSessionExpiry?`, `transaction?`, `deleteUser?`, `cleanExpiredChallenges?`] The library convention is to add new methods as optional with internal fallbacks to preserve adapter-author backwards compatibility. STATE.md "Init" decision explicitly: "Make new DatabaseAdapter methods optional with internal fallbacks to avoid hard breaking changes". The fallback in this case is simply "don't persist" — the response body still carries the fresh flag value to the consumer.

### Pattern 5: Standalone `verifyRegistration` adds `backupEligible` (BACKUP-03)

**What:** `webauthn.ts:verifyRegistration` already returns `credential.backedUp` and `credential.deviceType`. Phase 11 adds `credential.backupEligible` as a derived field.

**Current (`webauthn.ts:252-262`):**
```typescript
return {
  verified: true,
  credential: {
    id: registrationInfo.credential.id,
    publicKey: registrationInfo.credential.publicKey,
    counter: registrationInfo.credential.counter,
    deviceType: registrationInfo.credentialDeviceType,
    backedUp: registrationInfo.credentialBackedUp,
    transports: response.response.transports,
  },
};
```

**Phase 11 change:**
```typescript
import { deriveBackupEligibility } from './backup.js';

return {
  verified: true,
  credential: {
    id: registrationInfo.credential.id,
    publicKey: registrationInfo.credential.publicKey,
    counter: registrationInfo.credential.counter,
    deviceType: registrationInfo.credentialDeviceType,
    backedUp: registrationInfo.credentialBackedUp,
    backupEligible: deriveBackupEligibility(registrationInfo.credentialDeviceType),
    transports: response.response.transports,
  },
};
```

**Type update (`VerifyRegistrationResult.credential`):**
```typescript
credential?: {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  deviceType: 'singleDevice' | 'multiDevice';
  /**
   * BS bit (Backup State) — whether the credential is currently backed up.
   * May change over the credential's lifetime; re-read on every assertion.
   */
  backedUp: boolean;
  /**
   * BE bit (Backup Eligibility) — whether the authenticator class supports
   * backup. Set once at registration; immutable. Derived from `deviceType`.
   */
  backupEligible: boolean;  // NEW
  transports?: AuthenticatorTransport[];
};
```

**JSDoc on `verifyRegistration` itself:** Add a paragraph explaining the BE/BS lifecycle and pointing consumers at `verifyAuthentication` for the per-login BS re-read pattern (note: BACKUP-03 only adds `backupEligible` to `verifyRegistration`; the standalone `verifyAuthentication` shape is unchanged).

### Pattern 6: `AnonAuthHooks` type and threading (HOOK-01)

**What:** Define the optional callbacks object type. Thread it through `createAnonAuth → createRouter / createOAuthRouter`. **No call sites wired.**

**`src/types/index.ts` (add new section):**
```typescript
import type { Request } from 'express';

// ============================================
// Hooks (v0.7.0)
// ============================================

/**
 * Optional consumer-facing hooks for extending auth lifecycle behavior.
 *
 * All callbacks are OPTIONAL. A consumer who passes `hooks: {}` (or omits
 * the field entirely from `AnonAuthConfig`) sees behavior byte-identical
 * to v0.6.1.
 *
 * Phase 11 lands the type contract and threads hooks through the factory
 * functions; call sites are installed in subsequent phases:
 *   - afterAuthSuccess: Phase 14 (HOOK-02..06)
 *   - backfillKeyBundle: Phase 15 (BACKFILL-01..04)
 *   - onAuthEvent: Phase 13 (ANALYTICS-01..06)
 */
export interface AnonAuthHooks {
  /**
   * Phase 14 — fires inside /register/finish, /login/finish, and OAuth callback
   * after passkey verify + DB persist + MPC funding, BEFORE session creation.
   * Phase 11 reserves the field shape; call sites are not wired yet.
   *
   * Type signature is intentionally permissive at this stage; Phase 14 will
   * tighten it (full ctx shape, return contract) per HOOK-02..06.
   */
  afterAuthSuccess?: (ctx: unknown) => Promise<unknown>;

  /**
   * Phase 15 — fires inside /login/finish when sealingKeyHex was supplied
   * in the request body. Pass-through ownership: consumer owns the key-bundle
   * persistence. Phase 11 reserves the field shape; call sites are not wired yet.
   */
  backfillKeyBundle?: (ctx: unknown) => Promise<unknown>;

  /**
   * Phase 13 — fires fire-and-forget at lifecycle boundaries on passkey, OAuth,
   * recovery, and account-deletion endpoints. PII forbidden at the type level
   * (Phase 13 lands the discriminated-union event type). Phase 11 reserves
   * the field shape; call sites are not wired yet.
   */
  onAuthEvent?: (event: unknown) => void | Promise<void>;
}
```

**`AnonAuthConfig` extension:**
```typescript
export interface AnonAuthConfig {
  // ... existing fields unchanged ...

  /** Optional consumer hooks (v0.7.0). All callbacks optional; absent → v0.6.1 behavior.
   *  Phase 11 lands the type; call sites are wired in Phases 13–15. */
  hooks?: AnonAuthHooks;
}
```

**Threading through `createAnonAuth` (`src/server/index.ts`):**
```typescript
// In the createRouter call (lines 207-218):
const router = createRouter({
  db,
  sessionManager,
  passkeyManager,
  mpcManager,
  walletRecovery,
  ipfsRecovery,
  codename: config.codename,
  logger,
  rateLimiting: config.rateLimiting,
  csrf: config.csrf,
  hooks: config.hooks,           // NEW
});

// In the createOAuthRouter call (lines 188-200):
oauthRouter = createOAuthRouter({
  db,
  sessionManager,
  mpcManager,
  oauthConfig: config.oauth,
  ipfsRecovery,
  emailService,
  logger,
  rateLimiting: config.rateLimiting,
  csrf: config.csrf,
  oauthManager,
  hooks: config.hooks,           // NEW
});
```

**`RouterConfig` and `OAuthRouterConfig` extensions:**
```typescript
// router.ts and oauth/router.ts
export interface RouterConfig {
  // ... existing fields unchanged ...
  /** Phase 11 scaffolding — accepted and stored; call sites wired in F2/F3/F5. */
  hooks?: AnonAuthHooks;
}
```

**Re-export from `/server`:**
```typescript
// src/server/index.ts type re-exports block
export type {
  AnonAuthConfig,
  AnonAuthHooks,        // NEW
  // ...
} from '../types/index.js';
```

**Why `unknown` for ctx/event types in Phase 11:** Phase 14/13/15 own the precise shapes. Locking them in here would either (a) duplicate type design across phases or (b) constrain Phase 14 to a shape that may turn out to be wrong. `unknown` is forwards-compatible; Phase 14's tighter type assigns to `unknown` cleanly when refining. The "no call sites wired" guarantee means consumers who set a hook in Phase 11 see no behavior — the hook is silently dropped — which is the documented contract.

[ASSUMED] — `unknown` over `(ctx: { type: string; ... }) => ...` is the right tradeoff for Phase 11. Alternative: define the full ctx shape now and let Phase 14 re-use it. Risk: if Phase 14 finds the shape is wrong, the type churn touches Phase 11's contract. Recommendation: stay permissive; document the deferral.

### Pattern 7: React state propagation (BACKUP-04)

**What:** Add `passkeyBackedUp: boolean | null` and `passkeyBackupEligible: boolean | null` to `AnonAuthState`; populate from `register()` and `login()` API responses.

**`src/client/hooks/useAnonAuth.tsx:22-49` (add fields):**
```typescript
export interface AnonAuthState {
  // ... existing fields unchanged ...

  /** Whether the most recent passkey was backed up (BS bit) — re-read on every login.
   *  null until register() or login() resolves. */
  passkeyBackedUp: boolean | null;

  /** Whether the most recent passkey is backup-eligible (BE bit) — set at registration.
   *  null until register() or login() resolves. */
  passkeyBackupEligible: boolean | null;
}
```

**Initial state (`useState` initialiser, lines 126-140):**
```typescript
const [state, setState] = useState<AnonAuthState>({
  // ... existing fields ...
  passkeyBackedUp: null,
  passkeyBackupEligible: null,
});
```

**Populate in `register()` (lines 230-240):**
```typescript
if (result.success) {
  setState((prev) => ({
    ...prev,
    isLoading: false,
    isAuthenticated: true,
    codename: result.codename,
    username: result.username || username || null,
    nearAccountId: result.nearAccountId,
    authMethod: 'passkey',
    credentialCloudSynced: cloudSynced,
    passkeyBackedUp: result.passkey?.backedUp ?? null,
    passkeyBackupEligible: result.passkey?.backupEligible ?? null,
  }));
}
```

**Populate in `login()` (lines 275-286):**
```typescript
if (result.success) {
  const session = await api.getSession();
  setState((prev) => ({
    ...prev,
    isLoading: false,
    isAuthenticated: true,
    codename: session.codename || result.codename,
    nearAccountId: session.nearAccountId || null,
    expiresAt: session.expiresAt ? new Date(session.expiresAt) : null,
    passkeyBackedUp: result.passkey?.backedUp ?? null,
    passkeyBackupEligible: result.passkey?.backupEligible ?? null,
  }));
}
```

**API client type updates (`src/client/api.ts`):** No new method shapes — just extend the return types of `finishRegistration` and `finishAuthentication` to include `passkey?: { backedUp: boolean; backupEligible: boolean }`. Both already use `RegistrationFinishResponse` / `AuthenticationFinishResponse`, so updating the type definitions in `src/types/index.ts` (Pattern 2) propagates automatically.

### Anti-Patterns to Avoid

- **Don't write `backed_up` on every login** — only when `freshBackedUp !== passkey.backedUp`. Avoids spurious writes for the common case where BS hasn't changed (the existing test suite includes adapters with no transaction support; minimizing writes minimizes flakiness).
- **Don't surface `passkeyData.backedUp` from `finishAuthentication` by reading the stale DB row** — the whole point of BACKUP-02 is the FRESH value from the assertion. Read `verification.authenticationInfo.credentialBackedUp`, not `passkey.backedUp` (which is the pre-verification DB row).
- **Don't make `AnonAuthHooks` callbacks required** — `hooks: {}` MUST type-check. Defaults inside the hooks object MUST stay optional (the `?` modifier).
- **Don't widen `verifyAuthenticationResponse` standalone result shape in Phase 11** — REQUIREMENTS BACKUP-03 only mentions `verifyRegistration`. Touching `verifyAuthentication` standalone is out of scope; doing so risks a v0.6.1 contract diff outside the additive plan.
- **Don't break the existing `/login/finish` shape** — `nearAccountId` is NOT currently on the login finish response (only on register finish). The phase goal text says "alongside the existing `{ success, codename, nearAccountId }` response" but inspecting `router.ts:312-315` shows `/login/finish` returns `{ success, codename }`. Stay with the actual existing shape; do not silently add `nearAccountId` to login finish in this phase.
- **Don't define a tight `ctx` type for `afterAuthSuccess` / `backfillKeyBundle` / `onAuthEvent`** — those types belong to Phases 13/14/15. Use `unknown` and JSDoc the deferral.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BE/BS bit extraction from authenticator data | Custom CBOR + bit-mask parser | `@simplewebauthn/server` `verifyRegistrationResponse` / `verifyAuthenticationResponse` results | Library already parses; both bits exposed on the verification info object |
| `deviceType → backupEligible` mapping in three places | Inline `deviceType === 'multiDevice'` at each call site | `deriveBackupEligibility(deviceType)` from `src/server/backup.ts` | BACKUP-05 explicitly mandates single source of truth; inline duplication risks drift |
| New DB transaction for the BS-bit update | Open a transaction wrapping counter + backed_up update | Two sequential `UPDATE` calls (or one combined statement in the adapter) | The `db.transaction` wrapper is OPTIONAL on `DatabaseAdapter`; existing code already accepts non-atomic counter updates — we don't need to escalate atomicity for this phase |
| `useAnonAuth` re-reading session after register/login to get the flags | Extra `/session` round-trip after register/login | Read `result.passkey` directly from the finish response | Already in the response body; round-trip is wasted latency |

---

## Runtime State Inventory

> Phase 11 is additive code-only. No string is renamed, no schema is migrated, no service is reconfigured. The `anon_passkeys.backed_up` BOOLEAN column is already present in `POSTGRES_SCHEMA` (verified line 75) and is already populated at registration. Phase 11 adds login-time updates to the same column — no DDL change.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `anon_passkeys.backed_up` column already exists; values written by existing register flow remain valid; login-time refresh only updates existing rows | None — no migration |
| Live service config | None — no external service configuration carries Phase 11 strings | None |
| OS-registered state | None — no OS-level registrations affected | None |
| Secrets/env vars | None — Phase 11 introduces no new secrets and renames none | None |
| Build artifacts | tsup ESM/CJS rebuild required (additive types/exports). No stale artifact concern beyond a normal `npm run build` | `npm run build` |

**The canonical question:** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?* — Nothing. Phase 11 introduces new fields/types only; no existing identifier is renamed.

---

## Common Pitfalls

### Pitfall 1: Stale DB row used as "fresh" backed_up source on login

**What goes wrong:** A naive implementation reads the existing `Passkey` row from `db.getPasskeyById(response.id)` (already done at `passkey.ts:263`) and surfaces `passkey.backedUp` to the response body. That value is what was last written — possibly weeks ago. The whole point of BACKUP-02 is "BS bit can flip 0→1; re-read on every login."

**Why it happens:** The existing code already loads the passkey row before verification. It's tempting to reuse `passkey.backedUp`. But that's the pre-flip value.

**How to avoid:** Read from `verification.authenticationInfo.credentialBackedUp` AFTER `verifyAuthenticationResponse` resolves successfully. That's the freshly-parsed BS bit from the assertion's `authData`.

**Warning signs:** A unit test that mocks the assertion with `bs=true` but seeds the DB row with `backed_up=false` — the response body shows `backedUp: false`. Test must show `backedUp: true` (the fresh value).

### Pitfall 2: `deriveBackupEligibility` called with wrong input shape

**What goes wrong:** Caller passes the full `passkeyData` object instead of just `deviceType`, or passes a `Passkey` row (which has `deviceType` but also `backedUp`, `counter`, etc.). Function signature accepts the wrong type, fails at compile time. Fixable, but a signal of inconsistent call sites.

**Why it happens:** REQUIREMENTS-05 says "`deriveBackupEligibility(passkeyData)` helper" — the parameter name suggests passing the whole object.

**How to avoid:** The cleanest signature is `deriveBackupEligibility(deviceType: 'singleDevice' | 'multiDevice'): boolean`. The function does one thing; the call sites already have `deviceType` in scope. If a future caller does need to pass `passkeyData`, overload the function.

### Pitfall 3: `hooks: {}` does NOT compile because callbacks are required

**What goes wrong:** Defining `AnonAuthHooks` with non-optional callback fields (`afterAuthSuccess: (ctx) => Promise<...>`) causes `hooks: {}` to fail tsc. HOOK-01 success criterion: "Consumer who passes `hooks: {}` sees behavior byte-identical to v0.6.1" — this requires `hooks: {}` to TYPE-CHECK.

**Why it happens:** Easy to forget the `?` modifier on each callback.

**How to avoid:** All three callbacks MUST have `?` (`afterAuthSuccess?:`, etc.). Add a tsc-fail fixture (or, less heavyweight, a simple compiling fixture file) that includes `const _: AnonAuthConfig = { ..., hooks: {} };` — if it compiles, the contract holds.

### Pitfall 4: Hook threading drops at the OAuth router boundary

**What goes wrong:** `createAnonAuth` adds `hooks: config.hooks` to the `createRouter` call but forgets the `createOAuthRouter` call (or vice versa). Phase 14 then wires `afterAuthSuccess` at all three sites (passkey register/login + OAuth callback), but discovers OAuth's hook context is `undefined`.

**Why it happens:** Two factory call sites in `src/server/index.ts`; easy to update one.

**How to avoid:** Add a unit test in `exports.test.ts` (or a new `hooks-scaffolding.test.ts`) that constructs `createAnonAuth({ ..., hooks: { afterAuthSuccess: vi.fn() } })` and asserts that BOTH `createRouter` and `createOAuthRouter` mocks were called with the same hook reference. (Use `vi.spyOn` against the router factory imports.)

### Pitfall 5: tsup treeshakes `deriveBackupEligibility` because it's only re-exported from `/server` for tests

**What goes wrong:** New `src/server/backup.ts` is imported only by router/webauthn internally and not re-exported from the public surface. tsup correctly bundles it. However, if a test imports it from `'../server/backup.js'` directly (relative path), the test works against source but fails against the dist if a future contract test runs against the published artifact.

**Why it happens:** Phase 10 had a similar issue — `dist/` exports must include all public types but not necessarily internal helpers.

**How to avoid:** `deriveBackupEligibility` is INTERNAL — it does not need to be on the public export surface. Tests import from `'../server/backup.js'` (relative); that's fine. Confirm by running `npm run build` and inspecting `dist/server/index.js` — the helper should be inlined or bundled, but NOT exposed as a top-level export.

### Pitfall 6: `useAnonAuth` snapshot test breaks unrelated consumers

**What goes wrong:** Adding two new fields to `AnonAuthState` (`passkeyBackedUp`, `passkeyBackupEligible`) changes the shape of `AnonAuthContextValue`. A consumer with a strict TypeScript config and an exhaustive destructure (`const { isLoading, isAuthenticated, codename, ..., oauthProviders } = useAnonAuth();` written before) does not break — these are NEW required fields on the value, but TypeScript additive contract holds for destructure-some.

**Why it might still happen:** A consumer with `exhaustiveDestructure` lint rules might surface a warning. The bigger risk: tests that snapshot `AnonAuthContextValue` keys break (new keys present). 

**How to avoid:** Document the additive surface in CHANGELOG (Phase 16). For Phase 11, ensure the project's own tests don't snapshot the full state object — any existing `useAnonAuth` test should assert specific fields, not deep-equal the whole shape.

### Pitfall 7: `backupEligible` documented as derivable from `backedUp` (it is NOT)

**What goes wrong:** A reader assumes `backupEligible === !!backedUp` or `backupEligible === backedUp`. That's wrong: a multi-device-eligible credential can be NOT backed up yet (`backupEligible: true, backedUp: false`). They are independent bits.

**Why it happens:** The naming is similar; intuition fails.

**How to avoid:** JSDoc on every public surface (server `verifyRegistration`, types, `useAnonAuth` AnonAuthState fields) MUST explicitly distinguish:
- BE (backupEligible) — capability flag, set at registration, immutable
- BS (backedUp) — current state, may flip on each authentication
- Invariant: `BE === false → BS === false` (single-device cannot be backed up)

The JSDoc on `src/server/backup.ts` Pattern 1 above already encodes this; copy that text verbatim into the public surface JSDoc.

---

## Code Examples

### Example 1: Full `backup.ts` file (BACKUP-05)

```typescript
// src/server/backup.ts
//
// Single source of truth for the BE-bit lifecycle mapping.
// Source: derived from @simplewebauthn/server parseBackupFlags
// (node_modules/@simplewebauthn/server/esm/helpers/parseBackupFlags.js)

/**
 * BE/BS bit lifecycle (WebAuthn Level 2 §6.1.3):
 *
 * BE (Backup Eligibility) — bit 3 of authenticator flags. Set ONCE at credential
 *   creation. Indicates whether the authenticator class supports backup (e.g.,
 *   iCloud Keychain, Google Password Manager). Cannot change for the lifetime
 *   of the credential. Encoded by @simplewebauthn/server as
 *   `credentialDeviceType === 'multiDevice'`.
 *
 * BS (Backup State) — bit 4 of authenticator flags. May FLIP from 0→1 (or, in
 *   theory, 1→0) over the credential's lifetime as the authenticator backs up
 *   or evicts the key. Re-read on every authentication assertion. Encoded by
 *   @simplewebauthn/server as `credentialBackedUp` (boolean).
 *
 * Invariant (enforced by @simplewebauthn/server): BE === false implies BS === false.
 *   A single-device credential cannot be backed up.
 */
export function deriveBackupEligibility(
  deviceType: 'singleDevice' | 'multiDevice'
): boolean {
  return deviceType === 'multiDevice';
}
```

### Example 2: Vitest snapshot for BACKUP-01 contract

```typescript
// src/__tests__/registration-auth.test.ts (additive)
//
// Assert that POST /register/finish response includes the additive `passkey`
// nested key with both backedUp and backupEligible booleans.

it('BACKUP-01: /register/finish response includes passkey: { backedUp, backupEligible }', async () => {
  // mockPasskeyManager.finishRegistration returns deviceType: 'multiDevice', backedUp: true
  mockPasskeyManager.finishRegistration.mockResolvedValueOnce({
    verified: true,
    passkeyData: {
      credentialId: 'cred-1',
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: 'multiDevice',
      backedUp: true,
    },
    tempUserId: 'temp-user-1',
  });

  const app = createTestApp();
  const res = await request(app)
    .post('/register/finish')
    .send({
      challengeId: 'chal-reg-1',
      response: validRegistrationResponse,
      tempUserId: 'temp-user-1',
      codename: 'ALPHA-BRAVO-7',
    });

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    success: true,
    codename: 'ALPHA-BRAVO-7',
    nearAccountId: 'abc123def456',
    passkey: {
      backedUp: true,
      backupEligible: true,
    },
  });
});

it('BACKUP-01: response with single-device passkey reports backupEligible:false', async () => {
  mockPasskeyManager.finishRegistration.mockResolvedValueOnce({
    verified: true,
    passkeyData: {
      credentialId: 'cred-1',
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
    },
    tempUserId: 'temp-user-1',
  });

  const app = createTestApp();
  const res = await request(app)
    .post('/register/finish')
    .send({ /* same body as above */ });

  expect(res.body.passkey).toEqual({ backedUp: false, backupEligible: false });
});
```

### Example 3: BS-bit-flip-on-login test (BACKUP-02)

```typescript
// src/__tests__/registration-auth.test.ts (additive)

it('BACKUP-02: /login/finish surfaces FRESH backedUp from assertion (not stored)', async () => {
  // Stored row: backed_up = false (older registration)
  mockDb.getPasskeyById = vi.fn().mockResolvedValue({
    credentialId: 'cred-1',
    userId: 'user-1',
    publicKey: new Uint8Array(32),
    counter: 0,
    deviceType: 'multiDevice',
    backedUp: false,   // STALE
  });
  // Fresh assertion reports BS=1 (just got backed up)
  mockPasskeyManager.finishAuthentication.mockResolvedValueOnce({
    verified: true,
    userId: 'user-1',
    passkey: { /* stale row */ backedUp: false, deviceType: 'multiDevice' },
    passkeyData: { backedUp: true, deviceType: 'multiDevice' },  // FRESH
  });

  const app = createTestApp();
  const res = await request(app)
    .post('/login/finish')
    .send({ challengeId: 'chal-auth-1', response: validAuthenticationResponse });

  expect(res.body.passkey).toEqual({ backedUp: true, backupEligible: true });
});

it('BACKUP-02: persists fresh backed_up to anon_passkeys when value changes', async () => {
  const updateBackedUp = vi.fn().mockResolvedValue(undefined);
  mockDb.updatePasskeyBackedUp = updateBackedUp;
  mockDb.getPasskeyById = vi.fn().mockResolvedValue({
    credentialId: 'cred-1', userId: 'user-1', deviceType: 'multiDevice', backedUp: false,
    publicKey: new Uint8Array(32), counter: 0,
  });
  // ... fresh assertion: backedUp: true

  await request(createTestApp())
    .post('/login/finish')
    .send({ /* ... */ });

  expect(updateBackedUp).toHaveBeenCalledWith('cred-1', true);
});
```

### Example 4: Hook scaffolding compile fixture (HOOK-01)

```typescript
// src/__tests__/hooks-scaffolding.test.ts

import { describe, it, expect } from 'vitest';
import type { AnonAuthConfig, AnonAuthHooks } from '../server/index.js';
// (assumes AnonAuthHooks is re-exported; if not, import from '../types/index.js')

describe('HOOK-01: AnonAuthConfig.hooks is fully optional', () => {
  it('compiles with hooks omitted', () => {
    const _cfg: AnonAuthConfig = {
      nearNetwork: 'testnet',
      sessionSecret: 'secret',
      database: { type: 'postgres', connectionString: 'postgres://localhost/test' },
    };
    expect(_cfg).toBeDefined();
  });

  it('compiles with hooks: {}', () => {
    const _cfg: AnonAuthConfig = {
      nearNetwork: 'testnet',
      sessionSecret: 'secret',
      database: { type: 'postgres', connectionString: 'postgres://localhost/test' },
      hooks: {},
    };
    expect(_cfg.hooks).toEqual({});
  });

  it('compiles with all three hooks supplied', () => {
    const hooks: AnonAuthHooks = {
      afterAuthSuccess: async () => undefined,
      backfillKeyBundle: async () => ({ backfilled: false, reason: 'skipped' }),
      onAuthEvent: () => {},
    };
    const _cfg: AnonAuthConfig = {
      nearNetwork: 'testnet',
      sessionSecret: 'secret',
      database: { type: 'postgres', connectionString: 'postgres://localhost/test' },
      hooks,
    };
    expect(_cfg.hooks).toBe(hooks);
  });
});

describe('HOOK-01: hooks threaded through createAnonAuth (no call sites wired)', () => {
  it('createAnonAuth accepts hooks without throwing', async () => {
    // Assemble minimal config; createRouter and createOAuthRouter receive hooks
    // and ignore them in Phase 11. Verify by running through register flow with
    // a hook supplied — the hook MUST NOT be invoked.
    const afterAuthSuccess = vi.fn();
    const auth = createAnonAuth({
      nearNetwork: 'testnet',
      sessionSecret: 'test-secret-32-chars-long-enough-12345',
      database: { type: 'custom', adapter: makeMockDb() },
      rp: { name: 'Test', id: 'localhost', origin: 'http://localhost:3000' },
      hooks: { afterAuthSuccess },
    });
    expect(auth).toBeDefined();
    // Phase 11: no call site wired — the hook is silently dropped.
    // Phase 14 will add the call-site assertion.
    expect(afterAuthSuccess).not.toHaveBeenCalled();
  });
});
```

### Example 5: Backwards-compat snapshot

```typescript
// src/__tests__/registration-auth.test.ts (additive)
//
// Assert that the v0.6.1 response shape is preserved when no consumer
// reads the new `passkey` field.

it('Backwards-compat: existing v0.6.1 fields on /register/finish unchanged', async () => {
  const app = createTestApp();
  const res = await request(app)
    .post('/register/finish')
    .send({ /* valid body */ });

  expect(res.body).toEqual(
    expect.objectContaining({
      success: true,
      codename: expect.any(String),
      nearAccountId: expect.any(String),
    })
  );
  // Old consumers that did not read .passkey continue to work.
  // Strict equality on the EXTRA field is in BACKUP-01 test above.
});
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | `vitest.config.ts` (globals: true, environment: node) |
| Quick run command | `nvm use 20 && npm test -- --run` |
| Full suite command | `nvm use 20 && npm test -- --run` |
| Baseline | 252+ tests passing (Phase 10 added several to mpc-account-manager.test.ts and mpc-treasury-leak.test.ts; verify exact count via `npm test -- --run` before starting Phase 11) |
| Estimated runtime | ~30 seconds |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BACKUP-01 | `/register/finish` JSON body includes `passkey: { backedUp, backupEligible }`; old fields preserved | unit (supertest + mock) | `npm test -- --run src/__tests__/registration-auth.test.ts` | ✅ existing — extend |
| BACKUP-02 (response) | `/login/finish` JSON body includes `passkey: { backedUp, backupEligible }` with FRESH backedUp from assertion | unit (supertest + mock) | `npm test -- --run src/__tests__/registration-auth.test.ts` | ✅ existing — extend |
| BACKUP-02 (DB persist) | When fresh `backedUp` differs from stored, `db.updatePasskeyBackedUp(credentialId, fresh)` is called | unit (mock spy) | `npm test -- --run src/__tests__/registration-auth.test.ts` | ✅ existing — extend |
| BACKUP-02 (no-op when unchanged) | When fresh equals stored, `updatePasskeyBackedUp` is NOT called | unit (mock spy) | `npm test -- --run src/__tests__/registration-auth.test.ts` | ✅ existing — extend |
| BACKUP-03 | Standalone `verifyRegistration` returns `credential.backupEligible: boolean`; equals `(deviceType === 'multiDevice')` | unit | `npm test -- --run src/__tests__/passkey.test.ts` | ✅ existing — extend (or create new file `webauthn.test.ts` if no analog) |
| BACKUP-04 (state shape) | `AnonAuthState` exposes `passkeyBackedUp` and `passkeyBackupEligible` as `boolean \| null` | type-only / vitest type-check | `npm run typecheck` | ✅ tsc as part of build |
| BACKUP-04 (populate) | `register()` and `login()` populate the two state fields from the API response | unit (React Testing Library or jsdom) | `npm test -- --run src/__tests__/use-anon-auth.test.ts` (if exists) or skip — most logic is type-driven | ❌ Wave 0 |
| BACKUP-05 | `deriveBackupEligibility(deviceType)` returns the correct boolean for both inputs | unit | `npm test -- --run src/__tests__/backup.test.ts` | ❌ Wave 0 |
| HOOK-01 (type) | `AnonAuthConfig.hooks` is optional; `hooks: {}` compiles; all three callbacks individually optional | unit (compile + assert) | `npm test -- --run src/__tests__/hooks-scaffolding.test.ts` | ❌ Wave 0 |
| HOOK-01 (re-export) | `AnonAuthHooks` type is re-exported from `'@vitalpoint/near-phantom-auth/server'` | unit | `npm test -- --run src/__tests__/exports.test.ts` | ✅ existing — extend |
| HOOK-01 (threading) | `createAnonAuth({ hooks })` instantiates without throwing AND hooks are passed to both router factories | unit (spy) | `npm test -- --run src/__tests__/hooks-scaffolding.test.ts` | ❌ Wave 0 |
| HOOK-01 (no-op behavior) | Supplying `hooks.afterAuthSuccess` does NOT cause the hook to be invoked in Phase 11 | unit (mock not called) | `npm test -- --run src/__tests__/hooks-scaffolding.test.ts` | ❌ Wave 0 |
| Backwards-compat | `/register/finish` and `/login/finish` response include all v0.6.1 top-level fields unchanged | unit (objectContaining) | `npm test -- --run src/__tests__/registration-auth.test.ts` | ✅ existing — extend |
| Type-only `nearAccountId` not breaking | TS consumers with strict types compile against extended `RegistrationFinishResponse` | typecheck | `npm run typecheck` | ✅ |

### Sampling Rate

- **Per task commit:** `nvm use 20 && npm test -- --run` (full suite, ~30s)
- **Per wave merge:** `nvm use 20 && npm run build && npm run typecheck && npm test -- --run`
- **Phase gate:** Full suite green + `npm run build` succeeds + `npm run typecheck` succeeds before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/__tests__/backup.test.ts` — covers BACKUP-05 (deriveBackupEligibility unit tests)
- [ ] `src/__tests__/hooks-scaffolding.test.ts` — covers HOOK-01 (compile fixtures + threading spy)
- [ ] `src/server/backup.ts` — file does not exist; create as part of BACKUP-05 task (this is implementation, not test infra, but it's a Wave-0-style "must exist before downstream tasks" file)
- [ ] (Optional) `src/__tests__/use-anon-auth.test.ts` — only needed if BACKUP-04 wants behavioral test of state propagation; type-only assertion via tsc may suffice. Recommend SKIP for Phase 11; type contract is the binding promise.

*(Existing test infrastructure — vitest config, supertest pattern, mock factories — covers all other Phase 11 verifications without changes.)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (peripheral) | Phase 11 surfaces but does not change WebAuthn auth control flow; library `@simplewebauthn/server` performs all crypto verification |
| V3 Session Management | no — session creation logic untouched | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes (no new input) | Existing zod schemas (`registerFinishBodySchema`, `loginFinishBodySchema`) unchanged; `passkey: { backedUp; backupEligible }` is OUTPUT only |
| V6 Cryptography | no — no new crypto | — |
| V8 Data Protection | yes | The `backed_up` boolean is non-sensitive metadata about a credential; documenting it in JSDoc as observable on every response is acceptable. NOT PII per anonymity invariant; does not identify the user |
| V11 Business Logic | yes | BS-bit lifecycle: ensure the re-read on login matches the assertion's authData, not the stored row (Pitfall 1) |

### Known Threat Patterns for {WebAuthn flag plumbing + optional hook config}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stale `backed_up` cached in DB while assertion shows fresh value (false negative on backup status) | Tampering / Information Disclosure (consumer makes wrong UX decision based on stale flag) | BACKUP-02: re-read on every login; persist when changed |
| Hook injection — consumer's untrusted hook code runs in-process | Tampering / DoS | HOOK-01: types only; no call sites in Phase 11; Phase 13/14/15 own the wrapAnalytics / try-catch envelopes |
| Anonymity invariant breach — additive field carries identifying data | Information Disclosure | `passkey: { backedUp, backupEligible }` is two booleans — provably non-identifying. Documented in JSDoc and verified by snapshot test. |
| BE/BS confusion — consumer treats backupEligible as backedUp | Misconfiguration | JSDoc on every public surface explicitly distinguishes BE (capability) vs BS (state) |
| Hook callback throws and crashes register flow (Phase 11 has no call sites — non-issue here, but pattern noted for Phase 14) | DoS | Phase 14 owns try-catch + DB rollback contract; Phase 11 does not invoke hooks |

---

## Project Constraints (from STATE.md / REQUIREMENTS.md)

These directives carry the same authority as locked decisions:

- **System Node is v12; must use `nvm use 20` for GSD tools and any vitest run** (from MEMORY.md feedback)
- **`MPCAccountManager` contract FROZEN** — no field/method/return-shape renames in v0.7.0; Phase 11 does not touch `mpc.ts`
- **`MPCAccountManagerConfig.derivationSalt` is REQUIRED at the type level** — Phase 11 inherits this; the tsc-fail fixture pattern (`__tsc_fail/` style at `mpc-treasury-leak.test.ts:212-241`) is the project's established way to enforce required type fields. Phase 11 can reuse it for the (lighter-weight) `hooks: {}` compile assertion if a tsc-level guarantee is desired beyond the vitest type-check
- **New `DatabaseAdapter` methods MUST be optional** with internal fallbacks to avoid breaking custom-adapter consumers
- **zod for runtime validation** — Phase 11 makes no schema changes (request bodies unchanged), so no new schemas
- **pino externalized in tsup.config.ts** — consumers provide their own pino instance; Phase 11 adds no new log lines
- **Anonymity invariant non-negotiable** — no PII in any new field
- **Zero new dependencies**
- **Additive-only contract** — every existing v0.6.1 export, response shape, and behavior preserved

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-platform "is this a passkey?" probes | Standardized BE/BS bits in WebAuthn Level 2 | 2022 (W3C WebAuthn L2 spec) | `@simplewebauthn/server` parses and exposes both bits; consumers no longer hand-roll authData parsing |
| `credentialBackedUp` only on register | `credentialBackedUp` on BOTH register AND authenticate | `@simplewebauthn/server` v8+ (current 13.2.3) | BACKUP-02 re-read pattern is supported library-side; no upgrade needed |
| Optional callback fields with non-optional types (caller required to pass `() => undefined`) | Optional `?` modifier | TS 2.x+ idiom | HOOK-01 contract: callbacks individually optional so `hooks: {}` compiles |

**Deprecated/outdated:** None applicable. All approaches recommended in this research are current as of 2026-04-29 against `@simplewebauthn/server@13.2.3`, TypeScript 5.9.x, vitest 4.x, and React 18+/19.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `unknown` type parameters on `AnonAuthHooks` callbacks (rather than precise per-phase ctx types) is the right tradeoff for Phase 11 — Phase 14/13/15 will refine each per their own requirements | Pattern 6 | If Phase 14 wants the ctx shape locked in Phase 11, we'd need to define `HookCtx` types now and accept some re-work risk. Mitigation: Phase 14 research can lock these in if it wants to. |
| A2 | The phase goal text "alongside the existing `{ success, codename, nearAccountId }` response" describes the AGGREGATE register/login surface, and the actual existing `/login/finish` response (which is `{ success, codename }` only — no `nearAccountId`) is the binding shape. Phase 11 should NOT silently add `nearAccountId` to login finish | Claude's Discretion | If the goal text is normative and `nearAccountId` was meant to land in Phase 11, the planner should add it explicitly with an extra task and a JSDoc note in CHANGELOG |
| A3 | A new optional `db.updatePasskeyBackedUp(credentialId, backedUp)` method is preferable to extending `db.updatePasskeyCounter` (which is non-optional and changing its signature is breaking for custom-adapter consumers) | Pattern 4 | If consumers would prefer a single combined update method, the planner can add `updatePasskey(credentialId, { counter?, backedUp? })` instead — a separate optional method preserves the old signature |
| A4 | Standalone `verifyAuthentication()` does NOT need `backedUp` / `backupEligible` added to its result in Phase 11 (BACKUP-03 only mentions `verifyRegistration`); a future symmetry move can land in v0.8 | Anti-Patterns | If a consumer using the standalone webauthn entry needs the BS bit, they can use `@simplewebauthn/server` directly. Risk is low. |
| A5 | `hooks-scaffolding.test.ts` (vitest compile fixtures) is sufficient evidence for HOOK-01; the heavier `__tsc_fail/` fixture pattern is reserved for required-field enforcement (which HOOK-01 does NOT have — every callback is optional) | Validation Architecture | If the planner wants belt-and-suspenders, add a tsc-fail fixture asserting that "supplying a non-callable value to `hooks.afterAuthSuccess` fails tsc"; not strictly required by HOOK-01 |
| A6 | `useAnonAuth` test for BACKUP-04 state propagation is NOT a Wave-0 dependency — the contract is type-level (added fields), and the populate logic is straightforward enough that a reviewer can verify by inspection. Adding a React Testing Library test would force a new test infra dependency | Wave 0 Gaps | If reviewers prefer behavioral tests, add `src/__tests__/use-anon-auth.test.ts` with jsdom + RTL. Cost: new dev dependency (RTL); risk if skipped: regression in state propagation goes undetected at compile time |

---

## Open Questions

1. **Should `/login/finish` response add `nearAccountId` in Phase 11?**
   - What we know: ROADMAP phase goal text mentions "alongside the existing `{ success, codename, nearAccountId }` response" but the actual current `/login/finish` returns `{ success, codename }` (verified at `router.ts:312-315`).
   - What's unclear: Whether the goal text is descriptive (matches register only) or prescriptive (login should also gain `nearAccountId`).
   - Recommendation: Treat the existing `/login/finish` shape as binding (do not add `nearAccountId` in Phase 11); flag for human confirmation in `/gsd-discuss-phase` if run, or accept the conservative reading. `useAnonAuth.login()` already fetches `/session` after login to get `nearAccountId`, so consumers already have a path.

2. **Should `hooks-scaffolding.test.ts` use a tsc-fail fixture for "hooks: {} compiles"?**
   - What we know: The MPC-07 pattern at `mpc-treasury-leak.test.ts:211-241` writes a temp `.ts` file, runs `npx tsc --noEmit`, expects failure with a specific error string.
   - What's unclear: Whether HOOK-01's "compiles when omitted" needs a fixture that confirms it, or if a positive vitest type-check (the file itself compiles, asserts at runtime) is enough.
   - Recommendation: Positive vitest fixture is sufficient. The negative case (callback-required would fail) doesn't apply — there's no required-field semantics in `AnonAuthHooks`.

3. **Should the plan-checker enforce the "no call sites wired" invariant via grep?**
   - What we know: HOOK-01 phase scope locks in zero call sites for `afterAuthSuccess`, `backfillKeyBundle`, `onAuthEvent`.
   - What's unclear: Whether to add a regression guard. A grep-based test (`grep -r "hooks.afterAuthSuccess(" src/server` should return zero matches) would catch a Phase 14 leak-through into Phase 11 work-in-progress.
   - Recommendation: Add a one-line grep assertion in `hooks-scaffolding.test.ts`: `expect(callSitesGrepCount).toBe(0)`. Cheap insurance.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js v20 | vitest, tsup, typecheck | via nvm | 20.20.1 | `nvm use 20` (per MEMORY.md feedback) |
| `@simplewebauthn/server` | BE/BS bit parsing | YES | 13.2.3 | — (no upgrade required) |
| zod | Existing schemas | YES | ^4.3.6 | — |
| vitest | Test runner | YES | ^4.0.18 | — |
| tsup | Build (ESM + CJS + d.ts) | YES | (existing) | — |
| TypeScript | Type-checking, tsc-fail fixture | YES | ^5.9.3 | — |
| supertest | Router integration tests | YES | (already used in registration-auth.test.ts) | — |
| React (peer dep) | `useAnonAuth` host project | n/a (consumer-provided) | — | — |
| Postgres (live) | Adapter integration tests | OPTIONAL | — | All Phase 11 tests use mocked `DatabaseAdapter`; no live Postgres required |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None — every Phase 11 task can be implemented and verified in CI without external services.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — [VERIFIED: Read tool]
  - `src/server/passkey.ts` — `finishRegistration` extracts `deviceType` and `backedUp` (lines 192-200); `finishAuthentication` does NOT (returns DB row only)
  - `src/server/router.ts` — `/register/finish` response shape (lines 235-239), `/login/finish` response shape (lines 312-315)
  - `src/server/oauth/router.ts` — OAuth callback response shapes (lines 231-243, 265-278, 349-360)
  - `src/server/webauthn.ts` — standalone `verifyRegistration` returns `credential.deviceType` and `credential.backedUp` (lines 252-262)
  - `src/server/index.ts` — `createAnonAuth` instantiates `createRouter` and `createOAuthRouter` (lines 188-218); type re-exports (lines 245-287)
  - `src/server/db/adapters/postgres.ts` — `anon_passkeys.backed_up BOOLEAN` column at line 75; `updatePasskeyCounter` at lines 640-646; `createPasskey` writes `backedUp` at lines 580-595
  - `src/types/index.ts` — `AnonAuthConfig` (37-129); `DatabaseAdapter` (201-265); `Passkey` and `CreatePasskeyInput` (379-400); `RegistrationFinishResponse` (438-442); `AuthenticationFinishResponse` (449-452)
  - `src/client/hooks/useAnonAuth.tsx` — `AnonAuthState` interface (22-49); `register()` (198-251); `login()` (253-297)
  - `src/client/api.ts` — return types `RegistrationFinishResponse`, `AuthenticationFinishResponse` (37-58)
- `node_modules/@simplewebauthn/server@13.2.3` — [VERIFIED: Read tool]
  - `esm/registration/verifyRegistrationResponse.d.ts` lines 60-77 — `registrationInfo.credentialDeviceType: CredentialDeviceType; credentialBackedUp: boolean`
  - `esm/authentication/verifyAuthenticationResponse.d.ts` lines 55-67 — `authenticationInfo.credentialDeviceType: CredentialDeviceType; credentialBackedUp: boolean`
  - `esm/helpers/parseBackupFlags.js` — confirms `be → deviceType`, `bs → backedUp`, single-device-implies-not-backed-up invariant
- `package.json` — `@simplewebauthn/server: ^13.2.3`; `zod: ^4.3.6`; `vitest: ^4.0.18`; `pino: ^10.3.1`; `typescript: ^5.9.3` — [VERIFIED: Read tool]
- `.planning/phases/10-mpcaccountmanager/10-RESEARCH.md` — style and project conventions reference — [VERIFIED: Read tool]
- `.planning/phases/10-mpcaccountmanager/10-VALIDATION.md` — Nyquist validation pattern reference — [VERIFIED: Read tool]
- `.planning/STATE.md` — locked decisions for v0.7.0 (carried into Phase 11) — [VERIFIED: Read tool]
- `.planning/ROADMAP.md` — Phase 11 goal and success criteria — [VERIFIED: Read tool]
- `.planning/REQUIREMENTS.md` — BACKUP-01..05, HOOK-01, locked decisions, out-of-scope list — [VERIFIED: Read tool]
- `src/__tests__/registration-auth.test.ts` — supertest + mock pattern verified for additive snapshot tests — [VERIFIED: Read tool]
- `src/__tests__/exports.test.ts` — runtime export assertion pattern (`typeof X === 'function'`) — [VERIFIED: Read tool]
- `src/__tests__/mpc-treasury-leak.test.ts` lines 197-242 — tsc-fail fixture pattern (writes temp file, runs `npx tsc --noEmit`, asserts failure) — [VERIFIED: Read tool]

### Secondary (MEDIUM confidence)
- WebAuthn Level 2 §6.1.3 — BE/BS bit semantics — [CITED: industry knowledge consistent with `parseBackupFlags` source above]
- React `useState` additive shape extension is non-breaking for destructure-some consumers — [CITED: TypeScript structural typing rules]

### Tertiary (LOW confidence)
- None — Phase 11 has no LOW-confidence claims; everything load-bearing is verified by direct codebase inspection or library source.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package version verified in `package.json` and `node_modules`; zero new dependencies needed
- Architecture: HIGH — all factory call sites, response shapes, and DB columns verified by direct file inspection
- Pitfalls: HIGH — Pitfalls 1, 3, 4, 7 anchored in code evidence; Pitfall 2 is a design choice; Pitfall 5 mirrors Phase 10 lessons; Pitfall 6 follows TypeScript structural typing
- BE/BS lifecycle: HIGH — `@simplewebauthn/server@13.2.3` source directly verified for both register and authenticate flows; `parseBackupFlags.js` source verified for the BE→deviceType, BS→backedUp mapping and the single-device-implies-not-backed-up invariant
- Hook scaffolding type design: MEDIUM — type signatures are research-driven recommendations; final shapes converge with Phase 13/14/15 research and may tighten

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 (stable additive plumbing; `@simplewebauthn/server` major version bump would require re-check, but 13.x is current)
