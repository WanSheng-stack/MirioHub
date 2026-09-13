/**
 * PHASE 6.7C.1B.2 — match-request parse, sparse locations, stable idempotency.
 * Pure helpers. Not a live PostgreSQL run. TS admission-fact JSON is a
 * contract mirror for collision tests, not a PostgreSQL MVCC proof.
 */

import { createHash } from "node:crypto";
import {
  isContactCodeHash,
  isUuid,
} from "@/lib/matching/contactInvitationCodeCore";
import {
  evaluateMatchAdmission,
  validateProposedSchedule,
  type MatchAdmissionPost,
  type MatchAdmissionRouteScore,
  type MatchAdmissionRouteThresholds,
} from "@/lib/matching/matchAdmissionPolicy";
import { parseStoredPhone } from "@/lib/phone/phoneNumber";
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
  notCurrent: "error.match_request_not_current",
  inconsistentState: "error.match_request_inconsistent_state",
  notEligible: "error.match_request_not_eligible",
  creationDisabled: "error.match_request_creation_disabled",
  pricingNotReady: "error.match_request_pricing_not_ready",
  locationOverrideNotReady: "error.match_request_location_override_not_ready",
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
  locationOverrideNotReady: "[match-request] location override not ready",
} as const;

const HIGH_RISK_KEYS = [
  "phone",
  "email",
  "plate",
  "plusCode",
  "plus_code",
  "mapUrl",
  "map_url",
  "gps",
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
  "__proto__",
  "constructor",
  "prototype",
] as const;

const TRAVEL_PROPOSAL_KEYS = [
  "category",
  "proposedDate",
  "proposedTimeWindow",
  "pickup",
  "dropoff",
  "bumpTierId",
  "note",
] as const;
const DELIVER_PROPOSAL_KEYS = [
  "category",
  "proposedDate",
  "proposedTimeWindow",
  "pickup",
  "delivery",
  "bumpTierId",
  "note",
] as const;
const LOCATION_CHOICE_KEYS = ["mode", "location"] as const;
const RESOLVED_LOCATION_KEYS = [
  "locationVersion",
  "displayLabel",
  "latitude",
  "longitude",
  "precision",
  "timezoneName",
] as const;
const PRECISIONS = ["locality", "district", "approximate", "precise"] as const;
const IANA_RE =
  /^(UTC|[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+)+)$/;
const BUMP_TIER_RE = /^[a-z0-9][a-z0-9_.:-]*$/;
const STORED_PHONE_RE = /^[1-9][0-9]{7,14}$/;

export type ContactPreference = "phone" | "whatsapp" | "viber";
export type LocationPrecision = (typeof PRECISIONS)[number];

export type ResolvedRequestLocationV1 = {
  locationVersion: 1;
  displayLabel: string;
  latitude: number;
  longitude: number;
  precision: LocationPrecision;
  timezoneName: string;
};

export type RequestLocationChoiceV1 =
  | { mode: "demand_post_default" }
  | { mode: "override"; location: ResolvedRequestLocationV1 };

export type TravelMatchRequestProposalV1 = {
  category: "travel";
  proposedDate: string;
  proposedTimeWindow: string;
  pickup: RequestLocationChoiceV1;
  dropoff: RequestLocationChoiceV1;
  bumpTierId?: string;
  note?: string;
};

export type DeliverMatchRequestProposalV1 = {
  category: "deliver";
  proposedDate: string;
  proposedTimeWindow: string;
  pickup: RequestLocationChoiceV1;
  delivery: RequestLocationChoiceV1;
  bumpTierId?: string;
  note?: string;
};

export type MatchRequestProposalInput =
  | TravelMatchRequestProposalV1
  | DeliverMatchRequestProposalV1;

export type CanonicalProposal =
  | {
      category: "travel";
      proposedDate: string;
      proposedTimeWindow: string;
      pickup: RequestLocationChoiceV1;
      dropoff: RequestLocationChoiceV1;
      bumpTierId: string | null;
      note: string | null;
    }
  | {
      category: "deliver";
      proposedDate: string;
      proposedTimeWindow: string;
      pickup: RequestLocationChoiceV1;
      delivery: RequestLocationChoiceV1;
      bumpTierId: string | null;
      note: string | null;
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

export type TrustedLocationResolver = (
  choice: RequestLocationChoiceV1,
) => ResolvedRequestLocationV1 | null;

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

function parseFail(
  errorKey: string = MATCH_REQUEST_ERROR.invalidInput,
): { ok: false; status: 400; errorKey: string } {
  return { ok: false, status: 400, errorKey };
}

export function isCanonicalStoredPhone(value: string | null | undefined): boolean {
  if (typeof value !== "string" || !STORED_PHONE_RE.test(value)) return false;
  const parsed = parseStoredPhone(value);
  return parsed.valid && parsed.normalizedDigits === value;
}

export function parseMatchRequestCreateBody(
  body: unknown,
):
  | { ok: true; value: MatchRequestCreateInput }
  | { ok: false; status: 400; errorKey: string } {
  if (!isPlainObject(body)) return parseFail();
  if (containsHighRiskKey(body)) {
    return parseFail(MATCH_REQUEST_ERROR.unknownKey);
  }
  for (const key of Object.keys(body)) {
    if (!(MATCH_REQUEST_BODY_KEYS as readonly string[]).includes(key)) {
      return parseFail(MATCH_REQUEST_ERROR.unknownKey);
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
    return parseFail();
  }
  if (
    contactPreference !== "phone" &&
    contactPreference !== "whatsapp" &&
    contactPreference !== "viber"
  ) {
    return parseFail();
  }
  if (typeof whatsappAvailable !== "boolean" || typeof viberAvailable !== "boolean") {
    return parseFail();
  }
  const parsedProposal = parseProposal(proposal);
  if (!parsedProposal.ok) return parsedProposal;
  const preferredAllowed =
    contactPreference === "phone" ||
    (contactPreference === "whatsapp" && whatsappAvailable) ||
    (contactPreference === "viber" && viberAvailable);
  if (!preferredAllowed) {
    return parseFail(MATCH_REQUEST_ERROR.contactChannelInvalid);
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
  if (!isPlainObject(value)) return parseFail();
  if (containsHighRiskKey(value)) return parseFail(MATCH_REQUEST_ERROR.unknownKey);
  const category = value.category;
  const allowed =
    category === "travel"
      ? TRAVEL_PROPOSAL_KEYS
      : category === "deliver"
        ? DELIVER_PROPOSAL_KEYS
        : null;
  if (!allowed) {
    return parseFail(MATCH_REQUEST_ERROR.categoryNotSupported);
  }
  for (const key of Object.keys(value)) {
    if (!(allowed as readonly string[]).includes(key)) {
      return parseFail(MATCH_REQUEST_ERROR.unknownKey);
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
    return parseFail();
  }
  const pickup = parseLocationChoice(value.pickup);
  if (!pickup.ok) return pickup;
  const bump = parseOptionalBump(value.bumpTierId);
  if (!bump.ok) return bump;
  const note = parseOptionalNote(value.note);
  if (!note.ok) return note;
  if (category === "travel") {
    const dropoff = parseLocationChoice(value.dropoff);
    if (!dropoff.ok) return dropoff;
    return {
      ok: true,
      value: {
        category: "travel",
        proposedDate: value.proposedDate,
        proposedTimeWindow: value.proposedTimeWindow,
        pickup: pickup.value,
        dropoff: dropoff.value,
        ...(bump.value != null ? { bumpTierId: bump.value } : {}),
        ...(note.value != null ? { note: note.value } : {}),
      },
    };
  }
  const delivery = parseLocationChoice(value.delivery);
  if (!delivery.ok) return delivery;
  return {
    ok: true,
    value: {
      category: "deliver",
      proposedDate: value.proposedDate,
      proposedTimeWindow: value.proposedTimeWindow,
      pickup: pickup.value,
      delivery: delivery.value,
      ...(bump.value != null ? { bumpTierId: bump.value } : {}),
      ...(note.value != null ? { note: note.value } : {}),
    },
  };
}

export function parseLocationChoice(
  value: unknown,
):
  | { ok: true; value: RequestLocationChoiceV1 }
  | { ok: false; status: 400; errorKey: string } {
  if (!isPlainObject(value)) return parseFail();
  if (containsHighRiskKey(value)) return parseFail(MATCH_REQUEST_ERROR.unknownKey);
  for (const key of Object.keys(value)) {
    if (!(LOCATION_CHOICE_KEYS as readonly string[]).includes(key)) {
      return parseFail(MATCH_REQUEST_ERROR.unknownKey);
    }
  }
  if (value.mode === "demand_post_default") {
    if ("location" in value) return parseFail();
    return { ok: true, value: { mode: "demand_post_default" } };
  }
  if (value.mode === "override") {
    const location = parseResolvedLocation(value.location);
    if (!location.ok) return location;
    return { ok: true, value: { mode: "override", location: location.value } };
  }
  return parseFail();
}

function parseResolvedLocation(
  value: unknown,
):
  | { ok: true; value: ResolvedRequestLocationV1 }
  | { ok: false; status: 400; errorKey: string } {
  if (!isPlainObject(value)) return parseFail();
  if (containsHighRiskKey(value)) return parseFail(MATCH_REQUEST_ERROR.unknownKey);
  for (const key of Object.keys(value)) {
    if (!(RESOLVED_LOCATION_KEYS as readonly string[]).includes(key)) {
      return parseFail(MATCH_REQUEST_ERROR.unknownKey);
    }
  }
  if (value.locationVersion !== 1 || !Number.isSafeInteger(value.locationVersion)) {
    return parseFail();
  }
  if (
    typeof value.latitude !== "number" ||
    typeof value.longitude !== "number" ||
    !Number.isFinite(value.latitude) ||
    !Number.isFinite(value.longitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    value.longitude < -180 ||
    value.longitude > 180
  ) {
    return parseFail();
  }
  if (typeof value.displayLabel !== "string" || typeof value.timezoneName !== "string") {
    return parseFail();
  }
  const displayLabel = value.displayLabel.trim();
  const timezoneName = value.timezoneName.trim();
  if (
    displayLabel.length < 1 ||
    displayLabel.length > 200 ||
    timezoneName.length < 1 ||
    timezoneName.length > 100 ||
    !IANA_RE.test(timezoneName)
  ) {
    return parseFail();
  }
  if (!(PRECISIONS as readonly string[]).includes(String(value.precision))) {
    return parseFail();
  }
  return {
    ok: true,
    value: {
      locationVersion: 1,
      displayLabel,
      latitude: value.latitude,
      longitude: value.longitude,
      precision: value.precision as LocationPrecision,
      timezoneName,
    },
  };
}

function parseOptionalBump(
  value: unknown,
):
  | { ok: true; value: string | undefined }
  | { ok: false; status: 400; errorKey: string } {
  if (value == null) return { ok: true, value: undefined };
  if (typeof value !== "string") return parseFail();
  const trimmed = value.trim();
  if (trimmed === "") return parseFail();
  if (trimmed.length > 50 || !BUMP_TIER_RE.test(trimmed)) return parseFail();
  return { ok: true, value: trimmed };
}

function parseOptionalNote(
  value: unknown,
):
  | { ok: true; value: string | undefined }
  | { ok: false; status: 400; errorKey: string } {
  if (value == null) return { ok: true, value: undefined };
  if (typeof value !== "string") return parseFail();
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: undefined };
  if (trimmed.length > 500) return parseFail();
  return { ok: true, value: trimmed };
}

export function canonicalizeBrowserProposal(
  proposal: MatchRequestProposalInput,
): CanonicalProposal {
  const bump = proposal.bumpTierId?.trim() ? proposal.bumpTierId.trim() : null;
  const note = proposal.note?.trim() ? proposal.note.trim() : null;
  if (proposal.category === "travel") {
    return {
      category: "travel",
      proposedDate: proposal.proposedDate,
      proposedTimeWindow: proposal.proposedTimeWindow,
      pickup: proposal.pickup,
      dropoff: proposal.dropoff,
      bumpTierId: bump,
      note,
    };
  }
  return {
    category: "deliver",
    proposedDate: proposal.proposedDate,
    proposedTimeWindow: proposal.proposedTimeWindow,
    pickup: proposal.pickup,
    delivery: proposal.delivery,
    bumpTierId: bump,
    note,
  };
}

export function proposalHasOverride(proposal: CanonicalProposal): boolean {
  if (proposal.pickup.mode === "override") return true;
  if (proposal.category === "travel") return proposal.dropoff.mode === "override";
  return proposal.delivery.mode === "override";
}

export function demandDefaultLocation(): RequestLocationChoiceV1 {
  return { mode: "demand_post_default" };
}

export function quoteIsLegal(
  quote: ServerMatchRequestQuote | null,
): quote is ServerMatchRequestQuote {
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

function stableLocation(choice: RequestLocationChoiceV1): unknown {
  if (choice.mode === "demand_post_default") return { mode: "demand_post_default" };
  return {
    mode: "override",
    location: {
      locationVersion: choice.location.locationVersion,
      displayLabel: choice.location.displayLabel,
      latitude: choice.location.latitude,
      longitude: choice.location.longitude,
      precision: choice.location.precision,
      timezoneName: choice.location.timezoneName,
    },
  };
}

export function stableCanonicalProposal(proposal: CanonicalProposal): string {
  if (proposal.category === "travel") {
    return JSON.stringify({
      category: "travel",
      proposedDate: proposal.proposedDate,
      proposedTimeWindow: proposal.proposedTimeWindow,
      pickup: stableLocation(proposal.pickup),
      dropoff: stableLocation(proposal.dropoff),
      bumpTierId: proposal.bumpTierId,
      note: proposal.note,
    });
  }
  return JSON.stringify({
    category: "deliver",
    proposedDate: proposal.proposedDate,
    proposedTimeWindow: proposal.proposedTimeWindow,
    pickup: stableLocation(proposal.pickup),
    delivery: stableLocation(proposal.delivery),
    bumpTierId: proposal.bumpTierId,
    note: proposal.note,
  });
}

export function computeIdempotencyPayloadHash(input: {
  actorUserId: string;
  initiatorPostId: string;
  counterpartPostId: string;
  clientRequestId: string;
  clientRevisionId: string;
  proposal: CanonicalProposal;
  contactPreference: ContactPreference;
  whatsappAvailable: boolean;
  viberAvailable: boolean;
  contactCodeHash: string;
}): string {
  const payload = [
    input.actorUserId,
    input.initiatorPostId,
    input.counterpartPostId,
    input.clientRequestId,
    input.clientRevisionId,
    stableCanonicalProposal(input.proposal),
    input.contactPreference,
    input.whatsappAvailable ? "true" : "false",
    input.viberAvailable ? "true" : "false",
    input.contactCodeHash,
  ].join("\n");
  return createHash("sha256").update(payload, "utf8").digest("hex");
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

export function compositeRevisionPointerHolds(input: {
  requestId: string;
  pointerRevisionId: string | null;
  revisionId: string;
  revisionRequestId: string;
}): boolean {
  if (input.pointerRevisionId == null) return true;
  return (
    input.pointerRevisionId === input.revisionId &&
    input.requestId === input.revisionRequestId
  );
}

export const ADMISSION_FACT_JSON_KEYS = [
  "id",
  "user_id",
  "post_type",
  "category",
  "status",
  "departure_date",
  "departure_time_window",
  "service_time_window",
  "transport_mode",
  "escort_seats",
  "max_companions",
  "count_small",
  "count_medium",
  "count_large",
  "count_xlarge",
  "origin_address",
  "destination_address",
  "waypoints",
  "origin_gps_ewkb",
  "destination_gps_ewkb",
] as const;

/**
 * Mirrors SQL jsonb_build_object keys for collision tests.
 * Not a PostgreSQL jsonb::text byte match and not an MVCC proof.
 */
export function buildAdmissionPostFact(
  post: MatchAdmissionPost,
): Record<(typeof ADMISSION_FACT_JSON_KEYS)[number], unknown> {
  return {
    id: post.id,
    user_id: post.user_id,
    post_type: post.post_type,
    category: post.category,
    status: post.status,
    departure_date: post.departure_date ?? null,
    departure_time_window: post.departure_time_window ?? null,
    service_time_window: post.service_time_window ?? null,
    transport_mode: post.transport_mode ?? null,
    escort_seats: post.escort_seats ?? null,
    max_companions: post.max_companions ?? null,
    count_small: post.count_small ?? null,
    count_medium: post.count_medium ?? null,
    count_large: post.count_large ?? null,
    count_xlarge: post.count_xlarge ?? null,
    origin_address: post.origin_address ?? null,
    destination_address: post.destination_address ?? null,
    waypoints: post.waypoints ?? null,
    origin_gps_ewkb: post.origin_gps_ewkb ?? null,
    destination_gps_ewkb: post.destination_gps_ewkb ?? null,
  };
}

/** SQL snapshot WHERE contract only. Not a live PostgreSQL execution. */
export function snapshotPairQueryAccepts(input: {
  leftId: string | null;
  rightId: string | null;
  foundIds: string[];
}): boolean {
  if (input.leftId == null || input.rightId == null) return false;
  if (input.leftId === input.rightId) return false;
  const unique = new Set(input.foundIds);
  return (
    unique.size === 2 &&
    unique.has(input.leftId) &&
    unique.has(input.rightId)
  );
}

export function hashAdmissionFactsPair(
  left: MatchAdmissionPost,
  right: MatchAdmissionPost,
): string {
  const facts = [buildAdmissionPostFact(left), buildAdmissionPostFact(right)].sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  );
  return createHash("sha256").update(JSON.stringify(facts), "utf8").digest("hex");
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
    case MATCH_REQUEST_ERROR.notCurrent:
    case MATCH_REQUEST_ERROR.postUnavailable:
    case MATCH_REQUEST_ERROR.notEligible:
    case MATCH_REQUEST_ERROR.roleMismatch:
    case MATCH_REQUEST_ERROR.categoryMismatch:
    case MATCH_REQUEST_ERROR.categoryNotSupported:
    case MATCH_REQUEST_ERROR.creationDisabled:
    case MATCH_REQUEST_ERROR.pricingNotReady:
    case MATCH_REQUEST_ERROR.locationOverrideNotReady:
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
  return match ??
    (message.includes("error.server_configuration")
      ? MATCH_REQUEST_ERROR.serverConfiguration
      : null);
}

export type SimulatedPost = MatchAdmissionPost;
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
  invalidated_at: string | null;
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
  idempotency_payload_hash: string;
};
export type SimulatedRevision = {
  id: string;
  request_id: string;
  revision_no: number;
  status: string;
  client_revision_id: string;
  proposal_payload: CanonicalProposal;
  quote: ServerMatchRequestQuote;
  contact_preference: ContactPreference;
};
export type SimulatedGrant = {
  invitation_id: string;
  subject_user_id: string;
  viewer_user_id: string;
  allowed_channels: string[];
  preferred_channel: string;
  expires_at: string;
  revoked_at: string | null;
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
    idempotencyPayloadHash: string;
    admissionFactsHash: string;
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
    !isContactCodeHash(input.contactCodeHash) ||
    !/^[0-9a-f]{64}$/.test(input.idempotencyPayloadHash)
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
    if (!inv || !rev || rev.request_id !== existing.id) {
      return { ok: false, errorKey: MATCH_REQUEST_ERROR.inconsistentState, state: next };
    }
    const same =
      existing.idempotency_payload_hash === input.idempotencyPayloadHash &&
      rev.client_revision_id === input.clientRevisionId &&
      inv.contact_code_hash === input.contactCodeHash &&
      ((input.initiatorPostId === existing.demand_post_id &&
        input.counterpartPostId === existing.provider_post_id) ||
        (input.initiatorPostId === existing.provider_post_id &&
          input.counterpartPostId === existing.demand_post_id));
    if (!same) {
      return { ok: false, errorKey: MATCH_REQUEST_ERROR.idempotencyConflict, state: next };
    }
    const open =
      existing.status === "pending" &&
      rev.status === "current" &&
      Date.parse(existing.expires_at) > Date.parse(next.now) &&
      Date.parse(rev.status === "current" ? existing.expires_at : existing.expires_at) >
        Date.parse(next.now);
    if (!open) {
      return { ok: false, errorKey: MATCH_REQUEST_ERROR.notCurrent, state: next };
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
  if (proposalHasOverride(input.proposal)) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.locationOverrideNotReady, state: next };
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
    !/^[0-9a-f]{64}$/.test(input.admissionFactsHash) ||
    input.admissionFactsHash !== hashAdmissionFactsPair(initiator, counterpart)
  ) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.notEligible, state: next };
  }
  const profile = next.profiles.find((row) => row.id === input.actorUserId);
  if (!profile || !isCanonicalStoredPhone(profile.phone)) {
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
      const expired = expireOpenPair(next, pending, nowMs);
      if (!expired.ok) return expired;
    } else {
      return { ok: false, errorKey: MATCH_REQUEST_ERROR.alreadyOpen, state: next };
    }
  }
  const openInv = next.invitations.find(
    (row) =>
      row.demand_post_id === demandId &&
      row.provider_post_id === providerId &&
      row.status === "open",
  );
  if (openInv) {
    const linked = next.requests.find((row) => row.invitation_id === openInv.id);
    if (!linked || linked.status !== "expired") {
      return { ok: false, errorKey: MATCH_REQUEST_ERROR.inconsistentState, state: next };
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
    invalidated_at: null,
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
    idempotency_payload_hash: input.idempotencyPayloadHash,
  });
  next.revisions.push({
    id: revisionId,
    request_id: requestId,
    revision_no: 1,
    status: "current",
    client_revision_id: input.clientRevisionId,
    proposal_payload: input.proposal,
    quote: input.quote,
    contact_preference: input.contactPreference,
  });
  next.grants.push({
    invitation_id: invitationId,
    subject_user_id: input.actorUserId,
    viewer_user_id: counterpart.user_id,
    allowed_channels: channels,
    preferred_channel: input.contactPreference,
    expires_at: expiresAt,
    revoked_at: null,
  });
  if (
    !compositeRevisionPointerHolds({
      requestId,
      pointerRevisionId: revisionId,
      revisionId,
      revisionRequestId: requestId,
    })
  ) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.inconsistentState, state: next };
  }
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

function expireOpenPair(
  next: SimulatedWriterState,
  pending: SimulatedRequest,
  nowMs: number,
):
  | { ok: true }
  | { ok: false; errorKey: string; state: SimulatedWriterState } {
  const rev = next.revisions.find((row) => row.id === pending.current_revision_id);
  const inv = next.invitations.find((row) => row.id === pending.invitation_id);
  const grant = next.grants.find((row) => row.invitation_id === pending.invitation_id);
  if (!rev || rev.request_id !== pending.id || !inv || inv.id !== pending.invitation_id || !grant) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.inconsistentState, state: next };
  }
  if (
    inv.demand_post_id !== pending.demand_post_id ||
    inv.provider_post_id !== pending.provider_post_id
  ) {
    return { ok: false, errorKey: MATCH_REQUEST_ERROR.inconsistentState, state: next };
  }
  rev.status = "expired";
  pending.status = "expired";
  inv.status = "expired";
  inv.invalidated_at = next.now;
  if (grant.revoked_at == null || Date.parse(grant.revoked_at) > nowMs) {
    grant.revoked_at = next.now;
  }
  return { ok: true };
}
