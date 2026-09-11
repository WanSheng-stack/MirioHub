/**
 * PHASE 6.7A.2 — parse-only dual-post foundation contract.
 * Not a writer. Must not be imported by API, UI, or production matching code.
 */

export const V93_MIGRATION_REL =
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.sql";
export const V93_VERIFY_REL =
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.verify.sql";

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

export const V90_REQUEST_COLUMNS_THAT_MUST_EXIST_IN_GUARD = [
  "target_post_id",
  "target_post_type",
  "applicant_user_id",
  "applicant_role",
  "application_payload",
] as const;

export const V90_CONTRACT_COLUMNS_THAT_MUST_EXIST_IN_GUARD = [
  "source_post_id",
  "source_post_type",
  "status",
] as const;

export const V93_REQUEST_COLUMNS_THAT_MUST_NOT_EXIST_IN_GUARD = [
  "invitation_id",
  "demand_post_id",
  "provider_post_id",
] as const;

export const V93_CONTRACT_COLUMNS_THAT_MUST_NOT_EXIST_IN_GUARD = [
  "demand_post_id",
  "provider_post_id",
  "lifecycle_projection",
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

export function guardFingerprints(sql: string): {
  hasRequestsRegclass: boolean;
  hasContractsRegclass: boolean;
  hasRelkind: boolean;
  hasRls: boolean;
  hasRequestCount: boolean;
  hasContractCount: boolean;
  requestOldColumns: string[];
  contractOldColumns: string[];
  requestNewColumns: string[];
  contractNewColumns: string[];
  raisesException: boolean;
} {
  const block = extractDoBlock(sql);
  const named = (names: readonly string[]) =>
    names.filter((name) => block.includes(`'${name}'`));
  return {
    hasRequestsRegclass: block.includes("to_regclass('public.match_requests')"),
    hasContractsRegclass: block.includes("to_regclass('public.match_contracts')"),
    hasRelkind: /relkind/.test(block) && block.includes("'r'"),
    hasRls: /relrowsecurity/.test(block),
    hasRequestCount: /count\(\*\)[\s\S]*match_requests/i.test(block),
    hasContractCount: /count\(\*\)[\s\S]*match_contracts/i.test(block),
    requestOldColumns: named(V90_REQUEST_COLUMNS_THAT_MUST_EXIST_IN_GUARD),
    contractOldColumns: named(V90_CONTRACT_COLUMNS_THAT_MUST_EXIST_IN_GUARD),
    requestNewColumns: named(V93_REQUEST_COLUMNS_THAT_MUST_NOT_EXIST_IN_GUARD),
    contractNewColumns: named(V93_CONTRACT_COLUMNS_THAT_MUST_NOT_EXIST_IN_GUARD),
    raisesException: /RAISE\s+EXCEPTION/i.test(block),
  };
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
  return [...createSql.matchAll(/^\s+([a-z_][a-z0-9_]*)\s+/gim)]
    .map((match) => match[1])
    .filter(
      (name) =>
        ![
          "constraint",
          "primary",
          "unique",
          "check",
          "foreign",
          "references",
        ].includes(name.toLowerCase()),
    );
}

export function extractIndexDefs(sql: string, table: string): string[] {
  const re = new RegExp(
    `CREATE(?:\\s+UNIQUE)?\\s+INDEX\\s+[\\s\\S]*?ON\\s+public\\.${table}[\\s\\S]*?;`,
    "gi",
  );
  return [...sql.matchAll(re)].map((match) => match[0].replace(/\s+/g, " ").trim());
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

export function allowedChannelsPairwiseUnique(channels: string[]): boolean {
  if (channels.length === 1) return true;
  if (channels.length === 2) return channels[0] !== channels[1];
  if (channels.length === 3) {
    return (
      channels[0] !== channels[1] &&
      channels[0] !== channels[2] &&
      channels[1] !== channels[2]
    );
  }
  return false;
}

export function allowedChannelsSubset(channels: string[]): boolean {
  return channels.every((channel) =>
    (CONTACT_CHANNELS as readonly string[]).includes(channel),
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
