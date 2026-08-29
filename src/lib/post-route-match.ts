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

/** True when demand O/D both appear on driver axis with Index_Origin < Index_Destination. */
export function isOrderedRouteCompatible(
  driverOrderedRoute: string[],
  demandOrigin: string,
  demandDestination: string,
): boolean {
  const routeKeys = driverOrderedRoute.map(normalizeLocationKey);
  const originIndex = routeKeys.indexOf(normalizeLocationKey(demandOrigin));
  const destIndex = routeKeys.indexOf(normalizeLocationKey(demandDestination));
  return originIndex !== -1 && destIndex !== -1 && originIndex < destIndex;
}

export interface RouteSegmentKms {
  /** Driver solo straight-line / planned trip km without picking anyone up. */
  L_driver_straight: number;
  /** Rolling baseline: actual driven km after already-stacked orders. */
  L_baseline_current: number;
  /** Simulated total km if this new order is also stacked. */
  L_total_new_simulated: number;
  /** Passenger/cargo OD straight km for the candidate order. */
  L_passenger_straight: number;
}

export interface RouteStackingResult {
  isRouteMatch: boolean;
  matchRatio: number;
  isCapacityAllowed: boolean;
  showSpaceWarning: boolean;
  showDetourNotice: boolean;
  messageKey: string;
}

/**
 * HelloBike / Didi-style rolling-baseline match ratio.
 * Denominator is locked to L_passenger_straight; extra detour = simulated − baseline.
 */
export function evaluateRouteAndOrderStacking(
  metrics: RouteSegmentKms,
  newOrderSeats: number,
  newOrderUnits: number,
  currentStackedSeats: number,
  currentStackedUnits: number,
  _isBankVerified: boolean,
): RouteStackingResult {
  const extra_detour_kms = metrics.L_total_new_simulated - metrics.L_baseline_current;
  if (metrics.L_passenger_straight <= 0) {
    return {
      isRouteMatch: false,
      matchRatio: 0,
      isCapacityAllowed: false,
      showSpaceWarning: false,
      showDetourNotice: false,
      messageKey: "error.invalid_kms",
    };
  }

  const matchRatio = 1 - extra_detour_kms / metrics.L_passenger_straight;
  if (matchRatio < 0.7) {
    return {
      isRouteMatch: false,
      matchRatio,
      isCapacityAllowed: false,
      showSpaceWarning: false,
      showDetourNotice: false,
      messageKey: "error.low_match_filtered",
    };
  }

  const total_people_on_board = 1 + currentStackedSeats + newOrderSeats;
  if (total_people_on_board > 5) {
    return {
      isRouteMatch: true,
      matchRatio,
      isCapacityAllowed: false,
      showSpaceWarning: false,
      showDetourNotice: false,
      messageKey: "error.passenger_limit_exceeded",
    };
  }

  const showSpaceWarning = currentStackedUnits + newOrderUnits > 24;
  const showDetourNotice = matchRatio >= 0.7 && matchRatio < 0.9;

  return {
    isRouteMatch: true,
    matchRatio,
    isCapacityAllowed: true,
    showSpaceWarning,
    showDetourNotice,
    messageKey: matchRatio >= 0.9 ? "ui.perfect_match" : "ui.good_match",
  };
}

export interface RouteMatchMetrics {
  driver_ordered_route: string[];
  demand_origin: string;
  demand_destination: string;
  new_order_passengers: number;
  new_order_units: number;
  current_total_passengers: number;
  current_total_units: number;
  /** Optional km metrics for rolling-baseline stacking. */
  segmentKms?: RouteSegmentKms | null;
  isBankVerified?: boolean;
}

export interface RouteMatchResult {
  isRouteMatch: boolean;
  isCapacityAllowed: boolean;
  showSpaceWarning: boolean;
  showDetourNotice?: boolean;
  matchRatio?: number;
  messageKey?: string;
}

/**
 * Projection-slice gate (ordered indices) + optional rolling-baseline stacking.
 * Without segmentKms, capacity rules still apply with a perfect string-route ratio.
 */
export function evaluateRouteAndCapacityMatch(metrics: RouteMatchMetrics): RouteMatchResult {
  const orderedOk = isOrderedRouteCompatible(
    metrics.driver_ordered_route,
    metrics.demand_origin,
    metrics.demand_destination,
  );

  if (!orderedOk) {
    return {
      isRouteMatch: false,
      isCapacityAllowed: false,
      showSpaceWarning: false,
      showDetourNotice: false,
      matchRatio: 0,
      messageKey: "error.route_not_compatible",
    };
  }

  if (metrics.segmentKms) {
    const stacked = evaluateRouteAndOrderStacking(
      metrics.segmentKms,
      metrics.new_order_passengers,
      metrics.new_order_units,
      metrics.current_total_passengers,
      metrics.current_total_units,
      Boolean(metrics.isBankVerified),
    );
    return {
      isRouteMatch: stacked.isRouteMatch,
      isCapacityAllowed: stacked.isCapacityAllowed,
      showSpaceWarning: stacked.showSpaceWarning,
      showDetourNotice: stacked.showDetourNotice,
      matchRatio: stacked.matchRatio,
      messageKey: stacked.messageKey,
    };
  }

  const total_people_on_board =
    1 + metrics.current_total_passengers + metrics.new_order_passengers;
  if (total_people_on_board > 5) {
    return {
      isRouteMatch: true,
      isCapacityAllowed: false,
      showSpaceWarning: false,
      showDetourNotice: false,
      matchRatio: 1,
      messageKey: "error.passenger_limit_exceeded",
    };
  }

  const total_units_on_board = metrics.current_total_units + metrics.new_order_units;
  const showSpaceWarning = total_units_on_board > 24;

  return {
    isRouteMatch: true,
    isCapacityAllowed: true,
    showSpaceWarning,
    showDetourNotice: false,
    matchRatio: 1,
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

/**
 * Approximate rolling baseline kms for hall soft-match when only total driver km is known.
 * Treats each stacked order as adding a soft 10% corridor buffer (≤10 km absolute).
 */
export function approximateSegmentKmsForStacking(opts: {
  driverStraightKms: number;
  passengerStraightKms: number;
  alreadyStackedOrderCount: number;
}): RouteSegmentKms {
  const L_driver_straight = Math.max(0, opts.driverStraightKms);
  const L_passenger_straight = Math.max(0, opts.passengerStraightKms);
  const stackedBuffer = Math.min(10 * opts.alreadyStackedOrderCount, L_driver_straight * 0.25);
  const L_baseline_current = L_driver_straight + stackedBuffer;
  const softDetour = Math.min(10, Math.max(0, L_passenger_straight * 0.15));
  const L_total_new_simulated = L_baseline_current + softDetour;
  return {
    L_driver_straight,
    L_baseline_current,
    L_total_new_simulated,
    L_passenger_straight,
  };
}
