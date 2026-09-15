/**
 * PHASE 6.7C.2B.1 — publish subtype + transport helpers.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/serviceSubtypePublish.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
import {
  parsePublishTransportMode,
  PUBLISH_UI_DELIVER_TRANSPORT_MODES,
  PUBLISH_UI_TRAVEL_TRANSPORT_MODES,
} from "@/lib/auth/publishTransportMode";
import {
  TARGET_DELIVER_TRANSPORT_MODES,
  TARGET_TRAVEL_TRANSPORT_MODES,
} from "@/lib/transport/transportPolicy";
import { initialFormState } from "@/lib/post-form/usePostFormState";
import { buildPayloadFromForm } from "@/lib/post-form/buildPayload";
import {
  CanonicalStage1Error,
  hashCanonicalStage1,
  normalizeCanonicalStage1,
  computeServerFeeMinor,
} from "@/lib/auth/canonicalStage1Core";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

assert.equal(DEFAULT_TRAVEL_SERVICE_SUBTYPE, "passenger");
assert.equal(DEFAULT_DELIVER_SERVICE_SUBTYPE, "cargo_only");
assert.equal(defaultServiceSubtypeForCategory("travel"), "passenger");
assert.equal(defaultServiceSubtypeForCategory("deliver"), "cargo_only");
assert.equal(defaultServiceSubtypeForCategory("buy"), null);
assert.equal(initialFormState.service_subtype, "passenger");

assert.deepEqual(
  [...PUBLISH_UI_TRAVEL_TRANSPORT_MODES],
  [...TARGET_TRAVEL_TRANSPORT_MODES],
);
assert.deepEqual([...PUBLISH_UI_DELIVER_TRANSPORT_MODES], [
  "cargo_van",
  "light_truck",
  "box_truck",
  "vehicle_with_trailer",
  "other_cargo_vehicle",
]);
assert.ok(TARGET_DELIVER_TRANSPORT_MODES.includes("cargo_boat"));
assert.ok(TARGET_DELIVER_TRANSPORT_MODES.includes("private_cargo_boat"));

assert.equal(parsePublishServiceSubtype("travel", "passenger"), "passenger");
assert.equal(parsePublishServiceSubtype("travel", "small_item_only"), "small_item_only");
assert.equal(
  parsePublishServiceSubtype("travel", "passenger_with_small_item"),
  "passenger_with_small_item",
);
assert.equal(parsePublishServiceSubtype("deliver", "cargo_only"), "cargo_only");
assert.equal(parsePublishServiceSubtype("deliver", "cargo_with_escort"), "cargo_with_escort");
assert.equal(parsePublishServiceSubtype("buy", null), null);

for (const bad of [null, "", "cargo_only", "unknown", 1]) {
  assert.throws(
    () => parsePublishServiceSubtype("travel", bad),
    (err: unknown) =>
      err instanceof Error && err.message === "error.invalid_service_subtype",
  );
}

assert.throws(
  () =>
    assertPublishSubtypeTransportLegal({
      category: "travel",
      postType: "demand",
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
      transportMode: null,
    }),
  (err: unknown) =>
    err instanceof Error && err.message === "error.transport_mode_required",
);
assert.throws(
  () =>
    assertPublishSubtypeTransportLegal({
      category: "deliver",
      postType: "demand",
      serviceSubtype: "cargo_only",
      transportMode: "",
    }),
  (err: unknown) =>
    err instanceof Error && err.message === "error.transport_mode_required",
);
assert.throws(
  () =>
    assertPublishSubtypeTransportLegal({
      category: "deliver",
      postType: "provider",
      serviceSubtype: "cargo_only",
      transportMode: "van",
    }),
  (err: unknown) =>
    err instanceof Error && err.message === "error.invalid_transport_mode",
);
assert.throws(
  () =>
    assertPublishSubtypeTransportLegal({
      category: "travel",
      postType: "demand",
      serviceSubtype: "passenger",
      transportMode: "cargo_van",
    }),
  (err: unknown) =>
    err instanceof Error && err.message === "error.illegal_transport_combo",
);
assert.throws(
  () =>
    assertPublishSubtypeTransportLegal({
      category: "deliver",
      postType: "demand",
      serviceSubtype: "cargo_only",
      transportMode: "car",
    }),
  (err: unknown) =>
    err instanceof Error && err.message === "error.illegal_transport_combo",
);
assert.doesNotThrow(() =>
  assertPublishSubtypeTransportLegal({
    category: "deliver",
    postType: "provider",
    serviceSubtype: "cargo_only",
    transportMode: "cargo_van",
  }),
);
assert.doesNotThrow(() =>
  assertPublishSubtypeTransportLegal({
    category: "deliver",
    postType: "provider",
    serviceSubtype: "cargo_with_escort",
    transportMode: "light_truck",
  }),
);

assert.equal(parsePublishTransportMode("travel", "car").ok, true);
assert.equal(parsePublishTransportMode("deliver", "box_truck").ok, true);
assert.equal(parsePublishTransportMode("deliver", "van").ok, false);
assert.equal(parsePublishTransportMode("travel", null).ok, false);
assert.equal(parsePublishTransportMode("buy", null).ok, true);

assert.throws(
  () =>
    assertNoBrowserNightAuthorityFields({
      origin_country_code: "RS",
    }),
  (err: unknown) =>
    err instanceof Error &&
    err.message === "error.browser_night_authority_rejected",
);

const cleanedPassenger = cleanupFieldsForServiceSubtype({
  category: "travel",
  postType: "demand",
  serviceSubtype: "passenger",
  escort_seats: 9,
  max_companions: 2,
  share_mode: "share",
  count_small: 3,
  count_medium: 1,
  count_large: 1,
  count_xlarge: 1,
  carry_luggage: true,
});
assert.equal(cleanedPassenger.count_small, 0);
assert.equal(cleanedPassenger.count_medium, 0);
assert.equal(cleanedPassenger.count_large, 0);
assert.equal(cleanedPassenger.count_xlarge, 0);
assert.equal(cleanedPassenger.carry_luggage, false);
assert.equal(cleanedPassenger.max_companions, 2);

const cleanedPwsi = cleanupFieldsForServiceSubtype({
  category: "travel",
  postType: "demand",
  serviceSubtype: "passenger_with_small_item",
  escort_seats: 1,
  max_companions: 2,
  share_mode: "share",
  count_small: 2,
  count_medium: 0,
  count_large: 0,
  count_xlarge: 0,
  carry_luggage: false,
});
assert.equal(cleanedPwsi.count_small, 2);
assert.equal(cleanedPwsi.carry_luggage, true);

const cleanedEscortDemand = cleanupFieldsForServiceSubtype({
  category: "deliver",
  postType: "demand",
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
assert.equal(cleanedEscortDemand.escort_seats, 1);

const cleanedEscortProvider = cleanupFieldsForServiceSubtype({
  category: "deliver",
  postType: "provider",
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
assert.equal(cleanedEscortProvider.escort_seats, 0);
assert.equal(cleanedEscortProvider.share_mode, null);

assert.equal(travelShowsPassengerControls("passenger"), true);
assert.equal(travelShowsLuggageControls("passenger"), false);
assert.equal(travelShowsLuggageControls("passenger_with_small_item"), true);

const travelPayload = buildPayloadFromForm(
  {
    ...initialFormState,
    origin_address: "A",
    destination_address: "B",
    estimated_kms: 12,
    transport_mode: "car",
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
  assert.equal(travelPayload.payload.transport_mode, "car");
}

assert.equal(
  buildPayloadFromForm(
    {
      ...initialFormState,
      origin_address: "A",
      destination_address: "B",
      estimated_kms: 12,
      transport_mode: "",
      raw_phone_local: "601234567",
    },
    1,
    null,
  ).ok,
  false,
);

const baseRaw: Record<string, unknown> = {
  post_type: "demand",
  category: "travel",
  service_subtype: "passenger",
  title: "",
  origin_address: "Belgrade Center",
  destination_address: "Novi Sad",
  departure_date: "2026-09-10",
  departure_time: "14:30",
  time_buffer: 30,
  waypoints: [],
  share_mode: "share",
  delivery_mode: null,
  count_small: 3,
  count_medium: 0,
  count_large: 0,
  count_xlarge: 0,
  escort_seats: 1,
  max_companions: 1,
  bump_fee: 0,
  currency: "EUR",
  locale: "en",
  transport_mode: "car",
};

const passengerCanon = normalizeCanonicalStage1(baseRaw);
assert.equal(passengerCanon.count_small, 0);
assert.equal(passengerCanon.transport_mode, "car");

assert.throws(
  () => normalizeCanonicalStage1({ ...baseRaw, transport_mode: null }),
  (err: unknown) =>
    err instanceof CanonicalStage1Error &&
    err.errorKey === "error.transport_mode_required",
);
assert.throws(
  () =>
    normalizeCanonicalStage1({
      ...baseRaw,
      post_type: "provider",
      transport_mode: null,
    }),
  (err: unknown) =>
    err instanceof CanonicalStage1Error &&
    err.errorKey === "error.transport_mode_required",
);
assert.throws(
  () => normalizeCanonicalStage1({ ...baseRaw, transport_mode: "van" }),
  (err: unknown) =>
    err instanceof CanonicalStage1Error &&
    err.errorKey === "error.invalid_transport_mode",
);
assert.equal(
  normalizeCanonicalStage1({
    ...baseRaw,
    category: "deliver",
    service_subtype: "cargo_only",
    transport_mode: "cargo_van",
    share_mode: null,
    escort_seats: 0,
    max_companions: 0,
  }).transport_mode,
  "cargo_van",
);
assert.equal(
  normalizeCanonicalStage1({
    ...baseRaw,
    category: "deliver",
    post_type: "provider",
    service_subtype: "cargo_with_escort",
    transport_mode: "light_truck",
    escort_seats: 9,
    share_mode: "share",
  }).escort_seats,
  0,
);

const hashA = hashCanonicalStage1(
  normalizeCanonicalStage1(baseRaw),
  40,
  computeServerFeeMinor(40, normalizeCanonicalStage1(baseRaw)),
);
const hashB = hashCanonicalStage1(
  normalizeCanonicalStage1({
    ...baseRaw,
    service_subtype: "passenger_with_small_item",
    count_small: 1,
  }),
  40,
  computeServerFeeMinor(
    40,
    normalizeCanonicalStage1({
      ...baseRaw,
      service_subtype: "passenger_with_small_item",
      count_small: 1,
    }),
  ),
);
assert.notEqual(hashA, hashB);

const sheet = read("src/components/home/PublishBottomSheet.tsx");
assert.ok(sheet.includes("publishTransportModesForSubtype"));
assert.equal(sheet.includes('DELIVER_VEHICLE_OPTIONS: TransportMode[] = ["van"]'), false);
assert.equal(sheet.includes("submitPost"), false);
assert.ok(sheet.includes("stage1_required"));
assert.equal(sheet.includes("SET_CARRY_LUGGAGE"), false);
assert.ok(read("src/lib/auth/publishTransportMode.ts").includes("cargo_van"));

const submitPost = read("src/lib/post-form/submitPost.ts");
assert.equal(submitPost.includes('.from("posts").insert'), false);
assert.equal(submitPost.includes("export async function submitPost"), false);
assert.ok(submitPost.includes("upsertPhoneHistory"));
assert.ok(submitPost.includes("upsertPlateHistory"));

const postsNew = read("src/app/[locale]/posts/new/page.tsx");
assert.equal(postsNew.includes("submitPost"), false);
assert.equal(postsNew.includes('.from("posts").insert'), false);
assert.ok(postsNew.includes('redirect({ href: "/"'));

for (const src of [
  read("src/app/api/posts/trusted-publish/route.ts"),
  read("src/app/api/posts/shadow-draft/route.ts"),
  read("src/app/api/auth/passkey/verify/route.ts"),
]) {
  assert.ok(src.includes("_v98"));
  assert.equal(src.includes("insert_stage1_post_v86"), false);
  assert.equal(src.includes("publish_active_post_idempotent_v86"), false);
  assert.equal(src.includes("create_shadow_draft_idempotent_v86"), false);
  assert.equal(src.includes("commit_phase3_business_idempotent_v86"), false);
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, acc);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

let insertHits = 0;
let v86ProdHits = 0;
for (const file of walk(join(repoRoot, "src"))) {
  const src = readFileSync(file, "utf8");
  const rel = file.replace(repoRoot + "\\", "").replace(repoRoot + "/", "");
  if (/from\(["']posts["']\)\s*\.insert/.test(src) && !rel.includes(".test.")) {
    insertHits += 1;
  }
  if (
    /insert_stage1_post_v86|publish_active_post_idempotent_v86|create_shadow_draft_idempotent_v86|commit_phase3_business_idempotent_v86/.test(
      src,
    ) &&
    !rel.includes(".test.") &&
    !rel.includes("transportPolicy")
  ) {
    // Allow historical comments / migration string references only outside app routes
    if (
      rel.includes("app/api/") ||
      rel.includes("components/") ||
      rel.includes("lib/auth/") ||
      rel.includes("lib/post-form/")
    ) {
      v86ProdHits += 1;
    }
  }
}
assert.equal(insertHits, 0, "production posts.insert publish paths must be zero");
assert.equal(v86ProdHits, 0, "production v86 RPC call sites must be zero");

const zh = read("src/messages/zh.json");
const en = read("src/messages/en.json");
const sr = read("src/messages/sr.json");
for (const src of [zh, en, sr]) {
  assert.ok(src.includes("cargo_van"));
  assert.ok(src.includes("light_truck"));
  assert.ok(src.includes("box_truck"));
  assert.ok(src.includes("vehicle_with_trailer"));
  assert.ok(src.includes("other_cargo_vehicle"));
  assert.ok(src.includes("stage1_required"));
  assert.ok(src.includes("invalid_service_subtype"));
}

console.log("serviceSubtypePublish.test.ts: ok");
