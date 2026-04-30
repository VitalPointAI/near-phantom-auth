# Phase 17: Pattern Map

## Files and Analogs

| Target | Role | Closest Analog | Pattern to Reuse |
|--------|------|----------------|------------------|
| `src/types/index.ts` | Public config contract | Existing `RateLimitConfig`, `CsrfConfig`, `AnonAuthConfig.awaitAnalytics` | Add additive optional config types near HTTP/session defense config; re-export through `/server` if needed. |
| `src/server/session.ts` | Central session metadata normalization | Existing `cookieOptions` and `createSession()` preprocessing | Normalize inputs inside `createSessionManager` before calling `db.createSession`; keep routers unchanged where possible. |
| `src/server/index.ts` | Factory threading | Existing `rateLimiting`, `csrf`, `hooks`, `awaitAnalytics` threading | Pass top-level `config.sessionMetadata` into the manager once at factory construction. |
| `src/__tests__/session.test.ts` | Unit behavior tests | Existing signature and refresh tests | Use `makeMockDb()` to inspect `CreateSessionInput` captured by `db.createSession`. |
| `src/__tests__/registration-auth.test.ts` or new `session-metadata.test.ts` | Route-level integration | Existing supertest + mocked manager harness | Assert createSession input omits raw metadata under hardened config. |
| `README.md` | Consumer-facing docs | Existing Privacy and Anonymity Audit | Update storage table and production checklist with concrete config snippets and policy caveats. |

## Implementation Constraints

- No database migration is needed because `anon_sessions.ip_address` and `anon_sessions.user_agent` already accept null.
- Avoid route-by-route policy logic. Policy belongs in `session.ts` so every session creation path is covered: passkey register, passkey login, wallet recovery, IPFS recovery, and OAuth callback.
- Preserve backwards compatibility by defaulting to `store` when `sessionMetadata` is absent.
- Prefer HMAC via Node `crypto.createHmac('sha256', config.secret)` over plain hash so low-entropy IPs cannot be cheaply dictionary-reversed without the session secret.

