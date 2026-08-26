# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- `CreateSessionInput` now declares `id`. `sessionManager.createSession` passed
  it at runtime and signed that id into the session cookie, but the field was
  absent from the published adapter contract — so a custom adapter written
  correctly against the types generated its own id, the cookie named a row that
  did not exist, and **every authenticated request failed with 401** while
  sign-in itself appeared to succeed. Also removed the `as Session` cast that
  was concealing the gap, so drift is now a type error.

## [0.8.2] — 2026-08-26

### Added
- `mpc.rpcUrl` and `mpc.rpcHeaders` — configure the RPC endpoint used for every
  NEAR call made during account creation (`view_account`, `view_access_key`,
  `broadcast_tx_commit`). Previously `rpc.mainnet.near.org` was hardcoded with
  no override, so a consumer on a paid provider silently kept using the free
  shared endpoint. Defaults are unchanged, so existing consumers are unaffected.

## [0.8.1] — 2026-08-25

### Fixed
- **`buildSignedTransaction` emitted the signer's public key into the `Signature`
  field of the `SignedTransaction` envelope**, producing
  `transaction ++ [key_type] ++ publicKey(32) ++ signature(64)` instead of the
  correct `transaction ++ [key_type] ++ signature(64)`. The public key is already
  encoded inside the `Transaction` body, so the second copy shifted the signature
  by 32 bytes and every such transaction was rejected by the RPC with
  `Failed to decode transaction: signature error`.

  Consequence: `MPCAccountManager.createAccount` could never fund an account from
  the treasury, so **no account could be created** — neither via the passkey path
  nor any guest-fallback path built on it. Output is now byte-identical to
  `@near-js/transactions`' own `SignedTransaction` encoding.

### Added
- `buildSignedTransaction` is now exported, so its byte layout can be asserted
  directly against `@near-js/transactions` rather than against a copy of itself.

### Changed
- The `BUG-02` test block previously exercised a local duplicate
  (`buildSignedTransactionFixed`) rather than the real function, and asserted the
  broken 97-byte signature section as correct. It has been replaced with tests
  that import the real function and compare bytes against the official encoder.
  Mutation-proven: reinstating the stray 32 bytes turns 4 of 18 tests red.

### Compatibility
- No public API removed. Consumers on `^0.8.0` pick this up automatically;
  anyone pinning `0.8.0` exactly must bump to get a working account-creation path.

## [0.8.0] — 2026-05-31

### Added
- Enterprise Identity Module (v0.8.x, opt-in/additive): optional
  `enterprise` config, `auth.enterprise` binding API, conditional
  `enterprise_users` persistence, SCIM Users/Groups/ServiceProviderConfig
  router, and enterprise session offboarding checks.

### Compatibility
- Enterprise support is off by default. Consumers that omit `enterprise` keep
  the existing anonymous-first behavior, no enterprise routes, and no enterprise
  schema initialization.
- The package continues to separate anonymous, OAuth, and enterprise identity
  tracks. Enterprise PII stays out of anonymous records and analytics events.

## [0.7.1] — 2026-04-30

### Added
- Session metadata anonymity hardening via `sessionMetadata` policies for IP
  address and user-agent persistence.

## [0.7.0] — 2026-04-30

### Added
- **BACKUP-01..05:** Register and login responses now expose additive
  backup-eligibility passkey metadata (`passkey.backedUp` and
  `passkey.backupEligible`), with React state helpers mirroring the values.
- **RPID-01..05:** Multi-RP_ID / related-origin verification via
  `rp.relatedOrigins: Array<{ origin, rpId }>` paired tuples, including startup
  validation, array-form standalone WebAuthn verification inputs, README
  guidance for `/.well-known/webauthn`, and the 5 related-origin cap.
- **ANALYTICS-01..06:** Privacy-preserving `hooks.onAuthEvent` lifecycle
  analytics with type-level PII guards, static failure reasons, fire-and-forget
  default behavior, and `awaitAnalytics` opt-in for synchronous delivery.
- **HOOK-02..06:** `hooks.afterAuthSuccess` second-factor gating on passkey
  register, passkey login, and OAuth callback success, including structured
  `secondFactor` response echoes on short-circuit.
- **BACKFILL-01..04:** `hooks.backfillKeyBundle` lazy-backfill hook for
  pre-v0.6.0 NULL-bundle accounts. The hook fires on `/login/finish` only when
  `sealingKeyHex` is supplied, echoes `backfill`, and contains hook failures so
  login is never blocked.

### Compatibility
- Additive only - no breaking changes from v0.6.1.
- `MPCAccountManager`, `MPCAccountManagerConfig`, `CreateAccountResult`,
  `createAccount`, and `verifyRecoveryWallet` remain frozen for the v0.6.1
  standalone consumer contract.
- Existing consumers that omit `hooks`, omit `awaitAnalytics`, and omit
  `rp.relatedOrigins` keep v0.6.1 behavior.

### Notes
- **Zero new npm dependencies.** v0.7.0 reuses existing Express, pino, Zod,
  WebAuthn, and NEAR dependencies.
- **Anonymity invariant maintained.** Analytics events and library error logs
  do not carry `userId`, `codename`, `nearAccountId`, email, raw IP,
  raw user-agent, or PRF sealing material.
- **Consumer-owned schema for lazy backfill.** The library does not persist key
  bundles, wrap a transaction around backfill, or migrate existing IPFS recovery
  blobs.

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
