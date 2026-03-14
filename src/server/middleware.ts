/**
 * Express Middleware
 * 
 * Authentication middleware and route protection for Express apps.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { SessionManager } from './session.js';
import type { DatabaseAdapter, AnonUser } from '../types/index.js';
import pino from 'pino';
import type { Logger } from 'pino';

/**
 * Create authentication middleware
 * 
 * Attaches user and session to request if valid session exists.
 */
export function createAuthMiddleware(
  sessionManager: SessionManager,
  db: DatabaseAdapter,
  logger?: Logger
): RequestHandler {
  const log = (logger ?? pino({ level: 'silent' })).child({ module: 'middleware' });
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await sessionManager.getSession(req);
      
      if (session) {
        const user = await db.getUserById(session.userId);
        
        if (user) {
          req.anonUser = user;
          req.anonSession = session;
          
          // Refresh session (sliding window)
          await sessionManager.refreshSession(req, res);
        }
      }
      
      next();
    } catch (error) {
      log.error({ err: error }, 'Middleware error');
      next();
    }
  };
}

/**
 * Create route protection middleware
 * 
 * Returns 401 if no valid session.
 */
export function createRequireAuth(
  sessionManager: SessionManager,
  db: DatabaseAdapter,
  logger?: Logger
): RequestHandler {
  const log = (logger ?? pino({ level: 'silent' })).child({ module: 'middleware' });
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await sessionManager.getSession(req);
      
      if (!session) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      
      const user = await db.getUserById(session.userId);
      
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      
      req.anonUser = user;
      req.anonSession = session;
      
      // Refresh session
      await sessionManager.refreshSession(req, res);
      
      next();
    } catch (error) {
      log.error({ err: error }, 'Auth check error');
      res.status(500).json({ error: 'Authentication check failed' });
    }
  };
}
