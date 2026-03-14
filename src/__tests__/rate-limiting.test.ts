/**
 * Rate Limiting Tests (SEC-02)
 *
 * Verifies tiered rate limiting: authLimiter (20/15min default) and
 * recoveryLimiter (5/1hr default) applied to appropriate routes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRouter } from '../server/router.js';
import type { RateLimitConfig } from '../types/index.js';
import type { DatabaseAdapter } from '../types/index.js';
import type { SessionManager } from '../server/session.js';
import type { PasskeyManager } from '../server/passkey.js';
import type { MPCAccountManager } from '../server/mpc.js';

// ---------------------------------------------------------------------------
// Minimal stubs — rate limiter fires before route handlers, so implementations
// never need to succeed. Stubs just satisfy TypeScript shape requirements.
// ---------------------------------------------------------------------------

const mockDb = {} as unknown as DatabaseAdapter;

const mockSessionManager = {
  createSession: async () => {},
  getSession: async () => null,
  destroySession: async () => {},
  extendSession: async () => {},
} as unknown as SessionManager;

const mockPasskeyManager = {
  startRegistration: async () => ({ challengeId: 'x', options: {} }),
  finishRegistration: async () => ({ verified: false }),
  startAuthentication: async () => ({ challengeId: 'x', options: {} }),
  finishAuthentication: async () => ({ verified: false }),
} as unknown as PasskeyManager;

const mockMpcManager = {
  createAccount: async () => ({ nearAccountId: 'x', mpcPublicKey: 'x', derivationPath: 'x' }),
  addRecoveryWallet: async () => {},
} as unknown as MPCAccountManager;

// ---------------------------------------------------------------------------
// Factory: create Express app with configurable rate limits
// ---------------------------------------------------------------------------

function createTestApp(rateLimitConfig?: RateLimitConfig) {
  const app = express();
  const router = createRouter({
    db: mockDb,
    sessionManager: mockSessionManager,
    passkeyManager: mockPasskeyManager,
    mpcManager: mockMpcManager,
    rateLimiting: rateLimitConfig,
  });
  app.use(router);
  return app;
}

// ---------------------------------------------------------------------------
// Helper: send N requests to the same route, return array of status codes
// ---------------------------------------------------------------------------

async function sendN(app: ReturnType<typeof express>, method: 'get' | 'post', path: string, n: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) {
    const req = method === 'get'
      ? request(app).get(path)
      : request(app).post(path).send({});
    const res = await req;
    statuses.push(res.status);
  }
  return statuses;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Rate Limiting (SEC-02)', () => {
  describe('auth limiter', () => {
    it('returns 429 after exceeding auth limit from same IP', async () => {
      const limit = 3;
      const app = createTestApp({ auth: { limit, windowMs: 60_000 } });

      const statuses = await sendN(app, 'post', '/login/start', limit + 1);

      // First `limit` requests should not be 429
      const underLimit = statuses.slice(0, limit);
      expect(underLimit.every(s => s !== 429)).toBe(true);

      // The (limit+1)th request should be 429
      expect(statuses[limit]).toBe(429);
    });

    it('uses configurable windowMs and limit from RateLimitConfig.auth', async () => {
      const limit = 2;
      const app = createTestApp({ auth: { limit, windowMs: 60_000 } });

      const statuses = await sendN(app, 'post', '/register/start', limit + 1);

      expect(statuses[limit]).toBe(429);
      expect(statuses.slice(0, limit).every(s => s !== 429)).toBe(true);
    });

    it('applies to /register/start, /register/finish, /login/start, /login/finish, /logout', async () => {
      const limit = 2;
      // Each route gets its own app (separate limiter instance per app)
      const routes: [string, 'get' | 'post'][] = [
        ['/register/start', 'post'],
        ['/register/finish', 'post'],
        ['/login/start', 'post'],
        ['/login/finish', 'post'],
        ['/logout', 'post'],
      ];

      for (const [path, method] of routes) {
        const app = createTestApp({ auth: { limit, windowMs: 60_000 } });
        const statuses = await sendN(app, method, path, limit + 1);
        expect(statuses[limit]).toBe(429);
      }
    });
  });

  describe('recovery limiter', () => {
    it('returns 429 after exceeding recovery limit from same IP', async () => {
      const limit = 2;
      const app = createTestApp({ recovery: { limit, windowMs: 60_000 } });

      // Note: walletRecovery and ipfsRecovery are undefined, so those routes
      // don't exist. Use the mock walletRecovery stub to register the routes.
      // Instead, we test via the route structure — the limiter is applied but
      // the routes aren't registered (walletRecovery not passed).
      // We need to pass walletRecovery and ipfsRecovery stubs.
      const mockWalletRecovery = {
        generateLinkChallenge: () => ({ challenge: 'x', expiresAt: new Date() }),
        verifyLinkSignature: () => ({ verified: false }),
        generateRecoveryChallenge: () => ({ challenge: 'x', expiresAt: new Date() }),
        verifyRecoverySignature: async () => ({ verified: false }),
      } as any;

      const appWithRecovery = express();
      const router = createRouter({
        db: mockDb,
        sessionManager: mockSessionManager,
        passkeyManager: mockPasskeyManager,
        mpcManager: mockMpcManager,
        walletRecovery: mockWalletRecovery,
        rateLimiting: { recovery: { limit, windowMs: 60_000 } },
      });
      appWithRecovery.use(router);

      const statuses = await sendN(appWithRecovery, 'post', '/recovery/wallet/start', limit + 1);

      expect(statuses[limit]).toBe(429);
      expect(statuses.slice(0, limit).every(s => s !== 429)).toBe(true);
    });

    it('recovery limiter fires before auth limiter at equal request rate', async () => {
      // Auth limit=5, recovery limit=2. After 3 requests, recovery 429s but auth does not.
      const mockWalletRecovery = {
        generateLinkChallenge: () => ({ challenge: 'x', expiresAt: new Date() }),
        verifyLinkSignature: () => ({ verified: false }),
        generateRecoveryChallenge: () => ({ challenge: 'x', expiresAt: new Date() }),
        verifyRecoverySignature: async () => ({ verified: false }),
      } as any;

      const app = express();
      const router = createRouter({
        db: mockDb,
        sessionManager: mockSessionManager,
        passkeyManager: mockPasskeyManager,
        mpcManager: mockMpcManager,
        walletRecovery: mockWalletRecovery,
        rateLimiting: {
          auth: { limit: 5, windowMs: 60_000 },
          recovery: { limit: 2, windowMs: 60_000 },
        },
      });
      app.use(router);

      // 3 requests to recovery route — 3rd should be 429 (recovery limit=2)
      const recoveryStatuses = await sendN(app, 'post', '/recovery/wallet/start', 3);
      expect(recoveryStatuses[2]).toBe(429);

      // 3 requests to auth route — none should be 429 (auth limit=5)
      const authStatuses = await sendN(app, 'post', '/login/start', 3);
      expect(authStatuses.every(s => s !== 429)).toBe(true);
    });

    it('uses configurable windowMs and limit from RateLimitConfig.recovery', async () => {
      const limit = 2;
      const mockWalletRecovery = {
        generateRecoveryChallenge: () => ({ challenge: 'x', expiresAt: new Date() }),
        verifyRecoverySignature: async () => ({ verified: false }),
      } as any;

      const app = express();
      const router = createRouter({
        db: mockDb,
        sessionManager: mockSessionManager,
        passkeyManager: mockPasskeyManager,
        mpcManager: mockMpcManager,
        walletRecovery: mockWalletRecovery,
        rateLimiting: { recovery: { limit, windowMs: 60_000 } },
      });
      app.use(router);

      const statuses = await sendN(app, 'post', '/recovery/wallet/start', limit + 1);

      expect(statuses[limit]).toBe(429);
      expect(statuses.slice(0, limit).every(s => s !== 429)).toBe(true);
    });

    it('applies to all /recovery/* routes', async () => {
      const limit = 2;
      const mockWalletRecovery = {
        generateLinkChallenge: () => ({ challenge: 'x', expiresAt: new Date() }),
        verifyLinkSignature: () => ({ verified: false }),
        generateRecoveryChallenge: () => ({ challenge: 'x', expiresAt: new Date() }),
        verifyRecoverySignature: async () => ({ verified: false }),
      } as any;

      const recoveryRoutes = [
        '/recovery/wallet/link',
        '/recovery/wallet/verify',
        '/recovery/wallet/start',
        '/recovery/wallet/finish',
      ];

      for (const path of recoveryRoutes) {
        const app = express();
        const router = createRouter({
          db: mockDb,
          sessionManager: mockSessionManager,
          passkeyManager: mockPasskeyManager,
          mpcManager: mockMpcManager,
          walletRecovery: mockWalletRecovery,
          rateLimiting: { recovery: { limit, windowMs: 60_000 } },
        });
        app.use(router);

        const statuses = await sendN(app, 'post', path, limit + 1);
        expect(statuses[limit]).toBe(429);
      }
    });
  });

  describe('defaults', () => {
    it('applies default rate limits when rateLimiting config is omitted', async () => {
      // Default auth limit is 20. Send 21 requests — 21st should be 429.
      const app = createTestApp(); // no rateLimiting config

      const statuses = await sendN(app, 'post', '/login/start', 21);

      // First 20 should not be 429
      expect(statuses.slice(0, 20).every(s => s !== 429)).toBe(true);
      // 21st should be 429
      expect(statuses[20]).toBe(429);
    });

    it('does not rate limit GET /session', async () => {
      // Use a very low auth limit to confirm /session is unaffected
      const limit = 2;
      const app = createTestApp({ auth: { limit, windowMs: 60_000 } });

      // Send more requests than the auth limit allows
      const statuses = await sendN(app, 'get', '/session', limit + 5);

      // None should be 429 — session is exempt from rate limiting
      expect(statuses.every(s => s !== 429)).toBe(true);
    });
  });
});
