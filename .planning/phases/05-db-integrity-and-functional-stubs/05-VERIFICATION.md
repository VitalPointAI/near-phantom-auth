---
phase: 05-db-integrity-and-functional-stubs
verified: 2026-03-14T14:55:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
human_verification:
  - test: "Trigger registration failure mid-flow to confirm transaction rolls back"
    expected: "No user row or passkey row should exist in anon_users/anon_passkeys after a createPasskey failure"
    why_human: "Requires a live Postgres instance and injected error at createPasskey call"
  - test: "POST /account/reregister-passkey on an authenticated session returns 200 with challengeId + options"
    expected: "Response body contains { challengeId: string, options: { ... } }"
    why_human: "Requires running server with real session cookie; cannot verify response shape from static analysis"
  - test: "DELETE /account removes all rows and subsequent session cookie returns 401"
    expected: "After deletion, any authenticated request returns 401; DB has no rows for that userId"
    why_human: "Requires live Postgres and session state; deletion ordering correctness only provable at runtime"
  - test: "addRecoveryWallet returns a real txHash on testnet (not pending-*)"
    expected: "txHash matches [a-zA-Z0-9]{43,44} (base58 NEAR hash)"
    why_human: "Requires funded testnet account with treasury key having access to it; STATE.md flags treasury key signing authority as an open blocker"
---

# Phase 05: DB Integrity and Functional Stubs — Verification Report

**Phase Goal:** Database integrity (transaction wrapping, orphan prevention) and replace all functional stubs with real implementations
**Verified:** 2026-03-14T14:55:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DatabaseAdapter interface has optional transaction(), deleteUser(), deleteRecoveryData() methods | VERIFIED | `src/types/index.ts` lines 199-207: all three optional methods present with correct signatures |
| 2 | Postgres adapter implements transaction() using BEGIN/COMMIT/ROLLBACK with client-scoped adapter | VERIFIED | `src/server/db/adapters/postgres.ts` lines 784-799: full BEGIN/COMMIT/ROLLBACK with buildClientAdapter helper |
| 3 | Postgres adapter implements deleteUser() and deleteRecoveryData() with proper SQL | VERIFIED | lines 801-811: DELETE FROM anon_users and DELETE FROM anon_recovery with $1 param |
| 4 | Test scaffold exists with 14 it.todo() stubs covering all 5 requirements | VERIFIED | `src/__tests__/db-integrity.test.ts`: 14 stubs across INFRA-02, BUG-04, STUB-01, STUB-02, STUB-03 |
| 5 | addRecoveryWallet() builds a real AddKey transaction via @near-js/transactions and broadcasts via RPC | VERIFIED | `src/server/mpc.ts` lines 480-591: createTransaction + actionCreators.addKey + broadcast_tx_commit |
| 6 | addRecoveryWallet() returns a txHash that does not match /^pending-/ | VERIFIED | No "pending-" string found in mpc.ts; returns `submitResult.result?.transaction?.hash` |
| 7 | verifyRecoveryWallet() delegates to checkWalletAccess with specific public key | VERIFIED | `src/server/mpc.ts` lines 602-612: delegates entirely to checkWalletAccess(nearAccountId, recoveryWalletPublicKey, this.networkId) |
| 8 | Registration finish is wrapped in db.transaction() with sequential fallback | VERIFIED | `src/server/router.ts` lines 205-233: doRegistration function + db.transaction ? await db.transaction(doRegistration) : await doRegistration(db) |
| 9 | wallet/verify stores signature.publicKey in anon_recovery.reference | VERIFIED | `src/server/router.ts` lines 445, 452: addRecoveryWallet(user.nearAccountId, signature.publicKey) and reference: signature.publicKey |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types/index.ts` | Optional transaction?, deleteUser?, deleteRecoveryData? on DatabaseAdapter | VERIFIED | All three optional methods present at lines 199-207 |
| `src/server/db/adapters/postgres.ts` | Postgres implementations of all three new methods, buildClientAdapter helper | VERIFIED | buildClientAdapter at line 144, transaction at 784, deleteUser at 801, deleteRecoveryData at 808 |
| `src/__tests__/db-integrity.test.ts` | 14 it.todo() stubs covering all 5 requirements | VERIFIED | Exactly 14 stubs, organized by INFRA-02, BUG-04, STUB-01, STUB-02, STUB-03 |
| `src/server/mpc.ts` | Real addRecoveryWallet and fixed verifyRecoveryWallet | VERIFIED | @near-js/transactions actionCreators, KeyPairSigner, checkWalletAccess delegation all present |
| `src/server/router.ts` | Transaction-wrapped registration, wallet/verify fix, two new routes | VERIFIED | db.transaction conditional at line 231, signature.publicKey at 445+452, POST /account/reregister-passkey at 653, DELETE /account at 684 |
| `src/server/validation/schemas.ts` | WalletSignature object schema for walletVerify and walletFinish | VERIFIED | Both schemas declare signature as z.object({ signature, publicKey, message }) at lines 120-127 and 142-147 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/server/db/adapters/postgres.ts` | `src/types/index.ts` DatabaseAdapter | implements DatabaseAdapter interface; function return type is DatabaseAdapter | VERIFIED | createPostgresAdapter return type is DatabaseAdapter (line 127); all three new methods satisfy the interface |
| `src/server/router.ts:/register/finish` | DatabaseAdapter.transaction | db.transaction?.(doRegistration) fallback to doRegistration(db) | VERIFIED | Line 231-233: `db.transaction ? await db.transaction(doRegistration) : await doRegistration(db)` |
| `src/server/router.ts:/recovery/wallet/verify` | DatabaseAdapter.storeRecoveryData | stores signature.publicKey as reference | VERIFIED | Line 452: `reference: signature.publicKey` |
| `src/server/router.ts:DELETE /account` | DatabaseAdapter.deleteUser, deleteRecoveryData, deleteUserSessions | explicit ordered deletions (sessions -> recovery -> user) | VERIFIED | Lines 699-708: destroySession -> deleteUserSessions -> deleteRecoveryData? -> deleteUser |
| `src/server/mpc.ts:addRecoveryWallet` | @near-js/transactions | createTransaction, actionCreators.addKey, actionCreators.fullAccessKey | VERIFIED | Line 13: import { createTransaction, actionCreators }, line 538: const { addKey, fullAccessKey } = actionCreators |
| `src/server/mpc.ts:addRecoveryWallet` | @near-js/signers | KeyPairSigner.signTransaction | VERIFIED | Line 14: import { KeyPairSigner }, line 499+553: signer construction and signTransaction |
| `src/server/mpc.ts:verifyRecoveryWallet` | NEAR RPC via checkWalletAccess | view_access_key with specific public_key param | VERIFIED | Line 16: import { checkWalletAccess }, line 607: delegates to checkWalletAccess |

---

### Requirements Coverage

| Requirement | Description | Plans | Status | Evidence |
|-------------|-------------|-------|--------|----------|
| INFRA-02 | Registration flow wrapped in database transaction (no partial user creation) | 05-01, 05-03 | SATISFIED | DatabaseAdapter.transaction? in types; postgres implementation; router.ts doRegistration wrapped at line 231 |
| BUG-04 | verifyRecoveryWallet() checks specific wallet public key against access key list | 05-01, 05-02, 05-03 | SATISFIED | checkWalletAccess delegation in mpc.ts; signature.publicKey stored in reference; schema fixed to pass WalletSignature object |
| STUB-01 | addRecoveryWallet() implements real MPC signing for AddKey transaction | 05-01, 05-02 | SATISFIED | Full @near-js AddKey implementation in mpc.ts; no pending-* strings remain |
| STUB-02 | Passkey re-registration endpoint exists for post-recovery users | 05-01, 05-03 | SATISFIED | POST /account/reregister-passkey route at router.ts line 653; returns challengeId+options; 401 for unauthenticated |
| STUB-03 | Account deletion endpoint removes user and all associated data | 05-01, 05-03 | SATISFIED | DELETE /account route at router.ts line 684; deletion order: sessions -> recovery -> user; 401 if no session; 501 if deleteUser absent |

**Orphaned requirements check:** REQUIREMENTS.md traceability table maps only INFRA-02, BUG-04, STUB-01, STUB-02, STUB-03 to Phase 5. All five are claimed in plan frontmatter. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/__tests__/session.test.ts` | 101, 106+ | Cannot find name 'expect' (pre-existing TypeScript error) | Info | Pre-existing before Phase 5; does not affect vitest runtime; 0 test failures |

No anti-patterns found in any Phase 5 modified files (mpc.ts, router.ts, postgres.ts, types/index.ts, schemas.ts, db-integrity.test.ts).

---

### Compilation and Test Results

- `npx tsc --noEmit`: Only pre-existing errors in `session.test.ts` (missing `expect` import). No new errors introduced by Phase 5 files.
- `npx vitest run`: 92 passing, 14 todo (all in db-integrity.test.ts scaffold), 0 failures — matches SUMMARY claim exactly.
- Commits verified in git log: 765833e, 37d09e8, 1cce1ed, 29aeaf9, 2ba466b, ed4d3a1 — all present.

---

### Human Verification Required

The following items pass all automated checks but require runtime/human validation:

#### 1. Registration Transaction Rollback

**Test:** Connect to a running Postgres instance. Trigger the /register/finish route with a mock that causes createPasskey to throw after createUser succeeds.
**Expected:** No row in anon_users for the new userId; no row in anon_passkeys. Transaction rollback prevents orphaned user.
**Why human:** Requires live Postgres, injected failure, and DB state inspection — cannot verify atomicity from static analysis.

#### 2. POST /account/reregister-passkey Full Flow

**Test:** Authenticate via /register/finish, then POST to /account/reregister-passkey with the session cookie.
**Expected:** 200 response with `{ challengeId: string, options: { ... } }` containing WebAuthn credential creation options.
**Why human:** Response shape from passkeyManager.startRegistration depends on runtime WebAuthn library; static analysis confirms the route exists and calls startRegistration but cannot validate options structure.

#### 3. DELETE /account Data Cleanup

**Test:** Authenticate, create recovery data, then DELETE /account. Inspect anon_users, anon_sessions, anon_recovery, anon_passkeys tables.
**Expected:** All rows for that userId removed across all four tables. Subsequent requests with the same cookie return 401.
**Why human:** Requires live Postgres and session state to confirm cascade behavior and deletion ordering.

#### 4. addRecoveryWallet Real txHash on Testnet

**Test:** Call addRecoveryWallet with a funded testnet account and a real recovery public key.
**Expected:** Returns `{ success: true, txHash: "..." }` where txHash is a 43-44 char base58 NEAR transaction hash, not starting with "pending-".
**Why human:** STATE.md notes an open question about whether the treasury key has signing authority on user implicit accounts. The implementation is correct in structure; the key authority question can only be validated against live testnet.

---

### Phase Goal Assessment

The phase goal — "Database integrity (transaction wrapping, orphan prevention) and replace all functional stubs with real implementations" — is achieved:

- **Transaction wrapping:** DatabaseAdapter.transaction? is defined, fully implemented in postgres adapter, and wired into /register/finish with sequential fallback.
- **Orphan prevention:** deleteUser and deleteRecoveryData implemented with correct SQL; DELETE /account route enforces deletion order respecting the absence of FK cascades on sessions and recovery tables.
- **Stub replacement:** addRecoveryWallet now builds and broadcasts a real NEAR AddKey transaction via @near-js libraries. verifyRecoveryWallet delegates to checkWalletAccess for specific-key verification. POST /account/reregister-passkey and DELETE /account routes replace the two missing endpoints.
- **Supporting fix:** walletVerifyBodySchema and walletFinishBodySchema corrected from z.string() to WalletSignature object schema, unblocking the BUG-04 verification chain.

All five required requirement IDs (INFRA-02, BUG-04, STUB-01, STUB-02, STUB-03) are satisfied by codebase evidence.

---

_Verified: 2026-03-14T14:55:00Z_
_Verifier: Claude (gsd-verifier)_
