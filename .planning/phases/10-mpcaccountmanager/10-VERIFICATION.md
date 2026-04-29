---
phase: 10-mpcaccountmanager
verified: 2026-04-29T12:00:00Z
status: passed
score: 14/14 must-haves verified
overrides_applied: 0
---

# Phase 10: MPCAccountManager Verification Report

**Phase Goal:** MPCAccountManager hotfix v0.6.1 — unblock the Ledgera mpc-sidecar consumer (production restart loop on v0.6.0). Ship a value-exported MPCAccountManager class with idempotent createAccount, FullAccess permission gate on verifyRecoveryWallet, classified throw paths, treasury key isolation, and a published npm release.

**Verified:** 2026-04-29
**Status:** passed
**Re-verification:** No — initial verification

**Note on environment:** Sandbox blocked invocation of `npx tsc`, `npm test`, and `gsd-sdk`. Verification therefore relies on (a) direct file reads of source/test/dist artifacts, (b) `grep` against compiled bundle, and (c) the orchestrator's already-confirmed live evidence (npm registry shows 0.6.1 latest; fresh-consumer smoke install passed; tag pushed; full suite 282+4 skipped). All file-level checks pass.

## Goal Achievement

### Observable Truths (ROADMAP success criteria + plan must-haves)

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1 | Consumer can `import { MPCAccountManager }` from `/server` and the class is defined as a runtime value (MPC-01) | VERIFIED | `src/server/index.ts:260` is `export { MPCAccountManager } from './mpc.js';` (value export, not `export type`). `dist/server/index.js:1290` declares `var MPCAccountManager = class {`; `dist/server/index.js:3295` includes `MPCAccountManager` in the named-export list. `dist/server/index.d.ts` has `declare class MPCAccountManager` and re-exports `MPCAccountManagerConfig`, `CreateAccountResult`. Orchestrator-confirmed live: fresh smoke install resolved `typeof MPCAccountManager === 'function'`. |
| 2 | All v0.6.0 exports remain unchanged (additive only) | VERIFIED | `dist/server/index.d.ts` export footer enumerates all v0.6.0 names (`createAnonAuth`, `createOAuthRouter`, `createPostgresAdapter`, `generateCodename`, `createCleanupScheduler`, `createEmailService`, all type aliases). The new MPC-related entries are additions, not replacements. |
| 3 | `MPCAccountManagerConfig` and `CreateAccountResult` are re-exported from `/server` (MPC-01 type aliases) | VERIFIED | `src/server/index.ts:261` exports both as types from `./mpc.js`. `dist/server/index.d.ts` final export list contains both. `src/__tests__/exports.test.ts` includes type-import-and-instantiate compile-time checks for both aliases. |
| 4 | `createAccount(userId)` is a pure function of `(treasuryAccount, userId, derivationSalt)` and idempotent via `view_account` short-circuit (MPC-02, MPC-03) | VERIFIED | `src/server/mpc.ts:437-525` `createAccount` implementation: Step 1 deterministic SHA-256 derivation from `derivationSalt`/`userId`; Step 2 `accountExists` short-circuit returns `onChain: true` with zero broadcasts. T3, T3-bonus tests in `src/__tests__/mpc-account-manager.test.ts:155-198` assert distinct userIds → distinct hex IDs and second-call zero-broadcast. T1, T2 testnet-guarded tests at lines 110-139 cover MPC-02/03 against a real treasury. |
| 5 | Returned `nearAccountId` always matches `/^[a-f0-9]{64}$/` (MPC-04) | VERIFIED | `src/server/mpc.ts:449` `const implicitAccountId = publicKeyBytes.toString('hex')`. Tests T3, T4, T12 (lines 156-179 of `mpc-account-manager.test.ts`) assert the regex on returned IDs across distinct userIds, salts, and userId formats. |
| 6 | `verifyRecoveryWallet` returns `true` only for FullAccess keys; returns `false` (no throw) for FunctionCall, UNKNOWN_ACCOUNT, UNKNOWN_ACCESS_KEY (MPC-05, MPC-04) | VERIFIED | `src/server/recovery/wallet.ts:84-125` `checkWalletAccess` final line: `return result.result.permission === 'FullAccess';`. The pre-fix `return !result.error` is gone. Outer try/catch removed → fetch errors propagate (MPC-10). `src/server/mpc.ts:657-666` `verifyRecoveryWallet` delegates directly with no swallow. Tests: `wallet.test.ts:197-263` MPC-05 describe block (FunctionCall→false, FullAccess→true regression, UNKNOWN_ACCOUNT→false); `mpc-account-manager.test.ts:331-374` T8/T9/T10 unit tests; `wallet.test.ts:170-176` migrated test now uses `rejects.toThrow('Network error')`. |
| 7 | Concurrent `createAccount(sameUserId)` calls converge to identical results (MPC-06) | VERIFIED | `src/server/mpc.ts:500-514` Step 5: when `fundResult.error` matches `isLikelyNonceRace` (regex `InvalidNonce|nonce|TxAlreadyProcessed`), re-runs `accountExists`; if true, returns `onChain: true`. T6-bonus unit test at `mpc-account-manager.test.ts:262-287` asserts the converge-on-InvalidNonce path; T11 testnet test at lines 309-324 covers full real-world concurrent calls. |
| 8 | `derivationSalt` REQUIRED at the type boundary (MPC-07) | VERIFIED | `src/server/mpc.ts:42-49` `MPCAccountManagerConfig` has `derivationSalt: string` (no `?`). `src/__tests__/mpc-treasury-leak.test.ts:211-241` Gate 4 spawns child `tsc --noEmit` against a fixture omitting `derivationSalt`, expects exit 1, and asserts the error text mentions `derivationSalt`. |
| 9 | `parseNearAmount` from `@near-js/utils` is used for yoctoNEAR conversion (MPC-08) | VERIFIED | `src/server/mpc.ts:16` `import { parseNearAmount } from '@near-js/utils';`. `src/server/mpc.ts:185` `const yoctoStr = parseNearAmount(amountNear);`. T-MPC-08 unit test at `mpc-account-manager.test.ts:200-224` decodes the base64 `broadcast_tx_commit` body and verifies the borsh u128 little-endian byte sequence for 10^22 (= `parseNearAmount('0.01')`) is present. |
| 10 | Treasury private key VALUE never leaks (MPC-09) — KeyPair-only field, dist contains no key literal, pino redact wired | VERIFIED | `src/server/mpc.ts:380` `private keyPair?: KeyPair` (no raw string field). `src/server/mpc.ts:390-396` constructor materializes once via `KeyPair.fromString(...)`. `src/server/mpc.ts:404-414` default-silent logger wired with `redact.paths: ['config.treasuryPrivateKey', '*.treasuryPrivateKey', 'treasuryPrivateKey']` (mirrored in `dist/server/index.js:1312-1316`). Direct grep of `dist/server/index.js` for `ed25519:[A-Za-z0-9]{40,}` → only matches are `replace("ed25519:", "")` and template-string concatenations; no embedded key value. Tests: `mpc-treasury-leak.test.ts` Gates 1-3 (dist literal scan, runtime log capture, redaction smoke). |
| 11 | Error paths throw classified Errors with `cause` set (MPC-10) | VERIFIED | `src/server/mpc.ts:519` `throw new Error('RPC unreachable', { cause: new Error(errorText) });`. Line 522: `throw new Error('Treasury underfunded', ...)`. Line 524: `throw new Error('Transfer failed', ...)`. T5 (`mpc-account-manager.test.ts:234-245`) asserts `rejects.toThrow(/RPC unreachable|Transfer failed/)`. T6 asserts `rejects.toThrow('Treasury underfunded')`. `verifyRecoveryWallet` no longer swallows fetch errors (per Plan 03 wallet.ts rewrite + Plan 04 mpc.ts wrapper simplification). |
| 12 | All 12 spec scenarios T1–T12 pass under `npm test` (MPC-11) | VERIFIED | `src/__tests__/mpc-account-manager.test.ts` populated by Plan 04 with real assertions across 5 describe blocks. T1, T2, T7, T11 are testnet-guarded via `describe.skipIf(!HAVE_TESTNET)` (4 tests skipped when `NEAR_TREASURY_ACCOUNT` unset). T3, T4, T5, T6, T8, T9, T10, T12 + T3-bonus + T6-bonus + T-MPC-08 are unit tests with mocked fetch. Orchestrator-confirmed live: full suite reports 282 passing + 4 testnet-skipped = 286 total, 0 failures. |
| 13 | `npm publish` succeeded at v0.6.1 and fresh-consumer smoke install resolves the import (MPC-12) | VERIFIED | `package.json:3` shows `"version": "0.6.1"`. `package-lock.json` top-level version also `0.6.1`. `CHANGELOG.md` exists (88 lines) with `## [0.6.1] — 2026-04-29` entry covering MPC-01/03/04/05/06/07/08/09/10. `README.md:290` has `## MPCAccountManager (v0.6.1+)` section with derivation, idempotency contract, security expectations, frozen pin notice. Orchestrator-confirmed live: `npm view @vitalpoint/near-phantom-auth dist-tags` returns `latest: 0.6.1`; smoke install in tempdir succeeded with `typeof MPCAccountManager === 'function'`; git tag `v0.6.1` pushed to origin. |
| 14 | All 12 MPC-* requirement IDs present in plan frontmatter and traceable to closing artifacts | VERIFIED | Plans cover full set: 10-01→MPC-01; 10-02→MPC-11; 10-03→MPC-04,05; 10-04→MPC-02,03,06,08,09,10,11; 10-05→MPC-07,09; 10-06→MPC-12. Set union = MPC-01..MPC-12 (12/12). REQUIREMENTS.md does not assign any MPC-* ID to a different phase or leave any orphaned. |

**Score:** 14/14 truths verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/server/index.ts` (line 260-261) | Value export of `MPCAccountManager`; type re-exports of `MPCAccountManagerConfig`, `CreateAccountResult` | VERIFIED | Line 260: `export { MPCAccountManager } from './mpc.js';`. Line 261: `export type { MPCAccountManagerConfig, CreateAccountResult, MPCConfig, MPCAccount } from './mpc.js';`. |
| `src/server/mpc.ts` | Hardened class: KeyPair field, parseNearAmount, classified throws, idempotency, nonce-race convergence, redact-wired logger | VERIFIED | 688 lines. Class field `private keyPair?: KeyPair` (line 380). `parseNearAmount` import (line 16) and use (line 185). Three classified throws (lines 519, 522, 524). Idempotency block (lines 456-465). Nonce-race convergence (lines 500-514). Redact wiring (lines 404-414). |
| `src/server/recovery/wallet.ts` | `checkWalletAccess` rewritten with FullAccess gate; outer try/catch removed | VERIFIED | 211 lines. Function at lines 84-125. Final return `result.result.permission === 'FullAccess'` (line 124). No outer try/catch — fetch errors propagate. |
| `src/__tests__/exports.test.ts` | 10 regression tests (4 describe blocks; runtime, type aliases, source-shape, dist artifact) | VERIFIED | 113 lines, 4 describe blocks. Block 4 is `describe.skipIf(!haveDist)` and contains 2 dist-runtime tests. Per CHANGELOG note: 10-test count. |
| `src/__tests__/mpc-account-manager.test.ts` | T1-T12 + 3 bonus assertions; 5 describe blocks; 2 testnet-guarded | VERIFIED | 376 lines. 5 describe blocks: 2 `describe.skipIf(!HAVE_TESTNET)` (T1,T2 / T7,T11 = 4 tests), 3 unit (T3,T4,T12,T3-bonus,T-MPC-08 / T5,T6,T6-bonus / T8,T9,T10 = 11 tests). Total 15 it-cases (12 spec + 3 bonus). |
| `src/__tests__/mpc-treasury-leak.test.ts` | 6 gates: dist scan, log capture, redact smoke, type-level salt enforcement | VERIFIED | 243 lines. 4 describe blocks (Gate 1 splits into 2 sub-tests; Gate 4 splits into 2 sub-tests) → 6 total tests. Gate 1 wraps in `describe.skipIf(!distExists)` — actively running because `dist/` is committed. |
| `src/__tests__/wallet.test.ts` | New "MPC-05: FullAccess permission gate" describe block; migrated network-failure test now `rejects.toThrow` | VERIFIED | Line 197 `describe('checkWalletAccess — MPC-05: FullAccess permission gate', ...)` with 3 sub-tests (FunctionCall→false, FullAccess→true regression, UNKNOWN_ACCOUNT→false). Line 175 uses `rejects.toThrow('Network error')`. Old `returns false when fetch throws` form is gone. |
| `package.json` | version 0.6.1 | VERIFIED | Line 3: `"version": "0.6.1"`. |
| `package-lock.json` | 0.6.1 root | VERIFIED | Top-level `"version": "0.6.1"` and embedded `@vitalpoint/near-phantom-auth` entry both at 0.6.1. |
| `CHANGELOG.md` | Keep-A-Changelog format; v0.6.1 entry calling out additive surface | VERIFIED | 88 lines. `## [0.6.1] — 2026-04-29` with Fixed (MPC-01/04/05), Added (MPC-07/09/08/06/10/03 + CreateAccountResult + test coverage), Notes (additive only, zero new deps, behavior change). |
| `README.md` | `## MPCAccountManager (v0.6.1+)` section with derivation, config, security, code example | VERIFIED | 694 lines. Section starts at line 290. Includes import example, derivation function, idempotency contract, security expectations, frozen-pin notice. |
| `dist/server/index.js` | MPCAccountManager exported as class value at runtime | VERIFIED | Line 1290 `var MPCAccountManager = class`; line 3295 named-export footer includes it. |
| `dist/server/index.d.ts` | MPCAccountManager class declaration + type re-exports | VERIFIED | `declare class MPCAccountManager`; final export footer lists `MPCAccountManager` (value), `MPCAccountManagerConfig`, `CreateAccountResult`, `MPCConfig`, `MPCAccount`. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `src/server/index.ts` | `src/server/mpc.ts` (`MPCAccountManager`) | value export | WIRED | Line 260 `export { MPCAccountManager } from './mpc.js';` (no `type` modifier). |
| `src/server/index.ts` | `src/server/mpc.ts` (type aliases) | type re-export | WIRED | Line 261 names all 4 type aliases. |
| `src/server/mpc.ts` (`createAccount`) | `@near-js/utils` (`parseNearAmount`) | import + call | WIRED | Import at line 16; call at line 185 inside `fundAccountFromTreasury`. |
| `src/server/mpc.ts` (`MPCAccountManager` constructor) | `@near-js/crypto` (`KeyPair`) | one-time materialization | WIRED | Import at line 15; `KeyPair.fromString(config.treasuryPrivateKey as 'ed25519:${string}')` at line 396; cached on `this.keyPair`; raw `config.treasuryPrivateKey` not retained. |
| `src/server/mpc.ts` (`verifyRecoveryWallet`) | `src/server/recovery/wallet.ts` (`checkWalletAccess`) | function delegation (no try/catch) | WIRED | Line 665 `return await checkWalletAccess(nearAccountId, recoveryWalletPublicKey, this.networkId);` — propagates fetch errors per MPC-10. |
| `src/server/mpc.ts` (`addRecoveryWallet`) | `this.keyPair` | `new KeyPairSigner(this.keyPair)` | WIRED | Line 552 — uses cached KeyPair object; no local `KeyPair.fromString` call. |
| `src/server/mpc.ts` constructor | pino redact paths | `redact: { paths: [...], censor: '[Redacted]' }` | WIRED | Lines 404-414. Dist mirror at `dist/server/index.js:1312-1316`. |
| `dist/server/index.js` | `MPCAccountManager` class | named-export footer | WIRED | Line 3295 named export list. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `MPCAccountManager.createAccount` | `result` (returned object) | `derivePublicKey(seed)` from `crypto.createHash('sha256')` of `implicit-${salt}-${userId}` → `bs58` encoding + hex toString | YES — deterministic SHA-256 + ed25519 derivation; no static fallback | FLOWING |
| `MPCAccountManager.createAccount` (treasury-funded path) | `fundResult.txHash` | `fundAccountFromTreasury` calls `broadcast_tx_commit` via fetch and reads `result.transaction.hash` | YES — real RPC interaction; T1 testnet test verifies real tx hash | FLOWING |
| `MPCAccountManager.verifyRecoveryWallet` | `boolean` return | `checkWalletAccess` parses `view_access_key` RPC response and reads `result.result.permission` | YES — real RPC; T7 testnet test verifies against real on-chain key | FLOWING |
| `dist/server/index.js` `MPCAccountManager` | class methods | tsup-bundled from `src/server/mpc.ts`; no tree-shake of named methods (verified by line 1290+ class declaration in dist) | YES | FLOWING |

### Behavioral Spot-Checks

Sandbox blocked `npx tsc`, `npm test`, and `gsd-sdk` invocations. The orchestrator already ran the full validation chain and confirmed:

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Type-check passes | `nvm use 20 && npx tsc --noEmit` | exit 0 | PASS (orchestrator-confirmed; not re-run in sandbox) |
| Full test suite | `nvm use 20 && npm test -- --run` | 282 passing + 4 testnet-skipped = 286 total, 0 failures | PASS (orchestrator-confirmed) |
| Build artifact | `npm run build` (run inside Plan 06) | tsup ESM + CJS + DTS produced; dist/server/index.js 109.86 KB | PASS (orchestrator-confirmed; dist/ committed and inspected) |
| npm registry | `npm view @vitalpoint/near-phantom-auth@0.6.1 version` | `0.6.1` | PASS (orchestrator-confirmed live) |
| Fresh consumer import | `node -e "import('@vitalpoint/near-phantom-auth/server').then(m => console.log(typeof m.MPCAccountManager))"` | `function` | PASS (orchestrator-confirmed live in `/tmp/tmp.qRUBGV0TOd`) |
| Constructor instantiation | `new MPCAccountManager({ networkId: 'testnet', treasuryAccount, treasuryPrivateKey, derivationSalt })` | no throw | PASS (orchestrator-confirmed live) |
| Static dist scan | grep for `ed25519:[A-Za-z0-9]{40,}` literals in `dist/server/index.js` | only `replace("ed25519:", "")` and template-string fragments — no embedded key | PASS (verified in this run via direct grep) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| MPC-01 | 10-01 | `MPCAccountManager` exported as runtime value from `/server` (ESM + CJS + DTS); v0.6.0 exports preserved | SATISFIED | `src/server/index.ts:260` value export; `dist/server/index.js:3295` named-export footer; `dist/server/index.d.ts` `declare class` + export footer; `exports.test.ts` 10 regression tests (orchestrator-confirmed pass) |
| MPC-02 | 10-04 | `createAccount(userId)` is pure function of `(treasuryAccount, userId, derivationSalt)`; same args → same nearAccountId/mpcPublicKey/derivationPath; documented in README | SATISFIED | `src/server/mpc.ts:444-451` deterministic derivation; T3, T12 unit tests; README "Derivation Function" subsection at lines 290-345 |
| MPC-03 | 10-04 | Idempotent + atomic — `view_account` short-circuit returns onChain=true without duplicate transfer | SATISFIED | `mpc.ts:456-465` short-circuit; T3-bonus test asserts second call has zero broadcast calls |
| MPC-04 | 10-03 | `nearAccountId` matches `/^[a-f0-9]{64}$/` (64-char lowercase-hex implicit account); named accounts NOT supported | SATISFIED | `mpc.ts:449` `publicKeyBytes.toString('hex')`; T12 unit test asserts regex on 5 distinct userId formats |
| MPC-05 | 10-03 | `verifyRecoveryWallet` returns true ONLY for FullAccess; FunctionCall, missing account, unrelated key → false (no throw); no signature verification in this method | SATISFIED | `wallet.ts:124` FullAccess gate; `wallet.test.ts:197-263` MPC-05 block; `mpc-account-manager.test.ts:331-374` T8/T9/T10 unit tests |
| MPC-06 | 10-04 | Concurrent `createAccount(sameUserId)` converges; nonce-race loser retries `view_account` once | SATISFIED | `mpc.ts:500-514` `isLikelyNonceRace` retry block; T6-bonus unit test; T11 testnet test |
| MPC-07 | 10-05 | `MPCAccountManagerConfig.derivationSalt` REQUIRED; cross-tenant isolation | SATISFIED | `mpc.ts:46` `derivationSalt: string` (no `?`); `mpc-treasury-leak.test.ts:211-241` Gate 4 spawns child tsc and asserts compile failure when omitted; T4 asserts distinct salts → distinct accounts |
| MPC-08 | 10-04 | `fundingAmount` decimal-NEAR string; converts via `parseNearAmount` from `@near-js/utils`; networkId drives RPC URL | SATISFIED | `mpc.ts:16` import; `mpc.ts:185` `parseNearAmount(amountNear)`; `getRPCUrl(networkId)` at lines 69-73; T-MPC-08 test verifies 10^22 byte sequence in broadcast body |
| MPC-09 | 10-04 + 10-05 | Treasury private key in memory only; not written to disk, not logged, not in stack traces; consumer API stays synchronous | SATISFIED | `mpc.ts:380` `private keyPair?: KeyPair` (no raw string field); `mpc.ts:396` one-time materialization; `mpc.ts:404-414` redact paths; `dist/server/*.js,*.cjs` scan for `ed25519:<base58>` returns 0; `mpc-treasury-leak.test.ts` 6 gates |
| MPC-10 | 10-04 | Classified throws with cause: RPC unreachable, Treasury underfunded, Transfer failed; `verifyRecoveryWallet` swallows missing-account, propagates RPC-unreachable | SATISFIED | `mpc.ts:519,522,524` three classified throws with `cause`; `mpc.ts:665` `verifyRecoveryWallet` delegates to `checkWalletAccess` (no try/catch); `wallet.ts:96-110` no outer try/catch — fetch errors propagate; `mpc.ts:120` returns false on result.error |
| MPC-11 | 10-02 + 10-04 | Test suite covers all 12 T-scenarios (T1, T2, T7, T11 testnet; remainder unit-mocked) | SATISFIED | `mpc-account-manager.test.ts` 376 lines, 5 describe blocks, 12 spec + 3 bonus tests; testnet block uses `describe.skipIf(!HAVE_TESTNET)` |
| MPC-12 | 10-06 | README documents class + derivation + security; CHANGELOG calls out additive surface; `npm publish` at v0.6.1 succeeds; fresh consumer smoke install passes | SATISFIED | `package.json:3` 0.6.1; `CHANGELOG.md` `## [0.6.1]` entry; `README.md:290` MPCAccountManager section; orchestrator-confirmed npm registry shows 0.6.1 latest, smoke install passed, tag pushed |

**Coverage:** 12/12 requirements satisfied. No orphaned MPC-* IDs (REQUIREMENTS.md "Phase Mapping" lists exactly the 12 IDs assigned to Phase 10; all are claimed by at least one Plan in this phase).

### Anti-Patterns Found

None. Source files were scanned for:

- TODO/FIXME/XXX/HACK/PLACEHOLDER in `src/server/mpc.ts`, `src/server/recovery/wallet.ts`, `src/server/index.ts` — none in phase-10 modified regions
- Hardcoded empty array/object returns from `createAccount`/`verifyRecoveryWallet` — all return paths produce real data or throw classified errors
- console.* in source — none (project enforces pino-only logging via Phase 3 SEC-06)
- Stub onSubmit/onClick handlers — N/A (server-only changes)
- Empty `{ message: 'Not implemented' }` — N/A
- Treasury key VALUE in dist — verified absent via direct grep of `dist/server/index.js` for `ed25519:[A-Za-z0-9]{40,}`; only safe usage patterns (replace prefix, template construction) appear

### Human Verification Required

None. All goal-affecting checks are objectively verifiable from file reads, dist artifacts, and orchestrator-confirmed live evidence (registry, smoke install, tag push). Visual inspection / UX testing is not applicable — this is a server-side library hotfix.

The only remaining "human" surfaces are:

- **Live downstream consumer integration** (Ledgera mpc-sidecar restart loop resolution): This is the originating motivation for the phase. Confirming the consumer's restart loop is actually broken requires Ledgera to deploy `@vitalpoint/near-phantom-auth@0.6.1` and observe their pod metrics. This is OUTSIDE the scope of this library's verification — the library's contract obligation (runtime-resolvable `MPCAccountManager` import + working `createAccount`/`verifyRecoveryWallet`) is independently verified above.

### Gaps Summary

No gaps. All 12 MPC-* requirements satisfied with concrete codebase evidence. The phase ships a hardened, tested, published v0.6.1 hotfix that meets the FROZEN consumer-pin contract.

**Notable strengths:**

1. **Three-layer defense on MPC-09** (treasury key isolation): KeyPair-only field, redact-wired logger, and runtime log-capture audit. Even if a future change adds `log.info({ config }, '...')` somewhere, the redact path emits `[Redacted]` instead of the secret.
2. **MPC-07 is enforced at compile time, not just runtime.** The `tsc-fail` fixture (`mpc-treasury-leak.test.ts:211-241`) actively spawns a child compiler and asserts the type system rejects a config without `derivationSalt`.
3. **MPC-10 propagation symmetry.** Both `createAccount` (throws classified errors) and `verifyRecoveryWallet` (propagates fetch failures, swallows account-not-found) implement the contract consistently — no asymmetric error-handling that would surprise consumers.
4. **Idempotency is assertion-tested, not just observed.** T3-bonus's mock counts `broadcast_tx_commit` calls and asserts zero on the second call; T6-bonus simulates the InvalidNonce race and asserts convergence.

**Known deviations** (all documented in summaries; do not affect contract):

1. Plan 10-05 Gate 1 wording was rewritten from "zero `treasuryPrivateKey` matches in dist" to "zero `ed25519:<base58>` literal matches" because the constructor must read `config.treasuryPrivateKey` to materialize the KeyPair. The MPC-09 invariant (no key VALUE in dist) is strictly enforced; only the field NAME pattern was loosened to permit legitimate property access. Verified independently in this audit.
2. Several plans were re-dispatched in sequential mode after worktree-mode hit a base-mismatch bug. Final commits cover all task content (per `gsd-plan` orchestrator history).
3. Plan 10-06 npm publish required interactive 2FA OTP. User re-authenticated, orchestrator ran `npm publish --access public --otp=<code>`. Registry verified live.

## Next Steps

**Phase 10 closure: APPROVED.** All 14 must-have truths verified, all 12 MPC-* requirements satisfied, no gaps and no human verification items.

Suggested orchestrator actions:

1. Mark Phase 10 / milestone v0.6.1 as **complete** in `STATE.md` and `ROADMAP.md` (already shows `[x]` and Status `Complete` 2026-04-29).
2. Bundle this VERIFICATION.md with Phase 10 artifacts.
3. Resume the v0.5/v0.6 main milestone roadmap — Phase 8 (Wire OAuth Callback to DB-Backed State Validation) is the next planned item per ROADMAP.md.
4. Consider an `npm dist-tag add @vitalpoint/near-phantom-auth@0.6.1 v0.6` follow-up if needed for downstream pinning policy (not in scope of MPC-12).

---

_Verified: 2026-04-29_
_Verifier: Claude (gsd-verifier)_
