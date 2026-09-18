/**
 * Server-side Nominatim HTTP: single-process throttle + in-memory cache.
 * Do not import from client components.
 *
 * Cache / in-flight / throttle are process-local — not a multi-instance global.
 */

import {
  buildNominatimLookupUrl,
  parseNominatimLookupBatchResponse,
  placeRefKey,
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

type ThrottledResult =
  | { ok: true; data: unknown; fromCache: boolean }
  | { ok: false; errorKey: NominatimClientErrorKey };

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const MAX_CACHE_ENTRIES = 256;
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ThrottledResult>>();
let lastCallAt = 0;
let chain: Promise<void> = Promise.resolve();

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
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
 * Identical URLs share one in-flight Promise; failures are not cached.
 */
export async function throttledNominatimGetJson(
  url: string,
  deps: NominatimHttpDeps = {},
): Promise<ThrottledResult> {
  const nowMs = deps.nowMs ?? Date.now;
  const skipCache = deps.skipCache === true;

  if (!skipCache) {
    const hit = cache.get(url);
    if (hit && hit.expiresAt > nowMs()) {
      return { ok: true, data: hit.payload, fromCache: true };
    }
    const pending = inFlight.get(url);
    if (pending) return pending;
  }

  const run = async (): Promise<ThrottledResult> => {
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
      pruneCache(nowMs());
      cache.set(url, { expiresAt: nowMs() + CACHE_TTL_MS, payload: data });
      pruneCache(nowMs());
    }
    return { ok: true, data, fromCache: false };
  };

  const queued = chain.then(run, run);
  chain = queued.then(
    () => undefined,
    () => undefined,
  );

  if (skipCache) {
    return queued;
  }

  const tracked = queued.finally(() => {
    inFlight.delete(url);
  });
  inFlight.set(url, tracked);
  return tracked;
}

/**
 * True batch Nominatim /lookup: dedupe refs → one HTTP → restore input order.
 */
export async function lookupNominatimPlaceRefsBatch(
  refs: AddressPlaceRef[],
  deps: NominatimHttpDeps = {},
): Promise<
  | { ok: true; values: AddressSearchCandidate[] }
  | { ok: false; errorKey: NominatimClientErrorKey }
> {
  if (refs.length < 1) {
    return { ok: false, errorKey: "error.geocode_failed" };
  }

  const unique: AddressPlaceRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = placeRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }

  const url = buildNominatimLookupUrl(unique);
  if (url == null) {
    return { ok: false, errorKey: "error.geocode_failed" };
  }

  const res = await throttledNominatimGetJson(url, deps);
  if (!res.ok) return res;

  const parsedUnique = parseNominatimLookupBatchResponse(res.data, unique);
  if (parsedUnique == null) {
    return { ok: false, errorKey: "error.geocode_failed" };
  }

  const byKey = new Map<string, AddressSearchCandidate>();
  for (let i = 0; i < unique.length; i++) {
    byKey.set(placeRefKey(unique[i]), parsedUnique[i]);
  }

  const values: AddressSearchCandidate[] = [];
  for (const ref of refs) {
    const hit = byKey.get(placeRefKey(ref));
    if (hit == null) {
      return { ok: false, errorKey: "error.geocode_failed" };
    }
    values.push(hit);
  }
  return { ok: true, values };
}

/** Single-ref convenience over the batch path (one HTTP for one unique ref). */
export async function lookupNominatimPlaceRef(
  ref: AddressPlaceRef,
  deps: NominatimHttpDeps = {},
): Promise<
  | { ok: true; value: AddressSearchCandidate }
  | { ok: false; errorKey: NominatimClientErrorKey }
> {
  const batch = await lookupNominatimPlaceRefsBatch([ref], deps);
  if (!batch.ok) return batch;
  const value = batch.values[0];
  if (value == null) {
    return { ok: false, errorKey: "error.geocode_failed" };
  }
  return { ok: true, value };
}

/**
 * @deprecated Prefer lookupNominatimPlaceRefsBatch — kept as alias so old helpers
 * stay available; production publish/route-distance must use batch.
 */
export async function lookupNominatimPlaceRefsSequential(
  refs: AddressPlaceRef[],
  deps: NominatimHttpDeps = {},
): Promise<
  | { ok: true; values: AddressSearchCandidate[] }
  | { ok: false; errorKey: NominatimClientErrorKey }
> {
  return lookupNominatimPlaceRefsBatch(refs, deps);
}

/** Test helper — clears process cache / in-flight / throttle clock. */
export function resetNominatimClientStateForTests(): void {
  cache.clear();
  inFlight.clear();
  lastCallAt = 0;
  chain = Promise.resolve();
}
