/**
 * PHASE 6.7C.2C.3I-B.1 — v102A/B posts write boundary structure + pure logic.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/postsWriteBoundaryV102.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyAuthorityStateForContact,
  decideCompleteContactTransportV102,
  transportComboErrorKey,
} from "@/lib/posts/completeContactTransportV102";
import { parseV102PostsWriteRpcResult } from "@/lib/posts/parseV102PostsWriteRpcResult";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const V102A = "supabase/migrations/20260919000001_posts_write_boundary_v102a.sql";
const V102A_V =
  "supabase/migrations/20260919000001_posts_write_boundary_v102a.verify.sql";
const V102B = "supabase/migrations/20260919000002_posts_write_boundary_v102b.sql";
const V102B_V =
  "supabase/migrations/20260919000002_posts_write_boundary_v102b.verify.sql";
const CONTACT = "src/app/api/posts/complete-contact/route.ts";
const ACTIVATE = "src/app/api/posts/activate-after-identity/route.ts";

const a = read(V102A);
const b = read(V102B);
const av = read(V102A_V);
const bv = read(V102B_V);

// ── A creates RPCs; B seals; no CREATE TABLE/TRIGGER/SEQUENCE in either ─────
{
  assert.ok(a.includes("complete_post_contact_v102"));
  assert.ok(a.includes("activate_post_after_identity_v102"));
  assert.ok(a.includes("_posts_is_account_eligible_v102"));
  assert.ok(a.includes("_posts_validate_authority_complete_v102"));
  assert.equal(a.includes("DROP POLICY"), false);
  assert.equal(/REVOKE\s+INSERT,\s*UPDATE,\s*DELETE/i.test(a), false);
  assert.equal(a.includes("publish_active_post_idempotent_v98"), true); // guard only
  assert.equal(/REVOKE ALL ON FUNCTION public\.publish_active_post_idempotent_v98/i.test(a), false);

  assert.ok(b.includes("DROP POLICY IF EXISTS posts_update_own"));
  assert.ok(b.includes("DROP POLICY IF EXISTS posts_insert_own"));
  assert.ok(b.includes("DROP POLICY IF EXISTS posts_delete_own"));
  assert.ok(b.includes("REVOKE INSERT, UPDATE, DELETE ON TABLE public.posts FROM authenticated"));
  assert.ok(/REVOKE ALL ON FUNCTION public\.publish_active_post_idempotent_v98/i.test(b));
  assert.equal(b.includes("CREATE FUNCTION"), false);

  for (const src of [a, b]) {
    assert.equal(/CREATE\s+TABLE/i.test(src), false);
    assert.equal(/CREATE\s+SEQUENCE/i.test(src), false);
    assert.equal(/CREATE\s+TRIGGER/i.test(src), false);
    assert.equal(/CREATE\s+FUNCTION\s+public\.\w*v103/i.test(src), false);
  }

  assert.ok(av.includes("write policies still present"));
  assert.ok(av.includes("authenticated DML still present; anon DML absent"));
  assert.ok(a.includes("anon must not have posts DML"));
  assert.ok(a.includes("authenticated DML must still exist before v102A"));
  assert.ok(a.includes("destination_gps type drift"));
  assert.ok(av.includes("origin_gps + destination_gps extensions.geography"));
  assert.ok(av.includes("authenticated INSERT+UPDATE+DELETE; anon none"));
  assert.ok(bv.includes("write policies dropped"));
  assert.ok(bv.includes("v98 writers fully revoked"));
  assert.ok(av.includes("CASE WHEN bool_and(result = 'PASS') OVER () THEN 'PASS' ELSE 'FAIL' END"));
  assert.ok(bv.includes("CASE WHEN bool_and(result = 'PASS') OVER () THEN 'PASS' ELSE 'FAIL' END"));
  assert.ok(a.includes("Shape only"));
  assert.ok(a.includes("Frozen legacy-null-subtype"));
  assert.ok(a.includes("pg_timezone_names"));
  assert.ok(a.includes("phone_history"));
  assert.ok(a.includes("passenger_with_small_item"));
}

// ── authority / transport pure logic ────────────────────────────────────────
{
  assert.equal(
    classifyAuthorityStateForContact({
      origin_gps: "x",
      origin_country_code: "RS",
      origin_timezone: "Europe/Belgrade",
      night_policy_version: null,
    }),
    "complete",
  );
  assert.equal(
    classifyAuthorityStateForContact({
      origin_gps: null,
      origin_country_code: null,
      origin_timezone: null,
      night_policy_version: null,
    }),
    "legacy",
  );
  assert.equal(
    classifyAuthorityStateForContact({
      origin_gps: "x",
      origin_country_code: null,
      origin_timezone: "Europe/Belgrade",
      night_policy_version: null,
    }),
    "partial",
  );

  // passenger → car only
  assert.equal(
    transportComboErrorKey({
      category: "travel",
      serviceSubtype: "passenger",
      mode: "bus",
    }),
    "error.illegal_transport_combo",
  );
  assert.equal(
    transportComboErrorKey({
      category: "travel",
      serviceSubtype: "passenger",
      mode: "car",
    }),
    null,
  );
  // small_item_only full travel
  assert.equal(
    transportComboErrorKey({
      category: "travel",
      serviceSubtype: "small_item_only",
      mode: "bicycle",
    }),
    null,
  );
  // cargo_with_escort no boats
  assert.equal(
    transportComboErrorKey({
      category: "deliver",
      serviceSubtype: "cargo_with_escort",
      mode: "cargo_boat",
    }),
    "error.illegal_transport_combo",
  );
  assert.equal(
    transportComboErrorKey({
      category: "deliver",
      serviceSubtype: "cargo_with_escort",
      mode: "cargo_van",
    }),
    null,
  );
  // legacy null subtype full deliver
  assert.equal(
    transportComboErrorKey({
      category: "deliver",
      serviceSubtype: null,
      mode: "cargo_boat",
    }),
    null,
  );
  // buy reject
  assert.equal(
    transportComboErrorKey({
      category: "buy",
      serviceSubtype: null,
      mode: "car",
    }),
    "error.invalid_transport_mode",
  );

  assert.deepEqual(
    decideCompleteContactTransportV102({
      isOwner: true,
      category: "travel",
      serviceSubtype: "passenger",
      authorityState: "legacy",
      existingMode: null,
      requested: "car",
    }),
    { kind: "fill", mode: "car" },
  );
  assert.equal(
    decideCompleteContactTransportV102({
      isOwner: true,
      category: "travel",
      serviceSubtype: "passenger",
      authorityState: "complete",
      existingMode: "car",
      requested: "bus",
    }).kind,
    "reject",
  );
  assert.equal(
    decideCompleteContactTransportV102({
      isOwner: true,
      category: "travel",
      serviceSubtype: "passenger",
      authorityState: "complete",
      existingMode: "car",
      requested: "car",
    }).kind,
    "omit",
  );
  assert.equal(
    decideCompleteContactTransportV102({
      isOwner: true,
      category: "travel",
      serviceSubtype: null,
      authorityState: "legacy",
      existingMode: null,
      requested: "van",
    }).kind,
    "reject",
  );
}

// ── parse allowlist ─────────────────────────────────────────────────────────
{
  const ok = parseV102PostsWriteRpcResult(
    {
      ok: true,
      post_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      is_active: true,
      already_active: false,
      activated: true,
    },
    "error.submit_failed",
  );
  assert.equal(ok.ok, true);
  const combo = parseV102PostsWriteRpcResult(
    { ok: false, error_msg: "error.illegal_transport_combo" },
    "error.submit_failed",
  );
  assert.equal(combo.ok, false);
  if (!combo.ok) assert.equal(combo.errorKey, "error.illegal_transport_combo");
  const fake = parseV102PostsWriteRpcResult(
    { ok: false, error_msg: "error.fake_internal" },
    "error.submit_failed",
  );
  assert.equal(fake.ok, false);
  if (!fake.ok) assert.equal(fake.errorKey, "error.submit_failed");
}

// ── routes ──────────────────────────────────────────────────────────────────
{
  const contact = read(CONTACT);
  const activate = read(ACTIVATE);
  assert.ok(contact.includes("complete_post_contact_v102"));
  assert.ok(activate.includes("activate_post_after_identity_v102"));
  assert.ok(contact.includes("service_subtype"));
  assert.ok(contact.includes("auth.getUser()"));
  assert.ok(activate.includes("auth.getUser()"));
  assert.equal(/\.from\(\s*['"]posts['"]\s*\)\s*\.update/i.test(contact), false);
  assert.equal(/\.from\(\s*['"]posts['"]\s*\)\s*\.insert/i.test(contact), false);
  assert.equal(/\.from\(\s*['"]posts['"]\s*\)\s*\.delete/i.test(contact), false);
  assert.equal(/\.from\(\s*['"]posts['"]\s*\)\s*\.update/i.test(activate), false);
  assert.equal(contact.includes("geocodeAddress(post.origin_address)"), false);
  assert.equal(contact.includes("p_origin_gps"), false);
  assert.equal(contact.includes("p_locale"), false);
}

// ── production DML / writers ────────────────────────────────────────────────
{
  const appFiles = readdirSync(join(repoRoot, "src/app"), {
    recursive: true,
  }) as string[];
  let v98Calls = 0;
  let v101Calls = 0;
  for (const f of appFiles) {
    if (!f.endsWith(".ts") && !f.endsWith(".tsx")) continue;
    const src = read(join("src/app", f));
    assert.equal(
      /\.from\(\s*['"]posts['"]\s*\)\s*\.(insert|update|delete)/i.test(src),
      false,
      `posts DML in ${f}`,
    );
    if (/admin\.rpc\(\s*['"]publish_active_post_idempotent_v98/.test(src)) v98Calls += 1;
    if (/admin\.rpc\(\s*['"]create_shadow_draft_idempotent_v98/.test(src)) v98Calls += 1;
    if (/admin\.rpc\(\s*['"]commit_phase3_business_idempotent_v98/.test(src)) v98Calls += 1;
    if (src.includes("publish_active_post_idempotent_v101")) v101Calls += 1;
    if (src.includes("create_shadow_draft_idempotent_v101")) v101Calls += 1;
    if (src.includes("commit_phase3_business_idempotent_v101")) v101Calls += 1;
  }
  assert.equal(v98Calls, 0);
  assert.ok(v101Calls >= 3);

  const migs = readdirSync(join(repoRoot, "supabase/migrations"));
  assert.ok(migs.includes("20260919000001_posts_write_boundary_v102a.sql"));
  assert.ok(migs.includes("20260919000002_posts_write_boundary_v102b.sql"));
  assert.equal(migs.some((n) => /v103/.test(n)), false);
  assert.equal(
    migs.includes("20260919000001_posts_write_boundary_v102.sql"),
    false,
  );
  assert.ok(read("supabase/posts_init.sql").includes("posts_update_own"));
  assert.ok(read("docs/architecture/deferred-cleanup.md").includes("v102A"));
}

console.log("postsWriteBoundaryV102.test.ts: PASS");
