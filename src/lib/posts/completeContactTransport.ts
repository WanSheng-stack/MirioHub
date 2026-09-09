/**
 * complete-contact transport_mode fill. Pure decisions; the route applies
 * the owner + transport_mode IS NULL filter. Does not leak existing values
 * into browser responses.
 *
 * New Stage 1 rows with a non-null mode must not be overwritten.
 * Historical null rows may be filled once with a validated V1 mode.
 */

import {
  parseV1TransportMode,
  type ValidV1TransportMode,
} from "@/lib/auth/v1TransportMode";

export const COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY =
  "error.transport_mode_already_set";

export const COMPLETE_CONTACT_TRANSPORT_REREAD_FAILED_LOG =
  "[complete-contact] transport reread failed";

export const COMPLETE_CONTACT_TRANSPORT_REREAD_MISSING_LOG =
  "[complete-contact] transport reread missing";

export type CompleteContactTransportDecision =
  | { kind: "omit" }
  | { kind: "fill"; mode: ValidV1TransportMode }
  | { kind: "reject"; errorKey: string };

export type CompleteContactTransportRereadResult =
  | { kind: "idempotent" }
  | {
      kind: "conflict";
      errorKey: typeof COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY;
    }
  | {
      kind: "failed";
      errorKey: "error.submit_failed";
      log: string;
    };

export type CompleteContactTransportRereadResponse =
  | { ok: true }
  | { ok: false; errorKey: string; status: 400 | 500; log?: string };

export function decideCompleteContactTransport(input: {
  isOwner: boolean;
  existingMode: string | null;
  requested: unknown;
}): CompleteContactTransportDecision {
  if (!input.isOwner) {
    return { kind: "reject", errorKey: "error.not_found" };
  }
  if (input.requested === undefined) {
    return { kind: "omit" };
  }
  const parsed = parseV1TransportMode(input.requested);
  if (!parsed.ok) {
    return { kind: "reject", errorKey: parsed.errorKey };
  }
  const existing = input.existingMode === "" ? null : input.existingMode;
  if (existing === null) {
    if (parsed.value === null) return { kind: "omit" };
    return { kind: "fill", mode: parsed.value };
  }
  if (parsed.value === existing) {
    return { kind: "omit" };
  }
  return {
    kind: "reject",
    errorKey: COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY,
  };
}

export function decideAfterConditionalFillMiss(input: {
  intendedMode: ValidV1TransportMode;
  currentMode: string | null;
}): CompleteContactTransportDecision {
  if (input.currentMode === input.intendedMode) {
    return { kind: "omit" };
  }
  return {
    kind: "reject",
    errorKey: COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY,
  };
}

/**
 * Interprets the secondary SELECT after a conditional fill miss.
 * Query errors and missing rows are safe failures, never a transport conflict.
 * Does not copy Supabase message/details/hint into logs or browser JSON.
 */
export function interpretCompleteContactTransportReread(input: {
  intendedMode: ValidV1TransportMode;
  error: object | null | undefined;
  row: { transport_mode?: string | null } | null | undefined;
}): CompleteContactTransportRereadResult {
  if (input.error) {
    return {
      kind: "failed",
      errorKey: "error.submit_failed",
      log: COMPLETE_CONTACT_TRANSPORT_REREAD_FAILED_LOG,
    };
  }
  if (input.row == null) {
    return {
      kind: "failed",
      errorKey: "error.submit_failed",
      log: COMPLETE_CONTACT_TRANSPORT_REREAD_MISSING_LOG,
    };
  }
  const raced = decideAfterConditionalFillMiss({
    intendedMode: input.intendedMode,
    currentMode: input.row.transport_mode ?? null,
  });
  if (raced.kind === "reject") {
    return {
      kind: "conflict",
      errorKey: COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY,
    };
  }
  return { kind: "idempotent" };
}

export function completeContactTransportRereadResponse(
  result: CompleteContactTransportRereadResult,
): CompleteContactTransportRereadResponse {
  if (result.kind === "idempotent") return { ok: true };
  if (result.kind === "conflict") {
    return { ok: false, errorKey: result.errorKey, status: 400 };
  }
  return {
    ok: false,
    errorKey: result.errorKey,
    status: 500,
    log: result.log,
  };
}

/** Filters for the atomic fill. Browser never sees these internals. */
export function completeContactTransportFillFilter(input: {
  postId: string;
  ownerUserId: string;
}): {
  id: string;
  user_id: string;
  transport_mode: null;
} {
  return {
    id: input.postId,
    user_id: input.ownerUserId,
    transport_mode: null,
  };
}
