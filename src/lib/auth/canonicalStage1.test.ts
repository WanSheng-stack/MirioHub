/**
 * PHASE 6 deterministic contract tests.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/auth/canonicalStage1.test.ts
 */

import assert from "node:assert/strict";
import {
  CanonicalStage1Error,
  computeServerFeeMinor,
  hashCanonicalStage1,
  normalizeCanonicalStage1,
  SERVER_MAX_BUMP_FEE_MINOR,
  toRpcStage1Payload,
  validateBumpFeeMinor,
} from "@/lib/auth/canonicalStage1";
import { isIdempotentActiveRetry } from "@/lib/auth/stage1ActiveRisk";
import {
  processDemandPostIntercept,
  processSupplyPostIntercept,
} from "@/lib/post-intercept";

const baseRaw: Record<string, unknown> = {
  post_type: "demand",
  category: "travel",
  title: "",
  origin_address: "Belgrade Center",
  destination_address: "Novi Sad",
  departure_date: "2026-09-10",
  departure_time: "14:30",
  time_buffer: 30,
  waypoints: ["WP1", "WP2"],
  share_mode: "share",
  delivery_mode: null,
  count_small: 1,
  count_medium: 0,
  count_large: 0,
  count_xlarge: 0,
  escort_seats: 1,
  bump_fee: 0,
  currency: "EUR",
  locale: "en",
};

function expectReject(fn: () => unknown, key: string) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof CanonicalStage1Error);
    assert.equal(err.errorKey, key);
    return true;
  });
}

// ── bump_fee ────────────────────────────────────────────────────────────────
assert.equal(validateBumpFeeMinor(0), 0);
assert.equal(validateBumpFeeMinor(250), 250);
expectReject(() => validateBumpFeeMinor(-1), "error.invalid_bump_fee_boundary");
expectReject(() => validateBumpFeeMinor(SERVER_MAX_BUMP_FEE_MINOR + 1), "error.invalid_bump_fee_boundary");
expectReject(() => validateBumpFeeMinor(Number.NaN), "error.invalid_bump_fee_boundary");
expectReject(() => validateBumpFeeMinor(Number.POSITIVE_INFINITY), "error.invalid_bump_fee_boundary");
expectReject(() => validateBumpFeeMinor(1.5), "error.invalid_bump_fee_boundary");

const withBump = normalizeCanonicalStage1({ ...baseRaw, bump_fee: 2.5 });
assert.equal(withBump.bump_fee_minor, 250);
const fee0 = computeServerFeeMinor(40, normalizeCanonicalStage1(baseRaw));
const feeBump = computeServerFeeMinor(40, withBump);
assert.equal(feeBump - fee0, 250);

const forged = normalizeCanonicalStage1({
  ...baseRaw,
  fee_amount: 9999,
  fee_amount_minor: 999900,
  estimated_fee: 12.34,
});
assert.equal(
  computeServerFeeMinor(40, forged),
  computeServerFeeMinor(40, normalizeCanonicalStage1(baseRaw)),
);

// ── reject silent clamp ─────────────────────────────────────────────────────
expectReject(
  () => normalizeCanonicalStage1({ ...baseRaw, count_small: -1 }),
  "error.invalid_payload_numeric_values",
);
expectReject(
  () => normalizeCanonicalStage1({ ...baseRaw, escort_seats: -1 }),
  "error.invalid_payload_numeric_values",
);

// ── waypoint order ──────────────────────────────────────────────────────────
const a = normalizeCanonicalStage1({ ...baseRaw, waypoints: ["WP1", "WP2"] });
const b = normalizeCanonicalStage1({ ...baseRaw, waypoints: ["WP2", "WP1"] });
assert.deepEqual(a.waypoints, ["WP1", "WP2"]);
assert.deepEqual(b.waypoints, ["WP2", "WP1"]);
const hashA = hashCanonicalStage1(a, 40, 500);
const hashB = hashCanonicalStage1(b, 40, 500);
assert.notEqual(hashA, hashB);

// ── three-path same builder output ──────────────────────────────────────────
const ctxPayload = normalizeCanonicalStage1(baseRaw);
const rpc = toRpcStage1Payload(ctxPayload, 1234);
assert.equal(rpc.departure_time, "14:30");
assert.equal(rpc.departure_time_window, "14:30-15:00");
assert.deepEqual(rpc.waypoints, ["WP1", "WP2"]);
assert.equal(rpc.locale, "en");
assert.equal(rpc.fee_amount_minor, 1234);
assert.equal(JSON.stringify(rpc), JSON.stringify(toRpcStage1Payload(ctxPayload, 1234)));

// ── idempotency ≠ spam ──────────────────────────────────────────────────────
const row = {
  id: "p1",
  user_id: "u1",
  payload_hash: "H1",
  status: "active",
};
assert.equal(isIdempotentActiveRetry(row, "u1", "H1"), true);
assert.equal(isIdempotentActiveRetry(row, "u1", "H2"), false);
assert.equal(isIdempotentActiveRetry({ ...row, status: "draft" }, "u1", "H1"), false);
assert.equal(isIdempotentActiveRetry(row, "u2", "H1"), false);
assert.equal(isIdempotentActiveRetry(null, "u1", "H1"), false);

// ── existing risk rules ─────────────────────────────────────────────────────
assert.equal(
  processDemandPostIntercept({
    is_phone_duplicated: false,
    account_count: 1,
    active_order_count: 0,
  }).allowed,
  true,
);
assert.equal(
  processDemandPostIntercept({
    is_phone_duplicated: false,
    account_count: 1,
    active_order_count: 1,
  }).messageKey,
  "error.time_window_overlap",
);
assert.equal(
  processSupplyPostIntercept({
    is_phone_historically_reused: false,
    last_post_time_delta_months: 999,
    active_supply_posts_count: 3,
    is_premium_member: false,
  }).messageKey,
  "error.non_member_limit_exceeded",
);
assert.equal(
  processSupplyPostIntercept({
    is_phone_historically_reused: false,
    last_post_time_delta_months: 999,
    active_supply_posts_count: 2,
    is_premium_member: false,
  }).allowed,
  true,
);

console.log("PHASE 6 canonical/risk unit tests passed");
