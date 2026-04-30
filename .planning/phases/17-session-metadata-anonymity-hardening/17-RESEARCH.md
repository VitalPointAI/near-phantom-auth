# Phase 17: Session Metadata Anonymity Hardening - Research

## Research Complete

### Problem Statement

The anonymous passkey track does not store email, phone, real name, OAuth provider identity, or authenticator attestation. The remaining linkability risk is operational session metadata:

- `anon_sessions.ip_address`
- `anon_sessions.user_agent`

These fields are optional at the TypeScript level and nullable in PostgreSQL, but every current session creation call passes `req.ip` and `req.headers['user-agent']`. With database access, an operator or attacker can correlate a random codename and NEAR account ID with session IP/user-agent history.

### Current Implementation Facts

- `src/types/index.ts` defines `Session.ipAddress?`, `Session.userAgent?`, `CreateSessionInput.ipAddress?`, and `CreateSessionInput.userAgent?`.
- `src/server/db/adapters/postgres.ts` already stores `ip_address` and `user_agent` as nullable fields via `input.ipAddress || null` and `input.userAgent || null`.
- `src/server/session.ts` centralizes session persistence in `createSessionManager().createSession()`.
- `src/server/router.ts` and `src/server/oauth/router.ts` pass raw `req.ip` and raw `user-agent` into `sessionManager.createSession()` at passkey register/login, wallet recovery, IPFS recovery, and OAuth callback success paths.
- README already documents the privacy tradeoff in "Privacy and Anonymity Audit" and "Session IP and User Agent", but it currently describes storage as always present when Express supplies values.

### Recommended Design

Add a central session metadata policy to `createSessionManager()` and `AnonAuthConfig`:

```ts
export type SessionMetadataIpPolicy = 'store' | 'omit' | 'hash' | 'truncate';
export type SessionMetadataUserAgentPolicy = 'store' | 'omit' | 'hash';

export interface SessionMetadataConfig {
  ipAddress?: SessionMetadataIpPolicy;
  userAgent?: SessionMetadataUserAgentPolicy;
}
```

Policy behavior:

- `store`: current behavior, preserves raw value.
- `omit`: stores `undefined`/`null`; no raw metadata persists.
- `hash`: stores deterministic HMAC-SHA-256 digest using the existing session secret as key. Value format should be prefixed, e.g. `hmac-sha256:<hex>`, so downstream operators know it is not raw data.
- `truncate`: IP-only; stores coarse IP prefix. IPv4 should become `/24` style by zeroing the last octet (e.g. `203.0.113.42` -> `203.0.113.0/24`). IPv6 should become `/48` style by preserving the first three hextets and zeroing the remainder. If parsing fails, fall back to `omit` rather than storing raw untrusted input.

Default behavior should remain `store` for backwards compatibility. Privacy-hardened consumers opt in:

```ts
createAnonAuth({
  // ...
  sessionMetadata: {
    ipAddress: 'omit',
    userAgent: 'omit',
  },
});
```

This is additive, avoids a schema migration, and gives consumers an explicit hardening knob for deployments that need stronger anonymity.

### Implementation Touchpoints

- `src/types/index.ts`: add policy types and `AnonAuthConfig.sessionMetadata?`.
- `src/server/session.ts`: add `metadata?: SessionMetadataConfig` to `SessionConfig`; normalize `options.ipAddress` and `options.userAgent` before `db.createSession()`.
- `src/server/index.ts`: pass `config.sessionMetadata` into `createSessionManager`.
- `src/__tests__/session.test.ts`: add unit coverage for `omit`, `hash`, `truncate`, malformed-IP fallback, and default `store`.
- `src/__tests__/registration-auth.test.ts` or a new focused test file: verify an auth flow configured with omission does not pass raw IP/user-agent into session persistence.
- `README.md`: update Production Checklist and Privacy and Anonymity Audit to document the new policy.

### Security Notes

- HMAC hashing is pseudonymous, not anonymous. A stable digest can still correlate repeated sessions from the same IP/user-agent. It protects against casual disclosure of raw values, not against correlation.
- Omission is the strongest privacy mode and should be recommended for the anonymous track.
- Truncation reduces precision but still stores network-level metadata; it is useful for abuse analytics but not for maximum anonymity.
- Do not emit raw IP/user-agent through analytics events. The existing `AnalyticsEvent` whitelist already forbids `ip` and `userAgent`; Phase 17 should preserve that invariant.
- Do not log normalized or raw session metadata.

### Validation Strategy

- Unit tests prove exact storage outcomes for each policy.
- Route-level tests prove raw Express request metadata does not reach session persistence when policy is `omit`.
- Existing analytics PII tests remain green.
- Full suite must remain green.

## RESEARCH COMPLETE
