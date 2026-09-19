/**
 * PHASE 6.7C.2C.3J-A.2B — address search UI + transport preflight.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/geo/addressSearchUiPreflight.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADDRESS_SEARCH_LIMIT,
  ADDRESS_SEARCH_PAGE_SIZE,
  buildNominatimCandidateSearchUrl,
} from "@/lib/geo/addressSearch";
import {
  transportModeMissingErrorKey,
  travelItemUnitsMissingErrorKey,
} from "@/lib/post-payload";
import { publishTransportModesForSubtype } from "@/lib/auth/publishTransportMode";
import {
  FREE_LUGGAGE_UNITS_PER_PASSENGER,
  calculateFinalFeeParts,
} from "@/lib/post-fee";
import type { PostPayload } from "@/lib/post-payload";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

// ── Limits + wide POI search (no settlement-only) ───────────────────────────
{
  assert.equal(ADDRESS_SEARCH_LIMIT, 15);
  assert.equal(ADDRESS_SEARCH_PAGE_SIZE, 5);
  const url = buildNominatimCandidateSearchUrl({
    query: "airport",
    countryCode: "RS",
  });
  assert.ok(url);
  assert.ok(url!.includes("limit=15"));
  assert.equal(url!.includes("featureType"), false);
  assert.equal(url!.includes("featureType=settlement"), false);
}

// ── Inline responsive structure + show-more without second fetch ────────────
{
  const field = read("src/components/home/AddressSearchField.tsx");
  assert.ok(field.includes("flex-nowrap"));
  assert.ok(field.includes("max-[360px]:flex-wrap"));
  assert.ok(field.includes('compact'));
  assert.ok(field.includes("ADDRESS_SEARCH_PAGE_SIZE"));
  assert.ok(field.includes("showMoreCandidates"));
  assert.ok(field.includes("max-h-56 overflow-y-auto"));
  assert.ok(field.includes("show_more"));
  // Show more must only bump visibleCount — never call runSearch / fetch again.
  const showMoreBody = field.slice(
    field.indexOf("function showMoreCandidates"),
    field.indexOf("function selectCandidate"),
  );
  assert.ok(showMoreBody.includes("setVisibleCount"));
  assert.equal(showMoreBody.includes("fetch("), false);
  assert.equal(showMoreBody.includes("runSearch"), false);

  const country = read("src/components/home/AddressCountrySelect.tsx");
  assert.ok(country.includes("compact"));
  assert.ok(country.includes("countryCode"));
  assert.ok(country.includes("▾"));
}

// ── Human travel subtypes auto-car; small_item clears illegal mode ──────────
{
  const formSrc = read("src/lib/post-form/usePostFormState.ts");
  assert.ok(formSrc.includes('transport_mode: "car"'));
  assert.ok(formSrc.includes('transport_mode = "car"'));
  assert.ok(formSrc.includes('service_subtype === "passenger"'));
  assert.ok(
    formSrc.includes('service_subtype === "passenger_with_small_item"'),
  );
  assert.ok(
    publishTransportModesForSubtype("travel", "passenger").includes("car"),
  );
  assert.ok(
    publishTransportModesForSubtype(
      "travel",
      "passenger_with_small_item",
    ).includes("car"),
  );
  assert.deepEqual(
    [...publishTransportModesForSubtype("travel", "passenger")],
    ["car"],
  );
}

// ── small_item_only missing transport fails before auth ─────────────────────
{
  assert.equal(
    transportModeMissingErrorKey({
      category: "travel",
      transport_mode: null,
    }),
    "error.transport_mode_required",
  );
  assert.equal(
    transportModeMissingErrorKey({
      category: "travel",
      transport_mode: "",
    }),
    "error.transport_mode_required",
  );
  assert.equal(
    transportModeMissingErrorKey({
      category: "travel",
      transport_mode: "bicycle",
    }),
    null,
  );

  const sheet = read("src/components/home/PublishBottomSheet.tsx");
  assert.ok(sheet.includes("transportModeMissingErrorKey"));
  assert.ok(
    sheet.indexOf("transportModeMissingErrorKey") <
      sheet.indexOf("signInAnonymously"),
  );
  assert.ok(
    sheet.indexOf("transportModeMissingErrorKey") <
      sheet.indexOf("challenge-init"),
  );
  assert.ok(sheet.includes("transportError"));
  assert.ok(sheet.includes("error.transport_mode_required"));

  // Server parse remains fail-closed (not relaxed).
  const parseSrc = read("src/lib/auth/publishTransportMode.ts");
  assert.ok(parseSrc.includes("TRANSPORT_MODE_REQUIRED_KEY"));
  assert.ok(parseSrc.includes("Fail-closed"));
}

// ── Luggage fee regression (must not regress 3J-A.2) ────────────────────────
{
  function base(
    overrides: Partial<PostPayload> = {},
  ): PostPayload {
    return {
      post_type: "demand",
      category: "travel",
      phone_id: 0,
      raw_phone: "",
      normalized_phone: "",
      departure_date: "2026-09-10",
      departure_time_window: "14:30-14:30",
      estimated_arrival_time: null,
      fee_amount: null,
      count_small: 0,
      count_medium: 0,
      count_large: 0,
      count_xlarge: 0,
      bump_fee: 0,
      escort_seats: 1,
      max_companions: 1,
      share_mode: "share",
      delivery_mode: null,
      service_subtype: "passenger",
      transport_mode: "car",
      ...overrides,
    };
  }
  assert.equal(FREE_LUGGAGE_UNITS_PER_PASSENGER, 4);
  const passenger = calculateFinalFeeParts(40, base());
  assert.equal(passenger.freeLuggageUnits, 4);
  assert.equal(passenger.humanSeatFee > 0, true);
  assert.equal(passenger.cargoOrSpaceFee, 0);

  const four = calculateFinalFeeParts(
    40,
    base({
      service_subtype: "passenger_with_small_item",
      count_small: 4,
    }),
  );
  assert.equal(four.total, passenger.total);

  const five = calculateFinalFeeParts(
    40,
    base({
      service_subtype: "passenger_with_small_item",
      count_small: 5,
    }),
  );
  assert.equal(five.billableExtraUnits, 1);

  const itemOnly = calculateFinalFeeParts(
    40,
    base({
      service_subtype: "small_item_only",
      escort_seats: 0,
      share_mode: null,
      count_small: 1,
      transport_mode: "bicycle",
    }),
  );
  assert.equal(itemOnly.isPassengerFeeScene, false);
  assert.equal(itemOnly.humanSeatFee, 0);
  assert.equal(itemOnly.freeLuggageUnits, 0);

  assert.equal(
    travelItemUnitsMissingErrorKey(
      base({ service_subtype: "small_item_only", count_small: 0 }),
    ),
    "error.luggage_items_required",
  );
  assert.equal(
    travelItemUnitsMissingErrorKey(
      base({
        service_subtype: "passenger_with_small_item",
        count_small: 0,
      }),
    ),
    "error.luggage_items_required",
  );
}

// ── i18n show_more ──────────────────────────────────────────────────────────
{
  for (const locale of ["zh", "en", "sr"] as const) {
    const msg = JSON.parse(read(`src/messages/${locale}.json`)) as {
      home: { address: { show_more: string } };
    };
    assert.ok(msg.home.address.show_more.length > 0);
  }
}

// Deferred Maps note present; no Maps link implementation
{
  const src = read("src/lib/geo/addressSearch.ts");
  assert.ok(src.includes("Deferred cleanup"));
  assert.ok(src.toLowerCase().includes("google maps"));
  const field = read("src/components/home/AddressSearchField.tsx");
  assert.equal(field.includes("google.com/maps"), false);
  assert.equal(field.includes("maps.google"), false);
}

console.log("addressSearchUiPreflight.test.ts: PASS");
