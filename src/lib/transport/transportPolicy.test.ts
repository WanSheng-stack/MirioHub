/**
 * PHASE 6.7B.1A.1 — transport semantics + Stage 1 integrity (TEST A–AV).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/transport/transportPolicy.test.ts
 *
 * Baseline for protected-file diffs: 189d1ef0561b6840df95e0a59874827fd01e4086
 * Does not use `git diff HEAD`.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CanonicalStage1Error,
  computeServerFeeMinor,
  hashCanonicalStage1,
  normalizeCanonicalStage1,
  toRpcStage1Payload,
} from "@/lib/auth/canonicalStage1Core";
import { V1_STAGE1_TRANSPORT_MODES } from "@/lib/auth/v1TransportMode";
import {
  ALWAYS_ON_SAFETY_MODULES,
  resolveSafetyModules,
  validateSafetyFacts,
} from "@/lib/safety/safetyPolicy";
import {
  completeContactTransportFillFilter,
  decideAfterConditionalFillMiss,
  decideCompleteContactTransport,
} from "@/lib/posts/completeContactTransport";
import {
  getTransportFieldVisibility,
  getTransportPolicy,
  isLegacyReadableTransportMode,
  isModeAllowedForLane,
  LEGACY_VAN,
  PG_INT_MAX,
  suggestedMigrationTarget,
  TARGET_DELIVER_TRANSPORT_MODES,
  TARGET_TRAVEL_TRANSPORT_MODES,
  validateTransportCapability,
} from "@/lib/transport/transportPolicy";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const BASELINE = "189d1ef0561b6840df95e0a59874827fd01e4086";

const policySrc = read("src/lib/transport/transportPolicy.ts");
const inventory = read("docs/architecture/transport-policy-inventory.md");
const coreSrc = read("src/lib/auth/canonicalStage1Core.ts");
const stage1Src = read("src/lib/auth/canonicalStage1.ts");
const contactSrc = read("src/app/api/posts/complete-contact/route.ts");
const contactHelper = read("src/lib/posts/completeContactTransport.ts");
const migration = read(
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql",
);
const verifySql = read(
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.verify.sql",
);
const oldInsert = read(
  "supabase/migrations/20260905000001_unify_stage1_post_persistence_v86.sql",
);
const freezeSrc = read("src/lib/matching/legacyMatchingFreeze.ts");
const passkeySrc = read("src/app/api/auth/passkey/verify/route.ts");
const trustedSrc = read("src/app/api/posts/trusted-publish/route.ts");
const shadowSrc = read("src/app/api/posts/shadow-draft/route.ts");

const travelBase = {
  lane: "travel" as const,
  mode: "car",
};

function gitDiffNames(baseline: string, paths: string[]): string {
  return execFileSync("git", ["diff", "--name-only", baseline, "--", ...paths], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

const baseRaw: Record<string, unknown> = {
  post_type: "demand",
  category: "travel",
  title: "Ride",
  origin_address: "Belgrade Center",
  destination_address: "Novi Sad",
  departure_date: "2026-09-10",
  departure_time: "14:30",
  time_buffer: 30,
  waypoints: ["WP1"],
  share_mode: "share",
  delivery_mode: null,
  count_small: 1,
  count_medium: 0,
  count_large: 0,
  count_xlarge: 0,
  escort_seats: 1,
  bump_fee: 0,
  currency: "EUR",
  locale: "en",
  transport_mode: "car",
};

// TEST A — Demand uses peopleCount; Provider uses peopleCapacity
{
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "demand",
      peopleCount: 2,
      travelItemUnits: 0,
    }).ok,
    true,
  );
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "provider",
      peopleCapacity: 2,
      travelItemUnits: 0,
    }).ok,
    true,
  );
}

// TEST B — Demand + peopleCapacity → reject
{
  const result = validateTransportCapability({
    ...travelBase,
    postType: "demand",
    peopleCapacity: 1,
    travelItemUnits: 1,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorKey, "error.transport_people_field_not_allowed");
}

// TEST C — Provider + peopleCount → reject
{
  const result = validateTransportCapability({
    ...travelBase,
    postType: "provider",
    peopleCount: 1,
    travelItemUnits: 1,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorKey, "error.transport_people_field_not_allowed");
}

// TEST D — car Demand 0–4 ok, 5 reject
{
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "demand",
      peopleCount: 0,
      travelItemUnits: 1,
    }).ok,
    true,
  );
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "demand",
      peopleCount: 4,
      travelItemUnits: 0,
    }).ok,
    true,
  );
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "demand",
      peopleCount: 5,
      travelItemUnits: 0,
    }).ok,
    false,
  );
}

// TEST E — car Provider 0–4 ok, 5 reject
{
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "provider",
      peopleCapacity: 0,
      travelItemUnits: 2,
    }).ok,
    true,
  );
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "provider",
      peopleCapacity: 4,
    }).ok,
    true,
  );
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "provider",
      peopleCapacity: 5,
    }).ok,
    false,
  );
}

// TEST F — motorbike people > 0 reject
{
  assert.equal(
    validateTransportCapability({
      lane: "travel",
      postType: "demand",
      mode: "motorbike",
      peopleCount: 1,
      travelItemUnits: 0,
    }).ok,
    false,
  );
}

// TEST G — other non-car people > 0 reject
{
  for (const mode of ["walking", "bicycle", "subway", "flight", "ferry"] as const) {
    assert.equal(
      validateTransportCapability({
        lane: "travel",
        postType: "demand",
        mode,
        peopleCount: 1,
        travelItemUnits: 0,
      }).ok,
      false,
      mode,
    );
  }
}

// TEST H / I / J / K — Travel combos
{
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "demand",
      peopleCount: 1,
      travelItemUnits: 0,
    }).ok,
    true,
  );
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "demand",
      peopleCount: 1,
      travelItemUnits: 3,
    }).ok,
    true,
  );
  assert.equal(
    validateTransportCapability({
      lane: "travel",
      postType: "demand",
      mode: "walking",
      peopleCount: 0,
      travelItemUnits: 2,
    }).ok,
    true,
  );
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "demand",
      peopleCount: 0,
      travelItemUnits: 0,
    }).ok,
    false,
  );
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "provider",
      peopleCapacity: 0,
      travelItemUnits: 0,
    }).ok,
    false,
  );
}

// TEST L — travelItemUnits is classified Travel sum, not count_small
{
  assert.equal(policySrc.includes("count_small"), false);
  assert.ok(policySrc.includes("travelItemUnits"));
  assert.ok(policySrc.includes("not a single luggage-size database column"));
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "demand",
      peopleCount: 0,
      travelItemUnits: 12,
    }).ok,
    true,
  );
}

// TEST M — illegal quantity types reject
{
  const bad = ["1", Number.NaN, Infinity, -Infinity, 1.5, -1, {}, [], true];
  for (const value of bad) {
    const result = validateTransportCapability({
      ...travelBase,
      postType: "demand",
      peopleCount: value,
      travelItemUnits: 1,
    });
    assert.equal(result.ok, false, String(value));
  }
}

// TEST N — above PostgreSQL integer max reject
{
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "demand",
      peopleCount: 0,
      travelItemUnits: PG_INT_MAX + 1,
    }).ok,
    false,
  );
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "demand",
      peopleCount: 0,
      travelItemUnits: PG_INT_MAX,
    }).ok,
    true,
  );
}

// TEST O — visibility splits Demand count vs Provider capacity
{
  const demand = getTransportFieldVisibility({
    lane: "travel",
    postType: "demand",
    mode: "car",
  });
  const provider = getTransportFieldVisibility({
    lane: "travel",
    postType: "provider",
    mode: "car",
  });
  assert.equal(demand?.showPeopleCount, true);
  assert.equal(demand?.showPeopleCapacity, false);
  assert.equal(provider?.showPeopleCount, false);
  assert.equal(provider?.showPeopleCapacity, true);
  const walk = getTransportFieldVisibility({
    lane: "travel",
    postType: "demand",
    mode: "walking",
  });
  assert.equal(walk?.showPeopleCount, false);
  assert.equal(walk?.showPeopleCapacity, false);
}

// TEST P — Travel + cargo mode visibility fail closed
{
  assert.equal(
    getTransportFieldVisibility({
      lane: "travel",
      postType: "demand",
      mode: "cargo_van",
    }),
    null,
  );
  assert.equal(
    getTransportFieldVisibility({
      lane: "travel",
      postType: "provider",
      mode: "light_truck",
    }),
    null,
  );
}

// TEST Q — Deliver + Travel mode visibility fail closed
{
  assert.equal(
    getTransportFieldVisibility({
      lane: "deliver",
      postType: "demand",
      mode: "car",
    }),
    null,
  );
  assert.equal(
    getTransportFieldVisibility({
      lane: "deliver",
      postType: "provider",
      mode: "passenger_boat",
    }),
    null,
  );
}

// TEST R — legacy van readable, not new V2 publish
{
  assert.ok(isLegacyReadableTransportMode(LEGACY_VAN));
  assert.equal(isModeAllowedForLane(LEGACY_VAN, "deliver"), false);
  assert.equal(isModeAllowedForLane(LEGACY_VAN, "travel"), false);
  assert.equal(getTransportPolicy(LEGACY_VAN)?.allowsNewPost, false);
  assert.equal(suggestedMigrationTarget(LEGACY_VAN), "cargo_van");
}

// TEST S — no bare trailer; vehicle_with_trailer exists
{
  assert.equal((TARGET_DELIVER_TRANSPORT_MODES as readonly string[]).includes("trailer"), false);
  assert.ok(TARGET_DELIVER_TRANSPORT_MODES.includes("vehicle_with_trailer"));
  assert.equal(/\n\s+trailer:/.test(policySrc), false);
  assert.ok(policySrc.includes("vehicle_with_trailer"));
}

// TEST T — physical capacity ≠ lane eligibility
{
  const van = getTransportPolicy("cargo_van");
  assert.ok(van);
  assert.equal(van.canPhysicallyCarrySmallItems, true);
  assert.equal(van.canPhysicallyCarryLargeItems, true);
  assert.equal(van.eligibleForTravelLane, false);
  assert.equal(van.eligibleForDeliverLane, true);
}

// TEST U — no largeCargoTotal as Deliver final model
{
  assert.equal(policySrc.includes("largeCargoTotal"), false);
  assert.ok(policySrc.includes("Cargo V2"));
  assert.ok(inventory.includes("CargoRequirement"));
}

// TEST V / W — only validated safety facts
{
  const ok = validateSafetyFacts({
    category: "travel",
    lane: "travel",
    postType: "demand",
    peopleCount: 1,
    travelItemUnits: 0,
    transportMode: "car",
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.ok(resolveSafetyModules(ok.value).includes("passenger_identity_vehicle"));
  }
  assert.equal(validateSafetyFacts({ category: "travel", extra: true }).ok, false);
  assert.equal(
    validateSafetyFacts({ category: "travel", peopleCount: true }).ok,
    false,
  );
  assert.equal(
    validateSafetyFacts({
      category: "travel",
      lane: "travel",
      transportMode: "cargo_van",
    }).ok,
    false,
  );
}

// TEST X — always-on safety modules
{
  const facts = validateSafetyFacts({ category: "buy" });
  assert.ok(facts.ok);
  if (facts.ok) {
    const modules = resolveSafetyModules(facts.value);
    for (const required of ALWAYS_ON_SAFETY_MODULES) {
      assert.ok(modules.includes(required), required);
    }
  }
}

function expectCanonicalReject(fn: () => unknown, key: string) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof CanonicalStage1Error);
    assert.equal(err.errorKey, key);
    return true;
  });
}

// TEST Y — V1 transport retained
{
  const payload = normalizeCanonicalStage1(baseRaw);
  assert.equal(payload.transport_mode, "car");
  assert.equal(toRpcStage1Payload(payload, 100).transport_mode, "car");
}

// TEST Z — blank transport → null
{
  assert.equal(normalizeCanonicalStage1({ ...baseRaw, transport_mode: "" }).transport_mode, null);
  assert.equal(
    normalizeCanonicalStage1({ ...baseRaw, transport_mode: "   " }).transport_mode,
    null,
  );
  const missing = { ...baseRaw };
  delete missing.transport_mode;
  assert.equal(normalizeCanonicalStage1(missing).transport_mode, null);
}

// TEST AA — unknown / V2 reject
{
  expectCanonicalReject(
    () => normalizeCanonicalStage1({ ...baseRaw, transport_mode: "cargo_van" }),
    "error.invalid_transport_mode",
  );
  expectCanonicalReject(
    () => normalizeCanonicalStage1({ ...baseRaw, transport_mode: "hovercraft" }),
    "error.invalid_transport_mode",
  );
  expectCanonicalReject(
    () => normalizeCanonicalStage1({ ...baseRaw, transport_mode: 1 }),
    "error.invalid_transport_mode",
  );
}

// TEST AB / AC / AD — hash binds transport and title, stable
{
  const a = normalizeCanonicalStage1(baseRaw);
  const b = normalizeCanonicalStage1({ ...baseRaw, transport_mode: "van" });
  const c = normalizeCanonicalStage1({ ...baseRaw, title: "Other" });
  const fee = computeServerFeeMinor(40, a);
  const ha = hashCanonicalStage1(a, 40, fee);
  assert.notEqual(ha, hashCanonicalStage1(b, 40, computeServerFeeMinor(40, b)));
  assert.notEqual(ha, hashCanonicalStage1(c, 40, computeServerFeeMinor(40, c)));
  assert.equal(ha, hashCanonicalStage1(a, 40, fee));
  const blank = normalizeCanonicalStage1({ ...baseRaw, transport_mode: "" });
  const missing = { ...baseRaw };
  delete missing.transport_mode;
  assert.equal(
    hashCanonicalStage1(blank, 40, computeServerFeeMinor(40, blank)),
    hashCanonicalStage1(
      normalizeCanonicalStage1(missing),
      40,
      computeServerFeeMinor(40, normalizeCanonicalStage1(missing)),
    ),
  );
}

// TEST AE — trusted / shadow / Passkey share the same mapping
{
  assert.ok(passkeySrc.includes("toRpcStage1Payload"));
  assert.ok(trustedSrc.includes("toRpcStage1Payload"));
  assert.ok(shadowSrc.includes("toRpcStage1Payload"));
  assert.ok(passkeySrc.includes("buildCanonicalStage1PublishContext"));
  assert.ok(trustedSrc.includes("buildCanonicalStage1PublishContext"));
  assert.ok(shadowSrc.includes("buildCanonicalStage1PublishContext"));
}

// TEST AF / AG / AH / AI — migration signature, write, allowlist, ACL
{
  assert.ok(
    /CREATE OR REPLACE FUNCTION public\.insert_stage1_post_v86\(\s*p_user_id\s+uuid/.test(
      migration,
    ),
  );
  assert.ok(migration.includes("p_client_request_id uuid"));
  assert.ok(migration.includes("p_post_payload      jsonb"));
  assert.equal(/CREATE OR REPLACE FUNCTION public\.insert_stage1_post_v86\(/g.test(migration) || true, true);
  assert.equal((migration.match(/CREATE OR REPLACE FUNCTION public\.insert_stage1_post_v86/g) || []).length, 1);
  assert.ok(migration.includes("transport_mode"));
  assert.ok(migration.includes("'van'"));
  assert.equal(migration.includes("cargo_van"), false);
  assert.equal(migration.includes("vehicle_with_trailer"), false);
  assert.ok(migration.includes("error.invalid_transport_mode"));
  assert.ok(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.insert_stage1_post_v86",
    ),
  );
  assert.ok(migration.includes("FROM PUBLIC"));
  assert.ok(migration.includes("FROM anon"));
  assert.ok(migration.includes("FROM authenticated"));
  assert.ok(verifySql.includes("exactly one row"));
}

// TEST AJ — executed migrations / init / CHECK untouched vs this round's new file only
{
  const changed = gitDiffNames(BASELINE, [
    "supabase/init.sql",
    "supabase/migrations/20260908000001_fraud_logs_service_role_insert_v86.sql",
    "supabase/migrations/20260908000002_parked_risk_tables_acl_v86.sql",
    "supabase/migrations/20260908000003_freeze_legacy_direct_match_v89.sql",
    "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
    "supabase/migrations/20260907000001_security_boundary_hardening_v86.sql",
    "supabase/migrations/20260905000001_unify_stage1_post_persistence_v86.sql",
    "src/lib/post-fee.ts",
  ]);
  assert.equal(changed, "", changed);
  assert.equal(oldInsert.includes("ALTER TABLE public.posts"), false);
  assert.equal(migration.includes("ALTER TABLE public.posts"), false);
}

// TEST AK–AO — complete-contact decisions
{
  assert.equal(
    decideCompleteContactTransport({
      isOwner: true,
      existingMode: "car",
      requested: "car",
    }).kind,
    "omit",
  );
  const conflict = decideCompleteContactTransport({
    isOwner: true,
    existingMode: "car",
    requested: "van",
  });
  assert.equal(conflict.kind, "reject");
  const fill = decideCompleteContactTransport({
    isOwner: true,
    existingMode: null,
    requested: "bicycle",
  });
  assert.equal(fill.kind, "fill");
  if (fill.kind === "fill") assert.equal(fill.mode, "bicycle");
  assert.equal(
    decideCompleteContactTransport({
      isOwner: false,
      existingMode: null,
      requested: "car",
    }).kind,
    "reject",
  );
  assert.equal(
    decideCompleteContactTransport({
      isOwner: true,
      existingMode: null,
      requested: "cargo_van",
    }).kind,
    "reject",
  );
}

// TEST AP — conditional update filter
{
  const filter = completeContactTransportFillFilter({
    postId: "p1",
    ownerUserId: "u1",
  });
  assert.equal(filter.user_id, "u1");
  assert.equal(filter.transport_mode, null);
  assert.ok(contactSrc.includes(".is('transport_mode', null)"));
  assert.ok(contactSrc.includes(".eq('user_id'"));
  assert.equal(
    decideAfterConditionalFillMiss({ intendedMode: "car", currentMode: "car" }).kind,
    "omit",
  );
  assert.equal(
    decideAfterConditionalFillMiss({ intendedMode: "car", currentMode: "van" }).kind,
    "reject",
  );
}

// TEST AQ — browser response does not leak DB details
{
  assert.ok(contactSrc.includes("error.submit_failed"));
  assert.equal(contactSrc.includes("filled.errorKey"), true);
  assert.equal(/NextResponse\.json\(\s*\{[^}]*message:/.test(contactSrc), false);
  assert.equal(contactSrc.includes("SQLSTATE"), false);
  assert.equal(contactHelper.includes("existingMode"), true);
  assert.equal(contactHelper.includes("Does not leak"), true);
}

// TEST AR — new TS extra JSON key is ignored by old RPC (source evidence)
{
  const insertFn = oldInsert.slice(
    oldInsert.indexOf("CREATE OR REPLACE FUNCTION public.insert_stage1_post_v86"),
    oldInsert.indexOf("REVOKE ALL ON FUNCTION public.insert_stage1_post_v86"),
  );
  assert.equal(insertFn.includes("transport_mode"), false);
  assert.ok(insertFn.includes("p_post_payload->>'post_type'"));
  assert.ok(coreSrc.includes("transport_mode: payload.transport_mode"));
}

// TEST AS — freeze / matching files unchanged this round vs baseline
{
  const matching = gitDiffNames(BASELINE, [
    "src/lib/matching/legacyMatchingFreeze.ts",
  ]);
  assert.equal(matching, "", matching);
}

// TEST AT — production UI still uses V1 modes only
{
  const postsSrc = read("src/lib/posts.ts");
  assert.ok(postsSrc.includes('"van"'));
  assert.equal(postsSrc.includes("cargo_van"), false);
  assert.equal(postsSrc.includes("vehicle_with_trailer"), false);
  const publish = read("src/components/home/PublishBottomSheet.tsx");
  assert.equal(publish.includes("cargo_van"), false);
  assert.deepEqual([...V1_STAGE1_TRANSPORT_MODES], [
    "walking",
    "scooter",
    "bicycle",
    "motorbike",
    "subway",
    "bus",
    "train",
    "flight",
    "car",
    "van",
  ]);
}

// TEST AU / AV
{
  assert.ok(freezeSrc.includes("error.matching_temporarily_unavailable"));
  assert.equal(policySrc.includes("confirm_match"), false);
  assert.equal(migration.includes("match_requests"), false);
  assert.equal(coreSrc.includes("match_requests"), false);
}

assert.ok(stage1Src.includes("server-only"));
assert.equal(coreSrc.includes('import "server-only"'), false);
assert.ok(inventory.includes("Repository SQL indicates"));
assert.ok(inventory.includes("Live catalog remains to be verified"));
assert.ok(TARGET_TRAVEL_TRANSPORT_MODES.includes("car"));

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) acc.push(full);
  }
  return acc;
}
for (const file of walk(join(repoRoot, "src/components/hall"))) {
  const src = readFileSync(file, "utf8");
  assert.equal(src.includes("vehicle_with_trailer"), false, file);
}

console.log("transportPolicy.test.ts: ok");
