import "server-only";
import { OSRM_DRIVING_HOST } from "@/lib/route-kms";

export const OSRM_DRIVING_TABLE_URL = `${OSRM_DRIVING_HOST}/table/v1/driving`;

export type OsrmCoord = { lat: number; lon: number };

/**
 * One OSRM Table call → pairwise driving distances in km.
 * `null` cell = unroutable. Whole result `null` = request failed.
 */
export async function fetchOsrmDistanceMatrixKm(
  points: OsrmCoord[],
): Promise<(number | null)[][] | null> {
  if (points.length < 2) return null;
  if (points.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) {
    return null;
  }
  const coordStr = points.map((p) => `${p.lon},${p.lat}`).join(";");
  try {
    const res = await fetch(
      `${OSRM_DRIVING_TABLE_URL}/${coordStr}?annotations=distance`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { distances?: (number | null)[][] };
    const distances = json.distances;
    if (!Array.isArray(distances) || distances.length !== points.length) {
      return null;
    }
    return distances.map((row) => {
      if (!Array.isArray(row) || row.length !== points.length) {
        return points.map(() => null);
      }
      return row.map((meters) => {
        if (meters == null || !Number.isFinite(meters) || meters < 0) return null;
        return meters / 1000;
      });
    });
  } catch {
    return null;
  }
}
