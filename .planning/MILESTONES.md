# Milestones

## v0.6.1 MPCAccountManager hotfix (Shipped: 2026-04-29)

**Scope:** Phase 10 only — surgical hotfix for the v0.6.0 production bug where
`MPCAccountManager` was `export type`-stripped to `undefined` at runtime,
breaking the Ledgera mpc-sidecar consumer. Additive only: all v0.6.0 exports
unchanged; 12 new MPC-* requirements (MPC-01 through MPC-12) closed.

**Stats:**
- Phases: 1 (Phase 10 — MPCAccountManager)
- Plans: 6 (10-01 through 10-06)
- Tasks: ~12 across 5 waves
- Commits: 24 (`b3f51cc` → `500733e`)
- Files changed: 49 files, +7125 / -487 (most of the diff is dist/ rebuild)
- Source changes: `src/server/mpc.ts`, `src/server/index.ts`,
  `src/server/recovery/wallet.ts`, plus 4 new test files
- Timeline: 2026-04-28 16:07 → 2026-04-29 08:59 (~17 hours)
- Test suite: 280 (252 baseline + 28 new), 0 failures
- Published: `@vitalpoint/near-phantom-auth@0.6.1` to npm; git tag `v0.6.1` pushed

**Key accomplishments:**

1. **MPC-01 export bug fixed** — `import { MPCAccountManager }` resolves to a
   runtime constructor (was stripped by TypeScript's `export type`). The
   Ledgera mpc-sidecar restart loop closes end-to-end; fresh-consumer smoke
   install confirms `typeof MPCAccountManager === 'function'`.
2. **MPC-04 / MPC-05 wallet permission gate** — `verifyRecoveryWallet` now
   correctly rejects FunctionCall-only access keys (was returning true for any
   non-error RPC response). Deleted accounts return `false` without throwing.
3. **MPC-09 treasury key isolation** — three-layer defense: KeyPair object
   replaces raw private-key string field; pino redact paths wired into the
   default logger; dist bundle leak-audited at build time (zero
   `ed25519:<base58>` literals).
4. **MPC-10 classified throws** — `createAccount` throws
   `Error('RPC unreachable' | 'Treasury underfunded' | 'Transfer failed')`
   with `{ cause }` set. Removed the degraded-return pattern that masked
   failures behind a `mpcPublicKey: 'creation-failed'` placeholder.
5. **MPC-03 / MPC-06 idempotency + nonce-race convergence** — second
   `createAccount` call short-circuits via `view_account` (zero broadcasts
   on retry); concurrent calls retry view_account once on InvalidNonce and
   converge to a single provisioned account.
6. **MPC-07 derivationSalt enforcement at the type level** — `MPCAccountManagerConfig`
   makes `derivationSalt` REQUIRED. A tsc-fail child-process fixture verifies
   TypeScript rejects configs that omit it.
7. **MPC-12 published to npm** — `@vitalpoint/near-phantom-auth@0.6.1`
   (latest), 225.9 kB packed, smoke install passes, git tag pushed to origin.

**Known deferred items at close:** 2 (see `STATE.md > Deferred Items`).
Both are PRF cross-browser test scenarios carried over from v0.6.0 (which
was never formally closed). They require physical Firefox / Safari / hardware
key devices and are orthogonal to the v0.6.1 hotfix scope.

**Notes:**
- This is the project's first formal milestone close. Phases 1–9 shipped
  under v0.5.x (Phases 1–8) and v0.6.0 (Phase 9) but never went through
  `/gsd-complete-milestone` — they remain visible in the archived ROADMAP
  at `milestones/v0.6.1-ROADMAP.md` for historical traceability.
- Zero new npm dependencies. `parseNearAmount` and `KeyPair` were already
  available via `@near-js/utils` and `@near-js/crypto`.
- Plan execution hit two infrastructure issues (worktree base-mismatch bug
  on parallel dispatch; executor sandbox blocking `git`/`npm`/`nvm`) and one
  stream timeout. All recovered cleanly via orchestrator-driven sequential
  execution. Documented in each affected plan's SUMMARY.

---
