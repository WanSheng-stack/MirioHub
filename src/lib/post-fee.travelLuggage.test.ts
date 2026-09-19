/**
 * PHASE 6.7C.2C.3J-A.2 — Travel luggage + fee contract.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/post-fee.travelLuggage.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CanonicalStage1Error,
  normalizeCanonicalStage1,
} from "@/lib/auth/canonicalStage1Core";
import {
  FREE_LUGGAGE_UNITS_PER_PASSENGER,
  LUGGAGE_UNIT_LARGE,
  LUGGAGE_UNIT_MEDIUM,
  LUGGAGE_UNIT_SMALL,
  LUGGAGE_UNIT_XLARGE,
  calculateFinalFee,
  calculateFinalFeeParts,
  isPassengerFeeScene,
} from "@/lib/post-fee";
import type { PostPayload } from "@/lib/post-payload";
import {
  totalLuggageUnits,
  travelItemUnitsMissingErrorKey,
} from "@/lib/post-payload";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const KMS = 40;

function baseTravelPayload(
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

// Frozen unit weights
assert.equal(LUGGAGE_UNIT_SMALL, 1);
assert.equal(LUGGAGE_UNIT_MEDIUM, 3);
assert.equal(LUGGAGE_UNIT_LARGE, 6);
assert.equal(LUGGAGE_UNIT_XLARGE, 12);
assert.equal(FREE_LUGGAGE_UNITS_PER_PASSENGER, 4);
assert.equal(
  totalLuggageUnits({
    count_small: 1,
    count_medium: 1,
    count_large: 1,
    count_xlarge: 1,
  }),
  1 + 3 + 6 + 12,
);

// Scene classification
assert.equal(
  isPassengerFeeScene(baseTravelPayload({ service_subtype: "passenger" })),
  true,
);
assert.equal(
  isPassengerFeeScene(
    baseTravelPayload({ service_subtype: "passenger_with_small_item" }),
  ),
  true,
);
assert.equal(
  isPassengerFeeScene(
    baseTravelPayload({ service_subtype: "small_item_only", escort_seats: 0 }),
  ),
  false,
);
assert.equal(
  isPassengerFeeScene({
    category: "travel",
    escort_seats: 1,
    service_subtype: "small_item_only",
  }),
  false,
);

// passenger: 1 seat, implied free 4 units product rule; no cargo surcharge
{
  const parts = calculateFinalFeeParts(
    KMS,
    baseTravelPayload({
      service_subtype: "passenger",
      escort_seats: 1,
      max_companions: 1,
      count_small: 0,
      count_medium: 0,
      count_large: 0,
      count_xlarge: 0,
    }),
  );
  assert.equal(parts.isPassengerFeeScene, true);
  assert.equal(parts.freeLuggageUnits, 4);
  assert.equal(parts.demandedLuggageUnits, 0);
  assert.equal(parts.billableExtraUnits, 0);
  assert.ok(parts.humanSeatFee > 0);
  assert.equal(parts.cargoOrSpaceFee, 0);

  const zh = JSON.parse(read("src/messages/zh.json")) as {
    home: { sheet: { passenger_included_luggage_note: string; subtype_desc: { demand: { passenger: string } } } };
  };
  assert.ok(zh.home.sheet.passenger_included_luggage_note.includes("4"));
  assert.ok(zh.home.sheet.subtype_desc.demand.passenger.includes("4"));
  const sheet = read("src/components/home/PublishBottomSheet.tsx");
  assert.ok(sheet.includes("passenger_included_luggage_note"));
  assert.ok(sheet.includes('service_subtype === "passenger"'));
}

// passenger_with_small_item: 0 units → publish fail
{
  assert.equal(
    travelItemUnitsMissingErrorKey(
      baseTravelPayload({
        service_subtype: "passenger_with_small_item",
        count_small: 0,
      }),
    ),
    "error.luggage_items_required",
  );
  const builderSrc = read("src/lib/post-form/buildPayload.ts");
  assert.ok(builderSrc.includes("travelItemUnitsMissingErrorKey"));
  assert.throws(
    () =>
      normalizeCanonicalStage1({
        post_type: "demand",
        category: "travel",
        service_subtype: "passenger_with_small_item",
        title: "",
        origin_address: "A",
        destination_address: "B",
        departure_date: "2026-09-10",
        departure_time: "14:30",
        time_buffer: 0,
        waypoints: [],
        share_mode: "share",
        count_small: 0,
        count_medium: 0,
        count_large: 0,
        count_xlarge: 0,
        escort_seats: 1,
        max_companions: 1,
        bump_fee: 0,
        currency: "EUR",
        locale: "en",
        transport_mode: "car",
      }),
    (err: unknown) =>
      err instanceof CanonicalStage1Error &&
      err.errorKey === "error.luggage_items_required",
  );
}

// 1 person × 4 units == passenger price; 5 units bills 1 extra
{
  const passenger = calculateFinalFeeParts(
    KMS,
    baseTravelPayload({
      service_subtype: "passenger",
      escort_seats: 1,
      max_companions: 1,
    }),
  );
  const four = calculateFinalFeeParts(
    KMS,
    baseTravelPayload({
      service_subtype: "passenger_with_small_item",
      escort_seats: 1,
      max_companions: 1,
      count_small: 4,
    }),
  );
  assert.equal(four.humanSeatFee, passenger.humanSeatFee);
  assert.equal(four.cargoOrSpaceFee, 0);
  assert.equal(four.total, passenger.total);
  assert.equal(four.billableExtraUnits, 0);

  const five = calculateFinalFeeParts(
    KMS,
    baseTravelPayload({
      service_subtype: "passenger_with_small_item",
      escort_seats: 1,
      max_companions: 1,
      count_small: 5,
    }),
  );
  assert.equal(five.billableExtraUnits, 1);
  assert.equal(five.humanSeatFee, passenger.humanSeatFee);
  assert.ok(five.cargoOrSpaceFee > 0);
  assert.ok(five.total > passenger.total);
  assert.equal(
    five.cargoOrSpaceFee,
    1 * (five.baseRouteFee * 0.075),
  );
}

// 2 people: 8 free, 9 → 1 billable
{
  const eight = calculateFinalFeeParts(
    KMS,
    baseTravelPayload({
      service_subtype: "passenger_with_small_item",
      escort_seats: 2,
      max_companions: 2,
      count_small: 8,
    }),
  );
  assert.equal(eight.freeLuggageUnits, 8);
  assert.equal(eight.billableExtraUnits, 0);
  assert.equal(eight.cargoOrSpaceFee, 0);

  const nine = calculateFinalFeeParts(
    KMS,
    baseTravelPayload({
      service_subtype: "passenger_with_small_item",
      escort_seats: 2,
      max_companions: 2,
      count_small: 9,
    }),
  );
  assert.equal(nine.freeLuggageUnits, 8);
  assert.equal(nine.billableExtraUnits, 1);
  assert.equal(nine.cargoOrSpaceFee, 1 * (nine.baseRouteFee * 0.075));
}

// small_item_only: 0 units fail; no human seat fee; cargo coefficients
{
  assert.equal(
    travelItemUnitsMissingErrorKey(
      baseTravelPayload({
        service_subtype: "small_item_only",
        escort_seats: 0,
        max_companions: 0,
        share_mode: null,
        count_small: 0,
      }),
    ),
    "error.luggage_items_required",
  );
  assert.throws(
    () =>
      normalizeCanonicalStage1({
        post_type: "demand",
        category: "travel",
        service_subtype: "small_item_only",
        title: "",
        origin_address: "A",
        destination_address: "B",
        departure_date: "2026-09-10",
        departure_time: "14:30",
        time_buffer: 0,
        waypoints: [],
        share_mode: null,
        count_small: 0,
        count_medium: 0,
        count_large: 0,
        count_xlarge: 0,
        escort_seats: 0,
        max_companions: 0,
        bump_fee: 0,
        currency: "EUR",
        locale: "en",
        transport_mode: "car",
      }),
    (err: unknown) =>
      err instanceof CanonicalStage1Error &&
      err.errorKey === "error.luggage_items_required",
  );

  const sheet = read("src/components/home/PublishBottomSheet.tsx");
  assert.ok(sheet.includes("travelItemUnitsMissingErrorKey"));
  assert.ok(
    sheet.indexOf("travelItemUnitsMissingErrorKey") <
      sheet.indexOf("activation-eligibility"),
  );

  const parts = calculateFinalFeeParts(
    KMS,
    baseTravelPayload({
      service_subtype: "small_item_only",
      escort_seats: 0,
      max_companions: 0,
      share_mode: null,
      count_small: 1,
    }),
  );
  assert.equal(parts.isPassengerFeeScene, false);
  assert.equal(parts.humanSeatFee, 0);
  assert.equal(parts.freeLuggageUnits, 0);
  assert.equal(parts.cargoOrSpaceFee, parts.baseRouteFee * 0.25);
  assert.equal(parts.total, parts.cargoOrSpaceFee);
}

// Three subtypes must not collapse to the same fee via category===travel bug
{
  const passenger = calculateFinalFee(
    KMS,
    baseTravelPayload({ service_subtype: "passenger", escort_seats: 1 }),
  );
  const withExtra = calculateFinalFee(
    KMS,
    baseTravelPayload({
      service_subtype: "passenger_with_small_item",
      escort_seats: 1,
      count_small: 5,
    }),
  );
  const itemOnly = calculateFinalFee(
    KMS,
    baseTravelPayload({
      service_subtype: "small_item_only",
      escort_seats: 0,
      share_mode: null,
      count_small: 1,
    }),
  );
  assert.notEqual(passenger, withExtra);
  assert.notEqual(passenger, itemOnly);
  assert.notEqual(withExtra, itemOnly);

  const feeSrc = read("src/lib/post-fee.ts");
  assert.equal(
    /payload\.category === ["']travel["']\s*\|\|/.test(feeSrc),
    false,
  );
  assert.ok(feeSrc.includes('service_subtype === "passenger"'));
  assert.ok(feeSrc.includes("isPassengerFeeScene"));
  const canon = read("src/lib/auth/canonicalStage1Core.ts");
  assert.ok(canon.includes("service_subtype: payload.service_subtype"));
}

// i18n labels
{
  for (const locale of ["zh", "en", "sr"] as const) {
    const msg = JSON.parse(read(`src/messages/${locale}.json`)) as {
      home: {
        sheet: {
          subtype: {
            demand: {
              passenger: string;
              passenger_with_small_item: string;
              small_item_only: string;
            };
          };
          subtype_desc: {
            demand: {
              passenger: string;
              passenger_with_small_item: string;
              small_item_only: string;
            };
          };
        };
      };
      error: { luggage_items_required: string };
    };
    assert.ok(msg.home.sheet.subtype.demand.passenger.length > 0);
    assert.ok(
      msg.home.sheet.subtype.demand.passenger_with_small_item.length > 0,
    );
    assert.ok(msg.home.sheet.subtype.demand.small_item_only.length > 0);
    assert.ok(msg.home.sheet.subtype_desc.demand.passenger.includes("4") || locale === "sr");
    assert.ok(msg.error.luggage_items_required.length > 0);
  }
  const zh = JSON.parse(read("src/messages/zh.json")) as {
    home: { sheet: { subtype: { demand: Record<string, string> } } };
  };
  assert.ok(
    zh.home.sheet.subtype.demand.passenger_with_small_item.includes("额外"),
  );
  assert.ok(
    zh.home.sheet.subtype.demand.small_item_only.includes("不同行"),
  );
  const en = JSON.parse(read("src/messages/en.json")) as {
    home: { sheet: { subtype: { demand: Record<string, string> } } };
  };
  assert.ok(
    en.home.sheet.subtype.demand.passenger_with_small_item
      .toLowerCase()
      .includes("extra"),
  );
  assert.ok(
    en.home.sheet.subtype.demand.small_item_only
      .toLowerCase()
      .includes("does not travel"),
  );
}

console.log("post-fee.travelLuggage.test.ts: PASS");
