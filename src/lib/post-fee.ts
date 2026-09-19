import type { PostPayload } from "@/lib/post-payload";
import { totalLuggageUnits } from "@/lib/post-payload";

/** Frozen luggage unit weights (do not change without a fee-contract phase). */
export const LUGGAGE_UNIT_SMALL = 1;
export const LUGGAGE_UNIT_MEDIUM = 3;
export const LUGGAGE_UNIT_LARGE = 6;
export const LUGGAGE_UNIT_XLARGE = 12;

/** Ordinary carry-on included per passenger in passenger fee scenes. */
export const FREE_LUGGAGE_UNITS_PER_PASSENGER = 4;

export type FinalFeeParts = {
  baseRouteFee: number;
  humanSeatFee: number;
  cargoOrSpaceFee: number;
  deliveryPremium: number;
  bumpFee: number;
  total: number;
  isPassengerFeeScene: boolean;
  freeLuggageUnits: number;
  demandedLuggageUnits: number;
  billableExtraUnits: number;
};

/**
 * Travel passenger fee scene = passenger | passenger_with_small_item only.
 * small_item_only must never enter this branch.
 * Deliver escort (cargo_with_escort) remains a passenger-fee scene via seats.
 */
export function isPassengerFeeScene(
  payload: Pick<PostPayload, "category" | "escort_seats" | "service_subtype">,
): boolean {
  if (payload.category === "travel") {
    return (
      payload.service_subtype === "passenger" ||
      payload.service_subtype === "passenger_with_small_item"
    );
  }
  if (payload.category === "deliver") {
    return (payload.escort_seats ?? 0) >= 1;
  }
  return false;
}

function passengerSeatCount(payload: PostPayload): number {
  return payload.share_mode === "private" ? 4 : payload.escort_seats || 1;
}

export function calculateFinalFeeParts(
  kms: number,
  payload: PostPayload,
): FinalFeeParts {
  if (payload.category === "onsite" || payload.category === "errand") {
    return {
      baseRouteFee: 0,
      humanSeatFee: 0,
      cargoOrSpaceFee: 0,
      deliveryPremium: 0,
      bumpFee: payload.bump_fee || 0,
      total: payload.bump_fee || 0,
      isPassengerFeeScene: false,
      freeLuggageUnits: 0,
      demandedLuggageUnits: 0,
      billableExtraUnits: 0,
    };
  }

  let baseRouteFee =
    kms <= 100 ? kms * 0.05 : 100 * 0.05 + (kms - 100) * 0.035;
  baseRouteFee = Math.max(3.0, baseRouteFee);

  const passengerScene = isPassengerFeeScene(payload);
  let humanSeatFee = 0;
  let cargoOrSpaceFee = 0;
  let freeLuggageUnits = 0;
  let demandedLuggageUnits = 0;
  let billableExtraUnits = 0;

  if (passengerScene) {
    const currentSeats = passengerSeatCount(payload);
    let passengerDiscountRatio = 1.0;
    if (currentSeats === 2) passengerDiscountRatio = 0.9;
    else if (currentSeats === 3) passengerDiscountRatio = 0.8;
    else if (currentSeats === 4) passengerDiscountRatio = 0.7;
    humanSeatFee = baseRouteFee * passengerDiscountRatio * currentSeats;

    demandedLuggageUnits = totalLuggageUnits({
      count_small: payload.count_small ?? 0,
      count_medium: payload.count_medium ?? 0,
      count_large: payload.count_large ?? 0,
      count_xlarge: payload.count_xlarge ?? 0,
    });
    // passenger: counts cleaned to 0; free allowance is still seats×4 (product rule).
    // passenger_with_small_item: only units above seats×4 are billed.
    freeLuggageUnits = currentSeats * FREE_LUGGAGE_UNITS_PER_PASSENGER;
    billableExtraUnits = Math.max(0, demandedLuggageUnits - freeLuggageUnits);
    cargoOrSpaceFee = billableExtraUnits * (baseRouteFee * 0.075);
  } else {
    humanSeatFee = 0;
    freeLuggageUnits = 0;
    demandedLuggageUnits = totalLuggageUnits({
      count_small: payload.count_small ?? 0,
      count_medium: payload.count_medium ?? 0,
      count_large: payload.count_large ?? 0,
      count_xlarge: payload.count_xlarge ?? 0,
    });
    billableExtraUnits = demandedLuggageUnits;
    const totalCargoCoefficient =
      (payload.count_small ?? 0) * 0.25 +
      (payload.count_medium ?? 0) * 0.45 +
      (payload.count_large ?? 0) * 0.75 +
      (payload.count_xlarge ?? 0) * 1.5;
    cargoOrSpaceFee = baseRouteFee * totalCargoCoefficient;
  }

  const deliveryPremium =
    payload.delivery_mode === "door" ? (kms <= 10 ? 2.0 : 4.0) : 0;
  const bumpFee = payload.bump_fee || 0;
  const total = humanSeatFee + cargoOrSpaceFee + deliveryPremium + bumpFee;

  return {
    baseRouteFee,
    humanSeatFee,
    cargoOrSpaceFee,
    deliveryPremium,
    bumpFee,
    total,
    isPassengerFeeScene: passengerScene,
    freeLuggageUnits,
    demandedLuggageUnits,
    billableExtraUnits,
  };
}

export function calculateFinalFee(kms: number, payload: PostPayload): number {
  return calculateFinalFeeParts(kms, payload).total;
}
