/**
 * Stage-1 route resolution from confirmed Nominatim OSM place refs.
 * Server-only — keeps client-safe route-kms free of process cache/throttle.
 */

import "server-only";
import {
  parseAddressPlaceRef,
  type AddressPlaceRef,
} from "@/lib/geo/addressSearch";
import {
  lookupNominatimPlaceRef,
  lookupNominatimPlaceRefsSequential,
  type NominatimHttpDeps,
} from "@/lib/geo/nominatimClient";
import {
  computeRouteDistanceFromCoords,
  type NominatimCoordinateHit,
  type OsrmFetchDeps,
  type Stage1RouteWithOriginHitResult,
} from "@/lib/route-kms";

export type ResolveStage1FromPlacesDeps = NominatimHttpDeps & OsrmFetchDeps;

export async function resolveStage1RouteFromPlaceRefs(
  args: {
    category: string;
    originAddress: string;
    destinationAddress: string;
    originPlace: AddressPlaceRef;
    destinationPlace?: AddressPlaceRef | null;
  },
  deps: ResolveStage1FromPlacesDeps = {},
): Promise<Stage1RouteWithOriginHitResult> {
  const computeFromCoords = computeRouteDistanceFromCoords;

  if (args.category === "onsite" || args.category === "errand") {
    const origin = await lookupNominatimPlaceRef(args.originPlace, deps);
    if (!origin.ok) {
      return { ok: false, errorKey: origin.errorKey };
    }
    const hit: NominatimCoordinateHit = {
      lat: origin.value.latitude,
      lon: origin.value.longitude,
      countryCode: origin.value.countryCode,
    };
    return { ok: true, serverKms: 0, originNominatimHit: hit };
  }

  if (args.destinationPlace == null) {
    return { ok: false, errorKey: "error.address_required" };
  }

  const batch = await lookupNominatimPlaceRefsSequential(
    [args.originPlace, args.destinationPlace],
    deps,
  );
  if (!batch.ok) {
    return { ok: false, errorKey: batch.errorKey };
  }
  const originHit = batch.values[0];
  const destHit = batch.values[1];
  if (originHit == null || destHit == null) {
    return { ok: false, errorKey: "error.geocode_failed" };
  }

  const labels = [
    args.originAddress || originHit.displayName,
    args.destinationAddress || destHit.displayName,
  ];
  const coords = [
    { lat: originHit.latitude, lon: originHit.longitude },
    { lat: destHit.latitude, lon: destHit.longitude },
  ];
  const dist = await computeFromCoords(coords, labels, undefined, undefined, deps);
  if (!dist.ok) {
    return { ok: false, errorKey: dist.errorKey };
  }
  return {
    ok: true,
    serverKms: dist.totalKms,
    originNominatimHit: {
      lat: originHit.latitude,
      lon: originHit.longitude,
      countryCode: originHit.countryCode,
    },
  };
}

export function readPlaceRefFromRaw(
  rawPostInput: Record<string, unknown>,
  key: "origin_geo" | "destination_geo" | "service_geo",
): AddressPlaceRef | null {
  return parseAddressPlaceRef(rawPostInput[key]);
}
