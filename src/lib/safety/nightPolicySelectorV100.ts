/**
 * PHASE 6.7C.2C.3C — pure fixture mirror of select_night_service_policy_v100.
 * Does not connect to PostgreSQL. Used only for deterministic offline tests.
 * Production authority remains the SQL SECURITY DEFINER function.
 */

export type NightPolicyFixtureRow = {
  id: string;
  country_code: string;
  region_code: string | null;
  timezone_name: string;
  blocked_start_local: string;
  blocked_end_local: string;
  enabled: boolean;
  policy_version: number;
  effective_from: string; // ISO timestamptz
  effective_until: string | null;
};

export type NightPolicySelectorResult = {
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

export type NightPolicySelectorInput = {
  countryCode: string | null;
  regionCode: string | null;
  originTimezone: string | null;
  evaluationTime: string | null; // ISO timestamptz
  /** Injected catalog of valid IANA names (mirrors pg_timezone_names). */
  knownTimezones: ReadonlySet<string>;
};

function isValidCountry(code: string | null): code is string {
  if (code == null) return false;
  if (code !== code.trim()) return false;
  return /^[A-Z]{2}$/.test(code);
}

function isValidRegion(region: string | null): boolean {
  if (region == null) return true;
  if (region !== region.trim()) return false;
  if (region.length < 1 || region.length > 64) return false;
  return true;
}

function isValidTimezone(
  tz: string | null,
  known: ReadonlySet<string>,
): tz is string {
  if (tz == null) return false;
  if (tz !== tz.trim()) return false;
  if (tz.length < 1 || tz.length > 100) return false;
  return known.has(tz);
}

/**
 * Pure selector matching SQL v100 semantics (fail-closed → empty array).
 */
export function selectNightServicePolicyV100Pure(
  rows: readonly NightPolicyFixtureRow[],
  input: NightPolicySelectorInput,
): NightPolicySelectorResult[] {
  if (!isValidCountry(input.countryCode)) return [];
  if (!isValidRegion(input.regionCode)) return [];
  if (!isValidTimezone(input.originTimezone, input.knownTimezones)) return [];
  if (input.evaluationTime == null || input.evaluationTime.trim() === "") {
    return [];
  }
  const evaluationMs = Date.parse(input.evaluationTime);
  if (!Number.isFinite(evaluationMs)) return [];

  const countryCode = input.countryCode;
  const regionCode = input.regionCode;
  const originTimezone = input.originTimezone;

  const candidates = rows.filter((p) => {
    if (p.enabled !== true) return false;
    if (p.country_code !== countryCode) return false;
    if (p.timezone_name !== originTimezone) return false;
    const fromMs = Date.parse(p.effective_from);
    if (!Number.isFinite(fromMs) || fromMs > evaluationMs) return false;
    if (p.effective_until != null) {
      const untilMs = Date.parse(p.effective_until);
      if (!Number.isFinite(untilMs) || evaluationMs >= untilMs) return false;
    }
    if (regionCode != null) {
      return p.region_code === regionCode || p.region_code == null;
    }
    return p.region_code == null;
  });

  candidates.sort((a, b) => {
    const aExact = a.region_code != null ? 0 : 1;
    const bExact = b.region_code != null ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    if (a.policy_version !== b.policy_version) {
      return b.policy_version - a.policy_version;
    }
    const aFrom = Date.parse(a.effective_from);
    const bFrom = Date.parse(b.effective_from);
    if (aFrom !== bFrom) return bFrom - aFrom;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const top = candidates[0];
  if (!top) return [];
  return [
    {
      policy_id: top.id,
      country_code: top.country_code,
      region_code: top.region_code,
      timezone_name: top.timezone_name,
      blocked_start_local: top.blocked_start_local,
      blocked_end_local: top.blocked_end_local,
      policy_version: top.policy_version,
      effective_from: top.effective_from,
      effective_until: top.effective_until,
    },
  ];
}

/** Fixed evaluation instant for pure tests (never live clock). */
export const NIGHT_POLICY_SELECTOR_TEST_INSTANT =
  "2026-06-15T12:00:00.000Z";

export const NIGHT_POLICY_SELECTOR_KNOWN_TZ = new Set([
  "Europe/Belgrade",
  "Europe/Paris",
]);
