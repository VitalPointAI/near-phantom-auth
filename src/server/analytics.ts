/**
 * Phase 13 — registration analytics hook (`hooks.onAuthEvent`).
 *
 * Defines:
 *   - `AnalyticsEvent`: discriminated union of all 12 lifecycle event variants.
 *     The union IS the type-level PII whitelist — adding `userId`, `codename`,
 *     `nearAccountId`, `email`, `ip`, or `userAgent` to ANY variant fails the
 *     tsc-fail fixture in `src/__tests__/analytics-pii-leak.test.ts`.
 *   - `ALLOWED_EVENT_FIELDS`: runtime allowlist (defense-in-depth) — single
 *     source of truth for the snapshot test in
 *     `src/__tests__/analytics-pii-snapshot.test.ts`.
 *   - `wrapAnalytics(hook, opts)`: safe envelope. Fire-and-forget by default
 *     (does NOT block the response); `opts.await: true` switches to awaited
 *     emit. Errors and rejected Promises are ALWAYS swallowed and logged
 *     WARN with `redactErrorMessage(err)` ({ name, stackHead }, never the
 *     raw Error.message).
 *
 * Anonymity invariant: events MUST NOT carry user-identifying fields.
 * `rpId` is always `config.rp.id` (the PRIMARY rpId). Per-request matching
 * against `relatedOrigins` is OUT OF SCOPE — `@simplewebauthn/server@13.x`
 * does not return the matched rpId from `verifyAuthenticationResponse`.
 */
import type { Logger } from 'pino';
import pino from 'pino';

/** Failure reasons for `register.finish.failure`. Static enum — NEVER `Error.message`. */
export type RegisterFailureReason =
  | 'invalid-codename'
  | 'passkey-verification-failed'
  | 'internal-error';

/** Failure reasons for `login.finish.failure`. Static enum — NEVER `Error.message`. */
export type LoginFailureReason =
  | 'auth-failed'
  | 'user-not-found'
  | 'internal-error';

/** OAuth providers exposed on `oauth.callback.success`. Mirror of OAuthProvider in types. */
export type OauthProvider = 'google' | 'github' | 'twitter';

/**
 * AnalyticsEvent — discriminated union emitted by `hooks.onAuthEvent`.
 *
 * Allowed fields per variant: `type`, `rpId`, `timestamp` (always);
 * `provider` (oauth.* only), `backupEligible` (success.* only),
 * `reason` (failure.* only — static enum), `codenameProvided` (login.start only).
 *
 * INVARIANT: NO variant carries `userId`, `codename`, `nearAccountId`,
 * `email`, raw `ip`, raw `userAgent`. Verified by:
 *   - tsc-fail fixture: `src/__tests__/analytics-pii-leak.test.ts`
 *   - runtime whitelist:  `src/__tests__/analytics-pii-snapshot.test.ts`
 */
export type AnalyticsEvent =
  // --- register lifecycle ---
  | { type: 'register.start'; rpId: string; timestamp: number; }
  | { type: 'register.finish.success'; rpId: string; timestamp: number; backupEligible: boolean; }
  | { type: 'register.finish.failure'; rpId: string; timestamp: number; reason: RegisterFailureReason; }
  // --- login lifecycle ---
  | { type: 'login.start'; rpId: string; timestamp: number; codenameProvided: boolean; }
  | { type: 'login.finish.success'; rpId: string; timestamp: number; backupEligible: boolean; }
  | { type: 'login.finish.failure'; rpId: string; timestamp: number; reason: LoginFailureReason; }
  // --- recovery (4 variants) ---
  | { type: 'recovery.wallet.link.success'; rpId: string; timestamp: number; }
  | { type: 'recovery.wallet.recover.success'; rpId: string; timestamp: number; }
  | { type: 'recovery.ipfs.setup.success'; rpId: string; timestamp: number; }
  | { type: 'recovery.ipfs.recover.success'; rpId: string; timestamp: number; }
  // --- oauth ---
  | { type: 'oauth.callback.success'; rpId: string; timestamp: number; provider: OauthProvider; }
  // --- account ---
  | { type: 'account.delete'; rpId: string; timestamp: number; };

/**
 * Allowed event fields — single source of truth for the snapshot whitelist
 * test (ANALYTICS-05). Frozen so a test cannot mutate it at runtime.
 */
export const ALLOWED_EVENT_FIELDS: ReadonlySet<string> = Object.freeze(new Set([
  'type',
  'rpId',
  'timestamp',
  'provider',
  'backupEligible',
  'reason',
  'codenameProvided',
])) as ReadonlySet<string>;

/** Options for `wrapAnalytics`. */
export interface WrapAnalyticsOpts {
  /** Logger instance (typically the same one threaded through createAnonAuth). */
  logger?: Logger;
  /** When true, the wrapper awaits the hook before returning. Driven by
   *  `AnonAuthConfig.awaitAnalytics`. Default false (fire-and-forget). */
  await?: boolean;
}

/**
 * Redact an Error so its message cannot leak PII into the analytics WARN log.
 *
 * Strategy: keep the error class name (`Error`, `TypeError`, etc.) and the
 * first frame line of the stack trace (file:line, no values). Drop `message`
 * entirely — consumer-facing error strings often contain user-supplied input
 * (codename fragments, account IDs).
 *
 * NOTE: V8's `Error.stack` format is `"<Name>: <message>\n    at <frame>\n..."`,
 * so the first line of the stack contains the message. We must skip it and
 * return only frame lines (those starting with whitespace + `at `). This
 * matches the documented contract — `err.message` MUST NEVER appear in the
 * returned `stackHead`. Phase 13 ANALYTICS-04 / T-13-25 mitigation.
 */
export function redactErrorMessage(err: unknown): { name: string; stackHead?: string } {
  if (err instanceof Error) {
    const lines = err.stack?.split('\n') ?? [];
    // Filter to frame lines only (V8 frames start with whitespace then "at ").
    // This skips the leading "<Name>: <message>" line which carries PII.
    const frames = lines.filter((line) => /^\s+at\s/.test(line));
    const stackHead = frames.length > 0 ? frames.slice(0, 2).join(' | ') : undefined;
    return { name: err.name, stackHead };
  }
  return { name: typeof err };
}

/**
 * Wrap a consumer's `onAuthEvent` hook into a safe emitter.
 *
 * Fire-and-forget mode (default, `opts.await !== true`):
 *   - returns void synchronously
 *   - hook starts executing immediately on the same tick (no setImmediate)
 *   - hook errors / rejected Promises are caught and logged via WARN
 *   - response is NOT delayed by hook execution time
 *
 * Awaited mode (`opts.await === true`):
 *   - returns Promise<void> that resolves when the hook resolves
 *   - hook errors / rejected Promises are STILL caught (NEVER propagate)
 *   - response IS delayed by hook execution time (synchronous-guarantee
 *     use cases — consumer wants the event to land before responding)
 *
 * In BOTH modes, errors are swallowed — the analytics hook NEVER breaks
 * an auth response. (Phase 13 Critical Constraint 8.)
 */
export function wrapAnalytics(
  hook: ((event: AnalyticsEvent) => void | Promise<void>) | undefined,
  opts: WrapAnalyticsOpts = {},
): (event: AnalyticsEvent) => void | Promise<void> {
  const log = (opts.logger ?? pino({ level: 'silent' })).child({ module: 'analytics' });
  const shouldAwait = opts.await === true;

  if (!hook) {
    // No hook configured → no-op. Matches Phase 11 "absent hooks → behavior identical to v0.6.1".
    return () => {};
  }

  return (event: AnalyticsEvent): void | Promise<void> => {
    let ret: void | Promise<void>;
    try {
      ret = hook(event);
    } catch (err) {
      // Synchronous throw — log and swallow.
      log.warn({ err: redactErrorMessage(err) }, 'analytics hook threw');
      return shouldAwait ? Promise.resolve() : undefined;
    }

    if (ret && typeof (ret as Promise<void>).then === 'function') {
      const safe = (ret as Promise<void>).catch((err) => {
        log.warn({ err: redactErrorMessage(err) }, 'analytics hook rejected');
      });
      return shouldAwait ? safe : undefined;
    }

    return shouldAwait ? Promise.resolve() : undefined;
  };
}
