/** Haversine distance in kilometers between two WGS84 points. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const LBS_RINGS_KM = [5, 20, 50] as const;

export type LbsRing = (typeof LBS_RINGS_KM)[number];

/** Gravity weight: nearer rings rank first; within ring, closer first. */
export function lbsGravityScore(distanceKm: number): number {
  if (distanceKm <= 5) return distanceKm;
  if (distanceKm <= 20) return 1000 + distanceKm;
  if (distanceKm <= 50) return 2000 + distanceKm;
  return 9000 + distanceKm;
}

/** Parse PostGIS/WKT-ish or GeoJSON point-ish values into lat/lng. */
export function parseGpsPoint(value: unknown): { lat: number; lng: number } | null {
  if (!value) return null;
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    if (typeof v.lat === "number" && typeof v.lng === "number") {
      return { lat: v.lat, lng: v.lng };
    }
    if (typeof v.latitude === "number" && typeof v.longitude === "number") {
      return { lat: v.latitude, lng: v.longitude };
    }
    if (Array.isArray(v.coordinates) && v.coordinates.length >= 2) {
      const [lng, lat] = v.coordinates as number[];
      if (typeof lat === "number" && typeof lng === "number") return { lat, lng };
    }
  }
  if (typeof value === "string") {
    const match = value.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (match) {
      const lng = Number(match[1]);
      const lat = Number(match[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
  }
  return null;
}
