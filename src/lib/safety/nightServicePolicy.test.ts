/**
 * PHASE 6.7C.2A — service subtype and night-safety helper tests.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/nightServicePolicy.test.ts
 */

import assert from "node:assert/strict";
import {
  DELIVER_SERVICE_SUBTYPES,
  NO_PLATFORM_PASSENGER_MODES,
  PLATFORM_PASSENGER_MODES,
  SERVICE_SUBTYPE_TRUTH,
  TRAVEL_SERVICE_SUBTYPES,
  evaluateNightServicePolicy,
  isLocalTimeInBlockedWindow,
  serviceRequiresHumanTravel,
  serviceSubtypeIsLegal,
  serviceSubtypesAreCompatible,
  transportModeMayCarryPlatformPassenger,
  type NightServiceDecision,
} from "@/lib/safety/nightServicePolicy";
import {
  TARGET_DELIVER_TRANSPORT_MODES,
  TARGET_TRAVEL_TRANSPORT_MODES,
} from "@/lib/transport/transportPolicy";

function denialReason(decision: NightServiceDecision): string | undefined {
  return decision.ok ? undefined : decision.reason;
}

for (const row of SERVICE_SUBTYPE_TRUTH) {
  assert.equal(
    serviceSubtypeIsLegal(row.category, row.subtype),
    row.legal,
    `${row.category}/${String(row.subtype)}`,
  );
}

assert.equal(serviceSubtypeIsLegal("travel", "unknown"), false);
assert.equal(serviceSubtypeIsLegal("ghost", null), false);
assert.equal(serviceSubtypeIsLegal("buy", "cargo_only"), false);

assert.equal(serviceRequiresHumanTravel("travel", "passenger"), true);
assert.equal(serviceRequiresHumanTravel("travel", "passenger_with_small_item"), true);
assert.equal(serviceRequiresHumanTravel("travel", "small_item_only"), false);
assert.equal(serviceRequiresHumanTravel("deliver", "cargo_with_escort"), true);
assert.equal(serviceRequiresHumanTravel("deliver", "cargo_only"), false);
assert.equal(serviceRequiresHumanTravel("onsite", null), true);
assert.equal(serviceRequiresHumanTravel("buy", null), false);
assert.equal(serviceRequiresHumanTravel("errand", null), false);

assert.equal(serviceSubtypesAreCompatible("travel", "passenger", "travel", "passenger"), true);
assert.equal(
  serviceSubtypesAreCompatible("travel", "small_item_only", "travel", "small_item_only"),
  true,
);
assert.equal(
  serviceSubtypesAreCompatible(
    "travel",
    "passenger_with_small_item",
    "travel",
    "passenger_with_small_item",
  ),
  true,
);
assert.equal(
  serviceSubtypesAreCompatible("travel", "passenger_with_small_item", "travel", "passenger"),
  false,
);
assert.equal(
  serviceSubtypesAreCompatible("travel", "passenger", "travel", "small_item_only"),
  false,
);
assert.equal(serviceSubtypesAreCompatible("deliver", "cargo_only", "deliver", "cargo_only"), true);
assert.equal(
  serviceSubtypesAreCompatible("deliver", "cargo_with_escort", "deliver", "cargo_with_escort"),
  true,
);
assert.equal(
  serviceSubtypesAreCompatible("deliver", "cargo_only", "deliver", "cargo_with_escort"),
  false,
);
assert.equal(serviceSubtypesAreCompatible("travel", "passenger", "deliver", "cargo_only"), false);
assert.equal(serviceSubtypesAreCompatible("travel", null, "travel", "passenger"), false);
assert.equal(serviceSubtypesAreCompatible("buy", null, "buy", null), true);
assert.equal(serviceSubtypesAreCompatible("onsite", null, "onsite", null), true);

for (const mode of NO_PLATFORM_PASSENGER_MODES) {
  assert.equal(transportModeMayCarryPlatformPassenger(mode), false, mode);
}
for (const mode of PLATFORM_PASSENGER_MODES) {
  assert.equal(transportModeMayCarryPlatformPassenger(mode), true, mode);
}
assert.equal(transportModeMayCarryPlatformPassenger("van"), false);
assert.equal(transportModeMayCarryPlatformPassenger("unknown"), false);

assert.equal(
  evaluateNightServicePolicy({
    category: "travel",
    serviceSubtype: "passenger",
    transportMode: "car",
  }).ok,
  true,
);
assert.equal(
  evaluateNightServicePolicy({
    category: "travel",
    serviceSubtype: "passenger",
    transportMode: "motorbike",
  }).ok,
  false,
);
assert.equal(
  denialReason(
    evaluateNightServicePolicy({
      category: "travel",
      serviceSubtype: "passenger",
      transportMode: "ferry",
    }),
  ),
  "illegal_transport_combo",
);
assert.equal(
  evaluateNightServicePolicy({
    category: "travel",
    serviceSubtype: "passenger",
    transportMode: "bus",
  }).ok,
  false,
);
assert.equal(
  evaluateNightServicePolicy({
    category: "travel",
    serviceSubtype: "passenger",
    transportMode: "train",
  }).ok,
  false,
);
assert.equal(
  evaluateNightServicePolicy({
    category: "travel",
    serviceSubtype: "passenger",
    transportMode: "flight",
  }).ok,
  false,
);
assert.equal(
  evaluateNightServicePolicy({
    category: "travel",
    serviceSubtype: "passenger_with_small_item",
    transportMode: "private_boat",
  }).ok,
  false,
);
assert.equal(
  evaluateNightServicePolicy({
    category: "travel",
    serviceSubtype: "small_item_only",
    transportMode: "walking",
  }).ok,
  true,
);
assert.equal(
  evaluateNightServicePolicy({
    category: "travel",
    serviceSubtype: "passenger",
    transportMode: "cargo_van",
  }).ok,
  false,
);
assert.equal(
  evaluateNightServicePolicy({
    category: "deliver",
    serviceSubtype: "cargo_with_escort",
    transportMode: "cargo_van",
  }).ok,
  true,
);
assert.equal(
  evaluateNightServicePolicy({
    category: "deliver",
    serviceSubtype: "cargo_with_escort",
    transportMode: "cargo_boat",
  }).ok,
  false,
);
assert.equal(
  evaluateNightServicePolicy({
    category: "deliver",
    serviceSubtype: "cargo_only",
    transportMode: "cargo_boat",
  }).ok,
  true,
);
assert.equal(
  evaluateNightServicePolicy({
    category: "deliver",
    serviceSubtype: "cargo_with_escort",
    transportMode: "car",
  }).ok,
  false,
);
for (const mode of TARGET_DELIVER_TRANSPORT_MODES) {
  assert.equal(
    evaluateNightServicePolicy({
      category: "travel",
      serviceSubtype: "small_item_only",
      transportMode: mode,
    }).ok,
    false,
    `cargo ${mode} must not enter travel`,
  );
}

assert.equal(
  denialReason(
    evaluateNightServicePolicy({
      category: "travel",
      serviceSubtype: null,
      purpose: "match",
    }),
  ),
  "legacy_unknown_subtype",
);
assert.equal(
  denialReason(
    evaluateNightServicePolicy({
      category: "deliver",
      serviceSubtype: null,
      purpose: "publish",
    }),
  ),
  "legacy_unknown_subtype",
);

const overnight = {
  blockedStartLocal: "22:00",
  blockedEndLocal: "06:00",
  policyEnabled: true,
} as const;

assert.equal(isLocalTimeInBlockedWindow("21:59", "22:00", "06:00"), false);
assert.equal(isLocalTimeInBlockedWindow("22:00", "22:00", "06:00"), true);
assert.equal(isLocalTimeInBlockedWindow("23:59", "22:00", "06:00"), true);
assert.equal(isLocalTimeInBlockedWindow("00:00", "22:00", "06:00"), true);
assert.equal(isLocalTimeInBlockedWindow("05:59", "22:00", "06:00"), true);
assert.equal(isLocalTimeInBlockedWindow("06:00", "22:00", "06:00"), false);

assert.equal(isLocalTimeInBlockedWindow("00:59", "01:00", "05:00"), false);
assert.equal(isLocalTimeInBlockedWindow("01:00", "01:00", "05:00"), true);
assert.equal(isLocalTimeInBlockedWindow("04:59", "01:00", "05:00"), true);
assert.equal(isLocalTimeInBlockedWindow("05:00", "01:00", "05:00"), false);

const nightHuman = {
  category: "travel" as const,
  serviceSubtype: "passenger",
  transportMode: "car",
  ...overnight,
};
assert.equal(
  evaluateNightServicePolicy({ ...nightHuman, localTime: "21:59" }).ok,
  true,
);
assert.equal(
  denialReason(evaluateNightServicePolicy({ ...nightHuman, localTime: "22:00" })),
  "night_blocked",
);
assert.equal(
  denialReason(evaluateNightServicePolicy({ ...nightHuman, localTime: "00:00" })),
  "night_blocked",
);
assert.equal(
  evaluateNightServicePolicy({ ...nightHuman, localTime: "06:00" }).ok,
  true,
);
assert.equal(
  evaluateNightServicePolicy({
    category: "travel",
    serviceSubtype: "small_item_only",
    transportMode: "walking",
    localTime: "23:00",
    ...overnight,
  }).ok,
  true,
);
assert.equal(
  evaluateNightServicePolicy({
    category: "deliver",
    serviceSubtype: "cargo_only",
    transportMode: "box_truck",
    localTime: "23:00",
    ...overnight,
  }).ok,
  true,
);
assert.equal(
  denialReason(
    evaluateNightServicePolicy({
      category: "deliver",
      serviceSubtype: "cargo_with_escort",
      transportMode: "light_truck",
      localTime: "23:00",
      ...overnight,
    }),
  ),
  "night_blocked",
);
assert.equal(
  denialReason(
    evaluateNightServicePolicy({
    category: "onsite",
    serviceSubtype: null,
    localTime: "23:00",
    ...overnight,
  }),
  ),
  "night_blocked",
);
assert.equal(
  evaluateNightServicePolicy({
    category: "buy",
    serviceSubtype: null,
    localTime: "23:00",
    ...overnight,
  }).ok,
  true,
);
assert.equal(
  evaluateNightServicePolicy({
    category: "errand",
    serviceSubtype: null,
    localTime: "23:00",
    ...overnight,
  }).ok,
  true,
);
assert.equal(
  evaluateNightServicePolicy({
    ...nightHuman,
    localTime: "23:00",
    policyEnabled: false,
  }).ok,
  true,
);
assert.equal(
  denialReason(
    evaluateNightServicePolicy({
      category: "travel",
      serviceSubtype: "passenger",
      transportMode: "motorbike",
      policyEnabled: false,
    }),
  ),
  "illegal_transport_combo",
);

assert.ok(TARGET_TRAVEL_TRANSPORT_MODES.includes("car"));
assert.equal(TRAVEL_SERVICE_SUBTYPES.length, 3);
assert.equal(DELIVER_SERVICE_SUBTYPES.length, 2);

console.log("nightServicePolicy.test.ts: ok");
