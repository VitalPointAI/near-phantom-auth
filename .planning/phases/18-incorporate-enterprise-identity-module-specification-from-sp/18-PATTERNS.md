# Phase 18: Pattern Map

## Files and Analogs

| Target | Role | Closest Analog | Pattern to Reuse |
|--------|------|----------------|------------------|
| `src/types/index.ts` | Public config/types | `AnonAuthConfig.hooks`, `SessionMetadataConfig`, `DatabaseAdapter` optional methods | Add optional enterprise config and additive public types; keep new adapter methods optional where possible for backwards compatibility. |
| `src/server/index.ts` | Factory and exports | Existing optional OAuth/router construction | Build enterprise service and SCIM router only when `config.enterprise?.enabled === true`; return optional instance fields. |
| `src/server/db/adapters/postgres.ts` | Postgres persistence | `POSTGRES_SCHEMA`, OAuth user CRUD, `transaction` client adapter | Add a separate `POSTGRES_ENTERPRISE_SCHEMA` and `initializeEnterprise()` so default `initialize()` creates no enterprise tables. |
| `src/server/enterprise/index.ts` | Enterprise binding service | `src/server/oauth/index.ts`, `src/server/analytics.ts` wrapper shape | Encapsulate link/unlink/resolve/status methods and typed event emitter away from routers. |
| `src/server/session.ts` | Session creation/retrieval | `sessionMetadata` default-preserving central normalization | Add optional `track` to createSession input; default to `anonymous`. |
| `src/server/middleware.ts` | Auth enforcement | Existing `createAuthMiddleware` and `createRequireAuth` | Branch by `session.track`; enterprise branch loads enterprise user and rejects non-active statuses. |
| `src/server/enterprise/scim.ts` | SCIM router | `src/server/router.ts`, `src/server/oauth/router.ts`, `validateBody` | Express router with `json()`, rate limiter, bearer auth middleware, Zod schemas, and response helpers. |
| `src/server/validation/schemas.ts` | Runtime request validation | Existing POST body schemas with Zod | Add SCIM body schemas or keep SCIM-local schemas if they are not shared outside the router. |
| `src/__tests__/*.test.ts` | Verification | `hooks-scaffolding.test.ts`, `session.test.ts`, `analytics-pii-snapshot.test.ts`, route tests | Use Vitest, supertest where routers are involved, and source grep guards for default-off/docs invariants. |
| `README.md`, `CHANGELOG.md` | Consumer docs | v0.7.0 hooks and privacy audit sections | Add opt-in enterprise section, three-track anonymity audit, SCIM setup, and PRF/DEK interplay. |

## Implementation Constraints

- Do not append enterprise DDL to `POSTGRES_SCHEMA`; default installs must not create enterprise tables.
- Avoid adding enterprise fields to `AnalyticsEvent`; enterprise events are a separate opt-in surface.
- Avoid role/permission mapping in package code. SCIM groups may be stored as attributes only.
- Avoid OIDC/SAML connector implementation in Phase 18.
- Existing `createAnonAuth`, passkey routes, OAuth routes, and client hooks remain backwards compatible.
- Any new session `track` field must default to `anonymous` for existing custom adapters and old rows.

## Suggested New Files

- `src/server/enterprise/index.ts` - enterprise service and event emitter.
- `src/server/enterprise/scim.ts` - SCIM router.
- `src/server/enterprise/errors.ts` - typed `BindingError` subclasses, if keeping errors separate improves readability.
- `src/__tests__/enterprise-config.test.ts`
- `src/__tests__/enterprise-binding.test.ts`
- `src/__tests__/enterprise-session.test.ts`
- `src/__tests__/scim-users.test.ts`
- `src/__tests__/scim-groups.test.ts`
- `src/__tests__/enterprise-anonymity.test.ts`
- `src/__tests__/enterprise-docs.test.ts`

