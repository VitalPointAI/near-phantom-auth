/**
 * Phase 13 Plan 01 (Wave 0) — ANALYTICS-04 stub.
 *
 * Covers:
 *   - ANALYTICS-04 (latency): a 5-second onAuthEvent hook adds < 100ms
 *     to login latency in fire-and-forget mode (default).
 *   - ANALYTICS-04 (error swallow): a throwing onAuthEvent still produces
 *     200 OK; pino WARN is emitted with redactErrorMessage output
 *     ({ name, stackHead }), never the raw Error.message.
 *   - ANALYTICS-04 (await mode): awaitAnalytics: true makes the same
 *     5-second hook ADD ~5s to login latency.
 *
 * Reference implementation: 13-RESEARCH.md lines 705-721 (latency)
 * + 13-PATTERNS.md lines 690-702 (pino-stream capture).
 *
 * When Plans 02 + 03 land, replace each `it.todo` below with a real
 * `it(...)` using performance.now() and a captured pino stream.
 */
import { describe, it } from 'vitest';

describe('ANALYTICS-04: fire-and-forget latency (Wave 0 stub)', () => {
  it.todo('a 5s onAuthEvent does NOT add 5s to login latency (elapsed < 500ms)');
  it.todo('hookResolved remains false at the time the response returns (proof of fire-and-forget)');
});

describe('ANALYTICS-04: error swallow (Wave 0 stub)', () => {
  it.todo('a throwing onAuthEvent still produces a 200 OK response');
  it.todo('pino WARN is emitted with { err: { name, stackHead } } — Error.message is NOT in the log');
  it.todo('a hook returning a rejected Promise is also caught (.catch attached)');
});

describe('ANALYTICS-04: awaitAnalytics: true mode (Wave 0 stub)', () => {
  it.todo('with awaitAnalytics: true, a 5s onAuthEvent ADDS ~5s to login latency (elapsed > 4500ms)');
  it.todo('with awaitAnalytics: true, a throwing onAuthEvent STILL produces 200 OK (errors still swallowed)');
});
