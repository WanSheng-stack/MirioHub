/**
 * PHASE 6.7C.1B.3A.3 — collision-free encoding v2 + guard generator lock.
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
  declareAliasCollisions,
  decodeInventoryRows,
  digestRows,
  ENCODING_VERSION,
  encodeCanonicalField,
  encodeCanonicalRow,
  encodeHexTextFields,
  encodeLegacyRawTextFields,
  extractDeclareNames,
  extractSqlAliases,
  type InventoryRow,
  normalizeGuardEol,
  parseCsvRecords,
  renderV95CatalogGuardDoBlock,
  sortInventoryRows,
  sqlCanonicalLineExpr,
  utf8Hex,
  validateInventoryRows,
} from "@/lib/matching/v95PostV94Catalog";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const PHASE_BASELINE = "24c46f693ae5dca3bcc54a9ff4430aa736e26115";

const fixture = JSON.parse(
  read("src/lib/matching/v95PostV94Catalog.fixture.json"),
) as {
  source: string;
  encoding_version: number;
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
assert.equal(encodeCanonicalField("acl_status", "false"), `t:${utf8Hex("false")}`);
assert.equal(encodeCanonicalField("relforcerowsecurity", false), "b:false");
assert.notEqual(
  encodeCanonicalField("acl_status", "false"),
  encodeCanonicalField("relforcerowsecurity", false),
);
assert.notEqual(encodeCanonicalField("object_name", "null"), "n");
assert.equal(encodeCanonicalField("object_name", "null"), `t:${utf8Hex("null")}`);
assert.equal(encodeCanonicalField("object_name", ""), "t:");
assert.equal(utf8Hex("hello"), "68656c6c6f");
assert.equal(utf8Hex(""), "");
assert.equal(utf8Hex("null"), "6e756c6c");
assert.match(utf8Hex("Hello"), /^[0-9a-f]*$/);
assert.equal(utf8Hex("Hello"), utf8Hex("Hello").toLowerCase());
assert.equal(utf8Hex("你好"), Buffer.from("你好", "utf8").toString("hex"));
assert.equal(utf8Hex("Привет"), Buffer.from("Привет", "utf8").toString("hex"));
assert.equal(utf8Hex("café"), Buffer.from("café", "utf8").toString("hex"));

assert.equal(encodeCanonicalField("object_name", "a\u001fb").includes("\u001f"), false);
assert.equal(encodeCanonicalField("object_name", "a\nb").includes("\n"), false);
assert.equal(encodeCanonicalField("object_name", "a\r\nb").includes("\r"), false);
for (const token of ["n", "t:", "b:true", "i:1"]) {
  assert.notEqual(encodeCanonicalField("object_name", token), token);
  assert.equal(encodeCanonicalField("object_name", token), `t:${utf8Hex(token)}`);
}

const legacyCollisionLeft = encodeLegacyRawTextFields(["hello\u001ft:world"]);
const legacyCollisionRight = encodeLegacyRawTextFields(["hello", "world"]);
assert.equal(legacyCollisionLeft, legacyCollisionRight);
assert.notEqual(
  encodeHexTextFields(["hello\u001ft:world"]),
  encodeHexTextFields(["hello", "world"]),
);
const legacyRows = ["t:a", "t:b"].join("\n");
assert.equal(encodeLegacyRawTextFields(["a\nt:b"]), legacyRows);
assert.notEqual(`t:${utf8Hex("a\nt:b")}`, ["a", "b"].map((v) => `t:${utf8Hex(v)}`).join("\n"));

assert.equal(fixture.encoding_version, ENCODING_VERSION);
assert.equal(recomputed.encoding_version, ENCODING_VERSION);
assert.deepEqual(
  buildCatalogFingerprint(fixture.rows, fixture.source),
  recomputed,
);

const baselineFixture = JSON.parse(
  execFileSync(
    "git",
    ["show", `${PHASE_BASELINE}:src/lib/matching/v95PostV94Catalog.fixture.json`],
    { cwd: repoRoot, encoding: "utf8" },
  ),
) as { rows: InventoryRow[] };
assert.equal(baselineFixture.rows.length, 590);
assert.deepEqual(fixture.rows, baselineFixture.rows);

const sqlLine = sqlCanonicalLineExpr();
const sqlFields = sqlLine.split(/\n\s*\|\| chr\(31\) \|\| /);
assert.equal(sqlFields.length, INVENTORY_COLUMNS.length);
for (let i = 0; i < INVENTORY_COLUMNS.length; i += 1) {
  const column = INVENTORY_COLUMNS[i]!;
  assert.ok(sqlFields[i]!.includes(column), column);
}
assert.ok(sqlLine.includes("encode(convert_to("));
assert.ok(sqlLine.includes("encode(convert_to(btrim(regexp_replace(object_definition"));
assert.ok(sqlLine.includes("encode(convert_to(btrim(regexp_replace(default_expr"));
assert.ok(sqlLine.includes("encode(convert_to(btrim(regexp_replace(policy_using"));
assert.ok(sqlLine.includes("encode(convert_to(btrim(regexp_replace(policy_with_check"));
assert.equal(/'t:' \|\| [a-z_]+(?:\s|$)/.test(sqlLine), false);
assert.equal(sqlLine.includes("'t:' || object_definition"), false);
assert.equal(
  gitDiff(
    "supabase/migrations/20260911000003_v95_preapply_catalog_inventory.verify.sql",
  ),
  "",
);

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

const renderedGuard = renderV95CatalogGuardDoBlock(inventorySql, recomputed);
assert.equal(/\br record\b/.test(renderedGuard), false);
assert.equal(/\bFOR r IN\b/.test(renderedGuard), false);
assert.equal(/\bt text;/.test(renderedGuard), false);
assert.equal(/\bFOREACH t IN\b/.test(renderedGuard), false);
assert.ok(/\bv_fingerprint_row record\b/.test(renderedGuard));
assert.ok(/\bFOR v_fingerprint_row IN\b/.test(renderedGuard));
assert.ok(/\bv_target_table text\b/.test(renderedGuard));
assert.ok(/\bFOREACH v_target_table IN\b/.test(renderedGuard));
assert.equal(normalizeGuardEol(renderedGuard), normalizeGuardEol(guard));
assert.deepEqual(declareAliasCollisions(renderedGuard), []);
assert.deepEqual(
  declareAliasCollisions(`
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT 1 FROM pg_catalog.pg_roles r
  LOOP
    NULL;
  END LOOP;
END $$;
`),
  ["r"],
);
assert.deepEqual(
  declareAliasCollisions(`
DO $$
DECLARE
  v_fingerprint_row record;
BEGIN
  FOR v_fingerprint_row IN
    SELECT 1 FROM pg_catalog.pg_roles r
  LOOP
    NULL;
  END LOOP;
END $$;
`),
  [],
);
assert.equal(extractDeclareNames(renderedGuard).includes("r"), false);
assert.equal(extractDeclareNames(renderedGuard).includes("t"), false);
assert.ok(extractSqlAliases(renderedGuard).includes("r"));

assert.equal(guard.includes("post-v94 live catalog fixture missing"), false);
assert.ok(guard.includes("encoding_version"));
assert.ok(guard.includes("encode(convert_to("));
assert.ok(guard.includes("encode(convert_to(btrim(regexp_replace(object_definition"));
assert.equal(/'t:' \|\| object_definition\b/.test(guard), false);
assert.equal(/'t:' \|\| [a-z_]+ END/.test(guard), false);
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
assert.ok(
  verifySql.includes("encoding-v2") &&
    verifySql.includes("post-v94 catalog") &&
    verifySql.includes("UTF-8 lowercase hex"),
);
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
  gitDiff("supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql"),
  "",
);
assert.equal(
  gitDiff("supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql"),
  "",
);
assert.equal(
  gitDiff("supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql"),
  "",
);
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
