/**
 * PHASE 6.7C.2C.3G / v101B — authority-bound outer writers structure tests.
 * Reads real migration/verify text. Does not execute SQL or connect to Supabase.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/trustedPublishAuthorityWriterV101b.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractDoBlock,
  transactionControls,
  verifyIsSingleResultSet,
} from "@/lib/matching/allocationEventFoundationV94.contract";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const PHASE_BASELINE = "4f6c6b0699eb0e57dbc61e6c396accd9d6c26eff";

const MIG_REL =
  "supabase/migrations/20260918000002_trusted_publish_authority_writer_v101b.sql";
const VERIFY_REL =
  "supabase/migrations/20260918000002_trusted_publish_authority_writer_v101b.verify.sql";
const V101A_REL =
  "supabase/migrations/20260918000001_trusted_publish_authority_insert_v101.sql";

const HASH_ID =
  "public.trusted_publish_facts_hash_v101(text, extensions.geography, text, text, integer)";
const ACTIVE_ID =
  "public.publish_active_post_idempotent_v101(uuid, uuid, text, jsonb, bigint, extensions.geography, text, text, integer)";
const SHADOW_ID =
  "public.create_shadow_draft_idempotent_v101(uuid, uuid, text, text, jsonb, bigint, extensions.geography, text, text, integer)";
const COMMIT_ID =
  "public.commit_phase3_business_idempotent_v101(uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text, extensions.geography, text, text, integer)";

const FROZEN = [
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql",
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql",
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.sql",
  "supabase/migrations/20260911000002_matching_allocation_event_foundation_v94.sql",
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql",
  "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.sql",
  "supabase/migrations/20260914000001_postgis_extensions_rebind_v97.sql",
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.sql",
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.verify.sql",
  "supabase/migrations/20260916000001_match_admission_authority_v99.sql",
  "supabase/migrations/20260916000002_match_request_writer_v99b.sql",
  "supabase/migrations/20260917000001_night_policy_selector_v100.sql",
  "supabase/migrations/20260917000001_night_policy_selector_v100.verify.sql",
  V101A_REL,
  "supabase/migrations/20260918000001_trusted_publish_authority_insert_v101.verify.sql",
  "supabase/init.sql",
  "supabase/posts_init.sql",
] as const;

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", PHASE_BASELINE, "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function dollarBody(sql: string, tag: string): string {
  const token = `$${tag}$`;
  const start = sql.indexOf(token);
  if (start < 0) return "";
  const end = sql.indexOf(token, start + token.length);
  if (end < 0) return "";
  return sql.slice(start + token.length, end);
}

function writerBodies(mig: string): {
  hash: string;
  active: string;
  shadow: string;
  commit: string;
} {
  // Bodies use $hash$ once and $fn$ three times in order active/shadow/commit
  const hash = dollarBody(mig, "hash");
  const parts: string[] = [];
  let from = 0;
  const token = "$fn$";
  while (parts.length < 3) {
    const start = mig.indexOf(token, from);
    assert.ok(start >= 0, "missing $fn$ body");
    const end = mig.indexOf(token, start + token.length);
    assert.ok(end > start, "unclosed $fn$");
    parts.push(mig.slice(start + token.length, end));
    from = end + token.length;
  }
  return {
    hash,
    active: parts[0]!,
    shadow: parts[1]!,
    commit: parts[2]!,
  };
}

function lockBeforeSelect(body: string): boolean {
  const lock = body.search(/pg_advisory_xact_lock/i);
  const sel = body.search(/FROM\s+public\.posts/i);
  return lock >= 0 && sel >= 0 && lock < sel;
}

const mig = read(MIG_REL);
const verify = read(VERIFY_REL);
const bodies = writerBodies(mig);

async function main() {
  // Transaction + manual apply markers
  {
    assert.deepEqual(transactionControls(mig), ["BEGIN;", "COMMIT;"]);
    assert.ok(mig.includes("MANUAL APPLY REQUIRED"));
    assert.ok(mig.includes("v101B"));
    assert.equal(mig.includes("CREATE OR REPLACE FUNCTION"), false);
  }

  // Identities
  {
    assert.ok(mig.includes("CREATE FUNCTION public.trusted_publish_facts_hash_v101"));
    assert.ok(mig.includes("CREATE FUNCTION public.publish_active_post_idempotent_v101"));
    assert.ok(mig.includes("CREATE FUNCTION public.create_shadow_draft_idempotent_v101"));
    assert.ok(mig.includes("CREATE FUNCTION public.commit_phase3_business_idempotent_v101"));
    assert.ok(
      mig.replace(/\s+/g, " ").includes(
        HASH_ID.replace(/\s+/g, " ").replace("public.", ""),
      ) || mig.includes("trusted_publish_facts_hash_v101("),
    );
    void ACTIVE_ID;
    void SHADOW_ID;
    void COMMIT_ID;
    assert.ok(mig.includes("p_canonical_payload_hash"));
    assert.ok(mig.includes("p_fallback_reason"));
    assert.ok(mig.includes("STABLE"));
    assert.ok(mig.includes("VOLATILE"));
    assert.ok(mig.includes("SECURITY DEFINER"));
  }

  // Guard
  {
    const guard = extractDoBlock(mig);
    assert.ok(guard.includes("v101B_guard"));
    assert.ok(guard.includes("insert_stage1_post_v101"));
    assert.ok(guard.includes("publish_active_post_idempotent_v98"));
    assert.ok(guard.includes("create_shadow_draft_idempotent_v98"));
    assert.ok(guard.includes("commit_phase3_business_idempotent_v98"));
    assert.ok(guard.includes("select_night_service_policy_v100"));
    assert.ok(guard.includes("client_request_id"));
    assert.ok(guard.includes("matching_request_creation_enabled"));
    assert.ok(guard.includes("id = 1"));
    assert.equal(/schema_migrations/i.test(guard), false);
    assert.ok(guard.includes("trusted_publish_facts_hash_v101 already exists"));
  }

  // Lock before SELECT posts (all three writers)
  {
    assert.equal(lockBeforeSelect(bodies.active), true);
    assert.equal(lockBeforeSelect(bodies.shadow), true);
    assert.equal(lockBeforeSelect(bodies.commit), true);
    assert.ok(bodies.active.includes("v101_publish_user:"));
    assert.ok(bodies.active.includes("v101_publish_crid:"));
    assert.ok(bodies.shadow.includes("v101_publish_user:"));
    assert.ok(bodies.commit.includes("v101_publish_crid:"));
  }

  // Fresh → v101 insert; no v98 insert/outer
  {
    for (const b of [bodies.active, bodies.shadow, bodies.commit]) {
      assert.ok(b.includes("insert_stage1_post_v101"));
      assert.equal(b.includes("insert_stage1_post_v98"), false);
      assert.equal(b.includes("publish_active_post_idempotent_v98"), false);
      assert.equal(b.includes("create_shadow_draft_idempotent_v98"), false);
      assert.equal(b.includes("commit_phase3_business_idempotent_v98"), false);
      assert.equal(b.includes("auth.uid()"), false);
    }
  }

  // Exact retry uses stored authority; incoming authority not used to overwrite
  {
    assert.ok(bodies.active.includes("v_stored_gps"));
    assert.ok(bodies.active.includes("v_stored_cc"));
    assert.ok(bodies.active.includes("v_stored_tz"));
    assert.ok(bodies.active.includes("v_stored_night"));
    // Complete-path activate must NOT set origin_gps = p_origin_gps
    const completeActivate =
      /IF v_complete THEN[\s\S]*?SET status = 'active'[\s\S]*?WHERE id = v_existing_post_id/;
    const m = completeActivate.exec(bodies.active);
    assert.ok(m, "complete draft→active path");
    assert.equal(m![0]!.includes("origin_gps = p_origin_gps"), false);
  }

  // Legacy draft upgrade / legacy active refuse / partial refuse
  {
    for (const b of [bodies.active, bodies.shadow, bodies.commit]) {
      assert.ok(b.includes("error.publish_authority_legacy_missing"));
      assert.ok(b.includes("error.publish_authority_partial_state"));
      assert.ok(b.includes("error.publish_authority_invalid"));
      assert.ok(b.includes("origin_gps IS NULL"));
      assert.ok(b.includes("night_policy_version IS NULL"));
      assert.ok(b.includes("GET DIAGNOSTICS v_updated = ROW_COUNT"));
      assert.ok(b.includes("v_updated = 1"));
    }
    // Shadow legacy keeps draft (no status='active' in legacy UPDATE of shadow)
    const shadowLegacyUpdate =
      /Legacy: only draft[\s\S]*?UPDATE public\.posts[\s\S]*?WHERE id = v_post_id/;
    const sm = shadowLegacyUpdate.exec(bodies.shadow);
    assert.ok(sm, "shadow legacy update");
    assert.equal(/SET\s+status\s*=\s*'active'/.test(sm![0]!), false);
  }

  // Passkey atomicity structure
  {
    assert.ok(bodies.commit.includes("auth_challenges"));
    assert.ok(bodies.commit.includes("processing_token"));
    assert.ok(bodies.commit.includes("error.challenge_fencing_stale"));
    assert.ok(bodies.commit.includes("passkeys"));
    assert.ok(bodies.commit.includes("has_passkey"));
    assert.ok(bodies.commit.includes("insert_stage1_post_v101"));
    // Exact retry active returns before challenge consume
    const activeDupIdx = bodies.commit.indexOf(
      "Exact retry existing active",
    );
    const challengeIdx = bodies.commit.indexOf("UPDATE public.auth_challenges");
    assert.ok(activeDupIdx >= 0 && challengeIdx > activeDupIdx);
  }

  // ACL: hash sealed; writers service_role only
  {
    assert.ok(
      mig.includes(
        "REVOKE ALL ON FUNCTION public.trusted_publish_facts_hash_v101",
      ),
    );
    assert.ok(mig.includes("FROM service_role"));
    assert.ok(
      mig.includes(
        "GRANT EXECUTE ON FUNCTION public.publish_active_post_idempotent_v101",
      ),
    );
    assert.ok(mig.includes("TO service_role"));
    assert.equal(
      /GRANT EXECUTE ON FUNCTION public\.trusted_publish_facts_hash_v101[\s\S]{0,80}TO service_role/i.test(
        mig,
      ),
      false,
    );
    assert.equal(
      /GRANT EXECUTE ON FUNCTION public\.insert_stage1_post_v101/i.test(mig),
      false,
    );
  }

  // Verify shape
  {
    assert.equal(verifyIsSingleResultSet(verify), true);
    assert.ok(verify.includes("check_order"));
    assert.ok(verify.includes("overall_pass"));
    assert.ok(verify.includes("advisory before posts SELECT"));
    assert.ok(verify.includes("writers service_role only"));
    assert.ok(verify.includes("no insert_stage1_post_v98"));
    assert.equal(/PERFORM\s+public\.(publish_active|create_shadow|commit_phase3)/i.test(verify), false);
    assert.equal(/INSERT INTO public\.posts/i.test(verify), false);
  }

  // APIs still v98; no v102; frozen zero-diff
  {
    const trusted = read("src/app/api/posts/trusted-publish/route.ts");
    const shadow = read("src/app/api/posts/shadow-draft/route.ts");
    const passkey = read("src/app/api/auth/passkey/verify/route.ts");
    assert.ok(trusted.includes("publish_active_post_idempotent_v98"));
    assert.ok(shadow.includes("create_shadow_draft_idempotent_v98"));
    assert.ok(passkey.includes("commit_phase3_business_idempotent_v98"));
    assert.equal(trusted.includes("idempotent_v101"), false);
    assert.equal(shadow.includes("idempotent_v101"), false);
    assert.equal(passkey.includes("idempotent_v101"), false);

    const migs = readdirSync(join(repoRoot, "supabase/migrations"));
    assert.equal(migs.some((n) => /v102/.test(n)), false);
    assert.ok(
      migs.includes(
        "20260918000002_trusted_publish_authority_writer_v101b.sql",
      ),
    );

    for (const path of FROZEN) {
      assert.equal(gitDiff(path), "", `frozen dirty: ${path}`);
    }
  }

  // Owner/hash/status conflict keys
  {
    assert.ok(bodies.active.includes("error.security_boundary_compromised"));
    assert.ok(bodies.active.includes("error.idempotency_payload_conflict"));
    assert.ok(bodies.active.includes("error.invalid_post_status"));
  }

  // Hash helper attrs
  {
    assert.ok(bodies.hash.includes("st_asewkb") || mig.includes("st_asewkb"));
    assert.ok(mig.includes("extensions.digest"));
    assert.ok(mig.includes("LANGUAGE plpgsql"));
    assert.ok(mig.includes("SET search_path TO 'pg_catalog', 'public', 'pg_temp'"));
  }

  const ledger = read("docs/architecture/deferred-cleanup.md");
  assert.ok(ledger.includes("v101A") || ledger.includes("2C.3F"));
  assert.ok(ledger.includes("2C.3G") || ledger.includes("v101B"));

  console.log("trustedPublishAuthorityWriterV101b.test.ts: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
