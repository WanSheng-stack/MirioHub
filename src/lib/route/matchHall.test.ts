/**
 * PHASE 6.5B — match hall ranking, empty state, privacy, backend guard.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/route/matchHall.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canOfferMatchAction,
  compareMatchHallRows,
  formatRoutePercent,
  isMatchHallEmpty,
  matchCardShellClass,
  matchCardTone,
  matchHallDtoHasPrivateField,
  MATCH_HALL_EXCLUDED_STATUSES,
  MATCH_HALL_STATUSES,
  shouldComputeRealRouteScore,
  sortMatchHallRows,
  type MatchHallCardDto,
} from "@/lib/route/matchHall";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

assert.deepEqual(
  [...MATCH_HALL_STATUSES],
  ["active", "matched", "pending_completion", "completed"],
);
assert.deepEqual([...MATCH_HALL_EXCLUDED_STATUSES], ["draft", "canceled"]);

// TEST 1 — status is not a ranking signal
{
  const rows = sortMatchHallRows(
    [
      { id: "a", departure_date: "2026-09-07", score: 0.91, status: "active" },
      { id: "c", departure_date: "2026-09-07", score: 0.86, status: "pending_completion" },
      { id: "k", departure_date: "2026-09-07", score: 0.94, status: "completed" },
    ],
    "2026-09-07",
  );
  assert.deepEqual(
    rows.map((r) => [formatRoutePercent(r.score), r.status]),
    [
      [94, "completed"],
      [91, "active"],
      [86, "pending_completion"],
    ],
  );
}

// TEST 2 — same-day beats other-day even when other-day is active 99%
{
  const rows = sortMatchHallRows(
    [
      { id: "hot", departure_date: "2026-09-08", score: 0.99, status: "active" },
      { id: "done", departure_date: "2026-09-07", score: 0.7, status: "completed" },
    ],
    "2026-09-07",
  );
  assert.equal(rows[0]?.id, "done");
  assert.equal(rows[1]?.id, "hot");
}

// TEST 3 — same day + same status → score DESC
{
  const rows = sortMatchHallRows(
    [
      { id: "m", departure_date: "2026-09-07", score: 0.82, status: "active" },
      { id: "h", departure_date: "2026-09-07", score: 0.95, status: "active" },
      { id: "l", departure_date: "2026-09-07", score: 0.71, status: "active" },
    ],
    "2026-09-07",
  );
  assert.deepEqual(
    rows.map((r) => formatRoutePercent(r.score)),
    [95, 82, 71],
  );
}

assert.equal(compareMatchHallRows(
  { id: "x", departure_date: "d", score: 0.5, status: "completed" },
  { id: "y", departure_date: "d", score: 0.5, status: "active" },
  "d",
) < 0, true); // id tie-break only

// TEST 4 — active card
assert.equal(matchCardTone("active"), "active");
assert.equal(canOfferMatchAction("active"), true);
assert.ok(matchCardShellClass("active", "demand").includes("emerald"));

// TEST 5 — in-progress card
assert.equal(matchCardTone("matched"), "in_progress");
assert.equal(matchCardTone("pending_completion"), "in_progress");
assert.equal(canOfferMatchAction("matched"), false);
assert.equal(canOfferMatchAction("pending_completion"), false);
assert.ok(matchCardShellClass("in_progress", "provider").includes("zinc"));

// TEST 6 — completed card
assert.equal(matchCardTone("completed"), "completed");
assert.equal(canOfferMatchAction("completed"), false);
assert.ok(matchCardShellClass("completed", "demand").includes("zinc"));

// TEST 7 — only completed is not empty
assert.equal(
  isMatchHallEmpty([{ status: "completed", score: 0.8 }]),
  false,
);

// TEST 8 — truly empty
assert.equal(isMatchHallEmpty([]), true);

// TEST 9 — completed still uses real score path
assert.equal(shouldComputeRealRouteScore("completed"), true);
assert.equal(shouldComputeRealRouteScore("active"), true);
const loaderSrc = read("src/lib/route/buildMatchHall.ts");
assert.ok(loaderSrc.includes("calculateRouteMatchScore"));
assert.equal(loaderSrc.includes("* 2.5"), false);
assert.equal(loaderSrc.includes("isOrderedRouteCompatible"), false);
assert.ok(loaderSrc.includes("shouldComputeRealRouteScore"));

// TEST 10 — backend rejects non-active match
const confirmSql = read("supabase/migrate_orders_to_posts.sql");
assert.ok(confirmSql.includes("if v_post.status <> 'active'"));
assert.ok(confirmSql.includes("NOT_ACTIVE"));
const actionsSrc = read("src/components/post/PostActions.tsx");
assert.ok(actionsSrc.includes("confirm_match"));
assert.ok(actionsSrc.includes('post.status === "active"'));

const dto = {
  id: "1",
  user_id: "u",
  post_type: "demand",
  status: "completed",
  category: "travel",
  origin_address: "A",
  destination_address: "B",
  waypoints: null,
  departure_date: "2026-09-07",
  departure_time_window: "08:00",
  fee_amount: 10,
  delivery_mode: "spot",
  share_mode: "share",
  escort_seats: 0,
  max_companions: 1,
  count_small: 0,
  count_medium: 0,
  count_large: 0,
  count_xlarge: 0,
  authorName: "Ana",
  completedTripCount: 12,
  score: 0.94,
  extraDetourKm: 3.1,
  providerBaselineKm: 100,
  routeWithDemandKm: 103.1,
  demandDirectKm: 40,
  pickupBeforeProviderOrigin: false,
  dropoffAfterProviderDestination: false,
  pickupExtensionKm: 0,
  dropoffExtensionKm: 0,
} satisfies MatchHallCardDto;
assert.equal(matchHallDtoHasPrivateField(dto), false);

const cardSrc = read("src/components/match/MatchPostCard.tsx");
assert.ok(cardSrc.includes("canOfferMatchAction"));
assert.ok(cardSrc.includes("viewDetails"));
assert.equal(cardSrc.includes("New member"), false);
assert.equal(cardSrc.includes("created_at"), false);
assert.equal(cardSrc.includes("Posted"), false);

const pageSrc = read("src/app/[locale]/posts/[id]/matches/page.tsx");
assert.equal(pageSrc.includes("Same day"), false);
assert.equal(pageSrc.includes("Available"), false);
assert.ok(pageSrc.includes("isMatchHallEmpty"));

console.log("matchHall.test.ts: ok");
