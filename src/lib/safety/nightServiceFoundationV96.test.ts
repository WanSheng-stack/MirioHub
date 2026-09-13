/**
 * PHASE 6.7C.2A — v96 migration/verify structure tests.
 * Does not execute SQL or connect to Supabase.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/nightServiceFoundationV96.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractDoBlock,
  forbiddenSqlOps,
  transactionControls,
  verifyIsSingleResultSet,
} from "@/lib/matching/allocationEventFoundationV94.contract";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const PHASE_BASELINE = "6991f93a8192510ddcbb56e2e2b9f9e9c6216ed2";
const V96_REL =
  "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.sql";
const V96_VERIFY_REL =
  "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.verify.sql";

const FROZEN_PATHS = [
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql",
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql",
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.sql",
  "supabase/migrations/20260911000002_matching_allocation_event_foundation_v94.sql",
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql",
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.verify.sql",
  "supabase/migrations/20260911000003_v95_preapply_catalog_inventory.verify.sql",
  "supabase/init.sql",
  "src/lib/matching/v95PostV94Catalog.fixture.json",
  "src/components/matching/MatchRequestSheet.tsx",
  "src/lib/route/buildMatchHall.ts",
] as const;

const migration = read(V96_REL);
const verifySql = read(V96_VERIFY_REL);
const helper = read("src/lib/safety/nightServicePolicy.ts");
const payload = read("src/lib/post-payload.ts");
const ledger = read("docs/architecture/deferred-cleanup.md");
const guard = extractDoBlock(migration);

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", PHASE_BASELINE, "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

assert.deepEqual(transactionControls(migration), ["BEGIN;", "COMMIT;"]);
const firstDo = migration.search(/\bDO\s+\$\$/i);
const firstDoEnd = migration.indexOf("END $$;", firstDo);
const firstDdl = migration.search(/^ALTER TABLE|^CREATE TABLE/m);
assert.ok(firstDo > migration.indexOf("BEGIN;"));
assert.ok(firstDdl > firstDoEnd);

assert.equal(forbiddenSqlOps(guard).includes("EXCEPTION WHEN"), false);
assert.equal(/\bCASCADE\b/.test(migration), false);
assert.equal(/\bSET\s+ROLE\b/i.test(migration), false);
assert.equal(/\bALTER\s+OWNER\b/i.test(migration), false);
assert.equal(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(migration), false);
assert.equal(/CREATE\s+FUNCTION/i.test(migration), false);
assert.equal(/CREATE\s+TRIGGER/i.test(migration), false);
assert.equal(/CREATE\s+SEQUENCE/i.test(migration), false);
assert.equal(/CREATE\s+POLICY/i.test(migration), false);
assert.equal(/GRANT\s+/i.test(migration), false);
assert.equal(/ALTER TABLE[\s\S]{0,120}IF\s+(NOT\s+)?EXISTS/i.test(migration), false);
assert.equal(/CREATE TABLE[\s\S]{0,80}IF\s+(NOT\s+)?EXISTS/i.test(migration), false);

assert.ok(guard.includes("v96_guard: posts missing"));
assert.ok(guard.includes("match_request_revisions missing"));
assert.ok(guard.includes("current_revision_id missing"));
assert.ok(guard.includes("accepted_revision_id missing"));
assert.ok(guard.includes("matching_request_creation_enabled missing"));
assert.ok(guard.includes("create_match_request_v95 missing"));
assert.ok(guard.includes("inspect_match_request_v95 missing"));
assert.ok(guard.includes("read_match_request_candidate_snapshot_v95 missing"));
assert.ok(guard.includes("night_service_policies already exists"));
assert.equal(guard.includes("count(*) FROM public.posts"), false);

assert.ok(migration.includes("ADD COLUMN service_subtype text"));
assert.ok(migration.includes("ADD COLUMN origin_country_code text"));
assert.ok(migration.includes("ADD COLUMN origin_timezone text"));
assert.ok(migration.includes("ADD COLUMN night_policy_version integer"));
assert.ok(migration.includes("posts_service_subtype_category_check"));
assert.ok(migration.includes("'passenger'"));
assert.ok(migration.includes("'small_item_only'"));
assert.ok(migration.includes("'passenger_with_small_item'"));
assert.ok(migration.includes("'cargo_only'"));
assert.ok(migration.includes("'cargo_with_escort'"));
assert.ok(migration.includes("legacy_unknown"));

assert.ok(migration.includes("CREATE TABLE public.night_service_policies"));
assert.ok(migration.includes("night_service_policies_lookup_idx"));
assert.ok(migration.includes("night_service_policies_effective_idx"));
assert.ok(migration.includes("night_service_policies_country_default_open_uidx"));
assert.ok(migration.includes("region_code IS NULL AND effective_until IS NULL"));
assert.ok(migration.includes("ENABLE ROW LEVEL SECURITY"));
assert.equal(/FORCE ROW LEVEL SECURITY/i.test(migration), false);
assert.ok(migration.includes("REVOKE ALL ON TABLE public.night_service_policies FROM PUBLIC"));
assert.ok(migration.includes("FROM anon"));
assert.ok(migration.includes("FROM authenticated"));
assert.ok(migration.includes("FROM service_role"));
assert.ok(migration.includes("'RS'"));
assert.ok(migration.includes("'Europe/Belgrade'"));
assert.ok(migration.includes("TIME '22:00'"));
assert.ok(migration.includes("TIME '06:00'"));
assert.ok(migration.includes("false"));
assert.ok(helper.includes("Europe/Belgrade") || migration.includes("enabled=false") || migration.includes("enabled boolean NOT NULL DEFAULT false"));

assert.equal(verifyIsSingleResultSet(verifySql), true);
assert.ok(verifySql.includes("creation enabled still false"));
assert.ok(verifySql.includes("RS country default"));
assert.ok(verifySql.includes("no new rpc"));
assert.ok(verifySql.includes("v95 writer still present"));
assert.ok(verifySql.includes("v95 hash still extensions.digest"));
assert.equal(/pg_get_functiondef/i.test(verifySql), false);
assert.equal(/SELECT\s+public\.create_match_request_v95\s*\(/i.test(verifySql), false);
assert.equal(payload.includes("service_subtype?:"), false);
assert.ok(payload.includes("TRAVEL_SERVICE_SUBTYPES"));
assert.ok(ledger.includes("6.7C.2A"));
assert.ok(ledger.includes("night_service_policies"));
assert.ok(ledger.includes("v97"));

const v96Files = readdirSync(join(repoRoot, "supabase/migrations"))
  .filter((name) => name.includes("v96"))
  .sort();
assert.deepEqual(v96Files, [
  "20260913000001_service_subtype_night_safety_foundation_v96.sql",
  "20260913000001_service_subtype_night_safety_foundation_v96.verify.sql",
]);

for (const path of FROZEN_PATHS) {
  assert.equal(gitDiff(path), "", path);
}

console.log("nightServiceFoundationV96.test.ts: ok");
console.log("v96 SQL is not applied remotely.");
