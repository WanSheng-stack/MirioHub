/**
 * PHASE 6.7C.1B.1 — parse, sparse locations, idempotency, expiry.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/matchRequestCreate.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateContactInvitationCode } from "@/lib/matching/contactInvitationCodeCore";
import { ADMISSION_FACTS_FIELDS } from "@/lib/matching/matchAdmissionPolicy";
import {
  buildAdmissionPostFact,
  buildProductionServerQuote,
  canonicalizeBrowserProposal,
  compositeRevisionPointerHolds,
  computeIdempotencyPayloadHash,
  demandDefaultLocation,
  evaluateMatchRequestEligibility,
  evaluateMatchRequestWriter,
  hashAdmissionFactsPair,
  httpStatusForMatchRequestError,
  snapshotPairQueryAccepts,
  isCanonicalStoredPhone,
  MATCH_REQUEST_ERROR,
  parseLocationChoice,
  parseMatchRequestCreateBody,
  proposalHasOverride,
  quoteIsLegal,
  revisionStatusTimestampsAreLegal,
  type CanonicalProposal,
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
const PHONE = "381641234567";
const DEFAULT_LOC = { mode: "demand_post_default" as const };
const OVERRIDE_LOC = {
  mode: "override" as const,
  location: {
    locationVersion: 1 as const,
    displayLabel: "Kalemegdan Gate",
    latitude: 44.823,
    longitude: 20.45,
    precision: "precise" as const,
    timezoneName: "Europe/Belgrade",
  },
};

const validBody = {
  initiatorPostId: DEMAND,
  counterpartPostId: PROVIDER,
  clientRequestId: CLIENT,
  clientRevisionId: REVISION,
  proposal: {
    category: "travel" as const,
    proposedDate: "2026-09-12",
    proposedTimeWindow: "14:00-14:15",
    pickup: DEFAULT_LOC,
    dropoff: DEFAULT_LOC,
  },
  contactPreference: "phone" as const,
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
  service_subtype: "passenger",
  escort_seats: 0,
  max_companions: 1,
  count_small: 0,
  count_medium: 0,
  count_large: 0,
  count_xlarge: 0,
  origin_address: "Belgrade",
  destination_address: "Novi Sad",
  waypoints: [] as string[],
  origin_gps_ewkb: "0101000020e6100000",
  destination_gps_ewkb: "0101000020e6100001",
  origin_country_code: "RS",
  origin_timezone: "Europe/Belgrade",
  night_policy_version: 1,
};
const providerPost = {
  ...demandPost,
  id: PROVIDER,
  user_id: OTHER,
  post_type: "provider",
  departure_time_window: "20:00-20:15",
};
const providerB = { ...providerPost, id: PROVIDER_B };
const admissionHash = hashAdmissionFactsPair(demandPost, providerPost);

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

function travelProposal(
  overrides: Partial<Extract<CanonicalProposal, { category: "travel" }>> = {},
): Extract<CanonicalProposal, { category: "travel" }> {
  return {
    category: "travel",
    proposedDate: "2026-09-12",
    proposedTimeWindow: "14:00-14:15",
    pickup: DEFAULT_LOC,
    dropoff: DEFAULT_LOC,
    bumpTierId: null,
    note: null,
    ...overrides,
  };
}

function idemHash(
  overrides: Partial<Parameters<typeof computeIdempotencyPayloadHash>[0]> = {},
) {
  return computeIdempotencyPayloadHash({
    actorUserId: ACTOR,
    initiatorPostId: DEMAND,
    counterpartPostId: PROVIDER,
    clientRequestId: CLIENT,
    clientRevisionId: REVISION,
    proposal: travelProposal(),
    contactPreference: "phone",
    whatsappAvailable: false,
    viberAvailable: false,
    contactCodeHash: pair.codeHash,
    ...overrides,
  });
}

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
    profiles: [{ id: ACTOR, phone: PHONE }],
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
    idempotencyPayloadHash: idemHash(),
    admissionFactsHash: admissionHash,
    proposal: travelProposal(),
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
    loadSnapshot:
      overrides.loadSnapshot ??
      (async () => ({
        initiator: demandPost,
        counterpart: providerPost,
        admissionFactsHash: admissionHash,
      })),
    loadActorPhoneCanonical: overrides.loadActorPhoneCanonical ?? (async () => true),
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

function expiredPairState(): SimulatedWriterState {
  const state = baseState();
  const invId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const reqId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const revId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  state.invitations.push({
    id: invId,
    demand_post_id: DEMAND,
    provider_post_id: PROVIDER,
    initiator_user_id: ACTOR,
    recipient_user_id: OTHER,
    initiator_post_id: DEMAND,
    status: "open",
    contact_code_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    client_request_id: CLIENT_B,
    disclosure_mode: "recipient_contacts_initiator",
    expires_at: "2026-09-11T00:00:00.000Z",
    invalidated_at: null,
  });
  state.requests.push({
    id: reqId,
    invitation_id: invId,
    demand_post_id: DEMAND,
    provider_post_id: PROVIDER,
    requester_user_id: ACTOR,
    recipient_user_id: OTHER,
    client_request_id: CLIENT_B,
    status: "pending",
    expires_at: "2026-09-11T00:00:00.000Z",
    created_at: "2026-09-10T12:00:00.000Z",
    updated_at: "2026-09-10T12:00:00.000Z",
    current_revision_id: revId,
    accepted_revision_id: null,
    idempotency_payload_hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  state.revisions.push({
    id: revId,
    request_id: reqId,
    revision_no: 1,
    status: "current",
    client_revision_id: REVISION,
    proposal_payload: travelProposal(),
    quote,
    contact_preference: "phone",
  });
  state.grants.push({
    invitation_id: invId,
    subject_user_id: ACTOR,
    viewer_user_id: OTHER,
    allowed_channels: ["phone"],
    preferred_channel: "phone",
    expires_at: "2026-09-11T00:00:00.000Z",
    revoked_at: null,
  });
  return state;
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

  assert.equal(parseLocationChoice(DEFAULT_LOC).ok, true);
  assert.equal(parseLocationChoice({ mode: "demand_post_default", location: OVERRIDE_LOC.location }).ok, false);
  assert.equal(parseLocationChoice(OVERRIDE_LOC).ok, true);
  assert.equal(parseLocationChoice({ mode: "override" }).ok, false);
  assert.equal(parseLocationChoice({ mode: "custom" }).ok, false);
  assert.equal(parseLocationChoice([]).ok, false);
  assert.equal(
    parseLocationChoice({
      ...OVERRIDE_LOC,
      location: { ...OVERRIDE_LOC.location, locationVersion: 1.5 },
    }).ok,
    false,
  );
  assert.equal(
    parseLocationChoice({
      ...OVERRIDE_LOC,
      location: { ...OVERRIDE_LOC.location, locationVersion: "1" },
    }).ok,
    false,
  );
  assert.equal(
    parseLocationChoice({
      ...OVERRIDE_LOC,
      location: { ...OVERRIDE_LOC.location, latitude: Number.NaN },
    }).ok,
    false,
  );
  assert.equal(
    parseLocationChoice({
      ...OVERRIDE_LOC,
      location: { ...OVERRIDE_LOC.location, longitude: Number.POSITIVE_INFINITY },
    }).ok,
    false,
  );
  assert.equal(
    parseLocationChoice({
      ...OVERRIDE_LOC,
      location: { ...OVERRIDE_LOC.location, latitude: 91 },
    }).ok,
    false,
  );
  assert.equal(
    parseLocationChoice({
      ...OVERRIDE_LOC,
      location: { ...OVERRIDE_LOC.location, longitude: -181 },
    }).ok,
    false,
  );
  assert.equal(
    parseLocationChoice({
      ...OVERRIDE_LOC,
      location: { ...OVERRIDE_LOC.location, displayLabel: "  " },
    }).ok,
    false,
  );
  assert.equal(
    parseLocationChoice({
      ...OVERRIDE_LOC,
      location: { ...OVERRIDE_LOC.location, displayLabel: "x".repeat(201) },
    }).ok,
    false,
  );
  assert.equal(
    parseLocationChoice({
      ...OVERRIDE_LOC,
      location: { ...OVERRIDE_LOC.location, timezoneName: "Belgrade" },
    }).ok,
    false,
  );
  assert.equal(
    parseLocationChoice({
      ...OVERRIDE_LOC,
      location: { ...OVERRIDE_LOC.location, timezoneName: "UTC" },
    }).ok,
    true,
  );
  assert.equal(
    parseLocationChoice({
      ...OVERRIDE_LOC,
      location: { ...OVERRIDE_LOC.location, precision: "exact" },
    }).ok,
    false,
  );
  assert.equal(
    parseLocationChoice({
      ...OVERRIDE_LOC,
      location: { ...OVERRIDE_LOC.location, phone: PHONE },
    }).ok,
    false,
  );
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      proposal: { ...validBody.proposal, dropoff: undefined },
    }).ok,
    false,
  );
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      proposal: {
        category: "deliver",
        proposedDate: "2026-09-12",
        proposedTimeWindow: "14:00-14:15",
        pickup: DEFAULT_LOC,
      },
    }).ok,
    false,
  );
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      proposal: { ...validBody.proposal, note: "  " },
    }).ok,
    true,
  );
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      proposal: { ...validBody.proposal, note: "x".repeat(501) },
    }).ok,
    false,
  );
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      proposal: { ...validBody.proposal, note: "备注".repeat(10) },
    }).ok,
    true,
  );
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      proposal: { ...validBody.proposal, bumpTierId: "Tier A" },
    }).ok,
    false,
  );
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      proposal: { ...validBody.proposal, bumpTierId: "tier_rs.1" },
    }).ok,
    true,
  );
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      proposal: { ...validBody.proposal, bumpTierId: "x".repeat(51) },
    }).ok,
    false,
  );
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      proposal: { ...validBody.proposal, proposedDate: "2026-02-30" },
    }).ok,
    false,
  );
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      proposal: { ...validBody.proposal, proposedTimeWindow: "afternoon" },
    }).ok,
    false,
  );
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      whatsappAvailable: "true",
    }).ok,
    false,
  );
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      initiatorPostId: "not-a-uuid",
    }).ok,
    false,
  );
  assert.equal(
    parseMatchRequestCreateBody({
      ...validBody,
      proposal: { ...validBody.proposal, category: "buy" },
    }).ok,
    false,
  );
  assert.equal(
    parseMatchRequestCreateBody(JSON.parse('{"__proto__":{"x":1},"initiatorPostId":"1"}')).ok,
    false,
  );
  {
    const parsed = parseMatchRequestCreateBody({
      ...validBody,
      proposal: { ...validBody.proposal, note: "  keep me  " },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      const canonical = canonicalizeBrowserProposal(parsed.value.proposal);
      assert.equal(canonical.note, "keep me");
      assert.equal(canonical.pickup.mode, "demand_post_default");
      assert.equal("location" in canonical.pickup, false);
      assert.equal(JSON.stringify(canonical).includes("Belgrade"), false);
    }
  }

  const demandCanonical = canonicalizeBrowserProposal({
    category: "travel",
    proposedDate: "2026-09-12",
    proposedTimeWindow: "14:00-14:15",
    pickup: DEFAULT_LOC,
    dropoff: DEFAULT_LOC,
  });
  const providerInitiated = canonicalizeBrowserProposal({
    category: "travel",
    proposedDate: "2026-09-12",
    proposedTimeWindow: "14:00-14:15",
    pickup: DEFAULT_LOC,
    dropoff: DEFAULT_LOC,
  });
  assert.deepEqual(demandCanonical.pickup, demandDefaultLocation());
  assert.equal(providerInitiated.category, "travel");
  if (providerInitiated.category === "travel") {
    assert.deepEqual(providerInitiated.dropoff, demandDefaultLocation());
  }
  assert.equal(proposalHasOverride(travelProposal({ pickup: OVERRIDE_LOC })), true);

  assert.equal(
    evaluateMatchRequestEligibility({
      actorUserId: ACTOR,
      initiator: demandPost,
      counterpart: providerPost,
      route: { ok: true, score: 0.9, extraDetourKms: 2, baselineKms: 12 },
      thresholds: { maxExtraDetourKm: 30, maxExtraDetourRatio: 0.5 },
      proposal: validBody.proposal,
    }).ok,
    true,
  );
  assert.equal(
    evaluateMatchRequestEligibility({
      actorUserId: ACTOR,
      initiator: { ...demandPost, service_subtype: null },
      counterpart: providerPost,
      route: { ok: true, score: 0.9, extraDetourKms: 2, baselineKms: 12 },
      thresholds: { maxExtraDetourKm: 30, maxExtraDetourRatio: 0.5 },
      proposal: validBody.proposal,
    }).ok,
    false,
  );
  assert.equal(
    evaluateMatchRequestEligibility({
      actorUserId: ACTOR,
      initiator: { ...demandPost, origin_country_code: null },
      counterpart: providerPost,
      route: { ok: true, score: 0.9, extraDetourKms: 2, baselineKms: 12 },
      thresholds: { maxExtraDetourKm: 30, maxExtraDetourRatio: 0.5 },
      proposal: validBody.proposal,
    }).ok,
    false,
  );
  assert.equal(
    evaluateMatchRequestEligibility({
      actorUserId: ACTOR,
      initiator: demandPost,
      counterpart: { ...providerPost, departure_date: "2026-09-13" },
      route: { ok: true, score: 0.9, extraDetourKms: 2, baselineKms: 12 },
      thresholds: { maxExtraDetourKm: 30, maxExtraDetourRatio: 0.5 },
      proposal: validBody.proposal,
    }).ok,
    false,
  );

  assert.equal(quoteIsLegal(quote), true);
  assert.equal(quoteIsLegal({ ...quote, totalAmountMinor: 9 }), false);
  assert.equal(buildProductionServerQuote(), null);
  assert.equal(isCanonicalStoredPhone(PHONE), true);
  assert.equal(isCanonicalStoredPhone("hello"), false);
  assert.equal(isCanonicalStoredPhone("+381641234567"), false);
  assert.equal(isCanonicalStoredPhone(""), false);

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
      status: "current",
      supersededAt: "2026-09-12T01:00:00.000Z",
      respondedAt: null,
    }),
    false,
  );

  assert.deepEqual(
    [...ADMISSION_FACTS_FIELDS],
    [
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
    ],
  );
  {
    const base = hashAdmissionFactsPair(demandPost, providerPost);
    assert.equal(hashAdmissionFactsPair(providerPost, demandPost), base);
    assert.notEqual(
      hashAdmissionFactsPair({ ...demandPost, escort_seats: 2 }, providerPost),
      base,
    );
    assert.notEqual(
      hashAdmissionFactsPair({ ...demandPost, origin_gps_ewkb: "ffff" }, providerPost),
      base,
    );
    assert.notEqual(
      hashAdmissionFactsPair({ ...demandPost, count_small: 3 }, providerPost),
      base,
    );
    assert.notEqual(
      hashAdmissionFactsPair(
        { ...demandPost, waypoints: ["A", "B"] },
        providerPost,
      ),
      hashAdmissionFactsPair(
        { ...demandPost, waypoints: ["B", "A"] },
        providerPost,
      ),
    );
    const pipeLeft = { ...demandPost, origin_address: "Belgrade|Novi Sad", destination_address: "" };
    const pipeRight = { ...demandPost, origin_address: "Belgrade", destination_address: "Novi Sad" };
    assert.notEqual(
      JSON.stringify(buildAdmissionPostFact(pipeLeft)),
      JSON.stringify(buildAdmissionPostFact(pipeRight)),
    );
    const nullAddr = buildAdmissionPostFact({ ...demandPost, origin_address: null });
    const emptyAddr = buildAdmissionPostFact({ ...demandPost, origin_address: "" });
    assert.notEqual(JSON.stringify(nullAddr), JSON.stringify(emptyAddr));
    const extraField = { ...demandPost, share_mode: "public" } as typeof demandPost & {
      share_mode: string;
    };
    assert.equal(hashAdmissionFactsPair(extraField, providerPost), base);
    const unicode = { ...demandPost, origin_address: "贝尔格莱德\n|" };
    assert.notEqual(
      JSON.stringify(buildAdmissionPostFact(unicode)),
      JSON.stringify(buildAdmissionPostFact(demandPost)),
    );
    assert.equal(
      snapshotPairQueryAccepts({ leftId: DEMAND, rightId: PROVIDER, foundIds: [DEMAND, PROVIDER] }),
      true,
    );
    assert.equal(
      snapshotPairQueryAccepts({ leftId: PROVIDER, rightId: DEMAND, foundIds: [DEMAND, PROVIDER] }),
      true,
    );
    assert.equal(
      snapshotPairQueryAccepts({ leftId: DEMAND, rightId: PROVIDER, foundIds: [DEMAND] }),
      false,
    );
    assert.equal(
      snapshotPairQueryAccepts({ leftId: DEMAND, rightId: DEMAND, foundIds: [DEMAND] }),
      false,
    );
  }

  assert.equal(
    compositeRevisionPointerHolds({
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      pointerRevisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      revisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      revisionRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }),
    true,
  );
  assert.equal(
    compositeRevisionPointerHolds({
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      pointerRevisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      revisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      revisionRequestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    }),
    false,
  );
  assert.equal(
    compositeRevisionPointerHolds({
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      pointerRevisionId: null,
      revisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      revisionRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }),
    true,
  );

  {
    const created = evaluateMatchRequestWriter(baseState(), writerInput());
    assert.equal(created.ok, true);
    if (created.ok) {
      assert.equal(created.row.created, true);
      assert.equal(created.state.requests[0]?.accepted_revision_id, null);
      assert.deepEqual(created.state.revisions[0]?.proposal_payload, travelProposal());
      assert.deepEqual(created.state.revisions[0]?.quote, quote);
      assert.equal(JSON.stringify(created.state.revisions[0]?.proposal_payload).includes("Belgrade"), false);
      assert.equal(created.state.contracts.length, 0);
      assert.equal(created.state.allocations.length, 0);
      assert.equal(created.state.events.length, 0);
      assert.equal(created.state.fraudRows.length, 0);
      const retry = evaluateMatchRequestWriter(created.state, writerInput());
      assert.equal(retry.ok, true);
      if (retry.ok) {
        assert.equal(retry.row.created, false);
        assert.equal(retry.row.expires_at, created.row.expires_at);
        assert.equal(retry.state.requests[0]?.updated_at, created.state.requests[0]?.updated_at);
        assert.equal(retry.state.grants.length, 1);
        assert.equal(retry.state.requests.length, 1);
      }
      const collision = evaluateMatchRequestWriter(
        created.state,
        writerInput({
          idempotencyPayloadHash: idemHash({
            proposal: travelProposal({ note: "changed" }),
          }),
        }),
      );
      assert.equal(collision.ok, false);
      if (!collision.ok) {
        assert.equal(collision.errorKey, MATCH_REQUEST_ERROR.idempotencyConflict);
      }
      const terminal = structuredClone(created.state);
      terminal.requests[0]!.status = "expired";
      terminal.revisions[0]!.status = "expired";
      const stale = evaluateMatchRequestWriter(terminal, writerInput());
      assert.equal(stale.ok, false);
      if (!stale.ok) {
        assert.equal(stale.errorKey, MATCH_REQUEST_ERROR.notCurrent);
      }
    }
  }

  {
    const providerInit = evaluateMatchRequestWriter(
      baseState(),
      writerInput({
        actorUserId: OTHER,
        initiatorPostId: PROVIDER,
        counterpartPostId: DEMAND,
        admissionFactsHash: hashAdmissionFactsPair(providerPost, demandPost),
        idempotencyPayloadHash: idemHash({
          actorUserId: OTHER,
          initiatorPostId: PROVIDER,
          counterpartPostId: DEMAND,
        }),
      }),
    );
    assert.equal(providerInit.ok, false);
    const providerState = baseState();
    providerState.profiles.push({ id: OTHER, phone: PHONE });
    const providerOk = evaluateMatchRequestWriter(
      providerState,
      writerInput({
        actorUserId: OTHER,
        initiatorPostId: PROVIDER,
        counterpartPostId: DEMAND,
        admissionFactsHash: hashAdmissionFactsPair(providerPost, demandPost),
        idempotencyPayloadHash: idemHash({
          actorUserId: OTHER,
          initiatorPostId: PROVIDER,
          counterpartPostId: DEMAND,
        }),
      }),
    );
    assert.equal(providerOk.ok, true);
    if (providerOk.ok) {
      assert.equal(providerOk.state.requests[0]?.demand_post_id, DEMAND);
      assert.deepEqual(providerOk.state.revisions[0]?.proposal_payload.pickup, DEFAULT_LOC);
      assert.equal(JSON.stringify(providerOk.state.revisions[0]?.proposal_payload).includes("Belgrade"), false);
    }
  }

  {
    const override = evaluateMatchRequestWriter(
      baseState(),
      writerInput({ proposal: travelProposal({ pickup: OVERRIDE_LOC }) }),
    );
    assert.equal(override.ok, false);
    if (!override.ok) {
      assert.equal(override.errorKey, MATCH_REQUEST_ERROR.locationOverrideNotReady);
      assert.equal(override.state.requests.length, 0);
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
    }
  }

  {
    const priced = evaluateMatchRequestWriter(
      baseState(),
      writerInput({ quote: { ...quote, totalAmountMinor: 1 } }),
    );
    assert.equal(priced.ok, false);
    if (!priced.ok) assert.equal(priced.errorKey, MATCH_REQUEST_ERROR.pricingNotReady);
  }

  {
    const badPhone = evaluateMatchRequestWriter(
      { ...baseState(), profiles: [{ id: ACTOR, phone: "hello" }] },
      writerInput(),
    );
    assert.equal(badPhone.ok, false);
    if (!badPhone.ok) assert.equal(badPhone.errorKey, MATCH_REQUEST_ERROR.phoneRequired);
  }

  {
    const drifted = evaluateMatchRequestWriter(
      {
        ...baseState(),
        posts: [{ ...demandPost, escort_seats: 4 }, providerPost, providerB],
      },
      writerInput(),
    );
    assert.equal(drifted.ok, false);
    if (!drifted.ok) assert.equal(drifted.errorKey, MATCH_REQUEST_ERROR.notEligible);
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
          idempotencyPayloadHash: idemHash({ clientRequestId: CLIENT_B }),
        }),
      );
      assert.equal(concurrent.ok, false);
      if (!concurrent.ok) assert.equal(concurrent.errorKey, MATCH_REQUEST_ERROR.alreadyOpen);
    }
  }

  {
    const expired = evaluateMatchRequestWriter(expiredPairState(), writerInput());
    assert.equal(expired.ok, true);
    if (expired.ok) {
      const old = expired.state.requests.find((row) => row.id === "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
      const oldRev = expired.state.revisions.find((row) => row.id === "ffffffff-ffff-4fff-8fff-ffffffffffff");
      const oldInv = expired.state.invitations.find((row) => row.id === "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
      const oldGrant = expired.state.grants.find((row) => row.invitation_id === "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
      assert.equal(old?.status, "expired");
      assert.equal(old?.current_revision_id, "ffffffff-ffff-4fff-8fff-ffffffffffff");
      assert.equal(oldRev?.status, "expired");
      assert.equal(oldInv?.status, "expired");
      assert.equal(oldInv?.invalidated_at, expired.state.now);
      assert.equal(oldGrant?.revoked_at, expired.state.now);
      assert.equal(expired.state.requests.length, 2);
    }
  }

  {
    const mismatched = expiredPairState();
    mismatched.grants = [];
    const fail = evaluateMatchRequestWriter(mismatched, writerInput());
    assert.equal(fail.ok, false);
    if (!fail.ok) {
      assert.equal(fail.errorKey, MATCH_REQUEST_ERROR.inconsistentState);
      assert.equal(fail.state.requests.filter((row) => row.status === "pending" && row.id.startsWith("bbbb")).length, 0);
    }
  }

  {
    const created = await run({});
    assert.equal(created.status, 201);
    assert.equal(created.writerCalled, true);
    assert.equal(created.routeScored, true);
    assert.equal(created.postsLoaded, true);
    assert.equal(created.quoteLoaded, true);
    if (created.json.ok) {
      assert.equal(created.json.request.contactCode, pair.code);
    }
  }

  {
    let snapshotCalls = 0;
    let osrmCalls = 0;
    let quoteCalls = 0;
    const replay = await run({
      inspect: async () => emptyInspect({ existing_for_client_request: true, creation_enabled: false }),
      loadSnapshot: async () => {
        snapshotCalls += 1;
        return { initiator: demandPost, counterpart: providerPost, admissionFactsHash: admissionHash };
      },
      scoreRoute: async () => {
        osrmCalls += 1;
        return { ok: true, score: 0.9, extraDetourKms: 2, baselineKms: 12 };
      },
      loadQuote: async () => {
        quoteCalls += 1;
        return quote;
      },
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
    assert.equal(replay.postsLoaded, false);
    assert.equal(replay.quoteLoaded, false);
    assert.equal(snapshotCalls, 0);
    assert.equal(osrmCalls, 0);
    assert.equal(quoteCalls, 0);
    if (replay.json.ok) {
      assert.equal(replay.json.request.created, false);
      assert.equal(replay.json.request.contactCode, pair.code);
    }
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
  }

  {
    const overrideProd = await run({
      body: {
        ...validBody,
        proposal: { ...validBody.proposal, pickup: OVERRIDE_LOC },
      },
    });
    assert.equal(overrideProd.status, 409);
    assert.equal(overrideProd.writerCalled, false);
    if (!overrideProd.json.ok) {
      assert.equal(overrideProd.json.errorKey, MATCH_REQUEST_ERROR.locationOverrideNotReady);
    }
  }

  {
    const priced = await run({ loadQuote: async () => null });
    assert.equal(priced.status, 409);
    if (!priced.json.ok) {
      assert.equal(priced.json.errorKey, MATCH_REQUEST_ERROR.pricingNotReady);
    }
  }

  {
    const conflict = await run({
      inspect: async () => emptyInspect({ existing_for_client_request: true }),
      callWriter: async () => {
        throw new Error(MATCH_REQUEST_ERROR.idempotencyConflict);
      },
    });
    assert.equal(conflict.status, 409);
    assert.equal(JSON.stringify(conflict.json).includes(pair.code), false);
  }

  {
    const stale = await run({
      inspect: async () => emptyInspect({ existing_for_client_request: true }),
      callWriter: async () => {
        throw new Error(MATCH_REQUEST_ERROR.notCurrent);
      },
    });
    assert.equal(stale.status, 409);
    if (!stale.json.ok) {
      assert.equal(stale.json.errorKey, MATCH_REQUEST_ERROR.notCurrent);
    }
    assert.equal(JSON.stringify(stale.json).includes(pair.code), false);
    assert.equal(JSON.stringify(stale.json).includes("contactCode"), false);
  }

  {
    const unauthorized = await run({ getUser: async () => null });
    assert.equal(unauthorized.status, 401);
  }

  assert.equal(httpStatusForMatchRequestError(MATCH_REQUEST_ERROR.creationDisabled), 409);
  assert.equal(httpStatusForMatchRequestError(MATCH_REQUEST_ERROR.pricingNotReady), 409);
  assert.equal(httpStatusForMatchRequestError(MATCH_REQUEST_ERROR.locationOverrideNotReady), 409);
  assert.equal(httpStatusForMatchRequestError(MATCH_REQUEST_ERROR.notCurrent), 409);
  assert.equal(httpStatusForMatchRequestError(MATCH_REQUEST_ERROR.openLimit), 429);

  const route = readFileSync(join(repoRoot, "src/app/api/matching/requests/route.ts"), "utf8");
  assert.ok(route.includes("create_match_request_v99"));
  assert.ok(route.includes("read_match_request_candidate_snapshot_v99"));
  assert.ok(route.includes("inspect_match_request_v95"));
  assert.equal(route.includes("create_match_request_v95"), false);
  assert.equal(route.includes("read_match_request_candidate_snapshot_v95"), false);
  assert.ok(route.includes("p_idempotency_payload_hash"));
  assert.equal(route.includes("p_proposal_digest"), false);
  assert.equal(route.includes("p_quote_digest"), false);
  assert.equal(route.includes("contact-invitations"), false);

  console.log("matchRequestCreate.test.ts: ok");
}

void main();
