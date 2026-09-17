/**
 * PHASE 6.7C.2C.3H.1 — frozen allowlist of v101 writer error keys.
 * Pure module (no server-only) for unit tests.
 */

export const V101_PUBLISH_RPC_ERROR_KEYS = [
  "error.security_boundary_compromised",
  "error.identity_verification_required",
  "error.idempotency_payload_conflict",
  "error.invalid_post_status",
  "error.publish_authority_invalid",
  "error.publish_authority_partial_state",
  "error.publish_authority_legacy_missing",
  "error.challenge_fencing_stale",
  "error.passkey_transaction_failed",
  "error.authentication_credential_not_found",
] as const;

export type V101PublishRpcErrorKey = (typeof V101_PUBLISH_RPC_ERROR_KEYS)[number];

const ALLOWED = new Set<string>(V101_PUBLISH_RPC_ERROR_KEYS);

/** True only for exact frozen keys (no control chars / unknown error.*). */
export function isAllowedV101PublishRpcErrorKey(value: unknown): value is V101PublishRpcErrorKey {
  return typeof value === "string" && ALLOWED.has(value);
}
