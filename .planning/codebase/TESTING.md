# Testing Patterns

**Analysis Date:** 2026-03-14

## Test Framework

**Runner:**
- Vitest ^4.0.18 (listed in devDependencies)
- Config: No dedicated `vitest.config.ts` found; uses defaults or inline config in `package.json`

**Assertion Library:**
- Vitest built-in (expect, describe, it)

**Run Commands:**
```bash
npm test                 # Run all tests (vitest)
npx vitest --watch       # Watch mode
npx vitest --coverage    # Coverage (if configured)
```

## Test File Organization

**Location:**
- No test files exist in the codebase. Zero `.test.ts`, `.spec.ts`, `.test.tsx`, or `.spec.tsx` files.

**Expected Naming (based on vitest defaults):**
- `*.test.ts` or `*.spec.ts` for TypeScript tests
- `*.test.tsx` or `*.spec.tsx` for React component tests

**Recommended Structure (co-located):**
```
src/
├── server/
│   ├── session.ts
│   ├── session.test.ts          # Co-locate with source
│   ├── codename.ts
│   ├── codename.test.ts
│   ├── passkey.ts
│   ├── passkey.test.ts
│   ├── mpc.ts
│   ├── mpc.test.ts
│   ├── db/
│   │   └── adapters/
│   │       ├── postgres.ts
│   │       └── postgres.test.ts
│   └── recovery/
│       ├── ipfs.ts
│       ├── ipfs.test.ts
│       ├── wallet.ts
│       └── wallet.test.ts
├── client/
│   ├── passkey.test.ts
│   ├── api.test.ts
│   └── hooks/
│       ├── useAnonAuth.test.tsx
│       └── useOAuth.test.tsx
└── types/
    └── index.test.ts            # Type-level tests if needed
```

## Test Structure

**Recommended Suite Organization (vitest):**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateCodename, isValidCodename } from './codename.js';

describe('generateCodename', () => {
  it('generates NATO phonetic codename by default', () => {
    const codename = generateCodename();
    expect(codename).toMatch(/^[A-Z]+-\d{1,2}$/);
  });

  it('generates animal codename when style is animals', () => {
    const codename = generateCodename('animals');
    expect(codename).toMatch(/^[A-Z]+-[A-Z]+-\d{1,2}$/);
  });
});

describe('isValidCodename', () => {
  it('validates NATO format', () => {
    expect(isValidCodename('ALPHA-7')).toBe(true);
    expect(isValidCodename('invalid')).toBe(false);
  });
});
```

## Mocking

**Framework:** Vitest built-in (`vi.fn()`, `vi.mock()`, `vi.spyOn()`)

**Recommended Patterns:**

**Mocking the DatabaseAdapter interface:**
```typescript
import { vi } from 'vitest';
import type { DatabaseAdapter } from '../types/index.js';

function createMockDb(): DatabaseAdapter {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    createUser: vi.fn().mockResolvedValue({
      id: 'test-uuid',
      type: 'anonymous',
      codename: 'ALPHA-7',
      nearAccountId: 'test.testnet',
      mpcPublicKey: 'ed25519:test',
      derivationPath: 'near-anon-auth,test',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    }),
    getUserById: vi.fn().mockResolvedValue(null),
    getUserByCodename: vi.fn().mockResolvedValue(null),
    getUserByNearAccount: vi.fn().mockResolvedValue(null),
    createOAuthUser: vi.fn().mockResolvedValue(null),
    getOAuthUserById: vi.fn().mockResolvedValue(null),
    getOAuthUserByEmail: vi.fn().mockResolvedValue(null),
    getOAuthUserByProvider: vi.fn().mockResolvedValue(null),
    linkOAuthProvider: vi.fn().mockResolvedValue(undefined),
    createPasskey: vi.fn(),
    getPasskeyById: vi.fn().mockResolvedValue(null),
    getPasskeysByUserId: vi.fn().mockResolvedValue([]),
    updatePasskeyCounter: vi.fn().mockResolvedValue(undefined),
    deletePasskey: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    deleteUserSessions: vi.fn().mockResolvedValue(undefined),
    cleanExpiredSessions: vi.fn().mockResolvedValue(0),
    storeChallenge: vi.fn().mockResolvedValue(undefined),
    getChallenge: vi.fn().mockResolvedValue(null),
    deleteChallenge: vi.fn().mockResolvedValue(undefined),
    storeRecoveryData: vi.fn().mockResolvedValue(undefined),
    getRecoveryData: vi.fn().mockResolvedValue(null),
  };
}
```

**Mocking Express req/res:**
```typescript
function createMockReq(overrides = {}) {
  return {
    body: {},
    headers: {},
    ip: '127.0.0.1',
    params: {},
    cookies: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes() {
  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}
```

**Mocking fetch (for NEAR RPC, OAuth, IPFS calls):**
```typescript
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ result: { /* mock data */ } }),
}));
```

**What to Mock:**
- `DatabaseAdapter` - all database operations
- `fetch` - all external HTTP calls (NEAR RPC, OAuth providers, IPFS gateways)
- `crypto.randomUUID` / `crypto.randomBytes` - for deterministic tests
- `navigator.credentials` - WebAuthn browser APIs (client tests)
- `window.location` - OAuth redirect tests

**What NOT to Mock:**
- Pure functions: `generateCodename`, `isValidCodename`, `base64urlToUint8Array`
- Encryption utilities: `encryptRecoveryData`, `decryptRecoveryData` (test with real crypto)
- Borsh serialization helpers in `src/server/mpc.ts`
- Type validation logic

## Fixtures and Factories

**Test Data:**
```typescript
const TEST_USER = {
  id: 'test-user-id',
  type: 'anonymous' as const,
  codename: 'ALPHA-7',
  nearAccountId: 'anon-abc123def456.testnet',
  mpcPublicKey: 'ed25519:testpublickey',
  derivationPath: 'near-anon-auth,test-user-id',
  createdAt: new Date('2026-01-01'),
  lastActiveAt: new Date('2026-01-01'),
};

const TEST_SESSION = {
  id: 'test-session-id',
  userId: 'test-user-id',
  createdAt: new Date('2026-01-01'),
  expiresAt: new Date('2026-01-08'),
  lastActivityAt: new Date('2026-01-01'),
};

const TEST_PASSKEY = {
  credentialId: 'test-credential-id',
  userId: 'test-user-id',
  publicKey: new Uint8Array(32),
  counter: 0,
  deviceType: 'multiDevice' as const,
  backedUp: true,
  createdAt: new Date('2026-01-01'),
};
```

**Location:**
- No fixtures directory exists. Create test data inline or in a shared `src/__tests__/fixtures.ts` file.

## Coverage

**Requirements:** None enforced. No coverage thresholds configured.

**View Coverage:**
```bash
npx vitest --coverage
```

## Test Types

**Unit Tests:**
- High priority targets (pure logic, no external deps):
  - `src/server/codename.ts` - codename generation and validation
  - `src/server/session.ts` - session signing/verification logic
  - `src/server/recovery/ipfs.ts` - encryption/decryption, password validation
  - `src/server/recovery/wallet.ts` - signature verification
  - `src/server/webauthn.ts` - standalone WebAuthn utilities
  - `src/client/passkey.ts` - base64url conversion, feature detection
  - `src/server/mpc.ts` - borsh serialization helpers, account name generation

**Integration Tests:**
- `src/server/router.ts` - full request/response cycle with mocked DB
- `src/server/oauth/router.ts` - OAuth flow with mocked providers
- `src/server/db/adapters/postgres.ts` - requires test database or pg-mem
- `src/server/index.ts` (`createAnonAuth`) - factory wiring

**E2E Tests:**
- Not used. No Playwright, Cypress, or similar configured.

## Common Patterns

**Async Testing:**
```typescript
it('creates a session', async () => {
  const db = createMockDb();
  const sessionManager = createSessionManager(db, { secret: 'test-secret' });

  const session = await sessionManager.createSession('user-id', mockRes);

  expect(db.createSession).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'user-id' })
  );
});
```

**Error Testing:**
```typescript
it('throws when connection string missing', () => {
  expect(() => createAnonAuth({
    nearNetwork: 'testnet',
    sessionSecret: 'secret',
    database: { type: 'postgres' },
  })).toThrow('PostgreSQL requires connectionString');
});

it('returns verified false on bad passkey', async () => {
  const result = await passkeyManager.finishAuthentication('bad-id', mockResponse);
  expect(result.verified).toBe(false);
});
```

**Testing Encryption Round-trip:**
```typescript
it('encrypts and decrypts recovery data', async () => {
  const payload = { userId: 'test', nearAccountId: 'test.testnet', derivationPath: 'path', createdAt: Date.now() };
  const encrypted = await encryptRecoveryData(payload, 'StrongPassword123!');
  const decrypted = await decryptRecoveryData(encrypted, 'StrongPassword123!');
  expect(decrypted).toEqual(payload);
});
```

## Critical Testing Gaps

The codebase has **zero tests**. Priority areas to test first:

1. **`src/server/codename.ts`** - Pure functions, easiest to test, validates security-relevant codename format
2. **`src/server/session.ts`** - HMAC signing/verification is security-critical
3. **`src/server/recovery/ipfs.ts`** - Encryption/decryption correctness is essential for recovery
4. **`src/server/mpc.ts`** - Borsh serialization must be exact for on-chain transactions
5. **`src/server/router.ts`** - Core authentication flow with validation edge cases

---

*Testing analysis: 2026-03-14*
