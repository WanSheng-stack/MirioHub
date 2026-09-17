/**
 * Shared Stage-1 publish builder. Server-only.
 * Passkey verify, trusted-publish, and shadow-draft must all call this.
 *
 * Route distance uses Nominatim+OSRM. The origin Nominatim hit from the same
 * batch is returned so trusted authority can reuse it (no second geocode).
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

  const route = await resolveStage1RouteWithOriginHit(
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
