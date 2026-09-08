/**
 * PHASE 6.7B.1A — target V2 transport capability policy.
 *
 * This module is the intended single source for lane / mode / field-visibility
 * rules. It is NOT wired to publish UI, hall, fees, or APIs this round.
 *
 * Do NOT replace `@/lib/posts` TRANSPORT_MODES or `@/lib/types` TransportMode.
 * Those arrays are live publish + historical Post values. Changing them here
 * would leak new modes into production, break legacy `van`, and desync
 * canonical payload / DB CHECK.
 *
 * Client use (future) is UX only. 6.7C+ server must re-read the target post
 * from DB (id, category, owner, status, transport_mode) and re-run these
 * validators. Do not trust browser-supplied lane, mode, or people counts.
 */

import { TRANSPORT_MODES } from "@/lib/posts";
import type { PostType } from "@/lib/types";

export type TransportServiceLane = "travel" | "deliver";

export const TARGET_TRAVEL_TRANSPORT_MODES = [
  "walking",
  "bicycle",
  "ebike",
  "scooter",
  "motorbike",
  "car",
  "subway",
  "bus",
  "train",
  "flight",
  "ferry",
  "passenger_boat",
  "private_boat",
] as const;

export const TARGET_DELIVER_TRANSPORT_MODES = [
  "cargo_van",
  "light_truck",
  "box_truck",
  "trailer",
  "cargo_boat",
  "private_cargo_boat",
  "other_cargo_vehicle",
] as const;

export type TargetTravelTransportMode =
  (typeof TARGET_TRAVEL_TRANSPORT_MODES)[number];
export type TargetDeliverTransportMode =
  (typeof TARGET_DELIVER_TRANSPORT_MODES)[number];
export type TargetTransportMode =
  | TargetTravelTransportMode
  | TargetDeliverTransportMode;

/** Historical value still stored on posts. Not a V2 Travel mode. */
export const LEGACY_VAN = "van" as const;
export const LEGACY_VAN_SUGGESTED_TARGET = "cargo_van" as const;

/** Existing V1 / publish seat cap. Do not change capacity policy this round. */
export const CAR_PEOPLE_CAPACITY_MAX = 4;
export const DELIVER_ESCORT_PASSENGER_MAX = 1;

export type TransportCapabilityPolicy = {
  lane: TransportServiceLane;
  canCarrySmallItems: boolean;
  canCarryLargeItems: boolean;
  showsPeopleCapacity: boolean;
  maxPeopleCapacity: number;
  requiresVehicleIdentity: boolean;
  requiresPlate: boolean;
  isPublicTransport: boolean;
  isWaterTransport: boolean;
  allowsNewPost: boolean;
  legacyReadable: boolean;
};

export type TransportFieldVisibility = {
  showPeopleCapacity: boolean;
  showSmallItemCapacity: boolean;
  showLargeCargoCapacity: boolean;
  showVehicleIdentity: boolean;
  showPlate: boolean;
  showEscortPassenger: boolean;
  showPublicTransportNotice: boolean;
  showWaterTransportNotice: boolean;
  showSelfLoadUnloadNotice: boolean;
};

export type TransportCapabilityInput = {
  lane: TransportServiceLane;
  postType: PostType;
  mode: string;
  peopleCapacity?: number | null;
  escortPassengerCount?: number | null;
  smallItemTotal?: number | null;
  largeCargoTotal?: number | null;
};

export type TransportValidationResult =
  | { ok: true }
  | { ok: false; errorKey: string };

type PolicySeed = Omit<TransportCapabilityPolicy, "legacyReadable">;

function policy(
  seed: PolicySeed,
  mode: string,
): TransportCapabilityPolicy {
  return {
    ...seed,
    legacyReadable: (TRANSPORT_MODES as readonly string[]).includes(mode),
  };
}

const NO_PEOPLE = {
  showsPeopleCapacity: false,
  maxPeopleCapacity: 0,
} as const;

const TRAVEL_SMALL: PolicySeed = {
  lane: "travel",
  canCarrySmallItems: true,
  canCarryLargeItems: false,
  ...NO_PEOPLE,
  requiresVehicleIdentity: false,
  requiresPlate: false,
  isPublicTransport: false,
  isWaterTransport: false,
  allowsNewPost: true,
};

const TARGET_POLICIES: Record<TargetTransportMode, TransportCapabilityPolicy> = {
  walking: policy(TRAVEL_SMALL, "walking"),
  bicycle: policy(TRAVEL_SMALL, "bicycle"),
  ebike: policy(TRAVEL_SMALL, "ebike"),
  scooter: policy(TRAVEL_SMALL, "scooter"),
  motorbike: policy(
    {
      ...TRAVEL_SMALL,
      requiresVehicleIdentity: true,
      requiresPlate: true,
    },
    "motorbike",
  ),
  car: policy(
    {
      lane: "travel",
      canCarrySmallItems: true,
      canCarryLargeItems: false,
      showsPeopleCapacity: true,
      maxPeopleCapacity: CAR_PEOPLE_CAPACITY_MAX,
      requiresVehicleIdentity: true,
      requiresPlate: true,
      isPublicTransport: false,
      isWaterTransport: false,
      allowsNewPost: true,
    },
    "car",
  ),
  subway: policy(
    {
      ...TRAVEL_SMALL,
      isPublicTransport: true,
    },
    "subway",
  ),
  bus: policy(
    {
      ...TRAVEL_SMALL,
      isPublicTransport: true,
    },
    "bus",
  ),
  train: policy(
    {
      ...TRAVEL_SMALL,
      isPublicTransport: true,
    },
    "train",
  ),
  flight: policy(
    {
      ...TRAVEL_SMALL,
      isPublicTransport: true,
    },
    "flight",
  ),
  ferry: policy(
    {
      ...TRAVEL_SMALL,
      isPublicTransport: true,
      isWaterTransport: true,
    },
    "ferry",
  ),
  passenger_boat: policy(
    {
      ...TRAVEL_SMALL,
      isWaterTransport: true,
    },
    "passenger_boat",
  ),
  private_boat: policy(
    {
      ...TRAVEL_SMALL,
      requiresVehicleIdentity: true,
      isWaterTransport: true,
    },
    "private_boat",
  ),
  cargo_van: policy(
    {
      lane: "deliver",
      canCarrySmallItems: false,
      canCarryLargeItems: true,
      ...NO_PEOPLE,
      requiresVehicleIdentity: true,
      requiresPlate: true,
      isPublicTransport: false,
      isWaterTransport: false,
      allowsNewPost: true,
    },
    "cargo_van",
  ),
  light_truck: policy(
    {
      lane: "deliver",
      canCarrySmallItems: false,
      canCarryLargeItems: true,
      ...NO_PEOPLE,
      requiresVehicleIdentity: true,
      requiresPlate: true,
      isPublicTransport: false,
      isWaterTransport: false,
      allowsNewPost: true,
    },
    "light_truck",
  ),
  box_truck: policy(
    {
      lane: "deliver",
      canCarrySmallItems: false,
      canCarryLargeItems: true,
      ...NO_PEOPLE,
      requiresVehicleIdentity: true,
      requiresPlate: true,
      isPublicTransport: false,
      isWaterTransport: false,
      allowsNewPost: true,
    },
    "box_truck",
  ),
  trailer: policy(
    {
      lane: "deliver",
      canCarrySmallItems: false,
      canCarryLargeItems: true,
      ...NO_PEOPLE,
      requiresVehicleIdentity: true,
      requiresPlate: true,
      isPublicTransport: false,
      isWaterTransport: false,
      allowsNewPost: true,
    },
    "trailer",
  ),
  other_cargo_vehicle: policy(
    {
      lane: "deliver",
      canCarrySmallItems: false,
      canCarryLargeItems: true,
      ...NO_PEOPLE,
      requiresVehicleIdentity: true,
      requiresPlate: true,
      isPublicTransport: false,
      isWaterTransport: false,
      allowsNewPost: true,
    },
    "other_cargo_vehicle",
  ),
  cargo_boat: policy(
    {
      lane: "deliver",
      canCarrySmallItems: false,
      canCarryLargeItems: true,
      ...NO_PEOPLE,
      requiresVehicleIdentity: true,
      requiresPlate: false,
      isPublicTransport: false,
      isWaterTransport: true,
      allowsNewPost: true,
    },
    "cargo_boat",
  ),
  private_cargo_boat: policy(
    {
      lane: "deliver",
      canCarrySmallItems: false,
      canCarryLargeItems: true,
      ...NO_PEOPLE,
      requiresVehicleIdentity: true,
      requiresPlate: false,
      isPublicTransport: false,
      isWaterTransport: true,
      allowsNewPost: true,
    },
    "private_cargo_boat",
  ),
};

const LEGACY_VAN_POLICY: TransportCapabilityPolicy = {
  lane: "deliver",
  canCarrySmallItems: false,
  canCarryLargeItems: true,
  showsPeopleCapacity: false,
  maxPeopleCapacity: 0,
  requiresVehicleIdentity: true,
  requiresPlate: true,
  isPublicTransport: false,
  isWaterTransport: false,
  allowsNewPost: false,
  legacyReadable: true,
};

/** UI copy contract only. Do not replace live hall/publish messages this round. */
export const TRANSPORT_LANE_COPY_CONTRACT = {
  travel: {
    titleKey: "transportPolicy.travelTitle",
    subtitleKey: "transportPolicy.travelSubtitle",
  },
  deliver: {
    titleKey: "transportPolicy.deliverTitle",
    subtitleKey: "transportPolicy.deliverSubtitle",
  },
} as const;

export function isTargetTravelTransportMode(
  mode: string,
): mode is TargetTravelTransportMode {
  return (TARGET_TRAVEL_TRANSPORT_MODES as readonly string[]).includes(mode);
}

export function isTargetDeliverTransportMode(
  mode: string,
): mode is TargetDeliverTransportMode {
  return (TARGET_DELIVER_TRANSPORT_MODES as readonly string[]).includes(mode);
}

export function isLegacyReadableTransportMode(mode: string): boolean {
  if (mode === LEGACY_VAN) return true;
  return (TRANSPORT_MODES as readonly string[]).includes(mode);
}

export function suggestedMigrationTarget(mode: string): string | null {
  if (mode === LEGACY_VAN) return LEGACY_VAN_SUGGESTED_TARGET;
  if (isTargetTravelTransportMode(mode) || isTargetDeliverTransportMode(mode)) {
    return mode;
  }
  return null;
}

export function getTransportPolicy(
  mode: string,
): TransportCapabilityPolicy | null {
  if (mode === LEGACY_VAN) return LEGACY_VAN_POLICY;
  if (isTargetTravelTransportMode(mode) || isTargetDeliverTransportMode(mode)) {
    return TARGET_POLICIES[mode];
  }
  return null;
}

export function isModeAllowedForLane(
  mode: string,
  lane: TransportServiceLane,
): boolean {
  const current = getTransportPolicy(mode);
  if (!current || !current.allowsNewPost) return false;
  return current.lane === lane;
}

export function getTransportFieldVisibility(input: {
  lane: TransportServiceLane;
  postType: PostType;
  mode: string;
  hasPeople?: boolean;
  hasItems?: boolean;
}): TransportFieldVisibility | null {
  const current = getTransportPolicy(input.mode);
  if (!current) return null;

  const isCar = input.mode === "car";
  const deliverProvider =
    input.lane === "deliver" && input.postType === "provider";
  const deliverDemand = input.lane === "deliver" && input.postType === "demand";

  return {
    showPeopleCapacity:
      input.lane === "travel" && isCar && current.showsPeopleCapacity && !deliverProvider,
    showSmallItemCapacity:
      input.lane === "travel" && current.canCarrySmallItems,
    showLargeCargoCapacity:
      input.lane === "deliver" && current.canCarryLargeItems,
    showVehicleIdentity:
      input.postType === "provider" && current.requiresVehicleIdentity,
    showPlate:
      input.postType === "provider" &&
      current.requiresPlate &&
      !current.isWaterTransport,
    showEscortPassenger: deliverDemand,
    showPublicTransportNotice: current.isPublicTransport,
    showWaterTransportNotice: current.isWaterTransport,
    showSelfLoadUnloadNotice: input.lane === "deliver",
  };
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

export function validateTransportCapability(
  input: TransportCapabilityInput,
): TransportValidationResult {
  const current = getTransportPolicy(input.mode);
  if (!current) {
    return { ok: false, errorKey: "error.transport_mode_unknown" };
  }
  if (!isModeAllowedForLane(input.mode, input.lane)) {
    return { ok: false, errorKey: "error.transport_mode_not_allowed_for_lane" };
  }

  const people = input.peopleCapacity ?? 0;
  if (input.peopleCapacity != null && !isFiniteInteger(input.peopleCapacity)) {
    return { ok: false, errorKey: "error.transport_people_not_integer" };
  }
  if (input.mode !== "car") {
    if (people > 0) {
      return { ok: false, errorKey: "error.transport_people_not_allowed" };
    }
  } else if (people < 0 || people > CAR_PEOPLE_CAPACITY_MAX) {
    return { ok: false, errorKey: "error.transport_people_bounds" };
  }

  if (input.lane === "deliver" && input.postType === "provider" && people > 0) {
    return { ok: false, errorKey: "error.transport_people_not_allowed" };
  }

  if (input.lane === "travel") {
    const items = input.smallItemTotal ?? 0;
    if ((people ?? 0) <= 0 && items <= 0) {
      return { ok: false, errorKey: "error.transport_travel_empty" };
    }
  }

  if (input.lane === "deliver") {
    const cargo = input.largeCargoTotal ?? 0;
    if (cargo <= 0) {
      return { ok: false, errorKey: "error.transport_deliver_cargo_required" };
    }
    if (input.escortPassengerCount != null) {
      if (!isFiniteInteger(input.escortPassengerCount)) {
        return { ok: false, errorKey: "error.transport_escort_not_integer" };
      }
      if (
        input.escortPassengerCount < 0 ||
        input.escortPassengerCount > DELIVER_ESCORT_PASSENGER_MAX
      ) {
        return { ok: false, errorKey: "error.transport_escort_bounds" };
      }
    }
  }

  return { ok: true };
}
