// src/server/relatedOrigins.ts
//
// Single source of truth for the rp.relatedOrigins startup-config validator (RPID-02).
//
// Source: WebAuthn Level 3 §5.10.3 (Related Origin Requests),
//         passkeys.dev/docs/advanced/related-origins/,
//         web.dev/articles/webauthn-related-origin-requests.
//
// The library does NOT auto-host /.well-known/webauthn — consumer responsibility
// (see README "Cross-Domain Passkeys (v0.7.0)").

import type { RelatedOrigin } from '../types/index.js';

const MAX_RELATED_ORIGINS = 5;
const HTTPS_RE = /^https:\/\/[^*\s/?#]+(:[0-9]+)?$/;
const LOCALHOST_HTTP_RE = /^http:\/\/localhost(:[0-9]+)?$/;
// Hostname (no scheme, no path). Lowercase letters/digits/hyphens, label-segmented.
const RPID_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * Validate `rp.relatedOrigins` config at createAnonAuth() startup.
 *
 * Throws with a classified message on the FIRST failure encountered.
 *
 * Rules (RPID-02):
 *   1. Max 5 entries (browser ROR >= 5-label minimum; more entries silently
 *      ignored by Chrome/Safari).
 *   2. Each entry shape: `{ origin: string; rpId: string }`.
 *   3. No wildcards (`*`) in either field.
 *   4. Origin scheme: `https://...` OR (`http://localhost...` AND
 *      paired rpId === 'localhost'). Pitfall 3 — coupling, not independent.
 *   5. RP ID is a syntactically-valid host (no scheme, no path).
 *   6. Suffix-domain (Pitfall 2 boundary check): host(origin) === rpIdLower
 *      OR host(origin).endsWith('.' + rpIdLower). Boundary required so
 *      "notshopping.com" does NOT match rpId "shopping.com".
 *   7. Primary rp duplicates rejected (loud-fail, do NOT silent-dedupe).
 *
 * Returns a defensive shallow copy. Downstream callers (Plan 04 integration)
 * can iterate without fear of consumer-side mutation.
 *
 * No intermediate `.filter()` / `.sort()` is permitted between this call
 * and the spread at the verifyRegistrationResponse / verifyAuthenticationResponse
 * call sites — pairing intent is preserved by tuple ORDER (Pitfall 1).
 */
export function validateRelatedOrigins(
  entries: readonly RelatedOrigin[] | undefined,
  primaryRpId: string,
  primaryOrigin: string,
): RelatedOrigin[] {
  if (!entries || entries.length === 0) return [];
  if (entries.length > MAX_RELATED_ORIGINS) {
    throw new Error(
      `rp.relatedOrigins: max ${MAX_RELATED_ORIGINS} entries allowed (got ${entries.length}). ` +
      `Browser Related Origin Requests support a minimum of 5 unique labels; ` +
      `more entries are silently ignored by Chrome/Safari.`,
    );
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== 'object' || typeof e.origin !== 'string' || typeof e.rpId !== 'string') {
      throw new Error(`rp.relatedOrigins[${i}]: must be { origin: string; rpId: string }`);
    }
    if (e.origin.includes('*') || e.rpId.includes('*')) {
      throw new Error(
        `rp.relatedOrigins[${i}]: wildcards are not permitted (got origin="${e.origin}" rpId="${e.rpId}")`,
      );
    }
    const isHttps = HTTPS_RE.test(e.origin);
    const isLocalhostHttp = LOCALHOST_HTTP_RE.test(e.origin) && e.rpId === 'localhost';
    if (!isHttps && !isLocalhostHttp) {
      throw new Error(
        `rp.relatedOrigins[${i}]: origin must be https:// (got "${e.origin}"). ` +
        `http:// is only permitted when rpId === "localhost".`,
      );
    }
    if (!RPID_RE.test(e.rpId)) {
      throw new Error(`rp.relatedOrigins[${i}]: rpId "${e.rpId}" is not a valid host`);
    }
    // Suffix-domain check: host(origin) ends with rpId at a label boundary.
    let host: string;
    try {
      host = new URL(e.origin).hostname.toLowerCase();
    } catch {
      throw new Error(`rp.relatedOrigins[${i}]: origin "${e.origin}" is not a valid URL`);
    }
    const rpIdLower = e.rpId.toLowerCase();
    const isExact = host === rpIdLower;
    const isSubdomain = host.endsWith('.' + rpIdLower);
    if (!isExact && !isSubdomain) {
      throw new Error(
        `rp.relatedOrigins[${i}]: origin host "${host}" is not a suffix-domain of rpId "${e.rpId}". ` +
        `WebAuthn requires the assertion's effective domain be equal to or a subdomain of rpId.`,
      );
    }
    // Reject duplicates of the primary rp loudly (silent-dedupe is an anti-pattern).
    if (e.origin === primaryOrigin && e.rpId === primaryRpId) {
      throw new Error(
        `rp.relatedOrigins[${i}]: duplicates the primary rp { origin: "${primaryOrigin}", rpId: "${primaryRpId}" }. ` +
        `The primary rp is implicit; do not list it in relatedOrigins.`,
      );
    }
  }
  return [...entries];
}
