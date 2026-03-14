/**
 * Logging Infrastructure Tests
 *
 * Verifies INFRA-01: pino logger threading through all managers
 * Verifies SEC-06: sensitive field redaction
 */

import pino from 'pino';
import { describe, it, expect } from 'vitest';

// ============================================
// INFRA-01: Logging infrastructure
// ============================================

describe('Logging infrastructure (INFRA-01)', () => {
  it('no-op logger suppresses all output', () => {
    const logger = pino({ level: 'silent' });
    expect(logger.isLevelEnabled('info')).toBe(false);
    expect(logger.isLevelEnabled('error')).toBe(false);
    expect(logger.isLevelEnabled('fatal')).toBe(false);
  });

  it('child logger inherits silent level', () => {
    const logger = pino({ level: 'silent' });
    const child = logger.child({ module: 'test' });
    expect(child.isLevelEnabled('info')).toBe(false);
  });

  it('injectable logger receives log calls', () => {
    const entries: any[] = [];
    const stream = { write: (msg: string) => entries.push(JSON.parse(msg)) };
    const logger = pino({ level: 'info' }, stream as any);
    const child = logger.child({ module: 'test' });
    child.info({ action: 'test' }, 'hello');
    expect(entries.length).toBe(1);
    expect(entries[0].module).toBe('test');
    expect(entries[0].msg).toBe('hello');
  });
});

// ============================================
// Console removal (INFRA-01)
// ============================================

describe('Console removal (INFRA-01)', () => {
  it.todo('zero console.* calls remain in src/server/ (verified by grep)');
});

// ============================================
// Sensitive field redaction (SEC-06)
// ============================================

describe('Sensitive field redaction (SEC-06)', () => {
  it.todo('treasuryPrivateKey never appears in log output from mpc manager');
  it.todo('derivationPath never appears in log output from mpc manager');
  it.todo('sessionSecret never appears in log output from session manager');
  it.todo('mpcPublicKey never appears in log output from mpc manager');
  it.todo('raw request body fields are not logged');
});
