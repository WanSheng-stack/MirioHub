/**
 * PHASE 6.7C.1A — server-only contact invitation eligibility.
 * Production routes import this file. Tests use contactInvitationEligibilityCore.
 */

import "server-only";
import { calculateRouteMatchScore } from "@/lib/route/calculateRouteMatchScore";
import type { ContactInvitationEligibilityPost } from "@/lib/matching/contactInvitationEligibilityCore";

export async function scoreOfficialContactInvitationRoute(input: {
  initiator: ContactInvitationEligibilityPost;
  counterpart: ContactInvitationEligibilityPost;
}): Promise<boolean> {
  const result = await calculateRouteMatchScore({
    source: {
      post_type: input.initiator.post_type,
      origin_address: input.initiator.origin_address ?? "",
      destination_address: input.initiator.destination_address ?? "",
      waypoints: input.initiator.waypoints,
      origin_gps: input.initiator.origin_gps,
      destination_gps: input.initiator.destination_gps,
    },
    candidate: {
      post_type: input.counterpart.post_type,
      origin_address: input.counterpart.origin_address ?? "",
      destination_address: input.counterpart.destination_address ?? "",
      waypoints: input.counterpart.waypoints,
      origin_gps: input.counterpart.origin_gps,
      destination_gps: input.counterpart.destination_gps,
    },
  });
  return result.ok;
}

