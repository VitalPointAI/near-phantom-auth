/**
 * Server SDK Entry Point
 * 
 * @example
 * ```typescript
 * import { createAnonAuth } from '@vitalpoint/near-phantom-auth/server';
 * 
 * const anonAuth = createAnonAuth({
 *   nearNetwork: 'testnet',
 *   sessionSecret: process.env.SESSION_SECRET,
 *   database: {
 *     type: 'postgres',
 *     connectionString: process.env.DATABASE_URL,
 *   },
 *   rp: {
 *     name: 'My App',
 *     id: 'myapp.com',
 *     origin: 'https://myapp.com',
 *   },
 *   oauth: {
 *     callbackBaseUrl: 'https://myapp.com/auth/callback',
 *     google: { clientId: '...', clientSecret: '...' },
 *     github: { clientId: '...', clientSecret: '...' },
 *     twitter: { clientId: '...', clientSecret: '...' },
 *   },
 * });
 * 
 * app.use('/auth', anonAuth.router);
 * app.use('/auth/oauth', anonAuth.oauthRouter);
 * app.get('/protected', anonAuth.requireAuth, handler);
 * ```
 */

import type { Router, RequestHandler } from 'express';
import type { AnonAuthConfig, DatabaseAdapter } from '../types/index.js';
import pino from 'pino';
import { createPostgresAdapter } from './db/adapters/postgres.js';
import { createSessionManager, type SessionManager } from './session.js';
import { createPasskeyManager, type PasskeyManager } from './passkey.js';
import { validateRelatedOrigins } from './relatedOrigins.js';
import { createMPCManager, type MPCAccountManager } from './mpc.js';
import { createWalletRecoveryManager, type WalletRecoveryManager } from './recovery/wallet.js';
import { createIPFSRecoveryManager, type IPFSRecoveryManager } from './recovery/ipfs.js';
import { createOAuthManager, type OAuthManager } from './oauth/index.js';
import { createEmailService, type EmailService } from './email.js';
import { createOAuthRouter } from './oauth/router.js';
import { createAuthMiddleware, createRequireAuth } from './middleware.js';
import { createRouter } from './router.js';

export interface AnonAuthInstance {
  /** Express router with all auth endpoints (passkey) */
  router: Router;
  
  /** OAuth router for OAuth providers */
  oauthRouter?: Router;
  
  /** Middleware that attaches user to request if authenticated */
  middleware: RequestHandler;
  
  /** Middleware that requires authentication (401 if not) */
  requireAuth: RequestHandler;
  
  /** Initialize database schema */
  initialize(): Promise<void>;
  
  /** Database adapter */
  db: DatabaseAdapter;
  
  /** Session manager */
  sessionManager: SessionManager;
  
  /** Passkey manager */
  passkeyManager: PasskeyManager;
  
  /** MPC account manager */
  mpcManager: MPCAccountManager;
  
  /** Wallet recovery manager (if enabled) */
  walletRecovery?: WalletRecoveryManager;
  
  /** IPFS recovery manager (if enabled) */
  ipfsRecovery?: IPFSRecoveryManager;
  
  /** OAuth manager (if enabled) */
  oauthManager?: OAuthManager;
}

/**
 * Create anonymous authentication instance
 */
export function createAnonAuth(config: AnonAuthConfig): AnonAuthInstance {
  // Note: config.passkey (prfSalt, requirePrf) is client-side only — accepted here for type
  // symmetry with AnonAuthProviderProps but never read on the server. See src/types/index.ts.

  // Create logger: use provided logger or silent no-op default
  const logger = config.logger ?? pino({ level: 'silent' });

  // Create database adapter
  let db: DatabaseAdapter;
  
  if (config.database.adapter) {
    db = config.database.adapter;
  } else if (config.database.type === 'postgres') {
    if (!config.database.connectionString) {
      throw new Error('PostgreSQL requires connectionString');
    }
    db = createPostgresAdapter({
      connectionString: config.database.connectionString,
    });
  } else if (config.database.type === 'custom') {
    if (!config.database.adapter) {
      throw new Error('Custom database type requires adapter');
    }
    db = config.database.adapter;
  } else {
    throw new Error(`Unsupported database type: ${config.database.type}`);
  }

  // Create session manager
  const sessionManager = createSessionManager(db, {
    secret: config.sessionSecret,
    durationMs: config.sessionDurationMs,
    logger,
  });

  // Create passkey manager
  const rpConfig = config.rp || {
    name: 'Anonymous Auth',
    id: 'localhost',
    origin: 'http://localhost:3000',
  };

  // Phase 12 RPID-02: throw at startup on misconfiguration (Pitfall 4 — fail fast,
  // never at request time). Runs AFTER rpConfig resolution so primary rpId/origin
  // are available for suffix-domain checks. Helper handles undefined/[] (returns []).
  const validatedRelatedOrigins = validateRelatedOrigins(
    config.rp?.relatedOrigins,
    rpConfig.id,
    rpConfig.origin,
  );

  const passkeyManager = createPasskeyManager(db, {
    rpName: rpConfig.name,
    rpId: rpConfig.id,
    origin: rpConfig.origin,
    logger,
    relatedOrigins: validatedRelatedOrigins,    // Phase 12 RPID-03 thread-through
  });

  // Create MPC manager
  const mpcManager = createMPCManager({
    networkId: config.nearNetwork,
    accountPrefix: config.mpc?.accountPrefix || 'anon',
    treasuryAccount: config.mpc?.treasuryAccount,
    treasuryPrivateKey: config.mpc?.treasuryPrivateKey,
    fundingAmount: config.mpc?.fundingAmount,
    derivationSalt: config.mpc?.derivationSalt ?? config.derivationSalt,
    logger,
  });

  // Create recovery managers
  let walletRecovery: WalletRecoveryManager | undefined;
  let ipfsRecovery: IPFSRecoveryManager | undefined;

  if (config.recovery?.wallet) {
    walletRecovery = createWalletRecoveryManager({
      nearNetwork: config.nearNetwork,
      logger,
    });
  }

  if (config.recovery?.ipfs) {
    ipfsRecovery = createIPFSRecoveryManager({
      ...config.recovery.ipfs,
      logger,
    });
  }

  // Create email service (optional)
  let emailService: EmailService | undefined;
  if (config.email) {
    emailService = createEmailService(config.email, logger);
  }

  // Create OAuth manager and router
  let oauthManager: OAuthManager | undefined;
  let oauthRouter: Router | undefined;

  if (config.oauth) {
    oauthManager = createOAuthManager(
      {
        google: config.oauth.google,
        github: config.oauth.github,
        twitter: config.oauth.twitter,
      },
      db
    );

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
      hooks: config.hooks,                        // Phase 11 HOOK-01
    });
  }

  // Create middleware
  const middleware = createAuthMiddleware(sessionManager, db, logger);
  const requireAuth = createRequireAuth(sessionManager, db, logger);

  // Create router (passkey auth)
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
    hooks: config.hooks,                          // Phase 11 HOOK-01
  });

  return {
    router,
    oauthRouter,
    middleware,
    requireAuth,
    
    async initialize() {
      await db.initialize();
    },
    
    db,
    sessionManager,
    passkeyManager,
    mpcManager,
    walletRecovery,
    ipfsRecovery,
    oauthManager,
  };
}

// Standalone scheduler and email exports
export { createCleanupScheduler, type CleanupScheduler } from './cleanup.js';
export { createEmailService, type EmailService, type EmailConfig } from './email.js';

// Re-export types and utilities
export type {
  AnonAuthConfig,
  AnonAuthHooks,        // Phase 11 HOOK-01 re-export
  RelatedOrigin,        // Phase 12 RPID-01 re-export
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
export type { SessionManager, SessionConfig } from './session.js';
export type { PasskeyManager, PasskeyConfig } from './passkey.js';
export { MPCAccountManager } from './mpc.js';
export type { MPCAccountManagerConfig, CreateAccountResult, MPCConfig, MPCAccount } from './mpc.js';
export type { WalletRecoveryManager } from './recovery/wallet.js';
export type { IPFSRecoveryManager, IPFSRecoveryConfig } from './recovery/ipfs.js';
export type { OAuthManager, OAuthProfile, OAuthTokens, OAuthProviderConfig } from './oauth/index.js';
export { generateCodename, isValidCodename } from './codename.js';
export { createPostgresAdapter, POSTGRES_SCHEMA } from './db/adapters/postgres.js';
export { createOAuthManager } from './oauth/index.js';
export { createOAuthRouter } from './oauth/router.js';

// Standalone WebAuthn utilities (framework-agnostic)
export {
  createRegistrationOptions,
  verifyRegistration,
  createAuthenticationOptions,
  verifyAuthentication,
  base64urlToUint8Array,
  uint8ArrayToBase64url,
  type CreateRegistrationOptionsInput,
  type CreateRegistrationOptionsResult,
  type VerifyRegistrationInput,
  type VerifyRegistrationResult,
  type CreateAuthenticationOptionsInput,
  type CreateAuthenticationOptionsResult,
  type StoredCredential,
  type VerifyAuthenticationInput,
  type VerifyAuthenticationResult,
} from './webauthn.js';
