# near-phantom-auth

Anonymous passkey authentication with NEAR MPC accounts and decentralized recovery.

> **Privacy-first**: No email, no phone, no PII. Just biometrics and blockchain.

## Features

- **Passkey Authentication**: Face ID, Touch ID, Windows Hello - no passwords
- **NEAR MPC Accounts**: User-owned accounts via Chain Signatures (8-node threshold MPC)
- **Anonymous Identity**: Compound codenames (ALPHA-BRAVO-42, SWIFT-FALCON-73) - we never know who you are
- **OAuth Authentication**: Google, GitHub, and X/Twitter sign-in (separate identity track)
- **Decentralized Recovery**:
  - Link a NEAR wallet (on-chain access key, not stored in our DB)
  - Password + IPFS backup (encrypted, you hold the keys)
- **HttpOnly Sessions**: XSS-proof cookie-based sessions
- **Input Validation**: Zod schemas on all 18 endpoints - malformed requests rejected before reaching handlers
- **Rate Limiting**: Tiered per-endpoint limits (auth: 20/15min, recovery: 5/hr)
- **CSRF Protection**: Opt-in Double Submit Cookie with automatic OAuth callback exemption
- **Structured Logging**: Injectable pino logger with sensitive field redaction; silent by default
- **Automatic Cleanup**: Scheduler removes expired sessions, challenges, and OAuth states

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
