/**
 * PHASE 6.7C.2B — publish subtype helpers + defaults.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/serviceSubtypePublish.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoBrowserNightAuthorityFields,
  assertPublishSubtypeTransportLegal,
  cleanupFieldsForServiceSubtype,
  DEFAULT_DELIVER_SERVICE_SUBTYPE,
  DEFAULT_TRAVEL_SERVICE_SUBTYPE,
  defaultServiceSubtypeForCategory,
  parsePublishServiceSubtype,
  travelShowsLuggageControls,
  travelShowsPassengerControls,
} from "@/lib/safety/serviceSubtypePublish";
import { initialFormState } from "@/lib/post-form/usePostFormState";
import { buildPayloadFromForm } from "@/lib/post-form/buildPayload";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

assert.equal(DEFAULT_TRAVEL_SERVICE_SUBTYPE, "passenger");
assert.equal(DEFAULT_DELIVER_SERVICE_SUBTYPE, "cargo_only");
assert.equal(defaultServiceSubtypeForCategory("travel"), "passenger");
assert.equal(defaultServiceSubtypeForCategory("deliver"), "cargo_only");
assert.equal(defaultServiceSubtypeForCategory("buy"), null);
assert.equal(initialFormState.service_subtype, "passenger");

assert.equal(parsePublishServiceSubtype("travel", "passenger"), "passenger");
assert.equal(parsePublishServiceSubtype("travel", "small_item_only"), "small_item_only");
assert.equal(
  parsePublishServiceSubtype("travel", "passenger_with_small_item"),
  "passenger_with_small_item",
);
assert.equal(parsePublishServiceSubtype("deliver", "cargo_only"), "cargo_only");
assert.equal(parsePublishServiceSubtype("deliver", "cargo_with_escort"), "cargo_with_escort");
assert.equal(parsePublishServiceSubtype("buy", null), null);
assert.equal(parsePublishServiceSubtype("onsite", ""), null);
assert.equal(parsePublishServiceSubtype("errand", undefined), null);

for (const bad of [null, "", "cargo_only", "unknown", 1]) {
  assert.throws(
    () => parsePublishServiceSubtype("travel", bad),
    (err: unknown) =>
      err instanceof Error && err.message === "error.invalid_service_subtype",
  );
}
assert.throws(
  () => parsePublishServiceSubtype("buy", "passenger"),
  (err: unknown) =>
    err instanceof Error && err.message === "error.invalid_service_subtype",
);
assert.throws(
  () => parsePublishServiceSubtype("deliver", "passenger"),
  (err: unknown) =>
    err instanceof Error && err.message === "error.invalid_service_subtype",
);

assert.doesNotThrow(() =>
  assertPublishSubtypeTransportLegal({
    category: "travel",
    postType: "demand",
    serviceSubtype: "passenger",
    transportMode: null,
  }),
);
assert.throws(
  () =>
    assertPublishSubtypeTransportLegal({
      category: "travel",
      postType: "provider",
      serviceSubtype: "passenger",
      transportMode: null,
    }),
  (err: unknown) =>
    err instanceof Error && err.message === "error.transport_mode_required",
);
assert.throws(
  () =>
    assertPublishSubtypeTransportLegal({
      category: "travel",
      postType: "provider",
      serviceSubtype: "passenger",
      transportMode: "motorbike",
    }),
  (err: unknown) =>
    err instanceof Error && err.message === "error.illegal_transport_combo",
);
assert.doesNotThrow(() =>
  assertPublishSubtypeTransportLegal({
    category: "deliver",
    postType: "provider",
    serviceSubtype: "cargo_only",
    transportMode: "van",
  }),
);
assert.doesNotThrow(() =>
  assertPublishSubtypeTransportLegal({
    category: "deliver",
    postType: "provider",
    serviceSubtype: "cargo_with_escort",
    transportMode: "van",
  }),
);
// policyEnabled=false must not skip subtype/transport legality
assert.throws(
  () =>
    assertPublishSubtypeTransportLegal({
      category: "travel",
      postType: "demand",
      serviceSubtype: null,
      transportMode: "car",
    }),
  (err: unknown) =>
    err instanceof Error && err.message === "error.invalid_service_subtype",
);

assert.throws(
  () =>
    assertNoBrowserNightAuthorityFields({
      origin_country_code: "RS",
    }),
  (err: unknown) =>
    err instanceof Error &&
    err.message === "error.browser_night_authority_rejected",
);
assert.doesNotThrow(() => assertNoBrowserNightAuthorityFields({ title: "x" }));

const cleanedPassenger = cleanupFieldsForServiceSubtype({
  category: "travel",
  serviceSubtype: "passenger",
  escort_seats: 9,
  max_companions: 2,
  share_mode: "share",
  count_small: 3,
  count_medium: 0,
  count_large: 0,
  count_xlarge: 0,
  carry_luggage: false,
});
assert.equal(cleanedPassenger.count_small, 0);
assert.equal(cleanedPassenger.max_companions, 2);

const cleanedSmall = cleanupFieldsForServiceSubtype({
  category: "travel",
  serviceSubtype: "small_item_only",
  escort_seats: 4,
  max_companions: 4,
  share_mode: "private",
  count_small: 1,
  count_medium: 0,
  count_large: 0,
  count_xlarge: 0,
  carry_luggage: false,
});
assert.equal(cleanedSmall.escort_seats, 0);
assert.equal(cleanedSmall.max_companions, 0);
assert.equal(cleanedSmall.share_mode, null);
assert.equal(cleanedSmall.carry_luggage, true);

const cleanedEscort = cleanupFieldsForServiceSubtype({
  category: "deliver",
  serviceSubtype: "cargo_with_escort",
  escort_seats: 4,
  max_companions: 2,
  share_mode: "share",
  count_small: 1,
  count_medium: 0,
  count_large: 0,
  count_xlarge: 0,
  carry_luggage: true,
});
assert.equal(cleanedEscort.escort_seats, 1);

assert.equal(travelShowsPassengerControls("passenger"), true);
assert.equal(travelShowsPassengerControls("small_item_only"), false);
assert.equal(travelShowsLuggageControls("passenger", false), false);
assert.equal(travelShowsLuggageControls("passenger_with_small_item", false), true);

const travelPayload = buildPayloadFromForm(
  {
    ...initialFormState,
    origin_address: "A",
    destination_address: "B",
    estimated_kms: 12,
    service_subtype: "passenger_with_small_item",
    carry_luggage: true,
    count_small: 1,
    raw_phone_local: "601234567",
  },
  1,
  null,
);
assert.equal(travelPayload.ok, true);
if (travelPayload.ok) {
  assert.equal(travelPayload.payload.service_subtype, "passenger_with_small_item");
}

const buyPayload = buildPayloadFromForm(
  {
    ...initialFormState,
    category: "buy",
    service_subtype: null,
    service_address: "Market",
    title: "Milk",
    description: "1L",
    estimated_kms: 0,
    raw_phone_local: "601234567",
  },
  1,
  null,
);
assert.equal(buyPayload.ok, true);
if (buyPayload.ok) {
  assert.equal(buyPayload.payload.service_subtype, null);
}

const zh = read("src/messages/zh.json");
const en = read("src/messages/en.json");
const sr = read("src/messages/sr.json");
for (const src of [zh, en, sr]) {
  assert.ok(src.includes("service_subtype_legend"));
  assert.ok(src.includes('"passenger"'));
  assert.ok(src.includes('"small_item_only"'));
  assert.ok(src.includes('"passenger_with_small_item"'));
  assert.ok(src.includes('"cargo_only"'));
  assert.ok(src.includes('"cargo_with_escort"'));
  assert.ok(src.includes("invalid_service_subtype"));
  assert.ok(src.includes("browser_night_authority_rejected"));
}

const sheet = read("src/components/home/PublishBottomSheet.tsx");
assert.ok(sheet.includes("ServiceSubtypeFields"));
assert.ok(sheet.includes("DELIVER_VEHICLE_OPTIONS"));
assert.equal(sheet.includes("cargo_van"), false);

console.log("serviceSubtypePublish.test.ts: ok");
