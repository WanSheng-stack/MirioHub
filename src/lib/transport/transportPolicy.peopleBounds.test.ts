/**
 * PHASE 6.7B.1A.1B — shared Travel people 0–4 bounds and v91 helper ACL (TEST A–U).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/transport/transportPolicy.peopleBounds.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSafetyFacts } from "@/lib/safety/safetyPolicy";
import {
  validateTransportCapability,
  validateTransportDeclaredFields,
} from "@/lib/transport/transportPolicy";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const ROUND_BASELINE = "0a9453b16f8c5e75d5b26400fd497819db981423";
const MAIN_SQL =
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql";
const VERIFY_SQL =
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.verify.sql";

function rejectKey(
  result: { ok: true } | { ok: false; errorKey: string },
): string {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected reject");
  return result.errorKey;
}

function stage1HelperBody(sql: string): string {
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.insert_stage1_post_v86");
  const end = sql.indexOf("$$;");
  assert.ok(start >= 0 && end > start);
  return sql.slice(start, end + 3);
}

const travelDemand = { lane: "travel" as const, postType: "demand" as const };
const travelProvider = { lane: "travel" as const, postType: "provider" as const };

// TEST A — Travel Demand peopleCount=0 → ok
{
  assert.equal(
    validateTransportDeclaredFields({ ...travelDemand, peopleCount: 0 }).ok,
    true,
  );
}

// TEST B — Travel Demand peopleCount=4 → ok
{
  assert.equal(
    validateTransportDeclaredFields({ ...travelDemand, peopleCount: 4 }).ok,
    true,
  );
}

// TEST C — Travel Demand peopleCount=5 → bounds
{
  assert.equal(
    rejectKey(
      validateTransportDeclaredFields({ ...travelDemand, peopleCount: 5 }),
    ),
    "error.transport_people_bounds",
  );
}

// TEST D — Travel Demand peopleCount=999 → reject
{
  assert.equal(
    rejectKey(
      validateTransportDeclaredFields({ ...travelDemand, peopleCount: 999 }),
    ),
    "error.transport_people_bounds",
  );
}

// TEST E — Travel Provider peopleCapacity=0 → ok
{
  assert.equal(
    validateTransportDeclaredFields({ ...travelProvider, peopleCapacity: 0 }).ok,
    true,
  );
}

// TEST F — Travel Provider peopleCapacity=4 → ok
{
  assert.equal(
    validateTransportDeclaredFields({ ...travelProvider, peopleCapacity: 4 }).ok,
    true,
  );
}

// TEST G — Travel Provider peopleCapacity=5 → reject
{
  assert.equal(
    rejectKey(
      validateTransportDeclaredFields({
        ...travelProvider,
        peopleCapacity: 5,
      }),
    ),
    "error.transport_people_bounds",
  );
}

// TEST H — Safety Travel Demand, no transportMode, peopleCount=4 → ok
{
  assert.equal(
    validateSafetyFacts({
      category: "travel",
      postType: "demand",
      peopleCount: 4,
    }).ok,
    true,
  );
}

// TEST I — Safety Travel Demand, no transportMode, peopleCount=5 → reject
{
  assert.equal(
    rejectKey(
      validateSafetyFacts({
        category: "travel",
        postType: "demand",
        peopleCount: 5,
      }),
    ),
    "error.transport_people_bounds",
  );
  assert.equal(
    rejectKey(
      validateSafetyFacts({
        category: "travel",
        postType: "demand",
        peopleCount: 999,
      }),
    ),
    "error.transport_people_bounds",
  );
}

// TEST J — Safety Travel Provider, no transportMode, peopleCapacity=5 → reject
{
  assert.equal(
    rejectKey(
      validateSafetyFacts({
        category: "travel",
        postType: "provider",
        peopleCapacity: 5,
      }),
    ),
    "error.transport_people_bounds",
  );
}

// TEST K — non-car + people > 0 still rejected by capability
{
  const walking = validateTransportCapability({
    lane: "travel",
    postType: "demand",
    mode: "walking",
    peopleCount: 1,
    travelItemUnits: 0,
  });
  assert.equal(rejectKey(walking), "error.transport_people_not_allowed");
  const motorbike = validateTransportCapability({
    lane: "travel",
    postType: "provider",
    mode: "motorbike",
    peopleCapacity: 1,
    travelItemUnits: 0,
  });
  assert.equal(rejectKey(motorbike), "error.transport_people_not_allowed");
}

// TEST L — previous-round Deliver escort / travelItemUnits gates still hold
{
  assert.equal(
    rejectKey(
      validateTransportCapability({
        lane: "deliver",
        postType: "provider",
        mode: "cargo_van",
        escortPassengerCount: 0,
      }),
    ),
    "error.transport_escort_field_not_allowed",
  );
  assert.equal(
    rejectKey(
      validateTransportCapability({
        lane: "deliver",
        postType: "demand",
        mode: "cargo_van",
        travelItemUnits: 0,
      }),
    ),
    "error.transport_travel_item_field_not_allowed",
  );
  assert.equal(
    validateTransportCapability({
      lane: "deliver",
      postType: "demand",
      mode: "cargo_van",
      escortPassengerCount: 1,
    }).ok,
    true,
  );
}

const migration = read(MAIN_SQL);
const verifySql = read(VERIFY_SQL);

// TEST M — explicit REVOKE FROM service_role with exact signature
{
  assert.ok(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.insert_stage1_post_v86(\n  uuid, uuid, text, text, jsonb, bigint, text\n) FROM service_role;",
    ),
  );
}

// TEST N — no GRANT EXECUTE to service_role / anon / authenticated / PUBLIC
{
  const statements = migration
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert.equal(/GRANT\s+EXECUTE/i.test(statements), false);
  assert.equal(/GRANT\s+ALL/i.test(statements), false);
}

const REGPROCEDURE =
  "public.insert_stage1_post_v86(uuid,uuid,text,text,jsonb,bigint,text)";
const TYPE_ONLY = "uuid, uuid, text, text, jsonb, bigint, text";
const NAMED_IDENTITY =
  "p_user_id uuid, p_client_request_id uuid, p_payload_hash text, p_status text, p_post_payload jsonb, p_server_fee_minor bigint, p_fallback_reason text";

function statementsOf(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

// TEST O — verify outputs exact_function_count and locates named-arg functions
{
  assert.ok(verifySql.includes("exact_function_count"));
  assert.notEqual(NAMED_IDENTITY, TYPE_ONLY);
  const statements = statementsOf(verifySql);
  assert.equal(
    statements.includes(`identity_args = '${TYPE_ONLY}'`),
    false,
  );
  assert.equal(
    statements.includes(`pg_get_function_identity_arguments(p.oid)\n    = '${TYPE_ONLY}'`),
    false,
  );
  assert.equal(
    /pg_get_function_identity_arguments\([^)]+\)\s*=\s*'uuid, uuid, text, text, jsonb, bigint, text'/.test(
      statements,
    ),
    false,
  );
  assert.ok(statements.includes(`to_regprocedure(\n    '${REGPROCEDURE}'`));
}

// TEST P — verify outputs all_overload_count; body reuses the same exact OID
{
  assert.ok(verifySql.includes("all_overload_count"));
  const statements = statementsOf(verifySql);
  const locators = statements.match(
    /to_regprocedure\(\s*'public\.insert_stage1_post_v86\(uuid,uuid,text,text,jsonb,bigint,text\)'/g,
  );
  assert.ok(locators && locators.length >= 2);
  assert.ok(statements.includes("SELECT pg_get_functiondef(oid) AS def"));
  assert.equal(
    /pg_get_function_identity_arguments\(p\.oid\)/.test(statements),
    false,
  );
}

// TEST Q — PUBLIC uses aclexplode + grantee = 0
{
  assert.ok(verifySql.includes("aclexplode"));
  assert.ok(verifySql.includes("a.grantee = 0"));
  assert.ok(verifySql.includes("public_direct_execute"));
}

// TEST R — named roles use has_function_privilege on role OID + function OID
{
  assert.ok(verifySql.includes("has_function_privilege("));
  assert.ok(verifySql.includes("r.anon_oid"));
  assert.ok(verifySql.includes("r.authenticated_oid"));
  assert.ok(verifySql.includes("r.service_role_oid"));
  assert.ok(verifySql.includes("(SELECT e.oid FROM exact e)"));
  assert.ok(verifySql.includes("anon_effective_execute"));
  assert.ok(verifySql.includes("authenticated_effective_execute"));
  assert.ok(verifySql.includes("service_role_effective_execute"));
}

// TEST S — verify does not treat 'public' as a username
{
  assert.equal(verifySql.includes("has_function_privilege('public'"), false);
  assert.equal(verifySql.includes('has_function_privilege("public"'), false);
  assert.equal(verifySql.includes("has_function_privilege(\n      'public'"), false);
}

// TEST T — verify is read-only catalog; no business rows or writes
{
  assert.equal(/\bINSERT\s+INTO\b/i.test(verifySql), false);
  assert.equal(/\bUPDATE\b/i.test(verifySql), false);
  assert.equal(/\bDELETE\s+FROM\b/i.test(verifySql), false);
  assert.equal(/\bGRANT\b/i.test(verifySql), false);
  assert.equal(/\bREVOKE\b/i.test(verifySql), false);
  assert.equal(/\bFROM\s+posts\b/i.test(verifySql), false);
  assert.equal(verifySql.includes("payload_hash"), false);
  assert.ok(verifySql.includes("exact_function_count IS DISTINCT FROM 1 THEN NULL"));
}

// TEST U — v91 helper body unchanged vs 0a9453b except ACL REVOKE
{
  const baselineSql = execFileSync("git", ["show", `${ROUND_BASELINE}:${MAIN_SQL}`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(stage1HelperBody(migration), stage1HelperBody(baselineSql));
  assert.equal(baselineSql.includes("FROM service_role"), false);
  assert.ok(migration.includes("FROM service_role"));
  assert.ok(migration.includes("'van'"));
  assert.equal(migration.includes("cargo_van"), false);
  assert.equal(migration.includes("ALTER TABLE public.posts"), false);
  const initChanged = execFileSync(
    "git",
    ["diff", "--name-only", ROUND_BASELINE, "--", "supabase/init.sql"],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();
  assert.equal(initChanged, "");
}

console.log("transportPolicy.peopleBounds.test.ts: ok");
