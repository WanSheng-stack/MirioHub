/**
 * PHASE 6.7B — versioned application payload (TEST A–O).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/applicationPayload.test.ts
 */

import assert from "node:assert/strict";
import {
  isParsedCargoCapacityV1,
  isParsedCargoRequirementV1,
} from "@/lib/cargo/cargoContract";
import {
  applicantRoleForTarget,
  FORBIDDEN_PAYLOAD_KEYS,
  isForbiddenPayloadKey,
  MATCH_REQUEST_SEAT_CAP,
  normalizeMessage,
  parseApplicationPayloadV1,
  parseFiniteInteger,
  parseFiniteNonNegInt,
} from "@/lib/matching/applicationPayload";

function demandTravelOffer(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    applicantRole: "provider",
    targetPostType: "demand",
    targetCategory: "travel",
    transportMode: "car",
    availablePassengerSeats: 2,
    ...overrides,
  };
}

function providerTravelRequest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    applicantRole: "demand",
    targetPostType: "provider",
    targetCategory: "travel",
    passengerCount: 2,
    ...overrides,
  };
}

function minRequirement(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    requiredSpace: { length: 80, width: 50, height: 40 },
    approximateWeightKg: { kind: "known", kg: 10 },
    escortPassengerCount: 0,
    handlingRequest: { needsLoadingHelp: false, needsUnloadingHelp: false },
    ...overrides,
  };
}

function minCapacity(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    basis: "current_trip_available_space",
    availableSpace: { length: 120, width: 80, height: 80 },
    availablePayloadKg: { kind: "known", kg: 200 },
    escortAccommodation: "available",
    handlingOffer: { canHelpLoading: false, canHelpUnloading: false },
    ...overrides,
  };
}

function providerDeliverRequest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    applicantRole: "demand",
    targetPostType: "provider",
    targetCategory: "deliver",
    cargoRequirement: minRequirement(),
    ...overrides,
  };
}

function demandDeliverOffer(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    applicantRole: "provider",
    targetPostType: "demand",
    targetCategory: "deliver",
    cargoCapacity: minCapacity(),
    ...overrides,
  };
}

// TEST A Demand target → applicantRole=provider
{
  const parsed = parseApplicationPayloadV1(demandTravelOffer());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.targetPostType, "demand");
    assert.equal(parsed.value.applicantRole, "provider");
    assert.equal(applicantRoleForTarget("demand"), "provider");
  }
}

// TEST B Provider target → applicantRole=demand
{
  const parsed = parseApplicationPayloadV1(providerTravelRequest());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.targetPostType, "provider");
    assert.equal(parsed.value.applicantRole, "demand");
    assert.equal(applicantRoleForTarget("provider"), "demand");
  }
}

// TEST C same-side role+target → reject
{
  const sameA = parseApplicationPayloadV1(
    demandTravelOffer({ applicantRole: "demand" }),
  );
  assert.equal(sameA.ok, false);
  if (!sameA.ok) assert.equal(sameA.errorKey, "error.match_request_role_mismatch");

  const sameB = parseApplicationPayloadV1(
    providerTravelRequest({ applicantRole: "provider" }),
  );
  assert.equal(sameB.ok, false);
}

// TEST D unknown key → reject
{
  const parsed = parseApplicationPayloadV1(
    demandTravelOffer({ surprise: true }),
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.errorKey, "error.match_request_unknown_key");
}

// TEST E payload null / array / string → reject
{
  assert.equal(parseApplicationPayloadV1(null).ok, false);
  assert.equal(parseApplicationPayloadV1([]).ok, false);
  assert.equal(parseApplicationPayloadV1("x").ok, false);
  assert.equal(parseApplicationPayloadV1(1).ok, false);
}

// TEST F message trim, blank → undefined
{
  const blank = parseApplicationPayloadV1(demandTravelOffer({ message: "   " }));
  assert.equal(blank.ok, true);
  if (blank.ok) assert.equal("message" in blank.value, false);

  const trimmed = parseApplicationPayloadV1(
    demandTravelOffer({ message: "  hello  " }),
  );
  assert.equal(trimmed.ok, true);
  if (trimmed.ok) assert.equal(trimmed.value.message, "hello");

  const normBlank = normalizeMessage(" \n\t ");
  assert.equal(normBlank.ok, true);
  if (normBlank.ok) assert.equal(normBlank.value, undefined);
}

// TEST G message >300 → reject
{
  const parsed = parseApplicationPayloadV1(
    demandTravelOffer({ message: "a".repeat(301) }),
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.errorKey, "error.match_request_message_too_long");
}

// TEST H NaN / Infinity / string numbers → reject
{
  assert.equal(parseFiniteInteger(Number.NaN), null);
  assert.equal(parseFiniteInteger(Number.POSITIVE_INFINITY), null);
  assert.equal(parseFiniteInteger("2"), null);
  assert.equal(parseFiniteNonNegInt("1"), null);
  assert.equal(
    parseApplicationPayloadV1(demandTravelOffer({ availablePassengerSeats: "2" })).ok,
    false,
  );
  assert.equal(
    parseApplicationPayloadV1(demandTravelOffer({ availablePassengerSeats: Number.NaN })).ok,
    false,
  );
  assert.equal(
    parseApplicationPayloadV1(
      demandTravelOffer({ availablePassengerSeats: Number.POSITIVE_INFINITY }),
    ).ok,
    false,
  );
}

// TEST I negative / non-integer quantities → reject
{
  assert.equal(
    parseApplicationPayloadV1(demandTravelOffer({ availablePassengerSeats: -1 })).ok,
    false,
  );
  assert.equal(
    parseApplicationPayloadV1(demandTravelOffer({ availablePassengerSeats: 1.5 })).ok,
    false,
  );
  assert.equal(
    parseApplicationPayloadV1(
      providerTravelRequest({
        luggage: { small: -1, medium: 0, large: 0, xlarge: 0 },
      }),
    ).ok,
    false,
  );
  assert.equal(
    parseApplicationPayloadV1(
      providerDeliverRequest({
        cargoRequirement: minRequirement({
          requiredSpace: { length: -1, width: 50, height: 40 },
        }),
      }),
    ).ok,
    false,
  );
}

// TEST J travel Demand application passengerCount legal/illegal bounds
{
  assert.equal(parseApplicationPayloadV1(providerTravelRequest({ passengerCount: 1 })).ok, true);
  assert.equal(
    parseApplicationPayloadV1(providerTravelRequest({ passengerCount: MATCH_REQUEST_SEAT_CAP })).ok,
    true,
  );
  assert.equal(parseApplicationPayloadV1(providerTravelRequest({ passengerCount: 0 })).ok, false);
  assert.equal(parseApplicationPayloadV1(providerTravelRequest({ passengerCount: 5 })).ok, false);
}

// TEST K deliver Demand application uses CargoRequirementV1, not four-tier counts
{
  const parsed = parseApplicationPayloadV1(providerDeliverRequest());
  assert.equal(parsed.ok, true);
  if (parsed.ok && parsed.value.targetCategory === "deliver") {
    assert.equal(parsed.value.applicantRole, "demand");
    assert.equal("cargoRequirement" in parsed.value, true);
    assert.equal("cargo" in parsed.value, false);
    assert.equal("escortSeats" in parsed.value, false);
    assert.equal(isParsedCargoRequirementV1(parsed.value.cargoRequirement), true);
    assert.equal(parsed.value.cargoRequirement.escortPassengerCount, 0);
  }
  assert.equal(
    parseApplicationPayloadV1(
      providerDeliverRequest({
        cargoRequirement: minRequirement({ escortPassengerCount: 1 }),
      }),
    ).ok,
    true,
  );
  assert.equal(
    parseApplicationPayloadV1(
      providerDeliverRequest({
        cargoRequirement: minRequirement({ escortPassengerCount: 2 }),
      }),
    ).ok,
    false,
  );
  assert.equal(
    parseApplicationPayloadV1(
      providerDeliverRequest({
        cargoRequirement: minRequirement({
          handlingRequest: { needsLoadingHelp: 1, needsUnloadingHelp: false },
        }),
      }),
    ).ok,
    false,
  );
  assert.equal(
    parseApplicationPayloadV1({
      version: 1,
      applicantRole: "demand",
      targetPostType: "provider",
      targetCategory: "deliver",
      escortSeats: 1,
      cargo: { small: 1, medium: 0, large: 0, xlarge: 0 },
    }).ok,
    false,
  );
}

{
  const parsed = parseApplicationPayloadV1(demandDeliverOffer());
  assert.equal(parsed.ok, true);
  if (parsed.ok && parsed.value.targetCategory === "deliver") {
    assert.equal(parsed.value.applicantRole, "provider");
    assert.equal("transportMode" in parsed.value, false);
    assert.equal("cargoCapacity" in parsed.value, true);
    assert.equal("availableCargo" in parsed.value, false);
    assert.equal("availablePassengerSeats" in parsed.value, false);
    assert.equal(isParsedCargoCapacityV1(parsed.value.cargoCapacity), true);
    assert.equal(parsed.value.cargoCapacity.basis, "current_trip_available_space");
  }
  assert.equal(
    parseApplicationPayloadV1({
      version: 1,
      applicantRole: "provider",
      targetPostType: "demand",
      targetCategory: "deliver",
      availableCargo: { small: 1, medium: 0, large: 0, xlarge: 0 },
    }).ok,
    false,
  );
  const leftoverMode = parseApplicationPayloadV1(
    demandDeliverOffer({ transportMode: "van" }),
  );
  assert.equal(leftoverMode.ok, false);
  if (!leftoverMode.ok) {
    assert.equal(leftoverMode.errorKey, "error.match_request_unknown_key");
  }
  const leftoverWalking = parseApplicationPayloadV1(
    demandDeliverOffer({ transportMode: "walking" }),
  );
  assert.equal(leftoverWalking.ok, false);
  if (!leftoverWalking.ok) {
    assert.equal(leftoverWalking.errorKey, "error.match_request_unknown_key");
  }
  assert.equal(
    parseApplicationPayloadV1(
      demandDeliverOffer({
        cargoCapacity: minCapacity({
          handlingOffer: { canHelpLoading: true, canHelpUnloading: true },
        }),
      }),
    ).ok,
    true,
  );
  assert.equal(
    parseApplicationPayloadV1(
      demandDeliverOffer({
        cargoCapacity: minCapacity({
          handlingOffer: { canHelpLoading: "true", canHelpUnloading: false },
        }),
      }),
    ).ok,
    false,
  );
  const nestedFee = parseApplicationPayloadV1(
    demandDeliverOffer({
      cargoCapacity: minCapacity({
        compensation: { type: "negotiable" },
      }),
    }),
  );
  assert.equal(nestedFee.ok, false);
}

// TEST L Provider offer transportMode required and only existing enum
{
  assert.equal(
    parseApplicationPayloadV1(demandTravelOffer({ transportMode: "" })).ok,
    false,
  );
  assert.equal(
    parseApplicationPayloadV1(demandTravelOffer({ transportMode: "teleport" })).ok,
    false,
  );
  assert.equal(
    parseApplicationPayloadV1(demandTravelOffer({ transportMode: "car" })).ok,
    true,
  );
  assert.equal(
    parseApplicationPayloadV1(demandTravelOffer({ transportMode: "walking" })).ok,
    true,
  );
}

// TEST M any phone/email/plate/user UUID/private location field → reject
{
  for (const key of [
    "phone",
    "email",
    "plate",
    "user_id",
    "applicant_user_id",
    "service_address",
    "origin_gps",
    "raw_phone",
    "normalized_license_plate",
  ]) {
    assert.equal(isForbiddenPayloadKey(key), true, key);
    const parsed = parseApplicationPayloadV1(demandTravelOffer({ [key]: "x" }));
    assert.equal(parsed.ok, false, key);
    if (!parsed.ok) assert.equal(parsed.errorKey, "error.match_request_forbidden_key", key);
  }
}

// TEST N fee override/bid fields → reject
{
  for (const key of ["bid", "negotiated_fee", "fee_amount", "feeOverride", "bump_fee"]) {
    const parsed = parseApplicationPayloadV1(demandTravelOffer({ [key]: 12 }));
    assert.equal(parsed.ok, false, key);
    if (!parsed.ok) assert.equal(parsed.errorKey, "error.match_request_forbidden_key", key);
  }
}

// TEST O target route/date/time/fee read-only, not in editable payload
{
  const parsed = parseApplicationPayloadV1(demandTravelOffer());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const keys = Object.keys(parsed.value);
    assert.equal(keys.includes("origin_address"), false);
    assert.equal(keys.includes("destination_address"), false);
    assert.equal(keys.includes("departure_date"), false);
    assert.equal(keys.includes("departure_time_window"), false);
    assert.equal(keys.includes("fee_amount"), false);
  }
  assert.equal(
    parseApplicationPayloadV1(
      demandTravelOffer({ origin_address: "A", fee_amount: 10 }),
    ).ok,
    false,
  );
}

{
  const buy = parseApplicationPayloadV1({
    version: 1,
    applicantRole: "demand",
    targetPostType: "provider",
    targetCategory: "buy",
    itemQuantity: 2,
    itemUnit: "kg",
    itemCondition: "used",
    purchasePriceType: "range",
    minBudget: 10,
    maxBudget: 20.5,
  });
  assert.equal(buy.ok, true);

  const onsite = parseApplicationPayloadV1({
    version: 1,
    applicantRole: "demand",
    targetPostType: "provider",
    targetCategory: "onsite",
    message: "need a plumber",
  });
  assert.equal(onsite.ok, true);
  if (onsite.ok) {
    assert.equal("service_address" in onsite.value, false);
  }

  const providerBuy = parseApplicationPayloadV1({
    version: 1,
    applicantRole: "provider",
    targetPostType: "demand",
    targetCategory: "buy",
    transportMode: "bicycle",
  });
  assert.equal(providerBuy.ok, true);
}

assert.ok(FORBIDDEN_PAYLOAD_KEYS.includes("counterpart_post_id"));
assert.ok(FORBIDDEN_PAYLOAD_KEYS.includes("demand_post_id"));
assert.ok(FORBIDDEN_PAYLOAD_KEYS.includes("provider_post_id"));
assert.ok(FORBIDDEN_PAYLOAD_KEYS.includes("compensation"));
assert.ok(FORBIDDEN_PAYLOAD_KEYS.includes("amountMinor"));

{
  const noPost = parseApplicationPayloadV1(demandDeliverOffer());
  assert.equal(noPost.ok, true);
  if (noPost.ok) {
    assert.equal("applicant_post_id" in noPost.value, false);
    assert.equal("counterpart_post_id" in noPost.value, false);
  }
}

console.log("applicationPayload.test.ts: ok");
