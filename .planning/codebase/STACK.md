# Technology Stack

**Analysis Date:** 2026-03-14

## Languages

**Primary:**
- TypeScript 5.9.3 - All source code in `src/`

**Secondary:**
- SQL (PostgreSQL dialect) - Schema definitions in `src/server/db/adapters/postgres.ts`

## Runtime

**Environment:**
- Node.js >= 18.0.0 (specified in `package.json` engines field)
- CI runs on Node.js 20

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Express 4.x/5.x (optional peer dependency) - Server-side routing and middleware
- React 18.x/19.x (optional peer dependency) - Client-side hooks and providers

**Testing:**
- Vitest 4.0.18 - Test runner (configured via `npm run test`)

**Build/Dev:**
- tsup 8.5.1 - Bundler, configured in `tsup.config.ts`
- TypeScript 5.9.3 - Type checking via `tsc --noEmit`

## Package Architecture

This is an **npm library** (`@vitalpoint/near-phantom-auth`) published to npm with multiple entry points:

| Entry Point | Import Path | Source | Purpose |
|---|---|---|---|
| Main | `@vitalpoint/near-phantom-auth` | `src/index.ts` | Type re-exports |
| Server | `@vitalpoint/near-phantom-auth/server` | `src/server/index.ts` | Express middleware, auth logic |
| Client | `@vitalpoint/near-phantom-auth/client` | `src/client/index.ts` | React hooks, API client |
| WebAuthn | `@vitalpoint/near-phantom-auth/webauthn` | `src/webauthn/index.ts` | Standalone WebAuthn utilities |

All entry points ship as both ESM and CJS (`format: ['esm', 'cjs']` in `tsup.config.ts`).

## Key Dependencies

**Critical:**
- `@simplewebauthn/server` ^13.2.3 - WebAuthn/passkey registration and authentication verification
- `tweetnacl` ^1.0.3 - Ed25519 signature creation/verification for NEAR wallet operations
- `bs58` ^6.0.0 - Base58 encoding/decoding for NEAR public keys
- `cookie` ^1.1.1 - Cookie parsing for session management

**NEAR Protocol SDK (all ^2.5.1):**
- `@near-js/crypto` - Cryptographic primitives
- `@near-js/keystores` - Key storage abstractions
- `@near-js/providers` - RPC provider interfaces
- `@near-js/signers` - Transaction signing
- `@near-js/transactions` - Transaction building
- `@near-js/types` - Type definitions
- `@near-js/utils` - Utility functions

**Peer Dependencies (optional):**
- `express` ^4.18.0 || ^5.0.0 - Required only for server entry point
- `react` ^18.0.0 || ^19.0.0 - Required only for client entry point

**Externalized in Bundle:**
- `express`, `react`, `pg` are marked external in `tsup.config.ts`
- `pg` (PostgreSQL client) is dynamically imported at runtime in `src/server/db/adapters/postgres.ts`

## TypeScript Configuration

**Key settings from `tsconfig.json`:**
- Target: ES2022
- Module: ESNext with bundler resolution
- JSX: react-jsx
- Strict mode: **disabled** (`strict: false`, `noImplicitAny: false`)
- Declaration files and source maps: enabled
- Lib: ES2022, DOM

## Build Configuration

**tsup settings from `tsup.config.ts`:**
- 4 entry points (index, server, client, webauthn)
- Dual format: ESM + CJS
- TypeScript declarations generated
- Tree-shaking enabled
- Source maps enabled
- No code splitting

## Scripts

```bash
npm run build          # tsup (production build)
npm run dev            # tsup --watch (development)
npm run test           # vitest
npm run lint           # eslint src/
npm run typecheck      # tsc --noEmit
```

## CI/CD

**GitHub Actions workflows:**
- `ci.yml` - Runs on push/PR to main: install, build, typecheck
- `publish.yml` - Triggered by version tags (`v*`): build and publish to npm with provenance

## Platform Requirements

**Development:**
- Node.js >= 18
- npm
- No database required for building/testing

**Production (consuming application):**
- Node.js >= 18
- PostgreSQL (if using built-in postgres adapter)
- `pg` npm package installed by consumer
- Express (if using server entry point)
- React (if using client entry point)

---

*Stack analysis: 2026-03-14*
