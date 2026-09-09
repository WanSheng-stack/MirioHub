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

export type CompleteContactTransportDecision =
  | { kind: "omit" }
  | { kind: "fill"; mode: ValidV1TransportMode }
  | { kind: "reject"; errorKey: string };

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
