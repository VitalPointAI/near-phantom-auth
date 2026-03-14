# Coding Conventions

**Analysis Date:** 2026-03-14

## Naming Patterns

**Files:**
- Use lowercase kebab-case or single-word names: `codename.ts`, `passkey.ts`, `router.ts`
- React hooks use camelCase with `use` prefix: `useAnonAuth.tsx`, `useOAuth.tsx`
- Index files for barrel exports: `index.ts` in each module directory
- TypeScript files use `.ts`; React components use `.tsx`

**Functions:**
- Use camelCase for all functions: `createAnonAuth`, `generateCodename`, `verifyWalletSignature`
- Factory functions use `create` prefix: `createPostgresAdapter`, `createSessionManager`, `createApiClient`, `createRouter`
- Boolean checks use `is` prefix: `isValidCodename`, `isWebAuthnSupported`, `isLikelyCloudSynced`, `isConfigured`
- Async verification functions use `verify` prefix: `verifyRegistration`, `verifyAuthentication`, `verifyWalletSignature`
- Generator functions use `generate` prefix: `generateCodename`, `generatePKCE`, `generateState`

**Variables:**
- Use camelCase: `sessionManager`, `passkeyManager`, `mpcContractId`
- Constants use UPPER_SNAKE_CASE: `SESSION_COOKIE_NAME`, `DEFAULT_SESSION_DURATION_MS`, `NATO_PHONETIC`, `MIN_PASSWORD_LENGTH`
- Private class fields use `private` keyword (no underscore prefix): `private networkId`, `private mpcContractId`

**Types/Interfaces:**
- Use PascalCase: `AnonAuthConfig`, `DatabaseAdapter`, `MPCAccount`
- Interface names describe the entity, no `I` prefix: `SessionManager`, `PasskeyManager`, `WalletRecoveryManager`
- Input types use `Input` suffix: `CreateUserInput`, `CreateSessionInput`, `CreatePasskeyInput`
- Response types use `Response` suffix: `RegistrationStartResponse`, `AuthenticationFinishResponse`
- Config types use `Config` suffix: `MPCConfig`, `PasskeyConfig`, `SessionConfig`

**Database Columns:**
- Use snake_case in SQL: `near_account_id`, `mpc_public_key`, `created_at`
- Map to camelCase in TypeScript: `nearAccountId`, `mpcPublicKey`, `createdAt`

## Code Style

**Formatting:**
- No dedicated formatter configuration file (no Prettier, no Biome)
- 2-space indentation throughout
- Single quotes for string literals
- Semicolons required at end of statements
- Trailing commas in multiline structures

**Linting:**
- ESLint configured via `npm run lint` (lints `src/`)
- No `.eslintrc` file found; likely using default or inline config
- TypeScript strict mode is OFF (`"strict": false` in `tsconfig.json`)
- `noImplicitAny: false`, `noUnusedLocals: false`, `noUnusedParameters: false`

**TypeScript Configuration:**
- Target: ES2022
- Module: ESNext with bundler resolution
- JSX: react-jsx
- Source maps and declaration maps enabled
- `isolatedModules: true` for compatibility with bundlers

## Import Organization

**Order:**
1. Node.js built-in modules: `import { randomUUID, createHmac } from 'crypto';`
2. Third-party packages: `import { generateRegistrationOptions } from '@simplewebauthn/server';`
3. Internal types (with `type` keyword): `import type { DatabaseAdapter, AnonUser } from '../types/index.js';`
4. Internal modules: `import { createSessionManager } from './session.js';`

**Key Conventions:**
- Always use `type` keyword for type-only imports: `import type { Request, Response } from 'express';`
- Always include `.js` extension in relative imports (ESM requirement): `'../types/index.js'`, `'./session.js'`
- Re-export types using `export type { ... }` syntax
- Combined type and value exports use separate statements

**Path Aliases:**
- None configured; all imports use relative paths

## Error Handling

**Server-Side Route Handlers:**
- Wrap entire handler body in try/catch
- Log errors with prefixed tag: `console.error('[AnonAuth] Registration start error:', error);`
- Return generic user-facing error message: `res.status(500).json({ error: 'Registration failed' });`
- Never expose internal error details to clients
- Pattern example from `src/server/router.ts`:

```typescript
router.post('/register/start', async (req: Request, res: Response) => {
  try {
    // ... business logic ...
    res.json({ success: true, /* data */ });
  } catch (error) {
    console.error('[AnonAuth] Registration start error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});
```

**Validation Errors:**
- Return 400 with specific message: `res.status(400).json({ error: 'Missing required fields' });`
- Check required fields explicitly at top of handler

**Authentication Errors:**
- Return 401: `res.status(401).json({ error: 'Authentication required' });`
- Return 404 for not found: `res.status(404).json({ error: 'User not found' });`

**Client-Side Error Handling:**
- Catch errors and store in state: `error instanceof Error ? error.message : 'Registration failed'`
- Provide `clearError()` action on context
- Swallow non-critical errors silently (e.g., OAuth provider fetch failure)

**Library/Manager Functions:**
- Throw errors for programming mistakes: `throw new Error('PostgreSQL requires connectionString');`
- Return result objects for expected failures: `return { verified: false };`
- Use `catch {}` (empty catch) for non-critical operations like feature detection

## Logging

**Framework:** `console` (console.log, console.error, console.warn)

**Patterns:**
- Use bracketed prefix tags: `[AnonAuth]`, `[MPC]`, `[Passkey]`, `[IPFS]`, `[OAuth]`, `[WalletRecovery]`
- Log key operations: `console.log('[MPC] Creating NEAR account:', { nearAccountId, derivationPath });`
- Log errors with full error object: `console.error('[AnonAuth] Registration start error:', error);`
- Use `console.warn` for non-fatal issues: `console.warn('[MPC] No treasury configured, account will be dormant until funded');`

## Comments

**When to Comment:**
- File-level JSDoc block on every file describing purpose: `/** * Session Management * ... */`
- JSDoc on exported interfaces with `/** field description */` for each property
- Section headers using `// ============================================` dividers
- Inline comments for non-obvious logic or workarounds
- Route handlers have JSDoc with HTTP method and path: `/** * POST /register/start * Start passkey registration */`

**JSDoc/TSDoc:**
- `@example` blocks in entry point files (`src/index.ts`, `src/server/index.ts`, `src/client/index.ts`)
- `@packageDocumentation` tag on main entry point
- Interface properties use `/** description */` format consistently

## Function Design

**Size:** Functions are generally 10-50 lines. Larger functions (like route handlers) contain sequential logic with clear section breaks.

**Parameters:**
- Use config/options objects for functions with >2 parameters: `createPasskeyManager(db, config)`
- Config interfaces defined adjacent to the function that uses them
- Optional properties use `?` suffix in interfaces

**Return Values:**
- Success/failure operations return `{ verified: boolean; ... }` or `{ success: boolean; ... }`
- Nullable lookups return `T | null` (never `undefined`)
- Async operations always return Promises

## Module Design

**Exports:**
- Each module has an `index.ts` barrel file
- Factory functions are the primary exports: `createAnonAuth`, `createPostgresAdapter`
- Types re-exported from barrel files using `export type { ... }`
- Implementation details (private helpers) are NOT exported

**Barrel Files:**
- `src/index.ts`: Re-exports types only (main entry point)
- `src/server/index.ts`: Re-exports factory, types, and standalone utilities
- `src/client/index.ts`: Re-exports hooks, API client, and passkey utilities
- `src/webauthn/index.ts`: Thin re-export of `src/server/webauthn.ts`

**Module Pattern:**
- Prefer factory functions returning interface objects over classes
- Only `MPCAccountManager` in `src/server/mpc.ts` uses a class (with companion `createMPCManager` factory)
- All other managers use closure-based factory pattern:

```typescript
export function createSessionManager(db: DatabaseAdapter, config: SessionConfig): SessionManager {
  // private state via closure
  const cookieName = config.cookieName || SESSION_COOKIE_NAME;

  return {
    async createSession(userId, res, options) { /* ... */ },
    async getSession(req) { /* ... */ },
  };
}
```

## API Response Conventions

**Success responses:**
- Include `success: true` for mutation operations
- Include relevant data inline (not nested under `data` key)

**Error responses:**
- Always include `error` string field: `{ error: 'Registration failed' }`
- Optional `details` array for validation: `{ error: 'Password too weak', details: [...] }`

**Session endpoint:**
- Returns `{ authenticated: boolean, ... }` pattern

---

*Convention analysis: 2026-03-14*
