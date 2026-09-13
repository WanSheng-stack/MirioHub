/**
 * PHASE 6.7C.1B.1 — match-request create orchestration.
 * Exact retry uses only the stable idempotency payload hash.
 * create_match_request_v95 is the only success authority.
 */

import {
  generateContactInvitationCode,
  pepperIsUsable,
  type ContactInvitationCodePair,
} from "@/lib/matching/contactInvitationCodeCore";
import {
  buildProductionServerQuote,
  canonicalizeBrowserProposal,
  computeIdempotencyPayloadHash,
  evaluateMatchRequestEligibility,
  extractWriterErrorKey,
  httpStatusForMatchRequestError,
  interpretMatchRequestWriterRow,
  MATCH_REQUEST_ERROR,
  MATCH_REQUEST_SAFE_LOGS,
  parseMatchRequestCreateBody,
  proposalHasOverride,
  quoteIsLegal,
  type CanonicalProposal,
  type MatchRequestCreateInput,
  type MatchRequestInspectRow,
  type MatchRequestWriterRow,
  type ServerMatchRequestQuote,
} from "@/lib/matching/matchRequestCreateCore";
import type {
  MatchAdmissionPost,
  MatchAdmissionRouteScore,
  MatchAdmissionRouteThresholds,
} from "@/lib/matching/matchAdmissionPolicy";

export type MatchRequestRouteResult = {
  status: number;
  json:
    | {
        ok: true;
        request: {
          id: string;
          revisionId: string;
          status: string;
          contactCode: string;
          expiresAt: string;
          created: boolean;
        };
      }
    | { ok: false; errorKey: string };
  logs: string[];
  adminCreated: boolean;
  writerCalled: boolean;
  routeScored: boolean;
  postsLoaded: boolean;
  quoteLoaded: boolean;
  codeGenerated: boolean;
};

export type MatchRequestRouteDeps = {
  readBody: () => Promise<unknown>;
  getUser: () => Promise<string | null>;
  readPepper: () => string | null;
  generateCode: (input: {
    actorUserId: string;
    clientRequestId: string;
    clientRevisionId: string;
    initiatorPostId: string;
    counterpartPostId: string;
  }) => ContactInvitationCodePair;
  createAdmin: () => unknown;
  inspect: (
    admin: unknown,
    args: { actorUserId: string; initiatorPostId: string; clientRequestId: string },
  ) => Promise<MatchRequestInspectRow>;
  loadSnapshot: (
    admin: unknown,
    ids: { initiatorPostId: string; counterpartPostId: string },
  ) => Promise<{
    initiator: MatchAdmissionPost | null;
    counterpart: MatchAdmissionPost | null;
    admissionFactsHash: string;
  }>;
  loadActorPhoneCanonical: (admin: unknown, actorUserId: string) => Promise<boolean>;
  scoreRoute: (
    initiator: MatchAdmissionPost,
    counterpart: MatchAdmissionPost,
  ) => Promise<MatchAdmissionRouteScore>;
  loadThresholds: (admin: unknown) => Promise<MatchAdmissionRouteThresholds | null>;
  loadQuote: () => Promise<ServerMatchRequestQuote | null>;
  callWriter: (
    admin: unknown,
    args: {
      actorUserId: string;
      initiatorPostId: string;
      counterpartPostId: string;
      clientRequestId: string;
      clientRevisionId: string;
      contactCodeHash: string;
      idempotencyPayloadHash: string;
      admissionFactsHash: string;
      proposalPayload: CanonicalProposal;
      quote: ServerMatchRequestQuote;
      contactPreference: string;
      whatsappAvailable: boolean;
      viberAvailable: boolean;
    },
  ) => Promise<MatchRequestWriterRow>;
};

function fail(
  status: number,
  errorKey: string,
  logs: string[] = [],
  flags: {
    adminCreated?: boolean;
    writerCalled?: boolean;
    routeScored?: boolean;
    postsLoaded?: boolean;
    quoteLoaded?: boolean;
    codeGenerated?: boolean;
  } = {},
): MatchRequestRouteResult {
  return {
    status,
    json: { ok: false, errorKey },
    logs,
    adminCreated: flags.adminCreated ?? false,
    writerCalled: flags.writerCalled ?? false,
    routeScored: flags.routeScored ?? false,
    postsLoaded: flags.postsLoaded ?? false,
    quoteLoaded: flags.quoteLoaded ?? false,
    codeGenerated: flags.codeGenerated ?? false,
  };
}

function recoverCode(
  deps: MatchRequestRouteDeps,
  parsed: MatchRequestCreateInput,
  actorUserId: string,
): { ok: true; pair: ContactInvitationCodePair } | { ok: false; reason: "pepper" | "code" } {
  const pepper = deps.readPepper();
  if (pepper == null || !pepperIsUsable(pepper)) return { ok: false, reason: "pepper" };
  try {
    const pair = deps.generateCode({
      actorUserId,
      clientRequestId: parsed.clientRequestId,
      clientRevisionId: parsed.clientRevisionId,
      initiatorPostId: parsed.initiatorPostId,
      counterpartPostId: parsed.counterpartPostId,
    });
    if (!/^\d{4}$/.test(pair.code) || pair.codeHash.length !== 64) {
      return { ok: false, reason: "code" };
    }
    return { ok: true, pair };
  } catch {
    return { ok: false, reason: "code" };
  }
}

const PLACEHOLDER_QUOTE: ServerMatchRequestQuote = {
  pricingVersion: 1,
  pricingCountryCode: "XX",
  pricingCurrency: "XXX",
  baseAmountMinor: 0,
  bumpTierId: null,
  bumpAmountMinor: 0,
  totalAmountMinor: 0,
  matchPercentBasisPoints: 0,
  extraDetourM: 0,
  extraDurationSeconds: 0,
};

export async function runMatchRequestCreate(
  deps: MatchRequestRouteDeps,
): Promise<MatchRequestRouteResult> {
  let body: unknown;
  try {
    body = await deps.readBody();
  } catch {
    return fail(400, MATCH_REQUEST_ERROR.invalidInput);
  }
  const parsed = parseMatchRequestCreateBody(body);
  if (!parsed.ok) return fail(parsed.status, parsed.errorKey);

  let userId: string | null;
  try {
    userId = await deps.getUser();
  } catch {
    return fail(500, MATCH_REQUEST_ERROR.submitFailed, [
      MATCH_REQUEST_SAFE_LOGS.authLookupFailed,
    ]);
  }
  if (!userId) return fail(401, MATCH_REQUEST_ERROR.authenticationRequired);

  const pepper = deps.readPepper();
  if (pepper == null || !pepperIsUsable(pepper)) {
    return fail(500, MATCH_REQUEST_ERROR.serverConfiguration, [
      MATCH_REQUEST_SAFE_LOGS.serverConfigurationMissing,
    ]);
  }

  let admin: unknown;
  try {
    admin = deps.createAdmin();
  } catch {
    return fail(500, MATCH_REQUEST_ERROR.serverConfiguration, [
      MATCH_REQUEST_SAFE_LOGS.serverConfigurationMissing,
    ]);
  }

  let inspected: MatchRequestInspectRow;
  try {
    inspected = await deps.inspect(admin, {
      actorUserId: userId,
      initiatorPostId: parsed.value.initiatorPostId,
      clientRequestId: parsed.value.clientRequestId,
    });
  } catch {
    return fail(500, MATCH_REQUEST_ERROR.submitFailed, [
      MATCH_REQUEST_SAFE_LOGS.writerFailed,
    ], { adminCreated: true });
  }

  const canonical = canonicalizeBrowserProposal(parsed.value.proposal);
  const recovered = recoverCode(deps, parsed.value, userId);
  if (!recovered.ok) {
    return fail(
      500,
      recovered.reason === "pepper"
        ? MATCH_REQUEST_ERROR.serverConfiguration
        : MATCH_REQUEST_ERROR.submitFailed,
      [
        recovered.reason === "pepper"
          ? MATCH_REQUEST_SAFE_LOGS.serverConfigurationMissing
          : MATCH_REQUEST_SAFE_LOGS.codeGenerationFailed,
      ],
      { adminCreated: true },
    );
  }
  const idempotencyPayloadHash = computeIdempotencyPayloadHash({
    actorUserId: userId,
    initiatorPostId: parsed.value.initiatorPostId,
    counterpartPostId: parsed.value.counterpartPostId,
    clientRequestId: parsed.value.clientRequestId,
    clientRevisionId: parsed.value.clientRevisionId,
    proposal: canonical,
    contactPreference: parsed.value.contactPreference,
    whatsappAvailable: parsed.value.whatsappAvailable,
    viberAvailable: parsed.value.viberAvailable,
    contactCodeHash: recovered.pair.codeHash,
  });

  if (inspected.existing_for_client_request) {
    return finishWithWriter(deps, {
      admin,
      userId,
      parsed: parsed.value,
      pair: recovered.pair,
      idempotencyPayloadHash,
      admissionFactsHash: "",
      proposal: canonical,
      quote: PLACEHOLDER_QUOTE,
      routeScored: false,
      postsLoaded: false,
      quoteLoaded: false,
    });
  }

  if (inspected.creation_enabled === false) {
    return fail(409, MATCH_REQUEST_ERROR.creationDisabled, [
      MATCH_REQUEST_SAFE_LOGS.creationDisabled,
    ], { adminCreated: true });
  }
  if (proposalHasOverride(canonical)) {
    return fail(409, MATCH_REQUEST_ERROR.locationOverrideNotReady, [
      MATCH_REQUEST_SAFE_LOGS.locationOverrideNotReady,
    ], { adminCreated: true });
  }
  if (
    Number.isInteger(inspected.open_count) &&
    Number.isInteger(inspected.max_open) &&
    inspected.open_count >= inspected.max_open
  ) {
    return fail(429, MATCH_REQUEST_ERROR.openLimit, [
      MATCH_REQUEST_SAFE_LOGS.requestLimitReached,
    ], { adminCreated: true });
  }
  if (
    Number.isInteger(inspected.created_24h_count) &&
    Number.isInteger(inspected.max_created_24h) &&
    inspected.created_24h_count >= inspected.max_created_24h
  ) {
    return fail(429, MATCH_REQUEST_ERROR.rateLimit, [
      MATCH_REQUEST_SAFE_LOGS.requestLimitReached,
    ], { adminCreated: true });
  }

  let snapshot: {
    initiator: MatchAdmissionPost | null;
    counterpart: MatchAdmissionPost | null;
    admissionFactsHash: string;
  };
  try {
    snapshot = await deps.loadSnapshot(admin, {
      initiatorPostId: parsed.value.initiatorPostId,
      counterpartPostId: parsed.value.counterpartPostId,
    });
  } catch {
    return fail(500, MATCH_REQUEST_ERROR.submitFailed, [
      MATCH_REQUEST_SAFE_LOGS.writerFailed,
    ], { adminCreated: true });
  }
  if (!snapshot.initiator || !snapshot.counterpart || !/^[0-9a-f]{64}$/.test(snapshot.admissionFactsHash)) {
    return fail(404, MATCH_REQUEST_ERROR.postNotFound, [], {
      adminCreated: true,
      postsLoaded: true,
    });
  }

  let phoneCanonical = false;
  try {
    phoneCanonical = await deps.loadActorPhoneCanonical(admin, userId);
  } catch {
    return fail(500, MATCH_REQUEST_ERROR.submitFailed, [
      MATCH_REQUEST_SAFE_LOGS.writerFailed,
    ], { adminCreated: true, postsLoaded: true });
  }
  if (!phoneCanonical) {
    return fail(409, MATCH_REQUEST_ERROR.phoneRequired, [], {
      adminCreated: true,
      postsLoaded: true,
    });
  }

  let thresholds: MatchAdmissionRouteThresholds | null = null;
  try {
    thresholds = await deps.loadThresholds(admin);
  } catch {
    return fail(409, MATCH_REQUEST_ERROR.notEligible, [
      MATCH_REQUEST_SAFE_LOGS.eligibilityFailed,
    ], { adminCreated: true, postsLoaded: true });
  }

  let route: MatchAdmissionRouteScore;
  try {
    route = await deps.scoreRoute(snapshot.initiator, snapshot.counterpart);
  } catch {
    return fail(409, MATCH_REQUEST_ERROR.notEligible, [
      MATCH_REQUEST_SAFE_LOGS.eligibilityFailed,
    ], { adminCreated: true, routeScored: true, postsLoaded: true });
  }

  const eligible = evaluateMatchRequestEligibility({
    actorUserId: userId,
    initiator: snapshot.initiator,
    counterpart: snapshot.counterpart,
    route,
    thresholds,
    proposal: parsed.value.proposal,
  });
  if (!eligible.ok) {
    return fail(
      httpStatusForMatchRequestError(eligible.errorKey),
      eligible.errorKey,
      [MATCH_REQUEST_SAFE_LOGS.eligibilityFailed],
      { adminCreated: true, routeScored: true, postsLoaded: true },
    );
  }

  const quote = await deps.loadQuote();
  if (!quoteIsLegal(quote)) {
    return fail(409, MATCH_REQUEST_ERROR.pricingNotReady, [
      MATCH_REQUEST_SAFE_LOGS.pricingNotReady,
    ], { adminCreated: true, routeScored: true, postsLoaded: true, quoteLoaded: true });
  }

  return finishWithWriter(deps, {
    admin,
    userId,
    parsed: parsed.value,
    pair: recovered.pair,
    idempotencyPayloadHash,
    admissionFactsHash: snapshot.admissionFactsHash,
    proposal: canonical,
    quote,
    routeScored: true,
    postsLoaded: true,
    quoteLoaded: true,
  });
}

async function finishWithWriter(
  deps: MatchRequestRouteDeps,
  input: {
    admin: unknown;
    userId: string;
    parsed: MatchRequestCreateInput;
    pair: ContactInvitationCodePair;
    idempotencyPayloadHash: string;
    admissionFactsHash: string;
    proposal: CanonicalProposal;
    quote: ServerMatchRequestQuote;
    routeScored: boolean;
    postsLoaded: boolean;
    quoteLoaded: boolean;
  },
): Promise<MatchRequestRouteResult> {
  let writerRow: MatchRequestWriterRow;
  try {
    writerRow = await deps.callWriter(input.admin, {
      actorUserId: input.userId,
      initiatorPostId: input.parsed.initiatorPostId,
      counterpartPostId: input.parsed.counterpartPostId,
      clientRequestId: input.parsed.clientRequestId,
      clientRevisionId: input.parsed.clientRevisionId,
      contactCodeHash: input.pair.codeHash,
      idempotencyPayloadHash: input.idempotencyPayloadHash,
      admissionFactsHash: input.admissionFactsHash,
      proposalPayload: input.proposal,
      quote: input.quote,
      contactPreference: input.parsed.contactPreference,
      whatsappAvailable: input.parsed.whatsappAvailable,
      viberAvailable: input.parsed.viberAvailable,
    });
  } catch (error) {
    const mapped = extractWriterErrorKey(error instanceof Error ? error.message : "");
    if (mapped) {
      const logs =
        mapped === MATCH_REQUEST_ERROR.openLimit || mapped === MATCH_REQUEST_ERROR.rateLimit
          ? [MATCH_REQUEST_SAFE_LOGS.requestLimitReached]
          : mapped === MATCH_REQUEST_ERROR.creationDisabled
            ? [MATCH_REQUEST_SAFE_LOGS.creationDisabled]
            : mapped === MATCH_REQUEST_ERROR.pricingNotReady
              ? [MATCH_REQUEST_SAFE_LOGS.pricingNotReady]
              : mapped === MATCH_REQUEST_ERROR.locationOverrideNotReady
                ? [MATCH_REQUEST_SAFE_LOGS.locationOverrideNotReady]
                : mapped === MATCH_REQUEST_ERROR.notEligible
                  ? [MATCH_REQUEST_SAFE_LOGS.eligibilityFailed]
                  : [];
      return fail(httpStatusForMatchRequestError(mapped), mapped, logs, {
        adminCreated: true,
        writerCalled: true,
        routeScored: input.routeScored,
        postsLoaded: input.postsLoaded,
        quoteLoaded: input.quoteLoaded,
        codeGenerated: true,
      });
    }
    return fail(500, MATCH_REQUEST_ERROR.submitFailed, [
      MATCH_REQUEST_SAFE_LOGS.writerFailed,
    ], {
      adminCreated: true,
      writerCalled: true,
      routeScored: input.routeScored,
      postsLoaded: input.postsLoaded,
      quoteLoaded: input.quoteLoaded,
      codeGenerated: true,
    });
  }

  const interpreted = interpretMatchRequestWriterRow(
    writerRow,
    input.parsed.clientRequestId,
    input.parsed.clientRevisionId,
  );
  if (!interpreted.ok) {
    return fail(interpreted.status, interpreted.errorKey, [
      MATCH_REQUEST_SAFE_LOGS.writerResponseInvalid,
    ], {
      adminCreated: true,
      writerCalled: true,
      routeScored: input.routeScored,
      postsLoaded: input.postsLoaded,
      quoteLoaded: input.quoteLoaded,
      codeGenerated: true,
    });
  }

  return {
    status: interpreted.row.created ? 201 : 200,
    json: {
      ok: true,
      request: {
        id: interpreted.row.request_id,
        revisionId: interpreted.row.revision_id,
        status: interpreted.row.request_status,
        contactCode: input.pair.code,
        expiresAt: interpreted.row.expires_at,
        created: interpreted.row.created,
      },
    },
    logs: [],
    adminCreated: true,
    writerCalled: true,
    routeScored: input.routeScored,
    postsLoaded: input.postsLoaded,
    quoteLoaded: input.quoteLoaded,
    codeGenerated: true,
  };
}

export function generateCodeWithPepper(
  input: {
    actorUserId: string;
    clientRequestId: string;
    clientRevisionId: string;
    initiatorPostId: string;
    counterpartPostId: string;
  },
  pepper: string,
): ContactInvitationCodePair {
  return generateContactInvitationCode({ pepper, ...input });
}

export { buildProductionServerQuote };
