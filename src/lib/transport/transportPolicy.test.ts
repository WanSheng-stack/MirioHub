/**
 * PHASE 6.7B.1A — transport / safety policy foundation (TEST A–Y).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/transport/transportPolicy.test.ts
 *
 * Relative-to-baseline checks compare
 * 6866e7ca03fe9d905cf5d70918d94571e5e5100b
 * (PHASE 6.7B). They do not use `git diff HEAD`.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALWAYS_ON_SAFETY_MODULES,
  PAYMENT_POLICY_V1,
  resolveSafetyModules,
  SAFETY_COPY_KEYS,
} from "@/lib/safety/safetyPolicy";
import { TRANSPORT_MODES } from "@/lib/posts";
import {
  CAR_PEOPLE_CAPACITY_MAX,
  getTransportFieldVisibility,
  getTransportPolicy,
  isLegacyReadableTransportMode,
  isModeAllowedForLane,
  LEGACY_VAN,
  LEGACY_VAN_SUGGESTED_TARGET,
  suggestedMigrationTarget,
  TARGET_DELIVER_TRANSPORT_MODES,
  TARGET_TRAVEL_TRANSPORT_MODES,
  validateTransportCapability,
} from "@/lib/transport/transportPolicy";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const PHASE_67B_BASELINE = "6866e7ca03fe9d905cf5d70918d94571e5e5100b";

const policySrc = read("src/lib/transport/transportPolicy.ts");
const safetySrc = read("src/lib/safety/safetyPolicy.ts");
const inventory = read("docs/architecture/transport-policy-inventory.md");
const postsSrc = read("src/lib/posts.ts");
const typesSrc = read("src/lib/types.ts");
const payloadSrc = read("src/lib/matching/applicationPayload.ts");
const freezeSrc = read("src/lib/matching/legacyMatchingFreeze.ts");
const matchRoute = read(
  "src/app/api/posts/evaluate-provider-match-intercept/route.ts",
);
const actionsSrc = read("src/components/post/PostActions.tsx");
const zh = read("src/messages/zh.json");
const en = read("src/messages/en.json");
const sr = read("src/messages/sr.json");

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

function walkRuntimeTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRuntimeTs(full, acc);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      continue;
    }
    acc.push(full);
  }
  return acc;
}

function gitDiffNames(baseline: string, paths: string[]): string {
  return execFileSync(
    "git",
    ["diff", "--name-only", baseline, "--", ...paths],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();
}

// TEST A — target Travel modes complete, no duplicates
{
  assert.deepEqual([...TARGET_TRAVEL_TRANSPORT_MODES], [
    "walking",
    "bicycle",
    "ebike",
    "scooter",
    "motorbike",
    "car",
    "subway",
    "bus",
    "train",
    "flight",
    "ferry",
    "passenger_boat",
    "private_boat",
  ]);
  assert.ok(unique(TARGET_TRAVEL_TRANSPORT_MODES));
}

// TEST B — target Deliver modes complete, no duplicates
{
  assert.deepEqual([...TARGET_DELIVER_TRANSPORT_MODES], [
    "cargo_van",
    "light_truck",
    "box_truck",
    "trailer",
    "cargo_boat",
    "private_cargo_boat",
    "other_cargo_vehicle",
  ]);
  assert.ok(unique(TARGET_DELIVER_TRANSPORT_MODES));
}

// TEST C — legacy van readable, not a V2 Travel mode
{
  assert.ok(isLegacyReadableTransportMode(LEGACY_VAN));
  assert.equal(TARGET_TRAVEL_TRANSPORT_MODES.includes("van" as never), false);
  assert.equal(isModeAllowedForLane(LEGACY_VAN, "travel"), false);
  assert.equal(isModeAllowedForLane(LEGACY_VAN, "deliver"), false);
  const van = getTransportPolicy(LEGACY_VAN);
  assert.ok(van);
  assert.equal(van.legacyReadable, true);
  assert.equal(van.allowsNewPost, false);
  assert.equal(van.lane, "deliver");
  assert.equal(suggestedMigrationTarget(LEGACY_VAN), LEGACY_VAN_SUGGESTED_TARGET);
  assert.ok((TRANSPORT_MODES as readonly string[]).includes("van"));
}

// TEST D — car shows people capacity, max 4
{
  const car = getTransportPolicy("car");
  assert.ok(car);
  assert.equal(car.showsPeopleCapacity, true);
  assert.equal(car.maxPeopleCapacity, 4);
  assert.equal(CAR_PEOPLE_CAPACITY_MAX, 4);
  const vis = getTransportFieldVisibility({
    lane: "travel",
    postType: "demand",
    mode: "car",
  });
  assert.ok(vis);
  assert.equal(vis.showPeopleCapacity, true);
}

// TEST E — walking / bicycle / ebike / scooter / motorbike hide people
{
  for (const mode of ["walking", "bicycle", "ebike", "scooter", "motorbike"] as const) {
    const vis = getTransportFieldVisibility({
      lane: "travel",
      postType: "provider",
      mode,
    });
    assert.ok(vis, mode);
    assert.equal(vis.showPeopleCapacity, false, mode);
    assert.equal(getTransportPolicy(mode)?.showsPeopleCapacity, false, mode);
  }
}

// TEST F — public transport: no people field, no platform seats
{
  for (const mode of ["subway", "bus", "train", "flight"] as const) {
    const policy = getTransportPolicy(mode);
    const vis = getTransportFieldVisibility({
      lane: "travel",
      postType: "demand",
      mode,
    });
    assert.ok(policy && vis, mode);
    assert.equal(policy.isPublicTransport, true, mode);
    assert.equal(vis.showPeopleCapacity, false, mode);
    assert.equal(vis.showPublicTransportNotice, true, mode);
    assert.equal(policy.maxPeopleCapacity, 0, mode);
  }
}

// TEST G — water passenger modes hide people
{
  for (const mode of ["ferry", "passenger_boat", "private_boat"] as const) {
    const vis = getTransportFieldVisibility({
      lane: "travel",
      postType: "demand",
      mode,
    });
    assert.ok(vis, mode);
    assert.equal(vis.showPeopleCapacity, false, mode);
    assert.equal(vis.showWaterTransportNotice, true, mode);
    assert.equal(vis.showPlate, false, mode);
  }
}

// TEST H — forged non-car peopleCapacity > 0 rejected
{
  for (const mode of ["walking", "motorbike", "subway", "ferry", "cargo_van"] as const) {
    const lane = mode === "cargo_van" ? "deliver" : "travel";
    const result = validateTransportCapability({
      lane,
      postType: "demand",
      mode,
      peopleCapacity: 1,
      smallItemTotal: 1,
      largeCargoTotal: mode === "cargo_van" ? 1 : 0,
    });
    assert.equal(result.ok, false, mode);
    if (!result.ok) {
      assert.equal(result.errorKey, "error.transport_people_not_allowed");
    }
  }
  assert.equal(
    validateTransportCapability({
      lane: "travel",
      postType: "demand",
      mode: "car",
      peopleCapacity: 2,
      smallItemTotal: 0,
    }).ok,
    true,
  );
}

// TEST I — Travel three valid combos; empty invalid
{
  const base = { lane: "travel" as const, postType: "demand" as const, mode: "car" };
  assert.equal(
    validateTransportCapability({ ...base, peopleCapacity: 1, smallItemTotal: 0 }).ok,
    true,
  );
  assert.equal(
    validateTransportCapability({ ...base, peopleCapacity: 2, smallItemTotal: 3 }).ok,
    true,
  );
  assert.equal(
    validateTransportCapability({
      lane: "travel",
      postType: "demand",
      mode: "walking",
      peopleCapacity: 0,
      smallItemTotal: 2,
    }).ok,
    true,
  );
  assert.equal(
    validateTransportCapability({ ...base, peopleCapacity: 0, smallItemTotal: 0 }).ok,
    false,
  );
}

// TEST J — Deliver cargoTotal=0 invalid
{
  assert.equal(
    validateTransportCapability({
      lane: "deliver",
      postType: "demand",
      mode: "cargo_van",
      largeCargoTotal: 0,
      escortPassengerCount: 1,
    }).ok,
    false,
  );
  assert.equal(
    validateTransportCapability({
      lane: "deliver",
      postType: "provider",
      mode: "cargo_van",
      largeCargoTotal: 0,
    }).ok,
    false,
  );
  assert.equal(
    validateTransportCapability({
      lane: "deliver",
      postType: "demand",
      mode: "cargo_van",
      largeCargoTotal: 1,
      escortPassengerCount: 0,
    }).ok,
    true,
  );
}

// TEST K — Deliver escortPassengerCount only 0/1
{
  const ok0 = validateTransportCapability({
    lane: "deliver",
    postType: "demand",
    mode: "light_truck",
    largeCargoTotal: 2,
    escortPassengerCount: 0,
  });
  const ok1 = validateTransportCapability({
    lane: "deliver",
    postType: "demand",
    mode: "light_truck",
    largeCargoTotal: 2,
    escortPassengerCount: 1,
  });
  const bad2 = validateTransportCapability({
    lane: "deliver",
    postType: "demand",
    mode: "light_truck",
    largeCargoTotal: 2,
    escortPassengerCount: 2,
  });
  assert.equal(ok0.ok, true);
  assert.equal(ok1.ok, true);
  assert.equal(bad2.ok, false);
}

// TEST L — Deliver Provider never shows generic peopleCapacity
{
  for (const mode of TARGET_DELIVER_TRANSPORT_MODES) {
    const vis = getTransportFieldVisibility({
      lane: "deliver",
      postType: "provider",
      mode,
    });
    assert.ok(vis, mode);
    assert.equal(vis.showPeopleCapacity, false, mode);
    assert.equal(vis.showEscortPassenger, false, mode);
  }
  const demand = getTransportFieldVisibility({
    lane: "deliver",
    postType: "demand",
    mode: "cargo_van",
  });
  assert.equal(demand?.showPeopleCapacity, false);
  assert.equal(demand?.showEscortPassenger, true);
}

// TEST M — motor vehicles show plate; water craft do not
{
  for (const mode of ["car", "motorbike", "cargo_van", "light_truck"] as const) {
    const lane = mode === "car" || mode === "motorbike" ? "travel" : "deliver";
    const vis = getTransportFieldVisibility({
      lane,
      postType: "provider",
      mode,
    });
    assert.equal(vis?.showPlate, true, mode);
    assert.equal(vis?.showWaterTransportNotice, false, mode);
  }
  for (const mode of [
    "ferry",
    "passenger_boat",
    "private_boat",
    "cargo_boat",
    "private_cargo_boat",
  ] as const) {
    const lane = mode.includes("cargo") ? "deliver" : "travel";
    const vis = getTransportFieldVisibility({
      lane,
      postType: "provider",
      mode,
    });
    assert.equal(vis?.showPlate, false, mode);
    assert.equal(vis?.showWaterTransportNotice, true, mode);
  }
}

// TEST N — safety always includes the three public modules
{
  const modules = resolveSafetyModules({ category: "travel" });
  for (const required of ALWAYS_ON_SAFETY_MODULES) {
    assert.ok(modules.includes(required), required);
  }
  assert.ok(modules.includes("platform_boundary"));
  assert.ok(modules.includes("payment_anti_scam"));
  assert.ok(modules.includes("unlisted_risk_catchall"));
}

// TEST O — people → passenger safety
{
  const modules = resolveSafetyModules({
    category: "travel",
    peopleCount: 2,
    transportMode: "car",
  });
  assert.ok(modules.includes("passenger_identity_vehicle"));
}

// TEST P — Travel items → small-item handover
{
  const modules = resolveSafetyModules({
    category: "travel",
    lane: "travel",
    peopleCount: 0,
    travelItemTotal: 2,
    transportMode: "bicycle",
  });
  assert.ok(modules.includes("small_item_handover"));
  assert.equal(modules.includes("large_item_handover"), false);
}

// TEST Q — Deliver → large-item handover
{
  const modules = resolveSafetyModules({
    category: "deliver",
    transportMode: "cargo_van",
    escortPassengerCount: 0,
  });
  assert.ok(modules.includes("large_item_handover"));
}

// TEST R — Deliver + escort → escort safety
{
  const modules = resolveSafetyModules({
    category: "deliver",
    escortPassengerCount: 1,
    transportMode: "box_truck",
  });
  assert.ok(modules.includes("escort_passenger"));
  assert.ok(modules.includes("large_item_handover"));
}

// TEST S — public transport and water compose the right modules
{
  const transit = resolveSafetyModules({
    category: "travel",
    transportMode: "subway",
    travelItemTotal: 1,
  });
  assert.ok(transit.includes("public_transport_rules"));
  assert.equal(transit.includes("water_transport_rules"), false);

  const water = resolveSafetyModules({
    category: "travel",
    transportMode: "ferry",
    peopleCount: 0,
    travelItemTotal: 1,
  });
  assert.ok(water.includes("water_transport_rules"));
  assert.ok(water.includes("public_transport_rules"));

  const cargoBoat = resolveSafetyModules({
    category: "deliver",
    transportMode: "cargo_boat",
  });
  assert.ok(cargoBoat.includes("water_transport_rules"));
  assert.ok(cargoBoat.includes("large_item_handover"));
}

// TEST T — buy / onsite / errand compose matching help modules
{
  assert.ok(
    resolveSafetyModules({ category: "buy" }).includes("purchase_help"),
  );
  assert.ok(
    resolveSafetyModules({ category: "onsite" }).includes("onsite_help"),
  );
  assert.ok(
    resolveSafetyModules({ category: "errand" }).includes("errand_help"),
  );
}

// TEST U — policy functions have no browser user / contact / private data
{
  for (const src of [policySrc, safetySrc]) {
    assert.equal(src.includes("user_id"), false);
    assert.equal(src.includes("applicant_user_id"), false);
    assert.equal(src.includes("raw_phone"), false);
    assert.equal(src.includes("normalized_phone"), false);
    assert.equal(src.includes("raw_license_plate"), false);
    assert.equal(src.includes("service_address"), false);
    assert.equal(src.includes("origin_gps"), false);
    assert.equal(src.includes("window."), false);
    assert.equal(src.includes("localStorage"), false);
    assert.equal(/fetch\s*\(/.test(src), false);
  }
  assert.equal(PAYMENT_POLICY_V1.platformCollects, false);
  assert.equal(PAYMENT_POLICY_V1.escrow, false);
  assert.equal(SAFETY_COPY_KEYS.unlisted_risk_catchall, "safety.unlistedRiskCatchall");
}

// TEST V — this round does not wire production PostCard / homepage / publish
{
  const production = [
    "src/components/hall/PostCard.tsx",
    "src/app/[locale]/page.tsx",
    "src/components/home/PublishBottomSheet.tsx",
    "src/components/post-form/DeliverTravelFields.tsx",
    "src/components/home/HomeConsole.tsx",
    "src/app/[locale]/posts/[id]/page.tsx",
  ];
  for (const file of production) {
    const src = read(file);
    assert.equal(src.includes("transportPolicy"), false, file);
    assert.equal(src.includes("safetyPolicy"), false, file);
    assert.equal(src.includes("MatchRequestSheet"), false, file);
    assert.equal(src.includes("transportPolicy.travelTitle"), false, file);
  }
}

// TEST W — new policy files have no fetch / API / RPC / DB write
{
  for (const src of [policySrc, safetySrc]) {
    assert.equal(src.includes("createClient"), false);
    assert.equal(/\.rpc\(/.test(src), false);
    assert.equal(src.includes("from(\"posts\")"), false);
    assert.equal(src.includes("match_requests"), false);
  }
}

// TEST X — confirm_match still frozen
{
  assert.ok(freezeSrc.includes("error.matching_temporarily_unavailable"));
  assert.ok(matchRoute.includes("freezeLegacyDirectMatchIntercept"));
  assert.equal(actionsSrc.includes("confirm_match"), false);
  assert.equal(policySrc.includes("confirm_match"), false);
  assert.equal(safetySrc.includes("confirm_match"), false);
}

// TEST Y — migration / init.sql / public_posts_safe unchanged vs 6.7B baseline
{
  const changed = gitDiffNames(PHASE_67B_BASELINE, [
    "supabase/init.sql",
    "supabase/migrations",
    "src/lib/posts/publicPostSelect.ts",
    "src/lib/matching/applicationPayload.ts",
    "src/lib/post-fee.ts",
    "src/lib/posts.ts",
    "src/lib/types.ts",
  ]);
  assert.equal(
    changed,
    "",
    `protected paths changed vs 6.7B baseline: ${changed}`,
  );
  assert.ok(typesSrc.includes('"van"'));
  assert.ok(postsSrc.includes('"van"'));
  assert.ok(payloadSrc.includes("MATCH_REQUEST_TRAVEL_SEATS_MIN"));
}

assert.ok(inventory.includes("消灭散落和互相矛盾的业务规则"));
assert.ok(inventory.includes("6.7B.1B"));
assert.ok(zh.includes("顺路捎人或捎小件"));
assert.ok(en.includes("Give a lift to people or small items"));
assert.ok(sr.includes("Usput povedi ljude ili sitne stvari"));
assert.equal(sr.includes("TODO"), false);
assert.ok(zh.includes("无法列举所有风险"));
assert.ok(sr.includes("ne mogu da navedu sve rizike"));

const runtimeFiles = walkRuntimeTs(join(repoRoot, "src"));
for (const file of runtimeFiles) {
  if (file.includes("transportPolicy.ts") || file.includes("safetyPolicy.ts")) {
    continue;
  }
  const src = readFileSync(file, "utf8");
  if (
    file.endsWith("PostCard.tsx") ||
    file.endsWith("page.tsx") ||
    file.endsWith("PublishBottomSheet.tsx")
  ) {
    assert.equal(
      src.includes("@/lib/transport/transportPolicy"),
      false,
      file,
    );
  }
}

console.log("transportPolicy.test.ts: ok");
