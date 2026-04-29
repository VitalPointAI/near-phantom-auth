import { describe, it, expect } from 'vitest';
import { deriveBackupEligibility } from '../server/backup.js';

describe('deriveBackupEligibility (BACKUP-05)', () => {
  it('returns true for multiDevice', () => {
    expect(deriveBackupEligibility('multiDevice')).toBe(true);
  });

  it('returns false for singleDevice', () => {
    expect(deriveBackupEligibility('singleDevice')).toBe(false);
  });

  it('accepts only the two CredentialDeviceType literals (type smoke)', () => {
    const _ok1: ReturnType<typeof deriveBackupEligibility> = deriveBackupEligibility('multiDevice');
    const _ok2: ReturnType<typeof deriveBackupEligibility> = deriveBackupEligibility('singleDevice');
    expect(typeof _ok1).toBe('boolean');
    expect(typeof _ok2).toBe('boolean');
  });
});
