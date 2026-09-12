/**
 * PHASE 6.7C.1 — contact invitation parse, HTTP mapping, writer simulation.
 * Helper simulation is not a live PostgreSQL run.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/contactInvitationCreate.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONTACT_INVITATION_ERROR,
  CONTACT_INVITATION_SAFE_LOGS,
  evaluateContactInvitationWriter,
  generateCodeWithPepper,
  httpStatusForContactInvitationError,
  parseContactInvitationCreateBody,
  interpretContactInvitationWriterRow,
  runContactInvitationCreate,
  type ContactInvitationInspectRow,
  type ContactInvitationRouteDeps,
  type ContactInvitationWriterRow,
  type SimulatedInvitation,
  type SimulatedWriterResult,
  type SimulatedWriterState,
} from "@/lib/matching/contactInvitationCreate";
import {
  evaluateContactInvitationEligibility,
  type ContactInvitationEligibilityPost,
} from "@/lib/matching/contactInvitationEligibilityCore";

const PEPPER = "miriohub-contact-code-pepper-32chars!!";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DEMAND = "33333333-3333-4333-8333-333333333333";
const PROVIDER = "44444444-4444-4444-8444-444444444444";
const CLIENT = "55555555-5555-4555-8555-555555555555";
const CLIENT_B = "66666666-6666-4666-8666-666666666666";
const NOW = "2026-09-12T00:00:00.000Z";

const validBody = {
  initiatorPostId: DEMAND,
  counterpartPostId: PROVIDER,
  clientRequestId: CLIENT,
};

assert.equal(parseContactInvitationCreateBody(null).ok, false);
assert.equal(parseContactInvitationCreateBody([]).ok, false);
assert.equal(parseContactInvitationCreateBody("x").ok, false);
{
  const parsed = parseContactInvitationCreateBody(validBody);
  assert.equal(parsed.ok, true);
}
{
  const parsed = parseContactInvitationCreateBody({
    ...validBody,
    userId: ACTOR,
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.errorKey, CONTACT_INVITATION_ERROR.unknownKey);
    assert.equal(parsed.status, 400);
  }
}
{
  const parsed = parseContactInvitationCreateBody({
    initiatorPostId: "nope",
    counterpartPostId: PROVIDER,
    clientRequestId: CLIENT,
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.errorKey, CONTACT_INVITATION_ERROR.invalidInput);
  }
}

function baseState(): SimulatedWriterState {
  return {
    now: NOW,
    config: {
    matching_contact_mode: "cold_start",
    matching_contact_policy_version: 1,
    matching_contact_invitation_ttl_minutes: 1440,
    matching_contact_max_open_per_initiator_post: 20,
    matching_contact_max_created_per_actor_24h: 50,
    },
    posts: [
      {
        id: DEMAND,
        user_id: ACTOR,
        post_type: "demand",
        category: "travel",
        status: "active",
      },
      {
        id: PROVIDER,
        user_id: OTHER,
        post_type: "provider",
        category: "travel",
        status: "active",
      },
    ],
    invitations: [],
  };
}

const pair = generateCodeWithPepper(ACTOR, CLIENT, PEPPER);

function writerErrorKey(result: SimulatedWriterResult): string | undefined {
  return result.ok ? undefined : result.errorKey;
}

{
  const created = evaluateContactInvitationWriter(baseState(), {
    actorUserId: ACTOR,
    initiatorPostId: DEMAND,
    counterpartPostId: PROVIDER,
    clientRequestId: CLIENT,
    contactCodeHash: pair.codeHash,
  });
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.row.created, true);
    assert.equal(created.row.disclosure_mode, "mutual_eligible_contact");
    assert.equal(created.row.effective_client_request_id, CLIENT);
    assert.equal(created.state.invitations[0]?.recipient_user_id, OTHER);
    assert.equal(created.state.invitations[0]?.demand_post_id, DEMAND);
    assert.equal(created.state.invitations[0]?.provider_post_id, PROVIDER);
    assert.equal(
      created.state.invitations[0]?.expires_at,
      "2026-09-13T00:00:00.000Z",
    );
    const retry = evaluateContactInvitationWriter(created.state, {
      actorUserId: ACTOR,
      initiatorPostId: DEMAND,
      counterpartPostId: PROVIDER,
      clientRequestId: CLIENT,
      contactCodeHash: pair.codeHash,
    });
    assert.equal(retry.ok, true);
    if (retry.ok) {
      assert.equal(retry.row.created, false);
      assert.equal(retry.row.expires_at, created.row.expires_at);
      assert.equal(retry.state.invitations.length, 1);
      assert.equal(retry.state.invitations[0]?.updated_at, NOW);
    }
    const afterInitiatorClosed = structuredClone(created.state);
    afterInitiatorClosed.posts[0] = {
      ...afterInitiatorClosed.posts[0],
      status: "closed",
    };
    const retryInactiveInitiator = evaluateContactInvitationWriter(
      afterInitiatorClosed,
      {
        actorUserId: ACTOR,
        initiatorPostId: DEMAND,
        counterpartPostId: PROVIDER,
        clientRequestId: CLIENT,
        contactCodeHash: pair.codeHash,
      },
    );
    const rotated = generateCodeWithPepper(
      ACTOR,
      CLIENT,
      "other-contact-code-pepper-32chars!!!",
    );
    const pepperChanged = evaluateContactInvitationWriter(created.state, {
      actorUserId: ACTOR,
      initiatorPostId: DEMAND,
      counterpartPostId: PROVIDER,
      clientRequestId: CLIENT,
      contactCodeHash: rotated.codeHash,
    });
    assert.equal(pepperChanged.ok, false);
    if (!pepperChanged.ok) {
      assert.equal(
        pepperChanged.errorKey,
        CONTACT_INVITATION_ERROR.idempotencyConflict,
      );
    }
    assert.equal(retryInactiveInitiator.ok, true);
    if (retryInactiveInitiator.ok) {
      assert.equal(retryInactiveInitiator.row.created, false);
      assert.equal(retryInactiveInitiator.row.invitation_id, created.row.invitation_id);
    }
    const afterBothClosed = structuredClone(afterInitiatorClosed);
    afterBothClosed.posts[1] = {
      ...afterBothClosed.posts[1],
      status: "canceled",
    };
    const retryInactiveCounterpart = evaluateContactInvitationWriter(
      afterBothClosed,
      {
        actorUserId: ACTOR,
        initiatorPostId: DEMAND,
        counterpartPostId: PROVIDER,
        clientRequestId: CLIENT,
        contactCodeHash: pair.codeHash,
      },
    );
    assert.equal(retryInactiveCounterpart.ok, true);
    if (retryInactiveCounterpart.ok) {
      assert.equal(retryInactiveCounterpart.row.created, false);
    }
    const swappedCounterpart = "99999999-9999-4999-8999-999999999999";
    assert.equal(
      writerErrorKey(
        evaluateContactInvitationWriter(created.state, {
          actorUserId: ACTOR,
          initiatorPostId: DEMAND,
          counterpartPostId: swappedCounterpart,
          clientRequestId: CLIENT,
          contactCodeHash: pair.codeHash,
        }),
      ),
      CONTACT_INVITATION_ERROR.idempotencyConflict,
    );
    assert.equal(
      writerErrorKey(
        evaluateContactInvitationWriter(created.state, {
          actorUserId: ACTOR,
          initiatorPostId: PROVIDER,
          counterpartPostId: DEMAND,
          clientRequestId: CLIENT,
          contactCodeHash: pair.codeHash,
        }),
      ),
      CONTACT_INVITATION_ERROR.idempotencyConflict,
    );
    assert.equal(
      writerErrorKey(
        evaluateContactInvitationWriter(created.state, {
          actorUserId: ACTOR,
          initiatorPostId: DEMAND,
          counterpartPostId: PROVIDER,
          clientRequestId: CLIENT,
          contactCodeHash: "aa".repeat(32),
        }),
      ),
      CONTACT_INVITATION_ERROR.idempotencyConflict,
    );
  }
}

{
  const providerFirst = evaluateContactInvitationWriter(baseState(), {
    actorUserId: OTHER,
    initiatorPostId: PROVIDER,
    counterpartPostId: DEMAND,
    clientRequestId: CLIENT_B,
    contactCodeHash: generateCodeWithPepper(OTHER, CLIENT_B, PEPPER).codeHash,
  });
  assert.equal(providerFirst.ok, true);
  if (providerFirst.ok) {
    assert.equal(providerFirst.state.invitations[0]?.demand_post_id, DEMAND);
    assert.equal(providerFirst.state.invitations[0]?.provider_post_id, PROVIDER);
    assert.equal(providerFirst.state.invitations[0]?.initiator_post_id, PROVIDER);
    assert.equal(providerFirst.state.invitations[0]?.recipient_user_id, ACTOR);
  }
}

{
  const mature = baseState();
  mature.config = {
    matching_contact_mode: "mature",
    matching_contact_policy_version: 2,
    matching_contact_invitation_ttl_minutes: 60,
    matching_contact_max_open_per_initiator_post: 20,
    matching_contact_max_created_per_actor_24h: 50,
  };
  const result = evaluateContactInvitationWriter(mature, {
    actorUserId: ACTOR,
    initiatorPostId: DEMAND,
    counterpartPostId: PROVIDER,
    clientRequestId: CLIENT,
    contactCodeHash: pair.codeHash,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.row.disclosure_mode, "recipient_contacts_initiator");
    assert.equal(result.row.expires_at, "2026-09-12T01:00:00.000Z");
    assert.equal(result.state.invitations[0]?.contact_policy_version, 2);
  }
}

assert.equal(
  writerErrorKey(
    evaluateContactInvitationWriter(baseState(), {
      actorUserId: OTHER,
      initiatorPostId: DEMAND,
      counterpartPostId: PROVIDER,
      clientRequestId: CLIENT,
      contactCodeHash: pair.codeHash,
    }),
  ),
  CONTACT_INVITATION_ERROR.postNotOwned,
);
assert.equal(
  writerErrorKey(
    evaluateContactInvitationWriter(baseState(), {
      actorUserId: ACTOR,
      initiatorPostId: DEMAND,
      counterpartPostId: DEMAND,
      clientRequestId: CLIENT,
      contactCodeHash: pair.codeHash,
    }),
  ),
  CONTACT_INVITATION_ERROR.selfNotAllowed,
);
{
  const selfOwner = baseState();
  selfOwner.posts[1] = { ...selfOwner.posts[1], user_id: ACTOR };
  assert.equal(
    writerErrorKey(
      evaluateContactInvitationWriter(selfOwner, {
        actorUserId: ACTOR,
        initiatorPostId: DEMAND,
        counterpartPostId: PROVIDER,
        clientRequestId: CLIENT,
        contactCodeHash: pair.codeHash,
      }),
    ),
    CONTACT_INVITATION_ERROR.selfNotAllowed,
  );
}
{
  const inactive = baseState();
  inactive.posts[1] = { ...inactive.posts[1], status: "closed" };
  assert.equal(
    writerErrorKey(
      evaluateContactInvitationWriter(inactive, {
        actorUserId: ACTOR,
        initiatorPostId: DEMAND,
        counterpartPostId: PROVIDER,
        clientRequestId: CLIENT,
        contactCodeHash: pair.codeHash,
      }),
    ),
    CONTACT_INVITATION_ERROR.postUnavailable,
  );
}
{
  const sameRole = baseState();
  sameRole.posts[1] = { ...sameRole.posts[1], post_type: "demand" };
  assert.equal(
    writerErrorKey(
      evaluateContactInvitationWriter(sameRole, {
        actorUserId: ACTOR,
        initiatorPostId: DEMAND,
        counterpartPostId: PROVIDER,
        clientRequestId: CLIENT,
        contactCodeHash: pair.codeHash,
      }),
    ),
    CONTACT_INVITATION_ERROR.roleMismatch,
  );
}
{
  const mismatch = baseState();
  mismatch.posts[1] = { ...mismatch.posts[1], category: "deliver" };
  assert.equal(
    writerErrorKey(
      evaluateContactInvitationWriter(mismatch, {
        actorUserId: ACTOR,
        initiatorPostId: DEMAND,
        counterpartPostId: PROVIDER,
        clientRequestId: CLIENT,
        contactCodeHash: pair.codeHash,
      }),
    ),
    CONTACT_INVITATION_ERROR.categoryMismatch,
  );
}

{
  const first = evaluateContactInvitationWriter(baseState(), {
    actorUserId: ACTOR,
    initiatorPostId: DEMAND,
    counterpartPostId: PROVIDER,
    clientRequestId: CLIENT,
    contactCodeHash: pair.codeHash,
  });
  assert.equal(first.ok, true);
  if (first.ok) {
    const conflict = evaluateContactInvitationWriter(first.state, {
      actorUserId: ACTOR,
      initiatorPostId: DEMAND,
      counterpartPostId: PROVIDER,
      clientRequestId: CLIENT,
      contactCodeHash: "aa".repeat(32),
    });
    assert.equal(writerErrorKey(conflict), CONTACT_INVITATION_ERROR.idempotencyConflict);
    const otherClient = evaluateContactInvitationWriter(first.state, {
      actorUserId: ACTOR,
      initiatorPostId: DEMAND,
      counterpartPostId: PROVIDER,
      clientRequestId: CLIENT_B,
      contactCodeHash: generateCodeWithPepper(ACTOR, CLIENT_B, PEPPER).codeHash,
    });
    assert.equal(writerErrorKey(otherClient), CONTACT_INVITATION_ERROR.alreadyOpen);
    const reverse = evaluateContactInvitationWriter(first.state, {
      actorUserId: OTHER,
      initiatorPostId: PROVIDER,
      counterpartPostId: DEMAND,
      clientRequestId: CLIENT_B,
      contactCodeHash: generateCodeWithPepper(OTHER, CLIENT_B, PEPPER).codeHash,
    });
    assert.equal(writerErrorKey(reverse), CONTACT_INVITATION_ERROR.alreadyOpen);
    if (!reverse.ok) {
      const publicError = JSON.stringify({
        ok: reverse.ok,
        errorKey: reverse.errorKey,
      });
      assert.equal(publicError.includes(CLIENT), false);
      assert.equal(publicError.includes(pair.codeHash), false);
      assert.equal(publicError.includes(pair.code), false);
    }
  }
}

{
  const expired: SimulatedInvitation = {
    id: "77777777-7777-4777-8777-777777777777",
    demand_post_id: DEMAND,
    provider_post_id: PROVIDER,
    initiator_user_id: ACTOR,
    recipient_user_id: OTHER,
    initiator_post_id: DEMAND,
    status: "open",
    contact_policy_version: 1,
    disclosure_mode: "mutual_eligible_contact",
    contact_code_hash: "bb".repeat(32),
    client_request_id: CLIENT_B,
    expires_at: "2026-09-11T00:00:00.000Z",
    converted_at: null,
    invalidated_at: null,
    created_at: "2026-09-10T00:00:00.000Z",
    updated_at: "2026-09-10T00:00:00.000Z",
  };
  const state = baseState();
  state.invitations = [expired];
  const created = evaluateContactInvitationWriter(state, {
    actorUserId: ACTOR,
    initiatorPostId: DEMAND,
    counterpartPostId: PROVIDER,
    clientRequestId: CLIENT,
    contactCodeHash: pair.codeHash,
  });
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.row.created, true);
    assert.equal(created.state.invitations[0]?.status, "expired");
    assert.equal(created.state.invitations[0]?.invalidated_at, NOW);
    assert.equal(created.state.invitations[1]?.status, "open");
    assert.equal(created.state.posts.every((post) => post.status === "active"), true);
    assert.equal(
      created.state.invitations.some((row) => "match_request" in row),
      false,
    );
  }
}

{
  const state = baseState();
  state.config = {
    ...state.config!,
    matching_contact_max_open_per_initiator_post: 1,
  };
  const first = evaluateContactInvitationWriter(state, {
    actorUserId: ACTOR,
    initiatorPostId: DEMAND,
    counterpartPostId: PROVIDER,
    clientRequestId: CLIENT,
    contactCodeHash: pair.codeHash,
  });
  assert.equal(first.ok, true);
  if (first.ok) {
    const extraProvider = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    first.state.posts.push({
      id: extraProvider,
      user_id: OTHER,
      post_type: "provider",
      category: "travel",
      status: "active",
    });
    assert.equal(
      writerErrorKey(
        evaluateContactInvitationWriter(first.state, {
          actorUserId: ACTOR,
          initiatorPostId: DEMAND,
          counterpartPostId: extraProvider,
          clientRequestId: CLIENT_B,
          contactCodeHash: generateCodeWithPepper(ACTOR, CLIENT_B, PEPPER).codeHash,
        }),
      ),
      CONTACT_INVITATION_ERROR.openLimit,
    );
    const atLimitRetry = evaluateContactInvitationWriter(first.state, {
      actorUserId: ACTOR,
      initiatorPostId: DEMAND,
      counterpartPostId: PROVIDER,
      clientRequestId: CLIENT,
      contactCodeHash: pair.codeHash,
    });
    assert.equal(atLimitRetry.ok, true);
    if (atLimitRetry.ok) {
      assert.equal(atLimitRetry.row.created, false);
    }
  }
}

{
  const state = baseState();
  state.config = {
    ...state.config!,
    matching_contact_max_created_per_actor_24h: 1,
  };
  const first = evaluateContactInvitationWriter(state, {
    actorUserId: ACTOR,
    initiatorPostId: DEMAND,
    counterpartPostId: PROVIDER,
    clientRequestId: CLIENT,
    contactCodeHash: pair.codeHash,
  });
  assert.equal(first.ok, true);
  if (first.ok) {
    first.state.invitations[0] = {
      ...first.state.invitations[0]!,
      status: "expired",
      expires_at: "2026-09-11T00:00:00.000Z",
      invalidated_at: NOW,
    };
    const extraProvider = "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    first.state.posts.push({
      id: extraProvider,
      user_id: OTHER,
      post_type: "provider",
      category: "travel",
      status: "active",
    });
    assert.equal(
      writerErrorKey(
        evaluateContactInvitationWriter(first.state, {
          actorUserId: ACTOR,
          initiatorPostId: DEMAND,
          counterpartPostId: extraProvider,
          clientRequestId: CLIENT_B,
          contactCodeHash: generateCodeWithPepper(ACTOR, CLIENT_B, PEPPER).codeHash,
        }),
      ),
      CONTACT_INVITATION_ERROR.rateLimit,
    );
  }
}

assert.equal(
  httpStatusForContactInvitationError(CONTACT_INVITATION_ERROR.postNotOwned),
  403,
);
assert.equal(
  httpStatusForContactInvitationError(CONTACT_INVITATION_ERROR.postNotFound),
  404,
);
assert.equal(
  httpStatusForContactInvitationError(CONTACT_INVITATION_ERROR.alreadyOpen),
  409,
);
assert.equal(
  httpStatusForContactInvitationError(CONTACT_INVITATION_ERROR.notEligible),
  409,
);
assert.equal(
  httpStatusForContactInvitationError(CONTACT_INVITATION_ERROR.openLimit),
  429,
);
assert.equal(
  httpStatusForContactInvitationError(CONTACT_INVITATION_ERROR.rateLimit),
  429,
);

{
  const parsed = parseContactInvitationCreateBody({
    ...validBody,
    matched: true,
    score: 0.9,
    routeCompatible: true,
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.errorKey, CONTACT_INVITATION_ERROR.unknownKey);
  }
}

{
  const okRow = writerRow(true);
  assert.equal(
    interpretContactInvitationWriterRow(okRow, CLIENT).ok,
    true,
  );
  assert.equal(
    interpretContactInvitationWriterRow(
      { ...okRow, invitation_status: "pending" },
      CLIENT,
    ).ok,
    false,
  );
  assert.equal(
    interpretContactInvitationWriterRow(
      { ...okRow, disclosure_mode: "phone_now" },
      CLIENT,
    ).ok,
    false,
  );
  assert.equal(
    interpretContactInvitationWriterRow(
      { ...okRow, expires_at: "not-a-date" },
      CLIENT,
    ).ok,
    false,
  );
}

{
  const initiator = eligiblePost(DEMAND, ACTOR, "demand");
  const counterpart = eligiblePost(PROVIDER, OTHER, "provider");
  const route = okRoute();
  const thresholds = { maxExtraDetourKm: 30, maxExtraDetourRatio: 0.5 };
  assert.equal(
    evaluateContactInvitationEligibility({
      actorUserId: ACTOR,
      initiator,
      counterpart,
      route,
      thresholds,
    }).ok,
    true,
  );
  assert.equal(
    evaluateContactInvitationEligibility({
      actorUserId: ACTOR,
      initiator: { ...initiator, category: "travel" },
      counterpart: { ...counterpart, category: "deliver" },
      route,
      thresholds,
    }).ok,
    false,
  );
  assert.equal(
    evaluateContactInvitationEligibility({
      actorUserId: ACTOR,
      initiator: { ...initiator, departure_date: "" },
      counterpart,
      route,
      thresholds,
    }).ok,
    false,
  );
  assert.equal(
    evaluateContactInvitationEligibility({
      actorUserId: ACTOR,
      initiator: { ...initiator, departure_time_window: "14:00-18:00" },
      counterpart,
      route,
      thresholds,
    }).ok,
    false,
  );
  assert.equal(
    evaluateContactInvitationEligibility({
      actorUserId: ACTOR,
      initiator: { ...initiator, transport_mode: "cargo_van" },
      counterpart,
      route,
      thresholds,
    }).ok,
    false,
  );
  assert.equal(
    evaluateContactInvitationEligibility({
      actorUserId: ACTOR,
      initiator,
      counterpart,
      route: { ok: false },
      thresholds,
    }).ok,
    false,
  );
  const self = evaluateContactInvitationEligibility({
    actorUserId: ACTOR,
    initiator,
    counterpart: { ...counterpart, user_id: ACTOR },
    route,
    thresholds,
  });
  assert.equal(self.ok, false);
  if (!self.ok) {
    assert.equal(self.errorKey, CONTACT_INVITATION_ERROR.selfNotAllowed);
  }
}

function emptyInspect(
  overrides: Partial<ContactInvitationInspectRow> = {},
): ContactInvitationInspectRow {
  return {
    existing_for_client_request: false,
    open_count: 0,
    created_24h_count: 0,
    max_open: 20,
    max_created_24h: 50,
    ...overrides,
  };
}

function okRoute() {
  return { ok: true as const, score: 0.9, extraDetourKms: 2, baselineKms: 12 };
}

function eligiblePost(
  id: string,
  userId: string,
  postType: "demand" | "provider",
): ContactInvitationEligibilityPost {
  return {
    id,
    user_id: userId,
    post_type: postType,
    category: "travel",
    status: "active",
    departure_date: "2026-09-12",
    departure_time_window: "14:00-14:15",
    transport_mode: "car",
    max_companions: 1,
    count_small: 0,
    count_medium: 0,
    count_large: 0,
    count_xlarge: 0,
    origin_address: "Belgrade",
    destination_address: "Novi Sad",
  };
}

function writerRow(created: boolean): ContactInvitationWriterRow {
  return {
    invitation_id: "88888888-8888-4888-8888-888888888888",
    invitation_status: "open",
    disclosure_mode: "mutual_eligible_contact",
    expires_at: "2026-09-13T00:00:00.000Z",
    effective_client_request_id: CLIENT,
    created,
  };
}

async function main() {
async function run(overrides: Partial<ContactInvitationRouteDeps> & {
  body?: unknown;
}) {
  let adminCreated = false;
  return runContactInvitationCreate({
    readBody: async () => overrides.body ?? validBody,
    getUser: overrides.getUser ?? (async () => ACTOR),
    readPepper: overrides.readPepper ?? (() => PEPPER),
    generateCode:
      overrides.generateCode ??
      ((actorUserId, clientRequestId) =>
        generateCodeWithPepper(actorUserId, clientRequestId, PEPPER)),
    createAdmin:
      overrides.createAdmin ??
      (() => {
        adminCreated = true;
        return { kind: "admin" };
      }),
    inspect:
      overrides.inspect ??
      (async () => emptyInspect()),
    loadPosts:
      overrides.loadPosts ??
      (async () => ({
        initiator: eligiblePost(DEMAND, ACTOR, "demand"),
        counterpart: eligiblePost(PROVIDER, OTHER, "provider"),
      })),
    scoreRoute: overrides.scoreRoute ?? (async () => okRoute()),
    loadThresholds:
      overrides.loadThresholds ??
      (async () => ({ maxExtraDetourKm: 30, maxExtraDetourRatio: 0.5 })),
    callWriter:
      overrides.callWriter ??
      (async () => writerRow(true)),
  }).then((result) => ({ ...result, sawAdmin: adminCreated || result.adminCreated }));
}

{
  const result = await run({ body: ["x"] });
  assert.equal(result.status, 400);
  assert.equal(result.sawAdmin, false);
}
{
  const result = await run({
    body: {
      ...validBody,
      matched: true,
      score: 1,
      routeCompatible: true,
      threshold: 30,
      extraDetourKms: 1,
      category: "travel",
    },
  });
  assert.equal(result.status, 400);
  if (!result.json.ok) {
    assert.equal(result.json.errorKey, CONTACT_INVITATION_ERROR.unknownKey);
  }
  assert.equal(result.sawAdmin, false);
  assert.equal(result.writerCalled, false);
  assert.equal(result.routeScored, false);
  assert.equal(result.codeGenerated, false);
}
{
  const result = await run({
    scoreRoute: async () => ({ ok: false }),
  });
  assert.equal(result.status, 409);
  if (!result.json.ok) {
    assert.equal(result.json.errorKey, CONTACT_INVITATION_ERROR.notEligible);
  }
  assert.equal(result.writerCalled, false);
  assert.equal(result.routeScored, true);
  assert.equal(result.codeGenerated, false);
  assert.equal(JSON.stringify(result.json).includes("contactCode"), false);
}
{
  const result = await run({
    loadPosts: async () => ({
      initiator: eligiblePost(DEMAND, ACTOR, "demand"),
      counterpart: {
        ...eligiblePost(PROVIDER, OTHER, "provider"),
        departure_time_window: "20:00-22:00",
      },
    }),
  });
  assert.equal(result.status, 409);
  assert.equal(result.writerCalled, false);
  assert.equal(result.routeScored, false);
  assert.equal(result.codeGenerated, false);
}
{
  const result = await run({
    inspect: async () => emptyInspect({ open_count: 20, max_open: 20 }),
  });
  assert.equal(result.status, 429);
  if (!result.json.ok) {
    assert.equal(result.json.errorKey, CONTACT_INVITATION_ERROR.openLimit);
  }
  assert.equal(result.writerCalled, false);
  assert.equal(result.routeScored, false);
  assert.equal(result.codeGenerated, false);
  assert.equal(JSON.stringify(result.json).includes("contactCode"), false);
}
{
  const result = await run({
    inspect: async () =>
      emptyInspect({ created_24h_count: 50, max_created_24h: 50 }),
  });
  assert.equal(result.status, 429);
  if (!result.json.ok) {
    assert.equal(result.json.errorKey, CONTACT_INVITATION_ERROR.rateLimit);
  }
  assert.equal(result.codeGenerated, false);
}
{
  let writerCalls = 0;
  const result = await run({
    inspect: async () =>
      emptyInspect({
        existing_for_client_request: true,
        open_count: 20,
        created_24h_count: 50,
      }),
    callWriter: async (_admin, args) => {
      writerCalls += 1;
      assert.equal(args.contactCodeHash, pair.codeHash);
      assert.equal(args.admissionDigest, "");
      return writerRow(false);
    },
  });
  assert.equal(writerCalls, 1);
  assert.equal(result.status, 200);
  assert.equal(result.writerCalled, true);
  assert.equal(result.routeScored, false);
  assert.equal(result.codeGenerated, true);
  if (result.json.ok) {
    assert.equal(result.json.invitation.created, false);
    assert.equal(result.json.invitation.contactCode, pair.code);
  }
}
{
  const result = await run({
    inspect: async () =>
      emptyInspect({ existing_for_client_request: true }),
    callWriter: async () => {
      throw new Error("error.match_contact_invitation_idempotency_conflict");
    },
  });
  assert.equal(result.status, 409);
  assert.equal(result.writerCalled, true);
  assert.equal(result.routeScored, false);
  if (!result.json.ok) {
    assert.equal(
      result.json.errorKey,
      CONTACT_INVITATION_ERROR.idempotencyConflict,
    );
  }
  assert.equal(JSON.stringify(result.json).includes("contactCode"), false);
  assert.equal(JSON.stringify(result.json).includes(pair.code), false);
}
{
  const result = await run({
    callWriter: async () => ({
      ...writerRow(true),
      invitation_status: "pending",
    }),
  });
  assert.equal(result.status, 500);
  assert.equal(JSON.stringify(result.json).includes("contactCode"), false);
}
{
  const result = await run({ body: { ...validBody, userId: ACTOR } });
  assert.equal(result.json.ok, false);
  if (!result.json.ok) {
    assert.equal(result.json.errorKey, CONTACT_INVITATION_ERROR.unknownKey);
  }
  assert.equal(result.sawAdmin, false);
}
{
  const result = await run({ getUser: async () => null });
  assert.equal(result.status, 401);
  assert.equal(result.sawAdmin, false);
}
{
  const result = await run({
    getUser: async () => {
      throw new Error("supabase boom");
    },
  });
  assert.equal(result.status, 500);
  assert.deepEqual(result.logs, [CONTACT_INVITATION_SAFE_LOGS.authLookupFailed]);
  assert.equal(result.sawAdmin, false);
  assert.equal(JSON.stringify(result).includes("supabase boom"), false);
}
{
  const result = await run({ readPepper: () => null });
  assert.equal(result.status, 500);
  if (!result.json.ok) {
    assert.equal(result.json.errorKey, CONTACT_INVITATION_ERROR.serverConfiguration);
  }
  assert.deepEqual(result.logs, [
    CONTACT_INVITATION_SAFE_LOGS.serverConfigurationMissing,
  ]);
  assert.equal(result.sawAdmin, false);
}
{
  const result = await run({ readPepper: () => "short" });
  assert.equal(result.status, 500);
  assert.equal(result.sawAdmin, false);
}
{
  const result = await run({
    generateCode: () => {
      throw new Error("hmac leaked");
    },
  });
  assert.equal(result.status, 500);
  assert.deepEqual(result.logs, [CONTACT_INVITATION_SAFE_LOGS.codeGenerationFailed]);
  assert.equal(JSON.stringify(result).includes("hmac leaked"), false);
  assert.equal(result.sawAdmin, true);
  assert.equal(result.writerCalled, false);
}
{
  const created = await run({});
  assert.equal(created.status, 201);
  assert.equal(created.writerCalled, true);
  assert.equal(created.routeScored, true);
  assert.equal(created.json.ok, true);
  if (created.json.ok) {
    assert.equal(created.json.invitation.created, true);
    assert.equal(created.json.invitation.contactCode, pair.code);
    assert.equal("disclosureMode" in created.json.invitation, false);
    assert.equal("effectiveClientRequestId" in created.json.invitation, false);
    assert.equal("contactCodeHash" in created.json.invitation, false);
  }
  const replay = await run({
    inspect: async () =>
      emptyInspect({ existing_for_client_request: true }),
    callWriter: async () => writerRow(false),
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.writerCalled, true);
  assert.equal(replay.routeScored, false);
  assert.equal(replay.json.ok, true);
  if (replay.json.ok) {
    assert.equal(replay.json.invitation.created, false);
    assert.equal(replay.json.invitation.contactCode, pair.code);
  }
}
{
  const result = await run({
    callWriter: async () => {
      throw new Error("error.match_contact_post_not_found");
    },
  });
  assert.equal(result.status, 404);
  if (!result.json.ok) {
    assert.equal(result.json.errorKey, CONTACT_INVITATION_ERROR.postNotFound);
  }
}
{
  const result = await run({
    callWriter: async () => ({
      ...writerRow(true),
      effective_client_request_id: CLIENT_B,
    }),
  });
  assert.equal(result.status, 409);
  if (!result.json.ok) {
    assert.equal(result.json.errorKey, CONTACT_INVITATION_ERROR.alreadyOpen);
  }
  assert.equal(JSON.stringify(result.json).includes(pair.code), false);
}
{
  const dumped = JSON.stringify([
    CONTACT_INVITATION_SAFE_LOGS,
    await run({
      getUser: async () => {
        throw new Error(`${pair.code} ${pair.codeHash} ${ACTOR} ${CLIENT}`);
      },
    }),
  ]);
  assert.equal(dumped.includes(pair.code), false);
  assert.equal(dumped.includes(pair.codeHash), false);
  assert.equal(dumped.includes(ACTOR), false);
}

{
  const createSrc = readFileSync(
    new URL("./contactInvitationCreate.ts", import.meta.url),
    "utf8",
  );
  assert.equal(createSrc.includes("existing_invitation_id"), false);
  assert.equal(createSrc.includes("existing_initiator_post_id"), false);
  assert.equal(createSrc.includes("ContactInvitationWriterRow"), true);
  assert.ok(createSrc.includes("existing_for_client_request"));
  assert.ok(createSrc.includes("finishWithWriter"));
}

console.log("contactInvitationCreate.test.ts: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
