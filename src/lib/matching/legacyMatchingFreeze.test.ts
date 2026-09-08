/**
 * PHASE 6.6B.1 — freeze incomplete matching and hide untrusted hall credit (TEST A–N).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/legacyMatchingFreeze.test.ts
 *
 * Future 6.7B copy (do not render buttons this round):
 * Demand card: 我能帮忙 / Offer help / Ponudi pomoć
 * Provider card: 请求帮助 / Request help / Zatraži pomoć
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  freezeLegacyDirectMatchIntercept,
  MATCHING_TEMPORARILY_UNAVAILABLE_KEY,
} from "@/lib/matching/legacyMatchingFreeze";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const homePage = read("src/app/[locale]/page.tsx");
const postCard = read("src/components/hall/PostCard.tsx");
const homeConsole = read("src/components/home/HomeConsole.tsx");
const lbsWall = read("src/components/home/LbsMirrorWall.tsx");
const actionsSrc = read("src/components/post/PostActions.tsx");
const matchRoute = read(
  "src/app/api/posts/evaluate-provider-match-intercept/route.ts",
);
const freezeHelper = read("src/lib/matching/legacyMatchingFreeze.ts");
const providerMatch = read("src/lib/post-form/providerMatch.ts");
const migration = read(
  "supabase/migrations/20260908000003_freeze_legacy_direct_match_v89.sql",
);
const verifySql = read(
  "supabase/migrations/20260908000003_freeze_legacy_direct_match_v89.verify.sql",
);
const zh = read("src/messages/zh.json");
const en = read("src/messages/en.json");
const sr = read("src/messages/sr.json");
const evaluateSrc = read("src/lib/security/evaluateFraudIntercept.ts");
const flowSrc = read("src/lib/security/runFraudIntercept.ts");
const writeAuditSrc = read("src/lib/security/writeFraudAudit.ts");

const FAKE_CREDIT_TOKENS = [
  "0%",
  "0 orders",
  "0 reviews",
  "暂无评价",
  "★ —",
  "New member",
];

function walkRuntimeTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name === ".next") continue;
    const full = join(dir, name.name);
    if (name.isDirectory()) walkRuntimeTs(full, out);
    else if (
      (name.name.endsWith(".ts") || name.name.endsWith(".tsx")) &&
      !name.name.endsWith(".test.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

function assertNoLeak(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const token of [
    "phoneAccounts",
    "plateAccounts",
    "normalized_phone",
    "normalized_license_plate",
    "auditWriteSucceeded",
    "auditError",
    "trackerScene",
    "SQLSTATE",
    "fraud_logs",
    "evaluateProviderMatchFraud",
    "381653228255",
    "BG123AB",
    "11111111-2222-3333-4444-555555555555",
  ]) {
    assert.equal(text.includes(token), false, `leaked ${token}`);
  }
}

// TEST A — Provider cards no longer render CreditDashboard
{
  assert.equal(postCard.includes("CreditDashboard"), false);
  assert.equal(postCard.includes("creditStats"), false);
  assert.ok(readFileSync(join(repoRoot, "src/components/credit/CreditDashboard.tsx"), "utf8").includes("export function CreditDashboard"));
}

// TEST B — Demand cards no fake credit
{
  for (const src of [postCard, homeConsole, lbsWall, homePage]) {
    for (const token of FAKE_CREDIT_TOKENS) {
      assert.equal(src.includes(token), false, token);
    }
    assert.equal(src.includes("creditStats"), false);
    assert.equal(src.includes("computeCreditStats"), false);
  }
}

// TEST C — HomePage no authorIds completion loop
{
  assert.equal(homePage.includes("computeCreditStats"), false);
  assert.equal(homePage.includes("creditByUser"), false);
  assert.equal(homePage.includes("creditStats"), false);
  assert.equal(/for\s*\(\s*const\s+uid\s+of\s+authorIds\s*\)/.test(homePage), false);
}

// TEST D — no N+1 completion query on hall path
{
  assert.equal(homePage.includes("completion_type"), false);
  assert.equal(homePage.includes('.eq("status", "completed")'), false);
  assert.equal(homePage.includes('.eq("post_type", "provider")'), false);
}

// TEST E — public_posts_safe retained as public hall read
{
  assert.ok(homePage.includes('from("public_posts_safe")'));
  assert.ok(homePage.includes("PUBLIC_SAFE_POST_SELECT"));
  const hallBlock = homePage.slice(
    0,
    homePage.indexOf("let compliancePosts"),
  );
  assert.equal(hallBlock.includes('from("posts")'), false);
  assert.ok(
    readFileSync(
      join(repoRoot, "src/lib/posts/publicPostSelect.ts"),
      "utf8",
    ).includes("PUBLIC_SAFE_POST_SELECT"),
  );
}

// TEST F — PostActions no clickable old confirm_match button
{
  assert.equal(actionsSrc.includes("confirm_match"), false);
  assert.equal(actionsSrc.includes("confirmMatch"), false);
  assert.equal(actionsSrc.includes("acceptCargo"), false);
  assert.equal(actionsSrc.includes("async function confirm("), false);
  assert.equal(actionsSrc.includes("runProviderMatchIntercept"), false);
  assert.equal(actionsSrc.includes("evaluate-provider-match-intercept"), false);
}

// TEST G — browser runtime no supabase.rpc("confirm_match", ...)
{
  const runtimeFiles = walkRuntimeTs(join(repoRoot, "src"));
  for (const file of runtimeFiles) {
    const src = readFileSync(file, "utf8");
    assert.equal(src.includes('rpc("confirm_match"'), false, file);
    assert.equal(src.includes("rpc('confirm_match'"), false, file);
  }
}

// TEST H — existing match follow-up UI kept
{
  assert.ok(actionsSrc.includes("demand_user_id"));
  assert.ok(actionsSrc.includes("provider_user_id"));
  assert.ok(actionsSrc.includes("VerificationShield"));
  assert.ok(actionsSrc.includes("AutoMeltDialog"));
  assert.ok(actionsSrc.includes("cancel_match_no_fault"));
  assert.equal(actionsSrc.includes("reveal_contact"), true);
}

// TEST I — disabled API returns 409; no Fraud / audit
{
  const result = freezeLegacyDirectMatchIntercept();
  assert.equal(result.status, 409);
  assert.deepEqual(result.json, {
    ok: false,
    errorKey: MATCHING_TEMPORARILY_UNAVAILABLE_KEY,
  });
  assert.ok(matchRoute.includes("freezeLegacyDirectMatchIntercept"));
  assert.equal(matchRoute.includes("evaluateProviderMatchFraud"), false);
  assert.equal(matchRoute.includes("createClient"), false);
  assert.equal(matchRoute.includes("createAdmin"), false);
  assert.equal(matchRoute.includes("from(\"profiles\")"), false);
  assert.equal(matchRoute.includes("fraud_logs"), false);
  assert.equal(matchRoute.includes("writeFraudLog"), false);
  assert.equal(matchRoute.includes("runFraudIntercept"), false);
  assert.ok(evaluateSrc.includes("evaluateProviderMatchFraud"));
  assert.ok(flowSrc.includes("runProviderMatchIntercept"));
  assert.ok(writeAuditSrc.includes("writeFraudLog"));
}

// TEST J — browser response no metrics / phone / plate / UUID / audit / SQL
{
  const result = freezeLegacyDirectMatchIntercept();
  assertNoLeak(result.json);
  assert.deepEqual(Object.keys(result.json).sort(), ["errorKey", "ok"]);
  for (const src of [matchRoute, freezeHelper]) {
    assert.equal(src.includes("phoneAccounts"), false);
    assert.equal(src.includes("plateAccounts"), false);
    assert.equal(src.includes("normalized_phone"), false);
    assert.equal(src.includes("auditWriteSucceeded"), false);
    assert.equal(src.includes("SQLSTATE"), false);
  }
  assert.ok(zh.includes("匹配功能正在准备中，请稍后再试。"));
  assert.ok(en.includes("Matching is being prepared. Please try again later."));
  assert.ok(
    sr.includes("Funkcija povezivanja je u pripremi. Pokušajte ponovo kasnije."),
  );
  assert.ok(providerMatch.includes("res.status === 409"));
}

// TEST K — migration ACL confirm_match EXECUTE false for four roles
{
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert.ok(
      migration.includes(
        `REVOKE EXECUTE ON FUNCTION public.confirm_match(uuid) FROM ${role}`,
      ),
      role,
    );
  }
  assert.ok(migration.includes("to_regprocedure('public.confirm_match(uuid)')"));
  assert.equal(migration.includes("REVOKE IF EXISTS"), false);
  assert.ok(verifySql.includes("has_function_privilege"));
  assert.ok(verifySql.includes("anon"));
  assert.ok(verifySql.includes("authenticated"));
  assert.ok(verifySql.includes("service_role"));
  assert.ok(verifySql.includes("public_execute"));
}

// TEST L — migration does not DROP confirm_match, no CASCADE, no historical deletes
{
  assert.equal(/^\s*DROP\s+FUNCTION/im.test(migration), false);
  assert.equal(/\bCASCADE\b/.test(migration), false);
  assert.equal(/^\s*DELETE\s+FROM/im.test(migration), false);
  assert.equal(/^\s*TRUNCATE\b/im.test(migration), false);
  assert.equal(/^\s*CREATE\s+TABLE\b/im.test(migration), false);
  assert.equal(migration.includes("cancel_match_no_fault"), false);
  assert.equal(migration.includes("reveal_contact"), false);
  assert.equal(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.confirm_match/i.test(migration), false);
}

// TEST M — 6.6B fraud intercept kept (source still present; suite run separately)
{
  assert.ok(evaluateSrc.includes("export async function evaluateProviderMatchFraud"));
  assert.ok(flowSrc.includes("export async function runProviderMatchIntercept"));
  assert.ok(flowSrc.includes("writeAudit"));
  assert.ok(writeAuditSrc.includes("export async function writeFraudLog"));
}

// TEST N — besides new 20260908000003, init.sql unchanged vs frozen baseline
{
  const diff = execFileSync(
    "git",
    ["diff", "0e2cb24", "--", "supabase/init.sql"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(diff, "");
  const migrationNames = readdirSync(join(repoRoot, "supabase/migrations"));
  assert.ok(
    migrationNames.includes("20260908000003_freeze_legacy_direct_match_v89.sql"),
  );
  assert.ok(
    migrationNames.includes(
      "20260908000003_freeze_legacy_direct_match_v89.verify.sql",
    ),
  );
}

console.log("legacyMatchingFreeze.test.ts: ok");
