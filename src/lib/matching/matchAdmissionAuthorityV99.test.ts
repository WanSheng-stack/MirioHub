/**
 * PHASE 6.7C.2C.1 / v99A — admission authority structure + pure hash helpers.
 * Does not execute SQL or connect to Supabase.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/matchAdmissionAuthorityV99.test.ts
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
import {
  ADMISSION_FACTS_FIELDS_V99,
  ADMISSION_SCHEMA_VERSION_V99,
  buildAdmissionPairFactsV99,
  buildAdmissionPostFactsV99,
  hashAdmissionFactsV99,
  hashAdmissionPairV99,
  type AdmissionPostFactsV99Input,
} from "@/lib/matching/matchAdmissionAuthorityV99";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const V99_REL =
  "supabase/migrations/20260916000001_match_admission_authority_v99.sql";
const V99_VERIFY_REL =
  "supabase/migrations/20260916000001_match_admission_authority_v99.verify.sql";

const FROZEN = [
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql",
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.verify.sql",
  "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.sql",
  "supabase/migrations/20260914000001_postgis_extensions_rebind_v97.sql",
  "supabase/migrations/20260914000001_postgis_extensions_rebind_v97.verify.sql",
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.sql",
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.verify.sql",
  "supabase/init.sql",
] as const;

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function dollarBody(sql: string, tag: string): string {
  const token = `$${tag}$`;
  const start = sql.indexOf(token);
  if (start < 0) return "";
  const end = sql.indexOf(token, start + token.length);
  if (end < 0) return "";
  return sql.slice(start + token.length, end);
}

const migration = read(V99_REL);
const verifySql = read(V99_VERIFY_REL);
const factsBody = dollarBody(migration, "facts");
const hashBody = dollarBody(migration, "hash");
const snapBody = dollarBody(migration, "snap");
const guard = extractDoBlock(migration);

// ── Migration structure ─────────────────────────────────────────────────────
assert.ok(migration.includes("\nBEGIN;") || migration.startsWith("BEGIN;"));
assert.ok(migration.trimEnd().endsWith("COMMIT;"));
assert.deepEqual(transactionControls(migration), ["BEGIN;", "COMMIT;"]);
assert.equal(migration.includes("CREATE OR REPLACE FUNCTION"), false);
assert.ok(migration.includes("CREATE FUNCTION public.match_request_admission_post_facts_v99"));
assert.ok(migration.includes("CREATE FUNCTION public.match_request_admission_facts_hash_v99"));
assert.ok(migration.includes("CREATE FUNCTION public.read_match_request_candidate_snapshot_v99"));
assert.equal(migration.includes("CREATE FUNCTION public.create_match_request_v99"), false);
assert.ok(guard.includes("already exists — refuse re-apply"));
assert.ok(guard.includes("create_match_request_v99 must not exist"));

assert.equal(migration.includes("public.geography"), false);
assert.equal(migration.includes("public.geometry"), false);
assert.equal(migration.includes("public.st_"), false);
assert.ok(migration.includes("extensions.geography"));
assert.ok(migration.includes("extensions.st_asewkb"));
assert.ok(migration.includes("extensions.digest"));
assert.ok(migration.includes("SET search_path TO 'pg_catalog', 'public', 'pg_temp'"));
assert.equal(/search_path[^\n]*extensions/i.test(migration), false);

assert.equal(factsBody.includes("public.posts"), false);
assert.ok(factsBody.includes("jsonb_build_object"));
assert.ok(factsBody.includes("'admission_schema_version', 99"));
for (const field of ADMISSION_FACTS_FIELDS_V99) {
  if (field === "admission_schema_version") continue;
  assert.ok(
    factsBody.includes(`'${field}'`),
    `facts jsonb_build_object missing ${field}`,
  );
}

assert.equal(hashBody.includes("public.posts"), false);
assert.ok(hashBody.includes("extensions.digest"));
assert.ok(hashBody.includes("convert_to(p_facts::text, 'UTF8')"));
assert.ok(hashBody.includes("'sha256'"));
assert.ok(hashBody.includes("'99'"));
assert.ok(hashBody.includes("jsonb_array_length(p_facts) IS DISTINCT FROM 2"));

assert.ok(snapBody.includes("WITH pair AS MATERIALIZED"));
assert.ok(snapBody.includes("decorated AS MATERIALIZED"));
assert.equal(snapBody.split("FROM public.posts").length - 1, 1);
assert.ok(snapBody.includes("jsonb_agg(d.fact ORDER BY d.id)"));
assert.ok(snapBody.includes("match_request_admission_facts_hash_v99"));
assert.ok(snapBody.includes("match_request_admission_post_facts_v99"));
assert.ok(snapBody.includes("p_left_post_id IS DISTINCT FROM p_right_post_id"));
assert.ok(snapBody.includes("(SELECT count(*) FROM decorated) = 2"));
assert.ok(snapBody.includes("l.service_subtype"));
assert.ok(snapBody.includes("r.service_subtype"));
assert.ok(snapBody.includes("l.origin_country_code"));
assert.ok(snapBody.includes("r.origin_timezone"));
assert.ok(snapBody.includes("l.night_policy_version"));
assert.ok(snapBody.includes("extensions.st_x"));
assert.ok(snapBody.includes("extensions.st_y"));
assert.equal(snapBody.includes("public.st_"), false);
assert.equal(snapBody.includes("night_service_policies"), false);
assert.equal(snapBody.includes("profiles"), false);

assert.ok(migration.includes("left_service_subtype text"));
assert.ok(migration.includes("right_night_policy_version integer"));
assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.match_request_admission_post_facts_v99"));
assert.ok(migration.includes("GRANT EXECUTE ON FUNCTION public.read_match_request_candidate_snapshot_v99"));

// ── Verify structure ────────────────────────────────────────────────────────
assert.ok(verifyIsSingleResultSet(verifySql));
assert.ok(verifySql.includes(") AS observed,"));
assert.ok(verifySql.includes("overall_pass"));
assert.ok(verifySql.includes("facts_v99 identity"));
assert.ok(verifySql.includes("snapshot_v99 atomic shape"));
assert.ok(verifySql.includes("v95 five functions retained"));
assert.ok(verifySql.includes("create_match_request_v99 absent"));
assert.ok(verifySql.includes("creation remains false"));
assert.ok(verifySql.includes("night RS seed disabled"));
assert.equal(/SELECT\s+p\.prosrc\b/i.test(verifySql), false);
assert.equal(/pg_get_functiondef/i.test(verifySql), false);

const checkOrders = [...verifySql.matchAll(/SELECT\s+(\d+)\s*(?::integer)?\s*(?:AS check_order)?/g)]
  .map((m) => Number(m[1]))
  .filter((n) => n >= 100);
assert.ok(checkOrders.length >= 12, `expected many verify checks, got ${checkOrders.length}`);

// ── v99A package itself has no writer; API cutover is owned by v99B ──────────
for (const path of FROZEN) {
  assert.equal(gitDiff(path), "", `frozen path dirty: ${path}`);
}

const v99Files = readdirSync(join(repoRoot, "supabase/migrations"))
  .filter((name) => name.includes("v99"))
  .sort();
assert.ok(v99Files.includes("20260916000001_match_admission_authority_v99.sql"));
assert.ok(v99Files.includes("20260916000001_match_admission_authority_v99.verify.sql"));
assert.ok(v99Files.includes("20260916000002_match_request_writer_v99b.sql"));
assert.ok(v99Files.includes("20260916000002_match_request_writer_v99b.verify.sql"));
assert.equal(v99Files.some((n) => n.includes("v100")), false);

// ── Pure hash helper semantics ──────────────────────────────────────────────
const LEFT_ID = "11111111-1111-4111-8111-111111111111";
const RIGHT_ID = "22222222-2222-4222-8222-222222222222";

function basePost(
  overrides: Partial<AdmissionPostFactsV99Input> &
    Pick<AdmissionPostFactsV99Input, "id" | "user_id" | "post_type">,
): AdmissionPostFactsV99Input {
  return {
    category: "travel",
    status: "active",
    departure_date: "2026-09-16",
    departure_time_window: "14:00-14:15",
    service_time_window: null,
    transport_mode: "car",
    service_subtype: "passenger",
    escort_seats: 1,
    max_companions: 1,
    count_small: 0,
    count_medium: 0,
    count_large: 0,
    count_xlarge: 0,
    origin_address: "Belgrade",
    destination_address: "Novi Sad",
    waypoints: ["A", "B"],
    origin_gps_ewkb: "0101000020E6100000",
    destination_gps_ewkb: null,
    origin_country_code: null,
    origin_timezone: null,
    night_policy_version: null,
    ...overrides,
  };
}

const left = basePost({
  id: LEFT_ID,
  user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  post_type: "demand",
});
const right = basePost({
  id: RIGHT_ID,
  user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  post_type: "provider",
});

const hAB = hashAdmissionPairV99(left, right);
const hBA = hashAdmissionPairV99(right, left);
assert.ok(hAB);
assert.equal(hAB, hBA);

assert.equal(hashAdmissionPairV99(left, left), null);
assert.equal(
  hashAdmissionPairV99(left, { ...right, id: null }),
  null,
);
assert.equal(buildAdmissionPairFactsV99(left, left), null);
assert.equal(buildAdmissionPairFactsV99({ ...left, id: null }, right), null);

assert.notEqual(
  hashAdmissionPairV99(left, right),
  hashAdmissionPairV99({ ...left, service_subtype: "small_item_only" }, right),
);
assert.notEqual(
  hashAdmissionPairV99(left, right),
  hashAdmissionPairV99({ ...left, origin_country_code: "RS" }, right),
);
assert.notEqual(
  hashAdmissionPairV99(left, right),
  hashAdmissionPairV99({ ...left, origin_timezone: "Europe/Belgrade" }, right),
);
assert.notEqual(
  hashAdmissionPairV99(left, right),
  hashAdmissionPairV99({ ...left, night_policy_version: 1 }, right),
);

const nullCountry = hashAdmissionPairV99(
  { ...left, origin_country_code: null },
  right,
);
const emptyCountry = hashAdmissionPairV99(
  { ...left, origin_country_code: "" },
  right,
);
assert.ok(nullCountry);
assert.ok(emptyCountry);
assert.notEqual(nullCountry, emptyCountry);

assert.notEqual(
  hashAdmissionPairV99(left, right),
  hashAdmissionPairV99({ ...left, waypoints: ["B", "A"] }, right),
);

const sepLeft = hashAdmissionPairV99(
  { ...left, origin_address: "Belgrade|Novi" },
  right,
);
const sepSplit = hashAdmissionPairV99(
  { ...left, origin_address: "Belgrade", destination_address: "Novi" },
  right,
);
assert.notEqual(sepLeft, sepSplit);

const unicodeA = hashAdmissionPairV99(
  { ...left, origin_address: "Београд\nCenter" },
  right,
);
const unicodeB = hashAdmissionPairV99(
  { ...left, origin_address: "БеоградCenter" },
  right,
);
assert.notEqual(unicodeA, unicodeB);

assert.equal(
  hashAdmissionPairV99(left, right),
  hashAdmissionPairV99(
    { ...left, title: "noise", fee_amount: 999, bump_fee: 12 },
    { ...right, title: "other" },
  ),
);

const facts = buildAdmissionPostFactsV99(left);
assert.equal(facts.admission_schema_version, ADMISSION_SCHEMA_VERSION_V99);
assert.equal(facts.origin_country_code, null);
assert.equal(
  Object.keys(facts).sort().join(","),
  [...ADMISSION_FACTS_FIELDS_V99].sort().join(","),
);

assert.equal(
  hashAdmissionFactsV99([
    { ...facts, admission_schema_version: 98 as unknown as 99 },
    buildAdmissionPostFactsV99(right),
  ]),
  null,
);

console.log("matchAdmissionAuthorityV99.test.ts: ok");
console.log("v99 SQL is not applied remotely.");
