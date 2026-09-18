/**
 * Shared Stage-1 publish builder core (no server-only).
 * Passkey verify, trusted-publish, and shadow-draft must all call this.
 *
 * Confirmed OSM place refs are mandatory. Free-text Nominatim geocode is not
 * used on the production publish path.
 */

import {
  CanonicalStage1Error,
  computeServerFeeMinor,
  hashCanonicalStage1,
  normalizeCanonicalStage1,
  toRpcStage1Payload,
  type CanonicalStage1Payload,
  type CanonicalStage1PublishContext,
} from "@/lib/auth/canonicalStage1Core";
import {
  readPlaceRefFromRaw,
  resolveStage1RouteFromPlaceRefs,
  type ResolveStage1FromPlacesDeps,
} from "@/lib/geo/resolveStage1FromPlaces";
import type { NominatimCoordinateHit } from "@/lib/route-kms";

export type { CanonicalStage1Payload, CanonicalStage1PublishContext };

export { CanonicalStage1Error, toRpcStage1Payload };

export type CanonicalStage1PublishContextWithOrigin =
  CanonicalStage1PublishContext & {
    /** Same origin hit used for OSRM (or sole origin fetch when kms=0). */
    originNominatimHit: NominatimCoordinateHit;
  };

export type BuildCanonicalStage1PublishContextDeps = ResolveStage1FromPlacesDeps;

const ADDRESS_CONFIRMATION = "error.address_confirmation_required";

function isRouteCategory(category: string): boolean {
  return category === "travel" || category === "deliver";
}

function isServiceCategory(category: string): boolean {
  return (
    category === "buy" || category === "onsite" || category === "errand"
  );
}

/**
 * Production Stage-1 publish context from country-bound place refs only.
 */
export async function buildCanonicalStage1PublishContext(
  rawPostInput: Record<string, unknown>,
  deps: BuildCanonicalStage1PublishContextDeps = {},
): Promise<CanonicalStage1PublishContextWithOrigin> {
  // 1) Preliminary normalize — structure / category only.
  const preliminary = normalizeCanonicalStage1(rawPostInput);
  const category = preliminary.category;

  // Unconfirmed waypoints have no ref model yet → fail closed (no free-text).
  if (isRouteCategory(category) && preliminary.waypoints.length > 0) {
    throw new CanonicalStage1Error(ADDRESS_CONFIRMATION);
  }

  // 2) Parse required refs by category.
  let originPlace = null;
  let destinationPlace = null;

  if (isRouteCategory(category)) {
    originPlace = readPlaceRefFromRaw(rawPostInput, "origin_geo");
    destinationPlace = readPlaceRefFromRaw(rawPostInput, "destination_geo");
    if (originPlace == null || destinationPlace == null) {
      throw new CanonicalStage1Error(ADDRESS_CONFIRMATION);
    }
  } else if (isServiceCategory(category)) {
    // Buy / onsite / errand: single service-location authority (not destination).
    const servicePlace =
      readPlaceRefFromRaw(rawPostInput, "service_geo") ??
      readPlaceRefFromRaw(rawPostInput, "origin_geo");
    if (servicePlace == null) {
      throw new CanonicalStage1Error(ADDRESS_CONFIRMATION);
    }
    originPlace = servicePlace;
    destinationPlace = null;
  } else {
    throw new CanonicalStage1Error(ADDRESS_CONFIRMATION);
  }

  // 3) Server batch lookup + OSRM (one lookup HTTP for the place set).
  const route = await resolveStage1RouteFromPlaceRefs(
    {
      category,
      originPlace,
      destinationPlace,
    },
    deps,
  );
  if (!route.ok) {
    const key =
      route.errorKey === "error.address_required"
        ? ADDRESS_CONFIRMATION
        : route.errorKey;
    throw new CanonicalStage1Error(key);
  }

  // 4) Overwrite client address text with server lookup display_name.
  const overwritten: Record<string, unknown> = { ...rawPostInput };
  const originResolved = route.resolved[0];
  if (originResolved == null) {
    throw new CanonicalStage1Error("error.geocode_failed");
  }
  overwritten.origin_address = originResolved.displayName;

  if (isServiceCategory(category)) {
    overwritten.destination_address = originResolved.displayName;
    overwritten.service_address = originResolved.displayName;
  } else {
    const destResolved = route.resolved[1];
    if (destResolved == null) {
      throw new CanonicalStage1Error("error.geocode_failed");
    }
    overwritten.destination_address = destResolved.displayName;
  }

  // 5) Final normalize from resolved address text.
  const canonicalPayload = normalizeCanonicalStage1(overwritten);

  // 6) Hash / fee / authority all from the same resolved batch.
  const serverKms = route.serverKms;
  const serverFeeMinor = computeServerFeeMinor(serverKms, canonicalPayload);
  const payloadHash = hashCanonicalStage1(
    canonicalPayload,
    serverKms,
    serverFeeMinor,
  );

  return {
    canonicalPayload,
    payloadHash,
    serverKms,
    serverFeeMinor,
    originNominatimHit: route.originNominatimHit,
  };
}
