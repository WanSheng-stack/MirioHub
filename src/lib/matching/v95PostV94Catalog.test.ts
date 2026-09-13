/**
 * PHASE 6.7C.1B.3 — live post-v94 catalog fingerprint.
 * Recomputes digests from frozen typed rows. Does not copy hashes
 * out of the migration and compare them to themselves.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/v95PostV94Catalog.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractDoBlock,
  transactionControls,
} from "@/lib/matching/allocationEventFoundationV94.contract";
import {
  ACL_PRIVILEGES,
  ACL_ROLES,
  FINGERPRINT_REGIONS,
  INVENTORY_COLUMNS,
  TARGET_TABLES,
  buildCatalogFingerprint,
  cloneInventoryRows,
  decodeInventoryRows,
  digestRows,
  encodeCanonicalField,
  encodeCanonicalRow,
  type InventoryRow,
  parseCsvRecords,
  sortInventoryRows,
  validateInventoryRows,
} from "@/lib/matching/v95PostV94Catalog";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const PHASE_BASELINE = "afb9960b7a94ac53e214f379ce5564f385f0220b";

const fixture = JSON.parse(
  read("src/lib/matching/v95PostV94Catalog.fixture.json"),
) as {
  source: string;
  row_count: number;
  regions: Record<string, { count: number; digest: string }>;
  overall: { count: number; digest: string };
  rows: InventoryRow[];
};

const migration = read(
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql",
);
const verifySql = read(
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.verify.sql",
);
const inventorySql = read(
  "supabase/migrations/20260911000003_v95_preapply_catalog_inventory.verify.sql",
);
const guard = extractDoBlock(migration);
const recomputed = buildCatalogFingerprint(fixture.rows, fixture.source);

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", PHASE_BASELINE, "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function mutate(
  rows: InventoryRow[],
  fn: (row: InventoryRow) => void,
): InventoryRow[] {
  const copy = cloneInventoryRows(rows);
  fn(copy[0]!);
  return copy;
}

function regionDigestChanged(
  rows: InventoryRow[],
  region: string,
): boolean {
  return (
    buildCatalogFingerprint(rows).regions[
      region as keyof typeof recomputed.regions
    ].digest !== recomputed.regions[region as keyof typeof recomputed.regions].digest
  );
}

const miniCsv = [
  INVENTORY_COLUMNS.join(","),
  [
    "table_fingerprint",
    "table",
    "public",
    "contact_grants",
    "contact_grants",
    "2",
    "table:public.contact_grants",
    "r",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "null",
    "true",
    "false",
    "0",
    "relkind=r",
  ].join(","),
].join("\n");

const decodedMini = decodeInventoryRows(miniCsv);
assert.equal(decodedMini.length, 1);
assert.equal(decodedMini[0]!.attnum, null);
assert.equal(decodedMini[0]!.row_count, 0);
assert.equal(decodedMini[0]!.relrowsecurity, true);
assert.equal(decodedMini[0]!.relforcerowsecurity, false);
assert.equal(decodedMini[0]!.object_definition, "relkind=r");
assert.equal(encodeCanonicalField("attnum", null), "n");
assert.equal(encodeCanonicalField("acl_status", "false"), "t:false");
assert.equal(encodeCanonicalField("relforcerowsecurity", false), "b:false");
assert.notEqual(
  encodeCanonicalField("acl_status", "false"),
  encodeCanonicalField("relforcerowsecurity", false),
);
assert.notEqual(encodeCanonicalField("object_name", "null"), "n");
assert.equal(encodeCanonicalField("object_name", "null"), "t:null");

const quotedNullCsv = `${INVENTORY_COLUMNS.join(",")}\n${INVENTORY_COLUMNS.map(
  (column) => {
    if (column === "object_name") return '"null"';
    if (column === "object_identity") return "id:quoted-null";
    if (column === "object_order") return "1";
    if (column === "object_kind") return "table";
    if (column === "scope") return "table_fingerprint";
    if (column === "relrowsecurity") return "true";
    if (column === "relforcerowsecurity") return "false";
    if (column === "row_count") return "0";
    return "null";
  },
).join(",")}`;
const quotedNull = decodeInventoryRows(quotedNullCsv)[0]!;
assert.equal(quotedNull.object_name, "null");
assert.equal(quotedNull.attnum, null);

assert.equal(fixture.row_count, 590);
assert.equal(fixture.rows.length, 590);
assert.equal(INVENTORY_COLUMNS.length, 38);
validateInventoryRows(fixture.rows);
assert.deepEqual(recomputed.regions, fixture.regions);
assert.deepEqual(recomputed.overall, fixture.overall);
assert.equal(recomputed.overall.count, 590);

const shuffled = cloneInventoryRows(fixture.rows).reverse();
assert.deepEqual(digestRows(shuffled), digestRows(fixture.rows));
assert.deepEqual(
  buildCatalogFingerprint(shuffled).overall.digest,
  recomputed.overall.digest,
);

const sorted = sortInventoryRows(fixture.rows);
assert.equal(new Set(sorted.map((row) => row.object_identity)).size, 590);

assert.equal(recomputed.regions.tables.count, 10);
assert.equal(recomputed.regions.columns.count, 125);
assert.equal(recomputed.regions.constraints.count, 120);
assert.equal(recomputed.regions.indexes.count, 22);
assert.equal(recomputed.regions.policies.count, 10);
assert.equal(recomputed.regions.acl.count, 280);
assert.equal(recomputed.regions.triggers.count, 10);
assert.equal(recomputed.regions.sequences.count, 10);
assert.equal(recomputed.regions.functions.count, 1);
assert.equal(recomputed.regions.prerequisites.count, 2);

const rename = mutate(fixture.rows, (row) => {
  const column = fixture.rows.find((item) => item.object_kind === "column")!;
  Object.assign(row, column);
  row.object_name = "renamed_column";
  row.object_identity = "column:tamper.renamed_column";
});
assert.equal(regionDigestChanged(rename, "columns"), true);

const attnum = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_kind === "column"),
  );
  row.attnum = 999;
  row.object_identity = "column:tamper.attnum";
});
assert.equal(regionDigestChanged(attnum, "columns"), true);

const typ = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_kind === "column"),
  );
  row.format_type = "text";
  row.object_identity = "column:tamper.type";
});
assert.equal(regionDigestChanged(typ, "columns"), true);

const notNull = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_kind === "column"),
  );
  row.not_null = !(row.not_null as boolean);
  row.object_identity = "column:tamper.notnull";
});
assert.equal(regionDigestChanged(notNull, "columns"), true);

const def = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find(
      (item) => item.object_kind === "column" && item.default_expr != null,
    ),
  );
  row.default_expr = "now()";
  row.object_identity = "column:tamper.default";
});
assert.equal(regionDigestChanged(def, "columns"), true);

const constraintDef = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_kind === "check"),
  );
  row.object_definition = `${row.object_definition} AND true`;
  row.object_identity = "constraint:tamper.def";
});
assert.equal(regionDigestChanged(constraintDef, "constraints"), true);

const defer = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_kind === "check"),
  );
  row.condeferrable = true;
  row.object_identity = "constraint:tamper.defer";
});
assert.equal(regionDigestChanged(defer, "constraints"), true);

const indexDef = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_kind === "independent_index"),
  );
  row.object_definition = `${row.object_definition} -- changed`;
  row.object_identity = "index:tamper.def";
});
assert.equal(regionDigestChanged(indexDef, "indexes"), true);

const indexReady = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_kind === "independent_index"),
  );
  row.index_valid = false;
  row.index_ready = false;
  row.object_identity = "index:tamper.ready";
});
assert.equal(regionDigestChanged(indexReady, "indexes"), true);

const rls = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_kind === "table"),
  );
  row.relrowsecurity = false;
  row.relforcerowsecurity = true;
  row.object_identity = "table:tamper.rls";
});
assert.equal(regionDigestChanged(rls, "tables"), true);

const nonempty = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_kind === "table"),
  );
  row.row_count = 1;
  row.object_identity = "table:tamper.rows";
});
assert.equal(regionDigestChanged(nonempty, "tables"), true);
assert.throws(() => validateInventoryRows(nonempty));

const extraPolicy = cloneInventoryRows(fixture.rows);
extraPolicy.push({
  ...extraPolicy.find((row) => row.object_kind === "rls_policy_count")!,
  object_kind: "rls_policy",
  object_name: "tamper_policy",
  object_identity: "rls_policy:tamper.tamper_policy",
  policy_roles: "PUBLIC",
  policy_using: "true",
  policy_with_check: "true",
  object_definition: "cmd=* | using=true | with_check=true",
});
assert.equal(
  buildCatalogFingerprint(extraPolicy).regions.policies.count,
  recomputed.regions.policies.count + 1,
);

const policyRoles = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_kind === "rls_policy_count"),
  );
  row.object_kind = "rls_policy";
  row.policy_roles = "anon";
  row.policy_using = "false";
  row.policy_with_check = "false";
  row.object_identity = "rls_policy:tamper.roles";
});
assert.equal(regionDigestChanged(policyRoles, "policies"), true);

const publicAcl = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find(
      (item) =>
        item.object_kind === "table_acl" && item.acl_grantee === "PUBLIC",
    ),
  );
  row.acl_status = "true";
  row.object_identity = "acl:tamper.PUBLIC.SELECT";
});
assert.equal(regionDigestChanged(publicAcl, "acl"), true);

const namedAcl = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find(
      (item) => item.object_kind === "table_acl" && item.acl_grantee === "anon",
    ),
  );
  row.acl_status = "true";
  row.object_identity = "acl:tamper.anon.SELECT";
});
assert.equal(regionDigestChanged(namedAcl, "acl"), true);

const missingRole = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find(
      (item) =>
        item.object_kind === "table_acl" && item.acl_grantee === "authenticated",
    ),
  );
  row.acl_status = "role_missing";
  row.object_identity = "acl:tamper.authenticated.SELECT";
});
assert.equal(regionDigestChanged(missingRole, "acl"), true);
assert.throws(() => validateInventoryRows(missingRole));

const extraTrigger = cloneInventoryRows(fixture.rows);
extraTrigger.push({
  ...extraTrigger.find((row) => row.object_kind === "trigger_count")!,
  object_kind: "trigger",
  object_name: "tamper_trg",
  object_identity: "trigger:tamper.tamper_trg",
  object_definition: "CREATE TRIGGER tamper",
});
assert.equal(
  buildCatalogFingerprint(extraTrigger).regions.triggers.count,
  recomputed.regions.triggers.count + 1,
);

const extraSeq = cloneInventoryRows(fixture.rows);
extraSeq.push({
  ...extraSeq.find((row) => row.object_kind === "owned_sequence_count")!,
  object_kind: "owned_sequence",
  object_name: "public.tamper_seq",
  object_identity: "owned_sequence:tamper.id.a",
  object_definition: "sequence=public.tamper_seq | column=id | deptype=a",
});
assert.equal(
  buildCatalogFingerprint(extraSeq).regions.sequences.count,
  recomputed.regions.sequences.count + 1,
);

const pgcrypto = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_identity === "extension:pgcrypto"),
  );
  row.object_type = "missing";
  row.object_definition = "missing";
});
assert.equal(regionDigestChanged(pgcrypto, "prerequisites"), true);

const postgis = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_identity === "extension:postgis"),
  );
  row.object_definition = "schema=public | version=0.0.0";
});
assert.equal(regionDigestChanged(postgis, "prerequisites"), true);

const deleted = cloneInventoryRows(fixture.rows).slice(1);
assert.notEqual(
  buildCatalogFingerprint(deleted).overall.digest,
  recomputed.overall.digest,
);

const extraUnknown = cloneInventoryRows(fixture.rows);
extraUnknown.push({
  ...extraUnknown[0]!,
  object_identity: "table:public.unknown_extra",
  table_name: "unknown_extra",
});
assert.notEqual(
  buildCatalogFingerprint(extraUnknown).overall.digest,
  recomputed.overall.digest,
);

assert.throws(() => {
  const dup = cloneInventoryRows(fixture.rows);
  dup[1]!.object_identity = dup[0]!.object_identity;
  validateInventoryRows(dup);
});

const spaced = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_kind === "check"),
  );
  row.object_definition = `  ${String(row.object_definition).replace(/ /g, "  ")}\n`;
  row.object_identity = row.object_identity;
});
assert.equal(
  encodeCanonicalRow(spaced[0]!),
  encodeCanonicalRow(
    fixture.rows.find((item) => item.object_identity === spaced[0]!.object_identity)!,
  ),
);

const parenChanged = mutate(fixture.rows, (row) => {
  Object.assign(
    row,
    fixture.rows.find((item) => item.object_kind === "check"),
  );
  row.object_definition = String(row.object_definition).replace("(", "");
  row.object_identity = "constraint:tamper.paren";
});
assert.equal(regionDigestChanged(parenChanged, "constraints"), true);

const firstDdl = migration.search(/^ALTER TABLE|^CREATE /m);
const guardStart = migration.indexOf("DO $$");
const guardEnd = migration.indexOf("END $$;", guardStart);
assert.ok(guardStart > 0);
assert.ok(guardEnd > guardStart);
assert.ok(firstDdl > guardEnd);

assert.equal(guard.includes("post-v94 live catalog fixture missing"), false);
for (const region of [...FINGERPRINT_REGIONS, "overall"]) {
  assert.ok(guard.includes(`"${region}"`), region);
}
assert.ok(guard.includes("v95_guard: % mismatch"));
assert.ok(guard.includes("v95_guard: % missing"));
assert.ok(guard.includes("v95_guard: % extra"));
assert.ok(guard.includes("v95_guard: extra"));
for (const digest of [
  ...Object.values(recomputed.regions).map((item) => item.digest),
  recomputed.overall.digest,
]) {
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.ok(guard.includes(digest), digest);
}
assert.equal(/EXCEPTION\s+WHEN/i.test(guard), false);
assert.equal(/\bCASCADE\b/.test(guard), false);
assert.equal(/\bSET\s+ROLE\b/i.test(guard), false);
assert.equal(/\bALTER\s+OWNER\b/i.test(guard), false);
assert.equal(/schema_migrations/i.test(guard), false);
assert.ok(guard.includes("must still be empty"));
assert.ok(guard.includes("aclexplode("));
assert.ok(guard.includes("a.grantee = 0"));
assert.ok(guard.includes("WHEN role_oid = 0 THEN 'PUBLIC'"));
assert.ok(guard.includes("'missing_oid:' || role_oid::text"));
assert.ok(guard.includes("d.deptype::text"));
assert.equal(transactionControls(migration)[0], "BEGIN;");
assert.ok(verifySql.includes("creation enabled default false"));
assert.ok(verifySql.includes("catalog fingerprint bound") || verifySql.includes("post-v94 catalog fingerprint"));
assert.ok(inventorySql.includes("aclexplode("));
assert.equal(inventorySql.includes("has_table_privilege(0"), false);

for (const table of TARGET_TABLES) {
  assert.ok(guard.includes(`'${table}'`));
}
for (const role of ACL_ROLES) {
  assert.ok(
    fixture.rows.some(
      (row) => row.object_kind === "table_acl" && row.acl_grantee === role,
    ),
  );
}
for (const privilege of ACL_PRIVILEGES) {
  assert.ok(
    fixture.rows.some(
      (row) => row.object_kind === "table_acl" && row.acl_privilege === privilege,
    ),
  );
}

assert.equal(
  gitDiff("supabase/migrations/20260911000001_matching_dual_post_foundation_v93.sql"),
  "",
);
assert.equal(
  gitDiff("supabase/migrations/20260911000002_matching_allocation_event_foundation_v94.sql"),
  "",
);
assert.equal(gitDiff("supabase/init.sql"), "");
assert.equal(
  readdirSync(join(repoRoot, "supabase/migrations")).some((name) =>
    name.includes("v96"),
  ),
  false,
);

assert.equal(parseCsvRecords("a,b\n1,2").length, 2);

console.log("v95PostV94Catalog.test.ts: ok");
console.log("Fingerprint recomputed from frozen rows; v95 is not applied.");
