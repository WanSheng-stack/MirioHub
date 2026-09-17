/**
 * PHASE 6.7C.2C.3H — API cutover structure + origin-reuse offline tests.
 * Inspects real production route/helper sources. No Supabase / network.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/trustedPublishApiCutoverV101.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseV101PublishRpcResult } from "@/lib/safety/parseV101PublishRpcResult";
import {
  resolveStage1RouteWithOriginHit,
  type NominatimCoordinateHit,
} from "@/lib/route-kms";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const TRUSTED = "src/app/api/posts/trusted-publish/route.ts";
const SHADOW = "src/app/api/posts/shadow-draft/route.ts";
const PASSKEY = "src/app/api/auth/passkey/verify/route.ts";
const CANON_BUILDER = "src/lib/auth/buildCanonicalStage1PublishContext.ts";
const AUTH_FROM_HIT = "src/lib/safety/buildAuthorityForPublishFromOriginHit.ts";
const SELECTOR_LIVE = "src/lib/safety/selectNightServicePolicyV100Live.ts";
const ROUTE_KMS = "src/lib/route-kms.ts";

async function main() {
  const trusted = read(TRUSTED);
  const shadow = read(SHADOW);
  const passkey = read(PASSKEY);
  const builder = read(CANON_BUILDER);
  const authHit = read(AUTH_FROM_HIT);
  const selector = read(SELECTOR_LIVE);

  // Three production routes call exact v101 writers; zero v98 writer call sites
  {
    assert.ok(trusted.includes("publish_active_post_idempotent_v101"));
    assert.ok(shadow.includes("create_shadow_draft_idempotent_v101"));
    assert.ok(passkey.includes("commit_phase3_business_idempotent_v101"));
    assert.equal(trusted.includes("publish_active_post_idempotent_v98"), false);
    assert.equal(shadow.includes("create_shadow_draft_idempotent_v98"), false);
    assert.equal(passkey.includes("commit_phase3_business_idempotent_v98"), false);
    assert.equal(passkey.includes("p_payload_hash"), false);
    assert.ok(passkey.includes("p_canonical_payload_hash"));
  }

  // v101 via createAdminClient; actor from session auth
  {
    for (const src of [trusted, shadow, passkey]) {
      assert.ok(src.includes('from "@/lib/supabase/admin"') || src.includes("from '@/lib/supabase/admin'"));
      assert.ok(src.includes("createAdminClient"));
      assert.ok(/admin\.rpc\s*\(/.test(src));
    }
    assert.ok(trusted.includes("getUser") || trusted.includes("auth.getUser"));
    assert.ok(shadow.includes("getUser") || shadow.includes("auth.getUser"));
    assert.ok(passkey.includes("getSession") || passkey.includes("auth.getSession"));
    assert.ok(trusted.includes("user.id"));
    assert.ok(shadow.includes("user.id") || shadow.includes("current_uid"));
    assert.ok(passkey.includes("session.user.id") || passkey.includes("current_uid"));
  }

  // Request bodies do not accept authority fields
  {
    for (const src of [trusted, shadow, passkey]) {
      const bodyMatch = /interface RequestBody\s*\{([^}]*)\}/m.exec(src);
      assert.ok(bodyMatch, "RequestBody interface required");
      const bodyBlock = bodyMatch[1]!;
      assert.equal(/origin_gps|origin_country|origin_timezone|night_policy/i.test(bodyBlock), false);
      assert.equal(/body\.(origin_gps|originCountryCode|nightPolicyVersion)/.test(src), false);
    }
  }

  // v100 selector: region null; evaluationTime server-generated once
  {
    assert.ok(selector.includes("select_night_service_policy_v100"));
    assert.ok(selector.includes("p_region_code: null") || selector.includes("p_region_code:null"));
    assert.ok(selector.includes("createAdminClient"));
    assert.ok(selector.includes("server-only"));
    assert.ok(authHit.includes("new Date().toISOString()"));
    assert.ok(authHit.includes("evaluationTime ??"));
    assert.ok(authHit.includes("trustedPointFromNominatimHit"));
    assert.ok(authHit.includes("materializeTrustedPublishAuthorityFields"));
    assert.equal(authHit.includes("resolveTrustedOrigin(address)"), false);
  }

  // Four authority args from validated trusted fields
  {
    for (const src of [trusted, shadow, passkey]) {
      assert.ok(src.includes("p_origin_gps"));
      assert.ok(src.includes("p_origin_country_code"));
      assert.ok(src.includes("p_origin_timezone"));
      assert.ok(src.includes("p_night_policy_version"));
      assert.ok(src.includes("buildAuthorityForPublishFromOriginHit") || src.includes("exactRetry"));
    }
    assert.ok(shadow.includes("buildAuthorityForPublishFromOriginHit"));
    // Shadow always builds authority (never four-NULL insert)
    assert.equal(/exactRetry/.test(shadow), false);
  }

  // Origin Nominatim reuse in builder + route-kms helper
  {
    assert.ok(builder.includes("resolveStage1RouteWithOriginHit"));
    assert.ok(builder.includes("originNominatimHit"));
    assert.equal(builder.includes("computeRouteDistance("), false);
    assert.equal(builder.includes("resolveTrustedOrigin"), false);
    const routeKms = read(ROUTE_KMS);
    assert.ok(routeKms.includes("resolveStage1RouteWithOriginHit"));
    assert.ok(routeKms.includes("fetchNominatimCoordinateHitsSequential"));
    assert.ok(routeKms.includes("computeRouteDistanceFromCoords"));
  }

  // Passkey: authority after crypto; failure marks challenge
  {
    const cryptoIdx = passkey.indexOf("device_verification_failed");
    const authCallIdx = passkey.indexOf(
      "await buildAuthorityForPublishFromOriginHit(",
    );
    const rpcIdx = passkey.indexOf("commit_phase3_business_idempotent_v101");
    assert.ok(cryptoIdx >= 0 && authCallIdx > cryptoIdx && rpcIdx > authCallIdx);
    assert.ok(passkey.includes("authority_rejected"));
    assert.ok(passkey.includes("markChallengeFailed"));
  }

  // No direct posts insert/update in routes; no client imports of server-only
  {
    for (const src of [trusted, shadow, passkey]) {
      assert.equal(/\.from\(\s*['"]posts['"]\s*\)\s*\.insert/i.test(src), false);
      assert.equal(/\.from\(\s*['"]posts['"]\s*\)\s*\.update/i.test(src), false);
    }
    const clientFiles = readdirSync(join(repoRoot, "src/components"), {
      recursive: true,
    }) as string[];
    for (const f of clientFiles) {
      if (!f.endsWith(".tsx") && !f.endsWith(".ts")) continue;
      const src = read(join("src/components", f));
      assert.equal(
        src.includes("createAdminClient") ||
          src.includes("selectNightServicePolicyV100Live") ||
          src.includes("buildAuthorityForPublishFromOriginHit"),
        false,
        `client must not import admin/authority: ${f}`,
      );
    }
  }

  // Migrations / posts_update_own / no v102
  {
    const migs = readdirSync(join(repoRoot, "supabase/migrations"));
    assert.equal(migs.some((n) => /v102/.test(n)), false);
    const postsInit = read("supabase/posts_init.sql");
    assert.ok(postsInit.includes("posts_update_own"));
    const v98 = read(
      "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.sql",
    );
    assert.ok(v98.includes("GRANT EXECUTE ON FUNCTION public.publish_active_post_idempotent_v98"));
  }

  // parseV101PublishRpcResult fail-closed
  {
    assert.equal(
      parseV101PublishRpcResult(null, "error.submit_failed").ok,
      false,
    );
    assert.equal(
      parseV101PublishRpcResult(
        { ok: true, post_id: "not-a-uuid" },
        "error.submit_failed",
      ).ok,
      false,
    );
    const ok = parseV101PublishRpcResult(
      {
        ok: true,
        post_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        is_duplicate: true,
      },
      "error.submit_failed",
    );
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.isDuplicate, true);
    }
    const fail = parseV101PublishRpcResult(
      { ok: false, error_msg: "error.idempotency_payload_conflict" },
      "error.submit_failed",
    );
    assert.equal(fail.ok, false);
    if (!fail.ok) {
      assert.equal(fail.errorKey, "error.idempotency_payload_conflict");
    }
    const leak = parseV101PublishRpcResult(
      { ok: false, error_msg: "duplicate key value violates unique constraint" },
      "error.submit_failed",
    );
    assert.equal(leak.ok, false);
    if (!leak.ok) {
      assert.equal(leak.errorKey, "error.submit_failed");
    }
  }

  // Offline: origin fetched once; OSRM coords match authority hit
  {
    let httpCalls = 0;
    const hitA: NominatimCoordinateHit = {
      lat: 44.8,
      lon: 20.4,
      countryCode: "RS",
    };
    const hitB: NominatimCoordinateHit = {
      lat: 44.9,
      lon: 20.5,
      countryCode: "RS",
    };
    const route = await resolveStage1RouteWithOriginHit(
      {
        category: "travel",
        originAddress: "Origin Street 1",
        destinationAddress: "Dest Street 2",
        waypoints: [],
      },
      {
        fetchHits: async (locations) => {
          httpCalls += 1;
          assert.equal(locations.length, 2);
          return { ok: true, hits: [hitA, hitB] };
        },
        computeFromCoords: async (coords) => {
          assert.equal(coords.length, 2);
          assert.equal(coords[0]!.lat, hitA.lat);
          assert.equal(coords[0]!.lon, hitA.lon);
          assert.equal(coords[1]!.lat, hitB.lat);
          assert.equal(coords[1]!.lon, hitB.lon);
          return { ok: true, totalKms: 12.5 };
        },
        minIntervalMs: 0,
      },
    );
    assert.equal(route.ok, true);
    assert.equal(httpCalls, 1);
    if (route.ok) {
      assert.equal(route.originNominatimHit.lat, hitA.lat);
      assert.equal(route.originNominatimHit.lon, hitA.lon);
      assert.equal(route.serverKms, 12.5);
    }
  }

  // onsite: serverKms=0, origin still resolved once
  {
    let httpCalls = 0;
    const hit: NominatimCoordinateHit = {
      lat: 44.8,
      lon: 20.4,
      countryCode: "RS",
    };
    const route = await resolveStage1RouteWithOriginHit(
      {
        category: "onsite",
        originAddress: "Only Origin",
        destinationAddress: "",
        waypoints: [],
      },
      {
        fetchHits: async (locations) => {
          httpCalls += 1;
          assert.deepEqual(locations, ["Only Origin"]);
          return { ok: true, hits: [hit] };
        },
        computeFromCoords: async () => {
          throw new Error("OSRM must not run for onsite single-point");
        },
        minIntervalMs: 0,
      },
    );
    assert.equal(route.ok, true);
    assert.equal(httpCalls, 1);
    if (route.ok) {
      assert.equal(route.serverKms, 0);
      assert.equal(route.originNominatimHit.lat, hit.lat);
    }
  }

  console.log("trustedPublishApiCutoverV101.test.ts: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
