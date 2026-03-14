# Architecture

**Analysis Date:** 2026-03-14

## Pattern Overview

**Overall:** Multi-entry-point SDK library with Factory Pattern composition

**Key Characteristics:**
- Published npm package (`@vitalpoint/near-phantom-auth`) with 4 separate entry points: root, `/server`, `/client`, `/webauthn`
- Factory functions (`createAnonAuth`, `createPasskeyManager`, etc.) compose managers from a single config object
- Server-side uses Express middleware/router pattern; client-side uses React Context + Hooks
- Database adapter pattern allows pluggable storage backends
- Two distinct user tracks: anonymous (passkey-only, no PII) and standard (OAuth, has PII)

## Layers

**Types Layer:**
- Purpose: Shared type definitions used across server and client
- Location: `src/types/index.ts`
- Contains: All TypeScript interfaces, type aliases, and the `DatabaseAdapter` contract
- Depends on: Nothing
- Used by: Every other module

**Server Core Layer:**
- Purpose: Main SDK entry point that composes all server managers
- Location: `src/server/index.ts`
- Contains: `createAnonAuth()` factory, `AnonAuthInstance` interface
- Depends on: All server managers, database adapters
- Used by: Consuming Express applications

**Server Managers (Domain Logic):**
- Purpose: Encapsulate specific authentication concerns
- Location: `src/server/`
- Contains:
  - `src/server/session.ts` - Session lifecycle (create, verify, destroy, refresh)
  - `src/server/passkey.ts` - WebAuthn registration/authentication via `@simplewebauthn/server`
  - `src/server/mpc.ts` - NEAR MPC account creation and management
  - `src/server/codename.ts` - Anonymous codename generation (NATO/animal styles)
  - `src/server/webauthn.ts` - Standalone WebAuthn utilities (framework-agnostic, no DB dependency)
  - `src/server/oauth/index.ts` - OAuth provider manager (Google, GitHub, Twitter)
- Depends on: Types layer, `DatabaseAdapter` interface
- Used by: Router layer, middleware layer

**Server Recovery Layer:**
- Purpose: Account recovery mechanisms
- Location: `src/server/recovery/`
- Contains:
  - `src/server/recovery/wallet.ts` - NEAR wallet-based recovery (on-chain access keys)
  - `src/server/recovery/ipfs.ts` - IPFS + password-encrypted backup recovery
- Depends on: Types layer, crypto primitives
- Used by: Router layer

**Server Database Layer:**
- Purpose: Pluggable database adapters implementing `DatabaseAdapter` interface
- Location: `src/server/db/adapters/`
- Contains:
  - `src/server/db/adapters/postgres.ts` - PostgreSQL adapter using `pg` (dynamically imported)
- Depends on: Types layer (`DatabaseAdapter` interface)
- Used by: All server managers via dependency injection

**Server HTTP Layer (Router + Middleware):**
- Purpose: Express route handlers and auth middleware
- Location: `src/server/router.ts`, `src/server/middleware.ts`, `src/server/oauth/router.ts`
- Contains: Route definitions for registration, authentication, session, recovery, OAuth flows
- Depends on: All server managers
- Used by: Consuming Express applications (`app.use('/auth', auth.router)`)

**Client Layer:**
- Purpose: Browser-side SDK for consuming apps (React hooks + vanilla API client)
- Location: `src/client/`
- Contains:
  - `src/client/api.ts` - HTTP API client (framework-agnostic)
  - `src/client/passkey.ts` - Browser WebAuthn operations (navigator.credentials)
  - `src/client/hooks/useAnonAuth.tsx` - React Context/Hook for passkey auth
  - `src/client/hooks/useOAuth.tsx` - React Context/Hook for OAuth auth
- Depends on: Types layer, browser WebAuthn APIs
- Used by: Consuming React/browser applications

**WebAuthn Standalone Layer:**
- Purpose: Lightweight WebAuthn verification with no DB dependency (for Next.js API routes)
- Location: `src/webauthn/index.ts`
- Contains: Re-exports from `src/server/webauthn.ts`
- Depends on: Server webauthn module
- Used by: Consuming apps that manage their own sessions (e.g., Next.js)

## Data Flow

**Anonymous Registration Flow:**

1. Client calls `POST /register/start` - server generates codename + WebAuthn challenge, stores challenge in DB
2. Client creates passkey via `navigator.credentials.create()` using `src/client/passkey.ts`
3. Client calls `POST /register/finish` with credential response
4. Server verifies passkey via `@simplewebauthn/server` in `src/server/passkey.ts`
5. Server creates NEAR implicit account via MPC manager (`src/server/mpc.ts`)
6. Server creates user record in DB via `DatabaseAdapter.createUser()`
7. Server stores passkey credential in DB via `DatabaseAdapter.createPasskey()`
8. Server creates session, sets signed HttpOnly cookie via `src/server/session.ts`

**OAuth Registration/Login Flow:**

1. Client calls `GET /oauth/:provider/start` - server generates auth URL with PKCE + state
2. Server stores state/codeVerifier in cookies, returns auth URL
3. Client redirects to OAuth provider
4. On callback, client sends `POST /oauth/:provider/callback` with code + state
5. Server exchanges code for tokens, fetches user profile from provider API
6. Server checks for existing user by provider ID or email (auto-links if same email)
7. If new user: creates NEAR MPC account, stores OAuth user + provider in DB
8. Server creates session, sets signed HttpOnly cookie

**Passkey Authentication Flow:**

1. Client calls `POST /login/start` - server generates WebAuthn challenge
2. Client authenticates via `navigator.credentials.get()` using `src/client/passkey.ts`
3. Client calls `POST /login/finish` with assertion response
4. Server verifies assertion against stored credential, updates counter
5. Server creates session with signed HttpOnly cookie

**State Management:**
- Server: Sessions stored in database, referenced by HMAC-signed HttpOnly cookie (`anon_session`)
- Client (React): `useState` in Context providers (`AnonAuthProvider`, `OAuthProvider`)
- OAuth state: Temporary in-memory `Map` on server + HttpOnly cookies for PKCE code verifier

## Key Abstractions

**DatabaseAdapter:**
- Purpose: Contract for all database operations (users, passkeys, sessions, challenges, recovery)
- Definition: `src/types/index.ts` (interface `DatabaseAdapter`)
- Implementations: `src/server/db/adapters/postgres.ts`
- Pattern: Adapter/Strategy - allows custom implementations via `database.adapter` config

**Manager Interfaces:**
- Purpose: Encapsulate domain logic behind testable interfaces
- Examples:
  - `SessionManager` in `src/server/session.ts`
  - `PasskeyManager` in `src/server/passkey.ts`
  - `MPCAccountManager` in `src/server/mpc.ts`
  - `WalletRecoveryManager` in `src/server/recovery/wallet.ts`
  - `IPFSRecoveryManager` in `src/server/recovery/ipfs.ts`
  - `OAuthManager` in `src/server/oauth/index.ts`
- Pattern: Factory functions return interface implementations (closures over config + dependencies)

**AnonAuthInstance:**
- Purpose: Top-level API surface returned by `createAnonAuth()`
- Definition: `src/server/index.ts`
- Contains: Express routers, middleware, and all manager instances
- Pattern: Facade - single entry point composing all subsystems

**User Type Discriminated Union:**
- Purpose: Distinguish anonymous users (passkey, codename, no PII) from standard users (OAuth, email, PII)
- Definition: `src/types/index.ts` - `type User = AnonUser | OAuthUser`, discriminated by `type` field
- Pattern: Tagged union with `'anonymous'` and `'standard'` variants

## Entry Points

**Package Root (`src/index.ts`):**
- Location: `src/index.ts`
- Triggers: `import from '@vitalpoint/near-phantom-auth'`
- Responsibilities: Re-exports shared types only (no runtime code)

**Server Entry (`src/server/index.ts`):**
- Location: `src/server/index.ts`
- Triggers: `import { createAnonAuth } from '@vitalpoint/near-phantom-auth/server'`
- Responsibilities: Exports `createAnonAuth()` factory, all server types, standalone WebAuthn utilities, codename generator, Postgres adapter

**Client Entry (`src/client/index.ts`):**
- Location: `src/client/index.ts`
- Triggers: `import { useAnonAuth, AnonAuthProvider } from '@vitalpoint/near-phantom-auth/client'`
- Responsibilities: Exports React hooks (`useAnonAuth`, `useOAuth`, `useOAuthCallback`), providers, API client, passkey utilities

**WebAuthn Entry (`src/webauthn/index.ts`):**
- Location: `src/webauthn/index.ts`
- Triggers: `import { verifyRegistration } from '@vitalpoint/near-phantom-auth/webauthn'`
- Responsibilities: Lightweight re-export of standalone WebAuthn functions (no DB dependency)

## Error Handling

**Strategy:** Try/catch with console.error logging and JSON error responses

**Patterns:**
- All route handlers wrap logic in try/catch, return `{ error: string }` with appropriate HTTP status
- Server logs prefixed with component tags: `[AnonAuth]`, `[Passkey]`, `[MPC]`, `[OAuth]`, `[WalletRecovery]`, `[IPFS]`, `[WebAuthn]`
- Client hooks catch errors and store in `state.error`, exposing `clearError()` action
- No custom error classes - uses built-in `Error` with message strings
- Validation errors return 400, auth failures return 401, not found returns 404, internal errors return 500

## Cross-Cutting Concerns

**Logging:** `console.error` and `console.log` with component tag prefixes (e.g., `[AnonAuth]`, `[MPC]`). No structured logging framework.

**Validation:** Inline validation in route handlers. Password strength validation in `src/server/recovery/ipfs.ts`. Codename format validation in `src/server/codename.ts`. No schema validation library (e.g., zod).

**Authentication:** Dual-track:
- Anonymous: WebAuthn passkeys via `@simplewebauthn/server`, HttpOnly cookie sessions
- Standard: OAuth 2.0 + PKCE (Google, GitHub, Twitter), HttpOnly cookie sessions
- Sessions: HMAC-SHA256 signed session IDs in cookies, server-side session storage in DB
- Sliding window session refresh (extends at 50% lifetime)

**Security:**
- HttpOnly + Secure + SameSite=Strict cookies for sessions
- PKCE for OAuth flows (Google, Twitter)
- AES-256-GCM encryption for IPFS recovery backups with scrypt key derivation
- No private keys stored server-side - NEAR accounts use MPC (Chain Signatures)

---

*Architecture analysis: 2026-03-14*
