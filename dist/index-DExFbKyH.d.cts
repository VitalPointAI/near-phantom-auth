import pino from 'pino';

/**
 * Core types for near-anon-auth
 */

interface RateLimitConfig {
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
interface CsrfConfig {
    /** Secret for HMAC token signing. Must NOT be the same as sessionSecret. */
    secret: string;
}
interface AnonAuthConfig {
    /** NEAR network: 'testnet' | 'mainnet' */
    nearNetwork: 'testnet' | 'mainnet';
    /** Secret for signing session cookies */
    sessionSecret: string;
    /** Session duration in milliseconds (default: 7 days) */
    sessionDurationMs?: number;
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
}
interface MPCAccountConfig {
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
interface OAuthConfig {
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
interface DatabaseConfig {
    type: 'postgres' | 'custom';
    connectionString?: string;
    /** Custom adapter for database operations */
    adapter?: DatabaseAdapter;
}
interface CodenameConfig {
    /** Style of codename generation */
    style?: 'nato-phonetic' | 'animals' | 'custom';
    /** Custom codename generator function */
    generator?: (userId: string) => string;
}
interface RecoveryConfig {
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
interface DatabaseAdapter {
    /** Initialize database schema */
    initialize(): Promise<void>;
    createUser(user: CreateUserInput): Promise<AnonUser>;
    getUserById(id: string): Promise<AnonUser | null>;
    getUserByCodename(codename: string): Promise<AnonUser | null>;
    getUserByNearAccount(nearAccountId: string): Promise<AnonUser | null>;
    createOAuthUser(user: CreateOAuthUserInput): Promise<OAuthUser>;
    getOAuthUserById(id: string): Promise<OAuthUser | null>;
    getOAuthUserByEmail(email: string): Promise<OAuthUser | null>;
    getOAuthUserByProvider(provider: string, providerId: string): Promise<OAuthUser | null>;
    linkOAuthProvider(userId: string, provider: OAuthProvider): Promise<void>;
    createPasskey(passkey: CreatePasskeyInput): Promise<Passkey>;
    getPasskeyById(credentialId: string): Promise<Passkey | null>;
    getPasskeysByUserId(userId: string): Promise<Passkey[]>;
    updatePasskeyCounter(credentialId: string, counter: number): Promise<void>;
    deletePasskey(credentialId: string): Promise<void>;
    createSession(session: CreateSessionInput): Promise<Session>;
    getSession(sessionId: string): Promise<Session | null>;
    deleteSession(sessionId: string): Promise<void>;
    deleteUserSessions(userId: string): Promise<void>;
    cleanExpiredSessions(): Promise<number>;
    storeChallenge(challenge: Challenge): Promise<void>;
    getChallenge(challengeId: string): Promise<Challenge | null>;
    deleteChallenge(challengeId: string): Promise<void>;
    storeRecoveryData(data: RecoveryData): Promise<void>;
    getRecoveryData(userId: string, type: RecoveryType): Promise<RecoveryData | null>;
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
}
/** Minimal OAuth state record stored in the database to enable cross-instance durability. */
interface OAuthStateRecord {
    provider: string;
    state: string;
    codeVerifier?: string;
    redirectUri: string;
    expiresAt: Date;
}
/**
 * User type enumeration
 */
type UserType = 'anonymous' | 'standard';
/**
 * Anonymous user (HUMINT sources) - passkey only, no PII
 */
interface AnonUser {
    id: string;
    type: 'anonymous';
    codename: string;
    nearAccountId: string;
    mpcPublicKey: string;
    derivationPath: string;
    createdAt: Date;
    lastActiveAt: Date;
}
interface CreateUserInput {
    codename: string;
    nearAccountId: string;
    mpcPublicKey: string;
    derivationPath: string;
}
/**
 * OAuth provider connection
 */
interface OAuthProvider {
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
interface OAuthUser {
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
interface CreateOAuthUserInput {
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
type User = AnonUser | OAuthUser;
interface Session {
    id: string;
    userId: string;
    createdAt: Date;
    expiresAt: Date;
    lastActivityAt: Date;
    ipAddress?: string;
    userAgent?: string;
}
interface CreateSessionInput {
    userId: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
}
interface Passkey {
    credentialId: string;
    userId: string;
    publicKey: Uint8Array;
    counter: number;
    deviceType: 'singleDevice' | 'multiDevice';
    backedUp: boolean;
    transports?: AuthenticatorTransport[];
    createdAt: Date;
}
type AuthenticatorTransport = 'usb' | 'ble' | 'nfc' | 'internal' | 'hybrid';
interface CreatePasskeyInput {
    credentialId: string;
    userId: string;
    publicKey: Uint8Array;
    counter: number;
    deviceType: 'singleDevice' | 'multiDevice';
    backedUp: boolean;
    transports?: AuthenticatorTransport[];
}
interface Challenge {
    id: string;
    challenge: string;
    type: 'registration' | 'authentication' | 'recovery';
    userId?: string;
    expiresAt: Date;
    metadata?: Record<string, unknown>;
}
type RecoveryType = 'wallet' | 'ipfs';
interface RecoveryData {
    userId: string;
    type: RecoveryType;
    /** For wallet: NEAR account ID. For IPFS: CID */
    reference: string;
    createdAt: Date;
}
interface RegistrationStartResponse {
    challengeId: string;
    options: PublicKeyCredentialCreationOptionsJSON;
}
interface RegistrationFinishResponse {
    success: boolean;
    codename: string;
    nearAccountId: string;
}
interface AuthenticationStartResponse {
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
}
interface AuthenticationFinishResponse {
    success: boolean;
    codename: string;
}
interface PublicKeyCredentialCreationOptionsJSON {
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
interface PublicKeyCredentialRequestOptionsJSON {
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
interface RegistrationResponseJSON {
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
interface AuthenticationResponseJSON {
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
interface AnonAuthRequest {
    anonUser?: AnonUser;
    anonSession?: Session;
}
declare global {
    namespace Express {
        interface Request extends AnonAuthRequest {
        }
    }
}

export type { AuthenticationStartResponse as A, CsrfConfig as C, DatabaseAdapter as D, OAuthConfig as O, PublicKeyCredentialRequestOptionsJSON as P, RegistrationStartResponse as R, Session as S, User as U, RegistrationResponseJSON as a, RegistrationFinishResponse as b, AuthenticationResponseJSON as c, AuthenticationFinishResponse as d, PublicKeyCredentialCreationOptionsJSON as e, AuthenticatorTransport as f, Passkey as g, RateLimitConfig as h, AnonAuthConfig as i, AnonUser as j, OAuthProvider as k, OAuthUser as l, UserType as m, CodenameConfig as n, RecoveryConfig as o, RecoveryData as p, RecoveryType as q };
