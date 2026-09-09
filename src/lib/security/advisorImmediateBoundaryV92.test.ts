/**
 * PHASE 6.6A.1 / 6.6A.1A — Security Advisor immediate boundary (TEST A–R + 1A A–J).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/security/advisorImmediateBoundaryV92.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MATCH_HALL_AUTHOR_NAME_LOOKUP_FAILED_LOG,
  PUBLIC_AUTHOR_NAME_SELECT,
  PUBLIC_PROFILE_CARD_ID_MAX,
  PUBLIC_PROFILE_CARD_RPC,
  PUBLIC_PROFILE_CARD_RPC_FAILED_LOG,
  dedupePublicAuthorIds,
  interpretPublicAuthorNameRows,
  interpretPublicProfileCardsRpc,
  loadPublicProfileCardNames,
  publicProfileCardIdsWithinRpcBound,
} from "@/lib/posts/publicProfileCards";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const PHASE_BASELINE = "de2b229d26626178a947ec23e257d477cef2c87f";
const V92_ORIGINAL = "3d3f600fa6cbe42fa2019aad8658bcbf59bc556d";
const MIGRATION_REL =
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql";
const VERIFY_REL =
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.verify.sql";
const V91_REL =
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql";
const V91_VERIFY_REL =
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.verify.sql";
const V86_REL =
  "supabase/migrations/20260907000001_security_boundary_hardening_v86.sql";

const migration = read(MIGRATION_REL);
const verifySql = read(VERIFY_REL);
const homePage = read("src/app/[locale]/page.tsx");
const hallLoader = read("src/lib/route/buildMatchHall.ts");
const helperSrc = read("src/lib/posts/publicProfileCards.ts");
const detailPage = read("src/app/[locale]/posts/[id]/page.tsx");
const translateRoute = read("src/app/api/translate/route.ts");
const publicPostSelect = read("src/lib/posts/publicPostSelect.ts");
const initSql = read("supabase/init.sql");
const ledger = read("docs/architecture/deferred-cleanup.md");

const FORBIDDEN_RPC_TOKENS = [
  "plate",
  "vehicle",
  "facebook",
  "viber",
  "phone",
  "email",
  "normalized_phone",
  "raw_phone",
  "contact",
  "service_address",
  "origin_gps",
  "destination_gps",
] as const;

const SAMPLE_ID = "11111111-2222-3333-4444-555555555555";

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
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      continue;
    }
    out.push(full);
  }
  return out;
}

function extractRpcBody(sql: string): string {
  const marker = "CREATE OR REPLACE FUNCTION public.get_public_profile_cards_v92";
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, "missing RPC create");
  const rest = sql.slice(start);
  const as = rest.indexOf("AS $$");
  const end = rest.indexOf("$$;", as + 4);
  assert.ok(as >= 0 && end > as, "missing RPC body");
  return rest.slice(as + 5, end);
}

function nonCommentSqlLines(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));
}

function transactionControls(sql: string): string[] {
  return nonCommentSqlLines(sql).filter((line) =>
    /^(BEGIN|COMMIT|ROLLBACK)\s*;$/i.test(line),
  );
}

function stripCommentsAndTx(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (t.startsWith("--")) return false;
      if (/^BEGIN\s*;$/i.test(t)) return false;
      if (/^COMMIT\s*;$/i.test(t)) return false;
      return true;
    })
    .join("\n");
}

function verifyWithoutB2(sql: string): string {
  const b2 = sql.indexOf("-- B2.");
  const b3 = sql.indexOf("-- B3.");
  assert.ok(b2 >= 0 && b3 > b2, "verify B2/B3 markers");
  return sql.slice(0, b2) + sql.slice(b3);
}

function gitShow(rev: string, path: string): string {
  return execFileSync("git", ["show", `${rev}:${path}`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function assertNoDbLeak(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const token of [
    "permission denied",
    "Failing row",
    "SQLSTATE",
    "relacl",
    "proacl",
    "42501",
    SAMPLE_ID,
    "BG123AB",
    "381653228255",
  ]) {
    assert.equal(text.includes(token), false, `leaked ${token}`);
  }
}

const rpcBody = extractRpcBody(migration);

async function main() {
// PHASE 6.6A.1A TEST A — first actual SQL transaction control is BEGIN
{
  const controls = transactionControls(migration);
  assert.equal(controls[0]?.toUpperCase(), "BEGIN;");
  const firstSql = nonCommentSqlLines(migration)[0];
  assert.equal(firstSql?.toUpperCase(), "BEGIN;");
}

// PHASE 6.6A.1A TEST B — last transaction control is COMMIT
{
  const controls = transactionControls(migration);
  assert.equal(controls.at(-1)?.toUpperCase(), "COMMIT;");
  const sqlLines = nonCommentSqlLines(migration);
  assert.equal(sqlLines.at(-1)?.toUpperCase(), "COMMIT;");
}

// PHASE 6.6A.1A TEST C — BEGIN once, COMMIT once
{
  const controls = transactionControls(migration);
  assert.deepEqual(
    controls.map((line) => line.toUpperCase()),
    ["BEGIN;", "COMMIT;"],
  );
}

// PHASE 6.6A.1A TEST D — DROP VIEW profile_cards is before COMMIT
{
  const dropAt = migration.indexOf("DROP VIEW IF EXISTS public.profile_cards;");
  const commitAt = migration.search(/^COMMIT\s*;/m);
  assert.ok(dropAt >= 0, "missing DROP VIEW");
  assert.ok(commitAt >= 0, "missing COMMIT");
  assert.ok(dropAt < commitAt, "DROP VIEW must precede COMMIT");
}

// PHASE 6.6A.1A TEST E — no DROP ... CASCADE
{
  assert.equal(/DROP\s+\S+[\s\S]{0,80}\bCASCADE\b/i.test(migration), false);
  assert.equal(/\bCASCADE\b/.test(
    nonCommentSqlLines(migration).join("\n"),
  ), false);
}

// PHASE 6.6A.1A TEST F — verify B2 uses proallargtypes/proargmodes/proargnames
{
  const b2 = verifySql.slice(
    verifySql.indexOf("-- B2."),
    verifySql.indexOf("-- B3."),
  );
  assert.ok(b2.includes("proallargtypes"));
  assert.ok(b2.includes("proargmodes"));
  assert.ok(b2.includes("proargnames"));
  assert.ok(/WITH ORDINALITY/i.test(b2));
}

// PHASE 6.6A.1A TEST G — B2 no longer joins pg_attribute.attrelid = p.prorettype
{
  const b2 = verifySql.slice(
    verifySql.indexOf("-- B2."),
    verifySql.indexOf("-- B3."),
  );
  assert.equal(b2.includes("attrelid = p.prorettype"), false);
  assert.equal(/attrelid\s*=\s*p\.prorettype/.test(b2), false);
}

// PHASE 6.6A.1A TEST H — input p_ids is not a return column
{
  const b2 = verifySql.slice(
    verifySql.indexOf("-- B2."),
    verifySql.indexOf("-- B3."),
  );
  assert.ok(b2.includes("u.argmode IN ('o', 'b', 't')"));
  assert.equal(/column_name\s*=\s*'p_ids'/.test(b2), false);
  assert.ok(b2.includes("IN params (p_ids) are excluded") || b2.includes("p_ids"));
}

// PHASE 6.6A.1A TEST I — expected return columns are id uuid, full_name text
{
  const b2 = verifySql.slice(
    verifySql.indexOf("-- B2."),
    verifySql.indexOf("-- B3."),
  );
  assert.ok(b2.includes("1, id, uuid"));
  assert.ok(b2.includes("2, full_name, text"));
  assert.ok(b2.includes("column_name = 'id'"));
  assert.ok(b2.includes("type_name = 'uuid'"));
  assert.ok(b2.includes("column_name = 'full_name'"));
  assert.ok(b2.includes("type_name = 'text'"));
  assert.ok(b2.includes("return_column_count = 2"));
  assert.ok(b2.includes("return_signature_matches = true"));
}

// PHASE 6.6A.1A TEST J — remaining v92 SQL semantics unchanged vs 3d3f600
{
  const baselineMig = gitShow(V92_ORIGINAL, MIGRATION_REL);
  const baselineVerify = gitShow(V92_ORIGINAL, VERIFY_REL);
  assert.equal(stripCommentsAndTx(migration), stripCommentsAndTx(baselineMig));
  assert.equal(verifyWithoutB2(verifySql), verifyWithoutB2(baselineVerify));
}

// TEST A — RPC returns only id / full_name
{
  assert.ok(
    /RETURNS TABLE\s*\(\s*id uuid,\s*full_name text\s*\)/i.test(migration),
  );
  assert.ok(rpcBody.includes("pr.id"));
  assert.ok(rpcBody.includes("pr.full_name"));
  const interpreted = interpretPublicProfileCardsRpc({
    error: null,
    data: [
      {
        id: "a",
        full_name: "Ada",
        plate: "BG123AB",
        vehicle: "van",
        facebook: "x",
        viber: "y",
      },
    ],
  });
  assert.deepEqual([...interpreted.names.entries()], [["a", "Ada"]]);
  assert.equal(JSON.stringify([...interpreted.names.values()]).includes("BG"), false);
}

// TEST B — function body has no plate/vehicle/facebook/viber/phone/email
{
  const lower = rpcBody.toLowerCase();
  for (const token of FORBIDDEN_RPC_TOKENS) {
    assert.equal(
      new RegExp(`\\b${token}\\b`).test(lower),
      false,
      `RPC body must not contain ${token}`,
    );
  }
}

// TEST C — null / empty p_ids do not return profiles
{
  assert.ok(rpcBody.includes("p_ids IS NOT NULL"));
  assert.ok(rpcBody.includes("cardinality(p_ids) BETWEEN 1 AND 120"));
  assert.equal(publicProfileCardIdsWithinRpcBound([]), false);
  let called = false;
  const names = await loadPublicProfileCardNames({
    authorIds: [],
    rpc: async () => {
      called = true;
      return { data: [{ id: SAMPLE_ID, full_name: "Ada" }], error: null };
    },
  });
  assert.equal(called, false);
  assert.equal(names.size, 0);
}

// TEST D — over 120 is rejected / empty; no silent truncate
{
  assert.equal(rpcBody.includes("LIMIT"), false);
  assert.equal(helperSrc.includes(".slice("), false);
  assert.equal(homePage.includes(".slice("), false);
  const overflow = Array.from(
    { length: PUBLIC_PROFILE_CARD_ID_MAX + 1 },
    (_, i) => `id-${i}`,
  );
  assert.equal(publicProfileCardIdsWithinRpcBound(overflow), false);
  let called = false;
  const names = await loadPublicProfileCardNames({
    authorIds: overflow,
    rpc: async () => {
      called = true;
      return { data: [{ id: overflow[0], full_name: "Ada" }], error: null };
    },
  });
  assert.equal(called, false);
  assert.equal(names.size, 0);
  const within = Array.from({ length: PUBLIC_PROFILE_CARD_ID_MAX }, (_, i) => `id-${i}`);
  assert.equal(publicProfileCardIdsWithinRpcBound(within), true);
}

// TEST E — only active / completed public-post authors
{
  assert.ok(rpcBody.includes("FROM public.posts AS po"));
  assert.ok(rpcBody.includes("po.user_id = pr.id"));
  assert.ok(rpcBody.includes("po.status IN ('active', 'completed')"));
  assert.ok(rpcBody.includes("EXISTS"));
}

// TEST F — homepage uses RPC, not profile_cards
{
  assert.ok(homePage.includes("loadPublicProfileCardNames"));
  assert.ok(homePage.includes("supabase.rpc(fn, args)"));
  assert.equal(homePage.includes("profile_cards"), false);
  assert.equal(homePage.includes("createAdminClient"), false);
  assert.ok(helperSrc.includes(`"${PUBLIC_PROFILE_CARD_RPC}"`));
}

// TEST G — homepage RPC failure safe fallback, no DB error, no 500
{
  const dbError = {
    message: "permission denied for table profiles",
    details: `Failing row contains (${SAMPLE_ID})`,
    hint: "GRANT SELECT ON profile_cards",
    code: "42501",
  };
  const interpreted = interpretPublicProfileCardsRpc({
    error: dbError,
    data: [{ id: SAMPLE_ID, full_name: "Ada" }],
  });
  assert.equal(interpreted.failed, true);
  assert.equal(interpreted.log, PUBLIC_PROFILE_CARD_RPC_FAILED_LOG);
  assert.equal(interpreted.names.size, 0);
  assertNoDbLeak(interpreted);

  const logs: string[] = [];
  const names = await loadPublicProfileCardNames({
    authorIds: [SAMPLE_ID],
    rpc: async () => {
      throw new Error("permission denied for table profiles hint=GRANT");
    },
    onSafeFailure(log) {
      logs.push(log);
    },
  });
  assert.equal(names.size, 0);
  assert.deepEqual(logs, [PUBLIC_PROFILE_CARD_RPC_FAILED_LOG]);
  assert.equal(homePage.includes("error.message"), false);
  assert.equal(homePage.includes("error.details"), false);
  assert.equal(homePage.includes("error.hint"), false);
}

// TEST H — buildMatchHall uses existing admin profiles id/full_name only
{
  assert.ok(hallLoader.includes("createAdminClient"));
  assert.ok(hallLoader.includes('.from("profiles")'));
  assert.ok(hallLoader.includes("PUBLIC_AUTHOR_NAME_SELECT"));
  assert.equal(PUBLIC_AUTHOR_NAME_SELECT, "id, full_name");
  assert.equal(hallLoader.includes('.from("profile_cards")'), false);
  assert.equal(hallLoader.includes("get_public_profile_cards_v92"), false);
  assert.equal(hallLoader.includes("phone"), false);
  assert.equal(hallLoader.includes("plate"), false);
  assert.equal(hallLoader.includes("facebook"), false);
  assert.equal(hallLoader.includes("viber"), false);
  assert.equal(hallLoader.includes("vehicle"), false);
  assert.ok(hallLoader.includes("MATCH_HALL_AUTHOR_NAME_LOOKUP_FAILED_LOG"));
  const names = interpretPublicAuthorNameRows({
    error: {
      message: "permission denied",
      details: "profiles",
      hint: "GRANT",
    },
    data: [{ id: SAMPLE_ID, full_name: "Ada", phone: "381" }],
  });
  assert.equal(names.size, 0);
  assert.equal(MATCH_HALL_AUTHOR_NAME_LOOKUP_FAILED_LOG.includes("profiles"), false);
}

// TEST I — production profile_cards callers = 0
{
  const files = walkRuntimeTs(join(repoRoot, "src"));
  const callerRe = /\.from\(\s*['"]profile_cards['"]\s*\)/;
  const hits: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (callerRe.test(src)) {
      hits.push(relative(repoRoot, file).replaceAll("\\", "/"));
    }
  }
  assert.deepEqual(hits, []);
  assert.equal(homePage.includes('.from("profile_cards")'), false);
  assert.equal(hallLoader.includes('.from("profile_cards")'), false);
}

// TEST J — view DROP without CASCADE
{
  const dropLine = migration
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("DROP VIEW"));
  assert.equal(dropLine, "DROP VIEW IF EXISTS public.profile_cards;");
  assert.equal(/DROP\s+(VIEW|TABLE|FUNCTION|POLICY)[\s\S]{0,80}CASCADE/i.test(migration), false);
}

// TEST K — spatial_ref_sys RLS enabled, not FORCE
{
  assert.ok(
    migration.includes("ALTER TABLE public.spatial_ref_sys\nENABLE ROW LEVEL SECURITY;") ||
      migration.includes(
        "ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;",
      ),
  );
  assert.equal(/\bFORCE ROW LEVEL SECURITY\b/i.test(migration), false);
  assert.ok(verifySql.includes("relrowsecurity"));
  assert.ok(verifySql.includes("relforcerowsecurity"));
}

// TEST L — anon / authenticated / service_role SELECT only, no direct writes
{
  assert.ok(
    migration.includes("REVOKE ALL ON TABLE public.spatial_ref_sys FROM PUBLIC;"),
  );
  assert.ok(
    migration.includes("REVOKE ALL ON TABLE public.spatial_ref_sys FROM anon;"),
  );
  assert.ok(
    migration.includes(
      "REVOKE ALL ON TABLE public.spatial_ref_sys FROM authenticated;",
    ),
  );
  assert.ok(
    migration.includes(
      "REVOKE ALL ON TABLE public.spatial_ref_sys FROM service_role;",
    ),
  );
  assert.ok(
    migration.includes(
      "GRANT SELECT ON TABLE public.spatial_ref_sys TO anon, authenticated, service_role;",
    ),
  );
  assert.equal(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)\b/i.test(
    migration.slice(migration.indexOf("spatial_ref_sys")),
  ), false);
}

// TEST M — only SELECT policy, no write policy
{
  assert.ok(
    migration.includes("DROP POLICY IF EXISTS spatial_ref_sys_read_reference_v92"),
  );
  assert.ok(
    /CREATE POLICY\s+spatial_ref_sys_read_reference_v92[\s\S]*FOR SELECT[\s\S]*TO anon, authenticated, service_role[\s\S]*USING \(true\)/.test(
      migration,
    ),
  );
  assert.equal(/CREATE POLICY[\s\S]*spatial_ref_sys[\s\S]*FOR INSERT/i.test(migration), false);
  assert.equal(/CREATE POLICY[\s\S]*spatial_ref_sys[\s\S]*FOR UPDATE/i.test(migration), false);
  assert.equal(/CREATE POLICY[\s\S]*spatial_ref_sys[\s\S]*FOR DELETE/i.test(migration), false);
  assert.ok(verifySql.includes("polcmd"));
}

// TEST N — PostGIS extension / table not dropped, moved, or data-altered
{
  assert.equal(/\bDROP EXTENSION\b/i.test(migration), false);
  assert.equal(/\bALTER EXTENSION\b/i.test(migration), false);
  assert.equal(/\bDROP TABLE\b/i.test(migration), false);
  assert.equal(/ALTER TABLE[\s\S]{0,40}SET SCHEMA/i.test(migration), false);
  assert.equal(/\bDELETE FROM\b/i.test(migration), false);
  assert.equal(/\bUPDATE\s+public\.spatial_ref_sys\b/i.test(migration), false);
  assert.equal(/\bINSERT INTO\s+public\.spatial_ref_sys\b/i.test(migration), false);
  assert.ok(verifySql.includes("extname = 'postgis'") || verifySql.includes("e.extname = 'postgis'"));
}

// TEST O — public_posts_safe completely unchanged vs baseline
{
  assert.equal(gitDiff("src/lib/posts/publicPostSelect.ts"), "");
  assert.equal(gitDiff(V86_REL), "");
  assert.equal(gitDiff("supabase/init.sql"), "");
  assert.equal(gitDiff(V91_REL), "");
  assert.equal(gitDiff(V91_VERIFY_REL), "");
  assert.equal(migration.includes("CREATE VIEW public.public_posts_safe"), false);
  assert.equal(migration.includes("ALTER VIEW public.public_posts_safe"), false);
  assert.equal(migration.includes("security_invoker = true"), false);
  assert.ok(homePage.includes('from("public_posts_safe")'));
  assert.ok(homePage.includes("PUBLIC_SAFE_POST_SELECT"));
  assert.ok(publicPostSelect.includes("PUBLIC_SAFE_POST_SELECT"));
}

// TEST P — public reads do not fall back to anonymous posts dumps
{
  const hallBlock = homePage.slice(0, homePage.indexOf("let compliancePosts"));
  assert.ok(hallBlock.includes('from("public_posts_safe")'));
  assert.equal(hallBlock.includes('from("posts")'), false);
  assert.ok(homePage.includes("if (user)"));
  assert.ok(detailPage.includes('from("public_posts_safe")'));
  assert.ok(detailPage.includes("PUBLIC_SAFE_POST_SELECT"));
  assert.ok(detailPage.includes("ownedOrParticipant"));
  assert.ok(translateRoute.includes('from("public_posts_safe")'));
  const publicDetail = detailPage.slice(
    detailPage.indexOf("const { data: publicPost }"),
    detailPage.indexOf("const post = ownedOrParticipant"),
  );
  assert.ok(publicDetail.includes('from("public_posts_safe")'));
  assert.equal(publicDetail.includes('from("posts")'), false);
  const publicTranslate = translateRoute.slice(
    translateRoute.indexOf("const { data: publicPost }"),
    translateRoute.indexOf("const post = owned"),
  );
  assert.ok(publicTranslate.includes('from("public_posts_safe")'));
  assert.equal(publicTranslate.includes('from("posts")'), false);
}

// TEST Q — browser/API helpers do not echo DB message/details/hint or ACL
{
  assert.equal(homePage.includes("error.message"), false);
  assert.equal(hallLoader.includes("error.message"), false);
  assert.equal(hallLoader.includes("error.details"), false);
  assert.equal(hallLoader.includes("error.hint"), false);
  const ok = interpretPublicProfileCardsRpc({
    error: null,
    data: [{ id: "a", full_name: "Ada" }],
  });
  assertNoDbLeak({ names: [...ok.names.entries()], failed: ok.failed, log: ok.log });
  assert.ok(helperSrc.includes(PUBLIC_PROFILE_CARD_RPC_FAILED_LOG));
}

// TEST R — migration and verify do not read business data rows
{
  const verifySqlNoComments = verifySql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.equal(/SELECT[\s\S]{0,80}FROM\s+public\.profiles\b/i.test(verifySqlNoComments), false);
  assert.equal(/SELECT[\s\S]{0,80}FROM\s+public\.posts\b/i.test(verifySqlNoComments), false);
  assert.equal(/FROM\s+public\.spatial_ref_sys\b/i.test(verifySqlNoComments), false);
  assert.equal(/\bGRANT\b/i.test(verifySqlNoComments), false);
  assert.equal(/\bREVOKE\b/i.test(verifySqlNoComments), false);
  assert.equal(/FROM\s+public\.get_public_profile_cards_v92/i.test(verifySql), false);
  assert.equal(/SELECT\s+\*\s+FROM\s+get_public_profile_cards_v92/i.test(verifySql), false);
  assert.ok(verifySql.includes("to_regclass('public.profile_cards')"));
  assert.ok(verifySql.includes("to_regprocedure("));
  assert.ok(verifySql.includes("has_function_privilege"));
  assert.ok(verifySql.includes("has_table_privilege"));
  assert.equal(verifySql.includes("array_agg"), false);
  assert.ok(initSql.includes("create or replace view public.profile_cards"));
  assert.ok(ledger.includes("profile_cards"));
  assert.ok(ledger.includes("get_public_profile_cards_v92"));
}

// RPC ACL in migration
{
  assert.ok(migration.includes("LANGUAGE sql"));
  assert.ok(migration.includes("STABLE"));
  assert.ok(migration.includes("SECURITY DEFINER"));
  assert.ok(migration.includes("SET search_path = pg_catalog, public"));
  assert.ok(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.get_public_profile_cards_v92(uuid[]) FROM PUBLIC;",
    ),
  );
  assert.ok(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.get_public_profile_cards_v92(uuid[]) FROM anon;",
    ),
  );
  assert.ok(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.get_public_profile_cards_v92(uuid[]) FROM authenticated;",
    ),
  );
  assert.ok(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.get_public_profile_cards_v92(uuid[]) FROM service_role;",
    ),
  );
  assert.ok(
    migration.includes(
      "GRANT EXECUTE ON FUNCTION public.get_public_profile_cards_v92(uuid[]) TO anon, authenticated;",
    ),
  );
  assert.ok(rpcBody.includes("SELECT DISTINCT"));
  assert.equal(dedupePublicAuthorIds(["a", "a", "b"]).join(","), "a,b");
}

console.log("advisorImmediateBoundaryV92.test.ts: ok");
}

void main();
