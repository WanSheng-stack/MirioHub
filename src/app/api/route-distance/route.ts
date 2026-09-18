import { NextResponse } from "next/server";
import {
  computeRouteDistance,
  computeRouteDistanceFromCoords,
  isValidLatLon,
  parseFiniteCoordinate,
  type LatLon,
} from "@/lib/route-kms";

export async function POST(request: Request) {
  let body: {
    locations?: string[];
    sliceOrigin?: string;
    sliceDestination?: string;
    points?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, errorKey: "error.route_distance_failed" });
  }

  const points = parsePoints(body.points);
  if (points != null && points.length >= 2) {
    const labels =
      Array.isArray(body.locations) && body.locations.length === points.length
        ? body.locations.map((l) => String(l))
        : points.map((_, i) => `p${i}`);
    const result = await computeRouteDistanceFromCoords(
      points,
      labels,
      body.sliceOrigin,
      body.sliceDestination,
    );
    if (!result.ok) {
      return NextResponse.json({ ok: false, errorKey: result.errorKey });
    }
    return NextResponse.json({
      ok: true,
      totalKms: result.totalKms,
      sliceKms: result.sliceKms,
    });
  }

  const locations = body.locations ?? [];
  const result = await computeRouteDistance(
    locations,
    body.sliceOrigin,
    body.sliceDestination,
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, errorKey: result.errorKey });
  }

  return NextResponse.json({
    ok: true,
    totalKms: result.totalKms,
    sliceKms: result.sliceKms,
  });
}

function parsePoints(raw: unknown): LatLon[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out: LatLon[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const lat = parseFiniteCoordinate(row.lat);
    const lon = parseFiniteCoordinate(row.lon);
    if (lat == null || lon == null || !isValidLatLon(lat, lon)) return null;
    out.push({ lat, lon });
  }
  return out;
}
