/**
 * POSTGIS-RELOCATION-PREP.1 — v97 PostGIS extensions rebind structure tests.
 * Does not execute SQL or connect to Supabase.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/postgisExtensionsRebindV97.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractDoBlock,
  forbiddenSqlOps,
  sqlBody,
  transactionControls,
  verifyIsSingleResultSet,
} from "@/lib/matching/allocationEventFoundationV94.contract";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const FROZEN_HEAD = "6e1013704fb76b793b5f0fbe46915e446046fb9d";
const V97_REL =
  "supabase/migrations/20260914000001_postgis_extensions_rebind_v97.sql";
const V97_VERIFY_REL =
  "supabase/migrations/20260914000001_postgis_extensions_rebind_v97.verify.sql";

const FROZEN_PATHS = [
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql",
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql",
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.sql",
  "supabase/migrations/20260911000002_matching_allocation_event_foundation_v94.sql",
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql",
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.verify.sql",
  "supabase/migrations/20260911000003_v95_preapply_catalog_inventory.verify.sql",
  "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.sql",
  "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.verify.sql",
  "supabase/init.sql",
] as const;

const SNAPSHOT_RETURN_COLUMNS = [
  "admission_facts_hash text",
  "left_id uuid",
  "left_user_id uuid",
  "left_post_type text",
  "left_category text",
  "left_status text",
  "left_departure_date text",
  "left_departure_time_window text",
  "left_service_time_window text",
  "left_transport_mode text",
  "left_escort_seats integer",
  "left_max_companions integer",
  "left_count_small integer",
  "left_count_medium integer",
  "left_count_large integer",
  "left_count_xlarge integer",
  "left_origin_address text",
  "left_destination_address text",
  "left_waypoints jsonb",
  "left_origin_gps_ewkb text",
  "left_destination_gps_ewkb text",
  "left_origin_lat double precision",
  "left_origin_lng double precision",
  "left_destination_lat double precision",
  "left_destination_lng double precision",
  "right_id uuid",
  "right_user_id uuid",
  "right_post_type text",
  "right_category text",
  "right_status text",
  "right_departure_date text",
  "right_departure_time_window text",
  "right_service_time_window text",
  "right_transport_mode text",
  "right_escort_seats integer",
  "right_max_companions integer",
  "right_count_small integer",
  "right_count_medium integer",
  "right_count_large integer",
  "right_count_xlarge integer",
  "right_origin_address text",
  "right_destination_address text",
  "right_waypoints jsonb",
  "right_origin_gps_ewkb text",
  "right_destination_gps_ewkb text",
  "right_origin_lat double precision",
  "right_origin_lng double precision",
  "right_destination_lat double precision",
  "right_destination_lng double precision",
] as const;

const migration = read(V97_REL);
const verifySql = read(V97_VERIFY_REL);
const verifyBody = sqlBody(verifySql);
const guard = extractDoBlock(migration);
const ledger = read("docs/architecture/deferred-cleanup.md");
const nearbyOriginal = read("supabase/nearby_local_posts.sql");
const v95 = read(
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql",
);

function gitDiff(path: string, baseline = FROZEN_HEAD): string {
  return execFileSync("git", ["diff", baseline, "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function leftoverUnqualifiedPostgis(src: string): boolean {
  const stripped = src
    .replaceAll("extensions.st_", "")
    .replaceAll("public.st_", "");
  return /(^|[^a-z0-9_])st_[a-z0-9_]+/i.test(stripped);
}

function extractFunction(sql: string, name: string): string {
  const start = sql.search(
    new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\b`, "i"),
  );
  assert.ok(start >= 0, `missing function ${name}`);
  const tail = sql.slice(start);
  const dollar = tail.match(/AS \$([a-z]*)\$/i);
  assert.ok(dollar, `missing AS $tag$ for ${name}`);
  const closer = `\$${dollar[1]}\$;`;
  const end = tail.indexOf(closer, dollar.index ?? 0);
  assert.ok(end > 0, `missing closer for ${name}`);
  return tail.slice(0, end + closer.length);
}

function extractFunctionBody(fnSql: string): string {
  const dollar = fnSql.match(/AS \$([a-z]*)\$/i);
  assert.ok(dollar);
  const opener = `$${dollar[1]}$`;
  const start = fnSql.indexOf(opener);
  const end = fnSql.lastIndexOf(opener);
  assert.ok(start >= 0 && end > start);
  return fnSql.slice(start + opener.length, end);
}

function qualifyV95Postgis(src: string): string {
  return src
    .replaceAll("public.st_", "extensions.st_")
    .replaceAll("public.geometry", "extensions.geometry")
    .replaceAll("public.geography", "extensions.geography");
}

function qualifyNearbyPostgis(src: string): string {
  return src
    .replace(/(^|[^a-z0-9_.])st_/gi, "$1extensions.st_")
    .replaceAll("::geography", "::extensions.geography");
}

function compactSql(src: string): string {
  return src.replace(/\s+/g, " ").trim().toLowerCase();
}

function splitTopLevel(sql: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let inStr = false;
  let quote = "";
  let current = "";
  for (const ch of sql) {
    if (inStr) {
      current += ch;
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inStr = true;
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function selectList(sql: string): string[] {
  const match = sql.match(/^\s*SELECT\b([\s\S]+)$/i);
  assert.ok(match, `expected SELECT branch, got: ${sql.slice(0, 80)}`);
  return splitTopLevel(match[1]);
}

assert.deepEqual(transactionControls(migration), ["BEGIN;", "COMMIT;"]);
const firstDo = migration.search(/\bDO\s+\$\$/i);
const firstDoEnd = migration.indexOf("END $$;", firstDo);
const firstReplace = migration.search(/^CREATE OR REPLACE FUNCTION/m);
assert.ok(firstDo > migration.indexOf("BEGIN;"));
assert.ok(firstDoEnd > firstDo);
assert.ok(firstReplace > firstDoEnd, "guard must sit before first DDL");

assert.ok(guard.includes("v97_guard: postgis must be in extensions"));
assert.ok(guard.includes("v97_guard: extensions PostGIS types missing"));
assert.ok(guard.includes("v97_guard: public PostGIS types still present"));
assert.ok(guard.includes("v97_guard: facts helper identity missing"));
assert.ok(guard.includes("v97_guard: snapshot identity missing"));
assert.ok(guard.includes("v97_guard: nearby identity missing"));
assert.ok(guard.includes("v97_guard: overload or missing routine"));
assert.ok(
  guard.includes(
    "public.match_request_admission_post_facts_v95(uuid,uuid,text,text,text,date,text,text,text,integer,integer,integer,integer,integer,integer,text,text,jsonb,extensions.geography,extensions.geography)",
  ),
);
assert.ok(
  guard.includes("public.read_match_request_candidate_snapshot_v95(uuid,uuid)"),
);
assert.ok(
  guard.includes(
    "public.nearby_local_posts(double precision,double precision,integer)",
  ),
);
assert.equal(guard.includes("proname IN"), false);
assert.equal(forbiddenSqlOps(guard).includes("EXCEPTION WHEN"), false);
assert.equal(/\bCASCADE\b/.test(migration), false);
assert.equal(/\bSET\s+ROLE\b/i.test(migration), false);
assert.equal(/CREATE TABLE/i.test(migration), false);
assert.equal(/ALTER TABLE/i.test(migration), false);
assert.equal(/CREATE INDEX/i.test(migration), false);
assert.equal(/DROP INDEX/i.test(migration), false);
assert.equal(/GRANT\s+/i.test(migration), false);
assert.equal(/REVOKE\s+/i.test(migration), false);
assert.equal(/COMMENT ON/i.test(migration), false);
assert.equal(/CREATE SEQUENCE/i.test(migration), false);
assert.equal(/CREATE TRIGGER/i.test(migration), false);
assert.equal(/CREATE POLICY/i.test(migration), false);
assert.equal(/CREATE OR REPLACE FUNCTION public\.create_match_request_v95/i.test(migration), false);
assert.equal(
  /CREATE OR REPLACE FUNCTION public\.match_request_admission_facts_hash_v95/i.test(
    migration,
  ),
  false,
);

const replaced = [
  ...migration.matchAll(/^CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/gm),
].map((match) => match[1]);
assert.deepEqual(replaced, [
  "match_request_admission_post_facts_v95",
  "read_match_request_candidate_snapshot_v95",
  "nearby_local_posts",
]);
assert.ok(migration.includes("v97_post: leftover overload"));
assert.ok(migration.includes("SECURITY DEFINER"));
assert.ok(migration.includes("SECURITY INVOKER"));
assert.ok(migration.includes("SET search_path = pg_catalog, public"));
assert.ok(migration.includes("SET search_path = public"));
assert.ok(migration.includes("LANGUAGE sql"));
assert.ok(migration.includes("STABLE"));
assert.ok(migration.includes("RETURNS jsonb"));
assert.ok(migration.includes("RETURNS TABLE (id uuid, distance_m double precision)"));
assert.ok(migration.includes("extensions.geography"));
assert.ok(migration.includes("extensions.st_asewkb"));
assert.ok(migration.includes("extensions.st_x"));
assert.ok(migration.includes("extensions.st_y"));
assert.ok(migration.includes("extensions.st_distance"));
assert.ok(migration.includes("extensions.st_dwithin"));
assert.ok(migration.includes("extensions.st_setsrid"));
assert.ok(migration.includes("extensions.st_makepoint"));
assert.ok(guard.includes("to_regtype('public.geometry')"));
assert.ok(guard.includes("to_regtype('public.geography')"));
assert.equal(
  leftoverUnqualifiedPostgis("SELECT extensions.st_distance(a, b)"),
  false,
);
assert.equal(leftoverUnqualifiedPostgis("SELECT st_distance(a, b)"), true);
assert.equal(
  leftoverUnqualifiedPostgis("SELECT public.st_distance(a, b)"),
  false,
);
assert.equal(/public\.st_/i.test("SELECT public.st_distance(a, b)"), true);

const factsV97 = extractFunction(
  migration,
  "match_request_admission_post_facts_v95",
);
const snapV97 = extractFunction(
  migration,
  "read_match_request_candidate_snapshot_v95",
);
const nearbyV97 = extractFunction(migration, "nearby_local_posts");
const factsV95 = extractFunction(v95, "match_request_admission_post_facts_v95");
const snapV95 = extractFunction(
  v95,
  "read_match_request_candidate_snapshot_v95",
);

assert.ok(factsV97.includes("p_origin_gps extensions.geography"));
assert.ok(factsV97.includes("p_destination_gps extensions.geography"));
assert.ok(factsV97.includes("RETURNS jsonb"));
assert.ok(factsV97.includes("LANGUAGE sql"));
assert.ok(factsV97.includes("STABLE"));
assert.ok(factsV97.includes("SECURITY DEFINER"));
assert.ok(factsV97.includes("SET search_path = pg_catalog, public"));
assert.equal(compactSql(extractFunctionBody(factsV97)), compactSql(
  qualifyV95Postgis(extractFunctionBody(factsV95)),
));

assert.ok(snapV97.includes("SECURITY DEFINER"));
assert.ok(snapV97.includes("SET search_path = pg_catalog, public"));
assert.ok(snapV97.includes("STABLE"));
assert.ok(snapV97.includes("public.match_request_admission_facts_hash_v95"));
for (const column of SNAPSHOT_RETURN_COLUMNS) {
  assert.ok(snapV95.includes(column), column);
  assert.ok(snapV97.includes(column), column);
}
assert.equal(compactSql(extractFunctionBody(snapV97)), compactSql(
  qualifyV95Postgis(extractFunctionBody(snapV95)),
));

assert.ok(nearbyOriginal.includes("set search_path = public"));
assert.ok(nearbyOriginal.includes("security invoker"));
assert.ok(nearbyV97.includes("SECURITY INVOKER"));
assert.ok(nearbyV97.includes("SET search_path = public"));
assert.equal(nearbyV97.includes("pg_catalog, public"), false);
assert.ok(nearbyV97.includes("p_lng double precision"));
assert.ok(nearbyV97.includes("p_lat double precision"));
assert.ok(nearbyV97.includes("p_limit integer DEFAULT 60"));
assert.equal(compactSql(extractFunctionBody(nearbyV97)), compactSql(
  qualifyNearbyPostgis(extractFunctionBody(nearbyOriginal)),
));

assert.equal(verifyIsSingleResultSet(verifySql), true);
assert.ok(verifySql.includes("check_order"));
assert.ok(verifySql.includes("overall_pass"));
assert.ok(verifySql.includes("to_regprocedure"));
assert.ok(verifySql.includes("pg_get_function_identity_arguments"));
assert.ok(verifySql.includes("no leftover overloads"));
assert.ok(verifySql.includes("spatial_ref_sys extension member nonempty"));
assert.equal(verifySql.includes("8500"), false);
assert.ok(verifySql.includes("rows_nonempty"));
assert.ok(verifySql.includes("provolatile::text"));
assert.ok(verifySql.includes("relkind::text"));
assert.ok(verifySql.includes("grantee = 0"));
assert.ok(verifySql.includes("identity_args LIKE '%geography%'"));
assert.ok(verifySql.includes("replace(f.identity_args, ' ', '') = 'uuid,uuid'"));
assert.ok(verifySql.includes("'doubleprecision,doubleprecision,integer'"));
assert.equal(/array_to_string\([^)]*,\s*';'\)/.test(verifySql), false);
assert.equal(
  verifyBody
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length,
  1,
  "verify body must not embed semicolons inside literals",
);
assert.equal(/has_function_privilege\s*\(\s*0\b/.test(verifySql), false);
assert.equal(/has_table_privilege\s*\(\s*0\b/.test(verifySql), false);
assert.equal(/has_function_privilege\s*\(\s*'PUBLIC'/i.test(verifySql), false);
assert.ok(verifySql.includes("aclexplode"));
assert.ok(verifySql.includes("matching creation remains false"));
assert.ok(verifySql.includes("relation does not exist"));
assert.ok(verifySql.includes("replace(replace("));
assert.ok(verifySql.includes("NOT LIKE '%public.st_%'"));
assert.equal(/\(\^\\|\[\^a-z0-9_\.\]\)st_/i.test(verifySql), false);
assert.equal(/pg_get_functiondef/i.test(verifySql), false);
assert.equal(/SELECT\s+public\.create_match_request_v95\s*\(/i.test(verifySql), false);
assert.equal(/INSERT\b/i.test(verifyBody), false);
assert.equal(/UPDATE\b/i.test(verifyBody), false);
assert.equal(/DELETE\b/i.test(verifyBody), false);
assert.equal(/\bALTER\b/i.test(verifyBody), false);
assert.equal(/\bCREATE\b/i.test(verifyBody), false);
assert.equal(/\bDROP\b/i.test(verifyBody), false);
assert.equal(/\bGRANT\b/i.test(verifyBody), false);
assert.equal(/\bREVOKE\b/i.test(verifyBody), false);

assert.equal(
  leftoverUnqualifiedPostgis(
    "SELECT extensions.st_distance(a, b), public.geometry",
  ),
  false,
);
assert.equal(leftoverUnqualifiedPostgis("SELECT st_dwithin(a, b)"), true);
assert.equal(
  verifyIsSingleResultSet(
    "WITH x AS (SELECT 1 AS check_order) SELECT check_order, area, check_name, result, observed, expected, 'PASS' AS overall_pass FROM x",
  ),
  true,
);
assert.equal(
  verifyIsSingleResultSet(
    "WITH x AS (SELECT 1) SELECT check_order, area, check_name, result, observed, 'a; b' AS expected, 'PASS' AS overall_pass FROM x;",
  ),
  false,
  "embedded semicolon must fail single-statement detection",
);

const checksCte = verifyBody.match(
  /checks AS \(\s*([\s\S]*?)\n\)\s*SELECT check_order/i,
);
assert.ok(checksCte, "checks CTE must exist");
const unionBranches = checksCte[1]
  .split(/UNION ALL/i)
  .map((branch) => branch.trim())
  .filter((branch) => branch.length > 0);
assert.equal(unionBranches.length, 15);
for (const branch of unionBranches) {
  const columns = selectList(branch);
  assert.equal(columns.length, 6, branch.slice(0, 80));
}
assert.ok(unionBranches[0].includes("::integer"));
assert.ok(unionBranches[0].includes("::text"));

const finalSelect = verifyBody.match(
  /SELECT check_order, area, check_name, result, observed, expected,\s*CASE[\s\S]+overall_pass/i,
);
assert.ok(finalSelect);

assert.ok(ledger.includes("6.7C.1B.3A"));
assert.ok(ledger.includes("PostGIS"));
assert.ok(ledger.includes("v97"));
assert.ok(ledger.includes("not locked to 8500"));
assert.ok(ledger.includes("nonempty"));
assert.ok(ledger.includes("to_regprocedure"));
assert.ok(ledger.includes("Support has not been asked"));

const v97Files = readdirSync(join(repoRoot, "supabase/migrations"))
  .filter((name) => name.includes("v97") || name.includes("v98"))
  .sort();
assert.deepEqual(v97Files, [
  "20260914000001_postgis_extensions_rebind_v97.sql",
  "20260914000001_postgis_extensions_rebind_v97.verify.sql",
]);

for (const path of FROZEN_PATHS) {
  assert.equal(gitDiff(path), "", path);
}

console.log("postgisExtensionsRebindV97.test.ts: ok");
console.log("v97 SQL is not applied remotely.");
