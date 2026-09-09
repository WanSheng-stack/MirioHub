/**
 * PHASE 6.7B.1A.1 — target V2 transport capability policy.
 *
 * Client use is UX only. Server must re-read the post from DB and re-run
 * these validators. Do not trust browser-supplied lane, mode, role, or counts.
 *
 * This module owns transport mode / lane / role / people-field rules.
 * It does NOT own Cargo V2. Do not treat any quantity here as proof that a
 * Deliver shipment is complete. Deliver final non-empty checks belong to a
 * future Cargo V2 validator (CargoRequirement / CargoCapacity / …).
 *
 * travelItemUnits is the already-classified sum of Travel-allowed ordinary
 * small items / luggage. It is not a single luggage-size database column.
 * Legacy four-tier luggage counts remain the production model.
 * Do not fold Deliver furniture/appliances into travelItemUnits.
 *
 * Do NOT replace `@/lib/posts` TRANSPORT_MODES. V2 names (cargo_van,
 * vehicle_with_trailer, boats, …) must not appear in production UI or CHECK.
 */

import { TRANSPORT_MODES } from "@/lib/posts";
import type { PostType } from "@/lib/types";

export type TransportServiceLane = "travel" | "deliver";

export const PG_INT_MAX = 2_147_483_647;

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
  "vehicle_with_trailer",
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

export const LEGACY_VAN = "van" as const;
export const LEGACY_VAN_SUGGESTED_TARGET = "cargo_van" as const;

export const CAR_PEOPLE_COUNT_MAX = 4;
export const CAR_PEOPLE_CAPACITY_MAX = 4;
export const DELIVER_ESCORT_PASSENGER_MAX = 1;

export type TransportCapabilityPolicy = {
  eligibleForTravelLane: boolean;
  eligibleForDeliverLane: boolean;
  canPhysicallyCarrySmallItems: boolean;
  canPhysicallyCarryLargeItems: boolean;
  offersPlatformPeopleFields: boolean;
  maxPeopleCount: number;
  maxPeopleCapacity: number;
  requiresVehicleIdentity: boolean;
  requiresPlate: boolean;
  isPublicTransport: boolean;
  isWaterTransport: boolean;
  allowsNewPost: boolean;
  legacyReadable: boolean;
};

export type TransportFieldVisibility = {
  showPeopleCount: boolean;
  showPeopleCapacity: boolean;
  showSmallItemCapacity: boolean;
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
  peopleCount?: unknown;
  peopleCapacity?: unknown;
  travelItemUnits?: unknown;
  escortPassengerCount?: unknown;
};

export type TransportValidationResult =
  | { ok: true }
  | { ok: false; errorKey: string };

type PolicySeed = Omit<TransportCapabilityPolicy, "legacyReadable">;

function policy(seed: PolicySeed, mode: string): TransportCapabilityPolicy {
  return {
    ...seed,
    legacyReadable: (TRANSPORT_MODES as readonly string[]).includes(mode),
  };
}

const TRAVEL_BASE: PolicySeed = {
  eligibleForTravelLane: true,
  eligibleForDeliverLane: false,
  canPhysicallyCarrySmallItems: true,
  canPhysicallyCarryLargeItems: false,
  offersPlatformPeopleFields: false,
  maxPeopleCount: 0,
  maxPeopleCapacity: 0,
  requiresVehicleIdentity: false,
  requiresPlate: false,
  isPublicTransport: false,
  isWaterTransport: false,
  allowsNewPost: true,
};

const CARGO_ROAD: PolicySeed = {
  eligibleForTravelLane: false,
  eligibleForDeliverLane: true,
  canPhysicallyCarrySmallItems: true,
  canPhysicallyCarryLargeItems: true,
  offersPlatformPeopleFields: false,
  maxPeopleCount: 0,
  maxPeopleCapacity: 0,
  requiresVehicleIdentity: true,
  requiresPlate: true,
  isPublicTransport: false,
  isWaterTransport: false,
  allowsNewPost: true,
};

const CARGO_WATER: PolicySeed = {
  ...CARGO_ROAD,
  requiresPlate: false,
  isWaterTransport: true,
};

const TARGET_POLICIES: Record<TargetTransportMode, TransportCapabilityPolicy> = {
  walking: policy(TRAVEL_BASE, "walking"),
  bicycle: policy(TRAVEL_BASE, "bicycle"),
  ebike: policy(TRAVEL_BASE, "ebike"),
  scooter: policy(TRAVEL_BASE, "scooter"),
  motorbike: policy(
    {
      ...TRAVEL_BASE,
      requiresVehicleIdentity: true,
      requiresPlate: true,
    },
    "motorbike",
  ),
  car: policy(
    {
      ...TRAVEL_BASE,
      offersPlatformPeopleFields: true,
      maxPeopleCount: CAR_PEOPLE_COUNT_MAX,
      maxPeopleCapacity: CAR_PEOPLE_CAPACITY_MAX,
      requiresVehicleIdentity: true,
      requiresPlate: true,
    },
    "car",
  ),
  subway: policy({ ...TRAVEL_BASE, isPublicTransport: true }, "subway"),
  bus: policy({ ...TRAVEL_BASE, isPublicTransport: true }, "bus"),
  train: policy({ ...TRAVEL_BASE, isPublicTransport: true }, "train"),
  flight: policy({ ...TRAVEL_BASE, isPublicTransport: true }, "flight"),
  ferry: policy(
    { ...TRAVEL_BASE, isPublicTransport: true, isWaterTransport: true },
    "ferry",
  ),
  passenger_boat: policy({ ...TRAVEL_BASE, isWaterTransport: true }, "passenger_boat"),
  private_boat: policy(
    {
      ...TRAVEL_BASE,
      requiresVehicleIdentity: true,
      isWaterTransport: true,
    },
    "private_boat",
  ),
  cargo_van: policy(CARGO_ROAD, "cargo_van"),
  light_truck: policy(CARGO_ROAD, "light_truck"),
  box_truck: policy(CARGO_ROAD, "box_truck"),
  vehicle_with_trailer: policy(CARGO_ROAD, "vehicle_with_trailer"),
  other_cargo_vehicle: policy(CARGO_ROAD, "other_cargo_vehicle"),
  cargo_boat: policy(CARGO_WATER, "cargo_boat"),
  private_cargo_boat: policy(CARGO_WATER, "private_cargo_boat"),
};

const LEGACY_VAN_POLICY: TransportCapabilityPolicy = {
  eligibleForTravelLane: false,
  eligibleForDeliverLane: true,
  canPhysicallyCarrySmallItems: true,
  canPhysicallyCarryLargeItems: true,
  offersPlatformPeopleFields: false,
  maxPeopleCount: 0,
  maxPeopleCapacity: 0,
  requiresVehicleIdentity: true,
  requiresPlate: true,
  isPublicTransport: false,
  isWaterTransport: false,
  allowsNewPost: false,
  legacyReadable: true,
};

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
  return lane === "travel"
    ? current.eligibleForTravelLane
    : current.eligibleForDeliverLane;
}

export function getTransportFieldVisibility(input: {
  lane: TransportServiceLane;
  postType: PostType;
  mode: string;
}): TransportFieldVisibility | null {
  if (!isModeAllowedForLane(input.mode, input.lane)) return null;
  const current = getTransportPolicy(input.mode);
  if (!current) return null;

  const travelCar =
    input.lane === "travel" &&
    input.mode === "car" &&
    current.offersPlatformPeopleFields;
  const deliverDemand = input.lane === "deliver" && input.postType === "demand";

  return {
    showPeopleCount: travelCar && input.postType === "demand",
    showPeopleCapacity: travelCar && input.postType === "provider",
    showSmallItemCapacity:
      input.lane === "travel" && current.canPhysicallyCarrySmallItems,
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

export type TransportQuantityFields = {
  peopleCount?: unknown;
  peopleCapacity?: unknown;
  travelItemUnits?: unknown;
  escortPassengerCount?: unknown;
};

export type TransportDeclaredFieldsInput = TransportQuantityFields & {
  lane: TransportServiceLane;
  postType: PostType;
};

export type TransportDeclaredFieldsSuccess = {
  ok: true;
  peopleCount: number | null;
  peopleCapacity: number | null;
  travelItemUnits: number | null;
  escortPassengerCount: number | null;
};

export type TransportDeclaredFieldsResult =
  | TransportDeclaredFieldsSuccess
  | { ok: false; errorKey: string };

/** Own-property and not `undefined`. Missing keys are not treated as present. */
export function isTransportFieldPresent(
  input: object,
  key: keyof TransportQuantityFields,
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(input, key) &&
    (input as Record<string, unknown>)[key] !== undefined
  );
}

export function copyPresentTransportFields(input: object): TransportQuantityFields {
  const fields: TransportQuantityFields = {};
  for (const key of [
    "peopleCount",
    "peopleCapacity",
    "travelItemUnits",
    "escortPassengerCount",
  ] as const) {
    if (isTransportFieldPresent(input, key)) {
      fields[key] = (input as Record<string, unknown>)[key];
    }
  }
  return fields;
}

export function parsePolicyQuantity(
  value: unknown,
): { ok: true; value: number } | { ok: false; errorKey: string } {
  if (typeof value !== "number") {
    return { ok: false, errorKey: "error.transport_quantity_invalid" };
  }
  if (
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > PG_INT_MAX
  ) {
    return { ok: false, errorKey: "error.transport_quantity_invalid" };
  }
  return { ok: true, value };
}

function readQuantity(
  input: TransportQuantityFields,
  key: keyof TransportQuantityFields,
): { ok: true; value: number | null } | { ok: false; errorKey: string } {
  if (!isTransportFieldPresent(input, key)) return { ok: true, value: null };
  const parsed = parsePolicyQuantity((input as Record<string, unknown>)[key]);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

function peopleValueForCombo(
  postType: PostType,
  peopleCount: number | null,
  peopleCapacity: number | null,
): number {
  if (postType === "demand") return peopleCount ?? 0;
  return peopleCapacity ?? 0;
}

/**
 * Role / scene field gates shared by the transport capability validator and
 * safety facts. Escort is Deliver Demand only — never a Provider public seat
 * field. travelItemUnits is Travel only; Deliver must not silently ignore it.
 * Travel peopleCount / peopleCapacity use the platform 0–4 cap here so Safety
 * facts without a transportMode still reject oversized counts. Mode-specific
 * rules (only car may have people > 0) stay in validateTransportCapability.
 */
export function validateTransportDeclaredFields(
  input: TransportDeclaredFieldsInput,
): TransportDeclaredFieldsResult {
  const hasPeopleCount = isTransportFieldPresent(input, "peopleCount");
  const hasPeopleCapacity = isTransportFieldPresent(input, "peopleCapacity");
  const hasTravelItemUnits = isTransportFieldPresent(input, "travelItemUnits");
  const hasEscort = isTransportFieldPresent(input, "escortPassengerCount");

  if (input.postType === "demand" && hasPeopleCapacity) {
    return { ok: false, errorKey: "error.transport_people_field_not_allowed" };
  }
  if (input.postType === "provider" && hasPeopleCount) {
    return { ok: false, errorKey: "error.transport_people_field_not_allowed" };
  }
  if (input.lane === "deliver" && (hasPeopleCount || hasPeopleCapacity)) {
    return { ok: false, errorKey: "error.transport_people_field_not_allowed" };
  }
  if (input.lane === "travel" && hasPeopleCount && input.postType !== "demand") {
    return { ok: false, errorKey: "error.transport_people_field_not_allowed" };
  }
  if (input.lane === "travel" && hasPeopleCapacity && input.postType !== "provider") {
    return { ok: false, errorKey: "error.transport_people_field_not_allowed" };
  }

  if (input.lane === "deliver" && hasTravelItemUnits) {
    return { ok: false, errorKey: "error.transport_travel_item_field_not_allowed" };
  }
  if (hasEscort && (input.lane !== "deliver" || input.postType !== "demand")) {
    return { ok: false, errorKey: "error.transport_escort_field_not_allowed" };
  }

  const countRead = readQuantity(input, "peopleCount");
  if (!countRead.ok) return countRead;
  const capacityRead = readQuantity(input, "peopleCapacity");
  if (!capacityRead.ok) return capacityRead;
  const itemsRead = readQuantity(input, "travelItemUnits");
  if (!itemsRead.ok) return itemsRead;
  const escortRead = readQuantity(input, "escortPassengerCount");
  if (!escortRead.ok) return escortRead;

  if (
    countRead.value !== null &&
    countRead.value > CAR_PEOPLE_COUNT_MAX
  ) {
    return { ok: false, errorKey: "error.transport_people_bounds" };
  }
  if (
    capacityRead.value !== null &&
    capacityRead.value > CAR_PEOPLE_CAPACITY_MAX
  ) {
    return { ok: false, errorKey: "error.transport_people_bounds" };
  }
  if (
    escortRead.value !== null &&
    escortRead.value > DELIVER_ESCORT_PASSENGER_MAX
  ) {
    return { ok: false, errorKey: "error.transport_escort_bounds" };
  }

  return {
    ok: true,
    peopleCount: countRead.value,
    peopleCapacity: capacityRead.value,
    travelItemUnits: itemsRead.value,
    escortPassengerCount: escortRead.value,
  };
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

  const declared = validateTransportDeclaredFields(input);
  if (!declared.ok) return declared;

  const peopleCount = declared.peopleCount;
  const peopleCapacity = declared.peopleCapacity;
  const isCar = input.mode === "car";

  const rejectNonCarPeople = (
    value: number | null,
  ): TransportValidationResult | null => {
    if (value !== null && !isCar && value > 0) {
      return { ok: false, errorKey: "error.transport_people_not_allowed" };
    }
    return null;
  };

  const countBound = rejectNonCarPeople(peopleCount);
  if (countBound) return countBound;
  const capacityBound = rejectNonCarPeople(peopleCapacity);
  if (capacityBound) return capacityBound;

  if (input.lane === "travel") {
    const people = peopleValueForCombo(
      input.postType,
      peopleCount,
      peopleCapacity,
    );
    const items = declared.travelItemUnits ?? 0;
    if (people > 0 && !isCar) {
      return { ok: false, errorKey: "error.transport_people_not_allowed" };
    }
    if (people === 0 && items === 0) {
      return { ok: false, errorKey: "error.transport_travel_empty" };
    }
  }

  return { ok: true };
}
