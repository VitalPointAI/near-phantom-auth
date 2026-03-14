# Phase 7: Test Coverage - Research

**Researched:** 2026-03-14
**Domain:** Vitest unit + integration testing for a TypeScript/Express/WebAuthn/NEAR library
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-01 | Unit tests for session signing/verification (`src/server/session.ts`) | session.test.ts already has substantial coverage; gaps are adversarial cases per success criteria |
| TEST-02 | Unit tests for WebAuthn passkey flow (`src/server/passkey.ts`) | No test file exists; `createPasskeyManager` uses `@simplewebauthn/server` — must mock those functions |
| TEST-03 | Unit tests for MPC/borsh serialization and account creation (`src/server/mpc.ts`) | mpc.test.ts has borsh + derivation tests; gaps are `addRecoveryWallet` txHash assertion (no pending- prefix) |
| TEST-04 | Unit tests for IPFS encryption/decryption roundtrip (`src/server/recovery/ipfs.ts`) | No test file; pure crypto functions — `encryptRecoveryData`/`decryptRecoveryData` testable without network |
| TEST-05 | Unit tests for wallet recovery signature verification (`src/server/recovery/wallet.ts`) | No test file; `verifyWalletSignature` and `checkWalletAccess` need `vi.stubGlobal('fetch')` for RPC mocking |
| TEST-06 | Unit tests for codename generation/validation (`src/server/codename.ts`) | No test file; pure functions — no mocking needed |
| TEST-07 | Integration tests for registration and authentication flows | No test file; use `supertest` against real `createRouter`; mock db/passkey/mpc managers |
| TEST-08 | Integration tests for recovery flows (IPFS and wallet) | No test file; same `supertest` pattern as TEST-07 |
</phase_requirements>

---

## Summary

Phase 7 adds unit and integration test coverage for all security-critical modules. The codebase already has a solid test infrastructure: Vitest 4.x with `globals: true`, `environment: 'node'`, all tests in `src/__tests__/`, and `supertest` + `express` already installed as dev dependencies. Eight existing test files demonstrate the patterns to follow — `makeMockDb()` helper, `vi.fn()` for db/manager stubs, `vi.stubGlobal('fetch')` for NEAR RPC calls, and `supertest` for HTTP-level integration tests.

The test gap is concentrated in six areas: passkey.ts has no test file; ipfs.ts has no test file; wallet.ts has no test file; codename.ts has no test file; db-integrity.test.ts and mpc.test.ts have `it.todo()` stubs that need implementation. Integration tests for the full registration, authentication, IPFS recovery, and wallet recovery flows do not exist yet.

The most important constraint is stated in the success criteria: `addRecoveryWallet` tests must assert that `txHash` does NOT match `/^pending-/` — meaning the test must mock the fetch calls to return a real hash string, not merely test that the stub function returns something truthy. No test may assert a stub return value.

**Primary recommendation:** Follow the existing test patterns exactly — same file location (`src/__tests__/`), same mock helper style, same `supertest` integration approach from `rate-limiting.test.ts`. Do not introduce new test tooling.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.0.18 | Test runner, assertions, mocking | Already configured; `globals: true` means no import needed for `describe/it/expect` |
| supertest | ^7.2.2 | HTTP integration testing | Already installed; used in rate-limiting.test.ts and csrf.test.ts |
| express | peer dep | App under test | Must create a real Express app in integration tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tweetnacl | ^1.0.3 | Generate real ed25519 signatures for wallet tests | TEST-05: need real signed messages |
| bs58 | ^6.0.0 | Encode public keys for wallet test fixtures | TEST-05: public key fixture construction |
| pino | ^10.3.1 | Logger for modules under test | Pass `pino({ level: 'silent' })` to suppress test noise |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| vitest | jest | No reason — vitest is already configured and working |
| supertest | http.createServer | supertest provides cleaner API; already used in project |
| vi.stubGlobal('fetch') | node-fetch mock | `vi.stubGlobal` is the vitest-idiomatic way; already used in mpc.test.ts |

**Installation:** No new packages needed. All test dependencies are already in `devDependencies`.

---

## Architecture Patterns

### Recommended Project Structure
```
src/__tests__/
├── session.test.ts         # Already exists — adversarial cases may be complete
├── mpc.test.ts             # Already exists — needs addRecoveryWallet tests
├── passkey.test.ts         # NEW — TEST-02
├── ipfs.test.ts            # NEW — TEST-04
├── wallet.test.ts          # NEW — TEST-05
├── codename.test.ts        # NEW — TEST-06
├── registration-auth.test.ts  # NEW integration — TEST-07
└── recovery.test.ts        # NEW integration — TEST-08
```

### Pattern 1: makeMockDb() Helper (established, copy verbatim)
**What:** A factory that returns a `DatabaseAdapter` with all methods as `vi.fn()`, a real in-memory sessions Map, and support for `overrides`.
**When to use:** All unit tests that touch modules accepting a `DatabaseAdapter`.
**Example:**
```typescript
// Source: src/__tests__/session.test.ts (established pattern)
function makeMockDb(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
  const sessions = new Map<string, Session>();
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    createUser: vi.fn(),
    // ... all required methods ...
    createSession: vi.fn().mockImplementation(async (input) => { /* ... */ }),
    getSession: vi.fn().mockImplementation(async (id) => sessions.get(id) ?? null),
    ...overrides,
  };
}
```

### Pattern 2: vi.stubGlobal('fetch') for NEAR RPC calls
**What:** Replace the global `fetch` with a `vi.fn()` in `beforeEach`.
**When to use:** Any test that exercises code paths in `mpc.ts` or `wallet.ts` that call NEAR RPC endpoints.
**Example:**
```typescript
// Source: src/__tests__/mpc.test.ts (established pattern)
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }),
  }));
});
```

### Pattern 3: supertest Integration Test
**What:** Create a real Express app with `createRouter`, stub db/manager deps at the manager interface boundary, then use `supertest` to make HTTP requests.
**When to use:** TEST-07 (registration/auth flows), TEST-08 (recovery flows).
**Example:**
```typescript
// Source: src/__tests__/rate-limiting.test.ts (established pattern)
import express from 'express';
import request from 'supertest';
import { createRouter } from '../server/router.js';

function createTestApp(overrides = {}) {
  const app = express();
  const router = createRouter({
    db: mockDb,
    sessionManager: mockSessionManager,
    passkeyManager: mockPasskeyManager,
    mpcManager: mockMpcManager,
    ...overrides,
  });
  app.use(router);
  return app;
}

it('POST /register/start returns 200', async () => {
  const app = createTestApp();
  await request(app).post('/register/start').expect(200);
});
```

### Pattern 4: Real Crypto for Adversarial Session Tests
**What:** Create a real HMAC-signed cookie using `crypto.createHmac`, then tamper with it.
**When to use:** TEST-01 adversarial cases — tampered cookie, truncated cookie.
**Example:**
```typescript
// Source: src/__tests__/session.test.ts (established — already implemented)
const { createHmac } = await import('crypto');
const sig = createHmac('sha256', TEST_SECRET).update(sessionId).digest('base64url');
const signedCookie = `${sessionId}.${sig}`;
// Then tamper: replace chars, truncate, extend
```

### Pattern 5: Generating Real ed25519 Signatures for Wallet Tests
**What:** Use `tweetnacl` to sign a message with a generated keypair, then verify.
**When to use:** TEST-05 — `verifyWalletSignature` must test with cryptographically valid signatures.
**Example:**
```typescript
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createHash } from 'crypto';

function makeWalletFixture(message: string) {
  const keyPair = nacl.sign.keyPair();
  const messageHash = createHash('sha256').update(message).digest();
  const sig = nacl.sign.detached(messageHash, keyPair.secretKey);
  return {
    signature: Buffer.from(sig).toString('base64'),
    publicKey: `ed25519:${bs58.encode(Buffer.from(keyPair.publicKey))}`,
    message,
  };
}
```

### Anti-Patterns to Avoid
- **Asserting stub return values:** The success criteria explicitly states: "No test asserts a stub return value." If mocking `addRecoveryWallet`, the mock must return a realistic hash string (e.g., `'8KHt3ZzJd...'`), not `'pending-xyz'`.
- **Module-level fetch stubs without cleanup:** Always use `beforeEach`/`afterEach` with `vi.restoreAllMocks()` or `vi.unstubAllGlobals()` to avoid cross-test contamination. The mpc.test.ts derivation salt tests use `beforeEach`.
- **Importing from `../server/mpc.js` internal helpers:** `buildSignedTransaction` is not exported. The mpc.test.ts duplicates the function locally for testing. Same pattern applies to other private functions.
- **Hardcoding real NEAR RPC in tests:** All `fetch` calls must be mocked. Never make real network calls in the test suite.
- **Not calling `vi.unstubAllGlobals()` in afterEach:** The global fetch stub can leak between test files when running concurrently.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP integration testing | Custom http.Server test harness | `supertest` | Already installed, established pattern in 2 test files |
| Ed25519 signature generation | Custom crypto for test fixtures | `tweetnacl` (already a dep) | Same library used in wallet.ts production code |
| Base58 encoding in tests | Custom encoder | `bs58` (already a dep) | Same library used throughout codebase |
| Mock database | Custom class implementing DatabaseAdapter | `vi.fn()` + overrides pattern | Established pattern in session.test.ts |
| Fetch mocking | `msw` or `nock` | `vi.stubGlobal('fetch', vi.fn())` | Already used in mpc.test.ts; no new dependencies |

---

## Common Pitfalls

### Pitfall 1: `addRecoveryWallet` txHash assertion — "no pending- prefix" requirement
**What goes wrong:** Tests mock `addRecoveryWallet` to return `{ success: true, txHash: 'pending-abc' }` or `{ success: true }` — both fail the success criteria.
**Why it happens:** Previous stub implementation used `pending-` prefix. The requirement is specifically that the real implementation (with mocked RPC fetch) returns an actual hash string.
**How to avoid:** Mock the `fetch` calls that `addRecoveryWallet` makes internally. The function calls NEAR RPC twice (get access key, broadcast tx). Mock the broadcast response to return `{ result: { transaction: { hash: 'REAL_HASH_STRING' } } }`. Assert `txHash` does not match `/^pending-/`.
**Warning signs:** If the test only mocks at the `mpcManager.addRecoveryWallet` boundary rather than the `fetch` boundary, it is asserting a stub return value.

### Pitfall 2: `@simplewebauthn/server` is hard to test end-to-end without a real authenticator
**What goes wrong:** Calling `verifyRegistrationResponse` with fake data always returns `verified: false` or throws, making it impossible to test `finishRegistration`/`finishAuthentication` success paths without real WebAuthn data.
**Why it happens:** The library validates CBOR-encoded authenticator data, origin, RPID, and signature all together.
**How to avoid:** For unit tests of `passkey.ts`, mock the `@simplewebauthn/server` module functions:
```typescript
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({ challenge: 'abc', ... }),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({ verified: true, registrationInfo: { ... } }),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({ challenge: 'abc', ... }),
  verifyAuthenticationResponse: vi.fn().mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } }),
}));
```
For integration tests (TEST-07), mock `passkeyManager` at the interface boundary — do NOT attempt to call real `@simplewebauthn/server` functions in integration tests.

### Pitfall 3: Session cookie encoding in integration tests
**What goes wrong:** `supertest` integration tests that set a cookie manually fail because the session cookie value includes URL encoding and HMAC signatures.
**Why it happens:** `createSessionManager` encodes the cookie with `signSessionId` and the value is URL-encoded in the `res.cookie()` call.
**How to avoid:** For integration tests that need an authenticated user, mock `sessionManager.getSession` to return a fake session object directly, rather than trying to generate and pass a real signed cookie.

### Pitfall 4: `timingSafeEqual` with mismatched-length buffers in adversarial tests
**What goes wrong:** Tests that pass buffers of different lengths directly to `timingSafeEqual` will get `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` instead of testing the security behavior.
**Why it happens:** `timingSafeEqual` throws rather than returning false for length mismatches.
**How to avoid:** The production code in `session.ts` (line 75) already has a length guard: `if (sigBuffer.length !== expectedBuffer.length) return null`. Tests should verify this guard fires for truncated/extended inputs — which they already do in the existing `session.test.ts`. Any new adversarial tests should follow the same approach (test the module, not call `timingSafeEqual` directly).

### Pitfall 5: Module-level state in `mpc.ts` leaks between tests
**What goes wrong:** `warnedNoDerivationSalt` is a module-level `let` in `mpc.ts`. Multiple test runs in the same process will see the flag already set from a previous test.
**Why it happens:** ES module singletons persist for the lifetime of the test process.
**How to avoid:** Do not test the warning behavior across test files — keep it isolated to one `describe` block. Or use `vi.resetModules()` if you need a fresh import.

### Pitfall 6: Integration tests for wallet/IPFS recovery need managers passed to createRouter
**What goes wrong:** `walletRecovery` and `ipfsRecovery` routes only exist when the respective managers are passed to `createRouter`. Calling `/recovery/wallet/link` returns 404 if `walletRecovery` is omitted.
**Why it happens:** The router conditionally registers routes based on `config.walletRecovery` and `config.ipfsRecovery` presence.
**How to avoid:** Pass mock `walletRecovery` and `ipfsRecovery` objects to `createRouter` in integration tests for TEST-08.

---

## Code Examples

Verified patterns from existing source files:

### Generating a real ed25519 signature for wallet verification tests
```typescript
// Source: src/server/recovery/wallet.ts (verifyWalletSignature implementation)
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createHash } from 'crypto';

function buildValidWalletSignature(message: string) {
  const keyPair = nacl.sign.keyPair();
  const messageHash = createHash('sha256').update(message).digest();
  const sigBytes = nacl.sign.detached(messageHash, keyPair.secretKey);
  return {
    signature: Buffer.from(sigBytes).toString('base64'),
    publicKey: `ed25519:${bs58.encode(Buffer.from(keyPair.publicKey))}`,
    message,
  };
}
```

### Mocking checkWalletAccess (the NEAR RPC call in wallet.ts)
```typescript
// vi.stubGlobal approach — same as mpc.test.ts
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ result: { /* access key exists */ } }),
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });
```

### Integration test scaffold for registration flow (TEST-07)
```typescript
// Source: pattern from src/__tests__/rate-limiting.test.ts
import express from 'express';
import request from 'supertest';
import { createRouter } from '../server/router.js';
import { vi } from 'vitest';

const mockPasskeyManager = {
  startRegistration: vi.fn().mockResolvedValue({ challengeId: 'chal-1', options: { challenge: 'abc' } }),
  finishRegistration: vi.fn().mockResolvedValue({
    verified: true,
    passkeyData: {
      credentialId: 'cred-id-1',
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
    },
    tempUserId: 'temp-user-1',
  }),
  startAuthentication: vi.fn(),
  finishAuthentication: vi.fn(),
};

const mockMpcManager = {
  createAccount: vi.fn().mockResolvedValue({
    nearAccountId: 'abc123def456',
    derivationPath: 'near-anon-auth,temp-user-1',
    mpcPublicKey: 'ed25519:ABC',
    onChain: false,
  }),
  addRecoveryWallet: vi.fn(),
  verifyRecoveryWallet: vi.fn(),
  getMPCContractId: vi.fn(),
  getNetworkId: vi.fn(),
};

const mockDb = {
  // implement all required DatabaseAdapter methods as vi.fn()
  // createUser returns a user object with id, codename, nearAccountId, etc.
  createUser: vi.fn().mockResolvedValue({ id: 'user-1', codename: 'ALPHA-BRAVO-7', nearAccountId: 'abc123', ... }),
  createPasskey: vi.fn().mockResolvedValue(undefined),
  getUserByCodename: vi.fn().mockResolvedValue(null), // no collision
  // ... all other methods
};
```

### IPFS encrypt/decrypt roundtrip (TEST-04 — pure crypto, no mocking)
```typescript
// Source: src/server/recovery/ipfs.ts (encryptRecoveryData / decryptRecoveryData)
import { encryptRecoveryData, decryptRecoveryData } from '../server/recovery/ipfs.js';

it('encrypts and decrypts a payload successfully', async () => {
  const payload = {
    userId: 'user-1',
    nearAccountId: 'abc123def456',
    derivationPath: 'near-anon-auth,user-1',
    createdAt: Date.now(),
  };
  const encrypted = await encryptRecoveryData(payload, 'TestPassword123!');
  const decrypted = await decryptRecoveryData(encrypted, 'TestPassword123!');
  expect(decrypted.userId).toBe(payload.userId);
  expect(decrypted.nearAccountId).toBe(payload.nearAccountId);
});

it('throws on wrong password', async () => {
  const payload = { userId: 'u', nearAccountId: 'a', derivationPath: 'p', createdAt: 1 };
  const encrypted = await encryptRecoveryData(payload, 'CorrectPassword1!');
  await expect(decryptRecoveryData(encrypted, 'WrongPassword1!')).rejects.toThrow('Invalid password');
});
```

### Codename tests (TEST-06 — pure functions)
```typescript
// Source: src/server/codename.ts
import { generateCodename, generateNatoCodename, generateAnimalCodename, isValidCodename } from '../server/codename.js';

it('generateNatoCodename returns WORD-WORD-NN format', () => {
  const codename = generateNatoCodename();
  expect(isValidCodename(codename)).toBe(true);
  expect(/^[A-Z]+-[A-Z]+-\d{1,2}$/.test(codename)).toBe(true);
});

it('isValidCodename accepts ALPHA-BRAVO-42 (compound)', () => {
  expect(isValidCodename('ALPHA-BRAVO-42')).toBe(true);
});

it('isValidCodename accepts ALPHA-7 (legacy single-word)', () => {
  expect(isValidCodename('ALPHA-7')).toBe(true);
});

it('isValidCodename rejects lowercase', () => {
  expect(isValidCodename('alpha-7')).toBe(false);
});
```

---

## Existing Test Coverage (what already exists)

| File | Requirement | Status | Notes |
|------|-------------|--------|-------|
| `session.test.ts` | TEST-01 | SUBSTANTIALLY COMPLETE | Covers tampered/truncated/extended cookies, BUG-03. Adversarial cases in success criteria already tested. |
| `mpc.test.ts` | TEST-03 partial | PARTIAL | Covers DEBT-02, BUG-01, BUG-02, SEC-04. Missing: `addRecoveryWallet` txHash ≠ `pending-` assertion. |
| `db-integrity.test.ts` | TEST-03 partial | STUBS ONLY | `it.todo()` stubs for INFRA-02, BUG-04, STUB-01, STUB-02, STUB-03. Need implementation. |
| `validation.test.ts` | (SEC-05) | COMPLETE | Not a Phase 7 requirement — already done. |
| `rate-limiting.test.ts` | (SEC-02) | COMPLETE | Establishes `supertest` integration pattern to follow. |
| `csrf.test.ts` | (SEC-03) | COMPLETE | Establishes CSRF integration pattern. |
| `logging.test.ts` | (INFRA-01) | EXISTS | Not a Phase 7 requirement. |

**New files needed for Phase 7:**
- `src/__tests__/passkey.test.ts` — TEST-02
- `src/__tests__/ipfs.test.ts` — TEST-04
- `src/__tests__/wallet.test.ts` — TEST-05
- `src/__tests__/codename.test.ts` — TEST-06
- `src/__tests__/registration-auth.test.ts` — TEST-07
- `src/__tests__/recovery.test.ts` — TEST-08

**Existing files needing additions:**
- `src/__tests__/mpc.test.ts` — add `addRecoveryWallet` tests with fetch-mocked RPC (STUB-01 / TEST-03)
- `src/__tests__/db-integrity.test.ts` — implement `it.todo()` stubs (INFRA-02, BUG-04, STUB-02, STUB-03)

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-word codename ALPHA-7 | Compound ALPHA-BRAVO-42 | Phase 6 (DEBT-01) | `isValidCodename` regex now accepts both; tests must cover both formats |
| `addRecoveryWallet` returned `pending-*` stub hash | Real MPC signing via `@near-js/transactions` | Phase 5 (STUB-01) | Tests must mock fetch calls, NOT the manager method itself |
| `verifyRecoveryWallet` checked key list blindly | Checks specific wallet public key via `view_access_key` | Phase 5 (BUG-04) | Tests must pass the exact `recoveryWalletPublicKey` and mock RPC correctly |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (root) — `globals: true`, `environment: 'node'` |
| Quick run command | `npx vitest run src/__tests__/session.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | Session cookie sign/verify adversarial cases | unit | `npx vitest run src/__tests__/session.test.ts` | ✅ |
| TEST-02 | Passkey manager challenge, registration, auth lifecycle | unit | `npx vitest run src/__tests__/passkey.test.ts` | ❌ Wave 0 |
| TEST-03 | MPC addRecoveryWallet txHash ≠ pending- | unit | `npx vitest run src/__tests__/mpc.test.ts` | ✅ (needs additions) |
| TEST-03 | INFRA-02/BUG-04/STUB-01/STUB-02/STUB-03 todo stubs | unit | `npx vitest run src/__tests__/db-integrity.test.ts` | ✅ (needs todo impl) |
| TEST-04 | IPFS encrypt/decrypt roundtrip, wrong password throws | unit | `npx vitest run src/__tests__/ipfs.test.ts` | ❌ Wave 0 |
| TEST-05 | Wallet signature verify, unrelated key returns false | unit | `npx vitest run src/__tests__/wallet.test.ts` | ❌ Wave 0 |
| TEST-06 | Codename generation format, isValidCodename patterns | unit | `npx vitest run src/__tests__/codename.test.ts` | ❌ Wave 0 |
| TEST-07 | Full registration flow via supertest, full auth flow via supertest | integration | `npx vitest run src/__tests__/registration-auth.test.ts` | ❌ Wave 0 |
| TEST-08 | IPFS recovery flow via supertest, wallet recovery flow via supertest | integration | `npx vitest run src/__tests__/recovery.test.ts` | ❌ Wave 0 |

### Adversarial Cases Required by Success Criteria
| Behavior | File | Key Implementation Note |
|----------|------|------------------------|
| Tampered session cookie → 401 response | `registration-auth.test.ts` | Mock `sessionManager.getSession` to return null when cookie is tampered |
| Expired challenge → 400 response | `passkey.test.ts` | Mock `db.getChallenge` to return challenge with `expiresAt` in the past |
| Truncated session cookie → no throw | `session.test.ts` | Already covered (line 133–152); verify no regression |
| NEAR account with unrelated key → `verifyWalletSignature` returns false | `wallet.ts` | Mock `fetch` to return `{ error: 'UNKNOWN_ACCESS_KEY' }` for `checkWalletAccess` |
| `addRecoveryWallet` txHash does NOT match `/^pending-/` | `mpc.test.ts` | Mock both fetch calls; assert `txHash` against `/^pending-/` (should be false) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/__tests__/<relevant-file>.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** `npx vitest run` — full suite green with zero failures before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/passkey.test.ts` — covers TEST-02
- [ ] `src/__tests__/ipfs.test.ts` — covers TEST-04
- [ ] `src/__tests__/wallet.test.ts` — covers TEST-05
- [ ] `src/__tests__/codename.test.ts` — covers TEST-06
- [ ] `src/__tests__/registration-auth.test.ts` — covers TEST-07
- [ ] `src/__tests__/recovery.test.ts` — covers TEST-08

*(Existing infrastructure: vitest configured, supertest installed, node_modules present — no framework install needed)*

---

## Open Questions

1. **Passkey integration test: expired challenge returns 400**
   - What we know: `finishRegistration` throws `'Challenge expired'` when `challenge.expiresAt < new Date()`. The router's catch block returns 500, not 400.
   - What's unclear: The success criteria says "expired challenge returns 400" — but looking at `router.ts` line 178, the catch block sends 500. The `passkey.ts` throws a generic Error. The 400 may need to come from passkey.ts returning `{ verified: false }` (not throwing) when expired, or the router may need a conditional.
   - Recommendation: Read `passkey.ts` `finishAuthentication` carefully — it calls `deleteChallenge` and throws. The router catches all errors and sends 500. The test should verify the current behavior (500 for expired challenge, unless the router is updated). Clarify during planning whether this requires a router fix.

2. **db-integrity.test.ts todo stubs: INFRA-02 transaction rollback tests**
   - What we know: The stubs say "rolls back user creation when createPasskey fails". This requires the db adapter to have a working `transaction()` method.
   - What's unclear: The mock db doesn't implement `transaction()` — testing rollback requires a mock that simulates transaction behavior.
   - Recommendation: Mock `db.transaction` to run the callback but also test the non-transaction fallback path. The planner should decide whether to implement these stubs or remove them.

---

## Sources

### Primary (HIGH confidence)
- Source code `src/__tests__/*.test.ts` — established patterns directly in the codebase
- `vitest.config.ts` — confirmed framework configuration
- `package.json` — confirmed installed versions: vitest ^4.0.18, supertest ^7.2.2, @types/supertest ^7.2.0
- `src/server/session.ts`, `passkey.ts`, `mpc.ts`, `recovery/ipfs.ts`, `recovery/wallet.ts`, `codename.ts` — production modules under test

### Secondary (MEDIUM confidence)
- Vitest 4.x docs on `globals`, `vi.fn()`, `vi.stubGlobal`, `vi.mock` — patterns verified against working test files

### Tertiary (LOW confidence)
- None — all findings verified against project source

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed, versions locked in package.json
- Architecture: HIGH — patterns copied directly from 8 existing test files in the same project
- Pitfalls: HIGH — derived from reading actual production code and existing tests, not general advice

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable — no fast-moving deps)
