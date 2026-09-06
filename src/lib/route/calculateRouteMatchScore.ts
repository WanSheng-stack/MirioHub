import "server-only";
import { parseGpsPoint } from "@/lib/geo";
import { resolveDriverOrderedRoute } from "@/lib/post-route-match";
import { geocodeAddress } from "@/lib/route-kms";
import {
  findBestDemandInsertion,
  type DemandInsertionResult,
} from "@/lib/route/findBestDemandInsertion";
import { fetchOsrmDistanceMatrixKm } from "@/lib/route/osrmTable";

export type RouteScorePost = {
  post_type: string;
  origin_address: string;
  destination_address: string;
  waypoints?: string[] | null;
  origin_gps?: unknown | null;
  destination_gps?: unknown | null;
};

export type RouteMatchScoreOk = DemandInsertionResult & {
  ok: true;
};

export type RouteMatchScoreResult =
  | RouteMatchScoreOk
  | { ok: false; reason: "unscorable" };

function storedCoord(value: unknown): { lat: number; lon: number } | null {
  const parsed = parseGpsPoint(value);
  if (!parsed) return null;
  return { lat: parsed.lat, lon: parsed.lng };
}

async function resolveAddressCoord(
  address: string,
  stored: unknown,
  cache: Map<string, { lat: number; lon: number } | null>,
): Promise<{ lat: number; lon: number } | null> {
  const fromDb = storedCoord(stored);
  if (fromDb) return fromDb;
  const key = address.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  const geo = await geocodeAddress(address);
  cache.set(key, geo);
  return geo;
}

function splitDemandProvider(
  a: RouteScorePost,
  b: RouteScorePost,
): { demand: RouteScorePost; provider: RouteScorePost } | null {
  if (a.post_type === "demand" && b.post_type === "provider") {
    return { demand: a, provider: b };
  }
  if (a.post_type === "provider" && b.post_type === "demand") {
    return { demand: b, provider: a };
  }
  return null;
}

/**
 * Real road-network route match score for one Demand/Provider pair.
 * Never uses address-string equality, address length, haversine, or soft detour.
 */
export async function calculateRouteMatchScore(input: {
  demand?: RouteScorePost;
  provider?: RouteScorePost;
  /** Either role; normalized internally to Demand + Provider. */
  source?: RouteScorePost;
  candidate?: RouteScorePost;
}): Promise<RouteMatchScoreResult> {
  const pair =
    input.demand && input.provider
      ? { demand: input.demand, provider: input.provider }
      : input.source && input.candidate
        ? splitDemandProvider(input.source, input.candidate)
        : null;
  if (!pair) return { ok: false, reason: "unscorable" };

  const { demand, provider } = pair;
  const providerLabels = resolveDriverOrderedRoute({
    origin_address: provider.origin_address,
    destination_address: provider.destination_address,
    waypoints: provider.waypoints,
    post_type: provider.post_type,
  });
  if (providerLabels.length < 2) return { ok: false, reason: "unscorable" };

  const cache = new Map<string, { lat: number; lon: number } | null>();
  const providerCoords: { lat: number; lon: number }[] = [];
  for (let i = 0; i < providerLabels.length; i += 1) {
    const label = providerLabels[i]!;
    const stored =
      i === 0
        ? provider.origin_gps
        : i === providerLabels.length - 1
          ? provider.destination_gps
          : null;
    const coord = await resolveAddressCoord(label, stored, cache);
    if (!coord) return { ok: false, reason: "unscorable" };
    providerCoords.push(coord);
  }

  const pickup = await resolveAddressCoord(
    demand.origin_address,
    demand.origin_gps,
    cache,
  );
  const dropoff = await resolveAddressCoord(
    demand.destination_address,
    demand.destination_gps,
    cache,
  );
  if (!pickup || !dropoff) return { ok: false, reason: "unscorable" };

  const points = [...providerCoords, pickup, dropoff];
  const matrix = await fetchOsrmDistanceMatrixKm(points);
  if (!matrix) return { ok: false, reason: "unscorable" };

  const insertion = findBestDemandInsertion({
    providerCount: providerCoords.length,
    pickupIndex: providerCoords.length,
    dropoffIndex: providerCoords.length + 1,
    matrix,
  });
  if (!insertion) return { ok: false, reason: "unscorable" };
  return { ok: true, ...insertion };
}
