/**
 * PHASE 6.7C.1B.3 — post-v94 catalog fingerprint helpers.
 * Dev/test only. Do not import from production API, writer, or UI.
 * Does not connect to PostgreSQL or Supabase.
 */

import { createHash } from "node:crypto";

/** Whitespace-only. Matches btrim(regexp_replace(value, '\s+', ' ', 'g')). */
function canonicalizeCatalogDef(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "";
  return raw.replace(/\s+/g, " ").trim();
}

export const INVENTORY_COLUMNS = [
  "scope",
  "object_kind",
  "schema_name",
  "table_name",
  "object_name",
  "object_order",
  "object_identity",
  "object_type",
  "attnum",
  "format_type",
  "not_null",
  "default_expr",
  "attidentity",
  "attgenerated",
  "condeferrable",
  "condeferred",
  "convalidated",
  "index_unique",
  "index_valid",
  "index_ready",
  "policy_permissive",
  "policy_roles",
  "policy_cmd",
  "policy_using",
  "policy_with_check",
  "acl_grantee",
  "acl_privilege",
  "acl_status",
  "trigger_enabled",
  "depend_type",
  "language_name",
  "volatility",
  "security_definer",
  "proconfig",
  "relrowsecurity",
  "relforcerowsecurity",
  "row_count",
  "object_definition",
] as const;

export type InventoryColumn = (typeof INVENTORY_COLUMNS)[number];

export const TARGET_TABLES = [
  "match_contact_invitations",
  "contact_grants",
  "match_requests",
  "match_contracts",
  "provider_trip_state",
  "contract_allocations",
  "contract_state_projections",
  "contract_events",
  "safety_checklist_acceptances",
  "safety_checklist_acceptance_items",
] as const;

export const FINGERPRINT_REGIONS = [
  "tables",
  "columns",
  "constraints",
  "indexes",
  "policies",
  "acl",
  "triggers",
  "sequences",
  "functions",
  "prerequisites",
] as const;

export type FingerprintRegion = (typeof FINGERPRINT_REGIONS)[number];

export const ACL_ROLES = ["PUBLIC", "anon", "authenticated", "service_role"] as const;
export const ACL_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

export const V95_NEW_OBJECT_MARKERS = [
  "match_request_revisions",
  "matching_request_creation_enabled",
  "matching_request_ttl_minutes",
  "current_revision_id",
  "accepted_revision_id",
  "idempotency_payload_hash",
  "create_match_request_v95",
  "inspect_match_request_v95",
  "read_match_request_candidate_snapshot_v95",
  "match_request_admission_facts_hash_v95",
  "match_request_admission_post_facts_v95",
  "matching_contact_mode",
] as const;

const INTEGER_COLUMNS = new Set<InventoryColumn>([
  "object_order",
  "attnum",
  "row_count",
]);

const BOOLEAN_COLUMNS = new Set<InventoryColumn>([
  "not_null",
  "condeferrable",
  "condeferred",
  "convalidated",
  "index_unique",
  "index_valid",
  "index_ready",
  "security_definer",
  "relrowsecurity",
  "relforcerowsecurity",
]);

const NORMALIZE_COLUMNS = new Set<InventoryColumn>([
  "default_expr",
  "policy_using",
  "policy_with_check",
  "object_definition",
]);

const KIND_ORDER: Record<string, number> = {
  table: 1,
  column: 2,
  primary_key: 3,
  unique: 4,
  check: 5,
  foreign_key: 6,
  independent_index: 7,
  rls_policy_count: 8,
  rls_policy: 9,
  table_acl: 10,
  trigger_count: 11,
  trigger: 12,
  owned_sequence_count: 13,
  owned_sequence: 14,
  expected_function_set: 15,
  extension: 16,
};

const SCOPE_ORDER: Record<string, number> = {
  table_fingerprint: 1,
  function_boundary: 2,
  prerequisite: 3,
};

const KIND_TO_REGION: Record<string, FingerprintRegion> = {
  table: "tables",
  column: "columns",
  primary_key: "constraints",
  unique: "constraints",
  check: "constraints",
  foreign_key: "constraints",
  constraint: "constraints",
  independent_index: "indexes",
  rls_policy_count: "policies",
  rls_policy: "policies",
  table_acl: "acl",
  trigger_count: "triggers",
  trigger: "triggers",
  owned_sequence_count: "sequences",
  owned_sequence: "sequences",
  expected_function_set: "functions",
  extension: "prerequisites",
};

export type InventoryValue = string | number | boolean | null;

export type InventoryRow = Record<InventoryColumn, InventoryValue>;

export type RegionDigest = {
  count: number;
  digest: string;
};

export type CatalogFingerprint = {
  source: string;
  row_count: number;
  regions: Record<FingerprintRegion, RegionDigest>;
  overall: RegionDigest;
};

export type CatalogFixture = CatalogFingerprint & {
  rows: InventoryRow[];
};

type CsvField = {
  raw: string;
  quoted: boolean;
};

export function parseCsvRecords(text: string): CsvField[][] {
  const records: CsvField[][] = [];
  let row: CsvField[] = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push({ raw: field, quoted });
      field = "";
      quoted = false;
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push({ raw: field, quoted });
      if (row.some((item) => item.raw.length > 0 || item.quoted)) {
        records.push(row);
      }
      row = [];
      field = "";
      quoted = false;
      continue;
    }
    field += ch;
  }
  if (inQuotes) throw new Error("unterminated CSV quote");
  if (field.length > 0 || quoted || row.length > 0) {
    row.push({ raw: field, quoted });
    if (row.some((item) => item.raw.length > 0 || item.quoted)) {
      records.push(row);
    }
  }
  return records;
}

function decodeField(
  column: InventoryColumn,
  field: CsvField,
): InventoryValue {
  if (!field.quoted && field.raw === "null") return null;
  if (INTEGER_COLUMNS.has(column)) {
    if (field.raw === "") {
      throw new Error(`${column} empty integer cell`);
    }
    if (!/^-?\d+$/.test(field.raw)) {
      throw new Error(`${column} is not an integer: ${field.raw}`);
    }
    return Number(field.raw);
  }
  if (BOOLEAN_COLUMNS.has(column)) {
    if (field.raw === "true") return true;
    if (field.raw === "false") return false;
    throw new Error(`${column} is not a boolean: ${field.raw}`);
  }
  return field.raw;
}

export function decodeInventoryRows(csvText: string): InventoryRow[] {
  const records = parseCsvRecords(csvText);
  if (records.length < 2) throw new Error("CSV has no data rows");
  const header = records[0]!.map((field) => field.raw);
  if (header.length !== INVENTORY_COLUMNS.length) {
    throw new Error(`CSV header has ${header.length} columns, expected 38`);
  }
  for (let i = 0; i < INVENTORY_COLUMNS.length; i += 1) {
    if (header[i] !== INVENTORY_COLUMNS[i]) {
      throw new Error(
        `CSV header mismatch at ${i + 1}: ${header[i]} != ${INVENTORY_COLUMNS[i]}`,
      );
    }
  }
  return records.slice(1).map((record, index) => {
    if (record.length !== INVENTORY_COLUMNS.length) {
      throw new Error(
        `CSV row ${index + 2} has ${record.length} columns, expected 38`,
      );
    }
    const row = {} as InventoryRow;
    for (let i = 0; i < INVENTORY_COLUMNS.length; i += 1) {
      const column = INVENTORY_COLUMNS[i]!;
      row[column] = decodeField(column, record[i]!);
    }
    return row;
  });
}

export function cloneInventoryRow(row: InventoryRow): InventoryRow {
  return { ...row };
}

export function cloneInventoryRows(rows: InventoryRow[]): InventoryRow[] {
  return rows.map(cloneInventoryRow);
}

export function inventoryRegion(kind: InventoryValue): FingerprintRegion {
  if (typeof kind !== "string" || !(kind in KIND_TO_REGION)) {
    throw new Error(`unknown object_kind: ${String(kind)}`);
  }
  return KIND_TO_REGION[kind]!;
}

function scopeOrd(scope: InventoryValue): number {
  return SCOPE_ORDER[String(scope)] ?? 4;
}

function kindOrd(kind: InventoryValue): number {
  return KIND_ORDER[String(kind)] ?? 17;
}

export function compareInventoryRows(a: InventoryRow, b: InventoryRow): number {
  const scope = scopeOrd(a.scope) - scopeOrd(b.scope);
  if (scope !== 0) return scope;
  const tableNameA = String(a.table_name);
  const tableNameB = String(b.table_name);
  if (tableNameA < tableNameB) return -1;
  if (tableNameA > tableNameB) return 1;
  const kind = kindOrd(a.object_kind) - kindOrd(b.object_kind);
  if (kind !== 0) return kind;
  const order = Number(a.object_order ?? 0) - Number(b.object_order ?? 0);
  if (order !== 0) return order;
  const idA = String(a.object_identity);
  const idB = String(b.object_identity);
  if (idA < idB) return -1;
  if (idA > idB) return 1;
  return 0;
}

export function encodeCanonicalField(
  column: InventoryColumn,
  value: InventoryValue,
): string {
  if (value === null) return "n";
  if (BOOLEAN_COLUMNS.has(column)) {
    if (typeof value !== "boolean") {
      throw new Error(`${column} expected boolean`);
    }
    return value ? "b:true" : "b:false";
  }
  if (INTEGER_COLUMNS.has(column)) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(`${column} expected integer`);
    }
    return `i:${value}`;
  }
  if (typeof value !== "string") {
    throw new Error(`${column} expected text`);
  }
  const text = NORMALIZE_COLUMNS.has(column)
    ? canonicalizeCatalogDef(value)
    : value;
  return `t:${text}`;
}

export function encodeCanonicalRow(row: InventoryRow): string {
  return INVENTORY_COLUMNS.map((column) =>
    encodeCanonicalField(column, row[column]),
  ).join("\u001f");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sortInventoryRows(rows: InventoryRow[]): InventoryRow[] {
  return cloneInventoryRows(rows).sort(compareInventoryRows);
}

export function digestRows(rows: InventoryRow[]): RegionDigest {
  const sorted = sortInventoryRows(rows);
  const payload = sorted.map(encodeCanonicalRow).join("\n");
  return {
    count: sorted.length,
    digest: sha256Hex(payload),
  };
}

export function buildCatalogFingerprint(
  rows: InventoryRow[],
  source = "Supabase Snippet Untitled query (25).csv",
): CatalogFingerprint {
  const regions = {} as Record<FingerprintRegion, RegionDigest>;
  for (const region of FINGERPRINT_REGIONS) {
    regions[region] = digestRows(
      rows.filter((row) => inventoryRegion(row.object_kind) === region),
    );
  }
  return {
    source,
    row_count: rows.length,
    regions,
    overall: digestRows(rows),
  };
}

export function validateInventoryRows(rows: InventoryRow[]): void {
  if (rows.length !== 590) {
    throw new Error(`expected 590 rows, got ${rows.length}`);
  }
  const identities = rows.map((row) => row.object_identity);
  if (identities.some((value) => value == null || value === "")) {
    throw new Error("object_identity must be non-empty");
  }
  if (new Set(identities.map(String)).size !== rows.length) {
    throw new Error("object_identity is not unique");
  }

  const tables = rows.filter((row) => row.object_kind === "table");
  if (tables.length !== 10) {
    throw new Error(`expected 10 table rows, got ${tables.length}`);
  }
  const tableNames = tables.map((row) => String(row.table_name)).sort();
  const expectedNames = [...TARGET_TABLES].sort();
  if (tableNames.join(",") !== expectedNames.join(",")) {
    throw new Error(`target tables mismatch: ${tableNames.join(",")}`);
  }
  for (const table of tables) {
    if (table.schema_name !== "public") {
      throw new Error(`${table.table_name} schema is not public`);
    }
    if (table.object_type !== "r") {
      throw new Error(`${table.table_name} object_type is not r`);
    }
    if (table.relrowsecurity !== true) {
      throw new Error(`${table.table_name} RLS is not true`);
    }
    if (table.relforcerowsecurity !== false) {
      throw new Error(`${table.table_name} FORCE RLS is not false`);
    }
    if (table.row_count !== 0) {
      throw new Error(`${table.table_name} is not empty`);
    }
  }

  const acl = rows.filter((row) => row.object_kind === "table_acl");
  if (acl.length !== 280) {
    throw new Error(`expected 280 ACL rows, got ${acl.length}`);
  }
  for (const table of TARGET_TABLES) {
    for (const role of ACL_ROLES) {
      for (const privilege of ACL_PRIVILEGES) {
        const hit = acl.find(
          (row) =>
            row.table_name === table &&
            row.acl_grantee === role &&
            row.acl_privilege === privilege,
        );
        if (!hit) {
          throw new Error(`ACL missing ${table} ${role} ${privilege}`);
        }
        if (hit.acl_status === "true" || hit.acl_status === "role_missing") {
          throw new Error(`ACL forbidden status ${table} ${role} ${privilege}`);
        }
      }
    }
  }

  for (const kind of ["rls_policy_count", "trigger_count", "owned_sequence_count"] as const) {
    const counts = rows.filter((row) => row.object_kind === kind);
    if (counts.length !== 10) {
      throw new Error(`${kind} expected 10 rows, got ${counts.length}`);
    }
    if (counts.some((row) => row.object_definition !== "0" && row.object_definition !== 0)) {
      throw new Error(`${kind} is not all zero`);
    }
  }
  if (rows.some((row) => row.object_kind === "rls_policy")) {
    throw new Error("unexpected rls_policy rows");
  }
  if (rows.some((row) => row.object_kind === "trigger")) {
    throw new Error("unexpected trigger rows");
  }
  if (rows.some((row) => row.object_kind === "owned_sequence")) {
    throw new Error("unexpected owned_sequence rows");
  }

  const pgcrypto = rows.find((row) => row.object_identity === "extension:pgcrypto");
  const postgis = rows.find((row) => row.object_identity === "extension:postgis");
  if (!pgcrypto || pgcrypto.object_type !== "present") {
    throw new Error("pgcrypto missing");
  }
  if (!String(pgcrypto.object_definition).includes("schema=extensions")) {
    throw new Error("pgcrypto schema mismatch");
  }
  if (!String(pgcrypto.object_definition).includes("version=1.3")) {
    throw new Error("pgcrypto version mismatch");
  }
  if (!postgis || postgis.object_type !== "present") {
    throw new Error("postgis missing");
  }
  if (!String(postgis.object_definition).includes("schema=public")) {
    throw new Error("postgis schema mismatch");
  }
  if (!String(postgis.object_definition).includes("version=3.3.7")) {
    throw new Error("postgis version mismatch");
  }

  const blob = JSON.stringify(rows);
  for (const marker of V95_NEW_OBJECT_MARKERS) {
    if (blob.includes(marker)) {
      throw new Error(`CSV contains v95 object: ${marker}`);
    }
  }
  if (/prosrc/i.test(blob)) {
    throw new Error("CSV contains prosrc");
  }
  if (/origin_address|profiles\.phone/i.test(blob)) {
    throw new Error("CSV contains sensitive business fields");
  }
  if (/(?:\+86|^\s*)1[3-9]\d{9}\b/.test(blob)) {
    throw new Error("CSV contains phone-like values");
  }

  const requestAttnums = rows
    .filter(
      (row) =>
        row.object_kind === "column" && row.table_name === "match_requests",
    )
    .map((row) => row.attnum as number);
  const contractAttnums = rows
    .filter(
      (row) =>
        row.object_kind === "column" && row.table_name === "match_contracts",
    )
    .map((row) => row.attnum as number);
  if (!requestAttnums.includes(1) || !requestAttnums.includes(10)) {
    throw new Error("match_requests attnum hole was rewritten");
  }
  if (requestAttnums.join(",") === requestAttnums.map((_, i) => i + 1).join(",")) {
    throw new Error("match_requests attnums were forced consecutive");
  }
  if (contractAttnums.join(",") === contractAttnums.map((_, i) => i + 1).join(",")) {
    throw new Error("match_contracts attnums were forced consecutive");
  }
}

export function loadValidatedCatalog(
  csvText: string,
  source?: string,
): { rows: InventoryRow[]; fingerprint: CatalogFingerprint } {
  const rows = decodeInventoryRows(csvText);
  validateInventoryRows(rows);
  return {
    rows,
    fingerprint: buildCatalogFingerprint(rows, source),
  };
}

export function fingerprintJson(fp: CatalogFingerprint): string {
  return JSON.stringify({
    source: fp.source,
    row_count: fp.row_count,
    regions: fp.regions,
    overall: fp.overall,
  });
}

export function extractInventoryCteChain(inventorySql: string): string {
  const start = inventorySql.search(/\bWITH\s+target\s+AS\s*\(/i);
  if (start < 0) throw new Error("inventory WITH target not found");
  const inv = inventorySql.search(/\binventory\s+AS\s*\(/i);
  if (inv < 0) throw new Error("inventory CTE not found");
  let depth = 0;
  let i = inv + inventorySql.slice(inv).indexOf("(");
  for (; i < inventorySql.length; i += 1) {
    const ch = inventorySql[i]!;
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return inventorySql.slice(start + 4, i + 1).trim();
      }
    }
  }
  throw new Error("unbalanced inventory CTE");
}

function sqlText(column: InventoryColumn, normalize: boolean): string {
  const expr = normalize
    ? `CASE WHEN ${column} IS NULL THEN 'n' ELSE 't:' || btrim(regexp_replace(${column}, '\\s+', ' ', 'g')) END`
    : `CASE WHEN ${column} IS NULL THEN 'n' ELSE 't:' || ${column} END`;
  return expr;
}

function sqlBool(column: InventoryColumn): string {
  return `CASE WHEN ${column} IS NULL THEN 'n' WHEN ${column} THEN 'b:true' ELSE 'b:false' END`;
}

function sqlInt(column: InventoryColumn): string {
  return `CASE WHEN ${column} IS NULL THEN 'n' ELSE 'i:' || ${column}::text END`;
}

export function sqlCanonicalLineExpr(): string {
  return INVENTORY_COLUMNS.map((column) => {
    if (BOOLEAN_COLUMNS.has(column)) return sqlBool(column);
    if (INTEGER_COLUMNS.has(column)) return sqlInt(column);
    return sqlText(column, NORMALIZE_COLUMNS.has(column));
  }).join("\n      || chr(31) || ");
}

export function renderExpectedFingerprintSql(fp: CatalogFingerprint): string {
  const body: Record<string, RegionDigest> = {
    ...fp.regions,
    overall: fp.overall,
  };
  return JSON.stringify(body);
}

export function renderV95CatalogGuardDoBlock(
  inventorySql: string,
  fp: CatalogFingerprint,
): string {
  const cte = extractInventoryCteChain(inventorySql);
  const expected = renderExpectedFingerprintSql(fp);
  const line = sqlCanonicalLineExpr();
  const tables = TARGET_TABLES.map((name) => `    '${name}'`).join(",\n");
  return `DO $$
DECLARE
  t text;
  live_n bigint;
  r record;
  expected jsonb := $v95_fp$${expected}$v95_fp$::jsonb;
  exp jsonb;
  seen text[] := ARRAY[]::text[];
  want text;
  fn_count int;
BEGIN
  FOREACH t IN ARRAY ARRAY[
${tables}
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'v95_guard: table missing: %', t;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO live_n;
    IF live_n IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'v95_guard: % must still be empty', t;
    END IF;
  END LOOP;

  IF to_regclass('public.posts') IS NULL THEN
    RAISE EXCEPTION 'v95_guard: posts missing';
  END IF;
  IF to_regclass('public.system_configs') IS NULL THEN
    RAISE EXCEPTION 'v95_guard: system_configs missing';
  END IF;
  IF to_regclass('public.match_request_revisions') IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: match_request_revisions already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.match_requests'::regclass
      AND a.attname IN (
        'current_revision_id',
        'accepted_revision_id',
        'idempotency_payload_hash'
      )
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'v95_guard: request revision pointers or idempotency hash already exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.system_configs'::regclass
      AND a.attname IN (
        'matching_contact_mode',
        'matching_contact_policy_version',
        'matching_contact_invitation_ttl_minutes',
        'matching_contact_max_open_per_initiator_post',
        'matching_contact_max_created_per_actor_24h',
        'matching_request_creation_enabled',
        'matching_request_ttl_minutes',
        'matching_request_max_open_per_initiator_post',
        'matching_request_max_created_per_actor_24h',
        'matching_request_max_revisions_per_request',
        'matching_route_max_extra_detour_km',
        'matching_route_max_extra_detour_ratio'
      )
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'v95_guard: matching request config columns already exist';
  END IF;

  IF to_regprocedure(
    'public.create_match_request_v95(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,bigint,text,bigint,bigint,integer,integer,integer,text,boolean,boolean)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: target writer already exists';
  END IF;
  IF to_regprocedure('public.inspect_match_request_v95(uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: inspect already exists';
  END IF;
  IF to_regprocedure(
    'public.read_match_request_candidate_snapshot_v95(uuid,uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: snapshot rpc already exists';
  END IF;
  IF to_regprocedure(
    'public.match_request_admission_facts_hash_v95(jsonb)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: admission hash rpc already exists';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'match_request_admission_post_facts_v95'
  ) THEN
    RAISE EXCEPTION 'v95_guard: admission facts helper already exists';
  END IF;

  SELECT count(*)::int INTO fn_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_match_request_v95',
      'inspect_match_request_v95',
      'read_match_request_candidate_snapshot_v95',
      'match_request_admission_facts_hash_v95',
      'match_request_admission_post_facts_v95',
      'create_match_contact_invitation_v95',
      'inspect_match_contact_invitation_v95'
    );
  IF fn_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'v95_guard: leftover matching rpc exists';
  END IF;

  FOR r IN
    WITH
    ${cte},
    canon AS (
      SELECT
        CASE object_kind
          WHEN 'table' THEN 'tables'
          WHEN 'column' THEN 'columns'
          WHEN 'primary_key' THEN 'constraints'
          WHEN 'unique' THEN 'constraints'
          WHEN 'check' THEN 'constraints'
          WHEN 'foreign_key' THEN 'constraints'
          WHEN 'constraint' THEN 'constraints'
          WHEN 'independent_index' THEN 'indexes'
          WHEN 'rls_policy_count' THEN 'policies'
          WHEN 'rls_policy' THEN 'policies'
          WHEN 'table_acl' THEN 'acl'
          WHEN 'trigger_count' THEN 'triggers'
          WHEN 'trigger' THEN 'triggers'
          WHEN 'owned_sequence_count' THEN 'sequences'
          WHEN 'owned_sequence' THEN 'sequences'
          WHEN 'expected_function_set' THEN 'functions'
          WHEN 'extension' THEN 'prerequisites'
          ELSE 'unknown'
        END AS region,
        CASE scope
          WHEN 'table_fingerprint' THEN 1
          WHEN 'function_boundary' THEN 2
          WHEN 'prerequisite' THEN 3
          ELSE 4
        END AS scope_ord,
        table_name,
        CASE object_kind
          WHEN 'table' THEN 1
          WHEN 'column' THEN 2
          WHEN 'primary_key' THEN 3
          WHEN 'unique' THEN 4
          WHEN 'check' THEN 5
          WHEN 'foreign_key' THEN 6
          WHEN 'independent_index' THEN 7
          WHEN 'rls_policy_count' THEN 8
          WHEN 'rls_policy' THEN 9
          WHEN 'table_acl' THEN 10
          WHEN 'trigger_count' THEN 11
          WHEN 'trigger' THEN 12
          WHEN 'owned_sequence_count' THEN 13
          WHEN 'owned_sequence' THEN 14
          WHEN 'expected_function_set' THEN 15
          WHEN 'extension' THEN 16
          ELSE 17
        END AS kind_ord,
        object_order,
        object_identity,
        (
          ${line}
        ) AS line
      FROM inventory
    ),
    hashed AS (
      SELECT
        region,
        count(*)::bigint AS n,
        encode(
          extensions.digest(
            convert_to(
              coalesce(
                string_agg(
                  line,
                  E'\\n'
                  ORDER BY
                    scope_ord,
                    table_name COLLATE "C",
                    kind_ord,
                    object_order,
                    object_identity COLLATE "C"
                ),
                ''
              ),
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ) AS digest
      FROM canon
      GROUP BY region
    ),
    overall AS (
      SELECT
        'overall'::text AS region,
        count(*)::bigint AS n,
        encode(
          extensions.digest(
            convert_to(
              coalesce(
                string_agg(
                  line,
                  E'\\n'
                  ORDER BY
                    scope_ord,
                    table_name COLLATE "C",
                    kind_ord,
                    object_order,
                    object_identity COLLATE "C"
                ),
                ''
              ),
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ) AS digest
      FROM canon
    )
    SELECT region, n, digest FROM hashed
    UNION ALL
    SELECT region, n, digest FROM overall
  LOOP
    IF r.region = 'unknown' THEN
      RAISE EXCEPTION 'v95_guard: extra';
    END IF;
    exp := expected->r.region;
    IF exp IS NULL THEN
      RAISE EXCEPTION 'v95_guard: extra';
    END IF;
    IF r.n < (exp->>'count')::bigint THEN
      RAISE EXCEPTION 'v95_guard: % missing', r.region;
    END IF;
    IF r.n > (exp->>'count')::bigint THEN
      RAISE EXCEPTION 'v95_guard: % extra', r.region;
    END IF;
    IF r.digest IS DISTINCT FROM (exp->>'digest') THEN
      RAISE EXCEPTION 'v95_guard: % mismatch', r.region;
    END IF;
    seen := array_append(seen, r.region);
  END LOOP;

  FOREACH want IN ARRAY ARRAY[
    'tables', 'columns', 'constraints', 'indexes', 'policies', 'acl',
    'triggers', 'sequences', 'functions', 'prerequisites', 'overall'
  ] LOOP
    IF NOT want = ANY (seen) THEN
      RAISE EXCEPTION 'v95_guard: % missing', want;
    END IF;
  END LOOP;
END $$;`;
}
