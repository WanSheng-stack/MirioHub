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

export const POST_CATEGORIES: readonly PostCategory[] = [
  "deliver",
  "buy",
  "travel",
  "onsite",
  "errand",
] as const;

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

export function isPassengerScene(payload: Pick<PostPayload, "category" | "escort_seats">): boolean {
  return (
    payload.category === "travel" ||
    (payload.category === "deliver" && (payload.escort_seats ?? 0) >= 1)
  );
}

export function totalLuggageUnits(payload: Pick<PostPayload, "count_small" | "count_medium" | "count_large" | "count_xlarge">): number {
  return (
    payload.count_small * 1 +
    payload.count_medium * 3 +
    payload.count_large * 6 +
    payload.count_xlarge * 12
  );
}
