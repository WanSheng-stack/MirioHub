/**
 * PHASE 6.7C.2C.3I-B — parse frozen jsonb from v102 posts write RPCs.
 */

export type V102PostsWriteSuccess = {
  ok: true;
  postId: string;
  isActive: boolean;
  alreadyActive: boolean;
  activated: boolean;
};

export type V102PostsWriteFailure = {
  ok: false;
  errorKey: string;
};

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const ALLOWED_ERROR_KEYS = new Set([
  "error.not_found",
  "error.invalid_post_status",
  "error.identity_verification_required",
  "error.publish_authority_legacy_missing",
  "error.publish_authority_partial_state",
  "error.publish_authority_invalid",
  "error.invalid_transport_mode",
  "error.transport_mode_already_set",
  "error.security_boundary_compromised",
  "error.submit_failed",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function parseV102PostsWriteRpcResult(
  data: unknown,
  genericErrorKey: string,
): V102PostsWriteSuccess | V102PostsWriteFailure {
  if (!isPlainObject(data) || typeof data.ok !== "boolean") {
    return { ok: false, errorKey: genericErrorKey };
  }
  if (data.ok === false) {
    const err = data.error_msg;
    if (typeof err === "string" && ALLOWED_ERROR_KEYS.has(err)) {
      return { ok: false, errorKey: err };
    }
    return { ok: false, errorKey: genericErrorKey };
  }
  const postId = data.post_id;
  if (typeof postId !== "string" || !UUID_RE.test(postId)) {
    return { ok: false, errorKey: genericErrorKey };
  }
  return {
    ok: true,
    postId,
    isActive: data.is_active === true,
    alreadyActive: data.already_active === true,
    activated: data.activated === true,
  };
}
