/**
 * PHASE 6.7A.2 / 6.7A.2A — parse-only dual-post foundation contract.
 * Not a writer. Must not be imported by API, UI, or production matching code.
 */

export const V93_MIGRATION_REL =
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.sql";
export const V93_VERIFY_REL =
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.verify.sql";
export const V90_MIGRATION_REL =
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql";

export const V93_TABLES = [
  "match_contact_invitations",
  "contact_grants",
  "match_requests",
  "match_contracts",
] as const;

export const V93_APP_ROLES = [
  "PUBLIC",
  "anon",
  "authenticated",
  "service_role",
] as const;

export const V93_FORBIDDEN_TABLES = [
  "match_contact_invitations",
  "contact_grants",
] as const;

export const V90_REQUEST_DROPPED_COLUMNS = [
  "target_post_id",
  "target_post_type",
  "applicant_user_id",
  "recipient_user_id",
  "applicant_role",
  "payload_version",
  "application_payload",
  "status",
] as const;

export const V90_CONTRACT_DROPPED_COLUMNS = [
  "source_post_id",
  "source_post_type",
  "status",
  "accepted_at",
  "in_progress_at",
  "completed_at",
  "cancelled_at",
] as const;

export const V93_REQUEST_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "invalidated",
  "expired",
] as const;

export const V93_CONTRACT_LIFECYCLE = [
  "formed",
  "in_progress",
  "pending_completion",
  "completed",
  "cancelled",
] as const;

export const CONTACT_CHANNELS = ["phone", "whatsapp", "viber"] as const;

export const REQUEST_ASSERTION_FORBIDDEN_FACT_KEYS = [
  "seats",
  "cargo",
  "route",
  "time",
  "fee",
  "phone",
  "plate",
] as const;

export type CatalogColumn = {
  name: string;
  type: string;
  not_null: boolean;
  default_norm: string;
};

export type CatalogConstraint = {
  name: string;
  type: "p" | "u" | "c" | "f";
  def: string;
};

export type CatalogIndex = {
  name: string;
  def: string;
};

export type TableFingerprint = {
  relkind: "r";
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  columns: CatalogColumn[];
  constraints: CatalogConstraint[];
  indexes: CatalogIndex[];
};

export type FingerprintMismatch = {
  table: string;
  kind: "column" | "constraint" | "index" | "rls" | "relkind" | "empty" | "table";
  issue: "missing" | "extra" | "mismatch";
  object: string;
};

export type ChannelArrayShape = {
  ndims: number;
  lower: number;
  values: Array<string | null>;
};

export const V90_REQUEST_FINGERPRINT: TableFingerprint = {
  relkind: "r",
  relrowsecurity: true,
  relforcerowsecurity: false,
  columns: [
    { name: "id", type: "uuid", not_null: true, default_norm: "gen_random_uuid()" },
    { name: "target_post_id", type: "uuid", not_null: true, default_norm: "" },
    { name: "target_post_type", type: "text", not_null: true, default_norm: "" },
    { name: "applicant_user_id", type: "uuid", not_null: true, default_norm: "" },
    { name: "recipient_user_id", type: "uuid", not_null: true, default_norm: "" },
    { name: "applicant_role", type: "text", not_null: true, default_norm: "" },
    { name: "status", type: "text", not_null: true, default_norm: "'pending'" },
    { name: "payload_version", type: "integer", not_null: true, default_norm: "1" },
    {
      name: "application_payload",
      type: "jsonb",
      not_null: true,
      default_norm: "'{}'::jsonb",
    },
    { name: "client_request_id", type: "uuid", not_null: true, default_norm: "" },
    {
      name: "created_at",
      type: "timestamp with time zone",
      not_null: true,
      default_norm: "timezone('utc', now())",
    },
    {
      name: "updated_at",
      type: "timestamp with time zone",
      not_null: true,
      default_norm: "timezone('utc', now())",
    },
    {
      name: "responded_at",
      type: "timestamp with time zone",
      not_null: false,
      default_norm: "",
    },
    {
      name: "expires_at",
      type: "timestamp with time zone",
      not_null: false,
      default_norm: "",
    },
  ],
  constraints: [
    { name: "match_requests_pkey", type: "p", def: "PRIMARY KEY (id)" },
    {
      name: "match_requests_target_post_type_check",
      type: "c",
      def: "CHECK (target_post_type IN ('demand', 'provider'))",
    },
    {
      name: "match_requests_applicant_role_check",
      type: "c",
      def: "CHECK (applicant_role IN ('demand', 'provider'))",
    },
    {
      name: "match_requests_status_check",
      type: "c",
      def: "CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'expired'))",
    },
    {
      name: "match_requests_payload_version_check",
      type: "c",
      def: "CHECK (payload_version > 0)",
    },
    {
      name: "match_requests_application_payload_object_check",
      type: "c",
      def: "CHECK (jsonb_typeof(application_payload) = 'object')",
    },
    {
      name: "match_requests_applicant_ne_recipient",
      type: "c",
      def: "CHECK (applicant_user_id <> recipient_user_id)",
    },
    {
      name: "match_requests_role_aligns_target",
      type: "c",
      def: "CHECK ((target_post_type = 'demand' AND applicant_role = 'provider') OR (target_post_type = 'provider' AND applicant_role = 'demand'))",
    },
    {
      name: "match_requests_applicant_client_request_id_key",
      type: "u",
      def: "UNIQUE (applicant_user_id, client_request_id)",
    },
    {
      name: "match_requests_target_post_id_fkey",
      type: "f",
      def: "FOREIGN KEY (target_post_id) REFERENCES posts(id) ON DELETE RESTRICT",
    },
    {
      name: "match_requests_applicant_user_id_fkey",
      type: "f",
      def: "FOREIGN KEY (applicant_user_id) REFERENCES profiles(id) ON DELETE RESTRICT",
    },
    {
      name: "match_requests_recipient_user_id_fkey",
      type: "f",
      def: "FOREIGN KEY (recipient_user_id) REFERENCES profiles(id) ON DELETE RESTRICT",
    },
  ],
  indexes: [
    {
      name: "match_requests_one_pending_per_applicant_target",
      def: "CREATE UNIQUE INDEX match_requests_one_pending_per_applicant_target ON match_requests USING btree (target_post_id, applicant_user_id) WHERE status = 'pending'",
    },
    {
      name: "match_requests_target_post_id_idx",
      def: "CREATE INDEX match_requests_target_post_id_idx ON match_requests USING btree (target_post_id)",
    },
    {
      name: "match_requests_recipient_user_id_idx",
      def: "CREATE INDEX match_requests_recipient_user_id_idx ON match_requests USING btree (recipient_user_id)",
    },
  ],
};

export const V90_CONTRACT_FINGERPRINT: TableFingerprint = {
  relkind: "r",
  relrowsecurity: true,
  relforcerowsecurity: false,
  columns: [
    { name: "id", type: "uuid", not_null: true, default_norm: "gen_random_uuid()" },
    { name: "request_id", type: "uuid", not_null: true, default_norm: "" },
    { name: "source_post_id", type: "uuid", not_null: true, default_norm: "" },
    { name: "source_post_type", type: "text", not_null: true, default_norm: "" },
    { name: "demand_user_id", type: "uuid", not_null: true, default_norm: "" },
    { name: "provider_user_id", type: "uuid", not_null: true, default_norm: "" },
    { name: "status", type: "text", not_null: true, default_norm: "'accepted'" },
    { name: "snapshot_version", type: "integer", not_null: true, default_norm: "1" },
    { name: "demand_snapshot", type: "jsonb", not_null: true, default_norm: "" },
    { name: "provider_snapshot", type: "jsonb", not_null: true, default_norm: "" },
    { name: "agreement_snapshot", type: "jsonb", not_null: true, default_norm: "" },
    {
      name: "accepted_at",
      type: "timestamp with time zone",
      not_null: true,
      default_norm: "timezone('utc', now())",
    },
    {
      name: "in_progress_at",
      type: "timestamp with time zone",
      not_null: false,
      default_norm: "",
    },
    {
      name: "completed_at",
      type: "timestamp with time zone",
      not_null: false,
      default_norm: "",
    },
    {
      name: "cancelled_at",
      type: "timestamp with time zone",
      not_null: false,
      default_norm: "",
    },
    {
      name: "created_at",
      type: "timestamp with time zone",
      not_null: true,
      default_norm: "timezone('utc', now())",
    },
    {
      name: "updated_at",
      type: "timestamp with time zone",
      not_null: true,
      default_norm: "timezone('utc', now())",
    },
  ],
  constraints: [
    { name: "match_contracts_pkey", type: "p", def: "PRIMARY KEY (id)" },
    {
      name: "match_contracts_request_id_key",
      type: "u",
      def: "UNIQUE (request_id)",
    },
    {
      name: "match_contracts_request_id_fkey",
      type: "f",
      def: "FOREIGN KEY (request_id) REFERENCES match_requests(id) ON DELETE RESTRICT",
    },
    {
      name: "match_contracts_source_post_id_fkey",
      type: "f",
      def: "FOREIGN KEY (source_post_id) REFERENCES posts(id) ON DELETE RESTRICT",
    },
    {
      name: "match_contracts_source_post_type_check",
      type: "c",
      def: "CHECK (source_post_type IN ('demand', 'provider'))",
    },
    {
      name: "match_contracts_demand_user_id_fkey",
      type: "f",
      def: "FOREIGN KEY (demand_user_id) REFERENCES profiles(id) ON DELETE RESTRICT",
    },
    {
      name: "match_contracts_provider_user_id_fkey",
      type: "f",
      def: "FOREIGN KEY (provider_user_id) REFERENCES profiles(id) ON DELETE RESTRICT",
    },
    {
      name: "match_contracts_status_check",
      type: "c",
      def: "CHECK (status IN ('accepted', 'in_progress', 'pending_completion', 'completed', 'disputed', 'cancelled'))",
    },
    {
      name: "match_contracts_snapshot_version_check",
      type: "c",
      def: "CHECK (snapshot_version > 0)",
    },
    {
      name: "match_contracts_demand_snapshot_object_check",
      type: "c",
      def: "CHECK (jsonb_typeof(demand_snapshot) = 'object')",
    },
    {
      name: "match_contracts_provider_snapshot_object_check",
      type: "c",
      def: "CHECK (jsonb_typeof(provider_snapshot) = 'object')",
    },
    {
      name: "match_contracts_agreement_snapshot_object_check",
      type: "c",
      def: "CHECK (jsonb_typeof(agreement_snapshot) = 'object')",
    },
    {
      name: "match_contracts_demand_ne_provider",
      type: "c",
      def: "CHECK (demand_user_id <> provider_user_id)",
    },
    {
      name: "match_contracts_completed_requires_timestamp",
      type: "c",
      def: "CHECK (status <> 'completed' OR completed_at IS NOT NULL)",
    },
    {
      name: "match_contracts_cancelled_requires_timestamp",
      type: "c",
      def: "CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)",
    },
    {
      name: "match_contracts_completion_cancellation_exclusive",
      type: "c",
      def: "CHECK (completed_at IS NULL OR cancelled_at IS NULL)",
    },
  ],
  indexes: [
    {
      name: "match_contracts_provider_user_id_idx",
      def: "CREATE INDEX match_contracts_provider_user_id_idx ON match_contracts USING btree (provider_user_id)",
    },
    {
      name: "match_contracts_demand_user_id_idx",
      def: "CREATE INDEX match_contracts_demand_user_id_idx ON match_contracts USING btree (demand_user_id)",
    },
    {
      name: "match_contracts_source_post_id_idx",
      def: "CREATE INDEX match_contracts_source_post_id_idx ON match_contracts USING btree (source_post_id)",
    },
  ],
};

export function nonCommentSqlLines(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));
}

export function transactionControls(sql: string): string[] {
  return nonCommentSqlLines(sql).filter((line) =>
    /^(BEGIN|COMMIT|ROLLBACK)\s*;$/i.test(line),
  );
}

export function sqlBody(sql: string): string {
  return nonCommentSqlLines(sql).join("\n");
}

export function forbiddenSqlOps(sql: string): string[] {
  const body = sqlBody(sql);
  const hits: string[] = [];
  if (/\bCASCADE\b/i.test(body)) hits.push("CASCADE");
  if (/\bTRUNCATE\b/i.test(body)) hits.push("TRUNCATE");
  if (/\bSET\s+ROLE\b/i.test(body)) hits.push("SET ROLE");
  if (/\bOWNER\s+TO\b/i.test(body) || /\bALTER\s+OWNER\b/i.test(body)) {
    hits.push("ALTER OWNER");
  }
  if (/\bDROP\s+TABLE\b/i.test(body)) hits.push("DROP TABLE");
  if (/\bEXCEPTION\s+WHEN\b/i.test(body)) hits.push("EXCEPTION WHEN");
  if (/\bCREATE\s+POLICY\b/i.test(body)) hits.push("CREATE POLICY");
  if (/\bGRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i.test(body)) {
    hits.push("GRANT");
  }
  if (/\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(body)) {
    hits.push("CREATE FUNCTION");
  }
  if (/\bCREATE\s+TRIGGER\b/i.test(body)) hits.push("CREATE TRIGGER");
  if (/\bCREATE\s+SEQUENCE\b/i.test(body)) hits.push("CREATE SEQUENCE");
  if (/\b(CREATE|DROP|ALTER)\b[\s\S]{0,80}\bIF\s+NOT\s+EXISTS\b/i.test(body)) {
    hits.push("IF NOT EXISTS");
  }
  if (/\b(CREATE|DROP|ALTER)\b[\s\S]{0,80}\bIF\s+EXISTS\b/i.test(body)) {
    hits.push("IF EXISTS");
  }
  return hits;
}

export function extractDoBlock(sql: string): string {
  const start = sql.search(/\bDO\s+\$\$/i);
  if (start < 0) return "";
  const end = sql.indexOf("END $$;", start);
  if (end < 0) return sql.slice(start);
  return sql.slice(start, end + "END $$;".length);
}

export function normalizeDefaultExpr(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "";
  let s = raw.toLowerCase();
  s = s.replace(/::text/g, "");
  s = s.replace(/\bpublic\./g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function normalizeCatalogDef(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "";
  let s = raw.toLowerCase();
  s = s.replace(/::text/g, "");
  s = s.replace(/::regclass/g, "");
  s = s.replace(/\bpublic\./g, "");
  s = s.replace(/\s+on update no action\b/g, "");
  s = s.replace(/= any \(array\[([^\]]*)\]\)/g, "in ($1)");
  s = s.replace(
    / on (match_requests|match_contracts) \(/g,
    " on $1 using btree (",
  );
  s = s.replace(/[()]/g, " ");
  s = s.replace(/,/g, ", ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function cloneFingerprint(fp: TableFingerprint): TableFingerprint {
  return {
    relkind: fp.relkind,
    relrowsecurity: fp.relrowsecurity,
    relforcerowsecurity: fp.relforcerowsecurity,
    columns: fp.columns.map((column) => ({ ...column })),
    constraints: fp.constraints.map((constraint) => ({ ...constraint })),
    indexes: fp.indexes.map((index) => ({ ...index })),
  };
}

export function diffTableFingerprint(
  table: string,
  expected: TableFingerprint,
  actual: TableFingerprint,
): FingerprintMismatch[] {
  const mismatches: FingerprintMismatch[] = [];
  if (actual.relkind !== expected.relkind) {
    mismatches.push({
      table,
      kind: "relkind",
      issue: "mismatch",
      object: "relkind",
    });
  }
  if (actual.relrowsecurity !== expected.relrowsecurity) {
    mismatches.push({
      table,
      kind: "rls",
      issue: "mismatch",
      object: "relrowsecurity",
    });
  }
  if (actual.relforcerowsecurity !== expected.relforcerowsecurity) {
    mismatches.push({
      table,
      kind: "rls",
      issue: "mismatch",
      object: "relforcerowsecurity",
    });
  }

  const expCols = expected.columns;
  const actCols = actual.columns;
  const expColNames = expCols.map((column) => column.name);
  const actColNames = actCols.map((column) => column.name);
  for (const name of expColNames) {
    if (!actColNames.includes(name)) {
      mismatches.push({ table, kind: "column", issue: "missing", object: name });
    }
  }
  for (const name of actColNames) {
    if (!expColNames.includes(name)) {
      mismatches.push({ table, kind: "column", issue: "extra", object: name });
    }
  }
  if (expColNames.join("\0") !== actColNames.join("\0")) {
    if (
      !mismatches.some(
        (item) => item.kind === "column" && item.object === "order",
      )
    ) {
      const onlyOrder =
        [...expColNames].sort().join("\0") === [...actColNames].sort().join("\0");
      if (onlyOrder) {
        mismatches.push({
          table,
          kind: "column",
          issue: "mismatch",
          object: "order",
        });
      }
    }
  }
  for (let i = 0; i < Math.min(expCols.length, actCols.length); i += 1) {
    const exp = expCols[i];
    const act = actCols[i];
    if (exp.name !== act.name) continue;
    if (
      exp.type !== act.type ||
      exp.not_null !== act.not_null ||
      normalizeDefaultExpr(exp.default_norm) !==
        normalizeDefaultExpr(act.default_norm)
    ) {
      mismatches.push({
        table,
        kind: "column",
        issue: "mismatch",
        object: exp.name,
      });
    }
  }

  const expCons = new Map(
    expected.constraints.map((constraint) => [constraint.name, constraint]),
  );
  const actCons = new Map(
    actual.constraints.map((constraint) => [constraint.name, constraint]),
  );
  for (const name of expCons.keys()) {
    if (!actCons.has(name)) {
      mismatches.push({
        table,
        kind: "constraint",
        issue: "missing",
        object: name,
      });
    }
  }
  for (const name of actCons.keys()) {
    if (!expCons.has(name)) {
      mismatches.push({
        table,
        kind: "constraint",
        issue: "extra",
        object: name,
      });
    }
  }
  for (const [name, exp] of expCons) {
    const act = actCons.get(name);
    if (!act) continue;
    if (
      act.type !== exp.type ||
      normalizeCatalogDef(act.def) !== normalizeCatalogDef(exp.def)
    ) {
      mismatches.push({
        table,
        kind: "constraint",
        issue: "mismatch",
        object: name,
      });
    }
  }

  const expIdx = new Map(expected.indexes.map((index) => [index.name, index]));
  const actIdx = new Map(actual.indexes.map((index) => [index.name, index]));
  for (const name of expIdx.keys()) {
    if (!actIdx.has(name)) {
      mismatches.push({ table, kind: "index", issue: "missing", object: name });
    }
  }
  for (const name of actIdx.keys()) {
    if (!expIdx.has(name)) {
      mismatches.push({ table, kind: "index", issue: "extra", object: name });
    }
  }
  for (const [name, exp] of expIdx) {
    const act = actIdx.get(name);
    if (!act) continue;
    if (normalizeCatalogDef(act.def) !== normalizeCatalogDef(exp.def)) {
      mismatches.push({ table, kind: "index", issue: "mismatch", object: name });
    }
  }
  return mismatches;
}

export function fingerprintFailClosed(mismatches: FingerprintMismatch[]): boolean {
  return mismatches.length > 0;
}

export function parseDollarJson(sql: string, tag: string): unknown {
  const open = `$${tag}$`;
  const start = sql.indexOf(open);
  if (start < 0) return null;
  const from = start + open.length;
  const end = sql.indexOf(open, from);
  if (end < 0) return null;
  return JSON.parse(sql.slice(from, end));
}

export function tableFingerprintFromGuardJson(raw: unknown): TableFingerprint {
  const value = raw as TableFingerprint;
  return {
    relkind: value.relkind,
    relrowsecurity: value.relrowsecurity,
    relforcerowsecurity: value.relforcerowsecurity,
    columns: value.columns,
    constraints: value.constraints,
    indexes: value.indexes,
  };
}

export function allowedChannelsContractHolds(
  arr: ChannelArrayShape,
  preferred: string | null,
): boolean {
  const allow = new Set<string>(CONTACT_CHANNELS);
  if (arr.ndims !== 1) return false;
  if (arr.lower !== 1) return false;
  const card = arr.values.length;
  if (card < 1 || card > 3) return false;
  if (arr.values.some((value) => value == null)) return false;
  const channels = arr.values as string[];
  if (channels.some((channel) => !allow.has(channel))) return false;
  if (new Set(channels).size !== card) return false;
  if (preferred == null || preferred === "") return false;
  return channels.includes(preferred);
}

export function invitationTimestampInvariant(
  status: string,
  convertedAt: string | null,
  invalidatedAt: string | null,
): boolean {
  const convertedOk = (status === "converted") === (convertedAt != null);
  const invalidStatus =
    status === "invalidated" || status === "expired" || status === "blocked";
  const invalidOk = invalidStatus === (invalidatedAt != null);
  const exclusive = convertedAt == null || invalidatedAt == null;
  return convertedOk && invalidOk && exclusive;
}

export function extractDropColumns(sql: string, table: string): string[] {
  const re = new RegExp(
    `ALTER TABLE public\\.${table}\\s+([\\s\\S]*?);`,
    "gi",
  );
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) {
    const body = match[1];
    const dropRe = /DROP COLUMN\s+([a-z0-9_]+)/gi;
    let drop: RegExpExecArray | null;
    while ((drop = dropRe.exec(body))) {
      names.push(drop[1]);
    }
  }
  return names;
}

export function extractCreateTable(sql: string, table: string): string {
  const marker = `CREATE TABLE public.${table}`;
  const start = sql.indexOf(marker);
  if (start < 0) return "";
  const rest = sql.slice(start);
  const end = rest.indexOf("\n);");
  if (end < 0) return rest;
  return rest.slice(0, end + 3);
}

export function createTableColumnNames(createSql: string): string[] {
  return [
    ...createSql.matchAll(
      /^\s+([a-z_][a-z0-9_]*)\s+(uuid|text\[\]|text|integer|jsonb|timestamptz)\b/gim,
    ),
  ].map((match) => match[1]);
}

export function extractIndexDefs(sql: string, table: string): string[] {
  const re = new RegExp(
    `CREATE(?:\\s+UNIQUE)?\\s+INDEX\\s+[\\s\\S]*?ON\\s+public\\.${table}[\\s\\S]*?;`,
    "gi",
  );
  return [...sql.matchAll(re)].map((match) =>
    match[0].replace(/\s+/g, " ").trim(),
  );
}

export function extractIndexNames(sql: string, table: string): string[] {
  const re = new RegExp(
    `CREATE(?:\\s+UNIQUE)?\\s+INDEX\\s+([a-z0-9_]+)\\s+ON\\s+public\\.${table}`,
    "gi",
  );
  return [...sql.matchAll(re)].map((match) => match[1]);
}

export function extractNamedConstraints(createSql: string): string[] {
  return [...createSql.matchAll(/\bCONSTRAINT\s+([a-z0-9_]+)/gi)].map(
    (match) => match[1],
  );
}

export function hasGlobalUniqueDemandOnRequests(sql: string): boolean {
  const requestIndexes = extractIndexDefs(sql, "match_requests");
  const uniqueDemandOnly = requestIndexes.some((def) => {
    const unique = /CREATE UNIQUE INDEX/i.test(def);
    const demandOnly = /\(\s*demand_post_id\s*\)/i.test(def);
    const pair = /provider_post_id/i.test(def);
    return unique && demandOnly && !pair;
  });
  const requestAlters = [
    ...sql.matchAll(/ALTER TABLE public\.match_requests\s+([\s\S]*?);/gi),
  ].map((match) => match[1]);
  const uniqueConstraint = requestAlters.some((alterBody) =>
    /UNIQUE\s*\(\s*demand_post_id\s*\)/i.test(alterBody),
  );
  return uniqueDemandOnly || uniqueConstraint;
}

export function hasUniqueDemandOnContracts(sql: string): boolean {
  return /UNIQUE\s*\(\s*demand_post_id\s*\)/i.test(sql);
}

export function contactGrantValueColumns(createSql: string): string[] {
  return createTableColumnNames(createSql).filter((name) =>
    /^(phone|whatsapp|viber|raw_phone|normalized_phone|contact_code|message_body)$/i.test(
      name,
    ),
  );
}

export function requestAssertionStoresPostFacts(
  assertion: Record<string, unknown>,
): boolean {
  return REQUEST_ASSERTION_FORBIDDEN_FACT_KEYS.some((key) => key in assertion);
}

export function lifecycleIncludesDisputed(values: readonly string[]): boolean {
  return values.includes("disputed");
}

export function extractExpectComments(verifySql: string): string[] {
  return verifySql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-- EXPECT"));
}

export function rlsAndRevokePresent(sql: string, table: string): boolean {
  const enable = sql.includes(
    `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
  );
  const revokes = V93_APP_ROLES.every((role) =>
    sql.includes(`REVOKE ALL ON TABLE public.${table} FROM ${role}`),
  );
  return enable && revokes;
}

export function verifyUsesOwnedSequences(verifySql: string): boolean {
  return (
    verifySql.includes("pg_depend") &&
    verifySql.includes("relkind = 'S'") &&
    /deptype\s*=\s*'a'/.test(verifySql) &&
    !/relname LIKE 'match_%'/.test(verifySql) &&
    !/relname LIKE 'contact_grant%'/.test(verifySql)
  );
}

export function verifyScansFunctionsByRegex(verifySql: string): boolean {
  return /proname\s*~\*/.test(verifySql);
}
