/**
 * PHASE 6.7C.2C.3H / 3H.1 — runtime validation of v101 publish writer RPC results.
 * Fail-closed; only frozen allowlisted error keys reach the client.
 */

import {
  isAllowedV101PublishRpcErrorKey,
} from "@/lib/safety/v101PublishRpcErrorKeys";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export type V101PublishRpcSuccess = {
  ok: true;
  postId: string;
  isDuplicate: boolean;
};

export type V101PublishRpcFailure = {
  ok: false;
  errorKey: string;
};

/**
 * Validate jsonb result from publish_active / shadow / commit v101 writers.
 * Malformed shapes or unlisted error_msg → genericErrorKey.
 */
export function parseV101PublishRpcResult(
  data: unknown,
  genericErrorKey: string,
): V101PublishRpcSuccess | V101PublishRpcFailure {
  if (!isPlainObject(data)) {
    return { ok: false, errorKey: genericErrorKey };
  }
  if (typeof data.ok !== "boolean") {
    return { ok: false, errorKey: genericErrorKey };
  }
  if (data.ok === true) {
    const postId = data.post_id;
    if (typeof postId !== "string" || !UUID_RE.test(postId)) {
      return { ok: false, errorKey: genericErrorKey };
    }
    return {
      ok: true,
      postId,
      isDuplicate: data.is_duplicate === true,
    };
  }
  const err = data.error_msg;
  if (isAllowedV101PublishRpcErrorKey(err)) {
    return { ok: false, errorKey: err };
  }
  return { ok: false, errorKey: genericErrorKey };
}
