/**
 * PHASE 6.6B — current-window conflict vs historical asset reuse (TEST A–S).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/security/fraudSignalSeparation.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  processDemandPostIntercept,
  processProviderMatchIntercept,
  processSupplyPostIntercept,
} from "@/lib/post-intercept";
import type { WindowInterceptMetrics } from "@/lib/security/fraudLookupRpc";
import {
  isPureCargoDemand,
  runProviderMatchIntercept,
  runPublishIntercept,
  type MatchDemandRow,
  type ProviderMatchInterceptDeps,
} from "@/lib/security/runFraudIntercept";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const evaluateSrc = read("src/lib/security/evaluateFraudIntercept.ts");
const flowSrc = read("src/lib/security/runFraudIntercept.ts");
const interceptSrc = read("src/lib/post-intercept.ts");
const wrappersSrc = read("src/lib/security/fraudLookupRpc.ts");
const publishRoute = read(
  "src/app/api/posts/evaluate-publish-intercept/route.ts",
);
const matchRoute = read(
  "src/app/api/posts/evaluate-provider-match-intercept/route.ts",
);

const USER = "11111111-2222-3333-4444-555555555555";
const PHONE = "381653228255";
const PLATE = "BG123AB";
const dummyAdmin = {} as SupabaseClient;

const emptyWindow: WindowInterceptMetrics = {
  window_phone_account_count: 1,
  has_other_phone: false,
  has_other_plate: false,
  own_in_window_count: 0,
  own_cargo_in_window: 0,
};

const pureCargoDemand: MatchDemandRow = {
  category: "deliver",
  escort_seats: 0,
  max_companions: 0,
  count_small: 1,
  count_medium: 0,
  count_large: 0,
  count_xlarge: 0,
  departure_date: "2026-09-10",
  departure_time_window: "14:00-16:00",
};

function publishInput(postType: "demand" | "provider") {
  return {
    userId: USER,
    postType,
    normalizedPhone: PHONE,
    normalizedPlate: PLATE,
    departureDate: "2026-09-10",
    departureWindow: "14:00-16:00",
    isPremium: false,
  };
}

function matchInput() {
  return {
    userId: USER,
    demandPostId: "demand-1",
    providerNormalizedPhone: PHONE,
    providerNormalizedLicensePlate: PLATE,
    isBankVerified: false,
  };
}

function publishApiBody(decision: { allowed: boolean; errorKey: string }) {
  if (!decision.allowed) return { ok: false, errorKey: decision.errorKey };
  return { ok: true, errorKey: decision.errorKey };
}

function matchApiBody(decision: {
  allowed: boolean;
  errorKey: string;
  isSpaceWarning?: boolean;
}) {
  if (!decision.allowed) return { ok: false, errorKey: decision.errorKey };
  return {
    ok: true,
    errorKey: decision.errorKey,
    isSpaceWarning: Boolean(decision.isSpaceWarning),
  };
}

function assertBrowserSafe(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const token of [
    "phoneAccounts",
    "plateAccounts",
    "historicalReuse",
    "lastPostAt",
    "last_post_at",
    "has_other_phone",
    "has_other_plate",
    "own_in_window_count",
    "trackerScene",
    "auditOk",
    "auditWriteSucceeded",
    PHONE,
    PLATE,
    USER,
    "SQLSTATE",
    "42501",
  ]) {
    assert.equal(text.includes(token), false, `leaked ${token}`);
  }
}

async function main() {
  // TEST A — Demand current-window foreign phone
  {
    const decision = processDemandPostIntercept({
      has_foreign_phone_in_window: true,
      own_in_window_count: 0,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.messageKey, "error.post_denied_blurred");
    assert.equal(decision.logFraud, true);
    assert.equal(decision.trackerScene, "multi_account_demand_spam");

    let audits = 0;
    const result = await runPublishIntercept(dummyAdmin, publishInput("demand"), {
      gatherWindow: async () => ({ ...emptyWindow, has_other_phone: true }),
      countActiveSupplyPosts: async () => {
        throw new Error("supply counter must not run for demand");
      },
      writeAudit: async () => {
        audits += 1;
        return true;
      },
    });
    assert.equal(result.allowed, false);
    assert.equal(result.errorKey, "error.post_denied_blurred");
    assert.equal(audits, 1);
  }

  // TEST B — Demand historical reuse only: no history RPC, no fraud deny
  {
    const decision = processDemandPostIntercept({
      has_foreign_phone_in_window: false,
      own_in_window_count: 0,
    });
    assert.equal(decision.allowed, true);
    assert.notEqual(decision.trackerScene, "multi_account_demand_spam");

    let windowCalls = 0;
    let audits = 0;
    const result = await runPublishIntercept(dummyAdmin, publishInput("demand"), {
      gatherWindow: async () => {
        windowCalls += 1;
        return { ...emptyWindow, window_phone_account_count: 9 };
      },
      countActiveSupplyPosts: async () => {
        throw new Error("history/supply RPC must not run");
      },
      writeAudit: async () => {
        audits += 1;
        return true;
      },
    });
    assert.equal(windowCalls, 1);
    assert.equal(audits, 0);
    assert.equal(result.allowed, true);
    assert.equal(result.errorKey, "success.posted");
    assert.equal(flowSrc.includes("rpcCountAssetBoundAccounts"), false);
    assert.equal(evaluateSrc.includes("rpcCountAssetBoundAccounts"), false);
  }

  // TEST C — Demand own-window overlap
  {
    const decision = processDemandPostIntercept({
      has_foreign_phone_in_window: false,
      own_in_window_count: 1,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.messageKey, "error.time_window_overlap");
    assert.equal(decision.logFraud, false);
  }

  // TEST D — Demand no conflict
  {
    const decision = processDemandPostIntercept({
      has_foreign_phone_in_window: false,
      own_in_window_count: 0,
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.messageKey, "success.posted");
  }

  // TEST E — Supply historical phone reuse alone does not deny or audit
  {
    const decision = processSupplyPostIntercept({
      active_supply_posts_count: 0,
      is_premium_member: false,
    });
    assert.equal(decision.allowed, true);
    assert.notEqual(decision.trackerScene, "phone_recycling_fraud_1year");
    assert.equal(decision.logFraud, false);

    let audits = 0;
    let windowCalls = 0;
    const result = await runPublishIntercept(dummyAdmin, publishInput("provider"), {
      gatherWindow: async () => {
        windowCalls += 1;
        return emptyWindow;
      },
      countActiveSupplyPosts: async () => 0,
      writeAudit: async () => {
        audits += 1;
        return true;
      },
    });
    assert.equal(windowCalls, 0);
    assert.equal(audits, 0);
    assert.equal(result.allowed, true);
    assert.equal(flowSrc.includes("rpcLookupForeignPhoneReuse"), false);
    assert.equal(evaluateSrc.includes("rpcLookupForeignPhoneReuse"), false);
    assert.equal(flowSrc.includes("phone_recycling_fraud_1year"), false);
  }

  // TEST F — Supply historical plate reuse cannot become phone reuse / 0 months
  {
    assert.equal(interceptSrc.includes("is_phone_historically_reused"), false);
    assert.equal(flowSrc.includes("last_post_time_delta_months"), false);
    assert.equal(
      flowSrc.includes("phoneAccounts > 1 || plateAccounts > 1"),
      false,
    );
    assert.equal(evaluateSrc.includes("last_post_time_delta_months = 0"), false);
    const decision = processSupplyPostIntercept({
      active_supply_posts_count: 1,
      is_premium_member: false,
    });
    assert.equal(decision.allowed, true);
  }

  // TEST G — free Supply hits 3 active provider posts
  {
    const decision = processSupplyPostIntercept({
      active_supply_posts_count: 3,
      is_premium_member: false,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.messageKey, "error.non_member_limit_exceeded");
    assert.equal(decision.logFraud, false);
    const result = await runPublishIntercept(dummyAdmin, publishInput("provider"), {
      gatherWindow: async () => {
        throw new Error("window RPC must not run for supply");
      },
      countActiveSupplyPosts: async () => 3,
      writeAudit: async () => {
        throw new Error("supply limit must not write fraud_logs");
      },
    });
    assert.equal(result.errorKey, "error.non_member_limit_exceeded");
    assert.equal(result.allowed, false);
  }

  // TEST H — Premium is not denied by historical reuse; keeps 99999 cap
  {
    assert.equal(
      processSupplyPostIntercept({
        active_supply_posts_count: 3,
        is_premium_member: true,
      }).allowed,
      true,
    );
    assert.equal(
      processSupplyPostIntercept({
        active_supply_posts_count: 99999,
        is_premium_member: true,
      }).messageKey,
      "error.non_member_limit_exceeded",
    );
  }

  function matchDeps(
    overrides: Partial<ProviderMatchInterceptDeps> & {
      demand?: MatchDemandRow;
      window?: WindowInterceptMetrics;
    } = {},
  ): {
    deps: ProviderMatchInterceptDeps;
    calls: { window: number; audit: number; stacked: number };
  } {
    const calls = { window: 0, audit: 0, stacked: 0 };
    const demand = overrides.demand ?? pureCargoDemand;
    const window = overrides.window ?? emptyWindow;
    return {
      calls,
      deps: {
        loadDemandPost: overrides.loadDemandPost ?? (async () => demand),
        gatherWindow: overrides.gatherWindow ?? (async () => {
          calls.window += 1;
          return window;
        }),
        loadStackedMatchedPosts:
          overrides.loadStackedMatchedPosts ??
          (async () => {
            calls.stacked += 1;
            return [];
          }),
        writeAudit:
          overrides.writeAudit ??
          (async () => {
            calls.audit += 1;
            return true;
          }),
      },
    };
  }

  // TEST I — pure-cargo foreign phone window
  {
    const decision = processProviderMatchIntercept({
      has_foreign_phone_in_window: true,
      has_foreign_plate_in_window: false,
      own_cargo_in_window: 0,
      current_all_matched_units: 0,
      current_all_passengers_count: 0,
      is_bank_verified: false,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.messageKey, "error.match_denied_blurred");
    assert.equal(decision.logFraud, true);
    assert.equal(decision.trackerScene, "multi_account_spacetime_collision");

    const { deps, calls } = matchDeps({
      window: { ...emptyWindow, has_other_phone: true },
    });
    const result = await runProviderMatchIntercept(dummyAdmin, matchInput(), deps);
    assert.equal(result.allowed, false);
    assert.equal(result.errorKey, "error.match_denied_blurred");
    assert.equal(calls.window, 1);
    assert.equal(calls.audit, 1);
  }

  // TEST J — pure-cargo foreign plate window
  {
    const decision = processProviderMatchIntercept({
      has_foreign_phone_in_window: false,
      has_foreign_plate_in_window: true,
      own_cargo_in_window: 0,
      current_all_matched_units: 0,
      current_all_passengers_count: 0,
      is_bank_verified: false,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.logFraud, true);
    assert.notEqual(decision.trackerScene, "phone_recycling_fraud_1year");
    const { deps, calls } = matchDeps({
      window: { ...emptyWindow, has_other_plate: true },
    });
    const result = await runProviderMatchIntercept(dummyAdmin, matchInput(), deps);
    assert.equal(result.errorKey, "error.match_denied_blurred");
    assert.equal(calls.audit, 1);
  }

  // TEST K — pure-cargo historical reuse only
  {
    const decision = processProviderMatchIntercept({
      has_foreign_phone_in_window: false,
      has_foreign_plate_in_window: false,
      own_cargo_in_window: 0,
      current_all_matched_units: 0,
      current_all_passengers_count: 0,
      is_bank_verified: false,
    });
    assert.notEqual(decision.trackerScene, "multi_account_spacetime_collision");
    const { deps, calls } = matchDeps({
      window: { ...emptyWindow, window_phone_account_count: 8 },
    });
    const result = await runProviderMatchIntercept(dummyAdmin, matchInput(), deps);
    assert.equal(result.allowed, true);
    assert.equal(result.errorKey, "success.matched");
    assert.equal(calls.audit, 0);
    assert.equal(flowSrc.includes("rpcCountAssetBoundAccounts"), false);
  }

  // TEST L / S — non-pure-cargo never enters cargo-theft / fraud RPCs
  {
    assert.equal(isPureCargoDemand({ category: "travel", escort_seats: 0 }), false);
    assert.equal(
      isPureCargoDemand({ category: "deliver", escort_seats: 1 }),
      false,
    );
    assert.equal(
      isPureCargoDemand({ category: "deliver", escort_seats: 0 }),
      true,
    );

    for (const demand of [
      { ...pureCargoDemand, category: "travel" as const, escort_seats: 2 },
      { ...pureCargoDemand, category: "deliver" as const, escort_seats: 1 },
    ]) {
      const { deps, calls } = matchDeps({
        demand,
        window: { ...emptyWindow, has_other_phone: true, has_other_plate: true },
      });
      const result = await runProviderMatchIntercept(
        dummyAdmin,
        matchInput(),
        deps,
      );
      assert.equal(result.allowed, true);
      assert.equal(result.errorKey, "success.matched");
      assert.equal(calls.window, 0, "window RPC");
      assert.equal(calls.audit, 0, "audit");
      assert.equal(calls.stacked, 0, "stacked");
    }
  }

  // TEST M — unverified own cargo waterlevel, no foreign conflict
  {
    const decision = processProviderMatchIntercept({
      has_foreign_phone_in_window: false,
      has_foreign_plate_in_window: false,
      own_cargo_in_window: 1,
      current_all_matched_units: 0,
      current_all_passengers_count: 0,
      is_bank_verified: false,
    });
    assert.equal(decision.messageKey, "error.bank_verification_required");
    assert.equal(decision.logFraud, false);
    const { deps, calls } = matchDeps({
      window: { ...emptyWindow, own_cargo_in_window: 1 },
    });
    const result = await runProviderMatchIntercept(dummyAdmin, matchInput(), deps);
    assert.equal(result.errorKey, "error.bank_verification_required");
    assert.equal(calls.audit, 0);
  }

  // TEST N — verified own cargo waterlevel
  {
    const decision = processProviderMatchIntercept({
      has_foreign_phone_in_window: false,
      has_foreign_plate_in_window: false,
      own_cargo_in_window: 3,
      current_all_matched_units: 0,
      current_all_passengers_count: 0,
      is_bank_verified: true,
    });
    assert.equal(decision.messageKey, "error.active_cargo_limit_reached");
    assert.equal(decision.logFraud, false);
  }

  // TEST O — below waterlevel continues capacity / space warning
  {
    const ok = processProviderMatchIntercept({
      has_foreign_phone_in_window: false,
      has_foreign_plate_in_window: false,
      own_cargo_in_window: 0,
      current_all_matched_units: 10,
      current_all_passengers_count: 1,
      is_bank_verified: false,
    });
    assert.equal(ok.allowed, true);
    assert.equal(ok.isSpaceWarning, false);

    const warn = processProviderMatchIntercept({
      has_foreign_phone_in_window: false,
      has_foreign_plate_in_window: false,
      own_cargo_in_window: 0,
      current_all_matched_units: 25,
      current_all_passengers_count: 1,
      is_bank_verified: false,
    });
    assert.equal(warn.allowed, true);
    assert.equal(warn.isSpaceWarning, true);

    const seats = processProviderMatchIntercept({
      has_foreign_phone_in_window: false,
      has_foreign_plate_in_window: false,
      own_cargo_in_window: 0,
      current_all_matched_units: 0,
      current_all_passengers_count: 5,
      is_bank_verified: false,
    });
    assert.equal(seats.messageKey, "error.passenger_limit_exceeded");
    assert.equal(seats.logFraud, false);
    assert.ok(flowSrc.includes("currentStackedUnits + newUnits"));
    assert.ok(flowSrc.includes("is_bank_verified: input.isBankVerified"));
  }

  // TEST P — audit failure keeps original hard deny
  {
    const demand = await runPublishIntercept(dummyAdmin, publishInput("demand"), {
      gatherWindow: async () => ({ ...emptyWindow, has_other_phone: true }),
      countActiveSupplyPosts: async () => 0,
      writeAudit: async () => false,
    });
    assert.equal(demand.allowed, false);
    assert.equal(demand.errorKey, "error.post_denied_blurred");
    assert.notEqual(demand.errorKey, "error.submit_failed");
    assertBrowserSafe(publishApiBody(demand));

    const match = await runProviderMatchIntercept(dummyAdmin, matchInput(), {
      loadDemandPost: async () => pureCargoDemand,
      gatherWindow: async () => ({ ...emptyWindow, has_other_plate: true }),
      loadStackedMatchedPosts: async () => [],
      writeAudit: async () => false,
    });
    assert.equal(match.allowed, false);
    assert.equal(match.errorKey, "error.match_denied_blurred");
    assert.notEqual(match.errorKey, "error.submit_failed");
    assertBrowserSafe(matchApiBody(match));
  }

  // TEST Q — browser payload
  {
    const payload = publishApiBody({
      allowed: false,
      errorKey: "error.post_denied_blurred",
    });
    const matchPayload = matchApiBody({
      allowed: false,
      errorKey: "error.match_denied_blurred",
    });
    assert.deepEqual(Object.keys(payload).sort(), ["errorKey", "ok"]);
    assertBrowserSafe(payload);
    assertBrowserSafe(matchPayload);
    for (const src of [publishRoute, matchRoute]) {
      assert.equal(src.includes("phoneAccounts"), false);
      assert.equal(src.includes("plateAccounts"), false);
      assert.equal(src.includes("historicalReuse"), false);
      assert.equal(src.includes("lastPostAt"), false);
      assert.equal(src.includes("trackerScene"), false);
      assert.equal(src.includes("auditWriteSucceeded"), false);
    }
  }

  // TEST R — deleted live paths
  {
    assert.equal(flowSrc.includes("phoneAccounts > 1 || plateAccounts > 1"), false);
    assert.equal(evaluateSrc.includes("phoneAccounts > 1 || plateAccounts > 1"), false);
    assert.equal(flowSrc.includes("last_post_time_delta_months = 0"), false);
    assert.equal(evaluateSrc.includes("rpcCountAssetBoundAccounts"), false);
    assert.equal(flowSrc.includes("rpcCountAssetBoundAccounts"), false);
    assert.equal(evaluateSrc.includes("rpcLookupForeignPhoneReuse"), false);
    assert.equal(flowSrc.includes("rpcLookupForeignPhoneReuse"), false);
    assert.ok(wrappersSrc.includes("Historical signal retained for future composite risk policy"));
    assert.ok(wrappersSrc.includes("count_asset_bound_accounts_v86"));
    assert.ok(wrappersSrc.includes("lookup_foreign_phone_reuse_v86"));
  }

  // TEST S already covered in L via call counts. Re-assert isPureCargo before RPCs.
  {
    const loadOrder: string[] = [];
    const result = await runProviderMatchIntercept(dummyAdmin, matchInput(), {
      loadDemandPost: async () => {
        loadOrder.push("demand");
        return { ...pureCargoDemand, category: "travel", escort_seats: 2 };
      },
      gatherWindow: async () => {
        loadOrder.push("window");
        return emptyWindow;
      },
      loadStackedMatchedPosts: async () => {
        loadOrder.push("stacked");
        return [];
      },
      writeAudit: async () => {
        loadOrder.push("audit");
        return true;
      },
    });
    assert.deepEqual(loadOrder, ["demand"]);
    assert.equal(result.errorKey, "success.matched");
  }

  console.log("fraudSignalSeparation.test.ts: ok");
}

void main();
