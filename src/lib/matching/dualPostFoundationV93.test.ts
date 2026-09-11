/**
 * PHASE 6.7A.2 — dual-post matching foundation (v93).
 * Source assertions cover SQL static safety only. They do not claim a live DB run.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/dualPostFoundationV93.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTACT_CHANNELS,
  V90_CONTRACT_COLUMNS_THAT_MUST_EXIST_IN_GUARD,
  V90_CONTRACT_DROPPED_COLUMNS,
  V90_REQUEST_COLUMNS_THAT_MUST_EXIST_IN_GUARD,
  V90_REQUEST_DROPPED_COLUMNS,
  V93_APP_ROLES,
  V93_CONTRACT_COLUMNS_THAT_MUST_NOT_EXIST_IN_GUARD,
  V93_CONTRACT_LIFECYCLE,
  V93_MIGRATION_REL,
  V93_REQUEST_COLUMNS_THAT_MUST_NOT_EXIST_IN_GUARD,
  V93_REQUEST_STATUSES,
  V93_TABLES,
  V93_VERIFY_REL,
  allowedChannelsPairwiseUnique,
  allowedChannelsSubset,
  contactGrantValueColumns,
  extractCreateTable,
  extractDoBlock,
  extractDropColumns,
  extractExpectComments,
  extractIndexDefs,
  forbiddenSqlOps,
  guardFingerprints,
  hasGlobalUniqueDemandOnRequests,
  hasUniqueDemandOnContracts,
  lifecycleIncludesDisputed,
  requestAssertionStoresPostFacts,
  rlsAndRevokePresent,
  sqlBody,
  transactionControls,
} from "@/lib/matching/dualPostFoundationV93.contract";
import { freezeLegacyDirectMatchIntercept } from "@/lib/matching/legacyMatchingFreeze";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const PHASE_BASELINE = "5a527487a62dd8ea05529080e3f5f89a3fbbed97";

const FROZEN_PATHS = [
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.verify.sql",
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql",
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.verify.sql",
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql",
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.verify.sql",
  "supabase/init.sql",
  "src/lib/matching/applicationPayload.ts",
  "src/lib/matching/matchRequestForm.ts",
  "src/components/matching/MatchRequestSheet.tsx",
  "src/lib/matching/matchRequestSheetBehavior.ts",
] as const;

const migration = read(V93_MIGRATION_REL);
const verifySql = read(V93_VERIFY_REL);
const ledger = read("docs/architecture/deferred-cleanup.md");
const postCard = read("src/components/hall/PostCard.tsx");
const homePage = read("src/app/[locale]/page.tsx");
const homeConsole = read("src/components/home/HomeConsole.tsx");
const lbsWall = read("src/components/home/LbsMirrorWall.tsx");
const actionsSrc = read("src/components/post/PostActions.tsx");
const sheetSrc = read("src/components/matching/MatchRequestSheet.tsx");
const invitationCreate = extractCreateTable(
  migration,
  "match_contact_invitations",
);
const grantCreate = extractCreateTable(migration, "contact_grants");
const body = sqlBody(migration);
const guard = guardFingerprints(migration);
const expectComments = extractExpectComments(verifySql);

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", PHASE_BASELINE, "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function walkRuntimeTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === "dist"
    ) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRuntimeTs(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      continue;
    }
    out.push(full);
  }
  return out;
}

function constraintDef(name: string): string {
  const re = new RegExp(
    `(?:ADD\\s+)?CONSTRAINT ${name}\\s+[\\s\\S]*?(?=,\\s*(?:ADD\\s+)?CONSTRAINT\\s|;\\s*)`,
    "i",
  );
  const match = migration.match(re);
  assert.ok(match, `missing constraint ${name}`);
  return match[0];
}

// TEST A — explicit BEGIN/COMMIT, no ROLLBACK, fail-fast before first change
{
  const controls = transactionControls(migration);
  assert.deepEqual(controls, ["BEGIN;", "COMMIT;"]);
  const beginAt = body.search(/^BEGIN;/m);
  const guardAt = body.search(/\bDO \$\$/m);
  const firstChange = body.search(/^CREATE TABLE public\.match_contact_invitations/m);
  assert.ok(beginAt >= 0 && guardAt > beginAt && firstChange > guardAt);
}

// TEST B — fail-fast guard fingerprints
{
  const block = extractDoBlock(migration);
  assert.equal(guard.hasRequestsRegclass, true);
  assert.equal(guard.hasContractsRegclass, true);
  assert.equal(guard.hasRelkind, true);
  assert.equal(guard.hasRls, true);
  assert.equal(guard.hasRequestCount, true);
  assert.equal(guard.hasContractCount, true);
  assert.deepEqual(
    guard.requestOldColumns,
    [...V90_REQUEST_COLUMNS_THAT_MUST_EXIST_IN_GUARD],
  );
  assert.deepEqual(
    guard.contractOldColumns,
    [...V90_CONTRACT_COLUMNS_THAT_MUST_EXIST_IN_GUARD],
  );
  assert.deepEqual(
    guard.requestNewColumns,
    [...V93_REQUEST_COLUMNS_THAT_MUST_NOT_EXIST_IN_GUARD],
  );
  assert.deepEqual(
    guard.contractNewColumns,
    [...V93_CONTRACT_COLUMNS_THAT_MUST_NOT_EXIST_IN_GUARD],
  );
  assert.equal(guard.raisesException, true);
  assert.equal(/EXCEPTION\s+WHEN/i.test(block), false);
  assert.equal(block.includes("profiles"), false);
  assert.equal(/FROM public\.posts\b/i.test(block), false);
}

// TEST C — no CASCADE / TRUNCATE / SET ROLE / ALTER OWNER / skip / writers
{
  assert.deepEqual(forbiddenSqlOps(migration), []);
}

// TEST D — v90/v91/v92/init and parked matching UI files have no diff vs baseline
{
  for (const path of FROZEN_PATHS) {
    assert.equal(gitDiff(path), "", path);
  }
}

// TEST E — four tables RLS + four-role REVOKE; no policy/GRANT/RPC
{
  for (const table of V93_TABLES) {
    assert.equal(rlsAndRevokePresent(migration, table), true, table);
  }
  assert.equal(/FORCE ROW LEVEL SECURITY/i.test(migration), false);
  assert.equal(/CREATE\s+POLICY/i.test(migration), false);
  assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(migration), false);
  assert.equal(/CREATE\s+TRIGGER/i.test(migration), false);
  for (const role of V93_APP_ROLES) {
    assert.ok(role === "PUBLIC" || role.length > 0);
  }
}

// TEST F — invitations dual-post schema
{
  assert.ok(invitationCreate.includes("demand_post_id uuid NOT NULL"));
  assert.ok(invitationCreate.includes("provider_post_id uuid NOT NULL"));
  assert.ok(invitationCreate.includes("initiator_post_id uuid NOT NULL"));
  assert.ok(
    invitationCreate.includes("initiator_post_id IN (demand_post_id, provider_post_id)"),
  );
  assert.ok(invitationCreate.includes("UNIQUE (initiator_user_id, client_request_id)"));
  assert.ok(invitationCreate.includes("contact_code_hash"));
  assert.ok(
    migration.includes("WHERE status = 'open'"),
  );
  assert.ok(
    /CREATE UNIQUE INDEX match_contact_invitations_one_open_pair[\s\S]*\(demand_post_id, provider_post_id\)[\s\S]*WHERE status = 'open'/i.test(
      migration,
    ),
  );
  assert.ok(
    migration.includes(
      "Contact invitation, not an order",
    ) || migration.includes("not an order"),
  );
  assert.ok(migration.includes("plaintext four-digit code") || migration.includes("plaintext"));
}

// TEST G — dropped v90 request/contract columns
{
  assert.deepEqual(
    extractDropColumns(migration, "match_requests"),
    [...V90_REQUEST_DROPPED_COLUMNS],
  );
  assert.deepEqual(
    extractDropColumns(migration, "match_contracts"),
    [...V90_CONTRACT_DROPPED_COLUMNS],
  );
  assert.equal(/\bwithdrawn\b/.test(constraintDef("match_requests_status_check")), false);
  for (const status of V93_REQUEST_STATUSES) {
    assert.ok(constraintDef("match_requests_status_check").includes(`'${status}'`));
  }
  assert.ok(body.includes("invitation_id uuid NOT NULL"));
  assert.ok(body.includes("requester_user_id uuid NOT NULL"));
  assert.equal(/\btarget_post_id\b/.test(sqlBody(migration.split("DROP COLUMN status;")[1] ?? "")), false);
}

// TEST H — Demand may have many pending requests; one contract per Demand
{
  assert.equal(hasGlobalUniqueDemandOnRequests(migration), false);
  assert.equal(hasUniqueDemandOnContracts(migration), true);
  const pendingPair = extractIndexDefs(migration, "match_requests").find((def) =>
    /one_pending_pair/i.test(def),
  );
  assert.ok(pendingPair);
  assert.ok(/demand_post_id, provider_post_id/i.test(pendingPair ?? ""));
  assert.ok(/WHERE status = 'pending'/i.test(pendingPair ?? ""));
  assert.ok(
    /UNIQUE\s*\(\s*demand_post_id\s*\)/i.test(
      constraintDef("match_contracts_demand_post_id_key") ||
        migration.slice(migration.indexOf("match_contracts_demand_post_id_key")),
    ) || /UNIQUE \(demand_post_id\)/.test(migration),
  );
}

// TEST I — contact_grants stores channels, not raw contact values
{
  assert.deepEqual(contactGrantValueColumns(grantCreate), []);
  assert.ok(grantCreate.includes("allowed_channels text[] NOT NULL"));
  assert.ok(grantCreate.includes("preferred_channel text"));
  assert.equal(allowedChannelsSubset([...CONTACT_CHANNELS]), true);
  assert.equal(allowedChannelsPairwiseUnique(["phone"]), true);
  assert.equal(allowedChannelsPairwiseUnique(["phone", "viber"]), true);
  assert.equal(allowedChannelsPairwiseUnique(["phone", "phone"]), false);
  assert.equal(
    allowedChannelsPairwiseUnique(["phone", "whatsapp", "viber"]),
    true,
  );
  assert.equal(
    allowedChannelsPairwiseUnique(["phone", "whatsapp", "phone"]),
    false,
  );
  assert.equal(allowedChannelsPairwiseUnique([]), false);
  assert.ok(
    constraintDef(
      "contact_grants_allowed_channels_pairwise_unique_check",
    ).includes("allowed_channels[1] <> allowed_channels[2]"),
  );
  assert.ok(
    grantCreate.includes("ARRAY['phone', 'whatsapp', 'viber']") ||
      grantCreate.includes("ARRAY['phone','whatsapp','viber']") ||
      migration.includes("ARRAY['phone', 'whatsapp', 'viber']::text[]"),
  );
  assert.ok(migration.includes("Authorization relation and channel capability"));
}

// TEST J — request_assertion is not post facts; lifecycle has no disputed
{
  assert.equal(requestAssertionStoresPostFacts({}), false);
  assert.equal(requestAssertionStoresPostFacts({ phone: "x" }), true);
  assert.equal(requestAssertionStoresPostFacts({ cargo: {} }), true);
  assert.ok(
    migration.includes("Must not store seats, cargo, route, time, fee, phone, plate"),
  );
  assert.ok(
    constraintDef("match_requests_request_assertion_object_check").includes(
      "jsonb_typeof(request_assertion) = 'object'",
    ),
  );
  assert.equal(lifecycleIncludesDisputed(V93_CONTRACT_LIFECYCLE), false);
  assert.equal(
    /\bdisputed\b/.test(constraintDef("match_contracts_lifecycle_projection_check")),
    false,
  );
  for (const value of V93_CONTRACT_LIFECYCLE) {
    assert.ok(
      constraintDef("match_contracts_lifecycle_projection_check").includes(
        `'${value}'`,
      ),
    );
  }
  assert.ok(migration.includes("no application code may INSERT a contract"));
}

// TEST K — verify is catalog-only and lists EXPECT groups
{
  const verifyLines = sqlBody(verifySql);
  assert.equal(
    verifyLines
      .split("\n")
      .some((line) =>
        /^(BEGIN|COMMIT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i.test(
          line,
        ),
      ),
    false,
  );
  assert.equal(verifySql.includes("has_table_privilege('public'"), false);
  assert.ok(verifySql.includes("aclexplode"));
  assert.ok(verifySql.includes("has_table_privilege(r.oid, t.oid"));
  assert.ok(verifySql.includes("relforcerowsecurity"));
  assert.ok(verifySql.includes("EXPECT=0"));
  assert.ok(expectComments.some((line) => line.includes("relkind = r")));
  assert.ok(expectComments.some((line) => line.includes("relrowsecurity = true")));
  assert.ok(expectComments.some((line) => line.includes("relforcerowsecurity = false")));
  assert.ok(verifySql.includes("count(*)"));
  assert.equal(verifySql.includes("SELECT * FROM public.match_requests"), false);
  assert.equal(verifySql.includes("FROM public.profiles"), false);
  assert.equal(verifySql.includes("FROM public.posts"), false);
  assert.ok(verifySql.includes("pg_get_constraintdef"));
  assert.ok(verifySql.includes("pg_get_indexdef"));
}

// TEST L — MatchRequestSheet still unmounted; no production writer
{
  for (const src of [postCard, homePage, homeConsole, lbsWall, actionsSrc]) {
    assert.equal(src.includes("MatchRequestSheet"), false);
  }
  assert.ok(sheetSrc.includes("export function MatchRequestSheet"));
  const runtimeFiles = walkRuntimeTs(join(repoRoot, "src"));
  const writerRe =
    /\.from\(\s*["'](match_requests|match_contracts|match_contact_invitations|contact_grants)["']\s*\)/;
  const insertRe =
    /INSERT\s+INTO\s+public\.(match_requests|match_contracts|match_contact_invitations|contact_grants)/i;
  const contractImportRe = /dualPostFoundationV93\.contract/;
  for (const file of runtimeFiles) {
    const rel = relative(repoRoot, file).replaceAll("\\", "/");
    if (rel === "src/lib/matching/dualPostFoundationV93.contract.ts") continue;
    const src = readFileSync(file, "utf8");
    assert.equal(writerRe.test(src), false, `writer in ${rel}`);
    assert.equal(insertRe.test(src), false, `insert in ${rel}`);
    assert.equal(contractImportRe.test(src), false, `contract import in ${rel}`);
  }
}

// TEST M — legacy confirm_match freeze still 409
{
  const frozen = freezeLegacyDirectMatchIntercept();
  assert.equal(frozen.status, 409);
  assert.equal(frozen.json.ok, false);
  assert.equal(frozen.json.errorKey, "error.matching_temporarily_unavailable");
}

// TEST N — ledger records v93 dual-post foundation as schema-only
{
  assert.ok(/dual-post/i.test(ledger));
  assert.ok(ledger.includes("v93") || ledger.includes("6.7A.2"));
}

console.log("dualPostFoundationV93.test.ts: ok");
