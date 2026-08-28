import type { PostPayload } from "@/lib/post-payload";

export function calculateFinalFee(kms: number, payload: PostPayload): number {
  if (payload.category === "onsite" || payload.category === "errand") return 0;
  let base_route_fee = kms <= 100 ? kms * 0.05 : 100 * 0.05 + (kms - 100) * 0.035;
  base_route_fee = Math.max(3.0, base_route_fee);
  const is_passenger_scene =
    payload.category === "travel" ||
    (payload.category === "deliver" && payload.escort_seats && payload.escort_seats >= 1);
  let cargo_or_space_fee = 0;
  let human_seat_fee = 0;
  if (is_passenger_scene === true) {
    const current_seats = payload.share_mode === "private" ? 4 : payload.escort_seats || 1;

    let passenger_discount_ratio = 1.0;
    if (current_seats === 2) passenger_discount_ratio = 0.9;
    else if (current_seats === 3) passenger_discount_ratio = 0.8;
    else if (current_seats === 4) passenger_discount_ratio = 0.7;
    human_seat_fee = base_route_fee * passenger_discount_ratio * current_seats;
    const total_demanded_units =
      payload.count_small * 1 +
      payload.count_medium * 3 +
      payload.count_large * 6 +
      payload.count_xlarge * 12;
    const total_allowed_free_units = current_seats * 4;
    const extra_units = Math.max(0, total_demanded_units - total_allowed_free_units);
    cargo_or_space_fee = extra_units * (base_route_fee * 0.075);
  } else {
    human_seat_fee = 0;
    const total_cargo_coefficient =
      payload.count_small * 0.25 +
      payload.count_medium * 0.45 +
      payload.count_large * 0.75 +
      payload.count_xlarge * 1.5;

    cargo_or_space_fee = base_route_fee * total_cargo_coefficient;
  }
  const delivery_premium = payload.delivery_mode === "door" ? (kms <= 10 ? 2.0 : 4.0) : 0;
  return human_seat_fee + cargo_or_space_fee + delivery_premium + (payload.bump_fee || 0);
}
