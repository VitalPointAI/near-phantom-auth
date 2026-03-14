/**
 * Session Manager Tests
 *
 * SEC-01: Constant-time signature verification
 * BUG-03: refreshSession should call updateSessionExpiry on adapter when available
 */

import { describe, it, vi, beforeEach } from 'vitest';
import { createSessionManager } from '../server/session.js';
import type { DatabaseAdapter, Session, CreateSessionInput } from '../types/index.js';

// ============================================
// Mock helpers
// ============================================

function makeMockDb(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
  const sessions = new Map<string, Session>();

  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    createUser: vi.fn(),
    getUserById: vi.fn(),
    getUserByCodename: vi.fn(),
    getUserByNearAccount: vi.fn(),
    createOAuthUser: vi.fn(),
    getOAuthUserById: vi.fn(),
    getOAuthUserByEmail: vi.fn(),
    getOAuthUserByProvider: vi.fn(),
    linkOAuthProvider: vi.fn(),
    createPasskey: vi.fn(),
    getPasskeyById: vi.fn(),
    getPasskeysByUserId: vi.fn(),
    updatePasskeyCounter: vi.fn(),
    deletePasskey: vi.fn(),
    createSession: vi.fn().mockImplementation(async (input: CreateSessionInput & { id?: string }) => {
      const session: Session = {
        id: input.id ?? 'test-session-id',
        userId: input.userId,
        createdAt: new Date(),
        expiresAt: input.expiresAt,
        lastActivityAt: new Date(),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      };
      sessions.set(session.id, session);
      return session;
    }),
    getSession: vi.fn().mockImplementation(async (sessionId: string) => {
      return sessions.get(sessionId) ?? null;
    }),
    deleteSession: vi.fn().mockImplementation(async (sessionId: string) => {
      sessions.delete(sessionId);
    }),
    deleteUserSessions: vi.fn().mockResolvedValue(undefined),
    cleanExpiredSessions: vi.fn().mockResolvedValue(0),
    storeChallenge: vi.fn(),
    getChallenge: vi.fn(),
    deleteChallenge: vi.fn(),
    storeRecoveryData: vi.fn(),
    getRecoveryData: vi.fn(),
    ...overrides,
  };
}

function makeMockRes() {
  const cookies: Record<string, { value: string; options: Record<string, unknown> }> = {};
  return {
    cookie: vi.fn().mockImplementation((name: string, value: string, options: Record<string, unknown>) => {
      cookies[name] = { value, options };
    }),
    clearCookie: vi.fn(),
    _cookies: cookies,
  };
}

function makeMockReq(cookieHeader?: string) {
  return {
    headers: {
      cookie: cookieHeader,
    },
  };
}

const TEST_SECRET = 'test-session-secret-at-least-32-chars-long';
const COOKIE_NAME = 'anon_session';

// ============================================
// SEC-01: Signature verification
// ============================================

describe('verifySessionId - SEC-01', () => {
  it.todo('returns sessionId for valid signed value');
  it.todo('returns null for tampered signature');
  it.todo('returns null for truncated signature');
  it.todo('uses constant-time comparison');
});

// ============================================
// BUG-03: refreshSession adapter integration
// ============================================

describe('refreshSession - BUG-03', () => {
  let db: DatabaseAdapter;

  beforeEach(() => {
    db = makeMockDb();
  });

  it.todo('calls updateSessionExpiry on adapter when method exists');
  it.todo('falls back to cookie-only when adapter lacks updateSessionExpiry');
  it.todo('logs warning once on fallback, not on every call');
});
