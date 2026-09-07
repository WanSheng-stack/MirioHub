/**
 * PHASE 6.5B.6 TEST 11 — Demand plate duplication must not become phone fraud.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/security/demandPhonePlateIsolation.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { processDemandPostIntercept, processSupplyPostIntercept } from "@/lib/post-intercept";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

// TEST 11 — phone duplicated = false, plate duplicated = true
{
  const decision = processDemandPostIntercept({
    is_phone_duplicated: false,
    account_count: 2,
    active_order_count: 0,
  });
  assert.equal(decision.allowed, true);
  assert.notEqual(decision.trackerScene, "multi_account_demand_spam");
}

{
  const withPhoneDup = processDemandPostIntercept({
    is_phone_duplicated: true,
    account_count: 2,
    active_order_count: 0,
  });
  assert.equal(withPhoneDup.allowed, false);
  assert.equal(withPhoneDup.trackerScene, "multi_account_demand_spam");
}

const demandBlock = read("src/lib/security/evaluateFraudIntercept.ts").slice(
  read("src/lib/security/evaluateFraudIntercept.ts").indexOf('if (input.postType === "demand")'),
  read("src/lib/security/evaluateFraudIntercept.ts").indexOf("const reuse = await rpcLookupForeignPhoneReuse"),
);
assert.ok(demandBlock.includes("window.has_other_phone || historyPhoneAccounts > 1"));
assert.equal(demandBlock.includes("plateAccounts > 1"), false);
assert.equal(demandBlock.includes("plateAccounts,"), false);

const supplySrc = read("src/lib/post-intercept.ts");
assert.ok(
  supplySrc.includes(
    "metrics.is_phone_historically_reused === true && metrics.last_post_time_delta_months <= 12",
  ),
);
assert.equal(
  processSupplyPostIntercept({
    is_phone_historically_reused: true,
    last_post_time_delta_months: 12,
    active_supply_posts_count: 0,
    is_premium_member: false,
  }).trackerScene,
  "phone_recycling_fraud_1year",
);

console.log("demandPhonePlateIsolation.test.ts: ok");
