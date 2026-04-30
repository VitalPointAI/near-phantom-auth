/**
 * Session Management
 * 
 * HttpOnly cookie-based sessions for XSS protection.
 * Sessions are stored server-side (database) with secure cookie reference.
 */

import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import { isIP } from 'net';
import type { Response, Request } from 'express';
import type { Session, CreateSessionInput, DatabaseAdapter, SessionMetadataConfig } from '../types/index.js';
import pino from 'pino';
import type { Logger } from 'pino';

const SESSION_COOKIE_NAME = 'anon_session';
const DEFAULT_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SessionConfig {
  /** Secret for signing session cookies */
  secret: string;
  /** Cookie name (default: anon_session) */
  cookieName?: string;
  /** Session duration in ms (default: 7 days) */
  durationMs?: number;
  /** Cookie domain (optional) */
  domain?: string;
  /** Cookie path (default: /) */
  path?: string;
  /** Secure flag (default: true in production) */
  secure?: boolean;
  /** SameSite setting (default: strict) */
  sameSite?: 'strict' | 'lax' | 'none';
  /** Controls raw, omitted, hashed, or truncated session metadata persistence. */
  metadata?: SessionMetadataConfig;
  /** Optional pino logger instance. If omitted, logging is disabled (no output). */
  logger?: Logger;
}

export interface SessionManager {
  createSession(
    userId: string,
    res: Response,
    options?: { ipAddress?: string; userAgent?: string }
  ): Promise<Session>;
  
  getSession(req: Request): Promise<Session | null>;
  
  destroySession(req: Request, res: Response): Promise<void>;
  
  refreshSession(req: Request, res: Response): Promise<Session | null>;
}

/**
 * Sign a session ID with HMAC
 */
function signSessionId(sessionId: string, secret: string): string {
  const signature = createHmac('sha256', secret)
    .update(sessionId)
    .digest('base64url');
  return `${sessionId}.${signature}`;
}

/**
 * Verify and extract session ID from signed value
 */
function verifySessionId(signedValue: string, secret: string): string | null {
  const parts = signedValue.split('.');
  if (parts.length !== 2) return null;

  const [sessionId, signature] = parts;
  const expectedSignature = createHmac('sha256', secret)
    .update(sessionId)
    .digest('base64url');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(sigBuffer, expectedBuffer)) return null;
  return sessionId;
}

/**
 * Parse cookies from request
 */
function parseCookies(req: Request): Record<string, string> {
  const cookies: Record<string, string> = {};
  const cookieHeader = req.headers.cookie;
  
  if (!cookieHeader) return cookies;
  
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name && rest.length) {
      cookies[name] = decodeURIComponent(rest.join('='));
    }
  });
  
  return cookies;
}

function hmacMetadata(value: string, secret: string): string {
  return `hmac-sha256:${createHmac('sha256', secret).update(value).digest('hex')}`;
}

function truncateIpAddress(value: string): string | undefined {
  const ip = value.trim();

  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.');
    return `${a}.${b}.${c}.0/24`;
  }

  if (isIP(ip) === 6) {
    const expanded = expandIpv6(ip);
    if (!expanded) return undefined;
    return `${expanded.slice(0, 3).join(':')}::/48`;
  }

  return undefined;
}

function expandIpv6(value: string): string[] | undefined {
  if (value.includes(':::')) return undefined;

  const [headRaw, tailRaw] = value.split('::');
  if (value.split('::').length > 2) return undefined;

  const head = headRaw ? headRaw.split(':') : [];
  const tail = tailRaw ? tailRaw.split(':') : [];
  const missing = 8 - head.length - tail.length;

  if (missing < 0) return undefined;

  const groups = value.includes('::')
    ? [...head, ...Array.from({ length: missing }, () => '0'), ...tail]
    : head;

  if (groups.length !== 8) return undefined;

  return groups.map((part) => {
    const normalized = part.toLowerCase().replace(/^0+([0-9a-f])/, '$1');
    return normalized === '' ? '0' : normalized;
  });
}

function normalizeSessionMetadata(input: {
  ipAddress?: string;
  userAgent?: string;
  policy?: SessionMetadataConfig;
  secret: string;
}): { ipAddress?: string; userAgent?: string } {
  const ipPolicy = input.policy?.ipAddress ?? 'store';
  const userAgentPolicy = input.policy?.userAgent ?? 'store';

  const ipAddress = (() => {
    if (!input.ipAddress) return undefined;
    if (ipPolicy === 'omit') return undefined;
    if (ipPolicy === 'hash') return hmacMetadata(input.ipAddress, input.secret);
    if (ipPolicy === 'truncate') return truncateIpAddress(input.ipAddress);
    return input.ipAddress;
  })();

  const userAgent = (() => {
    if (!input.userAgent) return undefined;
    if (userAgentPolicy === 'omit') return undefined;
    if (userAgentPolicy === 'hash') return hmacMetadata(input.userAgent, input.secret);
    return input.userAgent;
  })();

  return { ipAddress, userAgent };
}

/**
 * Create session manager
 */
export function createSessionManager(
  db: DatabaseAdapter,
  config: SessionConfig
): SessionManager {
  const log = (config.logger ?? pino({ level: 'silent' })).child({ module: 'session' });
  const cookieName = config.cookieName || SESSION_COOKIE_NAME;
  let warnedNoUpdateSessionExpiry = false;
  const durationMs = config.durationMs || DEFAULT_SESSION_DURATION_MS;
  const isProduction = process.env.NODE_ENV === 'production';
  
  const cookieOptions = {
    httpOnly: true,
    secure: config.secure ?? isProduction,
    sameSite: config.sameSite || 'strict',
    path: config.path || '/',
    domain: config.domain,
  };

  return {
    async createSession(userId, res, options = {}) {
      const sessionId = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + durationMs);
      const metadata = normalizeSessionMetadata({
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        policy: config.metadata,
        secret: config.secret,
      });
      
      const sessionInput: CreateSessionInput = {
        userId,
        expiresAt,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      };
      
      const session = await db.createSession({
        ...sessionInput,
        id: sessionId,
      } as Session);
      
      // Sign and set cookie
      const signedId = signSessionId(sessionId, config.secret);
      
      res.cookie(cookieName, signedId, {
        ...cookieOptions,
        maxAge: durationMs,
        expires: expiresAt,
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
      
      // Check if expired
      if (session.expiresAt < new Date()) {
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
      
      // Clear cookie
      res.clearCookie(cookieName, {
        ...cookieOptions,
      });
    },
    
    async refreshSession(req, res) {
      const session = await this.getSession(req);
      
      if (!session) return null;
      
      // Check if session is past 50% of its lifetime (sliding window)
      const now = Date.now();
      const created = session.createdAt.getTime();
      const expires = session.expiresAt.getTime();
      const lifetime = expires - created;
      const elapsed = now - created;
      
      if (elapsed > lifetime * 0.5) {
        // Extend session
        const newExpiresAt = new Date(now + durationMs);

        if (db.updateSessionExpiry) {
          await db.updateSessionExpiry(session.id, newExpiresAt);
        } else if (!warnedNoUpdateSessionExpiry) {
          log.warn('Session refresh is cookie-only — implement updateSessionExpiry on your adapter for full persistence.');
          warnedNoUpdateSessionExpiry = true;
        }

        const signedId = signSessionId(session.id, config.secret);
        
        res.cookie(cookieName, signedId, {
          ...cookieOptions,
          maxAge: durationMs,
          expires: newExpiresAt,
        });
      }
      
      return session;
    },
  };
}
