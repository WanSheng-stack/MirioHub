import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateRouteAndCapacityMatch,
  resolveDriverOrderedRoute,
} from "@/lib/post-route-match";
import { processProviderMatchIntercept } from "@/lib/post-intercept";
import { totalLuggageUnits } from "@/lib/post-payload";
import type { Post } from "@/lib/types";

export type ProviderMatchResult =
  | { ok: true; isSpaceWarning: boolean; messageKey: string }
  | { ok: false; errorKey: string; logFraud?: boolean };

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
    .eq("departure_time_window", demand.departure_time_window)
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

  if (providerTrip && driverRoute.length >= 2) {
    const routeEval = evaluateRouteAndCapacityMatch({
      driver_ordered_route: driverRoute,
      demand_origin: demand.origin_address,
      demand_destination: demand.destination_address,
      new_order_passengers: newPassengers,
      new_order_units: newUnits,
      current_total_passengers: 0,
      current_total_units: 0,
    });

    if (!routeEval.isRouteMatch) {
      return { ok: false, errorKey: "error.route_not_compatible" };
    }
    if (!routeEval.isCapacityAllowed) {
      return {
        ok: false,
        errorKey: routeEval.messageKey ?? "error.passenger_limit_exceeded",
      };
    }
  }

  if (!isPureCargo) {
    return { ok: true, isSpaceWarning: false, messageKey: "success.matched" };
  }

  const depDate = demand.departure_date as string;
  const depWindow = demand.departure_time_window as string;

  const { data: activePosts } = await supabase
    .from("posts")
    .select("*")
    .eq("status", "matched")
    .eq("departure_date", depDate)
    .eq("departure_time_window", depWindow)
    .eq("category", "deliver");

  const overlapping = (activePosts ?? []).filter(
    (p) => (p.escort_seats ?? 0) === 0,
  );

  const phoneDup = overlapping.some(
    (p) => p.normalized_phone === providerNormalizedPhone,
  );
  const plateDup =
    providerNormalizedLicensePlate &&
    overlapping.some(
      (p) => p.normalized_license_plate === providerNormalizedLicensePlate,
    );
  const accountIds = new Set(overlapping.map((p) => p.user_id));
  const ownCargo = overlapping.filter((p) => p.user_id === providerUserId).length;

  let allUnits = 0;
  let allPassengers = 0;
  for (const p of overlapping) {
    allUnits += totalLuggageUnits({
      count_small: p.count_small ?? 0,
      count_medium: p.count_medium ?? 0,
      count_large: p.count_large ?? 0,
      count_xlarge: p.count_xlarge ?? 0,
    });
    allPassengers += (p.escort_seats ?? 0) + (p.max_companions ?? 0);
  }
  allUnits += newUnits;
  allPassengers += newPassengers;

  const decision = processProviderMatchIntercept({
    is_plate_duplicated: Boolean(plateDup),
    is_phone_duplicated: phoneDup,
    account_count: accountIds.size,
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
