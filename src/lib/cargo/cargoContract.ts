/**
 * PHASE 6.7B.1A.2 — Cargo V2 domain contracts and strict parsers.
 *
 * Not a database schema. Not on the production runtime path.
 * Parsers do not write to the database and do not trust browser input.
 * TypeScript types are not an authorization boundary; runtime parse is.
 */

import {
  isTargetDeliverTransportMode,
  type TargetDeliverTransportMode,
} from "@/lib/transport/transportPolicy";
import {
  CARGO_BULKY_CATEGORIES,
  CARGO_CARRY_DISTANCE_M_MAX,
  CARGO_CONTRACT_VERSION,
  CARGO_DESCRIPTION_MAX,
  CARGO_DIMENSION_CM_MAX,
  CARGO_DIMENSION_CM_MIN,
  CARGO_ELEVATOR_STATES,
  CARGO_ESCORT_ACCOMMODATIONS,
  CARGO_HANDLING_FLAG_MAX,
  CARGO_HANDLING_FLAGS,
  CARGO_HANDLING_REQUESTS,
  CARGO_ITEM_CATEGORIES,
  CARGO_ITEM_MAX,
  CARGO_ITEM_MIN,
  CARGO_LEVEL_MAX,
  CARGO_LEVEL_MIN,
  CARGO_NOTE_MAX,
  CARGO_PAYLOAD_KG_MAX,
  CARGO_PRESET_DIMENSIONS_CM,
  CARGO_QUANTITY_MAX,
  CARGO_QUANTITY_MIN,
  CARGO_RECOMMENDATION_THRESHOLDS,
  CARGO_SIZE_PRESETS,
  CARGO_SUPPORT_LEVELS,
  CARGO_VEHICLE_CLASSES,
  CARGO_WEIGHT_KG_MAX,
  isTransportModeVehicleClassCompatible,
  type CargoDimensionsCm,
  type CargoElevatorState,
  type CargoEscortAccommodation,
  type CargoHandlingFlag,
  type CargoHandlingRequest,
  type CargoItemCategory,
  type CargoSizePreset,
  type CargoSupportLevel,
  type CargoVehicleClass,
} from "@/lib/cargo/cargoPolicy";

export type {
  CargoDimensionsCm,
  CargoElevatorState,
  CargoEscortAccommodation,
  CargoHandlingFlag,
  CargoHandlingRequest,
  CargoItemCategory,
  CargoSizePreset,
  CargoSupportLevel,
  CargoVehicleClass,
};

export type CargoParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errorKey: string; field?: string };

export type CargoMeasurement =
  | { kind: "custom"; dimensionsCm: CargoDimensionsCm }
  | { kind: "preset"; preset: CargoSizePreset }
  | { kind: "unknown" };

export type CargoWeight =
  | { kind: "known"; kgPerUnit: number }
  | { kind: "unknown" };

export type CargoItemV1 = {
  category: CargoItemCategory;
  description?: string;
  quantity: number;
  measurement: CargoMeasurement;
  weight: CargoWeight;
  handlingFlags: CargoHandlingFlag[];
};

export type CargoLocationAccess = {
  level: number | null;
  elevator: CargoElevatorState;
  carryDistanceMeters?: number | null;
};

export type CargoRequirementV1 = {
  version: 1;
  items: CargoItemV1[];
  requestedVehicleClass?: CargoVehicleClass | null;
  pickupHandling: CargoHandlingRequest;
  dropoffHandling: CargoHandlingRequest;
  pickupAccess: CargoLocationAccess;
  dropoffAccess: CargoLocationAccess;
  escortPassengerCount: 0 | 1;
  note?: string;
};

export type CargoAvailableSpace =
  | { kind: "known"; dimensionsCm: CargoDimensionsCm }
  | { kind: "unknown" };

export type CargoPayloadKg =
  | { kind: "known"; kg: number }
  | { kind: "unknown" };

export type CargoCapacityV1 = {
  version: 1;
  basis: "current_trip_available_space";
  transportMode: TargetDeliverTransportMode;
  vehicleClass: CargoVehicleClass;
  availableSpace: CargoAvailableSpace;
  availablePayloadKg: CargoPayloadKg;
  loadingHelp: CargoSupportLevel;
  unloadingHelp: CargoSupportLevel;
  escortAccommodation: CargoEscortAccommodation;
  supportedHandlingFlags: CargoHandlingFlag[];
  note?: string;
};

export type CargoRecommendationReason =
  | "insufficient_dimensions"
  | "insufficient_weight"
  | "advisory_small_cargo_van"
  | "advisory_medium_cargo_van"
  | "advisory_large_cargo_van"
  | "advisory_light_truck"
  | "advisory_box_truck"
  | "advisory_vehicle_with_trailer"
  | "advisory_water_cargo"
  | "bulky_item_human_confirm"
  | "valuable_item_human_confirm"
  | "estimated_preset_only";

export type CargoVehicleRecommendation = {
  recommendedClass: CargoVehicleClass | null;
  confidence: "estimated" | "insufficient_data";
  reasons: CargoRecommendationReason[];
};

const REQUIREMENT_KEYS = new Set([
  "version",
  "items",
  "requestedVehicleClass",
  "pickupHandling",
  "dropoffHandling",
  "pickupAccess",
  "dropoffAccess",
  "escortPassengerCount",
  "note",
]);

const ITEM_KEYS = new Set([
  "category",
  "description",
  "quantity",
  "measurement",
  "weight",
  "handlingFlags",
]);

const MEASUREMENT_CUSTOM_KEYS = new Set(["kind", "dimensionsCm"]);
const MEASUREMENT_PRESET_KEYS = new Set(["kind", "preset"]);
const MEASUREMENT_UNKNOWN_KEYS = new Set(["kind"]);
const DIMENSION_KEYS = new Set(["length", "width", "height"]);
const WEIGHT_KNOWN_KEYS = new Set(["kind", "kgPerUnit"]);
const WEIGHT_UNKNOWN_KEYS = new Set(["kind"]);
const ACCESS_KEYS = new Set(["level", "elevator", "carryDistanceMeters"]);
const CAPACITY_KEYS = new Set([
  "version",
  "basis",
  "transportMode",
  "vehicleClass",
  "availableSpace",
  "availablePayloadKg",
  "loadingHelp",
  "unloadingHelp",
  "escortAccommodation",
  "supportedHandlingFlags",
  "note",
]);
const SPACE_KNOWN_KEYS = new Set(["kind", "dimensionsCm"]);
const SPACE_UNKNOWN_KEYS = new Set(["kind"]);
const PAYLOAD_KNOWN_KEYS = new Set(["kind", "kg"]);
const PAYLOAD_UNKNOWN_KEYS = new Set(["kind"]);

const FORBIDDEN_KEY_ALIASES = new Set(
  [
    "userid",
    "user_id",
    "postid",
    "post_id",
    "phone",
    "email",
    "plate",
    "licenseplate",
    "license_plate",
    "address",
    "originaddress",
    "origin_address",
    "destinationaddress",
    "destination_address",
    "gps",
    "lat",
    "lng",
    "latitude",
    "longitude",
    "fee",
    "bid",
    "payment",
    "photo",
    "photourl",
    "photo_url",
    "imageurl",
    "image_url",
    "pickupcode",
    "pickup_code",
    "deliverycode",
    "delivery_code",
    "code",
    "hazardous",
    "dangerous_goods",
    "dangerousgoods",
    "weapon",
    "illegal_goods",
    "illegalgoods",
    "contraband",
    "explosive",
    "flammable",
    "identity",
    "idcard",
    "id_card",
    "passport",
  ].map((k) => k.toLowerCase()),
);

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function fail<T>(errorKey: string, field?: string): CargoParseResult<T> {
  return field ? { ok: false, errorKey, field } : { ok: false, errorKey };
}

function ok<T>(value: T): CargoParseResult<T> {
  return { ok: true, value };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ownKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value);
}

function normalizeKey(key: string): string {
  return key.replace(/[\s-]/g, "").toLowerCase();
}

function scanForbidden(value: unknown, path: string): CargoParseResult<true> {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const nested = scanForbidden(value[i], `${path}.${i}`);
      if (!nested.ok) return nested;
    }
    return ok(true);
  }
  if (!isPlainObject(value)) return ok(true);
  for (const key of ownKeys(value)) {
    if (FORBIDDEN_KEY_ALIASES.has(normalizeKey(key))) {
      return fail("error.cargo_private_field_forbidden", `${path}.${key}`);
    }
    const nested = scanForbidden(value[key], `${path}.${key}`);
    if (!nested.ok) return nested;
  }
  return ok(true);
}

function rejectUnknownKeys(
  rec: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
): CargoParseResult<true> {
  for (const key of ownKeys(rec)) {
    if (!allowed.has(key)) {
      return fail("error.cargo_unknown_key", `${path}.${key}`);
    }
  }
  return ok(true);
}

function parseTrimmedString(
  value: unknown,
  field: string,
  max: number,
  required: boolean,
): CargoParseResult<string | undefined> {
  if (value === undefined || value === null) {
    return required
      ? fail("error.cargo_description_required", field)
      : ok(undefined);
  }
  if (typeof value !== "string") {
    return fail("error.cargo_invalid_payload", field);
  }
  if (CONTROL_CHARS.test(value)) {
    return fail("error.cargo_invalid_payload", field);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return required
      ? fail("error.cargo_description_required", field)
      : ok(undefined);
  }
  if (trimmed.length > max) {
    return fail(
      required ? "error.cargo_description_required" : "error.cargo_invalid_payload",
      field,
    );
  }
  return ok(trimmed);
}

function isSafeInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value)
  );
}

function atMostOneDecimal(value: number): boolean {
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;
}

function parseDimensionCm(
  value: unknown,
  field: string,
): CargoParseResult<number> {
  if (!isSafeInt(value)) {
    return fail("error.cargo_invalid_dimensions", field);
  }
  if (value < CARGO_DIMENSION_CM_MIN || value > CARGO_DIMENSION_CM_MAX) {
    return fail("error.cargo_invalid_dimensions", field);
  }
  return ok(value);
}

function parseDimensionsCm(
  value: unknown,
  path: string,
): CargoParseResult<CargoDimensionsCm> {
  if (!isPlainObject(value)) {
    return fail("error.cargo_invalid_dimensions", path);
  }
  const keys = rejectUnknownKeys(value, DIMENSION_KEYS, path);
  if (!keys.ok) return keys;
  const length = parseDimensionCm(value.length, `${path}.length`);
  if (!length.ok) return length;
  const width = parseDimensionCm(value.width, `${path}.width`);
  if (!width.ok) return width;
  const height = parseDimensionCm(value.height, `${path}.height`);
  if (!height.ok) return height;
  return ok({
    length: length.value,
    width: width.value,
    height: height.value,
  });
}

function parseMeasurement(
  value: unknown,
  path: string,
): CargoParseResult<CargoMeasurement> {
  if (!isPlainObject(value)) {
    return fail("error.cargo_invalid_dimensions", path);
  }
  if (value.kind === "custom") {
    const keys = rejectUnknownKeys(value, MEASUREMENT_CUSTOM_KEYS, path);
    if (!keys.ok) return keys;
    const dims = parseDimensionsCm(value.dimensionsCm, `${path}.dimensionsCm`);
    if (!dims.ok) return dims;
    return ok({ kind: "custom", dimensionsCm: dims.value });
  }
  if (value.kind === "preset") {
    const keys = rejectUnknownKeys(value, MEASUREMENT_PRESET_KEYS, path);
    if (!keys.ok) return keys;
    if (
      typeof value.preset !== "string" ||
      !(CARGO_SIZE_PRESETS as readonly string[]).includes(value.preset)
    ) {
      return fail("error.cargo_invalid_dimensions", `${path}.preset`);
    }
    return ok({ kind: "preset", preset: value.preset as CargoSizePreset });
  }
  if (value.kind === "unknown") {
    const keys = rejectUnknownKeys(value, MEASUREMENT_UNKNOWN_KEYS, path);
    if (!keys.ok) return keys;
    return ok({ kind: "unknown" });
  }
  return fail("error.cargo_invalid_dimensions", `${path}.kind`);
}

function parseUnitWeight(
  value: unknown,
  field: string,
  max: number,
): CargoParseResult<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail("error.cargo_invalid_weight", field);
  }
  if (value <= 0 || value > max || !atMostOneDecimal(value)) {
    return fail("error.cargo_invalid_weight", field);
  }
  return ok(value);
}

function parseWeight(value: unknown, path: string): CargoParseResult<CargoWeight> {
  if (!isPlainObject(value)) {
    return fail("error.cargo_invalid_weight", path);
  }
  if (value.kind === "known") {
    const keys = rejectUnknownKeys(value, WEIGHT_KNOWN_KEYS, path);
    if (!keys.ok) return keys;
    const kg = parseUnitWeight(
      value.kgPerUnit,
      `${path}.kgPerUnit`,
      CARGO_WEIGHT_KG_MAX,
    );
    if (!kg.ok) return kg;
    return ok({ kind: "known", kgPerUnit: kg.value });
  }
  if (value.kind === "unknown") {
    const keys = rejectUnknownKeys(value, WEIGHT_UNKNOWN_KEYS, path);
    if (!keys.ok) return keys;
    return ok({ kind: "unknown" });
  }
  return fail("error.cargo_invalid_weight", `${path}.kind`);
}

function parseHandlingFlags(
  value: unknown,
  path: string,
): CargoParseResult<CargoHandlingFlag[]> {
  if (!Array.isArray(value)) {
    return fail("error.cargo_invalid_handling_flag", path);
  }
  if (value.length > CARGO_HANDLING_FLAG_MAX) {
    return fail("error.cargo_invalid_handling_flag", path);
  }
  const seen = new Set<string>();
  for (const flag of value) {
    if (
      typeof flag !== "string" ||
      !(CARGO_HANDLING_FLAGS as readonly string[]).includes(flag)
    ) {
      return fail("error.cargo_invalid_handling_flag", path);
    }
    if (seen.has(flag)) {
      return fail("error.cargo_invalid_handling_flag", path);
    }
    seen.add(flag);
  }
  return ok(CARGO_HANDLING_FLAGS.filter((flag) => seen.has(flag)));
}

function parseItem(value: unknown, path: string): CargoParseResult<CargoItemV1> {
  if (!isPlainObject(value)) {
    return fail("error.cargo_invalid_payload", path);
  }
  const keys = rejectUnknownKeys(value, ITEM_KEYS, path);
  if (!keys.ok) return keys;
  if (
    typeof value.category !== "string" ||
    !(CARGO_ITEM_CATEGORIES as readonly string[]).includes(value.category)
  ) {
    return fail("error.cargo_invalid_category", `${path}.category`);
  }
  const category = value.category as CargoItemCategory;
  const description = parseTrimmedString(
    value.description,
    `${path}.description`,
    CARGO_DESCRIPTION_MAX,
    category === "other",
  );
  if (!description.ok) return description;
  if (!isSafeInt(value.quantity)) {
    return fail("error.cargo_invalid_quantity", `${path}.quantity`);
  }
  if (
    value.quantity < CARGO_QUANTITY_MIN ||
    value.quantity > CARGO_QUANTITY_MAX
  ) {
    return fail("error.cargo_invalid_quantity", `${path}.quantity`);
  }
  const measurement = parseMeasurement(value.measurement, `${path}.measurement`);
  if (!measurement.ok) return measurement;
  const weight = parseWeight(value.weight, `${path}.weight`);
  if (!weight.ok) return weight;
  const flags = parseHandlingFlags(value.handlingFlags, `${path}.handlingFlags`);
  if (!flags.ok) return flags;
  const item: CargoItemV1 = {
    category,
    quantity: value.quantity,
    measurement: measurement.value,
    weight: weight.value,
    handlingFlags: flags.value,
  };
  if (description.value !== undefined) item.description = description.value;
  return ok(item);
}

function parseAccess(
  value: unknown,
  path: string,
): CargoParseResult<CargoLocationAccess> {
  if (!isPlainObject(value)) {
    return fail("error.cargo_invalid_access", path);
  }
  const keys = rejectUnknownKeys(value, ACCESS_KEYS, path);
  if (!keys.ok) return keys;
  let level: number | null;
  if (value.level === null) {
    level = null;
  } else if (!isSafeInt(value.level)) {
    return fail("error.cargo_invalid_access", `${path}.level`);
  } else if (value.level < CARGO_LEVEL_MIN || value.level > CARGO_LEVEL_MAX) {
    return fail("error.cargo_invalid_access", `${path}.level`);
  } else {
    level = value.level;
  }
  if (
    typeof value.elevator !== "string" ||
    !(CARGO_ELEVATOR_STATES as readonly string[]).includes(value.elevator)
  ) {
    return fail("error.cargo_invalid_access", `${path}.elevator`);
  }
  const access: CargoLocationAccess = {
    level,
    elevator: value.elevator as CargoElevatorState,
  };
  if (value.carryDistanceMeters !== undefined) {
    if (value.carryDistanceMeters === null) {
      access.carryDistanceMeters = null;
    } else if (
      !isSafeInt(value.carryDistanceMeters) ||
      value.carryDistanceMeters < 0 ||
      value.carryDistanceMeters > CARGO_CARRY_DISTANCE_M_MAX
    ) {
      return fail("error.cargo_invalid_access", `${path}.carryDistanceMeters`);
    } else {
      access.carryDistanceMeters = value.carryDistanceMeters;
    }
  }
  return ok(access);
}

function parseNote(
  value: unknown,
  field: string,
): CargoParseResult<string | undefined> {
  if (value === undefined) return ok(undefined);
  if (typeof value !== "string") {
    return fail("error.cargo_invalid_payload", field);
  }
  if (CONTROL_CHARS.test(value)) {
    return fail("error.cargo_invalid_payload", field);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return ok(undefined);
  if (trimmed.length > CARGO_NOTE_MAX) {
    return fail("error.cargo_invalid_payload", field);
  }
  return ok(trimmed);
}

export function parseCargoRequirementV1(
  input: unknown,
): CargoParseResult<CargoRequirementV1> {
  if (!isPlainObject(input)) {
    return fail("error.cargo_invalid_payload");
  }
  const forbidden = scanForbidden(input, "requirement");
  if (!forbidden.ok) return forbidden;
  const keys = rejectUnknownKeys(input, REQUIREMENT_KEYS, "requirement");
  if (!keys.ok) return keys;
  if (input.version !== CARGO_CONTRACT_VERSION) {
    return fail("error.cargo_invalid_payload", "requirement.version");
  }
  if (!Array.isArray(input.items)) {
    return fail("error.cargo_items_required", "requirement.items");
  }
  if (input.items.length < CARGO_ITEM_MIN) {
    return fail("error.cargo_items_required", "requirement.items");
  }
  if (input.items.length > CARGO_ITEM_MAX) {
    return fail("error.cargo_too_many_items", "requirement.items");
  }
  const items: CargoItemV1[] = [];
  for (let i = 0; i < input.items.length; i += 1) {
    const item = parseItem(input.items[i], `requirement.items.${i}`);
    if (!item.ok) return item;
    items.push(item.value);
  }
  if (
    typeof input.pickupHandling !== "string" ||
    !(CARGO_HANDLING_REQUESTS as readonly string[]).includes(input.pickupHandling)
  ) {
    return fail("error.cargo_invalid_payload", "requirement.pickupHandling");
  }
  if (
    typeof input.dropoffHandling !== "string" ||
    !(CARGO_HANDLING_REQUESTS as readonly string[]).includes(input.dropoffHandling)
  ) {
    return fail("error.cargo_invalid_payload", "requirement.dropoffHandling");
  }
  const pickupAccess = parseAccess(input.pickupAccess, "requirement.pickupAccess");
  if (!pickupAccess.ok) return pickupAccess;
  const dropoffAccess = parseAccess(
    input.dropoffAccess,
    "requirement.dropoffAccess",
  );
  if (!dropoffAccess.ok) return dropoffAccess;
  if (input.escortPassengerCount !== 0 && input.escortPassengerCount !== 1) {
    return fail("error.cargo_invalid_escort", "requirement.escortPassengerCount");
  }
  let requestedVehicleClass: CargoVehicleClass | null | undefined;
  if (input.requestedVehicleClass !== undefined) {
    if (input.requestedVehicleClass === null) {
      requestedVehicleClass = null;
    } else if (
      typeof input.requestedVehicleClass !== "string" ||
      !(CARGO_VEHICLE_CLASSES as readonly string[]).includes(
        input.requestedVehicleClass,
      )
    ) {
      return fail(
        "error.cargo_invalid_vehicle_class",
        "requirement.requestedVehicleClass",
      );
    } else {
      requestedVehicleClass = input.requestedVehicleClass as CargoVehicleClass;
    }
  }
  const note = parseNote(input.note, "requirement.note");
  if (!note.ok) return note;
  const parsed: CargoRequirementV1 = {
    version: 1,
    items,
    pickupHandling: input.pickupHandling as CargoHandlingRequest,
    dropoffHandling: input.dropoffHandling as CargoHandlingRequest,
    pickupAccess: pickupAccess.value,
    dropoffAccess: dropoffAccess.value,
    escortPassengerCount: input.escortPassengerCount,
  };
  if (requestedVehicleClass !== undefined) {
    parsed.requestedVehicleClass = requestedVehicleClass;
  }
  if (note.value !== undefined) parsed.note = note.value;
  return ok(parsed);
}

function parseAvailableSpace(
  value: unknown,
  path: string,
): CargoParseResult<CargoAvailableSpace> {
  if (!isPlainObject(value)) {
    return fail("error.cargo_invalid_dimensions", path);
  }
  if (value.kind === "known") {
    const keys = rejectUnknownKeys(value, SPACE_KNOWN_KEYS, path);
    if (!keys.ok) return keys;
    const dims = parseDimensionsCm(value.dimensionsCm, `${path}.dimensionsCm`);
    if (!dims.ok) return dims;
    return ok({ kind: "known", dimensionsCm: dims.value });
  }
  if (value.kind === "unknown") {
    const keys = rejectUnknownKeys(value, SPACE_UNKNOWN_KEYS, path);
    if (!keys.ok) return keys;
    return ok({ kind: "unknown" });
  }
  return fail("error.cargo_invalid_dimensions", `${path}.kind`);
}

function parsePayloadKg(
  value: unknown,
  path: string,
): CargoParseResult<CargoPayloadKg> {
  if (!isPlainObject(value)) {
    return fail("error.cargo_invalid_weight", path);
  }
  if (value.kind === "known") {
    const keys = rejectUnknownKeys(value, PAYLOAD_KNOWN_KEYS, path);
    if (!keys.ok) return keys;
    const kg = parseUnitWeight(value.kg, `${path}.kg`, CARGO_PAYLOAD_KG_MAX);
    if (!kg.ok) return kg;
    return ok({ kind: "known", kg: kg.value });
  }
  if (value.kind === "unknown") {
    const keys = rejectUnknownKeys(value, PAYLOAD_UNKNOWN_KEYS, path);
    if (!keys.ok) return keys;
    return ok({ kind: "unknown" });
  }
  return fail("error.cargo_invalid_weight", `${path}.kind`);
}

export function parseCargoCapacityV1(
  input: unknown,
): CargoParseResult<CargoCapacityV1> {
  if (!isPlainObject(input)) {
    return fail("error.cargo_invalid_payload");
  }
  const forbidden = scanForbidden(input, "capacity");
  if (!forbidden.ok) return forbidden;
  const keys = rejectUnknownKeys(input, CAPACITY_KEYS, "capacity");
  if (!keys.ok) return keys;
  if (input.version !== CARGO_CONTRACT_VERSION) {
    return fail("error.cargo_invalid_payload", "capacity.version");
  }
  if (input.basis !== "current_trip_available_space") {
    return fail("error.cargo_invalid_payload", "capacity.basis");
  }
  if (
    typeof input.transportMode !== "string" ||
    !isTargetDeliverTransportMode(input.transportMode)
  ) {
    return fail("error.cargo_invalid_vehicle_class", "capacity.transportMode");
  }
  if (
    typeof input.vehicleClass !== "string" ||
    !(CARGO_VEHICLE_CLASSES as readonly string[]).includes(input.vehicleClass)
  ) {
    return fail("error.cargo_invalid_vehicle_class", "capacity.vehicleClass");
  }
  const vehicleClass = input.vehicleClass as CargoVehicleClass;
  if (
    !isTransportModeVehicleClassCompatible(input.transportMode, vehicleClass)
  ) {
    return fail(
      "error.cargo_transport_vehicle_mismatch",
      "capacity.vehicleClass",
    );
  }
  const space = parseAvailableSpace(
    input.availableSpace,
    "capacity.availableSpace",
  );
  if (!space.ok) return space;
  const payload = parsePayloadKg(
    input.availablePayloadKg,
    "capacity.availablePayloadKg",
  );
  if (!payload.ok) return payload;
  if (
    typeof input.loadingHelp !== "string" ||
    !(CARGO_SUPPORT_LEVELS as readonly string[]).includes(input.loadingHelp)
  ) {
    return fail("error.cargo_invalid_payload", "capacity.loadingHelp");
  }
  if (
    typeof input.unloadingHelp !== "string" ||
    !(CARGO_SUPPORT_LEVELS as readonly string[]).includes(input.unloadingHelp)
  ) {
    return fail("error.cargo_invalid_payload", "capacity.unloadingHelp");
  }
  if (
    typeof input.escortAccommodation !== "string" ||
    !(CARGO_ESCORT_ACCOMMODATIONS as readonly string[]).includes(
      input.escortAccommodation,
    )
  ) {
    return fail("error.cargo_invalid_escort", "capacity.escortAccommodation");
  }
  const flags = parseHandlingFlags(
    input.supportedHandlingFlags,
    "capacity.supportedHandlingFlags",
  );
  if (!flags.ok) return flags;
  const note = parseNote(input.note, "capacity.note");
  if (!note.ok) return note;
  const parsed: CargoCapacityV1 = {
    version: 1,
    basis: "current_trip_available_space",
    transportMode: input.transportMode,
    vehicleClass,
    availableSpace: space.value,
    availablePayloadKg: payload.value,
    loadingHelp: input.loadingHelp as CargoSupportLevel,
    unloadingHelp: input.unloadingHelp as CargoSupportLevel,
    escortAccommodation: input.escortAccommodation as CargoEscortAccommodation,
    supportedHandlingFlags: flags.value,
  };
  if (note.value !== undefined) parsed.note = note.value;
  return ok(parsed);
}

export function resolvedItemDimensions(
  item: CargoItemV1,
): CargoDimensionsCm | null {
  if (item.measurement.kind === "custom") return item.measurement.dimensionsCm;
  if (item.measurement.kind === "preset") {
    return CARGO_PRESET_DIMENSIONS_CM[item.measurement.preset];
  }
  return null;
}

export function itemVolumeCm3(dims: CargoDimensionsCm, quantity: number): number {
  const volume = dims.length * dims.width * dims.height * quantity;
  return Number.isFinite(volume) ? volume : Number.POSITIVE_INFINITY;
}

export function itemWeightKg(item: CargoItemV1): number | null {
  if (item.weight.kind !== "known") return null;
  const total = item.quantity * item.weight.kgPerUnit;
  return Number.isFinite(total) ? total : Number.POSITIVE_INFINITY;
}

function longestSide(dims: CargoDimensionsCm): number {
  return Math.max(dims.length, dims.width, dims.height);
}

function pickClassForTotals(
  volumeCm3: number,
  weightKg: number,
  longestCm: number,
): CargoVehicleClass {
  const t = CARGO_RECOMMENDATION_THRESHOLDS;
  const fits = (band: {
    maxVolumeCm3: number;
    maxPayloadKg: number;
    maxLongestSideCm: number;
  }) =>
    volumeCm3 <= band.maxVolumeCm3 &&
    weightKg <= band.maxPayloadKg &&
    longestCm <= band.maxLongestSideCm;
  if (fits(t.smallCargoVan)) return "small_cargo_van";
  if (fits(t.mediumCargoVan)) return "medium_cargo_van";
  if (fits(t.largeCargoVan)) return "large_cargo_van";
  if (fits(t.lightTruck)) return "light_truck";
  if (fits(t.boxTruck)) return "box_truck";
  return "vehicle_with_trailer";
}

function uniqueReasons(
  reasons: CargoRecommendationReason[],
): CargoRecommendationReason[] {
  return [...new Set(reasons)];
}

export function recommendCargoVehicleClass(
  requirement: CargoRequirementV1,
): CargoVehicleRecommendation {
  const reasons: CargoRecommendationReason[] = [];
  let missingDims = false;
  let missingWeight = false;
  let usedPreset = false;
  let volumeCm3 = 0;
  let weightKg = 0;
  let longestCm = 0;
  let knownAny = false;

  for (const item of requirement.items) {
    const dims = resolvedItemDimensions(item);
    if (!dims) missingDims = true;
    else {
      knownAny = true;
      volumeCm3 += itemVolumeCm3(dims, item.quantity);
      longestCm = Math.max(longestCm, longestSide(dims));
      if (item.measurement.kind === "preset") usedPreset = true;
    }
    const weight = itemWeightKg(item);
    if (weight === null) missingWeight = true;
    else weightKg += weight;
    if (CARGO_BULKY_CATEGORIES.has(item.category)) {
      reasons.push("bulky_item_human_confirm");
    }
    if (item.handlingFlags.includes("valuable")) {
      reasons.push("valuable_item_human_confirm");
    }
    if (item.handlingFlags.includes("oversized_shape")) {
      reasons.push("bulky_item_human_confirm");
    }
  }

  const requested = requirement.requestedVehicleClass;
  if (
    requested === "cargo_boat" ||
    requested === "private_cargo_boat" ||
    requested === "other_water_cargo"
  ) {
    if (missingDims) reasons.push("insufficient_dimensions");
    if (missingWeight) reasons.push("insufficient_weight");
    reasons.push("advisory_water_cargo");
    return {
      recommendedClass: requested,
      confidence: missingDims || missingWeight ? "insufficient_data" : "estimated",
      reasons: uniqueReasons(reasons),
    };
  }

  if (!knownAny || missingDims || missingWeight) {
    if (missingDims) reasons.push("insufficient_dimensions");
    if (missingWeight) reasons.push("insufficient_weight");
    return {
      recommendedClass: knownAny
        ? pickClassForTotals(volumeCm3 || 1, weightKg || 1, longestCm || 1)
        : null,
      confidence: "insufficient_data",
      reasons: uniqueReasons(reasons),
    };
  }

  if (usedPreset) reasons.push("estimated_preset_only");
  const recommendedClass = pickClassForTotals(volumeCm3, weightKg, longestCm);
  const classReason = {
    small_cargo_van: "advisory_small_cargo_van",
    medium_cargo_van: "advisory_medium_cargo_van",
    large_cargo_van: "advisory_large_cargo_van",
    light_truck: "advisory_light_truck",
    box_truck: "advisory_box_truck",
    vehicle_with_trailer: "advisory_vehicle_with_trailer",
  } as const;
  if (recommendedClass in classReason) {
    reasons.push(classReason[recommendedClass as keyof typeof classReason]);
  }
  return {
    recommendedClass,
    confidence: "estimated",
    reasons: uniqueReasons(reasons),
  };
}

export const CARGO_ERROR_KEYS = [
  "error.cargo_invalid_payload",
  "error.cargo_unknown_key",
  "error.cargo_items_required",
  "error.cargo_too_many_items",
  "error.cargo_invalid_category",
  "error.cargo_description_required",
  "error.cargo_invalid_quantity",
  "error.cargo_invalid_dimensions",
  "error.cargo_invalid_weight",
  "error.cargo_invalid_handling_flag",
  "error.cargo_invalid_vehicle_class",
  "error.cargo_transport_vehicle_mismatch",
  "error.cargo_invalid_access",
  "error.cargo_invalid_escort",
  "error.cargo_private_field_forbidden",
] as const;
