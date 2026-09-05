/**
 * Shared Stage-1 publish builder. Server-only.
 * Passkey verify, trusted-publish, and shadow-draft must all call this.
 *
 * Route distance uses the existing server Nominatim+OSRM path
 * (computeRouteDistance). The previously called RPC
 * calculate_server_route_kms_via_waypoints does not exist in repo or live DB.
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
import { buildDemandRouteLocations, computeRouteDistance } from "@/lib/route-kms";

export type { CanonicalStage1Payload, CanonicalStage1PublishContext };

export { CanonicalStage1Error, toRpcStage1Payload };

export async function buildCanonicalStage1PublishContext(
  rawPostInput: Record<string, unknown>,
): Promise<CanonicalStage1PublishContext> {
  const canonicalPayload = normalizeCanonicalStage1(rawPostInput);

  const locations = buildDemandRouteLocations(
    canonicalPayload.origin_address,
    canonicalPayload.destination_address,
    canonicalPayload.waypoints,
  );

  let serverKms = 0;
  if (locations.length < 2) {
    if (canonicalPayload.category !== "onsite" && canonicalPayload.category !== "errand") {
      throw new CanonicalStage1Error("error.address_required");
    }
  } else {
    const dist = await computeRouteDistance(locations);
    if (!dist.ok) {
      throw new CanonicalStage1Error(dist.errorKey);
    }
    serverKms = dist.totalKms;
  }

  const serverFeeMinor = computeServerFeeMinor(serverKms, canonicalPayload);
  const payloadHash = hashCanonicalStage1(canonicalPayload, serverKms, serverFeeMinor);

  return {
    canonicalPayload,
    payloadHash,
    serverKms,
    serverFeeMinor,
  };
}
