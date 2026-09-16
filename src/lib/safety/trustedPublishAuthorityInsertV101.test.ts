/**
 * PHASE 6.7C.2C.3F / v101A — atomic trusted authority Stage-1 insert foundation.
 * Reads real migration/verify text. Does not execute SQL or connect to Supabase.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/trustedPublishAuthorityInsertV101.test.ts
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

const PHASE_BASELINE = "93b7fe136bb09229e31a0bbd2149fd0c47ab8280";

const V101_REL =
  "supabase/migrations/20260918000001_trusted_publish_authority_insert_v101.sql";
const V101_VERIFY_REL =
  "supabase/migrations/20260918000001_trusted_publish_authority_insert_v101.verify.sql";
const V98_REL =
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.sql";

const FN_IDENTITY =
  "public.insert_stage1_post_v101(uuid, uuid, text, text, jsonb, bigint, text, extensions.geography, text, text, integer)";
const FN_REGPROCEDURE =
  "public.insert_stage1_post_v101(uuid,uuid,text,text,jsonb,bigint,text,extensions.geography,text,text,integer)";

const FROZEN = [
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql",
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql",
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.sql",
  "supabase/migrations/20260911000002_matching_allocation_event_foundation_v94.sql",
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql",
  "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.sql",
  "supabase/migrations/20260914000001_postgis_extensions_rebind_v97.sql",
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.sql",
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.verify.sql",
  "supabase/migrations/20260916000001_match_admission_authority_v99.sql",
  "supabase/migrations/20260916000002_match_request_writer_v99b.sql",
  "supabase/migrations/20260917000001_night_policy_selector_v100.sql",
  "supabase/migrations/20260917000001_night_policy_selector_v100.verify.sql",
  "supabase/init.sql",
  "supabase/posts_init.sql",
] as const;

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", PHASE_BASELINE, "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

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

function insertLists(fnBody: string): { cols: string[]; values: string[] } {
  const insertMatch = /INSERT\s+INTO\s+public\.posts\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*RETURNING/i.exec(
    fnBody,
  );
  assert.ok(insertMatch, "INSERT INTO public.posts … RETURNING required");
  const cols = insertMatch[1]!
    .split(",")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  // VALUES may contain nested COALESCE(...)/casts with commas — split carefully
  // by tracking paren depth.
  const raw = insertMatch[2]!;
  const values: string[] = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      values.push(buf.trim().replace(/\s+/g, " "));
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) values.push(buf.trim().replace(/\s+/g, " "));
  return { cols, values };
}

const migration = read(V101_REL);
const verifySql = read(V101_VERIFY_REL);
const v98 = read(V98_REL);
const ledger = read("docs/architecture/deferred-cleanup.md");

assert.ok(migration.startsWith("BEGIN;") || migration.includes("\nBEGIN;"));
assert.ok(migration.trimEnd().endsWith("COMMIT;"));
assert.deepEqual(transactionControls(migration), ["BEGIN;", "COMMIT;"]);
assert.equal(migration.includes("CREATE OR REPLACE FUNCTION"), false);
assert.ok(migration.includes("CREATE FUNCTION public.insert_stage1_post_v101"));
assert.ok(migration.includes(FN_REGPROCEDURE) || migration.includes(FN_IDENTITY));
assert.ok(
  migration.includes(
    "p_origin_gps            extensions.geography",
  ) || migration.includes("p_origin_gps extensions.geography"),
);
assert.ok(migration.includes("MANUAL APPLY REQUIRED"));
assert.ok(migration.includes("v101B"));
assert.ok(migration.includes("payload_hash"));
assert.ok(
  migration.includes("does NOT claim") ||
    migration.includes("does not claim") ||
    migration.includes("stores the caller-supplied hash"),
);

// No outer writers created in this phase (guard may name them to refuse)
assert.equal(
  /CREATE\s+FUNCTION\s+public\.publish_active_post_idempotent_v101/i.test(
    migration,
  ),
  false,
);
assert.equal(
  /CREATE\s+FUNCTION\s+public\.create_shadow_draft_idempotent_v101/i.test(
    migration,
  ),
  false,
);
assert.equal(
  /CREATE\s+FUNCTION\s+public\.commit_phase3_business_idempotent_v101/i.test(
    migration,
  ),
  false,
);
assert.equal(/CREATE\s+FUNCTION\s+public\.insert_stage1_post_v102/i.test(migration), false);

// Guard
const guard = extractDoBlock(migration);
assert.ok(guard.includes("v101A_guard"));
assert.ok(guard.includes("origin_gps"));
assert.ok(guard.includes("origin_country_code"));
assert.ok(guard.includes("origin_timezone"));
assert.ok(guard.includes("night_policy_version"));
assert.ok(guard.includes("insert_stage1_post_v98"));
assert.ok(guard.includes("publish_active_post_idempotent_v98"));
assert.ok(guard.includes("create_shadow_draft_idempotent_v98"));
assert.ok(guard.includes("commit_phase3_business_idempotent_v98"));
assert.ok(guard.includes("select_night_service_policy_v100"));
assert.ok(guard.includes("matching_request_creation_enabled"));
assert.ok(guard.includes("id = 1"));
assert.ok(guard.includes("RS seed") || guard.includes("country_code = 'RS'"));
assert.ok(guard.includes("enabled must be false") || guard.includes("enabled IS DISTINCT FROM false"));
assert.equal(/schema_migrations/i.test(guard), false);
assert.equal(guard.includes("INSERT INTO public.posts"), false);
assert.equal(/perform\s+public\.insert_stage1_post_v98/i.test(guard), false);

const body = dollarBody(migration, "fn");
assert.ok(body.length > 500, "v101 function body present");
assert.ok(body.includes("SECURITY DEFINER") === false); // attributes outside body
assert.ok(migration.includes("SECURITY DEFINER"));
assert.ok(migration.includes("VOLATILE"));
assert.ok(
  migration.includes("SET search_path TO 'pg_catalog', 'public', 'pg_temp'"),
);

// ACL: revoke from all app roles + service_role
for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
  assert.ok(
    migration.includes(`FROM ${role}`),
    `REVOKE … FROM ${role}`,
  );
}
assert.equal(/GRANT\s+EXECUTE[\s\S]*insert_stage1_post_v101/i.test(migration), false);

// PostGIS extensions-only
assert.ok(body.includes("extensions.geometrytype") || body.includes("extensions.st_"));
assert.ok(body.includes("extensions.st_srid"));
assert.ok(body.includes("extensions.st_x"));
assert.ok(body.includes("extensions.st_y"));
assert.equal(body.includes("public.st_"), false);
assert.equal(body.includes("public.geography"), false);
assert.equal(body.includes("extensions.geography"), false); // type is in signature, not body casts needed as ::extensions.geometry

// Authority validation branches
assert.ok(body.includes("p_origin_gps IS NULL"));
assert.ok(body.includes("^[A-Z]{2}$"));
assert.ok(body.includes("btrim(p_origin_country_code)"));
assert.ok(body.includes("btrim(p_origin_timezone)"));
assert.ok(body.includes("pg_timezone_names"));
assert.ok(body.includes("p_night_policy_version <= 0"));
assert.equal(/upper\s*\(\s*p_origin_country_code/i.test(body), false);
assert.equal(body.includes("Europe/Belgrade"), false);
assert.equal(/COALESCE\s*\(\s*p_night_policy_version\s*,\s*1\s*\)/i.test(body), false);

// Atomicity: one INSERT, no UPDATE posts
const insertHits = body.match(/INSERT\s+INTO\s+public\.posts/gi) ?? [];
assert.equal(insertHits.length, 1);
assert.equal(/UPDATE\s+public\.posts/i.test(body), false);

const v98Body = (() => {
  const start = v98.indexOf("CREATE FUNCTION public.insert_stage1_post_v98");
  assert.ok(start >= 0);
  const asIdx = v98.indexOf("AS $$", start);
  const end = v98.indexOf("$$;", asIdx);
  return v98.slice(asIdx + 5, end);
})();

const v98Ins = insertLists(v98Body);
const v101Ins = insertLists(body);

// v101 columns = v98 columns with origin_gps added before the three authority cols
const v98AuthIdx = v98Ins.cols.indexOf("origin_country_code");
assert.ok(v98AuthIdx >= 0);
assert.deepEqual(
  v98Ins.cols.slice(0, v98AuthIdx),
  v101Ins.cols.slice(0, v98AuthIdx),
  "canonical columns before authority must align with v98",
);
assert.deepEqual(v101Ins.cols.slice(v98AuthIdx), [
  "origin_gps",
  "origin_country_code",
  "origin_timezone",
  "night_policy_version",
]);
assert.deepEqual(v98Ins.cols.slice(v98AuthIdx), [
  "origin_country_code",
  "origin_timezone",
  "night_policy_version",
]);

// Values: v98 writes NULL,NULL,NULL for authority; v101 writes four params
const v98ValTail = v98Ins.values.slice(v98AuthIdx);
assert.deepEqual(v98ValTail, ["NULL", "NULL", "NULL"]);
const v101ValTail = v101Ins.values.slice(v98AuthIdx);
assert.deepEqual(v101ValTail, [
  "p_origin_gps",
  "p_origin_country_code",
  "p_origin_timezone",
  "p_night_policy_version",
]);

// Shared VALUES head (canonical) must match length
assert.equal(
  v101Ins.values.length - 4,
  v98Ins.values.length - 3,
  "canonical value count aligned",
);
for (let i = 0; i < v98AuthIdx; i++) {
  assert.equal(
    v101Ins.values[i],
    v98Ins.values[i],
    `VALUES[${i}] must match v98 (${v98Ins.cols[i]})`,
  );
}

// Migration must not alter v98 ACL / posts_update_own / flags
assert.equal(
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.insert_stage1_post_v98/i.test(
    migration,
  ),
  false,
);
assert.equal(
  /(?:DROP|CREATE|ALTER)\s+POLICY\s+posts_update_own/i.test(migration),
  false,
);
assert.equal(migration.includes("matching_request_creation_enabled = true"), false);
assert.equal(
  /(?:UPDATE|SET)\s+.*matching_request_creation_enabled\s*=\s*true/i.test(
    migration,
  ),
  false,
);
assert.equal(
  /night_service_policies[\s\S]{0,80}enabled\s*=\s*true/i.test(migration),
  false,
);

// Verify structure
assert.ok(verifyIsSingleResultSet(verifySql));
assert.ok(verifySql.includes("check_order"));
assert.ok(verifySql.includes("area"));
assert.ok(verifySql.includes("check_name"));
assert.ok(verifySql.includes("result"));
assert.ok(verifySql.includes("observed"));
assert.ok(verifySql.includes("expected"));
assert.ok(verifySql.includes("overall_pass"));
assert.ok(
  verifySql.includes(") AS observed,") ||
    verifySql.includes(")::text AS observed,"),
  "checks CTE first arm must alias observed",
);
assert.ok(verifySql.includes("One statement") || verifySql.includes("seven columns"));
assert.equal(
  /SELECT\s+public\.insert_stage1_post_v101\s*\(/i.test(stripSqlComments(verifySql)),
  false,
);
assert.equal(
  /PERFORM\s+public\.insert_stage1_post_v101/i.test(stripSqlComments(verifySql)),
  false,
);
// Token searches for INSERT in prosrc are allowed; verify must not write rows.
assert.equal(
  /INSERT\s+INTO\s+public\.posts/i.test(stripSqlComments(verifySql)),
  false,
);

const checkOrders = [
  ...verifySql.matchAll(
    /(?:SELECT|UNION ALL SELECT)\s+(\d+)(?:::integer)?(?:\s+AS\s+check_order)?,/g,
  ),
].map((m) => Number(m[1]));
assert.ok(
  checkOrders.length >= 30,
  `expected >=30 checks, got ${checkOrders.length}`,
);
for (const name of [
  "v101 exact OID",
  "PUBLIC no EXECUTE",
  "service_role no EXECUTE",
  "single posts INSERT",
  "no post-insert UPDATE posts",
  "no upper(country)",
  "no Europe/Belgrade fallback",
  "no COALESCE night version to 1",
  "creation=false",
  "RS night=false",
  "no v102 functions",
]) {
  assert.ok(verifySql.includes(name), `verify missing: ${name}`);
}

// Production APIs still v98; writer foundation unwired; no outer v101
const trusted = read("src/app/api/posts/trusted-publish/route.ts");
const shadow = read("src/app/api/posts/shadow-draft/route.ts");
const passkey = read("src/app/api/auth/passkey/verify/route.ts");
assert.ok(trusted.includes("publish_active_post_idempotent_v98"));
assert.ok(shadow.includes("create_shadow_draft_idempotent_v98"));
assert.ok(passkey.includes("commit_phase3_business_idempotent_v98"));
assert.equal(trusted.includes("v101"), false);
assert.equal(shadow.includes("v101"), false);
assert.equal(passkey.includes("v101"), false);
assert.equal(trusted.includes("writeTrustedPublishAuthority"), false);
assert.equal(trusted.includes("insert_stage1_post_v101"), false);

const writer = read("src/lib/safety/trustedPublishAuthorityWriter.ts");
assert.ok(writer.includes('import "server-only"'));
assert.equal(writer.includes("insert_stage1_post_v101"), false);

// Frozen history zero-diff; no v102 migration file
for (const path of FROZEN) {
  assert.equal(gitDiff(path), "", `frozen dirty: ${path}`);
}
const migs = readdirSync(join(repoRoot, "supabase/migrations"));
assert.ok(migs.includes("20260918000001_trusted_publish_authority_insert_v101.sql"));
assert.ok(
  migs.includes("20260918000001_trusted_publish_authority_insert_v101.verify.sql"),
);
assert.equal(migs.some((n) => /v102/.test(n)), false);

assert.equal(gitDiff("src/lib/safety/trustedPublishAuthorityWriter.ts"), "");
assert.equal(gitDiff("src/lib/safety/trustedPublishAuthorityWriterCore.ts"), "");
assert.equal(gitDiff("src/lib/safety/trustedPublishAuthority.ts"), "");

assert.ok(ledger.includes("2C.3F") || ledger.includes("v101A"));
assert.ok(ledger.includes("API cutover still pending") || ledger.includes("cutover"));

console.log("trustedPublishAuthorityInsertV101.test.ts: ok");
console.log(`v101 identity: ${FN_IDENTITY}`);
console.log(
  `INSERT delta: +origin_gps column; authority VALUES NULL,NULL,NULL → four p_origin_* params`,
);
