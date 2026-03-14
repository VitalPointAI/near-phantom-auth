# Phase 3: Structured Logging - Research

**Researched:** 2026-03-14
**Domain:** Structured logging with pino — injectable logger, redaction, no-op default
**Confidence:** HIGH

## Summary

Phase 3 eliminates all `console.*` calls from `src/server/` and replaces them with a structured JSON logger (pino). The library is consumer-facing: it must accept an optional `pino.Logger` instance via `AnonAuthConfig.logger`, default to a no-op logger when none is provided, and never install a global logger or produce output silently.

There are exactly 38 `console.*` call sites across 7 files in `src/server/`: `router.ts` (12), `mpc.ts` (15), `passkey.ts` (2), `session.ts` (1), `middleware.ts` (2), `recovery/wallet.ts` (1), `recovery/ipfs.ts` (1), `oauth/router.ts` (4). The most security-critical concern is `mpc.ts`, which logs `derivationPath` and references `treasuryPrivateKey` in its config — both must be redacted if they appear in log output.

The key architectural decision is the injection pattern: `AnonAuthConfig` receives an optional `logger?: pino.Logger`, which is threaded through every manager and router config. The no-op default is `pino({ level: 'silent' })` — pino's own `silent` level disables all logging (its `silent` method is a documented noop). No custom stub interface is needed; `pino.Logger` is the contract.

**Primary recommendation:** Add `pino` as a production dependency, add `logger?: pino.Logger` to `AnonAuthConfig` and all internal *Config interfaces, pass a `pino({ level: 'silent' })` default from `createAnonAuth`, replace every `console.*` with `logger.{error|warn|info|debug}`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-06 | Sensitive data (treasury keys, derivation paths, MPC public keys) redacted from production logs | Pino `redact` option with `paths` array and `censor`/`remove` eliminates these fields at serialization time. Specific paths identified below. |
| INFRA-01 | Structured logging replaces all console.log/error statements (pino or similar) | 38 console call sites catalogued across 7 files. Pino chosen; `level: 'silent'` default satisfies no-output requirement. Injectable via `AnonAuthConfig.logger`. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pino | ^10.3.1 | Structured JSON logging | De facto standard in Node.js server ecosystem; types bundled; supports `level: 'silent'` noop; built-in redaction via `fast-redact` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | pino bundles its own TypeScript types (`pino.d.ts`) | No `@types/pino` needed — types ship with the package |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pino | winston | winston is heavier, no built-in redaction, slower serialization |
| pino | bunyan | bunyan is abandoned; pino is its spiritual successor |
| pino | abstract-logging (custom interface) | Adds complexity; pino.Logger already provides the injectable contract |

**Installation:**
```bash
npm install pino
```

## Architecture Patterns

### Logger Threading Pattern

The library must thread a single logger instance from `createAnonAuth` through all internal managers and routers. No manager should create its own logger.

```
createAnonAuth(config)
  └─ logger = config.logger ?? pino({ level: 'silent' })
       ├─ createSessionManager(db, { secret, durationMs, logger })
       ├─ createPasskeyManager(db, { rpName, rpId, origin, logger })
       ├─ createMPCManager({ networkId, ..., logger })
       ├─ createWalletRecoveryManager({ nearNetwork, logger })
       ├─ createIPFSRecoveryManager(config.recovery.ipfs, logger)   ← positional or config field
       ├─ createRouter({ db, sessionManager, ..., logger })
       ├─ createOAuthRouter({ db, sessionManager, ..., logger })
       └─ createAuthMiddleware(sessionManager, db, logger)
            createRequireAuth(sessionManager, db, logger)
```

### Pattern 1: No-Op Default Logger

**What:** When `AnonAuthConfig.logger` is absent, instantiate `pino({ level: 'silent' })`. All logging methods resolve to pino's built-in noop. Zero output, zero overhead.

**When to use:** Always, as the default.

```typescript
// Source: pino.d.ts (pino TypeScript definitions, level 'silent' documented)
import pino from 'pino';

const NOOP_LOGGER = pino({ level: 'silent' });

export function createAnonAuth(config: AnonAuthConfig): AnonAuthInstance {
  const logger = config.logger ?? NOOP_LOGGER;
  // ...
}
```

**Important:** Do NOT call `pino()` with defaults — that writes to stdout. Only `pino({ level: 'silent' })` is safe as a library default.

### Pattern 2: Injectable Logger via AnonAuthConfig

**What:** Add `logger?: pino.Logger` to `AnonAuthConfig` (types/index.ts). Consumer passes their own pino instance; library logs appear in that stream.

```typescript
// In types/index.ts
import type pino from 'pino';

export interface AnonAuthConfig {
  // ... existing fields ...
  /** Optional pino logger instance. If omitted, logging is disabled (no-op). */
  logger?: pino.Logger;
}
```

The type import must be `import type pino from 'pino'` to avoid pulling pino into bundles for consumers who do not use logging.

### Pattern 3: Child Logger for Module Context

**What:** Each manager creates a child logger binding its module name. This adds a fixed `module` field to every log entry, enabling log filtering by subsystem.

```typescript
// Source: pino docs — logger.child(bindings)
export function createMPCManager(config: MPCConfig & { logger?: pino.Logger }): MPCAccountManager {
  const log = (config.logger ?? NOOP_LOGGER).child({ module: 'mpc' });
  // log.info({ nearAccountId }, 'Creating NEAR account');
}
```

### Pattern 4: Redacting Sensitive Fields

**What:** Pino's `redact` option in `pino(options)` replaces field values with a censor string before serialization. The consumer passes their logger — but the *library* controls what gets logged. Individual `log.*()` calls must not log raw sensitive values.

**The correct approach for this library:** Since the consumer provides the logger (and controls its `redact` config), the library must never pass sensitive values as log fields. The discipline is at the call site, not in the logger config.

**Fields that must never appear as log properties:**
- `treasuryPrivateKey` — never log, even masked
- `derivationPath` — omit from structured fields (it's a key derivation secret)
- `mpcPublicKey` — may appear in info logs if non-sensitive in context, but should be reviewed
- `sessionSecret` — never log
- Raw request body fields (passwords, tokens, etc.)

**Current violations in mpc.ts:**
```typescript
// BAD — logs derivationPath as a structured field (line 390-394)
console.log('[MPC] Creating NEAR account:', {
  nearAccountId,
  derivationPath,      // ← MUST be removed from log call
  mpcContractId: this.mpcContractId,
});

// BAD — logs adding recovery wallet with recoveryWalletId (line 486)
console.log('[MPC] Adding recovery wallet:', {
  nearAccountId,
  recoveryWalletId,    // ← review whether this is sensitive
});
```

**Fix pattern:**
```typescript
// GOOD — structured fields contain only non-sensitive context
log.info({ nearAccountId, network: this.networkId }, 'Creating NEAR account');
// derivationPath removed entirely from log call
```

### Pattern 5: Log Level Mapping from console.*

| console call | pino equivalent | Notes |
|-------------|-----------------|-------|
| `console.log` | `log.info` | General operational info |
| `console.warn` | `log.warn` | Non-fatal conditions |
| `console.error` | `log.error` | Errors, caught exceptions |

For caught errors, pass `{ err: error }` as first argument — pino serializes `err` with stack trace by default:

```typescript
// Source: pino docs — error serialization
log.error({ err: error }, '[AnonAuth] Registration start error');
// NOT: log.error('[AnonAuth] Registration start error:', error)
```

### Recommended Config Interface Changes

Every internal *Config interface that currently lacks a `logger` field needs one added:

| Interface | File | Change |
|-----------|------|--------|
| `AnonAuthConfig` | `src/types/index.ts` | Add `logger?: pino.Logger` |
| `RouterConfig` | `src/server/router.ts` | Add `logger?: pino.Logger` |
| `OAuthRouterConfig` | `src/server/oauth/router.ts` | Add `logger?: pino.Logger` |
| `MPCConfig` | `src/server/mpc.ts` | Add `logger?: pino.Logger` |
| `SessionConfig` | `src/server/session.ts` | Add `logger?: pino.Logger` |
| `PasskeyConfig` | `src/server/passkey.ts` | Add `logger?: pino.Logger` |
| `IPFSRecoveryConfig` | `src/server/recovery/ipfs.ts` | Add `logger?: pino.Logger` (or positional) |
| `WalletRecoveryConfig` | `src/server/recovery/wallet.ts` | Add `logger?: pino.Logger` |
| `createAuthMiddleware` / `createRequireAuth` | `src/server/middleware.ts` | Add `logger` parameter |

### Anti-Patterns to Avoid

- **Global pino instance:** Do not call `pino()` at module top level. It writes to stdout and persists across tests.
- **Logging sensitive config fields:** Never destructure and log `config.treasuryPrivateKey`, `config.sessionSecret`, or `config.mpc.derivationSalt`.
- **Duplicate logger creation:** Each manager takes the logger from its config; it does not call `pino()` itself.
- **String interpolation in log messages:** Use structured fields `{ key: value }` as the first argument, not template literals. Redaction only works on structured fields.
- **`pino()` with no options as default:** Bare `pino()` logs to stdout at info level — a library must not produce unsolicited output.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON serialization of log entries | Custom JSON logger | pino | pino uses `fast-json-stringify`; hand-rolled is slower and handles edge cases poorly |
| Field redaction | Custom filter function | pino `redact` option (on consumer's logger) | `fast-redact` handles nested paths, wildcards, and circular references |
| No-op logger | Custom `{ info: () => {}, warn: ... }` stub | `pino({ level: 'silent' })` | Avoids maintaining a parallel interface; stays compatible with `pino.Logger` type |
| Level hierarchy | Custom level enum | pino levels | pino's level system is well-understood by consumers |

**Key insight:** The no-op requirement is trivially satisfied by `level: 'silent'`. There is no need for a custom interface or stub object — pino's own type covers the contract.

## Common Pitfalls

### Pitfall 1: Logging sensitive fields as structured properties

**What goes wrong:** `log.info({ derivationPath, mpcPublicKey }, 'account created')` — these appear verbatim in JSON output even if the consumer's pino instance doesn't have redact configured.
**Why it happens:** Developers copy the existing `console.log(... { derivationPath })` pattern into pino calls.
**How to avoid:** During the console.* replacement, audit every field passed to `log.*()`. Remove `derivationPath`, `mpcPublicKey`, `treasuryPrivateKey`, `sessionSecret` from all log call arguments.
**Warning signs:** Any log call with `derivationPath` or `privateKey` as a property name.

### Pitfall 2: Bare pino() call used as default

**What goes wrong:** `const logger = config.logger ?? pino()` — the fallback `pino()` instance logs to stdout at info level, violating the "no output without explicit logger" requirement.
**Why it happens:** Looks innocuous; developers don't realize pino's default output destination is stdout.
**How to avoid:** Only use `pino({ level: 'silent' })` as the fallback.
**Warning signs:** Any `pino()` call without `{ level: 'silent' }` in a default/fallback position.

### Pitfall 3: ESM import of pino

**What goes wrong:** `import pino from 'pino'` fails at runtime in ESM contexts with older bundler configs, or the type-only import is used at runtime.
**Why it happens:** This project uses `"type": "module"` and tsup for bundling.
**How to avoid:** Use `import pino from 'pino'` (runtime import) where the logger is instantiated (only in `src/server/index.ts` for the default fallback). Use `import type pino from 'pino'` everywhere the type is used for annotation only.
**Warning signs:** `Cannot find module 'pino'` at runtime; `pino is not a function` errors.

### Pitfall 4: session.ts console.warn is inside a closure

**What goes wrong:** The `console.warn` in `session.ts` at line 203 is inside the `createSessionManager` closure, where `warnedNoUpdateSessionExpiry` state lives. The logger must be captured in the same closure, not passed per-call.
**Why it happens:** The warning state pattern requires closure scope.
**How to avoid:** Pass `logger` into `createSessionManager` config, capture it at closure creation time. The existing pattern already handles `warnedNoUpdateSessionExpiry` correctly — just substitute the logger.

### Pitfall 5: `pino.Logger` type reference in types/index.ts causes circular bundle

**What goes wrong:** Adding `import type pino from 'pino'` to `src/types/index.ts` may cause type-resolution issues if pino is not in `dependencies` at typecheck time.
**Why it happens:** Type imports from a dependency are fine only if the dependency is listed.
**How to avoid:** Add pino to `dependencies` (production, not devDependencies) — it is a runtime requirement for the default noop. Type imports resolve from the installed package.

## Code Examples

### Creating the no-op default and threading

```typescript
// src/server/index.ts (createAnonAuth)
// Source: pino docs — level: 'silent' disables all logging (noop)
import pino from 'pino';
import type { AnonAuthConfig } from '../types/index.js';

const NOOP_LOGGER: pino.Logger = pino({ level: 'silent' });

export function createAnonAuth(config: AnonAuthConfig): AnonAuthInstance {
  const logger = config.logger ?? NOOP_LOGGER;

  const mpcManager = createMPCManager({
    networkId: config.nearNetwork,
    // ...
    logger,
  });

  const router = createRouter({
    // ...
    logger,
  });
  // etc.
}
```

### Module-level child logger

```typescript
// src/server/mpc.ts
// Source: pino docs — child() binds fields to all log entries
import type pino from 'pino';

export interface MPCConfig {
  // existing fields...
  logger?: pino.Logger;
}

export function createMPCManager(config: MPCConfig): MPCAccountManager {
  const log = (config.logger ?? pino({ level: 'silent' })).child({ module: 'mpc' });

  // Later:
  log.info({ nearAccountId, network: config.networkId }, 'Creating NEAR account');
  // derivationPath intentionally omitted
}
```

### Error logging with stack trace serialization

```typescript
// pino serializes { err } with full stack trace automatically
log.error({ err: error }, 'Registration start error');
// NOT: log.error('Registration start error:', error)
```

### AnonAuthConfig type addition

```typescript
// src/types/index.ts
import type pino from 'pino';

export interface AnonAuthConfig {
  // ... existing fields ...

  /**
   * Optional pino logger instance. All library log output routes through this instance.
   * If not provided, logging is disabled (no output produced).
   * Do not pass a bare pino() instance without level configuration — the library
   * will not install a global logger or write to stdout by default.
   */
  logger?: pino.Logger;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `console.log` / `console.error` | `pino` structured JSON | Pino stable since v5 (2018); v10 current | Machine-parseable logs, redaction, level control |
| `@types/pino` separate package | Types bundled in `pino` | pino v7+ | No separate `@types/pino` needed |
| pino-noir (separate redaction) | `redact` built into pino | pino v5+ | Redaction is first-class, not a plugin |

**Deprecated/outdated:**
- `@types/pino`: Obsolete — pino ships its own `pino.d.ts`. Do not install.
- `pino-noir`: Obsolete — use pino's built-in `redact` option.

## Open Questions

1. **Should `mpcPublicKey` be logged?**
   - What we know: It's a public key (not secret), but the phase success criteria says "no MPC public key" in production logs.
   - What's unclear: Whether "no MPC public key in logs" means never log it, or just don't log it at startup in a way that correlates identity.
   - Recommendation: Omit from log call arguments by default; let SEC-06 drive the decision conservatively.

2. **Should `tsup.config.ts` externalize pino?**
   - What we know: The library bundles with tsup. Pino should be in `dependencies`, not bundled.
   - What's unclear: Whether tsup automatically externalizes `dependencies` or needs explicit config.
   - Recommendation: Verify tsup config before Wave 1; add `external: ['pino']` if needed to prevent double-bundling.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/__tests__/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | All console.* calls absent from src/server/ | static grep / unit | `grep -rn "console\." src/server/ --include="*.ts" \| wc -l` (expect 0) | ❌ Wave 0 |
| INFRA-01 | No-op default: `createAnonAuth({...})` without logger produces no stdout | unit | `npx vitest run src/__tests__/logging.test.ts` | ❌ Wave 0 |
| INFRA-01 | Injectable: consumer logger receives all log calls | unit | `npx vitest run src/__tests__/logging.test.ts` | ❌ Wave 0 |
| SEC-06 | No treasuryPrivateKey, derivationPath, mpcPublicKey, sessionSecret in log output | unit | `npx vitest run src/__tests__/logging.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `grep -rn "console\." src/server/ --include="*.ts"` (zero tolerance)
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + grep clean before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/__tests__/logging.test.ts` — covers INFRA-01 (no-op, injectable) and SEC-06 (redaction)
- [ ] No framework install needed — vitest already present

## Sources

### Primary (HIGH confidence)
- `pino.d.ts` (raw.githubusercontent.com/pinojs/pino/main/pino.d.ts) — `Logger` type, `level: 'silent'` documented as noop, `redact` option structure with `paths`, `censor`, `remove`
- pino npm registry (npmjs.com/package/pino) — version 10.3.1 latest, types bundled (no @types/pino needed)
- pinojs/pino GitHub releases — v10.3.1 released 09 Feb 2026, stable

### Secondary (MEDIUM confidence)
- betterstack.com pino guide — redact `censor`, `remove` options, child logger API (compatible with v9; confirmed against type definitions)
- signoz.io pino guide (2026) — child logger pattern, redact with `remove: true`

### Tertiary (LOW confidence)
- WebSearch for version 10.3.1 being latest — confirmed by multiple sources (signoz, socket.dev, search snippets)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — pino v10.3.1 confirmed from npm; types bundled confirmed from pino.d.ts
- Architecture: HIGH — injection pattern, `level: 'silent'` noop, child logger all verified from type definitions and docs
- Pitfalls: HIGH for sensitive field logging (verified by reading actual mpc.ts call sites); MEDIUM for ESM/tsup concern (plausible, not yet confirmed)
- Redaction: HIGH — pino.d.ts confirms `redact: { paths, censor, remove }` API

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (pino v10.x is stable; no expected breaking changes)
