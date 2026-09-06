import type { SupabaseClient } from "@supabase/supabase-js";
import {
  approximateSegmentKmsForStacking,
  evaluateRouteAndCapacityMatch,
  resolveDriverOrderedRoute,
} from "@/lib/post-route-match";
import { totalLuggageUnits } from "@/lib/post-payload";
import { PUBLIC_SAFE_POST_SELECT } from "@/lib/posts/publicPostSelect";
import type { Post } from "@/lib/types";

export type ProviderMatchResult =
  | { ok: true; isSpaceWarning: boolean; messageKey: string; showDetourNotice?: boolean; matchRatio?: number }
  | { ok: false; errorKey: string; logFraud?: boolean };

type ProviderMatchApiResult = {
  ok?: boolean;
  errorKey?: string;
  isSpaceWarning?: boolean;
  account_count?: unknown;
  reused?: unknown;
  last_post_at?: unknown;
  has_other_phone?: unknown;
  has_other_plate?: unknown;
};

export async function runProviderMatchIntercept(
  supabase: SupabaseClient,
  providerUserId: string,
  demandPostId: string,
  providerNormalizedPhone: string,
  providerNormalizedLicensePlate: string | null,
  isBankVerified: boolean,
): Promise<ProviderMatchResult> {
  const { data: demandPost } = await supabase
    .from("public_posts_safe")
    .select(PUBLIC_SAFE_POST_SELECT)
    .eq("id", demandPostId)
    .maybeSingle();

  if (!demandPost) return { ok: false, errorKey: "error.not_found" };

  const demand = demandPost as unknown as Post;

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
    .select(
      "user_id, category, escort_seats, max_companions, count_small, count_medium, count_large, count_xlarge",
    )
    .eq("status", "matched")
    .eq("user_id", providerUserId)
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

  void providerNormalizedPhone;
  void providerNormalizedLicensePlate;
  void isBankVerified;

  const res = await fetch("/api/posts/evaluate-provider-match-intercept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ demandPostId }),
  });
  const json = (await res.json()) as ProviderMatchApiResult;
  if (
    json.account_count != null ||
    json.reused != null ||
    json.last_post_at != null ||
    json.has_other_phone != null ||
    json.has_other_plate != null
  ) {
    return { ok: false, errorKey: "error.submit_failed" };
  }
  if (!json.ok) {
    return { ok: false, errorKey: json.errorKey ?? "error.submit_failed" };
  }
  return {
    ok: true,
    isSpaceWarning: Boolean(json.isSpaceWarning),
    messageKey: json.errorKey ?? "success.matched",
  };
}
