/**
 * PHASE 6.4S.2 — service-role fraud RPC user context.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/security/fraudRpcUserContext.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const migration = readFileSync(
  join(
    repoRoot,
    "supabase/migrations/20260907000001_security_boundary_hardening_v86.sql",
  ),
  "utf8",
);
const wrappers = readFileSync(join(here, "fraudLookupRpc.ts"), "utf8");
const evaluate = readFileSync(join(here, "evaluateFraudIntercept.ts"), "utf8");
const flow = readFileSync(join(here, "runFraudIntercept.ts"), "utf8");
const publishRoute = readFileSync(
  join(repoRoot, "src/app/api/posts/evaluate-publish-intercept/route.ts"),
  "utf8",
);
const matchRoute = readFileSync(
  join(repoRoot, "src/app/api/posts/evaluate-provider-match-intercept/route.ts"),
  "utf8",
);

function functionBody(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, name);
  const end = migration.indexOf("$$;", start);
  assert.ok(end > start, `${name} end`);
  return migration.slice(start, end);
}

const countBody = functionBody("count_asset_bound_accounts_v86");
const lookupBody = functionBody("lookup_foreign_phone_reuse_v86");
const windowBody = functionBody("gather_window_intercept_metrics_v86");

// TEST A — lookup uses explicit UUID-A (p_user_id), not auth.uid()
assert.ok(lookupBody.includes("p_user_id uuid"));
assert.equal(lookupBody.includes("auth.uid()"), false);
assert.ok(wrappers.includes("p_user_id: userId"));
assert.equal(evaluate.includes("rpcLookupForeignPhoneReuse"), false);
assert.equal(flow.includes("rpcLookupForeignPhoneReuse"), false);
assert.ok(
  flow.includes("deps.gatherWindow(\n      admin,\n      input.userId,"),
);
assert.ok(
  flow.includes("deps.gatherWindow(\n    admin,\n    input.userId,"),
);

// TEST B — window own_* counts use p_user_id
assert.ok(windowBody.includes("COUNT(*) FILTER (WHERE p.user_id = p_user_id)"));
assert.equal(windowBody.includes("auth.uid()"), false);
assert.equal(windowBody.includes("v_uid"), false);
assert.ok(
  evaluate.includes("gatherWindow: rpcGatherWindowInterceptMetrics"),
);
assert.equal(evaluate.includes("rpcCountAssetBoundAccounts"), false);
assert.equal(flow.includes("rpcCountAssetBoundAccounts"), false);

// TEST C — other-user rows use IS DISTINCT FROM p_user_id
assert.ok(lookupBody.includes("h.user_id IS DISTINCT FROM p_user_id"));
assert.ok(windowBody.includes("p.user_id IS DISTINCT FROM p_user_id"));
assert.equal(lookupBody.includes("IS DISTINCT FROM v_uid"), false);
assert.equal(windowBody.includes("IS DISTINCT FROM v_uid"), false);

// TEST D — null p_user_id rejected
assert.ok(lookupBody.includes("IF p_user_id IS NULL THEN"));
assert.ok(lookupBody.includes("RAISE EXCEPTION 'INVALID_USER_CONTEXT'"));
assert.ok(windowBody.includes("IF p_user_id IS NULL THEN"));
assert.ok(windowBody.includes("RAISE EXCEPTION 'INVALID_USER_CONTEXT'"));

// count_asset has no user context / auth.uid
assert.equal(countBody.includes("auth.uid()"), false);
assert.equal(countBody.includes("p_user_id"), false);

// TEST E — browser/authenticated still no EXECUTE; only new signatures
assert.equal(
  migration.includes("GRANT EXECUTE ON FUNCTION public.lookup_foreign_phone_reuse_v86(text) TO"),
  false,
);
assert.equal(
  migration.includes(
    "GRANT EXECUTE ON FUNCTION public.gather_window_intercept_metrics_v86(text, text, date, text) TO",
  ),
  false,
);
assert.ok(
  migration.includes(
    "REVOKE ALL ON FUNCTION public.lookup_foreign_phone_reuse_v86(uuid, text) FROM authenticated",
  ),
);
assert.ok(
  migration.includes(
    "REVOKE ALL ON FUNCTION public.gather_window_intercept_metrics_v86(uuid, text, text, date, text) FROM authenticated",
  ),
);
assert.ok(
  migration.includes(
    "GRANT EXECUTE ON FUNCTION public.count_asset_bound_accounts_v86(text, text) TO service_role",
  ),
);

// TEST F — API still only ok / errorKey / isSpaceWarning
for (const src of [publishRoute, matchRoute]) {
  assert.equal(src.includes("account_count"), false);
  assert.equal(src.includes("last_post_at"), false);
  assert.equal(src.includes("has_other_phone"), false);
  assert.equal(src.includes("has_other_plate"), false);
  assert.equal(src.includes("reused"), false);
}
assert.ok(publishRoute.includes("ok: true"));
assert.ok(publishRoute.includes("errorKey"));
assert.equal(matchRoute.includes("evaluateProviderMatchFraud"), false);
assert.ok(matchRoute.includes("freezeLegacyDirectMatchIntercept"));

console.log("fraudRpcUserContext.test.ts: ok");
