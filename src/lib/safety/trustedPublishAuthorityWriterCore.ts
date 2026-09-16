/**
 * PHASE 6.7C.2C.3E — trusted publish authority writer foundation (pure core).
 * Materializes DB-persistable posts fields from a successful
 * TrustedPublishAuthorityValue. Does not geocode, select night policy, call
 * Supabase, or cut over publish APIs. Persistence is injected by the caller.
 *
 * Schema note: posts already has origin_gps / origin_country_code /
 * origin_timezone / night_policy_version (v96). No migration/v101 required for
 * this foundation. nightPolicyApplied / policyId are validated for consistency
 * but only night_policy_version is persisted (applied is derivable; no policy_id
 * column on posts).
 */

import {
  assertValidIanaTimezone,
  isValidLatLon,
  parseFiniteCoordinate,
  toGeographyPointWkt,
} from "@/lib/route-kms";
import type { TrustedPublishAuthorityValue } from "@/lib/safety/trustedPublishAuthorityCore";

/** Columns written from trusted authority (existing posts schema). */
export type TrustedPublishAuthorityPersistedFields = {
  origin_gps: string;
  origin_country_code: string;
  origin_timezone: string;
  night_policy_version: number | null;
};

export type TrustedPublishAuthorityWriteErrorKey =
  | "error.authority_write_invalid"
  | "error.authentication_required";

export type TrustedPublishAuthorityWriteResult =
  | {
      ok: true;
      fields: TrustedPublishAuthorityPersistedFields;
    }
  | { ok: false; errorKey: TrustedPublishAuthorityWriteErrorKey };

export type PersistTrustedPublishAuthorityFn = (
  fields: TrustedPublishAuthorityPersistedFields,
  ctx: { userId: string },
) => Promise<void>;

export type ExecuteTrustedPublishAuthorityWriteArgs = {
  userId: string;
  /** Must be a successful TrustedPublishAuthorityValue (runtime-validated). */
  authority: unknown;
  /**
   * Optional client/raw bag. Authority-derived keys here are ignored and cannot
   * override trusted values. Never geocoded or policy-selected from this bag.
   */
  clientPayload?: Record<string, unknown>;
  persist: PersistTrustedPublishAuthorityFn;
};

/** Client/browser keys that must never override trusted authority. */
export const CLIENT_AUTHORITY_OVERRIDE_KEYS = [
  "origin_gps",
  "origin_country_code",
  "origin_timezone",
  "night_policy_version",
  "originGpsWkt",
  "originCountryCode",
  "originTimezone",
  "nightPolicyVersion",
  "nightPolicyApplied",
  "policyId",
] as const;

const WKT_POINT_RE =
  /^SRID=4326;POINT\(([-+0-9.eE]+)\s+([-+0-9.eE]+)\)$/;

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Fail-closed materialization of posts authority columns from a trusted value.
 * Does not trust clientPayload for any authority field.
 */
export function materializeTrustedPublishAuthorityFields(
  authority: unknown,
): TrustedPublishAuthorityWriteResult {
  if (!isPlainObject(authority)) {
    return { ok: false, errorKey: "error.authority_write_invalid" };
  }

  const originGpsWkt = authority.originGpsWkt;
  const originCountryCode = authority.originCountryCode;
  const originTimezone = authority.originTimezone;
  const nightPolicyVersion = authority.nightPolicyVersion;
  const nightPolicyApplied = authority.nightPolicyApplied;
  const policyId = authority.policyId;

  if (
    typeof originGpsWkt !== "string" ||
    originGpsWkt === "" ||
    originGpsWkt !== originGpsWkt.trim()
  ) {
    return { ok: false, errorKey: "error.authority_write_invalid" };
  }
  const wktMatch = WKT_POINT_RE.exec(originGpsWkt);
  if (!wktMatch) {
    return { ok: false, errorKey: "error.authority_write_invalid" };
  }
  const lon = parseFiniteCoordinate(wktMatch[1]);
  const lat = parseFiniteCoordinate(wktMatch[2]);
  if (lon == null || lat == null || !isValidLatLon(lat, lon)) {
    return { ok: false, errorKey: "error.authority_write_invalid" };
  }
  if (originGpsWkt !== toGeographyPointWkt(lat, lon)) {
    return { ok: false, errorKey: "error.authority_write_invalid" };
  }

  if (
    typeof originCountryCode !== "string" ||
    !/^[A-Z]{2}$/.test(originCountryCode)
  ) {
    return { ok: false, errorKey: "error.authority_write_invalid" };
  }

  if (
    typeof originTimezone !== "string" ||
    originTimezone === "" ||
    originTimezone !== originTimezone.trim() ||
    !assertValidIanaTimezone(originTimezone)
  ) {
    return { ok: false, errorKey: "error.authority_write_invalid" };
  }

  if (typeof nightPolicyApplied !== "boolean") {
    return { ok: false, errorKey: "error.authority_write_invalid" };
  }

  if (nightPolicyApplied === false) {
    if (nightPolicyVersion !== null || policyId !== null) {
      return { ok: false, errorKey: "error.authority_write_invalid" };
    }
    return {
      ok: true,
      fields: {
        origin_gps: originGpsWkt,
        origin_country_code: originCountryCode,
        origin_timezone: originTimezone,
        night_policy_version: null,
      },
    };
  }

  if (!isPositiveInt(nightPolicyVersion)) {
    return { ok: false, errorKey: "error.authority_write_invalid" };
  }
  if (
    typeof policyId !== "string" ||
    policyId !== policyId.trim() ||
    !UUID_RE.test(policyId)
  ) {
    return { ok: false, errorKey: "error.authority_write_invalid" };
  }

  return {
    ok: true,
    fields: {
      origin_gps: originGpsWkt,
      origin_country_code: originCountryCode,
      origin_timezone: originTimezone,
      night_policy_version: nightPolicyVersion,
    },
  };
}

/**
 * Execute writer foundation: validate authority → persist only trusted fields.
 * clientPayload cannot override authority-derived columns.
 */
export async function executeTrustedPublishAuthorityWrite(
  args: ExecuteTrustedPublishAuthorityWriteArgs,
): Promise<TrustedPublishAuthorityWriteResult> {
  try {
    if (
      typeof args.userId !== "string" ||
      args.userId === "" ||
      args.userId !== args.userId.trim() ||
      !UUID_RE.test(args.userId)
    ) {
      return { ok: false, errorKey: "error.authentication_required" };
    }

    const prepared = materializeTrustedPublishAuthorityFields(args.authority);
    if (!prepared.ok) return prepared;

    // Prove client keys cannot override: never read authority columns from client.
    void args.clientPayload;
    void CLIENT_AUTHORITY_OVERRIDE_KEYS;

    await args.persist(prepared.fields, { userId: args.userId });
    return prepared;
  } catch {
    return { ok: false, errorKey: "error.authority_write_invalid" };
  }
}

/** Typed helper for tests constructing a valid authority value. */
export function asTrustedPublishAuthorityValue(
  value: TrustedPublishAuthorityValue,
): TrustedPublishAuthorityValue {
  return value;
}
