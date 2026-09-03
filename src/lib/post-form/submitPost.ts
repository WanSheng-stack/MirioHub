import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPayloadFromForm } from "@/lib/post-form/buildPayload";
import type { PostFormState } from "@/lib/post-form/usePostFormState";
import {
  processDemandPostIntercept,
  processSupplyPostIntercept,
} from "@/lib/post-intercept";
import { buildDepartureTimestamp, demandInterceptRange } from "@/lib/post-time-windows";
import { geocodeAddress, toGeographyPointWkt } from "@/lib/route-kms";
import { haversineKm } from "@/lib/geo";
import type { AppLocale } from "@/i18n/routing";
import type { PostScope } from "@/lib/types";

async function resolveGeocodePair(
  originAddr: string,
  destAddr: string,
): Promise<{
  origin: { lat: number; lon: number; wkt: string } | null;
  destination: { lat: number; lon: number; wkt: string } | null;
}> {
  try {
    const res = await fetch("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin: originAddr, destination: destAddr }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      origin?: { lat: number; lon: number; wkt: string } | null;
      destination?: { lat: number; lon: number; wkt: string } | null;
    };
    return {
      origin: json.origin ?? null,
      destination: json.destination ?? null,
    };
  } catch {
    const [o, d] = await Promise.all([
      originAddr ? geocodeAddress(originAddr) : Promise.resolve(null),
      destAddr ? geocodeAddress(destAddr) : Promise.resolve(null),
    ]);
    return {
      origin: o ? { lat: o.lat, lon: o.lon, wkt: toGeographyPointWkt(o.lat, o.lon) } : null,
      destination: d
        ? { lat: d.lat, lon: d.lon, wkt: toGeographyPointWkt(d.lat, d.lon) }
        : null,
    };
  }
}

export type SubmitPostResult =
  | { ok: true; postId: string }
  | { ok: false; errorKey: string; logFraud?: boolean };

export async function upsertPhoneHistory(
  supabase: SupabaseClient,
  userId: string,
  normalizedPhone: string,
): Promise<number> {
  const { data: existing } = await supabase
    .from("phone_history")
    .select("id")
    .eq("normalized_phone", normalizedPhone)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("phone_history")
      .update({ last_post_at: new Date().toISOString() })
      .eq("id", existing.id);
    return existing.id as number;
  }

  const { data: inserted, error } = await supabase
    .from("phone_history")
    .insert({
      user_id: userId,
      normalized_phone: normalizedPhone,
      last_post_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !inserted) return 0;
  return inserted.id as number;
}

export async function upsertPlateHistory(
  supabase: SupabaseClient,
  userId: string,
  normalizedLicensePlate: string,
): Promise<number | null> {
  if (!normalizedLicensePlate) return null;

  const { data: existing } = await supabase
    .from("plate_history")
    .select("id")
    .eq("normalized_license_plate", normalizedLicensePlate)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.id) return existing.id as number;

  const { data: inserted, error } = await supabase
    .from("plate_history")
    .insert({
      user_id: userId,
      normalized_license_plate: normalizedLicensePlate,
    })
    .select("id")
    .single();
  if (error || !inserted) return null;
  return inserted.id as number;
}

/** Distinct UUID count bound to a phone across history + live posts. */
async function countPhoneBoundAccounts(
  supabase: SupabaseClient,
  normalizedPhone: string,
): Promise<number> {
  const accounts = new Set<string>();
  const { data: history } = await supabase
    .from("phone_history")
    .select("user_id")
    .eq("normalized_phone", normalizedPhone);
  for (const row of history ?? []) accounts.add(row.user_id as string);

  const { data: posts } = await supabase
    .from("posts")
    .select("user_id")
    .eq("normalized_phone", normalizedPhone)
    .in("status", ["active", "matched", "pending_completion"]);
  for (const row of posts ?? []) accounts.add(row.user_id as string);
  return accounts.size;
}

async function countPlateBoundAccounts(
  supabase: SupabaseClient,
  normalizedPlate: string,
): Promise<number> {
  if (!normalizedPlate) return 0;
  const accounts = new Set<string>();
  const { data: history } = await supabase
    .from("plate_history")
    .select("user_id")
    .eq("normalized_license_plate", normalizedPlate);
  for (const row of history ?? []) accounts.add(row.user_id as string);

  const { data: posts } = await supabase
    .from("posts")
    .select("user_id")
    .eq("normalized_license_plate", normalizedPlate)
    .in("status", ["active", "matched", "pending_completion"]);
  for (const row of posts ?? []) accounts.add(row.user_id as string);
  return accounts.size;
}

export async function gatherDemandMetrics(
  supabase: SupabaseClient,
  userId: string,
  normalizedPhone: string,
  normalizedPlate: string | null,
  departureDate: string,
  departureWindow: string,
) {
  const { from, to } = demandInterceptRange(departureDate, departureWindow);
  const { data: rows } = await supabase
    .from("posts")
    .select(
      "user_id, normalized_phone, normalized_license_plate, status, departure_date, departure_time_window",
    )
    .in("status", ["active", "matched", "pending_completion"]);

  const inWindow = (rows ?? []).filter((r) => {
    if (!r.departure_date || !r.departure_time_window) return false;
    const ts = buildDepartureTimestamp(r.departure_date, r.departure_time_window);
    return ts >= from && ts <= to;
  });

  const phoneMatches = inWindow.filter((r) => r.normalized_phone === normalizedPhone);
  const phoneAccountIds = new Set(phoneMatches.map((r) => r.user_id as string));
  phoneAccountIds.add(userId);

  const historyPhoneAccounts = await countPhoneBoundAccounts(supabase, normalizedPhone);
  const plateAccounts = normalizedPlate
    ? await countPlateBoundAccounts(supabase, normalizedPlate)
    : 0;

  const account_count = Math.max(phoneAccountIds.size, historyPhoneAccounts, plateAccounts);
  const is_phone_duplicated =
    phoneMatches.some((r) => r.user_id !== userId) || historyPhoneAccounts > 1 || plateAccounts > 1;

  const activeOwn = inWindow.filter((r) => r.user_id === userId).length;

  return {
    is_phone_duplicated,
    account_count,
    active_order_count: activeOwn,
  };
}

export async function gatherSupplyMetrics(
  supabase: SupabaseClient,
  userId: string,
  normalizedPhone: string,
  normalizedPlate: string | null,
  isPremium: boolean,
) {
  const { data: history } = await supabase
    .from("phone_history")
    .select("user_id, last_post_at, created_at")
    .eq("normalized_phone", normalizedPhone)
    .neq("user_id", userId)
    .order("last_post_at", { ascending: false })
    .limit(1);

  let is_phone_historically_reused = false;
  let last_post_time_delta_months = 999;
  if (history && history.length > 0) {
    is_phone_historically_reused = true;
    const last = new Date(
      (history[0].last_post_at as string) ?? (history[0].created_at as string),
    );
    last_post_time_delta_months = Math.floor(
      (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24 * 30),
    );
  }

  const phoneAccounts = await countPhoneBoundAccounts(supabase, normalizedPhone);
  const plateAccounts = normalizedPlate
    ? await countPlateBoundAccounts(supabase, normalizedPlate)
    : 0;
  if (phoneAccounts > 1 || plateAccounts > 1) {
    is_phone_historically_reused = true;
    last_post_time_delta_months = Math.min(last_post_time_delta_months, 0);
  }

  const { count } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("post_type", "provider")
    .eq("status", "active");

  return {
    is_phone_historically_reused,
    last_post_time_delta_months,
    active_supply_posts_count: count ?? 0,
    is_premium_member: isPremium,
  };
}

export async function submitPost(
  supabase: SupabaseClient,
  userId: string,
  locale: AppLocale,
  formState: PostFormState,
  isPremium: boolean,
): Promise<SubmitPostResult> {
  const built = buildPayloadFromForm(formState, 0, null);
  if (!built.ok) return { ok: false, errorKey: built.errorKey };

  const { payload } = built;

  const phoneId = await upsertPhoneHistory(supabase, userId, payload.normalized_phone);
  payload.phone_id = phoneId;

  const plateId = payload.normalized_license_plate
    ? await upsertPlateHistory(supabase, userId, payload.normalized_license_plate)
    : null;
  payload.plate_id = plateId;

  if (payload.post_type === "demand") {
    const metrics = await gatherDemandMetrics(
      supabase,
      userId,
      payload.normalized_phone,
      payload.normalized_license_plate ?? null,
      payload.departure_date,
      payload.departure_time_window,
    );
    const decision = processDemandPostIntercept(metrics);
    if (!decision.allowed) {
      if (decision.logFraud) {
        await supabase.from("fraud_logs").insert({
          user_id: userId,
          scene: decision.trackerScene,
          normalized_phone: payload.normalized_phone,
          normalized_license_plate: payload.normalized_license_plate,
          reporter_side: "demand",
        });
      }
      return { ok: false, errorKey: decision.messageKey, logFraud: decision.logFraud };
    }
  } else {
    const metrics = await gatherSupplyMetrics(
      supabase,
      userId,
      payload.normalized_phone,
      payload.normalized_license_plate ?? null,
      isPremium,
    );
    const decision = processSupplyPostIntercept(metrics);
    if (!decision.allowed) {
      if (decision.logFraud) {
        await supabase.from("fraud_logs").insert({
          user_id: userId,
          scene: decision.trackerScene,
          normalized_phone: payload.normalized_phone,
          normalized_license_plate: payload.normalized_license_plate,
          reporter_side: "provider",
        });
      }
      return { ok: false, errorKey: decision.messageKey, logFraud: decision.logFraud };
    }
  }

  const originAddr =
    (payload.origin_address as string) ||
    (payload.service_address as string) ||
    "";
  const destAddr =
    (payload.destination_address as string) ||
    (payload.service_address as string) ||
    originAddr;

  const [originGeo, destGeo] = await (async () => {
    const pair = await resolveGeocodePair(originAddr, destAddr);
    return [pair.origin, pair.destination ?? pair.origin] as const;
  })();
  const destResolved = destGeo ?? originGeo;

  let scope: PostScope = "city";
  if (originGeo && destResolved) {
    const d = haversineKm(originGeo.lat, originGeo.lon, destResolved.lat, destResolved.lon);
    if (d <= 5) scope = "near";
    else if (d <= 20) scope = "city";
    else if (d <= 200) scope = "intercity";
    else scope = "cross_border";
  }

  const row = {
    user_id: userId,
    locale,
    status: "active",
    post_type: payload.post_type,
    category: payload.category,
    title: payload.title ?? "",
    description: payload.description ?? "",
    delivery_mode: payload.delivery_mode,
    share_mode: payload.share_mode,
    escort_seats: payload.escort_seats ?? 0,
    max_companions: payload.max_companions,
    item_condition: payload.item_condition,
    phone_id: payload.phone_id,
    raw_phone: payload.raw_phone,
    normalized_phone: payload.normalized_phone,
    plate_id: payload.plate_id,
    raw_license_plate: payload.raw_license_plate,
    normalized_license_plate: payload.normalized_license_plate,
    provider_name: payload.provider_name,
    vehicle_brand: payload.vehicle_brand,
    vehicle_color: payload.vehicle_color,
    transport_mode: payload.transport_mode ?? null,
    departure_date: payload.departure_date,
    departure_time_window: payload.departure_time_window,
    estimated_arrival_time: payload.estimated_arrival_time,
    waypoints: payload.waypoints,
    item_quantity: payload.item_quantity,
    item_unit: payload.item_unit,
    price_calc_type: payload.price_calc_type,
    item_price: payload.item_price,
    count_small: payload.count_small,
    count_medium: payload.count_medium,
    count_large: payload.count_large,
    count_xlarge: payload.count_xlarge,
    has_luggage: payload.has_luggage,
    min_budget: payload.min_budget,
    max_budget: payload.max_budget,
    purchase_price_type: payload.purchase_price_type,
    bump_fee: payload.bump_fee ?? 0,
    fee_amount: payload.fee_amount,
    origin_address: payload.origin_address ?? "",
    destination_address: payload.destination_address ?? "",
    origin_gps: originGeo?.wkt ?? null,
    destination_gps: destResolved?.wkt ?? null,
    service_address: payload.service_address,
    service_time_window: payload.service_time_window,
    provider_pay_type: payload.provider_pay_type,
    scope,
  };

  const { data, error } = await supabase.from("posts").insert(row).select("id").single();
  if (error || !data) {
    return { ok: false, errorKey: "error.submit_failed" };
  }
  return { ok: true, postId: data.id as string };
}
