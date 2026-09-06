import type { PostType } from "@/lib/types";
import { FORBIDDEN_PUBLIC_POST_COLUMNS } from "@/lib/posts/publicPostSelect";

/** Schema CHECK: draft | active | matched | pending_completion | completed | canceled */
export const MATCH_HALL_STATUSES = [
  "active",
  "matched",
  "pending_completion",
  "completed",
] as const;

export type MatchHallStatus = (typeof MATCH_HALL_STATUSES)[number];

export const MATCH_HALL_EXCLUDED_STATUSES = ["draft", "canceled"] as const;

export type MatchCardTone = "active" | "in_progress" | "completed";

export type MatchHallSortRow = {
  id: string;
  departure_date: string | null;
  score: number;
  status?: string;
};

export type MatchHallExplanation = {
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

export type MatchHallCardDto = {
  id: string;
  user_id: string;
  post_type: PostType;
  status: MatchHallStatus;
  category: string;
  origin_address: string;
  destination_address: string;
  waypoints: string[] | null;
  departure_date: string | null;
  departure_time_window: string | null;
  fee_amount: number | null;
  delivery_mode: string | null;
  share_mode: string | null;
  escort_seats: number;
  max_companions: number | null;
  count_small: number | null;
  count_medium: number | null;
  count_large: number | null;
  count_xlarge: number | null;
  authorName: string | null;
  completedTripCount: number;
} & MatchHallExplanation;

export function isMatchHallStatus(status: string): status is MatchHallStatus {
  return (MATCH_HALL_STATUSES as readonly string[]).includes(status);
}

export function oppositePostType(type: PostType): PostType {
  return type === "demand" ? "provider" : "demand";
}

/**
 * Same departure_date first, then route score DESC.
 * Status is never a ranking signal. id is a stable tie-breaker only.
 */
export function compareMatchHallRows(
  a: MatchHallSortRow,
  b: MatchHallSortRow,
  sourceDepartureDate: string | null,
): number {
  const aSame = a.departure_date === sourceDepartureDate ? 0 : 1;
  const bSame = b.departure_date === sourceDepartureDate ? 0 : 1;
  if (aSame !== bSame) return aSame - bSame;
  if (b.score !== a.score) return b.score - a.score;
  return a.id.localeCompare(b.id);
}

export function sortMatchHallRows<T extends MatchHallSortRow>(
  rows: T[],
  sourceDepartureDate: string | null,
): T[] {
  return [...rows].sort((a, b) => compareMatchHallRows(a, b, sourceDepartureDate));
}

export function matchCardTone(status: string): MatchCardTone {
  if (status === "active") return "active";
  if (status === "completed") return "completed";
  return "in_progress";
}

/** Only active candidates may be matched. Status must not be faked in the UI. */
export function canOfferMatchAction(status: string): boolean {
  return status === "active";
}

export function isMatchHallEmpty(rows: readonly unknown[]): boolean {
  return rows.length === 0;
}

export function shouldComputeRealRouteScore(status: string): boolean {
  void status;
  return true;
}

export function matchCardShellClass(tone: MatchCardTone, postType: PostType): string {
  if (tone === "active") {
    return postType === "demand"
      ? "w-full rounded-xl border border-emerald-200/70 border-l-[3px] border-l-emerald-500 bg-emerald-50/40"
      : "w-full rounded-xl border border-violet-200/70 border-r-[3px] border-r-violet-500 bg-violet-50/40";
  }
  if (tone === "in_progress") {
    return "w-full rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-600";
  }
  return "w-full rounded-xl border border-zinc-200/80 bg-zinc-50/90 text-zinc-500";
}

export function matchCardTitleClass(tone: MatchCardTone): string {
  if (tone === "active") return "text-zinc-950";
  if (tone === "in_progress") return "text-zinc-700";
  return "text-zinc-600";
}

export function matchCardMetaClass(tone: MatchCardTone): string {
  if (tone === "active") return "text-zinc-600";
  if (tone === "in_progress") return "text-zinc-500";
  return "text-zinc-500";
}

export function matchHallDtoHasPrivateField(dto: object): boolean {
  return FORBIDDEN_PUBLIC_POST_COLUMNS.some((col) => col in dto);
}

export function formatRoutePercent(score: number): number {
  return Math.round(score * 100);
}
