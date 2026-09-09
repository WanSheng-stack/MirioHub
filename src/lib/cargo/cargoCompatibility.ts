/**
 * PHASE 6.7B.1A.2 — Cargo V2 compatibility (advisory, never a fit guarantee).
 *
 * Not on the production runtime path. Server must re-read both snapshots
 * before any future accept decision. requiresHumanConfirmation is always true.
 */

import {
  CARGO_PRESET_CLEAR_EXCEED_RATIO,
  CARGO_PRESET_CLOSE_FIT_RATIO,
  CARGO_SPECIAL_HANDLING_FLAGS,
  type CargoDimensionsCm,
  type CargoHandlingFlag,
} from "@/lib/cargo/cargoPolicy";
import type {
  CargoCapacityV1,
  CargoItemV1,
  CargoLocationAccess,
  CargoRequirementV1,
} from "@/lib/cargo/cargoContract";
import {
  itemVolumeCm3,
  itemWeightKg,
  resolvedItemDimensions,
} from "@/lib/cargo/cargoContract";

export type CargoCompatibilityStatus =
  | "preliminarily_compatible"
  | "needs_confirmation"
  | "incompatible";

export type CargoCompatibilityReason =
  | "item_exceeds_space_dimensions"
  | "total_volume_exceeds_available_space"
  | "total_weight_exceeds_available_payload"
  | "item_dimensions_unknown"
  | "item_weight_unknown"
  | "provider_space_unknown"
  | "provider_payload_unknown"
  | "preset_dimensions_estimated"
  | "special_handling_required"
  | "loading_help_requires_confirmation"
  | "unloading_help_requires_confirmation"
  | "escort_requires_confirmation"
  | "stairs_or_elevator_confirmation"
  | "carry_distance_confirmation"
  | "bulky_shape_requires_confirmation"
  | "escort_not_available"
  | "loading_help_not_available"
  | "unloading_help_not_available";

export type CargoCompatibilityResult = {
  status: CargoCompatibilityStatus;
  reasons: CargoCompatibilityReason[];
  requiresHumanConfirmation: true;
};

const REASON_ORDER: readonly CargoCompatibilityReason[] = [
  "item_exceeds_space_dimensions",
  "total_volume_exceeds_available_space",
  "total_weight_exceeds_available_payload",
  "escort_not_available",
  "loading_help_not_available",
  "unloading_help_not_available",
  "item_dimensions_unknown",
  "item_weight_unknown",
  "provider_space_unknown",
  "provider_payload_unknown",
  "preset_dimensions_estimated",
  "special_handling_required",
  "bulky_shape_requires_confirmation",
  "loading_help_requires_confirmation",
  "unloading_help_requires_confirmation",
  "escort_requires_confirmation",
  "stairs_or_elevator_confirmation",
  "carry_distance_confirmation",
];

export function sortedDimensions(
  dims: CargoDimensionsCm,
): [number, number, number] {
  return [dims.length, dims.width, dims.height]
    .slice()
    .sort((a, b) => a - b) as [number, number, number];
}

function customFitsInSpace(
  item: CargoDimensionsCm,
  space: CargoDimensionsCm,
): boolean {
  const a = sortedDimensions(item);
  const b = sortedDimensions(space);
  return a[0] <= b[0] && a[1] <= b[1] && a[2] <= b[2];
}

function presetFit(
  item: CargoDimensionsCm,
  space: CargoDimensionsCm,
): "fits" | "close" | "clear_exceed" {
  const a = sortedDimensions(item);
  const b = sortedDimensions(space);
  const exceeds = a[0] > b[0] || a[1] > b[1] || a[2] > b[2];
  if (exceeds) {
    const clearly =
      a[0] > b[0] * CARGO_PRESET_CLEAR_EXCEED_RATIO ||
      a[1] > b[1] * CARGO_PRESET_CLEAR_EXCEED_RATIO ||
      a[2] > b[2] * CARGO_PRESET_CLEAR_EXCEED_RATIO;
    return clearly ? "clear_exceed" : "close";
  }
  const close =
    a[0] > b[0] * CARGO_PRESET_CLOSE_FIT_RATIO ||
    a[1] > b[1] * CARGO_PRESET_CLOSE_FIT_RATIO ||
    a[2] > b[2] * CARGO_PRESET_CLOSE_FIT_RATIO;
  return close ? "close" : "fits";
}

function accessNeedsStairsConfirm(access: CargoLocationAccess): boolean {
  if (access.level === null) return true;
  if (access.elevator === "unknown") return true;
  return access.level > 0 && access.elevator === "unavailable";
}

function carryUnknown(access: CargoLocationAccess): boolean {
  return access.carryDistanceMeters === undefined || access.carryDistanceMeters === null;
}

function specialFlagsOf(item: CargoItemV1): CargoHandlingFlag[] {
  return item.handlingFlags.filter((flag) =>
    (CARGO_SPECIAL_HANDLING_FLAGS as readonly string[]).includes(flag),
  );
}

function finalize(
  hard: Set<CargoCompatibilityReason>,
  soft: Set<CargoCompatibilityReason>,
): CargoCompatibilityResult {
  const reasons = REASON_ORDER.filter(
    (reason) => hard.has(reason) || soft.has(reason),
  );
  return {
    status: hard.size > 0
      ? "incompatible"
      : soft.size > 0
        ? "needs_confirmation"
        : "preliminarily_compatible",
    reasons,
    requiresHumanConfirmation: true,
  };
}

export function evaluateCargoCompatibility(
  requirement: CargoRequirementV1,
  capacity: CargoCapacityV1,
): CargoCompatibilityResult {
  const hard = new Set<CargoCompatibilityReason>();
  const soft = new Set<CargoCompatibilityReason>();

  const spaceKnown = capacity.availableSpace.kind === "known";
  const payloadKnown = capacity.availablePayloadKg.kind === "known";
  if (!spaceKnown) soft.add("provider_space_unknown");
  if (!payloadKnown) soft.add("provider_payload_unknown");

  let allDimsKnown = true;
  let allCustom = true;
  let allWeightKnown = true;
  let totalVolume = 0;
  let totalWeight = 0;

  for (const item of requirement.items) {
    if (item.measurement.kind === "unknown") {
      allDimsKnown = false;
      soft.add("item_dimensions_unknown");
    }
    if (item.measurement.kind === "preset") {
      allCustom = false;
      soft.add("preset_dimensions_estimated");
    }
    if (item.weight.kind === "unknown") {
      allWeightKnown = false;
      soft.add("item_weight_unknown");
    }
    if (item.handlingFlags.includes("oversized_shape")) {
      soft.add("bulky_shape_requires_confirmation");
    }
    if (specialFlagsOf(item).length > 0) {
      soft.add("special_handling_required");
    }

    const dims = resolvedItemDimensions(item);
    if (dims && spaceKnown && capacity.availableSpace.kind === "known") {
      const space = capacity.availableSpace.dimensionsCm;
      if (item.measurement.kind === "custom") {
        if (!customFitsInSpace(dims, space)) {
          hard.add("item_exceeds_space_dimensions");
        }
      } else if (item.measurement.kind === "preset") {
        const fit = presetFit(dims, space);
        if (fit === "clear_exceed") hard.add("item_exceeds_space_dimensions");
        else if (fit === "close") soft.add("preset_dimensions_estimated");
      }
      const volume = itemVolumeCm3(dims, item.quantity);
      if (!Number.isFinite(volume)) hard.add("total_volume_exceeds_available_space");
      else totalVolume += volume;
    }

    const weight = itemWeightKg(item);
    if (weight !== null) {
      if (!Number.isFinite(weight)) {
        hard.add("total_weight_exceeds_available_payload");
      } else {
        totalWeight += weight;
      }
    }
  }

  if (allDimsKnown && spaceKnown && capacity.availableSpace.kind === "known") {
    const available =
      capacity.availableSpace.dimensionsCm.length *
      capacity.availableSpace.dimensionsCm.width *
      capacity.availableSpace.dimensionsCm.height;
    if (Number.isFinite(available) && totalVolume > available) {
      if (allCustom) hard.add("total_volume_exceeds_available_space");
      else if (totalVolume > available * CARGO_PRESET_CLEAR_EXCEED_RATIO) {
        hard.add("total_volume_exceeds_available_space");
      } else {
        soft.add("preset_dimensions_estimated");
      }
    }
  }

  if (allWeightKnown && payloadKnown && capacity.availablePayloadKg.kind === "known") {
    if (totalWeight > capacity.availablePayloadKg.kg) {
      hard.add("total_weight_exceeds_available_payload");
    }
  }

  if (requirement.escortPassengerCount === 1) {
    if (capacity.escortAccommodation === "not_available") {
      hard.add("escort_not_available");
    } else if (capacity.escortAccommodation === "requires_confirmation") {
      soft.add("escort_requires_confirmation");
    }
  }

  if (requirement.pickupHandling === "request_provider_help") {
    if (capacity.loadingHelp === "not_available") {
      hard.add("loading_help_not_available");
    } else if (capacity.loadingHelp === "requires_confirmation") {
      soft.add("loading_help_requires_confirmation");
    }
    if (carryUnknown(requirement.pickupAccess)) {
      soft.add("carry_distance_confirmation");
    }
  }
  if (requirement.dropoffHandling === "request_provider_help") {
    if (capacity.unloadingHelp === "not_available") {
      hard.add("unloading_help_not_available");
    } else if (capacity.unloadingHelp === "requires_confirmation") {
      soft.add("unloading_help_requires_confirmation");
    }
    if (carryUnknown(requirement.dropoffAccess)) {
      soft.add("carry_distance_confirmation");
    }
  }

  if (
    accessNeedsStairsConfirm(requirement.pickupAccess) ||
    accessNeedsStairsConfirm(requirement.dropoffAccess)
  ) {
    soft.add("stairs_or_elevator_confirmation");
  }

  return finalize(hard, soft);
}
