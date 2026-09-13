/**
 * PHASE 6.7C.1B — match-request parse, quote, and writer simulation.
 * Pure helpers. Not a live PostgreSQL run.
 */

import { createHash } from "node:crypto";
import {
  isContactCodeHash,
  isUuid,
} from "@/lib/matching/contactInvitationCodeCore";
import {
  evaluateMatchAdmission,
  matchAdmissionDigestHex,
  validateProposedSchedule,
  type MatchAdmissionPost,
  type MatchAdmissionRouteScore,
  type MatchAdmissionRouteThresholds,
} from "@/lib/matching/matchAdmissionPolicy";
import { canOfferMatchAction } from "@/lib/route/matchHall";

export const MATCH_REQUEST_BODY_KEYS = [
  "initiatorPostId",
  "counterpartPostId",
  "clientRequestId",
  "clientRevisionId",
  "proposal",
  "contactPreference",
  "whatsappAvailable",
  "viberAvailable",
] as const;

export const MATCH_REQUEST_ERROR = {
  unknownKey: "error.match_request_unknown_key",
  invalidInput: "error.match_request_invalid_input",
  authenticationRequired: "error.authentication_required",
  submitFailed: "error.submit_failed",
  serverConfiguration: "error.server_configuration",
  postNotFound: "error.match_request_post_not_found",
  postNotOwned: "error.match_request_post_not_owned",
  selfNotAllowed: "error.match_request_self_not_allowed",
  postUnavailable: "error.match_request_post_unavailable",
  roleMismatch: "error.match_request_role_mismatch",
  categoryMismatch: "error.match_request_category_mismatch",
  categoryNotSupported: "error.match_request_category_not_supported",
  alreadyOpen: "error.match_request_already_open",
  idempotencyConflict: "error.match_request_idempotency_conflict",
  notEligible: "error.match_request_not_eligible",
  creationDisabled: "error.match_request_creation_disabled",
  pricingNotReady: "error.match_request_pricing_not_ready",
  phoneRequired: "error.match_request_phone_required",
  contactChannelInvalid: "error.match_request_contact_channel_invalid",
  openLimit: "error.match_request_open_limit",
  rateLimit: "error.match_request_rate_limit",
} as const;

export const MATCH_REQUEST_ERROR_KEYS = Object.values(MATCH_REQUEST_ERROR);

export const MATCH_REQUEST_SAFE_LOGS = {
  authLookupFailed: "[match-request] auth lookup failed",
  serverConfigurationMissing: "[match-request] server configuration missing",
  codeGenerationFailed: "[match-request] code generation failed",
  writerFailed: "[match-request] writer failed",
  writerResponseInvalid: "[match-request] writer response invalid",
  eligibilityFailed: "[match-request] eligibility failed",
  requestLimitReached: "[match-request] request limit reached",
  creationDisabled: "[match-request] creation disabled",
  pricingNotReady: "[match-request] pricing not ready",
} as const;

const HIGH_RISK_KEYS = [
  "phone",
  "contactCode",
  "contactCodeHash",
  "origin_gps",
  "destination_gps",
  "amount",
  "baseAmount",
  "totalAmount",
  "currency",
  "pricingVersion",
  "score",
  "matched",
  "routeCompatible",
  "matchPercent",
  "extraDetourKm",
  "extraDuration",
  "userId",
  "actor",
  "requester",
  "recipient",
  "providerCapacity",
  "requestStatus",
  "membership",
  "quota",
] as const;

const TRAVEL_PROPOSAL_KEYS = [
  "category",
  "proposedDate",
  "proposedTimeWindow",
  "pickupLocation",
  "dropoffLocation",
  "bumpTierId",
  "note",
] as const;
const DELIVER_PROPOSAL_KEYS = [
  "category",
  "proposedDate",
  "proposedTimeWindow",
  "pickupLocation",
  "deliveryLocation",
  "bumpTierId",
  "note",
] as const;
const LOCATION_KEYS = ["locationVersion", "displayAddress"] as const;

export type ContactPreference = "phone" | "whatsapp" | "viber";

export type BrowserLocationInput = {
  locationVersion?: number;
  displayAddress?: string;
};

export type MatchRequestProposalInput =
  | {
      category: "travel";
      proposedDate: string;
      proposedTimeWindow: string;
      pickupLocation?: BrowserLocationInput;
      dropoffLocation?: BrowserLocationInput;
      bumpTierId?: string;
      note?: string;
    }
  | {
      category: "deliver";
      proposedDate: string;
      proposedTimeWindow: string;
      pickupLocation?: BrowserLocationInput;
      deliveryLocation?: BrowserLocationInput;
      bumpTierId?: string;
      note?: string;
    };

export type MatchRequestCreateInput = {
  initiatorPostId: string;
  counterpartPostId: string;
  clientRequestId: string;
  clientRevisionId: string;
  proposal: MatchRequestProposalInput;
  contactPreference: ContactPreference;
  whatsappAvailable: boolean;
  viberAvailable: boolean;
};

export type ServerMatchRequestQuote = {
  pricingVersion: number;
  pricingCountryCode: string;
  pricingCurrency: string;
  baseAmountMinor: number;
  bumpTierId: string | null;
  bumpAmountMinor: number;
  totalAmountMinor: number;
  matchPercentBasisPoints: number;
  extraDetourM: number;
  extraDurationSeconds: number;
};

export type CanonicalLocationSnapshot = {
  locationVersion: 1;
  displayAddress: string;
};

export type CanonicalProposal = {
  category: "travel" | "deliver";
  proposedDate: string;
  proposedTimeWindow: string;
  pickupLocation: CanonicalLocationSnapshot;
  dropoffLocation?: CanonicalLocationSnapshot;
  deliveryLocation?: CanonicalLocationSnapshot;
  bumpTierId: string | null;
  note: string | null;
};

export type MatchRequestWriterRow = {
  request_id: string;
  revision_id: string;
  invitation_id: string;
  request_status: string;
  revision_status: string;
  expires_at: string;
  effective_client_request_id: string;
  effective_client_revision_id: string;
  created: boolean;
};

export type MatchRequestInspectRow = {
  existing_for_client_request: boolean;
  open_count: number;
  created_24h_count: number;
  max_open: number;
  max_created_24h: number;
  creation_enabled: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function containsHighRiskKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsHighRiskKey);
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if ((HIGH_RISK_KEYS as readonly string[]).includes(key)) return true;
    if (containsHighRiskKey(value[key])) return true;
  }
  return false;
}

export function parseMatchRequestCreateBody(
  body: unknown,
):
  | { ok: true; value: MatchRequestCreateInput }
  | { ok: false; status: 400; errorKey: string } {
  if (!isPlainObject(body)) {
    return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.invalidInput };
  }
  if (containsHighRiskKey(body)) {
    return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.unknownKey };
  }
  for (const key of Object.keys(body)) {
    if (!(MATCH_REQUEST_BODY_KEYS as readonly string[]).includes(key)) {
      return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.unknownKey };
    }
  }
  const {
    initiatorPostId,
    counterpartPostId,
    clientRequestId,
    clientRevisionId,
    proposal,
    contactPreference,
    whatsappAvailable,
    viberAvailable,
  } = body;
  if (
    typeof initiatorPostId !== "string" ||
    typeof counterpartPostId !== "string" ||
    typeof clientRequestId !== "string" ||
    typeof clientRevisionId !== "string" ||
    !isUuid(initiatorPostId) ||
    !isUuid(counterpartPostId) ||
    !isUuid(clientRequestId) ||
    !isUuid(clientRevisionId) ||
    initiatorPostId === counterpartPostId
  ) {
    return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.invalidInput };
  }
  if (contactPreference !== "phone" && contactPreference !== "whatsapp" && contactPreference !== "viber") {
    return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.invalidInput };
  }
  if (typeof whatsappAvailable !== "boolean" || typeof viberAvailable !== "boolean") {
    return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.invalidInput };
  }
  const parsedProposal = parseProposal(proposal);
  if (!parsedProposal.ok) return parsedProposal;
  const preferredAllowed =
    contactPreference === "phone" ||
    (contactPreference === "whatsapp" && whatsappAvailable) ||
    (contactPreference === "viber" && viberAvailable);
  if (!preferredAllowed) {
    return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.contactChannelInvalid };
  }
  return {
    ok: true,
    value: {
      initiatorPostId,
      counterpartPostId,
      clientRequestId,
      clientRevisionId,
      proposal: parsedProposal.value,
      contactPreference,
      whatsappAvailable,
      viberAvailable,
    },
  };
}

function parseProposal(
  value: unknown,
):
  | { ok: true; value: MatchRequestProposalInput }
  | { ok: false; status: 400; errorKey: string } {
  if (!isPlainObject(value)) {
    return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.invalidInput };
  }
  if (containsHighRiskKey(value)) {
    return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.unknownKey };
  }
  const category = value.category;
  const allowed =
    category === "travel"
      ? TRAVEL_PROPOSAL_KEYS
      : category === "deliver"
        ? DELIVER_PROPOSAL_KEYS
        : null;
  if (!allowed) {
    return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.categoryNotSupported };
  }
  for (const key of Object.keys(value)) {
    if (!(allowed as readonly string[]).includes(key)) {
      return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.unknownKey };
    }
  }
  if (
    typeof value.proposedDate !== "string" ||
    typeof value.proposedTimeWindow !== "string" ||
    !validateProposedSchedule({
      proposedDate: value.proposedDate,
      proposedTimeWindow: value.proposedTimeWindow,
    })
  ) {
    return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.invalidInput };
  }
  const pickup = parseLocation(value.pickupLocation);
  if (!pickup.ok) return pickup;
  if (category === "travel") {
    const dropoff = parseLocation(value.dropoffLocation);
    if (!dropoff.ok) return dropoff;
    return {
      ok: true,
      value: {
        category: "travel",
        proposedDate: value.proposedDate,
        proposedTimeWindow: value.proposedTimeWindow,
        pickupLocation: pickup.value,
        dropoffLocation: dropoff.value,
        bumpTierId: optionalString(value.bumpTierId),
        note: optionalString(value.note),
      },
    };
  }
  const delivery = parseLocation(value.deliveryLocation);
  if (!delivery.ok) return delivery;
  return {
    ok: true,
    value: {
      category: "deliver",
      proposedDate: value.proposedDate,
      proposedTimeWindow: value.proposedTimeWindow,
      pickupLocation: pickup.value,
      deliveryLocation: delivery.value,
      bumpTierId: optionalString(value.bumpTierId),
      note: optionalString(value.note),
    },
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseLocation(
  value: unknown,
):
  | { ok: true; value: BrowserLocationInput | undefined }
  | { ok: false; status: 400; errorKey: string } {
  if (value == null) return { ok: true, value: undefined };
  if (!isPlainObject(value)) {
    return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.invalidInput };
  }
  if (containsHighRiskKey(value)) {
    return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.unknownKey };
  }
  for (const key of Object.keys(value)) {
    if (!(LOCATION_KEYS as readonly string[]).includes(key)) {
      return { ok: false, status: 400, errorKey: MATCH_REQUEST_ERROR.unknownKey };
    }
  }
  return {
    ok: true,
    value: {
      locationVersion: typeof value.locationVersion === "number" ? value.locationVersion : undefined,
      displayAddress: typeof value.displayAddress === "string" ? value.displayAddress : undefined,
    },
  };
}

export function canonicalizeProposal(input: {
  proposal: MatchRequestProposalInput;
  initiator: MatchAdmissionPost;
  counterpart: MatchAdmissionPost;
}): { ok: true; value: CanonicalProposal } | { ok: false; errorKey: string } {
  if (input.initiator.category !== input.proposal.category) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.notEligible };
  }
  if (input.proposal.category !== "travel" && input.proposal.category !== "deliver") {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.categoryNotSupported };
  }
  const pickup: CanonicalLocationSnapshot = {
    locationVersion: 1,
    displayAddress: input.initiator.origin_address ?? "",
  };
  const destination: CanonicalLocationSnapshot = {
    locationVersion: 1,
    displayAddress: input.initiator.destination_address ?? "",
  };
  if (input.proposal.category === "travel") {
    return {
      ok: true,
      value: {
        category: "travel",
        proposedDate: input.proposal.proposedDate,
        proposedTimeWindow: input.proposal.proposedTimeWindow,
        pickupLocation: pickup,
        dropoffLocation: destination,
        bumpTierId: input.proposal.bumpTierId ?? null,
        note: input.proposal.note ?? null,
      },
    };
  }
  return {
    ok: true,
    value: {
      category: "deliver",
      proposedDate: input.proposal.proposedDate,
      proposedTimeWindow: input.proposal.proposedTimeWindow,
      pickupLocation: pickup,
      deliveryLocation: destination,
      bumpTierId: input.proposal.bumpTierId ?? null,
      note: input.proposal.note ?? null,
    },
  };
}

export function revisionStatusTimestampsAreLegal(input: {
  status: string;
  supersededAt: string | null;
  respondedAt: string | null;
}): boolean {
  const superseded = input.supersededAt != null;
  const responded = input.respondedAt != null;
  if (superseded && responded) return false;
  switch (input.status) {
    case "current":
    case "expired":
    case "invalidated":
      return !superseded && !responded;
    case "superseded":
      return superseded && !responded;
    case "accepted":
    case "rejected":
      return responded && !superseded;
    default:
      return false;
  }
}

export function quoteIsLegal(quote: ServerMatchRequestQuote | null): quote is ServerMatchRequestQuote {
  if (quote == null) return false;
  return (
    Number.isInteger(quote.pricingVersion) &&
    quote.pricingVersion > 0 &&
    /^[A-Z]{2}$/.test(quote.pricingCountryCode) &&
    /^[A-Z]{3}$/.test(quote.pricingCurrency) &&
    Number.isInteger(quote.baseAmountMinor) &&
    quote.baseAmountMinor >= 0 &&
    Number.isInteger(quote.bumpAmountMinor) &&
    quote.bumpAmountMinor >= 0 &&
    quote.totalAmountMinor === quote.baseAmountMinor + quote.bumpAmountMinor &&
    Number.isInteger(quote.matchPercentBasisPoints) &&
    quote.matchPercentBasisPoints >= 0 &&
    quote.matchPercentBasisPoints <= 10000 &&
    Number.isInteger(quote.extraDetourM) &&
    quote.extraDetourM >= 0 &&
    Number.isInteger(quote.extraDurationSeconds) &&
    quote.extraDurationSeconds >= 0
  );
}

export function buildProductionServerQuote(): ServerMatchRequestQuote | null {
  return null;
}

export function digestCanonicalProposal(proposal: CanonicalProposal): string {
  return createHash("md5").update(JSON.stringify(proposal), "utf8").digest("hex");
}

export function digestServerQuote(quote: ServerMatchRequestQuote): string {
  return createHash("md5").update(JSON.stringify(quote), "utf8").digest("hex");
}

export function httpStatusForMatchRequestError(errorKey: string): number {
  switch (errorKey) {
    case MATCH_REQUEST_ERROR.unknownKey:
    case MATCH_REQUEST_ERROR.invalidInput:
    case MATCH_REQUEST_ERROR.contactChannelInvalid:
      return 400;
    case MATCH_REQUEST_ERROR.authenticationRequired:
      return 401;
    case MATCH_REQUEST_ERROR.postNotOwned:
    case MATCH_REQUEST_ERROR.selfNotAllowed:
      return 403;
    case MATCH_REQUEST_ERROR.postNotFound:
      return 404;
    case MATCH_REQUEST_ERROR.openLimit:
    case MATCH_REQUEST_ERROR.rateLimit:
      return 429;
    case MATCH_REQUEST_ERROR.alreadyOpen:
    case MATCH_REQUEST_ERROR.idempotencyConflict:
    case MATCH_REQUEST_ERROR.postUnavailable:
    case MATCH_REQUEST_ERROR.notEligible:
    case MATCH_REQUEST_ERROR.roleMismatch:
    case MATCH_REQUEST_ERROR.categoryMismatch:
    case MATCH_REQUEST_ERROR.categoryNotSupported:
    case MATCH_REQUEST_ERROR.creationDisabled:
    case MATCH_REQUEST_ERROR.pricingNotReady:
    case MATCH_REQUEST_ERROR.phoneRequired:
      return 409;
    default:
      return 500;
  }
}

export function interpretMatchRequestWriterRow(
  row: MatchRequestWriterRow,
  clientRequestId: string,
  clientRevisionId: string,
): { ok: true; row: MatchRequestWriterRow } | { ok: false; status: number; errorKey: string } {
  if (
    !isUuid(row.request_id) ||
    !isUuid(row.revision_id) ||
    !isUuid(row.invitation_id) ||
    row.request_status !== "pending" ||
    row.revision_status !== "current" ||
    !Number.isFinite(Date.parse(row.expires_at)) ||
    row.effective_client_request_id !== clientRequestId ||
    row.effective_client_revision_id !== clientRevisionId ||
    typeof row.created !== "boolean"
  ) {
    if (row.effective_client_request_id !== clientRequestId) {
      return { ok: false, status: 409, errorKey: MATCH_REQUEST_ERROR.alreadyOpen };
    }
    return { ok: false, status: 500, errorKey: MATCH_REQUEST_ERROR.submitFailed };
  }
  return { ok: true, row };
}

export function evaluateMatchRequestEligibility(input: {
  actorUserId: string;
  initiator: MatchAdmissionPost | null;
  counterpart: MatchAdmissionPost | null;
  route: MatchAdmissionRouteScore;
  thresholds: MatchAdmissionRouteThresholds | null;
  proposal: MatchRequestProposalInput;
}): { ok: true } | { ok: false; errorKey: string } {
  if (!isUuid(input.actorUserId)) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.invalidInput };
  }
  if (!input.initiator || !input.counterpart) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.postNotFound };
  }
  if (input.initiator.user_id !== input.actorUserId) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.postNotOwned };
  }
  if (input.counterpart.user_id === input.actorUserId) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.selfNotAllowed };
  }
  if (
    !canOfferMatchAction(input.initiator.status) ||
    !canOfferMatchAction(input.counterpart.status)
  ) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.notEligible };
  }
  if (input.initiator.category !== "travel" && input.initiator.category !== "deliver") {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.categoryNotSupported };
  }
  const admission = evaluateMatchAdmission({
    left: input.initiator,
    right: input.counterpart,
    route: input.route,
    thresholds: input.thresholds,
  });
  if (!admission.eligible) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.notEligible };
  }
  if (
    !validateProposedSchedule({
      proposedDate: input.proposal.proposedDate,
      proposedTimeWindow: input.proposal.proposedTimeWindow,
    })
  ) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.invalidInput };
  }
  return { ok: true };
}

export function extractWriterErrorKey(message: string): string | null {
  const match = MATCH_REQUEST_ERROR_KEYS.find((key) => message.includes(key));
  return match ?? (message.includes("error.server_configuration") ? MATCH_REQUEST_ERROR.serverConfiguration : null);
}

export type SimulatedPost = MatchAdmissionPost & { origin_gps?: unknown; destination_gps?: unknown };
export type SimulatedProfile = { id: string; phone: string };
export type SimulatedInvitation = {
  id: string;
  demand_post_id: string;
  provider_post_id: string;
  initiator_user_id: string;
  recipient_user_id: string;
  initiator_post_id: string;
  status: string;
  contact_code_hash: string;
  client_request_id: string;
  disclosure_mode: string;
  expires_at: string;
};
export type SimulatedRequest = {
  id: string;
  invitation_id: string;
  demand_post_id: string;
  provider_post_id: string;
  requester_user_id: string;
  recipient_user_id: string;
  client_request_id: string;
  status: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  current_revision_id: string;
  accepted_revision_id: string | null;
  request_assertion: {
    admissionDigest: string;
    proposalDigest: string;
    quoteDigest: string;
  };
};
export type SimulatedRevision = {
  id: string;
  request_id: string;
  revision_no: number;
  status: string;
  client_revision_id: string;
  proposal_payload: CanonicalProposal;
  contact_preference: ContactPreference;
};
export type SimulatedGrant = {
  invitation_id: string;
  subject_user_id: string;
  viewer_user_id: string;
  allowed_channels: string[];
  preferred_channel: string;
  expires_at: string;
};

export type SimulatedWriterState = {
  now: string;
  posts: SimulatedPost[];
  profiles: SimulatedProfile[];
  invitations: SimulatedInvitation[];
  requests: SimulatedRequest[];
  revisions: SimulatedRevision[];
  grants: SimulatedGrant[];
  contracts: unknown[];
  allocations: unknown[];
  events: unknown[];
  fraudRows: unknown[];
  config: {
    matching_request_creation_enabled: boolean;
    matching_request_ttl_minutes: number;
    matching_request_max_open_per_initiator_post: number;
    matching_request_max_created_per_actor_24h: number;
    matching_contact_policy_version: number;
  };
};

export function evaluateMatchRequestWriter(
  state: SimulatedWriterState,
  input: {
    actorUserId: string;
    initiatorPostId: string;
    counterpartPostId: string;
    clientRequestId: string;
    clientRevisionId: string;
    contactCodeHash: string;
    admissionDigest: string;
    proposalDigest: string;
    quoteDigest: string;
    proposal: CanonicalProposal;
    quote: ServerMatchRequestQuote;
    contactPreference: ContactPreference;
    whatsappAvailable: boolean;
    viberAvailable: boolean;
  },
):
  | { ok: true; row: MatchRequestWriterRow; state: SimulatedWriterState }
  | { ok: false; errorKey: string; state: SimulatedWriterState } {
  const next: SimulatedWriterState = structuredClone(state);
  next.contracts ??= [];
  next.allocations ??= [];
  next.events ??= [];
  next.fraudRows ??= [];
  if (
    !isUuid(input.actorUserId) ||
    !isUuid(input.initiatorPostId) ||
    !isContactCodeHash(input.contactCodeHash)
  ) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.invalidInput, state: next };
  }
  const existing = next.requests.find(
    (row) =>
      row.requester_user_id === input.actorUserId &&
      row.client_request_id === input.clientRequestId,
  );
  if (existing) {
    const inv = next.invitations.find((row) => row.id === existing.invitation_id);
    const rev = next.revisions.find((row) => row.id === existing.current_revision_id);
    const same =
      inv &&
      rev &&
      existing.status === "pending" &&
      rev.status === "current" &&
      inv.initiator_post_id === input.initiatorPostId &&
      rev.client_revision_id === input.clientRevisionId &&
      inv.contact_code_hash === input.contactCodeHash &&
      existing.request_assertion.proposalDigest === input.proposalDigest &&
      existing.request_assertion.quoteDigest === input.quoteDigest &&
      ((input.initiatorPostId === existing.demand_post_id &&
        input.counterpartPostId === existing.provider_post_id) ||
        (input.initiatorPostId === existing.provider_post_id &&
          input.counterpartPostId === existing.demand_post_id));
    if (!same) {
      return { ok: false, errorKey: MATCH_REQUEST_ERROR.idempotencyConflict, state: next };
    }
    return {
      ok: true,
      state: next,
      row: {
        request_id: existing.id,
        revision_id: existing.current_revision_id,
        invitation_id: existing.invitation_id,
        request_status: existing.status,
        revision_status: "current",
        expires_at: existing.expires_at,
        effective_client_request_id: existing.client_request_id,
        effective_client_revision_id: input.clientRevisionId,
        created: false,
      },
    };
  }
  if (!next.config.matching_request_creation_enabled) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.creationDisabled, state: next };
  }
  if (!quoteIsLegal(input.quote)) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.pricingNotReady, state: next };
  }
  const initiator = next.posts.find((post) => post.id === input.initiatorPostId);
  const counterpart = next.posts.find((post) => post.id === input.counterpartPostId);
  if (!initiator || !counterpart) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.postNotFound, state: next };
  }
  if (initiator.user_id !== input.actorUserId) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.postNotOwned, state: next };
  }
  if (counterpart.user_id === input.actorUserId) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.selfNotAllowed, state: next };
  }
  if (initiator.status !== "active" || counterpart.status !== "active") {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.postUnavailable, state: next };
  }
  if (
    !(
      (initiator.post_type === "demand" && counterpart.post_type === "provider") ||
      (initiator.post_type === "provider" && counterpart.post_type === "demand")
    )
  ) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.roleMismatch, state: next };
  }
  if (initiator.category !== counterpart.category) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.categoryMismatch, state: next };
  }
  if (initiator.category !== "travel" && initiator.category !== "deliver") {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.categoryNotSupported, state: next };
  }
  if (
    input.admissionDigest &&
    input.admissionDigest !== matchAdmissionDigestHex(initiator, counterpart)
  ) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.notEligible, state: next };
  }
  const profile = next.profiles.find((row) => row.id === input.actorUserId);
  if (!profile || profile.phone.trim() === "") {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.phoneRequired, state: next };
  }
  const channels = ["phone"];
  if (input.whatsappAvailable) channels.push("whatsapp");
  if (input.viberAvailable) channels.push("viber");
  if (!channels.includes(input.contactPreference)) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.contactChannelInvalid, state: next };
  }
  const demandId = initiator.post_type === "demand" ? initiator.id : counterpart.id;
  const providerId = initiator.post_type === "provider" ? initiator.id : counterpart.id;
  const nowMs = Date.parse(next.now);
  const pending = next.requests.find(
    (row) =>
      row.demand_post_id === demandId &&
      row.provider_post_id === providerId &&
      row.status === "pending",
  );
  if (pending) {
    if (Date.parse(pending.expires_at) <= nowMs) {
      pending.status = "expired";
    } else {
      return { ok: false, errorKey: MATCH_REQUEST_ERROR.alreadyOpen, state: next };
    }
  }
  const openCount = next.requests.filter(
    (row) =>
      row.requester_user_id === input.actorUserId &&
      row.status === "pending" &&
      Date.parse(row.expires_at) > nowMs &&
      (row.demand_post_id === input.initiatorPostId ||
        row.provider_post_id === input.initiatorPostId),
  ).length;
  if (openCount >= next.config.matching_request_max_open_per_initiator_post) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.openLimit, state: next };
  }
  const created24h = next.requests.filter(
    (row) =>
      row.requester_user_id === input.actorUserId &&
      Date.parse(row.created_at) >= nowMs - 24 * 60 * 60 * 1000,
  ).length;
  if (created24h >= next.config.matching_request_max_created_per_actor_24h) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.rateLimit, state: next };
  }
  const expiresAt = new Date(
    nowMs + next.config.matching_request_ttl_minutes * 60_000,
  ).toISOString();
  const invitationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const revisionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  next.invitations.push({
    id: invitationId,
    demand_post_id: demandId,
    provider_post_id: providerId,
    initiator_user_id: input.actorUserId,
    recipient_user_id: counterpart.user_id,
    initiator_post_id: input.initiatorPostId,
    status: "open",
    contact_code_hash: input.contactCodeHash,
    client_request_id: input.clientRequestId,
    disclosure_mode: "recipient_contacts_initiator",
    expires_at: expiresAt,
  });
  next.requests.push({
    id: requestId,
    invitation_id: invitationId,
    demand_post_id: demandId,
    provider_post_id: providerId,
    requester_user_id: input.actorUserId,
    recipient_user_id: counterpart.user_id,
    client_request_id: input.clientRequestId,
    status: "pending",
    expires_at: expiresAt,
    created_at: next.now,
    updated_at: next.now,
    current_revision_id: revisionId,
    accepted_revision_id: null,
    request_assertion: {
      admissionDigest: input.admissionDigest,
      proposalDigest: input.proposalDigest,
      quoteDigest: input.quoteDigest,
    },
  });
  next.revisions.push({
    id: revisionId,
    request_id: requestId,
    revision_no: 1,
    status: "current",
    client_revision_id: input.clientRevisionId,
    proposal_payload: input.proposal,
    contact_preference: input.contactPreference,
  });
  next.grants.push({
    invitation_id: invitationId,
    subject_user_id: input.actorUserId,
    viewer_user_id: counterpart.user_id,
    allowed_channels: channels,
    preferred_channel: input.contactPreference,
    expires_at: expiresAt,
  });
  return {
    ok: true,
    state: next,
    row: {
      request_id: requestId,
      revision_id: revisionId,
      invitation_id: invitationId,
      request_status: "pending",
      revision_status: "current",
      expires_at: expiresAt,
      effective_client_request_id: input.clientRequestId,
      effective_client_revision_id: input.clientRevisionId,
      created: true,
    },
  };
}
