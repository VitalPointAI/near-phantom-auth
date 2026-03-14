# External Integrations

**Analysis Date:** 2026-03-14

## APIs & External Services

**NEAR Protocol Blockchain:**
- Used for MPC account creation, funding, and access key verification
- RPC Endpoints (direct `fetch` calls, no SDK wrapper):
  - Mainnet: `https://rpc.mainnet.near.org`
  - Testnet: `https://rpc.testnet.near.org`
- Testnet Account Helper: `https://helper.testnet.near.org/account`
- MPC Signer Contracts:
  - Mainnet: `v1.signer-prod.near`
  - Testnet: `v1.signer-prod.testnet`
- Implementation: `src/server/mpc.ts`
- RPC methods used: `query` (view_account, view_access_key, view_access_key_list), `broadcast_tx_commit`
- Auth: Treasury account private key for funding (env var, consumer-provided)

**Google OAuth 2.0:**
- Auth URL: `https://accounts.google.com/o/oauth2/v2/auth`
- Token URL: `https://oauth2.googleapis.com/token`
- Profile URL: `https://www.googleapis.com/oauth2/v2/userinfo`
- Scopes: `openid email profile`
- PKCE: S256 code challenge
- Implementation: `src/server/oauth/index.ts`
- Auth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (consumer-provided config)

**GitHub OAuth:**
- Auth URL: `https://github.com/login/oauth/authorize`
- Token URL: `https://github.com/login/oauth/access_token`
- Profile URL: `https://api.github.com/user`
- Email URL: `https://api.github.com/user/emails` (fallback for private emails)
- Scopes: `read:user user:email`
- Implementation: `src/server/oauth/index.ts`
- Auth: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (consumer-provided config)

**X (Twitter) OAuth 2.0:**
- Auth URL: `https://twitter.com/i/oauth2/authorize`
- Token URL: `https://api.twitter.com/2/oauth2/token`
- Profile URL: `https://api.twitter.com/2/users/me?user.fields=profile_image_url`
- Scopes: `tweet.read users.read offline.access`
- PKCE: S256 code challenge
- Token exchange uses HTTP Basic auth
- Implementation: `src/server/oauth/index.ts`
- Auth: `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` (consumer-provided config)

## IPFS Pinning Services

**Pinata:**
- Endpoint: `https://api.pinata.cloud/pinning/pinFileToIPFS`
- Auth: `pinata_api_key` + `pinata_secret_api_key` headers
- Implementation: `src/server/recovery/ipfs.ts` (`pinToPinata`)

**web3.storage:**
- Endpoint: `https://api.web3.storage/upload`
- Auth: Bearer token
- Implementation: `src/server/recovery/ipfs.ts` (`pinToWeb3Storage`)

**Infura IPFS:**
- Endpoint: `https://ipfs.infura.io:5001/api/v0/add`
- Auth: HTTP Basic (projectId:projectSecret)
- Implementation: `src/server/recovery/ipfs.ts` (`pinToInfura`)

**IPFS Gateways (read-only, no auth):**
- `https://gateway.pinata.cloud/ipfs/{cid}`
- `https://w3s.link/ipfs/{cid}`
- `https://ipfs.infura.io/ipfs/{cid}`
- `https://ipfs.io/ipfs/{cid}`
- `https://cloudflare-ipfs.com/ipfs/{cid}`
- `https://dweb.link/ipfs/{cid}`
- Tries all gateways sequentially on failure
- Implementation: `src/server/recovery/ipfs.ts` (`fetchFromIPFS`)

**Custom Pinning:**
- Consumers can provide `customPin` and `customFetch` functions
- Configured via `RecoveryConfig.ipfs` in `src/types/index.ts`

## Data Storage

**Databases:**
- PostgreSQL (built-in adapter)
  - Connection: `connectionString` provided in config (consumer manages)
  - Client: `pg` package (dynamically imported)
  - Adapter: `src/server/db/adapters/postgres.ts`
  - Schema: 7 tables (`anon_users`, `oauth_users`, `oauth_providers`, `anon_passkeys`, `anon_sessions`, `anon_challenges`, `anon_recovery`)
  - Schema auto-creates via `CREATE TABLE IF NOT EXISTS`
- Custom adapter support via `DatabaseAdapter` interface in `src/types/index.ts`
- SQLite listed in `DatabaseConfig.type` but no adapter implemented

**File Storage:**
- IPFS only (for encrypted recovery backups)
- No local filesystem storage

**Caching:**
- In-memory `Map` for OAuth state storage (`src/server/oauth/index.ts`)
- No external cache service

## Authentication & Identity

**WebAuthn / Passkeys:**
- Server-side verification via `@simplewebauthn/server`
- Implementation: `src/server/webauthn.ts`, `src/server/passkey.ts`
- Client-side: `src/client/passkey.ts` (browser WebAuthn API)
- Challenge-response stored in database

**Session Management:**
- HttpOnly cookie-based (`anon_session` cookie name)
- HMAC-SHA256 signed session IDs
- Server-side session storage in database
- 7-day default duration with sliding window refresh
- Implementation: `src/server/session.ts`

**OAuth Providers:**
- Google, GitHub, X (Twitter) - all optional
- PKCE flow for Google and Twitter
- State parameter with 10-minute expiry
- In-memory state store (not distributed)
- Implementation: `src/server/oauth/index.ts`, `src/server/oauth/router.ts`

**NEAR Wallet Recovery:**
- Ed25519 signature verification via `tweetnacl`
- On-chain access key verification via NEAR RPC
- Implementation: `src/server/recovery/wallet.ts`

## Monitoring & Observability

**Error Tracking:**
- None (no external error tracking service)

**Logs:**
- `console.log` / `console.warn` / `console.error` throughout
- Prefixed with module tags: `[MPC]`, `[IPFS]`, `[WalletRecovery]`

## CI/CD & Deployment

**Hosting:**
- npm registry (`@vitalpoint/near-phantom-auth`)
- Published with `npm publish --access public --provenance`

**CI Pipeline:**
- GitHub Actions
  - `.github/workflows/ci.yml` - Build + typecheck on push/PR to main
  - `.github/workflows/publish.yml` - Publish to npm on version tags

## Environment Configuration

**Required by consuming application (not this library directly):**
- `SESSION_SECRET` - For signing session cookies
- `DATABASE_URL` - PostgreSQL connection string (if using postgres adapter)
- `NODE_ENV` - Controls cookie secure flag

**Optional OAuth vars (consumer-provided via config):**
- Google: clientId, clientSecret
- GitHub: clientId, clientSecret
- Twitter: clientId, clientSecret
- OAuth callback base URL

**Optional NEAR vars (consumer-provided via config):**
- `nearNetwork` - 'testnet' or 'mainnet'
- Treasury account + private key (for auto-funding new accounts)
- Funding amount (default: 0.01 NEAR)

**Optional IPFS vars (consumer-provided via config):**
- Pinning service API keys (Pinata, web3.storage, or Infura)

**Secrets location:**
- No `.env` file in this repo (library, not application)
- All secrets passed via config object by the consuming application

## Webhooks & Callbacks

**Incoming:**
- OAuth callback endpoints handled by `src/server/oauth/router.ts`
- Callback URL pattern: `{callbackBaseUrl}/{provider}` (e.g., `/auth/callback/google`)

**Outgoing:**
- None

## Network Dependencies Summary

All external network calls use the native `fetch` API (no axios/got). Services called:

| Service | Protocol | Auth Method | File |
|---|---|---|---|
| NEAR RPC | JSON-RPC over HTTPS | None (public) | `src/server/mpc.ts`, `src/server/recovery/wallet.ts` |
| NEAR Testnet Helper | REST | None | `src/server/mpc.ts` |
| Google OAuth | REST | OAuth 2.0 + PKCE | `src/server/oauth/index.ts` |
| GitHub OAuth | REST | OAuth 2.0 | `src/server/oauth/index.ts` |
| Twitter OAuth | REST | OAuth 2.0 + PKCE + Basic | `src/server/oauth/index.ts` |
| Pinata | REST | API key headers | `src/server/recovery/ipfs.ts` |
| web3.storage | REST | Bearer token | `src/server/recovery/ipfs.ts` |
| Infura IPFS | REST | Basic auth | `src/server/recovery/ipfs.ts` |
| IPFS Gateways | HTTPS | None | `src/server/recovery/ipfs.ts` |

---

*Integration audit: 2026-03-14*
