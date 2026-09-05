/** Official GoTrue Admin API cannot mint a session for an existing user id. */
export const LOGIN_SESSION_ISSUANCE_AVAILABLE = false;

export function mapLoginReserveReason(reason: string | null | undefined): string {
  switch (reason) {
    case "expired":
      return "error.device_login_expired";
    case "in_progress":
      return "error.device_login_in_progress";
    default:
      return "error.device_login_failed";
  }
}

export function clientErrorKeyFromLoginVerifyException(error: unknown): string {
  if (error && typeof error === "object" && "errorKey" in error) {
    const key = (error as { errorKey?: string }).errorKey;
    if (typeof key === "string" && key.startsWith("error.")) return key;
  }
  return "error.device_login_failed";
}

/** Short identifier for logs. Never log the raw assertion or public key. */
export function credentialIdLogTag(credentialId: string): string {
  const trimmed = credentialId.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 8)}…`;
}

export function isUsernamelessAuthenticationOptions(
  options: Record<string, unknown>,
): boolean {
  const allow = options.allowCredentials;
  return !Array.isArray(allow) || allow.length === 0;
}
