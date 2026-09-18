import { NextResponse } from "next/server";
import {
  parseAddressPlaceRef,
  type AddressPlaceRef,
} from "@/lib/geo/addressSearch";
import { lookupNominatimPlaceRefsBatch } from "@/lib/geo/nominatimClient";
import { computeRouteDistanceFromCoords } from "@/lib/route-kms";

/**
 * Distance from country-bound place refs (server re-lookup).
 * Does NOT accept client-supplied lat/lon points or free-text labels for authority.
 */
export async function POST(request: Request) {
  let body: {
    places?: unknown;
    locations?: unknown;
    sliceOrigin?: unknown;
    sliceDestination?: unknown;
    sliceOriginIndex?: unknown;
    sliceDestinationIndex?: unknown;
    points?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, errorKey: "error.route_distance_failed" },
      { status: 400 },
    );
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
    return NextResponse.json(
      { ok: false, errorKey: "error.address_confirmation_required" },
      { status: 400 },
    );
  }

  const lookedUp = await lookupNominatimPlaceRefsBatch(places);
  if (!lookedUp.ok) {
    return NextResponse.json(
      { ok: false, errorKey: lookedUp.errorKey },
      { status: 502 },
    );
  }
  if (lookedUp.values.length !== places.length) {
    return NextResponse.json(
      { ok: false, errorKey: "error.geocode_invalid_response" },
      { status: 502 },
    );
  }

  const coords = lookedUp.values.map((v) => ({
    lat: v.latitude,
    lon: v.longitude,
  }));
  // OSRM labels come from server lookup displayName — never client locations.
  const labels = lookedUp.values.map((v) => v.displayName);

  const slice = parseSliceIndexes(
    body.sliceOriginIndex,
    body.sliceDestinationIndex,
    places.length,
  );
  if (slice === "invalid") {
    return NextResponse.json(
      { ok: false, errorKey: "error.route_distance_failed" },
      { status: 400 },
    );
  }

  const result = await computeRouteDistanceFromCoords(
    coords,
    labels,
    undefined,
    undefined,
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errorKey: result.errorKey },
      { status: 502 },
    );
  }

  // With only O/D (or no valid slice indexes), sliceKms === totalKms.
  let sliceKms = result.totalKms;
  if (slice != null) {
    // Bounded indexes currently only support full-span (0 → n-1) ≡ total.
    if (slice.originIndex === 0 && slice.destIndex === places.length - 1) {
      sliceKms = result.totalKms;
    } else {
      return NextResponse.json(
        { ok: false, errorKey: "error.route_distance_failed" },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    totalKms: result.totalKms,
    sliceKms,
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

function parseSliceIndexes(
  originRaw: unknown,
  destRaw: unknown,
  placeCount: number,
):
  | { originIndex: number; destIndex: number }
  | null
  | "invalid" {
  if (originRaw == null && destRaw == null) return null;
  if (
    typeof originRaw !== "number" ||
    typeof destRaw !== "number" ||
    !Number.isInteger(originRaw) ||
    !Number.isInteger(destRaw)
  ) {
    return "invalid";
  }
  if (
    originRaw < 0 ||
    destRaw < 0 ||
    originRaw >= placeCount ||
    destRaw >= placeCount ||
    originRaw >= destRaw
  ) {
    return "invalid";
  }
  return { originIndex: originRaw, destIndex: destRaw };
}
