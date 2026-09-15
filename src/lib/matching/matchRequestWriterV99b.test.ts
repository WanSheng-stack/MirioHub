/**
 * PHASE 6.7C.2C.2 / v99B — create_match_request_v99 writer + API cutover.
 * Static structure checks only. Does not execute SQL or connect to Supabase.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/matchRequestWriterV99b.test.ts
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
import { MATCH_REQUEST_BODY_KEYS } from "@/lib/matching/matchRequestCreateCore";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const V99B_REL =
  "supabase/migrations/20260916000002_match_request_writer_v99b.sql";
const V99B_VERIFY_REL =
  "supabase/migrations/20260916000002_match_request_writer_v99b.verify.sql";
const V99A_REL =
  "supabase/migrations/20260916000001_match_admission_authority_v99.sql";
const V95_REL =
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql";

const WRITER_IDENTITY =
  "public.create_match_request_v99(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,bigint,text,bigint,bigint,integer,integer,integer,text,boolean,boolean)";

const FROZEN = [
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql",
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql",
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.sql",
  "supabase/migrations/20260911000002_matching_allocation_event_foundation_v94.sql",
  V95_REL,
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.verify.sql",
  "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.sql",
  "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.verify.sql",
  "supabase/migrations/20260914000001_postgis_extensions_rebind_v97.sql",
  "supabase/migrations/20260914000001_postgis_extensions_rebind_v97.verify.sql",
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.sql",
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.verify.sql",
  V99A_REL,
  "supabase/migrations/20260916000001_match_admission_authority_v99.verify.sql",
  "supabase/init.sql",
] as const;

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

/** Strip SQL comments so token checks do not pass on commented-out strings. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "");
}

function dollarBody(sql: string, tag: string): string {
  const token = `$${tag}$`;
  const start = sql.indexOf(token);
  if (start < 0) return "";
  const end = sql.indexOf(token, start + token.length);
  if (end < 0) return "";
  return sql.slice(start + token.length, end);
}

const migration = read(V99B_REL);
const verifySql = read(V99B_VERIFY_REL);
const route = read("src/app/api/matching/requests/route.ts");
const createTs = read("src/lib/matching/matchRequestCreate.ts");
const createCore = read("src/lib/matching/matchRequestCreateCore.ts");
const policy = read("src/lib/matching/matchAdmissionPolicy.ts");
const authorityTs = read("src/lib/matching/matchAdmissionAuthorityV99.ts");
const fnBody = stripSqlComments(dollarBody(migration, "fn"));
const guard = extractDoBlock(migration);

// ── Migration structure ─────────────────────────────────────────────────────
assert.ok(migration.includes("\nBEGIN;") || migration.startsWith("BEGIN;"));
assert.ok(migration.trimEnd().endsWith("COMMIT;"));
assert.deepEqual(transactionControls(migration), ["BEGIN;", "COMMIT;"]);
assert.equal(migration.includes("CREATE OR REPLACE FUNCTION"), false);
assert.ok(migration.includes("CREATE FUNCTION public.create_match_request_v99("));
assert.ok(migration.includes(WRITER_IDENTITY.replace("public.", "")));
assert.ok(guard.includes("already exists — refuse re-apply"));
assert.ok(guard.includes("v99A facts helper missing"));
assert.ok(guard.includes("create_match_request_v100 must not exist"));
assert.equal(migration.includes("CREATE FUNCTION public.create_match_request_v100"), false);
assert.equal(migration.includes("CREATE TABLE"), false);
assert.equal(migration.includes("CREATE POLICY"), false);
assert.equal(migration.includes("CREATE TRIGGER"), false);
assert.equal(migration.includes("CREATE SEQUENCE"), false);

assert.ok(migration.includes("LANGUAGE plpgsql"));
assert.ok(migration.includes("\nVOLATILE\n"));
assert.ok(migration.includes("SECURITY DEFINER"));
assert.ok(
  migration.includes("SET search_path TO 'pg_catalog', 'public', 'pg_temp'"),
);
assert.equal(/search_path[^\n]*extensions/i.test(migration), false);
assert.equal(migration.includes("public.geography"), false);
assert.equal(migration.includes("public.geometry"), false);
assert.equal(migration.includes("public.st_"), false);
assert.equal(fnBody.includes("public.digest"), false);

assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.create_match_request_v99"));
assert.ok(migration.includes("FROM PUBLIC;"));
assert.ok(migration.includes("FROM anon;"));
assert.ok(migration.includes("FROM authenticated;"));
assert.ok(migration.includes("GRANT EXECUTE ON FUNCTION public.create_match_request_v99"));
assert.ok(migration.includes("TO service_role;"));

// ── Exact retry before fresh creation / lock ────────────────────────────────
const exactIdx = fnBody.indexOf("INTO v_existing");
const createdFalseIdx = fnBody.indexOf("created := false");
const freshFlagIdx = fnBody.indexOf("matching_request_creation_enabled");
const postsLockIdx = fnBody.indexOf("FROM public.posts p");
const postsForUpdateIdx = fnBody.indexOf("FOR UPDATE", postsLockIdx);
assert.ok(exactIdx > 0);
assert.ok(createdFalseIdx > exactIdx);
assert.ok(freshFlagIdx > createdFalseIdx, "creation flag must follow exact retry");
assert.ok(postsLockIdx > freshFlagIdx, "posts lock must follow fresh-only creation gate");
assert.ok(postsForUpdateIdx > postsLockIdx, "posts SELECT must use FOR UPDATE");
assert.ok(fnBody.includes("error.match_request_idempotency_conflict"));
assert.ok(fnBody.includes("idempotency_payload_hash IS DISTINCT FROM"));

// Fresh-only creation gate token (not a comment-only marker)
assert.ok(fnBody.includes("error.match_request_creation_disabled"));
assert.ok(fnBody.includes("IF v_enabled IS NOT TRUE THEN"));

// ── Lock + v99 facts/hash (live body, not comments) ─────────────────────────
assert.ok(fnBody.includes("ORDER BY p.id"));
assert.ok(fnBody.includes("WHERE p.id IN (v_first, v_second)"));
assert.ok(fnBody.includes("p.service_subtype"));
assert.ok(fnBody.includes("p.origin_country_code"));
assert.ok(fnBody.includes("p.origin_timezone"));
assert.ok(fnBody.includes("p.night_policy_version"));
assert.ok(fnBody.includes("match_request_admission_post_facts_v99("));
assert.ok(fnBody.includes("match_request_admission_facts_hash_v99("));
assert.equal(fnBody.includes("match_request_admission_post_facts_v95"), false);
assert.equal(fnBody.includes("match_request_admission_facts_hash_v95"), false);
assert.ok(fnBody.includes("v_hash IS DISTINCT FROM p_admission_facts_hash"));

// Authority fail-closed
assert.ok(fnBody.includes("v_init_subtype IS NULL"));
assert.ok(fnBody.includes("v_init_country IS NULL"));
assert.ok(fnBody.includes("v_init_timezone IS NULL"));
assert.ok(fnBody.includes("v_init_night_ver IS NULL"));
assert.ok(fnBody.includes("v_init_country !~ '^[A-Z]{2}$'"));
assert.ok(fnBody.includes("passenger_with_small_item"));
assert.ok(fnBody.includes("cargo_with_escort"));
assert.ok(fnBody.includes("cargo_boat"));
assert.ok(fnBody.includes("IS DISTINCT FROM 'car'"));

// No browser authority params on writer signature
const createSig = migration.slice(
  migration.indexOf("CREATE FUNCTION public.create_match_request_v99("),
  migration.indexOf("RETURNS TABLE"),
);
assert.equal(createSig.includes("service_subtype"), false);
assert.equal(createSig.includes("origin_country_code"), false);
assert.equal(createSig.includes("origin_timezone"), false);
assert.equal(createSig.includes("night_policy_version"), false);
assert.equal(createSig.includes("p_admission_facts "), false);
assert.equal(createSig.includes("route_score"), false);

// Atomic writes retained; no contract/allocation/event
assert.ok(fnBody.includes("INSERT INTO public.match_contact_invitations"));
assert.ok(fnBody.includes("INSERT INTO public.match_requests"));
assert.ok(fnBody.includes("INSERT INTO public.match_request_revisions"));
assert.ok(fnBody.includes("INSERT INTO public.contact_grants"));
assert.equal(fnBody.includes("INSERT INTO public.match_contracts"), false);
assert.equal(fnBody.includes("INSERT INTO public.match_allocations"), false);
assert.equal(fnBody.includes("INSERT INTO public.match_events"), false);
assert.equal(fnBody.includes("INSERT INTO public.allocation"), false);

// ── Verify structure ────────────────────────────────────────────────────────
assert.ok(verifyIsSingleResultSet(verifySql));
assert.ok(verifySql.includes(") AS observed,"));
assert.ok(verifySql.includes("overall_pass"));
assert.ok(verifySql.includes("writer_v99 identity"));
assert.ok(verifySql.includes("writer binds v99 facts/hash"));
assert.ok(verifySql.includes("writer ACL service_role only"));
assert.ok(verifySql.includes("v99A three functions retained"));
assert.ok(verifySql.includes("v95 five functions retained"));
assert.ok(verifySql.includes("create_match_request_v100 absent"));
assert.ok(verifySql.includes("no v99B table/policy/trigger/sequence"));
assert.ok(verifySql.includes("creation remains false"));
assert.ok(verifySql.includes("night RS seed disabled"));
assert.equal(/SELECT\s+p\.prosrc\b/i.test(verifySql), false);
assert.equal(/pg_get_functiondef/i.test(verifySql), false);
assert.ok(verifySql.includes(WRITER_IDENTITY));

const checkOrders = [...verifySql.matchAll(/SELECT\s+(\d+)\s*(?::integer)?\s*(?:AS check_order)?/g)]
  .map((m) => Number(m[1]))
  .filter((n) => n >= 100);
assert.ok(checkOrders.length >= 9, `expected many verify checks, got ${checkOrders.length}`);

// ── API cutover (production call sites) ─────────────────────────────────────
const routeLive = stripSqlComments(route);
assert.ok(routeLive.includes("inspect_match_request_v95"));
assert.ok(routeLive.includes("read_match_request_candidate_snapshot_v99"));
assert.ok(routeLive.includes("create_match_request_v99"));
assert.equal(routeLive.includes("create_match_request_v95"), false);
assert.equal(routeLive.includes("read_match_request_candidate_snapshot_v95"), false);
assert.ok(route.includes("left_service_subtype"));
assert.ok(route.includes("right_origin_country_code"));
assert.ok(route.includes("left_origin_timezone"));
assert.ok(route.includes("right_night_policy_version"));
assert.ok(route.includes("service_subtype: (p(\"service_subtype\")"));
assert.ok(route.includes("origin_country_code: (p(\"origin_country_code\")"));
assert.ok(route.includes("origin_timezone: (p(\"origin_timezone\")"));
assert.ok(route.includes("night_policy_version: (p(\"night_policy_version\")"));

for (const key of [
  "origin_country_code",
  "origin_timezone",
  "night_policy_version",
  "service_subtype",
] as const) {
  assert.equal(
    (MATCH_REQUEST_BODY_KEYS as readonly string[]).includes(key),
    false,
    `browser body must not accept ${key}`,
  );
}

// Exact-retry shortcut in orchestration (live TS, not comments)
const createLive = createTs
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");
assert.ok(createLive.includes("existing_for_client_request"));
assert.ok(createLive.includes("admissionFactsHash: \"\""));
assert.ok(createLive.includes("postsLoaded: false"));
assert.ok(createLive.includes("routeScored: false"));
assert.ok(createLive.includes("quoteLoaded: false"));
const retryBlock = createLive.slice(
  createLive.indexOf("existing_for_client_request"),
  createLive.indexOf("creation_enabled === false"),
);
assert.equal(retryBlock.includes("loadSnapshot"), false);
assert.equal(retryBlock.includes("scoreRoute"), false);
assert.equal(retryBlock.includes("loadQuote"), false);

// TS admission authority parity
assert.ok(policy.includes("postSatisfiesAdmissionAuthority"));
assert.ok(policy.includes("assertPublishSubtypeTransportLegal"));
assert.ok(policy.includes("service_subtype?:"));
assert.ok(policy.includes("origin_country_code?:"));
assert.ok(policy.includes("origin_timezone?:"));
assert.ok(policy.includes("night_policy_version?:"));
assert.ok(createCore.includes("postSatisfiesAdmissionAuthority"));

// TS must not claim to rebuild PostgreSQL v99 hash for production
assert.equal(createTs.includes("match_request_admission_facts_hash_v99"), false);
assert.equal(createCore.includes("extensions.digest"), false);
assert.ok(authorityTs.includes("hashAdmissionFactsV99"));
assert.ok(
  authorityTs.includes("Mirrors") ||
    authorityTs.includes("Not a PostgreSQL") ||
    authorityTs.includes("pure admission"),
);

// ── Frozen history + no v100 ────────────────────────────────────────────────
for (const path of FROZEN) {
  assert.equal(gitDiff(path), "", `frozen path dirty: ${path}`);
}

const v99Files = readdirSync(join(repoRoot, "supabase/migrations"))
  .filter((name) => /v99|v100/.test(name))
  .sort();
assert.ok(v99Files.includes("20260916000001_match_admission_authority_v99.sql"));
assert.ok(v99Files.includes("20260916000002_match_request_writer_v99b.sql"));
assert.ok(v99Files.includes("20260916000002_match_request_writer_v99b.verify.sql"));
assert.equal(
  v99Files.some((n) => n.includes("v100")),
  false,
);

console.log("matchRequestWriterV99b.test.ts: ok");
