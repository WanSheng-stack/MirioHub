/**
 * PHASE 6.7A.3 — allocation and event foundation (v94).
 * Helpers execute schema-contract logic. They do not claim a live DB run.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/allocationEventFoundationV94.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allocationCategoryInvariant,
  checklistItemKeyInvariant,
  checklistItemOrderInvariant,
  checklistItemsSetInvariant,
  cloneFingerprint,
  diffTableFingerprint,
  eventActorInvariant,
  eventPayloadInvariant,
  extractCreateTable,
  extractDoBlock,
  extractExpectComments,
  extractIndexNames,
  extractNamedConstraints,
  fingerprintFailClosed,
  forbiddenSqlOps,
  guardReadsMigrationHistory,
  hasConfirmedItemsArrayColumn,
  hasDuplicateIndependentIndex,
  independentIndexNamesFromSql,
  lifecycleIncludesDisputed,
  mentionsHardcoded72h,
  pairwiseConfirmedItemsComparisonCount,
  parseDollarJson,
  projectionInvariant,
  sqlBody,
  tableFingerprintFromGuardJson,
  transactionControls,
  tripStateTimestampInvariant,
  v94CreateTableColumnNames,
  v94RlsAndRevokePresent,
  verifyIsSingleResultSet,
  verifyScansFunctionsByRegex,
  verifyUsesOwnedSequencesAi,
  volumeUsesNumericThenMultiply,
  V93_APP_ROLES,
  V93_CONTRACT_LIFECYCLE,
  V93_LIVE_CONTRACT_FINGERPRINT,
  V93_LIVE_FINGERPRINTS,
  V93_LIVE_GRANT_FINGERPRINT,
  V93_LIVE_INVITATION_FINGERPRINT,
  V93_LIVE_REQUEST_FINGERPRINT,
  V93_TABLES,
  V94_ALLOCATION_CATEGORIES,
  V94_APP_ROLES,
  V94_CHECKLIST_STAGES,
  V94_CLAIMS_DDL_REQUIRES_NONEMPTY_CHECKLIST_ITEMS,
  V94_CLAIMS_EVENT_PAYLOAD_CHECK_IS_RECURSIVE,
  V94_CLAIMS_SINGLE_TABLE_PREVENTS_OVERSELL,
  V94_COMPLETION_DUE_HOURS_HARDCODED,
  V94_CONTRACT_ALLOCATION_COLUMNS,
  V94_CONTRACT_EVENT_COLUMNS,
  V94_CONTRACT_STATE_PROJECTION_COLUMNS,
  V94_DIMENSION_CM_MAX,
  V94_DIMENSION_CM_MIN,
  V94_EVENT_PAYLOAD_DB_CHECK_SCOPE,
  V94_EVENT_TYPES,
  V94_FORBIDDEN_SENSITIVE_COLUMNS,
  V94_GUARD_JSON_TAGS,
  V94_HAS_PRODUCTION_WRITER,
  V94_ITEM_UNITS_MAX,
  V94_MIGRATION_REL,
  V94_PEOPLE_CAPACITY_MAX,
  V94_PEOPLE_UNITS_MAX,
  V94_PROVIDER_TRIP_STATE_COLUMNS,
  V94_REMOVED_PAIRWISE_COMPARISON_COUNT,
  V94_SAFETY_CHECKLIST_COLUMNS,
  V94_SAFETY_CHECKLIST_ITEM_COLUMNS,
  V94_TABLES,
  V94_VERIFY_REL,
  V94_WEIGHT_KG_MAX,
  V94_WORK_UNITS_MAX,
  type AllocationDraft,
  type ChecklistItemDraft,
  type ProjectionDraft,
} from "@/lib/matching/allocationEventFoundationV94.contract";
import { freezeLegacyDirectMatchIntercept } from "@/lib/matching/legacyMatchingFreeze";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const PHASE_BASELINE = "8f6dfa32228825e66119ee1c3ac91c56d5b99f2b";

const FROZEN_PATHS = [
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.verify.sql",
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql",
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.verify.sql",
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql",
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.verify.sql",
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.sql",
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.verify.sql",
  "supabase/init.sql",
  "src/lib/matching/applicationPayload.ts",
  "src/lib/matching/matchRequestForm.ts",
  "src/components/matching/MatchRequestSheet.tsx",
  "src/lib/matching/matchRequestSheetBehavior.ts",
] as const;

const migration = read(V94_MIGRATION_REL);
const verifySql = read(V94_VERIFY_REL);
const v93Sql = read(
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.sql",
);
const ledger = read("docs/architecture/deferred-cleanup.md");
const postCard = read("src/components/hall/PostCard.tsx");
const homePage = read("src/app/[locale]/page.tsx");
const homeConsole = read("src/components/home/HomeConsole.tsx");
const lbsWall = read("src/components/home/LbsMirrorWall.tsx");
const actionsSrc = read("src/components/post/PostActions.tsx");
const sheetSrc = read("src/components/matching/MatchRequestSheet.tsx");
const body = sqlBody(migration);
const guard = extractDoBlock(migration);
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

function item(
  acceptanceId: string,
  key: string,
  order: number,
): ChecklistItemDraft {
  return { acceptance_id: acceptanceId, item_key: key, item_order: order };
}

const travelBase = (): AllocationDraft => ({
  category: "travel",
  segment_from_order: 0,
  segment_to_order: 1,
  allocation_state: "active",
  released_at: null,
  release_reason: null,
  people_units: 1,
  small_item_units: 0,
  medium_item_units: 0,
  large_item_units: 0,
  xlarge_item_units: 0,
  space_length_cm: null,
  space_width_cm: null,
  space_height_cm: null,
  volume_cm3: null,
  weight_kg: null,
  weight_unknown: null,
  work_units: null,
});

const deliverBase = (): AllocationDraft => ({
  category: "deliver",
  segment_from_order: 0,
  segment_to_order: 2,
  allocation_state: "active",
  released_at: null,
  release_reason: null,
  people_units: null,
  small_item_units: null,
  medium_item_units: null,
  large_item_units: null,
  xlarge_item_units: null,
  space_length_cm: 10,
  space_width_cm: 20,
  space_height_cm: 30,
  volume_cm3: 6000,
  weight_kg: 1.5,
  weight_unknown: false,
  work_units: null,
});

const workBase = (category: "buy" | "onsite" | "errand"): AllocationDraft => ({
  category,
  segment_from_order: null,
  segment_to_order: null,
  allocation_state: "active",
  released_at: null,
  release_reason: null,
  people_units: null,
  small_item_units: null,
  medium_item_units: null,
  large_item_units: null,
  xlarge_item_units: null,
  space_length_cm: null,
  space_width_cm: null,
  space_height_cm: null,
  volume_cm3: null,
  weight_kg: null,
  weight_unknown: null,
  work_units: 1,
});

const openProjection = (): ProjectionDraft => ({
  execution_state: "not_started",
  custody_state: "none",
  completion_state: "open",
  cancellation_state: "none",
  issue_state: "none",
  last_event_sequence: 0,
  completion_declared_at: null,
  completion_due_at: null,
  terminal_privacy_at: null,
  version: 1,
});

// TEST A — explicit BEGIN/COMMIT, guard before first DDL
{
  const controls = transactionControls(migration);
  assert.deepEqual(controls, ["BEGIN;", "COMMIT;"]);
  const beginAt = body.search(/^BEGIN;/m);
  const guardAt = body.search(/\bDO \$\$/m);
  const firstChange = body.search(/^CREATE TABLE public\.provider_trip_state/m);
  assert.ok(beginAt >= 0 && guardAt > beginAt && firstChange > guardAt);
}

// TEST B — guard JSON matches live v93 fingerprints, not migration history
{
  assert.equal(guardReadsMigrationHistory(migration), false);
  assert.ok(guard.includes("count(*)"));
  assert.ok(guard.includes("relrowsecurity"));
  assert.ok(guard.includes("relforcerowsecurity"));
  assert.ok(guard.includes("format_type(a.atttypid, a.atttypmod)"));
  assert.ok(guard.includes("pg_get_constraintdef"));
  assert.ok(guard.includes("pg_get_indexdef"));
  assert.ok(guard.includes("co.conindid = i.indexrelid"));
  assert.equal(/EXCEPTION\s+WHEN/i.test(guard), false);
  assert.equal(/FROM public\.posts\b/i.test(guard), false);
  assert.equal(/FROM public\.profiles\b/i.test(guard), false);

  for (const table of V94_TABLES) {
    assert.ok(guard.includes(`table fingerprint extra: %`));
    assert.ok(migration.includes(`'${table}'`));
  }
  for (const table of V93_TABLES) {
    assert.ok(guard.includes("table fingerprint missing"));
    assert.ok(migration.includes(`'${table}'`));
  }

  assert.deepEqual(
    tableFingerprintFromGuardJson(
      parseDollarJson(migration, V94_GUARD_JSON_TAGS.match_contact_invitations),
    ),
    V93_LIVE_INVITATION_FINGERPRINT,
  );
  assert.deepEqual(
    tableFingerprintFromGuardJson(
      parseDollarJson(migration, V94_GUARD_JSON_TAGS.contact_grants),
    ),
    V93_LIVE_GRANT_FINGERPRINT,
  );
  assert.deepEqual(
    tableFingerprintFromGuardJson(
      parseDollarJson(migration, V94_GUARD_JSON_TAGS.match_requests),
    ),
    V93_LIVE_REQUEST_FINGERPRINT,
  );
  assert.deepEqual(
    tableFingerprintFromGuardJson(
      parseDollarJson(migration, V94_GUARD_JSON_TAGS.match_contracts),
    ),
    V93_LIVE_CONTRACT_FINGERPRINT,
  );

  const invitationCreate = extractCreateTable(v93Sql, "match_contact_invitations");
  const grantCreate = extractCreateTable(v93Sql, "contact_grants");
  assert.deepEqual(
    v94CreateTableColumnNames(invitationCreate),
    V93_LIVE_INVITATION_FINGERPRINT.columns.map((column) => column.name),
  );
  assert.deepEqual(
    v94CreateTableColumnNames(grantCreate),
    V93_LIVE_GRANT_FINGERPRINT.columns.map((column) => column.name),
  );
  for (const name of extractNamedConstraints(invitationCreate)) {
    assert.ok(
      V93_LIVE_INVITATION_FINGERPRINT.constraints.some((item) => item.name === name),
      name,
    );
  }
  for (const name of extractNamedConstraints(grantCreate)) {
    assert.ok(
      V93_LIVE_GRANT_FINGERPRINT.constraints.some((item) => item.name === name),
      name,
    );
  }
  assert.deepEqual(
    extractIndexNames(v93Sql, "match_contact_invitations"),
    V93_LIVE_INVITATION_FINGERPRINT.indexes.map((index) => index.name),
  );
  assert.deepEqual(
    extractIndexNames(v93Sql, "contact_grants"),
    V93_LIVE_GRANT_FINGERPRINT.indexes.map((index) => index.name),
  );
  assert.deepEqual(
    extractIndexNames(v93Sql, "match_requests"),
    V93_LIVE_REQUEST_FINGERPRINT.indexes.map((index) => index.name),
  );
  assert.deepEqual(
    extractIndexNames(v93Sql, "match_contracts"),
    V93_LIVE_CONTRACT_FINGERPRINT.indexes.map((index) => index.name),
  );
}

// TEST B2 — fingerprint fail-closed fixtures
{
  assert.deepEqual(
    diffTableFingerprint(
      "match_requests",
      V93_LIVE_REQUEST_FINGERPRINT,
      cloneFingerprint(V93_LIVE_REQUEST_FINGERPRINT),
    ),
    [],
  );

  const missingTable = cloneFingerprint(V93_LIVE_REQUEST_FINGERPRINT);
  missingTable.columns = [];
  missingTable.constraints = [];
  missingTable.indexes = [];
  assert.equal(
    fingerprintFailClosed(
      diffTableFingerprint(
        "match_requests",
        V93_LIVE_REQUEST_FINGERPRINT,
        missingTable,
      ),
    ),
    true,
  );

  const nonempty = cloneFingerprint(V93_LIVE_FINGERPRINTS.match_contracts);
  nonempty.columns = nonempty.columns.filter((column) => column.name !== "category");
  assert.ok(
    diffTableFingerprint(
      "match_contracts",
      V93_LIVE_CONTRACT_FINGERPRINT,
      nonempty,
    ).some(
      (item) =>
        item.kind === "column" &&
        item.issue === "missing" &&
        item.object === "category",
    ),
  );

  const extraV94 = cloneFingerprint(V93_LIVE_CONTRACT_FINGERPRINT);
  extraV94.columns = [
    ...extraV94.columns,
    { name: "provider_trip_state", type: "uuid", not_null: true, default_norm: "" },
  ];
  assert.ok(
    diffTableFingerprint(
      "match_contracts",
      V93_LIVE_CONTRACT_FINGERPRINT,
      extraV94,
    ).some(
      (item) =>
        item.kind === "column" &&
        item.issue === "extra" &&
        item.object === "provider_trip_state",
    ),
  );

  const rlsOff = cloneFingerprint(V93_LIVE_GRANT_FINGERPRINT);
  rlsOff.relrowsecurity = false;
  assert.ok(
    diffTableFingerprint(
      "contact_grants",
      V93_LIVE_GRANT_FINGERPRINT,
      rlsOff,
    ).some((item) => item.kind === "rls" && item.object === "relrowsecurity"),
  );

  const forceOn = cloneFingerprint(V93_LIVE_INVITATION_FINGERPRINT);
  forceOn.relforcerowsecurity = true;
  assert.ok(
    diffTableFingerprint(
      "match_contact_invitations",
      V93_LIVE_INVITATION_FINGERPRINT,
      forceOn,
    ).some(
      (item) => item.kind === "rls" && item.object === "relforcerowsecurity",
    ),
  );
}

// TEST C — no CASCADE / TRUNCATE / writers / skip flags
{
  assert.deepEqual(forbiddenSqlOps(migration), []);
  assert.equal(V94_HAS_PRODUCTION_WRITER, false);
}

// TEST D — frozen historical files have no diff vs this phase baseline
{
  for (const path of FROZEN_PATHS) {
    assert.equal(gitDiff(path), "", path);
  }
}

// TEST E — five tables RLS + four-role REVOKE; no policy/GRANT/RPC/trigger/sequence
{
  for (const table of V94_TABLES) {
    assert.equal(v94RlsAndRevokePresent(migration, table), true, table);
  }
  assert.equal(/FORCE ROW LEVEL SECURITY/i.test(migration), false);
  assert.equal(/CREATE\s+POLICY/i.test(migration), false);
  assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(migration), false);
  assert.equal(/CREATE\s+TRIGGER/i.test(migration), false);
  assert.equal(/CREATE\s+SEQUENCE/i.test(migration), false);
  assert.equal(/CREATE\s+VIEW/i.test(migration), false);
  assert.equal(/\bGENERATED\s+BY\s+DEFAULT\s+AS\s+IDENTITY\b/i.test(migration), false);
  assert.equal(/\bSERIAL\b/i.test(migration), false);
  for (const role of V94_APP_ROLES) {
    assert.ok(role === "PUBLIC" || V93_APP_ROLES.includes(role));
  }
}

// TEST F — trip state timestamp truth table
{
  assert.equal(
    tripStateTimestampInvariant({ state: "open", started_at: null, ended_at: null }),
    true,
  );
  assert.equal(
    tripStateTimestampInvariant({
      state: "started",
      started_at: "2026-09-12T01:00:00.000Z",
      ended_at: null,
    }),
    true,
  );
  assert.equal(
    tripStateTimestampInvariant({
      state: "ended",
      started_at: "2026-09-12T01:00:00.000Z",
      ended_at: "2026-09-12T02:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    tripStateTimestampInvariant({
      state: "open",
      started_at: "2026-09-12T01:00:00.000Z",
      ended_at: null,
    }),
    false,
  );
  assert.equal(
    tripStateTimestampInvariant({
      state: "open",
      started_at: null,
      ended_at: "2026-09-12T02:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    tripStateTimestampInvariant({
      state: "started",
      started_at: null,
      ended_at: null,
    }),
    false,
  );
  assert.equal(
    tripStateTimestampInvariant({
      state: "started",
      started_at: "2026-09-12T01:00:00.000Z",
      ended_at: "2026-09-12T02:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    tripStateTimestampInvariant({
      state: "ended",
      started_at: null,
      ended_at: "2026-09-12T02:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    tripStateTimestampInvariant({
      state: "ended",
      started_at: "2026-09-12T02:00:00.000Z",
      ended_at: "2026-09-12T01:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    tripStateTimestampInvariant({
      state: "paused",
      started_at: null,
      ended_at: null,
    }),
    false,
  );
  const create = extractCreateTable(migration, "provider_trip_state");
  assert.deepEqual(
    v94CreateTableColumnNames(create),
    [...V94_PROVIDER_TRIP_STATE_COLUMNS],
  );
  assert.equal(/stop.?taking/i.test(create), false);
  assert.ok(constraintDef("provider_trip_state_open_ts").includes("state = 'open'"));
}

// TEST G — Travel / Deliver / work allocation exclusivity
{
  assert.equal(allocationCategoryInvariant(travelBase()), true);
  assert.equal(
    allocationCategoryInvariant({ ...travelBase(), people_units: 0, small_item_units: 2 }),
    true,
  );
  assert.equal(
    allocationCategoryInvariant({
      ...travelBase(),
      people_units: 0,
      small_item_units: 0,
      medium_item_units: 0,
      large_item_units: 0,
      xlarge_item_units: 0,
    }),
    false,
  );
  assert.equal(
    allocationCategoryInvariant({ ...travelBase(), space_length_cm: 0 }),
    false,
  );
  assert.equal(
    allocationCategoryInvariant({ ...travelBase(), work_units: 0 }),
    false,
  );
  assert.equal(
    allocationCategoryInvariant({ ...travelBase(), people_units: V94_PEOPLE_UNITS_MAX + 1 }),
    false,
  );
  assert.equal(
    allocationCategoryInvariant({ ...travelBase(), segment_from_order: null, segment_to_order: null }),
    false,
  );
  assert.equal(
    allocationCategoryInvariant({ ...travelBase(), segment_from_order: 3, segment_to_order: 1 }),
    false,
  );

  assert.equal(allocationCategoryInvariant(deliverBase()), true);
  assert.equal(
    allocationCategoryInvariant({ ...deliverBase(), volume_cm3: 5999 }),
    false,
  );
  assert.equal(
    allocationCategoryInvariant({ ...deliverBase(), weight_unknown: true, weight_kg: 1.5 }),
    false,
  );
  assert.equal(
    allocationCategoryInvariant({ ...deliverBase(), weight_unknown: true, weight_kg: null }),
    true,
  );
  assert.equal(
    allocationCategoryInvariant({ ...deliverBase(), weight_unknown: false, weight_kg: null }),
    false,
  );
  assert.equal(
    allocationCategoryInvariant({ ...deliverBase(), people_units: 0 }),
    false,
  );
  assert.equal(
    allocationCategoryInvariant({ ...deliverBase(), work_units: 0 }),
    false,
  );
  assert.equal(
    allocationCategoryInvariant({
      ...deliverBase(),
      space_length_cm: V94_DIMENSION_CM_MAX + 1,
      volume_cm3: (V94_DIMENSION_CM_MAX + 1) * 20 * 30,
    }),
    false,
  );

  for (const category of ["buy", "onsite", "errand"] as const) {
    assert.equal(allocationCategoryInvariant(workBase(category)), true, category);
    assert.equal(
      allocationCategoryInvariant({ ...workBase(category), work_units: 0 }),
      false,
      category,
    );
    assert.equal(
      allocationCategoryInvariant({ ...workBase(category), people_units: 0 }),
      false,
      category,
    );
    assert.equal(
      allocationCategoryInvariant({ ...workBase(category), segment_from_order: 0, segment_to_order: 1 }),
      false,
      category,
    );
  }

  assert.equal(
    allocationCategoryInvariant({
      ...travelBase(),
      allocation_state: "released",
      released_at: "2026-09-12T03:00:00.000Z",
      release_reason: "contract_cancelled",
    }),
    true,
  );
  assert.equal(
    allocationCategoryInvariant({
      ...travelBase(),
      allocation_state: "released",
      released_at: null,
      release_reason: "contract_cancelled",
    }),
    false,
  );
  assert.equal(
    allocationCategoryInvariant({
      ...travelBase(),
      allocation_state: "active",
      released_at: "2026-09-12T03:00:00.000Z",
      release_reason: null,
    }),
    false,
  );

  assert.equal(V94_CLAIMS_SINGLE_TABLE_PREVENTS_OVERSELL, false);
  assert.ok(migration.includes("do not prevent cross-contract"));
  assert.equal(volumeUsesNumericThenMultiply(migration), true);

  function exportedNumber(src: string, name: string): number {
    const match = src.match(new RegExp(`export const ${name} = ([\\d_]+)`));
    assert.ok(match, name);
    return Number(match[1].replaceAll("_", ""));
  }
  const transportSrc = read("src/lib/transport/transportPolicy.ts");
  const cargoSrc = read("src/lib/cargo/cargoPolicy.ts");
  assert.equal(V94_PEOPLE_UNITS_MAX, exportedNumber(transportSrc, "CAR_PEOPLE_COUNT_MAX"));
  assert.equal(V94_PEOPLE_CAPACITY_MAX, exportedNumber(transportSrc, "CAR_PEOPLE_CAPACITY_MAX"));
  assert.equal(V94_ITEM_UNITS_MAX, exportedNumber(transportSrc, "PG_INT_MAX"));
  assert.equal(V94_WORK_UNITS_MAX, exportedNumber(transportSrc, "PG_INT_MAX"));
  assert.equal(V94_DIMENSION_CM_MIN, exportedNumber(cargoSrc, "CARGO_DIMENSION_CM_MIN"));
  assert.equal(V94_DIMENSION_CM_MAX, exportedNumber(cargoSrc, "CARGO_DIMENSION_CM_MAX"));
  assert.equal(V94_WEIGHT_KG_MAX, exportedNumber(cargoSrc, "CARGO_WEIGHT_KG_MAX"));
  assert.ok(constraintDef("contract_allocations_travel_shape").includes(`BETWEEN 0 AND ${V94_PEOPLE_UNITS_MAX}`));
  assert.ok(constraintDef("contract_allocations_travel_shape").includes(String(V94_ITEM_UNITS_MAX)));
  assert.ok(constraintDef("contract_allocations_deliver_shape").includes(String(V94_DIMENSION_CM_MAX)));
  assert.ok(constraintDef("contract_allocations_deliver_shape").includes(String(V94_WEIGHT_KG_MAX)));
  assert.deepEqual(
    v94CreateTableColumnNames(extractCreateTable(migration, "contract_allocations")),
    [...V94_CONTRACT_ALLOCATION_COLUMNS],
  );
}

// TEST H — projection orthogonal facts; disputed stays out of lifecycle
{
  assert.equal(lifecycleIncludesDisputed(V93_CONTRACT_LIFECYCLE), false);
  assert.equal(projectionInvariant(openProjection()), true);
  assert.equal(
    projectionInvariant({
      ...openProjection(),
      issue_state: "disputed",
      execution_state: "in_progress",
    }),
    true,
  );
  assert.equal(
    projectionInvariant({
      ...openProjection(),
      completion_state: "one_side_declared",
      completion_declared_at: "2026-09-12T01:00:00.000Z",
      completion_due_at: "2026-09-15T01:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    projectionInvariant({
      ...openProjection(),
      completion_state: "one_side_declared",
      completion_declared_at: "2026-09-12T01:00:00.000Z",
      completion_due_at: null,
    }),
    false,
  );
  assert.equal(
    projectionInvariant({
      ...openProjection(),
      completion_state: "mutually_confirmed",
      completion_declared_at: "2026-09-12T01:00:00.000Z",
      completion_due_at: null,
    }),
    true,
  );
  assert.equal(
    projectionInvariant({
      ...openProjection(),
      completion_state: "open",
      completion_declared_at: "2026-09-12T01:00:00.000Z",
      completion_due_at: null,
    }),
    false,
  );
  assert.equal(V94_COMPLETION_DUE_HOURS_HARDCODED, false);
  assert.equal(mentionsHardcoded72h(migration), false);
  assert.equal(
    /lifecycle_projection/.test(extractCreateTable(migration, "contract_state_projections")),
    false,
  );
  assert.ok(constraintDef("contract_state_projections_issue_check").includes("'disputed'"));
  assert.deepEqual(
    v94CreateTableColumnNames(extractCreateTable(migration, "contract_state_projections")),
    [...V94_CONTRACT_STATE_PROJECTION_COLUMNS],
  );
}

// TEST I — events: types, actor, sequence uniqueness, payload bounds
{
  assert.equal(eventActorInvariant({ actor_kind: "user", actor_user_id: "u1" }), true);
  assert.equal(eventActorInvariant({ actor_kind: "system", actor_user_id: null }), true);
  assert.equal(eventActorInvariant({ actor_kind: "user", actor_user_id: null }), false);
  assert.equal(eventActorInvariant({ actor_kind: "system", actor_user_id: "u1" }), false);
  assert.equal(eventPayloadInvariant({}), true);
  assert.equal(eventPayloadInvariant({ reason: "contract_cancelled" }), true);
  assert.equal(eventPayloadInvariant([]), false);
  assert.equal(eventPayloadInvariant("x"), false);
  assert.equal(eventPayloadInvariant({ phone: "+1" }), false);
  assert.equal(eventPayloadInvariant({ nested: { whatsapp: "abc" } }), false);
  assert.equal(eventPayloadInvariant({ demand_snapshot: {} }), false);
  assert.equal(V94_CLAIMS_EVENT_PAYLOAD_CHECK_IS_RECURSIVE, false);
  assert.equal(V94_EVENT_PAYLOAD_DB_CHECK_SCOPE, "top_level_keys_only");
  assert.ok(migration.includes("top level only"));
  assert.equal(migration.includes("'status_changed'"), false);
  assert.ok(constraintDef("contract_events_contract_sequence_key").includes("UNIQUE (contract_id, sequence_no)"));
  assert.ok(
    constraintDef("contract_events_contract_client_event_id_key").includes(
      "UNIQUE (contract_id, client_event_id)",
    ),
  );
  assert.equal(
    hasDuplicateIndependentIndex(migration, "contract_events", "contract_id, sequence_no"),
    false,
  );
  for (const eventType of V94_EVENT_TYPES) {
    assert.ok(constraintDef("contract_events_event_type_check").includes(`'${eventType}'`));
  }
  assert.deepEqual(
    v94CreateTableColumnNames(extractCreateTable(migration, "contract_events")),
    [...V94_CONTRACT_EVENT_COLUMNS],
  );
  assert.ok(migration.includes("Future writers may INSERT only"));
}

// TEST J — normalized checklist items (helper simulates UNIQUE/CHECK; not a live PG run)
{
  assert.equal(checklistItemsSetInvariant([item("a1", "pickup.identity_checked", 1)]), true);
  assert.equal(
    checklistItemsSetInvariant(
      Array.from({ length: 64 }, (_, i) => item("a1", `item_${i + 1}`, i + 1)),
    ),
    true,
  );
  assert.equal(checklistItemOrderInvariant(65), false);
  assert.equal(checklistItemsSetInvariant([item("a1", "ok_key", 65)]), false);
  assert.equal(checklistItemOrderInvariant(0), false);
  assert.equal(checklistItemsSetInvariant([item("a1", "ok_key", 0)]), false);
  assert.equal(checklistItemOrderInvariant(-1), false);
  assert.equal(checklistItemsSetInvariant([item("a1", "ok_key", -1)]), false);
  assert.equal(
    checklistItemsSetInvariant([
      item("a1", "pickup.identity_checked", 1),
      item("a1", "pickup.identity_checked", 2),
    ]),
    false,
  );
  assert.equal(
    checklistItemsSetInvariant([
      item("a1", "pickup.identity_checked", 1),
      item("a1", "delivery.code_confirmed", 1),
    ]),
    false,
  );
  assert.equal(
    checklistItemsSetInvariant([
      item("a1", "pickup.identity_checked", 1),
      item("a2", "pickup.identity_checked", 1),
    ]),
    true,
  );
  assert.equal(checklistItemKeyInvariant(""), false);
  assert.equal(checklistItemsSetInvariant([item("a1", "", 1)]), false);
  assert.equal(checklistItemKeyInvariant(" padded.key "), false);
  assert.equal(checklistItemsSetInvariant([item("a1", " padded.key ", 1)]), false);
  assert.equal(checklistItemKeyInvariant(`k${"x".repeat(100)}`), false);
  assert.equal(checklistItemsSetInvariant([item("a1", `k${"x".repeat(100)}`, 1)]), false);
  assert.equal(checklistItemKeyInvariant("Bad Key"), false);
  assert.equal(checklistItemsSetInvariant([item("a1", "Bad Key", 1)]), false);
  assert.equal(checklistItemKeyInvariant("pickup.identity_checked"), true);
  assert.equal(checklistItemKeyInvariant("delivery.code_confirmed"), true);

  assert.equal(hasConfirmedItemsArrayColumn(migration), false);
  assert.equal(pairwiseConfirmedItemsComparisonCount(migration), 0);
  assert.equal(V94_REMOVED_PAIRWISE_COMPARISON_COUNT, 2016);
  assert.equal(/confirmed_items\[\d+\]/.test(migration), false);
  assert.equal(migration.includes("safety_checklist_acceptances_items_shape"), false);
  assert.equal(V94_CLAIMS_DDL_REQUIRES_NONEMPTY_CHECKLIST_ITEMS, false);
  assert.ok(migration.includes("non-empty checklist items is a future transactional writer invariant"));

  const header = extractCreateTable(migration, "safety_checklist_acceptances");
  const itemsCreate = extractCreateTable(migration, "safety_checklist_acceptance_items");
  assert.deepEqual(v94CreateTableColumnNames(header), [...V94_SAFETY_CHECKLIST_COLUMNS]);
  assert.deepEqual(v94CreateTableColumnNames(itemsCreate), [...V94_SAFETY_CHECKLIST_ITEM_COLUMNS]);
  for (const col of V94_FORBIDDEN_SENSITIVE_COLUMNS) {
    assert.equal(new RegExp(`\\b${col}\\b`).test(header), false, col);
    assert.equal(new RegExp(`\\b${col}\\b`).test(itemsCreate), false, col);
  }
  assert.equal(/no_unknown_risk/.test(header), false);
  assert.equal(/photo_url/.test(header + itemsCreate), false);
  assert.equal(/file_url/.test(header + itemsCreate), false);
  assert.ok(header.includes("overall_confirmed boolean NOT NULL"));
  assert.ok(constraintDef("safety_checklist_acceptances_overall_true").includes("IS TRUE"));
  assert.ok(constraintDef("safety_checklist_acceptance_items_item_order_check").includes("BETWEEN 1 AND 64"));
  assert.ok(constraintDef("safety_checklist_acceptance_items_pkey").includes("PRIMARY KEY (acceptance_id, item_key)"));
  assert.ok(
    constraintDef("safety_checklist_acceptance_items_acceptance_id_item_order_key").includes(
      "UNIQUE (acceptance_id, item_order)",
    ),
  );
  assert.ok(itemsCreate.includes("ON DELETE RESTRICT"));
  assert.ok(itemsCreate.includes("ON UPDATE RESTRICT"));
  for (const stage of V94_CHECKLIST_STAGES) {
    assert.ok(constraintDef("safety_checklist_acceptances_stage_check").includes(`'${stage}'`));
  }
}

// TEST K — indexes have query purpose; no redundant sequence index; no enum spam
{
  assert.deepEqual(independentIndexNamesFromSql(migration, "provider_trip_state"), [
    "provider_trip_state_state_updated_idx",
  ]);
  assert.deepEqual(independentIndexNamesFromSql(migration, "contract_allocations"), [
    "contract_allocations_provider_state_segment_idx",
    "contract_allocations_demand_post_id_idx",
  ]);
  assert.deepEqual(independentIndexNamesFromSql(migration, "contract_events"), [
    "contract_events_type_occurred_idx",
  ]);
  assert.deepEqual(independentIndexNamesFromSql(migration, "contract_state_projections"), [
    "contract_state_projections_issue_updated_idx",
    "contract_state_projections_custody_updated_idx",
  ]);
  assert.deepEqual(
    independentIndexNamesFromSql(migration, "safety_checklist_acceptances"),
    ["safety_checklist_acceptances_contract_stage_confirmed_idx"],
  );
  assert.deepEqual(
    independentIndexNamesFromSql(migration, "safety_checklist_acceptance_items"),
    [],
  );
}

// TEST L — verify is one result set, sequences a+i, no function regex
{
  assert.equal(verifyIsSingleResultSet(verifySql), true);
  assert.equal(verifyUsesOwnedSequencesAi(verifySql), true);
  assert.equal(verifyScansFunctionsByRegex(verifySql), false);
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
  assert.ok(verifySql.includes("WHEN t.oid IS NULL OR r.oid IS NULL THEN 'FAIL'"));
  assert.ok(verifySql.includes("THEN 'NULL'"));
  assert.ok(expectComments.some((line) => line.includes("single result set")));
  assert.ok(verifySql.includes("overall_pass"));
  assert.ok(verifySql.includes("safety_checklist_acceptance_items"));
  assert.ok(verifySql.includes("no confirmed_items column"));
  assert.ok(expectComments.some((line) => line.includes("relkind = r")));
  assert.ok(expectComments.some((line) => line.includes("relrowsecurity = true")));
  assert.ok(expectComments.some((line) => line.includes("relforcerowsecurity = false")));
  assert.ok(expectComments.some((line) => line.includes("EXPECT=0")));
  assert.equal(verifySql.includes("SELECT * FROM public.contract_events"), false);
  assert.equal(verifySql.includes("FROM public.profiles"), false);
  assert.equal(verifySql.includes("FROM public.posts"), false);
  assert.equal(/proname\s*~\*/.test(verifySql), false);
}

// TEST M — production UI/API/payload/sheet have no v94 import or writer
{
  for (const src of [postCard, homePage, homeConsole, lbsWall, actionsSrc]) {
    assert.equal(src.includes("MatchRequestSheet"), false);
    assert.equal(src.includes("allocationEventFoundationV94"), false);
  }
  assert.ok(sheetSrc.includes("export function MatchRequestSheet"));
  const runtimeFiles = walkRuntimeTs(join(repoRoot, "src"));
  const writerRe =
    /\.from\(\s*["'](provider_trip_state|contract_allocations|contract_state_projections|contract_events|safety_checklist_acceptances|safety_checklist_acceptance_items)["']\s*\)/;
  const insertRe =
    /INSERT\s+INTO\s+public\.(provider_trip_state|contract_allocations|contract_state_projections|contract_events|safety_checklist_acceptances|safety_checklist_acceptance_items)/i;
  const contractImportRe = /allocationEventFoundationV94\.contract/;
  for (const file of runtimeFiles) {
    const rel = relative(repoRoot, file).replaceAll("\\", "/");
    if (rel === "src/lib/matching/allocationEventFoundationV94.contract.ts") continue;
    const src = readFileSync(file, "utf8");
    assert.equal(writerRe.test(src), false, `writer in ${rel}`);
    assert.equal(insertRe.test(src), false, `insert in ${rel}`);
    assert.equal(contractImportRe.test(src), false, `contract import in ${rel}`);
  }
}

// TEST N — confirm_match remains frozen; ledger records v94 schema-only
{
  const frozen = freezeLegacyDirectMatchIntercept();
  assert.equal(frozen.status, 409);
  assert.equal(frozen.json.ok, false);
  assert.equal(frozen.json.errorKey, "error.matching_temporarily_unavailable");
  assert.ok(ledger.includes("v94") || ledger.includes("6.7A.3"));
  assert.ok(/allocation/i.test(ledger));
}

// TEST O — categories used by allocation match dual-post contract categories
{
  assert.deepEqual([...V94_ALLOCATION_CATEGORIES], [
    "travel",
    "deliver",
    "buy",
    "onsite",
    "errand",
  ]);
}

console.log("allocationEventFoundationV94.test.ts: ok");
