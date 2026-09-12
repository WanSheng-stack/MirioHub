/**
 * PHASE 6.7C.1 — v95 SQL / verify / freeze / i18n.
 * Static SQL + helper coverage. This is not a live RPC apply.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/contactInvitationBoundaryV95.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTACT_INVITATION_ERROR_KEYS } from "@/lib/matching/contactInvitationCreate";
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
const PHASE_BASELINE = "f3a28559f61a64b27f9675326593d1f5a6c293cf";
const V95_REL =
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql";
const V95_VERIFY_REL =
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.verify.sql";

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
const route = read("src/app/api/matching/contact-invitations/route.ts");
const ledger = read("docs/architecture/deferred-cleanup.md");
const zh = JSON.parse(read("src/messages/zh.json")) as { error: Record<string, string> };
const en = JSON.parse(read("src/messages/en.json")) as { error: Record<string, string> };
const sr = JSON.parse(read("src/messages/sr.json")) as { error: Record<string, string> };
const postCard = read("src/components/hall/PostCard.tsx");
const homePage = read("src/app/[locale]/page.tsx");
const homeConsole = read("src/components/home/HomeConsole.tsx");
const sheet = read("src/components/matching/MatchRequestSheet.tsx");
const guard = extractDoBlock(migration);
const body = sqlBody(migration);

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", PHASE_BASELINE, "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function walkRuntimeTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRuntimeTs(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
    out.push(full);
  }
  return out;
}

assert.deepEqual(transactionControls(migration), ["BEGIN;", "COMMIT;"]);
assert.ok(body.search(/\bDO \$\$/m) > body.search(/^BEGIN;/m));
assert.ok(
  body.search(/^ALTER TABLE public\.system_configs/m) >
    body.search(/\bDO \$\$/m),
);
assert.equal(/\bCASCADE\b/.test(body), false);
assert.equal(/\bSET\s+ROLE\b/i.test(body), false);
assert.equal(/\bALTER\s+OWNER\b/i.test(body), false);
assert.equal(/\bEXCEPTION\s+WHEN\b/i.test(body), false);
assert.equal(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(migration), false);
assert.ok(migration.includes("CREATE FUNCTION public.create_match_contact_invitation_v95"));
assert.ok(guard.includes("match_contact_invitations"));
assert.ok(guard.includes("safety_checklist_acceptance_items"));
assert.ok(guard.includes("relrowsecurity"));
assert.ok(guard.includes("relforcerowsecurity"));
assert.ok(guard.includes("count(*)"));
assert.ok(guard.includes("to_regprocedure"));
assert.equal(/FROM public\.posts\b/i.test(guard), false);
assert.equal(/FROM public\.profiles\b/i.test(guard), false);

assert.ok(migration.includes("matching_contact_mode text NOT NULL DEFAULT 'cold_start'"));
assert.ok(migration.includes("matching_contact_policy_version integer NOT NULL DEFAULT 1"));
assert.ok(
  migration.includes(
    "matching_contact_invitation_ttl_minutes integer NOT NULL DEFAULT 1440",
  ),
);
assert.ok(
  migration.includes(
    "matching_contact_max_open_per_initiator_post integer NOT NULL DEFAULT 20",
  ),
);
assert.ok(
  migration.includes(
    "matching_contact_max_created_per_actor_24h integer NOT NULL DEFAULT 50",
  ),
);
assert.ok(migration.includes("v_now timestamptz := now()"));
assert.equal(migration.includes("timezone('utc', now())"), false);
assert.ok(migration.includes("CREATE FUNCTION public.inspect_match_contact_invitation_v95"));
assert.ok(migration.includes("existing_for_client_request boolean"));
assert.ok(migration.includes("matching_route_max_extra_detour_km numeric(6, 2) NOT NULL DEFAULT 30"));
assert.ok(migration.includes("matching_route_max_extra_detour_ratio numeric(4, 3) NOT NULL DEFAULT 0.5"));
assert.ok(migration.includes("p_admission_digest text"));
assert.equal(migration.includes("existing_invitation_id"), false);
assert.equal(extractInspectBody(migration).includes("INSERT"), false);
assert.equal(extractInspectBody(migration).includes("UPDATE"), false);
assert.equal(extractInspectBody(migration).includes("DELETE"), false);
assert.ok(migration.includes("pg_catalog.hashtext('v95_actor:'"));
assert.ok(migration.includes("SECURITY DEFINER"));
assert.ok(migration.includes("SET search_path = pg_catalog, public"));
assert.ok(migration.includes("ORDER BY p.id"));
assert.ok(migration.includes("FOR UPDATE"));
assert.ok(migration.includes("FROM public.posts p"));
assert.ok(migration.includes("FROM public.system_configs c"));
assert.ok(migration.includes("v_init_type = 'demand'"));
assert.ok(migration.includes("v_provider := p_initiator_post_id"));
assert.ok(migration.includes("recipient_user_id"));
assert.ok(migration.includes("v_ctr_user"));
assert.ok(migration.includes("mutual_eligible_contact"));
assert.ok(migration.includes("recipient_contacts_initiator"));
assert.ok(migration.includes("make_interval(mins => v_ttl)"));
assert.ok(migration.includes("status = 'expired'"));
assert.ok(migration.includes("created := false"));
assert.ok(migration.includes("created := true"));
assert.equal(/INSERT\s+INTO\s+public\.contact_grants/i.test(migration), false);
assert.equal(/INSERT\s+INTO\s+public\.match_requests/i.test(migration), false);
assert.equal(/INSERT\s+INTO\s+public\.match_contracts/i.test(migration), false);
assert.equal(/INSERT\s+INTO\s+public\.contract_allocations/i.test(migration), false);
assert.equal(/INSERT\s+INTO\s+public\.fraud_logs/i.test(migration), false);
assert.equal(/UPDATE\s+public\.posts/i.test(migration), false);
assert.equal(/\bphone\b/i.test(extractFunctionBody(migration)), false);
assert.equal(/\bviber\b/i.test(extractFunctionBody(migration)), false);
assert.equal(/\bfacebook\b/i.test(extractFunctionBody(migration)), false);
assert.equal(/\bplate\b/i.test(extractFunctionBody(migration)), false);

assert.ok(
  migration.includes(
    "REVOKE ALL ON FUNCTION public.create_match_contact_invitation_v95(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC",
  ),
);
assert.ok(
  migration.includes(
    "REVOKE ALL ON FUNCTION public.create_match_contact_invitation_v95(uuid, uuid, uuid, uuid, text, text) FROM anon",
  ),
);
assert.ok(
  migration.includes(
    "REVOKE ALL ON FUNCTION public.create_match_contact_invitation_v95(uuid, uuid, uuid, uuid, text, text) FROM authenticated",
  ),
);
assert.ok(
  migration.includes(
    "GRANT EXECUTE ON FUNCTION public.create_match_contact_invitation_v95(uuid, uuid, uuid, uuid, text, text) TO service_role",
  ),
);

assert.equal(verifyIsSingleResultSet(verifySql), true);
assert.equal(/pg_get_functiondef/i.test(verifySql), false);
assert.equal(verifySql.includes("SELECT * FROM public.posts"), false);
assert.equal(verifySql.includes("FROM public.profiles"), false);
assert.equal(
  sqlBody(verifySql).includes("bank_account") ||
    sqlBody(verifySql).includes("bank_reference"),
  false,
);
assert.ok(verifySql.includes("matching_route_max_extra_detour_km"));
assert.ok(verifySql.includes("matching_route_max_extra_detour_ratio"));
assert.ok(verifySql.includes("existing_for_client_request"));
assert.ok(verifySql.includes("inspect does not write") || verifySql.includes("inspect does not write"));
assert.ok(verifySql.includes("idempotency before post status"));
assert.ok(verifySql.includes("has_function_privilege"));
assert.ok(verifySql.includes("service_role_oid"));
assert.ok(verifySql.includes("WHEN (SELECT anon_oid FROM roles) IS NULL THEN NULL"));
assert.ok(verifySql.includes("prosecdef"));
assert.ok(verifySql.includes("provolatile"));
assert.ok(
  verifySql.includes("insert\\s+into\\s+public\\.match_contact_invitations"),
);
assert.equal(
  verifySql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"))
    .some((line) =>
      /^(BEGIN|COMMIT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i.test(
        line,
      ),
    ),
  false,
);

function extractFunctionBody(sql: string): string {
  const start = sql.indexOf("AS $fn$");
  const end = sql.indexOf("$fn$;", start + 1);
  return start >= 0 && end > start ? sql.slice(start, end) : "";
}

function extractInspectBody(sql: string): string {
  const start = sql.indexOf("AS $inspect$");
  const end = sql.indexOf("$inspect$;", start + 1);
  return start >= 0 && end > start ? sql.slice(start, end) : "";
}

assert.ok(route.includes("create_match_contact_invitation_v95"));
assert.ok(route.includes("getUser"));
assert.ok(route.includes("createAdminClient"));
assert.ok(route.includes("inspect_match_contact_invitation_v95"));
assert.ok(route.includes("scoreOfficialContactInvitationRoute"));
assert.ok(route.includes("p_admission_digest"));
assert.ok(route.includes("loadMatchAdmissionThresholds"));
assert.equal(route.includes("existing_invitation_id"), false);
assert.ok(route.includes('.from("posts")'));
assert.equal(route.includes("disclosure_mode"), false);
assert.equal(
  /\.from\(\s*["'](match_requests|match_contracts|match_contact_invitations|contact_grants)["']/.test(
    route,
  ),
  false,
);

for (const key of CONTACT_INVITATION_ERROR_KEYS) {
  const shortKey = key.replace(/^error\./, "");
  assert.ok(zh.error[shortKey], key);
  assert.ok(en.error[shortKey], key);
  assert.ok(sr.error[shortKey], key);
  for (const text of [zh.error[shortKey], en.error[shortKey], sr.error[shortKey]]) {
    assert.equal(/match_contact_invitations|pg_|uuid|hash/i.test(text), false, text);
  }
}

for (const src of [postCard, homePage, homeConsole]) {
  assert.equal(src.includes("MatchRequestSheet"), false);
  assert.equal(src.includes("contact-invitations"), false);
}
assert.ok(sheet.includes("export function MatchRequestSheet"));

const frozen = freezeLegacyDirectMatchIntercept();
assert.equal(frozen.status, 409);
assert.equal(frozen.json.errorKey, "error.matching_temporarily_unavailable");

for (const path of FROZEN_PATHS) {
  assert.equal(gitDiff(path), "", path);
}

const runtimeFiles = walkRuntimeTs(join(repoRoot, "src"));
const tableFrom = /\.from\(\s*["'](match_requests|match_contracts|match_contact_invitations|contact_grants)["']\s*\)/;
const tableInsert =
  /INSERT\s+INTO\s+public\.(match_requests|match_contracts|match_contact_invitations|contact_grants)/i;
for (const file of runtimeFiles) {
  const rel = relative(repoRoot, file).replaceAll("\\", "/");
  const src = readFileSync(file, "utf8");
  assert.equal(tableFrom.test(src), false, rel);
  assert.equal(tableInsert.test(src), false, rel);
  if (rel !== "src/lib/matching/dualPostFoundationV93.contract.ts") {
    assert.equal(src.includes("dualPostFoundationV93.contract"), false, rel);
  }
}

assert.ok(ledger.includes("6.7C.1") || ledger.includes("contact invitation"));
assert.equal(
  readdirSync(join(repoRoot, "supabase/migrations")).some(
    (name) =>
      name.startsWith("20260911000004") ||
      name.includes("_v96.") ||
      name.includes("contact_invitation_boundary_v96"),
  ),
  false,
);

console.log("contactInvitationBoundaryV95.test.ts: ok");
console.log(
  "v95 SQL helper and static catalog checks passed; migration is not applied remotely.",
);
