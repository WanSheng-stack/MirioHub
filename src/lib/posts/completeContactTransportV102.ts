/**
 * PHASE 6.7C.2C.3I-B.1 — complete-contact transport decision (v102).
 * SQL remains authoritative. Mirrors v98 subtype×mode when subtype non-NULL.
 * Legacy NULL subtype: frozen pre-subtype full Travel/Deliver allowlists.
 */

import {
  isTargetDeliverTransportMode,
  isTargetTravelTransportMode,
  LEGACY_VAN,
  TARGET_DELIVER_TRANSPORT_MODES,
  TARGET_TRAVEL_TRANSPORT_MODES,
  type TargetTransportMode,
} from "@/lib/transport/transportPolicy";

export const COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY =
  "error.transport_mode_already_set";

export type CompleteContactTransportDecision =
  | { kind: "omit" }
  | { kind: "fill"; mode: TargetTransportMode }
  | { kind: "reject"; errorKey: string };

const TRAVEL_FULL = new Set<string>(TARGET_TRAVEL_TRANSPORT_MODES);
const DELIVER_FULL = new Set<string>(TARGET_DELIVER_TRANSPORT_MODES);
const DELIVER_ESCORT_LAND = new Set([
  "cargo_van",
  "light_truck",
  "box_truck",
  "vehicle_with_trailer",
  "other_cargo_vehicle",
]);

/** Returns null if mode is legal for category×subtype; else error key. */
export function transportComboErrorKey(input: {
  category: string;
  serviceSubtype: string | null;
  mode: string;
}): string | null {
  const { category, serviceSubtype, mode } = input;
  if (category === "buy" || category === "onsite" || category === "errand") {
    return "error.invalid_transport_mode";
  }
  if (category === "travel") {
    if (
      serviceSubtype === "passenger" ||
      serviceSubtype === "passenger_with_small_item"
    ) {
      return mode === "car" ? null : "error.illegal_transport_combo";
    }
    if (serviceSubtype === "small_item_only" || serviceSubtype == null) {
      // NULL subtype = frozen legacy-null-subtype compat (full Travel).
      return TRAVEL_FULL.has(mode) ? null : "error.illegal_transport_combo";
    }
    return "error.illegal_transport_combo";
  }
  if (category === "deliver") {
    if (serviceSubtype === "cargo_only" || serviceSubtype == null) {
      // NULL subtype = frozen legacy-null-subtype compat (full Deliver).
      return DELIVER_FULL.has(mode) ? null : "error.illegal_transport_combo";
    }
    if (serviceSubtype === "cargo_with_escort") {
      if (mode === "cargo_boat" || mode === "private_cargo_boat") {
        return "error.illegal_transport_combo";
      }
      return DELIVER_ESCORT_LAND.has(mode)
        ? null
        : "error.illegal_transport_combo";
    }
    return "error.illegal_transport_combo";
  }
  return "error.invalid_transport_mode";
}

export function decideCompleteContactTransportV102(input: {
  isOwner: boolean;
  category: string;
  serviceSubtype: string | null;
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
  if (
    !isTargetTravelTransportMode(trimmed) &&
    !isTargetDeliverTransportMode(trimmed)
  ) {
    return { kind: "reject", errorKey: "error.invalid_transport_mode" };
  }
  const comboErr = transportComboErrorKey({
    category: input.category,
    serviceSubtype: input.serviceSubtype,
    mode: trimmed,
  });
  if (comboErr) {
    return { kind: "reject", errorKey: comboErr };
  }
  const mode = trimmed as TargetTransportMode;
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
    (nightNull ||
      (typeof row.night_policy_version === "number" &&
        row.night_policy_version > 0))
  ) {
    return "complete";
  }
  return "partial";
}
