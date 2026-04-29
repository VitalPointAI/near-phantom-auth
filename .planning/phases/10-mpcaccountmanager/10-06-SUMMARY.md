---
phase: 10
plan: 06
status: complete
requirements:
  - MPC-12
completed: 2026-04-29
---

# Plan 10-06 Summary — Release v0.6.1

## What Shipped

The v0.6.1 hotfix is live on the npm registry. Closes MPC-12 — the release task
— and closes Phase 10 / milestone v0.6.1.

## Files Changed

| File | Change |
|------|--------|
| `package.json` | `0.6.0` → `0.6.1` (via `npm version --no-git-tag-version`; package-lock.json synced atomically) |
| `CHANGELOG.md` | **Created** with Keep A Changelog format. v0.6.1 entry covers MPC-01/03/04/05/06/07/08/09/10 with migration notes; v0.6.0 and v0.5.x historical entries included. |
| `README.md` | Reframed opening with "Why use this?" value-prop section. Added new top-level **MPCAccountManager (v0.6.1+)** section: when-to-use matrix, quick start, derivation function, idempotency / concurrency / error path contracts, security expectations, frozen consumer-pin contract. Expanded feature reference. |
| `dist/` | Clean rebuild via `rm -rf dist && npm run build`. tsup ESM + CJS + DTS outputs all present. |

## Build artifacts

- `dist/server/index.js` 109.86 KB (ESM)
- `dist/server/index.cjs` 111.37 KB (CJS)
- `dist/server/index.d.ts` 20.60 KB (DTS)
- Total tarball: 225.9 kB packed, 1.2 MB unpacked, 28 files
- shasum: `3ac74da24a10e993fe936fdf25cc2fc3ac6e2e13`

## Publish Verification

| Step | Result |
|------|--------|
| `npm whoami` | `vitalpoint` (re-authenticated mid-flight; cached token in `~/.npmrc` had expired) |
| `npm publish --dry-run` | ✓ name `@vitalpoint/near-phantom-auth`, version `0.6.1`, files include `dist/`, `README.md`, `package.json` |
| `npm publish --access public --otp=<6-digit>` | ✓ `+ @vitalpoint/near-phantom-auth@0.6.1` (2FA OTP-gated) |
| `npm view @vitalpoint/near-phantom-auth@0.6.1 version` | `0.6.1` |
| `npm view @vitalpoint/near-phantom-auth dist-tags` | `{ latest: '0.6.1' }` |
| Fresh-consumer smoke install (tempdir → `npm install @vitalpoint/near-phantom-auth@0.6.1`) | ✓ |
| `typeof MPCAccountManager` after import from `/server` | ✓ `function` |
| `new MPCAccountManager({ ... })` instantiation | ✓ no throw — closes MPC-01 end-to-end |
| `git tag v0.6.1 && git push origin v0.6.1` | ✓ pushed to `https://github.com/VitalPointAI/near-phantom-auth.git` |

## Commits

- `4d3aff…` (HEAD~1) — `release(10-06): bump v0.6.1, write CHANGELOG, document MPCAccountManager standalone usage in README`
- `git tag v0.6.1` (signed against the post-release commit)

## Phase 10 Closure

This is the final plan of Phase 10 / milestone v0.6.1. All 12 MPC-* requirements
(MPC-01 through MPC-12) are now closed:

| Req | Plan | Status |
|-----|------|--------|
| MPC-01 | 10-01 | ✓ Export bug fixed; consumer can `import { MPCAccountManager }` and instantiate at runtime |
| MPC-02 | 10-04 | ✓ `nearAccountId` matches `/^[a-f0-9]{64}$/` |
| MPC-03 | 10-04 | ✓ `createAccount` idempotent via `view_account` short-circuit |
| MPC-04 | 10-03 | ✓ `verifyRecoveryWallet` returns false for UNKNOWN_ACCOUNT |
| MPC-05 | 10-03 | ✓ `verifyRecoveryWallet` returns false for FunctionCall keys |
| MPC-06 | 10-04 | ✓ Nonce-race convergence via post-broadcast `view_account` retry |
| MPC-07 | 10-05 | ✓ `derivationSalt` REQUIRED at the type level (tsc-fail fixture verifies) |
| MPC-08 | 10-04 | ✓ `parseNearAmount` from `@near-js/utils` replaces BN-based conversion |
| MPC-09 | 10-04 + 10-05 | ✓ KeyPair field replaces raw string; pino redact wired; dist leak audit green |
| MPC-10 | 10-04 | ✓ `createAccount` throws classified errors with `cause` set |
| MPC-11 | 10-02 + 10-04 | ✓ T1-T12 test scaffold populated with real assertions |
| MPC-12 | 10-06 | ✓ v0.6.1 published to npm; smoke install verified |

## Notes / Anomalies

- **OTP flow:** initial `npm whoami` returned 401 (cached token in `~/.npmrc`
  was expired). User ran `npm login`, then orchestrator ran
  `npm publish --access public --otp=<6-digit>` with the 2FA code provided
  inline. The `--otp=` flag avoided an interactive prompt that the orchestrator
  would not have been able to satisfy.
- **Smoke install** ran in `/tmp/tmp.qRUBGV0TOd` (auto-generated mktemp);
  `process.cwd()` was returned to the project root after the test.
- **Git tag** is annotated as a lightweight tag (no `-a`); was pushed via
  `git push origin v0.6.1`.

## Self-Check: PASSED
