/**
 * PHASE 6.6A — risk audit boundary (TEST A–L).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/security/writeFraudAudit.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  processDemandPostIntercept,
  processProviderMatchIntercept,
  processSupplyPostIntercept,
} from "@/lib/post-intercept";
import {
  retainFraudDecision,
  writeFraudLog,
  type FraudLogRow,
} from "@/lib/security/writeFraudAudit";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const migration = read(
  "supabase/migrations/20260908000002_risk_audit_boundary_v88.sql",
);
const verifySql = read(
  "supabase/migrations/20260908000002_risk_audit_boundary_v88.verify.sql",
);
const evaluateSrc = read("src/lib/security/evaluateFraudIntercept.ts");
const flowSrc = read("src/lib/security/runFraudIntercept.ts");
const publishRoute = read(
  "src/app/api/posts/evaluate-publish-intercept/route.ts",
);
const matchRoute = read(
  "src/app/api/posts/evaluate-provider-match-intercept/route.ts",
);
const postIntercept = read("src/lib/post-intercept.ts");

const SAMPLE_PHONE = "381653228255";
const SAMPLE_PLATE = "BG123AB";
const SAMPLE_USER = "11111111-2222-3333-4444-555555555555";

const sampleRow: FraudLogRow = {
  user_id: SAMPLE_USER,
  scene: "multi_account_demand_spam",
  normalized_phone: SAMPLE_PHONE,
  normalized_license_plate: SAMPLE_PLATE,
  reporter_side: "demand",
};

function mockAdmin(
  insert: (row: FraudLogRow) => { error: unknown },
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, "fraud_logs");
      return {
        insert(row: FraudLogRow) {
          return Promise.resolve(insert(row));
        },
      };
    },
  } as unknown as SupabaseClient;
}

function captureErrors<T>(fn: () => Promise<T>): Promise<{
  value: T;
  logs: unknown[][];
}> {
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  return fn()
    .then((value) => ({ value, logs }))
    .finally(() => {
      console.error = original;
    });
}

function serializedLogs(logs: unknown[][]): string {
  return JSON.stringify(logs);
}

function assertNoAuditLeak(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const token of [
    "auditWriteSucceeded",
    "auditError",
    "auditOk",
    "SQLSTATE",
    "fraud_logs",
    "potential_fraud_logs",
    "risk_incidents",
    "risk_scores",
    "phoneAccounts",
    "plateAccounts",
    "trackerScene",
    "normalized_phone",
    "normalized_license_plate",
    SAMPLE_PHONE,
    SAMPLE_PLATE,
    SAMPLE_USER,
    "42501",
    "permission denied",
  ]) {
    assert.equal(text.includes(token), false, `leaked ${token}`);
  }
}

function publishApiBody(decision: { allowed: boolean; errorKey: string }) {
  if (!decision.allowed) {
    return { ok: false, errorKey: decision.errorKey };
  }
  return { ok: true, errorKey: decision.errorKey };
}

function matchApiBody(decision: {
  allowed: boolean;
  errorKey: string;
  isSpaceWarning?: boolean;
}) {
  if (!decision.allowed) {
    return { ok: false, errorKey: decision.errorKey };
  }
  return {
    ok: true,
    errorKey: decision.errorKey,
    isSpaceWarning: Boolean(decision.isSpaceWarning),
  };
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTsFiles(full, out);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

async function main() {
  // TEST A — insert success returns true and does not log
  {
    let inserted: FraudLogRow | null = null;
    const { value, logs } = await captureErrors(() =>
      writeFraudLog(
        mockAdmin((row) => {
          inserted = row;
          return { error: null };
        }),
        sampleRow,
      ),
    );
    assert.equal(value, true);
    assert.deepEqual(inserted, sampleRow);
    assert.deepEqual(logs, []);
  }

  // TEST B — Supabase { error } → false, fixed log only, no leak
  {
    const { value, logs } = await captureErrors(() =>
      writeFraudLog(
        mockAdmin(() => ({
          error: {
            message: `permission denied for table fraud_logs user=${SAMPLE_USER}`,
            details: `Failing row contains (${SAMPLE_PHONE}, ${SAMPLE_PLATE})`,
            hint: "GRANT INSERT ON fraud_logs",
            code: "42501",
          },
        })),
        sampleRow,
      ),
    );
    assert.equal(value, false);
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0], ["[fraud-audit] write failed"]);
    const dumped = serializedLogs(logs);
    assert.equal(dumped, JSON.stringify([["[fraud-audit] write failed"]]));
    assert.equal(dumped.includes("permission denied"), false);
    assert.equal(dumped.includes("details"), false);
    assert.equal(dumped.includes("hint"), false);
    assert.equal(dumped.includes("42501"), false);
    assert.equal(dumped.includes(SAMPLE_PHONE), false);
    assert.equal(dumped.includes(SAMPLE_PLATE), false);
    assert.equal(dumped.includes(SAMPLE_USER), false);
    assert.equal(dumped.includes("message"), false);
  }

  // TEST C — insert throw → false, fixed log only, no exception leak
  {
    const { value, logs } = await captureErrors(() =>
      writeFraudLog(
        mockAdmin(() => {
          throw new Error(`ECONNRESET stack=${SAMPLE_PHONE} ${SAMPLE_USER}`);
        }),
        sampleRow,
      ),
    );
    assert.equal(value, false);
    assert.deepEqual(logs, [["[fraud-audit] writer threw"]]);
    const dumped = serializedLogs(logs);
    assert.equal(dumped.includes("ECONNRESET"), false);
    assert.equal(dumped.includes("stack"), false);
    assert.equal(dumped.includes(SAMPLE_PHONE), false);
    assert.equal(dumped.includes(SAMPLE_USER), false);
  }

  // TEST D — Demand hard deny + audit error keeps original errorKey
  {
    const demand = processDemandPostIntercept({
      has_foreign_phone_in_window: true,
      own_in_window_count: 0,
    });
    assert.equal(demand.allowed, false);
    assert.equal(demand.messageKey, "error.post_denied_blurred");
    assert.equal(demand.logFraud, true);
    const { value: auditOk } = await captureErrors(() =>
      writeFraudLog(
        mockAdmin(() => ({
          error: { message: "write failed", details: SAMPLE_PHONE },
        })),
        sampleRow,
      ),
    );
    assert.equal(auditOk, false);
    const returned = retainFraudDecision(
      { allowed: demand.allowed, errorKey: demand.messageKey },
      auditOk,
    );
    assert.equal(returned.allowed, false);
    assert.equal(returned.errorKey, "error.post_denied_blurred");
    assert.notEqual(returned.errorKey, "error.submit_failed");
    assert.equal(publishApiBody(returned).ok, false);
    assert.equal(publishApiBody(returned).errorKey, "error.post_denied_blurred");
    assert.ok(evaluateSrc.includes("writeAudit: writeFraudLog"));
    assert.ok(flowSrc.includes("retainFraudDecision"));
  }

  // TEST E — Supply historical reuse is not a fraud deny; limit deny does not audit
  {
    const historicalOnly = processSupplyPostIntercept({
      active_supply_posts_count: 0,
      is_premium_member: false,
    });
    assert.equal(historicalOnly.allowed, true);
    assert.notEqual(historicalOnly.trackerScene, "phone_recycling_fraud_1year");
    const supply = processSupplyPostIntercept({
      active_supply_posts_count: 3,
      is_premium_member: false,
    });
    assert.equal(supply.allowed, false);
    assert.equal(supply.messageKey, "error.non_member_limit_exceeded");
    assert.equal(supply.logFraud, false);
    const { value: auditOk } = await captureErrors(() =>
      writeFraudLog(
        mockAdmin(() => ({ error: { message: "fail" } })),
        { ...sampleRow, reporter_side: "provider", scene: "unused" },
      ),
    );
    const returned = retainFraudDecision(
      { allowed: supply.allowed, errorKey: supply.messageKey },
      auditOk,
    );
    assert.equal(returned.allowed, false);
    assert.equal(returned.errorKey, "error.non_member_limit_exceeded");
    assert.notEqual(returned.errorKey, "error.submit_failed");
  }

  // TEST F — Provider Match hard deny + audit error keeps original errorKey
  {
    const match = processProviderMatchIntercept({
      has_foreign_phone_in_window: false,
      has_foreign_plate_in_window: true,
      own_cargo_in_window: 0,
      current_all_matched_units: 0,
      current_all_passengers_count: 0,
      is_bank_verified: false,
    });
    assert.equal(match.allowed, false);
    assert.equal(match.messageKey, "error.match_denied_blurred");
    const { value: auditOk } = await captureErrors(() =>
      writeFraudLog(
        mockAdmin(() => {
          throw new Error("writer exploded");
        }),
        { ...sampleRow, reporter_side: "provider", scene: match.trackerScene! },
      ),
    );
    const returned = retainFraudDecision(
      { allowed: match.allowed, errorKey: match.messageKey },
      auditOk,
    );
    assert.equal(returned.allowed, false);
    assert.equal(returned.errorKey, "error.match_denied_blurred");
    assert.notEqual(returned.errorKey, "error.submit_failed");
    assert.equal(matchApiBody(returned).errorKey, "error.match_denied_blurred");
    assert.ok(flowSrc.includes('errorKey: "error.match_denied_blurred"') || match.messageKey === "error.match_denied_blurred");
    assert.ok(flowSrc.includes("retainFraudDecision"));
  }

  // TEST G — API / browser payload stays ok / errorKey / isSpaceWarning
  {
    const denied = retainFraudDecision(
      { allowed: false, errorKey: "error.post_denied_blurred" },
      false,
    );
    const publishDenied = publishApiBody(denied);
    const matchDenied = matchApiBody({
      allowed: false,
      errorKey: "error.match_denied_blurred",
    });
    const matchAllowed = matchApiBody({
      allowed: true,
      errorKey: "success.matched",
      isSpaceWarning: true,
    });
    assert.deepEqual(Object.keys(publishDenied).sort(), ["errorKey", "ok"]);
    assert.deepEqual(Object.keys(matchDenied).sort(), ["errorKey", "ok"]);
    assert.deepEqual(Object.keys(matchAllowed).sort(), [
      "errorKey",
      "isSpaceWarning",
      "ok",
    ]);
    assertNoAuditLeak(publishDenied);
    assertNoAuditLeak(matchDenied);
    assertNoAuditLeak(matchAllowed);
    for (const src of [publishRoute, matchRoute]) {
      assert.equal(src.includes("auditWriteSucceeded"), false);
      assert.equal(src.includes("auditError"), false);
      assert.equal(src.includes("phoneAccounts"), false);
      assert.equal(src.includes("plateAccounts"), false);
      assert.equal(src.includes("SQLSTATE"), false);
      assert.equal(src.includes("fraud_logs"), false);
      assert.equal(src.includes("trackerScene"), false);
      assert.equal(src.includes("normalized_phone"), false);
      assert.equal(src.includes("normalized_license_plate"), false);
    }
    assert.ok(publishRoute.includes("ok: false"));
    assert.ok(publishRoute.includes("errorKey: decision.errorKey"));
    assert.ok(matchRoute.includes("isSpaceWarning"));
  }

  // TEST H — migration ACL
  {
    for (const table of [
      "public.fraud_logs",
      "public.potential_fraud_logs",
      "public.risk_incidents",
      "public.risk_scores",
    ]) {
      for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
        assert.ok(
          migration.includes(`REVOKE ALL ON TABLE ${table} FROM ${role}`),
          `${table} ${role}`,
        );
      }
    }
    assert.ok(
      migration.includes("GRANT INSERT ON TABLE public.fraud_logs TO service_role"),
    );
    assert.equal(
      /GRANT (?!INSERT ON TABLE public\.fraud_logs TO service_role)/.test(
        migration.replace(
          "GRANT INSERT ON TABLE public.fraud_logs TO service_role",
          "",
        ),
      ),
      false,
    );
    assert.equal(migration.includes("GRANT SELECT"), false);
    assert.equal(migration.includes("GRANT UPDATE"), false);
    assert.equal(migration.includes("GRANT DELETE"), false);
    assert.equal(migration.includes("GRANT TRUNCATE"), false);
    assert.equal(migration.includes("GRANT REFERENCES"), false);
    assert.equal(migration.includes("GRANT TRIGGER"), false);
    assert.equal(
      migration.includes(
        "GRANT USAGE ON SEQUENCE public.potential_fraud_logs_id_seq",
      ),
      false,
    );
    for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
      assert.ok(
        migration.includes(
          `REVOKE ALL ON SEQUENCE public.potential_fraud_logs_id_seq FROM ${role}`,
        ),
      );
    }
    assert.equal(/^\s*CREATE TABLE\b/im.test(migration), false);
    assert.equal(/ALTER TABLE[\s\S]{0,80}ADD\b/i.test(migration), false);
  }

  // TEST I — named dangerous policies dropped; no dynamic DROP POLICY
  {
    assert.ok(
      migration.includes(
        'DROP POLICY IF EXISTS "Users can insert fraud logs"',
      ),
    );
    assert.ok(
      migration.includes(
        'DROP POLICY IF EXISTS "Users can view their own fraud logs"',
      ),
    );
    assert.ok(
      migration.includes(
        'DROP POLICY IF EXISTS "Users can view their own reported risk incidents"',
      ),
    );
    assert.equal(migration.includes("pg_policy"), false);
    assert.equal(migration.includes("EXECUTE format('DROP POLICY"), false);
    assert.equal(migration.includes("FOR pol IN"), false);
  }

  // TEST J — no application writer for parked tables
  {
    const writers = walkTsFiles(join(repoRoot, "src")).filter((file) => {
      const rel = relative(repoRoot, file).replaceAll("\\", "/");
      return !rel.endsWith(".test.ts");
    });
    for (const file of writers) {
      const src = readFileSync(file, "utf8");
      assert.equal(src.includes('from("potential_fraud_logs")'), false, file);
      assert.equal(src.includes('from("risk_incidents")'), false, file);
      assert.equal(src.includes('from("risk_scores")'), false, file);
      assert.equal(src.includes(".from('potential_fraud_logs')"), false, file);
      assert.equal(src.includes(".from('risk_incidents')"), false, file);
      assert.equal(src.includes(".from('risk_scores')"), false, file);
    }
    assert.ok(evaluateSrc.includes('from("fraud_logs")') === false);
    assert.ok(read("src/lib/security/writeFraudAudit.ts").includes('from("fraud_logs")'));
  }

  // TEST K — live Fraud Policy uses current-window signals only
  {
    assert.ok(
      postIntercept.includes("metrics.has_foreign_phone_in_window === true"),
    );
    assert.equal(postIntercept.includes("is_phone_historically_reused"), false);
    assert.equal(
      postIntercept.includes("phone_recycling_fraud_1year"),
      false,
    );
    assert.equal(
      flowSrc.includes("if (phoneAccounts > 1 || plateAccounts > 1)"),
      false,
    );
    const demand = processDemandPostIntercept({
      has_foreign_phone_in_window: true,
      own_in_window_count: 0,
    });
    assert.equal(demand.trackerScene, "multi_account_demand_spam");
    const supply = processSupplyPostIntercept({
      active_supply_posts_count: 0,
      is_premium_member: false,
    });
    assert.notEqual(supply.trackerScene, "phone_recycling_fraud_1year");
    const match = processProviderMatchIntercept({
      has_foreign_phone_in_window: false,
      has_foreign_plate_in_window: true,
      own_cargo_in_window: 0,
      current_all_matched_units: 0,
      current_all_passengers_count: 0,
      is_bank_verified: false,
    });
    assert.equal(match.trackerScene, "multi_account_spacetime_collision");
  }

  // TEST L — init.sql still matches frozen baseline
  {
    const diff = execFileSync(
      "git",
      ["diff", "0e2cb24", "--", "supabase/init.sql"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(diff, "");
  }

  assert.ok(verifySql.includes("relrowsecurity"));
  assert.ok(verifySql.includes("has_table_privilege"));
  assert.ok(verifySql.includes("has_sequence_privilege"));
  assert.ok(verifySql.includes("NOT t.tgisinternal"));
  assert.equal(verifySql.includes("SELECT * FROM public.fraud_logs"), false);
  assert.equal(verifySql.includes("normalized_phone"), false);
  assert.equal(verifySql.includes("normalized_license_plate"), false);
  assert.equal(verifySql.includes("user_id"), false);

  console.log("writeFraudAudit.test.ts: ok");
}

void main();
