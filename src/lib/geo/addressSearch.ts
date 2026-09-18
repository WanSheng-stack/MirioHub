/**
 * Country-scoped address candidate search (Nominatim multi-hit).
 * Pure parsers + URL builders. Network lives in API / injectable fetch.
 */

import {
  isValidLatLon,
  normalizeGeocodeAddress,
  parseFiniteCoordinate,
  parseOptionalCountryCode,
} from "@/lib/route-kms";

export const ADDRESS_SEARCH_LIMIT = 5;

export type AddressPrecision = "city" | "locality" | "street" | "poi" | "other";

export type AddressSearchCandidate = {
  /** Stable id for list keys (Nominatim place_id or lat/lon fallback). */
  id: string;
  primaryName: string;
  locality: string | null;
  countryCode: string;
  countryName: string | null;
  typeLabel: string | null;
  /** Label written into the confirmed address field. */
  displayLabel: string;
  precision: AddressPrecision;
  lat: number;
  lon: number;
};

export type AddressSearchRequest = {
  countryCode: string;
  query: string;
  localityContext?: string | null;
};

export type ConfirmedAddressGeo = {
  label: string;
  lat: number;
  lon: number;
  precision: AddressPrecision;
  searchCountryCode: string;
  localityContext: string | null;
};

/** ISO 3166-1 alpha-2 uppercase, or null. */
export function normalizeSearchCountryCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cc = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  return cc;
}

export function classifyAddressPrecision(row: {
  type?: unknown;
  class?: unknown;
  addresstype?: unknown;
}): AddressPrecision {
  const tokens = [row.addresstype, row.type, row.class]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toLowerCase());
  const set = new Set(tokens);

  if (
    set.has("city") ||
    set.has("town") ||
    set.has("village") ||
    set.has("municipality") ||
    set.has("hamlet") ||
    set.has("county") ||
    set.has("state") ||
    set.has("region") ||
    set.has("administrative")
  ) {
    return "city";
  }
  if (
    set.has("suburb") ||
    set.has("neighbourhood") ||
    set.has("neighborhood") ||
    set.has("quarter") ||
    set.has("city_district") ||
    set.has("borough") ||
    set.has("district")
  ) {
    return "locality";
  }
  if (
    set.has("road") ||
    set.has("residential") ||
    set.has("pedestrian") ||
    set.has("path") ||
    set.has("footway") ||
    set.has("living_street") ||
    set.has("house") ||
    set.has("building") ||
    set.has("house_number")
  ) {
    return "street";
  }
  if (
    set.has("amenity") ||
    set.has("shop") ||
    set.has("tourism") ||
    set.has("leisure") ||
    set.has("office") ||
    set.has("historic") ||
    set.has("aeroway")
  ) {
    return "poi";
  }
  return "other";
}

function readAddressPart(
  address: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!address) return null;
  for (const key of keys) {
    const v = address[key];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

/**
 * Build Nominatim search URL: country-scoped, max 5 candidates.
 * First-level (no localityContext) biases settlements via featureType=settlement.
 */
export function buildNominatimCandidateSearchUrl(input: {
  query: string;
  countryCode: string;
  localityContext?: string | null;
  limit?: number;
}): string | null {
  const cc = normalizeSearchCountryCode(input.countryCode);
  const qBase = normalizeGeocodeAddress(input.query);
  if (cc == null || qBase == null) return null;

  const locality =
    typeof input.localityContext === "string"
      ? normalizeGeocodeAddress(input.localityContext)
      : null;
  const q =
    locality != null && !qBase.toLowerCase().includes(locality.toLowerCase())
      ? `${qBase}, ${locality}`
      : qBase;

  const limit = Math.min(
    Math.max(1, input.limit ?? ADDRESS_SEARCH_LIMIT),
    ADDRESS_SEARCH_LIMIT,
  );
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: String(limit),
    addressdetails: "1",
    countrycodes: cc.toLowerCase(),
  });
  if (locality == null) {
    params.set("featureType", "settlement");
  }
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

/**
 * Parse Nominatim multi-hit JSON into display candidates.
 * Filters to requested country when address.country_code is present.
 * Does not return raw Nominatim payloads.
 */
export function parseNominatimCandidateResponse(
  data: unknown,
  expectedCountryCode: string,
): AddressSearchCandidate[] {
  const expected = normalizeSearchCountryCode(expectedCountryCode);
  if (expected == null || !Array.isArray(data)) return [];

  const out: AddressSearchCandidate[] = [];
  for (const item of data) {
    if (out.length >= ADDRESS_SEARCH_LIMIT) break;
    if (item == null || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const lat = parseFiniteCoordinate(row.lat);
    const lon = parseFiniteCoordinate(row.lon);
    if (lat == null || lon == null || !isValidLatLon(lat, lon)) continue;

    const address =
      row.address != null &&
      typeof row.address === "object" &&
      !Array.isArray(row.address)
        ? (row.address as Record<string, unknown>)
        : null;
    const hitCc = parseOptionalCountryCode(address);
    if (hitCc != null && hitCc !== expected) continue;

    const countryCode = hitCc ?? expected;
    const primaryName =
      (typeof row.name === "string" && row.name.trim()) ||
      readAddressPart(address, [
        "road",
        "pedestrian",
        "suburb",
        "neighbourhood",
        "city",
        "town",
        "village",
        "municipality",
      ]) ||
      (typeof row.display_name === "string"
        ? row.display_name.split(",")[0]?.trim()
        : "") ||
      "";
    if (!primaryName) continue;

    const locality = readAddressPart(address, [
      "city",
      "town",
      "village",
      "municipality",
      "county",
      "state",
    ]);
    const countryName = readAddressPart(address, ["country"]);
    const typeRaw =
      (typeof row.addresstype === "string" && row.addresstype) ||
      (typeof row.type === "string" && row.type) ||
      (typeof row.class === "string" && row.class) ||
      null;
    const precision = classifyAddressPrecision(row);
    const displayLabel =
      typeof row.display_name === "string" && row.display_name.trim()
        ? row.display_name.trim()
        : [primaryName, locality, countryName].filter(Boolean).join(", ");

    const placeId =
      typeof row.place_id === "number" || typeof row.place_id === "string"
        ? String(row.place_id)
        : `${lat.toFixed(5)}_${lon.toFixed(5)}`;

    out.push({
      id: placeId,
      primaryName,
      locality,
      countryCode,
      countryName,
      typeLabel: typeRaw,
      displayLabel,
      precision,
      lat,
      lon,
    });
  }
  return out;
}

export function candidateToConfirmed(
  candidate: AddressSearchCandidate,
  searchCountryCode: string,
): ConfirmedAddressGeo {
  const localityContext =
    candidate.precision === "city"
      ? candidate.primaryName
      : candidate.locality ?? candidate.primaryName;
  return {
    label: candidate.displayLabel,
    lat: candidate.lat,
    lon: candidate.lon,
    precision: candidate.precision,
    searchCountryCode,
    localityContext,
  };
}

export function isCityLevelPrecision(precision: AddressPrecision | null | undefined): boolean {
  return precision === "city";
}
