import type { PostFormState } from "@/lib/post-form/usePostFormState";
import type { PostPayload } from "@/lib/post-payload";
import { isDeliverOrTravel, isOnsiteOrErrand } from "@/lib/post-payload";
import { buildRawPhone, normalizeLicensePlate, normalizePhone } from "@/lib/post-validation";
import { calculateFinalFee } from "@/lib/post-fee";
import { mergeDepartureWindow } from "@/lib/post-time-windows";

export type BuildPayloadResult =
  | { ok: true; payload: PostPayload & Record<string, unknown> }
  | { ok: false; errorKey: string };

export function buildPayloadFromForm(
  state: PostFormState,
  phoneId: number,
  plateId: number | null,
): BuildPayloadResult {
  const phoneResult = normalizePhone(state.dial_code, state.raw_phone_local);
  if (!phoneResult.ok) return { ok: false, errorKey: phoneResult.errorKey };

  const route = isDeliverOrTravel(state.category);
  const local = isOnsiteOrErrand(state.category);
  const buy = state.category === "buy";

  let normalized_plate: string | null = null;
  let raw_plate: string | null = null;
  if (state.post_type === "provider" && state.raw_license_plate.trim()) {
    const plateResult = normalizeLicensePlate(state.raw_license_plate);
    if (!plateResult.ok) return { ok: false, errorKey: plateResult.errorKey };
    normalized_plate = plateResult.normalized;
    raw_plate = state.raw_license_plate.trim();
  }

  const fusedWindow = mergeDepartureWindow(state.departure_time, state.time_buffer);

  const payload: PostPayload & Record<string, unknown> = {
    post_type: state.post_type,
    category: state.category,
    phone_id: phoneId,
    raw_phone: buildRawPhone(state.dial_code, state.raw_phone_local),
    normalized_phone: phoneResult.normalized,
    departure_date: state.departure_date,
    departure_time_window: fusedWindow,
    estimated_arrival_time: null,
    count_small: route ? state.count_small : 0,
    count_medium: route ? state.count_medium : 0,
    count_large: route ? state.count_large : 0,
    count_xlarge: route ? state.count_xlarge : 0,
    bump_fee: state.post_type === "demand" && route ? state.bump_fee : 0,
    fee_amount: null,
    estimated_kms: state.estimated_kms,
    delivery_mode: null,
    share_mode: null,
    escort_seats: null,
    max_companions: null,
    item_condition: null,
    plate_id: plateId,
    raw_license_plate: raw_plate,
    normalized_license_plate: normalized_plate,
    provider_name: null,
    vehicle_brand: null,
    vehicle_color: null,
    waypoints: null,
    item_quantity: null,
    item_unit: null,
    price_calc_type: null,
    item_price: null,
    has_luggage: null,
    min_budget: null,
    max_budget: null,
    purchase_price_type: null,
    origin_address: null,
    destination_address: null,
    service_address: null,
    service_time_window: null,
    provider_pay_type: null,
    title: null,
    description: null,
  };

  if (route) {
    payload.origin_address = state.origin_address.trim();
    payload.destination_address = state.destination_address.trim();
    if (!payload.origin_address || !payload.destination_address) {
      return { ok: false, errorKey: "error.address_required" };
    }
    if (state.post_type === "provider") {
      const intermediate = state.waypoints.map((w) => w.trim()).filter(Boolean);
      payload.waypoints = [
        payload.origin_address as string,
        ...intermediate,
        payload.destination_address as string,
      ];
      payload.provider_name = state.provider_name.trim() || null;
      payload.vehicle_brand = state.vehicle_brand.trim() || null;
      payload.vehicle_color = state.vehicle_color.trim() || null;
      payload.transport_mode = state.transport_mode || null;
      const needsPlate =
        state.transport_mode === "car" ||
        state.transport_mode === "motorbike" ||
        state.transport_mode === "van";
      if (needsPlate && !normalized_plate) {
        return { ok: false, errorKey: "error.invalid_plate" };
      }
    }
    if (state.post_type === "demand") {
      if (state.estimated_kms <= 0) {
        return { ok: false, errorKey: "error.route_distance_failed" };
      }
    }
    if (state.post_type === "demand" && state.category === "deliver") {
      payload.delivery_mode = state.delivery_mode;
      payload.escort_seats = state.escort_seats;
    }
    if (state.category === "travel") {
      payload.max_companions = state.max_companions;
    }
    if (
      state.category === "travel" ||
      (state.category === "deliver" && state.escort_seats >= 1)
    ) {
      payload.share_mode = state.share_mode;
    }
    payload.has_luggage =
      state.count_small + state.count_medium + state.count_large + state.count_xlarge > 0;
    if (state.post_type === "demand") {
      payload.fee_amount = calculateFinalFee(state.estimated_kms, payload);
    }
    payload.title = "";
    payload.description = "";
  }

  if (buy) {
    payload.item_quantity = state.item_quantity;
    payload.item_unit = state.item_unit;
    payload.price_calc_type = state.price_calc_type;
    payload.item_condition = state.item_condition;
    payload.item_price = state.item_price;
    payload.service_address = state.service_address.trim() || null;
    payload.origin_address = state.service_address.trim() || state.origin_address.trim() || "";
    payload.destination_address = payload.origin_address;
    payload.departure_time_window = fusedWindow;
    payload.title = state.title.trim();
    payload.description = state.description.trim();
    if (!payload.origin_address) {
      return { ok: false, errorKey: "error.service_address_required" };
    }
    if (state.post_type === "demand") {
      payload.purchase_price_type = state.purchase_price_type;
      if (state.purchase_price_type === "range") {
        payload.min_budget = state.min_budget;
        payload.max_budget = state.max_budget;
      } else {
        payload.min_budget = null;
        payload.max_budget = null;
        if (!state.reference_photo_uploaded) {
          return { ok: false, errorKey: "error.reference_photo_required" };
        }
      }
    }
    if (state.post_type === "provider") {
      if (!state.item_price && state.item_price !== 0) {
        return { ok: false, errorKey: "error.item_price_required" };
      }
    }
  }

  if (local) {
    payload.service_address = state.service_address.trim();
    payload.service_time_window = fusedWindow;
    payload.origin_address = payload.service_address;
    payload.destination_address = payload.service_address;
    payload.title = state.title.trim();
    payload.description = state.description.trim();
    if (!payload.service_address) {
      return { ok: false, errorKey: "error.service_address_required" };
    }
    if (state.post_type === "demand") {
      payload.fee_amount = state.fixed_reward;
      if (state.fixed_reward == null || state.fixed_reward < 0) {
        return { ok: false, errorKey: "error.fixed_reward_required" };
      }
    } else {
      payload.provider_pay_type = state.provider_pay_type;
      if (state.provider_pay_type === "negotiable") {
        payload.fee_amount = 0;
      } else {
        payload.fee_amount = state.fixed_reward;
        if (state.fixed_reward == null || state.fixed_reward < 0) {
          return { ok: false, errorKey: "error.fixed_reward_required" };
        }
      }
    }
  }

  return { ok: true, payload };
}
