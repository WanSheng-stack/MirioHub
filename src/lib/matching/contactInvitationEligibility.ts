/**
 * PHASE 6.7C.1A.1 — server-only contact invitation route/threshold adapters.
 * Production routes import this file. Tests use contactInvitationEligibilityCore
 * and matchAdmissionPolicy. Date/time/transport/route rules live only in
 * matchAdmissionPolicy.ts.
 */

import "server-only";
import type { ContactInvitationEligibilityPost } from "@/lib/matching/contactInvitationEligibilityCore";
import {
  loadMatchAdmissionThresholds,
  scoreOfficialMatchAdmissionRoute,
} from "@/lib/matching/matchAdmissionServer";
import type { MatchAdmissionRouteScore } from "@/lib/matching/matchAdmissionPolicy";

export { loadMatchAdmissionThresholds };

export async function scoreOfficialContactInvitationRoute(input: {
  initiator: ContactInvitationEligibilityPost;
  counterpart: ContactInvitationEligibilityPost;
}): Promise<MatchAdmissionRouteScore> {
  return scoreOfficialMatchAdmissionRoute({
    left: input.initiator,
    right: input.counterpart,
  });
}
