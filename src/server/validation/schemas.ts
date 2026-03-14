/**
 * Zod Schemas for POST Route Bodies
 *
 * 13 named schemas covering all POST routes that accept a request body.
 * GET routes (/session, /oauth/providers, /oauth/:provider/start) have no body schema.
 *
 * IMPORTANT: WebAuthn credential response objects MUST use .passthrough() — never
 * .strict() — because browsers (Chrome extensions, password managers, Safari) may
 * add vendor-specific extension properties to the credential object. Using .strict()
 * would reject valid credentials from real users.
 *
 * SEC-05: All endpoint request bodies validated at runtime with zod schemas.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * POST /register/start
 * No request body — server generates tempUserId and codename internally.
 */
export const registerStartBodySchema = z.object({});

/**
 * POST /register/finish
 * WebAuthn RegistrationResponseJSON with challenge and user identifiers.
 *
 * The `response` credential object uses .passthrough() on both the outer object
 * and the inner `response` sub-object to allow vendor extension keys from browsers.
 */
export const registerFinishBodySchema = z.object({
  challengeId: z.string().min(1),
  tempUserId: z.string().min(1),
  codename: z.string().min(1),
  response: z
    .object({
      id: z.string().min(1),
      rawId: z.string().min(1),
      type: z.literal('public-key'),
      response: z
        .object({
          clientDataJSON: z.string().min(1),
          attestationObject: z.string().min(1),
        })
        .passthrough(), // allow transports, publicKeyAlgorithm, etc.
      // z.object({}).catchall(z.unknown()) is the correct Zod 4 pattern for
      // AuthenticationExtensionsClientOutputs — an object with arbitrary unknown keys.
      // z.record(z.unknown()) has a bug in Zod 4.3.6 when values are nested objects.
      clientExtensionResults: z.object({}).catchall(z.unknown()),
    })
    .passthrough(), // allow authenticatorAttachment and other vendor keys
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * POST /login/start
 * Codename is optional — login without codename does a global credential search.
 */
export const loginStartBodySchema = z.object({
  codename: z.string().min(1).optional(),
});

/**
 * POST /login/finish
 * WebAuthn AuthenticationResponseJSON with challenge.
 *
 * Both the outer credential object and inner `response` sub-object use .passthrough()
 * for the same reason as registerFinishBodySchema.
 */
export const loginFinishBodySchema = z.object({
  challengeId: z.string().min(1),
  response: z
    .object({
      id: z.string().min(1),
      rawId: z.string().min(1),
      type: z.literal('public-key'),
      response: z
        .object({
          clientDataJSON: z.string().min(1),
          authenticatorData: z.string().min(1),
          signature: z.string().min(1),
          userHandle: z.string().optional(),
        })
        .passthrough(), // allow vendor keys in inner response
      clientExtensionResults: z.object({}).catchall(z.unknown()),
    })
    .passthrough(), // allow authenticatorAttachment and other vendor keys
});

/**
 * POST /logout
 * No request body — session is destroyed via cookie.
 */
export const logoutBodySchema = z.object({});

// ---------------------------------------------------------------------------
// Wallet Recovery
// ---------------------------------------------------------------------------

/**
 * POST /recovery/wallet/link
 * No request body — session provides the authenticated user context.
 */
export const walletLinkBodySchema = z.object({});

/**
 * POST /recovery/wallet/verify
 * Wallet signature verification to complete linking.
 */
export const walletVerifyBodySchema = z.object({
  signature: z.string().min(1),
  challenge: z.string().min(1),
  walletAccountId: z.string().min(1),
});

/**
 * POST /recovery/wallet/start
 * No request body — server generates recovery challenge.
 */
export const walletStartBodySchema = z.object({});

/**
 * POST /recovery/wallet/finish
 * Wallet signature verification to complete recovery and create session.
 */
export const walletFinishBodySchema = z.object({
  signature: z.string().min(1),
  challenge: z.string().min(1),
  nearAccountId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// IPFS Recovery
// ---------------------------------------------------------------------------

/**
 * POST /recovery/ipfs/setup
 * Create encrypted backup on IPFS — password required.
 */
export const ipfsSetupBodySchema = z.object({
  password: z.string().min(1),
});

/**
 * POST /recovery/ipfs/recover
 * Recover using IPFS backup — CID and password both required.
 */
export const ipfsRecoverBodySchema = z.object({
  cid: z.string().min(1),
  password: z.string().min(1),
});

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/**
 * POST /oauth/:provider/callback
 * OAuth authorization code + CSRF state, both required.
 * Note: state is validated as a string here; comparison to the cookie value
 * is business logic in the route handler, not schema validation.
 */
export const oauthCallbackBodySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

/**
 * POST /oauth/:provider/link
 * Link an additional OAuth provider. `code` is required; `state` and
 * `codeVerifier` are optional (not all providers use PKCE or state in body).
 */
export const oauthLinkBodySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1).optional(),
  codeVerifier: z.string().min(1).optional(),
});
