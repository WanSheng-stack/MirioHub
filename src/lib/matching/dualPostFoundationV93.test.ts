/**
 * PHASE 6.7A.2 / 6.7A.2A — dual-post matching foundation (v93).
 * Helpers execute schema-contract logic. They do not claim a live DB run.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/dualPostFoundationV93.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  V90_CONTRACT_DROPPED_COLUMNS,
  V90_CONTRACT_FINGERPRINT,
  V90_MIGRATION_REL,
  V90_REQUEST_DROPPED_COLUMNS,
  V90_REQUEST_FINGERPRINT,
  V93_APP_ROLES,
  V93_CONTRACT_LIFECYCLE,
  V93_FORBIDDEN_TABLES,
  V93_MIGRATION_REL,
  V93_REQUEST_STATUSES,
  V93_TABLES,
  V93_VERIFY_REL,
  allowedChannelsContractHolds,
  cloneFingerprint,
  contactGrantValueColumns,
  createTableColumnNames,
  diffTableFingerprint,
  extractCreateTable,
  extractDoBlock,
  extractDropColumns,
  extractExpectComments,
  extractIndexDefs,
  extractIndexNames,
  extractNamedConstraints,
  fingerprintFailClosed,
  forbiddenSqlOps,
  hasGlobalUniqueDemandOnRequests,
  hasUniqueDemandOnContracts,
  invitationTimestampInvariant,
  lifecycleIncludesDisputed,
  parseDollarJson,
  requestAssertionStoresPostFacts,
  rlsAndRevokePresent,
  sqlBody,
  tableFingerprintFromGuardJson,
  transactionControls,
  verifyScansFunctionsByRegex,
  verifyUsesOwnedSequences,
  type ChannelArrayShape,
} from "@/lib/matching/dualPostFoundationV93.contract";
import { freezeLegacyDirectMatchIntercept } from "@/lib/matching/legacyMatchingFreeze";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const PHASE_BASELINE = "8b9d1a60e6d0c3a7102642b5bc2cb1749c350a57";

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
const v90Sql = read(V90_MIGRATION_REL);
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
const expectComments = extractExpectComments(verifySql);
const guardJsonRequests = tableFingerprintFromGuardJson(
  parseDollarJson(migration, "v90_requests_fp"),
);
const guardJsonContracts = tableFingerprintFromGuardJson(
  parseDollarJson(migration, "v90_contracts_fp"),
);

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

const channels = (values: Array<string | null>, extra: Partial<ChannelArrayShape> = {}): ChannelArrayShape => ({
  ndims: 1,
  lower: 1,
  values,
  ...extra,
});

// TEST A — explicit BEGIN/COMMIT, guard before first DDL
{
  const controls = transactionControls(migration);
  assert.deepEqual(controls, ["BEGIN;", "COMMIT;"]);
  const beginAt = body.search(/^BEGIN;/m);
  const guardAt = body.search(/\bDO \$\$/m);
  const firstChange = body.search(/^CREATE TABLE public\.match_contact_invitations/m);
  assert.ok(beginAt >= 0 && guardAt > beginAt && firstChange > guardAt);
}

// TEST B — guard JSON matches v90 fingerprint constants sourced from frozen v90
{
  assert.deepEqual(guardJsonRequests, V90_REQUEST_FINGERPRINT);
  assert.deepEqual(guardJsonContracts, V90_CONTRACT_FINGERPRINT);
  const v90ReqCreate = extractCreateTable(v90Sql, "match_requests");
  const v90ConCreate = extractCreateTable(v90Sql, "match_contracts");
  assert.deepEqual(
    createTableColumnNames(v90ReqCreate),
    V90_REQUEST_FINGERPRINT.columns.map((column) => column.name),
  );
  assert.deepEqual(
    createTableColumnNames(v90ConCreate),
    V90_CONTRACT_FINGERPRINT.columns.map((column) => column.name),
  );
  assert.deepEqual(
    extractIndexNames(v90Sql, "match_requests"),
    V90_REQUEST_FINGERPRINT.indexes.map((index) => index.name),
  );
  assert.deepEqual(
    extractIndexNames(v90Sql, "match_contracts"),
    V90_CONTRACT_FINGERPRINT.indexes.map((index) => index.name),
  );
  for (const name of extractNamedConstraints(v90ReqCreate)) {
    assert.ok(
      V90_REQUEST_FINGERPRINT.constraints.some((item) => item.name === name),
      name,
    );
  }
  for (const name of extractNamedConstraints(v90ConCreate)) {
    assert.ok(
      V90_CONTRACT_FINGERPRINT.constraints.some((item) => item.name === name),
      name,
    );
  }
}

// TEST B2 — catalog fixture comparison fail-closes on missing/extra objects
{
  assert.deepEqual(
    diffTableFingerprint(
      "match_requests",
      V90_REQUEST_FINGERPRINT,
      cloneFingerprint(V90_REQUEST_FINGERPRINT),
    ),
    [],
  );

  const missingCol = cloneFingerprint(V90_REQUEST_FINGERPRINT);
  missingCol.columns = missingCol.columns.filter(
    (column) => column.name !== "application_payload",
  );
  const missingColDiff = diffTableFingerprint(
    "match_requests",
    V90_REQUEST_FINGERPRINT,
    missingCol,
  );
  assert.equal(fingerprintFailClosed(missingColDiff), true);
  assert.ok(
    missingColDiff.some(
      (item) =>
        item.kind === "column" &&
        item.issue === "missing" &&
        item.object === "application_payload",
    ),
  );

  const extraCol = cloneFingerprint(V90_REQUEST_FINGERPRINT);
  extraCol.columns = [
    ...extraCol.columns,
    {
      name: "invitation_id",
      type: "uuid",
      not_null: true,
      default_norm: "",
    },
  ];
  const extraColDiff = diffTableFingerprint(
    "match_requests",
    V90_REQUEST_FINGERPRINT,
    extraCol,
  );
  assert.ok(
    extraColDiff.some(
      (item) =>
        item.kind === "column" &&
        item.issue === "extra" &&
        item.object === "invitation_id",
    ),
  );

  const colAttr = cloneFingerprint(V90_REQUEST_FINGERPRINT);
  colAttr.columns = colAttr.columns.map((column) =>
    column.name === "status"
      ? { ...column, type: "integer", not_null: false, default_norm: "" }
      : column,
  );
  assert.ok(
    diffTableFingerprint(
      "match_requests",
      V90_REQUEST_FINGERPRINT,
      colAttr,
    ).some(
      (item) =>
        item.kind === "column" &&
        item.issue === "mismatch" &&
        item.object === "status",
    ),
  );

  const extraCon = cloneFingerprint(V90_REQUEST_FINGERPRINT);
  extraCon.constraints = [
    ...extraCon.constraints,
    { name: "match_requests_v93_only", type: "c", def: "CHECK (true)" },
  ];
  assert.ok(
    diffTableFingerprint(
      "match_requests",
      V90_REQUEST_FINGERPRINT,
      extraCon,
    ).some(
      (item) =>
        item.kind === "constraint" &&
        item.issue === "extra" &&
        item.object === "match_requests_v93_only",
    ),
  );

  const missingCon = cloneFingerprint(V90_REQUEST_FINGERPRINT);
  missingCon.constraints = missingCon.constraints.filter(
    (item) => item.name !== "match_requests_status_check",
  );
  assert.ok(
    diffTableFingerprint(
      "match_requests",
      V90_REQUEST_FINGERPRINT,
      missingCon,
    ).some(
      (item) =>
        item.kind === "constraint" &&
        item.issue === "missing" &&
        item.object === "match_requests_status_check",
    ),
  );

  const extraIdx = cloneFingerprint(V90_CONTRACT_FINGERPRINT);
  extraIdx.indexes = [
    ...extraIdx.indexes,
    {
      name: "match_contracts_mystery_idx",
      def: "CREATE INDEX match_contracts_mystery_idx ON match_contracts USING btree (id)",
    },
  ];
  assert.ok(
    diffTableFingerprint(
      "match_contracts",
      V90_CONTRACT_FINGERPRINT,
      extraIdx,
    ).some(
      (item) =>
        item.kind === "index" &&
        item.issue === "extra" &&
        item.object === "match_contracts_mystery_idx",
    ),
  );

  const missingIdx = cloneFingerprint(V90_REQUEST_FINGERPRINT);
  missingIdx.indexes = missingIdx.indexes.filter(
    (item) => item.name !== "match_requests_one_pending_per_applicant_target",
  );
  assert.ok(
    diffTableFingerprint(
      "match_requests",
      V90_REQUEST_FINGERPRINT,
      missingIdx,
    ).some(
      (item) =>
        item.kind === "index" &&
        item.issue === "missing" &&
        item.object === "match_requests_one_pending_per_applicant_target",
    ),
  );

  const rlsOff = cloneFingerprint(V90_REQUEST_FINGERPRINT);
  rlsOff.relrowsecurity = false;
  assert.ok(
    diffTableFingerprint(
      "match_requests",
      V90_REQUEST_FINGERPRINT,
      rlsOff,
    ).some((item) => item.kind === "rls" && item.object === "relrowsecurity"),
  );

  const forceOn = cloneFingerprint(V90_REQUEST_FINGERPRINT);
  forceOn.relforcerowsecurity = true;
  assert.ok(
    diffTableFingerprint(
      "match_requests",
      V90_REQUEST_FINGERPRINT,
      forceOn,
    ).some(
      (item) => item.kind === "rls" && item.object === "relforcerowsecurity",
    ),
  );
}

// TEST B3 — SQL guard actually inspects exact catalog classes
{
  const block = extractDoBlock(migration);
  assert.equal(/EXCEPTION\s+WHEN/i.test(block), false);
  assert.ok(block.includes("format_type(a.atttypid, a.atttypmod)"));
  assert.ok(block.includes("a.attnotnull"));
  assert.ok(block.includes("pg_get_expr(ad.adbin, ad.adrelid)"));
  assert.ok(block.includes("pg_get_constraintdef"));
  assert.ok(block.includes("pg_get_indexdef"));
  assert.ok(block.includes("relforcerowsecurity"));
  assert.ok(block.includes("relrowsecurity"));
  assert.ok(block.includes("count(*)"));
  assert.ok(block.includes("co.conindid = i.indexrelid"));
  for (const table of V93_FORBIDDEN_TABLES) {
    assert.ok(block.includes(`table fingerprint extra: ${table}`));
  }
  assert.ok(block.includes("column fingerprint missing"));
  assert.ok(block.includes("column fingerprint extra"));
  assert.ok(block.includes("constraint fingerprint missing"));
  assert.ok(block.includes("constraint fingerprint extra"));
  assert.ok(block.includes("index fingerprint missing"));
  assert.ok(block.includes("index fingerprint extra"));
  assert.equal(/FROM public\.posts\b/i.test(block), false);
  assert.equal(/FROM public\.profiles\b/i.test(block), false);
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
  assert.ok(
    invitationCreate.includes("initiator_post_id IN (demand_post_id, provider_post_id)"),
  );
  assert.ok(invitationCreate.includes("UNIQUE (initiator_user_id, client_request_id)"));
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
}

// TEST I — allowed_channels contract rejects 2D/NULL/non-1-lower/empty/oversize/foreign/dupes
{
  const check = constraintDef("contact_grants_allowed_channels_contract_check");
  assert.ok(check.includes("array_ndims(allowed_channels) = 1"));
  assert.ok(check.includes("array_lower(allowed_channels, 1) = 1"));
  assert.ok(check.includes("array_position(allowed_channels, NULL) IS NULL"));
  assert.ok(check.includes("cardinality(allowed_channels) BETWEEN 1 AND 3"));
  assert.ok(check.includes("preferred_channel = ANY (allowed_channels)"));
  assert.ok(grantCreate.includes("preferred_channel text NOT NULL"));
  assert.deepEqual(contactGrantValueColumns(grantCreate), []);

  assert.equal(
    allowedChannelsContractHolds(channels(["phone"], { ndims: 2 }), "phone"),
    false,
  );
  assert.equal(
    allowedChannelsContractHolds(channels(["phone", null]), "phone"),
    false,
  );
  assert.equal(
    allowedChannelsContractHolds(channels(["phone"], { lower: 0 }), "phone"),
    false,
  );
  assert.equal(allowedChannelsContractHolds(channels([]), "phone"), false);
  assert.equal(
    allowedChannelsContractHolds(
      channels(["phone", "whatsapp", "viber", "phone"]),
      "phone",
    ),
    false,
  );
  assert.equal(
    allowedChannelsContractHolds(channels(["telegram"]), "telegram"),
    false,
  );
  assert.equal(
    allowedChannelsContractHolds(channels(["phone", "phone"]), "phone"),
    false,
  );
  assert.equal(
    allowedChannelsContractHolds(channels(["phone", "viber"]), "whatsapp"),
    false,
  );
  assert.equal(allowedChannelsContractHolds(channels(["phone"]), null), false);
  assert.equal(allowedChannelsContractHolds(channels(["phone"]), "phone"), true);
  assert.equal(
    allowedChannelsContractHolds(channels(["phone", "viber"]), "viber"),
    true,
  );
  assert.equal(
    allowedChannelsContractHolds(
      channels(["phone", "whatsapp", "viber"]),
      "whatsapp",
    ),
    true,
  );
}

// TEST I2 — invitation status / terminal timestamps bidirectional truth table
{
  const converted = constraintDef(
    "match_contact_invitations_converted_ts_consistent",
  );
  const invalid = constraintDef(
    "match_contact_invitations_invalid_ts_consistent",
  );
  const exclusive = constraintDef(
    "match_contact_invitations_converted_invalid_exclusive",
  );
  assert.ok(converted.includes("(status = 'converted') = (converted_at IS NOT NULL)"));
  assert.ok(
    invalid.includes("(status IN ('invalidated', 'expired', 'blocked'))"),
  );
  assert.ok(invalid.includes("= (invalidated_at IS NOT NULL)"));
  assert.ok(exclusive.includes("converted_at IS NULL OR invalidated_at IS NULL"));

  const ts = "2026-09-12T00:00:00.000Z";
  assert.equal(invitationTimestampInvariant("open", null, null), true);
  assert.equal(invitationTimestampInvariant("converted", ts, null), true);
  assert.equal(invitationTimestampInvariant("invalidated", null, ts), true);
  assert.equal(invitationTimestampInvariant("expired", null, ts), true);
  assert.equal(invitationTimestampInvariant("blocked", null, ts), true);

  assert.equal(invitationTimestampInvariant("open", ts, null), false);
  assert.equal(invitationTimestampInvariant("open", null, ts), false);
  assert.equal(invitationTimestampInvariant("converted", null, null), false);
  assert.equal(invitationTimestampInvariant("converted", ts, ts), false);
  assert.equal(invitationTimestampInvariant("invalidated", null, null), false);
  assert.equal(invitationTimestampInvariant("expired", null, null), false);
  assert.equal(invitationTimestampInvariant("blocked", null, null), false);
  assert.equal(invitationTimestampInvariant("invalidated", ts, ts), false);
  assert.equal(invitationTimestampInvariant("expired", ts, null), false);
  assert.equal(invitationTimestampInvariant("blocked", ts, ts), false);
}

// TEST J — request_assertion is not post facts; lifecycle has no disputed
{
  assert.equal(requestAssertionStoresPostFacts({}), false);
  assert.equal(requestAssertionStoresPostFacts({ phone: "x" }), true);
  assert.equal(lifecycleIncludesDisputed(V93_CONTRACT_LIFECYCLE), false);
  assert.equal(
    /\bdisputed\b/.test(constraintDef("match_contracts_lifecycle_projection_check")),
    false,
  );
}

// TEST K — verify is catalog-only, sequences by ownership, no function regex
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
  assert.equal(verifyUsesOwnedSequences(verifySql), true);
  assert.equal(verifyScansFunctionsByRegex(verifySql), false);
  assert.ok(verifySql.includes("WHEN t.oid IS NULL OR r.oid IS NULL THEN NULL"));
  assert.ok(expectComments.some((line) => line.includes("relkind = r")));
  assert.ok(expectComments.some((line) => line.includes("relrowsecurity = true")));
  assert.ok(
    expectComments.some((line) => line.includes("relforcerowsecurity = false")),
  );
  assert.ok(verifySql.includes("array_ndims = 1"));
  assert.ok(verifySql.includes("converted_ts_consistent"));
  assert.ok(verifySql.includes("preferred_channel text NOT NULL"));
  assert.equal(verifySql.includes("SELECT * FROM public.match_requests"), false);
  assert.equal(verifySql.includes("FROM public.profiles"), false);
  assert.equal(verifySql.includes("FROM public.posts"), false);
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
