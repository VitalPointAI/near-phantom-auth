---
phase: 18
slug: incorporate-enterprise-identity-module-specification-from-sp
status: complete
created: 2026-05-31
source_spec: specs/near-phantom-auth-enterprise-spec.md
---

# Phase 18 Research: Enterprise Identity Module

## Research Complete

Phase 18 incorporates `specs/near-phantom-auth-enterprise-spec.md` as an opt-in enterprise identity module for `@vitalpoint/near-phantom-auth`. The module binds external IdP subjects to NEAR DID/MPC accounts, exposes SCIM 2.0 lifecycle endpoints, and preserves the anonymous-first default behavior.

## Source Scope

Canonical source:
- `specs/near-phantom-auth-enterprise-spec.md`

Build-now package scope from the spec:
- `enterprise_users` third track, separate from `anon_users` and `oauth_users`
- Binding API: `linkIdentity`, `unlinkIdentity`, `resolveByExternalId`, `resolveByNearAccount`, `setStatus`
- Enterprise events: `identity.linked`, `identity.unlinked`, `identity.status`, `scim.provisioned`, `scim.deprovisioned`
- Session track discriminator and enterprise status enforcement
- SCIM 2.0 Users, Groups, and ServiceProviderConfig subset
- PRF/DEK interplay configuration and docs: `enterprise.passkeyStepUp`, `enterprise.serverManagedDek`
- README/anonymity audit updates

Deferred from the spec:
- Generic OIDC connector promotion
- SAML connector promotion
- Product-specific role-to-permission mapping
- Audit-log sink/format
- PIV/CAC smartcard-specific code
- Product policy such as "disable anonymity in Sovereign mode"

## Current Codebase Findings

### Factory and configuration

`src/server/index.ts` is the central factory. It builds the database adapter, session manager, passkey manager, MPC manager, optional recovery managers, optional OAuth manager/router, middleware, and passkey router. Optional features are already threaded through additive top-level config keys such as `oauth`, `hooks`, `awaitAnalytics`, `sessionMetadata`, `rateLimiting`, and `csrf`.

The right pattern for enterprise is:
- Add `AnonAuthConfig.enterprise?` as a fully optional block.
- Construct enterprise services only when `enterprise?.enabled === true`.
- Return `enterprise` and `scimRouter` only when enabled/configured.
- Keep default `createAnonAuth(configWithoutEnterprise)` behavior byte-compatible at construction time and route time.

### Database adapter

`src/types/index.ts` defines `DatabaseAdapter`. Several methods are optional for backwards compatibility: `transaction`, `deleteUser`, `deleteRecoveryData`, OAuth state cleanup, `updatePasskeyBackedUp`, and session expiry. This is the precedent for enterprise adapter methods: keep new enterprise methods optional at the type level where possible, but the enterprise module must fail with a classified runtime error when enabled against an adapter that does not implement the required enterprise methods.

`src/server/db/adapters/postgres.ts` currently exports one `POSTGRES_SCHEMA` string and `initialize()` always runs it. The spec says enterprise tables must not be created when enterprise config is absent. Therefore the plan should not append `enterprise_users` to `POSTGRES_SCHEMA`. Instead:
- Add a separate `POSTGRES_ENTERPRISE_SCHEMA` string.
- Add optional `initializeEnterprise?()` on the adapter and call it from `auth.initialize()` only when enterprise is enabled.
- Keep `POSTGRES_SCHEMA` unchanged so default install creates no enterprise tables.

The existing `anon_sessions` table already has `user_type TEXT NOT NULL DEFAULT 'anonymous'`, but runtime `Session` and `CreateSessionInput` do not expose a track. Enterprise should formalize this as `SessionTrack = 'anonymous' | 'oauth' | 'enterprise'`, thread it through `createSession()`, and keep default `anonymous` behavior when absent.

### Sessions and middleware

`src/server/session.ts` signs an `anon_session` cookie, stores server-side sessions, and delegates row persistence to `db.createSession`. It is the right place to set default `track: 'anonymous'` and preserve cookie behavior.

`src/server/middleware.ts` currently assumes every valid session maps to `db.getUserById(session.userId)`, and attaches `req.anonUser` / `req.anonSession`. Enterprise requires a track-aware branch:
- anonymous: load `db.getUserById`, attach `req.anonUser`
- oauth: load `db.getOAuthUserById`, but avoid expanding old behavior unless needed
- enterprise: load `db.getEnterpriseUserById`, reject/deletes session when status is `suspended` or `deprovisioned`, attach `req.enterpriseUser`

Critical offboarding behavior belongs here and in `requireAuth`, not only in SCIM. A live enterprise session must die at the next protected request after status changes.

### Routers and validation

`src/server/router.ts` and `src/server/oauth/router.ts` use:
- Express `Router`
- `json()`
- `express-rate-limit`
- optional CSRF with `doubleCsrf`
- Zod schemas in `src/server/validation/schemas.ts`
- `validateBody()` for request validation

SCIM should mirror this local pattern:
- `src/server/enterprise/scim.ts` or `src/server/scim.ts` creates a router.
- Mount JSON parsing inside the SCIM router.
- Use Zod schemas for every mutating body.
- Use constant-time bearer token comparison.
- Use existing `RateLimitConfig.auth` defaults unless a nested enterprise SCIM rate limit is added later.

### Analytics and events

`src/server/analytics.ts` defines a bounded event union and a safe wrapper for consumer hooks. Enterprise events are not analytics events because they intentionally include enterprise identifiers. They should live in a separate enterprise event emitter surface that is only constructed when enterprise is enabled.

Use Node's `EventEmitter` or a tiny typed wrapper, but keep event payloads secret-free:
- OK: `externalIdp`, `externalSub`, `nearAccountId`, timestamp, status transition
- Avoid: bearer token, raw request body, internal errors, session cookie, passkey material

### MPC account creation

`MPCAccountManager.createAccount(tempUserId)` is already used by passkey and OAuth flows. Enterprise binding should reuse it when `nearAccountId` is omitted and `enterprise.binding.mintMpcIfMissing !== false`. If a caller supplies `nearAccountId`, binding must not mint.

The binding API should not introduce a second identity rail. It maps external subject to the same `nearAccountId` model used by other tracks.

## Key Design Decisions for Planning

1. Enterprise is strictly opt-in. No enterprise routes, services, table initialization, middleware branches with database calls, or request-visible behavior activate when `enterprise` config is absent or disabled.
2. Enterprise persistence is a third track. `enterprise_users` is never joined to `anon_users`. Tests must prove anonymous routes cannot read enterprise attributes.
3. Enterprise table creation is conditional. Keep `POSTGRES_SCHEMA` unchanged and add `initializeEnterprise()` invoked only from `AnonAuthInstance.initialize()` when enabled.
4. Session track is additive. Existing sessions default to `anonymous`; enterprise sessions must set `track: 'enterprise'`.
5. Offboarding enforcement is request-time. `setStatus('suspended' | 'deprovisioned')` and SCIM `active:false` must delete enterprise sessions and make any stale cookie fail on the next protected request.
6. SCIM authentication is mandatory. Every SCIM request must validate the configured bearer token with constant-time comparison before hitting business logic.
7. SCIM idempotency is load-bearing. Duplicate create for the same external subject returns the existing resource.
8. Groups are mechanism only. SCIM groups may be stored in `externalAttrs.groups`; no role mapping belongs in the package.
9. PRF/DEK support is documented and typed, not a full SSO implementation in this phase. `passkeyStepUp` and `serverManagedDek` are config signals and documentation commitments.

## Validation Architecture

The phase needs Wave 0 tests before behavior implementation because several requirements are negative guarantees:
- default install does not initialize enterprise schema or expose `scimRouter`
- anonymous track cannot access enterprise attributes
- deprovisioned enterprise sessions are rejected/deleted
- SCIM `active:false` reaches the offboarding path
- bearer token is required for every SCIM endpoint

Recommended test files:
- `src/__tests__/enterprise-config.test.ts`
- `src/__tests__/enterprise-binding.test.ts`
- `src/__tests__/enterprise-session.test.ts`
- `src/__tests__/scim-users.test.ts`
- `src/__tests__/scim-groups.test.ts`
- `src/__tests__/enterprise-anonymity.test.ts`
- `src/__tests__/enterprise-docs.test.ts`

Each file should use existing Vitest patterns from `hooks-scaffolding.test.ts`, `session.test.ts`, and route tests under `src/__tests__`.

## Threat Model

### T-18-01: Default anonymity regression

Risk: Adding enterprise config, tables, middleware branches, or routes changes behavior for consumers who never enable enterprise.

Mitigations:
- `enterprise?` optional and disabled by default.
- `scimRouter` undefined unless enterprise SCIM is enabled.
- `initializeEnterprise()` only called from `initialize()` when enabled.
- Tests assert no enterprise schema string is present in `POSTGRES_SCHEMA`.

### T-18-02: Cross-track PII leakage

Risk: Enterprise PII in `externalAttrs` leaks into anonymous user/session types, analytics events, logs, or `/session`.

Mitigations:
- Separate `EnterpriseUser` type and `enterprise_users` table.
- `req.enterpriseUser` distinct from `req.anonUser`.
- No joins between `enterprise_users` and `anon_users`.
- No enterprise fields added to `AnalyticsEvent`.
- Redaction tests for logs and route responses.

### T-18-03: Offboarding is only advisory

Risk: SCIM `active:false` marks a row but live sessions continue.

Mitigations:
- `setStatus` deletes enterprise sessions.
- Middleware and `requireAuth` check enterprise status on every request.
- SCIM PATCH/DELETE tests assert a previously valid session becomes 401.

### T-18-04: SCIM bearer token leakage or bypass

Risk: A request without valid bearer reaches provisioning logic, or token comparison leaks timing.

Mitigations:
- Dedicated auth middleware first in SCIM router.
- `crypto.timingSafeEqual` with length-safe buffers.
- Tests for missing, wrong, and valid bearer.
- Logs never include token values.

### T-18-05: Duplicate provisioning creates duplicate accounts

Risk: IdP retry creates multiple enterprise rows and/or multiple MPC accounts.

Mitigations:
- Unique `(external_idp, external_sub)`.
- `linkIdentity` resolves existing binding before minting.
- SCIM POST duplicate returns existing SCIM resource.

## Suggested Plan Split

1. Foundation: enterprise config/types, adapter contract, exports, default-off regression tests.
2. Persistence: conditional Postgres enterprise schema and binding CRUD.
3. Binding service: `auth.enterprise` API, typed errors, event surface, MPC minting.
4. Session integration: track discriminator, enterprise session creation, middleware status enforcement.
5. SCIM Users: bearer auth, Users CRUD/filter/PATCH/DELETE, deprovisioning path.
6. SCIM Groups and ServiceProviderConfig: group lifecycle as attributes only.
7. Docs and release hardening: README, changelog, anonymity audit, test/typecheck/build.

