/**
 * PHASE 6.7C.1 — contact invitation input, HTTP mapping, and writer simulation.
 * Not a live PostgreSQL run. The route calls the v95 RPC after this helper
 * accepts the body and session. Future contact-grant / match-request writers
 * must not reuse this helper as authorization for phone disclosure.
 */

import {
  generateContactInvitationCode,
  isContactCodeHash,
  isUuid,
  pepperIsUsable,
  type ContactInvitationCodePair,
} from "@/lib/matching/contactInvitationCodeCore";
import {
  evaluateContactInvitationBaseEligibility,
  evaluateContactInvitationEligibility,
  type ContactInvitationEligibilityPost,
} from "@/lib/matching/contactInvitationEligibilityCore";
import {
  matchAdmissionDigestHex,
  type MatchAdmissionRouteScore,
  type MatchAdmissionRouteThresholds,
} from "@/lib/matching/matchAdmissionPolicy";

export const CONTACT_INVITATION_BODY_KEYS = [
  "initiatorPostId",
  "counterpartPostId",
  "clientRequestId",
] as const;

export const CONTACT_INVITATION_ERROR = {
  unknownKey: "error.match_contact_invitation_unknown_key",
  invalidInput: "error.match_contact_invitation_invalid_input",
  authenticationRequired: "error.authentication_required",
  submitFailed: "error.submit_failed",
  serverConfiguration: "error.server_configuration",
  postNotFound: "error.match_contact_post_not_found",
  postNotOwned: "error.match_contact_post_not_owned",
  selfNotAllowed: "error.match_contact_self_not_allowed",
  postUnavailable: "error.match_contact_post_unavailable",
  roleMismatch: "error.match_contact_role_mismatch",
  categoryMismatch: "error.match_contact_category_mismatch",
  alreadyOpen: "error.match_contact_invitation_already_open",
  idempotencyConflict: "error.match_contact_invitation_idempotency_conflict",
  notEligible: "error.match_contact_not_eligible",
  openLimit: "error.match_contact_invitation_open_limit",
  rateLimit: "error.match_contact_invitation_rate_limit",
} as const;

export const MATCH_CONTACT_INVITATION_STATUSES = [
  "open",
  "converted",
  "invalidated",
  "expired",
  "blocked",
] as const;

export const MATCH_CONTACT_DISCLOSURE_MODES = [
  "mutual_eligible_contact",
  "recipient_contacts_initiator",
] as const;

export const CONTACT_INVITATION_ERROR_KEYS = Object.values(
  CONTACT_INVITATION_ERROR,
);

export const CONTACT_INVITATION_SAFE_LOGS = {
  authLookupFailed: "[contact-invitation] auth lookup failed",
  serverConfigurationMissing: "[contact-invitation] server configuration missing",
  codeGenerationFailed: "[contact-invitation] code generation failed",
  writerFailed: "[contact-invitation] writer failed",
  writerResponseInvalid: "[contact-invitation] writer response invalid",
  eligibilityFailed: "[contact-invitation] eligibility failed",
  invitationLimitReached: "[contact-invitation] invitation limit reached",
} as const;

export type ContactInvitationCreateInput = {
  initiatorPostId: string;
  counterpartPostId: string;
  clientRequestId: string;
};

export type ContactInvitationParseResult =
  | { ok: true; value: ContactInvitationCreateInput }
  | { ok: false; status: 400; errorKey: string };

export type ContactInvitationSuccessJson = {
  ok: true;
  invitation: {
    id: string;
    status: string;
    contactCode: string;
    expiresAt: string;
    created: boolean;
  };
};

export type ContactInvitationErrorJson = {
  ok: false;
  errorKey: string;
};

export type ContactInvitationRouteResult = {
  status: number;
  json: ContactInvitationSuccessJson | ContactInvitationErrorJson;
  logs: string[];
  adminCreated: boolean;
  writerCalled: boolean;
  routeScored: boolean;
  codeGenerated: boolean;
};

export type ContactInvitationInspectRow = {
  existing_for_client_request: boolean;
  open_count: number;
  created_24h_count: number;
  max_open: number;
  max_created_24h: number;
};

/**
 * inspect is a non-atomic cost hint only.
 * It must never authorize a success response or fabricate a writer row.
 * create_match_contact_invitation_v95 is the only success authority.
 */

export function invitationPairMatchesRequest(input: {
  initiatorPostId: string;
  counterpartPostId: string;
  existingInitiatorPostId: string;
  existingDemandPostId: string;
  existingProviderPostId: string;
}): boolean {
  if (input.existingInitiatorPostId !== input.initiatorPostId) return false;
  return (
    (input.initiatorPostId === input.existingDemandPostId &&
      input.counterpartPostId === input.existingProviderPostId) ||
    (input.initiatorPostId === input.existingProviderPostId &&
      input.counterpartPostId === input.existingDemandPostId)
  );
}

export type ContactInvitationWriterRow = {
  invitation_id: string;
  invitation_status: string;
  disclosure_mode: string;
  expires_at: string;
  effective_client_request_id: string;
  created: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function parseContactInvitationCreateBody(
  body: unknown,
): ContactInvitationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      status: 400,
      errorKey: CONTACT_INVITATION_ERROR.invalidInput,
    };
  }
  const keys = Object.keys(body);
  for (const key of keys) {
    if (
      !(CONTACT_INVITATION_BODY_KEYS as readonly string[]).includes(key)
    ) {
      return {
        ok: false,
        status: 400,
        errorKey: CONTACT_INVITATION_ERROR.unknownKey,
      };
    }
  }
  const initiatorPostId = body.initiatorPostId;
  const counterpartPostId = body.counterpartPostId;
  const clientRequestId = body.clientRequestId;
  if (
    typeof initiatorPostId !== "string" ||
    typeof counterpartPostId !== "string" ||
    typeof clientRequestId !== "string" ||
    !isUuid(initiatorPostId) ||
    !isUuid(counterpartPostId) ||
    !isUuid(clientRequestId)
  ) {
    return {
      ok: false,
      status: 400,
      errorKey: CONTACT_INVITATION_ERROR.invalidInput,
    };
  }
  return {
    ok: true,
    value: { initiatorPostId, counterpartPostId, clientRequestId },
  };
}

export function httpStatusForContactInvitationError(errorKey: string): number {
  switch (errorKey) {
    case CONTACT_INVITATION_ERROR.unknownKey:
    case CONTACT_INVITATION_ERROR.invalidInput:
    case CONTACT_INVITATION_ERROR.roleMismatch:
    case CONTACT_INVITATION_ERROR.categoryMismatch:
      return 400;
    case CONTACT_INVITATION_ERROR.authenticationRequired:
      return 401;
    case CONTACT_INVITATION_ERROR.postNotOwned:
    case CONTACT_INVITATION_ERROR.selfNotAllowed:
      return 403;
    case CONTACT_INVITATION_ERROR.postNotFound:
      return 404;
    case CONTACT_INVITATION_ERROR.alreadyOpen:
    case CONTACT_INVITATION_ERROR.idempotencyConflict:
    case CONTACT_INVITATION_ERROR.postUnavailable:
    case CONTACT_INVITATION_ERROR.notEligible:
      return 409;
    case CONTACT_INVITATION_ERROR.openLimit:
    case CONTACT_INVITATION_ERROR.rateLimit:
      return 429;
    case CONTACT_INVITATION_ERROR.serverConfiguration:
    case CONTACT_INVITATION_ERROR.submitFailed:
    default:
      return 500;
  }
}

export function extractWriterErrorKey(message: string): string | null {
  const match = message.match(/error\.[a-z0-9_]+/);
  if (!match) return null;
  return CONTACT_INVITATION_ERROR_KEYS.includes(
    match[0] as (typeof CONTACT_INVITATION_ERROR_KEYS)[number],
  )
    ? match[0]
    : null;
}

export function isIsoTimestamptz(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

export function interpretContactInvitationWriterRow(
  row: ContactInvitationWriterRow | null | undefined,
  clientRequestId: string,
):
  | { ok: true; row: ContactInvitationWriterRow }
  | { ok: false; errorKey: string; status: number } {
  if (
    row == null ||
    typeof row.invitation_id !== "string" ||
    !isUuid(row.invitation_id) ||
    typeof row.invitation_status !== "string" ||
    !(MATCH_CONTACT_INVITATION_STATUSES as readonly string[]).includes(
      row.invitation_status,
    ) ||
    typeof row.disclosure_mode !== "string" ||
    !(MATCH_CONTACT_DISCLOSURE_MODES as readonly string[]).includes(
      row.disclosure_mode,
    ) ||
    typeof row.expires_at !== "string" ||
    !isIsoTimestamptz(row.expires_at) ||
    typeof row.effective_client_request_id !== "string" ||
    !isUuid(row.effective_client_request_id) ||
    typeof row.created !== "boolean"
  ) {
    return {
      ok: false,
      errorKey: CONTACT_INVITATION_ERROR.submitFailed,
      status: 500,
    };
  }
  if (row.effective_client_request_id !== clientRequestId) {
    return {
      ok: false,
      errorKey: CONTACT_INVITATION_ERROR.alreadyOpen,
      status: 409,
    };
  }
  return { ok: true, row };
}

export type ContactInvitationRouteDeps = {
  readBody: () => Promise<unknown>;
  getUser: () => Promise<string | null>;
  readPepper: () => string | null;
  generateCode: (
    actorUserId: string,
    clientRequestId: string,
  ) => ContactInvitationCodePair;
  createAdmin: () => unknown;
  inspect: (
    admin: unknown,
    args: {
      actorUserId: string;
      initiatorPostId: string;
      clientRequestId: string;
    },
  ) => Promise<ContactInvitationInspectRow>;
  loadPosts: (
    admin: unknown,
    ids: { initiatorPostId: string; counterpartPostId: string },
  ) => Promise<{
    initiator: ContactInvitationEligibilityPost | null;
    counterpart: ContactInvitationEligibilityPost | null;
  }>;
  scoreRoute: (
    initiator: ContactInvitationEligibilityPost,
    counterpart: ContactInvitationEligibilityPost,
  ) => Promise<MatchAdmissionRouteScore>;
  loadThresholds: (
    admin: unknown,
  ) => Promise<MatchAdmissionRouteThresholds | null>;
  callWriter: (
    admin: unknown,
    args: {
      actorUserId: string;
      initiatorPostId: string;
      counterpartPostId: string;
      clientRequestId: string;
      contactCodeHash: string;
      admissionDigest: string;
    },
  ) => Promise<ContactInvitationWriterRow>;
  nowIso?: () => string;
};

function fail(
  status: number,
  errorKey: string,
  logs: string[] = [],
  flags: {
    adminCreated?: boolean;
    writerCalled?: boolean;
    routeScored?: boolean;
    codeGenerated?: boolean;
  } = {},
): ContactInvitationRouteResult {
  return {
    status,
    json: { ok: false, errorKey },
    logs,
    adminCreated: flags.adminCreated ?? false,
    writerCalled: flags.writerCalled ?? false,
    routeScored: flags.routeScored ?? false,
    codeGenerated: flags.codeGenerated ?? false,
  };
}

function recoverCode(
  deps: ContactInvitationRouteDeps,
  actorUserId: string,
  clientRequestId: string,
):
  | { ok: true; pair: ContactInvitationCodePair }
  | { ok: false; reason: "pepper" | "code" } {
  const pepper = deps.readPepper();
  if (pepper == null || !pepperIsUsable(pepper)) {
    return { ok: false, reason: "pepper" };
  }
  try {
    const pair = deps.generateCode(actorUserId, clientRequestId);
    if (!/^\d{4}$/.test(pair.code) || !isContactCodeHash(pair.codeHash)) {
      return { ok: false, reason: "code" };
    }
    return { ok: true, pair };
  } catch {
    return { ok: false, reason: "code" };
  }
}

export async function runContactInvitationCreate(
  deps: ContactInvitationRouteDeps,
): Promise<ContactInvitationRouteResult> {
  let body: unknown;
  try {
    body = await deps.readBody();
  } catch {
    return fail(400, CONTACT_INVITATION_ERROR.invalidInput);
  }

  const parsed = parseContactInvitationCreateBody(body);
  if (!parsed.ok) {
    return fail(parsed.status, parsed.errorKey);
  }

  let userId: string | null;
  try {
    userId = await deps.getUser();
  } catch {
    return fail(500, CONTACT_INVITATION_ERROR.submitFailed, [
      CONTACT_INVITATION_SAFE_LOGS.authLookupFailed,
    ]);
  }
  if (!userId || !isUuid(userId)) {
    return fail(401, CONTACT_INVITATION_ERROR.authenticationRequired);
  }

  const pepper = deps.readPepper();
  if (pepper == null || !pepperIsUsable(pepper)) {
    return fail(500, CONTACT_INVITATION_ERROR.serverConfiguration, [
      CONTACT_INVITATION_SAFE_LOGS.serverConfigurationMissing,
    ]);
  }

  let admin: unknown;
  try {
    admin = deps.createAdmin();
  } catch {
    return fail(500, CONTACT_INVITATION_ERROR.serverConfiguration, [
      CONTACT_INVITATION_SAFE_LOGS.serverConfigurationMissing,
    ]);
  }

  let inspected: ContactInvitationInspectRow;
  try {
    inspected = await deps.inspect(admin, {
      actorUserId: userId,
      initiatorPostId: parsed.value.initiatorPostId,
      clientRequestId: parsed.value.clientRequestId,
    });
  } catch {
    return fail(
      500,
      CONTACT_INVITATION_ERROR.submitFailed,
      [CONTACT_INVITATION_SAFE_LOGS.writerFailed],
      { adminCreated: true },
    );
  }

  if (inspected.existing_for_client_request) {
    return finishWithWriter(deps, {
      admin,
      userId,
      parsed: parsed.value,
      routeScored: false,
      admissionDigest: "",
    });
  }

  let loaded: {
    initiator: ContactInvitationEligibilityPost | null;
    counterpart: ContactInvitationEligibilityPost | null;
  };
  try {
    loaded = await deps.loadPosts(admin, {
      initiatorPostId: parsed.value.initiatorPostId,
      counterpartPostId: parsed.value.counterpartPostId,
    });
  } catch {
    return fail(
      500,
      CONTACT_INVITATION_ERROR.submitFailed,
      [CONTACT_INVITATION_SAFE_LOGS.writerFailed],
      { adminCreated: true },
    );
  }

  const base = evaluateContactInvitationBaseEligibility({
    actorUserId: userId,
    initiator: loaded.initiator,
    counterpart: loaded.counterpart,
  });
  if (!base.ok) {
    const logs =
      base.errorKey === CONTACT_INVITATION_ERROR.notEligible
        ? [CONTACT_INVITATION_SAFE_LOGS.eligibilityFailed]
        : [];
    return fail(
      httpStatusForContactInvitationError(base.errorKey),
      base.errorKey,
      logs,
      { adminCreated: true },
    );
  }

  if (
    !Number.isInteger(inspected.open_count) ||
    !Number.isInteger(inspected.created_24h_count) ||
    !Number.isInteger(inspected.max_open) ||
    !Number.isInteger(inspected.max_created_24h)
  ) {
    return fail(
      500,
      CONTACT_INVITATION_ERROR.serverConfiguration,
      [CONTACT_INVITATION_SAFE_LOGS.serverConfigurationMissing],
      { adminCreated: true },
    );
  }
  if (inspected.open_count >= inspected.max_open) {
    return fail(
      429,
      CONTACT_INVITATION_ERROR.openLimit,
      [CONTACT_INVITATION_SAFE_LOGS.invitationLimitReached],
      { adminCreated: true },
    );
  }
  if (inspected.created_24h_count >= inspected.max_created_24h) {
    return fail(
      429,
      CONTACT_INVITATION_ERROR.rateLimit,
      [CONTACT_INVITATION_SAFE_LOGS.invitationLimitReached],
      { adminCreated: true },
    );
  }

  if (loaded.initiator == null || loaded.counterpart == null) {
    return fail(404, CONTACT_INVITATION_ERROR.postNotFound, [], { adminCreated: true });
  }

  let thresholds: MatchAdmissionRouteThresholds | null;
  try {
    thresholds = await deps.loadThresholds(admin);
  } catch {
    return fail(
      409,
      CONTACT_INVITATION_ERROR.notEligible,
      [CONTACT_INVITATION_SAFE_LOGS.eligibilityFailed],
      { adminCreated: true },
    );
  }

  let route: MatchAdmissionRouteScore;
  try {
    route = await deps.scoreRoute(loaded.initiator, loaded.counterpart);
  } catch {
    return fail(
      409,
      CONTACT_INVITATION_ERROR.notEligible,
      [CONTACT_INVITATION_SAFE_LOGS.eligibilityFailed],
      { adminCreated: true, routeScored: true },
    );
  }
  const eligible = evaluateContactInvitationEligibility({
    actorUserId: userId,
    initiator: loaded.initiator,
    counterpart: loaded.counterpart,
    route,
    thresholds,
  });
  if (!eligible.ok) {
    return fail(
      httpStatusForContactInvitationError(eligible.errorKey),
      eligible.errorKey,
      [CONTACT_INVITATION_SAFE_LOGS.eligibilityFailed],
      { adminCreated: true, routeScored: true },
    );
  }

  return finishWithWriter(deps, {
    admin,
    userId,
    parsed: parsed.value,
    routeScored: true,
    admissionDigest: matchAdmissionDigestHex(loaded.initiator, loaded.counterpart),
  });
}

async function finishWithWriter(
  deps: ContactInvitationRouteDeps,
  input: {
    admin: unknown;
    userId: string;
    parsed: ContactInvitationCreateInput;
    routeScored: boolean;
    admissionDigest: string;
  },
): Promise<ContactInvitationRouteResult> {
  const recovered = recoverCode(deps, input.userId, input.parsed.clientRequestId);
  if (!recovered.ok) {
    return fail(
      500,
      recovered.reason === "pepper"
        ? CONTACT_INVITATION_ERROR.serverConfiguration
        : CONTACT_INVITATION_ERROR.submitFailed,
      [
        recovered.reason === "pepper"
          ? CONTACT_INVITATION_SAFE_LOGS.serverConfigurationMissing
          : CONTACT_INVITATION_SAFE_LOGS.codeGenerationFailed,
      ],
      { adminCreated: true, routeScored: input.routeScored },
    );
  }

  let writerRow: ContactInvitationWriterRow;
  try {
    writerRow = await deps.callWriter(input.admin, {
      actorUserId: input.userId,
      initiatorPostId: input.parsed.initiatorPostId,
      counterpartPostId: input.parsed.counterpartPostId,
      clientRequestId: input.parsed.clientRequestId,
      contactCodeHash: recovered.pair.codeHash,
      admissionDigest: input.admissionDigest,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const mapped = extractWriterErrorKey(message);
    if (mapped) {
      const logs =
        mapped === CONTACT_INVITATION_ERROR.openLimit ||
        mapped === CONTACT_INVITATION_ERROR.rateLimit
          ? [CONTACT_INVITATION_SAFE_LOGS.invitationLimitReached]
          : mapped === CONTACT_INVITATION_ERROR.notEligible
            ? [CONTACT_INVITATION_SAFE_LOGS.eligibilityFailed]
            : [];
      return fail(httpStatusForContactInvitationError(mapped), mapped, logs, {
        adminCreated: true,
        writerCalled: true,
        routeScored: input.routeScored,
        codeGenerated: true,
      });
    }
    return fail(
      500,
      CONTACT_INVITATION_ERROR.submitFailed,
      [CONTACT_INVITATION_SAFE_LOGS.writerFailed],
      {
        adminCreated: true,
        writerCalled: true,
        routeScored: input.routeScored,
        codeGenerated: true,
      },
    );
  }

  const interpreted = interpretContactInvitationWriterRow(
    writerRow,
    input.parsed.clientRequestId,
  );
  if (!interpreted.ok) {
    return fail(
      interpreted.status,
      interpreted.errorKey,
      interpreted.errorKey === CONTACT_INVITATION_ERROR.submitFailed
        ? [CONTACT_INVITATION_SAFE_LOGS.writerResponseInvalid]
        : [],
      {
        adminCreated: true,
        writerCalled: true,
        routeScored: input.routeScored,
        codeGenerated: true,
      },
    );
  }

  return {
    status: interpreted.row.created ? 201 : 200,
    json: {
      ok: true,
      invitation: {
        id: interpreted.row.invitation_id,
        status: interpreted.row.invitation_status,
        contactCode: recovered.pair.code,
        expiresAt: interpreted.row.expires_at,
        created: interpreted.row.created,
      },
    },
    logs: [],
    adminCreated: true,
    writerCalled: true,
    routeScored: input.routeScored,
    codeGenerated: true,
  };
}

export function generateCodeWithPepper(
  actorUserId: string,
  clientRequestId: string,
  pepper: string,
): ContactInvitationCodePair {
  return generateContactInvitationCode({
    pepper,
    actorUserId,
    clientRequestId,
  });
}

export type SimulatedPost = {
  id: string;
  user_id: string;
  post_type: "demand" | "provider" | string;
  category: string;
  status: string;
  departure_date?: string | null;
  departure_time_window?: string | null;
  service_time_window?: string | null;
  transport_mode?: string | null;
  origin_address?: string | null;
  destination_address?: string | null;
  waypoints?: string[] | null;
};

export type SimulatedInvitation = {
  id: string;
  demand_post_id: string;
  provider_post_id: string;
  initiator_user_id: string;
  recipient_user_id: string;
  initiator_post_id: string;
  status: string;
  contact_policy_version: number;
  disclosure_mode: string;
  contact_code_hash: string;
  client_request_id: string;
  expires_at: string;
  converted_at: string | null;
  invalidated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SimulatedWriterState = {
  posts: SimulatedPost[];
  invitations: SimulatedInvitation[];
  config: {
    matching_contact_mode: string;
    matching_contact_policy_version: number;
    matching_contact_invitation_ttl_minutes: number;
    matching_contact_max_open_per_initiator_post: number;
    matching_contact_max_created_per_actor_24h: number;
  } | null;
  now: string;
};

export type SimulatedWriterResult =
  | { ok: true; row: ContactInvitationWriterRow; state: SimulatedWriterState }
  | { ok: false; errorKey: string; state: SimulatedWriterState };

function lockPostsInIdOrder(posts: SimulatedPost[]): SimulatedPost[] {
  return [...posts].sort((left, right) => left.id.localeCompare(right.id));
}

export function evaluateContactInvitationWriter(
  state: SimulatedWriterState,
  input: {
    actorUserId: string;
    initiatorPostId: string;
    counterpartPostId: string;
    clientRequestId: string;
    contactCodeHash: string;
    admissionDigest?: string;
  },
): SimulatedWriterResult {
  const next: SimulatedWriterState = {
    ...state,
    posts: state.posts.map((post) => ({ ...post })),
    invitations: state.invitations.map((row) => ({ ...row })),
    config: state.config ? { ...state.config } : null,
  };

  if (
    !isUuid(input.actorUserId) ||
    !isUuid(input.initiatorPostId) ||
    !isUuid(input.counterpartPostId) ||
    !isUuid(input.clientRequestId)
  ) {
    return { ok: false, errorKey: CONTACT_INVITATION_ERROR.invalidInput, state: next };
  }
  if (!isContactCodeHash(input.contactCodeHash)) {
    return {
      ok: false,
      errorKey: CONTACT_INVITATION_ERROR.serverConfiguration,
      state: next,
    };
  }
  if (input.initiatorPostId === input.counterpartPostId) {
    return { ok: false, errorKey: CONTACT_INVITATION_ERROR.selfNotAllowed, state: next };
  }

  const existingByKey = next.invitations.find(
    (row) =>
      row.initiator_user_id === input.actorUserId &&
      row.client_request_id === input.clientRequestId,
  );
  if (existingByKey) {
    const samePair = invitationPairMatchesRequest({
      initiatorPostId: input.initiatorPostId,
      counterpartPostId: input.counterpartPostId,
      existingInitiatorPostId: existingByKey.initiator_post_id,
      existingDemandPostId: existingByKey.demand_post_id,
      existingProviderPostId: existingByKey.provider_post_id,
    });
    if (samePair && existingByKey.contact_code_hash === input.contactCodeHash) {
      return {
        ok: true,
        state: next,
        row: {
          invitation_id: existingByKey.id,
          invitation_status: existingByKey.status,
          disclosure_mode: existingByKey.disclosure_mode,
          expires_at: existingByKey.expires_at,
          effective_client_request_id: existingByKey.client_request_id,
          created: false,
        },
      };
    }
    return {
      ok: false,
      errorKey: CONTACT_INVITATION_ERROR.idempotencyConflict,
      state: next,
    };
  }

  const locked = lockPostsInIdOrder(
    next.posts.filter(
      (post) =>
        post.id === input.initiatorPostId || post.id === input.counterpartPostId,
    ),
  );
  if (locked.length !== 2) {
    return { ok: false, errorKey: CONTACT_INVITATION_ERROR.postNotFound, state: next };
  }

  const initiator = locked.find((post) => post.id === input.initiatorPostId);
  const counterpart = locked.find((post) => post.id === input.counterpartPostId);
  if (!initiator || !counterpart) {
    return { ok: false, errorKey: CONTACT_INVITATION_ERROR.postNotFound, state: next };
  }
  if (initiator.user_id !== input.actorUserId) {
    return { ok: false, errorKey: CONTACT_INVITATION_ERROR.postNotOwned, state: next };
  }
  if (counterpart.user_id === input.actorUserId) {
    return { ok: false, errorKey: CONTACT_INVITATION_ERROR.selfNotAllowed, state: next };
  }
  if (initiator.status !== "active" || counterpart.status !== "active") {
    return {
      ok: false,
      errorKey: CONTACT_INVITATION_ERROR.postUnavailable,
      state: next,
    };
  }
  const complementary =
    (initiator.post_type === "demand" && counterpart.post_type === "provider") ||
    (initiator.post_type === "provider" && counterpart.post_type === "demand");
  if (!complementary) {
    return { ok: false, errorKey: CONTACT_INVITATION_ERROR.roleMismatch, state: next };
  }
  if (initiator.category !== counterpart.category) {
    return {
      ok: false,
      errorKey: CONTACT_INVITATION_ERROR.categoryMismatch,
      state: next,
    };
  }
  if (
    input.admissionDigest != null &&
    input.admissionDigest !== matchAdmissionDigestHex(initiator, counterpart)
  ) {
    return {
      ok: false,
      errorKey: CONTACT_INVITATION_ERROR.notEligible,
      state: next,
    };
  }

  const demandPostId =
    initiator.post_type === "demand" ? initiator.id : counterpart.id;
  const providerPostId =
    initiator.post_type === "provider" ? initiator.id : counterpart.id;
  const recipientUserId = counterpart.user_id;

  const config = next.config;
  if (
    config == null ||
    (config.matching_contact_mode !== "cold_start" &&
      config.matching_contact_mode !== "mature") ||
    config.matching_contact_policy_version <= 0 ||
    config.matching_contact_invitation_ttl_minutes < 10 ||
    config.matching_contact_invitation_ttl_minutes > 10080 ||
    config.matching_contact_max_open_per_initiator_post < 1 ||
    config.matching_contact_max_open_per_initiator_post > 100 ||
    config.matching_contact_max_created_per_actor_24h < 1 ||
    config.matching_contact_max_created_per_actor_24h > 500
  ) {
    return {
      ok: false,
      errorKey: CONTACT_INVITATION_ERROR.serverConfiguration,
      state: next,
    };
  }
  const disclosureMode =
    config.matching_contact_mode === "cold_start"
      ? "mutual_eligible_contact"
      : "recipient_contacts_initiator";

  const openPair = next.invitations.find(
    (row) =>
      row.demand_post_id === demandPostId &&
      row.provider_post_id === providerPostId &&
      row.status === "open",
  );
  if (openPair) {
    if (Date.parse(openPair.expires_at) <= Date.parse(next.now)) {
      openPair.status = "expired";
      openPair.invalidated_at = next.now;
      openPair.updated_at = next.now;
    } else {
      return {
        ok: false,
        errorKey: CONTACT_INVITATION_ERROR.alreadyOpen,
        state: next,
      };
    }
  }

  const nowMs = Date.parse(next.now);
  const openCount = next.invitations.filter(
    (row) =>
      row.initiator_post_id === input.initiatorPostId &&
      row.status === "open" &&
      Date.parse(row.expires_at) > nowMs,
  ).length;
  if (openCount >= config.matching_contact_max_open_per_initiator_post) {
    return {
      ok: false,
      errorKey: CONTACT_INVITATION_ERROR.openLimit,
      state: next,
    };
  }
  const created24h = next.invitations.filter(
    (row) =>
      row.initiator_user_id === input.actorUserId &&
      Date.parse(row.created_at) >= nowMs - 24 * 60 * 60 * 1000,
  ).length;
  if (created24h >= config.matching_contact_max_created_per_actor_24h) {
    return {
      ok: false,
      errorKey: CONTACT_INVITATION_ERROR.rateLimit,
      state: next,
    };
  }

  const expiresAt = new Date(
    Date.parse(next.now) +
      config.matching_contact_invitation_ttl_minutes * 60_000,
  ).toISOString();
  const created: SimulatedInvitation = {
    id: "11111111-1111-4111-8111-111111111111",
    demand_post_id: demandPostId,
    provider_post_id: providerPostId,
    initiator_user_id: input.actorUserId,
    recipient_user_id: recipientUserId,
    initiator_post_id: input.initiatorPostId,
    status: "open",
    contact_policy_version: config.matching_contact_policy_version,
    disclosure_mode: disclosureMode,
    contact_code_hash: input.contactCodeHash,
    client_request_id: input.clientRequestId,
    expires_at: expiresAt,
    converted_at: null,
    invalidated_at: null,
    created_at: next.now,
    updated_at: next.now,
  };
  next.invitations.push(created);
  return {
    ok: true,
    state: next,
    row: {
      invitation_id: created.id,
      invitation_status: created.status,
      disclosure_mode: created.disclosure_mode,
      expires_at: created.expires_at,
      effective_client_request_id: created.client_request_id,
      created: true,
    },
  };
}
