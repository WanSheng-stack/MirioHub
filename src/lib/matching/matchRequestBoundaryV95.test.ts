/**
 * PHASE 6.7C.1B.2A — v95 SQL / verify / freeze / PUBLIC ACL inventory.
 * Static catalog checks and pure ACL/policy-role helpers.
 * Inventory SQL has not been executed against PostgreSQL or Supabase.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/matchRequestBoundaryV95.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { MATCH_REQUEST_ERROR_KEYS } from "@/lib/matching/matchRequestCreateCore";
import { freezeLegacyDirectMatchIntercept } from "@/lib/matching/legacyMatchingFreeze";
import {
  extractDoBlock,
  sqlBody,
  transactionControls,
  verifyIsSingleResultSet,
} from "@/lib/matching/allocationEventFoundationV94.contract";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const PHASE_BASELINE = "c75a857f81b777f7849c6a4dc8554cbbe0207e09";
const V95_REL =
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql";
const V95_VERIFY_REL =
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.verify.sql";
const INVENTORY_REL =
  "supabase/migrations/20260911000003_v95_preapply_catalog_inventory.verify.sql";

const FROZEN_PATHS = [
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql",
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql",
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.sql",
  "supabase/migrations/20260911000002_matching_allocation_event_foundation_v94.sql",
  "supabase/init.sql",
  "src/components/matching/MatchRequestSheet.tsx",
  "src/components/hall/PostCard.tsx",
  "src/app/[locale]/page.tsx",
] as const;

const migration = read(V95_REL);
const verifySql = read(V95_VERIFY_REL);
const inventorySql = read(INVENTORY_REL);
const route = read("src/app/api/matching/requests/route.ts");
const ledger = read("docs/architecture/deferred-cleanup.md");
const zh = JSON.parse(read("src/messages/zh.json")) as { error: Record<string, string> };
const en = JSON.parse(read("src/messages/en.json")) as { error: Record<string, string> };
const sr = JSON.parse(read("src/messages/sr.json")) as { error: Record<string, string> };
const homeConsole = read("src/components/home/HomeConsole.tsx");
const sheet = read("src/components/matching/MatchRequestSheet.tsx");
const guard = extractDoBlock(migration);

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", PHASE_BASELINE, "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

type DirectAclAce = {
  grantee: number;
  privilege_type: string;
};

/** Mirrors inventory PUBLIC ACL: aclexplode + grantee = 0 only. */
function publicDirectAclGranted(
  relacl: DirectAclAce[] | null,
  aclDefaultPublic: DirectAclAce[],
  privilege: string,
): boolean {
  const entries = relacl ?? aclDefaultPublic;
  return entries.some(
    (ace) => ace.grantee === 0 && ace.privilege_type === privilege,
  );
}

/** Named roles: missing OID is role_missing, never false. */
function namedRolePrivilegeStatus(
  roleOid: number | null,
  hasPrivilege: boolean,
): "true" | "false" | "role_missing" {
  if (roleOid == null) return "role_missing";
  return hasPrivilege ? "true" : "false";
}

function policyRoleLabel(
  roleOid: number,
  rolname: string | null | undefined,
): string {
  if (roleOid === 0) return "PUBLIC";
  if (rolname != null && rolname !== "") return rolname;
  return `missing_oid:${roleOid}`;
}

function policyRolesFingerprint(
  roles: { oid: number; rolname: string | null | undefined }[],
): string {
  return roles
    .map((role) => policyRoleLabel(role.oid, role.rolname))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .join(",");
}

assert.deepEqual(transactionControls(migration), ["BEGIN;", "COMMIT;"]);
assert.equal(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(migration), false);
assert.equal(/\bCASCADE\b/.test(migration), false);
assert.equal(/\bSET\s+ROLE\b/i.test(migration), false);
assert.ok(migration.includes("CREATE TABLE public.match_request_revisions"));
assert.ok(migration.includes("CREATE FUNCTION public.create_match_request_v95"));
assert.ok(migration.includes("CREATE FUNCTION public.inspect_match_request_v95"));
assert.ok(migration.includes("CREATE FUNCTION public.read_match_request_candidate_snapshot_v95"));
assert.ok(migration.includes("CREATE FUNCTION public.match_request_admission_facts_hash_v95"));
assert.equal(/ADD\s+COLUMN\s+matching_contact_mode/i.test(migration), false);
assert.ok(sqlBody(migration).includes("'matching_contact_mode'"));
assert.equal(migration.includes("create_match_contact_invitation_v95("), false);
assert.equal(migration.includes("p_proposal_digest"), false);
assert.equal(migration.includes("p_quote_digest"), false);
assert.ok(migration.includes("idempotency_payload_hash text NOT NULL"));
assert.ok(migration.includes("match_requests_current_revision_pair_fkey"));
assert.ok(migration.includes("match_requests_accepted_revision_pair_fkey"));
assert.ok(migration.includes("UNIQUE (id, request_id)"));
assert.ok(migration.includes("p_idempotency_payload_hash"));
assert.ok(migration.includes("p_admission_facts_hash"));
assert.ok(migration.includes("^[1-9][0-9]{7,14}$"));
assert.ok(migration.includes("error.match_request_location_override_not_ready"));
assert.ok(migration.includes("error.match_request_not_current"));
assert.ok(migration.includes("'{\"v\":1}'::jsonb"));
assert.ok(migration.includes("matching_request_creation_enabled boolean NOT NULL DEFAULT false"));
assert.ok(migration.includes("DEFERRABLE INITIALLY DEFERRED"));
assert.equal(migration.includes("timezone('utc', now())"), false);
assert.ok(guard.includes("post-v94 live catalog fixture missing"));
assert.ok(guard.includes("run corrected 20260911000003_v95_preapply_catalog_inventory.verify.sql"));
assert.ok(guard.includes("v95 is not executable"));
assert.ok(guard.includes("btrim(regexp_replace"));
assert.equal(guard.includes("replace(n, '::text'"), false);
assert.equal(/INSERT\s+INTO\s+public\.match_contracts/i.test(migration), false);
assert.equal(/UPDATE\s+public\.posts/i.test(migration), false);

assert.equal(verifyIsSingleResultSet(verifySql), true);
assert.equal(/pg_get_functiondef/i.test(verifySql), false);
assert.ok(verifySql.includes("legacy contact rpc absent"));
assert.ok(verifySql.includes("creation enabled default false"));
assert.ok(verifySql.includes("idempotency payload hash column"));
assert.ok(verifySql.includes("composite current revision fk"));
assert.ok(verifySql.includes("writer omits unbound digest params"));
assert.ok(verifySql.includes("writer uses now not timezone utc"));
assert.ok(verifySql.includes("writer phone uses digit boundary"));
assert.ok(verifySql.includes("writer expires four layers"));
assert.ok(verifySql.includes("snapshot rpc count"));

function dollarBody(sql: string, tag: string): string {
  const token = `$${tag}$`;
  const start = sql.indexOf(token);
  if (start < 0) return "";
  const end = sql.indexOf(token, start + token.length);
  if (end < 0) return "";
  return sql.slice(start + token.length, end);
}

const snapshotBody = dollarBody(migration, "snap");
const hashBody = dollarBody(migration, "hash");
const factsBody = dollarBody(migration, "facts");
const writerBody = dollarBody(migration, "fn");
assert.ok(snapshotBody.includes("WITH pair AS MATERIALIZED"));
assert.ok(snapshotBody.includes("decorated AS MATERIALIZED"));
assert.equal(
  snapshotBody.split("FROM public.posts").length - 1,
  1,
);
assert.ok(snapshotBody.includes("jsonb_agg(d.fact ORDER BY d.id)"));
assert.ok(snapshotBody.includes("p_left_post_id IS DISTINCT FROM p_right_post_id"));
assert.ok(snapshotBody.includes("(SELECT count(*) FROM decorated) = 2"));
assert.equal(snapshotBody.includes("match_request_admission_facts_hash_v95(p_left_post_id"), false);
assert.equal(hashBody.includes("public.posts"), false);
assert.ok(hashBody.includes("digest("));
assert.equal(factsBody.includes("public.posts"), false);
assert.ok(factsBody.includes("jsonb_build_object"));
assert.ok(factsBody.includes("'origin_gps_ewkb'"));
assert.equal(factsBody.includes("|| '|' ||"), false);
assert.ok(writerBody.includes("FOR UPDATE"));
assert.ok(writerBody.includes("match_request_admission_post_facts_v95"));
assert.ok(writerBody.includes("match_request_admission_facts_hash_v95(v_facts)"));
assert.ok(
  writerBody.indexOf("match_request_admission_post_facts_v95") >
    writerBody.indexOf("FOR UPDATE"),
);

const inventoryStatements = sqlBody(inventorySql)
  .split(";")
  .map((part) => part.trim())
  .filter((part) => part.length > 0);
assert.equal(inventoryStatements.length, 1);
assert.equal(/has_table_privilege\s*\(\s*0\b/.test(inventorySql), false);
assert.equal(/has_table_privilege\s*\(\s*'PUBLIC'/i.test(inventorySql), false);
assert.equal(/has_table_privilege\s*\(\s*"PUBLIC"/i.test(inventorySql), false);
assert.ok(inventorySql.includes("aclexplode("));
assert.ok(inventorySql.includes("a.grantee = 0"));
assert.ok(inventorySql.includes('acldefault(\'r\'::"char", cls.relowner)'));
assert.ok(inventorySql.includes("c.relowner"));
assert.ok(inventorySql.includes("c.relacl"));
assert.ok(inventorySql.includes("WHEN role_oid = 0 THEN 'PUBLIC'"));
assert.ok(inventorySql.includes("'missing_oid:' || role_oid::text"));
assert.ok(
  inventorySql.includes(
    "string_agg(labeled.role_label, ',' ORDER BY labeled.role_label COLLATE \"C\")",
  ),
);
assert.ok(inventorySql.includes("pg_get_constraintdef(c.oid, false)"));
assert.ok(inventorySql.includes("pg_get_expr(ad.adbin, ad.adrelid)"));
assert.ok(inventorySql.includes("attidentity"));
assert.ok(inventorySql.includes("attgenerated"));
assert.ok(inventorySql.includes("condeferrable"));
assert.ok(inventorySql.includes("condeferred"));
assert.ok(inventorySql.includes("convalidated"));
assert.ok(inventorySql.includes("indisvalid"));
assert.ok(inventorySql.includes("indisready"));
assert.ok(inventorySql.includes("rls_policy"));
assert.ok(inventorySql.includes("rls_policy_count"));
assert.ok(inventorySql.includes("role_missing"));
assert.ok(inventorySql.includes("table_acl"));
assert.ok(inventorySql.includes("tgisinternal"));
assert.ok(inventorySql.includes("owned_sequence"));
assert.ok(inventorySql.includes("deptype IN ('a', 'i')"));
assert.ok(inventorySql.includes("expected function set empty"));
assert.ok(inventorySql.includes("pgcrypto"));
assert.ok(inventorySql.includes("postgis"));
assert.ok(inventorySql.includes("object_identity"));
assert.ok(inventorySql.includes("'column'"));
assert.ok(inventorySql.includes("'constraint'"));
assert.ok(inventorySql.includes("'independent_index'"));
assert.ok(inventorySql.includes("'trigger'"));
assert.ok(inventorySql.includes("'function_boundary'"));
assert.equal(/prosrc/i.test(inventorySql), false);
assert.equal(/posts\.origin_address|profiles\.phone/i.test(inventorySql), false);
assert.ok(inventorySql.includes("fail-closed"));
assert.ok(inventorySql.includes("ORDER BY"));
assert.ok(existsSync(join(repoRoot, INVENTORY_REL)));
assert.ok(verifySql.includes("snapshot single posts read"));
assert.ok(verifySql.includes("hash helper does not read posts"));
assert.ok(verifySql.includes("writer reuses facts helper after lock"));

assert.equal(
  publicDirectAclGranted(
    [{ grantee: 0, privilege_type: "SELECT" }],
    [],
    "SELECT",
  ),
  true,
);
assert.equal(
  publicDirectAclGranted(
    [{ grantee: 0, privilege_type: "INSERT" }],
    [],
    "SELECT",
  ),
  false,
);
assert.equal(
  publicDirectAclGranted(
    [{ grantee: 10, privilege_type: "SELECT" }],
    [],
    "SELECT",
  ),
  false,
);
assert.equal(
  publicDirectAclGranted(
    [{ grantee: 16384, privilege_type: "SELECT" }],
    [],
    "SELECT",
  ),
  false,
);
assert.equal(
  publicDirectAclGranted(null, [{ grantee: 0, privilege_type: "SELECT" }], "SELECT"),
  true,
);
assert.equal(publicDirectAclGranted(null, [], "SELECT"), false);
assert.equal(namedRolePrivilegeStatus(16384, true), "true");
assert.equal(namedRolePrivilegeStatus(16384, false), "false");
assert.equal(namedRolePrivilegeStatus(null, true), "role_missing");
assert.equal(namedRolePrivilegeStatus(null, false), "role_missing");
assert.notEqual(namedRolePrivilegeStatus(null, false), "false");
assert.equal(policyRoleLabel(0, null), "PUBLIC");
assert.equal(policyRoleLabel(0, "authenticated"), "PUBLIC");
assert.equal(policyRoleLabel(2200, "anon"), "anon");
assert.equal(policyRoleLabel(999001, null), "missing_oid:999001");
assert.equal(policyRoleLabel(999001, ""), "missing_oid:999001");
assert.equal(
  policyRolesFingerprint([
    { oid: 2200, rolname: "anon" },
    { oid: 0, rolname: null },
    { oid: 16384, rolname: "authenticated" },
  ]),
  "PUBLIC,anon,authenticated",
);
assert.equal(
  policyRolesFingerprint([
    { oid: 16384, rolname: "authenticated" },
    { oid: 2200, rolname: "anon" },
    { oid: 0, rolname: null },
  ]),
  policyRolesFingerprint([
    { oid: 0, rolname: null },
    { oid: 16384, rolname: "authenticated" },
    { oid: 2200, rolname: "anon" },
  ]),
);
assert.notEqual(policyRolesFingerprint([{ oid: 4242, rolname: null }]), "");
assert.equal(policyRolesFingerprint([{ oid: 4242, rolname: null }]), "missing_oid:4242");
assert.equal(policyRolesFingerprint([{ oid: 4242, rolname: undefined }]), "missing_oid:4242");

assert.ok(route.includes("create_match_request_v95"));
assert.ok(route.includes("read_match_request_candidate_snapshot_v95"));
assert.equal(route.includes("p_proposal_digest"), false);
assert.equal(
  /\.from\(\s*["'](match_requests|match_contracts|match_contact_invitations|contact_grants)["']/.test(
    route,
  ),
  false,
);

for (const key of MATCH_REQUEST_ERROR_KEYS) {
  const shortKey = key.replace(/^error\./, "");
  assert.ok(zh.error[shortKey], key);
  assert.ok(en.error[shortKey], key);
  assert.ok(sr.error[shortKey], key);
}

assert.equal(homeConsole.includes("MatchRequestSheet"), false);
assert.ok(sheet.includes("export function MatchRequestSheet"));
assert.equal(freezeLegacyDirectMatchIntercept().status, 409);

for (const path of FROZEN_PATHS) {
  assert.equal(gitDiff(path), "", path);
}
assert.equal(gitDiff(V95_REL), "", V95_REL);

assert.equal(
  readdirSync(join(repoRoot, "supabase/migrations")).some(
    (name) =>
      name.includes("_v96.") ||
      name.startsWith("20260911000004") ||
      name.includes("v96"),
  ),
  false,
);

const runtimeFiles: string[] = [];
function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
      runtimeFiles.push(full);
    }
  }
}
walk(join(repoRoot, "src"));
for (const file of runtimeFiles) {
  const rel = relative(repoRoot, file).replaceAll("\\", "/");
  const src = readFileSync(file, "utf8");
  assert.equal(src.includes("matching_contact_mode"), false, rel);
  assert.equal(src.includes("create_match_contact_invitation_v95"), false, rel);
}

assert.equal(
  existsSync(join(repoRoot, "src/app/api/matching/contact-invitations/route.ts")),
  false,
);
assert.equal(
  existsSync(join(repoRoot, "src/lib/matching/contactInvitationCreate.ts")),
  false,
);
assert.ok(ledger.includes("6.7C.1B.2A"));
assert.ok(ledger.includes("aclexplode"));
assert.ok(ledger.includes("missing_oid:<oid>"));

console.log("matchRequestBoundaryV95.test.ts: ok");
console.log("v95 SQL helper checks passed; migration is not applied remotely.");
