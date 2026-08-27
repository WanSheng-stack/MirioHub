import type { OrderRole } from "@/lib/roles";

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
};

export type Order = {
  id: string;
  author_id: string;
  role: OrderRole;
  title: string;
  description: string;
  task_notes: string;
  from_city: string;
  to_city: string;
  source_locale: "sr" | "en" | "zh";
  translations: Record<string, string> | null;
  status: "open" | "matched" | "cancelled";
  created_at: string;
};

/** P2 marketplace post — Demand (left) / Provider (right) mirror hall */
export type PostType = "demand" | "provider";
export type PostCategory = "deliver" | "buy" | "onsite" | "errand" | "travel";
export type PostScope = "near" | "city" | "intercity" | "cross_border";
export type PostStatus = "draft" | "active" | "completed" | "canceled";
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
  /** GeoJSON Point from PostGIS, or null until pinned */
  origin_gps: unknown | null;
  destination_gps: unknown | null;
  capacity_type: CapacityType | null;
  transport_mode: TransportMode | null;
  escort_seats: number;
  fee_amount: number | null;
  estimated_item_cost: number | null;
  created_at: string;
  updated_at: string;
};

export type MatchRow = {
  id: string;
  order_id: string;
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
