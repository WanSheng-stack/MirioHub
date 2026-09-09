/**
 * PHASE 6.7B.1A.2 — CargoRequirement / CargoCapacity parser tests (TEST A–AF).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/cargo/cargoContract.test.ts
 */

import assert from "node:assert/strict";
import {
  parseCargoCapacityV1,
  parseCargoRequirementV1,
} from "@/lib/cargo/cargoContract";

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

function minRequirement(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    items: [minItem()],
    pickupHandling: "self",
    dropoffHandling: "self",
    pickupAccess: { level: null, elevator: "unknown" },
    dropoffAccess: { level: null, elevator: "unknown" },
    escortPassengerCount: 0,
    ...overrides,
  };
}

function minCapacity(overrides: Record<string, unknown> = {}) {
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

function rejectKey(input: unknown, parser: typeof parseCargoRequirementV1) {
  const result = parser(input);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected reject");
  return result.errorKey;
}

// TEST A — legal minimum requirement
{
  const result = parseCargoRequirementV1(minRequirement());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.version, 1);
    assert.equal(result.value.items.length, 1);
    assert.equal(result.value.escortPassengerCount, 0);
    assert.equal(result.value.note, undefined);
  }
}

// TEST B — empty items reject
{
  assert.equal(
    rejectKey(minRequirement({ items: [] }), parseCargoRequirementV1),
    "error.cargo_items_required",
  );
}

// TEST C — more than 20 items reject
{
  const items = Array.from({ length: 21 }, () => minItem());
  assert.equal(
    rejectKey(minRequirement({ items }), parseCargoRequirementV1),
    "error.cargo_too_many_items",
  );
}

// TEST D — unknown top-level key reject
{
  assert.equal(
    rejectKey(minRequirement({ extra: true }), parseCargoRequirementV1),
    "error.cargo_unknown_key",
  );
}

// TEST E — unknown nested key reject
{
  assert.equal(
    rejectKey(
      minRequirement({ items: [minItem({ foo: 1 })] }),
      parseCargoRequirementV1,
    ),
    "error.cargo_unknown_key",
  );
}

// TEST F — category other without description reject
{
  assert.equal(
    rejectKey(
      minRequirement({ items: [minItem({ category: "other" })] }),
      parseCargoRequirementV1,
    ),
    "error.cargo_description_required",
  );
}

// TEST G — blank description: other rejects; other categories normalize
{
  assert.equal(
    rejectKey(
      minRequirement({
        items: [minItem({ category: "other", description: "   " })],
      }),
      parseCargoRequirementV1,
    ),
    "error.cargo_description_required",
  );
  const okBlank = parseCargoRequirementV1(
    minRequirement({ items: [minItem({ description: "   " })] }),
  );
  assert.equal(okBlank.ok, true);
  if (okBlank.ok) assert.equal(okBlank.value.items[0].description, undefined);
}

// TEST H — description > 120 reject
{
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({ items: [minItem({ description: "x".repeat(121) })] }),
    ).ok,
    false,
  );
}

// TEST I — note > 300 reject
{
  assert.equal(
    parseCargoRequirementV1(minRequirement({ note: "n".repeat(301) })).ok,
    false,
  );
}

// TEST J — invalid quantity
{
  for (const quantity of [0, -1, 1.5, "1", Number.NaN, Infinity, true, {}, []]) {
    assert.equal(
      rejectKey(
        minRequirement({ items: [minItem({ quantity })] }),
        parseCargoRequirementV1,
      ),
      "error.cargo_invalid_quantity",
      String(quantity),
    );
  }
}

// TEST K — quantity 1/99 ok, 100 reject
{
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({ items: [minItem({ quantity: 1 })] }),
    ).ok,
    true,
  );
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({ items: [minItem({ quantity: 99 })] }),
    ).ok,
    true,
  );
  assert.equal(
    rejectKey(
      minRequirement({ items: [minItem({ quantity: 100 })] }),
      parseCargoRequirementV1,
    ),
    "error.cargo_invalid_quantity",
  );
}

// TEST L — custom dimensions legal
{
  const result = parseCargoRequirementV1(
    minRequirement({
      items: [
        minItem({
          measurement: {
            kind: "custom",
            dimensionsCm: { length: 40, width: 30, height: 20 },
          },
        }),
      ],
    }),
  );
  assert.equal(result.ok, true);
}

// TEST M — invalid custom dimensions
{
  const badDims = [0, -1, 1.5, "10", 2001];
  for (const length of badDims) {
    assert.equal(
      parseCargoRequirementV1(
        minRequirement({
          items: [
            minItem({
              measurement: {
                kind: "custom",
                dimensionsCm: { length, width: 10, height: 10 },
              },
            }),
          ],
        }),
      ).ok,
      false,
      String(length),
    );
  }
}

// TEST N — preset allowlist; unknown preset reject
{
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({
        items: [minItem({ measurement: { kind: "preset", preset: "box_small" } })],
      }),
    ).ok,
    true,
  );
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({
        items: [minItem({ measurement: { kind: "preset", preset: "hover_crate" } })],
      }),
    ).ok,
    false,
  );
}

// TEST O — measurement unknown legal
{
  const result = parseCargoRequirementV1(minRequirement());
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.items[0].measurement.kind, "unknown");
}

// TEST P — known weight, at most one decimal
{
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({
        items: [minItem({ weight: { kind: "known", kgPerUnit: 12 } })],
      }),
    ).ok,
    true,
  );
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({
        items: [minItem({ weight: { kind: "known", kgPerUnit: 12.5 } })],
      }),
    ).ok,
    true,
  );
}

// TEST Q — invalid weight
{
  for (const kgPerUnit of [0, -1, 12.55, "12", Number.NaN, Infinity]) {
    assert.equal(
      parseCargoRequirementV1(
        minRequirement({
          items: [minItem({ weight: { kind: "known", kgPerUnit } })],
        }),
      ).ok,
      false,
      String(kgPerUnit),
    );
  }
}

// TEST R — handling flags unknown / duplicate / non-array
{
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({ items: [minItem({ handlingFlags: "fragile" })] }),
    ).ok,
    false,
  );
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({ items: [minItem({ handlingFlags: ["nope"] })] }),
    ).ok,
    false,
  );
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({
        items: [minItem({ handlingFlags: ["fragile", "fragile"] })],
      }),
    ).ok,
    false,
  );
  const ordered = parseCargoRequirementV1(
    minRequirement({
      items: [minItem({ handlingFlags: ["valuable", "fragile"] })],
    }),
  );
  assert.equal(ordered.ok, true);
  if (ordered.ok) {
    assert.deepEqual(ordered.value.items[0].handlingFlags, [
      "fragile",
      "valuable",
    ]);
  }
}

// TEST S — hazardous / illegal field names recursive reject
{
  for (const key of [
    "hazardous",
    "dangerous_goods",
    "weapon",
    "illegal_goods",
    "contraband",
    "explosive",
    "flammable",
  ]) {
    assert.equal(
      rejectKey(minRequirement({ [key]: true }), parseCargoRequirementV1),
      "error.cargo_private_field_forbidden",
      key,
    );
  }
}

// TEST T — private / contact / identity / fee / location / photo reject
{
  for (const key of [
    "phone",
    "email",
    "plate",
    "address",
    "gps",
    "user_id",
    "post_id",
    "fee",
    "bid",
    "pickup_code",
    "photo_url",
  ]) {
    assert.equal(
      rejectKey(minRequirement({ [key]: "x" }), parseCargoRequirementV1),
      "error.cargo_private_field_forbidden",
      key,
    );
  }
}

// TEST U — escort 0/1 ok, 2 reject
{
  assert.equal(
    parseCargoRequirementV1(minRequirement({ escortPassengerCount: 0 })).ok,
    true,
  );
  assert.equal(
    parseCargoRequirementV1(minRequirement({ escortPassengerCount: 1 })).ok,
    true,
  );
  assert.equal(
    rejectKey(minRequirement({ escortPassengerCount: 2 }), parseCargoRequirementV1),
    "error.cargo_invalid_escort",
  );
}

// TEST V — access level / elevator / carry distance
{
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({
        pickupAccess: { level: 0, elevator: "available", carryDistanceMeters: 10 },
      }),
    ).ok,
    true,
  );
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({ pickupAccess: { level: -6, elevator: "unknown" } }),
    ).ok,
    false,
  );
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({ pickupAccess: { level: 101, elevator: "unknown" } }),
    ).ok,
    false,
  );
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({ pickupAccess: { level: 1.2, elevator: "unknown" } }),
    ).ok,
    false,
  );
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({ pickupAccess: { level: 0, elevator: "maybe" } }),
    ).ok,
    false,
  );
  assert.equal(
    parseCargoRequirementV1(
      minRequirement({
        pickupAccess: { level: 0, elevator: "available", carryDistanceMeters: 5001 },
      }),
    ).ok,
    false,
  );
}

// TEST W — legal minimum capacity
{
  const result = parseCargoCapacityV1(minCapacity());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.basis, "current_trip_available_space");
  }
}

// TEST X — basis must be current_trip_available_space
{
  assert.equal(
    parseCargoCapacityV1(minCapacity({ basis: "nameplate_total" })).ok,
    false,
  );
}

// TEST Y — legal transportMode / vehicleClass mapping
{
  assert.equal(
    parseCargoCapacityV1(
      minCapacity({ transportMode: "cargo_van", vehicleClass: "medium_cargo_van" }),
    ).ok,
    true,
  );
  assert.equal(
    parseCargoCapacityV1(
      minCapacity({ transportMode: "light_truck", vehicleClass: "light_truck" }),
    ).ok,
    true,
  );
  assert.equal(
    parseCargoCapacityV1(
      minCapacity({ transportMode: "cargo_boat", vehicleClass: "cargo_boat" }),
    ).ok,
    true,
  );
}

// TEST Z — road / water mismatch reject
{
  assert.equal(
    rejectKey(
      minCapacity({ transportMode: "cargo_van", vehicleClass: "cargo_boat" }),
      parseCargoCapacityV1 as typeof parseCargoRequirementV1,
    ),
    "error.cargo_transport_vehicle_mismatch",
  );
  assert.equal(
    rejectKey(
      minCapacity({ transportMode: "cargo_boat", vehicleClass: "small_cargo_van" }),
      parseCargoCapacityV1 as typeof parseCargoRequirementV1,
    ),
    "error.cargo_transport_vehicle_mismatch",
  );
}

// TEST AA — availableSpace known / unknown
{
  assert.equal(parseCargoCapacityV1(minCapacity()).ok, true);
  assert.equal(
    parseCargoCapacityV1(
      minCapacity({
        availableSpace: {
          kind: "known",
          dimensionsCm: { length: 200, width: 120, height: 120 },
        },
      }),
    ).ok,
    true,
  );
}

// TEST AB — availablePayload known / unknown
{
  assert.equal(
    parseCargoCapacityV1(
      minCapacity({ availablePayloadKg: { kind: "known", kg: 400.5 } }),
    ).ok,
    true,
  );
  assert.equal(
    parseCargoCapacityV1(
      minCapacity({ availablePayloadKg: { kind: "known", kg: 0 } }),
    ).ok,
    false,
  );
}

// TEST AC — capacity unknown / private key reject
{
  assert.equal(
    rejectKey(
      minCapacity({ extra: 1 }),
      parseCargoCapacityV1 as typeof parseCargoRequirementV1,
    ),
    "error.cargo_unknown_key",
  );
  assert.equal(
    rejectKey(
      minCapacity({ phone: "1" }),
      parseCargoCapacityV1 as typeof parseCargoRequirementV1,
    ),
    "error.cargo_private_field_forbidden",
  );
}

// TEST AD — support level enum
{
  assert.equal(
    parseCargoCapacityV1(minCapacity({ loadingHelp: "maybe" })).ok,
    false,
  );
  assert.equal(
    parseCargoCapacityV1(minCapacity({ loadingHelp: "available" })).ok,
    true,
  );
}

// TEST AE — escortAccommodation enum
{
  assert.equal(
    parseCargoCapacityV1(minCapacity({ escortAccommodation: "seats" })).ok,
    false,
  );
  assert.equal(
    parseCargoCapacityV1(
      minCapacity({ escortAccommodation: "requires_confirmation" }),
    ).ok,
    true,
  );
}

// TEST AF — note trim and length
{
  const trimmed = parseCargoCapacityV1(minCapacity({ note: "  hello  " }));
  assert.equal(trimmed.ok, true);
  if (trimmed.ok) assert.equal(trimmed.value.note, "hello");
  assert.equal(
    parseCargoCapacityV1(minCapacity({ note: "x".repeat(301) })).ok,
    false,
  );
  const empty = parseCargoCapacityV1(minCapacity({ note: "   " }));
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.value.note, undefined);
}

console.log("cargoContract.test.ts: ok");
