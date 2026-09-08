/**
 * PHASE 6.7A — match request / contract foundation (TEST A–Y).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/model.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  processDemandPostIntercept,
  processSupplyPostIntercept,
} from "@/lib/post-intercept";
import {
  hasDistinctParties,
  isAlignedApplicantRole,
  isObjectPayload,
  isTerminalContractStatus,
  isTerminalRequestStatus,
  isValidMatchApplicantRole,
  isValidMatchContractStatus,
  isValidMatchRequestStatus,
  type MatchContractRecord,
  type MatchRequestRecord,
} from "@/lib/matching/model";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const migration = read(
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
);
const verifySql = read(
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.verify.sql",
);
const ledger = read("docs/architecture/deferred-cleanup.md");
const postCard = read("src/components/hall/PostCard.tsx");
const homePage = read("src/app/[locale]/page.tsx");
const interceptSrc = read("src/lib/post-intercept.ts");
const freezeSrc = read("src/lib/matching/legacyMatchingFreeze.ts");

const PROVIDER_APPLICANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DEMAND_OWNER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DEMAND_POST = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PROVIDER_POST = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const DEMAND_APPLICANT = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const PROVIDER_OWNER = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const NOW = "2026-09-08T12:00:00.000Z";

function providerAppliesToDemand(
  overrides: Partial<MatchRequestRecord> = {},
): MatchRequestRecord {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    target_post_id: DEMAND_POST,
    target_post_type: "demand",
    applicant_user_id: PROVIDER_APPLICANT,
    recipient_user_id: DEMAND_OWNER,
    applicant_role: "provider",
    status: "pending",
    payload_version: 1,
    application_payload: { transport_mode: "car" },
    client_request_id: "22222222-2222-2222-2222-222222222222",
    created_at: NOW,
    updated_at: NOW,
    responded_at: null,
    expires_at: null,
    ...overrides,
  };
}

function demandAppliesToProvider(
  overrides: Partial<MatchRequestRecord> = {},
): MatchRequestRecord {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    target_post_id: PROVIDER_POST,
    target_post_type: "provider",
    applicant_user_id: DEMAND_APPLICANT,
    recipient_user_id: PROVIDER_OWNER,
    applicant_role: "demand",
    status: "pending",
    payload_version: 1,
    application_payload: { category: "deliver", escort_seats: 0 },
    client_request_id: "44444444-4444-4444-4444-444444444444",
    created_at: NOW,
    updated_at: NOW,
    responded_at: null,
    expires_at: null,
    ...overrides,
  };
}

function sampleContract(
  requestId: string,
  overrides: Partial<MatchContractRecord> = {},
): MatchContractRecord {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    request_id: requestId,
    source_post_id: DEMAND_POST,
    source_post_type: "demand",
    demand_user_id: DEMAND_OWNER,
    provider_user_id: PROVIDER_APPLICANT,
    status: "accepted",
    snapshot_version: 1,
    demand_snapshot: { category: "deliver", escort_seats: 0, pure_cargo: true },
    provider_snapshot: { transport_mode: "car" },
    agreement_snapshot: { currency: "EUR", fee_amount_minor: 0, version: 1 },
    accepted_at: NOW,
    in_progress_at: null,
    completed_at: null,
    cancelled_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function assertNoForbiddenColumns(src: string) {
  assert.equal(/\bcounterpart_post_id\s+/i.test(src), false);
  assert.equal(/\bdemand_post_id\s+(?:uuid|text)/i.test(src), false);
  assert.equal(/\bprovider_post_id\s+(?:uuid|text)/i.test(src), false);
  assert.equal(/\bpickup_code\s+/i.test(src), false);
  assert.equal(/\bdelivery_code\s+/i.test(src), false);
}

// TEST A — Provider with no own post can apply to a Demand
{
  const row = providerAppliesToDemand();
  assert.equal(row.target_post_type, "demand");
  assert.equal(row.applicant_role, "provider");
  assert.ok(isAlignedApplicantRole(row.target_post_type, row.applicant_role));
  assert.ok(hasDistinctParties(row.applicant_user_id, row.recipient_user_id));
  assert.equal("counterpart_post_id" in row, false);
  assert.equal("applicant_post_id" in row, false);
}

// TEST B — Demand with no own post can apply to a Provider
{
  const row = demandAppliesToProvider();
  assert.equal(row.target_post_type, "provider");
  assert.equal(row.applicant_role, "demand");
  assert.ok(isAlignedApplicantRole(row.target_post_type, row.applicant_role));
  assert.equal("counterpart_post_id" in row, false);
}

// TEST C — no forced counterpart_post_id
{
  assertNoForbiddenColumns(migration);
  const reqKeys = Object.keys(providerAppliesToDemand());
  assert.equal(reqKeys.includes("counterpart_post_id"), false);
  const contractKeys = Object.keys(sampleContract("r1"));
  assert.equal(contractKeys.includes("counterpart_post_id"), false);
  assert.equal(contractKeys.includes("demand_post_id"), false);
  assert.equal(contractKeys.includes("provider_post_id"), false);
}

// TEST D — same-user CHECK
{
  assert.ok(migration.includes("applicant_user_id <> recipient_user_id"));
  assert.ok(migration.includes("demand_user_id <> provider_user_id"));
  assert.equal(
    hasDistinctParties(PROVIDER_APPLICANT, PROVIDER_APPLICANT),
    false,
  );
  assert.ok(hasDistinctParties(PROVIDER_APPLICANT, DEMAND_OWNER));
}

// TEST E — application_payload must be a JSON object
{
  assert.ok(migration.includes("jsonb_typeof(application_payload) = 'object'"));
  assert.equal(isObjectPayload({}), true);
  assert.equal(isObjectPayload({ a: 1 }), true);
  assert.equal(isObjectPayload([]), false);
  assert.equal(isObjectPayload(null), false);
  assert.equal(isObjectPayload("x"), false);
  const row = providerAppliesToDemand();
  assert.ok(isObjectPayload(row.application_payload));
}

// TEST F — request statuses
{
  for (const status of [
    "pending",
    "accepted",
    "rejected",
    "withdrawn",
    "expired",
  ] as const) {
    assert.equal(isValidMatchRequestStatus(status), true);
  }
  assert.equal(isValidMatchRequestStatus("open"), false);
  assert.equal(isValidMatchRequestStatus("matched"), false);
  assert.ok(isTerminalRequestStatus("accepted"));
  assert.equal(isTerminalRequestStatus("pending"), false);
  assert.ok(isValidMatchApplicantRole("demand"));
  assert.ok(isValidMatchApplicantRole("provider"));
  assert.equal(isValidMatchApplicantRole("both"), false);
}

// TEST G — contract statuses
{
  for (const status of [
    "accepted",
    "in_progress",
    "pending_completion",
    "completed",
    "disputed",
    "cancelled",
  ] as const) {
    assert.equal(isValidMatchContractStatus(status), true);
  }
  assert.equal(isValidMatchContractStatus("pending"), false);
  assert.ok(isTerminalContractStatus("completed"));
  assert.ok(isTerminalContractStatus("cancelled"));
  assert.equal(isTerminalContractStatus("disputed"), false);
  assert.equal(isTerminalContractStatus("accepted"), false);
}

// TEST H — contract parties distinct
{
  const ok = sampleContract("r-ok");
  assert.ok(hasDistinctParties(ok.demand_user_id, ok.provider_user_id));
  const same = sampleContract("r-bad", {
    demand_user_id: PROVIDER_APPLICANT,
    provider_user_id: PROVIDER_APPLICANT,
  });
  assert.equal(
    hasDistinctParties(same.demand_user_id, same.provider_user_id),
    false,
  );
}

// TEST I — one contract per request_id
{
  assert.ok(migration.includes("CONSTRAINT match_contracts_request_id_key UNIQUE"));
  const a = sampleContract("same-request");
  const b = sampleContract("same-request", {
    id: "66666666-6666-6666-6666-666666666666",
  });
  assert.equal(a.request_id, b.request_id);
  assert.notEqual(a.id, b.id);
}

// TEST J — one pending request per applicant+target
{
  assert.ok(
    migration.includes("match_requests_one_pending_per_applicant_target"),
  );
  assert.ok(
    /UNIQUE INDEX[\s\S]*\(target_post_id, applicant_user_id\)[\s\S]*WHERE status = 'pending'/i.test(
      migration,
    ),
  );
}

// TEST K — different applicants may apply to the same target
{
  const first = providerAppliesToDemand();
  const second = providerAppliesToDemand({
    id: "77777777-7777-7777-7777-777777777777",
    applicant_user_id: "88888888-8888-8888-8888-888888888888",
    client_request_id: "99999999-9999-9999-9999-999999999999",
  });
  assert.equal(first.target_post_id, second.target_post_id);
  assert.notEqual(first.applicant_user_id, second.applicant_user_id);
  assert.equal(
    /UNIQUE\s*\(\s*target_post_id\s*,\s*applicant_user_id\s*\)/.test(migration) &&
      !migration.includes("WHERE status = 'pending'"),
    false,
  );
}

// TEST L — Provider target has no one-application schema unique
{
  assert.equal(
    /UNIQUE\s*\(\s*target_post_id\s*\)/.test(migration),
    false,
  );
  assert.equal(
    /UNIQUE\s*\(\s*source_post_id\s*\)/.test(migration),
    false,
  );
  const c1 = sampleContract("r-1", { source_post_id: PROVIDER_POST, source_post_type: "provider" });
  const c2 = sampleContract("r-2", {
    id: "12121212-1212-1212-1212-121212121212",
    source_post_id: PROVIDER_POST,
    source_post_type: "provider",
    demand_user_id: DEMAND_APPLICANT,
  });
  assert.equal(c1.source_post_id, c2.source_post_id);
  assert.notEqual(c1.request_id, c2.request_id);
}

// TEST M — three snapshots are non-empty JSON objects
{
  const contract = sampleContract("r-snap");
  assert.ok(isObjectPayload(contract.demand_snapshot));
  assert.ok(isObjectPayload(contract.provider_snapshot));
  assert.ok(isObjectPayload(contract.agreement_snapshot));
  assert.ok(Object.keys(contract.demand_snapshot).length > 0);
  assert.ok(migration.includes("jsonb_typeof(demand_snapshot) = 'object'"));
  assert.ok(migration.includes("jsonb_typeof(provider_snapshot) = 'object'"));
  assert.ok(migration.includes("jsonb_typeof(agreement_snapshot) = 'object'"));
}

// TEST N — no plaintext pickup/delivery code columns
{
  assert.equal(/\bpickup_code\s+/i.test(migration), false);
  assert.equal(/\bdelivery_code\s+/i.test(migration), false);
  assert.equal("pickup_code" in sampleContract("r-n"), false);
  assert.equal("delivery_code" in sampleContract("r-n"), false);
}

// TEST O — RLS enabled
{
  assert.ok(
    migration.includes("ALTER TABLE public.match_requests ENABLE ROW LEVEL SECURITY"),
  );
  assert.ok(
    migration.includes(
      "ALTER TABLE public.match_contracts ENABLE ROW LEVEL SECURITY",
    ),
  );
}

// TEST P — four roles, all table privileges revoked
{
  for (const table of ["public.match_requests", "public.match_contracts"]) {
    for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
      assert.ok(
        migration.includes(`REVOKE ALL ON TABLE ${table} FROM ${role}`),
        `${table} ${role}`,
      );
    }
  }
  assert.equal(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i.test(migration), false);
}

// TEST Q — no browser policies
{
  assert.equal(/CREATE\s+POLICY/i.test(migration), false);
  assert.ok(verifySql.includes("EXPECT: 0 rows"));
}

// TEST R — no new SECURITY DEFINER function
{
  assert.equal(/SECURITY\s+DEFINER/i.test(migration), false);
  assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(migration), false);
}

// TEST S — no new trigger
{
  assert.equal(/CREATE\s+TRIGGER/i.test(migration), false);
  assert.equal(/CREATE\s+VIEW/i.test(migration), false);
}

// TEST T — legacy matches / confirm / cancel / reveal untouched
{
  assert.equal(/ALTER\s+TABLE\s+public\.matches\b/i.test(migration), false);
  assert.equal(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.confirm_match/i.test(migration), false);
  assert.equal(migration.includes("cancel_match_no_fault"), false);
  assert.equal(migration.includes("reveal_contact"), false);
  assert.equal(/DROP\s+FUNCTION/i.test(migration), false);
  assert.equal(/\bCASCADE\b/.test(migration), false);
  assert.equal(/^\s*DELETE\s+FROM/im.test(migration), false);
  assert.equal(/^\s*TRUNCATE\b/im.test(migration), false);
}

// TEST U — 20260908000003 and earlier migrations unmodified
{
  const names = readdirSync(join(repoRoot, "supabase/migrations"));
  assert.ok(
    names.includes("20260908000004_match_request_contract_foundation_v90.sql"),
  );
  assert.ok(
    names.includes(
      "20260908000004_match_request_contract_foundation_v90.verify.sql",
    ),
  );
  const earlier = execFileSync(
    "git",
    [
      "diff",
      "HEAD",
      "--",
      "supabase/migrations/20260908000003_freeze_legacy_direct_match_v89.sql",
      "supabase/migrations/20260908000003_freeze_legacy_direct_match_v89.verify.sql",
      "supabase/migrations/20260908000002_risk_audit_boundary_v88.sql",
      "supabase/migrations/20260908000001_account_display_name_and_phone_boundary.sql",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(earlier, "");
}

// TEST V — init.sql unmodified vs frozen baseline
{
  const diff = execFileSync(
    "git",
    ["diff", "0e2cb24", "--", "supabase/init.sql"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(diff, "");
}

// TEST W — 6.6B Fraud Signal Separation not reverted
{
  assert.ok(
    interceptSrc.includes("has_foreign_phone_in_window"),
  );
  assert.equal(interceptSrc.includes("is_phone_historically_reused"), false);
  assert.equal(
    processDemandPostIntercept({
      has_foreign_phone_in_window: true,
      own_in_window_count: 0,
    }).trackerScene,
    "multi_account_demand_spam",
  );
  assert.equal(
    processSupplyPostIntercept({
      active_supply_posts_count: 0,
      is_premium_member: false,
    }).allowed,
    true,
  );
  assert.equal(
    processDemandPostIntercept({
      has_foreign_phone_in_window: false,
      own_in_window_count: 0,
    }).allowed,
    true,
  );
}

// TEST X — 6.6B.1 hall credit freeze not reverted
{
  assert.equal(postCard.includes("CreditDashboard"), false);
  assert.equal(postCard.includes("creditStats"), false);
  assert.equal(homePage.includes("computeCreditStats"), false);
  assert.equal(homePage.includes("creditByUser"), false);
  assert.ok(homePage.includes('from("public_posts_safe")'));
  assert.ok(freezeSrc.includes("error.matching_temporarily_unavailable"));
}

// TEST Y — deferred cleanup ledger
{
  assert.ok(ledger.includes("CreditDashboard.tsx"));
  assert.ok(ledger.includes("credit-stats.ts"));
  assert.ok(ledger.includes("providerMatch.ts"));
  assert.ok(ledger.includes("evaluateFraudIntercept.ts"));
  assert.ok(ledger.includes("runFraudIntercept.ts"));
  assert.ok(ledger.includes("confirm_match"));
  assert.ok(ledger.includes("public.matches"));
  assert.ok(ledger.includes("completion_type"));
  assert.ok(ledger.includes("auto_melt_deadline"));
  assert.ok(ledger.includes("Future replacement"));
  assert.ok(ledger.includes("Earliest safe deletion") || ledger.includes("最早安全删除"));
  assert.ok(ledger.includes("Preconditions") || ledger.includes("前置条件"));
  assert.ok(ledger.includes("public_posts_safe"));
  assert.ok(ledger.includes("not") || ledger.includes("不是待删除"));
  assert.ok(ledger.includes("init.sql"));
}

assert.ok(verifySql.includes("has_table_privilege"));
assert.ok(verifySql.includes("relrowsecurity"));
assert.ok(verifySql.includes("NOT t.tgisinternal"));
assert.equal(verifySql.includes("SELECT * FROM public.match_requests"), false);
assert.equal(verifySql.includes("SELECT * FROM public.match_contracts"), false);

console.log("model.test.ts: ok");
