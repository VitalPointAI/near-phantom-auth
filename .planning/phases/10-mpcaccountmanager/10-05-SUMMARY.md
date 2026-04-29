---
phase: 10
plan: 05
status: complete
requirements:
  - MPC-07
  - MPC-09
completed: 2026-04-29
---

# Plan 10-05 Summary — Treasury Leak Audit + Pino Redaction Wiring

## What Shipped

Closes MPC-07 (derivationSalt required at the type level) and MPC-09 (treasury
private key never leaks to logs, dist bundle, or any observable surface). This
plan adds belt-and-suspenders coverage on top of Plan 10-04's KeyPair-field
hardening:

1. **Pino redact wiring** in `MPCAccountManager`'s default-silent logger —
   any future accidental `log.info({ config }, '...')` call emits `[Redacted]`
   instead of the secret.
2. **6-gate regression-blocking audit test** (`mpc-treasury-leak.test.ts`)
   that proves the key value never reaches dist/, runtime logs, or a config
   without `derivationSalt`.

## Files Changed

### `src/server/mpc.ts` (+12/-1 lines)
Updated the constructor's logger setup to add redact paths to the default
silent pino instance:

```typescript
this.log = (config.logger ?? pino({
  level: 'silent',
  redact: {
    paths: ['config.treasuryPrivateKey', '*.treasuryPrivateKey', 'treasuryPrivateKey'],
    censor: '[Redacted]',
  },
})).child({ module: 'mpc' });
```

### `src/__tests__/mpc-treasury-leak.test.ts` (new, 230 lines, 6 tests)

| Gate | Describe block | Test count |
|------|----------------|------------|
| 1: dist/ static analysis (skipped if no dist) | MPC-09 | 2 |
| 2: runtime log capture | MPC-09 | 1 |
| 3: redaction wiring smoke | MPC-09 | 1 |
| 4: type-level derivationSalt enforcement | MPC-07 | 2 |

Gate 4's "fails-tsc" test spawns a child `tsc --noEmit` process on a
deliberately-broken fixture (omitting `derivationSalt`), expects exit 1, and
verifies the error mentions `derivationSalt`. The fixture is cleaned up in a
finally block.

## Verification Results

| Check | Status |
|-------|--------|
| `nvm use 20 && npx tsc --noEmit` | ✓ exit 0 |
| `npm test -- --run src/__tests__/mpc-treasury-leak.test.ts` | ✓ 6/6 pass |
| `npm test -- --run src/__tests__/logging.test.ts` | ✓ 9/9 stay green |
| Full suite `npm test -- --run` | ✓ 282 pass + 4 skipped = 286 total, 0 failures |
| dist/server/*.js,*.cjs scan for ed25519:<base58> string literals | ✓ 0 matches |
| dist/server/*.js,*.cjs scan for treasuryPrivateKey field NAME | 6 hits, all legitimate property-access patterns (constructor materialization + createAnonAuth pass-through) — filtered out by Gate 1 |

## Plan Deviation: Gate 1 wording

Plan 10-05's truth claim said:
> grep -rn treasuryPrivateKey dist/server/ --include=\*.js --include=\*.cjs returns zero matches

That is too strict — the constructor MUST read `config.treasuryPrivateKey` to
materialize the KeyPair, and `createAnonAuth` must pass it through to
`MPCAccountManager`. Both produce field-NAME occurrences in compiled JS.

The MPC-09 invariant is about the private key VALUE never leaking, not about
the field name being absent from compiled code. Gate 1 was rewritten to filter
out legitimate property-access patterns and only fail on `ed25519:<40+ base58>`
string literals — the actual leak signature. Gate 1's second sub-test still
runs an unconditional `ed25519:<base58>` literal scan across all dist files
(JS/CJS/d.ts).

This is a non-load-bearing wording deviation; the security invariant is
strictly enforced.

## Commits

- `4c904c7` `feat(10-05): treasury key leak audit + pino redact wiring (MPC-07/MPC-09)`

## Notes for Plan 06

- After `npm run build` runs in Plan 06, the leak audit's Gate 1 will execute
  fully (currently dist/ exists from this plan's verification, so it's already
  active). Verify it stays green after the publish-prep build.
- The `MPCAccountManagerConfig` type-level enforcement adds the derivationSalt
  requirement to the consumer-facing API. This means consumers upgrading from
  v0.6.0 → v0.6.1 will see a TypeScript error if they were instantiating
  `MPCAccountManager` directly without providing `derivationSalt`. Plan 06's
  CHANGELOG and README must call this out as a behavior change.

## Self-Check: PASSED
