/**
 * PHASE 6.4S — source-level security boundary tests (TEST 1–9).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/security/securityBoundaryHardening.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORBIDDEN_PUBLIC_POST_COLUMNS,
  OWNER_POST_SELECT,
  PUBLIC_SAFE_POST_COLUMNS,
  PUBLIC_SAFE_POST_SELECT,
  publicSelectContainsForbidden,
} from "@/lib/posts/publicPostSelect";
import {
  parseForeignPhoneReuse,
  parseWindowInterceptMetrics,
} from "@/lib/security/fraudLookupRpc";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const migration = readFileSync(
  join(
    repoRoot,
    "supabase/migrations/20260907000001_security_boundary_hardening_v86.sql",
  ),
  "utf8",
);
const homePage = readFileSync(
  join(repoRoot, "src/app/[locale]/page.tsx"),
  "utf8",
);
const detailPage = readFileSync(
  join(repoRoot, "src/app/[locale]/posts/[id]/page.tsx"),
  "utf8",
);
const submitPost = readFileSync(
  join(repoRoot, "src/lib/post-form/submitPost.ts"),
  "utf8",
);
const providerMatch = readFileSync(
  join(repoRoot, "src/lib/post-form/providerMatch.ts"),
  "utf8",
);
const profilePage = readFileSync(
  join(repoRoot, "src/app/[locale]/profile/page.tsx"),
  "utf8",
);
const passkeyVerify = readFileSync(
  join(repoRoot, "src/app/api/auth/passkey/verify/route.ts"),
  "utf8",
);
const trustedPublish = readFileSync(
  join(repoRoot, "src/app/api/posts/trusted-publish/route.ts"),
  "utf8",
);

function assertNotRewritten(name: string) {
  assert.equal(
    migration.includes(`CREATE OR REPLACE FUNCTION public.${name}`),
    false,
    `migration must not rewrite ${name}`,
  );
}

// TEST 1 — User B cannot SELECT User A phone_history
assert.ok(migration.includes("DROP POLICY IF EXISTS phone_history_select_intercept"));
assert.equal(migration.includes("phone_history_select_intercept ON"), true);
assert.equal(/CREATE POLICY\s+phone_history_select_intercept/i.test(migration), false);
assert.equal(
  /USING\s*\(\s*true\s*\)/.test(
    migration.split("phone_history")[1]?.split("plate_history")[0] ?? migration,
  ) && migration.includes("CREATE POLICY") && migration.includes("phone_history_select_intercept ON public.phone_history\n  for select using (true)"),
  false,
);
assert.ok(
  !/CREATE POLICY[\s\S]{0,120}phone_history[\s\S]{0,80}USING\s*\(\s*true\s*\)/i.test(
    migration,
  ),
);

// TEST 2 — plate_history same
assert.ok(migration.includes("DROP POLICY IF EXISTS plate_history_select_intercept"));
assert.equal(/CREATE POLICY\s+plate_history_select_intercept/i.test(migration), false);
assert.ok(
  !/CREATE POLICY[\s\S]{0,120}plate_history[\s\S]{0,80}USING\s*\(\s*true\s*\)/i.test(
    migration,
  ),
);

// Fraud lookup must not fall back to client full-table SELECT
assert.ok(submitPost.includes("rpcCountAssetBoundAccounts"));
assert.ok(submitPost.includes("rpcGatherWindowInterceptMetrics"));
assert.ok(providerMatch.includes("rpcCountAssetBoundAccounts"));
assert.ok(providerMatch.includes("rpcGatherWindowInterceptMetrics"));
assert.equal(submitPost.includes('.from("phone_history")\n    .select("user_id")'), false);
assert.equal(providerMatch.includes('.from("phone_history")'), false);
assert.equal(providerMatch.includes('.from("plate_history")'), false);

// TEST 3 — User B submit_auto_melt(User A post) rejected
assert.ok(migration.includes("CREATE OR REPLACE FUNCTION public.submit_auto_melt"));
assert.ok(migration.includes("v_uid uuid := auth.uid()"));
assert.ok(migration.includes("WHERE id = p_post_id\n      AND user_id = v_uid"));
assert.ok(migration.includes("RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND')"));
assert.equal(migration.includes("post exists but not yours"), false);

// TEST 4 — User A own post: same UPDATE fence + success payload
assert.ok(migration.includes("RETURN jsonb_build_object('ok', true, 'deadline', v_deadline)"));
assert.ok(migration.includes("GRANT EXECUTE ON FUNCTION public.submit_auto_melt(uuid, text, text) TO authenticated"));

// TEST 5 — authenticated cannot mutate risk_scores
assert.ok(migration.includes('DROP POLICY IF EXISTS "System can fully manage risk scores"'));
assert.ok(migration.includes("REVOKE ALL ON TABLE public.risk_scores FROM authenticated"));
assert.ok(migration.includes("REVOKE ALL ON TABLE public.risk_scores FROM anon"));
assert.equal(
  /CREATE POLICY[\s\S]{0,80}risk_scores[\s\S]{0,80}USING\s*\(\s*true\s*\)/i.test(migration),
  false,
);

// TEST 6 — public active post query cannot obtain phones
assert.ok(migration.includes("CREATE VIEW public.public_posts_safe"));
assert.ok(migration.includes("security_invoker = false"));
for (const col of [
  "raw_phone",
  "normalized_phone",
  "phone_id",
  "contact_email",
  "plate_id",
] as const) {
  assert.equal(
    PUBLIC_SAFE_POST_COLUMNS.includes(col as (typeof PUBLIC_SAFE_POST_COLUMNS)[number]),
    false,
    col,
  );
}
assert.equal(publicSelectContainsForbidden(PUBLIC_SAFE_POST_SELECT), false);
assert.ok(homePage.includes('from("public_posts_safe")'));
assert.ok(homePage.includes("PUBLIC_SAFE_POST_SELECT"));
assert.ok(detailPage.includes('from("public_posts_safe")'));
assert.ok(detailPage.includes("PUBLIC_SAFE_POST_SELECT"));

const viewBlock = migration.slice(
  migration.indexOf("CREATE VIEW public.public_posts_safe"),
  migration.indexOf("REVOKE ALL ON public.public_posts_safe"),
);
for (const col of FORBIDDEN_PUBLIC_POST_COLUMNS) {
  assert.equal(
    new RegExp(`\\b${col}\\b`).test(viewBlock),
    false,
    `view must not project ${col}`,
  );
}

// TEST 7 — owner full-post path remains
assert.ok(detailPage.includes("OWNER_POST_SELECT"));
assert.ok(detailPage.includes('from("posts")'));
assert.ok(homePage.includes("OWNER_POST_SELECT"));
assert.ok(OWNER_POST_SELECT.includes("raw_phone"));
assert.ok(OWNER_POST_SELECT.includes("normalized_phone"));

// TEST 8 — fresh anonymous-account custom device verification not rewritten
assertNotRewritten("reserve_challenge_with_lease_v86");
assertNotRewritten("mark_challenge_failed_v86");
assertNotRewritten("classify_challenge_reserve_failure_v86");
assert.ok(passkeyVerify.includes("reserve_challenge_with_lease_v86"));

// TEST 9 — trusted publish not rewritten
assertNotRewritten("publish_active_post_idempotent_v86");
assert.ok(trustedPublish.includes("publish_active_post_idempotent_v86"));

// Extra contracts
assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.insert_stage1_post_v86"));
assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC"));
assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon"));
assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated"));
assert.ok(migration.includes("SET search_path = public, pg_temp"));
assert.equal(
  /\b(ALTER|DROP|TRUNCATE|REVOKE)\b[\s\S]{0,60}spatial_ref_sys/i.test(migration),
  false,
);
assert.equal(migration.includes("reveal_contact"), false);
assert.equal(migration.includes("confirm_match"), false);
assert.equal(migration.includes("contact_unlocks"), false);
assert.ok(migration.includes("DROP POLICY IF EXISTS posts_select_active_or_own"));
assert.ok(migration.includes("CREATE POLICY posts_select_own"));

// update_my_profile fill-if-empty keeps existing fields
assert.ok(profilePage.includes("p_phone: current.phone"));
assert.ok(profilePage.includes("p_plate: current.plate"));
assert.ok(profilePage.includes("p_vehicle: current.vehicle"));
assert.ok(profilePage.includes("p_facebook: current.facebook"));
assert.ok(profilePage.includes("p_viber: current.viber"));

const window = parseWindowInterceptMetrics({
  window_phone_account_count: 2,
  has_other_phone: true,
  has_other_plate: false,
  own_in_window_count: 1,
  own_cargo_in_window: 0,
});
assert.deepEqual(window, {
  window_phone_account_count: 2,
  has_other_phone: true,
  has_other_plate: false,
  own_in_window_count: 1,
  own_cargo_in_window: 0,
});
assert.equal(parseWindowInterceptMetrics(null), null);
assert.deepEqual(parseForeignPhoneReuse({ reused: true, last_post_at: "2026-01-01" }), {
  reused: true,
  last_post_at: "2026-01-01",
});

console.log("securityBoundaryHardening.test.ts: ok");
