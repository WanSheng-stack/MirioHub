/**
 * Route distance + Nominatim search helpers.
 * Client-safe module: no offline timezone package imports and no Next server
 * boundary marker. Trusted country+timezone binding is a separate server module.
 */

import {
  buildDriverOrderedRoute,
  estimateSliceKmsFromRoute,
  normalizeLocationKey,
} from "@/lib/post-route-match";

export type RouteDistanceResult =
  | { ok: true; totalKms: number; sliceKms?: number }
  | { ok: false; errorKey: string };

export type LatLon = { lat: number; lon: number };

type GeocodeResult = LatLon | null;

export const NOMINATIM_SEARCH_URL =
  "https://nominatim.openstreetmap.org/search";
export const NOMINATIM_USER_AGENT = "MirioHub/1.0";
export const NOMINATIM_GEOCODE_TIMEOUT_MS = 8000;
export const NOMINATIM_REVALIDATE_SECONDS = 86400;

/** Shared public OSRM host for Route + Table. Do not add a second base URL. */
export const OSRM_DRIVING_HOST = "https://router.project-osrm.org";

export type NominatimHitErrorKey =
  | "error.geocode_failed"
  | "error.geocode_timeout"
  | "error.geocode_invalid_response"
  | "error.geocode_country_unavailable";

export type NominatimHitOk = {
  lat: number;
  lon: number;
  countryCode: string;
};

export type NominatimHitResult =
  | { ok: true; value: NominatimHitOk }
  | { ok: false; errorKey: NominatimHitErrorKey };

export type NominatimFetchDeps = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** NFC + trim; empty → null. */
export function normalizeGeocodeAddress(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.normalize("NFC").trim();
  return normalized === "" ? null : normalized;
}

function isAbortError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Parse Nominatim search JSON (jsonv2 + addressdetails) into one hit.
 * Pure: no network. Does not return raw Nominatim payloads to callers beyond
 * lat/lon/countryCode.
 */
export function parseNominatimSearchResponse(data: unknown): NominatimHitResult {
  if (!Array.isArray(data)) {
    return { ok: false, errorKey: "error.geocode_invalid_response" };
  }
  if (data.length < 1) {
    return { ok: false, errorKey: "error.geocode_failed" };
  }
  const first = data[0];
  if (first == null || typeof first !== "object" || Array.isArray(first)) {
    return { ok: false, errorKey: "error.geocode_invalid_response" };
  }
  const row = first as Record<string, unknown>;
  const latRaw = row.lat;
  const lonRaw = row.lon;
  const lat =
    typeof latRaw === "number"
      ? latRaw
      : typeof latRaw === "string"
        ? Number(latRaw)
        : NaN;
  const lon =
    typeof lonRaw === "number"
      ? lonRaw
      : typeof lonRaw === "string"
        ? Number(lonRaw)
        : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, errorKey: "error.geocode_invalid_response" };
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, errorKey: "error.geocode_invalid_response" };
  }

  const address = row.address;
  if (address == null || typeof address !== "object" || Array.isArray(address)) {
    return { ok: false, errorKey: "error.geocode_country_unavailable" };
  }
  const ccRaw = (address as Record<string, unknown>).country_code;
  if (typeof ccRaw !== "string") {
    return { ok: false, errorKey: "error.geocode_country_unavailable" };
  }
  const countryCode = ccRaw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return { ok: false, errorKey: "error.geocode_country_unavailable" };
  }

  return { ok: true, value: { lat, lon, countryCode } };
}

export function buildNominatimSearchUrl(normalizedAddress: string): string {
  const params = new URLSearchParams({
    q: normalizedAddress,
    format: "jsonv2",
    limit: "1",
    addressdetails: "1",
  });
  return `${NOMINATIM_SEARCH_URL}?${params.toString()}`;
}

/**
 * One Nominatim search hit: coords + country_code from the same candidate.
 * Injectable fetch for offline tests.
 */
export async function fetchNominatimSearchHit(
  address: string,
  deps: NominatimFetchDeps = {},
): Promise<NominatimHitResult> {
  const normalized = normalizeGeocodeAddress(address);
  if (normalized == null) {
    return { ok: false, errorKey: "error.geocode_failed" };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? NOMINATIM_GEOCODE_TIMEOUT_MS;
  const url = buildNominatimSearchUrl(normalized);

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
      next: { revalidate: NOMINATIM_REVALIDATE_SECONDS },
    } as RequestInit);
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, errorKey: "error.geocode_timeout" };
    }
    return { ok: false, errorKey: "error.geocode_failed" };
  }

  if (!res.ok) {
    return { ok: false, errorKey: "error.geocode_failed" };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, errorKey: "error.geocode_invalid_response" };
  }

  return parseNominatimSearchResponse(data);
}

/**
 * Compatibility wrapper: lat/lon or null. Delegates to unified Nominatim hit
 * parser; drops country (callers that need country use the trusted origin module).
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const hit = await fetchNominatimSearchHit(address);
  if (!hit.ok) return null;
  return { lat: hit.value.lat, lon: hit.value.lon };
}

/** PostGIS geography WKT for insert via Supabase. */
export function toGeographyPointWkt(lat: number, lon: number): string {
  return `SRID=4326;POINT(${lon} ${lat})`;
}

export type OsrmFetchDeps = {
  fetchImpl?: typeof fetch;
};

/**
 * OSRM driving distance from already-resolved coordinates (no Nominatim).
 */
export async function osrmRouteKmsFromCoords(
  points: LatLon[],
  deps: OsrmFetchDeps = {},
): Promise<number | null> {
  if (points.length < 2) return null;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  }
  const coordStr = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(
      `${OSRM_DRIVING_HOST}/route/v1/driving/${coordStr}?overview=false`,
      { next: { revalidate: 3600 } } as RequestInit,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { routes?: { distance: number }[] };
    const meters = json.routes?.[0]?.distance;
    if (meters == null || !Number.isFinite(meters)) return null;
    return meters / 1000;
  } catch {
    return null;
  }
}

// ── Trusted origin assembly (pure; timezone lookup injected by server wrapper) ─

export type TrustedGeocodePoint = {
  lat: number;
  lon: number;
  wkt: string;
  countryCode: string;
  timezone: string;
};

export type TrustedOriginErrorKey =
  | "error.geocode_failed"
  | "error.geocode_timeout"
  | "error.geocode_invalid_response"
  | "error.geocode_country_unavailable"
  | "error.geocode_timezone_unavailable";

export type TrustedOriginResolution =
  | { ok: true; value: TrustedGeocodePoint }
  | { ok: false; errorKey: TrustedOriginErrorKey };

export type TimezoneLookup = (lat: number, lon: number) => string[];

/** Validate IANA name via Intl; fail closed on RangeError / empty. */
export function assertValidIanaTimezone(timezone: string): boolean {
  const tz = timezone.trim();
  if (tz === "") return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Offline timezone lookup on already-validated coordinates.
 * Empty / multi distinct / invalid IANA → unavailable.
 */
export function resolveTimezoneFromCoords(
  lat: number,
  lon: number,
  findTimezones: TimezoneLookup,
): { ok: true; timezone: string } | { ok: false } {
  let raw: string[];
  try {
    raw = findTimezones(lat, lon);
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false };
  const unique = [...new Set(raw.map((z) => String(z).trim()).filter(Boolean))];
  if (unique.length === 0) return { ok: false };
  if (unique.length > 1) return { ok: false };
  const timezone = unique[0]!;
  if (!assertValidIanaTimezone(timezone)) return { ok: false };
  return { ok: true, timezone };
}

/**
 * Build trusted point from an already-parsed Nominatim hit (no second geocode).
 */
export function assembleTrustedGeocodePoint(
  hit: NominatimHitOk,
  findTimezones: TimezoneLookup,
): TrustedOriginResolution {
  const tz = resolveTimezoneFromCoords(hit.lat, hit.lon, findTimezones);
  if (!tz.ok) {
    return { ok: false, errorKey: "error.geocode_timezone_unavailable" };
  }
  return {
    ok: true,
    value: {
      lat: hit.lat,
      lon: hit.lon,
      wkt: toGeographyPointWkt(hit.lat, hit.lon),
      countryCode: hit.countryCode,
      timezone: tz.timezone,
    },
  };
}

export type ResolveTrustedOriginCoreDeps = NominatimFetchDeps & {
  findTimezones: TimezoneLookup;
};

/**
 * Pure orchestration with injected timezone lookup (tests / server wrapper).
 */
export async function resolveTrustedOriginWithLookup(
  address: string,
  deps: ResolveTrustedOriginCoreDeps,
): Promise<TrustedOriginResolution> {
  const hit = await fetchNominatimSearchHit(address, deps);
  if (!hit.ok) {
    return { ok: false, errorKey: hit.errorKey };
  }
  return assembleTrustedGeocodePoint(hit.value, deps.findTimezones);
}

/** Fetch total route kms for ordered location strings via Nominatim + OSRM. */
export async function fetchOrderedRouteKms(
  locations: string[],
): Promise<number | null> {
  const cleaned = locations.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length < 2) return null;
  const hits = await Promise.all(cleaned.map((a) => fetchNominatimSearchHit(a)));
  if (hits.some((h) => !h.ok)) return null;
  const coords = hits.map((h) => ({
    lat: (h as { ok: true; value: NominatimHitOk }).value.lat,
    lon: (h as { ok: true; value: NominatimHitOk }).value.lon,
  }));
  return osrmRouteKmsFromCoords(coords);
}

/**
 * Same as fetchOrderedRouteKms but accepts pre-resolved coords so callers can
 * reuse one Nominatim hit for OSRM + WKT + country + timezone.
 */
export async function fetchOrderedRouteKmsFromCoords(
  coords: LatLon[],
  deps: OsrmFetchDeps = {},
): Promise<number | null> {
  if (coords.length < 2) return null;
  return osrmRouteKmsFromCoords(coords, deps);
}

/** Client-side: call internal API to resolve route distance. */
export async function fetchRouteDistanceClient(
  locations: string[],
  sliceOrigin?: string,
  sliceDestination?: string,
): Promise<RouteDistanceResult> {
  const res = await fetch("/api/route-distance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locations, sliceOrigin, sliceDestination }),
  });
  const json = (await res.json()) as {
    ok: boolean;
    totalKms?: number;
    sliceKms?: number;
    errorKey?: string;
  };
  if (!json.ok || json.totalKms == null) {
    return { ok: false, errorKey: json.errorKey ?? "error.route_distance_failed" };
  }
  return { ok: true, totalKms: json.totalKms, sliceKms: json.sliceKms };
}

/** Server-side direct computation (same logic as API route). */
export async function computeRouteDistance(
  locations: string[],
  sliceOrigin?: string,
  sliceDestination?: string,
): Promise<RouteDistanceResult> {
  const cleaned = locations.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length < 2) {
    return { ok: false, errorKey: "error.address_required" };
  }
  const totalKms = await fetchOrderedRouteKms(cleaned);
  if (totalKms == null) {
    return { ok: false, errorKey: "error.route_distance_failed" };
  }
  let sliceKms: number | undefined;
  if (sliceOrigin && sliceDestination) {
    sliceKms = estimateSliceKmsFromRoute(totalKms, cleaned, sliceOrigin, sliceDestination);
  }
  return { ok: true, totalKms, sliceKms };
}

/**
 * Server helper: distance from already-geocoded points (no second Nominatim).
 */
export async function computeRouteDistanceFromCoords(
  coords: LatLon[],
  locationLabelsForSlice: string[],
  sliceOrigin?: string,
  sliceDestination?: string,
  deps: OsrmFetchDeps = {},
): Promise<RouteDistanceResult> {
  if (coords.length < 2) {
    return { ok: false, errorKey: "error.address_required" };
  }
  const totalKms = await fetchOrderedRouteKmsFromCoords(coords, deps);
  if (totalKms == null) {
    return { ok: false, errorKey: "error.route_distance_failed" };
  }
  let sliceKms: number | undefined;
  if (sliceOrigin && sliceDestination) {
    sliceKms = estimateSliceKmsFromRoute(
      totalKms,
      locationLabelsForSlice,
      sliceOrigin,
      sliceDestination,
    );
  }
  return { ok: true, totalKms, sliceKms };
}

export function buildDemandRouteLocations(
  origin: string,
  destination: string,
  waypoints: string[] = [],
): string[] {
  return buildDriverOrderedRoute(origin, waypoints, destination);
}

export function locationsFingerprint(locations: string[]): string {
  return locations.map(normalizeLocationKey).join("|");
}
