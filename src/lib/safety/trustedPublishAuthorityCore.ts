/**
 * PHASE 6.7C.2C.3D / 3D.1 — trusted publish authority context (pure core).
 * Assembles origin GPS/country/timezone + optional night policy for a later
 * service_role writer. Does not write posts, call Supabase, or hit the network.
 * Production wrapper binds resolveTrustedOrigin behind server-only.
 */

import type { CanonicalStage1Payload } from "@/lib/auth/canonicalStage1Core";
import {
  assertValidIanaTimezone,
  isValidLatLon,
  parseFiniteCoordinate,
  toGeographyPointWkt,
  type TrustedGeocodePoint,
  type TrustedOriginErrorKey,
  type TrustedOriginResolution,
} from "@/lib/route-kms";
import {
  evaluateNightServicePolicy,
  type NightServiceDenial,
} from "@/lib/safety/nightServicePolicy";

/** v100 selector return-row contract (TABLE columns). */
export type NightPolicySelectorRow = {
  policy_id: string;
  country_code: string;
  region_code: string | null;
  timezone_name: string;
  blocked_start_local: string;
  blocked_end_local: string;
  policy_version: number;
  effective_from: string;
  effective_until: string | null;
};

export type NightPolicySelectInput = {
  countryCode: string;
  regionCode: null;
  originTimezone: string;
  evaluationTime: string;
};

/** Runtime result validated as unknown; only true arrays proceed. */
export type SelectNightPolicyFn = (
  input: NightPolicySelectInput,
) => Promise<unknown> | unknown;

export type ResolveTrustedOriginFn = (
  address: string,
) => Promise<TrustedOriginResolution>;

export type TrustedPublishAuthorityValue = {
  originGpsWkt: string;
  originCountryCode: string;
  originTimezone: string;
  nightPolicyVersion: number | null;
  nightPolicyApplied: boolean;
  policyId: string | null;
};

export type TrustedPublishAuthorityErrorKey =
  | TrustedOriginErrorKey
  | "error.night_policy_ambiguous"
  | "error.night_policy_invalid"
  | "error.night_service_blocked"
  | "error.night_policy_time_invalid"
  | "error.invalid_service_subtype"
  | "error.illegal_transport_combo";

export type TrustedPublishAuthorityResult =
  | { ok: true; value: TrustedPublishAuthorityValue }
  | { ok: false; errorKey: TrustedPublishAuthorityErrorKey };

export type BuildTrustedPublishAuthorityArgs = {
  canonical: CanonicalStage1Payload;
  /** Server-generated RFC3339 instant with explicit timezone (Z or ±HH:MM). */
  evaluationTime: string;
  resolveTrustedOrigin: ResolveTrustedOriginFn;
  selectNightPolicy: SelectNightPolicyFn;
};

const STRICT_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const WKT_POINT_RE =
  /^SRID=4326;POINT\(([-+0-9.eE]+)\s+([-+0-9.eE]+)\)$/;

function isValidUtcOffsetSuffix(suffix: string): boolean {
  if (suffix === "Z") return true;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(suffix);
  if (!m) return false;
  const hours = Number(m[2]);
  const mins = Number(m[3]);
  return (
    Number.isInteger(hours) &&
    Number.isInteger(mins) &&
    hours >= 0 &&
    hours <= 23 &&
    mins >= 0 &&
    mins <= 59
  );
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidGregorianYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1]!;
}

/**
 * RFC3339/ISO instant with explicit timezone. Rejects date-only, timezone-less,
 * padded, and non-finite parses. Does not default missing timezone to UTC.
 */
export function isStrictEvaluationInstant(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    return false;
  }
  const m = STRICT_INSTANT_RE.exec(value);
  if (!m) return false;
  if (!isValidUtcOffsetSuffix(m[8]!)) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  if (!isValidGregorianYmd(year, month, day)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function parseWktPoint4326(
  wkt: string,
): { lat: number; lon: number } | null {
  const m = WKT_POINT_RE.exec(wkt);
  if (!m) return null;
  const lon = parseFiniteCoordinate(m[1]);
  const lat = parseFiniteCoordinate(m[2]);
  if (lon == null || lat == null || !isValidLatLon(lat, lon)) return null;
  return { lat, lon };
}

function validateTrustedOriginPoint(
  origin: TrustedGeocodePoint,
): TrustedOriginErrorKey | null {
  if (
    typeof origin.countryCode !== "string" ||
    !/^[A-Z]{2}$/.test(origin.countryCode)
  ) {
    return "error.geocode_invalid_response";
  }
  if (
    typeof origin.timezone !== "string" ||
    origin.timezone === "" ||
    origin.timezone !== origin.timezone.trim()
  ) {
    return "error.geocode_invalid_response";
  }
  if (!assertValidIanaTimezone(origin.timezone)) {
    return "error.geocode_invalid_response";
  }
  if (
    typeof origin.wkt !== "string" ||
    origin.wkt === "" ||
    origin.wkt !== origin.wkt.trim()
  ) {
    return "error.geocode_invalid_response";
  }
  if (!isValidLatLon(origin.lat, origin.lon)) {
    return "error.geocode_invalid_response";
  }
  const fromWkt = parseWktPoint4326(origin.wkt);
  if (fromWkt == null) {
    return "error.geocode_invalid_response";
  }
  if (fromWkt.lat !== origin.lat || fromWkt.lon !== origin.lon) {
    return "error.geocode_invalid_response";
  }
  if (origin.wkt !== toGeographyPointWkt(origin.lat, origin.lon)) {
    return "error.geocode_invalid_response";
  }
  return null;
}

function mapNightDenial(
  reason: NightServiceDenial,
): TrustedPublishAuthorityErrorKey {
  switch (reason) {
    case "night_blocked":
      return "error.night_service_blocked";
    case "invalid_time":
      return "error.night_policy_time_invalid";
    case "illegal_subtype":
    case "legacy_unknown_subtype":
      return "error.invalid_service_subtype";
    case "illegal_transport_combo":
      return "error.illegal_transport_combo";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validateSelectedPolicy(
  row: NightPolicySelectorRow,
  origin: TrustedGeocodePoint,
): TrustedPublishAuthorityErrorKey | null {
  if (!isPositiveInt(row.policy_version)) {
    return "error.night_policy_invalid";
  }
  if (row.country_code !== origin.countryCode) {
    return "error.night_policy_invalid";
  }
  if (row.timezone_name !== origin.timezone) {
    return "error.night_policy_invalid";
  }
  if (row.region_code != null) {
    return "error.night_policy_invalid";
  }
  if (
    typeof row.blocked_start_local !== "string" ||
    typeof row.blocked_end_local !== "string" ||
    row.blocked_start_local.trim() === "" ||
    row.blocked_end_local.trim() === ""
  ) {
    return "error.night_policy_time_invalid";
  }
  if (typeof row.policy_id !== "string" || row.policy_id.trim() === "") {
    return "error.night_policy_invalid";
  }
  return null;
}

function assertSelectorRows(raw: unknown): NightPolicySelectorRow[] | null {
  if (!Array.isArray(raw)) return null;
  return raw as NightPolicySelectorRow[];
}

/**
 * Build trusted publish authority from canonical Stage-1 + injected geo/policy.
 * Fail-closed typed result; never throws internal geo/DB/fetch errors.
 */
export async function buildTrustedPublishAuthority(
  args: BuildTrustedPublishAuthorityArgs,
): Promise<TrustedPublishAuthorityResult> {
  try {
    if (!isStrictEvaluationInstant(args.evaluationTime)) {
      return { ok: false, errorKey: "error.night_policy_invalid" };
    }

    const originResult = await args.resolveTrustedOrigin(
      args.canonical.origin_address,
    );
    if (!originResult.ok) {
      return { ok: false, errorKey: originResult.errorKey };
    }
    const originErr = validateTrustedOriginPoint(originResult.value);
    if (originErr != null) {
      return { ok: false, errorKey: originErr };
    }
    const origin = originResult.value;

    const rowsRaw = await args.selectNightPolicy({
      countryCode: origin.countryCode,
      regionCode: null,
      originTimezone: origin.timezone,
      evaluationTime: args.evaluationTime,
    });
    const rows = assertSelectorRows(rowsRaw);
    if (rows == null) {
      return { ok: false, errorKey: "error.night_policy_invalid" };
    }

    if (rows.length > 1) {
      return { ok: false, errorKey: "error.night_policy_ambiguous" };
    }

    if (rows.length === 0) {
      return {
        ok: true,
        value: {
          originGpsWkt: origin.wkt,
          originCountryCode: origin.countryCode,
          originTimezone: origin.timezone,
          nightPolicyVersion: null,
          nightPolicyApplied: false,
          policyId: null,
        },
      };
    }

    const row = rows[0]!;
    const policyErr = validateSelectedPolicy(row, origin);
    if (policyErr != null) {
      return { ok: false, errorKey: policyErr };
    }

    const decision = evaluateNightServicePolicy({
      category: args.canonical.category,
      serviceSubtype: args.canonical.service_subtype,
      transportMode: args.canonical.transport_mode,
      localTime: args.canonical.departure_time,
      blockedStartLocal: row.blocked_start_local,
      blockedEndLocal: row.blocked_end_local,
      policyEnabled: true,
      purpose: "publish",
    });

    if (!decision.ok) {
      return { ok: false, errorKey: mapNightDenial(decision.reason) };
    }

    return {
      ok: true,
      value: {
        originGpsWkt: origin.wkt,
        originCountryCode: origin.countryCode,
        originTimezone: origin.timezone,
        nightPolicyVersion: row.policy_version,
        nightPolicyApplied: true,
        policyId: row.policy_id,
      },
    };
  } catch {
    return { ok: false, errorKey: "error.night_policy_invalid" };
  }
}

/** Fixed evaluation instant for offline tests (never live clock). */
export const TRUSTED_PUBLISH_AUTHORITY_TEST_INSTANT =
  "2026-06-15T12:00:00.000Z";
