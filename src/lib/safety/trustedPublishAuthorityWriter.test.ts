/**
 * PHASE 6.7C.2C.3E — trusted publish authority writer foundation (offline).
 * Imports pure writer core only (no server-only / network / Supabase).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/trustedPublishAuthorityWriter.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TrustedPublishAuthorityValue } from "@/lib/safety/trustedPublishAuthorityCore";
import {
  CLIENT_AUTHORITY_OVERRIDE_KEYS,
  executeTrustedPublishAuthorityWrite,
  materializeTrustedPublishAuthorityFields,
  type TrustedPublishAuthorityPersistedFields,
} from "@/lib/safety/trustedPublishAuthorityWriterCore";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const PHASE_BASELINE = "dee21f6285f2cad89193721144561c96a3559b95";
const USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const POLICY_ID = "11111111-1111-4111-8111-111111111111";
const LAT = 44.8178131;
const LON = 20.4568974;
const WKT = `SRID=4326;POINT(${LON} ${LAT})`;

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
  "supabase/migrations/20260916000001_match_admission_authority_v99.sql",
  "supabase/migrations/20260916000002_match_request_writer_v99b.sql",
  "supabase/migrations/20260917000001_night_policy_selector_v100.sql",
  "supabase/migrations/20260917000001_night_policy_selector_v100.verify.sql",
  "supabase/init.sql",
] as const;

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", PHASE_BASELINE, "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function okAuthority(
  overrides: Partial<TrustedPublishAuthorityValue> = {},
): TrustedPublishAuthorityValue {
  return {
    originGpsWkt: WKT,
    originCountryCode: "RS",
    originTimezone: "Europe/Belgrade",
    nightPolicyVersion: 2,
    nightPolicyApplied: true,
    policyId: POLICY_ID,
    ...overrides,
  };
}

function noPolicyAuthority(): TrustedPublishAuthorityValue {
  return okAuthority({
    nightPolicyVersion: null,
    nightPolicyApplied: false,
    policyId: null,
  });
}

async function main() {
  // 1. trusted authority values are persisted exactly
  {
    const captured: TrustedPublishAuthorityPersistedFields[] = [];
    const authority = okAuthority();
    const res = await executeTrustedPublishAuthorityWrite({
      userId: USER_ID,
      authority,
      persist: async (fields) => {
        captured.push({ ...fields });
      },
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.deepEqual(res.fields, {
        origin_gps: WKT,
        origin_country_code: "RS",
        origin_timezone: "Europe/Belgrade",
        night_policy_version: 2,
      });
    }
    assert.deepEqual(captured, [
      {
        origin_gps: WKT,
        origin_country_code: "RS",
        origin_timezone: "Europe/Belgrade",
        night_policy_version: 2,
      },
    ]);
  }

  // 2. client-supplied conflicting authority fields cannot override
  {
    const captured: TrustedPublishAuthorityPersistedFields[] = [];
    const res = await executeTrustedPublishAuthorityWrite({
      userId: USER_ID,
      authority: okAuthority({ originCountryCode: "RS", nightPolicyVersion: 3 }),
      clientPayload: {
        origin_country_code: "XX",
        origin_timezone: "Etc/UTC",
        night_policy_version: 99,
        origin_gps: "SRID=4326;POINT(0 0)",
        originCountryCode: "HU",
        nightPolicyVersion: 1,
        policyId: "00000000-0000-4000-8000-000000000000",
      },
      persist: async (fields) => {
        captured.push({ ...fields });
      },
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.fields.origin_country_code, "RS");
      assert.equal(res.fields.origin_timezone, "Europe/Belgrade");
      assert.equal(res.fields.night_policy_version, 3);
      assert.equal(res.fields.origin_gps, WKT);
    }
    assert.equal(captured[0]!.origin_country_code, "RS");
    assert.equal(captured[0]!.night_policy_version, 3);
    for (const key of CLIENT_AUTHORITY_OVERRIDE_KEYS) {
      assert.ok(key.length > 0);
    }
  }

  // 3. null / no-policy authority persists correctly
  {
    const captured: TrustedPublishAuthorityPersistedFields[] = [];
    const res = await executeTrustedPublishAuthorityWrite({
      userId: USER_ID,
      authority: noPolicyAuthority(),
      persist: async (fields) => {
        captured.push({ ...fields });
      },
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.fields.night_policy_version, null);
      assert.equal(res.fields.origin_country_code, "RS");
      assert.equal(res.fields.origin_timezone, "Europe/Belgrade");
      assert.equal(res.fields.origin_gps, WKT);
    }
    assert.equal(captured[0]!.night_policy_version, null);
  }

  // 4. malformed / missing authority cannot enter write path
  {
    let persistCalls = 0;
    const persist = async () => {
      persistCalls += 1;
    };
    for (const bad of [
      null,
      undefined,
      "authority",
      1,
      [],
      new Date(),
      {},
      { ...okAuthority(), originCountryCode: "rs" },
      { ...okAuthority(), originTimezone: " Europe/Belgrade" },
      { ...okAuthority(), originGpsWkt: "" },
      { ...okAuthority(), nightPolicyApplied: true, nightPolicyVersion: null },
      {
        ...okAuthority(),
        nightPolicyApplied: false,
        nightPolicyVersion: 1,
        policyId: null,
      },
      {
        ...okAuthority(),
        nightPolicyApplied: true,
        nightPolicyVersion: 1,
        policyId: "not-uuid",
      },
    ] as unknown[]) {
      const res = await executeTrustedPublishAuthorityWrite({
        userId: USER_ID,
        authority: bad,
        persist,
      });
      assert.equal(res.ok, false, String(bad));
      if (!res.ok) assert.equal(res.errorKey, "error.authority_write_invalid");
    }
    assert.equal(persistCalls, 0);

    const missing = await executeTrustedPublishAuthorityWrite({
      userId: USER_ID,
      authority: undefined,
      persist,
    });
    assert.equal(missing.ok, false);
    assert.equal(persistCalls, 0);

    const badUser = await executeTrustedPublishAuthorityWrite({
      userId: "",
      authority: okAuthority(),
      persist,
    });
    assert.equal(badUser.ok, false);
    if (!badUser.ok) {
      assert.equal(badUser.errorKey, "error.authentication_required");
    }
    assert.equal(persistCalls, 0);
  }

  // materialize mirrors execute validation
  {
    const ok = materializeTrustedPublishAuthorityFields(okAuthority());
    assert.equal(ok.ok, true);
    const bad = materializeTrustedPublishAuthorityFields(null);
    assert.equal(bad.ok, false);
  }

  // persist throw → fail closed, no leak
  {
    const res = await executeTrustedPublishAuthorityWrite({
      userId: USER_ID,
      authority: okAuthority(),
      persist: async () => {
        throw new Error("db boom");
      },
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.authority_write_invalid");
  }

  // 5. service-role writer remains server-only; wrapper not imported by clients
  {
    const wrapper = read("src/lib/safety/trustedPublishAuthorityWriter.ts");
    assert.ok(wrapper.includes('import "server-only"'));
    assert.ok(wrapper.includes("createAdminClient"));
    assert.ok(wrapper.includes('from "@/lib/supabase/admin"'));
    assert.ok(wrapper.includes("writeTrustedPublishAuthority"));
    const core = read("src/lib/safety/trustedPublishAuthorityWriterCore.ts");
    assert.equal(/import\s+["']server-only["']/.test(core), false);
    assert.equal(core.includes("createAdminClient"), false);
    assert.equal(core.includes("SUPABASE_SERVICE_ROLE_KEY"), false);

    const files: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          !entry.name.includes(".test.")
        ) {
          files.push(full);
        }
      }
    }
    walk(join(repoRoot, "src"));
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const head = src.slice(0, 400);
      if (!head.includes('"use client"') && !head.includes("'use client'")) {
        continue;
      }
      assert.equal(
        src.includes("trustedPublishAuthorityWriter"),
        false,
        `client import writer: ${file}`,
      );
      assert.equal(
        src.includes("createAdminClient"),
        false,
        `client import admin: ${file}`,
      );
    }
  }

  // API cutover (3H): publish routes call v101; foundation still not client-wired
  {
    const trusted = read("src/app/api/posts/trusted-publish/route.ts");
    const shadow = read("src/app/api/posts/shadow-draft/route.ts");
    const passkey = read("src/app/api/auth/passkey/verify/route.ts");
    assert.ok(trusted.includes("publish_active_post_idempotent_v101"));
    assert.ok(shadow.includes("create_shadow_draft_idempotent_v101"));
    assert.ok(passkey.includes("commit_phase3_business_idempotent_v101"));
    assert.equal(trusted.includes("publish_active_post_idempotent_v98"), false);
    assert.equal(shadow.includes("create_shadow_draft_idempotent_v98"), false);
    assert.equal(passkey.includes("commit_phase3_business_idempotent_v98"), false);
    assert.equal(trusted.includes("writeTrustedPublishAuthority"), false);
    assert.equal(shadow.includes("writeTrustedPublishAuthority"), false);
    assert.equal(passkey.includes("writeTrustedPublishAuthority"), false);
  }

  // posts_update_own / init.sql / v90–v100 frozen; no outer v101 writer/cutover
  {
    assert.equal(gitDiff("supabase/init.sql"), "");
    assert.equal(gitDiff("supabase/posts_init.sql"), "");
    for (const path of FROZEN) {
      assert.equal(gitDiff(path), "", `frozen dirty: ${path}`);
    }
    const migs = readdirSync(join(repoRoot, "supabase/migrations"));
    // v101A/v101B migration files may exist; reject v102 and API cutover.
    assert.equal(migs.some((n) => /v102/.test(n)), false);
    assert.equal(
      migs.some((n) => /cutover|revoke_v98|posts_update_own_seal/.test(n)),
      false,
    );
    const postsInit = read("supabase/posts_init.sql");
    assert.ok(postsInit.includes("posts_update_own"));
    assert.equal(gitDiff("supabase/posts_init.sql"), "");
  }

  // Schema gap: authority columns already exist (no migration needed)
  {
    const v96 = read(
      "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.sql",
    );
    assert.ok(v96.includes("ADD COLUMN origin_country_code text"));
    assert.ok(v96.includes("ADD COLUMN origin_timezone text"));
    assert.ok(v96.includes("ADD COLUMN night_policy_version integer"));
    assert.equal(v96.includes("night_policy_applied"), false);
    assert.equal(
      /ADD COLUMN\s+policy_id/.test(v96),
      false,
    );
  }

  // creation / RS night not flipped
  {
    const core = read("src/lib/safety/trustedPublishAuthorityWriterCore.ts");
    const wrap = read("src/lib/safety/trustedPublishAuthorityWriter.ts");
    assert.equal(core.includes("matching_request_creation_enabled"), false);
    assert.equal(wrap.includes("matching_request_creation_enabled"), false);
  }

  // authority context module still present; writer does not re-geocode
  {
    const core = read("src/lib/safety/trustedPublishAuthorityWriterCore.ts");
    assert.equal(core.includes("resolveTrustedOrigin"), false);
    assert.equal(core.includes("selectNightPolicy"), false);
    assert.equal(core.includes("evaluateNightServicePolicy"), false);
    assert.equal(core.includes("Date.now("), false);
  }

  const ledger = read("docs/architecture/deferred-cleanup.md");
  assert.ok(ledger.includes("2C.3E") || ledger.includes("writer foundation"));
  assert.ok(
    ledger.includes("API cutover still pending") ||
      ledger.includes("cutover still pending") ||
      ledger.includes("API cutover"),
  );

  console.log("trustedPublishAuthorityWriter.test.ts: ok");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
