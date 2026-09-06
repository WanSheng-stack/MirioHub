/**
 * Public-safe post projection — columns that may leave the DB for hall/detail.
 * Must stay aligned with public.public_posts_safe (20260907000001).
 */

export const FORBIDDEN_PUBLIC_POST_COLUMNS = [
  "raw_phone",
  "normalized_phone",
  "phone_id",
  "contact_email",
  "plate_id",
  "raw_license_plate",
  "normalized_license_plate",
  "pickup_code",
  "delivery_code",
  "client_request_id",
  "payload_hash",
  "fallback_reason",
] as const;

export const PUBLIC_SAFE_POST_COLUMNS = [
  "id",
  "user_id",
  "title",
  "description",
  "status",
  "locale",
  "post_type",
  "category",
  "scope",
  "origin_address",
  "destination_address",
  "origin_gps",
  "destination_gps",
  "capacity_type",
  "transport_mode",
  "escort_seats",
  "max_companions",
  "fee_amount",
  "estimated_item_cost",
  "translations",
  "created_at",
  "updated_at",
  "delivery_mode",
  "share_mode",
  "item_condition",
  "provider_name",
  "vehicle_brand",
  "vehicle_color",
  "departure_date",
  "departure_time_window",
  "estimated_arrival_time",
  "waypoints",
  "item_quantity",
  "item_unit",
  "price_calc_type",
  "item_price",
  "count_small",
  "count_medium",
  "count_large",
  "count_xlarge",
  "has_luggage",
  "min_budget",
  "max_budget",
  "purchase_price_type",
  "bump_fee",
  "service_address",
  "service_time_window",
  "provider_pay_type",
  "completion_type",
  "completion_note",
  "matched_at",
  "auto_melt_deadline",
  "fee_amount_minor",
  "currency",
] as const;

export const PUBLIC_SAFE_POST_SELECT = PUBLIC_SAFE_POST_COLUMNS.join(", ");

/** Owner / match-participant row. Includes contact fields the public view omits. */
export const OWNER_POST_SELECT = [
  PUBLIC_SAFE_POST_SELECT,
  "raw_phone",
  "normalized_phone",
  "phone_id",
  "plate_id",
  "raw_license_plate",
  "normalized_license_plate",
  "pickup_code",
  "delivery_code",
].join(", ");

export function publicSelectContainsForbidden(select: string): boolean {
  const cols = new Set(
    select
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  );
  return FORBIDDEN_PUBLIC_POST_COLUMNS.some((col) => cols.has(col));
}
