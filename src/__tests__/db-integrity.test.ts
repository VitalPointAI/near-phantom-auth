import { describe, it } from 'vitest';

describe('Phase 5: DB Integrity and Functional Stubs', () => {
  describe('INFRA-02: Registration transaction rollback', () => {
    it.todo('rolls back user creation when createPasskey fails');
    it.todo('rolls back user and passkey when createSession fails');
    it.todo('falls back to sequential calls when adapter has no transaction()');
  });

  describe('BUG-04: verifyRecoveryWallet specific key check', () => {
    it.todo('returns true when specific recovery key exists on account');
    it.todo('returns false when account has keys but not the recovery key');
    it.todo('returns false when account does not exist');
  });

  describe('STUB-01: addRecoveryWallet real MPC signing', () => {
    it.todo('returns a txHash that does not match /^pending-/');
    it.todo('creates an AddKey transaction with the recovery wallet public key');
    it.todo('uses the account derived key for signing, not treasury key');
  });

  describe('STUB-02: Passkey re-registration endpoint', () => {
    it.todo('returns 401 when not authenticated');
    it.todo('returns challengeId and options for authenticated user');
  });

  describe('STUB-03: Account deletion endpoint', () => {
    it.todo('returns 401 when not authenticated');
    it.todo('deletes user and all associated data');
    it.todo('returns 501 when deleteUser is not implemented');
  });
});
