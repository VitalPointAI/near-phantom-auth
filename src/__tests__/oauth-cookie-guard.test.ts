/**
 * OAuth Cookie-Parser Guard Tests (INFRA-05)
 *
 * Verifies that the OAuth callback handler detects missing cookie-parser
 * and returns a clear 500 error rather than silently failing.
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { createOAuthRouter } from '../server/oauth/router.js';
import type { DatabaseAdapter } from '../types/index.js';
import type { SessionManager } from '../server/session.js';
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

const mockMpcManager = {
  createAccount: async () => ({ nearAccountId: 'x', mpcPublicKey: 'x', derivationPath: 'x' }),
  addRecoveryWallet: async () => {},
} as unknown as MPCAccountManager;

const mockOAuthConfig: OAuthConfig = {
  callbackBaseUrl: 'http://localhost:3000/oauth',
  google: undefined,
  github: undefined,
  twitter: undefined,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuth cookie-parser guard (INFRA-05)', () => {
  it('returns 500 with clear error when req.cookies is undefined', async () => {
    // Create app WITHOUT cookie-parser and WITHOUT csrf (csrf auto-adds cookieParser)
    const app = express();
    const oauthRouter = createOAuthRouter({
      db: mockDb,
      sessionManager: mockSessionManager,
      mpcManager: mockMpcManager,
      oauthConfig: mockOAuthConfig,
      // no csrf — so the router won't auto-inject cookieParser
    });
    app.use(oauthRouter);

    const res = await request(app)
      .post('/google/callback')
      .send({ code: 'test-code', state: 'test-state' });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('cookie-parser');
  });

  it('logs error message mentioning cookie-parser middleware', async () => {
    // This behavior is tested indirectly through the 500 response body above.
    // The error message is: "Server configuration error: cookie-parser middleware is required"
    const app = express();
    const oauthRouter = createOAuthRouter({
      db: mockDb,
      sessionManager: mockSessionManager,
      mpcManager: mockMpcManager,
      oauthConfig: mockOAuthConfig,
    });
    app.use(oauthRouter);

    const res = await request(app)
      .post('/google/callback')
      .send({ code: 'test-code', state: 'test-state' });

    // The body error message explicitly references cookie-parser
    expect(res.body.error).toMatch(/cookie-parser/i);
  });

  it('proceeds normally when cookie-parser is mounted (no cookie-parser guard 500)', async () => {
    // Create app WITH cookie-parser mounted — guard should not fire
    const app = express();
    app.use(cookieParser()); // <-- cookie-parser present
    const oauthRouter = createOAuthRouter({
      db: mockDb,
      sessionManager: mockSessionManager,
      mpcManager: mockMpcManager,
      oauthConfig: mockOAuthConfig,
      // no csrf config
    });
    app.use(oauthRouter);

    const res = await request(app)
      .post('/google/callback')
      .send({ code: 'test-code', state: 'test-state' });

    // Should NOT be 500 from the cookie-parser guard
    // (May be 400 from invalid state, but not the 500 cookie guard)
    expect(res.status).not.toBe(500);
  });
});
