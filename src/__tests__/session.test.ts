/**
 * Session Manager Tests
 *
 * SEC-01: Constant-time signature verification
 * BUG-03: refreshSession should call updateSessionExpiry on adapter when available
 */

import { describe, it, vi, beforeEach } from 'vitest';
import pino from 'pino';
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
// SESSION-01..03: Session metadata privacy
// ============================================

describe('Session metadata privacy', () => {
  it('default absent metadata policy stores raw ipAddress and userAgent', async () => {
    const db = makeMockDb();
    const manager = createSessionManager(db, { secret: TEST_SECRET });
    const mockRes = makeMockRes();

    await manager.createSession('user1', mockRes as never, {
      ipAddress: '203.0.113.42',
      userAgent: 'Mozilla/5.0 test',
    });

    expect(db.createSession).toHaveBeenCalledOnce();
    const input = (db.createSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.ipAddress).toBe('203.0.113.42');
    expect(input.userAgent).toBe('Mozilla/5.0 test');
  });

  it('omit policy stores undefined for ipAddress and userAgent', async () => {
    const db = makeMockDb();
    const manager = createSessionManager(db, {
      secret: TEST_SECRET,
      metadata: { ipAddress: 'omit', userAgent: 'omit' },
    });
    const mockRes = makeMockRes();

    await manager.createSession('user1', mockRes as never, {
      ipAddress: '203.0.113.42',
      userAgent: 'Mozilla/5.0 test',
    });

    const input = (db.createSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.ipAddress).toBeUndefined();
    expect(input.userAgent).toBeUndefined();
  });

  it('hash policy stores deterministic HMAC values instead of raw metadata', async () => {
    const db = makeMockDb();
    const manager = createSessionManager(db, {
      secret: TEST_SECRET,
      metadata: { ipAddress: 'hash', userAgent: 'hash' },
    });
    const mockRes = makeMockRes();

    await manager.createSession('user1', mockRes as never, {
      ipAddress: '203.0.113.42',
      userAgent: 'Mozilla/5.0 test',
    });

    const input = (db.createSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.ipAddress).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect(input.userAgent).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect(input.ipAddress).not.toBe('203.0.113.42');
    expect(input.userAgent).not.toBe('Mozilla/5.0 test');
  });

  it('truncate policy stores an IPv4 /24 prefix instead of the full raw IP', async () => {
    const db = makeMockDb();
    const manager = createSessionManager(db, {
      secret: TEST_SECRET,
      metadata: { ipAddress: 'truncate' },
    });
    const mockRes = makeMockRes();

    await manager.createSession('user1', mockRes as never, {
      ipAddress: '203.0.113.42',
      userAgent: 'Mozilla/5.0 test',
    });

    const input = (db.createSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.ipAddress).toBe('203.0.113.0/24');
    expect(input.userAgent).toBe('Mozilla/5.0 test');
  });

  it('truncate policy omits malformed IPs instead of storing raw untrusted input', async () => {
    const db = makeMockDb();
    const manager = createSessionManager(db, {
      secret: TEST_SECRET,
      metadata: { ipAddress: 'truncate' },
    });
    const mockRes = makeMockRes();

    await manager.createSession('user1', mockRes as never, {
      ipAddress: 'not-an-ip',
      userAgent: 'Mozilla/5.0 test',
    });

    const input = (db.createSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.ipAddress).toBeUndefined();
    expect(input.userAgent).toBe('Mozilla/5.0 test');
  });
});

// ============================================
// SEC-01: Signature verification
// ============================================

describe('verifySessionId - SEC-01', () => {
  it('returns sessionId for valid signed value', async () => {
    const db = makeMockDb();
    const manager = createSessionManager(db, { secret: TEST_SECRET });
    const mockRes = makeMockRes();

    const session = await manager.createSession('user1', mockRes as never);
    const signedCookie = mockRes._cookies[COOKIE_NAME]?.value;

    expect(signedCookie).toBeTruthy();

    const mockReq = makeMockReq(`${COOKIE_NAME}=${encodeURIComponent(signedCookie!)}`);
    const retrieved = await manager.getSession(mockReq as never);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(session.id);
  });

  it('returns null for tampered signature (altered bytes)', async () => {
    const db = makeMockDb();
    const manager = createSessionManager(db, { secret: TEST_SECRET });
    const mockRes = makeMockRes();

    await manager.createSession('user1', mockRes as never);
    const signedCookie = mockRes._cookies[COOKIE_NAME]?.value;
    expect(signedCookie).toBeTruthy();

    // Tamper with the signature portion
    const dotIdx = signedCookie!.lastIndexOf('.');
    const sessionId = signedCookie!.substring(0, dotIdx);
    const sig = signedCookie!.substring(dotIdx + 1);
    // Replace first char of signature with a different char
    const tamperedSig = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1);
    const tampered = `${sessionId}.${tamperedSig}`;

    const mockReq = makeMockReq(`${COOKIE_NAME}=${encodeURIComponent(tampered)}`);
    const retrieved = await manager.getSession(mockReq as never);

    expect(retrieved).toBeNull();
  });

  it('returns null for truncated signature (shorter than expected)', async () => {
    const db = makeMockDb();
    const manager = createSessionManager(db, { secret: TEST_SECRET });
    const mockRes = makeMockRes();

    await manager.createSession('user1', mockRes as never);
    const signedCookie = mockRes._cookies[COOKIE_NAME]?.value;
    expect(signedCookie).toBeTruthy();

    // Truncate the signature
    const dotIdx = signedCookie!.lastIndexOf('.');
    const sessionId = signedCookie!.substring(0, dotIdx);
    const sig = signedCookie!.substring(dotIdx + 1);
    const truncatedSig = sig.slice(0, -5);
    const truncated = `${sessionId}.${truncatedSig}`;

    const mockReq = makeMockReq(`${COOKIE_NAME}=${encodeURIComponent(truncated)}`);
    const retrieved = await manager.getSession(mockReq as never);

    expect(retrieved).toBeNull();
  });

  it('returns null for signature with appended bytes (longer than expected)', async () => {
    const db = makeMockDb();
    const manager = createSessionManager(db, { secret: TEST_SECRET });
    const mockRes = makeMockRes();

    await manager.createSession('user1', mockRes as never);
    const signedCookie = mockRes._cookies[COOKIE_NAME]?.value;
    expect(signedCookie).toBeTruthy();

    // Append bytes to the signature
    const extended = `${signedCookie}XXXXXX`;

    const mockReq = makeMockReq(`${COOKIE_NAME}=${encodeURIComponent(extended)}`);
    const retrieved = await manager.getSession(mockReq as never);

    expect(retrieved).toBeNull();
  });
});

// ============================================
// BUG-03: refreshSession adapter integration
// ============================================

describe('refreshSession - BUG-03', () => {
  it('calls updateSessionExpiry on adapter when method exists', async () => {
    const updateSessionExpiry = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({ updateSessionExpiry });

    // Use short duration so 50% threshold is easy to trigger
    const manager = createSessionManager(db, {
      secret: TEST_SECRET,
      durationMs: 2000,
    });
    const mockRes = makeMockRes();

    await manager.createSession('user1', mockRes as never);
    const signedCookie = mockRes._cookies[COOKIE_NAME]?.value;

    // Backdate createdAt so elapsed > 50% of durationMs
    const sessions = (db.getSession as ReturnType<typeof vi.fn>).getMockImplementation();
    // Override getSession to return session with backdated createdAt
    const storedSession = await db.getSession('any');
    // Find the session id from the signed cookie
    const dotIdx = signedCookie!.lastIndexOf('.');
    const sessionId = signedCookie!.substring(0, dotIdx);

    // Manually update createdAt in the mock db sessions map by re-mocking getSession
    const backdatedSession = {
      id: sessionId,
      userId: 'user1',
      createdAt: new Date(Date.now() - 1500), // 1500ms ago, past 50% of 2000ms
      expiresAt: new Date(Date.now() + 500),
      lastActivityAt: new Date(),
    };

    const dbWithBackdated = makeMockDb({
      updateSessionExpiry,
      getSession: vi.fn().mockResolvedValue(backdatedSession),
    });
    const manager2 = createSessionManager(dbWithBackdated, {
      secret: TEST_SECRET,
      durationMs: 2000,
    });

    const mockReq = makeMockReq(`${COOKIE_NAME}=${encodeURIComponent(signedCookie!)}`);
    const mockRes2 = makeMockRes();
    await manager2.refreshSession(mockReq as never, mockRes2 as never);

    expect(updateSessionExpiry).toHaveBeenCalledOnce();
    expect(updateSessionExpiry).toHaveBeenCalledWith(sessionId, expect.any(Date));
  });

  it('falls back to cookie-only when adapter lacks updateSessionExpiry', async () => {
    const db = makeMockDb(); // no updateSessionExpiry

    const manager = createSessionManager(db, {
      secret: TEST_SECRET,
      durationMs: 2000,
    });
    const mockRes = makeMockRes();
    await manager.createSession('user1', mockRes as never);
    const signedCookie = mockRes._cookies[COOKIE_NAME]?.value;
    const dotIdx = signedCookie!.lastIndexOf('.');
    const sessionId = signedCookie!.substring(0, dotIdx);

    const backdatedSession = {
      id: sessionId,
      userId: 'user1',
      createdAt: new Date(Date.now() - 1500),
      expiresAt: new Date(Date.now() + 500),
      lastActivityAt: new Date(),
    };

    const dbNoExpiry = makeMockDb({
      getSession: vi.fn().mockResolvedValue(backdatedSession),
    });
    const manager2 = createSessionManager(dbNoExpiry, {
      secret: TEST_SECRET,
      durationMs: 2000,
    });

    const mockReq = makeMockReq(`${COOKIE_NAME}=${encodeURIComponent(signedCookie!)}`);
    const mockRes2 = makeMockRes();

    // Should NOT throw
    await expect(
      manager2.refreshSession(mockReq as never, mockRes2 as never)
    ).resolves.not.toThrow();
  });

  it('logs warning once on fallback, not on every call', async () => {
    const warnMessages: string[] = [];
    const stream = { write: (msg: string) => {
      const entry = JSON.parse(msg);
      if (entry.level === 40) warnMessages.push(entry.msg); // 40 = warn level in pino
    }};
    const logger = pino({ level: 'warn' }, stream as any);

    const sessionId = 'test-session-123';

    const backdatedSession = {
      id: sessionId,
      userId: 'user1',
      createdAt: new Date(Date.now() - 1500),
      expiresAt: new Date(Date.now() + 500),
      lastActivityAt: new Date(),
    };

    const dbNoExpiry = makeMockDb({
      getSession: vi.fn().mockResolvedValue(backdatedSession),
    });

    // Use fresh manager instance (module-level flag may be set from previous tests)
    // We create a fresh signed cookie by signing the session id manually
    const { createHmac } = await import('crypto');
    const sig = createHmac('sha256', TEST_SECRET).update(sessionId).digest('base64url');
    const signedCookie = `${sessionId}.${sig}`;

    const manager = createSessionManager(dbNoExpiry, {
      secret: TEST_SECRET,
      durationMs: 2000,
      logger,
    });

    const mockReq = makeMockReq(`${COOKIE_NAME}=${encodeURIComponent(signedCookie)}`);

    await manager.refreshSession(mockReq as never, makeMockRes() as never);
    await manager.refreshSession(mockReq as never, makeMockRes() as never);
    await manager.refreshSession(mockReq as never, makeMockRes() as never);

    // Warning should be logged at most once per manager instance
    const cookieOnlyWarnings = warnMessages.filter(msg =>
      msg.includes('Session refresh is cookie-only')
    );
    expect(cookieOnlyWarnings.length).toBe(1);
  });
});
