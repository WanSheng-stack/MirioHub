/**
 * Server-side Google Maps share-link → Nominatim reverse → AddressPlaceRef.
 * Do not import from client components.
 */

import {
  buildNominatimReverseUrl,
  parseNominatimReverseResponse,
  type AddressSearchCandidate,
} from "@/lib/geo/addressSearch";
import {
  extractCoordinatesFromGoogleMapsUrl,
  isAllowedGoogleMapsHostname,
  parseHttpsGoogleMapsUrl,
  type MapLinkErrorKey,
} from "@/lib/geo/googleMapsLink";
import {
  throttledNominatimGetJson,
  type NominatimHttpDeps,
} from "@/lib/geo/nominatimClient";
import { NOMINATIM_USER_AGENT } from "@/lib/route-kms";

const MAP_LINK_TIMEOUT_MS = 5000;
const MAP_LINK_MAX_REDIRECTS = 5;
const MAP_LINK_CACHE_TTL_MS = 30 * 60 * 1000;
const MAP_LINK_MAX_CACHE = 128;
const MAP_LINK_UA = `${NOMINATIM_USER_AGENT} MapLinkImport/1.0`;

type RedirectCacheEntry = {
  expiresAt: number;
  finalHref: string;
};

const redirectCache = new Map<string, RedirectCacheEntry>();
const redirectInFlight = new Map<string, Promise<ResolveRedirectResult>>();

type ResolveRedirectResult =
  | { ok: true; finalUrl: URL }
  | { ok: false; errorKey: MapLinkErrorKey };

export type MapLinkImportDeps = NominatimHttpDeps & {
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  timeoutMs?: number;
  skipRedirectCache?: boolean;
};

export type MapLinkImportOk = {
  ok: true;
  candidate: AddressSearchCandidate;
  /** Preview only — authority still uses osm ref lookup. */
  source: "google_maps_share_link";
};

export type MapLinkImportResult =
  | MapLinkImportOk
  | { ok: false; errorKey: MapLinkErrorKey };

function pruneRedirectCache(now: number): void {
  for (const [k, v] of redirectCache) {
    if (v.expiresAt <= now) redirectCache.delete(k);
  }
  while (redirectCache.size > MAP_LINK_MAX_CACHE) {
    const oldest = redirectCache.keys().next().value;
    if (oldest == null) break;
    redirectCache.delete(oldest);
  }
}

/**
 * Follow HTTPS redirects manually, re-validating host on every hop.
 * Response body is never treated as HTML authority.
 */
export async function resolveGoogleMapsShareRedirects(
  startUrl: URL,
  deps: MapLinkImportDeps = {},
): Promise<ResolveRedirectResult> {
  const cacheKey = startUrl.href;
  const nowMs = deps.nowMs ?? Date.now;
  const skipCache = deps.skipRedirectCache === true;

  if (!skipCache) {
    const hit = redirectCache.get(cacheKey);
    if (hit && hit.expiresAt > nowMs()) {
      try {
        return { ok: true, finalUrl: new URL(hit.finalHref) };
      } catch {
        redirectCache.delete(cacheKey);
      }
    }
    const pending = redirectInFlight.get(cacheKey);
    if (pending) return pending;
  }

  const run = async (): Promise<ResolveRedirectResult> => {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const timeoutMs = deps.timeoutMs ?? MAP_LINK_TIMEOUT_MS;
    let current = startUrl;

    for (let hop = 0; hop <= MAP_LINK_MAX_REDIRECTS; hop++) {
      if (current.protocol !== "https:") {
        return { ok: false, errorKey: "error.map_link_redirect_invalid" };
      }
      if (current.username || current.password) {
        return { ok: false, errorKey: "error.map_link_redirect_invalid" };
      }
      if (!isAllowedGoogleMapsHostname(current.hostname)) {
        return { ok: false, errorKey: "error.map_link_redirect_invalid" };
      }

      let res: Response;
      try {
        res = await fetchImpl(current.href, {
          method: "GET",
          redirect: "manual",
          cache: "no-store",
          headers: {
            "User-Agent": MAP_LINK_UA,
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const name =
          err != null && typeof err === "object"
            ? (err as { name?: string }).name
            : undefined;
        if (name === "AbortError" || name === "TimeoutError") {
          return { ok: false, errorKey: "error.map_link_timeout" };
        }
        return { ok: false, errorKey: "error.map_link_invalid" };
      }

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) {
          return { ok: false, errorKey: "error.map_link_redirect_invalid" };
        }
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          return { ok: false, errorKey: "error.map_link_redirect_invalid" };
        }
        current = next;
        continue;
      }

      if (!res.ok) {
        return { ok: false, errorKey: "error.map_link_invalid" };
      }

      // Success — do not parse HTML body; coordinates come from final URL.
      if (!skipCache) {
        pruneRedirectCache(nowMs());
        redirectCache.set(cacheKey, {
          expiresAt: nowMs() + MAP_LINK_CACHE_TTL_MS,
          finalHref: current.href,
        });
        pruneRedirectCache(nowMs());
      }
      return { ok: true, finalUrl: current };
    }

    return { ok: false, errorKey: "error.map_link_redirect_invalid" };
  };

  if (skipCache) return run();

  const tracked = run().finally(() => {
    redirectInFlight.delete(cacheKey);
  });
  redirectInFlight.set(cacheKey, tracked);
  return tracked;
}

/**
 * Import a Google Maps share link into a Nominatim-backed candidate.
 * expectedCountryCode must be exact ISO2 (no trim/uppercase repair).
 */
export async function importPlaceFromGoogleMapsLink(
  rawUrl: unknown,
  expectedCountryCode: string,
  deps: MapLinkImportDeps = {},
): Promise<MapLinkImportResult> {
  const parsed = parseHttpsGoogleMapsUrl(rawUrl);
  if (!parsed.ok) return parsed;

  const redirected = await resolveGoogleMapsShareRedirects(parsed.url, deps);
  if (!redirected.ok) return redirected;

  const coords = extractCoordinatesFromGoogleMapsUrl(redirected.finalUrl);
  if (!coords.ok) return coords;

  const reverseUrl = buildNominatimReverseUrl(coords.coord.lat, coords.coord.lon);
  if (reverseUrl == null) {
    return { ok: false, errorKey: "error.map_link_place_unavailable" };
  }

  const fetched = await throttledNominatimGetJson(reverseUrl, deps);
  if (!fetched.ok) {
    if (fetched.errorKey === "error.geocode_timeout") {
      return { ok: false, errorKey: "error.map_link_timeout" };
    }
    return { ok: false, errorKey: "error.map_link_place_unavailable" };
  }

  const candidate = parseNominatimReverseResponse(
    fetched.data,
    expectedCountryCode,
  );
  if (candidate == null) {
    // Distinguishes missing/wrong country vs parse failure when possible.
    const row =
      fetched.data != null &&
      typeof fetched.data === "object" &&
      !Array.isArray(fetched.data)
        ? (fetched.data as Record<string, unknown>)
        : null;
    const addr =
      row?.address != null &&
      typeof row.address === "object" &&
      !Array.isArray(row.address)
        ? (row.address as Record<string, unknown>)
        : null;
    const ccRaw = addr?.country_code;
    if (
      typeof ccRaw === "string" &&
      ccRaw.trim().toUpperCase() !== expectedCountryCode
    ) {
      return { ok: false, errorKey: "error.map_link_country_mismatch" };
    }
    return { ok: false, errorKey: "error.map_link_place_unavailable" };
  }

  if (candidate.countryCode !== expectedCountryCode) {
    return { ok: false, errorKey: "error.map_link_country_mismatch" };
  }

  return {
    ok: true,
    candidate,
    source: "google_maps_share_link",
  };
}

/** Test helper. */
export function resetMapLinkRedirectCacheForTests(): void {
  redirectCache.clear();
  redirectInFlight.clear();
}
