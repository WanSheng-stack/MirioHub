/**
 * PHASE 6.7C.2B.2 — v98 subtype×transport SQL structure + TS/UI parity.
 * Does not execute SQL or connect to Supabase.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/stage1PublishV98Boundary.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CanonicalStage1Error,
  normalizeCanonicalStage1,
} from "@/lib/auth/canonicalStage1Core";
import {
  parsePublishTransportMode,
  publishTransportModesForSubtype,
  PUBLISH_UI_TRAVEL_PEOPLE_TRANSPORT_MODES,
  PUBLISH_UI_TRAVEL_TRANSPORT_MODES,
  PUBLISH_UI_DELIVER_ESCORT_TRANSPORT_MODES,
} from "@/lib/auth/publishTransportMode";
import {
  cleanupFieldsForServiceSubtype,
  assertPublishSubtypeTransportLegal,
} from "@/lib/safety/serviceSubtypePublish";
import { TARGET_TRAVEL_TRANSPORT_MODES } from "@/lib/transport/transportPolicy";
import { initialFormState } from "@/lib/post-form/usePostFormState";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const migration = read(
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.sql",
);
const verifySql = read(
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.verify.sql",
);

function insertFnBody(): string {
  const start = migration.indexOf(
    "CREATE FUNCTION public.insert_stage1_post_v98(",
  );
  const end = migration.indexOf(
    "REVOKE ALL ON FUNCTION public.insert_stage1_post_v98(",
    start,
  );
  assert.ok(start >= 0 && end > start);
  return migration.slice(start, end);
}

const insertBody = insertFnBody();

// ── SQL structure: subtype × transport ──────────────────────────────────────
assert.ok(insertBody.includes("v98_people_travel_car_only"));
assert.ok(insertBody.includes("v_transport_raw IS DISTINCT FROM 'car'"));
assert.ok(insertBody.includes("v98_small_item_travel_all_modes"));
assert.ok(insertBody.includes("v98_cargo_escort_land_only"));
assert.ok(insertBody.includes("v98_cargo_only_full_deliver"));
assert.ok(insertBody.includes("v98_normalize_passenger_zero_counts"));
assert.ok(insertBody.includes("v98_normalize_cargo_escort_demand_provider"));

// people subtypes reject non-car (branch order: car-only before full travel list)
{
  const peopleIdx = insertBody.lastIndexOf("v98_people_travel_car_only");
  const smallIdx = insertBody.lastIndexOf("v98_small_item_travel_all_modes");
  assert.ok(peopleIdx > 0 && smallIdx > peopleIdx);
  const peopleBlock = insertBody.slice(peopleIdx, smallIdx);
  assert.ok(peopleBlock.includes("IS DISTINCT FROM 'car'"));
  assert.equal(peopleBlock.includes("'walking'"), false);
}

// cargo_with_escort rejects boats explicitly before land allowlist
{
  const escortIdx = insertBody.lastIndexOf("v98_cargo_escort_land_only");
  const block = insertBody.slice(escortIdx, escortIdx + 1200);
  assert.ok(block.includes("'cargo_boat'"));
  assert.ok(block.includes("'private_cargo_boat'"));
  assert.ok(block.includes("error.illegal_transport_combo"));
  assert.ok(block.includes("'cargo_van'"));
}

// cargo_only includes water modes
{
  const onlyIdx = insertBody.lastIndexOf("v98_cargo_only_full_deliver");
  const block = insertBody.slice(onlyIdx, onlyIdx + 800);
  assert.ok(block.includes("'cargo_boat'"));
  assert.ok(block.includes("'private_cargo_boat'"));
}

// normalize branches
assert.ok(insertBody.includes("v_count_small := 0"));
assert.ok(insertBody.includes("v_count_xlarge := 0"));
assert.ok(
  /cargo_with_escort[\s\S]*v_post_type = 'demand'[\s\S]*v_escort_seats := 1/.test(
    insertBody,
  ),
);
assert.ok(
  /v_post_type = 'demand'[\s\S]*ELSE[\s\S]*v_escort_seats := 0[\s\S]*v_share_mode := NULL/.test(
    insertBody,
  ),
);
assert.ok(insertBody.includes("invalid_text_representation"));
assert.ok(insertBody.includes("error.invalid_payload_numeric_values"));
assert.ok(insertBody.includes("v_post_type"));
assert.ok(insertBody.includes("'demand'"));
assert.ok(insertBody.includes("'provider'"));

// verify structural locks
assert.ok(verifySql.includes("people_travel_car_only"));
assert.ok(verifySql.includes("cargo_escort_rejects_boats"));
assert.ok(verifySql.includes("passenger_zeros_counts"));
assert.ok(verifySql.includes("cargo_escort_demand_provider_split"));
assert.ok(verifySql.includes("numeric_fail_closed"));
assert.ok(verifySql.includes("insert_v98 people car-only branch"));
assert.ok(verifySql.includes("insert_v98 escort land + normalize"));
assert.equal(/SELECT\s+p\.prosrc\b/i.test(verifySql), false);

// ── TS parity: reject / accept matrix ───────────────────────────────────────
function expectCanonReject(raw: Record<string, unknown>, key: string) {
  assert.throws(
    () => normalizeCanonicalStage1(raw),
    (err: unknown) =>
      err instanceof CanonicalStage1Error && err.errorKey === key,
  );
}

const travelBase: Record<string, unknown> = {
  post_type: "demand",
  category: "travel",
  service_subtype: "passenger",
  title: "",
  origin_address: "A",
  destination_address: "B",
  departure_date: "2026-09-10",
  departure_time: "14:30",
  time_buffer: 30,
  waypoints: [],
  share_mode: "share",
  delivery_mode: null,
  count_small: 0,
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

expectCanonReject(
  { ...travelBase, transport_mode: "walking" },
  "error.illegal_transport_combo",
);
expectCanonReject(
  {
    ...travelBase,
    service_subtype: "passenger_with_small_item",
    transport_mode: "bus",
  },
  "error.illegal_transport_combo",
);
assert.equal(
  normalizeCanonicalStage1({ ...travelBase, transport_mode: "car" })
    .transport_mode,
  "car",
);
assert.equal(
  normalizeCanonicalStage1({
    ...travelBase,
    service_subtype: "small_item_only",
    transport_mode: "walking",
    escort_seats: 0,
    max_companions: 0,
    share_mode: null,
  }).transport_mode,
  "walking",
);
expectCanonReject(
  {
    ...travelBase,
    category: "deliver",
    service_subtype: "cargo_with_escort",
    transport_mode: "cargo_boat",
    share_mode: "share",
  },
  "error.illegal_transport_combo",
);
assert.equal(
  normalizeCanonicalStage1({
    ...travelBase,
    category: "deliver",
    service_subtype: "cargo_with_escort",
    transport_mode: "cargo_van",
    share_mode: "share",
  }).transport_mode,
  "cargo_van",
);
assert.equal(
  normalizeCanonicalStage1({
    ...travelBase,
    category: "deliver",
    service_subtype: "cargo_only",
    transport_mode: "cargo_boat",
    share_mode: null,
    escort_seats: 0,
    max_companions: 0,
  }).transport_mode,
  "cargo_boat",
);
expectCanonReject(
  { ...travelBase, transport_mode: "van" },
  "error.invalid_transport_mode",
);

// ── Field normalize (TS cleanup mirrors SQL) ────────────────────────────────
{
  const p = cleanupFieldsForServiceSubtype({
    category: "travel",
    postType: "demand",
    serviceSubtype: "passenger",
    escort_seats: 2,
    max_companions: 2,
    share_mode: "share",
    count_small: 9,
    count_medium: 1,
    count_large: 1,
    count_xlarge: 1,
    carry_luggage: true,
  });
  assert.equal(p.count_small, 0);
  assert.equal(p.count_medium, 0);
  assert.equal(p.count_large, 0);
  assert.equal(p.count_xlarge, 0);
  assert.equal(p.carry_luggage, false);
}
{
  const p = cleanupFieldsForServiceSubtype({
    category: "travel",
    postType: "demand",
    serviceSubtype: "small_item_only",
    escort_seats: 3,
    max_companions: 3,
    share_mode: "private",
    count_small: 2,
    count_medium: 0,
    count_large: 0,
    count_xlarge: 0,
    carry_luggage: false,
  });
  assert.equal(p.escort_seats, 0);
  assert.equal(p.max_companions, 0);
  assert.equal(p.share_mode, null);
  assert.equal(p.count_small, 2);
}
{
  const p = cleanupFieldsForServiceSubtype({
    category: "deliver",
    postType: "demand",
    serviceSubtype: "cargo_only",
    escort_seats: 2,
    max_companions: 2,
    share_mode: "share",
    count_small: 1,
    count_medium: 0,
    count_large: 0,
    count_xlarge: 0,
    carry_luggage: false,
  });
  assert.equal(p.escort_seats, 0);
  assert.equal(p.share_mode, null);
}
{
  const d = cleanupFieldsForServiceSubtype({
    category: "deliver",
    postType: "demand",
    serviceSubtype: "cargo_with_escort",
    escort_seats: 9,
    max_companions: 2,
    share_mode: "private",
    count_small: 1,
    count_medium: 0,
    count_large: 0,
    count_xlarge: 0,
    carry_luggage: false,
  });
  assert.equal(d.escort_seats, 1);
  const pr = cleanupFieldsForServiceSubtype({
    category: "deliver",
    postType: "provider",
    serviceSubtype: "cargo_with_escort",
    escort_seats: 9,
    max_companions: 2,
    share_mode: "share",
    count_small: 1,
    count_medium: 0,
    count_large: 0,
    count_xlarge: 0,
    carry_luggage: false,
  });
  assert.equal(pr.escort_seats, 0);
  assert.equal(pr.share_mode, null);
}
expectCanonReject(
  { ...travelBase, max_companions: 5, escort_seats: 5 },
  "error.invalid_payload_numeric_values",
);
expectCanonReject(
  { ...travelBase, count_small: -1 },
  "error.invalid_payload_numeric_values",
);

// ── UI subtype option lists ─────────────────────────────────────────────────
assert.deepEqual([...publishTransportModesForSubtype("travel", "passenger")], [
  "car",
]);
assert.deepEqual(
  [...publishTransportModesForSubtype("travel", "passenger_with_small_item")],
  ["car"],
);
assert.deepEqual(
  [...publishTransportModesForSubtype("travel", "small_item_only")],
  [...TARGET_TRAVEL_TRANSPORT_MODES],
);
assert.deepEqual(
  [...publishTransportModesForSubtype("deliver", "cargo_with_escort")],
  [...PUBLISH_UI_DELIVER_ESCORT_TRANSPORT_MODES],
);
assert.equal(
  (
    publishTransportModesForSubtype(
      "deliver",
      "cargo_with_escort",
    ) as readonly string[]
  ).includes("cargo_boat"),
  false,
);
assert.equal(initialFormState.service_subtype, "passenger");
assert.deepEqual([...PUBLISH_UI_TRAVEL_PEOPLE_TRANSPORT_MODES], ["car"]);
assert.ok(PUBLISH_UI_TRAVEL_TRANSPORT_MODES.includes("walking"));

// walking cleared when switching back to passenger
{
  assert.equal(
    parsePublishTransportMode("travel", "walking", "passenger").ok,
    false,
  );
  assert.equal(
    parsePublishTransportMode("travel", "walking", "small_item_only").ok,
    true,
  );
  const allowed = new Set(
    publishTransportModesForSubtype("travel", "passenger") as readonly string[],
  );
  const prior = "walking";
  const cleared = allowed.has(prior) ? prior : "";
  assert.equal(cleared, "");
}

assert.throws(
  () =>
    assertPublishSubtypeTransportLegal({
      category: "travel",
      postType: "demand",
      serviceSubtype: "passenger",
      transportMode: "walking",
    }),
  (err: unknown) =>
    err instanceof Error && err.message === "error.illegal_transport_combo",
);

// ── Static production proofs ────────────────────────────────────────────────
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

const sheet = read("src/components/home/PublishBottomSheet.tsx");
assert.ok(sheet.includes("publishTransportModesForSubtype"));
assert.equal(sheet.includes("publishTransportModesForCategory("), false);

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
let v86Hits = 0;
for (const file of walk(join(repoRoot, "src"))) {
  const src = readFileSync(file, "utf8");
  const rel = file.slice(repoRoot.length + 1).replace(/\\/g, "/");
  if (rel.includes(".test.")) continue;
  if (/from\(["']posts["']\)\s*\.insert/.test(src)) insertHits += 1;
  if (
    (rel.includes("app/api/") ||
      rel.includes("components/") ||
      rel.includes("lib/auth/") ||
      rel.includes("lib/post-form/")) &&
    /insert_stage1_post_v86|publish_active_post_idempotent_v86|create_shadow_draft_idempotent_v86|commit_phase3_business_idempotent_v86/.test(
      src,
    )
  ) {
    v86Hits += 1;
  }
}
assert.equal(insertHits, 0);
assert.equal(v86Hits, 0);

console.log("stage1PublishV98Boundary.test.ts: ok");
console.log("v98 SQL is not applied remotely.");
