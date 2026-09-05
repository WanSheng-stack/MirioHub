/**
 * PHASE 6.1.2: WebAuthn RP/origin config + safe client error mapping.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/auth/webauthnConfig.test.ts
 */

import assert from "node:assert/strict";
import {
  WebAuthnConfigError,
  clientErrorKeyFromUnknownVerifyError,
  resolveWebAuthnConfig,
  WEBAUTHN_CONFIG_ERROR_KEY,
  WEBAUTHN_VERIFY_FAILED_KEY,
} from "@/lib/auth/webauthnConfigResolve";

const empty = {};

const dev = resolveWebAuthnConfig(empty, "development");
assert.equal(dev.rpID, "localhost");
assert.equal(dev.origin, "http://localhost:3000");
assert.equal(dev.rpName, "MirioHub");

const explicit = resolveWebAuthnConfig(
  {
    WEBAUTHN_RP_ID: "dev.miriohub.test",
    WEBAUTHN_ORIGIN: "http://127.0.0.1:4000",
    WEBAUTHN_RP_NAME: "MirioHub Dev",
  },
  "development",
);
assert.equal(explicit.rpID, "dev.miriohub.test");
assert.equal(explicit.origin, "http://127.0.0.1:4000");
assert.equal(explicit.rpName, "MirioHub Dev");

assert.throws(
  () => resolveWebAuthnConfig({}, "production"),
  (err: unknown) =>
    err instanceof WebAuthnConfigError &&
    err.errorKey === WEBAUTHN_CONFIG_ERROR_KEY &&
    /WEBAUTHN_RP_ID/.test(err.message),
);

assert.throws(
  () =>
    resolveWebAuthnConfig({ WEBAUTHN_RP_ID: "miriohub.com" }, "production"),
  (err: unknown) =>
    err instanceof WebAuthnConfigError &&
    err.errorKey === WEBAUTHN_CONFIG_ERROR_KEY &&
    /WEBAUTHN_ORIGIN/.test(err.message),
);

assert.throws(
  () =>
    resolveWebAuthnConfig(
      { WEBAUTHN_RP_ID: "https://localhost", WEBAUTHN_ORIGIN: "http://localhost:3000" },
      "development",
    ),
  WebAuthnConfigError,
);

assert.throws(
  () =>
    resolveWebAuthnConfig(
      { WEBAUTHN_RP_ID: "localhost", WEBAUTHN_ORIGIN: "*" },
      "development",
    ),
  WebAuthnConfigError,
);
assert.throws(
  () =>
    resolveWebAuthnConfig(
      { WEBAUTHN_RP_ID: "localhost", WEBAUTHN_ORIGIN: "http://localhost:3000/app" },
      "development",
    ),
  WebAuthnConfigError,
);

const raw = new Error(
  'Unexpected registration response origin "http://localhost:3000", expected "undefined"',
);
assert.equal(clientErrorKeyFromUnknownVerifyError(raw), WEBAUTHN_VERIFY_FAILED_KEY);
assert.notEqual(clientErrorKeyFromUnknownVerifyError(raw), raw.message);
assert.equal(
  clientErrorKeyFromUnknownVerifyError(new WebAuthnConfigError("missing")),
  WEBAUTHN_CONFIG_ERROR_KEY,
);

console.log("webauthnConfig: ok");
