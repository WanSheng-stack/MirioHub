/**
 * PHASE 6.7C.2C.3I-B — complete-contact transport decision for v102.
 * SQL remains authoritative; this is early reject / fill intent only.
 */

import {
  isTargetDeliverTransportMode,
  isTargetTravelTransportMode,
  LEGACY_VAN,
  type TargetTransportMode,
} from "@/lib/transport/transportPolicy";

export const COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY =
  "error.transport_mode_already_set";

export const COMPLETE_CONTACT_TRANSPORT_REREAD_FAILED_LOG =
  "[complete-contact] transport reread failed";

export const COMPLETE_CONTACT_TRANSPORT_REREAD_MISSING_LOG =
  "[complete-contact] transport reread missing";

export type CompleteContactTransportDecision =
  | { kind: "omit" }
  | { kind: "fill"; mode: TargetTransportMode }
  | { kind: "reject"; errorKey: string };

/**
 * Authority-complete: never fill; same non-null mode is idempotent omit.
 * Legacy: NULL → target lane mode once. Partial: reject.
 * Buy/onsite/errand: non-null request rejected. van rejected.
 */
export function decideCompleteContactTransportV102(input: {
  isOwner: boolean;
  category: string;
  authorityState: "complete" | "legacy" | "partial";
  existingMode: string | null;
  requested: unknown;
}): CompleteContactTransportDecision {
  if (!input.isOwner) {
    return { kind: "reject", errorKey: "error.not_found" };
  }
  if (input.requested === undefined) {
    return { kind: "omit" };
  }
  if (input.authorityState === "partial") {
    return {
      kind: "reject",
      errorKey: "error.publish_authority_partial_state",
    };
  }
  if (typeof input.requested !== "string") {
    return { kind: "reject", errorKey: "error.invalid_transport_mode" };
  }
  const trimmed = input.requested.trim();
  if (trimmed === "" || trimmed === LEGACY_VAN) {
    return { kind: "reject", errorKey: "error.invalid_transport_mode" };
  }
  if (input.category === "buy" || input.category === "onsite" || input.category === "errand") {
    return { kind: "reject", errorKey: "error.invalid_transport_mode" };
  }
  let mode: TargetTransportMode | null = null;
  if (input.category === "travel" && isTargetTravelTransportMode(trimmed)) {
    mode = trimmed;
  } else if (input.category === "deliver" && isTargetDeliverTransportMode(trimmed)) {
    mode = trimmed;
  }
  if (mode == null) {
    return { kind: "reject", errorKey: "error.invalid_transport_mode" };
  }

  const existing =
    input.existingMode === "" || input.existingMode == null
      ? null
      : input.existingMode;

  if (input.authorityState === "complete") {
    if (existing == null) {
      return {
        kind: "reject",
        errorKey: COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY,
      };
    }
    if (existing === mode) return { kind: "omit" };
    return {
      kind: "reject",
      errorKey: COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY,
    };
  }

  // legacy
  if (existing == null) return { kind: "fill", mode };
  if (existing === mode) return { kind: "omit" };
  return {
    kind: "reject",
    errorKey: COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY,
  };
}

export function classifyAuthorityStateForContact(row: {
  origin_gps: unknown | null;
  origin_country_code: string | null;
  origin_timezone: string | null;
  night_policy_version: number | null;
}): "complete" | "legacy" | "partial" {
  const gpsNull = row.origin_gps == null;
  const ccNull = row.origin_country_code == null;
  const tzNull = row.origin_timezone == null;
  const nightNull = row.night_policy_version == null;
  if (gpsNull && ccNull && tzNull && nightNull) return "legacy";
  if (
    !gpsNull &&
    !ccNull &&
    !tzNull &&
    (nightNull || (typeof row.night_policy_version === "number" && row.night_policy_version > 0))
  ) {
    return "complete";
  }
  return "partial";
}
