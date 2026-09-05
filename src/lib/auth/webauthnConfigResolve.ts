export const WEBAUTHN_CONFIG_ERROR_KEY =
  "error.device_verification_configuration_error";
export const WEBAUTHN_VERIFY_FAILED_KEY = "error.device_verification_failed";

export class WebAuthnConfigError extends Error {
  readonly errorKey = WEBAUTHN_CONFIG_ERROR_KEY;
  constructor(message: string) {
    super(message);
    this.name = "WebAuthnConfigError";
  }
}

export type WebAuthnConfig = {
  rpID: string;
  rpName: string;
  origin: string;
};

const DEFAULT_DEV_RP_ID = "localhost";
const DEFAULT_DEV_ORIGIN = "http://localhost:3000";
const DEFAULT_RP_NAME = "MirioHub";

function isProduction(nodeEnv: string | undefined): boolean {
  return nodeEnv === "production";
}

/** Hostname only — no scheme, port, path, query, or userinfo. */
export function assertValidRpID(rpID: string): string {
  const value = rpID.trim();
  if (!value) {
    throw new WebAuthnConfigError("WEBAUTHN_RP_ID is empty");
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    throw new WebAuthnConfigError("WEBAUTHN_RP_ID must not include a URL scheme");
  }
  if (/[:/?#@\s]/.test(value)) {
    throw new WebAuthnConfigError("WEBAUTHN_RP_ID must be a hostname without port or path");
  }
  if (value !== "localhost" && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(value)) {
    throw new WebAuthnConfigError("WEBAUTHN_RP_ID is not a valid hostname");
  }
  return value;
}

/** Exact WebAuthn origin: scheme + host + optional port, no path/wildcard. */
export function assertValidOrigin(origin: string): string {
  const value = origin.trim();
  if (!value || value === "*") {
    throw new WebAuthnConfigError("WEBAUTHN_ORIGIN is invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WebAuthnConfigError("WEBAUTHN_ORIGIN is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebAuthnConfigError("WEBAUTHN_ORIGIN must be http or https");
  }
  if (parsed.username || parsed.password) {
    throw new WebAuthnConfigError("WEBAUTHN_ORIGIN must not include credentials");
  }
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new WebAuthnConfigError("WEBAUTHN_ORIGIN must not include a path, query, or hash");
  }
  return parsed.origin;
}

export function resolveWebAuthnConfig(
  env: Record<string, string | undefined>,
  nodeEnv: string | undefined,
): WebAuthnConfig {
  const production = isProduction(nodeEnv);
  const rawRpID = env.WEBAUTHN_RP_ID?.trim();
  const rawOrigin = env.WEBAUTHN_ORIGIN?.trim();
  const rawName = env.WEBAUTHN_RP_NAME?.trim();

  if (production) {
    if (!rawRpID) {
      throw new WebAuthnConfigError("WEBAUTHN_RP_ID is required in production");
    }
    if (!rawOrigin) {
      throw new WebAuthnConfigError("WEBAUTHN_ORIGIN is required in production");
    }
  }

  const rpID = assertValidRpID(rawRpID || DEFAULT_DEV_RP_ID);
  const origin = assertValidOrigin(rawOrigin || DEFAULT_DEV_ORIGIN);
  const rpName = rawName || DEFAULT_RP_NAME;

  return { rpID, rpName, origin };
}

/** Never return exception.message to the client. */
export function clientErrorKeyFromUnknownVerifyError(error: unknown): string {
  if (error instanceof WebAuthnConfigError) return error.errorKey;
  return WEBAUTHN_VERIFY_FAILED_KEY;
}
