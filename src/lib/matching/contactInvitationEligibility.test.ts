/**
 * PHASE 6.7C.1A.1 — invitation wrapper over canonical admission.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/contactInvitationEligibility.test.ts
 */

import assert from "node:assert/strict";
import {
  evaluateContactInvitationEligibility,
  pairHasOfficialSchedule,
  postSatisfiesOfficialTransport,
  type ContactInvitationEligibilityPost,
} from "@/lib/matching/contactInvitationEligibilityCore";
import { CONTACT_INVITATION_ERROR } from "@/lib/matching/contactInvitationCreate";

function post(
  overrides: Partial<ContactInvitationEligibilityPost> &
    Pick<ContactInvitationEligibilityPost, "id" | "user_id" | "post_type">,
): ContactInvitationEligibilityPost {
  return {
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
    ...overrides,
  };
}

const ACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DEMAND = "33333333-3333-4333-8333-333333333333";
const PROVIDER = "44444444-4444-4444-8444-444444444444";
const ROUTE = { ok: true as const, score: 0.9, extraDetourKms: 2, baselineKms: 12 };
const THRESHOLDS = { maxExtraDetourKm: 30, maxExtraDetourRatio: 0.5 };

const initiator = post({ id: DEMAND, user_id: ACTOR, post_type: "demand" });
const counterpart = post({ id: PROVIDER, user_id: OTHER, post_type: "provider" });

assert.equal(
  evaluateContactInvitationEligibility({
    actorUserId: ACTOR,
    initiator,
    counterpart,
    route: ROUTE,
    thresholds: THRESHOLDS,
  }).ok,
  true,
);
assert.equal(
  evaluateContactInvitationEligibility({
    actorUserId: ACTOR,
    initiator,
    counterpart,
    route: { ok: false },
    thresholds: THRESHOLDS,
  }).ok,
  false,
);
assert.equal(
  pairHasOfficialSchedule(initiator, {
    ...counterpart,
    departure_time_window: "08:00-20:00",
  }),
  false,
);
assert.equal(
  pairHasOfficialSchedule(initiator, {
    ...counterpart,
    departure_date: "2026-09-13",
  }),
  false,
);
assert.equal(
  postSatisfiesOfficialTransport({ ...initiator, transport_mode: "cargo_van" }),
  false,
);
assert.equal(
  postSatisfiesOfficialTransport({
    ...initiator,
    category: "deliver",
    transport_mode: "cargo_van",
    escort_seats: 0,
  }),
  true,
);
{
  const result = evaluateContactInvitationEligibility({
    actorUserId: ACTOR,
    initiator: { ...initiator, category: "travel" },
    counterpart: { ...counterpart, category: "deliver", transport_mode: "van" },
    route: ROUTE,
    thresholds: THRESHOLDS,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorKey, CONTACT_INVITATION_ERROR.notEligible);
  }
}

console.log("contactInvitationEligibility.test.ts: ok");
