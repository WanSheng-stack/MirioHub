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
  "origin_gps",
  "destination_gps",
  "service_address",
  "completion_note",
  "auto_melt_deadline",
  "matched_at",
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
  "service_time_window",
  "provider_pay_type",
  "completion_type",
  "fee_amount_minor",
  "currency",
] as const;

export const PUBLIC_SAFE_POST_SELECT = PUBLIC_SAFE_POST_COLUMNS.join(", ");

const OWNER_EXTRA_POST_COLUMNS = [
  "origin_gps",
  "destination_gps",
  "service_address",
  "completion_note",
  "auto_melt_deadline",
  "matched_at",
  "raw_phone",
  "normalized_phone",
  "phone_id",
  "plate_id",
  "raw_license_plate",
  "normalized_license_plate",
  "pickup_code",
  "delivery_code",
] as const;

/** Owner / match-participant row. Includes contact and private location fields. */
export const OWNER_POST_SELECT = [
  PUBLIC_SAFE_POST_SELECT,
  ...OWNER_EXTRA_POST_COLUMNS,
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
