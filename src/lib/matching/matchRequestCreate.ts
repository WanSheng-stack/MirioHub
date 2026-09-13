/**
 * PHASE 6.7C.1B — match-request create orchestration.
 * inspect is a non-atomic hint. create_match_request_v95 is the only success authority.
 */

import {
  generateContactInvitationCode,
  pepperIsUsable,
  type ContactInvitationCodePair,
} from "@/lib/matching/contactInvitationCodeCore";
import {
  buildProductionServerQuote,
  canonicalizeProposal,
  digestCanonicalProposal,
  digestServerQuote,
  evaluateMatchRequestEligibility,
  extractWriterErrorKey,
  httpStatusForMatchRequestError,
  interpretMatchRequestWriterRow,
  MATCH_REQUEST_ERROR,
  MATCH_REQUEST_SAFE_LOGS,
  parseMatchRequestCreateBody,
  quoteIsLegal,
  type MatchRequestCreateInput,
  type MatchRequestInspectRow,
  type MatchRequestWriterRow,
  type ServerMatchRequestQuote,
} from "@/lib/matching/matchRequestCreateCore";
import {
  matchAdmissionDigestHex,
  type MatchAdmissionPost,
  type MatchAdmissionRouteScore,
  type MatchAdmissionRouteThresholds,
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
  loadPosts: (
    admin: unknown,
    ids: { initiatorPostId: string; counterpartPostId: string },
  ) => Promise<{ initiator: MatchAdmissionPost | null; counterpart: MatchAdmissionPost | null }>;
  loadActorPhonePresent: (admin: unknown, actorUserId: string) => Promise<boolean>;
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
      admissionDigest: string;
      proposalDigest: string;
      quoteDigest: string;
      proposalPayload: unknown;
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

  if (inspected.existing_for_client_request) {
    let proposal: Parameters<typeof digestCanonicalProposal>[0] = {
      category: parsed.value.proposal.category,
      proposedDate: parsed.value.proposal.proposedDate,
      proposedTimeWindow: parsed.value.proposal.proposedTimeWindow,
      pickupLocation: { locationVersion: 1, displayAddress: "" },
      dropoffLocation: { locationVersion: 1, displayAddress: "" },
      bumpTierId: parsed.value.proposal.bumpTierId ?? null,
      note: parsed.value.proposal.note ?? null,
    };
    try {
      const loaded = await deps.loadPosts(admin, {
        initiatorPostId: parsed.value.initiatorPostId,
        counterpartPostId: parsed.value.counterpartPostId,
      });
      if (loaded.initiator && loaded.counterpart) {
        const canonical = canonicalizeProposal({
          proposal: parsed.value.proposal,
          initiator: loaded.initiator,
          counterpart: loaded.counterpart,
        });
        if (canonical.ok) proposal = canonical.value;
      }
    } catch {
      // Writer remains the exact-retry authority.
    }
    return finishWithWriter(deps, {
      admin,
      userId,
      parsed: parsed.value,
      routeScored: false,
      admissionDigest: "",
      proposal,
      quote: (await deps.loadQuote()) ?? {
        pricingVersion: 0,
        pricingCountryCode: "",
        pricingCurrency: "",
        baseAmountMinor: 0,
        bumpTierId: null,
        bumpAmountMinor: 0,
        totalAmountMinor: 0,
        matchPercentBasisPoints: 0,
        extraDetourM: 0,
        extraDurationSeconds: 0,
      },
    });
  }

  if (inspected.creation_enabled === false) {
    return fail(409, MATCH_REQUEST_ERROR.creationDisabled, [
      MATCH_REQUEST_SAFE_LOGS.creationDisabled,
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

  let loaded: {
    initiator: MatchAdmissionPost | null;
    counterpart: MatchAdmissionPost | null;
  };
  try {
    loaded = await deps.loadPosts(admin, {
      initiatorPostId: parsed.value.initiatorPostId,
      counterpartPostId: parsed.value.counterpartPostId,
    });
  } catch {
    return fail(500, MATCH_REQUEST_ERROR.submitFailed, [
      MATCH_REQUEST_SAFE_LOGS.writerFailed,
    ], { adminCreated: true });
  }
  if (!loaded.initiator || !loaded.counterpart) {
    return fail(404, MATCH_REQUEST_ERROR.postNotFound, [], { adminCreated: true });
  }

  let phonePresent = false;
  try {
    phonePresent = await deps.loadActorPhonePresent(admin, userId);
  } catch {
    return fail(500, MATCH_REQUEST_ERROR.submitFailed, [
      MATCH_REQUEST_SAFE_LOGS.writerFailed,
    ], { adminCreated: true });
  }
  if (!phonePresent) {
    return fail(409, MATCH_REQUEST_ERROR.phoneRequired, [], { adminCreated: true });
  }

  let thresholds: MatchAdmissionRouteThresholds | null = null;
  try {
    thresholds = await deps.loadThresholds(admin);
  } catch {
    return fail(409, MATCH_REQUEST_ERROR.notEligible, [
      MATCH_REQUEST_SAFE_LOGS.eligibilityFailed,
    ], { adminCreated: true });
  }

  let route: MatchAdmissionRouteScore;
  try {
    route = await deps.scoreRoute(loaded.initiator, loaded.counterpart);
  } catch {
    return fail(409, MATCH_REQUEST_ERROR.notEligible, [
      MATCH_REQUEST_SAFE_LOGS.eligibilityFailed,
    ], { adminCreated: true, routeScored: true });
  }

  const eligible = evaluateMatchRequestEligibility({
    actorUserId: userId,
    initiator: loaded.initiator,
    counterpart: loaded.counterpart,
    route,
    thresholds,
    proposal: parsed.value.proposal,
  });
  if (!eligible.ok) {
    return fail(
      httpStatusForMatchRequestError(eligible.errorKey),
      eligible.errorKey,
      [MATCH_REQUEST_SAFE_LOGS.eligibilityFailed],
      { adminCreated: true, routeScored: true },
    );
  }

  const canonical = canonicalizeProposal({
    proposal: parsed.value.proposal,
    initiator: loaded.initiator,
    counterpart: loaded.counterpart,
  });
  if (!canonical.ok) {
    return fail(409, canonical.errorKey, [
      MATCH_REQUEST_SAFE_LOGS.eligibilityFailed,
    ], { adminCreated: true, routeScored: true });
  }

  const quote = await deps.loadQuote();
  if (!quoteIsLegal(quote)) {
    return fail(409, MATCH_REQUEST_ERROR.pricingNotReady, [
      MATCH_REQUEST_SAFE_LOGS.pricingNotReady,
    ], { adminCreated: true, routeScored: true });
  }

  return finishWithWriter(deps, {
    admin,
    userId,
    parsed: parsed.value,
    routeScored: true,
    admissionDigest: matchAdmissionDigestHex(loaded.initiator, loaded.counterpart),
    proposal: canonical.value,
    quote,
  });
}

async function finishWithWriter(
  deps: MatchRequestRouteDeps,
  input: {
    admin: unknown;
    userId: string;
    parsed: MatchRequestCreateInput;
    routeScored: boolean;
    admissionDigest: string;
    proposal: Parameters<typeof digestCanonicalProposal>[0];
    quote: ServerMatchRequestQuote;
  },
): Promise<MatchRequestRouteResult> {
  const recovered = recoverCode(deps, input.parsed, input.userId);
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
      { adminCreated: true, routeScored: input.routeScored },
    );
  }

  let writerRow: MatchRequestWriterRow;
  try {
    writerRow = await deps.callWriter(input.admin, {
      actorUserId: input.userId,
      initiatorPostId: input.parsed.initiatorPostId,
      counterpartPostId: input.parsed.counterpartPostId,
      clientRequestId: input.parsed.clientRequestId,
      clientRevisionId: input.parsed.clientRevisionId,
      contactCodeHash: recovered.pair.codeHash,
      admissionDigest: input.admissionDigest,
      proposalDigest: digestCanonicalProposal(input.proposal),
      quoteDigest: quoteIsLegal(input.quote) ? digestServerQuote(input.quote) : "",
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
              : mapped === MATCH_REQUEST_ERROR.notEligible
                ? [MATCH_REQUEST_SAFE_LOGS.eligibilityFailed]
                : [];
      return fail(httpStatusForMatchRequestError(mapped), mapped, logs, {
        adminCreated: true,
        writerCalled: true,
        routeScored: input.routeScored,
        codeGenerated: true,
      });
    }
    return fail(500, MATCH_REQUEST_ERROR.submitFailed, [
      MATCH_REQUEST_SAFE_LOGS.writerFailed,
    ], {
      adminCreated: true,
      writerCalled: true,
      routeScored: input.routeScored,
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
