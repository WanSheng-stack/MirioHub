/**
 * PHASE 6.7B.1B — versioned match-request application payload (V1).
 *
 * Client validator is UX + shared contract only. It MUST NOT be treated as
 * authorization or as a source of truth for the target post.
 * Applicant does not need to own a post. No counterpart_post_id.
 *
 * Deliver applications use Cargo V2 aggregate space:
 * - Provider → Demand deliver: cargoCapacity (this-trip remaining space)
 * - Demand → Provider deliver: cargoRequirement (overall required space)
 * Provider deliver offers do not inherit Travel's top-level transportMode.
 * Travel still uses four-tier luggage counts. Handling flags are advisory.
 * This module does not write match_requests, match_contracts, or
 * agreement_snapshot.
 *
 * PHASE 6.7C server MUST:
 * - Re-run this same strict validator on the request body
 * - Re-parse cargoCapacity / cargoRequirement with the Cargo V2 parsers
 * - Re-fetch from DB by target_post_id: post row, category, owner, current status
 * - Derive applicantRole / targetPostType from the authenticated user + DB post
 * - Never trust browser-provided targetPostType, targetCategory, recipient, or
 *   applicant role
 */

import {
  parseCargoCapacityV1,
  parseCargoRequirementV1,
  type ParsedCargoCapacityV1,
  type ParsedCargoRequirementV1,
} from "@/lib/cargo/cargoContract";
import {
  ITEM_UNITS,
  POST_CATEGORIES,
  type ItemCondition,
  type ItemUnit,
  type PostCategory,
  type PurchasePriceType,
} from "@/lib/post-payload";
import { TRANSPORT_MODES } from "@/lib/posts";
import { isAlignedApplicantRole, type MatchApplicantRole, type MatchPostType } from "@/lib/matching/model";
import type { TransportMode } from "@/lib/types";

export const APPLICATION_PAYLOAD_VERSION = 1 as const;
export const MATCH_REQUEST_MESSAGE_MAX = 300;

/**
 * Existing product seat cap: publish form clamps escort_seats / max_companions
 * to 0–4 / 1–4. Capacity intercept is driver + passengers ≤ 5.
 * Do not change that policy here.
 */
export const MATCH_REQUEST_SEAT_CAP = 4;
export const MATCH_REQUEST_TRAVEL_SEATS_MIN = 1;
export const MATCH_REQUEST_DELIVER_ESCORT_MIN = 0;

export type CargoCountsV1 = {
  small: number;
  medium: number;
  large: number;
  xlarge: number;
};

type EnvelopeV1 = {
  version: 1;
  applicantRole: MatchApplicantRole;
  targetPostType: MatchPostType;
  targetCategory: PostCategory;
  message?: string;
};

type ProviderOfferBase = EnvelopeV1 & {
  applicantRole: "provider";
  targetPostType: "demand";
};

export type ProviderOfferTravelV1 = ProviderOfferBase & {
  targetCategory: "travel";
  transportMode: TransportMode;
  availablePassengerSeats: number;
  availableCargo?: CargoCountsV1;
};

export type ProviderOfferDeliverV1 = ProviderOfferBase & {
  targetCategory: "deliver";
  cargoCapacity: ParsedCargoCapacityV1;
};

export type ProviderOfferLocalV1 = ProviderOfferBase & {
  targetCategory: "buy" | "onsite" | "errand";
  transportMode: TransportMode;
};

type DemandApplyBase = EnvelopeV1 & {
  applicantRole: "demand";
  targetPostType: "provider";
};

export type DemandApplyTravelV1 = DemandApplyBase & {
  targetCategory: "travel";
  passengerCount: number;
  luggage?: CargoCountsV1;
};

export type DemandApplyDeliverV1 = DemandApplyBase & {
  targetCategory: "deliver";
  cargoRequirement: ParsedCargoRequirementV1;
};

export type DemandApplyBuyV1 = DemandApplyBase & {
  targetCategory: "buy";
  itemQuantity: number;
  itemUnit: ItemUnit;
  itemCondition: ItemCondition;
  purchasePriceType: PurchasePriceType;
  minBudget?: number;
  maxBudget?: number;
};

export type DemandApplyLocalV1 = DemandApplyBase & {
  targetCategory: "onsite" | "errand";
};

export type ApplicationPayloadV1 =
  | ProviderOfferTravelV1
  | ProviderOfferDeliverV1
  | ProviderOfferLocalV1
  | DemandApplyTravelV1
  | DemandApplyDeliverV1
  | DemandApplyBuyV1
  | DemandApplyLocalV1;

export type ParseApplicationPayloadResult =
  | { ok: true; value: ApplicationPayloadV1 }
  | { ok: false; errorKey: string };

const CARGO_KEYS = ["small", "medium", "large", "xlarge"] as const;
const ITEM_CONDITIONS: readonly ItemCondition[] = ["new", "used"];
const PURCHASE_PRICE_TYPES: readonly PurchasePriceType[] = ["range", "negotiable"];

const ENVELOPE_KEYS = [
  "version",
  "applicantRole",
  "targetPostType",
  "targetCategory",
  "message",
] as const;

export const FORBIDDEN_PAYLOAD_KEYS = [
  "user_id",
  "applicant_user_id",
  "recipient_user_id",
  "target_owner_id",
  "owner_id",
  "phone",
  "raw_phone",
  "normalized_phone",
  "contact_email",
  "email",
  "plate",
  "raw_license_plate",
  "normalized_license_plate",
  "provider_name",
  "origin_gps",
  "destination_gps",
  "service_address",
  "pickup_code",
  "delivery_code",
  "completion_note",
  "bid",
  "negotiated_fee",
  "negotiatedFee",
  "fee_amount",
  "feeAmount",
  "fee_override",
  "feeOverride",
  "bump_fee",
  "bumpFee",
  "estimated_item_cost",
  "compensation",
  "amountMinor",
  "currency",
  "voluntary_unpaid",
  "counterpart_post_id",
  "demand_post_id",
  "provider_post_id",
  "applicant_post_id",
  "origin_address",
  "destination_address",
  "departure_date",
  "departure_time_window",
  "risk_score",
  "riskScore",
  "fraud_logs",
  "potential_fraud_logs",
  "trackerScene",
  "phoneAccounts",
  "plateAccounts",
  "SQLSTATE",
  "service_role",
  "serviceRole",
] as const;

export type ForbiddenPayloadKey = (typeof FORBIDDEN_PAYLOAD_KEYS)[number];

const FORBIDDEN_KEY_SET = new Set<string>(FORBIDDEN_PAYLOAD_KEYS);

const ALLOWED_BY_VARIANT: Record<string, ReadonlySet<string>> = {
  "provider:demand:travel": new Set([
    ...ENVELOPE_KEYS,
    "transportMode",
    "availablePassengerSeats",
    "availableCargo",
  ]),
  "provider:demand:deliver": new Set([
    ...ENVELOPE_KEYS,
    "cargoCapacity",
  ]),
  "provider:demand:buy": new Set([...ENVELOPE_KEYS, "transportMode"]),
  "provider:demand:onsite": new Set([...ENVELOPE_KEYS, "transportMode"]),
  "provider:demand:errand": new Set([...ENVELOPE_KEYS, "transportMode"]),
  "demand:provider:travel": new Set([
    ...ENVELOPE_KEYS,
    "passengerCount",
    "luggage",
  ]),
  "demand:provider:deliver": new Set([
    ...ENVELOPE_KEYS,
    "cargoRequirement",
  ]),
  "demand:provider:buy": new Set([
    ...ENVELOPE_KEYS,
    "itemQuantity",
    "itemUnit",
    "itemCondition",
    "purchasePriceType",
    "minBudget",
    "maxBudget",
  ]),
  "demand:provider:onsite": new Set([...ENVELOPE_KEYS]),
  "demand:provider:errand": new Set([...ENVELOPE_KEYS]),
};

function fail(errorKey: string): ParseApplicationPayloadResult {
  return { ok: false, errorKey };
}

export function isForbiddenPayloadKey(key: string): boolean {
  return FORBIDDEN_KEY_SET.has(key);
}

/** Finite integer; rejects NaN, Infinity, string numbers, and non-integers. */
export function parseFiniteInteger(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

export function parseFiniteNonNegInt(value: unknown): number | null {
  const n = parseFiniteInteger(value);
  if (n === null || n < 0) return null;
  return n;
}

export function parseSeatCount(
  value: unknown,
  min: number,
  max: number = MATCH_REQUEST_SEAT_CAP,
): number | null {
  const n = parseFiniteNonNegInt(value);
  if (n === null || n < min || n > max) return null;
  return n;
}

/**
 * Buy budgets reuse existing min_budget / max_budget (numeric major units).
 * Reject string numbers / NaN / Infinity / negatives. Fractional euros are
 * allowed so we do not invent an integer-only money field.
 */
export function parseNonNegFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function normalizeMessage(
  raw: unknown,
): { ok: true; value?: string } | { ok: false; errorKey: string } {
  if (raw === undefined) return { ok: true };
  if (typeof raw !== "string") {
    return { ok: false, errorKey: "error.match_request_invalid_payload" };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true };
  if (trimmed.length > MATCH_REQUEST_MESSAGE_MAX) {
    return { ok: false, errorKey: "error.match_request_message_too_long" };
  }
  return { ok: true, value: trimmed };
}

function isPostCategory(value: unknown): value is PostCategory {
  return (
    typeof value === "string" &&
    (POST_CATEGORIES as readonly string[]).includes(value)
  );
}

function isTransportMode(value: unknown): value is TransportMode {
  return (
    typeof value === "string" &&
    (TRANSPORT_MODES as readonly string[]).includes(value)
  );
}

function isItemUnit(value: unknown): value is ItemUnit {
  return typeof value === "string" && (ITEM_UNITS as readonly string[]).includes(value);
}

function isItemCondition(value: unknown): value is ItemCondition {
  return typeof value === "string" && (ITEM_CONDITIONS as readonly string[]).includes(value);
}

function isPurchasePriceType(value: unknown): value is PurchasePriceType {
  return (
    typeof value === "string" &&
    (PURCHASE_PRICE_TYPES as readonly string[]).includes(value)
  );
}

function parseCargoCounts(value: unknown): CargoCountsV1 | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.some((k) => !(CARGO_KEYS as readonly string[]).includes(k))) {
    return null;
  }
  if (CARGO_KEYS.some((k) => !(k in rec))) return null;
  const small = parseFiniteNonNegInt(rec.small);
  const medium = parseFiniteNonNegInt(rec.medium);
  const large = parseFiniteNonNegInt(rec.large);
  const xlarge = parseFiniteNonNegInt(rec.xlarge);
  if (small === null || medium === null || large === null || xlarge === null) {
    return null;
  }
  return { small, medium, large, xlarge };
}

function variantKey(
  applicantRole: MatchApplicantRole,
  targetPostType: MatchPostType,
  targetCategory: PostCategory,
): string {
  return `${applicantRole}:${targetPostType}:${targetCategory}`;
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export function applicantRoleForTarget(
  targetPostType: MatchPostType,
): MatchApplicantRole {
  return targetPostType === "demand" ? "provider" : "demand";
}

export function parseApplicationPayloadV1(
  raw: unknown,
): ParseApplicationPayloadResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("error.match_request_invalid_payload");
  }

  const rec = raw as Record<string, unknown>;
  const keys = Object.keys(rec);

  for (const key of keys) {
    if (isForbiddenPayloadKey(key)) {
      return fail("error.match_request_forbidden_key");
    }
  }

  if (rec.version !== APPLICATION_PAYLOAD_VERSION) {
    return fail("error.match_request_invalid_version");
  }

  const applicantRole = rec.applicantRole;
  const targetPostType = rec.targetPostType;
  if (applicantRole !== "provider" && applicantRole !== "demand") {
    return fail("error.match_request_role_mismatch");
  }
  if (targetPostType !== "demand" && targetPostType !== "provider") {
    return fail("error.match_request_role_mismatch");
  }
  if (!isAlignedApplicantRole(targetPostType, applicantRole)) {
    return fail("error.match_request_role_mismatch");
  }
  if (!isPostCategory(rec.targetCategory)) {
    return fail("error.match_request_invalid_category");
  }

  const allowed = ALLOWED_BY_VARIANT[variantKey(applicantRole, targetPostType, rec.targetCategory)];
  if (!allowed) return fail("error.match_request_invalid_category");
  for (const key of keys) {
    if (!allowed.has(key)) return fail("error.match_request_unknown_key");
  }

  const messageResult = normalizeMessage(rec.message);
  if (!messageResult.ok) return fail(messageResult.errorKey);
  const message = messageResult.value;

  if (applicantRole === "provider" && targetPostType === "demand") {
    if (rec.targetCategory === "deliver") {
      const cargoCapacity = parseCargoCapacityV1(rec.cargoCapacity);
      if (!cargoCapacity.ok) return fail(cargoCapacity.errorKey);
      return {
        ok: true,
        value: omitUndefined({
          version: 1,
          applicantRole: "provider",
          targetPostType: "demand",
          targetCategory: "deliver",
          cargoCapacity: cargoCapacity.value,
          message,
        }),
      };
    }

    if (!isTransportMode(rec.transportMode)) {
      return fail("error.match_request_transport_mode_required");
    }

    if (rec.targetCategory === "travel") {
      const availablePassengerSeats = parseSeatCount(
        rec.availablePassengerSeats,
        MATCH_REQUEST_TRAVEL_SEATS_MIN,
      );
      if (availablePassengerSeats === null) {
        return fail("error.match_request_passenger_count_bounds");
      }
      let availableCargo: CargoCountsV1 | undefined;
      if (rec.availableCargo !== undefined) {
        const cargo = parseCargoCounts(rec.availableCargo);
        if (!cargo) return fail("error.match_request_invalid_quantity");
        availableCargo = cargo;
      }
      return {
        ok: true,
        value: omitUndefined({
          version: 1,
          applicantRole: "provider",
          targetPostType: "demand",
          targetCategory: "travel",
          transportMode: rec.transportMode,
          availablePassengerSeats,
          availableCargo,
          message,
        }),
      };
    }

    return {
      ok: true,
      value: omitUndefined({
        version: 1,
        applicantRole: "provider",
        targetPostType: "demand",
        targetCategory: rec.targetCategory,
        transportMode: rec.transportMode,
        message,
      }),
    };
  }

  if (rec.targetCategory === "travel") {
    const passengerCount = parseSeatCount(
      rec.passengerCount,
      MATCH_REQUEST_TRAVEL_SEATS_MIN,
    );
    if (passengerCount === null) {
      return fail("error.match_request_passenger_count_bounds");
    }
    let luggage: CargoCountsV1 | undefined;
    if (rec.luggage !== undefined) {
      const parsed = parseCargoCounts(rec.luggage);
      if (!parsed) return fail("error.match_request_invalid_quantity");
      luggage = parsed;
    }
    return {
      ok: true,
      value: omitUndefined({
        version: 1,
        applicantRole: "demand",
        targetPostType: "provider",
        targetCategory: "travel",
        passengerCount,
        luggage,
        message,
      }),
    };
  }

  if (rec.targetCategory === "deliver") {
    const cargoRequirement = parseCargoRequirementV1(rec.cargoRequirement);
    if (!cargoRequirement.ok) return fail(cargoRequirement.errorKey);
    return {
      ok: true,
      value: omitUndefined({
        version: 1,
        applicantRole: "demand",
        targetPostType: "provider",
        targetCategory: "deliver",
        cargoRequirement: cargoRequirement.value,
        message,
      }),
    };
  }

  if (rec.targetCategory === "buy") {
    const itemQuantity = parseFiniteNonNegInt(rec.itemQuantity);
    if (itemQuantity === null || itemQuantity < 1) {
      return fail("error.match_request_invalid_quantity");
    }
    if (!isItemUnit(rec.itemUnit) || !isItemCondition(rec.itemCondition)) {
      return fail("error.match_request_invalid_enum");
    }
    if (!isPurchasePriceType(rec.purchasePriceType)) {
      return fail("error.match_request_invalid_enum");
    }
    if (rec.purchasePriceType === "range") {
      const minBudget = parseNonNegFiniteNumber(rec.minBudget);
      const maxBudget = parseNonNegFiniteNumber(rec.maxBudget);
      if (minBudget === null || maxBudget === null || minBudget > maxBudget) {
        return fail("error.match_request_invalid_budget");
      }
      return {
        ok: true,
        value: omitUndefined({
          version: 1,
          applicantRole: "demand",
          targetPostType: "provider",
          targetCategory: "buy",
          itemQuantity,
          itemUnit: rec.itemUnit,
          itemCondition: rec.itemCondition,
          purchasePriceType: "range",
          minBudget,
          maxBudget,
          message,
        }),
      };
    }
    if (rec.minBudget !== undefined || rec.maxBudget !== undefined) {
      return fail("error.match_request_unknown_key");
    }
    return {
      ok: true,
      value: omitUndefined({
        version: 1,
        applicantRole: "demand",
        targetPostType: "provider",
        targetCategory: "buy",
        itemQuantity,
        itemUnit: rec.itemUnit,
        itemCondition: rec.itemCondition,
        purchasePriceType: "negotiable",
        message,
      }),
    };
  }

  return {
    ok: true,
    value: omitUndefined({
      version: 1,
      applicantRole: "demand",
      targetPostType: "provider",
      targetCategory: rec.targetCategory,
      message,
    }),
  };
}
