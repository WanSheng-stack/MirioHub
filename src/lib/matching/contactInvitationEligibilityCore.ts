/**
 * PHASE 6.7C.1A — contact invitation eligibility core.
 * Pure functions over database-reread post facts. Tests import this file.
 * Production scores the pair with calculateRouteMatchScore, then calls here.
 * Do not trust browser matched/score/routeCompatible fields.
 */

import { TIME_WINDOWS } from "@/lib/post-time-windows";
import { isDeliverOrTravel, isOnsiteOrErrand } from "@/lib/post-payload";
import type { PostCategory } from "@/lib/types";
import {
  canOfferMatchAction,
  oppositePostType,
} from "@/lib/route/matchHall";
import { validateTransportCapability } from "@/lib/transport/transportPolicy";
import type { TransportServiceLane } from "@/lib/transport/transportPolicy";
import { isUuid } from "@/lib/matching/contactInvitationCodeCore";

const ERROR = {
  invalidInput: "error.match_contact_invitation_invalid_input",
  postNotFound: "error.match_contact_post_not_found",
  postNotOwned: "error.match_contact_post_not_owned",
  selfNotAllowed: "error.match_contact_self_not_allowed",
  notEligible: "error.match_contact_not_eligible",
} as const;

export type ContactInvitationEligibilityPost = {
  id: string;
  user_id: string;
  post_type: string;
  category: string;
  status: string;
  departure_date?: string | null;
  departure_time_window?: string | null;
  service_time_window?: string | null;
  transport_mode?: string | null;
  escort_seats?: number | null;
  max_companions?: number | null;
  count_small?: number | null;
  count_medium?: number | null;
  count_large?: number | null;
  count_xlarge?: number | null;
  origin_address?: string | null;
  destination_address?: string | null;
  waypoints?: string[] | null;
  origin_gps?: unknown;
  destination_gps?: unknown;
};

export type ContactInvitationEligibilityOk = {
  ok: true;
};

export type ContactInvitationEligibilityFail = {
  ok: false;
  errorKey: string;
};

export type ContactInvitationEligibilityResult =
  | ContactInvitationEligibilityOk
  | ContactInvitationEligibilityFail;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isOfficialMatchDate(value: string | null | undefined): boolean {
  if (value == null || !DATE_RE.test(value)) return false;
  return Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

export function isOfficialMatchTimeWindow(
  value: string | null | undefined,
): boolean {
  if (value == null) return false;
  return (TIME_WINDOWS as readonly string[]).includes(value);
}

export function pairHasOfficialSchedule(
  initiator: ContactInvitationEligibilityPost,
  counterpart: ContactInvitationEligibilityPost,
): boolean {
  if (initiator.category !== counterpart.category) return false;
  const category = initiator.category as PostCategory;
  if (isDeliverOrTravel(category)) {
    return (
      isOfficialMatchDate(initiator.departure_date) &&
      isOfficialMatchDate(counterpart.departure_date) &&
      isOfficialMatchTimeWindow(initiator.departure_time_window) &&
      isOfficialMatchTimeWindow(counterpart.departure_time_window)
    );
  }
  if (category === "buy" || isOnsiteOrErrand(category)) {
    const initiatorWindow = initiator.departure_time_window ?? initiator.service_time_window;
    const counterpartWindow =
      counterpart.departure_time_window ?? counterpart.service_time_window;
    return (
      isOfficialMatchDate(initiator.departure_date) &&
      isOfficialMatchDate(counterpart.departure_date) &&
      isOfficialMatchTimeWindow(initiatorWindow) &&
      isOfficialMatchTimeWindow(counterpartWindow)
    );
  }
  return false;
}

function travelItemUnits(post: ContactInvitationEligibilityPost): number {
  return (
    (post.count_small ?? 0) +
    (post.count_medium ?? 0) +
    (post.count_large ?? 0) +
    (post.count_xlarge ?? 0)
  );
}

export function postSatisfiesOfficialTransport(
  post: ContactInvitationEligibilityPost,
): boolean {
  if (!isDeliverOrTravel(post.category as PostCategory)) return true;
  const mode = post.transport_mode;
  if (mode == null || mode === "") return true;
  const lane = post.category as TransportServiceLane;
  const input =
    post.post_type === "demand"
      ? {
          lane,
          postType: "demand" as const,
          mode,
          peopleCount: post.category === "travel" ? (post.max_companions ?? 0) : undefined,
          travelItemUnits:
            post.category === "travel" ? travelItemUnits(post) : undefined,
          escortPassengerCount:
            post.category === "deliver" ? (post.escort_seats ?? 0) : undefined,
        }
      : {
          lane,
          postType: "provider" as const,
          mode,
          peopleCapacity: post.category === "travel" ? (post.max_companions ?? 0) : undefined,
          travelItemUnits:
            post.category === "travel" ? travelItemUnits(post) : undefined,
        };
  return validateTransportCapability(input).ok;
}

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
  if (
    (input.initiator.post_type !== "demand" &&
      input.initiator.post_type !== "provider") ||
    input.counterpart.post_type !==
      oppositePostType(input.initiator.post_type as "demand" | "provider")
  ) {
    return { ok: false, errorKey: ERROR.notEligible };
  }
  if (input.initiator.category !== input.counterpart.category) {
    return { ok: false, errorKey: ERROR.notEligible };
  }
  if (!pairHasOfficialSchedule(input.initiator, input.counterpart)) {
    return { ok: false, errorKey: ERROR.notEligible };
  }
  if (
    !postSatisfiesOfficialTransport(input.initiator) ||
    !postSatisfiesOfficialTransport(input.counterpart)
  ) {
    return { ok: false, errorKey: ERROR.notEligible };
  }
  return { ok: true };
}

export function evaluateContactInvitationRouteEligibility(routeOk: boolean): ContactInvitationEligibilityResult {
  if (!routeOk) {
    return { ok: false, errorKey: ERROR.notEligible };
  }
  return { ok: true };
}

export function evaluateContactInvitationEligibility(input: {
  actorUserId: string;
  initiator: ContactInvitationEligibilityPost | null;
  counterpart: ContactInvitationEligibilityPost | null;
  routeOk: boolean;
}): ContactInvitationEligibilityResult {
  const base = evaluateContactInvitationBaseEligibility(input);
  if (!base.ok) return base;
  return evaluateContactInvitationRouteEligibility(input.routeOk);
}

export function invitationPairMatchesRequest(input: {
  initiatorPostId: string;
  counterpartPostId: string;
  existingInitiatorPostId: string | null;
  existingDemandPostId: string | null;
  existingProviderPostId: string | null;
}): boolean {
  if (
    input.existingInitiatorPostId == null ||
    input.existingDemandPostId == null ||
    input.existingProviderPostId == null
  ) {
    return false;
  }
  if (input.existingInitiatorPostId !== input.initiatorPostId) return false;
  if (input.initiatorPostId === input.counterpartPostId) return false;
  return (
    (input.initiatorPostId === input.existingDemandPostId &&
      input.counterpartPostId === input.existingProviderPostId) ||
    (input.initiatorPostId === input.existingProviderPostId &&
      input.counterpartPostId === input.existingDemandPostId)
  );
}
