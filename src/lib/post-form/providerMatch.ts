import type { SupabaseClient } from "@supabase/supabase-js";
import {
  approximateSegmentKmsForStacking,
  evaluateRouteAndCapacityMatch,
  resolveDriverOrderedRoute,
} from "@/lib/post-route-match";
import { processProviderMatchIntercept } from "@/lib/post-intercept";
import { totalLuggageUnits } from "@/lib/post-payload";
import { buildDepartureTimestamp, demandInterceptRange } from "@/lib/post-time-windows";
import type { Post } from "@/lib/types";

export type ProviderMatchResult =
  | { ok: true; isSpaceWarning: boolean; messageKey: string; showDetourNotice?: boolean; matchRatio?: number }
  | { ok: false; errorKey: string; logFraud?: boolean };

async function countBoundAccounts(
  supabase: SupabaseClient,
  field: "normalized_phone" | "normalized_license_plate",
  value: string,
): Promise<number> {
  if (!value) return 0;
  const accounts = new Set<string>();
  const historyTable = field === "normalized_phone" ? "phone_history" : "plate_history";
  const historyCol =
    field === "normalized_phone" ? "normalized_phone" : "normalized_license_plate";

  const { data: history } = await supabase
    .from(historyTable)
    .select("user_id")
    .eq(historyCol, value);
  for (const row of history ?? []) accounts.add(row.user_id as string);

  const { data: posts } = await supabase
    .from("posts")
    .select("user_id")
    .eq(field, value)
    .in("status", ["active", "matched", "pending_completion"]);
  for (const row of posts ?? []) accounts.add(row.user_id as string);
  return accounts.size;
}

export async function runProviderMatchIntercept(
  supabase: SupabaseClient,
  providerUserId: string,
  demandPostId: string,
  providerNormalizedPhone: string,
  providerNormalizedLicensePlate: string | null,
  isBankVerified: boolean,
): Promise<ProviderMatchResult> {
  const { data: demandPost } = await supabase
    .from("posts")
    .select("*")
    .eq("id", demandPostId)
    .maybeSingle();

  if (!demandPost) return { ok: false, errorKey: "error.not_found" };

  const demand = demandPost as Post;
  const isPureCargo =
    demand.category === "deliver" && (demand.escort_seats ?? 0) === 0;

  const { data: providerTrip } = await supabase
    .from("posts")
    .select("*")
    .eq("user_id", providerUserId)
    .eq("post_type", "provider")
    .eq("status", "active")
    .eq("departure_date", demand.departure_date)
    .maybeSingle();

  const driverRoute = providerTrip
    ? resolveDriverOrderedRoute(providerTrip as Post)
    : [];

  const newPassengers =
    demand.category === "travel"
      ? demand.max_companions ?? 1
      : demand.escort_seats ?? 0;
  const newUnits = totalLuggageUnits({
    count_small: demand.count_small ?? 0,
    count_medium: demand.count_medium ?? 0,
    count_large: demand.count_large ?? 0,
    count_xlarge: demand.count_xlarge ?? 0,
  });

  const { data: stackedRows } = await supabase
    .from("posts")
    .select("*")
    .eq("status", "matched")
    .eq("departure_date", demand.departure_date as string);

  let currentStackedSeats = 0;
  let currentStackedUnits = 0;
  let stackedOrderCount = 0;
  for (const p of stackedRows ?? []) {
    const row = p as Post;
    if (providerTrip && row.user_id !== (providerTrip as Post).user_id) continue;
    // Count matches accepted by this provider in the same departure day window
    currentStackedSeats +=
      (row.category === "travel" ? row.max_companions ?? 0 : row.escort_seats ?? 0) || 0;
    currentStackedUnits += totalLuggageUnits({
      count_small: row.count_small ?? 0,
      count_medium: row.count_medium ?? 0,
      count_large: row.count_large ?? 0,
      count_xlarge: row.count_xlarge ?? 0,
    });
    stackedOrderCount += 1;
  }

  if (providerTrip && driverRoute.length >= 2) {
    const passengerKms = Math.max(
      12,
      Math.max(demand.origin_address.length, demand.destination_address.length) * 2.5,
    );
    const driverKms = Math.max(
      12,
      Math.max(
        (providerTrip as Post).origin_address.length,
        (providerTrip as Post).destination_address.length,
      ) * 2.5,
    );
    const routeEval = evaluateRouteAndCapacityMatch({
      driver_ordered_route: driverRoute,
      demand_origin: demand.origin_address,
      demand_destination: demand.destination_address,
      new_order_passengers: newPassengers,
      new_order_units: newUnits,
      current_total_passengers: currentStackedSeats,
      current_total_units: currentStackedUnits,
      isBankVerified,
      segmentKms: approximateSegmentKmsForStacking({
        driverStraightKms: driverKms,
        passengerStraightKms: passengerKms,
        alreadyStackedOrderCount: stackedOrderCount,
      }),
    });

    if (!routeEval.isRouteMatch) {
      return {
        ok: false,
        errorKey: routeEval.messageKey ?? "error.route_not_compatible",
      };
    }
    if (!routeEval.isCapacityAllowed) {
      return {
        ok: false,
        errorKey: routeEval.messageKey ?? "error.passenger_limit_exceeded",
      };
    }
  }

  // Cross-account phone/plate collision in ±30min absolute window
  const depDate = demand.departure_date as string;
  const depWindow = demand.departure_time_window as string;
  const { from, to } = demandInterceptRange(depDate, depWindow);

  const { data: windowPosts } = await supabase
    .from("posts")
    .select(
      "user_id, normalized_phone, normalized_license_plate, status, departure_date, departure_time_window, escort_seats, category, count_small, count_medium, count_large, count_xlarge, max_companions",
    )
    .in("status", ["active", "matched", "pending_completion"]);

  const inWindow = (windowPosts ?? []).filter((r) => {
    if (!r.departure_date || !r.departure_time_window) return false;
    const ts = buildDepartureTimestamp(r.departure_date, r.departure_time_window);
    return ts >= from && ts <= to;
  });

  const phoneAccountsLive = new Set(
    inWindow
      .filter((r) => r.normalized_phone === providerNormalizedPhone)
      .map((r) => r.user_id as string),
  );
  phoneAccountsLive.add(providerUserId);

  const phoneHistoryAccounts = await countBoundAccounts(
    supabase,
    "normalized_phone",
    providerNormalizedPhone,
  );
  const plateHistoryAccounts = providerNormalizedLicensePlate
    ? await countBoundAccounts(
        supabase,
        "normalized_license_plate",
        providerNormalizedLicensePlate,
      )
    : 0;

  const account_count = Math.max(
    phoneAccountsLive.size,
    phoneHistoryAccounts,
    plateHistoryAccounts,
  );
  const is_phone_duplicated =
    phoneAccountsLive.size > 1 || phoneHistoryAccounts > 1;
  const is_plate_duplicated =
    Boolean(providerNormalizedLicensePlate) &&
    (plateHistoryAccounts > 1 ||
      inWindow.some(
        (r) =>
          r.normalized_license_plate === providerNormalizedLicensePlate &&
          r.user_id !== providerUserId,
      ));

  if ((is_phone_duplicated || is_plate_duplicated) && account_count > 1) {
    await supabase.from("fraud_logs").insert({
      user_id: providerUserId,
      scene: "multi_account_spacetime_collision",
      normalized_phone: providerNormalizedPhone,
      normalized_license_plate: providerNormalizedLicensePlate,
      reporter_side: "provider",
    });
    return { ok: false, errorKey: "error.match_denied_blurred", logFraud: true };
  }

  if (!isPureCargo) {
    return { ok: true, isSpaceWarning: false, messageKey: "success.matched" };
  }

  const overlapping = inWindow.filter(
    (p) => p.category === "deliver" && (p.escort_seats ?? 0) === 0,
  );
  const ownCargo = overlapping.filter((p) => p.user_id === providerUserId).length;

  let allUnits = currentStackedUnits + newUnits;
  let allPassengers = currentStackedSeats + newPassengers;

  const decision = processProviderMatchIntercept({
    is_plate_duplicated: is_plate_duplicated,
    is_phone_duplicated: is_phone_duplicated,
    account_count,
    active_cargo_order_count: ownCargo,
    current_all_matched_units: allUnits,
    current_all_passengers_count: allPassengers,
    is_bank_verified: isBankVerified,
  });

  if (!decision.allowed) {
    if (decision.logFraud) {
      await supabase.from("fraud_logs").insert({
        user_id: providerUserId,
        scene: decision.trackerScene,
        normalized_phone: providerNormalizedPhone,
        normalized_license_plate: providerNormalizedLicensePlate,
        reporter_side: "provider",
      });
    }
    return { ok: false, errorKey: decision.messageKey, logFraud: decision.logFraud };
  }

  return {
    ok: true,
    isSpaceWarning: Boolean(decision.isSpaceWarning),
    messageKey: decision.messageKey,
  };
}
