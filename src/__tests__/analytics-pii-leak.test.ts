/**
 * Phase 13 Plan 01 (Wave 0) — ANALYTICS-03 stub.
 *
 * Covers:
 *   - ANALYTICS-03: tsc-fail fixture proves a literal adding `codename`,
 *     `userId`, `nearAccountId`, `email`, `ip`, or `userAgent` to any
 *     AnalyticsEvent variant fails `tsc --noEmit`.
 *
 * Analog: src/__tests__/mpc-treasury-leak.test.ts:197-242 (Gate 4 / MPC-07).
 * When Plan 02 lands AnalyticsEvent, replace each `it.todo` below with a
 * real `it(...)` that:
 *   1. writes a fixture .ts file at src/__tests__/_analytics-pii-fixture-${randomUUID()}.ts
 *      (per-test UUID required — Pitfall 5 in 13-RESEARCH.md lines 614-619 —
 *      because parallel vitest workers race on a deterministic path)
 *   2. shells out to `npx tsc --noEmit <fixturePath>` via execSync
 *   3. asserts tscFailed === true AND tscOutput matches /<forbiddenField>/
 *   4. unlinks the fixture in `finally`
 *
 * Wave 0 invariant: this file MUST be picked up by vitest.
 */
import { describe, it } from 'vitest';

describe('ANALYTICS-03: AnalyticsEvent forbids PII via tsc-fail fixture (Wave 0 stub)', () => {
  it.todo('a fixture adding `codename` to register.start fails tsc --noEmit');
  it.todo('a fixture adding `userId` to register.finish.success fails tsc --noEmit');
  it.todo('a fixture adding `nearAccountId` to login.finish.success fails tsc --noEmit');
  it.todo('a fixture adding `email` to oauth.callback.success fails tsc --noEmit');
  it.todo('a fixture adding `ip` to account.delete fails tsc --noEmit');
  it.todo('a fixture adding `userAgent` to recovery.wallet.link.success fails tsc --noEmit');
});
