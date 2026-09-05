import type { User } from "@supabase/supabase-js";

/** Permanent confirmed account that may enroll a native Supabase passkey. */
export function isPermanentConfirmedUser(user: Pick<User, "is_anonymous" | "email_confirmed_at">): boolean {
  return user.is_anonymous !== true && Boolean(user.email_confirmed_at);
}

export function isWebAuthnUserCancel(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const code = "code" in error ? String(error.code) : "";
  return (
    name === "AbortError" ||
    name === "NotAllowedError" ||
    code === "webauthn_aborted"
  );
}

/** Map native Auth passkey errors. Never return a raw WebAuthn message. */
export function nativePasskeyErrorKey(error: unknown): string {
  if (!error || typeof error !== "object") return "device_login_failed";
  const code = "code" in error ? String(error.code) : "";
  if (code === "webauthn_credential_not_found") return "device_login_not_found";
  if (code === "webauthn_challenge_expired") return "device_login_expired";
  if (code === "passkey_disabled") return "device_verification_configuration_error";
  return "device_login_failed";
}
