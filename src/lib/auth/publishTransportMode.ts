/**
 * PHASE 6.7C.2B.2 — publish-time transport_mode parsing for Stage 1.
 * New writes must use transportPolicy target modes, filtered by subtype.
 * Legacy `van` is readable only and must never be accepted for new posts.
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
import type { ServiceSubtype } from "@/lib/safety/nightServicePolicy";

export type PublishTransportMode = TargetTransportMode;

export const INVALID_TRANSPORT_MODE_KEY = "error.invalid_transport_mode";
export const TRANSPORT_MODE_REQUIRED_KEY = "error.transport_mode_required";
export const ILLEGAL_TRANSPORT_COMBO_KEY = "error.illegal_transport_combo";

/** Land Deliver modes shown in publish UI (cargo_only). */
export const PUBLISH_UI_DELIVER_TRANSPORT_MODES = [
  "cargo_van",
  "light_truck",
  "box_truck",
  "vehicle_with_trailer",
  "other_cargo_vehicle",
] as const satisfies readonly TargetDeliverTransportMode[];

/** Land Deliver modes that may carry an escort passenger. */
export const PUBLISH_UI_DELIVER_ESCORT_TRANSPORT_MODES = [
  "cargo_van",
  "light_truck",
  "box_truck",
  "vehicle_with_trailer",
  "other_cargo_vehicle",
] as const satisfies readonly TargetDeliverTransportMode[];

/** SQL/canonical cargo_with_escort allowlist (no water cargo). */
export const PUBLISH_DELIVER_ESCORT_TRANSPORT_MODES =
  PUBLISH_UI_DELIVER_ESCORT_TRANSPORT_MODES;

export const PUBLISH_UI_TRAVEL_TRANSPORT_MODES = [
  ...TARGET_TRAVEL_TRANSPORT_MODES,
] as const satisfies readonly TargetTravelTransportMode[];

export const PUBLISH_UI_TRAVEL_PEOPLE_TRANSPORT_MODES = [
  "car",
] as const satisfies readonly TargetTravelTransportMode[];

/** @deprecated Prefer publishTransportModesForSubtype — category-only list. */
export function publishTransportModesForCategory(
  category: string,
): readonly PublishTransportMode[] {
  if (category === "travel") return PUBLISH_UI_TRAVEL_TRANSPORT_MODES;
  if (category === "deliver") return PUBLISH_UI_DELIVER_TRANSPORT_MODES;
  return [];
}

/**
 * UI + canonical allowlist for category + service_subtype.
 * Options shown here must not include modes that SQL/canonical will reject.
 */
export function publishTransportModesForSubtype(
  category: string,
  serviceSubtype: ServiceSubtype | null | undefined,
): readonly PublishTransportMode[] {
  if (category === "travel") {
    if (
      serviceSubtype === "passenger" ||
      serviceSubtype === "passenger_with_small_item"
    ) {
      return PUBLISH_UI_TRAVEL_PEOPLE_TRANSPORT_MODES;
    }
    if (serviceSubtype === "small_item_only") {
      return PUBLISH_UI_TRAVEL_TRANSPORT_MODES;
    }
    return [];
  }
  if (category === "deliver") {
    if (serviceSubtype === "cargo_with_escort") {
      return PUBLISH_UI_DELIVER_ESCORT_TRANSPORT_MODES;
    }
    if (serviceSubtype === "cargo_only") {
      return PUBLISH_UI_DELIVER_TRANSPORT_MODES;
    }
    return [];
  }
  return [];
}

function laneForCategory(category: string): TransportServiceLane | null {
  if (category === "travel") return "travel";
  if (category === "deliver") return "deliver";
  return null;
}

function modeAllowedForSubtype(
  category: string,
  serviceSubtype: ServiceSubtype | null | undefined,
  mode: string,
): boolean {
  const allowed = publishTransportModesForSubtype(category, serviceSubtype);
  if ((allowed as readonly string[]).includes(mode)) return true;
  // SQL accepts water cargo for cargo_only even when UI omits it.
  if (
    category === "deliver" &&
    serviceSubtype === "cargo_only" &&
    isTargetDeliverTransportMode(mode)
  ) {
    return true;
  }
  return false;
}

/**
 * Fail-closed publish parser. Travel/Deliver require a non-empty mode legal
 * for the subtype. Legacy van, blank, unknown, and cross-lane modes reject.
 * Buy/Onsite/Errand force null (any non-empty value rejects).
 */
export function parsePublishTransportMode(
  category: string,
  raw: unknown,
  serviceSubtype?: ServiceSubtype | null,
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
  if (
    serviceSubtype !== undefined &&
    !modeAllowedForSubtype(category, serviceSubtype, trimmed)
  ) {
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
