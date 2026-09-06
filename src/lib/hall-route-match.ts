import type { Post } from "@/lib/types";

export type RouteMatchInfo = {
  matchedCount: number;
  showSpaceWarning: boolean;
  showDetourNotice: boolean;
  bestMatchRatio: number | null;
};

/**
 * Hall badges used placeholder string/length scores.
 * Real detour scoring is pair-wise + OSRM (calculateRouteMatchScore).
 * PHASE 6.5B Match Results will display those scores; hall must not show fake %.
 */
export function computeProviderMatchInfo(
  demands: Post[],
  providers: Post[],
): Map<string, RouteMatchInfo> {
  void demands;
  void providers;
  return new Map();
}

export function computeDemandMatchInfo(
  demands: Post[],
  providers: Post[],
): Map<string, RouteMatchInfo> {
  void demands;
  void providers;
  return new Map();
}
