/**
 * Stage-1 route resolution from confirmed Nominatim OSM place refs.
 * Pure of Next.js server-only so unit tests can exercise the contract.
 */

import {
  parseAddressPlaceRef,
  type AddressPlaceRef,
  type AddressSearchCandidate,
} from "@/lib/geo/addressSearch";
import {
  lookupNominatimPlaceRefsBatch,
  type NominatimHttpDeps,
} from "@/lib/geo/nominatimClient";
import {
  computeRouteDistanceFromCoords,
  type NominatimCoordinateHit,
  type OsrmFetchDeps,
  type Stage1RouteWithOriginHitResult,
} from "@/lib/route-kms";

export type ResolveStage1FromPlacesDeps = NominatimHttpDeps & OsrmFetchDeps;

export type ResolveStage1FromPlacesOk = {
  ok: true;
  serverKms: number;
  originNominatimHit: NominatimCoordinateHit;
  /** Server lookup display names in input order (origin[, destination]). */
  resolved: AddressSearchCandidate[];
};

export type ResolveStage1FromPlacesResult =
  | ResolveStage1FromPlacesOk
  | { ok: false; errorKey: string };

function toOriginHit(c: AddressSearchCandidate): NominatimCoordinateHit {
  return {
    lat: c.latitude,
    lon: c.longitude,
    countryCode: c.countryCode,
  };
}

/**
 * Resolve route authority from country-bound place refs.
 * Always one batch lookup for the place set (O+D share one HTTP even when equal).
 */
export async function resolveStage1RouteFromPlaceRefs(
  args: {
    category: string;
    originPlace: AddressPlaceRef;
    destinationPlace?: AddressPlaceRef | null;
  },
  deps: ResolveStage1FromPlacesDeps = {},
): Promise<ResolveStage1FromPlacesResult> {
  const singlePlace =
    args.category === "onsite" ||
    args.category === "errand" ||
    args.category === "buy";

  if (singlePlace) {
    const batch = await lookupNominatimPlaceRefsBatch([args.originPlace], deps);
    if (!batch.ok) {
      return { ok: false, errorKey: batch.errorKey };
    }
    const origin = batch.values[0];
    if (origin == null) {
      return { ok: false, errorKey: "error.geocode_failed" };
    }
    return {
      ok: true,
      serverKms: 0,
      originNominatimHit: toOriginHit(origin),
      resolved: [origin],
    };
  }

  if (args.destinationPlace == null) {
    return { ok: false, errorKey: "error.address_confirmation_required" };
  }

  const batch = await lookupNominatimPlaceRefsBatch(
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

  const labels = [originHit.displayName, destHit.displayName];
  const coords = [
    { lat: originHit.latitude, lon: originHit.longitude },
    { lat: destHit.latitude, lon: destHit.longitude },
  ];
  const dist = await computeRouteDistanceFromCoords(
    coords,
    labels,
    undefined,
    undefined,
    deps,
  );
  if (!dist.ok) {
    return { ok: false, errorKey: dist.errorKey };
  }
  return {
    ok: true,
    serverKms: dist.totalKms,
    originNominatimHit: toOriginHit(originHit),
    resolved: [originHit, destHit],
  };
}

export function readPlaceRefFromRaw(
  rawPostInput: Record<string, unknown>,
  key: "origin_geo" | "destination_geo" | "service_geo",
): AddressPlaceRef | null {
  return parseAddressPlaceRef(rawPostInput[key]);
}

/** Narrow Stage1RouteWithOriginHitResult-compatible projection. */
export function toStage1RouteResult(
  result: ResolveStage1FromPlacesResult,
): Stage1RouteWithOriginHitResult {
  if (!result.ok) return result;
  return {
    ok: true,
    serverKms: result.serverKms,
    originNominatimHit: result.originNominatimHit,
  };
}
