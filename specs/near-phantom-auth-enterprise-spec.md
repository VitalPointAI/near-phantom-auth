# near-phantom-auth — Enterprise Identity Module Specification

**Target package:** `@vitalpoint/near-phantom-auth`
**Audience:** Package maintainer (you) + implementation agent
**Status:** Design spec for a new opt-in module
**Companion to:** the Provenance AI-spend-attribution spec (one consumer of this module; the module is product-agnostic)

---

## 0. Purpose

Add enterprise identity-binding capability to near-phantom-auth **without compromising the anonymous-first core that defines the package**. The new capability lets an organization bind an external IdP identity (Okta, Entra, PingFederate, Google Workspace, etc.) to a package-issued NEAR DID, and lifecycle-manage that binding via SCIM — so a deprovisioned employee loses DID access automatically.

This is delivered as an **opt-in module that is off by default**. A consumer who never enables it gets exactly today's behavior, byte for byte.

---

## 1. Guiding Constraints (do not violate)

These are the non-negotiables that protect what the package already is.

1. **The anonymous core is untouched and remains the default.** If `enterprise` config is absent, no new tables, routes, columns, or code paths activate. The anonymity audit in the current README must remain true verbatim for default installs.
2. **No PII leaks across tracks.** The package already separates anonymous (`anon_users`) from OAuth (`oauth_users`) with separate types. Enterprise identities are a **third track** (`enterprise_users` + binding table), and PII from it must never write into `anon_users` or its sessions. The existing cross-track isolation guarantee extends to three tracks.
3. **Anonymity is a per-deployment policy, not removed.** Enabling the enterprise module for one deployment must not weaken anonymity for anonymous users in the same or other deployments. The two tracks coexist.
4. **Additive, backward-compatible API.** No breaking changes to `createAnonAuth`, `useAnonAuth`, `createApiClient`, or existing routes. New surface is new exports / new config keys / new routes under a new prefix.
5. **Reusable primitives only; no product policy in the package.** The package owns the binding mechanism and SCIM lifecycle. It does **not** own role-to-permission mapping, audit-log formats, "disable anonymity in mode X" rules, or smartcard specifics — those live in the consuming application. (See §7 boundary.)
6. **The DID/MPC substrate is shared.** Enterprise users get the same NEAR MPC account treatment as other tracks; the binding maps an external `sub` to that DID. No second identity rail.

---

## 2. Scope: What Ships in the Package vs. Not

| Capability | In package (this module) | In consuming app |
|---|---|---|
| External-`sub` ↔ NEAR-DID binding table + API | ✅ Yes | — |
| SCIM 2.0 provisioning endpoint (`/Users`, `/Groups`) | ✅ Yes | — |
| Generic OIDC connector | ⚠️ Phase 2 (promote-later) | Prototype first |
| SAML connector | ⚠️ Phase 2 (promote-later) | Prototype first |
| Role → permission/scope mapping | ❌ No | ✅ Yes |
| Audit-log format & sink | ❌ No (emits events only) | ✅ Yes |
| "Anonymity disabled in Sovereign mode" policy | ❌ No | ✅ Yes |
| PIV/CAC smartcard specifics | ❌ No | ✅ Yes (via OIDC/SAML mapping) |

**Rationale for the phased OIDC/SAML:** SAML especially is a deep edge-case surface (IdP quirks, signature canonicalization, encrypted assertions). Owning it in the package means owning it for *every* consumer forever. Prove it in one application against a real Okta/Entra tenant, then promote the stabilized connector into the package as Phase 2.

---

## 3. Phase 1 — The Binding Layer (build now)

### 3.1 New track: `enterprise_users`

A third user track parallel to `anon_users` and `oauth_users`. Holds the enterprise identity and its binding to a NEAR DID.

```sql
-- New table. Only created when enterprise module is enabled.
CREATE TABLE enterprise_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  near_account_id TEXT NOT NULL,            -- the bound NEAR DID/account (same MPC treatment)
  external_idp    TEXT NOT NULL,            -- 'okta' | 'entra' | 'ping' | 'google-ws' | ...
  external_sub    TEXT NOT NULL,            -- stable IdP subject identifier
  external_attrs  JSONB,                    -- non-secret claims the org chooses to store (email, displayName, groups)
  scim_id         TEXT,                     -- SCIM resource id, if provisioned via SCIM
  status          TEXT NOT NULL DEFAULT 'active', -- 'active' | 'suspended' | 'deprovisioned'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_idp, external_sub)
);
CREATE INDEX idx_enterprise_near ON enterprise_users (near_account_id);
CREATE INDEX idx_enterprise_scim ON enterprise_users (scim_id);
```

Notes:
- `external_attrs` is deliberately a JSONB the *consumer* decides the contents of — the package does not mandate storing email/name. A privacy-conscious deployment can store only `external_sub`.
- This table is **never joined to `anon_users`**. Enforce in code and (optionally) with separate schemas.

### 3.2 Binding API (server)

New methods on the auth instance, available only when enterprise config is present:

```ts
// All return typed results; throw typed errors (BindingError subclasses).
auth.enterprise.linkIdentity({
  externalIdp: string,
  externalSub: string,
  externalAttrs?: Record<string, unknown>,
  // If nearAccountId omitted, a new MPC account is minted (same path as other tracks).
  nearAccountId?: string,
}): Promise<{ nearAccountId: string; enterpriseUserId: string; isNew: boolean }>;

auth.enterprise.unlinkIdentity({
  externalIdp: string, externalSub: string,
  // 'revoke' (default): mark deprovisioned, deny future sessions, keep record for audit.
  // 'delete': hard-delete the binding row.
  mode?: 'revoke' | 'delete',
}): Promise<{ ok: boolean }>;

auth.enterprise.resolveByExternalId(
  externalIdp: string, externalSub: string
): Promise<{ nearAccountId: string; status: string; enterpriseUserId: string } | null>;

auth.enterprise.resolveByNearAccount(
  nearAccountId: string
): Promise<{ externalIdp: string; externalSub: string; status: string } | null>;

auth.enterprise.setStatus({
  externalIdp: string, externalSub: string,
  status: 'active' | 'suspended' | 'deprovisioned',
}): Promise<{ ok: boolean }>;
```

**Critical behavior — deprovisioning actually denies access.** When status is `suspended` or `deprovisioned`, any existing session for that `near_account_id` on the enterprise track must be invalidated at next request and no new session may be issued. This is the single most important enterprise requirement: offboarding must sever access, not just stop future logins. Implement as a session-validity check that consults `enterprise_users.status`.

### 3.3 Session integration

- Enterprise-track sessions reuse the existing HttpOnly, Secure, SameSite=Strict cookie machinery — no new session model.
- Add a track discriminator to the session record (`track: 'anon' | 'oauth' | 'enterprise'`) so `requireAuth` can apply track-appropriate checks (the status check above for enterprise).
- `req.enterpriseUser` populated analogously to `req.anonUser`, exposing `nearAccountId`, `externalSub`, `status`, and chosen `externalAttrs` — never anonymous-track data.

### 3.4 PRF sealing key interplay

Enterprise users authenticating via IdP (not passkey) will **not** produce a WebAuthn PRF sealing key. Two supported patterns, consumer's choice via config:
- **`enterprise.passkeyStepUp: true`** — after IdP login, prompt the user to register/use a passkey bound to their enterprise account, yielding a PRF sealing key (best for deployments that want per-user encryption keys consistent with the anonymous track).
- **`enterprise.serverManagedDek: true`** — no PRF; the consuming app provisions the user's DEK from a server/enclave-held key hierarchy instead. (Provenance Mode C uses the enclave path.)
Document clearly that pure-IdP enterprise users without step-up do not get the authenticator-rooted DEK property that passkey users get.

### 3.5 Events (not audit logs)

The package **emits structured events**; it does not define the audit log. Consumers subscribe and write their own audit records in their own format.

```ts
auth.enterprise.on('identity.linked'   , (e) => { /* {externalIdp, externalSub, nearAccountId, ts} */ });
auth.enterprise.on('identity.unlinked' , (e) => { /* ... */ });
auth.enterprise.on('identity.status'   , (e) => { /* {..., from, to} */ });
auth.enterprise.on('scim.provisioned'  , (e) => { /* ... */ });
auth.enterprise.on('scim.deprovisioned', (e) => { /* ... */ });
```

Events carry no secrets and respect the existing pino-redaction approach.

---

## 4. Phase 1 — SCIM 2.0 Provisioning Endpoint (build now)

SCIM is what makes deprovisioning automatic: the IdP pushes user lifecycle changes to the package. This is stable, well-specified (RFC 7644), and universally required — a good fit for the package.

### 4.1 Mounting

```ts
const auth = createAnonAuth({
  /* ...existing... */
  enterprise: {
    scim: {
      enabled: true,
      // Bearer token the IdP presents; the package validates, does not issue.
      bearerToken: process.env.SCIM_BEARER_TOKEN!,
      // Optional: map SCIM attributes → external_attrs keys.
      attributeMapping: { userName: 'email', 'name.formatted': 'displayName' },
    },
  },
});

if (auth.scimRouter) app.use('/scim/v2', auth.scimRouter);
```

### 4.2 Endpoints (RFC 7644 subset, sufficient for Okta/Entra)

| Method | Route | Behavior |
|---|---|---|
| POST | `/scim/v2/Users` | Provision: `linkIdentity` + mint MPC account; returns SCIM User with `id`. |
| GET | `/scim/v2/Users/:id` | Return SCIM representation from `enterprise_users`. |
| GET | `/scim/v2/Users?filter=...` | Filter by `userName`/`externalId` (the subset Okta/Entra use). |
| PATCH | `/scim/v2/Users/:id` | Partial update; `active:false` → `setStatus('deprovisioned')` → **severs access**. |
| PUT | `/scim/v2/Users/:id` | Full replace. |
| DELETE | `/scim/v2/Users/:id` | `unlinkIdentity({mode:'revoke'})` by default. |
| GET/POST/PATCH | `/scim/v2/Groups` | Group lifecycle → maps to `external_attrs.groups`; group→role interpretation is the consumer's job. |
| GET | `/scim/v2/ServiceProviderConfig` | Advertise supported features. |

### 4.3 SCIM hardening

- **Auth:** validate the IdP's bearer token (constant-time compare) on every SCIM request; rate-limit per existing tiered limiter.
- **Idempotency:** provisioning the same `externalId` twice returns the existing resource, not a duplicate (the `UNIQUE(external_idp, external_sub)` constraint backs this).
- **Validation:** Zod schemas on all SCIM payloads, consistent with the package's existing "Zod on all endpoints" property.
- **`active:false` is the critical path** — it must reliably reach `setStatus` and invalidate sessions. Test this explicitly; it is the offboarding guarantee.

---

## 5. Phase 2 — Enterprise IdP Connectors (promote later)

Built and hardened in a consuming application first, then promoted into the package once stable.

### 5.1 Generic OIDC connector
Generalize the existing OAuth track from fixed providers (Google/GitHub/X) to **arbitrary OIDC issuers** via discovery (`.well-known/openid-configuration`), configurable scopes/claims, and PKCE. On successful login, call `linkIdentity` with `externalSub = id_token.sub`. This is a moderate extension of code the package already has.

### 5.2 SAML connector
The deeper one. SP-initiated and IdP-initiated SSO, signature validation, optional encrypted assertions, clock-skew tolerance, and the per-IdP quirk handling that makes SAML painful. **Do not build this in the package until it has run against at least one real Okta or Entra tenant in an application**, because the edge cases are not knowable from the spec alone.

### 5.3 PIV/CAC (government)
Smartcard auth reaches the package as OIDC/SAML from a government IdP that fronts the card (the common pattern). The package needs no card-specific code; the consuming app maps the resulting claims. Note this so no one tries to build PKCS#11 into the package.

---

## 6. Configuration Summary (additive)

```ts
createAnonAuth({
  /* ...all existing config unchanged... */
  enterprise: {                 // ← entire block optional; absent = today's behavior
    enabled: true,
    binding: { mintMpcIfMissing: true },
    passkeyStepUp: false,
    serverManagedDek: true,
    scim: {
      enabled: true,
      bearerToken: process.env.SCIM_BEARER_TOKEN!,
      attributeMapping: { /* SCIM → external_attrs */ },
    },
    // Phase 2 (once promoted):
    // oidc: { issuers: [{ id, discoveryUrl, clientId, clientSecret, scopes }] },
    // saml: { providers: [{ id, metadataUrl, ... }] },
  },
});
```

New exports:
```ts
import { createAnonAuth } from '@vitalpoint/near-phantom-auth/server'; // gains auth.enterprise, auth.scimRouter
// Phase 2 optional subpath to keep core bundle lean:
// import { createOidcConnector } from '@vitalpoint/near-phantom-auth/enterprise';
```

---

## 7. The Package / Application Boundary (restated for clarity)

**Package provides (mechanism):** binding table + API, SCIM lifecycle, session-status enforcement, events, NEAR MPC account minting, and (Phase 2) IdP connectors.

**Application provides (policy):** what groups/roles mean, which scopes they grant, the audit-log format and storage, whether anonymity is permitted in a given mode, smartcard/government specifics, and any UI. For Provenance specifically, the "anonymity disabled in Sovereign mode," role→dashboard-scope mapping, and audit format live in Provenance, consuming the package's events.

A useful test for any future addition: *if it would differ between two products both using this package, it is policy and belongs in the app; if it would be identical, it is mechanism and may belong in the package.*

---

## 8. Testing & Compliance Notes

- **Regression-protect the anonymous core:** a test asserting that with no `enterprise` config, no new tables/routes exist and the anonymity audit claims hold. This is the most important test in the module.
- **Deprovisioning test:** SCIM `active:false` (and `unlinkIdentity`) must invalidate live sessions, not merely block future logins. Assert an in-flight session dies.
- **Cross-track isolation test:** assert no enterprise PII can be read through any anonymous-track type or route.
- **Idempotent provisioning test:** double-provision yields one resource.
- **FIPS/compliance scope:** be aware that shipping SCIM + enterprise SSO pulls the package itself toward enterprise compliance expectations (SOC 2 control coverage, etc.). This is a maintainer obligation that grows with adoption; the opt-in/off-by-default design limits blast radius to deployments that enable it.

---

## 9. Suggested Build Order (package side)

1. **P1 — Binding layer:** `enterprise_users` table, `linkIdentity`/`unlinkIdentity`/`resolve*`/`setStatus`, session track discriminator + status enforcement, events. Behind `enterprise.enabled`.
2. **P2 — SCIM endpoint:** `auth.scimRouter`, RFC 7644 subset, bearer auth, idempotency, the `active:false` offboarding path.
3. **P3 — PRF/DEK interplay:** `passkeyStepUp` and `serverManagedDek` paths documented and tested.
4. **P4 — Docs:** README section presenting enterprise binding as opt-in, anonymity-preserving; update the anonymity audit to note the three-track model and that enterprise is off by default.
5. **P5 (later) — Promote OIDC connector** from the application once stable; **P6 (later) — SAML**, after real-tenant hardening.

Phases 1–2 give a consuming app everything needed for SSO-to-DID binding when paired with an application-side OIDC/SAML prototype.
