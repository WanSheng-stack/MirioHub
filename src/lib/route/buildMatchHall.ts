import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_SAFE_POST_SELECT } from "@/lib/posts/publicPostSelect";
import {
  MATCH_HALL_AUTHOR_NAME_LOOKUP_FAILED_LOG,
  PUBLIC_AUTHOR_NAME_SELECT,
  interpretPublicAuthorNameRows,
} from "@/lib/posts/publicProfileCards";
import { calculateRouteMatchScore } from "@/lib/route/calculateRouteMatchScore";
import type { RouteScorePost } from "@/lib/route/calculateRouteMatchScore";
import {
  isMatchHallStatus,
  MATCH_HALL_STATUSES,
  oppositePostType,
  shouldComputeRealRouteScore,
  sortMatchHallRows,
  type MatchHallCardDto,
  type MatchHallStatus,
} from "@/lib/route/matchHall";
import type { Post, PostType } from "@/lib/types";

const SCORE_SELECT = `${PUBLIC_SAFE_POST_SELECT}, origin_gps, destination_gps`;

type ScoreRow = Post & { origin_gps?: unknown; destination_gps?: unknown };

function toDto(
  row: ScoreRow,
  explanation: Pick<
    MatchHallCardDto,
    | "score"
    | "extraDetourKm"
    | "providerBaselineKm"
    | "routeWithDemandKm"
    | "demandDirectKm"
    | "pickupBeforeProviderOrigin"
    | "dropoffAfterProviderDestination"
    | "pickupExtensionKm"
    | "dropoffExtensionKm"
  >,
  authorName: string | null,
  completedTripCount: number,
): MatchHallCardDto {
  return {
    id: row.id,
    user_id: row.user_id,
    post_type: row.post_type,
    status: row.status as MatchHallStatus,
    category: row.category,
    origin_address: row.origin_address,
    destination_address: row.destination_address,
    waypoints: row.waypoints ?? null,
    departure_date: (row.departure_date as string | null) ?? null,
    departure_time_window: row.departure_time_window ?? null,
    fee_amount: row.fee_amount,
    delivery_mode: row.delivery_mode ?? null,
    share_mode: row.share_mode ?? null,
    escort_seats: row.escort_seats ?? 0,
    max_companions: row.max_companions ?? null,
    count_small: row.count_small ?? null,
    count_medium: row.count_medium ?? null,
    count_large: row.count_large ?? null,
    count_xlarge: row.count_xlarge ?? null,
    authorName,
    completedTripCount,
    score: explanation.score,
    extraDetourKm: explanation.extraDetourKm,
    providerBaselineKm: explanation.providerBaselineKm,
    routeWithDemandKm: explanation.routeWithDemandKm,
    demandDirectKm: explanation.demandDirectKm,
    pickupBeforeProviderOrigin: explanation.pickupBeforeProviderOrigin,
    dropoffAfterProviderDestination: explanation.dropoffAfterProviderDestination,
    pickupExtensionKm: explanation.pickupExtensionKm,
    dropoffExtensionKm: explanation.dropoffExtensionKm,
  };
}

export async function buildMatchHall(input: {
  source: ScoreRow;
}): Promise<MatchHallCardDto[]> {
  const sourceType = input.source.post_type as PostType;
  if (sourceType !== "demand" && sourceType !== "provider") return [];

  const admin = createAdminClient();
  const { data: rawCandidates } = await admin
    .from("posts")
    .select(SCORE_SELECT)
    .in("status", [...MATCH_HALL_STATUSES])
    .eq("post_type", oppositePostType(sourceType))
    .neq("id", input.source.id)
    .neq("user_id", input.source.user_id);

  const candidates = ((rawCandidates ?? []) as unknown as ScoreRow[]).filter((row) =>
    isMatchHallStatus(row.status),
  );

  const authorIds = [...new Set(candidates.map((c) => c.user_id))];
  let nameQuery: { data: unknown; error: unknown } = { data: [], error: null };
  if (authorIds.length) {
    const result = await admin
      .from("profiles")
      .select(PUBLIC_AUTHOR_NAME_SELECT)
      .in("id", authorIds);
    nameQuery = result;
    if (result.error) {
      console.error(MATCH_HALL_AUTHOR_NAME_LOOKUP_FAILED_LOG);
    }
  }
  const names = interpretPublicAuthorNameRows(nameQuery);

  const completedCounts = new Map<string, number>();
  if (authorIds.length) {
    const { data: finished } = await admin
      .from("posts")
      .select("user_id")
      .in("user_id", authorIds)
      .eq("status", "completed");
    for (const row of finished ?? []) {
      const uid = (row as { user_id: string }).user_id;
      completedCounts.set(uid, (completedCounts.get(uid) ?? 0) + 1);
    }
  }

  const geocodeCache = new Map<string, { lat: number; lon: number } | null>();
  const sourceScore: RouteScorePost = {
    post_type: input.source.post_type,
    origin_address: input.source.origin_address,
    destination_address: input.source.destination_address,
    waypoints: input.source.waypoints,
    origin_gps: input.source.origin_gps,
    destination_gps: input.source.destination_gps,
  };

  const scored: MatchHallCardDto[] = [];
  for (const candidate of candidates) {
    if (!shouldComputeRealRouteScore(candidate.status)) continue;
    const result = await calculateRouteMatchScore({
      source: sourceScore,
      candidate: {
        post_type: candidate.post_type,
        origin_address: candidate.origin_address,
        destination_address: candidate.destination_address,
        waypoints: candidate.waypoints,
        origin_gps: candidate.origin_gps,
        destination_gps: candidate.destination_gps,
      },
      geocodeCache,
    });
    if (!result.ok) continue;
    scored.push(
      toDto(
        candidate,
        {
          score: result.score,
          extraDetourKm: result.extraDetourKms,
          providerBaselineKm: result.baselineKms,
          routeWithDemandKm: result.bestRouteKms,
          demandDirectKm: result.demandDirectKms,
          pickupBeforeProviderOrigin: result.pickupBeforeProviderOrigin,
          dropoffAfterProviderDestination: result.dropoffAfterProviderDestination,
          pickupExtensionKm: result.pickupExtensionKm,
          dropoffExtensionKm: result.dropoffExtensionKm,
        },
        names.get(candidate.user_id) ?? null,
        completedCounts.get(candidate.user_id) ?? 0,
      ),
    );
  }

  return sortMatchHallRows(scored, (input.source.departure_date as string | null) ?? null);
}
