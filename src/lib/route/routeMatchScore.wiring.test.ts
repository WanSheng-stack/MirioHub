/**
 * PHASE 6.5A — production route-score path must not use placeholder km / string gates.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/route/routeMatchScore.wiring.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeDemandMatchInfo,
  computeProviderMatchInfo,
} from "@/lib/hall-route-match";
import {
  evaluateCapacityOnly,
  ROUTE_MATCH_GOOD_SCORE,
  ROUTE_MATCH_MIN_SCORE,
} from "@/lib/post-route-match";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const scoreSrc = read("src/lib/route/calculateRouteMatchScore.ts");
const insertionSrc = read("src/lib/route/findBestDemandInsertion.ts");
const osrmSrc = read("src/lib/route/osrmTable.ts");
const apiSrc = read("src/app/api/posts/evaluate-route-match/route.ts");
const providerMatchSrc = read("src/lib/post-form/providerMatch.ts");
const hallSrc = read("src/lib/hall-route-match.ts");

assert.equal(ROUTE_MATCH_MIN_SCORE, 0.7);
assert.equal(ROUTE_MATCH_GOOD_SCORE, 0.9);

for (const [name, src] of [
  ["calculateRouteMatchScore", scoreSrc],
  ["findBestDemandInsertion", insertionSrc],
  ["osrmTable", osrmSrc],
  ["evaluate-route-match", apiSrc],
] as const) {
  assert.equal(src.includes("isOrderedRouteCompatible"), false, `${name} string gate`);
  assert.equal(src.includes("estimateSliceKmsFromRoute"), false, `${name} segment average`);
  assert.equal(src.includes("approximateSegmentKmsForStacking"), false, `${name} softDetour`);
  assert.equal(src.includes("* 2.5"), false, `${name} address.length km`);
}

assert.equal(providerMatchSrc.includes("evaluateRouteAndCapacityMatch"), false);
assert.equal(providerMatchSrc.includes("approximateSegmentKmsForStacking"), false);
assert.equal(providerMatchSrc.includes("* 2.5"), false);
assert.ok(providerMatchSrc.includes("/api/posts/evaluate-route-match"));
assert.ok(providerMatchSrc.includes("evaluateCapacityOnly"));
assert.ok(providerMatchSrc.includes("providerPostId"));
assert.ok(apiSrc.includes("evaluateRouteMatchAccess"));
assert.ok(apiSrc.includes("evaluateMatchAdmission"));
assert.ok(insertionSrc.includes("pickupBeforeProviderOrigin"));

assert.ok(apiSrc.includes("calculateRouteMatchScore"));
assert.ok(scoreSrc.includes("fetchOsrmDistanceMatrixKm"));
assert.ok(scoreSrc.includes("origin_gps"));
assert.ok(scoreSrc.includes("geocodeAddress"));
assert.ok(osrmSrc.includes("import \"server-only\""));
assert.ok(scoreSrc.includes("import \"server-only\""));
assert.ok(osrmSrc.includes("/table/v1/driving"));
assert.ok(osrmSrc.includes("OSRM_DRIVING_HOST"));

assert.equal(hallSrc.includes("approximateSegmentKmsForStacking"), false);
assert.equal(hallSrc.includes("isOrderedRouteCompatible"), false);
assert.equal(computeProviderMatchInfo([], []).size, 0);
assert.equal(computeDemandMatchInfo([], []).size, 0);

const overCapacity = evaluateCapacityOnly({
  newOrderPassengers: 5,
  newOrderUnits: 1,
  currentTotalPassengers: 1,
  currentTotalUnits: 1,
});
assert.equal(overCapacity.isCapacityAllowed, false);

const spaceWarn = evaluateCapacityOnly({
  newOrderPassengers: 1,
  newOrderUnits: 10,
  currentTotalPassengers: 1,
  currentTotalUnits: 20,
});
assert.equal(spaceWarn.isCapacityAllowed, true);
assert.equal(spaceWarn.showSpaceWarning, true);

console.log("routeMatchScore.wiring.test.ts: ok");
