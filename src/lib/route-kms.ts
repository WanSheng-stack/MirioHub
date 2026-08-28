import {
  buildDriverOrderedRoute,
  estimateSliceKmsFromRoute,
  normalizeLocationKey,
} from "@/lib/post-route-match";

export type RouteDistanceResult =
  | { ok: true; totalKms: number; sliceKms?: number }
  | { ok: false; errorKey: string };

type GeocodeResult = { lat: number; lon: number } | null;

async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const q = encodeURIComponent(address.trim());
  if (!q) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,
      { headers: { "User-Agent": "MirioHub/1.0" }, next: { revalidate: 86400 } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { lat: string; lon: string }[];
    if (!data?.length) return null;
    return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
  } catch {
    return null;
  }
}

async function osrmRouteKms(points: GeocodeResult[]): Promise<number | null> {
  const valid = points.filter((p): p is { lat: number; lon: number } => p != null);
  if (valid.length < 2) return null;
  const coordStr = valid.map((p) => `${p.lon},${p.lat}`).join(";");
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=false`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { routes?: { distance: number }[] };
    const meters = json.routes?.[0]?.distance;
    if (meters == null) return null;
    return meters / 1000;
  } catch {
    return null;
  }
}

/** Fetch total route kms for ordered location strings via Nominatim + OSRM. */
export async function fetchOrderedRouteKms(locations: string[]): Promise<number | null> {
  const cleaned = locations.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length < 2) return null;
  const coords = await Promise.all(cleaned.map(geocodeAddress));
  return osrmRouteKms(coords);
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
