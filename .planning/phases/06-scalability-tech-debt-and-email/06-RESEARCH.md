# Phase 6: Scalability, Tech Debt, and Email - Research

**Researched:** 2026-03-14
**Domain:** Node.js infrastructure, PostgreSQL, AWS SES, TypeScript type narrowing, concurrent async patterns
**Confidence:** HIGH

## Summary

Phase 6 completes ten discrete requirements across five distinct domains: OAuth state durability (INFRA-03), automatic record cleanup (INFRA-04), codename namespace expansion (DEBT-01), type system cleanup (DEBT-03, DEBT-04), query performance (PERF-01, PERF-02), AWS SES email delivery (EMAIL-01, EMAIL-02), and the OAuth recovery password flow that was deferred from Phase 5 (BUG-05).

The codebase is already well-structured. Every requirement has a clear, targeted change with minimal blast radius. The largest single effort is INFRA-03: moving OAuth state from an in-memory `Map` in `createOAuthManager()` to a dedicated `oauth_state` database table, which requires touching the `DatabaseAdapter` interface, the Postgres adapter, and the OAuth manager. All other items are single-file surgical changes.

**Primary recommendation:** Work in dependency order — INFRA-03 first (enables multi-instance correctness and unlocks INFRA-04 cleanup scope), then PERF-01 (rewrites the same Postgres adapter touched by INFRA-03), then the three debt items in any order, then PERF-02, then EMAIL-01/EMAIL-02/BUG-05 as a group.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-03 | OAuth state stored in database instead of in-memory Map | New `oauth_state` table + `DatabaseAdapter` methods + `createOAuthManager` rewrite |
| INFRA-04 | Automatic expired session and challenge cleanup mechanism | `setInterval` scheduler with existing `cleanExpiredSessions()` + new `cleanExpiredChallenges()` |
| DEBT-01 | Codename system uses compound codenames (ALPHA-BRAVO-42) for larger namespace | `generateNatoCodename()` already produces single-word; needs compound variant + `isValidCodename` regex update |
| DEBT-03 | SQLite removed from DatabaseConfig union type | `src/types/index.ts` line 123: change `'postgres' \| 'sqlite' \| 'custom'` to `'postgres' \| 'custom'` |
| DEBT-04 | Dead testnet helper API code removed or cleaned up | `createTestnetAccount()` function in `mpc.ts` lines 96-119 — confirm dead, remove |
| PERF-01 | OAuth user lookups use JOIN queries instead of N+1 sequential queries | `getOAuthUserById`, `getOAuthUserByEmail`, `getOAuthUserByProvider` all do sequential queries |
| PERF-02 | IPFS gateway fallback uses `Promise.any()` for concurrent requests | `fetchFromIPFS()` in `ipfs.ts` uses sequential `for...of` loop |
| EMAIL-01 | AWS SES integration for email delivery | `@aws-sdk/client-ses` v3; externalized peer dep |
| EMAIL-02 | OAuth recovery password delivered to user via email after SES integration | Uses email from `profile.email` captured in OAuth callback handler |
| BUG-05 | OAuth recovery password either delivered to user via email or auto-recovery skipped until email works | Currently has a `// TODO: Send recovery info to user's email` comment in `oauth/router.ts` line 319 |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-ses` | v3 (^3.x) | AWS SES email via SendEmail API | AWS v3 SDK is modular; only pulls in SES client, not the full SDK |
| `pg` (existing) | peer dep | PostgreSQL for oauth_state table | Already the DB adapter; no new dependency |
| Node.js `setInterval` | built-in | Periodic cleanup scheduler | No dependency; correct for library-embedded scheduler |
| `Promise.any()` | ES2021 built-in (Node 18+) | IPFS concurrent gateway fetch | Engine requirement is Node 18+; Promise.any is available |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@aws-sdk/credential-providers` | v3 | IAM/env credential loading | Only needed if not using simple key/secret config |
| Node.js `AggregateError` | built-in | `Promise.any()` rejection unwrapping | Available in Node 18+; thrown when all IPFS gateways fail |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@aws-sdk/client-ses` v3 | `nodemailer` + SES transport | Project decision locked AWS SES; nodemailer adds a layer |
| `setInterval` | `node-cron` or `bull` | No cron scheduling needed; simple interval is sufficient for cleanup |
| `Promise.any()` | Manual race with AbortController | `Promise.any()` is standard and cleaner; no timeout needed for gateway fallback |

**Installation (new dependency only):**
```bash
npm install @aws-sdk/client-ses
```
Add `@aws-sdk/client-ses` to `tsup.config.ts` `external` array (consumers provide their own AWS credentials; should not be bundled).

## Architecture Patterns

### Recommended Project Structure

No new directories needed. Changes are surgical within:
```
src/
├── types/index.ts              # DEBT-03: remove 'sqlite' from union
├── server/
│   ├── codename.ts             # DEBT-01: compound codename function
│   ├── mpc.ts                  # DEBT-04: remove createTestnetAccount()
│   ├── oauth/
│   │   ├── index.ts            # INFRA-03: replace Map with DB calls
│   │   └── router.ts           # BUG-05/EMAIL-02: call email service after backup
│   ├── recovery/
│   │   └── ipfs.ts             # PERF-02: Promise.any() in fetchFromIPFS
│   ├── email.ts                # EMAIL-01: new file, SES client factory
│   ├── cleanup.ts              # INFRA-04: new file, scheduler factory
│   └── db/
│       └── adapters/
│           └── postgres.ts     # INFRA-03: oauth_state table + 3 methods
│                               # PERF-01: JOIN queries for OAuth lookups
```

### Pattern 1: OAuth State in Database (INFRA-03)

**What:** Replace `stateStore = new Map<string, OAuthState>()` with three `DatabaseAdapter` methods backed by a new `oauth_state` table.

**New `DatabaseAdapter` methods (optional with `?` — backward compat pattern established in Phase 5):**
```typescript
// In DatabaseAdapter interface (types/index.ts)
storeOAuthState?(state: OAuthState): Promise<void>;
getOAuthState?(stateKey: string): Promise<OAuthState | null>;
deleteOAuthState?(stateKey: string): Promise<void>;
```

**New schema (appended to `POSTGRES_SCHEMA` in postgres.ts):**
```sql
CREATE TABLE IF NOT EXISTS oauth_state (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code_verifier TEXT,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_state_expires ON oauth_state(expires_at);
```

**`createOAuthManager` fallback:** If `db.storeOAuthState` is not implemented (custom adapters), fall back to in-memory Map. This maintains backward compatibility without breaking existing custom adapters.

**Validated in**: `getAuthUrl()` calls `storeOAuthState`, `validateState()` calls `getOAuthState` then `deleteOAuthState` (atomic consume pattern — delete on read to prevent replay).

### Pattern 2: Cleanup Scheduler (INFRA-04)

**What:** A factory function that wraps periodic cleanup in `setInterval`, cleans expired sessions and challenges, and returns a `stop()` handle.

```typescript
// src/server/cleanup.ts
export interface CleanupScheduler {
  stop(): void;
}

export function createCleanupScheduler(
  db: DatabaseAdapter,
  log: Logger,
  intervalMs = 5 * 60 * 1000  // 5 minutes default
): CleanupScheduler {
  const handle = setInterval(async () => {
    try {
      const sessions = await db.cleanExpiredSessions();
      const challenges = await db.cleanExpiredChallenges?.() ?? 0;
      const oauthStates = await db.cleanExpiredOAuthStates?.() ?? 0;
      log.info({ sessions, challenges, oauthStates }, 'Cleanup complete');
    } catch (err) {
      log.error({ err }, 'Cleanup failed');
    }
  }, intervalMs);
  handle.unref(); // Do not prevent process exit
  return { stop: () => clearInterval(handle) };
}
```

**Critical:** Call `handle.unref()` so the interval timer does not prevent the process from exiting normally in tests or graceful shutdown scenarios.

**New optional `DatabaseAdapter` methods:**
```typescript
cleanExpiredChallenges?(): Promise<number>;
cleanExpiredOAuthStates?(): Promise<number>;
```

Postgres implementation:
```sql
-- cleanExpiredChallenges
DELETE FROM anon_challenges WHERE expires_at < NOW()

-- cleanExpiredOAuthStates
DELETE FROM oauth_state WHERE expires_at < NOW()
```

### Pattern 3: JOIN Queries for OAuth Lookups (PERF-01)

**What:** All three `getOAuthUser*` methods currently execute two sequential round-trips. Replace with a single JOIN.

**Current pattern (N+1):** `getOAuthUserByProvider` does `SELECT user_id FROM oauth_providers WHERE ...` then calls `this.getOAuthUserById(userId)` which does two more queries (user + providers). Three sequential queries total.

**Replacement pattern (one JOIN):**
```sql
-- getOAuthUserByProvider
SELECT u.*, p.provider, p.provider_id, p.email AS p_email,
       p.name AS p_name, p.avatar_url AS p_avatar_url, p.connected_at
FROM oauth_users u
JOIN oauth_providers p ON p.user_id = u.id
WHERE p.provider = $1 AND p.provider_id = $2

-- getOAuthUserByEmail / getOAuthUserById: similar pattern
SELECT u.*, p.provider, p.provider_id, p.email AS p_email,
       p.name AS p_name, p.avatar_url AS p_avatar_url, p.connected_at
FROM oauth_users u
LEFT JOIN oauth_providers p ON p.user_id = u.id
WHERE u.email = $1
```

**Row aggregation:** A user with multiple providers returns multiple rows — aggregate `providers[]` array in JavaScript after the query (GROUP BY equivalent in application code). This is correct and efficient.

**Note on `getOAuthUserByProvider`:** Use `INNER JOIN` (not `LEFT JOIN`) because the provider row must exist for this lookup. `getOAuthUserById` and `getOAuthUserByEmail` use `LEFT JOIN` to handle users with zero linked providers.

### Pattern 4: Concurrent IPFS Gateway Fetch (PERF-02)

**What:** Replace sequential `for...of` gateway loop in `fetchFromIPFS()` with `Promise.any()`.

```typescript
// Source: MDN Web Docs, Promise.any() - Node 18+ built-in
async function fetchFromIPFS(cid: string): Promise<Uint8Array> {
  const gateways = [
    `https://gateway.pinata.cloud/ipfs/${cid}`,
    `https://w3s.link/ipfs/${cid}`,
    `https://ipfs.infura.io/ipfs/${cid}`,
    `https://ipfs.io/ipfs/${cid}`,
    `https://cloudflare-ipfs.com/ipfs/${cid}`,
    `https://dweb.link/ipfs/${cid}`,
  ];

  const fetchGateway = async (url: string): Promise<Uint8Array> => {
    const response = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
    if (!response.ok) throw new Error(`Gateway ${url} returned ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };

  try {
    return await Promise.any(gateways.map(fetchGateway));
  } catch (err) {
    // AggregateError: all gateways failed
    throw new Error('Failed to fetch from IPFS - tried all gateways');
  }
}
```

**Caveat:** `Promise.any()` fires all requests simultaneously. This is intentional — it's a race, not a queue. The first successful response wins; all others are discarded. This is the specified behavior (PERF-02 success criterion).

### Pattern 5: AWS SES Email Service (EMAIL-01)

**What:** A thin factory that wraps `@aws-sdk/client-ses` `SendEmailCommand` for transactional emails.

```typescript
// src/server/email.ts
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { Logger } from 'pino';

export interface EmailConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  fromAddress: string;
}

export interface EmailService {
  sendRecoveryPassword(toEmail: string, recoveryPassword: string): Promise<void>;
}

export function createEmailService(config: EmailConfig, log: Logger): EmailService {
  const client = new SESClient({
    region: config.region,
    ...(config.accessKeyId && {
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey!,
      },
    }),
  });

  return {
    async sendRecoveryPassword(toEmail, recoveryPassword) {
      const command = new SendEmailCommand({
        Source: config.fromAddress,
        Destination: { ToAddresses: [toEmail] },
        Message: {
          Subject: { Data: 'Your NEAR Account Recovery Password' },
          Body: {
            Text: {
              Data: `Your recovery password is: ${recoveryPassword}\n\nStore this securely. You will need it to recover your account if you lose your device.`,
            },
          },
        },
      });
      await client.send(command);
      log.info({ to: toEmail }, 'Recovery password email sent');
    },
  };
}
```

**Externalizing:** Add `@aws-sdk/client-ses` to the `external` array in `tsup.config.ts`. Consumers who do not use SES never pay the import cost.

**Optional wiring:** The `EmailService` is optional in `OAuthRouterConfig`. If not provided, the backup CID is created but the email step is skipped (graceful degradation satisfies BUG-05: skip auto-recovery until email works).

### Pattern 6: Compound Codenames (DEBT-01)

**What:** `generateNatoCodename()` currently produces `ALPHA-7` (single word, suffix 1-99). Maximum namespace: 26 words × 99 = 2,574 unique codenames before collision becomes likely with birthday attack. Compound codenames (`ALPHA-BRAVO-42`) expand namespace to 26 × 26 × 99 = 66,924.

The ADJECTIVE-ANIMAL style (`generateAnimalCodename()`) already produces compound codenames. The gap is in `generateNatoCodename()`.

**Decision from STATE.md:** `ALPHA-BRAVO-42` style — two NATO words + numeric suffix.

```typescript
export function generateNatoCodename(): string {
  const word1 = randomPick(NATO_PHONETIC);
  const word2 = randomPick(NATO_PHONETIC);
  const num = randomSuffix();
  return `${word1}-${word2}-${num}`;
}
```

**`isValidCodename()` regex update:** The current NATO pattern `/^[A-Z]+-\d{1,2}$/` matches old single-word format. Update to accept compound:
```typescript
const natoPattern = /^[A-Z]+-[A-Z]+-\d{1,2}$/;
```

**Migration concern:** Existing users in the database have old-format codenames (`ALPHA-7`). The validation function is used for input validation (e.g., lookup by codename), not user creation. Old codenames will fail `isValidCodename()` after the change. The planner must decide: keep both patterns valid in the regex, or migrate existing records. Research recommendation: keep both valid by accepting either format (the `||` already exists in `isValidCodename`). Update NATO pattern to accept both old and new format.

```typescript
// Accepts both ALPHA-7 (legacy) and ALPHA-BRAVO-42 (new)
const natoPattern = /^[A-Z]+(?:-[A-Z]+)?-\d{1,2}$/;
```

### Pattern 7: Remove SQLite from Type Union (DEBT-03)

**What:** Single-line change in `src/types/index.ts` line 123.

```typescript
// Before
type: 'postgres' | 'sqlite' | 'custom';

// After
type: 'postgres' | 'custom';
```

**TypeScript compile-time enforcement:** After this change, `tsc --noEmit` will produce an error if any code passes `type: 'sqlite'`. No runtime behavior changes; `DatabaseConfig.type` is not used for branching in the library (the `adapter` field drives behavior).

**Verification:** Run `npx tsc --noEmit` in the project. Zero errors expected (the 'sqlite' literal is only in the type definition, not in any consuming switch statement).

### Pattern 8: Remove Dead Testnet Helper Code (DEBT-04)

**What:** `createTestnetAccount()` in `mpc.ts` lines 96-119 calls the NEAR testnet helper API (`https://helper.testnet.near.org/account`). This function is no longer called in the codebase (the `MPCAccountManager.createAccount()` method uses implicit accounts funded by treasury, not the helper API).

**Verification before removal:** Grep for `createTestnetAccount` call sites. Confirmed: zero call sites in the codebase. Safe to delete.

**What to delete:** The entire `createTestnetAccount()` function (lines 96-119). The surrounding `accountExists()` and `fundAccountFromTreasury()` functions are still used by `createAccount()` — do not delete them.

### Anti-Patterns to Avoid

- **Blocking process exit with interval:** Always call `handle.unref()` on the `setInterval` handle in the cleanup scheduler. Without it, integration tests hang waiting for the timer to fire.
- **Eager SES client instantiation:** Construct `SESClient` inside `createEmailService()` factory, not at module load time. This allows consumers to conditionally wire email without a cold import cost.
- **Breaking `DatabaseAdapter` interface:** All new methods (`storeOAuthState`, `getOAuthState`, `deleteOAuthState`, `cleanExpiredChallenges`, `cleanExpiredOAuthStates`) MUST be optional (`?`) — established pattern from Phase 5.
- **`Promise.any()` without catch:** The rejection case of `Promise.any()` is `AggregateError`. Always wrap in `try/catch` and rethrow a user-friendly error.
- **Regex breadth on codename validation:** Do not remove the old `ALPHA-7` pattern from validation — existing users have old-format codenames in the database.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email delivery | Custom SMTP client or raw SES HTTP | `@aws-sdk/client-ses` | Handles SigV4 signing, retry, regional endpoints |
| Concurrent fetch race | Manual `Promise` with resolve/reject wiring | `Promise.any()` | Built-in, handles AggregateError, no edge cases |
| Credential management | Reading env vars manually in email module | SES client `credentials` option + env var fallback | SDK auto-discovers credentials from env, IAM role, config file |

**Key insight:** AWS SDK v3 is modular. `@aws-sdk/client-ses` is a single-purpose 50KB package. Do not install `aws-sdk` v2 (600KB+ monolithic package).

## Common Pitfalls

### Pitfall 1: `handle.unref()` omitted in cleanup scheduler
**What goes wrong:** Vitest (and other test runners) hang after tests complete because `setInterval` keeps the event loop alive.
**Why it happens:** Node.js keeps the process alive as long as there are active timer references.
**How to avoid:** Call `handle.unref()` immediately after `setInterval()`. This makes the timer "non-blocking" — it fires if the event loop is otherwise idle, but does not prevent exit.
**Warning signs:** Test suite pauses after all tests pass, exits only after `--forceExit` or timeout.

### Pitfall 2: `Promise.any()` fires all requests simultaneously
**What goes wrong:** If IPFS gateways enforce rate limits by IP, all 6 simultaneous requests may be rejected.
**Why it happens:** This is the correct behavior — it's a race, and this is an inherent tradeoff documented in the spec (PERF-02 explicitly requires concurrent requests).
**How to avoid:** Accept this tradeoff. Consumers who hit rate limits can supply `config.customFetch`.

### Pitfall 3: JOIN returns multiple rows per user (multiple providers)
**What goes wrong:** `getOAuthUserByEmail` returns 3 rows for a user with 3 linked providers; only the first row is used, silently dropping providers.
**Why it happens:** SQL JOIN multiplies rows by provider count.
**How to avoid:** After JOIN, group rows by `u.id` in JavaScript and build the `providers[]` array from all matching rows before returning the `OAuthUser` object.

### Pitfall 4: OAuth state cookie vs. DB race condition
**What goes wrong:** The OAuth state is stored in DB on `getAuthUrl()`, but the cookie (`oauth_state`) is still used to compare against the `state` query param in the callback. The DB lookup is redundant until the cookie comparison is also migrated.
**Why it happens:** INFRA-03 description says "stored in database instead of in-memory Map" — the requirement is to replace the Map, not to replace the cookie. The cookie-based state validation remains as an additional layer.
**How to avoid:** Preserve the cookie comparison in `router.ts` but have `validateState()` (in `oauth/index.ts`) query the database instead of the Map. The DB acts as a cross-instance truth source; the cookie is an additional CSRF defense layer that remains.

### Pitfall 5: SES `SendEmailCommand` requires verified sender
**What goes wrong:** Sending from an unverified `From` address causes SES to return `MessageRejected`.
**Why it happens:** AWS SES requires sender email addresses or domains to be verified before use, especially in sandbox mode.
**How to avoid:** Document in `EmailConfig` that `fromAddress` must be verified in SES. The email service itself cannot verify this programmatically; it's an AWS console configuration step. Log a clear error message when `MessageRejected` is received.

### Pitfall 6: SQLite removal breaks consumers using `type: 'sqlite'`
**What goes wrong:** A consumer who set `database: { type: 'sqlite', adapter: myAdapter }` now gets a TypeScript compile error.
**Why it happens:** This is intentional (DEBT-03 goal), but it is a breaking change.
**How to avoid:** The planner should flag this as a breaking change in documentation. Consumers using `'sqlite'` should migrate to `'custom'` (which is semantically identical — both use the `adapter` field).

## Code Examples

Verified patterns from official sources:

### AWS SES SendEmailCommand
```typescript
// Source: AWS SDK v3 docs - https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ses/command/SendEmailCommand/
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const client = new SESClient({ region: 'us-east-1' });
const command = new SendEmailCommand({
  Source: 'noreply@example.com',
  Destination: { ToAddresses: ['user@example.com'] },
  Message: {
    Subject: { Data: 'Subject line' },
    Body: { Text: { Data: 'Email body' } },
  },
});
await client.send(command);
```

### Promise.any() with AggregateError handling
```typescript
// Source: MDN Promise.any() - built into Node.js 18+
try {
  const result = await Promise.any(promises);
} catch (err) {
  // err is AggregateError when all promises rejected
  if (err instanceof AggregateError) {
    console.error(err.errors); // Array of individual errors
  }
  throw new Error('All attempts failed');
}
```

### JOIN query with multiple rows aggregation (Node pg)
```typescript
// Standard pattern for one-to-many JOIN in pg (no ORM)
const rows = await pool.query(
  `SELECT u.*, p.provider, p.provider_id, p.email AS p_email, p.connected_at
   FROM oauth_users u
   LEFT JOIN oauth_providers p ON p.user_id = u.id
   WHERE u.id = $1`,
  [userId]
);
if (rows.rows.length === 0) return null;
const user = rows.rows[0]; // base fields from first row
const providers = rows.rows
  .filter(r => r.provider !== null)
  .map(r => ({
    provider: r.provider,
    providerId: r.provider_id,
    email: r.p_email,
    connectedAt: r.connected_at,
  }));
return { ...mapUserRow(user), providers };
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| AWS SDK v2 monolith (`aws-sdk`) | AWS SDK v3 modular (`@aws-sdk/client-ses`) | 2020 | Only import what you need; tree-shakeable |
| Sequential IPFS gateway retry | `Promise.any()` concurrent race | ES2021 / Node 15+ | First gateway to respond wins; no sequential wait |
| `Map`-based OAuth state (process-local) | DB-backed OAuth state | Pattern established by this phase | Survives restarts, works across instances |

**Deprecated/outdated:**
- `https://helper.testnet.near.org/account`: The NEAR testnet faucet helper API is deprecated and unreliable. The library already migrated to treasury-funded implicit accounts. `createTestnetAccount()` is dead code.

## Open Questions

1. **Codename backward compatibility for existing users**
   - What we know: `isValidCodename()` is called in router.ts for codename lookup validation
   - What's unclear: Are there consumers who validate stored codenames against this function (e.g., in login flows)?
   - Recommendation: Accept both `WORD-NN` and `WORD-WORD-NN` in `isValidCodename()` using `(?:-[A-Z]+)?` optional segment. Generation switches to compound; validation accepts both.

2. **Cleanup scheduler wiring point**
   - What we know: The scheduler factory should be created by the consumer, not auto-started inside the library
   - What's unclear: Should `createAnonAuth()` (the main entry point in `src/server/index.ts`) return the scheduler as part of its return value?
   - Recommendation: Export `createCleanupScheduler` as a standalone function. The consumer calls it after initializing the library. This follows the library's existing pattern of returning composable pieces rather than a single opinionated object.

3. **SES sandbox vs. production mode**
   - What we know: SES sandbox only allows sending to verified email addresses
   - What's unclear: How should the library behave when SES is not configured?
   - Recommendation: `EmailService` is optional in `OAuthRouterConfig`. Absence means skip email silently (log a warning that recovery password was not emailed). This satisfies BUG-05: "skip auto-recovery until email works."

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-03 | OAuth state stored/retrieved/deleted from DB | unit | `npx vitest run src/__tests__/oauth-state.test.ts` | ❌ Wave 0 |
| INFRA-04 | Scheduler calls cleanExpiredSessions and cleanExpiredChallenges on interval | unit | `npx vitest run src/__tests__/cleanup.test.ts` | ❌ Wave 0 |
| DEBT-01 | `generateNatoCodename()` returns compound `WORD-WORD-NN` format | unit | `npx vitest run src/__tests__/codename.test.ts` | ❌ Wave 0 |
| DEBT-01 | `isValidCodename()` accepts both old and new formats | unit | `npx vitest run src/__tests__/codename.test.ts` | ❌ Wave 0 |
| DEBT-03 | TypeScript rejects `type: 'sqlite'` at compile time | type check | `npx tsc --noEmit` | ✅ existing |
| DEBT-04 | `createTestnetAccount` function is absent from mpc.ts | manual/grep | `grep -n createTestnetAccount src/server/mpc.ts` | ✅ existing |
| PERF-01 | `getOAuthUserByProvider` executes single query (JOIN) | unit | `npx vitest run src/__tests__/db-integrity.test.ts` | ✅ existing (extend) |
| PERF-02 | `fetchFromIPFS` calls all gateways concurrently | unit | `npx vitest run src/__tests__/ipfs.test.ts` | ❌ Wave 0 |
| EMAIL-01 | `createEmailService` sends SES `SendEmailCommand` | unit | `npx vitest run src/__tests__/email.test.ts` | ❌ Wave 0 |
| EMAIL-02 | OAuth callback sends email after creating recovery backup | unit | `npx vitest run src/__tests__/oauth-email.test.ts` | ❌ Wave 0 |
| BUG-05 | OAuth callback skips email gracefully when no email service configured | unit | `npx vitest run src/__tests__/oauth-email.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + `npx tsc --noEmit` before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/oauth-state.test.ts` — covers INFRA-03
- [ ] `src/__tests__/cleanup.test.ts` — covers INFRA-04
- [ ] `src/__tests__/codename.test.ts` — covers DEBT-01
- [ ] `src/__tests__/ipfs.test.ts` — covers PERF-02
- [ ] `src/__tests__/email.test.ts` — covers EMAIL-01
- [ ] `src/__tests__/oauth-email.test.ts` — covers EMAIL-02 + BUG-05

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `src/server/oauth/index.ts` — confirmed `Map`-based state store, lines 96, 169, 363-370
- Direct code inspection: `src/server/db/adapters/postgres.ts` — confirmed N+1 query pattern in `getOAuthUserByProvider` (lines 540-551), `getOAuthUserById` (lines 458-496), `getOAuthUserByEmail` (lines 499-537)
- Direct code inspection: `src/server/recovery/ipfs.ts` — confirmed sequential `for...of` loop in `fetchFromIPFS()` (lines 221-248)
- Direct code inspection: `src/server/mpc.ts` lines 96-119 — confirmed `createTestnetAccount()` is never called
- Direct code inspection: `src/types/index.ts` line 123 — confirmed `'sqlite'` in union type
- Direct code inspection: `src/server/codename.ts` — confirmed `generateNatoCodename()` generates single-word format
- Direct code inspection: `src/server/oauth/router.ts` lines 298-319 — confirmed `// TODO: Send recovery info to user's email` placeholder
- AWS SDK v3 SES documentation: `@aws-sdk/client-ses` is the current standard for SES integration
- Node.js 18 release notes: `Promise.any()` available since Node 15, standard in Node 18+ (engine requirement of this package)

### Secondary (MEDIUM confidence)
- `handle.unref()` pattern: documented in Node.js Timer documentation for non-blocking intervals
- JOIN aggregation pattern: standard PostgreSQL + `pg` adapter pattern, verified against postgres.ts existing query structure

### Tertiary (LOW confidence)
- NEAR testnet helper deprecation: observed from code comment history and common knowledge that `helper.testnet.near.org` is no longer the recommended account creation path

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — AWS SDK v3 is the only viable path; all other tools are Node.js built-ins
- Architecture: HIGH — code inspection confirmed exact lines to change for each requirement
- Pitfalls: HIGH — JOIN aggregation and `handle.unref()` are well-known Node.js patterns verified by code structure

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (AWS SDK v3 API is stable; PostgreSQL JOIN semantics do not change)
