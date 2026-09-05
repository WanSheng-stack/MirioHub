import "server-only";
import {
  resolveWebAuthnConfig,
  type WebAuthnConfig,
} from "@/lib/auth/webauthnConfigResolve";

export {
  WebAuthnConfigError,
  clientErrorKeyFromUnknownVerifyError,
  resolveWebAuthnConfig,
  WEBAUTHN_CONFIG_ERROR_KEY,
  WEBAUTHN_VERIFY_FAILED_KEY,
  type WebAuthnConfig,
} from "@/lib/auth/webauthnConfigResolve";

export function getWebAuthnConfig(): WebAuthnConfig {
  return resolveWebAuthnConfig(process.env, process.env.NODE_ENV);
}
