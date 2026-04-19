import pino3 from 'pino';
import { scrypt, randomBytes, createHash, randomUUID, createHmac, timingSafeEqual, createDecipheriv, createCipheriv } from 'crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import bs582 from 'bs58';
import BN from 'bn.js';
import { actionCreators, createTransaction } from '@near-js/transactions';
import { KeyPairSigner } from '@near-js/signers';
import { KeyPair, PublicKey } from '@near-js/crypto';
import nacl from 'tweetnacl';
import { promisify } from 'util';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { Router, json } from 'express';
import { rateLimit } from 'express-rate-limit';
import { doubleCsrf } from 'csrf-csrf';
import cookieParser from 'cookie-parser';
import { z } from 'zod';

// src/server/index.ts

// src/server/db/adapters/postgres.ts
var POSTGRES_SCHEMA = `
-- Anonymous users (HUMINT sources - passkey only)
CREATE TABLE IF NOT EXISTS anon_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codename TEXT UNIQUE NOT NULL,
  near_account_id TEXT UNIQUE NOT NULL,
  mpc_public_key TEXT NOT NULL,
  derivation_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OAuth users (standard users - OAuth providers)
CREATE TABLE IF NOT EXISTS oauth_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  near_account_id TEXT UNIQUE NOT NULL,
  mpc_public_key TEXT NOT NULL,
  derivation_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OAuth provider connections
CREATE TABLE IF NOT EXISTS oauth_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES oauth_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_id)
);

-- Passkeys (WebAuthn credentials) - for anonymous users
CREATE TABLE IF NOT EXISTS anon_passkeys (
  credential_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES anon_users(id) ON DELETE CASCADE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type TEXT NOT NULL,
  backed_up BOOLEAN NOT NULL DEFAULT false,
  transports TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions (works for both user types)
CREATE TABLE IF NOT EXISTS anon_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_type TEXT NOT NULL DEFAULT 'anonymous',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT
);

-- WebAuthn challenges (temporary)
CREATE TABLE IF NOT EXISTS anon_challenges (
  id UUID PRIMARY KEY,
  challenge TEXT NOT NULL,
  type TEXT NOT NULL,
  user_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB
);

-- Recovery data references (works for both user types)
CREATE TABLE IF NOT EXISTS anon_recovery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_type TEXT NOT NULL DEFAULT 'anonymous',
  type TEXT NOT NULL,
  reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, type)
);

-- OAuth state (cross-instance durability for OAuth login flows)
CREATE TABLE IF NOT EXISTS oauth_state (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code_verifier TEXT,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_anon_sessions_user ON anon_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_anon_sessions_expires ON anon_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_anon_passkeys_user ON anon_passkeys(user_id);
CREATE INDEX IF NOT EXISTS idx_anon_challenges_expires ON anon_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_users_email ON oauth_users(email);
CREATE INDEX IF NOT EXISTS idx_oauth_providers_user ON oauth_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_providers_lookup ON oauth_providers(provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_oauth_state_expires ON oauth_state(expires_at);
`;
function mapOAuthUserRows(rows) {
  if (rows.length === 0 || !rows[0].id) return null;
  const first = rows[0];
  const providers = [];
  for (const row of rows) {
    if (row.provider) {
      providers.push({
        provider: row.provider,
        providerId: row.provider_id,
        email: row.p_email,
        name: row.p_name,
        avatarUrl: row.p_avatar_url,
        connectedAt: row.connected_at
      });
    }
  }
  return {
    id: first.id,
    type: "standard",
    email: first.email,
    name: first.name,
    avatarUrl: first.avatar_url,
    nearAccountId: first.near_account_id,
    mpcPublicKey: first.mpc_public_key,
    derivationPath: first.derivation_path,
    providers,
    createdAt: first.created_at,
    lastActiveAt: first.last_active_at
  };
}
function createPostgresAdapter(config) {
  let pool = null;
  async function getPool() {
    if (!pool) {
      const { Pool } = await import('pg');
      pool = new Pool({ connectionString: config.connectionString });
    }
    return pool;
  }
  function buildClientAdapter(client) {
    return {
      async initialize() {
        throw new Error("Not available in transaction context");
      },
      async createUser(input) {
        const result = await client.query(
          `INSERT INTO anon_users (codename, near_account_id, mpc_public_key, derivation_path)
           VALUES ($1, $2, $3, $4)
           RETURNING id, codename, near_account_id, mpc_public_key, derivation_path, created_at, last_active_at`,
          [input.codename, input.nearAccountId, input.mpcPublicKey, input.derivationPath]
        );
        const row = result.rows[0];
        return {
          id: row.id,
          type: "anonymous",
          codename: row.codename,
          nearAccountId: row.near_account_id,
          mpcPublicKey: row.mpc_public_key,
          derivationPath: row.derivation_path,
          createdAt: row.created_at,
          lastActiveAt: row.last_active_at
        };
      },
      async getUserById() {
        throw new Error("Not available in transaction context");
      },
      async getUserByCodename() {
        throw new Error("Not available in transaction context");
      },
      async getUserByNearAccount() {
        throw new Error("Not available in transaction context");
      },
      async createOAuthUser() {
        throw new Error("Not available in transaction context");
      },
      async getOAuthUserById() {
        throw new Error("Not available in transaction context");
      },
      async getOAuthUserByEmail() {
        throw new Error("Not available in transaction context");
      },
      async getOAuthUserByProvider() {
        throw new Error("Not available in transaction context");
      },
      async linkOAuthProvider() {
        throw new Error("Not available in transaction context");
      },
      async createPasskey(input) {
        await client.query(
          `INSERT INTO anon_passkeys (credential_id, user_id, public_key, counter, device_type, backed_up, transports)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            input.credentialId,
            input.userId,
            input.publicKey,
            input.counter,
            input.deviceType,
            input.backedUp,
            input.transports || null
          ]
        );
        return {
          ...input,
          createdAt: /* @__PURE__ */ new Date()
        };
      },
      async getPasskeyById() {
        throw new Error("Not available in transaction context");
      },
      async getPasskeysByUserId() {
        throw new Error("Not available in transaction context");
      },
      async updatePasskeyCounter() {
        throw new Error("Not available in transaction context");
      },
      async deletePasskey() {
        throw new Error("Not available in transaction context");
      },
      async createSession(input) {
        const result = await client.query(
          `INSERT INTO anon_sessions (id, user_id, expires_at, ip_address, user_agent)
           VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5)
           RETURNING id, user_id, created_at, expires_at, last_activity_at, ip_address, user_agent`,
          [input.id || null, input.userId, input.expiresAt, input.ipAddress || null, input.userAgent || null]
        );
        const row = result.rows[0];
        return {
          id: row.id,
          userId: row.user_id,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          lastActivityAt: row.last_activity_at,
          ipAddress: row.ip_address,
          userAgent: row.user_agent
        };
      },
      async getSession() {
        throw new Error("Not available in transaction context");
      },
      async deleteSession() {
        throw new Error("Not available in transaction context");
      },
      async deleteUserSessions() {
        throw new Error("Not available in transaction context");
      },
      async cleanExpiredSessions() {
        throw new Error("Not available in transaction context");
      },
      async storeChallenge(challenge) {
        await client.query(
          `INSERT INTO anon_challenges (id, challenge, type, user_id, expires_at, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            challenge.id,
            challenge.challenge,
            challenge.type,
            challenge.userId || null,
            challenge.expiresAt,
            challenge.metadata ? JSON.stringify(challenge.metadata) : null
          ]
        );
      },
      async getChallenge() {
        throw new Error("Not available in transaction context");
      },
      async deleteChallenge(challengeId) {
        await client.query("DELETE FROM anon_challenges WHERE id = $1", [challengeId]);
      },
      async storeRecoveryData() {
        throw new Error("Not available in transaction context");
      },
      async getRecoveryData() {
        throw new Error("Not available in transaction context");
      }
    };
  }
  return {
    async initialize() {
      const p = await getPool();
      await p.query(POSTGRES_SCHEMA);
    },
    async createUser(input) {
      const p = await getPool();
      const result = await p.query(
        `INSERT INTO anon_users (codename, near_account_id, mpc_public_key, derivation_path)
         VALUES ($1, $2, $3, $4)
         RETURNING id, codename, near_account_id, mpc_public_key, derivation_path, created_at, last_active_at`,
        [input.codename, input.nearAccountId, input.mpcPublicKey, input.derivationPath]
      );
      const row = result.rows[0];
      return {
        id: row.id,
        type: "anonymous",
        codename: row.codename,
        nearAccountId: row.near_account_id,
        mpcPublicKey: row.mpc_public_key,
        derivationPath: row.derivation_path,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at
      };
    },
    async getUserById(id) {
      const p = await getPool();
      const result = await p.query(
        "SELECT * FROM anon_users WHERE id = $1",
        [id]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        type: "anonymous",
        codename: row.codename,
        nearAccountId: row.near_account_id,
        mpcPublicKey: row.mpc_public_key,
        derivationPath: row.derivation_path,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at
      };
    },
    async getUserByCodename(codename) {
      const p = await getPool();
      const result = await p.query(
        "SELECT * FROM anon_users WHERE codename = $1",
        [codename]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        type: "anonymous",
        codename: row.codename,
        nearAccountId: row.near_account_id,
        mpcPublicKey: row.mpc_public_key,
        derivationPath: row.derivation_path,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at
      };
    },
    async getUserByNearAccount(nearAccountId) {
      const p = await getPool();
      const result = await p.query(
        "SELECT * FROM anon_users WHERE near_account_id = $1",
        [nearAccountId]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        type: "anonymous",
        codename: row.codename,
        nearAccountId: row.near_account_id,
        mpcPublicKey: row.mpc_public_key,
        derivationPath: row.derivation_path,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at
      };
    },
    // ============================================
    // OAuth Users
    // ============================================
    async createOAuthUser(input) {
      const p = await getPool();
      const client = await p.connect();
      try {
        await client.query("BEGIN");
        const userResult = await client.query(
          `INSERT INTO oauth_users (email, name, avatar_url, near_account_id, mpc_public_key, derivation_path)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [input.email, input.name, input.avatarUrl, input.nearAccountId, input.mpcPublicKey, input.derivationPath]
        );
        const userRow = userResult.rows[0];
        await client.query(
          `INSERT INTO oauth_providers (user_id, provider, provider_id, email, name, avatar_url)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userRow.id,
            input.provider.provider,
            input.provider.providerId,
            input.provider.email,
            input.provider.name,
            input.provider.avatarUrl
          ]
        );
        await client.query("COMMIT");
        return {
          id: userRow.id,
          type: "standard",
          email: userRow.email,
          name: userRow.name,
          avatarUrl: userRow.avatar_url,
          nearAccountId: userRow.near_account_id,
          mpcPublicKey: userRow.mpc_public_key,
          derivationPath: userRow.derivation_path,
          providers: [input.provider],
          createdAt: userRow.created_at,
          lastActiveAt: userRow.last_active_at
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async getOAuthUserById(id) {
      const p = await getPool();
      const result = await p.query(
        `SELECT u.id, u.email, u.name, u.avatar_url, u.near_account_id, u.mpc_public_key,
                u.derivation_path, u.created_at, u.last_active_at,
                p.provider, p.provider_id, p.email AS p_email,
                p.name AS p_name, p.avatar_url AS p_avatar_url, p.connected_at
         FROM oauth_users u
         LEFT JOIN oauth_providers p ON p.user_id = u.id
         WHERE u.id = $1`,
        [id]
      );
      return mapOAuthUserRows(result.rows);
    },
    async getOAuthUserByEmail(email) {
      const p = await getPool();
      const result = await p.query(
        `SELECT u.id, u.email, u.name, u.avatar_url, u.near_account_id, u.mpc_public_key,
                u.derivation_path, u.created_at, u.last_active_at,
                p.provider, p.provider_id, p.email AS p_email,
                p.name AS p_name, p.avatar_url AS p_avatar_url, p.connected_at
         FROM oauth_users u
         LEFT JOIN oauth_providers p ON p.user_id = u.id
         WHERE u.email = $1`,
        [email]
      );
      return mapOAuthUserRows(result.rows);
    },
    async getOAuthUserByProvider(provider, providerId) {
      const p = await getPool();
      const result = await p.query(
        `SELECT u.id, u.email, u.name, u.avatar_url, u.near_account_id, u.mpc_public_key,
                u.derivation_path, u.created_at, u.last_active_at,
                p.provider, p.provider_id, p.email AS p_email,
                p.name AS p_name, p.avatar_url AS p_avatar_url, p.connected_at
         FROM oauth_users u
         JOIN oauth_providers p ON p.user_id = u.id
         WHERE u.id = (
           SELECT user_id FROM oauth_providers WHERE provider = $1 AND provider_id = $2
         )`,
        [provider, providerId]
      );
      return mapOAuthUserRows(result.rows);
    },
    async linkOAuthProvider(userId, provider) {
      const p = await getPool();
      await p.query(
        `INSERT INTO oauth_providers (user_id, provider, provider_id, email, name, avatar_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (provider, provider_id) DO UPDATE SET
           email = EXCLUDED.email,
           name = EXCLUDED.name,
           avatar_url = EXCLUDED.avatar_url`,
        [
          userId,
          provider.provider,
          provider.providerId,
          provider.email,
          provider.name,
          provider.avatarUrl
        ]
      );
    },
    async createPasskey(input) {
      const p = await getPool();
      await p.query(
        `INSERT INTO anon_passkeys (credential_id, user_id, public_key, counter, device_type, backed_up, transports)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.credentialId,
          input.userId,
          input.publicKey,
          input.counter,
          input.deviceType,
          input.backedUp,
          input.transports || null
        ]
      );
      return {
        ...input,
        createdAt: /* @__PURE__ */ new Date()
      };
    },
    async getPasskeyById(credentialId) {
      const p = await getPool();
      const result = await p.query(
        "SELECT * FROM anon_passkeys WHERE credential_id = $1",
        [credentialId]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        credentialId: row.credential_id,
        userId: row.user_id,
        publicKey: row.public_key,
        counter: row.counter,
        deviceType: row.device_type,
        backedUp: row.backed_up,
        transports: row.transports,
        createdAt: row.created_at
      };
    },
    async getPasskeysByUserId(userId) {
      const p = await getPool();
      const result = await p.query(
        "SELECT * FROM anon_passkeys WHERE user_id = $1",
        [userId]
      );
      return result.rows.map((row) => ({
        credentialId: row.credential_id,
        userId: row.user_id,
        publicKey: row.public_key,
        counter: row.counter,
        deviceType: row.device_type,
        backedUp: row.backed_up,
        transports: row.transports,
        createdAt: row.created_at
      }));
    },
    async updatePasskeyCounter(credentialId, counter) {
      const p = await getPool();
      await p.query(
        "UPDATE anon_passkeys SET counter = $1 WHERE credential_id = $2",
        [counter, credentialId]
      );
    },
    async deletePasskey(credentialId) {
      const p = await getPool();
      await p.query("DELETE FROM anon_passkeys WHERE credential_id = $1", [credentialId]);
    },
    async createSession(input) {
      const p = await getPool();
      const result = await p.query(
        `INSERT INTO anon_sessions (id, user_id, expires_at, ip_address, user_agent)
         VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5)
         RETURNING id, user_id, created_at, expires_at, last_activity_at, ip_address, user_agent`,
        [input.id || null, input.userId, input.expiresAt, input.ipAddress || null, input.userAgent || null]
      );
      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        lastActivityAt: row.last_activity_at,
        ipAddress: row.ip_address,
        userAgent: row.user_agent
      };
    },
    async getSession(sessionId) {
      const p = await getPool();
      const result = await p.query(
        "SELECT * FROM anon_sessions WHERE id = $1 AND expires_at > NOW()",
        [sessionId]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        lastActivityAt: row.last_activity_at,
        ipAddress: row.ip_address,
        userAgent: row.user_agent
      };
    },
    async deleteSession(sessionId) {
      const p = await getPool();
      await p.query("DELETE FROM anon_sessions WHERE id = $1", [sessionId]);
    },
    async deleteUserSessions(userId) {
      const p = await getPool();
      await p.query("DELETE FROM anon_sessions WHERE user_id = $1", [userId]);
    },
    async cleanExpiredSessions() {
      const p = await getPool();
      const result = await p.query("DELETE FROM anon_sessions WHERE expires_at < NOW()");
      return result.rowCount || 0;
    },
    async updateSessionExpiry(sessionId, newExpiresAt) {
      const p = await getPool();
      await p.query(
        "UPDATE anon_sessions SET expires_at = $1 WHERE id = $2",
        [newExpiresAt, sessionId]
      );
    },
    async storeChallenge(challenge) {
      const p = await getPool();
      await p.query(
        `INSERT INTO anon_challenges (id, challenge, type, user_id, expires_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          challenge.id,
          challenge.challenge,
          challenge.type,
          challenge.userId || null,
          challenge.expiresAt,
          challenge.metadata ? JSON.stringify(challenge.metadata) : null
        ]
      );
    },
    async getChallenge(challengeId) {
      const p = await getPool();
      const result = await p.query(
        "SELECT * FROM anon_challenges WHERE id = $1",
        [challengeId]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        challenge: row.challenge,
        type: row.type,
        userId: row.user_id,
        expiresAt: row.expires_at,
        metadata: row.metadata
      };
    },
    async deleteChallenge(challengeId) {
      const p = await getPool();
      await p.query("DELETE FROM anon_challenges WHERE id = $1", [challengeId]);
    },
    async storeRecoveryData(data) {
      const p = await getPool();
      await p.query(
        `INSERT INTO anon_recovery (user_id, type, reference)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, type) DO UPDATE SET reference = $3, created_at = NOW()`,
        [data.userId, data.type, data.reference]
      );
    },
    async getRecoveryData(userId, type) {
      const p = await getPool();
      const result = await p.query(
        "SELECT * FROM anon_recovery WHERE user_id = $1 AND type = $2",
        [userId, type]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        userId: row.user_id,
        type: row.type,
        reference: row.reference,
        createdAt: row.created_at
      };
    },
    async transaction(fn) {
      const p = await getPool();
      const client = await p.connect();
      try {
        await client.query("BEGIN");
        const txAdapter = buildClientAdapter(client);
        const result = await fn(txAdapter);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async deleteUser(userId) {
      const p = await getPool();
      await p.query("DELETE FROM anon_users WHERE id = $1", [userId]);
    },
    async deleteRecoveryData(userId) {
      const p = await getPool();
      await p.query("DELETE FROM anon_recovery WHERE user_id = $1", [userId]);
    },
    // ============================================
    // OAuth State (DB-backed, cross-instance)
    // ============================================
    async storeOAuthState(state) {
      const p = await getPool();
      await p.query(
        `INSERT INTO oauth_state (state, provider, code_verifier, redirect_uri, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (state) DO NOTHING`,
        [state.state, state.provider, state.codeVerifier || null, state.redirectUri, state.expiresAt]
      );
    },
    async getOAuthState(stateKey) {
      const p = await getPool();
      const result = await p.query(
        `SELECT state, provider, code_verifier, redirect_uri, expires_at
         FROM oauth_state
         WHERE state = $1 AND expires_at > NOW()`,
        [stateKey]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        state: row.state,
        provider: row.provider,
        codeVerifier: row.code_verifier,
        redirectUri: row.redirect_uri,
        expiresAt: row.expires_at
      };
    },
    async deleteOAuthState(stateKey) {
      const p = await getPool();
      await p.query("DELETE FROM oauth_state WHERE state = $1", [stateKey]);
    },
    async cleanExpiredChallenges() {
      const p = await getPool();
      const result = await p.query("DELETE FROM anon_challenges WHERE expires_at < NOW()");
      return result.rowCount || 0;
    },
    async cleanExpiredOAuthStates() {
      const p = await getPool();
      const result = await p.query("DELETE FROM oauth_state WHERE expires_at < NOW()");
      return result.rowCount || 0;
    }
  };
}
var SESSION_COOKIE_NAME = "anon_session";
var DEFAULT_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1e3;
function signSessionId(sessionId, secret) {
  const signature = createHmac("sha256", secret).update(sessionId).digest("base64url");
  return `${sessionId}.${signature}`;
}
function verifySessionId(signedValue, secret) {
  const parts = signedValue.split(".");
  if (parts.length !== 2) return null;
  const [sessionId, signature] = parts;
  const expectedSignature = createHmac("sha256", secret).update(sessionId).digest("base64url");
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(sigBuffer, expectedBuffer)) return null;
  return sessionId;
}
function parseCookies(req) {
  const cookies = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split("=");
    if (name && rest.length) {
      cookies[name] = decodeURIComponent(rest.join("="));
    }
  });
  return cookies;
}
function createSessionManager(db, config) {
  const log2 = (config.logger ?? pino3({ level: "silent" })).child({ module: "session" });
  const cookieName = config.cookieName || SESSION_COOKIE_NAME;
  let warnedNoUpdateSessionExpiry = false;
  const durationMs = config.durationMs || DEFAULT_SESSION_DURATION_MS;
  const isProduction = process.env.NODE_ENV === "production";
  const cookieOptions = {
    httpOnly: true,
    secure: config.secure ?? isProduction,
    sameSite: config.sameSite || "strict",
    path: config.path || "/",
    domain: config.domain
  };
  return {
    async createSession(userId, res, options = {}) {
      const sessionId = randomUUID();
      const now = /* @__PURE__ */ new Date();
      const expiresAt = new Date(now.getTime() + durationMs);
      const sessionInput = {
        userId,
        expiresAt,
        ipAddress: options.ipAddress,
        userAgent: options.userAgent
      };
      const session = await db.createSession({
        ...sessionInput,
        id: sessionId
      });
      const signedId = signSessionId(sessionId, config.secret);
      res.cookie(cookieName, signedId, {
        ...cookieOptions,
        maxAge: durationMs,
        expires: expiresAt
      });
      return session;
    },
    async getSession(req) {
      const cookies = parseCookies(req);
      const signedId = cookies[cookieName];
      if (!signedId) return null;
      const sessionId = verifySessionId(signedId, config.secret);
      if (!sessionId) return null;
      const session = await db.getSession(sessionId);
      if (!session) return null;
      if (session.expiresAt < /* @__PURE__ */ new Date()) {
        await db.deleteSession(sessionId);
        return null;
      }
      return session;
    },
    async destroySession(req, res) {
      const cookies = parseCookies(req);
      const signedId = cookies[cookieName];
      if (signedId) {
        const sessionId = verifySessionId(signedId, config.secret);
        if (sessionId) {
          await db.deleteSession(sessionId);
        }
      }
      res.clearCookie(cookieName, {
        ...cookieOptions
      });
    },
    async refreshSession(req, res) {
      const session = await this.getSession(req);
      if (!session) return null;
      const now = Date.now();
      const created = session.createdAt.getTime();
      const expires = session.expiresAt.getTime();
      const lifetime = expires - created;
      const elapsed = now - created;
      if (elapsed > lifetime * 0.5) {
        const newExpiresAt = new Date(now + durationMs);
        if (db.updateSessionExpiry) {
          await db.updateSessionExpiry(session.id, newExpiresAt);
        } else if (!warnedNoUpdateSessionExpiry) {
          log2.warn("Session refresh is cookie-only \u2014 implement updateSessionExpiry on your adapter for full persistence.");
          warnedNoUpdateSessionExpiry = true;
        }
        const signedId = signSessionId(session.id, config.secret);
        res.cookie(cookieName, signedId, {
          ...cookieOptions,
          maxAge: durationMs,
          expires: newExpiresAt
        });
      }
      return session;
    }
  };
}
function createPasskeyManager(db, config) {
  const log2 = (config.logger ?? pino3({ level: "silent" })).child({ module: "passkey" });
  const challengeTimeoutMs = config.challengeTimeoutMs || 6e4;
  return {
    async startRegistration(userId, userDisplayName) {
      const options = await generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpId,
        userName: userDisplayName,
        userDisplayName,
        userID: new TextEncoder().encode(userId),
        attestationType: "none",
        excludeCredentials: [],
        // No existing passkeys for new user
        authenticatorSelection: {
          residentKey: "required",
          // Required for discoverable credentials (login without username)
          userVerification: "preferred"
          // Note: removed authenticatorAttachment to allow both platform and cross-platform (hardware keys)
        }
      });
      const challengeId = randomUUID();
      const challenge = {
        id: challengeId,
        challenge: options.challenge,
        type: "registration",
        userId: void 0,
        // Don't set foreign key - user doesn't exist
        expiresAt: new Date(Date.now() + challengeTimeoutMs),
        metadata: { tempUserId: userId, userDisplayName }
        // Store temp ID here
      };
      await db.storeChallenge(challenge);
      return {
        challengeId,
        options
      };
    },
    async finishRegistration(challengeId, response) {
      const challenge = await db.getChallenge(challengeId);
      if (!challenge) {
        throw new Error("Challenge not found or expired");
      }
      if (challenge.type !== "registration") {
        throw new Error("Invalid challenge type");
      }
      if (challenge.expiresAt < /* @__PURE__ */ new Date()) {
        await db.deleteChallenge(challengeId);
        throw new Error("Challenge expired");
      }
      const tempUserId = challenge.metadata?.tempUserId;
      if (!tempUserId) {
        throw new Error("Challenge missing temp user ID");
      }
      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response,
          expectedChallenge: challenge.challenge,
          expectedOrigin: config.origin,
          expectedRPID: config.rpId
        });
      } catch (error) {
        log2.error({ err: error }, "Registration verification failed");
        await db.deleteChallenge(challengeId);
        return { verified: false };
      }
      if (!verification.verified || !verification.registrationInfo) {
        await db.deleteChallenge(challengeId);
        return { verified: false };
      }
      const { registrationInfo } = verification;
      await db.deleteChallenge(challengeId);
      return {
        verified: true,
        passkeyData: {
          credentialId: registrationInfo.credential.id,
          publicKey: registrationInfo.credential.publicKey,
          counter: registrationInfo.credential.counter,
          deviceType: registrationInfo.credentialDeviceType,
          backedUp: registrationInfo.credentialBackedUp,
          transports: response.response.transports
        },
        tempUserId
      };
    },
    async startAuthentication(userId) {
      let allowCredentials;
      if (userId) {
        const passkeys = await db.getPasskeysByUserId(userId);
        allowCredentials = passkeys.map((pk) => ({
          id: pk.credentialId,
          type: "public-key",
          transports: pk.transports
        }));
      }
      const options = await generateAuthenticationOptions({
        rpID: config.rpId,
        userVerification: "preferred",
        allowCredentials
      });
      const challengeId = randomUUID();
      const challenge = {
        id: challengeId,
        challenge: options.challenge,
        type: "authentication",
        userId,
        expiresAt: new Date(Date.now() + challengeTimeoutMs)
      };
      await db.storeChallenge(challenge);
      return {
        challengeId,
        options
      };
    },
    async finishAuthentication(challengeId, response) {
      const challenge = await db.getChallenge(challengeId);
      if (!challenge) {
        throw new Error("Challenge not found or expired");
      }
      if (challenge.type !== "authentication") {
        throw new Error("Invalid challenge type");
      }
      if (challenge.expiresAt < /* @__PURE__ */ new Date()) {
        await db.deleteChallenge(challengeId);
        throw new Error("Challenge expired");
      }
      const passkey = await db.getPasskeyById(response.id);
      if (!passkey) {
        await db.deleteChallenge(challengeId);
        throw new Error("Passkey not found");
      }
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challenge.challenge,
          expectedOrigin: config.origin,
          expectedRPID: config.rpId,
          credential: {
            id: passkey.credentialId,
            publicKey: passkey.publicKey,
            counter: passkey.counter,
            transports: passkey.transports
          }
        });
      } catch (error) {
        log2.error({ err: error }, "Authentication verification failed");
        await db.deleteChallenge(challengeId);
        return { verified: false };
      }
      if (!verification.verified) {
        await db.deleteChallenge(challengeId);
        return { verified: false };
      }
      await db.updatePasskeyCounter(
        passkey.credentialId,
        verification.authenticationInfo.newCounter
      );
      await db.deleteChallenge(challengeId);
      return {
        verified: true,
        userId: passkey.userId,
        passkey
      };
    }
  };
}
var _log = pino3({ level: "silent" }).child({ module: "wallet-recovery" });
function generateWalletChallenge(action, timestamp) {
  return `near-anon-auth:${action}:${timestamp}`;
}
function verifyWalletSignature(signature, expectedMessage) {
  try {
    if (signature.message !== expectedMessage) {
      return false;
    }
    const pubKeyStr = signature.publicKey.replace("ed25519:", "");
    const publicKeyBytes = bs582.decode(pubKeyStr);
    const signatureBytes = Buffer.from(signature.signature, "base64");
    const messageHash = createHash("sha256").update(signature.message).digest();
    return nacl.sign.detached.verify(
      messageHash,
      signatureBytes,
      publicKeyBytes
    );
  } catch (error) {
    _log.error({ err: error }, "Signature verification failed");
    return false;
  }
}
async function checkWalletAccess(nearAccountId, walletPublicKey, networkId) {
  try {
    const rpcUrl = networkId === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org";
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "check-access-key",
        method: "query",
        params: {
          request_type: "view_access_key",
          finality: "final",
          account_id: nearAccountId,
          public_key: walletPublicKey
        }
      })
    });
    const result = await response.json();
    return !result.error;
  } catch {
    return false;
  }
}
function createWalletRecoveryManager(config) {
  (config.logger ?? pino3({ level: "silent" })).child({ module: "wallet-recovery" });
  const CHALLENGE_TIMEOUT_MS = 5 * 60 * 1e3;
  return {
    generateLinkChallenge() {
      const timestamp = Date.now();
      const challenge = generateWalletChallenge("link-recovery", timestamp);
      const expiresAt = new Date(Date.now() + CHALLENGE_TIMEOUT_MS);
      return { challenge, expiresAt };
    },
    verifyLinkSignature(signature, challenge) {
      const verified = verifyWalletSignature(signature, challenge);
      if (!verified) {
        return { verified: false };
      }
      const walletId = signature.publicKey;
      return { verified: true, walletId };
    },
    generateRecoveryChallenge() {
      const timestamp = Date.now();
      const challenge = generateWalletChallenge("recover-account", timestamp);
      const expiresAt = new Date(Date.now() + CHALLENGE_TIMEOUT_MS);
      return { challenge, expiresAt };
    },
    async verifyRecoverySignature(signature, challenge, nearAccountId) {
      if (!verifyWalletSignature(signature, challenge)) {
        return { verified: false };
      }
      const hasAccess = await checkWalletAccess(
        nearAccountId,
        signature.publicKey,
        config.nearNetwork
      );
      return { verified: hasAccess };
    }
  };
}

// src/server/mpc.ts
function getMPCContractId(networkId) {
  return networkId === "mainnet" ? "v1.signer-prod.near" : "v1.signer-prod.testnet";
}
function getRPCUrl(networkId) {
  return networkId === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org";
}
function derivePublicKey(seed) {
  const hash = createHash("sha512").update(seed).digest();
  return hash.subarray(0, 32);
}
async function accountExists(accountId, networkId) {
  try {
    const rpcUrl = getRPCUrl(networkId);
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "check-account",
        method: "query",
        params: {
          request_type: "view_account",
          finality: "final",
          account_id: accountId
        }
      })
    });
    const result = await response.json();
    return !result.error;
  } catch {
    return false;
  }
}
function generateAccountName(userId, prefix) {
  const hash = createHash("sha256").update(userId).digest("hex");
  const shortHash = hash.substring(0, 12);
  return `${prefix}-${shortHash}`;
}
async function fundAccountFromTreasury(accountId, treasuryAccount, treasuryPrivateKey, amountNear, networkId, log2) {
  const nacl2 = await import('tweetnacl');
  try {
    const rpcUrl = getRPCUrl(networkId);
    const keyString = treasuryPrivateKey.replace("ed25519:", "");
    let secretKey;
    try {
      secretKey = bs582.decode(keyString);
    } catch {
      secretKey = Buffer.from(keyString, "base64");
    }
    const publicKey = secretKey.length === 64 ? secretKey.slice(32) : nacl2.default.sign.keyPair.fromSeed(secretKey.slice(0, 32)).publicKey;
    const publicKeyB58 = bs582.encode(Buffer.from(publicKey));
    const fullPublicKey = `ed25519:${publicKeyB58}`;
    log2.info({ accountId: treasuryAccount }, "Treasury public key verified");
    const accessKeyResponse = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "get-access-key",
        method: "query",
        params: {
          request_type: "view_access_key",
          finality: "final",
          account_id: treasuryAccount,
          public_key: fullPublicKey
        }
      })
    });
    const accessKeyResult = await accessKeyResponse.json();
    if (accessKeyResult.error || !accessKeyResult.result) {
      log2.error({ err: new Error(JSON.stringify(accessKeyResult.error)) }, "Access key error");
      return {
        success: false,
        error: `Could not get access key: ${accessKeyResult.error?.cause?.name || "Unknown"}`
      };
    }
    const nonce = accessKeyResult.result.nonce + 1;
    const blockHash = accessKeyResult.result.block_hash;
    const [whole, fraction = ""] = amountNear.split(".");
    const paddedFraction = fraction.padEnd(24, "0").slice(0, 24);
    const yoctoStr = (whole + paddedFraction).replace(/^0+/, "") || "0";
    const amountYocto = BigInt(new BN(yoctoStr).toString());
    const transaction = buildTransferTransaction(
      treasuryAccount,
      publicKey,
      nonce,
      accountId,
      blockHash,
      amountYocto,
      bs582
    );
    const txHash = createHash("sha256").update(transaction).digest();
    const signature = nacl2.default.sign.detached(txHash, secretKey);
    const signedTx = buildSignedTransaction(transaction, signature, publicKey);
    const submitResponse = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "send-tx",
        method: "broadcast_tx_commit",
        params: [Buffer.from(signedTx).toString("base64")]
      })
    });
    const submitResult = await submitResponse.json();
    if (submitResult.error) {
      log2.error({ err: new Error(submitResult.error.data || submitResult.error.message || "Transaction failed") }, "Transaction error");
      return {
        success: false,
        error: submitResult.error.data || submitResult.error.message || "Transaction failed"
      };
    }
    const resultHash = submitResult.result?.transaction?.hash || "unknown";
    log2.info({ accountId, txHash: resultHash }, "Funded account");
    return { success: true, txHash: resultHash };
  } catch (error) {
    log2.error({ err: error }, "Treasury funding failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
function buildTransferTransaction(signerId, publicKey, nonce, receiverId, blockHash, amount, bs583) {
  const parts = [];
  parts.push(serializeString(signerId));
  parts.push(new Uint8Array([0]));
  parts.push(new Uint8Array(publicKey));
  parts.push(serializeU64(BigInt(nonce)));
  parts.push(serializeString(receiverId));
  parts.push(bs583.decode(blockHash));
  parts.push(serializeU32(1));
  parts.push(new Uint8Array([3]));
  parts.push(serializeU128(amount));
  return concatArrays(parts);
}
function buildSignedTransaction(transaction, signature, publicKey) {
  const parts = [];
  parts.push(transaction);
  parts.push(new Uint8Array([0]));
  parts.push(new Uint8Array(publicKey));
  parts.push(new Uint8Array(signature));
  return concatArrays(parts);
}
function serializeString(str) {
  const bytes = Buffer.from(str, "utf8");
  const len = serializeU32(bytes.length);
  return concatArrays([len, bytes]);
}
function serializeU32(num) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(num);
  return buf;
}
function serializeU64(num) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(num);
  return buf;
}
function serializeU128(num) {
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(num & BigInt("0xFFFFFFFFFFFFFFFF"), 0);
  buf.writeBigUInt64LE(num >> BigInt(64), 8);
  return buf;
}
function concatArrays(arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
var warnedNoDerivationSalt = false;
var MPCAccountManager = class {
  networkId;
  mpcContractId;
  accountPrefix;
  treasuryAccount;
  treasuryPrivateKey;
  fundingAmount;
  derivationSalt;
  log;
  constructor(config) {
    this.networkId = config.networkId;
    this.mpcContractId = getMPCContractId(config.networkId);
    this.accountPrefix = config.accountPrefix || "anon";
    this.treasuryAccount = config.treasuryAccount;
    this.treasuryPrivateKey = config.treasuryPrivateKey;
    this.fundingAmount = config.fundingAmount || "0.01";
    this.derivationSalt = config.derivationSalt;
    this.log = (config.logger ?? pino3({ level: "silent" })).child({ module: "mpc" });
  }
  /**
   * Create a new NEAR account for an anonymous user
   */
  async createAccount(userId) {
    const accountName = generateAccountName(userId, this.accountPrefix);
    const suffix = this.networkId === "mainnet" ? ".near" : ".testnet";
    const nearAccountId = `${accountName}${suffix}`;
    const derivationPath = `near-anon-auth,${userId}`;
    this.log.info({ nearAccountId, network: this.networkId }, "Creating NEAR account");
    try {
      if (!this.derivationSalt && !warnedNoDerivationSalt) {
        this.log.warn("No derivationSalt configured -- account IDs are predictable from user IDs. Set derivationSalt for production use.");
        warnedNoDerivationSalt = true;
      }
      const seedInput = this.derivationSalt ? `implicit-${this.derivationSalt}-${userId}` : `implicit-${userId}`;
      const seed = createHash("sha256").update(seedInput).digest();
      const publicKeyBytes = derivePublicKey(seed);
      const implicitAccountId = publicKeyBytes.toString("hex");
      const publicKey = `ed25519:${bs582.encode(publicKeyBytes)}`;
      this.log.info({ accountId: implicitAccountId, network: this.networkId }, "Created implicit account");
      const alreadyExists = await accountExists(implicitAccountId, this.networkId);
      if (alreadyExists) {
        this.log.info({ accountId: implicitAccountId }, "Implicit account already funded");
        return {
          nearAccountId: implicitAccountId,
          derivationPath,
          mpcPublicKey: publicKey,
          onChain: true
        };
      }
      let onChain = false;
      if (this.treasuryAccount && this.treasuryPrivateKey) {
        this.log.info({ accountId: implicitAccountId }, "Funding implicit account from treasury");
        const fundResult = await fundAccountFromTreasury(
          implicitAccountId,
          this.treasuryAccount,
          this.treasuryPrivateKey,
          this.fundingAmount,
          this.networkId,
          this.log
        );
        if (fundResult.success) {
          this.log.info({ txHash: fundResult.txHash }, "Account funded");
          onChain = true;
        } else {
          this.log.warn({ err: new Error(fundResult.error) }, "Funding failed, account will be dormant");
        }
      } else {
        this.log.warn("No treasury configured, account will be dormant until funded");
      }
      return {
        nearAccountId: implicitAccountId,
        derivationPath,
        mpcPublicKey: publicKey,
        onChain
      };
    } catch (error) {
      this.log.error({ err: error }, "Mainnet implicit account creation failed");
      return {
        nearAccountId,
        derivationPath,
        mpcPublicKey: "creation-failed",
        onChain: false
      };
    }
  }
  /**
   * Add a recovery wallet as an access key to the MPC account
   *
   * This creates an on-chain link without storing it in our database.
   * The recovery wallet can be used to prove ownership and create new passkeys.
   *
   * @param nearAccountId - The user's NEAR implicit account ID
   * @param recoveryWalletPublicKey - The recovery wallet's public key in ed25519:BASE58 format
   */
  async addRecoveryWallet(nearAccountId, recoveryWalletPublicKey) {
    this.log.info({ nearAccountId }, "Adding recovery wallet via AddKey transaction");
    if (!this.treasuryPrivateKey) {
      this.log.error("No treasury private key configured \u2014 cannot sign AddKey transaction");
      return { success: false };
    }
    try {
      const rpcUrl = getRPCUrl(this.networkId);
      const keyPair = KeyPair.fromString(this.treasuryPrivateKey);
      const signer = new KeyPairSigner(keyPair);
      const signerPublicKey = await signer.getPublicKey();
      const signerPublicKeyStr = signerPublicKey.toString();
      const accessKeyResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "get-access-key",
          method: "query",
          params: {
            request_type: "view_access_key",
            finality: "final",
            account_id: nearAccountId,
            public_key: signerPublicKeyStr
          }
        })
      });
      const accessKeyResult = await accessKeyResponse.json();
      if (accessKeyResult.error || !accessKeyResult.result) {
        this.log.error(
          { err: new Error(JSON.stringify(accessKeyResult.error)) },
          "Could not fetch access key for AddKey transaction"
        );
        return { success: false };
      }
      const nonce = BigInt(accessKeyResult.result.nonce) + 1n;
      const blockHashBytes = bs582.decode(accessKeyResult.result.block_hash);
      const { addKey, fullAccessKey } = actionCreators;
      const recoveryPublicKey = PublicKey.fromString(recoveryWalletPublicKey);
      const action = addKey(recoveryPublicKey, fullAccessKey());
      const tx = createTransaction(
        nearAccountId,
        // signerId
        signerPublicKey,
        // must match signer.getPublicKey()
        nearAccountId,
        // receiverId (adding key to user's own account)
        nonce,
        [action],
        blockHashBytes
        // Uint8Array, NOT base58 string
      );
      const [, signedTx] = await signer.signTransaction(tx);
      const encoded = Buffer.from(signedTx.encode()).toString("base64");
      const submitResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "send-tx",
          method: "broadcast_tx_commit",
          params: [encoded]
        })
      });
      const submitResult = await submitResponse.json();
      if (submitResult.error) {
        this.log.error(
          { err: new Error(submitResult.error.data || submitResult.error.message || "Transaction failed") },
          "AddKey transaction broadcast failed"
        );
        return { success: false };
      }
      const txHash = submitResult.result?.transaction?.hash || "unknown";
      this.log.info({ nearAccountId, txHash }, "Recovery wallet added via AddKey");
      return { success: true, txHash };
    } catch (error) {
      this.log.error({ err: error }, "addRecoveryWallet failed");
      return { success: false };
    }
  }
  /**
   * Verify that a wallet has recovery access to an account by checking the
   * specific recovery wallet public key via view_access_key RPC.
   *
   * Returns false when account has keys but none match the recovery wallet key.
   *
   * @param nearAccountId - The user's NEAR implicit account ID
   * @param recoveryWalletPublicKey - The recovery wallet's public key in ed25519:BASE58 format
   */
  async verifyRecoveryWallet(nearAccountId, recoveryWalletPublicKey) {
    try {
      return await checkWalletAccess(nearAccountId, recoveryWalletPublicKey, this.networkId);
    } catch {
      this.log.error({ nearAccountId }, "Recovery wallet verification failed");
      return false;
    }
  }
  /**
   * Get MPC contract ID
   */
  getMPCContractId() {
    return this.mpcContractId;
  }
  /**
   * Get network ID
   */
  getNetworkId() {
    return this.networkId;
  }
};
function createMPCManager(config) {
  return new MPCAccountManager(config);
}
var scryptAsync = promisify(scrypt);
async function deriveKey(password, salt) {
  return scryptAsync(password, salt, 32);
}
async function encryptRecoveryData(payload, password) {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payloadJson = JSON.stringify(payload);
  const encrypted = Buffer.concat([
    cipher.update(payloadJson, "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    authTag: authTag.toString("base64"),
    version: 1
  };
}
async function decryptRecoveryData(encryptedData, password) {
  const salt = Buffer.from(encryptedData.salt, "base64");
  const iv = Buffer.from(encryptedData.iv, "base64");
  const ciphertext = Buffer.from(encryptedData.ciphertext, "base64");
  const authTag = Buffer.from(encryptedData.authTag, "base64");
  const key = await deriveKey(password, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    throw new Error("Invalid password or corrupted data");
  }
}
async function pinToPinata(data, apiKey, apiSecret) {
  const formData = new FormData();
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  formData.append("file", new Blob([buffer]), "recovery.json");
  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: {
      "pinata_api_key": apiKey,
      "pinata_secret_api_key": apiSecret
    },
    body: formData
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Pinata error: ${response.status} - ${error}`);
  }
  const result = await response.json();
  return result.IpfsHash;
}
async function pinToWeb3Storage(data, apiToken) {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const response = await fetch("https://api.web3.storage/upload", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/octet-stream",
      "X-Name": "phantom-recovery.json"
    },
    body: buffer
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`web3.storage error: ${response.status} - ${error}`);
  }
  const result = await response.json();
  return result.cid;
}
async function pinToInfura(data, projectId, projectSecret) {
  const formData = new FormData();
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  formData.append("file", new Blob([buffer]), "recovery.json");
  const auth = Buffer.from(`${projectId}:${projectSecret}`).toString("base64");
  const response = await fetch("https://ipfs.infura.io:5001/api/v0/add", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`
    },
    body: formData
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Infura error: ${response.status} - ${error}`);
  }
  const result = await response.json();
  return result.Hash;
}
async function fetchFromIPFS(cid) {
  const gateways = [
    `https://gateway.pinata.cloud/ipfs/${cid}`,
    `https://w3s.link/ipfs/${cid}`,
    `https://ipfs.infura.io/ipfs/${cid}`,
    `https://ipfs.io/ipfs/${cid}`,
    `https://cloudflare-ipfs.com/ipfs/${cid}`,
    `https://dweb.link/ipfs/${cid}`
  ];
  const fetchGateway = async (url) => {
    const response = await fetch(url, {
      headers: { Accept: "application/octet-stream" }
    });
    if (!response.ok) throw new Error(`Gateway ${url} returned ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  try {
    return await Promise.any(gateways.map(fetchGateway));
  } catch {
    throw new Error("Failed to fetch from IPFS - tried all gateways");
  }
}
function createIPFSRecoveryManager(config) {
  const log2 = (config.logger ?? pino3({ level: "silent" })).child({ module: "ipfs-recovery" });
  const MIN_PASSWORD_LENGTH = 12;
  async function pinData(data) {
    if (config.customPin) {
      return config.customPin(data);
    }
    switch (config.pinningService) {
      case "pinata":
        if (!config.apiKey || !config.apiSecret) {
          throw new Error("Pinata requires apiKey and apiSecret");
        }
        return pinToPinata(data, config.apiKey, config.apiSecret);
      case "web3storage":
        if (!config.apiKey) {
          throw new Error("web3.storage requires apiKey (API token)");
        }
        return pinToWeb3Storage(data, config.apiKey);
      case "infura":
        if (!config.projectId || !config.apiSecret) {
          throw new Error("Infura requires projectId and apiSecret");
        }
        return pinToInfura(data, config.projectId, config.apiSecret);
      case "custom":
        throw new Error("Custom pinning requires customPin function");
      default:
        throw new Error(`Unknown pinning service: ${config.pinningService}`);
    }
  }
  async function fetchData(cid) {
    if (config.customFetch) {
      return config.customFetch(cid);
    }
    return fetchFromIPFS(cid);
  }
  function calculatePasswordStrength(password) {
    let score = 0;
    if (password.length >= 12) score++;
    if (password.length >= 16) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    if (score <= 2) return "weak";
    if (score <= 4) return "medium";
    return "strong";
  }
  return {
    async createRecoveryBackup(payload, password) {
      const validation = this.validatePassword(password);
      if (!validation.valid) {
        throw new Error(`Invalid password: ${validation.errors.join(", ")}`);
      }
      const encrypted = await encryptRecoveryData(payload, password);
      const data = new TextEncoder().encode(JSON.stringify(encrypted));
      const cid = await pinData(data);
      log2.info({ cid, pinningService: config.pinningService }, "Recovery backup created");
      return { cid };
    },
    async recoverFromBackup(cid, password) {
      const data = await fetchData(cid);
      const encrypted = JSON.parse(
        new TextDecoder().decode(data)
      );
      return decryptRecoveryData(encrypted, password);
    },
    validatePassword(password) {
      const errors = [];
      if (password.length < MIN_PASSWORD_LENGTH) {
        errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      }
      if (!/[a-z]/.test(password)) {
        errors.push("Password must contain lowercase letters");
      }
      if (!/[A-Z]/.test(password)) {
        errors.push("Password must contain uppercase letters");
      }
      if (!/[0-9]/.test(password)) {
        errors.push("Password must contain numbers");
      }
      const strength = calculatePasswordStrength(password);
      return {
        valid: errors.length === 0,
        errors,
        strength
      };
    }
  };
}
function generatePKCE() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}
function generateState() {
  return randomBytes(32).toString("base64url");
}
function createOAuthManager(config, db) {
  const stateStore = /* @__PURE__ */ new Map();
  return {
    isConfigured(provider) {
      return !!config[provider]?.clientId;
    },
    async getAuthUrl(provider, redirectUri) {
      const providerConfig = config[provider];
      if (!providerConfig) {
        throw new Error(`Provider ${provider} not configured`);
      }
      const state = generateState();
      const { codeVerifier, codeChallenge } = generatePKCE();
      let url;
      const { clientId } = providerConfig;
      switch (provider) {
        case "google": {
          const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: "openid email profile",
            state,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            access_type: "offline",
            prompt: "consent"
          });
          url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
          break;
        }
        case "github": {
          const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            scope: "read:user user:email",
            state
          });
          url = `https://github.com/login/oauth/authorize?${params}`;
          break;
        }
        case "twitter": {
          const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: "tweet.read users.read offline.access",
            state,
            code_challenge: codeChallenge,
            code_challenge_method: "S256"
          });
          url = `https://twitter.com/i/oauth2/authorize?${params}`;
          break;
        }
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
      const oauthState = {
        provider,
        state,
        codeVerifier,
        redirectUri,
        expiresAt: new Date(Date.now() + 10 * 60 * 1e3)
        // 10 minutes
      };
      if (db.storeOAuthState) {
        await db.storeOAuthState(oauthState);
      } else {
        stateStore.set(state, oauthState);
        for (const [key, value] of stateStore.entries()) {
          if (value.expiresAt < /* @__PURE__ */ new Date()) {
            stateStore.delete(key);
          }
        }
      }
      return { url, state, codeVerifier };
    },
    async exchangeCode(provider, code, redirectUri, codeVerifier) {
      const providerConfig = config[provider];
      if (!providerConfig) {
        throw new Error(`Provider ${provider} not configured`);
      }
      const { clientId, clientSecret } = providerConfig;
      let tokenUrl;
      let body;
      switch (provider) {
        case "google": {
          tokenUrl = "https://oauth2.googleapis.com/token";
          body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
            code_verifier: codeVerifier || ""
          });
          break;
        }
        case "github": {
          tokenUrl = "https://github.com/login/oauth/access_token";
          body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri
          });
          break;
        }
        case "twitter": {
          tokenUrl = "https://api.twitter.com/2/oauth2/token";
          body = new URLSearchParams({
            client_id: clientId,
            code,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
            code_verifier: codeVerifier || ""
          });
          break;
        }
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
      const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      };
      if (provider === "twitter") {
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        headers["Authorization"] = `Basic ${credentials}`;
      }
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers,
        body
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }
      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in || 3600,
        tokenType: data.token_type || "Bearer"
      };
    },
    async getProfile(provider, accessToken) {
      let profileUrl;
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      };
      switch (provider) {
        case "google":
          profileUrl = "https://www.googleapis.com/oauth2/v2/userinfo";
          break;
        case "github":
          profileUrl = "https://api.github.com/user";
          break;
        case "twitter":
          profileUrl = "https://api.twitter.com/2/users/me?user.fields=profile_image_url";
          break;
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
      const response = await fetch(profileUrl, { headers });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Profile fetch failed: ${error}`);
      }
      const data = await response.json();
      switch (provider) {
        case "google":
          return {
            provider,
            providerId: String(data.id),
            email: data.email,
            name: data.name,
            avatarUrl: data.picture,
            raw: data
          };
        case "github": {
          let email = data.email;
          if (!email) {
            try {
              const emailResponse = await fetch("https://api.github.com/user/emails", { headers });
              if (emailResponse.ok) {
                const emails = await emailResponse.json();
                const primary = emails.find((e) => e.primary && e.verified);
                email = primary?.email;
              }
            } catch {
            }
          }
          return {
            provider,
            providerId: String(data.id),
            email,
            name: data.name || data.login,
            avatarUrl: data.avatar_url,
            raw: data
          };
        }
        case "twitter": {
          const twitterData = data.data;
          return {
            provider,
            providerId: String(twitterData.id),
            email: void 0,
            // Twitter doesn't provide email
            name: twitterData.name,
            avatarUrl: twitterData.profile_image_url,
            raw: data
          };
        }
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
    },
    async validateState(state) {
      if (db.getOAuthState) {
        const record = await db.getOAuthState(state);
        if (!record) return null;
        if (record.expiresAt < /* @__PURE__ */ new Date()) {
          await db.deleteOAuthState?.(state);
          return null;
        }
        await db.deleteOAuthState?.(state);
        return {
          provider: record.provider,
          state: record.state,
          codeVerifier: record.codeVerifier,
          redirectUri: record.redirectUri,
          expiresAt: record.expiresAt
        };
      } else {
        const oauthState = stateStore.get(state);
        if (!oauthState) return null;
        if (oauthState.expiresAt < /* @__PURE__ */ new Date()) {
          stateStore.delete(state);
          return null;
        }
        stateStore.delete(state);
        return oauthState;
      }
    }
  };
}
function createEmailService(config, log2) {
  const client = new SESClient({
    region: config.region,
    ...config.accessKeyId && {
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    }
  });
  return {
    async sendRecoveryPassword(toEmail, recoveryPassword) {
      const command = new SendEmailCommand({
        Source: config.fromAddress,
        Destination: { ToAddresses: [toEmail] },
        Message: {
          Subject: { Data: "Your NEAR Account Recovery Password" },
          Body: {
            Text: {
              Data: `Your recovery password is: ${recoveryPassword}

Store this securely. You will need it to recover your account if you lose your device.`
            }
          }
        }
      });
      try {
        await client.send(command);
        log2.info({ to: toEmail }, "Recovery password email sent");
      } catch (err) {
        log2.error({ err }, "Failed to send recovery email");
        throw err;
      }
    }
  };
}

// src/server/validation/validateBody.ts
function validateBody(schema, req, res) {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: result.error.issues[0]?.message ?? "Invalid request body"
    });
    return null;
  }
  return result.data;
}
var registerStartBodySchema = z.object({});
var registerFinishBodySchema = z.object({
  challengeId: z.string().min(1),
  tempUserId: z.string().min(1),
  codename: z.string().min(1),
  sealingKeyHex: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  response: z.object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.literal("public-key"),
    response: z.object({
      clientDataJSON: z.string().min(1),
      attestationObject: z.string().min(1)
    }).passthrough(),
    // allow transports, publicKeyAlgorithm, etc.
    // z.object({}).catchall(z.unknown()) is the correct Zod 4 pattern for
    // AuthenticationExtensionsClientOutputs — an object with arbitrary unknown keys.
    // z.record(z.unknown()) has a bug in Zod 4.3.6 when values are nested objects.
    clientExtensionResults: z.object({}).catchall(z.unknown())
  }).passthrough()
  // allow authenticatorAttachment and other vendor keys
});
var loginStartBodySchema = z.object({
  codename: z.string().min(1).optional()
});
var loginFinishBodySchema = z.object({
  challengeId: z.string().min(1),
  sealingKeyHex: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  response: z.object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.literal("public-key"),
    response: z.object({
      clientDataJSON: z.string().min(1),
      authenticatorData: z.string().min(1),
      signature: z.string().min(1),
      userHandle: z.string().optional()
    }).passthrough(),
    // allow vendor keys in inner response
    clientExtensionResults: z.object({}).catchall(z.unknown())
  }).passthrough()
  // allow authenticatorAttachment and other vendor keys
});
var logoutBodySchema = z.object({});
var walletLinkBodySchema = z.object({});
var walletVerifyBodySchema = z.object({
  signature: z.object({
    signature: z.string().min(1),
    publicKey: z.string().min(1),
    message: z.string().min(1)
  }),
  challenge: z.string().min(1),
  walletAccountId: z.string().min(1)
});
var walletStartBodySchema = z.object({});
var walletFinishBodySchema = z.object({
  signature: z.object({
    signature: z.string().min(1),
    publicKey: z.string().min(1),
    message: z.string().min(1)
  }),
  challenge: z.string().min(1),
  nearAccountId: z.string().min(1)
});
var ipfsSetupBodySchema = z.object({
  password: z.string().min(1)
});
var ipfsRecoverBodySchema = z.object({
  cid: z.string().min(1),
  password: z.string().min(1)
});
var oauthCallbackBodySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});
var oauthLinkBodySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1).optional(),
  codeVerifier: z.string().min(1).optional()
});

// src/server/oauth/router.ts
function createOAuthRouter(config) {
  const log2 = (config.logger ?? pino3({ level: "silent" })).child({ module: "oauth" });
  const router = Router();
  const {
    db,
    sessionManager,
    mpcManager,
    oauthConfig,
    ipfsRecovery,
    emailService
  } = config;
  const authRateConfig = config.rateLimiting?.auth ?? {};
  const authLimiter = rateLimit({
    windowMs: authRateConfig.windowMs ?? 15 * 60 * 1e3,
    limit: authRateConfig.limit ?? 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      log2.warn({ limit: options.limit }, "auth rate limit exceeded");
      res.status(429).json({ error: "Too many requests. Please try again later." });
    }
  });
  router.use(cookieParser());
  if (config.csrf) {
    const { doubleCsrfProtection } = doubleCsrf({
      getSecret: () => config.csrf.secret,
      getSessionIdentifier: (req) => req.ip ?? "",
      cookieName: "__Host-csrf",
      cookieOptions: {
        httpOnly: true,
        sameSite: "strict",
        secure: true,
        path: "/"
      },
      ignoredMethods: ["GET", "HEAD", "OPTIONS"],
      getCsrfTokenFromRequest: (req) => req.headers["x-csrf-token"],
      // OAuth callback arrives cross-origin from provider; cannot carry CSRF cookie.
      // OAuth flow uses state parameter validation as its own CSRF defense.
      skipCsrfProtection: (req) => {
        return /^\/[^/]+\/callback$/.test(req.path);
      }
    });
    router.use(doubleCsrfProtection);
    log2.info("CSRF protection enabled for OAuth router (callback exempt)");
  }
  const oauthManager = config.oauthManager ?? createOAuthManager(
    {
      google: oauthConfig.google,
      github: oauthConfig.github,
      twitter: oauthConfig.twitter
    },
    db
  );
  router.use(json());
  router.get("/providers", (_req, res) => {
    res.json({
      providers: {
        google: oauthManager.isConfigured("google"),
        github: oauthManager.isConfigured("github"),
        twitter: oauthManager.isConfigured("twitter")
      }
    });
  });
  router.get("/:provider/start", authLimiter, async (req, res) => {
    try {
      const provider = req.params.provider;
      if (!["google", "github", "twitter"].includes(provider)) {
        return res.status(400).json({ error: "Invalid provider" });
      }
      if (!oauthManager.isConfigured(provider)) {
        return res.status(400).json({ error: `${provider} OAuth not configured` });
      }
      const redirectUri = `${oauthConfig.callbackBaseUrl}/${provider}`;
      const { url, state, codeVerifier } = await oauthManager.getAuthUrl(provider, redirectUri);
      if (codeVerifier) {
        res.cookie("oauth_code_verifier", codeVerifier, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 10 * 60 * 1e3
          // 10 minutes
        });
      }
      res.cookie("oauth_state", state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 10 * 60 * 1e3
      });
      return res.json({ url, state });
    } catch (error) {
      log2.error({ err: error }, "OAuth start error");
      return res.status(500).json({ error: "Failed to start OAuth flow" });
    }
  });
  router.post("/:provider/callback", authLimiter, async (req, res) => {
    try {
      if (req.cookies === void 0) {
        log2.error(
          "OAuth callback received request without req.cookies. Mount cookie-parser middleware before the OAuth router: app.use(cookieParser())"
        );
        return res.status(500).json({
          error: "Server configuration error: cookie-parser middleware is required"
        });
      }
      const body = validateBody(oauthCallbackBodySchema, req, res);
      if (!body) return;
      const provider = req.params.provider;
      const { code, state } = body;
      const oauthState = await oauthManager.validateState(state);
      if (!oauthState) {
        return res.status(400).json({ error: "Invalid state" });
      }
      const codeVerifier = oauthState.codeVerifier;
      res.clearCookie("oauth_state");
      res.clearCookie("oauth_code_verifier");
      const redirectUri = `${oauthConfig.callbackBaseUrl}/${provider}`;
      const tokens = await oauthManager.exchangeCode(provider, code, redirectUri, codeVerifier);
      const profile = await oauthManager.getProfile(provider, tokens.accessToken);
      let user = await db.getOAuthUserByProvider(provider, profile.providerId);
      if (user) {
        await sessionManager.createSession(user.id, res, {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"]
        });
        return res.json({
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
            nearAccountId: user.nearAccountId,
            type: "standard"
          },
          isNewUser: false
        });
      }
      if (profile.email) {
        user = await db.getOAuthUserByEmail(profile.email);
        if (user) {
          const providerData2 = {
            provider,
            providerId: profile.providerId,
            email: profile.email,
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            connectedAt: /* @__PURE__ */ new Date()
          };
          await db.linkOAuthProvider(user.id, providerData2);
          await sessionManager.createSession(user.id, res, {
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          });
          return res.json({
            success: true,
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              avatarUrl: user.avatarUrl,
              nearAccountId: user.nearAccountId,
              type: "standard"
            },
            isNewUser: false,
            linkedProvider: provider
          });
        }
      }
      const tempUserId = crypto.randomUUID();
      const mpcAccount = await mpcManager.createAccount(tempUserId);
      const providerData = {
        provider,
        providerId: profile.providerId,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        connectedAt: /* @__PURE__ */ new Date()
      };
      const newUser = await db.createOAuthUser({
        email: profile.email || `${profile.providerId}@${provider}.oauth`,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        nearAccountId: mpcAccount.nearAccountId,
        mpcPublicKey: mpcAccount.mpcPublicKey,
        derivationPath: mpcAccount.derivationPath,
        provider: providerData
      });
      if (ipfsRecovery && profile.email) {
        try {
          const recoveryPassword = crypto.randomUUID();
          const { cid } = await ipfsRecovery.createRecoveryBackup(
            {
              userId: newUser.id,
              nearAccountId: newUser.nearAccountId,
              derivationPath: newUser.derivationPath,
              createdAt: Date.now()
            },
            recoveryPassword
          );
          await db.storeRecoveryData({
            userId: newUser.id,
            type: "ipfs",
            reference: cid,
            createdAt: /* @__PURE__ */ new Date()
          });
          log2.info({ cid }, "Recovery backup created for new user");
          if (emailService && profile.email) {
            try {
              await emailService.sendRecoveryPassword(profile.email, recoveryPassword);
            } catch (emailErr) {
              log2.warn({ err: emailErr }, "Recovery email send failed \u2014 user registered but password not emailed");
            }
          } else if (!emailService) {
            log2.info("Email service not configured \u2014 recovery password not sent");
          }
        } catch (error) {
          log2.error({ err: error }, "Failed to create recovery backup");
        }
      }
      await sessionManager.createSession(newUser.id, res, {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]
      });
      return res.json({
        success: true,
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          avatarUrl: newUser.avatarUrl,
          nearAccountId: newUser.nearAccountId,
          type: "standard"
        },
        isNewUser: true
      });
    } catch (error) {
      log2.error({ err: error }, "OAuth callback error");
      return res.status(500).json({ error: "OAuth authentication failed" });
    }
  });
  router.post("/:provider/link", authLimiter, async (req, res) => {
    try {
      const session = await sessionManager.getSession(req);
      if (!session) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const body = validateBody(oauthLinkBodySchema, req, res);
      if (!body) return;
      const provider = req.params.provider;
      const { code, state, codeVerifier } = body;
      const redirectUri = `${oauthConfig.callbackBaseUrl}/${provider}`;
      const tokens = await oauthManager.exchangeCode(provider, code, redirectUri, codeVerifier);
      const profile = await oauthManager.getProfile(provider, tokens.accessToken);
      const existingUser = await db.getOAuthUserByProvider(provider, profile.providerId);
      if (existingUser && existingUser.id !== session.userId) {
        return res.status(400).json({ error: "This account is already linked to another user" });
      }
      const providerData = {
        provider,
        providerId: profile.providerId,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        connectedAt: /* @__PURE__ */ new Date()
      };
      await db.linkOAuthProvider(session.userId, providerData);
      return res.json({
        success: true,
        message: `${provider} account linked successfully`
      });
    } catch (error) {
      log2.error({ err: error }, "OAuth link error");
      return res.status(500).json({ error: "Failed to link provider" });
    }
  });
  return router;
}
function createAuthMiddleware(sessionManager, db, logger) {
  const log2 = (logger ?? pino3({ level: "silent" })).child({ module: "middleware" });
  return async (req, res, next) => {
    try {
      const session = await sessionManager.getSession(req);
      if (session) {
        const user = await db.getUserById(session.userId);
        if (user) {
          req.anonUser = user;
          req.anonSession = session;
          await sessionManager.refreshSession(req, res);
        }
      }
      next();
    } catch (error) {
      log2.error({ err: error }, "Middleware error");
      next();
    }
  };
}
function createRequireAuth(sessionManager, db, logger) {
  const log2 = (logger ?? pino3({ level: "silent" })).child({ module: "middleware" });
  return async (req, res, next) => {
    try {
      const session = await sessionManager.getSession(req);
      if (!session) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const user = await db.getUserById(session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      req.anonUser = user;
      req.anonSession = session;
      await sessionManager.refreshSession(req, res);
      next();
    } catch (error) {
      log2.error({ err: error }, "Auth check error");
      res.status(500).json({ error: "Authentication check failed" });
    }
  };
}
var NATO_PHONETIC = [
  "ALPHA",
  "BRAVO",
  "CHARLIE",
  "DELTA",
  "ECHO",
  "FOXTROT",
  "GOLF",
  "HOTEL",
  "INDIA",
  "JULIET",
  "KILO",
  "LIMA",
  "MIKE",
  "NOVEMBER",
  "OSCAR",
  "PAPA",
  "QUEBEC",
  "ROMEO",
  "SIERRA",
  "TANGO",
  "UNIFORM",
  "VICTOR",
  "WHISKEY",
  "XRAY",
  "YANKEE",
  "ZULU"
];
var ADJECTIVES = [
  "SWIFT",
  "SILENT",
  "SHADOW",
  "STEEL",
  "STORM",
  "FROST",
  "CRIMSON",
  "GOLDEN",
  "SILVER",
  "IRON",
  "DARK",
  "BRIGHT",
  "RAPID",
  "GHOST",
  "PHANTOM",
  "ARCTIC",
  "DESERT",
  "OCEAN",
  "MOUNTAIN",
  "FOREST",
  "THUNDER",
  "LIGHTNING",
  "COSMIC"
];
var ANIMALS = [
  "FALCON",
  "EAGLE",
  "HAWK",
  "WOLF",
  "BEAR",
  "LION",
  "TIGER",
  "PANTHER",
  "COBRA",
  "VIPER",
  "RAVEN",
  "OWL",
  "SHARK",
  "DRAGON",
  "PHOENIX",
  "GRIFFIN",
  "LEOPARD",
  "JAGUAR",
  "LYNX",
  "FOX",
  "ORCA",
  "RAPTOR",
  "CONDOR"
];
function randomSuffix() {
  const bytes = randomBytes(1);
  return bytes[0] % 99 + 1;
}
function randomPick(array) {
  const bytes = randomBytes(1);
  return array[bytes[0] % array.length];
}
function generateNatoCodename() {
  const word1 = randomPick(NATO_PHONETIC);
  const word2 = randomPick(NATO_PHONETIC);
  const num = randomSuffix();
  return `${word1}-${word2}-${num}`;
}
function generateAnimalCodename() {
  const adj = randomPick(ADJECTIVES);
  const animal = randomPick(ANIMALS);
  const num = randomSuffix();
  return `${adj}-${animal}-${num}`;
}
function generateCodename(style = "nato-phonetic") {
  switch (style) {
    case "nato-phonetic":
      return generateNatoCodename();
    case "animals":
      return generateAnimalCodename();
    default:
      return generateNatoCodename();
  }
}
function isValidCodename(codename) {
  const natoPattern = /^[A-Z]+(?:-[A-Z]+)?-\d{1,2}$/;
  const animalPattern = /^[A-Z]+-[A-Z]+-\d{1,2}$/;
  return natoPattern.test(codename) || animalPattern.test(codename);
}

// src/server/router.ts
function createRouter(config) {
  const log2 = (config.logger ?? pino3({ level: "silent" })).child({ module: "router" });
  const router = Router();
  const {
    db,
    sessionManager,
    passkeyManager,
    mpcManager,
    walletRecovery,
    ipfsRecovery
  } = config;
  const authRateConfig = config.rateLimiting?.auth ?? {};
  const recoveryRateConfig = config.rateLimiting?.recovery ?? {};
  const authLimiter = rateLimit({
    windowMs: authRateConfig.windowMs ?? 15 * 60 * 1e3,
    limit: authRateConfig.limit ?? 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      log2.warn({ limit: options.limit }, "auth rate limit exceeded");
      res.status(429).json({ error: "Too many requests. Please try again later." });
    }
  });
  const recoveryLimiter = rateLimit({
    windowMs: recoveryRateConfig.windowMs ?? 60 * 60 * 1e3,
    limit: recoveryRateConfig.limit ?? 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      log2.warn({ limit: options.limit }, "recovery rate limit exceeded");
      res.status(429).json({ error: "Too many recovery attempts. Please try again later." });
    }
  });
  if (config.csrf) {
    const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
      getSecret: () => config.csrf.secret,
      getSessionIdentifier: (req) => req.ip ?? "",
      cookieName: "__Host-csrf",
      cookieOptions: {
        httpOnly: true,
        sameSite: "strict",
        secure: true,
        path: "/"
      },
      ignoredMethods: ["GET", "HEAD", "OPTIONS"],
      getCsrfTokenFromRequest: (req) => req.headers["x-csrf-token"]
    });
    router.use(cookieParser());
    router.use(doubleCsrfProtection);
    router.get("/csrf-token", (req, res) => {
      res.json({ token: generateCsrfToken(req, res) });
    });
    log2.info("CSRF protection enabled");
  }
  router.use(json());
  router.post("/register/start", authLimiter, async (req, res) => {
    try {
      const body = validateBody(registerStartBodySchema, req, res);
      if (!body) return;
      const tempUserId = crypto.randomUUID();
      const style = config.codename?.style || "nato-phonetic";
      let codename;
      if (config.codename?.generator) {
        codename = config.codename.generator(tempUserId);
      } else {
        codename = generateCodename(style);
      }
      let attempts = 0;
      while (await db.getUserByCodename(codename) && attempts < 10) {
        codename = generateCodename(style);
        attempts++;
      }
      if (attempts >= 10) {
        return res.status(500).json({ error: "Failed to generate unique codename" });
      }
      const { challengeId, options } = await passkeyManager.startRegistration(
        tempUserId,
        codename
      );
      res.json({
        challengeId,
        options,
        codename,
        tempUserId
      });
    } catch (error) {
      log2.error({ err: error }, "Registration start error");
      res.status(500).json({ error: "Registration failed" });
    }
  });
  router.post("/register/finish", authLimiter, async (req, res) => {
    try {
      const body = validateBody(registerFinishBodySchema, req, res);
      if (!body) return;
      const { challengeId, response, tempUserId, codename } = body;
      if (!isValidCodename(codename)) {
        return res.status(400).json({ error: "Invalid codename format" });
      }
      const { verified, passkeyData } = await passkeyManager.finishRegistration(
        challengeId,
        response
      );
      if (!verified || !passkeyData) {
        return res.status(400).json({ error: "Passkey verification failed" });
      }
      const mpcAccount = await mpcManager.createAccount(tempUserId);
      const doRegistration = async (adapter) => {
        const user2 = await adapter.createUser({
          codename,
          nearAccountId: mpcAccount.nearAccountId,
          mpcPublicKey: mpcAccount.mpcPublicKey,
          derivationPath: mpcAccount.derivationPath
        });
        await adapter.createPasskey({
          credentialId: passkeyData.credentialId,
          userId: user2.id,
          publicKey: passkeyData.publicKey,
          counter: passkeyData.counter,
          deviceType: passkeyData.deviceType,
          backedUp: passkeyData.backedUp,
          transports: passkeyData.transports
        });
        const session = await sessionManager.createSession(user2.id, res, {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"]
        });
        return { user: user2, session };
      };
      const { user } = db.transaction ? await db.transaction(doRegistration) : await doRegistration(db);
      res.json({
        success: true,
        codename: user.codename,
        nearAccountId: user.nearAccountId
      });
    } catch (error) {
      log2.error({ err: error }, "Registration finish error");
      res.status(500).json({ error: "Registration failed" });
    }
  });
  router.post("/login/start", authLimiter, async (req, res) => {
    try {
      const body = validateBody(loginStartBodySchema, req, res);
      if (!body) return;
      const { codename } = body;
      let userId;
      if (codename) {
        const user = await db.getUserByCodename(codename);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
        userId = user.id;
      }
      const { challengeId, options } = await passkeyManager.startAuthentication(userId);
      res.json({ challengeId, options });
    } catch (error) {
      log2.error({ err: error }, "Login start error");
      res.status(500).json({ error: "Login failed" });
    }
  });
  router.post("/login/finish", authLimiter, async (req, res) => {
    try {
      const body = validateBody(loginFinishBodySchema, req, res);
      if (!body) return;
      const { challengeId, response } = body;
      const { verified, userId } = await passkeyManager.finishAuthentication(
        challengeId,
        response
      );
      if (!verified || !userId) {
        return res.status(401).json({ error: "Authentication failed" });
      }
      const user = await db.getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      await sessionManager.createSession(user.id, res, {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]
      });
      res.json({
        success: true,
        codename: user.codename
      });
    } catch (error) {
      log2.error({ err: error }, "Login finish error");
      res.status(500).json({ error: "Authentication failed" });
    }
  });
  router.post("/logout", authLimiter, async (req, res) => {
    try {
      const body = validateBody(logoutBodySchema, req, res);
      if (!body) return;
      await sessionManager.destroySession(req, res);
      res.json({ success: true });
    } catch (error) {
      log2.error({ err: error }, "Logout error");
      res.status(500).json({ error: "Logout failed" });
    }
  });
  router.get("/session", async (req, res) => {
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
        expiresAt: session.expiresAt
      });
    } catch (error) {
      log2.error({ err: error }, "Session check error");
      res.status(500).json({ error: "Session check failed" });
    }
  });
  if (walletRecovery) {
    router.post("/recovery/wallet/link", recoveryLimiter, async (req, res) => {
      try {
        const body = validateBody(walletLinkBodySchema, req, res);
        if (!body) return;
        const session = await sessionManager.getSession(req);
        if (!session) {
          return res.status(401).json({ error: "Authentication required" });
        }
        const { challenge: walletChallenge, expiresAt } = walletRecovery.generateLinkChallenge();
        await db.storeChallenge({
          id: crypto.randomUUID(),
          challenge: walletChallenge,
          type: "recovery",
          userId: session.userId,
          expiresAt,
          metadata: { action: "wallet-link" }
        });
        res.json({
          challenge: walletChallenge,
          expiresAt: expiresAt.toISOString()
        });
      } catch (error) {
        log2.error({ err: error }, "Wallet link error");
        res.status(500).json({ error: "Failed to initiate wallet link" });
      }
    });
    router.post("/recovery/wallet/verify", recoveryLimiter, async (req, res) => {
      try {
        const session = await sessionManager.getSession(req);
        if (!session) {
          return res.status(401).json({ error: "Authentication required" });
        }
        const body = validateBody(walletVerifyBodySchema, req, res);
        if (!body) return;
        const { signature, challenge, walletAccountId } = body;
        const { verified } = walletRecovery.verifyLinkSignature(
          signature,
          challenge
        );
        if (!verified) {
          return res.status(401).json({ error: "Invalid signature" });
        }
        const user = await db.getUserById(session.userId);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
        await mpcManager.addRecoveryWallet(user.nearAccountId, signature.publicKey);
        await db.storeRecoveryData({
          userId: user.id,
          type: "wallet",
          reference: signature.publicKey,
          createdAt: /* @__PURE__ */ new Date()
        });
        res.json({
          success: true,
          message: "Wallet linked for recovery. The link is stored on-chain, not in our database."
        });
      } catch (error) {
        log2.error({ err: error }, "Wallet verify error");
        res.status(500).json({ error: "Failed to verify wallet" });
      }
    });
    router.post("/recovery/wallet/start", recoveryLimiter, async (req, res) => {
      try {
        const body = validateBody(walletStartBodySchema, req, res);
        if (!body) return;
        const { challenge, expiresAt } = walletRecovery.generateRecoveryChallenge();
        res.json({
          challenge,
          expiresAt: expiresAt.toISOString()
        });
      } catch (error) {
        log2.error({ err: error }, "Wallet recovery start error");
        res.status(500).json({ error: "Failed to start recovery" });
      }
    });
    router.post("/recovery/wallet/finish", recoveryLimiter, async (req, res) => {
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
          return res.status(401).json({ error: "Recovery verification failed" });
        }
        const user = await db.getUserByNearAccount(nearAccountId);
        if (!user) {
          return res.status(404).json({ error: "Account not found" });
        }
        await sessionManager.createSession(user.id, res, {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"]
        });
        res.json({
          success: true,
          codename: user.codename,
          message: "Recovery successful. You can now register a new passkey."
        });
      } catch (error) {
        log2.error({ err: error }, "Wallet recovery finish error");
        res.status(500).json({ error: "Recovery failed" });
      }
    });
  }
  if (ipfsRecovery) {
    router.post("/recovery/ipfs/setup", recoveryLimiter, async (req, res) => {
      try {
        const session = await sessionManager.getSession(req);
        if (!session) {
          return res.status(401).json({ error: "Authentication required" });
        }
        const body = validateBody(ipfsSetupBodySchema, req, res);
        if (!body) return;
        const { password } = body;
        const validation = ipfsRecovery.validatePassword(password);
        if (!validation.valid) {
          return res.status(400).json({
            error: "Password too weak",
            details: validation.errors
          });
        }
        const user = await db.getUserById(session.userId);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
        const { cid } = await ipfsRecovery.createRecoveryBackup(
          {
            userId: user.id,
            nearAccountId: user.nearAccountId,
            derivationPath: user.derivationPath,
            createdAt: Date.now()
          },
          password
        );
        await db.storeRecoveryData({
          userId: user.id,
          type: "ipfs",
          reference: cid,
          createdAt: /* @__PURE__ */ new Date()
        });
        res.json({
          success: true,
          cid,
          message: "Backup created. Save this CID with your password - you need both to recover."
        });
      } catch (error) {
        log2.error({ err: error }, "IPFS setup error");
        res.status(500).json({ error: "Failed to create backup" });
      }
    });
    router.post("/recovery/ipfs/recover", recoveryLimiter, async (req, res) => {
      try {
        const body = validateBody(ipfsRecoverBodySchema, req, res);
        if (!body) return;
        const { cid, password } = body;
        let payload;
        try {
          payload = await ipfsRecovery.recoverFromBackup(cid, password);
        } catch {
          return res.status(401).json({ error: "Invalid password or CID" });
        }
        const user = await db.getUserById(payload.userId);
        if (!user) {
          return res.status(404).json({ error: "Account not found" });
        }
        await sessionManager.createSession(user.id, res, {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"]
        });
        res.json({
          success: true,
          codename: user.codename,
          message: "Recovery successful. You can now register a new passkey."
        });
      } catch (error) {
        log2.error({ err: error }, "IPFS recovery error");
        res.status(500).json({ error: "Recovery failed" });
      }
    });
  }
  router.post("/account/reregister-passkey", authLimiter, async (req, res) => {
    try {
      const session = await sessionManager.getSession(req);
      if (!session) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const user = await db.getUserById(session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const { challengeId, options } = await passkeyManager.startRegistration(
        user.id,
        user.codename
      );
      res.json({ challengeId, options });
    } catch (error) {
      log2.error({ err: error }, "Passkey re-registration error");
      res.status(500).json({ error: "Failed to start re-registration" });
    }
  });
  router.delete("/account", authLimiter, async (req, res) => {
    try {
      const session = await sessionManager.getSession(req);
      if (!session) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (!db.deleteUser) {
        return res.status(501).json({ error: "Account deletion not supported by database adapter" });
      }
      const userId = session.userId;
      await sessionManager.destroySession(req, res);
      await db.deleteUserSessions(userId);
      if (db.deleteRecoveryData) {
        await db.deleteRecoveryData(userId);
      }
      await db.deleteUser(userId);
      res.json({ success: true });
    } catch (error) {
      log2.error({ err: error }, "Account deletion error");
      res.status(500).json({ error: "Account deletion failed" });
    }
  });
  return router;
}

// src/server/cleanup.ts
function createCleanupScheduler(db, log2, intervalMs = 5 * 60 * 1e3) {
  const handle = setInterval(async () => {
    try {
      const sessions = await db.cleanExpiredSessions();
      const challenges = await db.cleanExpiredChallenges?.() ?? 0;
      const oauthStates = await db.cleanExpiredOAuthStates?.() ?? 0;
      if (sessions > 0 || challenges > 0 || oauthStates > 0) {
        log2.info({ sessions, challenges, oauthStates }, "Cleanup complete");
      }
    } catch (err) {
      log2.error({ err }, "Cleanup failed");
    }
  }, intervalMs);
  handle.unref();
  return {
    stop() {
      clearInterval(handle);
    }
  };
}
var log = pino3({ level: "silent" }).child({ module: "webauthn" });
async function createRegistrationOptions(input) {
  const {
    rpName,
    rpId,
    userName,
    userDisplayName = userName,
    userId,
    excludeCredentials = [],
    timeout = 6e4
  } = input;
  const userIdBytes = userId ? new TextEncoder().encode(userId) : crypto.getRandomValues(new Uint8Array(32));
  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userName,
    userDisplayName,
    userID: userIdBytes,
    attestationType: "none",
    // We don't need attestation for most use cases
    excludeCredentials: excludeCredentials.map((cred) => ({
      id: cred.id,
      type: "public-key",
      transports: cred.transports
    })),
    authenticatorSelection: {
      residentKey: "required",
      // Enable discoverable credentials (login without username)
      userVerification: "preferred"
      // Don't restrict authenticator attachment - allow both platform and hardware keys
    },
    timeout
  });
  return {
    options,
    challenge: options.challenge
  };
}
async function verifyRegistration(input) {
  const { response, expectedChallenge, expectedOrigin, expectedRPID } = input;
  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID
    });
    if (!verification.verified || !verification.registrationInfo) {
      return { verified: false, error: "Verification failed" };
    }
    const { registrationInfo } = verification;
    return {
      verified: true,
      credential: {
        id: registrationInfo.credential.id,
        publicKey: registrationInfo.credential.publicKey,
        counter: registrationInfo.credential.counter,
        deviceType: registrationInfo.credentialDeviceType,
        backedUp: registrationInfo.credentialBackedUp,
        transports: response.response.transports
      }
    };
  } catch (error) {
    log.error({ err: error }, "Registration verification error");
    return {
      verified: false,
      error: error instanceof Error ? error.message : "Verification failed"
    };
  }
}
async function createAuthenticationOptions(input) {
  const { rpId, allowCredentials, timeout = 6e4 } = input;
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: "preferred",
    allowCredentials: allowCredentials?.map((cred) => ({
      id: cred.id,
      type: "public-key",
      transports: cred.transports
    })),
    timeout
  });
  return {
    options,
    challenge: options.challenge
  };
}
async function verifyAuthentication(input) {
  const { response, expectedChallenge, expectedOrigin, expectedRPID, credential } = input;
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports
      }
    });
    if (!verification.verified) {
      return { verified: false, error: "Verification failed" };
    }
    return {
      verified: true,
      newCounter: verification.authenticationInfo.newCounter
    };
  } catch (error) {
    log.error({ err: error }, "Authentication verification error");
    return {
      verified: false,
      error: error instanceof Error ? error.message : "Verification failed"
    };
  }
}
function base64urlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64url(bytes) {
  const binary = String.fromCharCode(...bytes);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// src/server/index.ts
function createAnonAuth(config) {
  const logger = config.logger ?? pino3({ level: "silent" });
  let db;
  if (config.database.adapter) {
    db = config.database.adapter;
  } else if (config.database.type === "postgres") {
    if (!config.database.connectionString) {
      throw new Error("PostgreSQL requires connectionString");
    }
    db = createPostgresAdapter({
      connectionString: config.database.connectionString
    });
  } else if (config.database.type === "custom") {
    if (!config.database.adapter) {
      throw new Error("Custom database type requires adapter");
    }
    db = config.database.adapter;
  } else {
    throw new Error(`Unsupported database type: ${config.database.type}`);
  }
  const sessionManager = createSessionManager(db, {
    secret: config.sessionSecret,
    durationMs: config.sessionDurationMs,
    logger
  });
  const rpConfig = config.rp || {
    name: "Anonymous Auth",
    id: "localhost",
    origin: "http://localhost:3000"
  };
  const passkeyManager = createPasskeyManager(db, {
    rpName: rpConfig.name,
    rpId: rpConfig.id,
    origin: rpConfig.origin,
    logger
  });
  const mpcManager = createMPCManager({
    networkId: config.nearNetwork,
    accountPrefix: config.mpc?.accountPrefix || "anon",
    treasuryAccount: config.mpc?.treasuryAccount,
    treasuryPrivateKey: config.mpc?.treasuryPrivateKey,
    fundingAmount: config.mpc?.fundingAmount,
    derivationSalt: config.mpc?.derivationSalt ?? config.derivationSalt,
    logger
  });
  let walletRecovery;
  let ipfsRecovery;
  if (config.recovery?.wallet) {
    walletRecovery = createWalletRecoveryManager({
      nearNetwork: config.nearNetwork,
      logger
    });
  }
  if (config.recovery?.ipfs) {
    ipfsRecovery = createIPFSRecoveryManager({
      ...config.recovery.ipfs,
      logger
    });
  }
  let emailService;
  if (config.email) {
    emailService = createEmailService(config.email, logger);
  }
  let oauthManager;
  let oauthRouter;
  if (config.oauth) {
    oauthManager = createOAuthManager(
      {
        google: config.oauth.google,
        github: config.oauth.github,
        twitter: config.oauth.twitter
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
      oauthManager
    });
  }
  const middleware = createAuthMiddleware(sessionManager, db, logger);
  const requireAuth = createRequireAuth(sessionManager, db, logger);
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
    csrf: config.csrf
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
    oauthManager
  };
}

export { POSTGRES_SCHEMA, base64urlToUint8Array, createAnonAuth, createAuthenticationOptions, createCleanupScheduler, createEmailService, createOAuthManager, createOAuthRouter, createPostgresAdapter, createRegistrationOptions, generateCodename, isValidCodename, uint8ArrayToBase64url, verifyAuthentication, verifyRegistration };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map