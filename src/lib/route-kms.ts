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
/** Minimum gap between public Nominatim HTTP calls within one batch. */
export const NOMINATIM_PUBLIC_MIN_INTERVAL_MS = 1000;

/** Shared public OSRM host for Route + Table. Do not add a second base URL. */
export const OSRM_DRIVING_HOST = "https://router.project-osrm.org";
export const OSRM_ROUTE_TIMEOUT_MS = 8000;

export type NominatimHitErrorKey =
  | "error.geocode_failed"
  | "error.geocode_timeout"
  | "error.geocode_invalid_response";

/**
 * Coordinate-level hit from one Nominatim candidate.
 * countryCode may be null — still usable for geocodeAddress / OSRM.
 */
export type NominatimCoordinateHit = {
  lat: number;
  lon: number;
  countryCode: string | null;
};

/**
 * @deprecated Prefer NominatimCoordinateHit. Kept as alias for callers that
 * previously required countryCode; use requireTrustedCountry / assemble for authority.
 */
export type NominatimHitOk = NominatimCoordinateHit;

export type NominatimCoordinateResult =
  | { ok: true; value: NominatimCoordinateHit }
  | { ok: false; errorKey: NominatimHitErrorKey };

/** @deprecated Alias of NominatimCoordinateResult */
export type NominatimHitResult = NominatimCoordinateResult;

export type NominatimFetchDeps = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Injected sleep between sequential public Nominatim calls (default 1000ms). */
  delayMs?: (ms: number) => Promise<void>;
  /** Override min interval (tests may set 0). */
  minIntervalMs?: number;
};

/** NFC + trim; empty → null. */
export function normalizeGeocodeAddress(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.normalize("NFC").trim();
  return normalized === "" ? null : normalized;
}

/**
 * Single coordinate parser for all lat/lon entry points.
 * Accepts number or non-blank numeric string; rejects blank, NaN, Infinity, OOB.
 */
export function parseFiniteCoordinate(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    return n;
  }
  return null;
}

export function isValidLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function isAbortError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse optional ISO alpha-2 country from Nominatim address object.
 * Returns null when missing/invalid — does not fail the coordinate hit.
 */
export function parseOptionalCountryCode(address: unknown): string | null {
  if (address == null || typeof address !== "object" || Array.isArray(address)) {
    return null;
  }
  const ccRaw = (address as Record<string, unknown>).country_code;
  if (typeof ccRaw !== "string") return null;
  const countryCode = ccRaw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) return null;
  return countryCode;
}

/**
 * Parse Nominatim search JSON into a coordinate hit (country optional).
 * Pure: no network. Does not return raw Nominatim payloads.
 */
export function parseNominatimSearchResponse(
  data: unknown,
): NominatimCoordinateResult {
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
  const lat = parseFiniteCoordinate(row.lat);
  const lon = parseFiniteCoordinate(row.lon);
  if (lat == null || lon == null || !isValidLatLon(lat, lon)) {
    return { ok: false, errorKey: "error.geocode_invalid_response" };
  }

  return {
    ok: true,
    value: {
      lat,
      lon,
      countryCode: parseOptionalCountryCode(row.address),
    },
  };
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
 * One Nominatim search coordinate hit (country may be null).
 * Injectable fetch for offline tests.
 */
export async function fetchNominatimSearchHit(
  address: string,
  deps: NominatimFetchDeps = {},
): Promise<NominatimCoordinateResult> {
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
 * Compatibility wrapper: lat/lon or null.
 * Succeeds when coordinates are valid even if country_code is missing.
 */
export async function geocodeAddress(
  address: string,
  deps: NominatimFetchDeps = {},
): Promise<GeocodeResult> {
  const hit = await fetchNominatimSearchHit(address, deps);
  if (!hit.ok) return null;
  return { lat: hit.value.lat, lon: hit.value.lon };
}

/** PostGIS geography WKT for insert via Supabase. */
export function toGeographyPointWkt(lat: number, lon: number): string {
  return `SRID=4326;POINT(${lon} ${lat})`;
}

export type OsrmFetchDeps = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
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
    if (!isValidLatLon(p.lat, p.lon)) return null;
  }
  const coordStr = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? OSRM_ROUTE_TIMEOUT_MS;
  try {
    const res = await fetchImpl(
      `${OSRM_DRIVING_HOST}/route/v1/driving/${coordStr}?overview=false`,
      {
        signal: AbortSignal.timeout(timeoutMs),
        next: { revalidate: 3600 },
      } as RequestInit,
    );
    if (!res.ok) return null;
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return null;
    }
    if (json == null || typeof json !== "object" || Array.isArray(json)) {
      return null;
    }
    const routes = (json as { routes?: unknown }).routes;
    if (!Array.isArray(routes) || routes.length < 1) return null;
    const first = routes[0];
    if (first == null || typeof first !== "object" || Array.isArray(first)) {
      return null;
    }
    const distance = (first as { distance?: unknown }).distance;
    if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) {
      return null;
    }
    return distance / 1000;
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
  if (!isValidLatLon(lat, lon)) return { ok: false };
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
 * Require a legal ISO country on a coordinate hit for trusted authority.
 */
export function requireTrustedCountryCode(
  hit: NominatimCoordinateHit,
):
  | { ok: true; countryCode: string }
  | { ok: false; errorKey: "error.geocode_country_unavailable" } {
  if (hit.countryCode == null || !/^[A-Z]{2}$/.test(hit.countryCode)) {
    return { ok: false, errorKey: "error.geocode_country_unavailable" };
  }
  return { ok: true, countryCode: hit.countryCode };
}

/**
 * Build trusted point from an already-parsed Nominatim coordinate hit
 * (no second geocode). Requires country + unique IANA timezone.
 */
export function assembleTrustedGeocodePoint(
  hit: NominatimCoordinateHit,
  findTimezones: TimezoneLookup,
): TrustedOriginResolution {
  if (!isValidLatLon(hit.lat, hit.lon)) {
    return { ok: false, errorKey: "error.geocode_invalid_response" };
  }
  const country = requireTrustedCountryCode(hit);
  if (!country.ok) {
    return { ok: false, errorKey: country.errorKey };
  }
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
      countryCode: country.countryCode,
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

/**
 * Resolve many addresses sequentially for public Nominatim:
 * - original order preserved
 * - normalized duplicates share one HTTP call
 * - injectable delay between distinct HTTP calls (≥1000ms by default)
 */
export async function fetchNominatimCoordinateHitsSequential(
  locations: string[],
  deps: NominatimFetchDeps = {},
): Promise<
  | { ok: true; hits: NominatimCoordinateHit[] }
  | { ok: false; errorKey: NominatimHitErrorKey }
> {
  const delay = deps.delayMs ?? defaultDelay;
  const minInterval = deps.minIntervalMs ?? NOMINATIM_PUBLIC_MIN_INTERVAL_MS;
  const cache = new Map<string, NominatimCoordinateHit>();
  const hits: NominatimCoordinateHit[] = [];
  let httpCalls = 0;

  for (const raw of locations) {
    const normalized = normalizeGeocodeAddress(raw);
    if (normalized == null) {
      return { ok: false, errorKey: "error.geocode_failed" };
    }
    const cached = cache.get(normalized);
    if (cached) {
      hits.push(cached);
      continue;
    }
    if (httpCalls > 0 && minInterval > 0) {
      await delay(minInterval);
    }
    const result = await fetchNominatimSearchHit(normalized, deps);
    httpCalls += 1;
    if (!result.ok) {
      return { ok: false, errorKey: result.errorKey };
    }
    cache.set(normalized, result.value);
    hits.push(result.value);
  }

  return { ok: true, hits };
}

/** Fetch total route kms for ordered location strings via Nominatim + OSRM. */
export async function fetchOrderedRouteKms(
  locations: string[],
  deps: NominatimFetchDeps & OsrmFetchDeps = {},
): Promise<number | null> {
  const cleaned = locations.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length < 2) return null;
  const batch = await fetchNominatimCoordinateHitsSequential(cleaned, deps);
  if (!batch.ok) return null;
  const coords = batch.hits.map((h) => ({ lat: h.lat, lon: h.lon }));
  return osrmRouteKmsFromCoords(coords, deps);
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

/** Client-side: resolve route distance via server place-ref lookup (no client coords). */
export async function fetchRouteDistanceClient(
  locations: string[],
  sliceOrigin?: string,
  sliceDestination?: string,
  places?: Array<{
    provider: "nominatim";
    osmType: "node" | "way" | "relation";
    osmId: string;
  }>,
): Promise<RouteDistanceResult> {
  const res = await fetch("/api/route-distance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations,
      sliceOrigin,
      sliceDestination,
      places,
    }),
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
  deps: NominatimFetchDeps & OsrmFetchDeps = {},
): Promise<RouteDistanceResult> {
  const cleaned = locations.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length < 2) {
    return { ok: false, errorKey: "error.address_required" };
  }
  const totalKms = await fetchOrderedRouteKms(cleaned, deps);
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

export type Stage1RouteWithOriginHitDeps = NominatimFetchDeps &
  OsrmFetchDeps & {
    fetchHits?: typeof fetchNominatimCoordinateHitsSequential;
    computeFromCoords?: typeof computeRouteDistanceFromCoords;
  };

export type Stage1RouteWithOriginHitResult =
  | {
      ok: true;
      serverKms: number;
      originNominatimHit: NominatimCoordinateHit;
    }
  | { ok: false; errorKey: string };

/**
 * One Nominatim pass for Stage-1: ordered route hits + OSRM kms, returning the
 * origin hit for trusted authority reuse (no second geocode).
 * onsite/errand with fewer than two locations → serverKms=0, origin resolved once.
 *
 * Free-text path (legacy / missing place refs). Prefer OSM place-ref resolution
 * in server builders when confirmed refs are available.
 */
export async function resolveStage1RouteWithOriginHit(
  args: {
    category: string;
    originAddress: string;
    destinationAddress: string;
    waypoints: string[];
  },
  deps: Stage1RouteWithOriginHitDeps = {},
): Promise<Stage1RouteWithOriginHitResult> {
  const locations = buildDemandRouteLocations(
    args.originAddress,
    args.destinationAddress,
    args.waypoints,
  );
  const fetchHits = deps.fetchHits ?? fetchNominatimCoordinateHitsSequential;
  const computeFromCoords =
    deps.computeFromCoords ?? computeRouteDistanceFromCoords;

  if (locations.length < 2) {
    if (args.category !== "onsite" && args.category !== "errand") {
      return { ok: false, errorKey: "error.address_required" };
    }
    const batch = await fetchHits([args.originAddress], deps);
    if (!batch.ok) {
      return { ok: false, errorKey: batch.errorKey };
    }
    const hit = batch.hits[0];
    if (hit == null) {
      return { ok: false, errorKey: "error.geocode_failed" };
    }
    return { ok: true, serverKms: 0, originNominatimHit: hit };
  }

  const batch = await fetchHits(locations, deps);
  if (!batch.ok) {
    return { ok: false, errorKey: batch.errorKey };
  }
  if (batch.hits.length !== locations.length) {
    return { ok: false, errorKey: "error.geocode_invalid_response" };
  }
  const hit = batch.hits[0];
  if (hit == null) {
    return { ok: false, errorKey: "error.geocode_failed" };
  }
  const coords = batch.hits.map((h) => ({ lat: h.lat, lon: h.lon }));
  const dist = await computeFromCoords(
    coords,
    locations,
    undefined,
    undefined,
    deps,
  );
  if (!dist.ok) {
    return { ok: false, errorKey: dist.errorKey };
  }
  return {
    ok: true,
    serverKms: dist.totalKms,
    originNominatimHit: hit,
  };
}
