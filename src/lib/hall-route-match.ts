import type { Post } from "@/lib/types";
import {
  evaluateRouteAndCapacityMatch,
  resolveDriverOrderedRoute,
} from "@/lib/post-route-match";
import { totalLuggageUnits } from "@/lib/post-payload";

export type RouteMatchInfo = {
  matchedCount: number;
  showSpaceWarning: boolean;
};

function isRouteCategory(post: Post): boolean {
  return post.category === "deliver" || post.category === "travel";
}

function passengerCount(post: Post): number {
  if (post.category === "travel") return post.max_companions ?? 1;
  return post.escort_seats ?? 0;
}

/** Build lookup: providerId → match info against any active demand. */
export function computeProviderMatchInfo(
  demands: Post[],
  providers: Post[],
): Map<string, RouteMatchInfo> {
  const result = new Map<string, RouteMatchInfo>();
  const activeDemands = demands.filter((d) => d.post_type === "demand" && isRouteCategory(d));

  for (const provider of providers) {
    if (provider.post_type !== "provider" || !isRouteCategory(provider)) continue;

    const driverRoute = resolveDriverOrderedRoute(provider);
    let matchedCount = 0;
    let showSpaceWarning = false;

    for (const demand of activeDemands) {
      const evalResult = evaluateRouteAndCapacityMatch({
        driver_ordered_route: driverRoute,
        demand_origin: demand.origin_address,
        demand_destination: demand.destination_address,
        new_order_passengers: passengerCount(demand),
        new_order_units: totalLuggageUnits({
          count_small: demand.count_small ?? 0,
          count_medium: demand.count_medium ?? 0,
          count_large: demand.count_large ?? 0,
          count_xlarge: demand.count_xlarge ?? 0,
        }),
        current_total_passengers: 0,
        current_total_units: 0,
      });

      if (evalResult.isRouteMatch && evalResult.isCapacityAllowed) {
        matchedCount += 1;
        if (evalResult.showSpaceWarning) showSpaceWarning = true;
      }
    }

    if (matchedCount > 0) {
      result.set(provider.id, { matchedCount, showSpaceWarning });
    }
  }

  return result;
}

/** Build lookup: demandId → count of compatible provider trips. */
export function computeDemandMatchInfo(
  demands: Post[],
  providers: Post[],
): Map<string, RouteMatchInfo> {
  const result = new Map<string, RouteMatchInfo>();
  const activeProviders = providers.filter(
    (p) => p.post_type === "provider" && isRouteCategory(p),
  );

  for (const demand of demands) {
    if (demand.post_type !== "demand" || !isRouteCategory(demand)) continue;

    let matchedCount = 0;
    let showSpaceWarning = false;

    for (const provider of activeProviders) {
      const driverRoute = resolveDriverOrderedRoute(provider);
      const evalResult = evaluateRouteAndCapacityMatch({
        driver_ordered_route: driverRoute,
        demand_origin: demand.origin_address,
        demand_destination: demand.destination_address,
        new_order_passengers: passengerCount(demand),
        new_order_units: totalLuggageUnits({
          count_small: demand.count_small ?? 0,
          count_medium: demand.count_medium ?? 0,
          count_large: demand.count_large ?? 0,
          count_xlarge: demand.count_xlarge ?? 0,
        }),
        current_total_passengers: 0,
        current_total_units: 0,
      });

      if (evalResult.isRouteMatch && evalResult.isCapacityAllowed) {
        matchedCount += 1;
        if (evalResult.showSpaceWarning) showSpaceWarning = true;
      }
    }

    if (matchedCount > 0) {
      result.set(demand.id, { matchedCount, showSpaceWarning });
    }
  }

  return result;
}
