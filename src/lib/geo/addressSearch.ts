/**
 * Country-scoped address candidate search + stable Nominatim OSM refs.
 * Pure parsers / URL builders. Network + cache live in nominatimClient.
 */

import {
  isValidLatLon,
  normalizeGeocodeAddress,
  parseFiniteCoordinate,
  parseOptionalCountryCode,
} from "@/lib/route-kms";

export const ADDRESS_SEARCH_LIMIT = 5;
export const ADDRESS_QUERY_MIN_LEN = 1;
export const ADDRESS_QUERY_MAX_LEN = 200;
export const ADDRESS_LOCALITY_MAX_LEN = 200;

export type NominatimOsmType = "node" | "way" | "relation";

export type AddressResultLevel = "city" | "district" | "street" | "place";

export type AddressPlaceRef = {
  provider: "nominatim";
  osmType: NominatimOsmType;
  osmId: string;
};

export type AddressSearchCandidate = AddressPlaceRef & {
  displayName: string;
  primaryLabel: string;
  localityLabel: string | null;
  countryCode: string;
  countryName: string | null;
  typeLabel: string | null;
  resultLevel: AddressResultLevel;
  latitude: number;
  longitude: number;
};

/**
 * Client-confirmed place. Server must re-resolve via osmType+osmId —
 * preview lat/lon are display-only and never authoritative.
 */
export type ConfirmedAddressGeo = AddressPlaceRef & {
  displayName: string;
  primaryLabel: string;
  localityLabel: string | null;
  countryCode: string;
  resultLevel: AddressResultLevel;
  searchCountryCode: string;
  localityContext: string | null;
  previewLatitude: number;
  previewLongitude: number;
};

/**
 * Strict ISO 3166-1 alpha-2: exact uppercase, no trim/pad/lowercase accept.
 */
export function requireExactCountryCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!/^[A-Z]{2}$/.test(raw)) return null;
  return raw;
}

/** Lenient helper for internal URL building after exact validation. */
export function countryCodeForNominatimParam(exactUpper: string): string {
  return exactUpper.toLowerCase();
}

export function parseNominatimOsmType(raw: unknown): NominatimOsmType | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "node" || v === "n") return "node";
  if (v === "way" || v === "w") return "way";
  if (v === "relation" || v === "r") return "relation";
  return null;
}

export function parseNominatimOsmId(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return String(raw);
  }
  if (typeof raw === "string" && /^[1-9][0-9]*$/.test(raw.trim())) {
    return raw.trim();
  }
  return null;
}

export function osmLookupId(osmType: NominatimOsmType, osmId: string): string {
  const prefix =
    osmType === "node" ? "N" : osmType === "way" ? "W" : "R";
  return `${prefix}${osmId}`;
}

export function parseAddressPlaceRef(raw: unknown): AddressPlaceRef | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row.provider !== "nominatim") return null;
  const osmType = parseNominatimOsmType(row.osmType);
  const osmId = parseNominatimOsmId(row.osmId);
  if (osmType == null || osmId == null) return null;
  return { provider: "nominatim", osmType, osmId };
}

export function boundAddressQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = normalizeGeocodeAddress(raw);
  if (normalized == null) return null;
  if (
    normalized.length < ADDRESS_QUERY_MIN_LEN ||
    normalized.length > ADDRESS_QUERY_MAX_LEN
  ) {
    return null;
  }
  return normalized;
}

export function boundLocalityContext(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  if (raw.trim() === "") return null;
  const normalized = normalizeGeocodeAddress(raw);
  if (normalized == null) return null;
  if (normalized.length > ADDRESS_LOCALITY_MAX_LEN) return null;
  return normalized;
}

export function classifyAddressResultLevel(row: {
  type?: unknown;
  class?: unknown;
  addresstype?: unknown;
}): AddressResultLevel {
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
    return "district";
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
  return "place";
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
 * countryCode must already be exact uppercase ISO2.
 */
export function buildNominatimCandidateSearchUrl(input: {
  query: string;
  countryCode: string;
  localityContext?: string | null;
  limit?: number;
}): string | null {
  const cc = requireExactCountryCode(input.countryCode);
  const qBase = boundAddressQuery(input.query);
  if (cc == null || qBase == null) return null;

  const locality =
    input.localityContext != null
      ? boundLocalityContext(input.localityContext)
      : null;
  if (input.localityContext != null && input.localityContext.trim() !== "" && locality == null) {
    return null;
  }

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
    countrycodes: countryCodeForNominatimParam(cc),
  });
  if (locality == null) {
    params.set("featureType", "settlement");
  }
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

export function buildNominatimLookupUrl(
  refs: AddressPlaceRef[],
): string | null {
  if (refs.length < 1) return null;
  const ids: string[] = [];
  for (const ref of refs) {
    if (ref.provider !== "nominatim") return null;
    if (parseNominatimOsmType(ref.osmType) == null) return null;
    if (parseNominatimOsmId(ref.osmId) == null) return null;
    ids.push(osmLookupId(ref.osmType, ref.osmId));
  }
  const params = new URLSearchParams({
    osm_ids: ids.join(","),
    format: "jsonv2",
    addressdetails: "1",
  });
  return `https://nominatim.openstreetmap.org/lookup?${params.toString()}`;
}

function parseOneNominatimRow(
  row: Record<string, unknown>,
  expectedCountryCode: string | null,
): AddressSearchCandidate | null {
  const osmType = parseNominatimOsmType(row.osm_type);
  const osmId = parseNominatimOsmId(row.osm_id);
  if (osmType == null || osmId == null) return null;

  const lat = parseFiniteCoordinate(row.lat);
  const lon = parseFiniteCoordinate(row.lon);
  if (lat == null || lon == null || !isValidLatLon(lat, lon)) return null;

  const address =
    row.address != null &&
    typeof row.address === "object" &&
    !Array.isArray(row.address)
      ? (row.address as Record<string, unknown>)
      : null;
  const hitCc = parseOptionalCountryCode(address);
  // Fail closed: missing country_code is not filled from expected.
  if (hitCc == null) return null;
  if (expectedCountryCode != null && hitCc !== expectedCountryCode) return null;

  const primaryLabel =
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
  if (!primaryLabel) return null;

  const localityLabel = readAddressPart(address, [
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
  const resultLevel = classifyAddressResultLevel(row);
  const displayName =
    typeof row.display_name === "string" && row.display_name.trim()
      ? row.display_name.trim()
      : [primaryLabel, localityLabel, countryName].filter(Boolean).join(", ");

  return {
    provider: "nominatim",
    osmType,
    osmId,
    displayName,
    primaryLabel,
    localityLabel,
    countryCode: hitCc,
    countryName,
    typeLabel: typeRaw,
    resultLevel,
    latitude: lat,
    longitude: lon,
  };
}

/**
 * Parse Nominatim multi-hit search JSON.
 * Requires address.country_code; does not invent expected country.
 */
export function parseNominatimCandidateResponse(
  data: unknown,
  expectedCountryCode: string,
): AddressSearchCandidate[] {
  const expected = requireExactCountryCode(expectedCountryCode);
  if (expected == null || !Array.isArray(data)) return [];

  const out: AddressSearchCandidate[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    if (out.length >= ADDRESS_SEARCH_LIMIT) break;
    if (item == null || typeof item !== "object" || Array.isArray(item)) continue;
    const parsed = parseOneNominatimRow(
      item as Record<string, unknown>,
      expected,
    );
    if (parsed == null) continue;
    const key = `${parsed.osmType}:${parsed.osmId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  return out;
}

/**
 * Parse Nominatim lookup JSON into one candidate (country optional filter).
 */
export function parseNominatimLookupResponse(
  data: unknown,
  expectedRef: AddressPlaceRef,
  expectedCountryCode?: string | null,
): AddressSearchCandidate | null {
  if (!Array.isArray(data) || data.length < 1) return null;
  const expectedCc =
    expectedCountryCode != null
      ? requireExactCountryCode(expectedCountryCode)
      : null;
  if (expectedCountryCode != null && expectedCc == null) return null;

  for (const item of data) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) continue;
    const parsed = parseOneNominatimRow(
      item as Record<string, unknown>,
      expectedCc,
    );
    if (parsed == null) continue;
    if (
      parsed.osmType === expectedRef.osmType &&
      parsed.osmId === expectedRef.osmId
    ) {
      return parsed;
    }
  }
  return null;
}

export function candidateToConfirmed(
  candidate: AddressSearchCandidate,
  searchCountryCode: string,
): ConfirmedAddressGeo {
  const localityContext =
    candidate.resultLevel === "city"
      ? candidate.primaryLabel
      : candidate.localityLabel ?? candidate.primaryLabel;
  return {
    provider: "nominatim",
    osmType: candidate.osmType,
    osmId: candidate.osmId,
    displayName: candidate.displayName,
    primaryLabel: candidate.primaryLabel,
    localityLabel: candidate.localityLabel,
    countryCode: candidate.countryCode,
    resultLevel: candidate.resultLevel,
    searchCountryCode,
    localityContext,
    previewLatitude: candidate.latitude,
    previewLongitude: candidate.longitude,
  };
}

export function isCityLevelResult(
  level: AddressResultLevel | null | undefined,
): boolean {
  return level === "city";
}

/** @deprecated alias kept for call-site migration during 3J-A.1 */
export const isCityLevelPrecision = isCityLevelResult;
