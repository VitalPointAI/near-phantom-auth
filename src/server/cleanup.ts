import type { DatabaseAdapter } from '../types/index.js';
import type { Logger } from 'pino';

export interface CleanupScheduler {
  /** Stop the cleanup interval. Call on graceful shutdown. */
  stop(): void;
}

/**
 * Create a periodic cleanup scheduler that removes expired sessions,
 * challenges, and OAuth states from the database.
 *
 * The interval timer is unref'd so it does not prevent process exit.
 * Consumers call this after initializing the library and call stop()
 * on graceful shutdown.
 *
 * @param db - DatabaseAdapter instance
 * @param log - pino Logger instance
 * @param intervalMs - cleanup interval in milliseconds (default: 5 minutes)
 */
export function createCleanupScheduler(
  db: DatabaseAdapter,
  log: Logger,
  intervalMs = 5 * 60 * 1000
): CleanupScheduler {
  const handle = setInterval(async () => {
    try {
      const sessions = await db.cleanExpiredSessions();
      const challenges = await db.cleanExpiredChallenges?.() ?? 0;
      const oauthStates = await db.cleanExpiredOAuthStates?.() ?? 0;

      if (sessions > 0 || challenges > 0 || oauthStates > 0) {
        log.info({ sessions, challenges, oauthStates }, 'Cleanup complete');
      }
    } catch (err) {
      log.error({ err }, 'Cleanup failed');
    }
  }, intervalMs);

  // CRITICAL: unref so the timer does not prevent process exit in tests
  // or graceful shutdown scenarios
  handle.unref();

  return {
    stop() {
      clearInterval(handle);
    },
  };
}
