---
phase: 06-scalability-tech-debt-and-email
plan: "03"
subsystem: email
tags: [email, aws-ses, oauth, recovery, bug-fix]
dependency_graph:
  requires: []
  provides: [email-service, recovery-email-delivery]
  affects: [src/server/oauth/router.ts, src/server/index.ts]
tech_stack:
  added: ["@aws-sdk/client-ses"]
  patterns: ["factory function with optional config", "best-effort email delivery", "graceful skip on missing service"]
key_files:
  created:
    - src/server/email.ts
  modified:
    - src/types/index.ts
    - tsup.config.ts
    - src/server/index.ts
    - src/server/oauth/router.ts
decisions:
  - "EmailService is optional — absence means graceful skip with info log (BUG-05 satisfied)"
  - "Email failure is isolated from registration — caught separately, logs warn, does not throw"
  - "@aws-sdk/client-ses externalized in tsup — library consumers provide their own SES dependency"
  - "accessKeyId optional — omitting falls back to AWS instance profile / environment credentials"
metrics:
  duration_seconds: 224
  completed_date: "2026-03-14"
  tasks_completed: 2
  files_created: 1
  files_modified: 4
---

# Phase 6 Plan 3: Email Service (AWS SES Recovery Password Delivery) Summary

**One-liner:** AWS SES email service wired into OAuth registration flow to deliver recovery passwords, with graceful skip when unconfigured (BUG-05 resolved).

## What Was Built

Added an optional AWS SES email service that delivers recovery passwords to OAuth users after IPFS backup creation. When `email` config is absent from `AnonAuthConfig`, the backup is still created but the email step is silently skipped — satisfying BUG-05's requirement for graceful skip behavior.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create email service, add config types, externalize SES | cd88aa2 | src/server/email.ts, src/types/index.ts, tsup.config.ts, package.json |
| 2 | Wire email service into createAnonAuth and OAuth router | f41dd2b | src/server/index.ts, src/server/oauth/router.ts |

## Key Changes

**src/server/email.ts (new)**
- `EmailConfig` interface: region, accessKeyId?, secretAccessKey?, fromAddress
- `EmailService` interface: `sendRecoveryPassword(toEmail, recoveryPassword): Promise<void>`
- `createEmailService` factory: constructs SESClient with optional explicit credentials, returns EmailService implementation that sends formatted recovery email

**src/types/index.ts**
- Added optional `email` field to `AnonAuthConfig` with inline type matching `EmailConfig`

**tsup.config.ts**
- Added `@aws-sdk/client-ses` to the external array — consumers provide their own AWS SDK

**src/server/index.ts**
- Import `createEmailService` and `EmailService` from `./email.js`
- Conditionally create `emailService` when `config.email` is present
- Pass `emailService` to `createOAuthRouter`

**src/server/oauth/router.ts**
- Import `EmailService` from `../email.js`
- Add `emailService?: EmailService` to `OAuthRouterConfig`
- Destructure `emailService` from config
- Replace TODO with `sendRecoveryPassword` call after IPFS backup creation
- Email failure caught separately — logs warn, does not fail registration or backup

## Deviations from Plan

None — plan executed exactly as written. Pre-existing TypeScript errors in `session.test.ts` (vitest globals not imported) are unrelated to this plan and were present before execution.

## Verification Results

- `npx tsc --noEmit`: No new errors (pre-existing session.test.ts errors excluded — unrelated)
- `npx vitest run`: 92 tests pass, 14 todo, 0 failures
- `grep -c "TODO.*email" src/server/oauth/router.ts`: 0 (TODO removed)
- `grep "@aws-sdk/client-ses" tsup.config.ts`: present in external array
- `grep "emailService" src/server/index.ts`: emailService created and passed to createOAuthRouter

## Requirements Satisfied

- **EMAIL-01**: EmailService created with AWS SES, wired into config
- **EMAIL-02**: Recovery password sent to user email after IPFS backup creation
- **BUG-05**: Missing EmailService = graceful skip with info log; email failure does not break registration

## Self-Check: PASSED

- src/server/email.ts: FOUND
- src/types/index.ts email field: FOUND
- tsup.config.ts @aws-sdk/client-ses: FOUND
- src/server/index.ts emailService: FOUND
- src/server/oauth/router.ts emailService: FOUND
- Commits cd88aa2, f41dd2b: verified via git log
