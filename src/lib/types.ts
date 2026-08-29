export type SystemConfig = {
  id: number;
  is_global_free_campaign: boolean;
  must_read_sr: string;
  must_read_en: string;
  must_read_zh: string;
  bank_name: string;
  bank_recipient: string;
  bank_account: string;
  bank_reference: string;
  ips_qr_url: string;
  wechat_support_hint: string;
};

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  plate: string | null;
  vehicle: string | null;
  facebook: string | null;
  viber: string | null;
  is_premium: boolean;
  is_admin: boolean;
  free_views_left: number;
  is_bank_verified?: boolean;
  bank_reference_code?: string | null;
};

/** P2 marketplace post — Demand / Provider mixed hall */
export type PostType = "demand" | "provider";
export type PostCategory = "deliver" | "buy" | "onsite" | "errand" | "travel";
export type PostScope = "near" | "city" | "intercity" | "cross_border";
export type PostStatus =
  | "draft"
  | "active"
  | "matched"
  | "pending_completion"
  | "completed"
  | "canceled";
export type CapacityType = "backpack" | "suitcase" | "trunk";
export type TransportMode =
  | "walking"
  | "scooter"
  | "bicycle"
  | "motorbike"
  | "subway"
  | "bus"
  | "train"
  | "flight"
  | "car"
  | "van";

export type DeliveryMode = "spot" | "door";
export type ShareMode = "share" | "private";
export type ItemUnit = "pcs" | "kg" | "g" | "l" | "ml" | "box" | "pack" | "bottle";

export type Post = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  status: PostStatus;
  locale: "zh" | "en" | "sr";
  post_type: PostType;
  category: PostCategory;
  scope: PostScope;
  origin_address: string;
  destination_address: string;
  origin_gps: unknown | null;
  destination_gps: unknown | null;
  capacity_type: CapacityType | null;
  transport_mode: TransportMode | null;
  escort_seats: number;
  fee_amount: number | null;
  estimated_item_cost: number | null;
  translations?: Record<string, string> | null;
  created_at: string;
  updated_at: string;
  delivery_mode?: DeliveryMode | null;
  share_mode?: ShareMode | null;
  max_companions?: number | null;
  item_condition?: "new" | "used" | null;
  phone_id?: number | null;
  raw_phone?: string | null;
  normalized_phone?: string | null;
  plate_id?: number | null;
  raw_license_plate?: string | null;
  normalized_license_plate?: string | null;
  provider_name?: string | null;
  vehicle_brand?: string | null;
  vehicle_color?: string | null;
  departure_date?: string | null;
  departure_time_window?: string | null;
  waypoints?: string[] | null;
  item_quantity?: number | null;
  item_unit?: ItemUnit | null;
  count_small?: number;
  count_medium?: number;
  count_large?: number;
  count_xlarge?: number;
  bump_fee?: number | null;
  service_address?: string | null;
  completion_type?: "standard" | "auto_melt" | null;
  completion_note?: string | null;
  pickup_code?: string | null;
  delivery_code?: string | null;
  auto_melt_deadline?: string | null;
  matched_at?: string | null;
};

export type MatchRow = {
  id: string;
  post_id: string;
  demand_user_id: string;
  provider_user_id: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
};

export type RevealResult = {
  ok: boolean;
  phone?: string;
  error?: "AUTH" | "NOT_FOUND" | "NO_PHONE" | "PAYWALL" | string;
  unlock_mode?: string;
  campaign?: boolean;
  free_views_left?: number;
  server_utc?: string;
};
