# Roadmap: near-phantom-auth

## Milestones

- ✅ **v0.5.x Hardening** — Phases 1–8 (shipped 2026-03-14 to 2026-03-15; not formally closed at the time)
- ✅ **v0.6.0 PRF Extension** — Phase 9 (shipped 2026-03-15; deferred PRF browser-test items remain — see `STATE.md > Deferred Items`)
- ✅ **v0.6.1 MPCAccountManager hotfix** — Phase 10 (shipped 2026-04-29; published as `@vitalpoint/near-phantom-auth@0.6.1`) — see [milestones/v0.6.1-ROADMAP.md](milestones/v0.6.1-ROADMAP.md)

## Phases

<details>
<summary>✅ v0.5.x Hardening (Phases 1–8) — SHIPPED 2026-03-15</summary>

The initial hardening milestone (35 requirements covering input validation, CSRF, structured logging, rate limiting, OAuth state DB-backing, email integration, and test coverage). Phases were not formally closed via `/gsd-complete-milestone` at the time — they're archived alongside Phase 10 in `milestones/v0.6.1-ROADMAP.md` for historical traceability.

- [x] Phase 1: Atomic Security Fixes (3/3 plans) — completed 2026-03-14
- [x] Phase 2: Input Validation (2/2 plans) — completed 2026-03-14
- [x] Phase 3: Structured Logging (2/2 plans) — completed 2026-03-14
- [x] Phase 4: HTTP Defenses (3/3 plans) — completed 2026-03-14
- [x] Phase 5: DB Integrity and Functional Stubs (3/3 plans) — completed 2026-03-14
- [x] Phase 6: Scalability, Tech Debt, and Email (4/4 plans) — completed 2026-03-14
- [x] Phase 7: Test Coverage (4/4 plans) — completed 2026-03-15
- [x] Phase 8: Wire OAuth Callback to DB-Backed State Validation (1/1 plan) — completed 2026-03-15

</details>

<details>
<summary>✅ v0.6.0 PRF Extension (Phase 9) — SHIPPED 2026-03-15</summary>

WebAuthn PRF (Pseudo-Random Function) extension for DEK sealing key derivation. PRF-capable authenticators return a deterministic 32-byte sealing key per credential, hex-encoded as `sealingKeyHex` on `/register/finish` and `/login/finish`. Graceful degradation on Firefox / older authenticators; opt-in `requirePrf` enforcement available.

- [x] Phase 9: WebAuthn PRF Extension for DEK Sealing Key (3/3 plans) — completed 2026-03-15

**Deferred items at close:** 2 (cross-browser PRF testing on Firefox/Safari/hardware keys — needs physical devices). Tracked in `STATE.md > Deferred Items`.

</details>

<details>
<summary>✅ v0.6.1 MPCAccountManager hotfix (Phase 10) — SHIPPED 2026-04-29</summary>

Surgical hotfix for the v0.6.0 production bug where `MPCAccountManager` was `export type`-stripped to `undefined` at runtime, breaking the Ledgera mpc-sidecar consumer. Additive only: all v0.6.0 exports unchanged; 12 new MPC-* requirements (MPC-01 through MPC-12) closed.

- [x] Phase 10: MPCAccountManager (6/6 plans) — completed 2026-04-29

**Published:** `@vitalpoint/near-phantom-auth@0.6.1` to npm; git tag `v0.6.1` pushed to origin.

</details>

### 📋 v0.7.x (Planned)

No phases scheduled yet. Run `/gsd-new-milestone` to start the next milestone cycle.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Atomic Security Fixes | v0.5.x | 3/3 | Complete | 2026-03-14 |
| 2. Input Validation | v0.5.x | 2/2 | Complete | 2026-03-14 |
| 3. Structured Logging | v0.5.x | 2/2 | Complete | 2026-03-14 |
| 4. HTTP Defenses | v0.5.x | 3/3 | Complete | 2026-03-14 |
| 5. DB Integrity and Functional Stubs | v0.5.x | 3/3 | Complete | 2026-03-14 |
| 6. Scalability, Tech Debt, and Email | v0.5.x | 4/4 | Complete | 2026-03-14 |
| 7. Test Coverage | v0.5.x | 4/4 | Complete | 2026-03-15 |
| 8. Wire OAuth Callback DB State | v0.5.x | 1/1 | Complete | 2026-03-15 |
| 9. WebAuthn PRF Extension | v0.6.0 | 3/3 | Complete | 2026-03-15 |
| 10. MPCAccountManager | v0.6.1 | 6/6 | Complete | 2026-04-29 |
