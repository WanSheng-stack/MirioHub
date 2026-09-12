/**
 * Server-only adapters for the canonical match-admission contract.
 * Thresholds and route scores are never accepted from the browser.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  routeThresholdsAreLegal,
  type MatchAdmissionPost,
  type MatchAdmissionRouteScore,
  type MatchAdmissionRouteThresholds,
} from "@/lib/matching/matchAdmissionPolicy";
import { calculateRouteMatchScore } from "@/lib/route/calculateRouteMatchScore";

export async function scoreOfficialMatchAdmissionRoute(input: {
  left: MatchAdmissionPost & { origin_gps?: unknown; destination_gps?: unknown };
  right: MatchAdmissionPost & { origin_gps?: unknown; destination_gps?: unknown };
  geocodeCache?: Map<string, { lat: number; lon: number } | null>;
}): Promise<MatchAdmissionRouteScore> {
  const result = await calculateRouteMatchScore({
    source: {
      post_type: input.left.post_type,
      origin_address: input.left.origin_address ?? "",
      destination_address: input.left.destination_address ?? "",
      waypoints: input.left.waypoints,
      origin_gps: input.left.origin_gps,
      destination_gps: input.left.destination_gps,
    },
    candidate: {
      post_type: input.right.post_type,
      origin_address: input.right.origin_address ?? "",
      destination_address: input.right.destination_address ?? "",
      waypoints: input.right.waypoints,
      origin_gps: input.right.origin_gps,
      destination_gps: input.right.destination_gps,
    },
    geocodeCache: input.geocodeCache,
  });
  if (!result.ok) return { ok: false };
  return {
    ok: true,
    score: result.score,
    extraDetourKms: result.extraDetourKms,
    baselineKms: result.baselineKms,
  };
}

export async function loadMatchAdmissionThresholds(
  admin: unknown,
): Promise<MatchAdmissionRouteThresholds | null> {
  const client = admin as SupabaseClient;
  const { data, error } = await client
    .from("system_configs")
    .select(
      "matching_route_max_extra_detour_km, matching_route_max_extra_detour_ratio",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return null;
  const thresholds = {
    maxExtraDetourKm: Number(data.matching_route_max_extra_detour_km),
    maxExtraDetourRatio: Number(data.matching_route_max_extra_detour_ratio),
  };
  return routeThresholdsAreLegal(thresholds) ? thresholds : null;
}
