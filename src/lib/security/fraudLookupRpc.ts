import type { SupabaseClient } from "@supabase/supabase-js";

export type WindowInterceptMetrics = {
  window_phone_account_count: number;
  has_other_phone: boolean;
  has_other_plate: boolean;
  own_in_window_count: number;
  own_cargo_in_window: number;
};

export type ForeignPhoneReuse = {
  reused: boolean;
  last_post_at: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function parseWindowInterceptMetrics(
  value: unknown,
): WindowInterceptMetrics | null {
  const row = asRecord(value);
  if (!row) return null;
  const count = Number(row.window_phone_account_count);
  const own = Number(row.own_in_window_count);
  const cargo = Number(row.own_cargo_in_window);
  if (!Number.isFinite(count) || !Number.isFinite(own) || !Number.isFinite(cargo)) {
    return null;
  }
  return {
    window_phone_account_count: count,
    has_other_phone: Boolean(row.has_other_phone),
    has_other_plate: Boolean(row.has_other_plate),
    own_in_window_count: own,
    own_cargo_in_window: cargo,
  };
}

export function parseForeignPhoneReuse(value: unknown): ForeignPhoneReuse | null {
  const row = asRecord(value);
  if (!row) return null;
  return {
    reused: Boolean(row.reused),
    last_post_at:
      typeof row.last_post_at === "string" || row.last_post_at === null
        ? (row.last_post_at as string | null)
        : null,
  };
}

export async function rpcCountAssetBoundAccounts(
  supabase: SupabaseClient,
  kind: "phone" | "plate",
  value: string,
): Promise<number | null> {
  if (!value) return 0;
  const { data, error } = await supabase.rpc("count_asset_bound_accounts_v86", {
    p_kind: kind,
    p_value: value,
  });
  if (error) return null;
  const n = typeof data === "number" ? data : Number(data);
  return Number.isFinite(n) ? n : null;
}

export async function rpcLookupForeignPhoneReuse(
  supabase: SupabaseClient,
  userId: string,
  normalizedPhone: string,
): Promise<ForeignPhoneReuse | null> {
  const { data, error } = await supabase.rpc("lookup_foreign_phone_reuse_v86", {
    p_user_id: userId,
    p_normalized_phone: normalizedPhone,
  });
  if (error) return null;
  return parseForeignPhoneReuse(data);
}

export async function rpcGatherWindowInterceptMetrics(
  supabase: SupabaseClient,
  userId: string,
  normalizedPhone: string,
  normalizedPlate: string | null,
  departureDate: string,
  departureWindow: string,
): Promise<WindowInterceptMetrics | null> {
  const { data, error } = await supabase.rpc(
    "gather_window_intercept_metrics_v86",
    {
      p_user_id: userId,
      p_normalized_phone: normalizedPhone,
      p_normalized_plate: normalizedPlate,
      p_departure_date: departureDate || null,
      p_departure_window: departureWindow || null,
    },
  );
  if (error) return null;
  return parseWindowInterceptMetrics(data);
}
