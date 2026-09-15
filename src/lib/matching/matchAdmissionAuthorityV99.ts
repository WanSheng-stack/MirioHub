/**
 * PHASE 6.7C.2C.1 / v99A — pure admission facts/hash helpers.
 * Mirrors unapplied SQL semantics for unit tests. Not wired to API/writer.
 * Production authority remains the v99 SQL functions after user apply.
 */

import { createHash } from "node:crypto";

export const ADMISSION_SCHEMA_VERSION_V99 = 99 as const;

export const ADMISSION_FACTS_FIELDS_V99 = [
  "admission_schema_version",
  "id",
  "user_id",
  "post_type",
  "category",
  "status",
  "departure_date",
  "departure_time_window",
  "service_time_window",
  "transport_mode",
  "service_subtype",
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
  "origin_country_code",
  "origin_timezone",
  "night_policy_version",
] as const;

export type AdmissionPostFactsV99Input = {
  id: string | null | undefined;
  user_id: string | null | undefined;
  post_type: string | null | undefined;
  category: string | null | undefined;
  status: string | null | undefined;
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
  waypoints?: unknown;
  origin_gps_ewkb?: string | null;
  destination_gps_ewkb?: string | null;
  origin_country_code?: string | null;
  origin_timezone?: string | null;
  night_policy_version?: number | null;
  /** Non-admission fields must not affect hash when present. */
  title?: string | null;
  fee_amount?: number | null;
  bump_fee?: number | null;
};

export type AdmissionPostFactsV99 = {
  admission_schema_version: typeof ADMISSION_SCHEMA_VERSION_V99;
  id: string | null;
  user_id: string | null;
  post_type: string | null;
  category: string | null;
  status: string | null;
  departure_date: string | null;
  departure_time_window: string | null;
  service_time_window: string | null;
  transport_mode: string | null;
  service_subtype: string | null;
  escort_seats: number | null;
  max_companions: number | null;
  count_small: number | null;
  count_medium: number | null;
  count_large: number | null;
  count_xlarge: number | null;
  origin_address: string | null;
  destination_address: string | null;
  waypoints: unknown;
  origin_gps_ewkb: string | null;
  destination_gps_ewkb: string | null;
  origin_country_code: string | null;
  origin_timezone: string | null;
  night_policy_version: number | null;
};

/** Keep NULL vs "" distinct — never coalesce text to empty. */
function textOrNull(value: string | null | undefined): string | null {
  if (value === undefined) return null;
  return value;
}

function intOrNull(value: number | null | undefined): number | null {
  if (value === undefined) return null;
  return value;
}

export function buildAdmissionPostFactsV99(
  post: AdmissionPostFactsV99Input,
): AdmissionPostFactsV99 {
  return {
    admission_schema_version: ADMISSION_SCHEMA_VERSION_V99,
    id: textOrNull(post.id),
    user_id: textOrNull(post.user_id),
    post_type: textOrNull(post.post_type),
    category: textOrNull(post.category),
    status: textOrNull(post.status),
    departure_date: textOrNull(post.departure_date),
    departure_time_window: textOrNull(post.departure_time_window),
    service_time_window: textOrNull(post.service_time_window),
    transport_mode: textOrNull(post.transport_mode),
    service_subtype: textOrNull(post.service_subtype),
    escort_seats: intOrNull(post.escort_seats),
    max_companions: intOrNull(post.max_companions),
    count_small: intOrNull(post.count_small),
    count_medium: intOrNull(post.count_medium),
    count_large: intOrNull(post.count_large),
    count_xlarge: intOrNull(post.count_xlarge),
    origin_address: textOrNull(post.origin_address),
    destination_address: textOrNull(post.destination_address),
    waypoints: post.waypoints === undefined ? null : post.waypoints,
    origin_gps_ewkb: textOrNull(post.origin_gps_ewkb),
    destination_gps_ewkb: textOrNull(post.destination_gps_ewkb),
    origin_country_code: textOrNull(post.origin_country_code),
    origin_timezone: textOrNull(post.origin_timezone),
    night_policy_version: intOrNull(post.night_policy_version),
  };
}

/**
 * Stable JSON text approximating PostgreSQL jsonb::text key ordering
 * (object keys sorted). Used only for relative hash tests — live SQL uses
 * p_facts::text + extensions.digest.
 */
export function stableJsonbText(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(nested as Record<string, unknown>).sort()) {
        sorted[k] = (nested as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return nested;
  });
}

export function buildAdmissionPairFactsV99(
  left: AdmissionPostFactsV99Input,
  right: AdmissionPostFactsV99Input,
): AdmissionPostFactsV99[] | null {
  const a = buildAdmissionPostFactsV99(left);
  const b = buildAdmissionPostFactsV99(right);
  if (a.id == null || b.id == null) return null;
  if (a.id === b.id) return null;
  return [a, b].sort((x, y) => (x.id as string).localeCompare(y.id as string));
}

export function hashAdmissionFactsV99(
  facts: AdmissionPostFactsV99[] | null | undefined,
): string | null {
  if (facts == null || !Array.isArray(facts) || facts.length !== 2) return null;
  const ids = facts.map((f) => f?.id);
  if (ids.some((id) => id == null || id === "")) return null;
  if (new Set(ids).size !== 2) return null;
  if (
    facts.some(
      (f) => f.admission_schema_version !== ADMISSION_SCHEMA_VERSION_V99,
    )
  ) {
    return null;
  }
  return createHash("sha256")
    .update(stableJsonbText(facts), "utf8")
    .digest("hex");
}

export function hashAdmissionPairV99(
  left: AdmissionPostFactsV99Input,
  right: AdmissionPostFactsV99Input,
): string | null {
  return hashAdmissionFactsV99(buildAdmissionPairFactsV99(left, right));
}
