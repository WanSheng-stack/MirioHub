import type { DemandInsertionResult } from "@/lib/route/findBestDemandInsertion";

export type RouteMatchAccessPost = {
  user_id: string;
  post_type: string;
  status: string;
};

/** V1: session user owns an active provider post; demand is a public active post. */
export function evaluateRouteMatchAccess(input: {
  userId: string;
  demand: RouteMatchAccessPost | null;
  provider: RouteMatchAccessPost | null;
}): boolean {
  const { userId, demand, provider } = input;
  if (!userId || !demand || !provider) return false;
  if (provider.user_id !== userId) return false;
  if (provider.post_type !== "provider" || provider.status !== "active") return false;
  if (demand.post_type !== "demand" || demand.status !== "active") return false;
  return true;
}

export type RouteMatchApiOk = {
  ok: true;
  score: number;
  extraDetourKm: number;
  providerBaselineKm: number;
  routeWithDemandKm: number;
  demandDirectKm: number;
  pickupBeforeProviderOrigin: boolean;
  dropoffAfterProviderDestination: boolean;
  pickupExtensionKm: number;
  dropoffExtensionKm: number;
};

export function toRouteMatchApiPayload(result: DemandInsertionResult): RouteMatchApiOk {
  return {
    ok: true,
    score: result.score,
    extraDetourKm: result.extraDetourKms,
    providerBaselineKm: result.baselineKms,
    routeWithDemandKm: result.bestRouteKms,
    demandDirectKm: result.demandDirectKms,
    pickupBeforeProviderOrigin: result.pickupBeforeProviderOrigin,
    dropoffAfterProviderDestination: result.dropoffAfterProviderDestination,
    pickupExtensionKm: result.pickupExtensionKm,
    dropoffExtensionKm: result.dropoffExtensionKm,
  };
}

/** Pick an owned provider post without date/maybeSingle guessing. */
export function resolveViewerProviderPostId(
  ownedActiveProviderIds: string[],
  requestedId?: string | null,
): string | null {
  const owned = ownedActiveProviderIds.filter(Boolean);
  if (requestedId && owned.includes(requestedId)) return requestedId;
  if (!requestedId && owned.length === 1) return owned[0] ?? null;
  return null;
}
