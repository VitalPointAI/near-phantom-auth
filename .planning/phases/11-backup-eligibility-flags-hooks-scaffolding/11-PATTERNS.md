# Phase 11: Backup-Eligibility Flags + Hooks Scaffolding — Pattern Map

**Mapped:** 2026-04-29
**Files analyzed:** 11 (2 new + 9 modified)
**Analogs found:** 11 / 11 (all in-repo, all VERIFIED by direct Read against source line numbers cited in 11-RESEARCH.md)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/server/backup.ts` (CREATE) | utility (pure helper) | transform | `src/server/codename.ts` (`isValidCodename`) | role-match (pure server-side validator/derivation) |
| `src/__tests__/backup.test.ts` (CREATE) | test (unit) | request-response (none — pure func) | `src/__tests__/codename.test.ts` | exact (pure-func unit test scaffold) |
| `src/__tests__/hooks-scaffolding.test.ts` (CREATE) | test (type + threading) | request-response | `src/__tests__/exports.test.ts` (re-export shape) + `src/__tests__/mpc-treasury-leak.test.ts` lines 197-242 (tsc-fail fixture) | role-match (compile-fixture + spy-on-factory) |
| `src/server/passkey.ts` (MODIFY) | service (manager factory) | request-response | self — extend existing `finishAuthentication` shape; mirror `finishRegistration` shape (lines 190-201) | self-match |
| `src/server/webauthn.ts` (MODIFY) | utility (standalone framework-agnostic) | request-response | self — extend `verifyRegistration` result.credential (lines 252-262) | self-match |
| `src/server/router.ts` (MODIFY) | controller (Express router) | request-response | self — `/register/finish` (lines 235-239) and `/login/finish` (lines 312-315) | self-match |
| `src/server/index.ts` (MODIFY) | factory + entry point | request-response | self — existing `createRouter`/`createOAuthRouter` factory calls (lines 188-218); existing type re-exports (lines 245-287) | self-match |
| `src/server/oauth/router.ts` (MODIFY) | controller (Express router) | request-response | `src/server/router.ts` (`RouterConfig` interface, lines 36-50) | exact (sister factory) |
| `src/server/db/adapters/postgres.ts` (MODIFY) | service (DB adapter) | CRUD (UPDATE) | self — existing `updatePasskeyCounter` (lines 640-646) | self-match (sister-method on same table) |
| `src/types/index.ts` (MODIFY) | model (type definitions) | n/a (types only) | self — existing optional adapter methods (lines 243-264); existing response types (lines 438-452) | self-match |
| `src/client/hooks/useAnonAuth.tsx` (MODIFY) | component (React hook + context) | event-driven (state setter) | self — existing `register()` (lines 198-251), `login()` (lines 253-297), `AnonAuthState` (lines 22-49) | self-match |

---

## Pattern Assignments

### `src/server/backup.ts` (CREATE — utility, transform)

**Analog:** `src/server/codename.ts` — pure-function server helper with no external dependencies. Phase 11 mirrors this shape for `deriveBackupEligibility`.

**Imports pattern (NONE — no imports needed; the function takes a string-literal-union and returns boolean):**
```typescript
// src/server/backup.ts has zero imports — purest possible helper.
// Mirrors codename.ts which only imports from a local data file (not applicable here).
```

**Core pattern (NEW file, full content per 11-RESEARCH.md lines 744-772):**
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
 *   creation. Indicates whether the authenticator class supports backup. Cannot
 *   change for the lifetime of the credential. Encoded by @simplewebauthn/server
 *   as `credentialDeviceType === 'multiDevice'`.
 *
 * BS (Backup State) — bit 4 of authenticator flags. May FLIP from 0→1 (or 1→0)
 *   over the credential's lifetime. Re-read on every authentication assertion.
 *   Encoded by @simplewebauthn/server as `credentialBackedUp` (boolean).
 *
 * Invariant (enforced by @simplewebauthn/server): BE === false implies BS === false.
 */
export function deriveBackupEligibility(
  deviceType: 'singleDevice' | 'multiDevice'
): boolean {
  return deviceType === 'multiDevice';
}
```

**Why this analog:** Both `codename.ts` (existing) and `backup.ts` (new) are pure-function server helpers with no DB / no logger / no async. The function-export-with-JSDoc pattern is the project's convention for "single-source-of-truth helpers" (verified by reading `src/server/codename.ts:isValidCodename` and the `mpc-account-manager` factory pattern).

---

### `src/__tests__/backup.test.ts` (CREATE — unit test)

**Analog:** `src/__tests__/codename.test.ts` lines 1-47 — describe-block-per-function, multiple it-blocks, pure-function asserts, no mocks.

**Imports pattern (lines 7-13 of codename.test.ts):**
```typescript
import { describe, it, expect } from 'vitest';
import { deriveBackupEligibility } from '../server/backup.js';
```

**Core pattern (mirroring `describe`/`it` shape at codename.test.ts lines 19-47):**
```typescript
describe('deriveBackupEligibility (BACKUP-05)', () => {
  it('returns true for multiDevice', () => {
    expect(deriveBackupEligibility('multiDevice')).toBe(true);
  });

  it('returns false for singleDevice', () => {
    expect(deriveBackupEligibility('singleDevice')).toBe(false);
  });

  // Optional (per Pitfall 7 in 11-RESEARCH.md):
  // Type-level smoke — confirm the union is exhaustive at compile time.
  it('accepts only the two CredentialDeviceType literals', () => {
    const _ok1: ReturnType<typeof deriveBackupEligibility> = deriveBackupEligibility('multiDevice');
    const _ok2: ReturnType<typeof deriveBackupEligibility> = deriveBackupEligibility('singleDevice');
    expect(typeof _ok1).toBe('boolean');
    expect(typeof _ok2).toBe('boolean');
  });
});
```

**Why this analog:** `codename.test.ts` is the lightest-weight pure-function test in the repo. No mocks, no supertest, no fixtures. `backup.ts` has the same complexity profile.

---

### `src/__tests__/hooks-scaffolding.test.ts` (CREATE — type + threading test)

**Analog A — type/runtime re-export shape:** `src/__tests__/exports.test.ts` lines 47-81 (type-alias re-export assertions).
**Analog B — tsc-fail fixture (only if Open Question #2 in 11-RESEARCH.md is resolved toward "yes"):** `src/__tests__/mpc-treasury-leak.test.ts` lines 211-242.
**Analog C — factory spy pattern (for "hooks threaded but not invoked"):** `src/__tests__/registration-auth.test.ts` lines 18-118 (mock-DB + mock-managers + supertest).

**Imports pattern (combining `exports.test.ts` lines 13-22 with `registration-auth.test.ts` lines 8-12):**
```typescript
import { describe, it, expect, vi } from 'vitest';
import {
  createAnonAuth,
  type AnonAuthConfig,
  type AnonAuthHooks,
} from '../server/index.js';
```

**Core pattern A — `hooks: {}` compiles (mirrors `exports.test.ts` lines 47-58):**
```typescript
describe('HOOK-01: AnonAuthConfig.hooks is fully optional', () => {
  it('compiles with hooks omitted', () => {
    const _cfg: AnonAuthConfig = {
      nearNetwork: 'testnet',
      sessionSecret: 'secret-32-chars-long-enough-padding-12',
      database: { type: 'postgres', connectionString: 'postgres://x/y' },
    };
    expect(_cfg).toBeDefined();
  });

  it('compiles with hooks: {}', () => {
    const _cfg: AnonAuthConfig = {
      nearNetwork: 'testnet',
      sessionSecret: 'secret-32-chars-long-enough-padding-12',
      database: { type: 'postgres', connectionString: 'postgres://x/y' },
      hooks: {},
    };
    expect(_cfg.hooks).toEqual({});
  });
});
```

**Core pattern B — threading verification (factory spy; mirrors registration-auth.test.ts mock-injection at lines 73-118):**
```typescript
describe('HOOK-01: hooks threaded through createAnonAuth (no call sites wired)', () => {
  it('createAnonAuth accepts hooks without throwing AND does NOT invoke them', async () => {
    const afterAuthSuccess = vi.fn();
    const auth = createAnonAuth({
      nearNetwork: 'testnet',
      sessionSecret: 'test-secret-32-chars-long-enough-12345',
      database: { type: 'custom', adapter: makeMockDb() }, // makeMockDb from registration-auth.test.ts pattern
      rp: { name: 'Test', id: 'localhost', origin: 'http://localhost:3000' },
      hooks: { afterAuthSuccess },
    });
    expect(auth).toBeDefined();
    // Phase 11 contract: hooks are accepted but NOT invoked. Phase 14 will wire call sites.
    expect(afterAuthSuccess).not.toHaveBeenCalled();
  });

  // Pitfall 4 guard: zero call sites in src/server during Phase 11.
  it('grep-guard: no call sites for hooks.afterAuthSuccess in src/server during Phase 11', () => {
    // Optional belt-and-suspenders per Open Question #3.
    // execSync('grep -r "hooks.afterAuthSuccess(" src/server | wc -l') === '0'
  });
});
```

**Why these analogs:**
- `exports.test.ts:47-81` — established pattern for "type re-exported correctly" assertions in this repo (used for MPC type aliases).
- `mpc-treasury-leak.test.ts:211-242` — the *only* tsc-fail fixture in the repo; canonical pattern for "compiles? must / must-not".
- `registration-auth.test.ts:18-118` — `makeMockDb()` factory + manager-mock pattern for "instantiate the system, assert side-effect didn't happen".

---

### `src/server/passkey.ts` (MODIFY — service, request-response)

**Analog:** Self. The existing `finishRegistration` return shape (lines 190-201) is the literal template the new `finishAuthentication` return shape must mirror.

**Imports pattern (existing, lines 7-34) — UNCHANGED. The existing `VerifiedAuthenticationResponse` type (line 19) already carries `authenticationInfo.credentialBackedUp` and `authenticationInfo.credentialDeviceType`:**
```typescript
import type {
  GenerateRegistrationOptionsOpts,
  GenerateAuthenticationOptionsOpts,
  VerifyRegistrationResponseOpts,
  VerifyAuthenticationResponseOpts,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
```

**Existing `finishRegistration` template to mirror (lines 188-201):**
```typescript
// Return verified data - caller must create user first, then passkey
return {
  verified: true,
  passkeyData: {
    credentialId: registrationInfo.credential.id,
    publicKey: registrationInfo.credential.publicKey,
    counter: registrationInfo.credential.counter,
    deviceType: registrationInfo.credentialDeviceType,
    backedUp: registrationInfo.credentialBackedUp,
    transports: response.response.transports,
  },
  tempUserId,
};
```

**Existing `finishAuthentication` (the modification target — lines 296-310). The current return omits the freshly-read flags entirely:**
```typescript
// Update counter
await db.updatePasskeyCounter(
  passkey.credentialId,
  verification.authenticationInfo.newCounter
);

// Clean up challenge
await db.deleteChallenge(challengeId);

return {
  verified: true,
  userId: passkey.userId,
  passkey,
};
```

**Phase 11 change — extend with FRESH flag re-read + optional adapter call (per 11-RESEARCH.md Pattern 3 lines 309-359):**
```typescript
// After successful verification (replaces lines 296-310):
const freshBackedUp = verification.authenticationInfo.credentialBackedUp;
const freshDeviceType = verification.authenticationInfo.credentialDeviceType;

await db.updatePasskeyCounter(
  passkey.credentialId,
  verification.authenticationInfo.newCounter
);

// NEW: persist re-read backed_up only when value changed (avoid spurious writes)
if (freshBackedUp !== passkey.backedUp && db.updatePasskeyBackedUp) {
  await db.updatePasskeyBackedUp(passkey.credentialId, freshBackedUp);
}

await db.deleteChallenge(challengeId);

return {
  verified: true,
  userId: passkey.userId,
  passkey,
  passkeyData: { backedUp: freshBackedUp, deviceType: freshDeviceType },
};
```

**Type signature change (PasskeyManager interface, lines 81-89) — additive:**
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

**Why self-match:** The `finishRegistration` shape already established the `passkeyData: { ... }` convention (lines 192-200). Extending `finishAuthentication` with the same key shape (subset of fields — only `backedUp` + `deviceType` here) keeps the manager-return-shape vocabulary consistent.

---

### `src/server/webauthn.ts` (MODIFY — utility, request-response)

**Analog:** Self. The existing `VerifyRegistrationResult.credential` type (lines 99-119) plus the `verifyRegistration` return statement (lines 252-262) are the literal modification targets.

**Imports pattern — ADD one import (mirrors `passkey.ts:32` style of relative `.js` import for sibling server modules):**
```typescript
import { deriveBackupEligibility } from './backup.js';
```

**Existing return shape (lines 252-262):**
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

**Phase 11 change — ADD `backupEligible` derived from `deviceType`:**
```typescript
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

**Type update (`VerifyRegistrationResult.credential` interface, lines 99-119) — additive `backupEligible: boolean` between `backedUp` and `transports`. JSDoc must distinguish BE (capability, immutable) from BS (state, may flip) per Pitfall 7 (11-RESEARCH.md lines 726-736).**

**Why self-match:** The file already exposes `deviceType` and `backedUp` on the same `credential` literal. Adding `backupEligible` is symmetric and uses the same single-source-of-truth helper that `router.ts` will use.

---

### `src/server/router.ts` (MODIFY — controller, request-response)

**Analog:** Self. Both `/register/finish` (lines 235-239) and `/login/finish` (lines 312-315) response shapes are the modification targets.

**Imports pattern — ADD relative import (mirrors existing `./passkey.js` / `./codename.js` style; see lines 13, 20):**
```typescript
import { deriveBackupEligibility } from './backup.js';
```

**Existing `/register/finish` response (lines 235-239):**
```typescript
res.json({
  success: true,
  codename: user.codename,
  nearAccountId: user.nearAccountId,
});
```

**Phase 11 change — ADD `passkey: { backedUp, backupEligible }`. `passkeyData` is already destructured at line 190 (`const { verified, passkeyData } = await passkeyManager.finishRegistration(...)`):**
```typescript
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

**Existing `/login/finish` response (lines 312-315):**
```typescript
res.json({
  success: true,
  codename: user.codename,
});
```

**Phase 11 change — destructure `passkeyData` from manager return (depends on `passkey.ts` modification), then add same `passkey` key. Per 11-RESEARCH.md Open Question #1, do NOT silently add `nearAccountId` to login finish:**
```typescript
const { verified, userId, passkeyData } = await passkeyManager.finishAuthentication(
  challengeId,
  response
);
// ... (existing user lookup, session creation) ...
res.json({
  success: true,
  codename: user.codename,
  ...(passkeyData && {
    passkey: {
      backedUp: passkeyData.backedUp,
      backupEligible: deriveBackupEligibility(passkeyData.deviceType),
    },
  }),
});
```

**RouterConfig extension (lines 36-50) — ADD optional `hooks` field per HOOK-01 threading. Mirrors existing optional fields (`logger`, `rateLimiting`, `csrf`):**
```typescript
import type { AnonAuthHooks } from '../types/index.js';

export interface RouterConfig {
  // ... existing fields unchanged ...
  /** Phase 11 scaffolding — accepted and stored; call sites wired in F2/F3/F5. */
  hooks?: AnonAuthHooks;
}
```

**Why self-match:** Both router endpoints already follow the `res.json({ success: true, ... })` additive pattern. The `passkey.ts` manager already exposes `passkeyData` for register; mirroring it for auth keeps the controller code symmetrical.

---

### `src/server/index.ts` (MODIFY — factory + entry point)

**Analog:** Self. Existing `createRouter` call (lines 207-218) and `createOAuthRouter` call (lines 188-200) are the modification sites; existing type re-export block (lines 245-287) is the export-extension site.

**Existing factory call sites (lines 188-218):**
```typescript
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
});

// ...

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
});
```

**Phase 11 change — ADD `hooks: config.hooks` to BOTH factory calls (Pitfall 4: don't drop one):**
```typescript
oauthRouter = createOAuthRouter({
  // ... existing fields ...
  hooks: config.hooks,           // NEW
});

const router = createRouter({
  // ... existing fields ...
  hooks: config.hooks,           // NEW
});
```

**Existing type re-exports block (lines 245-257):**
```typescript
export type {
  AnonAuthConfig,
  DatabaseAdapter,
  AnonUser,
  OAuthUser,
  User,
  UserType,
  OAuthProvider,
  OAuthConfig,
  Session,
  RateLimitConfig,
  CsrfConfig
} from '../types/index.js';
```

**Phase 11 change — ADD `AnonAuthHooks` to the re-export list (consumers need the type to write callbacks):**
```typescript
export type {
  AnonAuthConfig,
  AnonAuthHooks,        // NEW (HOOK-01 re-export requirement)
  DatabaseAdapter,
  // ... rest unchanged ...
} from '../types/index.js';
```

**Why self-match:** The file already follows the pattern of "factory call passes `config.X` through". Adding `hooks: config.hooks` is the same shape as existing `csrf: config.csrf`, `rateLimiting: config.rateLimiting`. Re-export block already groups public types.

---

### `src/server/oauth/router.ts` (MODIFY — controller, request-response)

**Analog:** `src/server/router.ts` `RouterConfig` interface (lines 36-50). The OAuth router has the sister `OAuthRouterConfig` interface at lines 26-42; both need parallel `hooks?: AnonAuthHooks` fields.

**Existing `OAuthRouterConfig` (lines 26-42):**
```typescript
export interface OAuthRouterConfig {
  db: DatabaseAdapter;
  sessionManager: SessionManager;
  mpcManager: MPCAccountManager;
  oauthConfig: OAuthConfig;
  ipfsRecovery?: IPFSRecoveryManager;
  /** Optional pino logger instance. If omitted, logging is disabled (no output). */
  logger?: Logger;
  /** Optional rate limiting config */
  rateLimiting?: RateLimitConfig;
  /** Optional CSRF config (Double Submit Cookie) */
  csrf?: CsrfConfig;
  /** Optional email service for sending recovery passwords */
  emailService?: EmailService;
  /** Optional pre-created OAuthManager instance. If omitted, one is created internally. */
  oauthManager?: OAuthManager;
}
```

**Phase 11 change — ADD optional `hooks` field with parallel JSDoc to `RouterConfig`:**
```typescript
import type { DatabaseAdapter, OAuthConfig, OAuthProvider, RateLimitConfig, CsrfConfig, AnonAuthHooks } from '../../types/index.js';

export interface OAuthRouterConfig {
  // ... existing fields unchanged ...
  /** Phase 11 scaffolding — accepted and stored; call sites wired in F2/F3/F5. */
  hooks?: AnonAuthHooks;
}
```

**Function body change — NONE.** Per HOOK-01, no call sites are wired. The factory accepts the field and stores it (typically `const { hooks } = config;` if any later code references it, but Phase 11 has zero references).

**Why parallel-router analog:** `oauth/router.ts` and `router.ts` are sister factories with identical config-extension patterns. Phase 11 must extend both symmetrically (Pitfall 4).

---

### `src/server/db/adapters/postgres.ts` (MODIFY — service, CRUD)

**Analog:** Self. The existing `updatePasskeyCounter` (lines 640-646) is the literal template for the new `updatePasskeyBackedUp` method — same target table, same `WHERE credential_id = $X` clause, same one-line body.

**Existing analog (lines 640-646):**
```typescript
async updatePasskeyCounter(credentialId: string, counter: number): Promise<void> {
  const p = await getPool();
  await p.query(
    'UPDATE anon_passkeys SET counter = $1 WHERE credential_id = $2',
    [counter, credentialId]
  );
},
```

**Phase 11 change — ADD parallel method for `backed_up` column (which already exists in `POSTGRES_SCHEMA` line 75 per 11-RESEARCH.md):**
```typescript
async updatePasskeyBackedUp(credentialId: string, backedUp: boolean): Promise<void> {
  const p = await getPool();
  await p.query(
    'UPDATE anon_passkeys SET backed_up = $1 WHERE credential_id = $2',
    [backedUp, credentialId]
  );
},
```

**Why self-match:** Sister method on the same table. The `getPool()` lazy-init pattern, parameterised query style, and `Promise<void>` signature are all already established here. No new SQL idioms required.

---

### `src/types/index.ts` (MODIFY — model)

**Analog:** Self. Three modification sites use three distinct internal templates:

**(a) `DatabaseAdapter` optional method extension (mirrors lines 243-264 — the existing optional-method block):**
```typescript
// Existing pattern (lines 243-262, abbreviated):
updateSessionExpiry?(sessionId: string, newExpiresAt: Date): Promise<void>;
transaction?<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;
deleteUser?(userId: string): Promise<void>;
deleteRecoveryData?(userId: string): Promise<void>;
storeOAuthState?(state: OAuthStateRecord): void | Promise<void>;
// ...
```

**Phase 11 addition (per 11-RESEARCH.md Pattern 4 lines 365-374):**
```typescript
/** Optional: update the backed_up (BS bit) flag on a passkey record.
 *  If not implemented, the BS bit re-read at login is reflected in the
 *  response body but NOT persisted; the next session start will see the
 *  stale stored value. */
updatePasskeyBackedUp?(credentialId: string, backedUp: boolean): Promise<void>;
```

**(b) `AnonAuthConfig` extension (lines 37-129 — add new optional field at end of interface, per existing optional-field pattern at lines 108-128):**
```typescript
// Existing pattern (lines 108-115):
/** Optional pino logger instance. If omitted, logging is disabled (no output). */
logger?: pino.Logger;
/** Optional rate limiting configuration. Applied per-route with sensible defaults. */
rateLimiting?: RateLimitConfig;
/** Optional CSRF protection (Double Submit Cookie). Disabled by default. */
csrf?: CsrfConfig;
```

**Phase 11 addition:**
```typescript
/** Optional consumer hooks (v0.7.0). All callbacks optional; absent → v0.6.1 behavior.
 *  Phase 11 lands the type; call sites are wired in Phases 13–15. */
hooks?: AnonAuthHooks;
```

**(c) `AnonAuthHooks` interface (NEW — define near other top-level config types). Use `unknown` for ctx/event params per 11-RESEARCH.md Pattern 6 lines 449-499 (Phase 13/14/15 will refine):**
```typescript
/**
 * Optional consumer-facing hooks for extending auth lifecycle behavior.
 *
 * All callbacks are OPTIONAL. A consumer who passes `hooks: {}` (or omits
 * the field entirely) sees behavior byte-identical to v0.6.1.
 *
 * Phase 11 lands the type contract and threads hooks through factory functions;
 * call sites are installed in subsequent phases (13/14/15).
 */
export interface AnonAuthHooks {
  /** Phase 14 — fires inside /register/finish, /login/finish, OAuth callback. */
  afterAuthSuccess?: (ctx: unknown) => Promise<unknown>;
  /** Phase 15 — fires inside /login/finish when sealingKeyHex was supplied. */
  backfillKeyBundle?: (ctx: unknown) => Promise<unknown>;
  /** Phase 13 — fires fire-and-forget at lifecycle boundaries. */
  onAuthEvent?: (event: unknown) => void | Promise<void>;
}
```

**(d) Response type extensions (lines 438-452):**
```typescript
// Existing:
export interface RegistrationFinishResponse {
  success: boolean;
  codename: string;
  nearAccountId: string;
}
export interface AuthenticationFinishResponse {
  success: boolean;
  codename: string;
}
```

**Phase 11 addition (additive optional `passkey` key on both):**
```typescript
export interface RegistrationFinishResponse {
  success: boolean;
  codename: string;
  nearAccountId: string;
  /** v0.7.0 — BACKUP-01 additive nested key. Optional for forward-compat with
   *  degraded-path responses that may omit the flags. */
  passkey?: { backedUp: boolean; backupEligible: boolean };
}

export interface AuthenticationFinishResponse {
  success: boolean;
  codename: string;
  /** v0.7.0 — BACKUP-02 additive nested key; backedUp is RE-READ from the
   *  assertion on every login (BS bit may flip). */
  passkey?: { backedUp: boolean; backupEligible: boolean };
}
```

**Why self-match:** All four mod sites use existing project conventions — optional adapter methods with JSDoc rationale, optional config fields at end of interface, additive response keys with `?` for forward-compat.

---

### `src/client/hooks/useAnonAuth.tsx` (MODIFY — component)

**Analog:** Self. The existing `AnonAuthState` interface (lines 22-49), the `useState` initialiser (lines 126-140), and the `register()` / `login()` setState calls (lines 230-240, 275-286) are the modification targets.

**Existing `AnonAuthState` interface (lines 22-49) — pattern: typed, JSDoc-documented, `| null` for "not yet known":**
```typescript
export interface AnonAuthState {
  /** Whether initial session check is in progress */
  isLoading: boolean;
  // ...
  /** Whether the last registered credential appears cloud-synced (privacy warning) */
  credentialCloudSynced: boolean | null;
  // ...
}
```

**Phase 11 addition — ADD two new fields with JSDoc that distinguishes BE vs BS (Pitfall 7):**
```typescript
/** Whether the most recent passkey was backed up (BS bit) — re-read on every login.
 *  null until register() or login() resolves. */
passkeyBackedUp: boolean | null;

/** Whether the most recent passkey is backup-eligible (BE bit) — set once at registration.
 *  null until register() or login() resolves. */
passkeyBackupEligible: boolean | null;
```

**Existing initial state (lines 126-140):**
```typescript
const [state, setState] = useState<AnonAuthState>({
  isLoading: true,
  isAuthenticated: false,
  // ...
  credentialCloudSynced: null,
  oauthProviders: [],
});
```

**Phase 11 addition — initialise both new fields to `null`:**
```typescript
const [state, setState] = useState<AnonAuthState>({
  // ... existing fields ...
  credentialCloudSynced: null,
  oauthProviders: [],
  passkeyBackedUp: null,         // NEW
  passkeyBackupEligible: null,   // NEW
});
```

**Existing `register()` setState (lines 230-240) — pattern: spread prev + override fields after success branch:**
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
  }));
}
```

**Phase 11 addition — populate from `result.passkey` with nullish coalescing:**
```typescript
if (result.success) {
  setState((prev) => ({
    ...prev,
    // ... existing fields ...
    credentialCloudSynced: cloudSynced,
    passkeyBackedUp: result.passkey?.backedUp ?? null,
    passkeyBackupEligible: result.passkey?.backupEligible ?? null,
  }));
}
```

**Existing `login()` setState (lines 275-286) — same pattern, after `api.getSession()` resolves:**
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
  }));
}
```

**Phase 11 addition — populate from `result.passkey` (the finish response, NOT the session round-trip — per Don't Hand-Roll table in 11-RESEARCH.md):**
```typescript
if (result.success) {
  const session = await api.getSession();
  setState((prev) => ({
    ...prev,
    // ... existing fields ...
    expiresAt: session.expiresAt ? new Date(session.expiresAt) : null,
    passkeyBackedUp: result.passkey?.backedUp ?? null,
    passkeyBackupEligible: result.passkey?.backupEligible ?? null,
  }));
}
```

**API client type cascade (`src/client/api.ts` lines 39-58) — NO file change needed. The function signatures already type-reference `RegistrationFinishResponse` and `AuthenticationFinishResponse` (imported from `../types/index.js`), so extending those types in `types/index.ts` propagates automatically (per 11-RESEARCH.md Pattern 7 line 633).**

**Why self-match:** The `AnonAuthState` shape and the `setState((prev) => ({ ...prev, ...fields }))` idiom are already conventionalised in this file. Adding two more `boolean | null` fields with the same naming pattern (e.g., `credentialCloudSynced`) keeps the file's vocabulary consistent.

---

## Shared Patterns

### Pattern S1: Optional config field with JSDoc rationale + `?` modifier

**Source:** `src/types/index.ts` lines 108-128 (`logger?`, `rateLimiting?`, `csrf?`); `src/types/index.ts` lines 243-262 (`updateSessionExpiry?`, `transaction?`, `deleteUser?`, etc.); `src/server/router.ts` lines 44-49.

**Apply to:**
- `AnonAuthConfig.hooks?: AnonAuthHooks` (HOOK-01)
- `DatabaseAdapter.updatePasskeyBackedUp?` (BACKUP-02)
- `RouterConfig.hooks?` and `OAuthRouterConfig.hooks?` (HOOK-01 threading)
- `RegistrationFinishResponse.passkey?` and `AuthenticationFinishResponse.passkey?` (BACKUP-01/02)

**Concrete excerpt (the canonical optional-method-with-fallback-rationale shape, types/index.ts lines 245-247):**
```typescript
/** Optional: wrap multiple operations in a database transaction.
 *  If not implemented, operations execute sequentially (no atomicity guarantee). */
transaction?<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;
```

**Rule:** Every new optional field gets (1) `?` modifier, (2) JSDoc explaining the absent-field fallback, (3) NO behavioral change when absent.

---

### Pattern S2: Single-source-of-truth pure helper file

**Source:** `src/server/codename.ts` (`isValidCodename(codename: string): boolean`).

**Apply to:** `src/server/backup.ts` (`deriveBackupEligibility(deviceType): boolean`).

**Rule:** A new file under `src/server/` exports a pure function (no DB, no logger, no async, no I/O), is consumed by both `router.ts` and one or more sibling modules, and has a corresponding `__tests__/<name>.test.ts` with describe/it/expect-only structure (no mocks).

---

### Pattern S3: Factory-with-config-object — `create*({ ...config })`

**Source:** `src/server/index.ts` lines 188-218; `src/server/router.ts` lines 52-62; `src/server/passkey.ts` lines 94-100; `src/server/oauth/router.ts` lines 44-54.

**Apply to:** Threading `hooks` through `createAnonAuth` → `createRouter` / `createOAuthRouter`.

**Concrete excerpt (createAnonAuth → createRouter, lines 207-218):**
```typescript
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
  // Phase 11: hooks: config.hooks  ← ADD HERE
});
```

**Rule:** Threading a new config field through factories means (1) extending `RouterConfig` / `OAuthRouterConfig` interfaces in lockstep, (2) adding `hooks: config.hooks` to BOTH factory call sites in `index.ts`, (3) destructuring (or not, if no body code references it) inside the factory.

---

### Pattern S4: Additive response shape — never reorder, never replace

**Source:** `src/server/router.ts` lines 235-239 (`/register/finish`), 312-315 (`/login/finish`); `src/server/oauth/router.ts` lines 231-243 (verified by 11-RESEARCH.md "Sources" section).

**Apply to:** All response-body extensions in Phase 11.

**Rule:** New fields go at the END of the response literal. Existing fields keep their order, name, and value. Optional `passkey?: { backedUp, backupEligible }` is appended; never replace `success`, `codename`, or `nearAccountId`. Verified by a backwards-compat snapshot test using `expect.objectContaining(...)`.

---

### Pattern S5: tsc-fail compile fixture (heavyweight, optional for Phase 11)

**Source:** `src/__tests__/mpc-treasury-leak.test.ts` lines 211-242.

**Apply to:** `src/__tests__/hooks-scaffolding.test.ts` ONLY IF Open Question #2 in 11-RESEARCH.md resolves toward "yes — add a tsc-fail fixture for hooks: {}". Recommendation in research: positive vitest fixture (Pattern A) is sufficient; the tsc-fail pattern is reserved for required-field enforcement (Phase 13's PII whitelist).

**Concrete excerpt (the canonical write-temp-file → execSync → assert-failure shape, lines 211-241):**
```typescript
const fixturePath = join(process.cwd(), 'src/__tests__/_some-fixture.ts');
const fixtureSrc = `
  import type { SomeType } from '../module.js';
  const _bad: SomeType = { /* missing required field */ };
  export {};
  void _bad;
`;
writeFileSync(fixturePath, fixtureSrc, 'utf-8');
let tscFailed = false;
let tscOutput = '';
try {
  execSync(`npx tsc --noEmit ${fixturePath}`, { encoding: 'utf-8', cwd: process.cwd(), stdio: 'pipe' });
} catch (err) {
  tscFailed = true;
  const e = err as { stdout?: string; stderr?: string };
  tscOutput = (e.stdout || '') + (e.stderr || '');
} finally {
  if (existsSync(fixturePath)) unlinkSync(fixturePath);
}
expect(tscFailed).toBe(true);
expect(tscOutput).toMatch(/expected-error-substring/);
```

**Rule:** Use this pattern only when the test must verify "this code DOES NOT compile". For "this code compiles when X is omitted", a positive vitest assertion (the file containing the test compiles successfully under the project's tsc) is sufficient.

---

### Pattern S6: Pino logger child + silent default

**Source:** `src/server/passkey.ts` line 98 (`config.logger ?? pino({ level: 'silent' })).child({ module: 'passkey' })`); `src/server/router.ts` line 53; `src/server/oauth/router.ts` line 45; `src/server/webauthn.ts` line 55.

**Apply to:** `src/server/backup.ts` — NOT applicable (pure helper, no logging). Confirms that the new file does NOT need a logger import; consistency with `codename.ts` (also no logger).

**Rule:** Server-side files that perform I/O or have error paths use the silent-default pattern. Pure helpers do NOT.

---

## No Analog Found

None. Every Phase 11 file has a clear in-repo analog (mostly self-match). The phase is pure additive plumbing on top of v0.6.1 — no new architectural patterns introduced.

---

## Metadata

**Analog search scope:**
- `src/server/` (factory + manager + adapter + router patterns)
- `src/client/hooks/` (React state + setter idioms)
- `src/types/` (interface extension patterns)
- `src/__tests__/` (vitest test patterns: pure-func, mock-DB, supertest, tsc-fail fixture)
- `node_modules/@simplewebauthn/server/esm/` (verifying the BE/BS bit surface — already done in 11-RESEARCH.md, not re-verified here)

**Files scanned (Read tool, non-overlapping ranges):**
- `src/server/passkey.ts` (lines 1-100, 100-313)
- `src/server/webauthn.ts` (full file, 375 lines)
- `src/server/router.ts` (lines 1-350)
- `src/server/index.ts` (full file, 287 lines)
- `src/server/oauth/router.ts` (lines 1-100)
- `src/server/db/adapters/postgres.ts` (lines 560-700)
- `src/types/index.ts` (lines 1-270, 370-490)
- `src/client/hooks/useAnonAuth.tsx` (lines 1-300)
- `src/client/api.ts` (lines 30-100)
- `src/__tests__/codename.test.ts` (lines 1-60)
- `src/__tests__/exports.test.ts` (full file, 113 lines)
- `src/__tests__/registration-auth.test.ts` (lines 1-120)
- `src/__tests__/mpc-treasury-leak.test.ts` (lines 180-242)

**Pattern extraction date:** 2026-04-29

**Confidence:** HIGH — every analog is in-repo and was Read directly. All citations match the line ranges enumerated in `11-RESEARCH.md` "Sources / Primary" section (verified 2026-04-29). Zero `node_modules/` reliance for analog selection (the WebAuthn library is the *target* of the wrappers, not an analog).
