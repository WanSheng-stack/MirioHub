/** Normalize location strings for ordered slice matching (case-insensitive trim). */
export function normalizeLocationKey(location: string): string {
  return location.trim().toLowerCase();
}

/** Build driver ordered route: origin → waypoints → destination. */
export function buildDriverOrderedRoute(
  origin: string,
  waypoints: string[] | null | undefined,
  destination: string,
): string[] {
  const mid = (waypoints ?? [])
    .map((w) => (typeof w === "string" ? w : String(w)).trim())
    .filter(Boolean);
  return [origin.trim(), ...mid, destination.trim()].filter(Boolean);
}

/** If waypoints jsonb already stores full ordered route, use as-is; else assemble. */
export function resolveDriverOrderedRoute(post: {
  origin_address: string;
  destination_address: string;
  waypoints?: string[] | null;
  post_type: string;
}): string[] {
  const wps = post.waypoints ?? [];
  if (
    post.post_type === "provider" &&
    wps.length >= 2 &&
    normalizeLocationKey(wps[0] ?? "") === normalizeLocationKey(post.origin_address) &&
    normalizeLocationKey(wps[wps.length - 1] ?? "") ===
      normalizeLocationKey(post.destination_address)
  ) {
    return wps.map((w) => w.trim()).filter(Boolean);
  }
  return buildDriverOrderedRoute(post.origin_address, wps, post.destination_address);
}

export interface RouteMatchMetrics {
  driver_ordered_route: string[];
  demand_origin: string;
  demand_destination: string;
  new_order_passengers: number;
  new_order_units: number;
  current_total_passengers: number;
  current_total_units: number;
}

export interface RouteMatchResult {
  isRouteMatch: boolean;
  isCapacityAllowed: boolean;
  showSpaceWarning: boolean;
  messageKey?: string;
}

export function evaluateRouteAndCapacityMatch(metrics: RouteMatchMetrics): RouteMatchResult {
  const routeKeys = metrics.driver_ordered_route.map(normalizeLocationKey);
  const originKey = normalizeLocationKey(metrics.demand_origin);
  const destKey = normalizeLocationKey(metrics.demand_destination);

  const origin_index = routeKeys.indexOf(originKey);
  const dest_index = routeKeys.indexOf(destKey);

  const isRouteMatch =
    origin_index !== -1 && dest_index !== -1 && origin_index < dest_index;

  if (!isRouteMatch) {
    return { isRouteMatch: false, isCapacityAllowed: false, showSpaceWarning: false };
  }

  const total_people_on_board =
    1 + metrics.current_total_passengers + metrics.new_order_passengers;
  if (total_people_on_board > 5) {
    return {
      isRouteMatch: true,
      isCapacityAllowed: false,
      showSpaceWarning: false,
      messageKey: "error.passenger_limit_exceeded",
    };
  }

  const total_units_on_board = metrics.current_total_units + metrics.new_order_units;
  const showSpaceWarning = total_units_on_board > 24;

  return {
    isRouteMatch: true,
    isCapacityAllowed: true,
    showSpaceWarning,
    messageKey: "success.match_compatible",
  };
}

/** Estimate slice kms as proportional share of total route distance. */
export function estimateSliceKmsFromRoute(
  totalKms: number,
  route: string[],
  sliceOrigin: string,
  sliceDestination: string,
): number {
  if (totalKms <= 0 || route.length < 2) return 0;
  const keys = route.map(normalizeLocationKey);
  const oi = keys.indexOf(normalizeLocationKey(sliceOrigin));
  const di = keys.indexOf(normalizeLocationKey(sliceDestination));
  if (oi === -1 || di === -1 || oi >= di) return totalKms;
  const segments = route.length - 1;
  const sliceSegments = di - oi;
  return Math.max(3, (totalKms * sliceSegments) / segments);
}
