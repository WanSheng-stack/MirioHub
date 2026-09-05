/**
 * PHASE 6.4: returning-user authentication helpers.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/auth/passkeyLogin.test.ts
 */

import assert from "node:assert/strict";
import {
  LOGIN_SESSION_ISSUANCE_AVAILABLE,
  clientErrorKeyFromLoginVerifyException,
  credentialIdLogTag,
  isUsernamelessAuthenticationOptions,
  mapLoginReserveReason,
} from "@/lib/auth/passkeyLogin";

assert.equal(LOGIN_SESSION_ISSUANCE_AVAILABLE, false);

assert.equal(mapLoginReserveReason("expired"), "error.device_login_expired");
assert.equal(mapLoginReserveReason("in_progress"), "error.device_login_in_progress");
assert.equal(mapLoginReserveReason("failed"), "error.device_login_failed");
assert.equal(mapLoginReserveReason("invalid"), "error.device_login_failed");

const raw = new Error('Unexpected authentication response origin "x"');
assert.equal(clientErrorKeyFromLoginVerifyException(raw), "error.device_login_failed");
assert.notEqual(clientErrorKeyFromLoginVerifyException(raw), raw.message);

assert.equal(credentialIdLogTag("abcdefghijklmnop"), "abcdefgh…");
assert.equal(
  isUsernamelessAuthenticationOptions({ rpId: "localhost" }),
  true,
);
assert.equal(
  isUsernamelessAuthenticationOptions({ allowCredentials: [] }),
  true,
);
assert.equal(
  isUsernamelessAuthenticationOptions({
    allowCredentials: [{ id: "cred" }],
  }),
  false,
);

console.log("passkeyLogin: ok");
