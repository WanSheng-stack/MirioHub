/**
 * PHASE 6.7C.1B — match request parse, eligibility, writer simulation, orchestration.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/matchRequestCreate.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateContactInvitationCode } from "@/lib/matching/contactInvitationCodeCore";
import {
  buildProductionServerQuote,
  evaluateMatchRequestEligibility,
  evaluateMatchRequestWriter,
  httpStatusForMatchRequestError,
  interpretMatchRequestWriterRow,
  MATCH_REQUEST_ERROR,
  MATCH_REQUEST_SAFE_LOGS,
  parseMatchRequestCreateBody,
  quoteIsLegal,
  revisionStatusTimestampsAreLegal,
  type MatchRequestInspectRow,
  type ServerMatchRequestQuote,
  type SimulatedWriterState,
} from "@/lib/matching/matchRequestCreateCore";
import {
  generateCodeWithPepper,
  runMatchRequestCreate,
  type MatchRequestRouteDeps,
} from "@/lib/matching/matchRequestCreate";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const PEPPER = "miriohub-contact-code-pepper-32chars!!";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DEMAND = "33333333-3333-4333-8333-333333333333";
const PROVIDER = "44444444-4444-4444-8444-444444444444";
const PROVIDER_B = "88888888-8888-4888-8888-888888888888";
const CLIENT = "55555555-5555-4555-8555-555555555555";
const CLIENT_B = "99999999-9999-4999-8999-999999999999";
const REVISION = "66666666-6666-4666-8666-666666666666";

const validBody = {
  initiatorPostId: DEMAND,
  counterpartPostId: PROVIDER,
  clientRequestId: CLIENT,
  clientRevisionId: REVISION,
  proposal: {
    category: "travel",
    proposedDate: "2026-09-12",
    proposedTimeWindow: "14:00-14:15",
  },
  contactPreference: "phone",
  whatsappAvailable: false,
  viberAvailable: false,
};

const quote: ServerMatchRequestQuote = {
  pricingVersion: 1,
  pricingCountryCode: "RS",
  pricingCurrency: "RSD",
  baseAmountMinor: 1000,
  bumpTierId: null,
  bumpAmountMinor: 0,
  totalAmountMinor: 1000,
  matchPercentBasisPoints: 9100,
  extraDetourM: 4000,
  extraDurationSeconds: 600,
};

const demandPost = {
  id: DEMAND,
  user_id: ACTOR,
  post_type: "demand",
  category: "travel",
  status: "active",
  departure_date: "2026-09-12",
  departure_time_window: "14:00-14:15",
  transport_mode: "car",
  max_companions: 1,
  origin_address: "Belgrade",
  destination_address: "Novi Sad",
};
const providerPost = {
  ...demandPost,
  id: PROVIDER,
  user_id: OTHER,
  post_type: "provider",
  departure_time_window: "20:00-20:15",
};
const providerB = { ...providerPost, id: PROVIDER_B };

const pair = generateCodeWithPepper(
  {
    actorUserId: ACTOR,
    clientRequestId: CLIENT,
    clientRevisionId: REVISION,
    initiatorPostId: DEMAND,
    counterpartPostId: PROVIDER,
  },
  PEPPER,
);

function baseState(): SimulatedWriterState {
  return {
    now: "2026-09-12T00:00:00.000Z",
    config: {
      matching_request_creation_enabled: true,
      matching_request_ttl_minutes: 1440,
      matching_request_max_open_per_initiator_post: 20,
      matching_request_max_created_per_actor_24h: 50,
      matching_contact_policy_version: 1,
    },
    posts: [demandPost, providerPost, providerB],
    profiles: [{ id: ACTOR, phone: "+381611111111" }],
    invitations: [],
    requests: [],
    revisions: [],
    grants: [],
    contracts: [],
    allocations: [],
    events: [],
    fraudRows: [],
  };
}

function writerInput(
  overrides: Partial<Parameters<typeof evaluateMatchRequestWriter>[1]> = {},
) {
  return {
    actorUserId: ACTOR,
    initiatorPostId: DEMAND,
    counterpartPostId: PROVIDER,
    clientRequestId: CLIENT,
    clientRevisionId: REVISION,
    contactCodeHash: pair.codeHash,
    admissionDigest: "",
    proposalDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    quoteDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    proposal: {
      category: "travel" as const,
      proposedDate: "2026-09-12",
      proposedTimeWindow: "14:00-14:15",
      pickupLocation: { locationVersion: 1 as const, displayAddress: "Belgrade" },
      dropoffLocation: { locationVersion: 1 as const, displayAddress: "Novi Sad" },
      bumpTierId: null,
      note: null,
    },
    quote,
    contactPreference: "phone" as const,
    whatsappAvailable: false,
    viberAvailable: false,
    ...overrides,
  };
}

function emptyInspect(
  overrides: Partial<MatchRequestInspectRow> = {},
): MatchRequestInspectRow {
  return {
    existing_for_client_request: false,
    open_count: 0,
    created_24h_count: 0,
    max_open: 20,
    max_created_24h: 50,
    creation_enabled: true,
    ...overrides,
  };
}

async function run(overrides: Partial<MatchRequestRouteDeps> & { body?: unknown } = {}) {
  return runMatchRequestCreate({
    readBody: async () => overrides.body ?? validBody,
    getUser: overrides.getUser ?? (async () => ACTOR),
    readPepper: overrides.readPepper ?? (() => PEPPER),
    generateCode:
      overrides.generateCode ??
      ((input) => generateContactInvitationCode({ pepper: PEPPER, ...input })),
    createAdmin: overrides.createAdmin ?? (() => ({ kind: "admin" })),
    inspect: overrides.inspect ?? (async () => emptyInspect()),
    loadPosts:
      overrides.loadPosts ??
      (async () => ({ initiator: demandPost, counterpart: providerPost })),
    loadActorPhonePresent: overrides.loadActorPhonePresent ?? (async () => true),
    scoreRoute:
      overrides.scoreRoute ??
      (async () => ({ ok: true, score: 0.9, extraDetourKms: 2, baselineKms: 12 })),
    loadThresholds:
      overrides.loadThresholds ??
      (async () => ({ maxExtraDetourKm: 30, maxExtraDetourRatio: 0.5 })),
    loadQuote: overrides.loadQuote ?? (async () => quote),
    callWriter:
      overrides.callWriter ??
      (async () => ({
        request_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        revision_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        invitation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        request_status: "pending",
        revision_status: "current",
        expires_at: "2026-09-13T00:00:00.000Z",
        effective_client_request_id: CLIENT,
        effective_client_revision_id: REVISION,
        created: true,
      })),
  });
}

async function main() {
  assert.equal(parseMatchRequestCreateBody(validBody).ok, true);
  assert.equal(parseMatchRequestCreateBody({ ...validBody, score: 1 }).ok, false);
  assert.equal(parseMatchRequestCreateBody({ ...validBody, userId: ACTOR }).ok, false);
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      proposal: { ...validBody.proposal, phone: "+381" },
    }).ok,
    false,
  );
  {
    const parsed = parseMatchRequestCreateBody({
      ...validBody,
      contactPreference: "whatsapp",
      whatsappAvailable: false,
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.errorKey, MATCH_REQUEST_ERROR.contactChannelInvalid);
    }
  }

  assert.equal(
    evaluateMatchRequestEligibility({
      actorUserId: ACTOR,
      initiator: demandPost,
      counterpart: providerPost,
      route: { ok: true, score: 0.9, extraDetourKms: 2, baselineKms: 12 },
      thresholds: { maxExtraDetourKm: 30, maxExtraDetourRatio: 0.5 },
      proposal: validBody.proposal as never,
    }).ok,
    true,
  );
  assert.equal(
    evaluateMatchRequestEligibility({
      actorUserId: ACTOR,
      initiator: demandPost,
      counterpart: { ...providerPost, departure_date: "2026-09-13" },
      route: { ok: true, score: 0.9, extraDetourKms: 2, baselineKms: 12 },
      thresholds: { maxExtraDetourKm: 30, maxExtraDetourRatio: 0.5 },
      proposal: validBody.proposal as never,
    }).ok,
    false,
  );
  assert.equal(
    evaluateMatchRequestEligibility({
      actorUserId: ACTOR,
      initiator: demandPost,
      counterpart: providerPost,
      route: { ok: true, score: 0.9, extraDetourKms: 2, baselineKms: 12 },
      thresholds: { maxExtraDetourKm: 30, maxExtraDetourRatio: 0.5 },
      proposal: {
        category: "travel",
        proposedDate: "2026-02-30",
        proposedTimeWindow: "14:00-14:15",
      },
    }).ok,
    false,
  );

  assert.equal(quoteIsLegal(quote), true);
  assert.equal(quoteIsLegal({ ...quote, totalAmountMinor: 9 }), false);
  assert.equal(buildProductionServerQuote(), null);

  assert.equal(
    revisionStatusTimestampsAreLegal({
      status: "current",
      supersededAt: null,
      respondedAt: null,
    }),
    true,
  );
  assert.equal(
    revisionStatusTimestampsAreLegal({
      status: "superseded",
      supersededAt: "2026-09-12T01:00:00.000Z",
      respondedAt: null,
    }),
    true,
  );
  assert.equal(
    revisionStatusTimestampsAreLegal({
      status: "accepted",
      supersededAt: null,
      respondedAt: "2026-09-12T01:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    revisionStatusTimestampsAreLegal({
      status: "expired",
      supersededAt: null,
      respondedAt: null,
    }),
    true,
  );
  assert.equal(
    revisionStatusTimestampsAreLegal({
      status: "current",
      supersededAt: "2026-09-12T01:00:00.000Z",
      respondedAt: null,
    }),
    false,
  );
  assert.equal(
    revisionStatusTimestampsAreLegal({
      status: "accepted",
      supersededAt: "2026-09-12T01:00:00.000Z",
      respondedAt: "2026-09-12T01:00:00.000Z",
    }),
    false,
  );

  {
    const created = evaluateMatchRequestWriter(baseState(), writerInput());
    assert.equal(created.ok, true);
    if (created.ok) {
      assert.equal(created.row.created, true);
      assert.equal(created.state.invitations.length, 1);
      assert.equal(created.state.requests.length, 1);
      assert.equal(created.state.revisions.length, 1);
      assert.equal(created.state.grants.length, 1);
      assert.equal(created.state.requests[0]?.accepted_revision_id, null);
      assert.equal(created.state.revisions.filter((row) => row.status === "current").length, 1);
      assert.equal(created.state.invitations[0]?.disclosure_mode, "recipient_contacts_initiator");
      assert.equal(created.state.grants[0]?.subject_user_id, ACTOR);
      assert.equal(created.state.grants[0]?.viewer_user_id, OTHER);
      assert.equal(created.state.contracts.length, 0);
      assert.equal(created.state.allocations.length, 0);
      assert.equal(created.state.events.length, 0);
      assert.equal(created.state.fraudRows.length, 0);
      assert.equal(created.state.posts.every((post) => post.status === "active"), true);
      assert.equal(JSON.stringify(created.state).includes(pair.code), false);
      assert.equal(JSON.stringify(created.state.revisions).includes("+381"), false);
      assert.equal(JSON.stringify(created.state.invitations).includes("+381"), false);
      assert.equal(JSON.stringify(created.state.grants).includes("+381"), false);
      const retry = evaluateMatchRequestWriter(created.state, writerInput());
      assert.equal(retry.ok, true);
      if (retry.ok) {
        assert.equal(retry.row.created, false);
        assert.equal(retry.state.requests.length, 1);
        assert.equal(retry.state.grants.length, 1);
      }
      const collision = evaluateMatchRequestWriter(
        created.state,
        writerInput({ proposalDigest: "cccccccccccccccccccccccccccccccc" }),
      );
      assert.equal(collision.ok, false);
      if (!collision.ok) {
        assert.equal(collision.errorKey, MATCH_REQUEST_ERROR.idempotencyConflict);
      }
    }
  }

  {
    const disabled = evaluateMatchRequestWriter(
      { ...baseState(), config: { ...baseState().config, matching_request_creation_enabled: false } },
      writerInput(),
    );
    assert.equal(disabled.ok, false);
    if (!disabled.ok) {
      assert.equal(disabled.errorKey, MATCH_REQUEST_ERROR.creationDisabled);
      assert.equal(disabled.state.requests.length, 0);
      assert.equal(disabled.state.invitations.length, 0);
      assert.equal(disabled.state.revisions.length, 0);
      assert.equal(disabled.state.grants.length, 0);
    }
  }

  {
    const priced = evaluateMatchRequestWriter(
      baseState(),
      writerInput({ quote: { ...quote, totalAmountMinor: 1 } }),
    );
    assert.equal(priced.ok, false);
    if (!priced.ok) {
      assert.equal(priced.errorKey, MATCH_REQUEST_ERROR.pricingNotReady);
      assert.equal(priced.state.requests.length, 0);
    }
  }

  {
    const first = evaluateMatchRequestWriter(baseState(), writerInput());
    assert.equal(first.ok, true);
    if (first.ok) {
      const concurrent = evaluateMatchRequestWriter(
        first.state,
        writerInput({
          clientRequestId: CLIENT_B,
          contactCodeHash: generateContactInvitationCode({
            pepper: PEPPER,
            actorUserId: ACTOR,
            clientRequestId: CLIENT_B,
            clientRevisionId: REVISION,
            initiatorPostId: DEMAND,
            counterpartPostId: PROVIDER,
          }).codeHash,
        }),
      );
      assert.equal(concurrent.ok, false);
      if (!concurrent.ok) {
        assert.equal(concurrent.errorKey, MATCH_REQUEST_ERROR.alreadyOpen);
      }
    }
  }

  {
    const limited = {
      ...baseState(),
      config: { ...baseState().config, matching_request_max_created_per_actor_24h: 1 },
    };
    const first = evaluateMatchRequestWriter(limited, writerInput());
    assert.equal(first.ok, true);
    if (first.ok) {
      const second = evaluateMatchRequestWriter(
        first.state,
        writerInput({
          counterpartPostId: PROVIDER_B,
          clientRequestId: CLIENT_B,
          contactCodeHash: generateContactInvitationCode({
            pepper: PEPPER,
            actorUserId: ACTOR,
            clientRequestId: CLIENT_B,
            clientRevisionId: REVISION,
            initiatorPostId: DEMAND,
            counterpartPostId: PROVIDER_B,
          }).codeHash,
        }),
      );
      assert.equal(second.ok, false);
      if (!second.ok) {
        assert.equal(second.errorKey, MATCH_REQUEST_ERROR.rateLimit);
      }
    }
  }

  {
    const expiredState = baseState();
    expiredState.requests.push({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      invitation_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      demand_post_id: DEMAND,
      provider_post_id: PROVIDER,
      requester_user_id: ACTOR,
      recipient_user_id: OTHER,
      client_request_id: CLIENT_B,
      status: "pending",
      expires_at: "2026-09-11T00:00:00.000Z",
      created_at: "2026-09-11T12:00:00.000Z",
      updated_at: "2026-09-11T12:00:00.000Z",
      current_revision_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      accepted_revision_id: null,
      request_assertion: {
        admissionDigest: "",
        proposalDigest: "old",
        quoteDigest: "old",
      },
    });
    const afterExpire = evaluateMatchRequestWriter(expiredState, writerInput());
    assert.equal(afterExpire.ok, true);
    const rateState = {
      ...baseState(),
      config: { ...baseState().config, matching_request_max_created_per_actor_24h: 1 },
    };
    rateState.requests.push({
      ...expiredState.requests[0]!,
      status: "expired",
    });
    const stillRate = evaluateMatchRequestWriter(rateState, writerInput());
    assert.equal(stillRate.ok, false);
    if (!stillRate.ok) {
      assert.equal(stillRate.errorKey, MATCH_REQUEST_ERROR.rateLimit);
    }
  }

  {
    const created = await run({});
    assert.equal(created.status, 201);
    assert.equal(created.writerCalled, true);
    assert.equal(created.routeScored, true);
    if (created.json.ok) {
      assert.equal(created.json.request.created, true);
      assert.equal(created.json.request.contactCode, pair.code);
    }
  }
  {
    const replay = await run({
      inspect: async () => emptyInspect({ existing_for_client_request: true }),
      callWriter: async () => ({
        request_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        revision_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        invitation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        request_status: "pending",
        revision_status: "current",
        expires_at: "2026-09-13T00:00:00.000Z",
        effective_client_request_id: CLIENT,
        effective_client_revision_id: REVISION,
        created: false,
      }),
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.writerCalled, true);
    assert.equal(replay.routeScored, false);
    if (replay.json.ok) assert.equal(replay.json.request.created, false);
  }
  {
    const disabled = await run({
      inspect: async () => emptyInspect({ creation_enabled: false }),
    });
    assert.equal(disabled.status, 409);
    assert.equal(disabled.writerCalled, false);
    if (!disabled.json.ok) {
      assert.equal(disabled.json.errorKey, MATCH_REQUEST_ERROR.creationDisabled);
    }
    assert.equal(JSON.stringify(disabled.json).includes("contactCode"), false);
  }
  {
    const priced = await run({ loadQuote: async () => null });
    assert.equal(priced.status, 409);
    assert.equal(priced.writerCalled, false);
    if (!priced.json.ok) {
      assert.equal(priced.json.errorKey, MATCH_REQUEST_ERROR.pricingNotReady);
    }
    assert.equal(JSON.stringify(priced.json).includes("contactCode"), false);
  }
  {
    const limited = await run({
      inspect: async () => emptyInspect({ open_count: 20, max_open: 20 }),
    });
    assert.equal(limited.status, 429);
    assert.equal(JSON.stringify(limited.json).includes("contactCode"), false);
  }
  {
    const conflict = await run({
      inspect: async () => emptyInspect({ existing_for_client_request: true }),
      callWriter: async () => {
        throw new Error(MATCH_REQUEST_ERROR.idempotencyConflict);
      },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.writerCalled, true);
    assert.equal(JSON.stringify(conflict.json).includes(pair.code), false);
  }
  {
    const unauthorized = await run({ getUser: async () => null });
    assert.equal(unauthorized.status, 401);
    assert.equal(JSON.stringify(unauthorized.json).includes("contactCode"), false);
  }
  {
    const invalidRow = await run({
      callWriter: async () => ({
        request_id: "not-a-uuid",
        revision_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        invitation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        request_status: "pending",
        revision_status: "current",
        expires_at: "2026-09-13T00:00:00.000Z",
        effective_client_request_id: CLIENT,
        effective_client_revision_id: REVISION,
        created: true,
      }),
    });
    assert.equal(invalidRow.status, 500);
    assert.equal(JSON.stringify(invalidRow.json).includes(pair.code), false);
  }
  {
    const dumped = JSON.stringify([
      MATCH_REQUEST_SAFE_LOGS,
      await run({
        getUser: async () => {
          throw new Error(`${pair.code} ${pair.codeHash}`);
        },
      }),
    ]);
    assert.equal(dumped.includes(pair.code), false);
    assert.equal(dumped.includes(pair.codeHash), false);
  }

  assert.equal(
    interpretMatchRequestWriterRow(
      {
        request_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        revision_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        invitation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        request_status: "pending",
        revision_status: "current",
        expires_at: "2026-09-13T00:00:00.000Z",
        effective_client_request_id: CLIENT,
        effective_client_revision_id: REVISION,
        created: true,
      },
      CLIENT,
      REVISION,
    ).ok,
    true,
  );
  assert.equal(httpStatusForMatchRequestError(MATCH_REQUEST_ERROR.creationDisabled), 409);
  assert.equal(httpStatusForMatchRequestError(MATCH_REQUEST_ERROR.pricingNotReady), 409);
  assert.equal(httpStatusForMatchRequestError(MATCH_REQUEST_ERROR.openLimit), 429);

  const route = readFileSync(join(repoRoot, "src/app/api/matching/requests/route.ts"), "utf8");
  assert.ok(route.includes("create_match_request_v95"));
  assert.ok(route.includes("inspect_match_request_v95"));
  assert.equal(route.includes("contact-invitations"), false);
  assert.equal(route.includes("matching_contact_mode"), false);

  console.log("matchRequestCreate.test.ts: ok");
}

void main();
