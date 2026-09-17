/**
 * PHASE 6.7C.2C.3H.1 — preflight retry classification + frozen RPC error allowlist.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/v101ApiBoundaryHelpers.test.ts
 */

import assert from "node:assert/strict";
import {
  canSkipFreshAuthorityForShadow,
  classifyPublishAuthorityState,
  isExistingActiveIntentForOwner,
  isIdempotentActiveRetry,
  type PublishIntentRow,
} from "@/lib/auth/idempotentActiveRetry";
import { parseV101PublishRpcResult } from "@/lib/safety/parseV101PublishRpcResult";
import {
  V101_PUBLISH_RPC_ERROR_KEYS,
  isAllowedV101PublishRpcErrorKey,
} from "@/lib/safety/v101PublishRpcErrorKeys";

const base: PublishIntentRow = {
  id: "p1",
  user_id: "u1",
  payload_hash: "v101-authority-bound-hash-NOT-canonical",
  status: "active",
  origin_gps: "SRID=4326;POINT(20.4 44.8)",
  origin_country_code: "RS",
  origin_timezone: "Europe/Belgrade",
  night_policy_version: 1,
};

// ── isExistingActiveIntentForOwner: never compares payload_hash ─────────────
{
  assert.equal(isExistingActiveIntentForOwner(base, "u1"), true);
  // Different canonical hash must NOT matter at API preflight
  assert.equal(
    isExistingActiveIntentForOwner(
      { ...base, payload_hash: "totally-different" },
      "u1",
    ),
    true,
  );
  assert.equal(isExistingActiveIntentForOwner(base, "u2"), false);
  assert.equal(
    isExistingActiveIntentForOwner({ ...base, status: "draft" }, "u1"),
    false,
  );
  assert.equal(isExistingActiveIntentForOwner(null, "u1"), false);

  // Deprecated hash compare would reject v101 rows vs canonical Stage-1 hash
  assert.equal(
    isIdempotentActiveRetry(base, "u1", "canonical-stage1-hash"),
    false,
  );
}

// ── authority classification ────────────────────────────────────────────────
{
  assert.equal(classifyPublishAuthorityState(base), "complete");
  assert.equal(
    classifyPublishAuthorityState({
      ...base,
      night_policy_version: null,
    }),
    "complete",
  );
  assert.equal(
    classifyPublishAuthorityState({
      ...base,
      origin_gps: null,
      origin_country_code: null,
      origin_timezone: null,
      night_policy_version: null,
    }),
    "legacy",
  );
  assert.equal(
    classifyPublishAuthorityState({
      ...base,
      origin_timezone: null,
    }),
    "partial",
  );
  assert.equal(
    classifyPublishAuthorityState({
      ...base,
      origin_gps: null,
    }),
    "partial",
  );
  assert.equal(classifyPublishAuthorityState(null), "absent");
}

// ── shadow skip: complete only; legacy builds; partial closed; owner bound ─
{
  assert.equal(canSkipFreshAuthorityForShadow(base, "u1"), true);
  assert.equal(
    canSkipFreshAuthorityForShadow({ ...base, status: "draft" }, "u1"),
    true,
  );
  assert.equal(
    canSkipFreshAuthorityForShadow(
      {
        ...base,
        origin_gps: null,
        origin_country_code: null,
        origin_timezone: null,
        night_policy_version: null,
      },
      "u1",
    ),
    false,
    "legacy must still build fresh authority",
  );
  assert.equal(
    canSkipFreshAuthorityForShadow(
      { ...base, origin_country_code: null },
      "u1",
    ),
    false,
    "partial must fail closed (no bypass)",
  );
  assert.equal(canSkipFreshAuthorityForShadow(base, "u2"), false);
  assert.equal(
    canSkipFreshAuthorityForShadow({ ...base, status: "matched" }, "u1"),
    false,
  );
}

// ── frozen allowlist: every key preserved ───────────────────────────────────
{
  for (const key of V101_PUBLISH_RPC_ERROR_KEYS) {
    assert.equal(isAllowedV101PublishRpcErrorKey(key), true);
    const parsed = parseV101PublishRpcResult(
      { ok: false, error_msg: key },
      "error.submit_failed",
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.errorKey, key);
  }
}

// ── rejected arbitrary / malformed error.* ──────────────────────────────────
{
  const rejected = [
    "error.fake_internal",
    "error.submit_failed",
    "error.security_boundary_compromised\n",
    "error.security_boundary_compromised\0",
    " ERROR.security_boundary_compromised",
    "error.security_boundary_compromised ",
    "duplicate key",
    "",
    null,
    undefined,
    { ok: false },
  ];
  for (const err of rejected) {
    assert.equal(isAllowedV101PublishRpcErrorKey(err), false);
    const parsed = parseV101PublishRpcResult(
      { ok: false, error_msg: err },
      "error.submit_failed",
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.errorKey, "error.submit_failed");
  }
}

console.log("v101ApiBoundaryHelpers.test.ts: PASS");
