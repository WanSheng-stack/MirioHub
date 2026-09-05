/**
 * PHASE 6.4A: native Supabase passkey helpers.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/auth/nativePasskey.test.ts
 */

import assert from "node:assert/strict";
import {
  isPermanentConfirmedUser,
  isWebAuthnUserCancel,
  nativePasskeyErrorKey,
} from "@/lib/auth/nativePasskey";

assert.equal(
  isPermanentConfirmedUser({ is_anonymous: true, email_confirmed_at: undefined }),
  false,
);
assert.equal(
  isPermanentConfirmedUser({ is_anonymous: false, email_confirmed_at: undefined }),
  false,
);
assert.equal(
  isPermanentConfirmedUser({
    is_anonymous: false,
    email_confirmed_at: "2026-09-06T00:00:00Z",
  }),
  true,
);

assert.equal(isWebAuthnUserCancel({ name: "AbortError" }), true);
assert.equal(isWebAuthnUserCancel({ name: "NotAllowedError" }), true);
assert.equal(isWebAuthnUserCancel({ code: "webauthn_aborted" }), true);
assert.equal(isWebAuthnUserCancel({ code: "passkey_disabled" }), false);

assert.equal(
  nativePasskeyErrorKey({ code: "webauthn_credential_not_found" }),
  "device_login_not_found",
);
assert.equal(
  nativePasskeyErrorKey({ code: "webauthn_challenge_expired" }),
  "device_login_expired",
);
assert.equal(
  nativePasskeyErrorKey({ code: "passkey_disabled" }),
  "device_verification_configuration_error",
);
assert.equal(nativePasskeyErrorKey({ message: "DOMException" }), "device_login_failed");

console.log("nativePasskey.test.ts: all passed");
