import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { POSTGRES_SCHEMA } from '../server/index.js';

const read = (path: string) => readFileSync(path, 'utf8');

describe('ENT-02/ENT-08: enterprise does not leak into anonymous surfaces', () => {
  it('keeps enterprise tables out of default schema', () => {
    expect(POSTGRES_SCHEMA).not.toContain('enterprise_users');
  });

  it('keeps enterprise events out of AnalyticsEvent', () => {
    const analytics = read('src/server/analytics.ts');
    expect(analytics).not.toContain("type: 'enterprise.");
    expect(analytics).not.toContain("type: 'scim.");
  });

  it('keeps enterprise identifiers out of AnonUser shape', () => {
    const types = read('src/types/index.ts');
    const anonBlock = types.slice(types.indexOf('export interface AnonUser'), types.indexOf('export interface CreateUserInput'));
    for (const forbidden of ['externalSub', 'externalAttrs', 'scimId', 'externalIdp']) {
      expect(anonBlock).not.toContain(forbidden);
    }
  });

  it('does not return enterprise attrs from anonymous passkey router responses', () => {
    const router = read('src/server/router.ts');
    expect(router).not.toContain('externalAttrs');
    expect(router).not.toContain('enterpriseUser');
  });
});

