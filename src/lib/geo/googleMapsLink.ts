/**
 * Google Maps share-link parsing (pure). No network.
 * Short-link redirects and Nominatim reverse live in server modules.
 */

export type MapLinkErrorKey =
  | "error.map_link_invalid"
  | "error.map_link_host_not_allowed"
  | "error.map_link_redirect_invalid"
  | "error.map_link_timeout"
  | "error.map_link_coordinates_unavailable"
  | "error.map_link_coordinates_ambiguous"
  | "error.map_link_country_mismatch"
  | "error.map_link_place_unavailable";

export type LatLon = { lat: number; lon: number };

const GOOGLE_MAPS_HOST_EXACT = new Set([
  "www.google.com",
  "google.com",
  "maps.google.com",
  "maps.app.goo.gl",
  "goo.gl",
]);

/** Country TLDs that host Google Maps under /maps (www.google.xx / google.xx). */
const GOOGLE_COUNTRY_TLDS = new Set([
  "com",
  "co.uk",
  "com.au",
  "co.jp",
  "co.in",
  "com.br",
  "com.mx",
  "com.ar",
  "com.tr",
  "de",
  "fr",
  "it",
  "es",
  "nl",
  "pl",
  "cz",
  "at",
  "ch",
  "be",
  "pt",
  "ie",
  "se",
  "no",
  "dk",
  "fi",
  "hu",
  "ro",
  "bg",
  "hr",
  "rs",
  "si",
  "sk",
  "gr",
  "ru",
  "ua",
  "ca",
  "com.sg",
  "com.hk",
  "com.tw",
  "co.kr",
  "co.th",
  "com.vn",
  "co.id",
  "com.ph",
  "com.my",
  "co.za",
  "com.eg",
  "co.il",
  "ae",
  "com.sa",
  "cl",
  "com.co",
  "com.pe",
  "com.uy",
  "com.ec",
  "com.ve",
  "com.pk",
  "lk",
  "com.bd",
  "com.ng",
  "com.gh",
  "com.ke",
]);

function isPrivateOrLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const parts = h.split(".").map(Number);
    if (parts.some((n) => n > 255)) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  // IPv6 / bracket forms — reject all IP literals for this allowlist phase
  if (h.includes(":")) return true;
  return false;
}

/**
 * True when hostname is an allowed Google Maps share host.
 */
export function isAllowedGoogleMapsHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (isPrivateOrLocalHostname(h)) return false;
  if (GOOGLE_MAPS_HOST_EXACT.has(h)) return true;
  // www.google.<tld> or google.<tld>
  const m = /^(?:www\.)?google\.([a-z.]+)$/.exec(h);
  if (m && GOOGLE_COUNTRY_TLDS.has(m[1]!)) return true;
  return false;
}

export function parseHttpsGoogleMapsUrl(
  raw: unknown,
):
  | { ok: true; url: URL }
  | { ok: false; errorKey: MapLinkErrorKey } {
  if (typeof raw !== "string") {
    return { ok: false, errorKey: "error.map_link_invalid" };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, errorKey: "error.map_link_invalid" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, errorKey: "error.map_link_invalid" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, errorKey: "error.map_link_invalid" };
  }
  if (url.username || url.password) {
    return { ok: false, errorKey: "error.map_link_invalid" };
  }
  if (!isAllowedGoogleMapsHostname(url.hostname)) {
    return { ok: false, errorKey: "error.map_link_host_not_allowed" };
  }
  // goo.gl shortener: only /maps/... paths (compat)
  if (url.hostname.toLowerCase() === "goo.gl") {
    if (!url.pathname.toLowerCase().startsWith("/maps")) {
      return { ok: false, errorKey: "error.map_link_host_not_allowed" };
    }
  }
  return { ok: true, url };
}

function pushCoord(
  out: LatLon[],
  latRaw: string,
  lonRaw: string,
): void {
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
  out.push({ lat, lon });
}

/**
 * Extract candidate coordinates from a final Google Maps URL.
 * Ambiguous / conflicting sets fail closed at resolve time.
 */
export function extractCoordinatesFromGoogleMapsUrl(
  url: URL,
):
  | { ok: true; coord: LatLon }
  | { ok: false; errorKey: MapLinkErrorKey } {
  const found: LatLon[] = [];
  const href = url.href;
  const pathAndQuery = `${url.pathname}${url.search}${url.hash}`;

  // /@lat,lon,zoom
  for (const m of pathAndQuery.matchAll(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
    pushCoord(found, m[1]!, m[2]!);
  }
  // !3dLAT!4dLON
  for (const m of pathAndQuery.matchAll(
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g,
  )) {
    pushCoord(found, m[1]!, m[2]!);
  }
  // query=lat,lon or q=lat,lon
  for (const key of ["query", "q"] as const) {
    const v = url.searchParams.get(key);
    if (v == null) continue;
    const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(v.trim());
    if (m) pushCoord(found, m[1]!, m[2]!);
  }
  // Also scan full href for q=/query= embedded in path fragments
  for (const m of href.matchAll(
    /(?:[?&#](?:q|query)=)(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/gi,
  )) {
    pushCoord(found, m[1]!, m[2]!);
  }

  if (found.length === 0) {
    return { ok: false, errorKey: "error.map_link_coordinates_unavailable" };
  }

  const first = found[0]!;
  for (const c of found) {
    if (
      Math.abs(c.lat - first.lat) > 1e-5 ||
      Math.abs(c.lon - first.lon) > 1e-5
    ) {
      return { ok: false, errorKey: "error.map_link_coordinates_ambiguous" };
    }
  }
  return { ok: true, coord: first };
}

export function coordsNearlyEqual(a: LatLon, b: LatLon, eps = 1e-5): boolean {
  return Math.abs(a.lat - b.lat) <= eps && Math.abs(a.lon - b.lon) <= eps;
}
