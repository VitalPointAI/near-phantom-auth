/**
 * Core types for near-anon-auth
 */

import type pino from 'pino';
import type { Request } from 'express';
import type { AnalyticsEvent } from '../server/analytics.js';

// ============================================
// HTTP Defense Configuration
// ============================================

export interface RateLimitConfig {
  /** Auth endpoint rate limit config (login, register, logout, OAuth) */
  auth?: {
    /** Window duration in ms (default: 15 * 60 * 1000 = 15 min) */
    windowMs?: number;
    /** Max requests per window per IP (default: 20) */
    limit?: number;
  };
  /** Recovery endpoint rate limit config (stricter than auth) */
  recovery?: {
    /** Window duration in ms (default: 60 * 60 * 1000 = 1 hour) */
    windowMs?: number;
    /** Max requests per window per IP (default: 5) */
    limit?: number;
  };
}

export interface CsrfConfig {
  /** Secret for HMAC token signing. Must NOT be the same as sessionSecret. */
  secret: string;
}

export type SessionMetadataIpPolicy = 'store' | 'omit' | 'hash' | 'truncate';
export type SessionMetadataUserAgentPolicy = 'store' | 'omit' | 'hash';

export interface SessionMetadataConfig {
  /** IP address persistence policy. Default `store` preserves v0.7.0 behavior.
   *  Use `omit` for maximum anonymous-track privacy. Use `hash` for
   *  pseudonymous HMAC correlation, not anonymity. Use `truncate` for coarse
   *  network analytics without storing a full raw IP address. */
  ipAddress?: SessionMetadataIpPolicy;
  /** User-agent persistence policy. Default `store` preserves v0.7.0 behavior.
   *  Use `omit` for maximum anonymous-track privacy. Use `hash` for
   *  pseudonymous HMAC correlation, not anonymity. User-agent truncation is not
   *  supported because UA strings do not have a stable network-prefix analogue. */
  userAgent?: SessionMetadataUserAgentPolicy;
}

// ============================================
// Hooks
// ============================================

/**
 * Optional consumer-facing hooks for extending auth lifecycle behavior.
 *
 * All callbacks are OPTIONAL. A consumer who passes `hooks: {}` (or omits
 * the field entirely) sees behavior byte-identical to v0.6.1.
 *
 * Phase 11 lands the type contract and threads hooks through factory functions;
 * call sites are installed in subsequent phases:
 *   - `afterAuthSuccess` — Phase 14 (HOOK-02..06): fires inside /register/finish,
 *     /login/finish, OAuth callback after auth succeeds, before session creation.
 *   - `backfillKeyBundle` — Phase 15 (BACKFILL-01..04): fires inside /login/finish
 *     when sealingKeyHex was supplied; pass-through (consumer owns schema).
 *   - `onAuthEvent` — Phase 13 (ANALYTICS-01..06): fire-and-forget at lifecycle
 *     boundaries; type-level PII whitelist enforced via tsc-fail fixture.
 */
/**
 * v0.7.0 — Phase 14 HOOK-04. OAuth provider literal mirror.
 * Mirrors `OauthProvider` in `src/server/analytics.ts:39` to avoid a
 * circular import between `types/index.ts` and `server/analytics.ts`.
 */
export type AfterAuthSuccessProvider = 'google' | 'github' | 'twitter';

/**
 * v0.7.0 — Phase 14 HOOK-02..04. Hook context discriminated union.
 *
 * Each variant carries the fields the consumer's hook needs to make a
 * second-factor decision. The discriminator is `authMethod`. The
 * `provider` field exists ONLY on the OAuth variant (Pitfall 5: putting
 * `provider` on every variant defeats type narrowing).
 *
 * `req` is the bare Express `Request`. The library does NOT sanitize
 * this surface — consumer's hook is consumer's code; what they read
 * from `req` (cookies, headers, body) is their responsibility.
 *
 * `codename` is REQUIRED on passkey variants and OPTIONAL on the OAuth
 * variant because `OAuthUser` (src/types/index.ts:410-422) does not
 * carry a codename in v0.7.0. Field reserved for future homogenization.
 *
 * SECURITY (T-14-03): `userId`, `codename`, `nearAccountId` are surfaced
 * to the CONSUMER (intended). The library MUST NOT log or telemetrize
 * these fields — they are part of the anonymity invariant for library
 * emissions but are exposed to the consumer's hook by design.
 */
export type AfterAuthSuccessCtx =
  | {
      authMethod: 'passkey-register';
      userId: string;
      codename: string;
      nearAccountId: string;
      req: Request;
    }
  | {
      authMethod: 'passkey-login';
      userId: string;
      codename: string;
      nearAccountId: string;
      req: Request;
    }
  | {
      authMethod: 'oauth-google' | 'oauth-github' | 'oauth-twitter';
      userId: string;
      /** OAuth users do not currently have a codename in v0.7.0;
       *  field reserved for future homogenization. */
      codename?: string;
      nearAccountId: string;
      provider: AfterAuthSuccessProvider;
      req: Request;
    };

/**
 * v0.7.0 — Phase 14 HOOK-02..05. Hook return discriminated union.
 *
 * `continue: true` allows the normal response (session is created,
 *   `secondFactor` is OMITTED from the response).
 * `continue: false` short-circuits: response carries the consumer's
 *   `body` spread into the top level PLUS a structured
 *   `secondFactor: { status, body }` echo (HOOK-05). NO session is
 *   created and NO `Set-Cookie` header is issued (Pitfall 2 — T-14-02).
 *
 * `body: Record<string, unknown>` is tighter than `object` (which
 * accepts Date / RegExp etc. that `res.json()` does not handle
 * predictably).
 */
export type AfterAuthSuccessResult =
  | { continue: true }
  | { continue: false; status: number; body: Record<string, unknown> };

/**
 * v0.7.0 — Phase 15 BACKFILL-02. Allowed values for the `reason` field on
 * a `BackfillKeyBundleResult`. Static enum (not free-form string) so the
 * library and consumers can switch on the value without parsing.
 *
 * - `'already-current'` — the consumer's schema already has a current key
 *   bundle for this user; nothing to do.
 * - `'no-legacy-data'` — the consumer has no pre-v0.6.0 NULL-bundle row
 *   for this user; nothing to backfill.
 * - `'completed'` — the consumer ran a backfill ceremony and persisted
 *   the new bundle.
 * - `'skipped'` — the consumer chose to skip (or the library set this
 *   reason on a hook throw — see BACKFILL-03).
 */
export type BackfillReason =
  | 'already-current'
  | 'no-legacy-data'
  | 'completed'
  | 'skipped';

/**
 * v0.7.0 — Phase 15 BACKFILL-01. Hook context for `hooks.backfillKeyBundle`.
 *
 * Single-shape (no discriminated union — only one fire site at
 * `POST /login/finish`). Surfaced ONLY when `sealingKeyHex` was supplied
 * in the request body (i.e. the authenticator returned a fresh PRF
 * sealing key). The library does NOT fire this hook when `sealingKeyHex`
 * is undefined — silent skip is the contract (BACKFILL-01).
 *
 * `req` is the bare Express `Request`. The library does NOT sanitize
 * this surface — the consumer's hook is consumer's code; what they read
 * from `req` (cookies, headers, body) is their responsibility.
 *
 * SECURITY (T-15-01 anonymity invariant): `userId`, `codename`,
 * `nearAccountId`, AND `sealingKeyHex` are surfaced to the CONSUMER
 * (intended). The library MUST NOT log or telemetrize these fields —
 * they are exposed to the consumer's hook by design but never to the
 * library's pino emissions. (Library logs use `redactErrorMessage` on
 * any thrown Error; the ctx itself is never written to a log payload.)
 */
export interface BackfillKeyBundleCtx {
  userId: string;
  codename: string;
  nearAccountId: string;
  /** 64-char lowercase hex (validated upstream by loginFinishBodySchema).
   *  Sensitive material — consumer's hook owns its handling, library
   *  never logs this field. */
  sealingKeyHex: string;
  req: Request;
}

/**
 * v0.7.0 — Phase 15 BACKFILL-02. Hook return shape for
 * `hooks.backfillKeyBundle`.
 *
 * `backfilled: boolean` — did the consumer actually persist a new key
 *   bundle? (false on `'already-current'`, `'no-legacy-data'`, and
 *   `'skipped'`; true on `'completed'`.)
 * `reason?: BackfillReason` — optional explicit reason; consumers SHOULD
 *   set it for observability but the library does not require it.
 *
 * Library echoes the result on `AuthenticationFinishResponse.backfill?`
 * (additive nested key; absent when `sealingKeyHex` was not supplied or
 * when no hook is configured).
 */
export interface BackfillKeyBundleResult {
  backfilled: boolean;
  reason?: BackfillReason;
}

export interface AnonAuthHooks {
  /**
   * v0.7.0 — Phase 14 HOOK-02..06. Fires INSIDE /register/finish (after
   * passkey verify + DB persist + MPC funding), inside /login/finish (after
   * passkey verify + getUserById), and inside OAuth /callback × 3 success
   * branches (after token exchange + user resolution). Always fires BEFORE
   * `sessionManager.createSession`.
   *
   * Returning `{ continue: false, status, body }` short-circuits the
   * response with consumer's body spread into the top level + a
   * `secondFactor: { status, body }` echo. NO session is created.
   *
   * A throw on the register-finish path triggers the existing
   * `db.transaction()` rollback wrapper. On login-finish and OAuth, a
   * throw produces a 500 — no DB writes happen between verify and
   * session, so no rollback is needed (login) or no transaction wrapper
   * exists at all (OAuth — see HOOK-06 + Pitfall 6).
   *
   * WARNING (HOOK-06): `mpcManager.createAccount` runs BEFORE the DB
   * transaction opens on register-finish (router.ts:225); on the OAuth
   * new-user branch (oauth/router.ts:304) it runs without any
   * transaction wrapper. A hook throw OR a `continue: false` AFTER MPC
   * funding leaves an orphaned funded NEAR implicit account with no DB
   * record. Consumers MUST be idempotent and prefer `continue: false`
   * over throwing for soft failures.
   */
  afterAuthSuccess?: (ctx: AfterAuthSuccessCtx) => Promise<AfterAuthSuccessResult>;
  /**
   * v0.7.0 — Phase 15 BACKFILL-01..03. Pass-through hook fired INSIDE
   * `POST /login/finish` after passkey verify + `db.getUserById`, BEFORE
   * `sessionManager.createSession` — and ONLY when `sealingKeyHex` was
   * supplied in the request body (no PRF → no fresh sealing key →
   * silent skip; the hook is NOT invoked, no `backfill` field appears
   * on the response).
   *
   * Library is **pass-through** by contract: it does NOT persist the
   * bundle, does NOT wrap the hook in a transaction, and does NOT touch
   * any consumer-owned schema. The consumer's hook is fully responsible
   * for migration logic (read legacy NULL-bundle row, derive new
   * bundle, persist atomically in consumer's own transaction, etc.).
   *
   * BACKFILL-03 CONTAINMENT: a hook throw or rejected Promise is
   * caught by the library, logged WARN with a redacted error payload
   * (Error.name + first 2 stack frames; sealingKeyHex NEVER appears in
   * the log), and the response continues with
   * `backfill: { backfilled: false, reason: 'skipped' }`. **Backfill
   * failure NEVER blocks login.**
   *
   * BACKFILL-04 (consumer responsibilities, documented in README):
   *   - Library does not persist the key bundle (consumer-owned schema).
   *   - Library does not run a transaction around the hook.
   *   - Library does not migrate existing IPFS recovery blobs — those
   *     remain consumer-owned and may be ORPHANED if the consumer's
   *     backfill replaces the recovery method (dual-recovery semantics
   *     explicit).
   */
  backfillKeyBundle?: (ctx: BackfillKeyBundleCtx) => Promise<BackfillKeyBundleResult>;
  /** Phase 13 — fires fire-and-forget at lifecycle boundaries on the
   *  passkey router, OAuth router, recovery endpoints, and account-delete.
   *  Errors / rejected Promises are caught by the library and logged WARN
   *  with redacted payload — they NEVER break the auth response. Default
   *  fire-and-forget; opt-in to awaited emit via `AnonAuthConfig.awaitAnalytics`. */
  onAuthEvent?: (event: AnalyticsEvent) => void | Promise<void>;
}

/**
 * Paired tuple binding a related origin to its rpId for cross-domain passkey
 * support (WebAuthn Related Origin Requests, v0.7.0 RPID-01).
 *
 * Pairing is structural — the array is a list of pairs, NOT two parallel
 * arrays. `@simplewebauthn/server@13.x` does NOT cross-check origin↔rpId
 * pairing; it tests independent membership of each list. The paired-tuple
 * shape IS the R3 origin-spoofing defense — it cannot be silently broken
 * by a `.map()` reorder because the array IS the list of pairs.
 *
 * Validated at createAnonAuth() startup by validateRelatedOrigins() (Plan 02):
 *   - https:// only (or http://localhost when rpId === 'localhost')
 *   - no wildcards
 *   - origin host MUST be a suffix-domain of rpId (label-boundary aware)
 *   - max 5 entries
 *
 * The library does NOT auto-host /.well-known/webauthn — consumer
 * responsibility (see README "Cross-Domain Passkeys" — added in Plan 04).
 */
export interface RelatedOrigin {
  /** Origin for the related domain. Must be `https://...` (or
   *  `http://localhost...` only when paired rpId === 'localhost'). */
  origin: string;
  /** RP ID for the related domain. Origin's host MUST be a suffix-domain
   *  of this rpId (`host === rpId || host.endsWith('.' + rpId)`). */
  rpId: string;
}

// ============================================
// Configuration
// ============================================

export interface AnonAuthConfig {
  /** NEAR network: 'testnet' | 'mainnet' */
  nearNetwork: 'testnet' | 'mainnet';
  
  /** Secret for signing session cookies */
  sessionSecret: string;
  
  /** Session duration in milliseconds (default: 7 days) */
  sessionDurationMs?: number;

  /** Controls whether operational session metadata is stored raw, omitted, or
   *  transformed before persistence. Absent config preserves current behavior
   *  (`store`). For maximum anonymous-track privacy, set both fields to
   *  `omit`. `hash` uses HMAC and remains pseudonymous/correlatable; `truncate`
   *  applies only to IP addresses. */
  sessionMetadata?: SessionMetadataConfig;
  
  /** Database configuration */
  database: DatabaseConfig;
  
  /** Codename generation style */
  codename?: CodenameConfig;
  
  /** Recovery options */
  recovery?: RecoveryConfig;
  
  /** WebAuthn relying party configuration */
  rp?: {
    /** Relying party name (shown to users) */
    name: string;
    /** Relying party ID (usually your domain) */
    id: string;
    /** Origin for WebAuthn (e.g., https://example.com) */
    origin: string;
    /** Optional related origins for cross-domain passkey support (v0.7.0 RPID-01).
     *  Max 5 entries; each origin's host MUST be a suffix-domain of its paired rpId.
     *  Validated at createAnonAuth() startup by validateRelatedOrigins (Plan 02).
     *  The library does NOT host /.well-known/webauthn — consumer responsibility
     *  (see README "Cross-Domain Passkeys (v0.7.0)"). Default: undefined === []. */
    relatedOrigins?: RelatedOrigin[];
  };

  /** Passkey / PRF configuration (WebAuthn Level 3 PRF extension) */
  passkey?: {
    /**
     * PRF salt for DEK sealing key derivation.
     * Must be byte-identical across all registrations and logins for the same credential — one byte
     * of difference produces a different 32-byte PRF output and destroys DEK access for existing users.
     * Defaults to the library-internal constant 'near-phantom-auth-prf-v1'.
     * Server-side documentation only — the library does not use this value at runtime on the server;
     * the actual PRF ceremony runs in the browser. Mirror this value in AnonAuthProviderProps.passkey.
     */
    prfSalt?: Uint8Array;
    /**
     * If true, refuse registration/login when the authenticator does not support the PRF extension.
     * Defaults to false (graceful degradation — the ceremony completes without sealingKeyHex).
     *
     * WR-03 TRADE-OFF: The PRF support check runs AFTER `navigator.credentials.create()`
     * (registration) or `.get()` (login) resolves. By that point the ceremony has already
     * run — on registration, the authenticator has provisioned the credential on the device
     * (platform keychain, hardware key slot, etc.). If this guard throws on a requirePrf:true
     * registration against a non-PRF authenticator, the user is left with an ORPHANED passkey
     * on their device that the server never recorded; it cannot be cleaned up remotely and
     * may confuse users at next login.
     *
     * This is an accepted limitation because PRF support is reliably detectable only via a
     * real WebAuthn ceremony in today's browsers (`PublicKeyCredential.getClientCapabilities()`
     * is not yet broadly available). A pre-flight probe should be added when that API lands.
     * For login, the concern is smaller (no new credential is provisioned; only the counter
     * advances), but the "login failed because of PRF" UX on an otherwise-valid credential
     * is still worth calling out here.
     */
    requirePrf?: boolean;
  };

  /** OAuth provider configuration */
  oauth?: OAuthConfig;
  
  /** MPC account configuration */
  mpc?: MPCAccountConfig;

  /** Server-side secret salt for NEAR account derivation. Recommended for production to prevent account ID prediction. */
  derivationSalt?: string;

  /** Optional pino logger instance. If omitted, logging is disabled (no output). */
  logger?: pino.Logger;

  /** Optional rate limiting configuration. Applied per-route with sensible defaults. */
  rateLimiting?: RateLimitConfig;

  /** Optional CSRF protection (Double Submit Cookie). Disabled by default. */
  csrf?: CsrfConfig;

  /** AWS SES email configuration for sending recovery passwords to OAuth users.
   *  When absent, recovery passwords are not emailed (backup still created). */
  email?: {
    /** AWS SES region (e.g., 'us-east-1') */
    region: string;
    /** AWS access key ID (optional — uses instance profile if omitted) */
    accessKeyId?: string;
    /** AWS secret access key (required when accessKeyId is provided) */
    secretAccessKey?: string;
    /** Verified sender email address or domain identity in SES */
    fromAddress: string;
  };

  /** Optional consumer hooks (v0.7.0). All callbacks optional;
   *  absent or `hooks: {}` → behavior identical to v0.6.1.
   *  Phase 11 lands the type; call sites wired in Phases 13–15. */
  hooks?: AnonAuthHooks;

  /** Phase 13 ANALYTICS-04. When true, the library AWAITS `hooks.onAuthEvent`
   *  before responding (synchronous-guarantee mode). Default false
   *  (fire-and-forget). Adds latency proportional to hook execution time
   *  when enabled — README documents this trade-off. Errors are STILL
   *  swallowed in await mode (a throwing hook never breaks the response). */
  awaitAnalytics?: boolean;
}

export interface MPCAccountConfig {
  /** Treasury account for auto-funding new accounts */
  treasuryAccount?: string;
  /** Treasury account private key (ed25519:...) */
  treasuryPrivateKey?: string;
  /** Amount of NEAR to fund new accounts (default: 0.01) */
  fundingAmount?: string;
  /** Account name prefix (default: 'anon') */
  accountPrefix?: string;

  /** Server-side secret salt for NEAR account derivation (forwarded from AnonAuthConfig) */
  derivationSalt?: string;
}

export interface OAuthConfig {
  /** OAuth callback base URL (e.g., https://myapp.com/auth/callback) */
  callbackBaseUrl: string;
  
  /** Google OAuth */
  google?: {
    clientId: string;
    clientSecret: string;
  };
  
  /** GitHub OAuth */
  github?: {
    clientId: string;
    clientSecret: string;
  };
  
  /** X (Twitter) OAuth */
  twitter?: {
    clientId: string;
    clientSecret: string;
  };
}

export interface DatabaseConfig {
  type: 'postgres' | 'custom';
  connectionString?: string;
  /** Custom adapter for database operations */
  adapter?: DatabaseAdapter;
}

export interface CodenameConfig {
  /** Style of codename generation */
  style?: 'nato-phonetic' | 'animals' | 'custom';
  /** Custom codename generator function */
  generator?: (userId: string) => string;
}

export interface RecoveryConfig {
  /** Enable wallet-based recovery (on-chain access key) */
  wallet?: boolean;
  
  /** Enable IPFS + password recovery */
  ipfs?: {
    pinningService: 'pinata' | 'web3storage' | 'infura' | 'custom';
    apiKey?: string;
    apiSecret?: string;
    /** Custom pinning function */
    customPin?: (data: Uint8Array) => Promise<string>;
    customFetch?: (cid: string) => Promise<Uint8Array>;
  };
}

// ============================================
// Database Adapter
// ============================================

export interface DatabaseAdapter {
  /** Initialize database schema */
  initialize(): Promise<void>;
  
  // Users
  createUser(user: CreateUserInput): Promise<AnonUser>;
  getUserById(id: string): Promise<AnonUser | null>;
  getUserByCodename(codename: string): Promise<AnonUser | null>;
  getUserByNearAccount(nearAccountId: string): Promise<AnonUser | null>;
  
  // OAuth Users (standard users with OAuth)
  createOAuthUser(user: CreateOAuthUserInput): Promise<OAuthUser>;
  getOAuthUserById(id: string): Promise<OAuthUser | null>;
  getOAuthUserByEmail(email: string): Promise<OAuthUser | null>;
  getOAuthUserByProvider(provider: string, providerId: string): Promise<OAuthUser | null>;
  linkOAuthProvider(userId: string, provider: OAuthProvider): Promise<void>;
  
  // Passkeys
  createPasskey(passkey: CreatePasskeyInput): Promise<Passkey>;
  getPasskeyById(credentialId: string): Promise<Passkey | null>;
  getPasskeysByUserId(userId: string): Promise<Passkey[]>;
  updatePasskeyCounter(credentialId: string, counter: number): Promise<void>;
  deletePasskey(credentialId: string): Promise<void>;
  
  // Sessions
  createSession(session: CreateSessionInput): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  deleteSession(sessionId: string): Promise<void>;
  deleteUserSessions(userId: string): Promise<void>;
  cleanExpiredSessions(): Promise<number>;
  
  // Challenges (for WebAuthn)
  storeChallenge(challenge: Challenge): Promise<void>;
  getChallenge(challengeId: string): Promise<Challenge | null>;
  deleteChallenge(challengeId: string): Promise<void>;
  
  // Recovery
  storeRecoveryData(data: RecoveryData): Promise<void>;
  getRecoveryData(userId: string, type: RecoveryType): Promise<RecoveryData | null>;

  // Optional: update session expiry without full session replacement.
  // If not implemented, session refresh falls back to cookie-only behavior.
  updateSessionExpiry?(sessionId: string, newExpiresAt: Date): Promise<void>;

  /** Optional: wrap multiple operations in a database transaction.
   *  If not implemented, operations execute sequentially (no atomicity guarantee). */
  transaction?<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;

  /** Optional: delete a user by ID. Passkeys cascade via FK; sessions and recovery must be deleted first. */
  deleteUser?(userId: string): Promise<void>;

  /** Optional: delete all recovery data for a user. */
  deleteRecoveryData?(userId: string): Promise<void>;

  /** Optional: store OAuth state for cross-instance durability. */
  storeOAuthState?(state: OAuthStateRecord): void | Promise<void>;
  /** Optional: retrieve and consume OAuth state by state key. */
  getOAuthState?(stateKey: string): Promise<OAuthStateRecord | null>;
  /** Optional: delete OAuth state (consumed or expired). */
  deleteOAuthState?(stateKey: string): Promise<void>;
  /** Optional: clean expired WebAuthn challenges. Returns count deleted. */
  cleanExpiredChallenges?(): Promise<number>;
  /** Optional: clean expired OAuth states. Returns count deleted. */
  cleanExpiredOAuthStates?(): Promise<number>;

  /** Optional: persist the backed_up (BS bit) flag on a passkey record on every login.
   *  If not implemented, the BS bit re-read at login is reflected in the
   *  response body but NOT persisted; the next session start will see the
   *  stale stored value. Custom adapters that don't need persistence may omit this. */
  updatePasskeyBackedUp?(credentialId: string, backedUp: boolean): Promise<void>;
}

// ============================================
// OAuth State Record (for DB-backed state storage)
// ============================================

/** Minimal OAuth state record stored in the database to enable cross-instance durability. */
export interface OAuthStateRecord {
  provider: string;
  state: string;
  codeVerifier?: string;
  redirectUri: string;
  expiresAt: Date;
}

// ============================================
// User Types
// ============================================

/**
 * User type enumeration
 */
export type UserType = 'anonymous' | 'standard';

/**
 * Anonymous user (HUMINT sources) - passkey only, no PII
 */
export interface AnonUser {
  id: string;
  type: 'anonymous';
  codename: string;
  nearAccountId: string;
  mpcPublicKey: string;
  derivationPath: string;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface CreateUserInput {
  codename: string;
  nearAccountId: string;
  mpcPublicKey: string;
  derivationPath: string;
}

/**
 * OAuth provider connection
 */
export interface OAuthProvider {
  provider: 'google' | 'github' | 'twitter';
  providerId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  connectedAt: Date;
}

/**
 * Standard user (OAuth/email) - full access, has PII
 */
export interface OAuthUser {
  id: string;
  type: 'standard';
  email: string;
  name?: string;
  avatarUrl?: string;
  nearAccountId: string;
  mpcPublicKey: string;
  derivationPath: string;
  providers: OAuthProvider[];
  createdAt: Date;
  lastActiveAt: Date;
}

export interface CreateOAuthUserInput {
  email: string;
  name?: string;
  avatarUrl?: string;
  nearAccountId: string;
  mpcPublicKey: string;
  derivationPath: string;
  provider: OAuthProvider;
}

/**
 * Union type for any user
 */
export type User = AnonUser | OAuthUser;

// ============================================
// Session
// ============================================

export interface Session {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface CreateSessionInput {
  userId: string;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

// ============================================
// Passkeys (WebAuthn)
// ============================================

export interface Passkey {
  credentialId: string;
  userId: string;
  publicKey: Uint8Array;
  counter: number;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  transports?: AuthenticatorTransport[];
  createdAt: Date;
}

export type AuthenticatorTransport = 'usb' | 'ble' | 'nfc' | 'internal' | 'hybrid';

export interface CreatePasskeyInput {
  credentialId: string;
  userId: string;
  publicKey: Uint8Array;
  counter: number;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  transports?: AuthenticatorTransport[];
}

// ============================================
// Challenges
// ============================================

export interface Challenge {
  id: string;
  challenge: string;
  type: 'registration' | 'authentication' | 'recovery';
  userId?: string;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

// ============================================
// Recovery
// ============================================

export type RecoveryType = 'wallet' | 'ipfs';

export interface RecoveryData {
  userId: string;
  type: RecoveryType;
  /** For wallet: NEAR account ID. For IPFS: CID */
  reference: string;
  createdAt: Date;
}

// ============================================
// API Responses
// ============================================

export interface RegistrationStartResponse {
  challengeId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

export interface RegistrationFinishResponse {
  success: boolean;
  codename: string;
  nearAccountId: string;
  /** v0.7.0 — BACKUP-01 additive nested key. Optional for forward-compat with
   *  degraded-path responses that may omit the flags. */
  passkey?: { backedUp: boolean; backupEligible: boolean };
  /** v0.7.0 — HOOK-05 echo of consumer's hook short-circuit. Present
   *  when `hooks.afterAuthSuccess` returned `{ continue: false, status,
   *  body }`; absent on `continue: true`. The library spreads
   *  consumer's `body` fields into the response AND echoes the
   *  structured descriptor here so consumers can detect short-circuit
   *  on the response body alone (without inspecting HTTP status).
   *
   *  If consumer's `body` happens to include a key named
   *  `secondFactor`, the echo wins — the echo is the canonical source
   *  of short-circuit metadata. */
  secondFactor?: { status: number; body: Record<string, unknown> };
}

export interface AuthenticationStartResponse {
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

export interface AuthenticationFinishResponse {
  success: boolean;
  codename: string;
  /** v0.7.0 — BACKUP-02 additive nested key; backedUp is RE-READ from the
   *  assertion on every login (BS bit may flip). */
  passkey?: { backedUp: boolean; backupEligible: boolean };
  /** v0.7.0 — HOOK-05 echo of consumer's hook short-circuit. Same
   *  contract as `RegistrationFinishResponse.secondFactor`. */
  secondFactor?: { status: number; body: Record<string, unknown> };
  /** v0.7.0 — BACKFILL-02 echo of the consumer's `hooks.backfillKeyBundle`
   *  result. Present on responses where `sealingKeyHex` was supplied AND
   *  a hook was configured. Absent when:
   *    - `sealingKeyHex` was NOT supplied (silent skip — BACKFILL-01);
   *    - no `hooks.backfillKeyBundle` was configured;
   *  Present with `{ backfilled: false, reason: 'skipped' }` when the
   *  hook threw or rejected (BACKFILL-03 — library catches, logs WARN
   *  with redacted error, login continues normally). */
  backfill?: { backfilled: boolean; reason?: BackfillReason };
}

export interface RecoveryWalletLinkResponse {
  success: boolean;
  nearAccountId: string;
  message: string;
}

export interface RecoveryIPFSSetupResponse {
  success: boolean;
  cid: string;
  message: string;
}

// ============================================
// WebAuthn JSON Types (for API transport)
// ============================================

export interface PublicKeyCredentialCreationOptionsJSON {
  challenge: string;
  rp: {
    name: string;
    id: string;
  };
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  pubKeyCredParams: Array<{
    type: 'public-key';
    alg: number;
  }>;
  timeout?: number;
  excludeCredentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransport[];
  }>;
  authenticatorSelection?: {
    authenticatorAttachment?: 'platform' | 'cross-platform';
    residentKey?: 'discouraged' | 'preferred' | 'required';
    requireResidentKey?: boolean;
    userVerification?: 'discouraged' | 'preferred' | 'required';
  };
  attestation?: 'none' | 'indirect' | 'direct' | 'enterprise';
}

export interface PublicKeyCredentialRequestOptionsJSON {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransport[];
  }>;
  userVerification?: 'discouraged' | 'preferred' | 'required';
}

export interface RegistrationResponseJSON {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: AuthenticatorTransport[];
  };
  clientExtensionResults: Record<string, unknown>;
  /** Authenticator attachment type (platform = device built-in, cross-platform = hardware key) */
  authenticatorAttachment?: 'platform' | 'cross-platform';
  /** Transport methods (for privacy detection) */
  transports?: AuthenticatorTransport[];
}

export interface AuthenticationResponseJSON {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  clientExtensionResults: Record<string, unknown>;
}

// ============================================
// Express Integration
// ============================================

export interface AnonAuthRequest {
  anonUser?: AnonUser;
  anonSession?: Session;
}

declare global {
  namespace Express {
    interface Request extends AnonAuthRequest {}
  }
}
