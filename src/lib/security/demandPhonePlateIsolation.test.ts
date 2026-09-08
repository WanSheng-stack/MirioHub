/**
 * Demand plate history must not become phone fraud.
 * Historical phone reuse is not a standalone Demand hard-deny.
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

{
  const decision = processDemandPostIntercept({
    has_foreign_phone_in_window: false,
    own_in_window_count: 0,
  });
  assert.equal(decision.allowed, true);
  assert.notEqual(decision.trackerScene, "multi_account_demand_spam");
}

{
  const withPhoneDup = processDemandPostIntercept({
    has_foreign_phone_in_window: true,
    own_in_window_count: 0,
  });
  assert.equal(withPhoneDup.allowed, false);
  assert.equal(withPhoneDup.trackerScene, "multi_account_demand_spam");
}

const demandFlow = read("src/lib/security/runFraudIntercept.ts");
assert.ok(demandFlow.includes("has_foreign_phone_in_window: window.has_other_phone"));
assert.equal(demandFlow.includes("has_other_plate"), true);
assert.equal(
  demandFlow.includes("has_foreign_phone_in_window: window.has_other_plate"),
  false,
);
assert.equal(demandFlow.includes("rpcCountAssetBoundAccounts"), false);
assert.equal(demandFlow.includes("historyPhoneAccounts"), false);
assert.equal(demandFlow.includes("plateAccounts"), false);

const intercept = read("src/lib/post-intercept.ts");
assert.equal(intercept.includes("is_phone_historically_reused"), false);
assert.equal(
  processSupplyPostIntercept({
    active_supply_posts_count: 0,
    is_premium_member: false,
  }).trackerScene,
  undefined,
);
assert.equal(intercept.includes("phone_recycling_fraud_1year"), false);

console.log("demandPhonePlateIsolation.test.ts: ok");
