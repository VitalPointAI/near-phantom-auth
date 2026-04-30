import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import pino from 'pino';

// src/server/webauthn.ts

// src/server/backup.ts
function deriveBackupEligibility(deviceType) {
  return deviceType === "multiDevice";
}
var log = pino({ level: "silent" }).child({ module: "webauthn" });
async function createRegistrationOptions(input) {
  const {
    rpName,
    rpId,
    userName,
    userDisplayName = userName,
    userId,
    excludeCredentials = [],
    timeout = 6e4
  } = input;
  const userIdBytes = userId ? new TextEncoder().encode(userId) : crypto.getRandomValues(new Uint8Array(32));
  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userName,
    userDisplayName,
    userID: userIdBytes,
    attestationType: "none",
    // We don't need attestation for most use cases
    excludeCredentials: excludeCredentials.map((cred) => ({
      id: cred.id,
      type: "public-key",
      transports: cred.transports
    })),
    authenticatorSelection: {
      residentKey: "required",
      // Enable discoverable credentials (login without username)
      userVerification: "preferred"
      // Don't restrict authenticator attachment - allow both platform and hardware keys
    },
    timeout
  });
  return {
    options,
    challenge: options.challenge
  };
}
async function verifyRegistration(input) {
  const { response, expectedChallenge, expectedOrigin, expectedRPID } = input;
  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID
    });
    if (!verification.verified || !verification.registrationInfo) {
      return { verified: false, error: "Verification failed" };
    }
    const { registrationInfo } = verification;
    return {
      verified: true,
      credential: {
        id: registrationInfo.credential.id,
        publicKey: registrationInfo.credential.publicKey,
        counter: registrationInfo.credential.counter,
        deviceType: registrationInfo.credentialDeviceType,
        backedUp: registrationInfo.credentialBackedUp,
        backupEligible: deriveBackupEligibility(registrationInfo.credentialDeviceType),
        transports: response.response.transports
      }
    };
  } catch (error) {
    log.error({ err: error }, "Registration verification error");
    return {
      verified: false,
      error: error instanceof Error ? error.message : "Verification failed"
    };
  }
}
async function createAuthenticationOptions(input) {
  const { rpId, allowCredentials, timeout = 6e4 } = input;
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: "preferred",
    allowCredentials: allowCredentials?.map((cred) => ({
      id: cred.id,
      type: "public-key",
      transports: cred.transports
    })),
    timeout
  });
  return {
    options,
    challenge: options.challenge
  };
}
async function verifyAuthentication(input) {
  const { response, expectedChallenge, expectedOrigin, expectedRPID, credential } = input;
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports
      }
    });
    if (!verification.verified) {
      return { verified: false, error: "Verification failed" };
    }
    return {
      verified: true,
      newCounter: verification.authenticationInfo.newCounter
    };
  } catch (error) {
    log.error({ err: error }, "Authentication verification error");
    return {
      verified: false,
      error: error instanceof Error ? error.message : "Verification failed"
    };
  }
}
function base64urlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64url(bytes) {
  const binary = String.fromCharCode(...bytes);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export { base64urlToUint8Array, createAuthenticationOptions, createRegistrationOptions, uint8ArrayToBase64url, verifyAuthentication, verifyRegistration };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map