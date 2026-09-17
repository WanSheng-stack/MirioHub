/**
 * PHASE 6.7C.2B — v98 Stage-1 publish subtype migration/verify structure.
 * Does not execute SQL or connect to Supabase.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/stage1PublishServiceSubtypeV98.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractDoBlock,
  transactionControls,
  verifyIsSingleResultSet,
} from "@/lib/matching/allocationEventFoundationV94.contract";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const V98_REL =
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.sql";
const V98_VERIFY_REL =
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.verify.sql";

const FROZEN = [
  "supabase/migrations/20260905000001_unify_stage1_post_persistence_v86.sql",
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql",
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql",
  "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.sql",
  "supabase/migrations/20260914000001_postgis_extensions_rebind_v97.sql",
  "supabase/migrations/20260914000001_postgis_extensions_rebind_v97.verify.sql",
  "supabase/init.sql",
] as const;

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

const migration = read(V98_REL);
const verifySql = read(V98_VERIFY_REL);
const passkey = read("src/app/api/auth/passkey/verify/route.ts");
const trusted = read("src/app/api/posts/trusted-publish/route.ts");
const shadow = read("src/app/api/posts/shadow-draft/route.ts");
const core = read("src/lib/auth/canonicalStage1Core.ts");
const ledger = read("docs/architecture/deferred-cleanup.md");

assert.ok(migration.startsWith("BEGIN;") || migration.includes("\nBEGIN;"));
assert.ok(migration.trimEnd().endsWith("COMMIT;"));
assert.equal(migration.includes("CREATE OR REPLACE FUNCTION"), false);
assert.ok(migration.includes("CREATE FUNCTION public.insert_stage1_post_v98"));
assert.ok(migration.includes("CREATE FUNCTION public.publish_active_post_idempotent_v98"));
assert.ok(migration.includes("CREATE FUNCTION public.create_shadow_draft_idempotent_v98"));
assert.ok(migration.includes("CREATE FUNCTION public.commit_phase3_business_idempotent_v98"));
assert.ok(migration.includes("service_subtype"));
assert.ok(migration.includes("error.invalid_service_subtype"));
assert.ok(migration.includes("error.browser_night_authority_rejected"));
assert.ok(migration.includes("origin_country_code"));
assert.ok(migration.includes("origin_timezone"));
assert.ok(migration.includes("night_policy_version"));
assert.ok(migration.includes("refuse re-apply"));
assert.ok(migration.includes("SET search_path TO 'pg_catalog', 'public', 'pg_temp'"));

const guard = extractDoBlock(migration);
assert.ok(guard.includes("insert_stage1_post_v98"));
assert.ok(guard.includes("posts.service_subtype missing"));

assert.deepEqual(transactionControls(migration), ["BEGIN;", "COMMIT;"]);

assert.ok(verifyIsSingleResultSet(verifySql));
assert.ok(verifySql.includes("check_order"));
assert.ok(verifySql.includes("overall_pass"));
assert.ok(verifySql.includes("One statement") || verifySql.includes("seven columns"));
const selectTail = verifySql.slice(verifySql.lastIndexOf("SELECT"));
assert.ok(selectTail.includes("check_order"));
assert.ok(selectTail.includes("area"));
assert.ok(selectTail.includes("check_name"));
assert.ok(selectTail.includes("result"));
assert.ok(selectTail.includes("observed"));
assert.ok(selectTail.includes("expected"));
assert.ok(selectTail.includes("overall_pass"));
assert.ok(
  verifySql.includes(") AS observed,"),
  "checks CTE first arm must alias observed for outer SELECT",
);
assert.ok(verifySql.includes("writes_subtype"));
assert.ok(verifySql.includes("rejects_browser_authority"));
assert.ok(verifySql.includes("has_target_transport_allowlist"));
assert.ok(verifySql.includes("requires_transport_nonempty"));
assert.ok(verifySql.includes("rejects_legacy_van_write"));
assert.ok(verifySql.includes("people_travel_car_only"));
assert.ok(verifySql.includes("cargo_escort_rejects_boats"));
assert.ok(verifySql.includes("passenger_zeros_counts"));
assert.ok(verifySql.includes("cargo_escort_demand_provider_split"));
assert.ok(verifySql.includes("matching_request_creation_enabled"));
assert.ok(verifySql.includes("night_service_policies"));
assert.ok(verifySql.includes("enabled=false") || verifySql.includes("enabled=false"));
assert.ok(verifySql.includes("insert_stage1_post_v86"));
assert.ok(verifySql.includes("nearby_local_posts"));
assert.ok(verifySql.includes("create_match_request_v95"));
assert.ok(verifySql.includes("TypeScript call-site"));
assert.equal(/pg_get_functiondef/i.test(verifySql), false);
assert.equal(/SELECT\s+public\.publish_active_post_idempotent_v98\s*\(/i.test(verifySql), false);
assert.ok(verifySql.includes("::text"));
assert.equal(/SELECT\s+p\.prosrc\b/i.test(verifySql), false);
assert.equal(/,\s*p\.prosrc\b/i.test(verifySql), false);

assert.ok(migration.includes("cargo_van"));
assert.ok(migration.includes("light_truck"));
assert.ok(migration.includes("box_truck"));
assert.ok(migration.includes("vehicle_with_trailer"));
assert.ok(migration.includes("other_cargo_vehicle"));
assert.ok(migration.includes("cargo_boat"));
assert.ok(migration.includes("ebike"));
assert.ok(migration.includes("ferry"));
assert.ok(migration.includes("error.transport_mode_required"));
assert.ok(migration.includes("error.illegal_transport_combo"));
assert.ok(migration.includes("posts_transport_mode_check"));
assert.ok(migration.includes("DROP CONSTRAINT posts_transport_mode_check"));
assert.equal(migration.includes("not uniquely identifiable"), false);
assert.equal(migration.includes("posts_max_companions_check"), false);
assert.ok(migration.includes("v_max_companions := NULL"));
assert.ok(migration.includes("'van'"));
assert.ok(migration.includes("v98_people_travel_car_only"));
assert.ok(migration.includes("v98_normalize_cargo_escort_demand_provider"));
assert.ok(core.includes("parsePublishTransportMode"));
assert.equal(core.includes("parseV1TransportMode"), false);

assert.ok(passkey.includes("commit_phase3_business_idempotent_v101"));
assert.ok(trusted.includes("publish_active_post_idempotent_v101"));
assert.ok(shadow.includes("create_shadow_draft_idempotent_v101"));
assert.equal(passkey.includes("commit_phase3_business_idempotent_v86"), false);
assert.equal(trusted.includes("publish_active_post_idempotent_v86"), false);
assert.equal(shadow.includes("create_shadow_draft_idempotent_v86"), false);
assert.equal(passkey.includes("commit_phase3_business_idempotent_v98"), false);
assert.equal(trusted.includes("publish_active_post_idempotent_v98"), false);
assert.equal(shadow.includes("create_shadow_draft_idempotent_v98"), false);

assert.ok(core.includes("service_subtype"));
assert.ok(core.includes("sst: payload.service_subtype"));
assert.ok(core.includes("assertNoBrowserNightAuthorityFields"));
assert.ok(core.includes("assertPublishSubtypeTransportLegal"));

assert.ok(ledger.includes("6.7C.2B") || ledger.includes("v98"));
assert.ok(ledger.includes("15/15 PASS") || ledger.includes("15/15"));
assert.ok(ledger.includes("v99") || ledger.includes("v99 or later"));

const v98Files = readdirSync(join(repoRoot, "supabase/migrations"))
  .filter((name) => name.includes("v98"))
  .sort();
assert.deepEqual(v98Files, [
  "20260915000001_stage1_publish_service_subtype_v98.sql",
  "20260915000001_stage1_publish_service_subtype_v98.verify.sql",
]);

for (const path of FROZEN) {
  assert.equal(gitDiff(path), "", path);
}

console.log("stage1PublishServiceSubtypeV98.test.ts: ok");
console.log("v98 SQL is not applied remotely.");
