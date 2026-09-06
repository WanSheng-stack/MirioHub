/**
 * PHASE 6.5A.1 — API ownership boundary + explicit providerPostId.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/route/routeMatchAccess.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateRouteMatchAccess,
  resolveViewerProviderPostId,
  toRouteMatchApiPayload,
} from "@/lib/route/routeMatchAccess";
import type { DemandInsertionResult } from "@/lib/route/findBestDemandInsertion";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const userA = "user-a";
const userB = "user-b";
const demandActive = {
  user_id: "user-c",
  post_type: "demand",
  status: "active",
};
const providerA = {
  user_id: userA,
  post_type: "provider",
  status: "active",
};

// TEST 6
assert.equal(
  evaluateRouteMatchAccess({
    userId: userA,
    demand: demandActive,
    provider: providerA,
  }),
  true,
);

// TEST 7 — User A cannot score User B's provider
assert.equal(
  evaluateRouteMatchAccess({
    userId: userA,
    demand: demandActive,
    provider: { ...providerA, user_id: userB },
  }),
  false,
);

// TEST 8 — demand draft
assert.equal(
  evaluateRouteMatchAccess({
    userId: userA,
    demand: { ...demandActive, status: "draft" },
    provider: providerA,
  }),
  false,
);

// TEST 9 — provider non-active
assert.equal(
  evaluateRouteMatchAccess({
    userId: userA,
    demand: demandActive,
    provider: { ...providerA, status: "matched" },
  }),
  false,
);

// TEST 10 — swapped roles
assert.equal(
  evaluateRouteMatchAccess({
    userId: userA,
    demand: { user_id: userA, post_type: "provider", status: "active" },
    provider: { user_id: userA, post_type: "demand", status: "active" },
  }),
  false,
);

assert.equal(
  evaluateRouteMatchAccess({
    userId: userA,
    demand: null,
    provider: providerA,
  }),
  false,
);

// TEST 11 — same-day two provider posts: explicit Post 2 only
assert.equal(
  resolveViewerProviderPostId(["post-1", "post-2"], "post-2"),
  "post-2",
);
assert.equal(resolveViewerProviderPostId(["post-1", "post-2"], null), null);
assert.equal(resolveViewerProviderPostId(["post-1"], null), "post-1");
assert.equal(resolveViewerProviderPostId(["post-1", "post-2"], "post-9"), null);

const providerMatchSrc = read("src/lib/post-form/providerMatch.ts");
assert.ok(providerMatchSrc.includes("input.providerPostId"));
assert.ok(/eq\("id", input\.providerPostId\)/.test(providerMatchSrc));
assert.equal(
  /eq\("post_type", "provider"\)\s*\n\s*\.eq\("status", "active"\)\s*\n\s*\.eq\("departure_date"/.test(
    providerMatchSrc,
  ),
  false,
  "must not guess provider trip by date + maybeSingle",
);

const apiSrc = read("src/app/api/posts/evaluate-route-match/route.ts");
assert.ok(apiSrc.includes("evaluateRouteMatchAccess"));
assert.ok(apiSrc.includes("toRouteMatchApiPayload"));
assert.equal(apiSrc.includes("origin_gps"), true); // admin read
assert.equal(apiSrc.includes("toRouteMatchApiPayload(result)"), true);
assert.equal(/return NextResponse\.json\(\s*\{[\s\S]*origin_gps/.test(apiSrc), false);

const payload = toRouteMatchApiPayload({
  baselineKms: 10,
  bestRouteKms: 12,
  extraDetourKms: 2,
  demandDirectKms: 8,
  pickupInsertIndex: 0,
  dropoffInsertIndex: 1,
  pickupBeforeProviderOrigin: true,
  dropoffAfterProviderDestination: false,
  pickupExtensionKm: 2.1,
  dropoffExtensionKm: 0,
  score: 0.75,
} satisfies DemandInsertionResult);
assert.equal(payload.ok, true);
assert.equal(payload.score, 0.75);
assert.equal(payload.extraDetourKm, 2);
assert.equal(payload.providerBaselineKm, 10);
assert.equal(payload.routeWithDemandKm, 12);
assert.equal(payload.demandDirectKm, 8);
assert.equal(payload.pickupBeforeProviderOrigin, true);
assert.equal(payload.pickupExtensionKm, 2.1);
assert.equal("origin_gps" in payload, false);

const actionsSrc = read("src/components/post/PostActions.tsx");
assert.ok(actionsSrc.includes("providerPostId"));
assert.ok(actionsSrc.includes("providerPostId,"));

console.log("routeMatchAccess.test.ts: ok");
