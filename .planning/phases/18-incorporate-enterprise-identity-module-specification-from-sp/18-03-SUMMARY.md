---
phase: 18-incorporate-enterprise-identity-module-specification-from-sp
plan: 03
subsystem: enterprise-binding
tags: [enterprise, binding, events, mpc, idempotency]
requirements_completed: [ENT-03]
completed: 2026-05-31
---

# Phase 18 Plan 03 Summary

Implemented the `auth.enterprise` binding API with typed errors, idempotent linking, optional MPC minting, and secret-free lifecycle events.

## Accomplishments

- Added `src/server/enterprise/errors.ts` with classified enterprise errors for disabled config, missing adapter support, conflicts, not-found identities, and deprovisioned access.
- Added `createEnterpriseBinding()` with `linkIdentity`, `unlinkIdentity`, `resolveByExternalId`, `resolveByNearAccount`, `setStatus`, and typed event subscription.
- Made binding idempotent by `(externalIdp, externalSub)` and ensured existing bindings do not mint duplicate MPC accounts.
- Added optional MPC account minting when enabled and no NEAR account exists.
- Emitted lifecycle events without bearer tokens, secrets, or raw credential material.

## Verification

- `npm test -- --run src/__tests__/enterprise-binding.test.ts` passed.
- Full `npm test -- --run` passed during final phase verification.
