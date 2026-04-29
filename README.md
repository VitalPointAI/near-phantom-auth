# near-phantom-auth

**Drop-in anonymous authentication for any web app — passkeys + NEAR MPC accounts + decentralized recovery, with no email, no phone, and no PII.**

> **Privacy-first**: No email, no phone, no PII. Just biometrics and blockchain.

## Why use this?

Most "anonymous" auth solutions still ask for an email or phone number for recovery. This package treats anonymity as a hard constraint and ships everything you need to honor it:

- **Truly anonymous sign-up** — users register with a passkey (Face ID, Touch ID, Windows Hello). No email, no phone, no real name. Identity is a randomly-generated codename (`ALPHA-BRAVO-42`) the server cannot link to a person.
- **Per-user NEAR account out of the box** — every passkey user gets a deterministic 64-char hex implicit account on NEAR (`testnet` or `mainnet`). Optionally auto-funded from your treasury so it is on-chain immediately. The account is the user's, not yours.
- **Account recovery without identity** — two recovery paths, both anonymity-preserving:
  - **Wallet recovery** — link a NEAR wallet on-chain via a `FullAccess` key. We never see the wallet; the link lives only on the blockchain.
  - **Password + IPFS recovery** — your password encrypts a recovery blob (AES-256-GCM); we pin the ciphertext to IPFS via Pinata/Web3.Storage/Infura. Lose your device, recover with `password + CID`.
- **OAuth track for users who want it** — Google / GitHub / X-Twitter sign-in is available as a fully separate identity stream that does NOT cross-contaminate the anonymous track. OAuth users live in a different table with a different type.
- **Standalone MPC account helper** (v0.6.1+) — if you only need NEAR account provisioning (not the full passkey/recovery stack), import `MPCAccountManager` directly and skip everything else.
- **End-to-end encryption ready** — the WebAuthn PRF extension (v0.6.0+) returns a stable 32-byte sealing key per credential, derived inside the authenticator's secure enclave. Hand it to any DEK provisioner downstream.
- **Production-hardened** — Zod input validation on every endpoint, tiered rate limiting, opt-in CSRF, `HttpOnly` cookies, structured logging with treasury-key redaction, and a 280+ test suite.

## Feature reference

- **Passkey Authentication**: Face ID, Touch ID, Windows Hello, hardware keys — no passwords
- **NEAR MPC Accounts**: User-owned accounts via Chain Signatures (8-node threshold MPC) on testnet or mainnet
- **Standalone `MPCAccountManager`** (v0.6.1+): Provision and recover NEAR accounts without the full auth stack — see [MPCAccountManager (v0.6.1+)](#mpcaccountmanager-v061) below
- **Anonymous Identity**: Compound codenames (ALPHA-BRAVO-42, SWIFT-FALCON-73) — we never know who you are
- **OAuth Authentication**: Google, GitHub, and X/Twitter sign-in (separate identity track that never touches the anonymous user table)
- **Decentralized Recovery**:
  - Link a NEAR wallet (on-chain `FullAccess` access key, not stored in our DB)
  - Password + IPFS backup (encrypted, you hold the keys)
- **HttpOnly Sessions**: XSS-proof cookie-based sessions
- **Input Validation**: Zod schemas on all 18 endpoints — malformed requests rejected before reaching handlers
- **Rate Limiting**: Tiered per-endpoint limits (auth: 20/15min, recovery: 5/hr)
- **CSRF Protection**: Opt-in Double Submit Cookie with automatic OAuth callback exemption
- **Structured Logging**: Injectable pino logger with sensitive field redaction (treasury private key, etc.); silent by default
- **Automatic Cleanup**: Scheduler removes expired sessions, challenges, and OAuth states
- **PRF-Derived Sealing Key** (v0.6.0+): WebAuthn PRF extension produces a stable per-credential 32-byte sealing key for end-to-end encryption — opt-in via `passkey.prfSalt`/`requirePrf`, graceful degradation on Firefox/older authenticators

## WebAuthn PRF Extension (DEK Sealing Key)

Since v0.6.0, the library requests the WebAuthn PRF (Pseudo-Random Function) extension on every registration and login. A PRF-capable authenticator deterministically derives 32 bytes per credential (HMAC-SHA-256 over the RP-supplied salt, computed inside the authenticator's secure enclave). The 32 bytes are hex-encoded as `sealingKeyHex` and posted in the body of `/register/finish` and `/login/finish`. Downstream services (e.g., an auth-service DEK provisioner) can use this stable key material to seal/unseal per-user encrypted data.

> **The 32 bytes never leave the authenticator's secure enclave in raw form. Only the salt and the derived hex are seen by application code.**

### Configuration

```tsx
import { AnonAuthProvider } from '@vitalpoint/near-phantom-auth/client';

function App() {
  return (
    <AnonAuthProvider
      apiUrl="/auth"
      passkey={{
        prfSalt: new TextEncoder().encode('my-app-prf-sealing-v1'),
        requirePrf: false,
      }}
    >
      <AuthDemo />
    </AnonAuthProvider>
  );
}
```

The same `passkey: { prfSalt, requirePrf }` shape is also accepted on `createAnonAuth({ passkey })` server-side for symmetry with the client surface. On the server this is type documentation only — the library does not use these values at runtime on the server; the salt and enforcement rules live entirely in the browser.

If `passkey` is omitted, the library defaults to `prfSalt = new TextEncoder().encode('near-phantom-auth-prf-v1')` and `requirePrf = false`.

### Salt Immutability

- **Do not change the salt after deployment.**
- The PRF output is deterministic over (credential, salt). Changing the salt by one byte produces a different sealing key and makes any data encrypted with the original key inaccessible.
- The `v1` suffix is a rotation identifier, not a semver — it does NOT mean "to be upgraded later." Treat the chosen salt as a permanent constant for the lifetime of the deployment.

### Browser Support

| Browser / Authenticator                       | Registration PRF                     | Login PRF | Notes                                                              |
| --------------------------------------------- | ------------------------------------ | --------- | ------------------------------------------------------------------ |
| Chrome / Edge ≥116                            | yes                                  | yes       | iCloud Keychain / Google Password Manager / Chrome 147+ Windows Hello |
| Safari ≥18 (iOS 18, macOS 15)                 | yes                                  | yes       | Synced platform passkeys                                           |
| Firefox                                       | no                                   | no        | PRF not yet implemented as of mid-2025; graceful degradation applies |
| Hardware keys (YubiKey, etc.)                 | no (returns `enabled: true` only)    | yes       | First sealing key arrives on first successful login, not registration |
| Chrome ≤146 Windows Hello                     | no                                   | yes       | Same hardware-key behavior                                         |

When the authenticator does not return a PRF result, `sealingKeyHex` is omitted from the POST body (the field is absent, not sent as `null`). With `requirePrf: false` (default), the registration/login ceremony completes normally and the user can still use unencrypted features — encrypted endpoints simply 401 until the user logs in again on a PRF-capable device. With `requirePrf: true`, the `register()`/`login()` hook methods throw an `Error` whose message starts with `PRF_NOT_SUPPORTED`; the `useAnonAuth` hook surfaces this as `state.error` via the existing catch path. Choose `requirePrf: true` only if your user base is restricted to PRF-capable authenticators — otherwise you will lock out Firefox users entirely.

### Migration for Existing Accounts (NULL Key Bundles)

Users who registered before v0.6.0 do not have a DEK provisioned server-side — their account records have a NULL key bundle (`users.mlkem_ek IS NULL`). Once the auth-service is patched so that `provisionUserKeys()` fires whenever `getUserKeyBundle(userId)` returns `null` on login (not only for brand-new `isNewUser` registrations), these accounts auto-bootstrap on next successful login. No client-side migration is required: starting at v0.6.0 the library ships `sealingKeyHex` on every login for PRF-capable authenticators, and the server decides — based on the presence of an existing key bundle — whether to provision a new DEK or unwrap the existing one.

## Installation

```bash
npm install @vitalpoint/near-phantom-auth
```

The package provides both server and client exports:
- `@vitalpoint/near-phantom-auth/server` - Express router, session management, MPC accounts
- `@vitalpoint/near-phantom-auth/client` - React hooks, WebAuthn helpers, API client

Both are included in the single package - no separate installs needed.

## Quick Start

### Server (Express)

```typescript
import express from 'express';
import { createAnonAuth } from '@vitalpoint/near-phantom-auth/server';

const app = express();

const auth = createAnonAuth({
  nearNetwork: 'testnet',
  sessionSecret: process.env.SESSION_SECRET!,
  database: {
    type: 'postgres',
    connectionString: process.env.DATABASE_URL!,
  },
  rp: {
    name: 'My App',
    id: 'myapp.com',
    origin: 'https://myapp.com',
  },
  // Recommended for production: prevents account ID prediction
  derivationSalt: process.env.DERIVATION_SALT!,
  recovery: {
    wallet: true,
    ipfs: {
      pinningService: 'pinata',
      apiKey: process.env.PINATA_API_KEY,
      apiSecret: process.env.PINATA_API_SECRET,
    },
  },
});

// Initialize database schema
await auth.initialize();

// Mount auth routes
app.use('/auth', auth.router);

// Mount OAuth routes (optional)
if (auth.oauthRouter) {
  app.use('/auth/oauth', auth.oauthRouter);
}

// Protect routes
app.get('/api/me', auth.requireAuth, (req, res) => {
  res.json({
    codename: req.anonUser!.codename,
    nearAccountId: req.anonUser!.nearAccountId,
  });
});

app.listen(3000);
```

### Client (React)

```tsx
import { AnonAuthProvider, useAnonAuth } from '@vitalpoint/near-phantom-auth/client';

function App() {
  return (
    <AnonAuthProvider apiUrl="/auth">
      <AuthDemo />
    </AnonAuthProvider>
  );
}

function AuthDemo() {
  const {
    isLoading,
    isAuthenticated,
    codename,
    nearAccountId,
    webAuthnSupported,
    register,
    login,
    logout,
    error,
    clearError,
  } = useAnonAuth();

  if (isLoading) return <div>Loading...</div>;

  if (!webAuthnSupported) {
    return <div>Your browser doesn't support passkeys.</div>;
  }

  if (!isAuthenticated) {
    return (
      <div>
        <h1>Anonymous Auth Demo</h1>
        {error && (
          <p style={{ color: 'red' }}>
            {error} <button onClick={clearError}>x</button>
          </p>
        )}
        <button onClick={register}>Register (Create Identity)</button>
        <button onClick={() => login()}>Sign In (Existing Identity)</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Welcome, {codename}</h1>
      <p>NEAR Account: {nearAccountId}</p>
      <button onClick={logout}>Sign Out</button>
    </div>
  );
}
```

> **Important**: Always use the client library's `register` and `login` functions rather than implementing WebAuthn manually. WebAuthn uses base64url encoding (not standard base64), and the client library handles this correctly.

### Client (Vanilla JS / Non-React)

For non-React applications, use the lower-level functions:

```typescript
import {
  createApiClient,
  createPasskey,
  authenticateWithPasskey,
  isWebAuthnSupported
} from '@vitalpoint/near-phantom-auth/client';

const api = createApiClient({ baseUrl: '/auth' });

// Check support
if (!isWebAuthnSupported()) {
  console.error('WebAuthn not supported');
}

// Register
async function register() {
  const { challengeId, options, tempUserId, codename } = await api.startRegistration();
  const credential = await createPasskey(options); // Handles base64url encoding
  const result = await api.finishRegistration(challengeId, credential, tempUserId, codename);
  console.log('Registered as:', result.codename);
}

// Login
async function login() {
  const { challengeId, options } = await api.startAuthentication();
  const credential = await authenticateWithPasskey(options); // Handles base64url encoding
  const result = await api.finishAuthentication(challengeId, credential);
  console.log('Logged in as:', result.codename);
}
```

## How It Works

### Registration Flow

```
1. User clicks "Register"
2. Browser creates passkey (biometric prompt)
3. Server creates NEAR account via MPC
4. User gets compound codename (e.g., ALPHA-BRAVO-42)
5. Session cookie set (HttpOnly, Secure, SameSite=Strict)
```

### Authentication Flow

```
1. User clicks "Sign In"
2. Browser prompts for passkey (biometric)
3. Server verifies signature (constant-time comparison)
4. Session cookie set
```

### Recovery Options

#### Wallet Recovery
- User links existing NEAR wallet
- Wallet added as on-chain access key (NOT stored in our database)
- Recovery: Sign with wallet -> Create new passkey

#### Password + IPFS Recovery
- User sets strong password
- Recovery data encrypted with password (AES-256-GCM)
- Encrypted blob stored on IPFS via concurrent multi-gateway pinning
- User saves: password + IPFS CID
- Recovery: Provide password + CID -> Decrypt -> Create new passkey

## MPCAccountManager (v0.6.1+)

Standalone helper for provisioning NEAR implicit accounts and verifying recovery wallets. Exported from `@vitalpoint/near-phantom-auth/server` as a runtime value. Use this directly when you only need the account-provisioning pipeline — not the full passkey + session + recovery stack — for example when integrating with an existing auth service via a sidecar.

### When to use it

| Use case | Use this | Use full `createAnonAuth` |
|----------|----------|---------------------------|
| Building a complete anonymous auth flow (passkey + sessions + recovery) | — | yes |
| Provisioning NEAR accounts for users authenticated by another system | yes | — |
| Server-to-server account creation triggered by a webhook | yes | — |
| Verifying that a wallet has `FullAccess` on a user's NEAR account | yes | yes (via `auth.mpc.verifyRecoveryWallet`) |
| Idempotent retry of provisioning from a queue worker | yes | — |

### Quick start

```typescript
import {
  MPCAccountManager,
  type MPCAccountManagerConfig,
  type CreateAccountResult,
} from '@vitalpoint/near-phantom-auth/server';

const manager = new MPCAccountManager({
  networkId: 'testnet',                                    // or 'mainnet'
  treasuryAccount: process.env.NEAR_TREASURY_ACCOUNT!,
  treasuryPrivateKey: process.env.NEAR_TREASURY_KEY!,
  derivationSalt: process.env.NEAR_DERIVATION_SALT!,        // REQUIRED — see Security
  fundingAmount: '0.01',                                   // optional; default '0.01' NEAR
});

const result: CreateAccountResult = await manager.createAccount('user-id');
// result.nearAccountId  matches /^[a-f0-9]{64}$/  (64-char hex implicit account)
// result.mpcPublicKey   is `ed25519:${bs58.encode(publicKeyBytes)}`
// result.derivationPath is `near-anon-auth,user-id`
// result.onChain        is true after successful funding
```

### Derivation function

The account ID is a pure function of `(derivationSalt, userId)` — same arguments always produce the same account. There is no randomness; idempotent retry is safe.

```
seedInput      = `implicit-${derivationSalt}-${userId}`
seed           = SHA-256(seedInput)
publicKeyBytes = first 32 bytes of SHA-512(seed)
nearAccountId  = publicKeyBytes.toString('hex')         // 64-char lowercase hex
mpcPublicKey   = `ed25519:${bs58.encode(publicKeyBytes)}`
derivationPath = `near-anon-auth,${userId}`
```

If `derivationSalt` is omitted (only possible via the looser internal `MPCConfig` type), account IDs become predictable from user IDs alone — the standalone `MPCAccountManagerConfig` type makes the salt REQUIRED at compile time.

### Idempotency (MPC-03)

`createAccount(userId)` is idempotent. A second call against an already-provisioned account short-circuits via `view_account` and issues zero additional `broadcast_tx_commit` calls — the existing on-chain account is returned with `onChain: true`.

### Concurrent calls (MPC-06)

Two concurrent `createAccount` calls for the same `userId` from different replicas converge to a single provisioned account. The loser of the nonce race retries `view_account` once and returns success when the winner has already provisioned the account.

### Error paths (MPC-10)

`createAccount` throws when:

| Condition | Thrown error | Suggested HTTP status |
|-----------|--------------|-----------------------|
| NEAR RPC is unreachable (fetch throws) | `Error('RPC unreachable', { cause })` | 503 |
| Treasury balance is too low | `Error('Treasury underfunded', { cause })` | 503 |
| Any other broadcast failure | `Error('Transfer failed', { cause })` | 502 |

The `cause` field always contains the original RPC error message for debugging.

`verifyRecoveryWallet` throws **only** when the NEAR RPC is unreachable (consumer should return 500). It returns `false` (does not throw) for missing accounts, FunctionCall-only keys, or unknown access keys.

### Security expectations

- **`derivationSalt` is REQUIRED** at the type level — TypeScript rejects an `MPCAccountManagerConfig` literal that omits it. Use a per-tenant secret salt to prevent cross-tenant account ID collision.
- **`treasuryPrivateKey` is never logged** — the manager replaces the raw string with a `KeyPair` object on construction. The default-silent pino logger is wired with redact paths (`config.treasuryPrivateKey`, `*.treasuryPrivateKey`); even an accidental `log.info({ config }, '...')` emits `[Redacted]` instead of the secret.
- **Transactions are signed in-process** — no `near-cli` shell-out, no `process.exec` injection vector.
- **`verifyRecoveryWallet` returns true ONLY for `FullAccess` keys** — FunctionCall-scoped keys (which cannot sign arbitrary transactions) cannot satisfy recovery verification.
- **Dist bundle is leak-audited** — the published `dist/server/index.js` is checked at build time to confirm zero `ed25519:<base58>` string literals are baked in.

### Frozen contract (consumer pin)

The following surface is FROZEN — no field, method, or return-shape rename without a coordinated PR:

- `class MPCAccountManager`
- `createAccount(userId: string): Promise<CreateAccountResult>`
- `verifyRecoveryWallet(nearAccountId: string, recoveryWalletPublicKey: string): Promise<boolean>`
- `interface MPCAccountManagerConfig` (with `derivationSalt: string` REQUIRED)
- `type CreateAccountResult` (= `MPCAccount`)

## API Routes

### Passkey Authentication

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/register/start` | Start passkey registration |
| POST | `/register/finish` | Complete registration, create NEAR account |
| POST | `/login/start` | Start authentication |
| POST | `/login/finish` | Complete authentication |
| POST | `/logout` | End session |
| GET | `/session` | Get current session |
| GET | `/csrf-token` | Get CSRF token (when CSRF enabled) |

### Recovery

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/recovery/wallet/link` | Start wallet linking |
| POST | `/recovery/wallet/verify` | Complete wallet linking |
| POST | `/recovery/wallet/start` | Start wallet recovery |
| POST | `/recovery/wallet/finish` | Complete wallet recovery |
| POST | `/recovery/ipfs/setup` | Create IPFS backup |
| POST | `/recovery/ipfs/recover` | Recover from IPFS |

### Account Management

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/account/reregister-passkey` | Re-register passkey after recovery |
| DELETE | `/account` | Delete account and all associated data |

### OAuth (mounted separately)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/oauth/providers` | List available OAuth providers |
| GET | `/oauth/:provider/start` | Start OAuth flow (google, github, twitter) |
| POST | `/oauth/:provider/callback` | Handle OAuth callback |
| POST | `/oauth/:provider/link` | Link additional provider to account |

## Configuration

### Full Configuration

```typescript
const auth = createAnonAuth({
  // === Required ===
  nearNetwork: 'testnet',           // 'testnet' or 'mainnet'
  sessionSecret: '...',             // Session signing secret
  database: {
    type: 'postgres',               // 'postgres' or 'custom'
    connectionString: '...',        // PostgreSQL connection string
    // OR
    // type: 'custom',
    // adapter: myCustomAdapter,    // DatabaseAdapter implementation
  },

  // === WebAuthn Relying Party ===
  rp: {
    name: 'My App',
    id: 'myapp.com',
    origin: 'https://myapp.com',
  },

  // === Privacy (recommended for production) ===
  derivationSalt: '...',           // Prevents NEAR account ID prediction

  // === Session ===
  sessionDurationMs: 7 * 24 * 60 * 60 * 1000, // Default: 7 days

  // === Codename Generation ===
  codename: {
    style: 'nato-phonetic',         // ALPHA-BRAVO-42 (default)
    // style: 'animals',            // SWIFT-FALCON-73
    // generator: (userId) => `AGENT-${userId.slice(0, 8)}`, // Custom
  },

  // === Recovery ===
  recovery: {
    wallet: true,                   // Enable on-chain wallet recovery
    ipfs: {                         // Enable IPFS + password recovery
      pinningService: 'pinata',     // 'pinata', 'web3storage', 'infura', 'custom'
      apiKey: '...',
      apiSecret: '...',
    },
  },

  // === OAuth (optional) ===
  oauth: {
    callbackBaseUrl: 'https://myapp.com/auth/callback',
    google: { clientId: '...', clientSecret: '...' },
    github: { clientId: '...', clientSecret: '...' },
    twitter: { clientId: '...', clientSecret: '...' },
  },

  // === MPC Account Config (optional) ===
  mpc: {
    treasuryAccount: 'your-treasury.near',
    treasuryPrivateKey: process.env.NEAR_TREASURY_PRIVATE_KEY,
    fundingAmount: '0.01',          // NEAR per new account
    accountPrefix: 'anon',          // Account name prefix
    derivationSalt: '...',          // Alternative to top-level derivationSalt
  },

  // === Logging (optional) ===
  logger: pinoInstance,             // pino logger; silent/disabled if omitted

  // === Rate Limiting (optional, sensible defaults) ===
  rateLimiting: {
    auth: { windowMs: 900000, limit: 20 },      // 20 req / 15 min
    recovery: { windowMs: 3600000, limit: 5 },   // 5 req / 1 hr
  },

  // === CSRF Protection (optional, disabled by default) ===
  csrf: {
    secret: '...',                  // HMAC secret (must differ from sessionSecret)
  },

  // === Email (optional, for OAuth recovery passwords) ===
  email: {
    region: 'us-east-1',           // AWS SES region
    accessKeyId: '...',            // Optional (uses instance profile if omitted)
    secretAccessKey: '...',
    fromAddress: 'noreply@myapp.com',
  },
});
```

### Environment Variables

```bash
# Required
SESSION_SECRET=your-secure-session-secret
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb

# Privacy (recommended for production)
DERIVATION_SALT=your-random-secret-salt

# NEAR Network ('testnet' or 'mainnet')
NEAR_NETWORK=mainnet

# Mainnet: Treasury for auto-funding new accounts
NEAR_TREASURY_ACCOUNT=your-treasury.near
NEAR_TREASURY_PRIVATE_KEY=ed25519:5abc123...
NEAR_FUNDING_AMOUNT=0.01  # optional, default 0.01

# Optional: Recovery via IPFS (Pinata)
PINATA_API_KEY=your-pinata-key
PINATA_API_SECRET=your-pinata-secret

# Optional: Recovery via IPFS (Web3.Storage)
WEB3_STORAGE_TOKEN=your-web3storage-token

# Optional: Recovery via IPFS (Infura)
INFURA_IPFS_PROJECT_ID=your-project-id
INFURA_IPFS_PROJECT_SECRET=your-project-secret

# Optional: OAuth providers
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
TWITTER_CLIENT_ID=...
TWITTER_CLIENT_SECRET=...

# Optional: CSRF protection
CSRF_SECRET=your-csrf-secret

# Optional: AWS SES email
AWS_SES_REGION=us-east-1
AWS_SES_ACCESS_KEY_ID=...
AWS_SES_SECRET_ACCESS_KEY=...
AWS_SES_FROM_ADDRESS=noreply@myapp.com
```

### Cleanup Scheduler

Expired sessions, challenges, and OAuth states are not cleaned automatically by `createAnonAuth`. Use the standalone cleanup scheduler:

```typescript
import { createCleanupScheduler } from '@vitalpoint/near-phantom-auth/server';

const scheduler = createCleanupScheduler(auth.db, logger, 5 * 60 * 1000); // every 5 min

// On graceful shutdown:
process.on('SIGTERM', () => scheduler.stop());
```

### MPC Account Funding (Mainnet)

On NEAR mainnet, implicit accounts (64-char hex addresses) need initial funding to become active on-chain. Configure a treasury account to auto-fund new user accounts:

```typescript
const auth = createAnonAuth({
  nearNetwork: 'mainnet',
  // ... other config

  mpc: {
    treasuryAccount: 'your-treasury.near',
    treasuryPrivateKey: process.env.NEAR_TREASURY_PRIVATE_KEY,
    fundingAmount: '0.01',
    accountPrefix: 'myapp',
  },
});
```

**How it works:**
1. New user registers with passkey
2. System derives deterministic implicit account ID (64-char hex)
3. Treasury sends 0.01 NEAR to activate the account
4. User can now receive/send NEAR immediately

**Cost estimation:**
- ~0.01 NEAR per new user
- 1 NEAR funds ~100 new accounts
- Treasury account needs ~0.00182 NEAR minimum balance to stay active

> **Testnet**: On testnet, accounts are auto-created via the NEAR testnet helper API with test tokens. No treasury needed.

## Security Recommendations

### Hardware Security Keys

For maximum security, we recommend using a hardware security key instead of platform authenticators (Face ID, fingerprint). Hardware keys provide:

- **Phishing resistance**: Credentials bound to specific domains
- **No biometric data exposure**: Key never leaves the device
- **Cross-device portability**: Use the same key on multiple devices
- **Air-gapped signing**: Private keys never touch your computer

**Recommended: [Nitrokey](https://shop.nitrokey.com/shop?aff_ref=39)** - Open source hardware security keys with FIDO2/WebAuthn support. Made in Germany with open firmware you can audit.

### Production Checklist

- [ ] Set `derivationSalt` to prevent NEAR account ID prediction
- [ ] Set `sessionSecret` to a cryptographically random value (32+ bytes)
- [ ] Enable `csrf` with a separate secret if your frontend is on a different origin
- [ ] Configure `rateLimiting` thresholds appropriate for your traffic
- [ ] Provide a `logger` instance with appropriate redaction for your environment
- [ ] Run `createCleanupScheduler` to prevent expired record accumulation

## Privacy and Anonymity Audit

This section documents exactly what the package stores, logs, and exposes for passkey (anonymous) users. The goal: **it must be impossible to link a passkey user to a real-world identity through anything this package does.**

### What We Store (Passkey Users)

| Data | Stored | Location | Identity Risk |
|------|--------|----------|---------------|
| Email | No | - | - |
| Phone | No | - | - |
| Real name | No | - | - |
| Codename | Yes | Database | None - randomly generated from `crypto.randomBytes()` |
| NEAR account ID | Yes | Database + Blockchain | None - derived from random UUID + salt |
| Passkey public key | Yes | Database | None - device-generated, unlinkable |
| Session IP address | Yes | Database (`anon_sessions`) | Operational - ephemeral, cleaned on session expiry |
| Session user agent | Yes | Database (`anon_sessions`) | Operational - ephemeral, cleaned on session expiry |
| Recovery wallet link | No | On-chain only | - |
| IPFS backup CID | Yes | Database | None - content is AES-256-GCM encrypted |

### What We Cannot Know

- **Real identity of passkey users** - no PII is collected or stored at any point in the passkey flow
- **Link between codename and real person** - codenames are random, not derived from identity
- **Link between NEAR account and real person** - account IDs are derived from random UUIDs (with `derivationSalt`, they are also unpredictable)
- **Contents of IPFS recovery backups** - encrypted with user-chosen password, never stored server-side
- **Which wallet belongs to which user** - recovery wallet linkage is on-chain only, not in our database

### Anonymity Design Decisions

**WebAuthn attestation is set to `'none'`**. The package never requests device attestation, which means the server never learns the manufacturer, model, or firmware version of the user's authenticator. This is intentional - attestation is an identity vector.

**OAuth and passkey tracks are fully separated**. OAuth users (who have email/name) and passkey users (who are anonymous) are stored in separate database tables (`oauth_users` vs `anon_users`) with separate TypeScript types. OAuth identity data never leaks into anonymous user records.

**Codenames are purely random**. Generated from `crypto.randomBytes()` selecting from word lists. Not derived from user ID, device, IP, or any other input. Two users on the same device get unrelated codenames.

**Logging is silent by default**. If no `logger` is provided, zero output is produced. When logging is enabled, passkey flow log calls contain no identity data - only error objects, NEAR account IDs, and operational metadata.

**Rate limiting is in-memory only**. IP addresses are used as rate limit keys by `express-rate-limit` but are never persisted to disk or database by the rate limiter. They exist only in the Node.js process memory for the duration of the rate limit window.

### Session IP and User Agent

Session records include optional `ipAddress` and `userAgent` fields. These are standard Express operational metadata used for session security (detecting session hijacking, abuse patterns). They are:

- **Ephemeral** - cleaned up when sessions expire (via cleanup scheduler or expiry)
- **Not exposed** - never returned in any API response
- **Not logged** - not included in any log call
- **Not linked to identity** - there is no identity to link to; the user record contains only a random UUID, random codename, and NEAR account

With full database access, an attacker would see: a random UUID, a random codename, a NEAR account, and a list of session IPs. But there is no name, email, phone, or external identifier to connect any of it to a real person. The IP tells you a session came from an ISP - not who the person is.

### Threat Model Summary

| Threat | Mitigated | How |
|--------|-----------|-----|
| Server operator identifies user | Yes | No PII in anonymous user record |
| Database breach reveals identity | Yes | Only random UUIDs, codenames, and public keys |
| Log exfiltration reveals identity | Yes | Logging silent by default; no PII in passkey log calls |
| Device fingerprinting via WebAuthn | Yes | Attestation set to `'none'` |
| Cross-track deanonymization (OAuth -> passkey) | Yes | Separate DB tables and type system |
| NEAR account -> real identity | Yes | Derived from random UUID; unpredictable with `derivationSalt` |
| Recovery backup contents leaked | Yes | AES-256-GCM encrypted with user password |
| Rate limiter IP persistence | Yes | In-memory only, never written to disk |

## License

MIT

## Contributing

Contributions welcome! Please read our contributing guidelines first.
