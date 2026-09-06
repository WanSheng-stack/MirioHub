import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateCapacityOnly,
  resolveDriverOrderedRoute,
  ROUTE_MATCH_GOOD_SCORE,
  ROUTE_MATCH_MIN_SCORE,
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
  input: {
    providerUserId: string;
    demandPostId: string;
    providerPostId: string;
    providerNormalizedPhone: string;
    providerNormalizedLicensePlate: string | null;
    isBankVerified: boolean;
  },
): Promise<ProviderMatchResult> {
  const { data: demandPost } = await supabase
    .from("public_posts_safe")
    .select(PUBLIC_SAFE_POST_SELECT)
    .eq("id", input.demandPostId)
    .maybeSingle();

  if (!demandPost) return { ok: false, errorKey: "error.not_found" };

  const demand = demandPost as unknown as Post;

  const { data: providerTrip } = await supabase
    .from("posts")
    .select("*")
    .eq("id", input.providerPostId)
    .eq("user_id", input.providerUserId)
    .eq("post_type", "provider")
    .eq("status", "active")
    .maybeSingle();

  if (!providerTrip) {
    return { ok: false, errorKey: "error.route_not_compatible" };
  }

  const driverRoute = resolveDriverOrderedRoute(providerTrip as Post);

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
    .eq("user_id", input.providerUserId)
    .eq("departure_date", demand.departure_date as string);

  let currentStackedSeats = 0;
  let currentStackedUnits = 0;
  for (const p of stackedRows ?? []) {
    const row = p as Post;
    currentStackedSeats +=
      (row.category === "travel" ? row.max_companions ?? 0 : row.escort_seats ?? 0) || 0;
    currentStackedUnits += totalLuggageUnits({
      count_small: row.count_small ?? 0,
      count_medium: row.count_medium ?? 0,
      count_large: row.count_large ?? 0,
      count_xlarge: row.count_xlarge ?? 0,
    });
  }

  let routeSpaceWarning = false;
  let routeMatchRatio: number | undefined;
  if (driverRoute.length >= 2) {
    const routeRes = await fetch("/api/posts/evaluate-route-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        demandPostId: input.demandPostId,
        providerPostId: input.providerPostId,
      }),
    });
    let routeJson: { ok?: boolean; score?: number; errorKey?: string };
    try {
      routeJson = (await routeRes.json()) as {
        ok?: boolean;
        score?: number;
        errorKey?: string;
      };
    } catch {
      return { ok: false, errorKey: "error.route_not_compatible" };
    }
    if (
      !routeJson.ok ||
      typeof routeJson.score !== "number" ||
      routeJson.score < ROUTE_MATCH_MIN_SCORE
    ) {
      return {
        ok: false,
        errorKey:
          typeof routeJson.score === "number" && routeJson.score < ROUTE_MATCH_MIN_SCORE
            ? "error.low_match_filtered"
            : (routeJson.errorKey ?? "error.route_not_compatible"),
      };
    }

    const capacity = evaluateCapacityOnly({
      newOrderPassengers: newPassengers,
      newOrderUnits: newUnits,
      currentTotalPassengers: currentStackedSeats,
      currentTotalUnits: currentStackedUnits,
    });
    if (!capacity.isCapacityAllowed) {
      return {
        ok: false,
        errorKey: capacity.messageKey ?? "error.passenger_limit_exceeded",
      };
    }
    routeSpaceWarning = capacity.showSpaceWarning;
    routeMatchRatio = routeJson.score;
  }

  void input.providerNormalizedPhone;
  void input.providerNormalizedLicensePlate;
  void input.isBankVerified;

  const res = await fetch("/api/posts/evaluate-provider-match-intercept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ demandPostId: input.demandPostId }),
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
    isSpaceWarning: Boolean(json.isSpaceWarning) || routeSpaceWarning,
    messageKey: json.errorKey ?? "success.matched",
    matchRatio: routeMatchRatio,
    showDetourNotice:
      routeMatchRatio != null &&
      routeMatchRatio >= ROUTE_MATCH_MIN_SCORE &&
      routeMatchRatio < ROUTE_MATCH_GOOD_SCORE,
  };
}
