/**
 * PHASE 6.7C.1A.1 — canonical match-admission contract.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/matchAdmissionPolicy.test.ts
 */

import assert from "node:assert/strict";
import {
  ADMISSION_FACTS_FIELDS,
  canonicalAdmissionFacts,
  describePairTimeDifference,
  evaluateMatchAdmission,
  evaluatePairCompatibility,
  evaluateRouteAdmission,
  hashMatchAdmissionDigest,
  isStrictCalendarDate,
  officialStartDeltaMinutes,
  officialTimeWindowsCompatible,
  pairHasCompatibleSchedule,
  pairHasExactAdmissionSubtype,
  postSatisfiesAdmissionAuthority,
  validateProposedSchedule,
  type MatchAdmissionPost,
  type MatchAdmissionRouteScore,
  type MatchAdmissionRouteThresholds,
} from "@/lib/matching/matchAdmissionPolicy";
import {
  TARGET_DELIVER_TRANSPORT_MODES,
  TARGET_TRAVEL_TRANSPORT_MODES,
} from "@/lib/transport/transportPolicy";

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
    service_subtype: "passenger",
    max_companions: 1,
    count_small: 0,
    count_medium: 0,
    count_large: 0,
    count_xlarge: 0,
    origin_address: "Belgrade",
    destination_address: "Novi Sad",
    origin_country_code: "RS",
    origin_timezone: "Europe/Belgrade",
    night_policy_version: 1,
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
  true,
);
assert.equal(
  pairHasCompatibleSchedule(demand, {
    ...provider,
    departure_time_window: "20:00-20:15",
  }),
  true,
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
{
  const midnight = describePairTimeDifference(demand, {
    ...provider,
    departure_time_window: "23:45-00:00",
  });
  assert.equal(midnight.advisoryOnly, true);
  assert.equal(
    admit(demand, { ...provider, departure_time_window: "23:45-00:00" }).eligible,
    true,
  );
}
assert.equal(
  validateProposedSchedule({
    proposedDate: "2026-09-12",
    proposedTimeWindow: "14:00-14:15",
  }),
  true,
);
assert.equal(
  validateProposedSchedule({
    proposedDate: "2026-02-30",
    proposedTimeWindow: "14:00-14:15",
  }),
  false,
);
assert.equal(
  validateProposedSchedule({
    proposedDate: "2026-09-12",
    proposedTimeWindow: "14:00-18:00",
  }),
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
  const hall = admit();
  const requestAdmission = admit(demand, {
    ...provider,
    departure_time_window: "08:00-08:15",
  });
  assert.equal(hall.eligible, true);
  assert.equal(requestAdmission.eligible, true);
}
{
  const shifted = { ...provider, departure_date: "2026-09-13" };
  const hall = admit(demand, shifted);
  assert.equal(hall.eligible, false);
}

assert.equal(hashMatchAdmissionDigest("a").length, 64);
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
  const base = canonicalAdmissionFacts(demand);
  assert.notEqual(
    canonicalAdmissionFacts({ ...demand, escort_seats: 1 }),
    base,
  );
  assert.notEqual(
    canonicalAdmissionFacts({ ...demand, max_companions: 4 }),
    base,
  );
  assert.notEqual(
    canonicalAdmissionFacts({ ...demand, count_small: 2 }),
    base,
  );
  assert.notEqual(
    canonicalAdmissionFacts({ ...demand, origin_gps_ewkb: "01010000" }),
    base,
  );
  assert.notEqual(
    hashMatchAdmissionDigest(canonicalAdmissionFacts(demand)),
    hashMatchAdmissionDigest(
      canonicalAdmissionFacts({ ...demand, destination_gps_ewkb: "02020000" }),
    ),
  );
}

{
  assert.equal(postSatisfiesAdmissionAuthority(demand), true);
  assert.equal(
    postSatisfiesAdmissionAuthority({ ...demand, service_subtype: null }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({ ...demand, service_subtype: "" }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({ ...demand, service_subtype: "   " }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      service_subtype: "cargo_only",
    }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      transport_mode: "van",
    }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({ ...demand, origin_country_code: null }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({ ...demand, origin_country_code: "rs" }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({ ...demand, origin_timezone: null }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({ ...demand, origin_timezone: "" }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({ ...demand, origin_timezone: "  " }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({ ...demand, night_policy_version: null }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({ ...demand, night_policy_version: 0 }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      category: "buy",
      service_subtype: null,
      transport_mode: null,
      origin_country_code: null,
      origin_timezone: null,
      night_policy_version: null,
    }),
    true,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      category: "buy",
      service_subtype: "passenger",
    }),
    false,
  );
  const deliver = post({
    id: DEMAND,
    user_id: ACTOR,
    post_type: "demand",
    category: "deliver",
    service_subtype: "cargo_with_escort",
    transport_mode: "cargo_van",
    escort_seats: 1,
  });
  assert.equal(postSatisfiesAdmissionAuthority(deliver), true);
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...deliver,
      transport_mode: "cargo_boat",
    }),
    false,
  );

  // Pair subtype exact-match (no silent downgrade).
  assert.equal(pairHasExactAdmissionSubtype(demand, provider), true);
  assert.equal(
    pairHasExactAdmissionSubtype(demand, {
      ...provider,
      service_subtype: "small_item_only",
    }),
    false,
  );
  assert.equal(
    pairHasExactAdmissionSubtype(demand, {
      ...provider,
      service_subtype: "passenger_with_small_item",
    }),
    false,
  );
  assert.equal(
    pairHasExactAdmissionSubtype(
      { ...demand, category: "deliver", service_subtype: "cargo_only", transport_mode: "cargo_van" },
      {
        ...provider,
        category: "deliver",
        service_subtype: "cargo_with_escort",
        transport_mode: "cargo_van",
        escort_seats: 1,
      },
    ),
    false,
  );
  assert.equal(
    evaluatePairCompatibility(demand, {
      ...provider,
      service_subtype: "small_item_only",
      transport_mode: "car",
    }).ok,
    false,
  );
  assert.equal(
    evaluatePairCompatibility(demand, {
      ...provider,
      service_subtype: "passenger_with_small_item",
    }).ok,
    false,
  );
  assert.equal(evaluatePairCompatibility(demand, provider).ok, true);

  // Transport authority via single-post helper (both sides must pass).
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      service_subtype: "small_item_only",
      transport_mode: "cargo_van",
    }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      category: "deliver",
      service_subtype: "cargo_only",
      transport_mode: "bus",
    }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      transport_mode: "walking",
    }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      service_subtype: "passenger_with_small_item",
      transport_mode: "bus",
    }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      category: "deliver",
      service_subtype: "cargo_with_escort",
      transport_mode: "private_cargo_boat",
      escort_seats: 1,
    }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      transport_mode: "unknown_mode",
    }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      transport_mode: null,
    }),
    false,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      transport_mode: "  ",
    }),
    false,
  );

  // Positive transport cases (initiator-shaped posts).
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      service_subtype: "passenger",
      transport_mode: "car",
    }),
    true,
  );
  assert.equal(
    postSatisfiesAdmissionAuthority({
      ...demand,
      service_subtype: "passenger_with_small_item",
      transport_mode: "car",
    }),
    true,
  );
  for (const mode of TARGET_TRAVEL_TRANSPORT_MODES) {
    assert.equal(
      postSatisfiesAdmissionAuthority({
        ...demand,
        service_subtype: "small_item_only",
        transport_mode: mode,
      }),
      true,
      `small_item_only + ${mode}`,
    );
  }
  for (const mode of TARGET_DELIVER_TRANSPORT_MODES) {
    assert.equal(
      postSatisfiesAdmissionAuthority({
        ...demand,
        category: "deliver",
        service_subtype: "cargo_only",
        transport_mode: mode,
      }),
      true,
      `cargo_only + ${mode}`,
    );
  }
  for (const mode of [
    "cargo_van",
    "light_truck",
    "box_truck",
    "vehicle_with_trailer",
    "other_cargo_vehicle",
  ] as const) {
    assert.equal(
      postSatisfiesAdmissionAuthority({
        ...demand,
        category: "deliver",
        service_subtype: "cargo_with_escort",
        transport_mode: mode,
        escort_seats: 1,
      }),
      true,
      `cargo_with_escort + ${mode}`,
    );
  }

  // Counterpart side also fail-closed when only right is illegal.
  assert.equal(
    evaluatePairCompatibility(demand, {
      ...provider,
      transport_mode: "bus",
    }).ok,
    false,
  );
  assert.equal(
    evaluatePairCompatibility(
      {
        ...demand,
        category: "deliver",
        service_subtype: "cargo_only",
        transport_mode: "cargo_van",
      },
      {
        ...provider,
        category: "deliver",
        service_subtype: "cargo_only",
        transport_mode: "bus",
      },
    ).ok,
    false,
  );
}

console.log("matchAdmissionPolicy.test.ts: ok");
