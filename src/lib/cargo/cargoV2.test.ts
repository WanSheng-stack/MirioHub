/**
 * PHASE 6.7B.1A.2A — Cargo V2 aggregate-space contract tests (TEST A–AJ).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/cargo/cargoV2.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareDeclaredCargo,
  evaluateCargoCompatibility,
  sortedDimensions,
} from "@/lib/cargo/cargoCompatibility";
import {
  CARGO_AMOUNT_MINOR_MAX,
  CARGO_CURRENCIES,
  CARGO_DIMENSION_CM_MAX,
  CARGO_HANDLING_SCOPES,
  CARGO_WEIGHT_KG_MAX,
  providerScopeCoversDemand,
  type CargoHandlingScope,
} from "@/lib/cargo/cargoPolicy";
import {
  isParsedCargoCapacityV1,
  isParsedCargoRequirementV1,
  parseCargoCapacityV1,
  parseCargoRequirementV1,
} from "@/lib/cargo/cargoContract";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const PHASE_BASELINE = "c86f4e986f44977e10934c85301cd7dc38c65fc4";
const V92_REL =
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql";
const V91_REL =
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql";
const V86_REL =
  "supabase/migrations/20260907000001_security_boundary_hardening_v86.sql";

const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", PHASE_BASELINE, "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTs(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function minRequirement(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    requiredSpace: { length: 80, width: 50, height: 40 },
    approximateWeightKg: { kind: "known", kg: 10 },
    escortPassengerCount: 0,
    handlingRequest: { scope: "none" },
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
    handlingOffer: { scope: "none" },
    ...overrides,
  };
}

function mustParseReq(input: unknown) {
  const parsed = parseCargoRequirementV1(input);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.value;
}

function mustParseCap(input: unknown) {
  const parsed = parseCargoCapacityV1(input);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.value;
}

function compare(req: unknown, cap: unknown) {
  const result = compareDeclaredCargo(req, cap);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

function demandHandling(scope: CargoHandlingScope) {
  if (scope === "none") return { scope: "none" as const };
  return {
    scope,
    compensation: { type: "fixed" as const, amountMinor: 1000, currency: "RSD" as const },
  };
}

function providerHandling(scope: CargoHandlingScope) {
  if (scope === "none") return { scope: "none" as const };
  return {
    scope,
    compensation: { type: "fixed" as const, amountMinor: 1000, currency: "RSD" as const },
  };
}

// TEST A — Demand aggregate dimensions parse
{
  const parsed = parseCargoRequirementV1(minRequirement());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value.requiredSpace, {
      length: 80,
      width: 50,
      height: 40,
    });
    assert.equal(parsed.value.version, 1);
  }
}

// TEST B — Provider aggregate dimensions parse
{
  const parsed = parseCargoCapacityV1(minCapacity());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value.availableSpace, {
      length: 120,
      width: 80,
      height: 80,
    });
    assert.equal(parsed.value.basis, "current_trip_available_space");
  }
}

// TEST C — missing any side rejects
{
  for (const missing of ["length", "width", "height"] as const) {
    const space = { length: 80, width: 50, height: 40 } as Record<string, number>;
    delete space[missing];
    const parsed = parseCargoRequirementV1(
      minRequirement({ requiredSpace: space }),
    );
    assert.equal(parsed.ok, false, missing);
  }
}

// TEST D — 0 / negative / decimal / string / NaN / Infinity / over max reject
{
  const bad = [0, -1, 1.5, "80", Number.NaN, Number.POSITIVE_INFINITY, CARGO_DIMENSION_CM_MAX + 1];
  for (const value of bad) {
    const parsed = parseCargoRequirementV1(
      minRequirement({
        requiredSpace: { length: value, width: 50, height: 40 },
      }),
    );
    assert.equal(parsed.ok, false, String(value));
  }
}

// TEST E — items / category / preset / quantity rejected
{
  const parsed = parseCargoRequirementV1(
    minRequirement({
      items: [{ category: "moving_box", quantity: 1, preset: "box_small" }],
    }),
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.errorKey, "error.cargo_unknown_key");
}

// TEST F — vehicle recommendation and trailer fallback are gone
{
  const policy = read("src/lib/cargo/cargoPolicy.ts");
  const contract = read("src/lib/cargo/cargoContract.ts");
  const compat = read("src/lib/cargo/cargoCompatibility.ts");
  for (const src of [policy, contract, compat]) {
    assert.equal(src.includes("recommendCargoVehicleClass"), false);
    assert.equal(src.includes("CargoVehicleRecommendation"), false);
    assert.equal(src.includes("vehicle_with_trailer"), false);
    assert.equal(src.includes("CARGO_PRESET_DIMENSIONS"), false);
  }
}

// TEST G — sorted rotation still conflicts when one side is larger
{
  const result = compare(
    minRequirement({
      requiredSpace: { length: 300, width: 20, height: 20 },
    }),
    minCapacity({
      availableSpace: { length: 100, width: 100, height: 100 },
    }),
  );
  assert.equal(result.status, "declared_conflict");
  assert.ok(result.reasons.includes("declared_space_exceeds_available_space"));
}

// TEST H — numeric non-conflict is not a guaranteed fit
{
  const result = compare(
    minRequirement({
      requiredSpace: { length: 100, width: 50, height: 40 },
    }),
    minCapacity({
      availableSpace: { length: 40, width: 100, height: 50 },
    }),
  );
  assert.deepEqual(sortedDimensions({ length: 100, width: 50, height: 40 }), [
    40, 50, 100,
  ]);
  assert.equal(result.status, "no_obvious_conflict");
  assert.equal(result.reasons.includes("declared_space_exceeds_available_space"), false);
  assert.equal(JSON.stringify(result).includes("guaranteed"), false);
  assert.equal(JSON.stringify(result).includes("guaranteed_fit"), false);
}

// TEST I — known weight Demand > Provider → declared_conflict
{
  const result = compare(
    minRequirement({ approximateWeightKg: { kind: "known", kg: 80 } }),
    minCapacity({ availablePayloadKg: { kind: "known", kg: 20 } }),
  );
  assert.equal(result.status, "declared_conflict");
  assert.ok(result.reasons.includes("declared_weight_exceeds_available_payload"));
}

// TEST J — either weight unknown → needs_confirmation
{
  const demandUnknown = compare(
    minRequirement({ approximateWeightKg: { kind: "unknown" } }),
    minCapacity(),
  );
  assert.equal(demandUnknown.status, "needs_confirmation");
  assert.ok(demandUnknown.reasons.includes("weight_confirmation_required"));
  const providerUnknown = compare(
    minRequirement(),
    minCapacity({ availablePayloadKg: { kind: "unknown" } }),
  );
  assert.equal(providerUnknown.status, "needs_confirmation");
}

// TEST K — escort 1 + not_available → declared_conflict
{
  const result = compare(
    minRequirement({ escortPassengerCount: 1 }),
    minCapacity({ escortAccommodation: "not_available" }),
  );
  assert.equal(result.status, "declared_conflict");
  assert.ok(result.reasons.includes("escort_condition_differs"));
}

// TEST L — escort requires_confirmation → needs_confirmation
{
  const result = compare(
    minRequirement({ escortPassengerCount: 1 }),
    minCapacity({ escortAccommodation: "requires_confirmation" }),
  );
  assert.equal(result.status, "needs_confirmation");
  assert.ok(result.reasons.includes("escort_requires_confirmation"));
}

// TEST M — handling scope coverage for every combination
{
  const expectedCover: Record<CargoHandlingScope, Record<CargoHandlingScope, boolean>> = {
    none: { none: true, loading: true, unloading: true, both: true },
    loading: { none: false, loading: true, unloading: false, both: true },
    unloading: { none: false, loading: false, unloading: true, both: true },
    both: { none: false, loading: false, unloading: false, both: true },
  };
  for (const demand of CARGO_HANDLING_SCOPES) {
    for (const provider of CARGO_HANDLING_SCOPES) {
      assert.equal(
        providerScopeCoversDemand(provider, demand),
        expectedCover[demand][provider],
        `${demand} vs ${provider}`,
      );
      const result = compare(
        minRequirement({ handlingRequest: demandHandling(demand) }),
        minCapacity({ handlingOffer: providerHandling(provider) }),
      );
      if (expectedCover[demand][provider]) {
        assert.equal(result.reasons.includes("handling_scope_differs"), false);
      } else {
        assert.equal(result.status, "declared_conflict");
        assert.ok(result.reasons.includes("handling_scope_differs"));
      }
    }
  }
}

// TEST N — Demand scope none + compensation rejects
{
  const parsed = parseCargoRequirementV1(
    minRequirement({
      handlingRequest: {
        scope: "none",
        compensation: { type: "negotiable" },
      },
    }),
  );
  assert.equal(parsed.ok, false);
}

// TEST O — Demand non-none without compensation rejects
{
  const parsed = parseCargoRequirementV1(
    minRequirement({ handlingRequest: { scope: "loading" } }),
  );
  assert.equal(parsed.ok, false);
}

// TEST P — Provider scope none + compensation rejects
{
  const parsed = parseCargoCapacityV1(
    minCapacity({
      handlingOffer: {
        scope: "none",
        compensation: { type: "voluntary_unpaid" },
      },
    }),
  );
  assert.equal(parsed.ok, false);
}

// TEST Q — Provider non-none without compensation rejects
{
  const parsed = parseCargoCapacityV1(
    minCapacity({ handlingOffer: { scope: "both" } }),
  );
  assert.equal(parsed.ok, false);
}

// TEST R — fixed amountMinor is a strict positive safe integer within the bound
{
  const badAmounts = [0, -1, 1.5, "1000", Number.NaN, CARGO_AMOUNT_MINOR_MAX + 1];
  for (const amountMinor of badAmounts) {
    const parsed = parseCargoRequirementV1(
      minRequirement({
        handlingRequest: {
          scope: "loading",
          compensation: { type: "fixed", amountMinor, currency: "RSD" },
        },
      }),
    );
    assert.equal(parsed.ok, false, String(amountMinor));
  }
  const okAmount = parseCargoRequirementV1(
    minRequirement({
      handlingRequest: {
        scope: "loading",
        compensation: { type: "fixed", amountMinor: 2500, currency: "EUR" },
      },
    }),
  );
  assert.equal(okAmount.ok, true);
}

// TEST S — currency allowlist is RSD / EUR
{
  assert.deepEqual([...CARGO_CURRENCIES], ["RSD", "EUR"]);
  const parsed = parseCargoRequirementV1(
    minRequirement({
      handlingRequest: {
        scope: "loading",
        compensation: { type: "fixed", amountMinor: 100, currency: "USD" },
      },
    }),
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.errorKey, "error.cargo_invalid_currency");
}

// TEST T — negotiable → needs_confirmation
{
  const result = compare(
    minRequirement({
      handlingRequest: { scope: "loading", compensation: { type: "negotiable" } },
    }),
    minCapacity({
      handlingOffer: {
        scope: "loading",
        compensation: { type: "fixed", amountMinor: 500, currency: "RSD" },
      },
    }),
  );
  assert.equal(result.status, "needs_confirmation");
  assert.ok(result.reasons.includes("handling_compensation_requires_confirmation"));
}

// TEST U — Provider fixed > Demand fixed → needs_confirmation
{
  const result = compare(
    minRequirement({
      handlingRequest: {
        scope: "both",
        compensation: { type: "fixed", amountMinor: 1000, currency: "RSD" },
      },
    }),
    minCapacity({
      handlingOffer: {
        scope: "both",
        compensation: { type: "fixed", amountMinor: 1500, currency: "RSD" },
      },
    }),
  );
  assert.equal(result.status, "needs_confirmation");
  assert.ok(result.reasons.includes("handling_compensation_amount_differs"));
}

// TEST V — Provider fixed <= Demand fixed → no fee conflict
{
  const result = compare(
    minRequirement({
      handlingRequest: {
        scope: "both",
        compensation: { type: "fixed", amountMinor: 1500, currency: "RSD" },
      },
    }),
    minCapacity({
      handlingOffer: {
        scope: "both",
        compensation: { type: "fixed", amountMinor: 1500, currency: "RSD" },
      },
    }),
  );
  assert.equal(result.status, "no_obvious_conflict");
  assert.equal(result.reasons.includes("handling_compensation_amount_differs"), false);
}

// TEST W — different currency → needs_confirmation
{
  const result = compare(
    minRequirement({
      handlingRequest: {
        scope: "loading",
        compensation: { type: "fixed", amountMinor: 1000, currency: "RSD" },
      },
    }),
    minCapacity({
      handlingOffer: {
        scope: "loading",
        compensation: { type: "fixed", amountMinor: 1000, currency: "EUR" },
      },
    }),
  );
  assert.equal(result.status, "needs_confirmation");
  assert.ok(result.reasons.includes("handling_compensation_currency_differs"));
}

// TEST X — voluntary_unpaid does not mint a receivable from Demand's offer
{
  const result = compare(
    minRequirement({
      handlingRequest: {
        scope: "loading",
        compensation: { type: "fixed", amountMinor: 4000, currency: "RSD" },
      },
    }),
    minCapacity({
      handlingOffer: {
        scope: "loading",
        compensation: { type: "voluntary_unpaid" },
      },
    }),
  );
  assert.equal(result.status, "no_obvious_conflict");
  const text = JSON.stringify(result);
  assert.equal(text.includes("4000"), false);
  assert.equal(text.includes("receivable"), false);
  assert.equal(text.includes("amountMinor"), false);
}

// TEST Y — unknown key reject
{
  const parsed = parseCargoRequirementV1(minRequirement({ extra: true }));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.errorKey, "error.cargo_unknown_key");
}

// TEST Z — private / contact / location / code / fee override / bid reject
{
  for (const key of ["phone", "email", "address", "gps", "pickup_code", "fee", "bid", "contact"]) {
    const parsed = parseCargoRequirementV1(minRequirement({ [key]: "x" }));
    assert.equal(parsed.ok, false, key);
    if (!parsed.ok) {
      assert.equal(parsed.errorKey, "error.cargo_private_field_forbidden");
    }
  }
  const nested = parseCargoCapacityV1(
    minCapacity({ note: "ok", payment_link: "https://pay" }),
  );
  assert.equal(nested.ok, false);
}

// TEST AA — parser returns branded values; evaluator cannot skip parse
{
  const rawReq = minRequirement();
  const rawCap = minCapacity();
  assert.equal(isParsedCargoRequirementV1(rawReq), false);
  assert.equal(isParsedCargoCapacityV1(rawCap), false);
  const req = mustParseReq(rawReq);
  const cap = mustParseCap(rawCap);
  assert.equal(isParsedCargoRequirementV1(req), true);
  assert.equal(isParsedCargoCapacityV1(cap), true);
  assert.throws(
    () =>
      evaluateCargoCompatibility(
        rawReq as never,
        cap,
      ),
    (err: unknown) =>
      err instanceof TypeError &&
      String(err.message) === "error.cargo_unparsed_input",
  );
  const viaUnknown = compareDeclaredCargo(rawReq, rawCap);
  assert.equal(viaUnknown.ok, true);
}

// TEST AB — reasons are stable and de-duplicated
{
  const result = compare(
    minRequirement({
      requiredSpace: { length: 300, width: 20, height: 20 },
      approximateWeightKg: { kind: "known", kg: 90 },
      escortPassengerCount: 1,
      handlingRequest: demandHandling("both"),
    }),
    minCapacity({
      availableSpace: { length: 100, width: 100, height: 100 },
      availablePayloadKg: { kind: "known", kg: 10 },
      escortAccommodation: "not_available",
      handlingOffer: providerHandling("none"),
    }),
  );
  assert.deepEqual(result.reasons, [...result.reasons].sort((a, b) => {
    const order = [
      "declared_space_exceeds_available_space",
      "declared_weight_exceeds_available_payload",
      "escort_condition_differs",
      "handling_scope_differs",
    ];
    return order.indexOf(a) - order.indexOf(b);
  }));
  assert.equal(new Set(result.reasons).size, result.reasons.length);
}

// TEST AC — requiresHumanConfirmation is always true
{
  for (const result of [
    compare(minRequirement(), minCapacity()),
    compare(
      minRequirement({ approximateWeightKg: { kind: "unknown" } }),
      minCapacity(),
    ),
    compare(
      minRequirement({ requiredSpace: { length: 400, width: 400, height: 400 } }),
      minCapacity(),
    ),
  ]) {
    assert.equal(result.requiresHumanConfirmation, true);
  }
}

// TEST AD — comparison never emits Fraud / hard-deny / browser metrics
{
  const result = compare(
    minRequirement({ escortPassengerCount: 1 }),
    minCapacity({ escortAccommodation: "not_available" }),
  );
  const text = JSON.stringify(result);
  for (const token of [
    "hard_deny",
    "hardDeny",
    "fraud",
    "fraud_logs",
    "account_count",
    "SQLSTATE",
    "incompatible",
    "preliminarily_compatible",
  ]) {
    assert.equal(text.includes(token), false, token);
  }
}

// TEST AE — old per-item and recommendation symbols are unused in cargo modules
{
  const cargoDir = join(repoRoot, "src/lib/cargo");
  for (const file of walkTs(cargoDir)) {
    if (file.endsWith(".test.ts")) continue;
    const src = readFileSync(file, "utf8");
    for (const token of [
      "CargoItemV1",
      "CargoItemCategory",
      "moving_box",
      "kgPerUnit",
      "handlingFlags",
      "recommendCargoVehicleClass",
      "CargoVehicleRecommendation",
      "guaranteed_fit",
    ]) {
      assert.equal(src.includes(token), false, `${relative(repoRoot, file)} ${token}`);
    }
  }
}

// TEST AF — no UI / API / DB integration
{
  const hits: string[] = [];
  for (const file of walkTs(join(repoRoot, "src"))) {
    const rel = relative(repoRoot, file).replaceAll("\\", "/");
    if (rel.startsWith("src/lib/cargo/")) continue;
    const src = readFileSync(file, "utf8");
    if (/from\s+["']@\/lib\/cargo\//.test(src)) hits.push(rel);
  }
  assert.deepEqual(hits, []);
}

// TEST AG — this phase adds 0 migrations
{
  const names = execFileSync(
    "git",
    ["diff", "--name-only", PHASE_BASELINE, "--", "supabase/migrations"],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();
  assert.equal(names, "");
}

// TEST AH — v92 unchanged vs c86f4e9
{
  assert.equal(gitDiff(V92_REL), "");
  assert.equal(
    gitDiff(
      "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.verify.sql",
    ),
    "",
  );
}

// TEST AI — v91 and earlier migrations unchanged
{
  assert.equal(gitDiff(V91_REL), "");
  assert.equal(gitDiff(V86_REL), "");
}

// TEST AJ — init.sql unchanged
{
  assert.equal(gitDiff("supabase/init.sql"), "");
}

{
  const weightTooPrecise = parseCargoRequirementV1(
    minRequirement({ approximateWeightKg: { kind: "known", kg: 1.25 } }),
  );
  assert.equal(weightTooPrecise.ok, false);
  const weightOk = parseCargoRequirementV1(
    minRequirement({ approximateWeightKg: { kind: "known", kg: 1.5 } }),
  );
  assert.equal(weightOk.ok, true);
  const weightOver = parseCargoRequirementV1(
    minRequirement({
      approximateWeightKg: { kind: "known", kg: CARGO_WEIGHT_KG_MAX + 1 },
    }),
  );
  assert.equal(weightOver.ok, false);
  const blankNote = parseCargoRequirementV1(minRequirement({ note: "   " }));
  assert.equal(blankNote.ok, true);
  if (blankNote.ok) assert.equal("note" in blankNote.value, false);
}

console.log("cargoV2.test.ts: ok");
