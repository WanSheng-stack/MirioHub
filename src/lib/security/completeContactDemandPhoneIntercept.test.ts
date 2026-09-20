/**
 * Complete-contact Demand phone fraud boundary.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/security/completeContactDemandPhoneIntercept.test.ts
 */

import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WindowInterceptMetrics } from "@/lib/security/fraudLookupRpc";
import { runCompleteContactDemandPhoneIntercept } from "@/lib/security/runFraudIntercept";
import type { FraudLogRow } from "@/lib/security/writeFraudAudit";

const admin = {} as SupabaseClient;
const input = {
  userId: "11111111-2222-3333-4444-555555555555",
  normalizedPhone: "381653228255",
  departureDate: "2026-09-22",
  departureWindow: "10:00-12:00",
};

function metrics(overrides: Partial<WindowInterceptMetrics> = {}): WindowInterceptMetrics {
  return {
    window_phone_account_count: 1,
    has_other_phone: false,
    has_other_plate: false,
    own_in_window_count: 0,
    own_cargo_in_window: 0,
    ...overrides,
  };
}

async function run(inputMetrics: WindowInterceptMetrics | null, auditResult = true) {
  const audits: FraudLogRow[] = [];
  const decision = await runCompleteContactDemandPhoneIntercept(admin, input, {
    gatherWindow: async (
      receivedAdmin,
      userId,
      phone,
      plate,
      date,
      window,
    ) => {
      assert.equal(receivedAdmin, admin);
      assert.deepEqual([userId, phone, plate, date, window], [
        input.userId,
        input.normalizedPhone,
        null,
        input.departureDate,
        input.departureWindow,
      ]);
      return inputMetrics;
    },
    writeAudit: async (receivedAdmin, row) => {
      assert.equal(receivedAdmin, admin);
      audits.push(row);
      return auditResult;
    },
  });
  return { decision, audits };
}

async function main() {
  const collision = await run(metrics({ has_other_phone: true }));
  assert.deepEqual(collision.decision, {
    allowed: false,
    errorKey: "error.post_denied_blurred",
  });
  assert.deepEqual(collision.audits, [
    {
      user_id: input.userId,
      scene: "multi_account_demand_spam",
      normalized_phone: input.normalizedPhone,
      normalized_license_plate: null,
      reporter_side: "demand",
    },
  ]);

  const selfOnly = await run(metrics({ own_in_window_count: 1 }));
  assert.equal(selfOnly.decision.allowed, true);
  assert.equal(selfOnly.decision.errorKey, "success.posted");
  assert.equal(selfOnly.audits.length, 0);

  const unavailable = await run(null);
  assert.deepEqual(unavailable.decision, {
    allowed: false,
    errorKey: "error.submit_failed",
  });
  assert.equal(unavailable.audits.length, 0);

  const auditFailed = await run(metrics({ has_other_phone: true }), false);
  assert.equal(auditFailed.decision.allowed, false);
  assert.equal(auditFailed.decision.errorKey, "error.post_denied_blurred");
  assert.equal(auditFailed.audits.length, 1);

  console.log("completeContactDemandPhoneIntercept.test.ts: ok");
}

void main();
