import { NextResponse } from "next/server";
import {
  parseAddressPlaceRef,
  type AddressPlaceRef,
} from "@/lib/geo/addressSearch";
import { lookupNominatimPlaceRefsSequential } from "@/lib/geo/nominatimClient";
import { computeRouteDistanceFromCoords } from "@/lib/route-kms";

/**
 * Distance from trusted place refs (server re-lookup).
 * Does NOT accept client-supplied lat/lon points.
 */
export async function POST(request: Request) {
  let body: {
    places?: unknown;
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

  // Reject legacy client coordinate injection.
  if (body.points != null) {
    return NextResponse.json(
      { ok: false, errorKey: "error.route_distance_failed" },
      { status: 400 },
    );
  }

  const places = parsePlaceList(body.places);
  if (places == null || places.length < 2) {
    return NextResponse.json({ ok: false, errorKey: "error.address_required" });
  }

  const lookedUp = await lookupNominatimPlaceRefsSequential(places);
  if (!lookedUp.ok) {
    return NextResponse.json({ ok: false, errorKey: lookedUp.errorKey });
  }
  if (lookedUp.values.length !== places.length) {
    return NextResponse.json({
      ok: false,
      errorKey: "error.geocode_invalid_response",
    });
  }

  const coords = lookedUp.values.map((v) => ({
    lat: v.latitude,
    lon: v.longitude,
  }));
  const labels =
    Array.isArray(body.locations) && body.locations.length === places.length
      ? body.locations.map((l) => String(l))
      : lookedUp.values.map((v) => v.displayName);

  const result = await computeRouteDistanceFromCoords(
    coords,
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

function parsePlaceList(raw: unknown): AddressPlaceRef[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out: AddressPlaceRef[] = [];
  for (const item of raw) {
    const ref = parseAddressPlaceRef(item);
    if (ref == null) return null;
    out.push(ref);
  }
  return out;
}
