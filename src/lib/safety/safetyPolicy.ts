/**
 * PHASE 6.7B.1A — composable safety-module policy.
 *
 * An order can combine people, small items, large cargo, escort, water, and
 * public transport. Do not collapse this into a single exclusive scenario enum.
 *
 * This round: types, resolver, copy-key contract, payment V1 contract.
 * No production UI mount. No payment/order-state/database changes.
 *
 * platform_boundary, payment_anti_scam, and unlisted_risk_catchall are always
 * present. The catchall is a shared key — do not paste the long body into
 * every scenario. Do not ask the user to certify that no unknown risk exists.
 *
 * Future server (6.7C+) must re-read post facts from DB. Do not trust
 * browser-supplied category, lane, people counts, or escort flags.
 */

import type { PostCategory } from "@/lib/post-payload";
import {
  getTransportPolicy,
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

/** Shared copy keys. Bodies live in messages; do not duplicate long text. */
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

export type SafetyFacts = {
  category: PostCategory;
  lane?: TransportServiceLane | null;
  peopleCount?: number | null;
  travelItemTotal?: number | null;
  escortPassengerCount?: number | null;
  transportMode?: string | null;
};

export type PaymentTimingId =
  | "after_arrival_and_identity_check"
  | "after_recipient_confirms_receipt"
  | "after_unload_and_appearance_check"
  | "after_completion_and_check"
  | "buy_split_principal_and_service";

/**
 * V1 payment contract only. Not wired to checkout, order status, or DB.
 * Platform does not collect, escrow, or independently verify cash/transfer.
 */
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
      id: "buy_split_principal_and_service",
      splitPrincipalAndService: true,
      serviceFeeAfterHandover: true,
      goodsPrincipalByAdvanceMutualConfirm: true,
    },
  },
} as const satisfies {
  platformCollects: false;
  escrow: false;
  verifiesCashOrTransfer: false;
  allowStrangerPaymentLinks: false;
  allowBankSecretsRequest: false;
  recommendPrepaidServiceFee: false;
  feeChangeRequiresMutualReconfirm: true;
  timing: {
    travelPeople: PaymentTimingId;
    travelSmallItem: PaymentTimingId;
    deliverLarge: PaymentTimingId;
    onsiteErrand: PaymentTimingId;
    buy: {
      id: PaymentTimingId;
      splitPrincipalAndService: boolean;
      serviceFeeAfterHandover: boolean;
      goodsPrincipalByAdvanceMutualConfirm: boolean;
    };
  };
};

function uniqueModules(modules: SafetyModule[]): SafetyModule[] {
  return [...new Set(modules)];
}

export function resolveSafetyModules(facts: SafetyFacts): SafetyModule[] {
  const modules: SafetyModule[] = [...ALWAYS_ON_SAFETY_MODULES];
  const lane =
    facts.lane ??
    (facts.category === "travel" || facts.category === "deliver"
      ? facts.category
      : null);
  const people = facts.peopleCount ?? 0;
  const travelItems = facts.travelItemTotal ?? 0;
  const escort = facts.escortPassengerCount ?? 0;
  const modePolicy = facts.transportMode
    ? getTransportPolicy(facts.transportMode)
    : null;

  if (people > 0) modules.push("passenger_identity_vehicle");
  if (lane === "travel" && travelItems > 0) modules.push("small_item_handover");
  if (lane === "deliver") modules.push("large_item_handover");
  if (lane === "deliver" && escort === 1) modules.push("escort_passenger");
  if (modePolicy?.isPublicTransport) modules.push("public_transport_rules");
  if (modePolicy?.isWaterTransport) modules.push("water_transport_rules");
  if (facts.category === "buy") modules.push("purchase_help");
  if (facts.category === "onsite") modules.push("onsite_help");
  if (facts.category === "errand") modules.push("errand_help");

  return uniqueModules(modules);
}
