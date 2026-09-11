/**
 * PHASE 6.7A.3 — parse-only allocation / event foundation contract (v94).
 * Not a writer, API, RPC, or UI module. Must not be imported by production paths.
 * Future APIs must re-validate on the server; these helpers are not an auth boundary.
 *
 * Numeric caps duplicate transportPolicy.ts / cargoPolicy.ts so this module
 * does not import those packages (Cargo V2 importer freeze). Tests lock the
 * literals to the authority source files by reading them as text.
 */

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

export const V93_CONTRACT_LIFECYCLE = [
  "formed",
  "in_progress",
  "pending_completion",
  "completed",
  "cancelled",
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
  s = s.replace(/::text\[\]/g, "");
  s = s.replace(/::text/g, "");
  s = s.replace(/::regclass/g, "");
  s = s.replace(/\bpublic\./g, "");
  s = s.replace(/\s+on update no action\b/g, "");
  s = s.replace(/= any \(array\[([^\]]*)\]\)/g, "in ($1)");
  s = s.replace(/ on ([a-z_]+) \(/g, " on $1 using btree (");
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

export function extractCreateTable(sql: string, table: string): string {
  const marker = `CREATE TABLE public.${table}`;
  const start = sql.indexOf(marker);
  if (start < 0) return "";
  const rest = sql.slice(start);
  const end = rest.indexOf("\n);");
  if (end < 0) return rest;
  return rest.slice(0, end + 3);
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

export function rlsAndRevokePresent(sql: string, table: string): boolean {
  const enable = sql.includes(
    `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
  );
  const revokes = V93_APP_ROLES.every((role) =>
    sql.includes(`REVOKE ALL ON TABLE public.${table} FROM ${role}`),
  );
  return enable && revokes;
}

export function lifecycleIncludesDisputed(values: readonly string[]): boolean {
  return values.includes("disputed");
}

export const V94_MIGRATION_REL =
  "supabase/migrations/20260911000002_matching_allocation_event_foundation_v94.sql";
export const V94_VERIFY_REL =
  "supabase/migrations/20260911000002_matching_allocation_event_foundation_v94.verify.sql";

export const V94_TABLES = [
  "provider_trip_state",
  "contract_allocations",
  "contract_state_projections",
  "contract_events",
  "safety_checklist_acceptances",
] as const;

export const V94_APP_ROLES = V93_APP_ROLES;

/** Authority: src/lib/transport/transportPolicy.ts CAR_PEOPLE_COUNT_MAX */
export const V94_PEOPLE_UNITS_MAX = 4;
/** Authority: src/lib/transport/transportPolicy.ts CAR_PEOPLE_CAPACITY_MAX */
export const V94_PEOPLE_CAPACITY_MAX = 4;
/** Authority: src/lib/transport/transportPolicy.ts PG_INT_MAX */
export const V94_ITEM_UNITS_MAX = 2_147_483_647;
export const V94_WORK_UNITS_MAX = 2_147_483_647;
/** Authority: src/lib/cargo/cargoPolicy.ts CARGO_DIMENSION_CM_MIN */
export const V94_DIMENSION_CM_MIN = 1;
/** Authority: src/lib/cargo/cargoPolicy.ts CARGO_DIMENSION_CM_MAX */
export const V94_DIMENSION_CM_MAX = 2000;
/** Authority: src/lib/cargo/cargoPolicy.ts CARGO_WEIGHT_KG_MAX */
export const V94_WEIGHT_KG_MAX = 10_000;
export const V94_CONFIRMED_ITEMS_MAX = 64;

export const V94_CLAIMS_SINGLE_TABLE_PREVENTS_OVERSELL = false;
export const V94_COMPLETION_DUE_HOURS_HARDCODED = false;
export const V94_HAS_PRODUCTION_WRITER = false;

export const V94_TRIP_STATES = ["open", "started", "ended"] as const;
export const V94_ALLOCATION_CATEGORIES = [
  "travel",
  "deliver",
  "buy",
  "onsite",
  "errand",
] as const;
export const V94_ALLOCATION_STATES = ["active", "released"] as const;
export const V94_RELEASE_REASONS = [
  "contract_cancelled",
  "contract_returned",
  "administrative_resolution",
] as const;
export const V94_EXECUTION_STATES = [
  "not_started",
  "in_progress",
  "delivered_or_arrived",
  "ended",
] as const;
export const V94_CUSTODY_STATES = [
  "none",
  "provider_holds_goods",
  "returned",
  "delivered",
] as const;
export const V94_COMPLETION_STATES = [
  "open",
  "one_side_declared",
  "mutually_confirmed",
  "code_confirmed",
  "auto_completed",
] as const;
export const V94_CANCELLATION_STATES = [
  "none",
  "requested",
  "accepted",
  "cancelled",
] as const;
export const V94_ISSUE_STATES = [
  "none",
  "reported",
  "disputed",
  "resolved",
] as const;
export const V94_ACTOR_KINDS = ["user", "system"] as const;
export const V94_CHECKLIST_STAGES = [
  "trip_start",
  "passenger_pickup",
  "cargo_handover",
  "purchase_start",
  "onsite_start",
  "errand_start",
  "delivery",
  "return",
] as const;
export const V94_EVENT_TYPES = [
  "contract_formed",
  "trip_started",
  "passenger_picked_up",
  "cargo_handed_over",
  "cargo_picked_up",
  "purchase_started",
  "onsite_started",
  "errand_started",
  "delivery_declared",
  "completion_confirmed",
  "completion_code_verified",
  "completion_auto_finalized",
  "cancellation_requested",
  "cancellation_accepted",
  "cancelled_pre_custody",
  "issue_reported",
  "dispute_opened",
  "dispute_resolved",
  "cargo_returned",
] as const;

export const V94_PROVIDER_TRIP_STATE_COLUMNS = [
  "provider_post_id",
  "state",
  "version",
  "started_at",
  "ended_at",
  "created_at",
  "updated_at",
] as const;

export const V94_CONTRACT_ALLOCATION_COLUMNS = [
  "id",
  "contract_id",
  "provider_post_id",
  "demand_post_id",
  "category",
  "segment_from_order",
  "segment_to_order",
  "allocation_state",
  "released_at",
  "release_reason",
  "people_units",
  "small_item_units",
  "medium_item_units",
  "large_item_units",
  "xlarge_item_units",
  "space_length_cm",
  "space_width_cm",
  "space_height_cm",
  "volume_cm3",
  "weight_kg",
  "weight_unknown",
  "work_units",
  "created_at",
  "updated_at",
] as const;

export const V94_CONTRACT_STATE_PROJECTION_COLUMNS = [
  "contract_id",
  "execution_state",
  "custody_state",
  "completion_state",
  "cancellation_state",
  "issue_state",
  "last_event_sequence",
  "completion_declared_at",
  "completion_due_at",
  "terminal_privacy_at",
  "version",
  "created_at",
  "updated_at",
] as const;

export const V94_CONTRACT_EVENT_COLUMNS = [
  "id",
  "contract_id",
  "sequence_no",
  "event_type",
  "actor_kind",
  "actor_user_id",
  "occurred_at",
  "payload_version",
  "event_payload",
  "client_event_id",
  "created_at",
] as const;

export const V94_SAFETY_CHECKLIST_COLUMNS = [
  "id",
  "contract_id",
  "stage",
  "actor_user_id",
  "checklist_version",
  "confirmed_items",
  "overall_confirmed",
  "client_confirmation_id",
  "confirmed_at",
  "created_at",
] as const;

export const V94_FORBIDDEN_SENSITIVE_COLUMNS = [
  "phone",
  "raw_phone",
  "normalized_phone",
  "whatsapp",
  "viber",
  "plate",
  "license_plate",
  "full_plate",
  "address",
  "gps",
  "origin_gps",
  "destination_gps",
  "verification_code",
  "pickup_code",
  "delivery_code",
  "completion_code",
  "consignee_code",
  "message",
  "message_body",
  "photo",
  "photo_url",
  "file_url",
  "id_number",
  "snapshot",
  "no_unknown_risk",
  "unknown_risk_confirmed",
] as const;

export const V94_EVENT_PAYLOAD_FORBIDDEN_KEYS = [
  "phone",
  "raw_phone",
  "normalized_phone",
  "whatsapp",
  "whatsapp_value",
  "viber",
  "viber_value",
  "plate",
  "license_plate",
  "full_plate",
  "address",
  "gps",
  "origin_gps",
  "destination_gps",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "verification_code",
  "pickup_code",
  "delivery_code",
  "completion_code",
  "consignee_code",
  "message",
  "message_body",
  "photo",
  "photo_url",
  "file_url",
  "id_number",
  "passport",
  "snapshot",
  "demand_snapshot",
  "provider_snapshot",
  "agreement_snapshot",
  "contact",
  "email",
] as const;

const HIGH_RISK_PAYLOAD_KEY =
  /(phone|whatsapp|viber|plate|license_plate|address|gps|latitude|longitude|verification_code|pickup_code|delivery_code|completion_code|consignee_code|message_body|photo_url|file_url|id_number|passport|snapshot)/i;

const CHECKLIST_ITEM_KEY = /^[a-z][a-z0-9_]{0,62}$/;

export type ConfirmedItemsShape = {
  ndims: number;
  lower: number;
  values: Array<string | null>;
};

export type TripStateDraft = {
  state: string;
  started_at: string | null;
  ended_at: string | null;
  version?: number;
};

export type AllocationDraft = {
  category: string;
  segment_from_order: number | null;
  segment_to_order: number | null;
  allocation_state: string;
  released_at: string | null;
  release_reason: string | null;
  people_units: number | null;
  small_item_units: number | null;
  medium_item_units: number | null;
  large_item_units: number | null;
  xlarge_item_units: number | null;
  space_length_cm: number | null;
  space_width_cm: number | null;
  space_height_cm: number | null;
  volume_cm3: number | null;
  weight_kg: number | null;
  weight_unknown: boolean | null;
  work_units: number | null;
};

export type ProjectionDraft = {
  execution_state: string;
  custody_state: string;
  completion_state: string;
  cancellation_state: string;
  issue_state: string;
  last_event_sequence: number;
  completion_declared_at: string | null;
  completion_due_at: string | null;
  terminal_privacy_at: string | null;
  version: number;
};

export type EventActorDraft = {
  actor_kind: string;
  actor_user_id: string | null;
};

const utc = "timezone('utc', now())";
const uuidDefault = "gen_random_uuid()";
const jsonbObject = "'{}'::jsonb";
const ts = "timestamp with time zone";

function col(
  name: string,
  type: string,
  not_null: boolean,
  default_norm = "",
): CatalogColumn {
  return { name, type, not_null, default_norm };
}

function tsNotNull(name: string, withDefault = false): CatalogColumn {
  return col(name, ts, true, withDefault ? utc : "");
}

function tsNull(name: string): CatalogColumn {
  return col(name, ts, false, "");
}

export const V93_LIVE_INVITATION_FINGERPRINT: TableFingerprint = {
  relkind: "r",
  relrowsecurity: true,
  relforcerowsecurity: false,
  columns: [
    col("id", "uuid", true, uuidDefault),
    col("demand_post_id", "uuid", true),
    col("provider_post_id", "uuid", true),
    col("initiator_user_id", "uuid", true),
    col("recipient_user_id", "uuid", true),
    col("initiator_post_id", "uuid", true),
    col("status", "text", true, "'open'"),
    col("contact_policy_version", "integer", true),
    col("disclosure_mode", "text", true),
    col("contact_code_hash", "text", true),
    col("client_request_id", "uuid", true),
    tsNotNull("expires_at"),
    tsNull("converted_at"),
    tsNull("invalidated_at"),
    tsNotNull("created_at", true),
    tsNotNull("updated_at", true),
  ],
  constraints: [
    { name: "match_contact_invitations_pkey", type: "p", def: "PRIMARY KEY (id)" },
    {
      name: "match_contact_invitations_demand_post_id_fkey",
      type: "f",
      def: "FOREIGN KEY (demand_post_id) REFERENCES posts(id) ON DELETE RESTRICT",
    },
    {
      name: "match_contact_invitations_provider_post_id_fkey",
      type: "f",
      def: "FOREIGN KEY (provider_post_id) REFERENCES posts(id) ON DELETE RESTRICT",
    },
    {
      name: "match_contact_invitations_initiator_user_id_fkey",
      type: "f",
      def: "FOREIGN KEY (initiator_user_id) REFERENCES profiles(id) ON DELETE RESTRICT",
    },
    {
      name: "match_contact_invitations_recipient_user_id_fkey",
      type: "f",
      def: "FOREIGN KEY (recipient_user_id) REFERENCES profiles(id) ON DELETE RESTRICT",
    },
    {
      name: "match_contact_invitations_initiator_post_id_fkey",
      type: "f",
      def: "FOREIGN KEY (initiator_post_id) REFERENCES posts(id) ON DELETE RESTRICT",
    },
    {
      name: "match_contact_invitations_distinct_posts",
      type: "c",
      def: "CHECK (demand_post_id <> provider_post_id)",
    },
    {
      name: "match_contact_invitations_distinct_users",
      type: "c",
      def: "CHECK (initiator_user_id <> recipient_user_id)",
    },
    {
      name: "match_contact_invitations_initiator_post_belongs",
      type: "c",
      def: "CHECK (initiator_post_id IN (demand_post_id, provider_post_id))",
    },
    {
      name: "match_contact_invitations_status_check",
      type: "c",
      def: "CHECK (status IN ('open', 'converted', 'invalidated', 'expired', 'blocked'))",
    },
    {
      name: "match_contact_invitations_policy_version_check",
      type: "c",
      def: "CHECK (contact_policy_version > 0)",
    },
    {
      name: "match_contact_invitations_disclosure_mode_check",
      type: "c",
      def: "CHECK (disclosure_mode IN ('recipient_contacts_initiator', 'mutual_eligible_contact'))",
    },
    {
      name: "match_contact_invitations_contact_code_hash_present",
      type: "c",
      def: "CHECK (btrim(contact_code_hash) <> '')",
    },
    {
      name: "match_contact_invitations_expires_after_created",
      type: "c",
      def: "CHECK (expires_at > created_at)",
    },
    {
      name: "match_contact_invitations_converted_ts_consistent",
      type: "c",
      def: "CHECK ((status = 'converted') = (converted_at IS NOT NULL))",
    },
    {
      name: "match_contact_invitations_invalid_ts_consistent",
      type: "c",
      def: "CHECK ((status IN ('invalidated', 'expired', 'blocked')) = (invalidated_at IS NOT NULL))",
    },
    {
      name: "match_contact_invitations_converted_invalid_exclusive",
      type: "c",
      def: "CHECK (converted_at IS NULL OR invalidated_at IS NULL)",
    },
    {
      name: "match_contact_invitations_initiator_client_request_id_key",
      type: "u",
      def: "UNIQUE (initiator_user_id, client_request_id)",
    },
  ],
  indexes: [
    {
      name: "match_contact_invitations_one_open_pair",
      def: "CREATE UNIQUE INDEX match_contact_invitations_one_open_pair ON match_contact_invitations USING btree (demand_post_id, provider_post_id) WHERE status = 'open'",
    },
    {
      name: "match_contact_invitations_recipient_status_created_idx",
      def: "CREATE INDEX match_contact_invitations_recipient_status_created_idx ON match_contact_invitations USING btree (recipient_user_id, status, created_at DESC)",
    },
    {
      name: "match_contact_invitations_initiator_status_created_idx",
      def: "CREATE INDEX match_contact_invitations_initiator_status_created_idx ON match_contact_invitations USING btree (initiator_user_id, status, created_at DESC)",
    },
    {
      name: "match_contact_invitations_open_expires_idx",
      def: "CREATE INDEX match_contact_invitations_open_expires_idx ON match_contact_invitations USING btree (expires_at) WHERE status = 'open'",
    },
  ],
};

export const V93_LIVE_GRANT_FINGERPRINT: TableFingerprint = {
  relkind: "r",
  relrowsecurity: true,
  relforcerowsecurity: false,
  columns: [
    col("id", "uuid", true, uuidDefault),
    col("invitation_id", "uuid", true),
    col("subject_user_id", "uuid", true),
    col("viewer_user_id", "uuid", true),
    col("allowed_channels", "text[]", true),
    col("preferred_channel", "text", true),
    col("policy_version", "integer", true),
    tsNotNull("granted_at", true),
    tsNotNull("expires_at"),
    tsNull("revoked_at"),
    tsNotNull("created_at", true),
  ],
  constraints: [
    { name: "contact_grants_pkey", type: "p", def: "PRIMARY KEY (id)" },
    {
      name: "contact_grants_invitation_id_fkey",
      type: "f",
      def: "FOREIGN KEY (invitation_id) REFERENCES match_contact_invitations(id) ON DELETE RESTRICT",
    },
    {
      name: "contact_grants_subject_user_id_fkey",
      type: "f",
      def: "FOREIGN KEY (subject_user_id) REFERENCES profiles(id) ON DELETE RESTRICT",
    },
    {
      name: "contact_grants_viewer_user_id_fkey",
      type: "f",
      def: "FOREIGN KEY (viewer_user_id) REFERENCES profiles(id) ON DELETE RESTRICT",
    },
    {
      name: "contact_grants_distinct_users",
      type: "c",
      def: "CHECK (subject_user_id <> viewer_user_id)",
    },
    {
      name: "contact_grants_allowed_channels_contract_check",
      type: "c",
      def: "CHECK (array_ndims(allowed_channels) = 1 AND array_lower(allowed_channels, 1) = 1 AND array_length(allowed_channels, 1) = cardinality(allowed_channels) AND cardinality(allowed_channels) BETWEEN 1 AND 3 AND array_position(allowed_channels, NULL) IS NULL AND allowed_channels <@ ARRAY['phone', 'whatsapp', 'viber'] AND CASE cardinality(allowed_channels) WHEN 1 THEN true WHEN 2 THEN allowed_channels[1] <> allowed_channels[2] WHEN 3 THEN allowed_channels[1] <> allowed_channels[2] AND allowed_channels[1] <> allowed_channels[3] AND allowed_channels[2] <> allowed_channels[3] ELSE false END AND preferred_channel = ANY (allowed_channels))",
    },
    {
      name: "contact_grants_policy_version_check",
      type: "c",
      def: "CHECK (policy_version > 0)",
    },
    {
      name: "contact_grants_expires_after_granted",
      type: "c",
      def: "CHECK (expires_at > granted_at)",
    },
    {
      name: "contact_grants_revoked_after_granted",
      type: "c",
      def: "CHECK (revoked_at IS NULL OR revoked_at >= granted_at)",
    },
    {
      name: "contact_grants_invitation_subject_viewer_key",
      type: "u",
      def: "UNIQUE (invitation_id, subject_user_id, viewer_user_id)",
    },
  ],
  indexes: [
    {
      name: "contact_grants_viewer_expires_live_idx",
      def: "CREATE INDEX contact_grants_viewer_expires_live_idx ON contact_grants USING btree (viewer_user_id, expires_at) WHERE revoked_at IS NULL",
    },
    {
      name: "contact_grants_invitation_id_idx",
      def: "CREATE INDEX contact_grants_invitation_id_idx ON contact_grants USING btree (invitation_id)",
    },
  ],
};

export const V93_LIVE_REQUEST_FINGERPRINT: TableFingerprint = {
  relkind: "r",
  relrowsecurity: true,
  relforcerowsecurity: false,
  columns: [
    col("id", "uuid", true, uuidDefault),
    col("client_request_id", "uuid", true),
    tsNotNull("created_at", true),
    tsNotNull("updated_at", true),
    tsNull("responded_at"),
    tsNull("expires_at"),
    col("invitation_id", "uuid", true),
    col("demand_post_id", "uuid", true),
    col("provider_post_id", "uuid", true),
    col("requester_user_id", "uuid", true),
    col("recipient_user_id", "uuid", true),
    col("status", "text", true, "'pending'"),
    col("request_version", "integer", true, "1"),
    col("request_assertion", "jsonb", true, jsonbObject),
  ],
  constraints: [
    { name: "match_requests_pkey", type: "p", def: "PRIMARY KEY (id)" },
    {
      name: "match_requests_invitation_id_fkey",
      type: "f",
      def: "FOREIGN KEY (invitation_id) REFERENCES match_contact_invitations(id) ON DELETE RESTRICT",
    },
    {
      name: "match_requests_demand_post_id_fkey",
      type: "f",
      def: "FOREIGN KEY (demand_post_id) REFERENCES posts(id) ON DELETE RESTRICT",
    },
    {
      name: "match_requests_provider_post_id_fkey",
      type: "f",
      def: "FOREIGN KEY (provider_post_id) REFERENCES posts(id) ON DELETE RESTRICT",
    },
    {
      name: "match_requests_requester_user_id_fkey",
      type: "f",
      def: "FOREIGN KEY (requester_user_id) REFERENCES profiles(id) ON DELETE RESTRICT",
    },
    {
      name: "match_requests_recipient_user_id_fkey",
      type: "f",
      def: "FOREIGN KEY (recipient_user_id) REFERENCES profiles(id) ON DELETE RESTRICT",
    },
    {
      name: "match_requests_invitation_id_key",
      type: "u",
      def: "UNIQUE (invitation_id)",
    },
    {
      name: "match_requests_requester_client_request_id_key",
      type: "u",
      def: "UNIQUE (requester_user_id, client_request_id)",
    },
    {
      name: "match_requests_distinct_posts",
      type: "c",
      def: "CHECK (demand_post_id <> provider_post_id)",
    },
    {
      name: "match_requests_requester_ne_recipient",
      type: "c",
      def: "CHECK (requester_user_id <> recipient_user_id)",
    },
    {
      name: "match_requests_status_check",
      type: "c",
      def: "CHECK (status IN ('pending', 'accepted', 'rejected', 'invalidated', 'expired'))",
    },
    {
      name: "match_requests_request_version_check",
      type: "c",
      def: "CHECK (request_version > 0)",
    },
    {
      name: "match_requests_request_assertion_object_check",
      type: "c",
      def: "CHECK (jsonb_typeof(request_assertion) = 'object')",
    },
    {
      name: "match_requests_responded_aligns_status",
      type: "c",
      def: "CHECK ((status IN ('accepted', 'rejected')) = (responded_at IS NOT NULL))",
    },
    {
      name: "match_requests_non_response_terminal_null",
      type: "c",
      def: "CHECK (status NOT IN ('invalidated', 'expired') OR responded_at IS NULL)",
    },
  ],
  indexes: [
    {
      name: "match_requests_one_pending_pair",
      def: "CREATE UNIQUE INDEX match_requests_one_pending_pair ON match_requests USING btree (demand_post_id, provider_post_id) WHERE status = 'pending'",
    },
    {
      name: "match_requests_recipient_status_created_idx",
      def: "CREATE INDEX match_requests_recipient_status_created_idx ON match_requests USING btree (recipient_user_id, status, created_at DESC)",
    },
    {
      name: "match_requests_requester_status_created_idx",
      def: "CREATE INDEX match_requests_requester_status_created_idx ON match_requests USING btree (requester_user_id, status, created_at DESC)",
    },
    {
      name: "match_requests_demand_post_id_idx",
      def: "CREATE INDEX match_requests_demand_post_id_idx ON match_requests USING btree (demand_post_id)",
    },
    {
      name: "match_requests_provider_post_id_idx",
      def: "CREATE INDEX match_requests_provider_post_id_idx ON match_requests USING btree (provider_post_id)",
    },
    {
      name: "match_requests_pending_expires_idx",
      def: "CREATE INDEX match_requests_pending_expires_idx ON match_requests USING btree (expires_at) WHERE status = 'pending'",
    },
  ],
};

export const V93_LIVE_CONTRACT_FINGERPRINT: TableFingerprint = {
  relkind: "r",
  relrowsecurity: true,
  relforcerowsecurity: false,
  columns: [
    col("id", "uuid", true, uuidDefault),
    col("request_id", "uuid", true),
    col("demand_user_id", "uuid", true),
    col("provider_user_id", "uuid", true),
    col("snapshot_version", "integer", true, "1"),
    col("demand_snapshot", "jsonb", true),
    col("provider_snapshot", "jsonb", true),
    col("agreement_snapshot", "jsonb", true),
    tsNotNull("created_at", true),
    tsNotNull("updated_at", true),
    col("demand_post_id", "uuid", true),
    col("provider_post_id", "uuid", true),
    col("category", "text", true),
    col("lifecycle_projection", "text", true, "'formed'"),
    tsNotNull("formed_at", true),
    tsNull("terminal_at"),
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
      name: "match_contracts_demand_post_id_fkey",
      type: "f",
      def: "FOREIGN KEY (demand_post_id) REFERENCES posts(id) ON DELETE RESTRICT",
    },
    {
      name: "match_contracts_provider_post_id_fkey",
      type: "f",
      def: "FOREIGN KEY (provider_post_id) REFERENCES posts(id) ON DELETE RESTRICT",
    },
    {
      name: "match_contracts_demand_post_id_key",
      type: "u",
      def: "UNIQUE (demand_post_id)",
    },
    {
      name: "match_contracts_distinct_posts",
      type: "c",
      def: "CHECK (demand_post_id <> provider_post_id)",
    },
    {
      name: "match_contracts_category_check",
      type: "c",
      def: "CHECK (category IN ('travel', 'deliver', 'buy', 'onsite', 'errand'))",
    },
    {
      name: "match_contracts_lifecycle_projection_check",
      type: "c",
      def: "CHECK (lifecycle_projection IN ('formed', 'in_progress', 'pending_completion', 'completed', 'cancelled'))",
    },
    {
      name: "match_contracts_terminal_null_unless_closed",
      type: "c",
      def: "CHECK (lifecycle_projection IN ('completed', 'cancelled') OR terminal_at IS NULL)",
    },
    {
      name: "match_contracts_terminal_required_when_closed",
      type: "c",
      def: "CHECK (lifecycle_projection NOT IN ('completed', 'cancelled') OR terminal_at IS NOT NULL)",
    },
  ],
  indexes: [
    {
      name: "match_contracts_provider_lifecycle_formed_idx",
      def: "CREATE INDEX match_contracts_provider_lifecycle_formed_idx ON match_contracts USING btree (provider_post_id, lifecycle_projection, formed_at)",
    },
    {
      name: "match_contracts_demand_user_lifecycle_formed_idx",
      def: "CREATE INDEX match_contracts_demand_user_lifecycle_formed_idx ON match_contracts USING btree (demand_user_id, lifecycle_projection, formed_at DESC)",
    },
    {
      name: "match_contracts_provider_user_lifecycle_formed_idx",
      def: "CREATE INDEX match_contracts_provider_user_lifecycle_formed_idx ON match_contracts USING btree (provider_user_id, lifecycle_projection, formed_at DESC)",
    },
  ],
};

export const V93_LIVE_FINGERPRINTS: Record<
  (typeof V93_TABLES)[number],
  TableFingerprint
> = {
  match_contact_invitations: V93_LIVE_INVITATION_FINGERPRINT,
  contact_grants: V93_LIVE_GRANT_FINGERPRINT,
  match_requests: V93_LIVE_REQUEST_FINGERPRINT,
  match_contracts: V93_LIVE_CONTRACT_FINGERPRINT,
};

export const V94_GUARD_JSON_TAGS = {
  match_contact_invitations: "v93_invitations_fp",
  contact_grants: "v93_grants_fp",
  match_requests: "v93_requests_fp",
  match_contracts: "v93_contracts_fp",
} as const;

export function v94CreateTableColumnNames(createSql: string): string[] {
  return [
    ...createSql.matchAll(
      /^\s+([a-z_][a-z0-9_]*)\s+(uuid|text\[\]|text|integer|bigint|numeric(?:\([^)]+\))?|boolean|jsonb|timestamptz)\b/gim,
    ),
  ].map((match) => match[1]);
}

export function confirmedItemsPairwiseUniquenessSql(
  column = "confirmed_items",
): string {
  const parts: string[] = [];
  for (let i = 1; i <= V94_CONFIRMED_ITEMS_MAX; i += 1) {
    for (let j = i + 1; j <= V94_CONFIRMED_ITEMS_MAX; j += 1) {
      parts.push(
        `(cardinality(${column}) < ${j} OR ${column}[${i}] <> ${column}[${j}])`,
      );
    }
  }
  return parts.join("\n      AND ");
}

export function confirmedItemsKeyPatternSql(column = "confirmed_items"): string {
  const parts: string[] = [];
  for (let i = 1; i <= V94_CONFIRMED_ITEMS_MAX; i += 1) {
    parts.push(
      `(cardinality(${column}) < ${i} OR ${column}[${i}] ~ '^[a-z][a-z0-9_]{0,62}$')`,
    );
  }
  return parts.join("\n      AND ");
}

export function isNonNegativeSafeInt(value: number | null): boolean {
  return (
    value != null &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= V94_ITEM_UNITS_MAX
  );
}

export function isPositiveSafeInt(value: number | null): boolean {
  return isNonNegativeSafeInt(value) && value != null && value > 0;
}

export function tripStateTimestampInvariant(draft: TripStateDraft): boolean {
  if (draft.version != null && !(draft.version > 0)) return false;
  if (draft.state === "open") {
    return draft.started_at == null && draft.ended_at == null;
  }
  if (draft.state === "started") {
    return draft.started_at != null && draft.ended_at == null;
  }
  if (draft.state === "ended") {
    return (
      draft.started_at != null &&
      draft.ended_at != null &&
      draft.ended_at >= draft.started_at
    );
  }
  return false;
}

function segmentPairOk(
  from: number | null,
  to: number | null,
  required: boolean,
): boolean {
  if (from == null && to == null) return !required;
  if (from == null || to == null) return false;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from < 0 || from > V94_ITEM_UNITS_MAX || to > V94_ITEM_UNITS_MAX) return false;
  return to > from;
}

function releaseStateOk(draft: AllocationDraft): boolean {
  if (draft.allocation_state === "active") {
    return draft.released_at == null && draft.release_reason == null;
  }
  if (draft.allocation_state === "released") {
    return (
      draft.released_at != null &&
      draft.release_reason != null &&
      (V94_RELEASE_REASONS as readonly string[]).includes(draft.release_reason)
    );
  }
  return false;
}

function travelFieldsPresent(draft: AllocationDraft): boolean {
  return (
    draft.people_units != null ||
    draft.small_item_units != null ||
    draft.medium_item_units != null ||
    draft.large_item_units != null ||
    draft.xlarge_item_units != null
  );
}

function deliverFieldsPresent(draft: AllocationDraft): boolean {
  return (
    draft.space_length_cm != null ||
    draft.space_width_cm != null ||
    draft.space_height_cm != null ||
    draft.volume_cm3 != null ||
    draft.weight_kg != null ||
    draft.weight_unknown != null
  );
}

function allTravelNull(draft: AllocationDraft): boolean {
  return !travelFieldsPresent(draft);
}

function allDeliverNull(draft: AllocationDraft): boolean {
  return !deliverFieldsPresent(draft);
}

export function allocationCategoryInvariant(draft: AllocationDraft): boolean {
  if (
    !(V94_ALLOCATION_CATEGORIES as readonly string[]).includes(draft.category)
  ) {
    return false;
  }
  if (!releaseStateOk(draft)) return false;

  if (draft.category === "travel") {
    if (!segmentPairOk(draft.segment_from_order, draft.segment_to_order, true)) {
      return false;
    }
    if (draft.work_units != null) return false;
    if (!allDeliverNull(draft)) return false;
    const units = [
      draft.people_units,
      draft.small_item_units,
      draft.medium_item_units,
      draft.large_item_units,
      draft.xlarge_item_units,
    ];
    if (units.some((value) => !isNonNegativeSafeInt(value))) return false;
    if (draft.people_units != null && draft.people_units > V94_PEOPLE_UNITS_MAX) {
      return false;
    }
    return units.some((value) => value != null && value > 0);
  }

  if (draft.category === "deliver") {
    if (!segmentPairOk(draft.segment_from_order, draft.segment_to_order, true)) {
      return false;
    }
    if (draft.work_units != null) return false;
    if (!allTravelNull(draft)) return false;
    const dims = [
      draft.space_length_cm,
      draft.space_width_cm,
      draft.space_height_cm,
    ];
    if (
      dims.some(
        (value) =>
          !isPositiveSafeInt(value) ||
          value == null ||
          value < V94_DIMENSION_CM_MIN ||
          value > V94_DIMENSION_CM_MAX,
      )
    ) {
      return false;
    }
    const expectedVolume =
      Number(draft.space_length_cm) *
      Number(draft.space_width_cm) *
      Number(draft.space_height_cm);
    if (draft.volume_cm3 == null || draft.volume_cm3 !== expectedVolume) {
      return false;
    }
    if (draft.weight_unknown === true) return draft.weight_kg == null;
    if (draft.weight_unknown === false) {
      return (
        draft.weight_kg != null &&
        Number.isFinite(draft.weight_kg) &&
        draft.weight_kg > 0 &&
        draft.weight_kg <= V94_WEIGHT_KG_MAX
      );
    }
    return false;
  }

  if (
    draft.category === "buy" ||
    draft.category === "onsite" ||
    draft.category === "errand"
  ) {
    if (draft.segment_from_order != null || draft.segment_to_order != null) {
      return false;
    }
    if (!allTravelNull(draft) || !allDeliverNull(draft)) return false;
    return (
      isPositiveSafeInt(draft.work_units) &&
      draft.work_units != null &&
      draft.work_units <= V94_WORK_UNITS_MAX
    );
  }

  return false;
}

export function projectionInvariant(draft: ProjectionDraft): boolean {
  if (!(V94_EXECUTION_STATES as readonly string[]).includes(draft.execution_state)) {
    return false;
  }
  if (!(V94_CUSTODY_STATES as readonly string[]).includes(draft.custody_state)) {
    return false;
  }
  if (
    !(V94_COMPLETION_STATES as readonly string[]).includes(draft.completion_state)
  ) {
    return false;
  }
  if (
    !(V94_CANCELLATION_STATES as readonly string[]).includes(
      draft.cancellation_state,
    )
  ) {
    return false;
  }
  if (!(V94_ISSUE_STATES as readonly string[]).includes(draft.issue_state)) {
    return false;
  }
  if (!Number.isInteger(draft.last_event_sequence) || draft.last_event_sequence < 0) {
    return false;
  }
  if (!Number.isInteger(draft.version) || draft.version <= 0) return false;

  const openTs =
    draft.completion_declared_at == null && draft.completion_due_at == null;
  if ((draft.completion_state === "open") !== openTs) return false;

  if (draft.completion_state === "one_side_declared") {
    if (
      draft.completion_declared_at == null ||
      draft.completion_due_at == null ||
      draft.completion_due_at <= draft.completion_declared_at
    ) {
      return false;
    }
  }

  if (
    draft.completion_state === "mutually_confirmed" ||
    draft.completion_state === "code_confirmed" ||
    draft.completion_state === "auto_completed"
  ) {
    if (draft.completion_declared_at == null) return false;
  }

  return true;
}

export function confirmedItemsShapeInvariant(shape: ConfirmedItemsShape): boolean {
  if (shape.ndims !== 1) return false;
  if (shape.lower !== 1) return false;
  const card = shape.values.length;
  if (card < 1 || card > V94_CONFIRMED_ITEMS_MAX) return false;
  if (shape.values.some((value) => value == null)) return false;
  const keys = shape.values as string[];
  if (keys.some((key) => !CHECKLIST_ITEM_KEY.test(key))) return false;
  return new Set(keys).size === card;
}

export function eventActorInvariant(draft: EventActorDraft): boolean {
  if (draft.actor_kind === "user") return draft.actor_user_id != null;
  if (draft.actor_kind === "system") return draft.actor_user_id == null;
  return false;
}

function payloadKeyForbidden(key: string): boolean {
  if (
    (V94_EVENT_PAYLOAD_FORBIDDEN_KEYS as readonly string[]).includes(key)
  ) {
    return true;
  }
  return HIGH_RISK_PAYLOAD_KEY.test(key);
}

function walkPayloadForbidden(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => walkPayloadForbidden(entry));
  }
  if (typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value)) {
    if (payloadKeyForbidden(key)) return true;
    if (walkPayloadForbidden(nested)) return true;
  }
  return false;
}

export function eventPayloadInvariant(payload: unknown): boolean {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  return !walkPayloadForbidden(payload);
}

export function v94RlsAndRevokePresent(sql: string, table: string): boolean {
  return rlsAndRevokePresent(sql, table);
}

export function extractExpectComments(verifySql: string): string[] {
  return verifySql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-- EXPECT"));
}

export function verifyUsesOwnedSequencesAi(verifySql: string): boolean {
  return (
    verifySql.includes("pg_depend") &&
    verifySql.includes("relkind = 'S'") &&
    /deptype\s*IN\s*\(\s*'a'\s*,\s*'i'\s*\)/.test(verifySql)
  );
}

export function verifyScansFunctionsByRegex(verifySql: string): boolean {
  return /proname\s*~\*/.test(verifySql);
}

export function verifyIsSingleResultSet(verifySql: string): boolean {
  const body = sqlBody(verifySql);
  const statements = body
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return (
    body.includes("check_order") &&
    body.includes("area") &&
    body.includes("check_name") &&
    body.includes("result") &&
    body.includes("observed") &&
    body.includes("expected") &&
    statements.length === 1
  );
}

export function guardReadsMigrationHistory(sql: string): boolean {
  return /schema_migrations/i.test(extractDoBlock(sql));
}

export function volumeUsesNumericThenMultiply(sql: string): boolean {
  const numericFirst =
    /space_length_cm::numeric\s*\*\s*space_width_cm::numeric\s*\*\s*space_height_cm::numeric/.test(
      sql,
    );
  const intThenCast =
    /\(space_length_cm\s*\*\s*space_width_cm\s*\*\s*space_height_cm\)::numeric/.test(
      sql,
    );
  return numericFirst && !intThenCast;
}

export function mentionsHardcoded72h(sql: string): boolean {
  return (
    /\b72\s*hour/i.test(sql) ||
    /\binterval\s+'72/i.test(sql) ||
    /\b259200\b/.test(sql)
  );
}

export function independentIndexNamesFromSql(sql: string, table: string): string[] {
  return extractIndexNames(sql, table);
}

export function hasDuplicateIndependentIndex(
  sql: string,
  table: string,
  uniqueCols: string,
): boolean {
  const names = extractIndexNames(sql, table);
  const defs = names.map((name) => {
    const re = new RegExp(
      `CREATE(?:\\s+UNIQUE)?\\s+INDEX\\s+${name}\\s+ON\\s+public\\.${table}[\\s\\S]*?;`,
      "i",
    );
    return sql.match(re)?.[0] ?? "";
  });
  return defs.some(
    (def) =>
      /\bCREATE UNIQUE INDEX\b/i.test(def) === false &&
      new RegExp(`\\(\\s*${uniqueCols}\\s*\\)`, "i").test(def),
  );
}
