/**
 * CSRF Protection Tests (SEC-03)
 *
 * Verifies Double Submit Cookie Pattern via csrf-csrf:
 * - POST without CSRF token = 403 when enabled
 * - POST with valid CSRF token = not 403 when enabled
 * - CSRF disabled by default — no behavior change
 * - OAuth callback exempt from CSRF
 * - GET /csrf-token returns token
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { createRouter } from '../server/router.js';
import { createOAuthRouter } from '../server/oauth/router.js';
import type { DatabaseAdapter } from '../types/index.js';
import type { SessionManager } from '../server/session.js';
import type { PasskeyManager } from '../server/passkey.js';
import type { MPCAccountManager } from '../server/mpc.js';
import type { OAuthConfig } from '../types/index.js';

// ---------------------------------------------------------------------------
// Minimal stubs
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

const TEST_CSRF_SECRET = 'test-csrf-secret-at-least-32-chars-long!!';

// ---------------------------------------------------------------------------
// Factory: main router with CSRF enabled
// ---------------------------------------------------------------------------

function createCsrfEnabledApp() {
  const app = express();
  const router = createRouter({
    db: mockDb,
    sessionManager: mockSessionManager,
    passkeyManager: mockPasskeyManager,
    mpcManager: mockMpcManager,
    csrf: { secret: TEST_CSRF_SECRET },
  });
  app.use(router);
  return app;
}

// Factory: main router with CSRF disabled (default)
function createCsrfDisabledApp() {
  const app = express();
  const router = createRouter({
    db: mockDb,
    sessionManager: mockSessionManager,
    passkeyManager: mockPasskeyManager,
    mpcManager: mockMpcManager,
    // no csrf config
  });
  app.use(router);
  return app;
}

// Factory: oauth router with CSRF enabled
function createOAuthAppWithCsrf() {
  const mockOAuthConfig: OAuthConfig = {
    callbackBaseUrl: 'http://localhost:3000/oauth',
    google: undefined,
    github: undefined,
    twitter: undefined,
  };

  const app = express();
  const oauthRouter = createOAuthRouter({
    db: mockDb,
    sessionManager: mockSessionManager,
    mpcManager: mockMpcManager,
    oauthConfig: mockOAuthConfig,
    csrf: { secret: TEST_CSRF_SECRET },
  });
  app.use(oauthRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Helper: get CSRF token + cookie from GET /csrf-token
// ---------------------------------------------------------------------------

async function getCsrfTokenAndCookie(app: ReturnType<typeof express>): Promise<{ token: string; cookie: string }> {
  const res = await request(app).get('/csrf-token');
  expect(res.status).toBe(200);
  const token = res.body.token as string;
  const setCookieHeader = res.headers['set-cookie'];
  // set-cookie can be string or array
  const cookie = Array.isArray(setCookieHeader)
    ? setCookieHeader.map((c: string) => c.split(';')[0]).join('; ')
    : setCookieHeader?.split(';')[0] ?? '';
  return { token, cookie };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CSRF Protection (SEC-03)', () => {
  describe('when csrf enabled', () => {
    it('state-changing POST without CSRF token returns 403', async () => {
      const app = createCsrfEnabledApp();
      const res = await request(app)
        .post('/login/start')
        .send({ codename: 'ALPHA' });
      expect(res.status).toBe(403);
    });

    it('state-changing POST with valid CSRF token succeeds (not 403)', async () => {
      const app = createCsrfEnabledApp();
      const { token, cookie } = await getCsrfTokenAndCookie(app);

      const res = await request(app)
        .post('/login/start')
        .set('Cookie', cookie)
        .set('x-csrf-token', token)
        .send({ codename: 'ALPHA' });

      expect(res.status).not.toBe(403);
    });

    it('GET /csrf-token returns a token object', async () => {
      const app = createCsrfEnabledApp();
      const res = await request(app).get('/csrf-token');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(typeof res.body.token).toBe('string');
      expect(res.body.token.length).toBeGreaterThan(0);
    });

    it('GET requests are not CSRF-protected (GET /session passes without token)', async () => {
      const app = createCsrfEnabledApp();
      const res = await request(app).get('/session');
      // Should return 401 (no session) not 403 (CSRF reject)
      expect(res.status).not.toBe(403);
    });
  });

  describe('when csrf disabled (default)', () => {
    it('no behavior change — POST requests succeed without CSRF token (no 403)', async () => {
      const app = createCsrfDisabledApp();
      const res = await request(app)
        .post('/login/start')
        .send({ codename: 'ALPHA' });
      // Should not be 403 — CSRF is disabled
      expect(res.status).not.toBe(403);
    });
  });

  describe('OAuth exemption', () => {
    it('OAuth callback route is exempt from CSRF even when enabled', async () => {
      const app = createOAuthAppWithCsrf();

      // POST to /:provider/callback WITHOUT CSRF token — should not get 403
      // (will fail for business logic reasons like invalid state, but not CSRF 403)
      const res = await request(app)
        .post('/google/callback')
        .send({ code: 'test-code', state: 'test-state' });

      expect(res.status).not.toBe(403);
    });
  });
});
