---
gsd_state_version: 1.0
milestone: v0.5
milestone_name: milestone
status: completed
stopped_at: Completed 06-04-PLAN.md
last_updated: "2026-03-14T20:30:58.246Z"
last_activity: 2026-03-14 — Phase 02 Plan 02 complete — route validation wiring (SEC-05 satisfied)
progress:
  total_phases: 7
  completed_phases: 6
  total_plans: 17
  completed_plans: 17
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-14)

**Core value:** Every security-sensitive code path must be correct, tested, and production-safe
**Current focus:** Phase 2 — Input Validation

## Current Position

Phase: 2 of 7 (Input Validation)
Plan: 2 of 2 in current phase — COMPLETE
Status: Phase 02 complete — all POST routes validated with Zod schemas
Last activity: 2026-03-14 — Phase 02 Plan 02 complete — route validation wiring (SEC-05 satisfied)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: none yet
- Trend: -

*Updated after each plan completion*
| Phase 01 P01 | 6 | 2 tasks | 7 files |
| Phase 01 P02 | 3 | 2 tasks | 3 files |
| Phase 01 P03 | 4 | 2 tasks | 3 files |
| Phase 02 P02 | 7 | 2 tasks | 2 files |
| Phase 03-structured-logging P01 | 6 | 2 tasks | 14 files |
| Phase 03-structured-logging P02 | 6 | 2 tasks | 11 files |
| Phase 04-http-defenses P01 | 8 | 2 tasks | 9 files |
| Phase 04-http-defenses P02 | 5 | 2 tasks | 4 files |
| Phase 04-http-defenses P03 | 5 | 2 tasks | 4 files |
| Phase 05-db-integrity-and-functional-stubs P01 | 2 | 2 tasks | 3 files |
| Phase 05 P02 | 8 | 2 tasks | 1 files |
| Phase 05-db-integrity-and-functional-stubs P03 | 15 | 2 tasks | 3 files |
| Phase 06-scalability-tech-debt-and-email P02 | 3 | 2 tasks | 4 files |
| Phase 06-scalability-tech-debt-and-email P03 | 224 | 2 tasks | 5 files |
| Phase 06-scalability-tech-debt-and-email P01 | 7 | 2 tasks | 3 files |
| Phase 06-scalability-tech-debt-and-email P04 | 8 | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Init]: AWS SES for email delivery (Phase 6)
- [Init]: Compound codenames ALPHA-BRAVO-42 style (Phase 6)
- [Init]: Remove SQLite type instead of implementing adapter (Phase 6)
- [Init]: Skip auto-recovery for OAuth until email works — BUG-05 deferred to Phase 6 behind EMAIL-01
- [Init]: zod for runtime validation, no `.strict()` on WebAuthn response fields (Phase 2)
- [Phase 02 P01]: z.object({}).catchall(z.unknown()) replaces z.record(z.unknown()) for clientExtensionResults — Zod 4.3.6 bug: z.record(z.unknown()) throws TypeError when values are nested objects; catchall is semantically equivalent and works correctly
- [Phase 02 P01]: WebAuthn .passthrough() on both outer credential and inner response sub-object — confirmed correct approach in schemas.ts
- [Init]: Make new DatabaseAdapter methods optional with internal fallbacks to avoid hard breaking changes (Phase 5)
- [Phase 01]: it.todo() used for all test stubs — suite runs green with 0 failures, 16 todos, clean scaffolding for Plans 02 and 03
- [Phase 01]: warnedNoUpdateSessionExpiry is instance-scoped (inside createSessionManager closure), not module-level — prevents test isolation issues and is semantically correct since different manager instances are independent
- [Phase 01]: Length guard before timingSafeEqual is required — timingSafeEqual throws ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH on mismatched-length buffers, so truncated/extended signatures are rejected by length check before comparison
- [Phase 01 P03]: Static bs58 import replaces dynamic import; removes bs58.default accessor throughout mpc.ts
- [Phase 01 P03]: BN-based yoctoNEAR conversion: split decimal string, reconstruct integer, use BN for canonical form — honors locked BN decision while handling bn.js lack of decimal string support
- [Phase 01 P03]: derivationSalt absent produces identical seed 'implicit-{userId}' as original code for backward compatibility
- [Phase 02]: Empty-body POST routes use z.object({}) schema — rejects non-object bodies while accepting extra fields
- [Phase 02]: Auth-before-body ordering preserved in walletVerify, ipfsSetup, oauthLink — session check precedes validateBody call
- [Phase 03-01]: pino externalized in tsup.config.ts — library consumers provide their own pino instance; not bundled to avoid version conflicts
- [Phase 03-01]: No-op default is pino({ level: 'silent' }) — consumers who do not pass a logger see zero output, no console pollution
- [Phase 03-01]: Child loggers with module binding created in each factory — Plan 02 can use log.* directly without any plumbing changes
- [Phase 03-structured-logging]: fundAccountFromTreasury accepts log Logger parameter — standalone module-level functions needing logging receive logger from caller rather than a silent fallback
- [Phase 03-structured-logging]: webauthn.ts and wallet.ts use module-level pino silent loggers — standalone exported functions not created via factory use pino({ level: 'silent' }) with no consumer override path
- [Phase 04-http-defenses]: express-rate-limit, csrf-csrf, cookie-parser externalized in tsup.config.ts — middleware deps consumed by library users
- [Phase 04-http-defenses]: RateLimitConfig and CsrfConfig defined before implementation — Plans 02 and 03 can implement without any type/setup work
- [Phase 04-http-defenses]: Test stubs created with it.todo placeholders — suite runs green with 19 todos, clean scaffolding for Plans 02 and 03
- [Phase 04-http-defenses]: Separate limiter instances per router (router.ts vs oauth/router.ts) — independent per-IP counters; intentional isolation
- [Phase 04-http-defenses]: getCsrfTokenFromRequest replaces getTokenFromRequest; generateCsrfToken replaces generateToken; getSessionIdentifier uses req.ip (csrf-csrf v4 renamed API)
- [Phase 04-http-defenses]: skipCsrfProtection regex is ^\/[^/]+\/callback$ — req.path is relative to sub-router mount point
- [Phase 04-http-defenses]: INFRA-05 guard fires regardless of CSRF setting — consumer may disable CSRF but also forget cookie-parser
- [Phase 05]: Make new DatabaseAdapter methods optional with ? — no breaking changes for custom adapters that don't implement them
- [Phase 05]: buildClientAdapter() throws 'Not available in transaction context' for non-transactional methods — prevents silent query-outside-transaction bugs
- [Phase 05]: actionCreators destructuring for addKey/fullAccessKey — plan showed direct imports that don't exist; fixed to use actionCreators object which is the actual export from @near-js/transactions
- [Phase 05]: Treasury key cast to ed25519 template literal for KeyPair.fromString — KeyPairString type requires ed25519:X format; signing authority question deferred to testnet validation
- [Phase 05-db-integrity-and-functional-stubs]: walletVerifyBodySchema and walletFinishBodySchema: signature is a WalletSignature object (signature/publicKey/message), not a plain string — schema was mismatched to the WalletRecoveryManager interface
- [Phase 05-db-integrity-and-functional-stubs]: DELETE /account: destroySession before deleteUserSessions to invalidate auth cookie immediately; deleteRecoveryData is conditional on adapter support; returns 501 if deleteUser not implemented
- [Phase 06-02]: isValidCodename NATO pattern uses optional second word segment (?:-[A-Z]+)? — accepts both ALPHA-7 (legacy) and ALPHA-BRAVO-42 (new)
- [Phase 06-02]: Promise.any() with no AbortController in fetchFromIPFS — consumers needing timeouts use config.customFetch per PERF-02 spec
- [Phase 06-02]: createTestnetAccount deleted after zero call sites confirmed — testnet helper API was dead code
- [Phase 06-03]: EmailService is optional — absence means graceful skip with info log (BUG-05 satisfied)
- [Phase 06-03]: Email failure is isolated from registration — caught separately, logs warn, does not throw
- [Phase 06-03]: @aws-sdk/client-ses externalized in tsup — library consumers provide their own SES dependency
- [Phase 06-01]: OAuthStateRecord defined in types/index.ts to avoid circular imports — does not import from oauth/index.ts
- [Phase 06-01]: stateStore Map kept as fallback for custom adapters without DB state methods — no breaking changes
- [Phase 06-01]: mapOAuthUserRows() shared helper eliminates duplicated row-to-OAuthUser mapping across three getOAuthUser* methods
- [Phase 06-04]: createCleanupScheduler is standalone export, not embedded in AnonAuthInstance — composable pattern
- [Phase 06-04]: handle.unref() called immediately after setInterval — prevents timer from blocking process exit
- [Phase 06-04]: cleanExpiredChallenges and cleanExpiredOAuthStates optional-chained with ?? 0 — custom adapters without these methods still work

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase 5 (MPC signing):** Real borsh AddKey transaction serialization must be validated against NEAR testnet before Phase 5 ships. Capture a real AddKey transaction as a fixture.
- **Phase 5 (DB interface):** Decide before Phase 5 whether `DatabaseAdapter.transaction()` being optional (no-op fallback) is acceptable, or whether absent transaction support should be a hard runtime error.
- **Phase 6 (zod version):** RESOLVED — Zod 4.3.6 installed and confirmed stable latest as of 2026-03-14.

## Session Continuity

Last session: 2026-03-14T20:30:58.243Z
Stopped at: Completed 06-04-PLAN.md
Resume file: None
