/**
 * Logging Infrastructure Tests
 *
 * Verifies INFRA-01: pino logger threading through all managers
 * Verifies SEC-06: sensitive field redaction
 */

import pino from 'pino';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

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
  it('zero console.* calls remain in src/server/', async () => {
    const { execSync } = await import('child_process');
    const count = execSync('grep -rn "console\\." src/server/ --include="*.ts" | wc -l', {
      encoding: 'utf-8',
      cwd: join(process.cwd()),
    }).trim();
    expect(parseInt(count, 10)).toBe(0);
  });
});

// ============================================
// Sensitive field redaction (SEC-06)
// ============================================

describe('Sensitive field redaction (SEC-06)', () => {
  const serverDir = join(process.cwd(), 'src', 'server');

  const readSource = (relativePath: string) =>
    readFileSync(join(serverDir, relativePath), 'utf-8');

  it('treasuryPrivateKey never appears in log.* calls in mpc.ts', () => {
    const source = readSource('mpc.ts');
    const logCalls = source.match(/log\.(info|warn|error|debug)\([^)]+\)/g) || [];
    for (const call of logCalls) {
      expect(call).not.toContain('treasuryPrivateKey');
    }
  });

  it('derivationPath never appears in log.* calls in mpc.ts', () => {
    const source = readSource('mpc.ts');
    const logCalls = source.match(/log\.(info|warn|error|debug)\([^)]+\)/g) || [];
    for (const call of logCalls) {
      expect(call).not.toContain('derivationPath');
    }
  });

  it('mpcPublicKey never appears in log.* calls in mpc.ts', () => {
    const source = readSource('mpc.ts');
    const logCalls = source.match(/log\.(info|warn|error|debug)\([^)]+\)/g) || [];
    for (const call of logCalls) {
      expect(call).not.toContain('mpcPublicKey');
    }
  });

  it('sessionSecret never appears in log.* calls in session.ts', () => {
    const source = readSource('session.ts');
    const logCalls = source.match(/log\.(info|warn|error|debug)\([^)]+\)/g) || [];
    for (const call of logCalls) {
      expect(call).not.toContain('sessionSecret');
      expect(call).not.toContain('secret');
    }
  });

  it('raw request body fields are not logged in router.ts', () => {
    const source = readSource('router.ts');
    const logCalls = source.match(/log\.(info|warn|error|debug)\([^)]+\)/g) || [];
    for (const call of logCalls) {
      expect(call).not.toContain('req.body');
    }
  });
});

// ============================================
// Session metadata logging (SESSION-04)
// ============================================

describe('Session metadata logging', () => {
  const serverDir = join(process.cwd(), 'src', 'server');

  const readSource = (relativePath: string) =>
    readFileSync(join(serverDir, relativePath), 'utf-8');

  it('session.ts log calls never include raw session metadata names', () => {
    const source = readSource('session.ts');
    const logCalls = source.match(/log\.(info|warn|error|debug)\([^)]+\)/g) || [];
    for (const call of logCalls) {
      expect(call).not.toContain('ipAddress');
      expect(call).not.toContain('userAgent');
      expect(call).not.toContain('metadata.ipAddress');
      expect(call).not.toContain('metadata.userAgent');
    }
  });

  it('router log calls never include req.ip or raw user-agent header access', () => {
    for (const file of ['router.ts', 'oauth/router.ts']) {
      const source = readSource(file);
      const logCalls = source.match(/log\.(info|warn|error|debug)\([^)]+\)/g) || [];
      for (const call of logCalls) {
        expect(call).not.toContain('req.ip');
        expect(call).not.toContain("req.headers['user-agent']");
        expect(call).not.toContain('req.headers["user-agent"]');
      }
    }
  });
});
