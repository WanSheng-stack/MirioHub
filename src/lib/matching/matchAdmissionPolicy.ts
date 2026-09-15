/**
 * PHASE 6.7C.1A.1 — canonical V1 match-admission contract.
 *
 * Single eligibility source for:
 * - buildMatchHall candidate display
 * - first-send match request creation
 * - evaluate-route-match (same product path; access is separate)
 *
 * Distinguishes: field legality, pair compatibility, route scorability,
 * and route threshold. `calculateRouteMatchScore.ok` is NOT admission.
 *
 * inspect RPC is a non-atomic cost hint. This helper is API authorization
 * for new match requests. The v95 writer remains the state/idempotency/limit authority.
 *
 * Active posts can still change matching-relevant fields after publish:
 * complete-contact may refresh origin_gps / destination_gps / scope and may
 * fill transport_mode when it is currently null. It does not rewrite
 * origin_address, destination_address, departure_date, or
 * departure_time_window. Eligibility is therefore not fully atomic.
 * The server binds a digest of persisted matching facts from one SQL
 * snapshot RPC; the writer recomputes that hash after locking posts with
 * the same SQL helper. The browser never submits the hash, score, or
 * thresholds. GPS uses PostgreSQL EWKB hex, not JavaScript PostGIS text.
 */

import { createHash } from "node:crypto";
import { TIME_WINDOWS } from "@/lib/post-time-windows";
import { isDeliverOrTravel, isOnsiteOrErrand } from "@/lib/post-payload";
import type { PostCategory } from "@/lib/types";
import { oppositePostType } from "@/lib/route/matchHall";
import { validateTransportCapability } from "@/lib/transport/transportPolicy";
import type { TransportServiceLane } from "@/lib/transport/transportPolicy";
import { assertPublishSubtypeTransportLegal } from "@/lib/safety/serviceSubtypePublish";

export const MATCH_ROUTE_DEFAULT_MAX_EXTRA_DETOUR_KM = 30;
export const MATCH_ROUTE_DEFAULT_MAX_EXTRA_DETOUR_RATIO = 0.5;

export type MatchAdmissionReason =
  | "invalid_fields"
  | "incompatible_pair"
  | "route_unscorable"
  | "route_over_threshold"
  | "config_invalid";

export type MatchAdmissionDecision =
  | { eligible: true; routeScore: number; reasons: [] }
  | { eligible: false; reasons: MatchAdmissionReason[] };

export type MatchAdmissionPost = {
  id: string;
  user_id: string;
  post_type: string;
  category: string;
  status: string;
  departure_date?: string | null;
  departure_time_window?: string | null;
  service_time_window?: string | null;
  transport_mode?: string | null;
  service_subtype?: string | null;
  escort_seats?: number | null;
  max_companions?: number | null;
  count_small?: number | null;
  count_medium?: number | null;
  count_large?: number | null;
  count_xlarge?: number | null;
  origin_address?: string | null;
  destination_address?: string | null;
  waypoints?: string[] | null;
  /** Snapshot EWKB hex or parsed point. Production hash uses SQL EWKB only. */
  origin_gps?: unknown;
  destination_gps?: unknown;
  origin_gps_ewkb?: string | null;
  destination_gps_ewkb?: string | null;
  origin_country_code?: string | null;
  origin_timezone?: string | null;
  night_policy_version?: number | null;
};

export const ADMISSION_FACTS_FIELDS = [
  "id",
  "user_id",
  "post_type",
  "category",
  "status",
  "departure_date",
  "departure_time_window",
  "service_time_window",
  "transport_mode",
  "escort_seats",
  "max_companions",
  "count_small",
  "count_medium",
  "count_large",
  "count_xlarge",
  "origin_address",
  "destination_address",
  "waypoints",
  "origin_gps_ewkb",
  "destination_gps_ewkb",
] as const;

export type MatchAdmissionRouteScore =
  | { ok: false }
  | {
      ok: true;
      score: number;
      extraDetourKms: number;
      baselineKms: number;
    };

export type MatchAdmissionRouteThresholds = {
  maxExtraDetourKm: number;
  maxExtraDetourRatio: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTES_PER_DAY = 1440;

export function isStrictCalendarDate(value: string | null | undefined): boolean {
  if (value == null || !DATE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export function isOfficialMatchTimeWindow(
  value: string | null | undefined,
): value is string {
  if (value == null) return false;
  return (TIME_WINDOWS as readonly string[]).includes(value);
}

export function parseOfficialTimeWindowMinutes(
  window: string,
): { start: number; end: number } | null {
  if (!isOfficialMatchTimeWindow(window)) return null;
  const [startRaw, endRaw] = window.split("-");
  if (!startRaw || !endRaw) return null;
  const start = clockToMinutes(startRaw);
  let end = clockToMinutes(endRaw);
  if (start == null || end == null) return null;
  // Official last window is 23:45-00:00. Treat wrap as end += 1440 so
  // 23:45 vs 00:00 is a 15-minute circular start delta, not 1425.
  if (end <= start) end += MINUTES_PER_DAY;
  if (end <= start) return null;
  return { start, end };
}

function clockToMinutes(clock: string): number | null {
  if (clock === "24:00") return MINUTES_PER_DAY;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function officialStartDeltaMinutes(left: number, right: number): number {
  const raw = Math.abs(left - right);
  return Math.min(raw, MINUTES_PER_DAY - raw);
}

export function officialTimeWindowsCompatible(
  leftWindow: string,
  rightWindow: string,
): boolean {
  const left = parseOfficialTimeWindowMinutes(leftWindow);
  const right = parseOfficialTimeWindowMinutes(rightWindow);
  if (!left || !right) return false;
  const overlap = left.start < right.end && right.start < left.end;
  const nearStart = officialStartDeltaMinutes(left.start, right.start) <= 30;
  return overlap || nearStart;
}

export function pairServiceDate(post: MatchAdmissionPost): string | null {
  return post.departure_date ?? null;
}

export function pairServiceTimeWindow(post: MatchAdmissionPost): string | null {
  if (isDeliverOrTravel(post.category as PostCategory)) {
    return post.departure_time_window ?? null;
  }
  return post.departure_time_window ?? post.service_time_window ?? null;
}

export function validatePostScheduleFields(post: MatchAdmissionPost): boolean {
  const date = pairServiceDate(post);
  const window = pairServiceTimeWindow(post);
  return isStrictCalendarDate(date) && isOfficialMatchTimeWindow(window);
}

export function pairHasCompatibleDate(
  left: MatchAdmissionPost,
  right: MatchAdmissionPost,
): boolean {
  if (left.category !== right.category) return false;
  const category = left.category as PostCategory;
  if (
    !isDeliverOrTravel(category) &&
    category !== "buy" &&
    !isOnsiteOrErrand(category)
  ) {
    return false;
  }
  const leftDate = pairServiceDate(left);
  const rightDate = pairServiceDate(right);
  return (
    isStrictCalendarDate(leftDate) &&
    isStrictCalendarDate(rightDate) &&
    leftDate === rightDate
  );
}

export type PairTimeDifference = {
  overlap: boolean;
  startDeltaMinutes: number | null;
  advisoryOnly: true;
};

export function describePairTimeDifference(
  left: MatchAdmissionPost,
  right: MatchAdmissionPost,
): PairTimeDifference {
  const leftWindow = pairServiceTimeWindow(left);
  const rightWindow = pairServiceTimeWindow(right);
  if (
    !isOfficialMatchTimeWindow(leftWindow) ||
    !isOfficialMatchTimeWindow(rightWindow)
  ) {
    return { overlap: false, startDeltaMinutes: null, advisoryOnly: true };
  }
  const leftRange = parseOfficialTimeWindowMinutes(leftWindow);
  const rightRange = parseOfficialTimeWindowMinutes(rightWindow);
  if (!leftRange || !rightRange) {
    return { overlap: false, startDeltaMinutes: null, advisoryOnly: true };
  }
  return {
    overlap: leftRange.start < rightRange.end && rightRange.start < leftRange.end,
    startDeltaMinutes: officialStartDeltaMinutes(leftRange.start, rightRange.start),
    advisoryOnly: true,
  };
}

export function validateProposedSchedule(input: {
  proposedDate: string | null | undefined;
  proposedTimeWindow: string | null | undefined;
}): boolean {
  return (
    isStrictCalendarDate(input.proposedDate) &&
    isOfficialMatchTimeWindow(input.proposedTimeWindow)
  );
}

/** Date-hard admission only. Time overlap is advisory and must not gate eligibility. */
export function pairHasCompatibleSchedule(
  left: MatchAdmissionPost,
  right: MatchAdmissionPost,
): boolean {
  return (
    pairHasCompatibleDate(left, right) &&
    validatePostScheduleFields(left) &&
    validatePostScheduleFields(right)
  );
}

function travelItemUnits(post: MatchAdmissionPost): number {
  return (
    (post.count_small ?? 0) +
    (post.count_medium ?? 0) +
    (post.count_large ?? 0) +
    (post.count_xlarge ?? 0)
  );
}

export function postSatisfiesOfficialTransport(post: MatchAdmissionPost): boolean {
  if (!isDeliverOrTravel(post.category as PostCategory)) return true;
  const mode = post.transport_mode;
  if (mode == null || mode === "") return true;
  const lane = post.category as TransportServiceLane;
  const input =
    post.post_type === "demand"
      ? {
          lane,
          postType: "demand" as const,
          mode,
          peopleCount: post.category === "travel" ? (post.max_companions ?? 0) : undefined,
          travelItemUnits:
            post.category === "travel" ? travelItemUnits(post) : undefined,
          escortPassengerCount:
            post.category === "deliver" ? (post.escort_seats ?? 0) : undefined,
        }
      : {
          lane,
          postType: "provider" as const,
          mode,
          peopleCapacity: post.category === "travel" ? (post.max_companions ?? 0) : undefined,
          travelItemUnits:
            post.category === "travel" ? travelItemUnits(post) : undefined,
        };
  return validateTransportCapability(input).ok;
}

/**
 * v99 first-send authority: subtype/country/timezone/policy from snapshot.
 * Reuses publish subtype×transport truth table. Does not infer defaults.
 */
export function postSatisfiesAdmissionAuthority(post: MatchAdmissionPost): boolean {
  const category = post.category;
  const subtypeRaw = post.service_subtype ?? null;
  const subtype =
    subtypeRaw == null ? null : String(subtypeRaw).trim() || null;
  const country = post.origin_country_code;
  const timezoneRaw = post.origin_timezone;
  const timezone =
    timezoneRaw == null ? null : String(timezoneRaw).trim() || null;
  const policy = post.night_policy_version;

  if (category === "buy" || category === "onsite" || category === "errand") {
    if (subtype != null) return false;
    return true;
  }
  if (category !== "travel" && category !== "deliver") return false;

  // Travel/Deliver NULL/blank subtype = legacy_unknown — not eligible.
  if (subtype == null) return false;
  if (country == null || country === "" || !/^[A-Z]{2}$/.test(country)) {
    return false;
  }
  if (timezone == null) return false;
  if (policy == null || !Number.isSafeInteger(policy) || policy <= 0) {
    return false;
  }

  if (post.post_type !== "demand" && post.post_type !== "provider") return false;
  try {
    assertPublishSubtypeTransportLegal({
      category,
      postType: post.post_type,
      serviceSubtype: subtype as never,
      transportMode: post.transport_mode,
    });
  } catch {
    return false;
  }
  return true;
}

/** Travel/Deliver pair must share the exact same service_subtype (no downgrade). */
export function pairHasExactAdmissionSubtype(
  left: MatchAdmissionPost,
  right: MatchAdmissionPost,
): boolean {
  if (left.category !== right.category) return false;
  if (
    left.category !== "travel" &&
    left.category !== "deliver"
  ) {
    const ls = left.service_subtype;
    const rs = right.service_subtype;
    const leftBlank = ls == null || String(ls).trim() === "";
    const rightBlank = rs == null || String(rs).trim() === "";
    return leftBlank && rightBlank;
  }
  const leftSubtype = left.service_subtype;
  const rightSubtype = right.service_subtype;
  if (leftSubtype == null || rightSubtype == null) return false;
  const ls = String(leftSubtype).trim();
  const rs = String(rightSubtype).trim();
  if (ls === "" || rs === "") return false;
  return ls === rs;
}

export function pairHasCompatibleRolesAndCategory(
  left: MatchAdmissionPost,
  right: MatchAdmissionPost,
): boolean {
  if (left.id === right.id || left.user_id === right.user_id) return false;
  if (left.post_type !== "demand" && left.post_type !== "provider") return false;
  if (right.post_type !== oppositePostType(left.post_type)) return false;
  return left.category === right.category;
}

export function evaluatePairCompatibility(
  left: MatchAdmissionPost,
  right: MatchAdmissionPost,
): { ok: true } | { ok: false; reasons: MatchAdmissionReason[] } {
  if (!pairHasCompatibleRolesAndCategory(left, right)) {
    return { ok: false, reasons: ["incompatible_pair"] };
  }
  if (!pairHasExactAdmissionSubtype(left, right)) {
    return { ok: false, reasons: ["incompatible_pair"] };
  }
  if (
    !validatePostScheduleFields(left) ||
    !validatePostScheduleFields(right)
  ) {
    return { ok: false, reasons: ["invalid_fields"] };
  }
  if (!pairHasCompatibleDate(left, right)) {
    return { ok: false, reasons: ["incompatible_pair"] };
  }
  if (
    !postSatisfiesOfficialTransport(left) ||
    !postSatisfiesOfficialTransport(right)
  ) {
    return { ok: false, reasons: ["incompatible_pair"] };
  }
  if (
    !postSatisfiesAdmissionAuthority(left) ||
    !postSatisfiesAdmissionAuthority(right)
  ) {
    return { ok: false, reasons: ["incompatible_pair"] };
  }
  return { ok: true };
}

export function routeThresholdsAreLegal(
  thresholds: MatchAdmissionRouteThresholds | null | undefined,
): thresholds is MatchAdmissionRouteThresholds {
  if (thresholds == null) return false;
  const { maxExtraDetourKm, maxExtraDetourRatio } = thresholds;
  return (
    Number.isFinite(maxExtraDetourKm) &&
    Number.isFinite(maxExtraDetourRatio) &&
    maxExtraDetourKm > 0 &&
    maxExtraDetourKm <= 500 &&
    maxExtraDetourRatio >= 0 &&
    maxExtraDetourRatio <= 5
  );
}

export function evaluateRouteAdmission(
  route: MatchAdmissionRouteScore,
  thresholds: MatchAdmissionRouteThresholds | null | undefined,
): { ok: true; score: number } | { ok: false; reason: MatchAdmissionReason } {
  if (!routeThresholdsAreLegal(thresholds)) {
    return { ok: false, reason: "config_invalid" };
  }
  if (!route.ok) return { ok: false, reason: "route_unscorable" };
  const extra = route.extraDetourKms;
  const baseline = route.baselineKms;
  if (
    !Number.isFinite(extra) ||
    !Number.isFinite(baseline) ||
    !Number.isFinite(route.score) ||
    extra < 0
  ) {
    return { ok: false, reason: "route_unscorable" };
  }
  const withinAbsolute = extra <= thresholds.maxExtraDetourKm;
  const withinRatio =
    baseline > 0 && extra / baseline <= thresholds.maxExtraDetourRatio;
  if (withinAbsolute || withinRatio) {
    return { ok: true, score: route.score };
  }
  return { ok: false, reason: "route_over_threshold" };
}

export function evaluateMatchAdmission(input: {
  left: MatchAdmissionPost;
  right: MatchAdmissionPost;
  route: MatchAdmissionRouteScore;
  thresholds: MatchAdmissionRouteThresholds | null;
}): MatchAdmissionDecision {
  const pair = evaluatePairCompatibility(input.left, input.right);
  if (!pair.ok) {
    return { eligible: false, reasons: pair.reasons };
  }
  const route = evaluateRouteAdmission(input.route, input.thresholds);
  if (!route.ok) {
    return { eligible: false, reasons: [route.reason] };
  }
  return { eligible: true, routeScore: route.score, reasons: [] };
}

export function hashMatchAdmissionDigest(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function matchAdmissionDigestHex(
  left: Parameters<typeof computeMatchAdmissionDigest>[0],
  right: Parameters<typeof computeMatchAdmissionDigest>[1],
): string {
  return hashMatchAdmissionDigest(computeMatchAdmissionDigest(left, right));
}

export function computeMatchAdmissionDigest(
  left: MatchAdmissionPost,
  right: MatchAdmissionPost,
): string {
  const ordered = [left, right].sort((a, b) => a.id.localeCompare(b.id));
  const payload = ordered.map(canonicalAdmissionFacts).join("\n");
  return payload;
}

export function canonicalAdmissionFacts(post: MatchAdmissionPost): string {
  return [
    post.id,
    post.user_id,
    post.post_type,
    post.category,
    post.status,
    post.departure_date ?? "",
    post.departure_time_window ?? "",
    post.service_time_window ?? "",
    post.transport_mode ?? "",
    post.escort_seats == null ? "" : String(post.escort_seats),
    post.max_companions == null ? "" : String(post.max_companions),
    post.count_small == null ? "" : String(post.count_small),
    post.count_medium == null ? "" : String(post.count_medium),
    post.count_large == null ? "" : String(post.count_large),
    post.count_xlarge == null ? "" : String(post.count_xlarge),
    post.origin_address ?? "",
    post.destination_address ?? "",
    canonicalWaypoints(post.waypoints),
    post.origin_gps_ewkb ?? "",
    post.destination_gps_ewkb ?? "",
  ].join("|");
}

function canonicalWaypoints(waypoints: unknown): string {
  if (!Array.isArray(waypoints)) return "";
  return waypoints.map((value) => String(value)).join("\u001f");
}
