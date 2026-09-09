/**
 * PHASE 6.7B.1A.2B.1 — Cargo V2 aggregate-space contracts and strict parsers.
 *
 * Not a database schema. Not on the production runtime path.
 * TypeScript types are not an authorization boundary; runtime parse is.
 * Server must re-parse; do not trust browser JSON.
 * Parsed authenticity is a module-private WeakSet, not an exported Symbol.
 * Handling booleans are advisory preferences only; they carry no fee model.
 */

import {
  CARGO_CONTRACT_VERSION,
  CARGO_DIMENSION_CM_MAX,
  CARGO_DIMENSION_CM_MIN,
  CARGO_ESCORT_ACCOMMODATIONS,
  CARGO_NOTE_MAX,
  CARGO_WEIGHT_KG_MAX,
  type CargoEscortAccommodation,
} from "@/lib/cargo/cargoPolicy";

export type { CargoEscortAccommodation };

export type CargoParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errorKey: string; field?: string };

export type CargoDimensionsCm = {
  length: number;
  width: number;
  height: number;
};

export type CargoWeight =
  | { kind: "known"; kg: number }
  | { kind: "unknown" };

export type CargoHandlingRequest = {
  needsLoadingHelp: boolean;
  needsUnloadingHelp: boolean;
};

export type CargoHandlingOffer = {
  canHelpLoading: boolean;
  canHelpUnloading: boolean;
};

export type CargoRequirementV1 = {
  version: 1;
  requiredSpace: CargoDimensionsCm;
  approximateWeightKg: CargoWeight;
  escortPassengerCount: 0 | 1;
  handlingRequest: CargoHandlingRequest;
  note?: string;
};

export type CargoCapacityV1 = {
  version: 1;
  basis: "current_trip_available_space";
  availableSpace: CargoDimensionsCm;
  availablePayloadKg: CargoWeight;
  escortAccommodation: CargoEscortAccommodation;
  handlingOffer: CargoHandlingOffer;
  note?: string;
};

declare const parsedRequirementBrand: unique symbol;
declare const parsedCapacityBrand: unique symbol;

export type ParsedCargoRequirementV1 = CargoRequirementV1 & {
  readonly [parsedRequirementBrand]: true;
};

export type ParsedCargoCapacityV1 = CargoCapacityV1 & {
  readonly [parsedCapacityBrand]: true;
};

const parsedRequirementValues = new WeakSet<object>();
const parsedCapacityValues = new WeakSet<object>();

const REQUIREMENT_KEYS = new Set([
  "version",
  "requiredSpace",
  "approximateWeightKg",
  "escortPassengerCount",
  "handlingRequest",
  "note",
]);

const CAPACITY_KEYS = new Set([
  "version",
  "basis",
  "availableSpace",
  "availablePayloadKg",
  "escortAccommodation",
  "handlingOffer",
  "note",
]);

const DIMENSION_KEYS = new Set(["length", "width", "height"]);
const WEIGHT_KNOWN_KEYS = new Set(["kind", "kg"]);
const WEIGHT_UNKNOWN_KEYS = new Set(["kind"]);
const DEMAND_HANDLING_KEYS = new Set(["needsLoadingHelp", "needsUnloadingHelp"]);
const PROVIDER_HANDLING_KEYS = new Set(["canHelpLoading", "canHelpUnloading"]);

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
    "paymentlink",
    "payment_link",
    "bank",
    "iban",
    "credential",
    "contact",
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
    "identity",
    "idcard",
    "id_card",
    "passport",
    "hazardous",
    "dangerous_goods",
    "dangerousgoods",
    "weapon",
    "illegal_goods",
    "illegalgoods",
    "contraband",
    "explosive",
    "flammable",
    "feeoverride",
    "fee_override",
    "transportfee",
    "transport_fee",
    "compensation",
    "amountminor",
    "amount_minor",
    "currency",
    "fixed",
    "negotiable",
    "voluntaryunpaid",
    "voluntary_unpaid",
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
  if (
    value.length === undefined ||
    value.width === undefined ||
    value.height === undefined
  ) {
    return fail("error.cargo_invalid_dimensions", path);
  }
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

function parseKg(value: unknown, field: string): CargoParseResult<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail("error.cargo_invalid_weight", field);
  }
  if (value <= 0 || value > CARGO_WEIGHT_KG_MAX || !atMostOneDecimal(value)) {
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
    const kg = parseKg(value.kg, `${path}.kg`);
    if (!kg.ok) return kg;
    return ok({ kind: "known", kg: kg.value });
  }
  if (value.kind === "unknown") {
    const keys = rejectUnknownKeys(value, WEIGHT_UNKNOWN_KEYS, path);
    if (!keys.ok) return keys;
    return ok({ kind: "unknown" });
  }
  return fail("error.cargo_invalid_weight", `${path}.kind`);
}

function parseRequiredBoolean(
  value: unknown,
  field: string,
): CargoParseResult<boolean> {
  if (typeof value !== "boolean") {
    return fail("error.cargo_invalid_handling", field);
  }
  return ok(value);
}

function parseHandlingRequest(
  value: unknown,
  path: string,
): CargoParseResult<CargoHandlingRequest> {
  if (!isPlainObject(value)) {
    return fail("error.cargo_invalid_handling", path);
  }
  const keys = rejectUnknownKeys(value, DEMAND_HANDLING_KEYS, path);
  if (!keys.ok) return keys;
  if (
    !Object.hasOwn(value, "needsLoadingHelp") ||
    !Object.hasOwn(value, "needsUnloadingHelp")
  ) {
    return fail("error.cargo_invalid_handling", path);
  }
  const loading = parseRequiredBoolean(
    value.needsLoadingHelp,
    `${path}.needsLoadingHelp`,
  );
  if (!loading.ok) return loading;
  const unloading = parseRequiredBoolean(
    value.needsUnloadingHelp,
    `${path}.needsUnloadingHelp`,
  );
  if (!unloading.ok) return unloading;
  return ok({
    needsLoadingHelp: loading.value,
    needsUnloadingHelp: unloading.value,
  });
}

function parseHandlingOffer(
  value: unknown,
  path: string,
): CargoParseResult<CargoHandlingOffer> {
  if (!isPlainObject(value)) {
    return fail("error.cargo_invalid_handling", path);
  }
  const keys = rejectUnknownKeys(value, PROVIDER_HANDLING_KEYS, path);
  if (!keys.ok) return keys;
  if (
    !Object.hasOwn(value, "canHelpLoading") ||
    !Object.hasOwn(value, "canHelpUnloading")
  ) {
    return fail("error.cargo_invalid_handling", path);
  }
  const loading = parseRequiredBoolean(
    value.canHelpLoading,
    `${path}.canHelpLoading`,
  );
  if (!loading.ok) return loading;
  const unloading = parseRequiredBoolean(
    value.canHelpUnloading,
    `${path}.canHelpUnloading`,
  );
  if (!unloading.ok) return unloading;
  return ok({
    canHelpLoading: loading.value,
    canHelpUnloading: unloading.value,
  });
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

function brandRequirement(
  value: CargoRequirementV1,
): ParsedCargoRequirementV1 {
  const frozen = Object.freeze({
    version: 1 as const,
    requiredSpace: Object.freeze({ ...value.requiredSpace }),
    approximateWeightKg: Object.freeze({ ...value.approximateWeightKg }),
    escortPassengerCount: value.escortPassengerCount,
    handlingRequest: Object.freeze({ ...value.handlingRequest }),
    ...(value.note !== undefined ? { note: value.note } : {}),
  }) as ParsedCargoRequirementV1;
  parsedRequirementValues.add(frozen);
  return frozen;
}

function brandCapacity(value: CargoCapacityV1): ParsedCargoCapacityV1 {
  const frozen = Object.freeze({
    version: 1 as const,
    basis: "current_trip_available_space" as const,
    availableSpace: Object.freeze({ ...value.availableSpace }),
    availablePayloadKg: Object.freeze({ ...value.availablePayloadKg }),
    escortAccommodation: value.escortAccommodation,
    handlingOffer: Object.freeze({ ...value.handlingOffer }),
    ...(value.note !== undefined ? { note: value.note } : {}),
  }) as ParsedCargoCapacityV1;
  parsedCapacityValues.add(frozen);
  return frozen;
}

export function isParsedCargoRequirementV1(
  value: unknown,
): value is ParsedCargoRequirementV1 {
  return typeof value === "object" && value !== null && parsedRequirementValues.has(value);
}

export function isParsedCargoCapacityV1(
  value: unknown,
): value is ParsedCargoCapacityV1 {
  return typeof value === "object" && value !== null && parsedCapacityValues.has(value);
}

export function parseCargoRequirementV1(
  input: unknown,
): CargoParseResult<ParsedCargoRequirementV1> {
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
  const requiredSpace = parseDimensionsCm(
    input.requiredSpace,
    "requirement.requiredSpace",
  );
  if (!requiredSpace.ok) return requiredSpace;
  const weight = parseWeight(
    input.approximateWeightKg,
    "requirement.approximateWeightKg",
  );
  if (!weight.ok) return weight;
  if (input.escortPassengerCount !== 0 && input.escortPassengerCount !== 1) {
    return fail("error.cargo_invalid_escort", "requirement.escortPassengerCount");
  }
  const handling = parseHandlingRequest(
    input.handlingRequest,
    "requirement.handlingRequest",
  );
  if (!handling.ok) return handling;
  const note = parseNote(input.note, "requirement.note");
  if (!note.ok) return note;
  const parsed: CargoRequirementV1 = {
    version: 1,
    requiredSpace: requiredSpace.value,
    approximateWeightKg: weight.value,
    escortPassengerCount: input.escortPassengerCount,
    handlingRequest: handling.value,
  };
  if (note.value !== undefined) parsed.note = note.value;
  return ok(brandRequirement(parsed));
}

export function parseCargoCapacityV1(
  input: unknown,
): CargoParseResult<ParsedCargoCapacityV1> {
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
  const availableSpace = parseDimensionsCm(
    input.availableSpace,
    "capacity.availableSpace",
  );
  if (!availableSpace.ok) return availableSpace;
  const payload = parseWeight(
    input.availablePayloadKg,
    "capacity.availablePayloadKg",
  );
  if (!payload.ok) return payload;
  if (
    typeof input.escortAccommodation !== "string" ||
    !(CARGO_ESCORT_ACCOMMODATIONS as readonly string[]).includes(
      input.escortAccommodation,
    )
  ) {
    return fail("error.cargo_invalid_escort", "capacity.escortAccommodation");
  }
  const handling = parseHandlingOffer(
    input.handlingOffer,
    "capacity.handlingOffer",
  );
  if (!handling.ok) return handling;
  const note = parseNote(input.note, "capacity.note");
  if (!note.ok) return note;
  const parsed: CargoCapacityV1 = {
    version: 1,
    basis: "current_trip_available_space",
    availableSpace: availableSpace.value,
    availablePayloadKg: payload.value,
    escortAccommodation: input.escortAccommodation as CargoEscortAccommodation,
    handlingOffer: handling.value,
  };
  if (note.value !== undefined) parsed.note = note.value;
  return ok(brandCapacity(parsed));
}

export const CARGO_ERROR_KEYS = [
  "error.cargo_invalid_payload",
  "error.cargo_unknown_key",
  "error.cargo_invalid_dimensions",
  "error.cargo_invalid_weight",
  "error.cargo_invalid_escort",
  "error.cargo_invalid_handling",
  "error.cargo_private_field_forbidden",
] as const;
