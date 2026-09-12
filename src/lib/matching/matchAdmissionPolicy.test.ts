/**
 * PHASE 6.7C.1A.1 — canonical match-admission contract.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/matchAdmissionPolicy.test.ts
 */

import assert from "node:assert/strict";
import {
  evaluateContactInvitationEligibility,
  type ContactInvitationEligibilityPost,
} from "@/lib/matching/contactInvitationEligibilityCore";
import { CONTACT_INVITATION_ERROR } from "@/lib/matching/contactInvitationCreate";
import {
  evaluateMatchAdmission,
  evaluateRouteAdmission,
  hashMatchAdmissionDigest,
  isStrictCalendarDate,
  officialStartDeltaMinutes,
  officialTimeWindowsCompatible,
  pairHasCompatibleSchedule,
  type MatchAdmissionPost,
  type MatchAdmissionRouteScore,
  type MatchAdmissionRouteThresholds,
} from "@/lib/matching/matchAdmissionPolicy";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DEMAND = "33333333-3333-4333-8333-333333333333";
const PROVIDER = "44444444-4444-4444-8444-444444444444";

const THRESHOLDS: MatchAdmissionRouteThresholds = {
  maxExtraDetourKm: 30,
  maxExtraDetourRatio: 0.5,
};

const OK_ROUTE: MatchAdmissionRouteScore = {
  ok: true,
  score: 0.91,
  extraDetourKms: 4,
  baselineKms: 20,
};

function post(
  overrides: Partial<MatchAdmissionPost> &
    Pick<MatchAdmissionPost, "id" | "user_id" | "post_type">,
): MatchAdmissionPost {
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

const demand = post({ id: DEMAND, user_id: ACTOR, post_type: "demand" });
const provider = post({ id: PROVIDER, user_id: OTHER, post_type: "provider" });

function admit(
  left: MatchAdmissionPost = demand,
  right: MatchAdmissionPost = provider,
  route: MatchAdmissionRouteScore = OK_ROUTE,
  thresholds: MatchAdmissionRouteThresholds | null = THRESHOLDS,
) {
  return evaluateMatchAdmission({ left, right, route, thresholds });
}

assert.equal(isStrictCalendarDate("2026-02-30"), false);
assert.equal(isStrictCalendarDate("2026-02-29"), false);
assert.equal(isStrictCalendarDate("2028-02-29"), true);
assert.equal(isStrictCalendarDate("2026-04-31"), false);
assert.equal(isStrictCalendarDate("2026-12-31"), true);
assert.equal(Number.isFinite(Date.parse("2026-02-30T00:00:00Z")), true);

assert.equal(
  pairHasCompatibleSchedule(demand, {
    ...provider,
    departure_time_window: "14:00-14:15",
  }),
  true,
);
assert.equal(
  pairHasCompatibleSchedule(demand, {
    ...provider,
    departure_time_window: "14:15-14:30",
  }),
  true,
);
assert.equal(
  pairHasCompatibleSchedule(demand, {
    ...provider,
    departure_time_window: "14:30-14:45",
  }),
  true,
);
assert.equal(
  pairHasCompatibleSchedule(demand, {
    ...provider,
    departure_time_window: "14:45-15:00",
  }),
  false,
);
assert.equal(
  pairHasCompatibleSchedule(demand, {
    ...provider,
    departure_date: "2026-09-13",
  }),
  false,
);
assert.equal(
  pairHasCompatibleSchedule(
    { ...demand, departure_date: "2026-02-30" },
    { ...provider, departure_date: "2026-02-30" },
  ),
  false,
);
assert.equal(
  pairHasCompatibleSchedule(
    { ...demand, departure_date: "2028-02-29" },
    { ...provider, departure_date: "2028-02-29" },
  ),
  true,
);
assert.equal(
  pairHasCompatibleSchedule(
    { ...demand, departure_time_window: "08:00-20:00" },
    provider,
  ),
  false,
);
assert.equal(
  pairHasCompatibleSchedule(
    { ...demand, departure_date: null },
    provider,
  ),
  false,
);
assert.equal(
  pairHasCompatibleSchedule(
    { ...demand, departure_time_window: null },
    provider,
  ),
  false,
);
assert.equal(officialStartDeltaMinutes(23 * 60 + 45, 0), 15);
assert.equal(
  officialTimeWindowsCompatible("23:45-00:00", "00:00-00:15"),
  true,
);
assert.equal(
  officialTimeWindowsCompatible("23:45-00:00", "00:30-00:45"),
  false,
);

assert.equal(admit().eligible, true);
assert.equal(
  admit(demand, { ...provider, category: "deliver", transport_mode: "van" })
    .eligible,
  false,
);
assert.equal(
  admit(demand, { ...provider, departure_date: "2026-09-13" }).eligible,
  false,
);
assert.equal(
  admit({ ...demand, transport_mode: "cargo_van" }, provider).eligible,
  false,
);
assert.equal(admit(demand, provider, { ok: false }).eligible, false);
assert.deepEqual(admit(demand, provider, { ok: false }).reasons, [
  "route_unscorable",
]);

{
  const passAbs = evaluateRouteAdmission(
    { ok: true, score: 0.8, extraDetourKms: 30, baselineKms: 10 },
    THRESHOLDS,
  );
  assert.equal(passAbs.ok, true);
  const rejectAbs = evaluateRouteAdmission(
    { ok: true, score: 0.8, extraDetourKms: 31, baselineKms: 10 },
    THRESHOLDS,
  );
  assert.equal(rejectAbs.ok, false);
  if (!rejectAbs.ok) assert.equal(rejectAbs.reason, "route_over_threshold");
}
{
  const passRatio = evaluateRouteAdmission(
    { ok: true, score: 0.8, extraDetourKms: 40, baselineKms: 100 },
    THRESHOLDS,
  );
  assert.equal(passRatio.ok, true);
  const rejectRatio = evaluateRouteAdmission(
    { ok: true, score: 0.8, extraDetourKms: 60, baselineKms: 100 },
    THRESHOLDS,
  );
  assert.equal(rejectRatio.ok, false);
}
{
  const zeroBaselineOverAbs = evaluateRouteAdmission(
    { ok: true, score: 0.8, extraDetourKms: 31, baselineKms: 0 },
    THRESHOLDS,
  );
  assert.equal(zeroBaselineOverAbs.ok, false);
}
assert.equal(
  evaluateRouteAdmission(
    { ok: true, score: Number.NaN, extraDetourKms: 1, baselineKms: 10 },
    THRESHOLDS,
  ).ok,
  false,
);
assert.equal(
  evaluateRouteAdmission(
    { ok: true, score: 0.8, extraDetourKms: Number.POSITIVE_INFINITY, baselineKms: 10 },
    THRESHOLDS,
  ).ok,
  false,
);
assert.equal(
  evaluateRouteAdmission(
    { ok: true, score: 0.8, extraDetourKms: -1, baselineKms: 10 },
    THRESHOLDS,
  ).ok,
  false,
);
assert.equal(evaluateRouteAdmission(OK_ROUTE, null).ok, false);

{
  const invite = evaluateContactInvitationEligibility({
    actorUserId: ACTOR,
    initiator: demand as ContactInvitationEligibilityPost,
    counterpart: provider as ContactInvitationEligibilityPost,
    route: OK_ROUTE,
    thresholds: THRESHOLDS,
  });
  const hall = admit();
  assert.equal(invite.ok, hall.eligible);
  assert.equal(invite.ok, true);
}
{
  const shifted = { ...provider, departure_date: "2026-09-13" };
  const invite = evaluateContactInvitationEligibility({
    actorUserId: ACTOR,
    initiator: demand as ContactInvitationEligibilityPost,
    counterpart: shifted as ContactInvitationEligibilityPost,
    route: OK_ROUTE,
    thresholds: THRESHOLDS,
  });
  const hall = admit(demand, shifted);
  assert.equal(invite.ok, false);
  assert.equal(hall.eligible, false);
  if (!invite.ok) {
    assert.equal(invite.errorKey, CONTACT_INVITATION_ERROR.notEligible);
    assert.equal(JSON.stringify(invite).includes("date"), false);
  }
}

assert.equal(hashMatchAdmissionDigest("a").length, 32);
assert.notEqual(
  hashMatchAdmissionDigest("a"),
  hashMatchAdmissionDigest("b"),
);

{
  const buyDemand = post({
    id: DEMAND,
    user_id: ACTOR,
    post_type: "demand",
    category: "buy",
    departure_time_window: null,
    service_time_window: "10:00-10:15",
    transport_mode: null,
  });
  const buyProvider = post({
    id: PROVIDER,
    user_id: OTHER,
    post_type: "provider",
    category: "buy",
    departure_time_window: null,
    service_time_window: "10:15-10:30",
    transport_mode: null,
  });
  assert.equal(pairHasCompatibleSchedule(buyDemand, buyProvider), true);
  assert.equal(
    pairHasCompatibleSchedule(buyDemand, {
      ...buyProvider,
      departure_date: "2026-09-13",
    }),
    false,
  );
}

console.log("matchAdmissionPolicy.test.ts: ok");
