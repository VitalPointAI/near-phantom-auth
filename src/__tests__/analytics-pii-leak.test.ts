/**
 * Phase 13 Plan 02 — ANALYTICS-03 implementation (tsc-fail fixture).
 *
 * Pattern: direct mirror of src/__tests__/mpc-treasury-leak.test.ts:197-242.
 * Adaptation: per-test UUID-suffixed fixture path because Phase 13 has 6
 * forbidden-field assertions (vs MPC-07's 1) and vitest 4.x runs files in
 * parallel — see Pitfall 5 in 13-RESEARCH.md lines 614-619.
 *
 * Each test writes a tiny .ts file that imports AnalyticsEvent and tries
 * to assign a literal containing a forbidden PII field. tsc --noEmit MUST
 * fail; the test asserts both the non-zero exit AND the offending field
 * name appears in tsc's output.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

/**
 * Per forbidden field, the test specifies which variant the fixture should
 * extend. Each variant must require the field to fail tsc — i.e. the
 * fixture adds an EXTRA field beyond the variant's allowed set.
 *
 * `extraPrefix` is OPTIONAL: variants whose allowed set is exactly
 * { type, rpId, timestamp } omit it; variants with additional required
 * fields (backupEligible, provider) declare them so the ONLY tsc error is
 * the forbidden field — not a missing required field.
 */
interface ForbiddenCase {
  field: string;
  variant: string;
  extraPrefix?: string;
  extra: string;
}

const forbiddenCases: ForbiddenCase[] = [
  { field: 'codename', variant: 'register.start', extra: "codename: 'ALPHA-7-BRAVO'" },
  { field: 'userId', variant: 'register.finish.success', extraPrefix: 'backupEligible: true,', extra: "userId: 'user-1'" },
  { field: 'nearAccountId', variant: 'login.finish.success', extraPrefix: 'backupEligible: false,', extra: "nearAccountId: 'alice.testnet'" },
  { field: 'email', variant: 'oauth.callback.success', extraPrefix: "provider: 'google',", extra: "email: 'alice@example.com'" },
  { field: 'ip', variant: 'account.delete', extra: "ip: '127.0.0.1'" },
  { field: 'ipAddress', variant: 'login.start', extraPrefix: 'codenameProvided: true,', extra: "ipAddress: '203.0.113.42'" },
  { field: 'userAgent', variant: 'recovery.wallet.link.success', extra: "userAgent: 'Mozilla/5.0'" },
];

describe('ANALYTICS-03: AnalyticsEvent forbids PII via tsc-fail fixture', () => {
  it.each(forbiddenCases)(
    'a fixture adding `$field` to $variant fails tsc --noEmit',
    ({ field, variant, extraPrefix, extra }) => {
      // Per-test UUID — Pitfall 5: parallel vitest workers race on a
      // deterministic path. Each test gets its own fixture file.
      const fixturePath = join(
        process.cwd(),
        `src/__tests__/_analytics-pii-fixture-${randomUUID()}.ts`,
      );

      const fixtureSrc = `
        import type { AnalyticsEvent } from '../server/analytics.js';
        const _bad: AnalyticsEvent = {
          type: '${variant}',
          rpId: 'localhost',
          timestamp: 0,
          ${extraPrefix ?? ''}
          ${extra}, // <-- this MUST fail tsc
        };
        export {};
        void _bad;
      `;

      writeFileSync(fixturePath, fixtureSrc, 'utf-8');

      let tscFailed = false;
      let tscOutput = '';
      try {
        execSync(`npx tsc --noEmit ${fixturePath}`, {
          encoding: 'utf-8',
          cwd: process.cwd(),
          stdio: 'pipe',
        });
      } catch (err) {
        tscFailed = true;
        const e = err as { stdout?: string; stderr?: string };
        tscOutput = (e.stdout || '') + (e.stderr || '');
      } finally {
        if (existsSync(fixturePath)) unlinkSync(fixturePath);
      }

      expect(tscFailed).toBe(true);
      expect(tscOutput).toMatch(new RegExp(field));
    },
    30_000,
  );
});
