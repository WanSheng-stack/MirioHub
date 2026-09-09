/**
 * PHASE 6.7B.1A.1 — composable safety-module policy.
 *
 * Client calls are UX only. Server must rebuild facts from the database and
 * already-validated contracts. Do not trust browser-supplied mode, category,
 * role, lane, or counts.
 *
 * resolveSafetyModules accepts only ValidatedSafetyFacts from validateSafetyFacts.
 */

import type { PostCategory } from "@/lib/post-payload";
import type { PostType } from "@/lib/types";
import {
  getTransportPolicy,
  isModeAllowedForLane,
  parsePolicyQuantity,
  type TransportServiceLane,
} from "@/lib/transport/transportPolicy";

export type SafetyModule =
  | "platform_boundary"
  | "passenger_identity_vehicle"
  | "small_item_handover"
  | "large_item_handover"
  | "escort_passenger"
  | "public_transport_rules"
  | "water_transport_rules"
  | "purchase_help"
  | "onsite_help"
  | "errand_help"
  | "payment_anti_scam"
  | "unlisted_risk_catchall";

export const ALWAYS_ON_SAFETY_MODULES = [
  "platform_boundary",
  "payment_anti_scam",
  "unlisted_risk_catchall",
] as const satisfies readonly SafetyModule[];

export const SAFETY_COPY_KEYS = {
  platform_boundary: "safety.module.platform_boundary",
  passenger_identity_vehicle: "safety.module.passenger_identity_vehicle",
  small_item_handover: "safety.module.small_item_handover",
  large_item_handover: "safety.module.large_item_handover",
  escort_passenger: "safety.module.escort_passenger",
  public_transport_rules: "safety.module.public_transport_rules",
  water_transport_rules: "safety.module.water_transport_rules",
  purchase_help: "safety.module.purchase_help",
  onsite_help: "safety.module.onsite_help",
  errand_help: "safety.module.errand_help",
  payment_anti_scam: "safety.module.payment_anti_scam",
  unlisted_risk_catchall: "safety.unlistedRiskCatchall",
  escortSeatConfirm: "transportPolicy.escortSeatConfirm",
} as const;

const VALIDATED_SAFETY_FACTS = Symbol("ValidatedSafetyFacts");

const ALLOWED_SAFETY_KEYS = new Set([
  "category",
  "lane",
  "postType",
  "peopleCount",
  "peopleCapacity",
  "travelItemUnits",
  "escortPassengerCount",
  "transportMode",
]);

const CATEGORIES = new Set<PostCategory>([
  "deliver",
  "buy",
  "onsite",
  "errand",
  "travel",
]);

export type ValidatedSafetyFacts = {
  readonly [VALIDATED_SAFETY_FACTS]: true;
  readonly category: PostCategory;
  readonly lane: TransportServiceLane | null;
  readonly postType: PostType | null;
  readonly peopleCount: number;
  readonly peopleCapacity: number;
  readonly travelItemUnits: number;
  readonly escortPassengerCount: number;
  readonly transportMode: string | null;
};

export type SafetyFactsResult =
  | { ok: true; value: ValidatedSafetyFacts }
  | { ok: false; errorKey: string };

export type PaymentTimingId =
  | "after_arrival_and_identity_check"
  | "after_recipient_confirms_receipt"
  | "after_unload_and_appearance_check"
  | "after_completion_and_check"
  | "buy_split_principal_and_service";

export const PAYMENT_POLICY_V1 = {
  platformCollects: false,
  escrow: false,
  verifiesCashOrTransfer: false,
  allowStrangerPaymentLinks: false,
  allowBankSecretsRequest: false,
  recommendPrepaidServiceFee: false,
  feeChangeRequiresMutualReconfirm: true,
  timing: {
    travelPeople: "after_arrival_and_identity_check",
    travelSmallItem: "after_recipient_confirms_receipt",
    deliverLarge: "after_unload_and_appearance_check",
    onsiteErrand: "after_completion_and_check",
    buy: {
      id: "buy_split_principal_and_service" as const,
      splitPrincipalAndService: true,
      serviceFeeAfterHandover: true,
      goodsPrincipalByAdvanceMutualConfirm: true,
    },
  },
} as const;

function fail(errorKey: string): SafetyFactsResult {
  return { ok: false, errorKey };
}

function optionalQuantity(
  rec: Record<string, unknown>,
  key: string,
): { ok: true; value: number } | { ok: false; errorKey: string } {
  if (!(key in rec) || rec[key] === undefined || rec[key] === null) {
    return { ok: true, value: 0 };
  }
  return parsePolicyQuantity(rec[key]);
}

export function validateSafetyFacts(input: unknown): SafetyFactsResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return fail("error.safety_facts_invalid");
  }
  const rec = input as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!ALLOWED_SAFETY_KEYS.has(key)) {
      return fail("error.safety_facts_unknown_key");
    }
  }

  if (typeof rec.category !== "string" || !CATEGORIES.has(rec.category as PostCategory)) {
    return fail("error.safety_facts_invalid_category");
  }
  const category = rec.category as PostCategory;

  let lane: TransportServiceLane | null = null;
  if (rec.lane !== undefined && rec.lane !== null) {
    if (rec.lane !== "travel" && rec.lane !== "deliver") {
      return fail("error.safety_facts_invalid_lane");
    }
    lane = rec.lane;
  } else if (category === "travel" || category === "deliver") {
    lane = category;
  }

  if (
    (category === "travel" && lane === "deliver") ||
    (category === "deliver" && lane === "travel") ||
    ((category === "buy" || category === "onsite" || category === "errand") &&
      lane !== null)
  ) {
    return fail("error.safety_facts_lane_category_conflict");
  }

  let postType: PostType | null = null;
  if (rec.postType !== undefined && rec.postType !== null) {
    if (rec.postType !== "demand" && rec.postType !== "provider") {
      return fail("error.safety_facts_invalid_role");
    }
    postType = rec.postType;
  }

  const peopleCount = optionalQuantity(rec, "peopleCount");
  if (!peopleCount.ok) return peopleCount;
  const peopleCapacity = optionalQuantity(rec, "peopleCapacity");
  if (!peopleCapacity.ok) return peopleCapacity;
  const travelItemUnits = optionalQuantity(rec, "travelItemUnits");
  if (!travelItemUnits.ok) return travelItemUnits;
  const escortPassengerCount = optionalQuantity(rec, "escortPassengerCount");
  if (!escortPassengerCount.ok) return escortPassengerCount;

  if (postType === "demand" && "peopleCapacity" in rec && rec.peopleCapacity != null) {
    return fail("error.transport_people_field_not_allowed");
  }
  if (postType === "provider" && "peopleCount" in rec && rec.peopleCount != null) {
    return fail("error.transport_people_field_not_allowed");
  }

  let transportMode: string | null = null;
  if (rec.transportMode !== undefined && rec.transportMode !== null) {
    if (typeof rec.transportMode !== "string" || rec.transportMode.trim() === "") {
      return fail("error.safety_facts_invalid_mode");
    }
    transportMode = rec.transportMode;
    const policy = getTransportPolicy(transportMode);
    if (!policy) {
      return fail("error.safety_facts_invalid_mode");
    }
    if (lane && !isModeAllowedForLane(transportMode, lane)) {
      return fail("error.safety_facts_lane_mode_conflict");
    }
  }

  const value: ValidatedSafetyFacts = {
    [VALIDATED_SAFETY_FACTS]: true,
    category,
    lane,
    postType,
    peopleCount: peopleCount.value,
    peopleCapacity: peopleCapacity.value,
    travelItemUnits: travelItemUnits.value,
    escortPassengerCount: escortPassengerCount.value,
    transportMode,
  };
  return { ok: true, value };
}

function uniqueModules(modules: SafetyModule[]): SafetyModule[] {
  return [...new Set(modules)];
}

export function resolveSafetyModules(facts: ValidatedSafetyFacts): SafetyModule[] {
  const modules: SafetyModule[] = [...ALWAYS_ON_SAFETY_MODULES];
  const people =
    facts.postType === "provider" ? facts.peopleCapacity : facts.peopleCount;
  const modePolicy = facts.transportMode
    ? getTransportPolicy(facts.transportMode)
    : null;

  if (people > 0) modules.push("passenger_identity_vehicle");
  if (facts.lane === "travel" && facts.travelItemUnits > 0) {
    modules.push("small_item_handover");
  }
  if (facts.lane === "deliver") modules.push("large_item_handover");
  if (facts.lane === "deliver" && facts.escortPassengerCount === 1) {
    modules.push("escort_passenger");
  }
  if (modePolicy?.isPublicTransport) modules.push("public_transport_rules");
  if (modePolicy?.isWaterTransport) modules.push("water_transport_rules");
  if (facts.category === "buy") modules.push("purchase_help");
  if (facts.category === "onsite") modules.push("onsite_help");
  if (facts.category === "errand") modules.push("errand_help");

  return uniqueModules(modules);
}
