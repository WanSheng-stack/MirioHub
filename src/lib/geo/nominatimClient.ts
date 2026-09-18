/**
 * Server-side Nominatim HTTP: single-process throttle + in-memory cache.
 * Do not import from client components.
 */

import {
  buildNominatimLookupUrl,
  parseNominatimLookupResponse,
  type AddressPlaceRef,
  type AddressSearchCandidate,
} from "@/lib/geo/addressSearch";
import {
  NOMINATIM_GEOCODE_TIMEOUT_MS,
  NOMINATIM_PUBLIC_MIN_INTERVAL_MS,
  NOMINATIM_USER_AGENT,
} from "@/lib/route-kms";

export type NominatimClientErrorKey =
  | "error.geocode_failed"
  | "error.geocode_timeout"
  | "error.geocode_invalid_response";

type CacheEntry = {
  expiresAt: number;
  payload: unknown;
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const cache = new Map<string, CacheEntry>();
let lastCallAt = 0;
let chain: Promise<void> = Promise.resolve();

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type NominatimHttpDeps = {
  fetchImpl?: typeof fetch;
  delayMs?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  timeoutMs?: number;
  nowMs?: () => number;
  /** Test-only: bypass shared process cache. */
  skipCache?: boolean;
};

/**
 * Serialize Nominatim calls in this process and enforce min interval.
 */
export async function throttledNominatimGetJson(
  url: string,
  deps: NominatimHttpDeps = {},
): Promise<
  | { ok: true; data: unknown; fromCache: boolean }
  | { ok: false; errorKey: NominatimClientErrorKey }
> {
  const nowMs = deps.nowMs ?? Date.now;
  const skipCache = deps.skipCache === true;

  if (!skipCache) {
    const hit = cache.get(url);
    if (hit && hit.expiresAt > nowMs()) {
      return { ok: true, data: hit.payload, fromCache: true };
    }
  }

  const run = async (): Promise<
    | { ok: true; data: unknown; fromCache: boolean }
    | { ok: false; errorKey: NominatimClientErrorKey }
  > => {
    const delay = deps.delayMs ?? defaultDelay;
    const minInterval = deps.minIntervalMs ?? NOMINATIM_PUBLIC_MIN_INTERVAL_MS;
    const elapsed = nowMs() - lastCallAt;
    if (lastCallAt > 0 && elapsed < minInterval) {
      await delay(minInterval - elapsed);
    }

    const fetchImpl = deps.fetchImpl ?? fetch;
    const timeoutMs = deps.timeoutMs ?? NOMINATIM_GEOCODE_TIMEOUT_MS;
    lastCallAt = nowMs();

    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: {
          "User-Agent": NOMINATIM_USER_AGENT,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name =
        err != null && typeof err === "object"
          ? (err as { name?: string }).name
          : undefined;
      if (name === "AbortError" || name === "TimeoutError") {
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

    if (!skipCache) {
      cache.set(url, { expiresAt: nowMs() + CACHE_TTL_MS, payload: data });
    }
    return { ok: true, data, fromCache: false };
  };

  // Queue behind prior calls so min-interval is process-global.
  const queued = chain.then(run, run);
  chain = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

export async function lookupNominatimPlaceRef(
  ref: AddressPlaceRef,
  deps: NominatimHttpDeps & { expectedCountryCode?: string | null } = {},
): Promise<
  | { ok: true; value: AddressSearchCandidate }
  | { ok: false; errorKey: NominatimClientErrorKey }
> {
  const url = buildNominatimLookupUrl([ref]);
  if (url == null) {
    return { ok: false, errorKey: "error.geocode_failed" };
  }
  const res = await throttledNominatimGetJson(url, deps);
  if (!res.ok) return res;
  const parsed = parseNominatimLookupResponse(
    res.data,
    ref,
    deps.expectedCountryCode ?? null,
  );
  if (parsed == null) {
    return { ok: false, errorKey: "error.geocode_failed" };
  }
  return { ok: true, value: parsed };
}

export async function lookupNominatimPlaceRefsSequential(
  refs: AddressPlaceRef[],
  deps: NominatimHttpDeps = {},
): Promise<
  | { ok: true; values: AddressSearchCandidate[] }
  | { ok: false; errorKey: NominatimClientErrorKey }
> {
  const values: AddressSearchCandidate[] = [];
  const memo = new Map<string, AddressSearchCandidate>();
  for (const ref of refs) {
    const key = `${ref.osmType}:${ref.osmId}`;
    const cached = memo.get(key);
    if (cached) {
      values.push(cached);
      continue;
    }
    const hit = await lookupNominatimPlaceRef(ref, deps);
    if (!hit.ok) return hit;
    memo.set(key, hit.value);
    values.push(hit.value);
  }
  return { ok: true, values };
}

/** Test helper — clears process cache / throttle clock. */
export function resetNominatimClientStateForTests(): void {
  cache.clear();
  lastCallAt = 0;
  chain = Promise.resolve();
}
