/**
 * Shared Stage-1 publish builder. Server-only.
 * Passkey verify, trusted-publish, and shadow-draft must all call this.
 *
 * When confirmed OSM place refs are present on rawPostInput (origin_geo /
 * destination_geo / service_geo), route + authority reuse Nominatim lookup of
 * those refs — not a free-text limit=1 re-search of display labels.
 */

import "server-only";
import {
  CanonicalStage1Error,
  computeServerFeeMinor,
  hashCanonicalStage1,
  normalizeCanonicalStage1,
  toRpcStage1Payload,
  type CanonicalStage1Payload,
  type CanonicalStage1PublishContext,
} from "@/lib/auth/canonicalStage1";
import {
  readPlaceRefFromRaw,
  resolveStage1RouteFromPlaceRefs,
} from "@/lib/geo/resolveStage1FromPlaces";
import {
  resolveStage1RouteWithOriginHit,
  type NominatimCoordinateHit,
  type Stage1RouteWithOriginHitDeps,
} from "@/lib/route-kms";

export type { CanonicalStage1Payload, CanonicalStage1PublishContext };

export { CanonicalStage1Error, toRpcStage1Payload };

export type CanonicalStage1PublishContextWithOrigin =
  CanonicalStage1PublishContext & {
    /** Same origin hit used for OSRM (or sole origin fetch when kms=0). */
    originNominatimHit: NominatimCoordinateHit;
  };

export type BuildCanonicalStage1PublishContextDeps = Stage1RouteWithOriginHitDeps;

export async function buildCanonicalStage1PublishContext(
  rawPostInput: Record<string, unknown>,
  deps: BuildCanonicalStage1PublishContextDeps = {},
): Promise<CanonicalStage1PublishContextWithOrigin> {
  const canonicalPayload = normalizeCanonicalStage1(rawPostInput);

  const originPlace =
    readPlaceRefFromRaw(rawPostInput, "origin_geo") ??
    readPlaceRefFromRaw(rawPostInput, "service_geo");
  const destinationPlace = readPlaceRefFromRaw(rawPostInput, "destination_geo");

  const route =
    originPlace != null
      ? await resolveStage1RouteFromPlaceRefs(
          {
            category: canonicalPayload.category,
            originAddress: canonicalPayload.origin_address,
            destinationAddress: canonicalPayload.destination_address,
            originPlace,
            destinationPlace,
          },
          deps,
        )
      : await resolveStage1RouteWithOriginHit(
          {
            category: canonicalPayload.category,
            originAddress: canonicalPayload.origin_address,
            destinationAddress: canonicalPayload.destination_address,
            waypoints: canonicalPayload.waypoints,
          },
          deps,
        );

  if (!route.ok) {
    throw new CanonicalStage1Error(route.errorKey);
  }

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
