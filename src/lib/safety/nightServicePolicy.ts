/**
 * PHASE 6.7C.2A — service subtype and regional night-safety policy.
 * Pure helpers. Do not read PostgreSQL or trust browser night/subtype
 * conclusions. Server writers must re-evaluate from stored post rows.
 */

import type { PostCategory } from "@/lib/types";
import {
  TARGET_DELIVER_TRANSPORT_MODES,
  TARGET_TRAVEL_TRANSPORT_MODES,
} from "@/lib/transport/transportPolicy";

export const TRAVEL_SERVICE_SUBTYPES = [
  "passenger",
  "small_item_only",
  "passenger_with_small_item",
] as const;

export const DELIVER_SERVICE_SUBTYPES = [
  "cargo_only",
  "cargo_with_escort",
] as const;

export type TravelServiceSubtype = (typeof TRAVEL_SERVICE_SUBTYPES)[number];
export type DeliverServiceSubtype = (typeof DELIVER_SERVICE_SUBTYPES)[number];
export type ServiceSubtype = TravelServiceSubtype | DeliverServiceSubtype;

export const HUMAN_TRAVEL_SUBTYPES = [
  "passenger",
  "passenger_with_small_item",
  "cargo_with_escort",
] as const;

export const NIGHT_ALLOWED_WITHOUT_HUMAN = [
  "small_item_only",
  "cargo_only",
] as const;

/** Modes that must not publish a people-carrying subtype. */
export const NO_PLATFORM_PASSENGER_MODES = [
  "walking",
  "bicycle",
  "ebike",
  "scooter",
  "motorbike",
  "subway",
  "bus",
  "train",
  "flight",
  "ferry",
  "passenger_boat",
  "private_boat",
  "cargo_boat",
  "private_cargo_boat",
] as const;

/** Explicitly allowed to carry a platform passenger or escort. */
export const PLATFORM_PASSENGER_MODES = [
  "car",
  "cargo_van",
  "light_truck",
  "box_truck",
  "vehicle_with_trailer",
  "other_cargo_vehicle",
] as const;

export type NightServicePurpose = "publish" | "match";

export type NightServicePolicyInput = {
  category: string;
  serviceSubtype: string | null | undefined;
  transportMode?: string | null;
  localTime?: string | null;
  blockedStartLocal?: string | null;
  blockedEndLocal?: string | null;
  policyEnabled?: boolean;
  purpose?: NightServicePurpose;
};

export type NightServiceDenial =
  | "illegal_subtype"
  | "legacy_unknown_subtype"
  | "illegal_transport_combo"
  | "night_blocked"
  | "invalid_time";

export type NightServiceDecision =
  | { ok: true; nightBlocked: false }
  | { ok: false; reason: NightServiceDenial };

function isTravelSubtype(value: string): value is TravelServiceSubtype {
  return (TRAVEL_SERVICE_SUBTYPES as readonly string[]).includes(value);
}

function isDeliverSubtype(value: string): value is DeliverServiceSubtype {
  return (DELIVER_SERVICE_SUBTYPES as readonly string[]).includes(value);
}

/** Catalog-legal combinations. Travel/Deliver NULL is legacy-unknown, not a new write. */
export function serviceSubtypeIsLegal(
  category: string,
  subtype: string | null | undefined,
): boolean {
  if (category === "travel") {
    return subtype == null || isTravelSubtype(subtype);
  }
  if (category === "deliver") {
    return subtype == null || isDeliverSubtype(subtype);
  }
  if (category === "buy" || category === "onsite" || category === "errand") {
    return subtype == null;
  }
  return false;
}

export function serviceRequiresHumanTravel(
  category: string,
  subtype: string | null | undefined,
): boolean {
  if (category === "onsite") return true;
  if (subtype == null) return false;
  return (HUMAN_TRAVEL_SUBTYPES as readonly string[]).includes(subtype);
}

export function transportModeMayCarryPlatformPassenger(mode: string): boolean {
  return (PLATFORM_PASSENGER_MODES as readonly string[]).includes(mode);
}

function toMinutes(value: string): number | null {
  const matched = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!matched) return null;
  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  const seconds = Number(matched[3] ?? "0");
  if (
    hours > 23 ||
    minutes > 59 ||
    seconds > 59 ||
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds)
  ) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Inclusive start, exclusive end. Wraps across midnight when start > end.
 * Invalid or zero-width windows fail closed (treated as inside the block).
 */
export function isLocalTimeInBlockedWindow(
  localTime: string,
  start: string,
  end: string,
): boolean {
  const time = toMinutes(localTime);
  const blockedStart = toMinutes(start);
  const blockedEnd = toMinutes(end);
  if (time == null || blockedStart == null || blockedEnd == null) return true;
  if (blockedStart === blockedEnd) return true;
  if (blockedStart < blockedEnd) {
    return time >= blockedStart && time < blockedEnd;
  }
  return time >= blockedStart || time < blockedEnd;
}

function transportComboIsLegal(
  category: string,
  subtype: string | null | undefined,
  mode: string | null | undefined,
): boolean {
  const needsPeople = serviceRequiresHumanTravel(category, subtype);
  if (category === "travel") {
    if (mode == null || mode === "") return !needsPeople;
    if (
      !(TARGET_TRAVEL_TRANSPORT_MODES as readonly string[]).includes(mode)
    ) {
      return false;
    }
    if (needsPeople && !transportModeMayCarryPlatformPassenger(mode)) {
      return false;
    }
    return true;
  }
  if (category === "deliver") {
    if (mode == null || mode === "") return !needsPeople;
    if (
      !(TARGET_DELIVER_TRANSPORT_MODES as readonly string[]).includes(mode)
    ) {
      return false;
    }
    if (needsPeople && !transportModeMayCarryPlatformPassenger(mode)) {
      return false;
    }
    return true;
  }
  return true;
}

export function serviceSubtypesAreCompatible(
  leftCategory: string,
  leftSubtype: string | null | undefined,
  rightCategory: string,
  rightSubtype: string | null | undefined,
): boolean {
  if (leftCategory !== rightCategory) return false;
  if (!serviceSubtypeIsLegal(leftCategory, leftSubtype)) return false;
  if (!serviceSubtypeIsLegal(rightCategory, rightSubtype)) return false;
  if (leftCategory === "buy" || leftCategory === "onsite" || leftCategory === "errand") {
    return leftSubtype == null && rightSubtype == null;
  }
  if (leftSubtype == null || rightSubtype == null) return false;
  return leftSubtype === rightSubtype;
}

export function evaluateNightServicePolicy(
  input: NightServicePolicyInput,
): NightServiceDecision {
  const category = input.category;
  const subtype = input.serviceSubtype ?? null;
  const purpose = input.purpose ?? "match";

  if (!serviceSubtypeIsLegal(category, subtype)) {
    return { ok: false, reason: "illegal_subtype" };
  }
  if (
    (category === "travel" || category === "deliver") &&
    subtype == null &&
    (purpose === "match" || purpose === "publish")
  ) {
    return { ok: false, reason: "legacy_unknown_subtype" };
  }
  if (!transportComboIsLegal(category, subtype, input.transportMode)) {
    return { ok: false, reason: "illegal_transport_combo" };
  }

  const nightSensitive =
    category === "onsite" || serviceRequiresHumanTravel(category, subtype);
  if (!input.policyEnabled || !nightSensitive) {
    return { ok: true, nightBlocked: false };
  }
  if (
    input.localTime == null ||
    input.blockedStartLocal == null ||
    input.blockedEndLocal == null
  ) {
    return { ok: false, reason: "invalid_time" };
  }
  if (
    toMinutes(input.localTime) == null ||
    toMinutes(input.blockedStartLocal) == null ||
    toMinutes(input.blockedEndLocal) == null
  ) {
    return { ok: false, reason: "invalid_time" };
  }
  if (
    isLocalTimeInBlockedWindow(
      input.localTime,
      input.blockedStartLocal,
      input.blockedEndLocal,
    )
  ) {
    return { ok: false, reason: "night_blocked" };
  }
  return { ok: true, nightBlocked: false };
}

export const SERVICE_SUBTYPE_TRUTH: ReadonlyArray<{
  category: PostCategory;
  subtype: ServiceSubtype | null;
  legal: boolean;
}> = [
  { category: "travel", subtype: "passenger", legal: true },
  { category: "travel", subtype: "small_item_only", legal: true },
  { category: "travel", subtype: "passenger_with_small_item", legal: true },
  { category: "travel", subtype: null, legal: true },
  { category: "deliver", subtype: "cargo_only", legal: true },
  { category: "deliver", subtype: "cargo_with_escort", legal: true },
  { category: "deliver", subtype: null, legal: true },
  { category: "buy", subtype: null, legal: true },
  { category: "onsite", subtype: null, legal: true },
  { category: "errand", subtype: null, legal: true },
  { category: "travel", subtype: "cargo_only", legal: false },
  { category: "deliver", subtype: "passenger", legal: false },
  { category: "buy", subtype: "passenger", legal: false },
  { category: "onsite", subtype: "cargo_only", legal: false },
  { category: "errand", subtype: "small_item_only", legal: false },
];
