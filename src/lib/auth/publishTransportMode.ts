/**
 * PHASE 6.7C.2B.1 — publish-time transport_mode parsing for Stage 1.
 * New writes must use transportPolicy target modes. Legacy `van` is
 * readable only and must never be accepted for new posts.
 */

import {
  isModeAllowedForLane,
  isTargetDeliverTransportMode,
  isTargetTravelTransportMode,
  LEGACY_VAN,
  TARGET_DELIVER_TRANSPORT_MODES,
  TARGET_TRAVEL_TRANSPORT_MODES,
  type TargetDeliverTransportMode,
  type TargetTransportMode,
  type TargetTravelTransportMode,
  type TransportServiceLane,
} from "@/lib/transport/transportPolicy";

export type PublishTransportMode = TargetTransportMode;

export const INVALID_TRANSPORT_MODE_KEY = "error.invalid_transport_mode";
export const TRANSPORT_MODE_REQUIRED_KEY = "error.transport_mode_required";
export const ILLEGAL_TRANSPORT_COMBO_KEY = "error.illegal_transport_combo";

/** Land Deliver modes shown in publish UI. Water cargo stays legal in
 *  canonical/SQL contracts but is omitted until location/cargo fields exist. */
export const PUBLISH_UI_DELIVER_TRANSPORT_MODES = [
  "cargo_van",
  "light_truck",
  "box_truck",
  "vehicle_with_trailer",
  "other_cargo_vehicle",
] as const satisfies readonly TargetDeliverTransportMode[];

export const PUBLISH_UI_TRAVEL_TRANSPORT_MODES = [
  ...TARGET_TRAVEL_TRANSPORT_MODES,
] as const satisfies readonly TargetTravelTransportMode[];

export function publishTransportModesForCategory(
  category: string,
): readonly PublishTransportMode[] {
  if (category === "travel") return PUBLISH_UI_TRAVEL_TRANSPORT_MODES;
  if (category === "deliver") return PUBLISH_UI_DELIVER_TRANSPORT_MODES;
  return [];
}

function laneForCategory(category: string): TransportServiceLane | null {
  if (category === "travel") return "travel";
  if (category === "deliver") return "deliver";
  return null;
}

/**
 * Fail-closed publish parser. Travel/Deliver require a non-empty target mode
 * for the lane. Legacy van, blank, unknown, and cross-lane modes reject.
 * Buy/Onsite/Errand force null (any non-empty value rejects).
 */
export function parsePublishTransportMode(
  category: string,
  raw: unknown,
):
  | { ok: true; value: PublishTransportMode | null }
  | { ok: false; errorKey: string } {
  const lane = laneForCategory(category);

  if (lane == null) {
    if (raw === undefined || raw === null || raw === "") {
      return { ok: true, value: null };
    }
    if (typeof raw === "string" && raw.trim() === "") {
      return { ok: true, value: null };
    }
    return { ok: false, errorKey: INVALID_TRANSPORT_MODE_KEY };
  }

  if (raw === undefined || raw === null) {
    return { ok: false, errorKey: TRANSPORT_MODE_REQUIRED_KEY };
  }
  if (typeof raw !== "string") {
    return { ok: false, errorKey: INVALID_TRANSPORT_MODE_KEY };
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, errorKey: TRANSPORT_MODE_REQUIRED_KEY };
  }
  if (trimmed === LEGACY_VAN) {
    return { ok: false, errorKey: INVALID_TRANSPORT_MODE_KEY };
  }
  if (lane === "travel") {
    if (!isTargetTravelTransportMode(trimmed)) {
      return { ok: false, errorKey: ILLEGAL_TRANSPORT_COMBO_KEY };
    }
  } else if (!isTargetDeliverTransportMode(trimmed)) {
    return { ok: false, errorKey: ILLEGAL_TRANSPORT_COMBO_KEY };
  }
  if (!isModeAllowedForLane(trimmed, lane)) {
    return { ok: false, errorKey: ILLEGAL_TRANSPORT_COMBO_KEY };
  }
  return { ok: true, value: trimmed };
}

export function isLegacyVanTransportMode(mode: string): boolean {
  return mode === LEGACY_VAN;
}

export {
  TARGET_DELIVER_TRANSPORT_MODES,
  TARGET_TRAVEL_TRANSPORT_MODES,
  LEGACY_VAN,
};
