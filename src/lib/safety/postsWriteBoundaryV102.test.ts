/**
 * PHASE 6.7C.2C.3I-B — posts write boundary v102 structure + pure logic tests.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/postsWriteBoundaryV102.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyAuthorityStateForContact,
  decideCompleteContactTransportV102,
  COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY,
} from "@/lib/posts/completeContactTransportV102";
import { parseV102PostsWriteRpcResult } from "@/lib/posts/parseV102PostsWriteRpcResult";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const MIG = "supabase/migrations/20260919000001_posts_write_boundary_v102.sql";
const VERIFY =
  "supabase/migrations/20260919000001_posts_write_boundary_v102.verify.sql";
const CONTACT = "src/app/api/posts/complete-contact/route.ts";
const ACTIVATE = "src/app/api/posts/activate-after-identity/route.ts";

const completeAuth = {
  origin_gps: "SRID=4326;POINT(20 44)",
  origin_country_code: "RS",
  origin_timezone: "Europe/Belgrade",
  night_policy_version: 1 as number | null,
};
const legacyAuth = {
  origin_gps: null,
  origin_country_code: null,
  origin_timezone: null,
  night_policy_version: null,
};
const partialAuth = {
  origin_gps: "SRID=4326;POINT(20 44)",
  origin_country_code: null,
  origin_timezone: "Europe/Belgrade",
  night_policy_version: null,
};

// ── authority classification ────────────────────────────────────────────────
assert.equal(classifyAuthorityStateForContact(completeAuth), "complete");
assert.equal(
  classifyAuthorityStateForContact({
    ...completeAuth,
    night_policy_version: null,
  }),
  "complete",
);
assert.equal(classifyAuthorityStateForContact(legacyAuth), "legacy");
assert.equal(classifyAuthorityStateForContact(partialAuth), "partial");

// ── transport decisions ─────────────────────────────────────────────────────
{
  // complete: forbid fill / change; same = omit
  assert.equal(
    decideCompleteContactTransportV102({
      isOwner: true,
      category: "travel",
      authorityState: "complete",
      existingMode: "car",
      requested: undefined,
    }).kind,
    "omit",
  );
  assert.equal(
    decideCompleteContactTransportV102({
      isOwner: true,
      category: "travel",
      authorityState: "complete",
      existingMode: "car",
      requested: "car",
    }).kind,
    "omit",
  );
  assert.deepEqual(
    decideCompleteContactTransportV102({
      isOwner: true,
      category: "travel",
      authorityState: "complete",
      existingMode: "car",
      requested: "bus",
    }),
    { kind: "reject", errorKey: COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY },
  );
  assert.deepEqual(
    decideCompleteContactTransportV102({
      isOwner: true,
      category: "travel",
      authorityState: "complete",
      existingMode: null,
      requested: "car",
    }),
    { kind: "reject", errorKey: COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY },
  );

  // legacy fill once
  assert.deepEqual(
    decideCompleteContactTransportV102({
      isOwner: true,
      category: "travel",
      authorityState: "legacy",
      existingMode: null,
      requested: "car",
    }),
    { kind: "fill", mode: "car" },
  );
  assert.deepEqual(
    decideCompleteContactTransportV102({
      isOwner: true,
      category: "deliver",
      authorityState: "legacy",
      existingMode: null,
      requested: "cargo_van",
    }),
    { kind: "fill", mode: "cargo_van" },
  );
  assert.equal(
    decideCompleteContactTransportV102({
      isOwner: true,
      category: "travel",
      authorityState: "legacy",
      existingMode: "car",
      requested: "car",
    }).kind,
    "omit",
  );

  // illegal / cross-lane / van / blank / buy
  for (const requested of ["van", "", "cargo_van", "unknown"]) {
    const d = decideCompleteContactTransportV102({
      isOwner: true,
      category: "travel",
      authorityState: "legacy",
      existingMode: null,
      requested,
    });
    assert.equal(d.kind, "reject", `travel reject ${requested}`);
  }
  assert.equal(
    decideCompleteContactTransportV102({
      isOwner: true,
      category: "buy",
      authorityState: "legacy",
      existingMode: null,
      requested: "car",
    }).kind,
    "reject",
  );
  assert.equal(
    decideCompleteContactTransportV102({
      isOwner: true,
      category: "travel",
      authorityState: "partial",
      existingMode: null,
      requested: "car",
    }).kind,
    "reject",
  );
  assert.equal(
    decideCompleteContactTransportV102({
      isOwner: false,
      category: "travel",
      authorityState: "legacy",
      existingMode: null,
      requested: "car",
    }).kind,
    "reject",
  );
}

// ── RPC parse allowlist ─────────────────────────────────────────────────────
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
  if (ok.ok) {
    assert.equal(ok.activated, true);
    assert.equal(ok.isActive, true);
  }
  const allow = parseV102PostsWriteRpcResult(
    { ok: false, error_msg: "error.publish_authority_partial_state" },
    "error.submit_failed",
  );
  assert.equal(allow.ok, false);
  if (!allow.ok) {
    assert.equal(allow.errorKey, "error.publish_authority_partial_state");
  }
  const fake = parseV102PostsWriteRpcResult(
    { ok: false, error_msg: "error.fake_internal" },
    "error.submit_failed",
  );
  assert.equal(fake.ok, false);
  if (!fake.ok) assert.equal(fake.errorKey, "error.submit_failed");
}

// ── migration / verify structure ────────────────────────────────────────────
{
  const mig = read(MIG);
  const verify = read(VERIFY);
  assert.ok(mig.includes("complete_post_contact_v102"));
  assert.ok(mig.includes("activate_post_after_identity_v102"));
  assert.ok(mig.includes("_posts_is_account_eligible_v102"));
  assert.ok(mig.includes("SECURITY DEFINER"));
  assert.ok(mig.includes("SET search_path TO 'pg_catalog', 'public', 'pg_temp'"));
  assert.ok(mig.includes("FOR UPDATE"));
  assert.ok(mig.includes("DROP POLICY IF EXISTS posts_update_own"));
  assert.ok(mig.includes("DROP POLICY IF EXISTS posts_insert_own"));
  assert.ok(mig.includes("DROP POLICY IF EXISTS posts_delete_own"));
  assert.ok(mig.includes("REVOKE INSERT, UPDATE, DELETE ON TABLE public.posts FROM authenticated"));
  assert.ok(mig.includes("REVOKE ALL ON FUNCTION public.publish_active_post_idempotent_v98"));
  assert.ok(mig.includes("GRANT EXECUTE ON FUNCTION public.complete_post_contact_v102"));
  assert.ok(mig.includes("GRANT EXECUTE ON FUNCTION public.activate_post_after_identity_v102"));
  assert.ok(mig.includes("REVOKE ALL ON FUNCTION public._posts_is_account_eligible_v102"));
  assert.equal(mig.includes("CREATE TABLE"), false);
  assert.equal(/CREATE\s+TRIGGER/i.test(mig), false);
  assert.equal(mig.includes("v103"), false);
  // frozen authority columns never assigned in contact writer
  assert.ok(mig.includes("raw_phone = CASE"));
  assert.equal(/origin_gps\s*=\s*CASE/i.test(mig), false);
  assert.equal(/payload_hash\s*=/i.test(mig), false);
  assert.equal(/locale\s*=/i.test(mig), false);
  assert.ok(mig.includes("p_destination_update_kind"));
  assert.ok(mig.includes("extensions.st_distance"));
  assert.ok(mig.includes("use_origin"));
  assert.ok(verify.includes("overall_pass"));
  assert.ok(verify.includes("check_order"));
  assert.ok(verify.includes("posts_update_own"));
  assert.ok(verify.includes("v98 writers fully revoked"));
  assert.ok(verify.includes("v101 writers service_role only"));
}

// ── routes: no direct posts DML; v102 RPCs; no origin geocode ───────────────
{
  const contact = read(CONTACT);
  const activate = read(ACTIVATE);
  assert.ok(contact.includes("complete_post_contact_v102"));
  assert.ok(activate.includes("activate_post_after_identity_v102"));
  assert.ok(contact.includes("auth.getUser()"));
  assert.ok(activate.includes("auth.getUser()"));
  assert.ok(contact.includes("createAdminClient"));
  assert.ok(activate.includes("createAdminClient"));
  assert.equal(/\.from\(\s*['"]posts['"]\s*\)\s*\.update/i.test(contact), false);
  assert.equal(/\.from\(\s*['"]posts['"]\s*\)\s*\.insert/i.test(contact), false);
  assert.equal(/\.from\(\s*['"]posts['"]\s*\)\s*\.delete/i.test(contact), false);
  assert.equal(/\.from\(\s*['"]posts['"]\s*\)\s*\.update/i.test(activate), false);
  assert.equal(/\.from\(\s*['"]posts['"]\s*\)\s*\.insert/i.test(activate), false);
  assert.equal(/\.from\(\s*['"]posts['"]\s*\)\s*\.delete/i.test(activate), false);
  assert.equal(contact.includes("geocodeAddress(post.origin_address)"), false);
  assert.equal(contact.includes("p_origin_gps"), false);
  assert.equal(contact.includes("p_locale"), false);
  const rpcBlock = contact.match(/admin\.rpc\(\s*["']complete_post_contact_v102["'][\s\S]*?\n\s*\}\)/)?.[0] ?? "";
  assert.ok(rpcBlock.includes("complete_post_contact_v102"));
  assert.equal(/locale/i.test(rpcBlock), false);
  assert.equal(/p_origin_/i.test(rpcBlock), false);
  assert.ok(contact.includes("p_activate"));
  assert.ok(contact.includes("destinationUpdateKind"));
  assert.ok(contact.includes("use_origin"));
  // Request bodies reject authority fields
  for (const src of [contact, activate]) {
    const bodyMatch = /interface RequestBody\s*\{([^}]*)\}/m.exec(src);
    if (bodyMatch) {
      assert.equal(
        /origin_gps|destination_gps|scope|payload_hash|userId|user_id/i.test(
          bodyMatch[1]!,
        ),
        false,
      );
    }
  }
}

// ── production: no posts DML; v98 writer calls = 0; v101 publish remain ─────
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
    if (
      /publish_active_post_idempotent_v98|create_shadow_draft_idempotent_v98|commit_phase3_business_idempotent_v98/.test(
        src,
      ) &&
      !src.trimStart().startsWith("/**")
    ) {
      // count only string occurrences in code (comments in complete-contact header removed)
    }
    if (/admin\.rpc\(\s*['"]publish_active_post_idempotent_v98/.test(src)) v98Calls += 1;
    if (/admin\.rpc\(\s*['"]create_shadow_draft_idempotent_v98/.test(src)) v98Calls += 1;
    if (/admin\.rpc\(\s*['"]commit_phase3_business_idempotent_v98/.test(src)) v98Calls += 1;
    if (src.includes("publish_active_post_idempotent_v101")) v101Calls += 1;
    if (src.includes("create_shadow_draft_idempotent_v101")) v101Calls += 1;
    if (src.includes("commit_phase3_business_idempotent_v101")) v101Calls += 1;
  }
  assert.equal(v98Calls, 0);
  assert.ok(v101Calls >= 3);

  // Frozen files zero-diff expectation: still contain historical posts_update_own text
  assert.ok(read("supabase/posts_init.sql").includes("posts_update_own"));
  const migs = readdirSync(join(repoRoot, "supabase/migrations"));
  assert.equal(migs.some((n) => /v103/.test(n)), false);
  assert.ok(migs.includes("20260919000001_posts_write_boundary_v102.sql"));
  // v90–v101B untouched (spot-check filenames present)
  assert.ok(migs.some((n) => n.includes("v101b") || n.includes("v101B") || n.includes("writer_v101b")));
}

console.log("postsWriteBoundaryV102.test.ts: PASS");
