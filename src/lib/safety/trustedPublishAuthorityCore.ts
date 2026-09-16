/**
 * PHASE 6.7C.2C.3D — trusted publish authority context (pure core).
 * Assembles origin GPS/country/timezone + optional night policy for a later
 * service_role writer. Does not write posts, call Supabase, or hit the network.
 * Production wrapper binds resolveTrustedOrigin behind server-only.
 */

import type { CanonicalStage1Payload } from "@/lib/auth/canonicalStage1Core";
import type {
  TrustedGeocodePoint,
  TrustedOriginErrorKey,
  TrustedOriginResolution,
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

export type SelectNightPolicyFn = (
  input: NightPolicySelectInput,
) => Promise<NightPolicySelectorRow[]> | NightPolicySelectorRow[];

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
  /** Server-generated ISO timestamptz; never browser clock. */
  evaluationTime: string;
  resolveTrustedOrigin: ResolveTrustedOriginFn;
  selectNightPolicy: SelectNightPolicyFn;
};

function isFiniteIsoInstant(value: string): boolean {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
    return false;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms);
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
  // Production region resolver does not exist yet; only country-default rows.
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

/**
 * Build trusted publish authority from canonical Stage-1 + injected geo/policy.
 * Fail-closed typed result; never throws internal geo/DB/fetch errors.
 */
export async function buildTrustedPublishAuthority(
  args: BuildTrustedPublishAuthorityArgs,
): Promise<TrustedPublishAuthorityResult> {
  try {
    if (!isFiniteIsoInstant(args.evaluationTime)) {
      return { ok: false, errorKey: "error.night_policy_invalid" };
    }

    const originResult = await args.resolveTrustedOrigin(
      args.canonical.origin_address,
    );
    if (!originResult.ok) {
      return { ok: false, errorKey: originResult.errorKey };
    }
    const origin = originResult.value;

    const rowsRaw = await args.selectNightPolicy({
      countryCode: origin.countryCode,
      regionCode: null,
      originTimezone: origin.timezone,
      evaluationTime: args.evaluationTime,
    });
    const rows = Array.isArray(rowsRaw) ? rowsRaw : [];

    if (rows.length > 1) {
      return { ok: false, errorKey: "error.night_policy_ambiguous" };
    }

    if (rows.length === 0) {
      // Enabled policy absent (e.g. RS seed enabled=false). Publish authority
      // may still succeed with null version; matching later fail-closes on NULL.
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
