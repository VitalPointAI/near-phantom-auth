/**
 * Express Router
 *
 * API routes for registration, authentication, and recovery.
 */

import { Router, json } from 'express';
import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { doubleCsrf } from 'csrf-csrf';
import cookieParser from 'cookie-parser';
import type { SessionManager } from './session.js';
import type { PasskeyManager } from './passkey.js';
import type { MPCAccountManager } from './mpc.js';
import type { WalletRecoveryManager } from './recovery/wallet.js';
import type { IPFSRecoveryManager } from './recovery/ipfs.js';
import type { DatabaseAdapter, CodenameConfig, RateLimitConfig, CsrfConfig, AnonAuthHooks } from '../types/index.js';
import pino from 'pino';
import type { Logger } from 'pino';
import { generateCodename, isValidCodename } from './codename.js';
import { deriveBackupEligibility } from './backup.js';
import { wrapAnalytics } from './analytics.js';
import { validateBody } from './validation/validateBody.js';
import {
  registerStartBodySchema,
  registerFinishBodySchema,
  loginStartBodySchema,
  loginFinishBodySchema,
  logoutBodySchema,
  walletLinkBodySchema,
  walletVerifyBodySchema,
  walletStartBodySchema,
  walletFinishBodySchema,
  ipfsSetupBodySchema,
  ipfsRecoverBodySchema,
} from './validation/schemas.js';

export interface RouterConfig {
  db: DatabaseAdapter;
  sessionManager: SessionManager;
  passkeyManager: PasskeyManager;
  mpcManager: MPCAccountManager;
  walletRecovery?: WalletRecoveryManager;
  ipfsRecovery?: IPFSRecoveryManager;
  codename?: CodenameConfig;
  /** Optional pino logger instance. If omitted, logging is disabled (no output). */
  logger?: Logger;
  /** Optional rate limiting config */
  rateLimiting?: RateLimitConfig;
  /** Optional CSRF config (Double Submit Cookie) */
  csrf?: CsrfConfig;
  /** Phase 11 scaffolding — accepted and stored; call sites wired in Phases 13–15. */
  hooks?: AnonAuthHooks;
  /** Phase 13 ANALYTICS-01. Primary RP ID, used in every emitted event's
   *  `rpId` field. Captured once at router construction, NEVER per-request
   *  (Pitfall 4 — `@simplewebauthn/server` does not surface the matched
   *  rpId in multi-RP_ID flows; primary is the only safe source). */
  rpId?: string;
  /** Phase 13 ANALYTICS-04. When true, lifecycle emit calls await the
   *  consumer's `onAuthEvent` hook before responding. Default false. */
  awaitAnalytics?: boolean;
}

export function createRouter(config: RouterConfig): Router {
  const log = (config.logger ?? pino({ level: 'silent' })).child({ module: 'router' });
  const router = Router();
  const {
    db,
    sessionManager,
    passkeyManager,
    mpcManager,
    walletRecovery,
    ipfsRecovery,
  } = config;

  // Phase 13 ANALYTICS-01/04: capture rpId + emit closure ONCE at factory
  // construction (Pitfall 2 — never per-request). `emit` is a no-op when
  // `config.hooks?.onAuthEvent` is undefined (matches v0.6.1 behavior).
  const rpId = config.rpId ?? 'localhost';
  const emit = wrapAnalytics(config.hooks?.onAuthEvent, {
    logger: config.logger,
    await: config.awaitAnalytics === true,
  });

  // Create rate limiter instances
  const authRateConfig = config.rateLimiting?.auth ?? {};
  const recoveryRateConfig = config.rateLimiting?.recovery ?? {};

  const authLimiter = rateLimit({
    windowMs: authRateConfig.windowMs ?? 15 * 60 * 1000,
    limit: authRateConfig.limit ?? 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      log.warn({ limit: options.limit }, 'auth rate limit exceeded');
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
    },
  });

  const recoveryLimiter = rateLimit({
    windowMs: recoveryRateConfig.windowMs ?? 60 * 60 * 1000,
    limit: recoveryRateConfig.limit ?? 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      log.warn({ limit: options.limit }, 'recovery rate limit exceeded');
      res.status(429).json({ error: 'Too many recovery attempts. Please try again later.' });
    },
  });

  // CSRF protection (opt-in via config.csrf)
  if (config.csrf) {
    const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
      getSecret: () => config.csrf!.secret,
      getSessionIdentifier: (req) => req.ip ?? '',
      cookieName: '__Host-csrf',
      cookieOptions: {
        httpOnly: true,
        sameSite: 'strict',
        secure: true,
        path: '/',
      },
      ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
      getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'] as string,
    });

    router.use(cookieParser());
    router.use(doubleCsrfProtection);

    // CSRF token endpoint (GET — exempt via ignoredMethods)
    router.get('/csrf-token', (req: Request, res: Response) => {
      res.json({ token: generateCsrfToken(req, res) });
    });

    log.info('CSRF protection enabled');
  }

  // Parse JSON bodies
  router.use(json());

  // ============================================
  // Registration
  // ============================================

  /**
   * POST /register/start
   * Start passkey registration
   */
  router.post('/register/start', authLimiter, async (req: Request, res: Response) => {
    try {
      const body = validateBody(registerStartBodySchema, req, res);
      if (!body) return;

      await emit({ type: 'register.start', rpId, timestamp: Date.now() });

      // Generate temporary user ID for registration
      const tempUserId = crypto.randomUUID();

      // Generate codename
      const style = config.codename?.style || 'nato-phonetic';
      let codename: string;

      if (config.codename?.generator) {
        codename = config.codename.generator(tempUserId);
      } else {
        codename = generateCodename(style);
      }

      // Ensure codename is unique
      let attempts = 0;
      while (await db.getUserByCodename(codename) && attempts < 10) {
        codename = generateCodename(style);
        attempts++;
      }

      if (attempts >= 10) {
        return res.status(500).json({ error: 'Failed to generate unique codename' });
      }

      const { challengeId, options } = await passkeyManager.startRegistration(
        tempUserId,
        codename
      );

      res.json({
        challengeId,
        options,
        codename,
        tempUserId,
      });
    } catch (error) {
      log.error({ err: error }, 'Registration start error');
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  /**
   * POST /register/finish
   * Complete passkey registration
   */
  router.post('/register/finish', authLimiter, async (req: Request, res: Response) => {
    try {
      const body = validateBody(registerFinishBodySchema, req, res);
      if (!body) return;

      const { challengeId, response, tempUserId, codename } = body;

      if (!isValidCodename(codename)) {
        await emit({ type: 'register.finish.failure', rpId, timestamp: Date.now(), reason: 'invalid-codename' });
        return res.status(400).json({ error: 'Invalid codename format' });
      }

      // Verify passkey registration
      const { verified, passkeyData } = await passkeyManager.finishRegistration(
        challengeId,
        response
      );

      if (!verified || !passkeyData) {
        await emit({ type: 'register.finish.failure', rpId, timestamp: Date.now(), reason: 'passkey-verification-failed' });
        return res.status(400).json({ error: 'Passkey verification failed' });
      }

      // Create NEAR account via MPC
      const mpcAccount = await mpcManager.createAccount(tempUserId);

      // INFRA-02: Wrap DB operations in a transaction when available.
      // If db.transaction is not implemented, fall back to sequential calls
      // (existing behavior — no atomicity guarantee without transaction support).
      const doRegistration = async (adapter: DatabaseAdapter) => {
        const user = await adapter.createUser({
          codename,
          nearAccountId: mpcAccount.nearAccountId,
          mpcPublicKey: mpcAccount.mpcPublicKey,
          derivationPath: mpcAccount.derivationPath,
        });

        await adapter.createPasskey({
          credentialId: passkeyData.credentialId,
          userId: user.id,
          publicKey: passkeyData.publicKey,
          counter: passkeyData.counter,
          deviceType: passkeyData.deviceType,
          backedUp: passkeyData.backedUp,
          transports: passkeyData.transports,
        });

        const session = await sessionManager.createSession(user.id, res, {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });

        return { user, session };
      };

      const { user } = db.transaction
        ? await db.transaction(doRegistration)
        : await doRegistration(db);

      await emit({
        type: 'register.finish.success',
        rpId,
        timestamp: Date.now(),
        backupEligible: deriveBackupEligibility(passkeyData.deviceType),
      });

      res.json({
        success: true,
        codename: user.codename,
        nearAccountId: user.nearAccountId,
        passkey: {
          backedUp: passkeyData.backedUp,
          backupEligible: deriveBackupEligibility(passkeyData.deviceType),
        },
      });
    } catch (error) {
      log.error({ err: error }, 'Registration finish error');
      await emit({ type: 'register.finish.failure', rpId, timestamp: Date.now(), reason: 'internal-error' });
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // ============================================
  // Authentication
  // ============================================

  /**
   * POST /login/start
   * Start passkey authentication
   */
  router.post('/login/start', authLimiter, async (req: Request, res: Response) => {
    try {
      const body = validateBody(loginStartBodySchema, req, res);
      if (!body) return;

      const { codename } = body;

      await emit({
        type: 'login.start',
        rpId,
        timestamp: Date.now(),
        codenameProvided: !!codename,
      });

      let userId: string | undefined;

      if (codename) {
        const user = await db.getUserByCodename(codename);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        userId = user.id;
      }

      const { challengeId, options } = await passkeyManager.startAuthentication(userId);

      res.json({ challengeId, options });
    } catch (error) {
      log.error({ err: error }, 'Login start error');
      res.status(500).json({ error: 'Login failed' });
    }
  });

  /**
   * POST /login/finish
   * Complete passkey authentication
   */
  router.post('/login/finish', authLimiter, async (req: Request, res: Response) => {
    try {
      const body = validateBody(loginFinishBodySchema, req, res);
      if (!body) return;

      const { challengeId, response } = body;

      const { verified, userId, passkeyData } = await passkeyManager.finishAuthentication(
        challengeId,
        response
      );

      if (!verified || !userId) {
        await emit({ type: 'login.finish.failure', rpId, timestamp: Date.now(), reason: 'auth-failed' });
        return res.status(401).json({ error: 'Authentication failed' });
      }

      const user = await db.getUserById(userId);

      if (!user) {
        await emit({ type: 'login.finish.failure', rpId, timestamp: Date.now(), reason: 'user-not-found' });
        return res.status(404).json({ error: 'User not found' });
      }

      // Create session
      await sessionManager.createSession(user.id, res, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      // Per D-LOGIN-NEARACCOUNTID: keep existing { success, codename } shape — do NOT add nearAccountId.
      // Per Pattern S4: append the new passkey key at end with spread guard so a degraded
      // path with no passkeyData still returns a valid { success, codename } response.
      if (passkeyData) {
        await emit({
          type: 'login.finish.success',
          rpId,
          timestamp: Date.now(),
          backupEligible: deriveBackupEligibility(passkeyData.deviceType),
        });
      }

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
    } catch (error) {
      log.error({ err: error }, 'Login finish error');
      await emit({ type: 'login.finish.failure', rpId, timestamp: Date.now(), reason: 'internal-error' });
      res.status(500).json({ error: 'Authentication failed' });
    }
  });

  /**
   * POST /logout
   * End session
   */
  router.post('/logout', authLimiter, async (req: Request, res: Response) => {
    try {
      const body = validateBody(logoutBodySchema, req, res);
      if (!body) return;

      await sessionManager.destroySession(req, res);
      res.json({ success: true });
    } catch (error) {
      log.error({ err: error }, 'Logout error');
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  /**
   * GET /session
   * Get current session
   */
  router.get('/session', async (req: Request, res: Response) => {
    try {
      const session = await sessionManager.getSession(req);

      if (!session) {
        return res.status(401).json({ authenticated: false });
      }

      const user = await db.getUserById(session.userId);

      if (!user) {
        return res.status(401).json({ authenticated: false });
      }

      res.json({
        authenticated: true,
        codename: user.codename,
        nearAccountId: user.nearAccountId,
        expiresAt: session.expiresAt,
      });
    } catch (error) {
      log.error({ err: error }, 'Session check error');
      res.status(500).json({ error: 'Session check failed' });
    }
  });

  // ============================================
  // Wallet Recovery
  // ============================================

  if (walletRecovery) {
    /**
     * POST /recovery/wallet/link
     * Link a NEAR wallet for recovery
     */
    router.post('/recovery/wallet/link', recoveryLimiter, async (req: Request, res: Response) => {
      try {
        const body = validateBody(walletLinkBodySchema, req, res);
        if (!body) return;

        const session = await sessionManager.getSession(req);

        if (!session) {
          return res.status(401).json({ error: 'Authentication required' });
        }

        const { challenge: walletChallenge, expiresAt } = walletRecovery.generateLinkChallenge();

        // Store challenge for verification
        await db.storeChallenge({
          id: crypto.randomUUID(),
          challenge: walletChallenge,
          type: 'recovery',
          userId: session.userId,
          expiresAt,
          metadata: { action: 'wallet-link' },
        });

        res.json({
          challenge: walletChallenge,
          expiresAt: expiresAt.toISOString(),
        });
      } catch (error) {
        log.error({ err: error }, 'Wallet link error');
        res.status(500).json({ error: 'Failed to initiate wallet link' });
      }
    });

    /**
     * POST /recovery/wallet/verify
     * Verify wallet signature and complete linking
     */
    router.post('/recovery/wallet/verify', recoveryLimiter, async (req: Request, res: Response) => {
      try {
        const session = await sessionManager.getSession(req);

        if (!session) {
          return res.status(401).json({ error: 'Authentication required' });
        }

        const body = validateBody(walletVerifyBodySchema, req, res);
        if (!body) return;

        const { signature, challenge, walletAccountId } = body;

        const { verified } = walletRecovery.verifyLinkSignature(
          signature,
          challenge
        );

        if (!verified) {
          return res.status(401).json({ error: 'Invalid signature' });
        }

        const user = await db.getUserById(session.userId);

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // BUG-04: Add wallet as access key on-chain using the wallet's public key
        // (not the account name — the public key is what goes on-chain as an access key)
        await mpcManager.addRecoveryWallet(user.nearAccountId, signature.publicKey);

        // BUG-04: Store the wallet's public key for verifyRecoveryWallet chain
        // (previously stored 'enabled' which broke the verification chain)
        await db.storeRecoveryData({
          userId: user.id,
          type: 'wallet',
          reference: signature.publicKey,
          createdAt: new Date(),
        });

        await emit({ type: 'recovery.wallet.link.success', rpId, timestamp: Date.now() });

        res.json({
          success: true,
          message: 'Wallet linked for recovery. The link is stored on-chain, not in our database.',
        });
      } catch (error) {
        log.error({ err: error }, 'Wallet verify error');
        res.status(500).json({ error: 'Failed to verify wallet' });
      }
    });

    /**
     * POST /recovery/wallet/start
     * Start wallet-based recovery
     */
    router.post('/recovery/wallet/start', recoveryLimiter, async (req: Request, res: Response) => {
      try {
        const body = validateBody(walletStartBodySchema, req, res);
        if (!body) return;

        const { challenge, expiresAt } = walletRecovery.generateRecoveryChallenge();

        res.json({
          challenge,
          expiresAt: expiresAt.toISOString(),
        });
      } catch (error) {
        log.error({ err: error }, 'Wallet recovery start error');
        res.status(500).json({ error: 'Failed to start recovery' });
      }
    });

    /**
     * POST /recovery/wallet/finish
     * Complete wallet-based recovery
     */
    router.post('/recovery/wallet/finish', recoveryLimiter, async (req: Request, res: Response) => {
      try {
        const body = validateBody(walletFinishBodySchema, req, res);
        if (!body) return;

        const { signature, challenge, nearAccountId } = body;

        const { verified } = await walletRecovery.verifyRecoverySignature(
          signature,
          challenge,
          nearAccountId
        );

        if (!verified) {
          return res.status(401).json({ error: 'Recovery verification failed' });
        }

        // Find user by NEAR account
        const user = await db.getUserByNearAccount(nearAccountId);

        if (!user) {
          return res.status(404).json({ error: 'Account not found' });
        }

        // Create session for recovered user
        await sessionManager.createSession(user.id, res, {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });

        await emit({ type: 'recovery.wallet.recover.success', rpId, timestamp: Date.now() });

        res.json({
          success: true,
          codename: user.codename,
          message: 'Recovery successful. You can now register a new passkey.',
        });
      } catch (error) {
        log.error({ err: error }, 'Wallet recovery finish error');
        res.status(500).json({ error: 'Recovery failed' });
      }
    });
  }

  // ============================================
  // IPFS Recovery
  // ============================================

  if (ipfsRecovery) {
    /**
     * POST /recovery/ipfs/setup
     * Create encrypted backup on IPFS
     */
    router.post('/recovery/ipfs/setup', recoveryLimiter, async (req: Request, res: Response) => {
      try {
        const session = await sessionManager.getSession(req);

        if (!session) {
          return res.status(401).json({ error: 'Authentication required' });
        }

        const body = validateBody(ipfsSetupBodySchema, req, res);
        if (!body) return;

        const { password } = body;

        // Validate password
        const validation = ipfsRecovery.validatePassword(password);
        if (!validation.valid) {
          return res.status(400).json({
            error: 'Password too weak',
            details: validation.errors,
          });
        }

        const user = await db.getUserById(session.userId);

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Create and pin backup
        const { cid } = await ipfsRecovery.createRecoveryBackup(
          {
            userId: user.id,
            nearAccountId: user.nearAccountId,
            derivationPath: user.derivationPath,
            createdAt: Date.now(),
          },
          password
        );

        // Store CID reference
        await db.storeRecoveryData({
          userId: user.id,
          type: 'ipfs',
          reference: cid,
          createdAt: new Date(),
        });

        await emit({ type: 'recovery.ipfs.setup.success', rpId, timestamp: Date.now() });

        res.json({
          success: true,
          cid,
          message: 'Backup created. Save this CID with your password - you need both to recover.',
        });
      } catch (error) {
        log.error({ err: error }, 'IPFS setup error');
        res.status(500).json({ error: 'Failed to create backup' });
      }
    });

    /**
     * POST /recovery/ipfs/recover
     * Recover using IPFS backup
     */
    router.post('/recovery/ipfs/recover', recoveryLimiter, async (req: Request, res: Response) => {
      try {
        const body = validateBody(ipfsRecoverBodySchema, req, res);
        if (!body) return;

        const { cid, password } = body;

        // Decrypt backup
        let payload;
        try {
          payload = await ipfsRecovery.recoverFromBackup(cid, password);
        } catch {
          return res.status(401).json({ error: 'Invalid password or CID' });
        }

        // Find user
        const user = await db.getUserById(payload.userId);

        if (!user) {
          return res.status(404).json({ error: 'Account not found' });
        }

        // Create session
        await sessionManager.createSession(user.id, res, {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });

        await emit({ type: 'recovery.ipfs.recover.success', rpId, timestamp: Date.now() });

        res.json({
          success: true,
          codename: user.codename,
          message: 'Recovery successful. You can now register a new passkey.',
        });
      } catch (error) {
        log.error({ err: error }, 'IPFS recovery error');
        res.status(500).json({ error: 'Recovery failed' });
      }
    });
  }

  // ============================================
  // Account Management
  // ============================================

  /**
   * POST /account/reregister-passkey
   * Start passkey re-registration for post-recovery users.
   * STUB-02: Authenticated users can register a new passkey after wallet/IPFS recovery.
   */
  router.post('/account/reregister-passkey', authLimiter, async (req: Request, res: Response) => {
    try {
      const session = await sessionManager.getSession(req);
      if (!session) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const user = await db.getUserById(session.userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const { challengeId, options } = await passkeyManager.startRegistration(
        user.id,
        user.codename
      );

      res.json({ challengeId, options });
    } catch (error) {
      log.error({ err: error }, 'Passkey re-registration error');
      res.status(500).json({ error: 'Failed to start re-registration' });
    }
  });

  /**
   * DELETE /account
   * Delete user account and all associated data.
   * STUB-03: Explicit deletion order — sessions first (no FK cascade), then recovery
   * (no FK cascade), then user (passkeys cascade via ON DELETE CASCADE).
   * Returns 501 if adapter does not implement deleteUser.
   */
  router.delete('/account', authLimiter, async (req: Request, res: Response) => {
    try {
      const session = await sessionManager.getSession(req);
      if (!session) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!db.deleteUser) {
        return res.status(501).json({ error: 'Account deletion not supported by database adapter' });
      }

      const userId = session.userId;

      // Destroy current session first (invalidates auth cookie immediately),
      // then delete all remaining sessions for the user (no FK cascade on anon_sessions).
      await sessionManager.destroySession(req, res);
      await db.deleteUserSessions(userId);

      // Delete recovery data (no FK cascade on anon_recovery).
      if (db.deleteRecoveryData) {
        await db.deleteRecoveryData(userId);
      }

      // Delete user — passkeys cascade via FK ON DELETE CASCADE.
      await db.deleteUser(userId);

      await emit({ type: 'account.delete', rpId, timestamp: Date.now() });

      res.json({ success: true });
    } catch (error) {
      log.error({ err: error }, 'Account deletion error');
      res.status(500).json({ error: 'Account deletion failed' });
    }
  });

  return router;
}
