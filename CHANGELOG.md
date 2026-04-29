# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] — 2026-04-29

### Fixed
- **MPC-01:** `MPCAccountManager` is now exported as a runtime value (was previously
  `export type` which stripped the constructor at compile time, producing
  `TypeError: MPCAccountManager is not a constructor` for consumers using
  `import { MPCAccountManager }`). Closes the production restart loop reported
  by the Ledgera mpc-sidecar consumer.
- **MPC-04:** `verifyRecoveryWallet` returns `false` (without throwing) for
  deleted/missing accounts (UNKNOWN_ACCOUNT). Previously the wrapper's
  swallow-all `try/catch` masked this case from callers.
- **MPC-05:** `verifyRecoveryWallet` now correctly returns `false` for
  FunctionCall-only access keys. Previously it returned `true` for any non-error
  RPC response, allowing FunctionCall-scoped keys to satisfy recovery
  verification — a security gap that bypassed the FullAccess requirement.

### Added
- **MPC-07:** New `MPCAccountManagerConfig` type alias makes `derivationSalt` REQUIRED
  at the consumer-facing type boundary (cross-tenant isolation guarantee).
  Note: this is a TypeScript-level requirement on the new standalone API; the
  internal `createAnonAuth` flow still accepts the looser `MPCConfig`.
- **MPC-09:** Pino redact paths added to the default logger
  (`config.treasuryPrivateKey`, `*.treasuryPrivateKey`); raw treasury key string
  is no longer retained as an instance field — replaced by a KeyPair object that
  is materialized once in the constructor and never re-stringified.
- **MPC-08:** yoctoNEAR conversion now uses `parseNearAmount` from `@near-js/utils`
  (was a custom BN-based block).
- **MPC-06:** `createAccount` retries `view_account` once after a nonce-race
  broadcast failure, allowing concurrent calls from multiple replicas to converge
  to a single provisioned account.
- **MPC-10:** `createAccount` now throws classified errors with `cause` set
  (`Error('RPC unreachable', { cause })`, `Error('Treasury underfunded', { cause })`,
  `Error('Transfer failed', { cause })`) instead of returning a degraded
  `{ mpcPublicKey: 'creation-failed' }` object. `verifyRecoveryWallet` propagates
  fetch failures (RPC unreachable) so consumer routes can return 500.
- **MPC-03:** `createAccount` is now idempotent — a second call against an
  already-provisioned account short-circuits via `view_account` and issues
  zero additional `broadcast_tx_commit` calls.
- New consumer-facing type alias `CreateAccountResult` (= `MPCAccount`) frozen
  for the contract.
- Test coverage:
  - `src/__tests__/mpc-account-manager.test.ts` — T1–T12 scenarios for the new
    standalone usage path (282 unit assertions; 4 testnet-guarded entries skip
    cleanly when `NEAR_TREASURY_ACCOUNT`/`NEAR_TREASURY_KEY` are unset).
  - `src/__tests__/mpc-treasury-leak.test.ts` — 6-gate regression audit
    proving no treasury key VALUE leaks to the dist bundle, runtime logs, or
    untyped configs.
  - `src/__tests__/exports.test.ts` — 10-test regression gate locking in the
    MPC-01 fix at the build-artifact level.

### Notes
- **Additive only** — all v0.6.0 exports remain unchanged. The new contract
  (`MPCAccountManager`, `MPCAccountManagerConfig`, `CreateAccountResult`,
  `createAccount`, `verifyRecoveryWallet`) is FROZEN by consumer pin.
- **Zero new npm dependencies.** `parseNearAmount` and `KeyPair` utilities
  were already available via `@near-js/utils` and `@near-js/crypto`.
- **Internal compatibility preserved.** `createAnonAuth` continues to use
  `createMPCManager(MPCConfig)` with optional `derivationSalt`/`treasuryPrivateKey`.
  The new `MPCAccountManagerConfig` is a strict-subset alias used only when
  consumers instantiate `MPCAccountManager` directly.
- **Behavior change for direct consumers:** if you instantiate
  `MPCAccountManager` directly (the new v0.6.1 standalone path), TypeScript
  now requires `derivationSalt`. Pass a per-tenant secret salt to prevent
  cross-tenant account ID collision.

## [0.6.0] — 2026-03-15

### Added
- WebAuthn PRF (Pseudo-Random Function) extension for DEK sealing key
  derivation (Phase 9; PRF-01 through PRF-12). PRF-capable authenticators
  return a deterministic 32-byte sealing key per credential, hex-encoded as
  `sealingKeyHex` on `/register/finish` and `/login/finish`.
- Configuration: `passkey.prfSalt` and `passkey.requirePrf` (defaults to
  graceful degradation on Firefox / older authenticators).

## [0.5.x] — 2026-03-14 and earlier

- Initial hardening milestone (35 requirements covering input validation,
  CSRF protection, structured logging, rate limiting, OAuth state DB-backing,
  email integration, and test coverage). See `.planning/v0.5-MILESTONE-AUDIT.md`
  for the complete requirement-by-requirement audit.
