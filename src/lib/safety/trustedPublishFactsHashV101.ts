/**
 * PHASE 6.7C.2C.3G / v101B — pure publish-facts hash fixtures (offline).
 * Mirrors SQL field set + UTF-8 SHA-256 of jsonb-like text for relative tests.
 * Live authority remains trusted_publish_facts_hash_v101 (PostGIS EWKB + digest).
 * Does not reimplement PostGIS EWKB; callers supply origin_gps_ewkb_hex fixtures.
 */

import { createHash } from "node:crypto";

export const PUBLISH_FACTS_SCHEMA_VERSION_V101 = 101 as const;

/** Frozen key order for documentation; jsonb::text sorts keys alphabetically. */
export const PUBLISH_FACTS_FIELDS_V101 = [
  "publish_facts_schema_version",
  "canonical_payload_hash",
  "origin_gps_ewkb_hex",
  "origin_country_code",
  "origin_timezone",
  "night_policy_version",
] as const;

export type TrustedPublishFactsV101Input = {
  canonical_payload_hash: string;
  origin_gps_ewkb_hex: string;
  origin_country_code: string;
  origin_timezone: string;
  night_policy_version: number | null;
};

const HEX64 = /^[0-9a-f]{64}$/;
const COUNTRY = /^[A-Z]{2}$/;
const EWKB_HEX = /^[0-9a-f]+$/;

/**
 * Stable JSON text approximating PostgreSQL jsonb::text (object keys sorted).
 * Relative hash tests only — live SQL uses facts::text + extensions.digest.
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

export function validateTrustedPublishFactsInputsV101(
  input: TrustedPublishFactsV101Input,
): boolean {
  if (
    typeof input.canonical_payload_hash !== "string" ||
    !HEX64.test(input.canonical_payload_hash)
  ) {
    return false;
  }
  if (
    typeof input.origin_gps_ewkb_hex !== "string" ||
    input.origin_gps_ewkb_hex.length < 2 ||
    !EWKB_HEX.test(input.origin_gps_ewkb_hex)
  ) {
    return false;
  }
  if (
    typeof input.origin_country_code !== "string" ||
    input.origin_country_code !== input.origin_country_code.trim() ||
    !COUNTRY.test(input.origin_country_code)
  ) {
    return false;
  }
  if (
    typeof input.origin_timezone !== "string" ||
    input.origin_timezone !== input.origin_timezone.trim() ||
    input.origin_timezone.length < 1 ||
    input.origin_timezone.length > 100
  ) {
    return false;
  }
  if (
    input.night_policy_version !== null &&
    (typeof input.night_policy_version !== "number" ||
      !Number.isInteger(input.night_policy_version) ||
      input.night_policy_version <= 0)
  ) {
    return false;
  }
  return true;
}

export function buildTrustedPublishFactsV101(
  input: TrustedPublishFactsV101Input,
): Record<(typeof PUBLISH_FACTS_FIELDS_V101)[number], unknown> | null {
  if (!validateTrustedPublishFactsInputsV101(input)) return null;
  return {
    publish_facts_schema_version: PUBLISH_FACTS_SCHEMA_VERSION_V101,
    canonical_payload_hash: input.canonical_payload_hash,
    origin_gps_ewkb_hex: input.origin_gps_ewkb_hex,
    origin_country_code: input.origin_country_code,
    origin_timezone: input.origin_timezone,
    night_policy_version: input.night_policy_version,
  };
}

export function hashTrustedPublishFactsV101(
  input: TrustedPublishFactsV101Input,
): string | null {
  const facts = buildTrustedPublishFactsV101(input);
  if (facts == null) return null;
  return createHash("sha256")
    .update(stableJsonbText(facts), "utf8")
    .digest("hex");
}
