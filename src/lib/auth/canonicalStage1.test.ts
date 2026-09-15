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
} from "@/lib/auth/canonicalStage1Core";
import { isIdempotentActiveRetry } from "@/lib/auth/idempotentActiveRetry";
import {
  processDemandPostIntercept,
  processSupplyPostIntercept,
} from "@/lib/post-intercept";
import { mapChallengeReserveReason } from "@/lib/auth/challengeReserveReason";

const baseRaw: Record<string, unknown> = {
  post_type: "demand",
  category: "travel",
  service_subtype: "passenger",
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
  max_companions: 1,
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
assert.equal(rpc.service_subtype, "passenger");
assert.equal(JSON.stringify(rpc), JSON.stringify(toRpcStage1Payload(ctxPayload, 1234)));

// ── service_subtype required for travel/deliver; null for buy ───────────────
assert.equal(normalizeCanonicalStage1(baseRaw).service_subtype, "passenger");
expectReject(
  () => normalizeCanonicalStage1({ ...baseRaw, service_subtype: null }),
  "error.invalid_service_subtype",
);
expectReject(
  () => normalizeCanonicalStage1({ ...baseRaw, service_subtype: "" }),
  "error.invalid_service_subtype",
);
expectReject(
  () => normalizeCanonicalStage1({ ...baseRaw, service_subtype: "cargo_only" }),
  "error.invalid_service_subtype",
);
expectReject(
  () =>
    normalizeCanonicalStage1({
      ...baseRaw,
      category: "buy",
      service_subtype: "passenger",
      origin_address: "X",
      destination_address: "X",
    }),
  "error.invalid_service_subtype",
);
assert.equal(
  normalizeCanonicalStage1({
    ...baseRaw,
    category: "buy",
    service_subtype: null,
    origin_address: "X",
    destination_address: "X",
  }).service_subtype,
  null,
);

const hashPassenger = hashCanonicalStage1(
  normalizeCanonicalStage1(baseRaw),
  40,
  500,
);
const hashSmall = hashCanonicalStage1(
  normalizeCanonicalStage1({ ...baseRaw, service_subtype: "small_item_only" }),
  40,
  500,
);
assert.notEqual(hashPassenger, hashSmall);

expectReject(
  () =>
    normalizeCanonicalStage1({
      ...baseRaw,
      origin_country_code: "RS",
    }),
  "error.browser_night_authority_rejected",
);
expectReject(
  () =>
    normalizeCanonicalStage1({
      ...baseRaw,
      post_type: "provider",
      transport_mode: null,
    }),
  "error.transport_mode_required",
);
expectReject(
  () =>
    normalizeCanonicalStage1({
      ...baseRaw,
      post_type: "provider",
      transport_mode: "motorbike",
      service_subtype: "passenger",
    }),
  "error.illegal_transport_combo",
);
assert.equal(
  normalizeCanonicalStage1({
    ...baseRaw,
    post_type: "provider",
    transport_mode: "car",
    service_subtype: "passenger",
  }).transport_mode,
  "car",
);

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
    has_foreign_phone_in_window: false,
    own_in_window_count: 0,
  }).allowed,
  true,
);
assert.equal(
  processDemandPostIntercept({
    has_foreign_phone_in_window: false,
    own_in_window_count: 1,
  }).messageKey,
  "error.time_window_overlap",
);
assert.equal(
  processSupplyPostIntercept({
    active_supply_posts_count: 3,
    is_premium_member: false,
  }).messageKey,
  "error.non_member_limit_exceeded",
);
assert.equal(
  processSupplyPostIntercept({
    active_supply_posts_count: 2,
    is_premium_member: false,
  }).allowed,
  true,
);

assert.equal(mapChallengeReserveReason("expired"), "error.device_verification_expired");
assert.equal(mapChallengeReserveReason("in_progress"), "error.device_verification_in_progress");
assert.equal(mapChallengeReserveReason("failed"), "error.device_verification_failed");
assert.equal(mapChallengeReserveReason("missing"), "error.device_verification_invalid");

console.log("PHASE 6 canonical/risk unit tests passed");
