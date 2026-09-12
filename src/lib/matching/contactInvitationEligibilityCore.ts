/**
 * PHASE 6.7C.1A.1 — invitation-specific wrapper over canonical admission.
 * Ownership / self / active-for-invite stay here.
 * Date, time, category, transport, and route thresholds come from
 * matchAdmissionPolicy.ts. Do not copy those rules.
 */

import { isUuid } from "@/lib/matching/contactInvitationCodeCore";
import {
  evaluateMatchAdmission,
  evaluatePairCompatibility,
  pairHasCompatibleSchedule,
  postSatisfiesOfficialTransport,
  type MatchAdmissionPost,
  type MatchAdmissionRouteScore,
  type MatchAdmissionRouteThresholds,
} from "@/lib/matching/matchAdmissionPolicy";
import { canOfferMatchAction } from "@/lib/route/matchHall";

export {
  pairHasCompatibleSchedule,
  postSatisfiesOfficialTransport,
};

/** @deprecated Use pairHasCompatibleSchedule. Format-only schedule is gone. */
export const pairHasOfficialSchedule = pairHasCompatibleSchedule;

const ERROR = {
  invalidInput: "error.match_contact_invitation_invalid_input",
  postNotFound: "error.match_contact_post_not_found",
  postNotOwned: "error.match_contact_post_not_owned",
  selfNotAllowed: "error.match_contact_self_not_allowed",
  notEligible: "error.match_contact_not_eligible",
} as const;

export type ContactInvitationEligibilityPost = MatchAdmissionPost & {
  origin_gps?: unknown;
  destination_gps?: unknown;
};

export type ContactInvitationEligibilityResult =
  | { ok: true }
  | { ok: false; errorKey: string };

export function evaluateContactInvitationBaseEligibility(input: {
  actorUserId: string;
  initiator: ContactInvitationEligibilityPost | null;
  counterpart: ContactInvitationEligibilityPost | null;
}): ContactInvitationEligibilityResult {
  if (!isUuid(input.actorUserId)) {
    return { ok: false, errorKey: ERROR.invalidInput };
  }
  if (!input.initiator || !input.counterpart) {
    return { ok: false, errorKey: ERROR.postNotFound };
  }
  if (input.initiator.id === input.counterpart.id) {
    return { ok: false, errorKey: ERROR.selfNotAllowed };
  }
  if (input.initiator.user_id !== input.actorUserId) {
    return { ok: false, errorKey: ERROR.postNotOwned };
  }
  if (input.counterpart.user_id === input.actorUserId) {
    return { ok: false, errorKey: ERROR.selfNotAllowed };
  }
  if (
    !canOfferMatchAction(input.initiator.status) ||
    !canOfferMatchAction(input.counterpart.status)
  ) {
    return { ok: false, errorKey: ERROR.notEligible };
  }
  const pair = evaluatePairCompatibility(input.initiator, input.counterpart);
  if (!pair.ok) {
    return { ok: false, errorKey: ERROR.notEligible };
  }
  return { ok: true };
}

export function evaluateContactInvitationEligibility(input: {
  actorUserId: string;
  initiator: ContactInvitationEligibilityPost | null;
  counterpart: ContactInvitationEligibilityPost | null;
  route: MatchAdmissionRouteScore;
  thresholds: MatchAdmissionRouteThresholds | null;
}): ContactInvitationEligibilityResult {
  const base = evaluateContactInvitationBaseEligibility(input);
  if (!base.ok) return base;
  if (!input.initiator || !input.counterpart) {
    return { ok: false, errorKey: ERROR.postNotFound };
  }
  const admission = evaluateMatchAdmission({
    left: input.initiator,
    right: input.counterpart,
    route: input.route,
    thresholds: input.thresholds,
  });
  if (!admission.eligible) {
    return { ok: false, errorKey: ERROR.notEligible };
  }
  return { ok: true };
}
