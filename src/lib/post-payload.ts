import type {
  DeliverServiceSubtype,
  ServiceSubtype,
  TravelServiceSubtype,
} from "@/lib/safety/nightServicePolicy";

export type PostType = "demand" | "provider";
export type PostCategory = "deliver" | "buy" | "travel" | "onsite" | "errand";
export type DeliveryMode = "spot" | "door";
export type ShareMode = "share" | "private";
export type ItemCondition = "new" | "used";
export type ItemUnit = "pcs" | "kg" | "g" | "l" | "ml" | "box" | "pack" | "bottle";
export type PriceCalcType = "unit" | "total";
export type PurchasePriceType = "range" | "negotiable";
export type ProviderPayType = "hourly" | "fixed" | "negotiable";
export type CompletionType = "standard" | "auto_melt";

export interface PostPayload {
  post_type: PostType;
  category: PostCategory;
  delivery_mode?: DeliveryMode | null;
  share_mode?: ShareMode | null;
  escort_seats?: number | null;
  max_companions?: number | null;
  item_condition?: ItemCondition | null;
  phone_id: number;
  raw_phone: string;
  normalized_phone: string;
  plate_id?: number | null;
  raw_license_plate?: string | null;
  normalized_license_plate?: string | null;
  provider_name?: string | null;
  vehicle_brand?: string | null;
  vehicle_color?: string | null;
  transport_mode?: string | null;
  service_subtype?: ServiceSubtype | null;
  departure_date: string;
  departure_time_window: string;
  estimated_arrival_time: string | null;
  waypoints?: string[] | null;
  item_quantity?: number | null;
  item_unit?: ItemUnit | null;
  price_calc_type?: PriceCalcType | null;
  item_price?: number | null;
  count_small: number;
  count_medium: number;
  count_large: number;
  count_xlarge: number;
  has_luggage?: boolean | null;
  min_budget?: number | null;
  max_budget?: number | null;
  purchase_price_type?: PurchasePriceType | null;
  bump_fee?: number;
  fee_amount: number | string | null;
  pickup_code?: string | null;
  delivery_code?: string | null;
  completion_type?: CompletionType | null;
  completion_note?: string | null;
  /** Extended fields for DB insert */
  origin_address?: string | null;
  destination_address?: string | null;
  service_address?: string | null;
  service_time_window?: string | null;
  provider_pay_type?: ProviderPayType | null;
  title?: string | null;
  description?: string | null;
  estimated_kms?: number;
}

export {
  DELIVER_SERVICE_SUBTYPES,
  TRAVEL_SERVICE_SUBTYPES,
} from "@/lib/safety/nightServicePolicy";
export type { DeliverServiceSubtype, ServiceSubtype, TravelServiceSubtype };

export const POST_CATEGORIES: readonly PostCategory[] = [
  "travel",
  "deliver",
  "buy",
  "onsite",
  "errand",
] as const;

/** HelloBike-style circular icon order on home console. */
export const HOME_CATEGORY_ORDER: readonly PostCategory[] = [
  "travel",
  "deliver",
  "buy",
  "onsite",
  "errand",
] as const;

export const CATEGORY_ICONS: Record<PostCategory, string> = {
  travel: "🧑‍🤝‍🧑",
  deliver: "📦",
  buy: "🛒",
  onsite: "🛠️",
  errand: "🏃",
};

export const ITEM_UNITS: readonly ItemUnit[] = [
  "pcs",
  "kg",
  "g",
  "l",
  "ml",
  "box",
  "pack",
  "bottle",
] as const;

export const BUMP_FEE_OPTIONS = [0, 2, 5, 10] as const;

export function isDeliverOrTravel(category: PostCategory): boolean {
  return category === "deliver" || category === "travel";
}

export function isOnsiteOrErrand(category: PostCategory): boolean {
  return category === "onsite" || category === "errand";
}

export function isPassengerScene(
  payload: Pick<PostPayload, "category" | "escort_seats" | "service_subtype">,
): boolean {
  if (payload.category === "travel") {
    return (
      payload.service_subtype === "passenger" ||
      payload.service_subtype === "passenger_with_small_item"
    );
  }
  return (
    payload.category === "deliver" && (payload.escort_seats ?? 0) >= 1
  );
}

/** Frozen unit weights — keep in sync with post-fee. */
export function totalLuggageUnits(payload: Pick<PostPayload, "count_small" | "count_medium" | "count_large" | "count_xlarge">): number {
  return (
    (payload.count_small ?? 0) * 1 +
    (payload.count_medium ?? 0) * 3 +
    (payload.count_large ?? 0) * 6 +
    (payload.count_xlarge ?? 0) * 12
  );
}

/**
 * Travel subtypes that require explicit item counts (> 0) before publish.
 * passenger implies ordinary carry-on and does not use counters.
 */
export function travelSubtypeRequiresItemUnits(
  serviceSubtype: ServiceSubtype | null | undefined,
): boolean {
  return (
    serviceSubtype === "small_item_only" ||
    serviceSubtype === "passenger_with_small_item"
  );
}

export function travelItemUnitsMissingErrorKey(
  payload: Pick<
    PostPayload,
    | "category"
    | "service_subtype"
    | "count_small"
    | "count_medium"
    | "count_large"
    | "count_xlarge"
  >,
): string | null {
  if (payload.category !== "travel") return null;
  if (!travelSubtypeRequiresItemUnits(payload.service_subtype)) return null;
  if (totalLuggageUnits(payload) > 0) return null;
  return "error.luggage_items_required";
}
