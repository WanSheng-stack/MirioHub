/**
 * PHASE 6.7B.1A.2 — recommendation + compatibility tests (TEST AG–AZ).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/cargo/cargoCompatibility.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateCargoCompatibility,
  sortedDimensions,
} from "@/lib/cargo/cargoCompatibility";
import {
  parseCargoCapacityV1,
  parseCargoRequirementV1,
  recommendCargoVehicleClass,
  type CargoCapacityV1,
  type CargoRequirementV1,
} from "@/lib/cargo/cargoContract";
import {
  CARGO_PRESET_DIMENSIONS_CM,
  CARGO_RECOMMENDATION_THRESHOLDS,
} from "@/lib/cargo/cargoPolicy";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function req(input: Record<string, unknown>): CargoRequirementV1 {
  const parsed = parseCargoRequirementV1(input);
  if (!parsed.ok) throw new Error(parsed.errorKey);
  return parsed.value;
}

function cap(input: Record<string, unknown>): CargoCapacityV1 {
  const parsed = parseCargoCapacityV1(input);
  if (!parsed.ok) throw new Error(parsed.errorKey);
  return parsed.value;
}

function minItem(overrides: Record<string, unknown> = {}) {
  return {
    category: "moving_box",
    quantity: 1,
    measurement: { kind: "unknown" },
    weight: { kind: "unknown" },
    handlingFlags: [],
    ...overrides,
  };
}

function minReq(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    items: [minItem()],
    pickupHandling: "self",
    dropoffHandling: "self",
    pickupAccess: { level: 0, elevator: "available", carryDistanceMeters: 5 },
    dropoffAccess: { level: 0, elevator: "available", carryDistanceMeters: 5 },
    escortPassengerCount: 0,
    ...overrides,
  };
}

function minCap(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    basis: "current_trip_available_space",
    transportMode: "cargo_van",
    vehicleClass: "small_cargo_van",
    availableSpace: { kind: "unknown" },
    availablePayloadKg: { kind: "unknown" },
    loadingHelp: "not_available",
    unloadingHelp: "not_available",
    escortAccommodation: "not_available",
    supportedHandlingFlags: [],
    ...overrides,
  };
}

function knownBox(overrides: Record<string, unknown> = {}) {
  return minItem({
    measurement: {
      kind: "custom",
      dimensionsCm: { length: 40, width: 30, height: 20 },
    },
    weight: { kind: "known", kgPerUnit: 5 },
    ...overrides,
  });
}

function knownSpace() {
  return {
    kind: "known",
    dimensionsCm: { length: 200, width: 120, height: 120 },
  };
}

// TEST AG — insufficient data
{
  const rec = recommendCargoVehicleClass(req(minReq()));
  assert.equal(rec.confidence, "insufficient_data");
  assert.equal(rec.recommendedClass, null);
  assert.ok(rec.reasons.includes("insufficient_dimensions"));
}

// TEST AH — a few ordinary boxes → advisory small van
{
  const rec = recommendCargoVehicleClass(
    req(
      minReq({
        items: [
          minItem({
            quantity: 3,
            measurement: { kind: "preset", preset: "box_small" },
            weight: { kind: "known", kgPerUnit: 8 },
          }),
        ],
      }),
    ),
  );
  assert.equal(rec.recommendedClass, "small_cargo_van");
  assert.equal(rec.confidence, "estimated");
  assert.ok(rec.reasons.includes("advisory_small_cargo_van"));
}

// TEST AI — bulky / heavier goods raise the advisory class
{
  const rec = recommendCargoVehicleClass(
    req(
      minReq({
        items: [
          minItem({
            category: "furniture",
            measurement: { kind: "preset", preset: "sofa_3_seat" },
            weight: { kind: "known", kgPerUnit: 80 },
          }),
        ],
      }),
    ),
  );
  assert.ok(rec.recommendedClass !== "small_cargo_van");
  assert.ok(rec.reasons.includes("bulky_item_human_confirm"));
  assert.ok(
    rec.recommendedClass === "medium_cargo_van" ||
      rec.recommendedClass === "large_cargo_van" ||
      rec.recommendedClass === "light_truck" ||
      rec.recommendedClass === "box_truck" ||
      rec.recommendedClass === "vehicle_with_trailer",
  );
}

// TEST AJ — recommendation is not a guarantee
{
  const rec = recommendCargoVehicleClass(
    req(
      minReq({
        items: [
          minItem({
            measurement: { kind: "preset", preset: "box_small" },
            weight: { kind: "known", kgPerUnit: 5 },
          }),
        ],
      }),
    ),
  );
  const packed = JSON.stringify(rec);
  assert.equal(packed.includes("guaranteed"), false);
  assert.equal(packed.includes("verified"), false);
  assert.equal(packed.includes("approved"), false);
  assert.equal(packed.toLowerCase().includes('"safe"'), false);
}

// TEST AK — thresholds live in cargoPolicy
{
  assert.ok(CARGO_RECOMMENDATION_THRESHOLDS.smallCargoVan.maxVolumeCm3 > 0);
  assert.ok(CARGO_PRESET_DIMENSIONS_CM.box_small.length > 0);
  const compatSrc = read("src/lib/cargo/cargoCompatibility.ts");
  assert.equal(compatSrc.includes("maxVolumeCm3"), false);
  assert.equal(compatSrc.includes("box_small:"), false);
  const contractSrc = read("src/lib/cargo/cargoContract.ts");
  assert.ok(contractSrc.includes("CARGO_RECOMMENDATION_THRESHOLDS"));
}

function knownPair(
  reqOver: Record<string, unknown> = {},
  capOver: Record<string, unknown> = {},
) {
  return {
    requirement: req(minReq({ items: [knownBox()], ...reqOver })),
    capacity: cap(
      minCap({
        availableSpace: knownSpace(),
        availablePayloadKg: { kind: "known", kg: 400 },
        loadingHelp: "available",
        unloadingHelp: "available",
        escortAccommodation: "available",
        ...capOver,
      }),
    ),
  };
}

// TEST AL — item fits after rotating axes
{
  const { requirement, capacity } = knownPair({
    items: [
      knownBox({
        measurement: {
          kind: "custom",
          dimensionsCm: { length: 100, width: 10, height: 10 },
        },
      }),
    ],
  }, {
    availableSpace: {
      kind: "known",
      dimensionsCm: { length: 20, width: 20, height: 120 },
    },
  });
  const item = sortedDimensions({ length: 100, width: 10, height: 10 });
  const space = sortedDimensions({ length: 20, width: 20, height: 120 });
  assert.ok(item[0] <= space[0] && item[1] <= space[1] && item[2] <= space[2]);
  const result = evaluateCargoCompatibility(requirement, capacity);
  assert.equal(result.reasons.includes("item_exceeds_space_dimensions"), false);
  assert.equal(result.requiresHumanConfirmation, true);
}

// TEST AM — cannot fit on any axis order → incompatible
{
  const { requirement, capacity } = knownPair({
    items: [
      knownBox({
        measurement: {
          kind: "custom",
          dimensionsCm: { length: 300, width: 300, height: 300 },
        },
      }),
    ],
  });
  const result = evaluateCargoCompatibility(requirement, capacity);
  assert.equal(result.status, "incompatible");
  assert.ok(result.reasons.includes("item_exceeds_space_dimensions"));
}

// TEST AN — known total volume exceeds remaining space
{
  const { requirement, capacity } = knownPair({
    items: [
      knownBox({
        quantity: 99,
        measurement: {
          kind: "custom",
          dimensionsCm: { length: 100, width: 100, height: 100 },
        },
      }),
    ],
  });
  const result = evaluateCargoCompatibility(requirement, capacity);
  assert.equal(result.status, "incompatible");
  assert.ok(result.reasons.includes("total_volume_exceeds_available_space"));
}

// TEST AO — volume under the remaining cube is not a guaranteed fit
{
  const { requirement, capacity } = knownPair();
  const result = evaluateCargoCompatibility(requirement, capacity);
  const packed = JSON.stringify(result);
  assert.equal(packed.includes("guaranteed"), false);
  assert.equal(result.requiresHumanConfirmation, true);
}

// TEST AP — total weight exceeds remaining payload
{
  const { requirement, capacity } = knownPair(
    {
      items: [knownBox({ quantity: 10, weight: { kind: "known", kgPerUnit: 50 } })],
    },
    { availablePayloadKg: { kind: "known", kg: 100 } },
  );
  const result = evaluateCargoCompatibility(requirement, capacity);
  assert.equal(result.status, "incompatible");
  assert.ok(result.reasons.includes("total_weight_exceeds_available_payload"));
}

// TEST AQ — unknown item dimensions → needs_confirmation
{
  const result = evaluateCargoCompatibility(
    req(minReq({ items: [minItem({ weight: { kind: "known", kgPerUnit: 5 } })] })),
    cap(minCap({ availableSpace: knownSpace(), availablePayloadKg: { kind: "known", kg: 100 } })),
  );
  assert.notEqual(result.status, "incompatible");
  assert.ok(result.reasons.includes("item_dimensions_unknown"));
  assert.equal(result.status, "needs_confirmation");
}

// TEST AR — unknown item weight → needs_confirmation
{
  const result = evaluateCargoCompatibility(
    req(minReq({ items: [knownBox({ weight: { kind: "unknown" } })] })),
    cap(
      minCap({
        availableSpace: knownSpace(),
        availablePayloadKg: { kind: "known", kg: 100 },
      }),
    ),
  );
  assert.equal(result.status, "needs_confirmation");
  assert.ok(result.reasons.includes("item_weight_unknown"));
}

// TEST AS — provider space unknown
{
  const result = evaluateCargoCompatibility(
    req(minReq({ items: [knownBox()] })),
    cap(minCap({ availablePayloadKg: { kind: "known", kg: 100 } })),
  );
  assert.equal(result.status, "needs_confirmation");
  assert.ok(result.reasons.includes("provider_space_unknown"));
}

// TEST AT — provider payload unknown
{
  const result = evaluateCargoCompatibility(
    req(minReq({ items: [knownBox()] })),
    cap(minCap({ availableSpace: knownSpace() })),
  );
  assert.equal(result.status, "needs_confirmation");
  assert.ok(result.reasons.includes("provider_payload_unknown"));
}

// TEST AU — special handling flag → needs_confirmation
{
  const { requirement, capacity } = knownPair({
    items: [knownBox({ handlingFlags: ["valuable"] })],
  });
  const result = evaluateCargoCompatibility(requirement, capacity);
  assert.equal(result.status, "needs_confirmation");
  assert.ok(result.reasons.includes("special_handling_required"));
}

// TEST AV — escort required vs not_available → incompatible
{
  const { requirement, capacity } = knownPair(
    { escortPassengerCount: 1 },
    { escortAccommodation: "not_available" },
  );
  const result = evaluateCargoCompatibility(requirement, capacity);
  assert.equal(result.status, "incompatible");
  assert.ok(result.reasons.includes("escort_not_available"));
}

// TEST AW — escort requires_confirmation
{
  const { requirement, capacity } = knownPair(
    { escortPassengerCount: 1 },
    { escortAccommodation: "requires_confirmation" },
  );
  const result = evaluateCargoCompatibility(requirement, capacity);
  assert.equal(result.status, "needs_confirmation");
  assert.ok(result.reasons.includes("escort_requires_confirmation"));
}

// TEST AX — loading help requested vs not_available → incompatible
{
  const { requirement, capacity } = knownPair(
    { pickupHandling: "request_provider_help" },
    { loadingHelp: "not_available" },
  );
  const result = evaluateCargoCompatibility(requirement, capacity);
  assert.equal(result.status, "incompatible");
  assert.ok(result.reasons.includes("loading_help_not_available"));
}

// TEST AY — unknown access / stairs → needs_confirmation
{
  const unknownLevel = evaluateCargoCompatibility(
    req(minReq({ items: [knownBox()], pickupAccess: { level: null, elevator: "unknown" } })),
    knownPair().capacity,
  );
  assert.equal(unknownLevel.status, "needs_confirmation");
  assert.ok(unknownLevel.reasons.includes("stairs_or_elevator_confirmation"));

  const stairs = evaluateCargoCompatibility(
    req(
      minReq({
        items: [knownBox()],
        pickupAccess: { level: 3, elevator: "unavailable", carryDistanceMeters: 10 },
      }),
    ),
    knownPair().capacity,
  );
  assert.ok(stairs.reasons.includes("stairs_or_elevator_confirmation"));
}

// TEST AZ — fully known, no conflict → preliminarily_compatible, still human confirm
{
  const { requirement, capacity } = knownPair();
  const result = evaluateCargoCompatibility(requirement, capacity);
  assert.equal(result.status, "preliminarily_compatible");
  assert.equal(result.requiresHumanConfirmation, true);
  assert.equal(result.reasons.length, 0);
}

console.log("cargoCompatibility.test.ts: ok");
