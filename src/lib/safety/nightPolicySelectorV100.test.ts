/**
 * PHASE 6.7C.2C.3C — v100 night policy selector structure + pure fixture tests.
 * Does not execute SQL or connect to Supabase.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/nightPolicySelectorV100.test.ts
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
  NIGHT_POLICY_SELECTOR_KNOWN_TZ,
  NIGHT_POLICY_SELECTOR_TEST_INSTANT,
  selectNightServicePolicyV100Pure,
  type NightPolicyFixtureRow,
} from "@/lib/safety/nightPolicySelectorV100";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const V100_REL =
  "supabase/migrations/20260917000001_night_policy_selector_v100.sql";
const V100_VERIFY_REL =
  "supabase/migrations/20260917000001_night_policy_selector_v100.verify.sql";

const FN_IDENTITY =
  "public.select_night_service_policy_v100(text, text, text, timestamptz)";
const FN_REGPROCEDURE =
  "public.select_night_service_policy_v100(text,text,text,timestamptz)";

const FROZEN = [
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql",
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql",
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.sql",
  "supabase/migrations/20260911000002_matching_allocation_event_foundation_v94.sql",
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql",
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.verify.sql",
  "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.sql",
  "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.verify.sql",
  "supabase/migrations/20260914000001_postgis_extensions_rebind_v97.sql",
  "supabase/migrations/20260914000001_postgis_extensions_rebind_v97.verify.sql",
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.sql",
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.verify.sql",
  "supabase/migrations/20260916000001_match_admission_authority_v99.sql",
  "supabase/migrations/20260916000001_match_admission_authority_v99.verify.sql",
  "supabase/migrations/20260916000002_match_request_writer_v99b.sql",
  "supabase/migrations/20260916000002_match_request_writer_v99b.verify.sql",
  "supabase/init.sql",
] as const;

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", "--", path], {
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

const migration = read(V100_REL);
const verifySql = read(V100_VERIFY_REL);
const body = stripSqlComments(dollarBody(migration, "fn"));
const guard = extractDoBlock(migration);
const ledger = read("docs/architecture/deferred-cleanup.md");

// ── Migration structure ─────────────────────────────────────────────────────
assert.ok(migration.includes("\nBEGIN;") || migration.startsWith("BEGIN;"));
assert.ok(migration.trimEnd().endsWith("COMMIT;"));
assert.deepEqual(transactionControls(migration), ["BEGIN;", "COMMIT;"]);
assert.equal(migration.includes("CREATE OR REPLACE FUNCTION"), false);
assert.ok(
  migration.includes("CREATE FUNCTION public.select_night_service_policy_v100("),
);
assert.ok(migration.includes(FN_IDENTITY) || migration.includes(FN_REGPROCEDURE));
assert.ok(migration.includes("LANGUAGE sql"));
assert.ok(migration.includes("\nSTABLE\n") || /\nSTABLE\r?\n/.test(migration));
assert.ok(migration.includes("SECURITY DEFINER"));
assert.ok(
  migration.includes("SET search_path TO 'pg_catalog', 'public', 'pg_temp'"),
);
assert.equal(/search_path[^\n]*extensions/i.test(migration), false);
assert.equal(migration.includes("CREATE TABLE"), false);
assert.equal(migration.includes("CREATE POLICY"), false);
assert.equal(migration.includes("CREATE TRIGGER"), false);
assert.equal(migration.includes("CREATE SEQUENCE"), false);
assert.equal(migration.includes("INSERT INTO public.night_service_policies"), false);
assert.equal(migration.includes("UPDATE public.night_service_policies"), false);
assert.equal(migration.includes("ALTER TABLE public.night_service_policies"), false);
assert.equal(migration.includes("select_night_service_policy_v101"), true); // guard only
assert.ok(guard.includes("select_night_service_policy_v101 must not exist"));
assert.equal(
  stripSqlComments(migration).includes(
    "CREATE FUNCTION public.select_night_service_policy_v101",
  ),
  false,
);

assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.select_night_service_policy_v100"));
assert.ok(migration.includes("FROM PUBLIC"));
assert.ok(migration.includes("FROM anon"));
assert.ok(migration.includes("FROM authenticated"));
assert.ok(
  migration.includes(
    "GRANT EXECUTE ON FUNCTION public.select_night_service_policy_v100",
  ),
);
assert.ok(migration.includes("TO service_role"));

// Guard contracts
assert.ok(guard.includes("night_service_policies missing"));
assert.ok(guard.includes("RLS not enabled"));
assert.ok(guard.includes("FORCE RLS must be off"));
assert.ok(guard.includes("app-role privilege present"));
assert.ok(guard.includes("SELECT need.attname INTO v_missing"));
assert.equal(guard.includes("SELECT a.attname INTO v_missing"), false);
{
  const missingCol = guard.indexOf("SELECT need.attname INTO v_missing");
  assert.ok(missingCol >= 0);
  const stmtEnd = guard.indexOf("LIMIT 1;", missingCol);
  assert.ok(stmtEnd > missingCol);
  const stmt = guard.slice(missingCol, stmtEnd + "LIMIT 1;".length);
  assert.ok(stmt.includes("AS need(attname)"));
  assert.ok(stmt.includes("FROM pg_catalog.pg_attribute a"));
  assert.ok(stmt.includes("AND a.attname = need.attname"));
  // alias a must only appear inside the NOT EXISTS subquery
  const notExists = stmt.indexOf("WHERE NOT EXISTS (");
  assert.ok(notExists > 0);
  const before = stmt.slice(0, notExists);
  assert.equal(/\ba\.attname\b/.test(before), false);
  assert.equal(/\bFROM pg_catalog\.pg_attribute a\b/.test(before), false);
}
assert.ok(guard.includes("RS seed version 1 row_count must be 1"));
assert.ok(guard.includes("RS seed enabled must be false"));
assert.ok(guard.includes("RS seed blocked_start_local drift"));
assert.ok(guard.includes("RS seed blocked_end_local drift"));
assert.ok(guard.includes("RS seed effective_from must be set"));
assert.ok(guard.includes("RS seed effective_until must be NULL"));
assert.ok(guard.includes("system_configs id=1 must exist exactly once"));
assert.ok(guard.includes("matching_request_creation_enabled must be false"));
assert.ok(guard.includes("WHERE id = 1"));
assert.ok(guard.includes("policy_version = 1"));
assert.equal(guard.includes("ORDER BY p.policy_version ASC, p.id ASC"), false);
assert.equal(
  /FROM public\.system_configs\s+LIMIT 1/.test(guard),
  false,
  "system_configs must not use unconditional LIMIT 1",
);
assert.ok(guard.includes("v99A facts helper missing"));
assert.ok(guard.includes("create_match_request_v99 missing"));
assert.ok(guard.includes("select_night_service_policy_v100 already exists"));
assert.equal(guard.includes("schema_migrations"), false);

// Function body contracts (real source, not markers)
assert.ok(body.includes("enabled IS TRUE"));
assert.ok(body.includes("p.effective_from <= p_evaluation_time"));
assert.ok(body.includes("p_evaluation_time < p.effective_until"));
assert.ok(body.includes("p.timezone_name = p_origin_timezone"));
assert.ok(body.includes("pg_catalog.pg_timezone_names"));
assert.ok(body.includes("p_country_code ~ '^[A-Z]{2}$'"));
assert.ok(body.includes("p_country_code = btrim(p_country_code)"));
assert.ok(body.includes("CASE WHEN p.region_code IS NOT NULL THEN 0 ELSE 1 END"));
assert.ok(body.includes("policy_version DESC"));
assert.ok(body.includes("effective_from DESC"));
assert.ok(body.includes("p.id ASC"));
assert.ok(body.includes("LIMIT 1"));
assert.equal(body.includes("upper("), false);
assert.equal(body.includes("Europe/Belgrade"), false);
assert.equal(body.includes("CREATE TABLE"), false);

// Selector body must be byte-identical to 9a21dd1 (alias fix is guard-only)
{
  const baselineMig = execFileSync(
    "git",
    ["show", "9a21dd15469f88038509d55d2db3a5a0c100869d:" + V100_REL],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const baselineBody = stripSqlComments(dollarBody(baselineMig, "fn"));
  assert.equal(body, baselineBody, "selector $fn$ body drifted from 9a21dd1");
}

// First DDL must remain after the complete guard DO block
{
  const guardEnd = migration.indexOf("END $$;");
  assert.ok(guardEnd > 0);
  const createFn = migration.indexOf(
    "CREATE FUNCTION public.select_night_service_policy_v100(",
  );
  assert.ok(createFn > guardEnd, "CREATE FUNCTION must follow complete guard");
  assert.equal(
    migration.slice(0, guardEnd).includes("CREATE FUNCTION"),
    false,
  );
}

// v100 verify must stay frozen at HEAD baseline for this alias-only fix
assert.equal(
  gitDiff(V100_VERIFY_REL),
  "",
  "v100 verify must be zero-diff for 42P01 alias fix",
);

const returnsBlock = migration.slice(
  migration.indexOf("RETURNS TABLE"),
  migration.indexOf("LANGUAGE sql"),
);
assert.ok(returnsBlock.includes("policy_id uuid"));
assert.ok(returnsBlock.includes("blocked_start_local time without time zone"));
assert.ok(returnsBlock.includes("blocked_end_local time without time zone"));
assert.ok(returnsBlock.includes("policy_version integer"));

// ── Verify structure ────────────────────────────────────────────────────────
assert.ok(verifyIsSingleResultSet(verifySql));
assert.ok(verifySql.includes("check_order"));
assert.ok(verifySql.includes("overall_pass"));
assert.ok(verifySql.includes("::text"));
assert.equal(verifySql.includes("INSERT "), false);
assert.equal(verifySql.includes("UPDATE "), false);
assert.equal(verifySql.includes("DELETE "), false);
assert.equal(
  /INSERT\s+INTO\s+public\.night_service_policies/i.test(migration + verifySql),
  false,
);
assert.equal(
  /UPDATE\s+public\.night_service_policies/i.test(migration + verifySql),
  false,
);
assert.equal(
  /DELETE\s+FROM\s+public\.night_service_policies/i.test(migration + verifySql),
  false,
);

const checkOrders = [
  ...verifySql.matchAll(/^\s*\(\s*(\d+)\s*,/gm),
].map((m) => Number(m[1]));
assert.ok(checkOrders.length >= 31, `expected >=31 checks, got ${checkOrders.length}`);
for (let i = 1; i <= 31; i++) {
  assert.ok(checkOrders.includes(i), `missing check_order ${i}`);
}

assert.ok(verifySql.includes("RS disabled returns zero rows"));
assert.ok(verifySql.includes("lowercase country zero rows"));
assert.ok(verifySql.includes("padded country zero rows"));
assert.ok(verifySql.includes("empty region zero rows"));
assert.ok(verifySql.includes("padded timezone zero rows"));
assert.ok(verifySql.includes("illegal timezone zero rows"));
assert.ok(verifySql.includes("NULL evaluation_time zero rows"));
assert.ok(verifySql.includes("matching creation still false"));
assert.ok(verifySql.includes("RS seed still enabled=false"));
assert.ok(verifySql.includes("no select_night_service_policy_v101"));
assert.ok(verifySql.includes("provolatile::text"));

// 2C.3C.1 — false-PASS boundary locks
assert.ok(migration.includes("WHERE id = 1"));
assert.ok(verifySql.includes("WHERE id = 1"));
assert.equal(
  /FROM public\.system_configs\s+LIMIT 1/.test(migration),
  false,
);
assert.equal(
  /FROM public\.system_configs\s+LIMIT 1/.test(verifySql),
  false,
);
assert.ok(verifySql.includes("policy_version = 1"));
assert.ok(verifySql.includes("row_count"));
assert.ok(guard.includes("count(*)::int INTO v_seed_n"));
assert.ok(/v_seed_n IS DISTINCT FROM 1/.test(guard));
assert.ok(migration.includes("TIME '22:00'"));
assert.ok(migration.includes("TIME '06:00'"));
assert.ok(verifySql.includes("TIME '22:00'"));
assert.ok(verifySql.includes("TIME '06:00'"));
assert.ok(verifySql.includes("(SELECT effective_until FROM rs_seed) IS NULL"));
assert.ok(guard.includes("RS seed effective_until must be NULL"));
assert.ok(verifySql.includes("effective_from + interval '1 second'"));
assert.equal(verifySql.includes("2026-06-15 12:00:00+00"), true); // invalid-input checks may keep fixed time
// check 21 must not use the fixed date for RS disabled proof
{
  const check21Start = verifySql.indexOf("'RS disabled returns zero rows'");
  assert.ok(check21Start > 0);
  const check21Block = verifySql.slice(check21Start, check21Start + 900);
  assert.equal(check21Block.includes("2026-06-15"), false);
  assert.ok(check21Block.includes("seed_count=1 evaluation_time_set=true selector_count=0"));
  assert.ok(check21Block.includes("seed_count"));
  assert.ok(check21Block.includes("evaluation_time_set"));
  assert.ok(check21Block.includes("selector_count"));
}
assert.ok(verifySql.includes("rs_disabled AS"));
assert.ok(verifySql.includes("ELSE NULL"));
assert.ok(
  verifySql.includes("WHEN s.row_count = 1 AND s.effective_from IS NOT NULL"),
);
assert.ok(
  verifySql.includes("bool_and(c.result = 'PASS') OVER ()") &&
    verifySql.includes("THEN 'PASS'") &&
    verifySql.includes("ELSE 'FAIL'") &&
    verifySql.includes("END AS overall_pass"),
);
// overall_pass must be text PASS/FAIL, not boolean bool_and alone
assert.equal(
  /\(SELECT bool_and\(x\.result = 'PASS'\) FROM checks x\) AS overall_pass/.test(
    verifySql,
  ),
  false,
);
assert.ok(verifySql.includes("THEN 'PASS'"));
assert.ok(verifySql.includes("ELSE 'FAIL'"));

assert.ok(migration.includes("CREATE FUNCTION public.select_night_service_policy_v100("));
assert.ok(migration.includes(FN_IDENTITY) || migration.includes(FN_REGPROCEDURE));
assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.select_night_service_policy_v100"));
assert.ok(migration.includes("GRANT EXECUTE ON FUNCTION public.select_night_service_policy_v100"));
assert.equal(migration.includes("CREATE TABLE"), false);
assert.equal(migration.includes("CREATE TRIGGER"), false);
assert.equal(migration.includes("CREATE SEQUENCE"), false);
assert.equal(
  stripSqlComments(migration).includes(
    "CREATE FUNCTION public.select_night_service_policy_v101",
  ),
  false,
);

// ── Frozen paths ────────────────────────────────────────────────────────────
for (const path of FROZEN) {
  assert.equal(gitDiff(path), "", `frozen dirty: ${path}`);
}

assert.ok(ledger.includes("select_night_service_policy_v100"));
assert.ok(ledger.includes("2C.3C") || ledger.includes("v100"));

// ── Pure fixture selector ───────────────────────────────────────────────────
const T0 = NIGHT_POLICY_SELECTOR_TEST_INSTANT;
const known = NIGHT_POLICY_SELECTOR_KNOWN_TZ;

function base(
  overrides: Partial<NightPolicyFixtureRow> & { id: string },
): NightPolicyFixtureRow {
  return {
    country_code: "RS",
    region_code: null,
    timezone_name: "Europe/Belgrade",
    blocked_start_local: "22:00:00",
    blocked_end_local: "06:00:00",
    enabled: true,
    policy_version: 1,
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_until: null,
    ...overrides,
  };
}

{
  // exact region beats country default
  const rows = [
    base({ id: "c-default", region_code: null, policy_version: 9 }),
    base({ id: "r-exact", region_code: "VOJ", policy_version: 1 }),
  ];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: "VOJ",
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.policy_id, "r-exact");
}

{
  // no exact region → country default
  const rows = [
    base({ id: "c-default", region_code: null }),
    base({ id: "other-region", region_code: "NIS" }),
  ];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: "VOJ",
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.policy_id, "c-default");
}

{
  // disabled ignored
  const rows = [base({ id: "off", enabled: false })];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: null,
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out.length, 0);
}

{
  // future effective_from ignored
  const rows = [base({ id: "future", effective_from: "2027-01-01T00:00:00.000Z" })];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: null,
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out.length, 0);
}

{
  // evaluation_time == effective_from → selectable
  const rows = [base({ id: "at-from", effective_from: T0 })];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: null,
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.policy_id, "at-from");
}

{
  // evaluation_time == effective_until → not selectable
  const rows = [
    base({
      id: "at-until",
      effective_from: "2026-01-01T00:00:00.000Z",
      effective_until: T0,
    }),
  ];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: null,
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out.length, 0);
}

{
  // highest policy_version
  const rows = [
    base({ id: "v1", policy_version: 1 }),
    base({ id: "v3", policy_version: 3 }),
    base({ id: "v2", policy_version: 2 }),
  ];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: null,
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out[0]!.policy_id, "v3");
}

{
  // same version → later effective_from
  const rows = [
    base({
      id: "early",
      policy_version: 2,
      effective_from: "2026-02-01T00:00:00.000Z",
      effective_until: "2026-12-01T00:00:00.000Z",
    }),
    base({
      id: "late",
      policy_version: 2,
      effective_from: "2026-03-01T00:00:00.000Z",
      effective_until: "2026-12-01T00:00:00.000Z",
    }),
  ];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: null,
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out[0]!.policy_id, "late");
}

{
  // final tie-break id ASC
  const rows = [
    base({
      id: "b-id",
      policy_version: 2,
      effective_from: "2026-03-01T00:00:00.000Z",
      effective_until: "2026-12-01T00:00:00.000Z",
    }),
    base({
      id: "a-id",
      policy_version: 2,
      effective_from: "2026-03-01T00:00:00.000Z",
      effective_until: "2026-12-01T00:00:00.000Z",
    }),
  ];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: null,
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out[0]!.policy_id, "a-id");
}

{
  // timezone mismatch
  const rows = [base({ id: "paris", timezone_name: "Europe/Paris" })];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: null,
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out.length, 0);
}

{
  // country mismatch
  const rows = [base({ id: "hu", country_code: "HU" })];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: null,
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out.length, 0);
}

{
  // region param NULL must not select region row
  const rows = [base({ id: "regional", region_code: "VOJ" })];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: null,
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out.length, 0);
}

{
  // bounded overlap still deterministic (version then from then id)
  const rows = [
    base({
      id: "overlap-a",
      policy_version: 1,
      effective_from: "2026-01-01T00:00:00.000Z",
      effective_until: "2026-12-01T00:00:00.000Z",
    }),
    base({
      id: "overlap-b",
      policy_version: 1,
      effective_from: "2026-05-01T00:00:00.000Z",
      effective_until: "2026-12-01T00:00:00.000Z",
    }),
  ];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: null,
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out[0]!.policy_id, "overlap-b");
}

{
  // illegal inputs → zero
  const rows = [base({ id: "ok" })];
  const cases: Array<{
    countryCode: string | null;
    regionCode: string | null;
    originTimezone: string | null;
    evaluationTime: string | null;
  }> = [
    { countryCode: "rs", regionCode: null, originTimezone: "Europe/Belgrade", evaluationTime: T0 },
    { countryCode: " RS", regionCode: null, originTimezone: "Europe/Belgrade", evaluationTime: T0 },
    { countryCode: "RS ", regionCode: null, originTimezone: "Europe/Belgrade", evaluationTime: T0 },
    { countryCode: null, regionCode: null, originTimezone: "Europe/Belgrade", evaluationTime: T0 },
    { countryCode: "RS", regionCode: "", originTimezone: "Europe/Belgrade", evaluationTime: T0 },
    { countryCode: "RS", regionCode: "  ", originTimezone: "Europe/Belgrade", evaluationTime: T0 },
    { countryCode: "RS", regionCode: null, originTimezone: " Europe/Belgrade", evaluationTime: T0 },
    { countryCode: "RS", regionCode: null, originTimezone: "Not/A_Zone", evaluationTime: T0 },
    { countryCode: "RS", regionCode: null, originTimezone: null, evaluationTime: T0 },
    { countryCode: "RS", regionCode: null, originTimezone: "Europe/Belgrade", evaluationTime: null },
  ];
  for (const c of cases) {
    const out = selectNightServicePolicyV100Pure(rows, {
      ...c,
      knownTimezones: known,
    });
    assert.equal(out.length, 0, JSON.stringify(c));
  }
}

{
  // RS disabled seed shape → zero
  const rows = [
    base({
      id: "rs-seed",
      enabled: false,
      policy_version: 1,
      timezone_name: "Europe/Belgrade",
    }),
  ];
  const out = selectNightServicePolicyV100Pure(rows, {
    countryCode: "RS",
    regionCode: null,
    originTimezone: "Europe/Belgrade",
    evaluationTime: T0,
    knownTimezones: known,
  });
  assert.equal(out.length, 0);
}

// No Date.now() in pure module
const pureSrc = read("src/lib/safety/nightPolicySelectorV100.ts");
assert.equal(pureSrc.includes("Date.now("), false);
assert.equal(pureSrc.includes("new Date("), false);

// Client must not import selector SQL wrapper (there is none) / ensure no "use client" pulls
{
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
        files.push(full);
      }
    }
  }
  walk(join(repoRoot, "src"));
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const head = src.slice(0, 400);
    if (!head.includes('"use client"') && !head.includes("'use client'")) continue;
    assert.equal(
      src.includes("select_night_service_policy_v100"),
      false,
      file,
    );
  }
}

console.log("nightPolicySelectorV100.test.ts: ok");
