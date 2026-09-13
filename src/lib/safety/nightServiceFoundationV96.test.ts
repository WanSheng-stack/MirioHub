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
const V96_DDL_BASELINE = "eee56e7d10753692a322c1b0b26fe820d387fd2a";
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

function gitDiff(path: string, baseline = PHASE_BASELINE): string {
  return execFileSync("git", ["diff", baseline, "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

type IndexContract = {
  name: string;
  primary: boolean;
  unique: boolean;
  keys: string;
  predTokens: string[] | null;
};

const INDEX_CONTRACTS: readonly IndexContract[] = [
  {
    name: "night_service_policies_pkey",
    primary: true,
    unique: true,
    keys: "id",
    predTokens: null,
  },
  {
    name: "night_service_policies_lookup_idx",
    primary: false,
    unique: false,
    keys: "country_code,region_code,enabled",
    predTokens: null,
  },
  {
    name: "night_service_policies_effective_idx",
    primary: false,
    unique: false,
    keys: "effective_from,effective_until",
    predTokens: null,
  },
  {
    name: "night_service_policies_country_default_open_uidx",
    primary: false,
    unique: true,
    keys: "country_code",
    predTokens: ["region_code IS NULL", "effective_until IS NULL"],
  },
  {
    name: "night_service_policies_region_open_uidx",
    primary: false,
    unique: true,
    keys: "country_code,region_code",
    predTokens: ["region_code IS NOT NULL", "effective_until IS NULL"],
  },
  {
    name: "night_service_policies_country_default_version_uidx",
    primary: false,
    unique: true,
    keys: "country_code,policy_version",
    predTokens: ["region_code IS NULL"],
  },
  {
    name: "night_service_policies_region_version_uidx",
    primary: false,
    unique: true,
    keys: "country_code,region_code,policy_version",
    predTokens: ["region_code IS NOT NULL"],
  },
];

function indexContractPasses(
  observed: {
    name: string;
    primary: boolean;
    unique: boolean;
    keys: string;
    pred: string | null;
  },
  expected: IndexContract,
): boolean {
  if (observed.name !== expected.name) return false;
  if (observed.primary !== expected.primary) return false;
  if (observed.unique !== expected.unique) return false;
  if (observed.keys !== expected.keys) return false;
  if (expected.predTokens == null) return observed.pred == null;
  if (observed.pred == null) return false;
  return expected.predTokens.every((token) => observed.pred!.includes(token));
}

function extraUserIndexFails(names: readonly string[]): boolean {
  const allowed = new Set(INDEX_CONTRACTS.map((row) => row.name));
  return names.some((name) => !allowed.has(name));
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
assert.ok(migration.includes("night_service_policies_region_open_uidx"));
assert.ok(migration.includes("night_service_policies_country_default_version_uidx"));
assert.ok(migration.includes("night_service_policies_region_version_uidx"));
assert.ok(migration.includes("region_code IS NULL AND effective_until IS NULL"));
assert.ok(migration.includes("origin_timezone = btrim(origin_timezone)"));
assert.ok(migration.includes("region_code = btrim(region_code)"));
assert.ok(migration.includes("timezone_name = btrim(timezone_name)"));
assert.ok(migration.includes("do not fully prevent overlapping bounded intervals"));
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

const DANGEROUS_VALUES_ALIASES = new Set([
  "notnull",
  "default",
  "constraint",
  "primary",
  "references",
  "user",
  "current",
  "check",
  "trigger",
  "role",
  "policy",
  "type",
]);

function valuesAliasListIsDangerous(aliasCsv: string): boolean {
  return aliasCsv
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((name) => DANGEROUS_VALUES_ALIASES.has(name));
}

assert.equal(
  valuesAliasListIsDangerous("check_order, attname, typ, notnull, def"),
  true,
  "old alias list is dangerous",
);
assert.equal(
  valuesAliasListIsDangerous(
    "check_order, attname, expected_type, expected_not_null, expected_default",
  ),
  false,
  "new alias list is safe",
);
assert.equal(
  verifySql.includes("AS v(check_order, attname, typ, notnull, def)"),
  false,
);
assert.ok(verifySql.includes("expected_type"));
assert.ok(verifySql.includes("expected_not_null"));
assert.ok(verifySql.includes("expected_default"));
assert.ok(verifySql.includes("e.expected_type"));
assert.ok(verifySql.includes("e.expected_not_null"));
assert.ok(verifySql.includes("e.expected_default"));

const valuesAliasLists = [...verifySql.matchAll(/AS\s+v\s*\(([^)]+)\)/gi)].map(
  (match) => match[1],
);
assert.ok(valuesAliasLists.length > 0);
for (const aliasCsv of valuesAliasLists) {
  assert.equal(
    valuesAliasListIsDangerous(aliasCsv),
    false,
    `VALUES aliases must stay safe: ${aliasCsv}`,
  );
}

assert.equal(verifyIsSingleResultSet(verifySql), true);
assert.ok(verifySql.includes("creation enabled still false"));
assert.ok(verifySql.includes("RS country default"));
assert.ok(verifySql.includes("no new rpc"));
assert.ok(verifySql.includes("v95 writer still present"));
assert.ok(verifySql.includes("v95 hash still extensions.digest"));
assert.ok(verifySql.includes("pg_catalog.pg_attrdef"));
assert.ok(verifySql.includes("pg_get_constraintdef"));
assert.ok(verifySql.includes("pg_get_indexdef"));
assert.ok(verifySql.includes("posts_service_subtype_category_check"));
assert.ok(verifySql.includes("night_service_policies_pkey"));
assert.ok(verifySql.includes("indisvalid"));
assert.ok(verifySql.includes("indisready"));
assert.ok(verifySql.includes("night_service_policies_country_default_version_uidx"));
assert.ok(verifySql.includes("night_service_policies_region_version_uidx"));
assert.ok(verifySql.includes("aclexplode"));
assert.ok(verifySql.includes("grantee = 0"));
assert.ok(verifySql.includes("NULL::oid"));
assert.ok(verifySql.includes("'PUBLIC'::text"));
assert.ok(verifySql.includes("anon_oid, 'anon'::text"));
assert.ok(verifySql.includes("authenticated_oid, 'authenticated'::text"));
assert.ok(verifySql.includes("service_role_oid, 'service_role'::text"));
assert.equal(/\(\s*0\s*,\s*'PUBLIC'/.test(verifySql), false);
assert.equal(/VALUES\s*\(\s*0\s*,/.test(verifySql), false);
assert.equal(/has_table_privilege\s*\(\s*0\s*,/.test(verifySql), false);
assert.equal(/has_table_privilege\s*\(\s*0\b/.test(verifySql), false);
assert.equal(/has_table_privilege\s*\(\s*'PUBLIC'/i.test(verifySql), false);
assert.equal(/has_table_privilege\s*\(\s*"PUBLIC"/i.test(verifySql), false);
assert.ok(verifySql.includes("WHEN r.role_name = 'PUBLIC' THEN"));
assert.ok(verifySql.includes("FROM public_acl"));
assert.ok(verifySql.includes("unnest(i.indkey)"));
assert.ok(verifySql.includes("i.keys IS NOT DISTINCT FROM e.keys"));
assert.ok(verifySql.includes("i.indisprimary IS NOT DISTINCT FROM e.is_primary"));
assert.ok(verifySql.includes("'country_code,region_code,enabled'"));
assert.ok(verifySql.includes("'effective_from,effective_until'"));
assert.ok(verifySql.includes("'country_code,policy_version'"));
assert.ok(verifySql.includes("'country_code,region_code,policy_version'"));
assert.ok(verifySql.includes("no extra user indexes"));
assert.ok(verifySql.includes("relation does not exist"));
assert.ok(verifySql.includes("fail-closed"));
assert.ok(ledger.includes("errors at parse/plan time"));
assert.ok(verifySql.includes("'SELECT'"));
assert.ok(verifySql.includes("'INSERT'"));
assert.ok(verifySql.includes("'UPDATE'"));
assert.ok(verifySql.includes("'DELETE'"));
assert.ok(verifySql.includes("'TRUNCATE'"));
assert.ok(verifySql.includes("'REFERENCES'"));
assert.ok(verifySql.includes("'TRIGGER'"));
assert.ok(verifySql.includes("deptype IN ('a', 'i')"));
assert.equal(verifySql.includes("nullable-text"), false);
assert.equal(/pg_get_functiondef/i.test(verifySql), false);
assert.equal(/SELECT\s+public\.create_match_request_v95\s*\(/i.test(verifySql), false);
assert.equal(payload.includes("service_subtype?:"), false);
assert.ok(payload.includes("TRAVEL_SERVICE_SUBTYPES"));
assert.ok(helper.includes('if (mode == null || mode === "") return false'));
assert.equal(helper.includes("return !needsPeople"), false);
assert.ok(helper.includes("policy_version DESC"));
assert.ok(helper.includes("effective_from DESC"));
assert.ok(helper.includes("id ASC"));
assert.ok(ledger.includes("6.7C.2A"));
assert.ok(ledger.includes("night_service_policies"));
assert.ok(ledger.includes("v97"));
assert.ok(ledger.includes("overlapping bounded intervals"));

const techSpec = read(
  "docs/architecture/MirioHub_V1_Matching_Fulfillment_Technical_Spec_v2.md",
);
assert.ok(techSpec.includes("exact region_code"));
assert.ok(techSpec.includes("policy_version DESC"));
assert.ok(techSpec.includes("effective_from DESC"));
assert.ok(techSpec.includes("id ASC"));
assert.ok(techSpec.includes("overlapping bounded intervals"));
assert.ok(techSpec.includes("do not fully prevent"));

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

assert.equal(gitDiff(V96_REL, V96_DDL_BASELINE), "", "v96 migration must stay frozen");
assert.equal(
  gitDiff("src/lib/safety/nightServicePolicy.ts", V96_DDL_BASELINE),
  "",
);
assert.equal(
  gitDiff("src/lib/safety/nightServicePolicy.test.ts", V96_DDL_BASELINE),
  "",
);

const inventorySql = read(
  "supabase/migrations/20260911000003_v95_preapply_catalog_inventory.verify.sql",
);
assert.equal(/has_table_privilege\s*\(\s*0\b/.test(inventorySql), false);
assert.equal(/has_table_privilege\s*\(\s*'PUBLIC'/i.test(inventorySql), false);
assert.ok(inventorySql.includes("a.grantee = 0"));
assert.ok(inventorySql.includes("WHEN role_oid = 0 THEN 'PUBLIC'"));
assert.ok(inventorySql.includes("aclexplode("));

const lookup = INDEX_CONTRACTS.find((row) => row.name.endsWith("lookup_idx"));
const version = INDEX_CONTRACTS.find((row) =>
  row.name.endsWith("country_default_version_uidx"),
);
const openEnded = INDEX_CONTRACTS.find((row) =>
  row.name.endsWith("country_default_open_uidx"),
);
assert.ok(lookup && version && openEnded);
assert.equal(
  indexContractPasses(
    {
      name: lookup.name,
      primary: false,
      unique: false,
      keys: "country_code,enabled",
      pred: null,
    },
    lookup,
  ),
  false,
  "lookup missing region_code must fail",
);
assert.equal(
  indexContractPasses(
    {
      name: version.name,
      primary: false,
      unique: true,
      keys: "country_code,enabled",
      pred: "region_code IS NULL",
    },
    version,
  ),
  false,
  "version index swapping policy_version for enabled must fail",
);
assert.equal(
  indexContractPasses(
    {
      name: openEnded.name,
      primary: false,
      unique: true,
      keys: "country_code",
      pred: "region_code IS NULL",
    },
    openEnded,
  ),
  false,
  "open-ended missing effective_until IS NULL must fail",
);
assert.equal(
  indexContractPasses(
    {
      name: lookup.name,
      primary: false,
      unique: false,
      keys: "enabled,region_code,country_code",
      pred: null,
    },
    lookup,
  ),
  false,
  "reversed lookup keys must fail",
);
assert.equal(
  extraUserIndexFails([
    ...INDEX_CONTRACTS.map((row) => row.name),
    "night_service_policies_ghost_idx",
  ]),
  true,
  "unknown extra index must fail",
);
assert.equal(
  extraUserIndexFails(INDEX_CONTRACTS.map((row) => row.name)),
  false,
);
assert.equal(
  indexContractPasses(
    {
      name: lookup.name,
      primary: lookup.primary,
      unique: lookup.unique,
      keys: lookup.keys,
      pred: null,
    },
    lookup,
  ),
  true,
);
assert.equal(/\(\s*0\s*,\s*'PUBLIC'/.test(verifySql), false, "PUBLIC must not use OID 0");
assert.ok(verifySql.includes("(NULL::oid, 'PUBLIC'::text)"));

console.log("nightServiceFoundationV96.test.ts: ok");
console.log("v96 SQL is not applied remotely.");
