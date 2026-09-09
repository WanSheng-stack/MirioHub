/**
 * PHASE 6.7B.1A.2 — centralized Cargo V2 policy numbers.
 *
 * Advisory only. Thresholds may be recalibrated from real usage later.
 * They are not a load-fit guarantee, vehicle verification, or insurance.
 * Do not scatter these numbers in UI or compatibility code.
 *
 * This module is not on the production runtime path.
 */

import type { TargetDeliverTransportMode } from "@/lib/transport/transportPolicy";

export const CARGO_CONTRACT_VERSION = 1 as const;

export const CARGO_ITEM_MIN = 1;
export const CARGO_ITEM_MAX = 20;
export const CARGO_QUANTITY_MIN = 1;
export const CARGO_QUANTITY_MAX = 99;
export const CARGO_DIMENSION_CM_MIN = 1;
export const CARGO_DIMENSION_CM_MAX = 2000;
export const CARGO_WEIGHT_KG_MAX = 10_000;
export const CARGO_PAYLOAD_KG_MAX = 50_000;
export const CARGO_NOTE_MAX = 300;
export const CARGO_DESCRIPTION_MAX = 120;
export const CARGO_LEVEL_MIN = -5;
export const CARGO_LEVEL_MAX = 100;
export const CARGO_CARRY_DISTANCE_M_MAX = 5000;
export const CARGO_HANDLING_FLAG_MAX = 9;
export const CARGO_ESCORT_MAX = 1;

export const CARGO_ITEM_CATEGORIES = [
  "moving_box",
  "suitcase",
  "furniture",
  "appliance",
  "mattress",
  "bicycle",
  "building_material",
  "equipment",
  "other",
] as const;

export const CARGO_SIZE_PRESETS = [
  "box_small",
  "box_medium",
  "box_large",
  "suitcase",
  "chair",
  "small_table",
  "mattress_single",
  "mattress_double",
  "washing_machine",
  "refrigerator",
  "sofa_2_seat",
  "sofa_3_seat",
] as const;

export const CARGO_HANDLING_FLAGS = [
  "fragile",
  "keep_upright",
  "oversized_shape",
  "valuable",
  "liquid",
  "contains_battery",
  "temperature_sensitive",
  "disassembly_required",
  "two_person_lift",
] as const;

export const CARGO_SPECIAL_HANDLING_FLAGS = [
  "valuable",
  "liquid",
  "contains_battery",
  "temperature_sensitive",
  "oversized_shape",
] as const;

export const CARGO_HANDLING_REQUESTS = [
  "self",
  "request_provider_help",
  "third_party_arranged",
] as const;

export const CARGO_ELEVATOR_STATES = [
  "available",
  "unavailable",
  "unknown",
] as const;

export const CARGO_SUPPORT_LEVELS = [
  "available",
  "not_available",
  "requires_confirmation",
] as const;

export const CARGO_ESCORT_ACCOMMODATIONS = [
  "available",
  "not_available",
  "requires_confirmation",
] as const;

export const CARGO_VEHICLE_CLASSES = [
  "small_cargo_van",
  "medium_cargo_van",
  "large_cargo_van",
  "light_truck",
  "box_truck",
  "vehicle_with_trailer",
  "other_road_cargo",
  "cargo_boat",
  "private_cargo_boat",
  "other_water_cargo",
] as const;

export type CargoItemCategory = (typeof CARGO_ITEM_CATEGORIES)[number];
export type CargoSizePreset = (typeof CARGO_SIZE_PRESETS)[number];
export type CargoHandlingFlag = (typeof CARGO_HANDLING_FLAGS)[number];
export type CargoHandlingRequest = (typeof CARGO_HANDLING_REQUESTS)[number];
export type CargoElevatorState = (typeof CARGO_ELEVATOR_STATES)[number];
export type CargoSupportLevel = (typeof CARGO_SUPPORT_LEVELS)[number];
export type CargoEscortAccommodation =
  (typeof CARGO_ESCORT_ACCOMMODATIONS)[number];
export type CargoVehicleClass = (typeof CARGO_VEHICLE_CLASSES)[number];

export type CargoDimensionsCm = {
  length: number;
  width: number;
  height: number;
};

/**
 * Recommended outer-box estimates in centimetres. Not a fit guarantee.
 * Preset matches that look numerically loadable still need human confirmation.
 */
export const CARGO_PRESET_DIMENSIONS_CM: Record<
  CargoSizePreset,
  CargoDimensionsCm
> = {
  box_small: { length: 40, width: 30, height: 30 },
  box_medium: { length: 50, width: 40, height: 40 },
  box_large: { length: 70, width: 50, height: 50 },
  suitcase: { length: 70, width: 45, height: 30 },
  chair: { length: 50, width: 50, height: 90 },
  small_table: { length: 80, width: 80, height: 75 },
  mattress_single: { length: 200, width: 90, height: 25 },
  mattress_double: { length: 200, width: 140, height: 25 },
  washing_machine: { length: 60, width: 60, height: 85 },
  refrigerator: { length: 70, width: 70, height: 180 },
  sofa_2_seat: { length: 160, width: 90, height: 90 },
  sofa_3_seat: { length: 220, width: 95, height: 95 },
};

const ROAD_CLASSES = new Set<CargoVehicleClass>([
  "small_cargo_van",
  "medium_cargo_van",
  "large_cargo_van",
  "light_truck",
  "box_truck",
  "vehicle_with_trailer",
  "other_road_cargo",
]);

const WATER_CLASSES = new Set<CargoVehicleClass>([
  "cargo_boat",
  "private_cargo_boat",
  "other_water_cargo",
]);

export const CARGO_MODE_TO_VEHICLE_CLASSES: Record<
  TargetDeliverTransportMode,
  readonly CargoVehicleClass[]
> = {
  cargo_van: ["small_cargo_van", "medium_cargo_van", "large_cargo_van"],
  light_truck: ["light_truck"],
  box_truck: ["box_truck"],
  vehicle_with_trailer: ["vehicle_with_trailer"],
  other_cargo_vehicle: ["other_road_cargo"],
  cargo_boat: ["cargo_boat", "other_water_cargo"],
  private_cargo_boat: ["private_cargo_boat", "other_water_cargo"],
};

export function isRoadCargoVehicleClass(cls: CargoVehicleClass): boolean {
  return ROAD_CLASSES.has(cls);
}

export function isWaterCargoVehicleClass(cls: CargoVehicleClass): boolean {
  return WATER_CLASSES.has(cls);
}

export function isTransportModeVehicleClassCompatible(
  mode: TargetDeliverTransportMode,
  cls: CargoVehicleClass,
): boolean {
  return CARGO_MODE_TO_VEHICLE_CLASSES[mode].includes(cls);
}

/**
 * Advisory volume / weight / longest-side bands for Demand form help.
 * Recalibrate from usage later. Not a hard deny and not copied from
 * any third-party fleet catalog.
 */
export const CARGO_RECOMMENDATION_THRESHOLDS = {
  smallCargoVan: {
    maxVolumeCm3: 3_000_000,
    maxPayloadKg: 500,
    maxLongestSideCm: 180,
  },
  mediumCargoVan: {
    maxVolumeCm3: 8_000_000,
    maxPayloadKg: 1_000,
    maxLongestSideCm: 250,
  },
  largeCargoVan: {
    maxVolumeCm3: 15_000_000,
    maxPayloadKg: 1_500,
    maxLongestSideCm: 320,
  },
  lightTruck: {
    maxVolumeCm3: 25_000_000,
    maxPayloadKg: 3_000,
    maxLongestSideCm: 420,
  },
  boxTruck: {
    maxVolumeCm3: 40_000_000,
    maxPayloadKg: 8_000,
    maxLongestSideCm: 600,
  },
} as const;

/** Preset vs remaining space: clearly larger than this ratio → incompatible. */
export const CARGO_PRESET_CLEAR_EXCEED_RATIO = 1.15;
/** Preset vs remaining space: within this fraction of a side → confirmation. */
export const CARGO_PRESET_CLOSE_FIT_RATIO = 0.9;

export const CARGO_BULKY_CATEGORIES = new Set<CargoItemCategory>([
  "furniture",
  "appliance",
  "mattress",
  "equipment",
  "building_material",
]);
