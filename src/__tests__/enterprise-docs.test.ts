import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('ENT-07/ENT-08: enterprise docs', () => {
  it('documents enterprise opt-in/off-by-default setup and SCIM router', () => {
    const readme = read('README.md');
    expect(readme).toContain('Enterprise Identity Module');
    expect(readme).toContain('opt-in and off by default');
    expect(readme).toContain('auth.scimRouter');
    expect(readme).toContain('linkIdentity');
  });

  it('documents PRF/DEK enterprise modes', () => {
    const readme = read('README.md');
    expect(readme).toContain('passkeyStepUp');
    expect(readme).toContain('serverManagedDek');
    expect(readme).toContain('Pure IdP enterprise auth without passkey step-up');
  });

  it('documents three-track anonymity and policy boundary', () => {
    const readme = read('README.md');
    expect(readme).toContain('enterprise_users');
    expect(readme).toContain('anon_users');
    expect(readme).toContain('role-to-permission mapping');
    expect(readme).toContain('AnalyticsEvent');
  });

  it('records additive enterprise behavior in the changelog', () => {
    const changelog = read('CHANGELOG.md');
    expect(changelog).toContain('Enterprise Identity Module');
    expect(changelog).toContain('opt-in/additive');
    expect(changelog).toContain('off by default');
  });
});

