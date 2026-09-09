/**
 * PHASE 6.7B.1A.2B.1 — Cargo V2 advisory handling preferences.
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
} from "@/lib/cargo/cargoCompatibility";
import {
  isParsedCargoCapacityV1,
  isParsedCargoRequirementV1,
  parseCargoCapacityV1,
  parseCargoRequirementV1,
} from "@/lib/cargo/cargoContract";
import * as cargoContract from "@/lib/cargo/cargoContract";
import {
  CARGO_ADVISORY_HANDLING_REASONS,
  isConflictReason,
  type CargoDeclaredComparisonReason,
} from "@/lib/cargo/cargoPolicy";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const PHASE_BASELINE = "7c1d50c2889019b5c6f9b4d73b1517f0fa3c5588";
const V92_REL =
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql";
const V91_REL =
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql";
const V86_REL =
  "supabase/migrations/20260907000001_security_boundary_hardening_v86.sql";

const HANDLING_REASONS = [
  "loading_help_unavailable",
  "unloading_help_unavailable",
  "handling_fee_negotiation_required",
] as const;

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

function handlingReasonsOf(
  reasons: readonly string[],
): Array<(typeof HANDLING_REASONS)[number]> {
  return HANDLING_REASONS.filter((reason) => reasons.includes(reason));
}

function assertNotConflictFromHandling(
  result: ReturnType<typeof compare>,
  expectedTrueConflict: CargoDeclaredComparisonReason,
) {
  for (const reason of handlingReasonsOf(result.reasons)) {
    assert.equal(isConflictReason(reason), false, reason);
  }
  assert.ok(result.reasons.includes(expectedTrueConflict));
  assert.equal(isConflictReason(expectedTrueConflict), true);
  assert.equal(result.status, "declared_conflict");
}

// TEST A — Demand needs nothing, Provider both false
{
  const result = compare(
    minRequirement(),
    minCapacity({
      handlingOffer: { canHelpLoading: false, canHelpUnloading: false },
    }),
  );
  assert.deepEqual(handlingReasonsOf(result.reasons), []);
  assert.equal(result.status, "no_obvious_conflict");
  assert.equal(result.requiresHumanConfirmation, true);
}

// TEST B — Demand needs nothing, Provider both true
{
  const result = compare(
    minRequirement(),
    minCapacity({
      handlingOffer: { canHelpLoading: true, canHelpUnloading: true },
    }),
  );
  assert.deepEqual(handlingReasonsOf(result.reasons), []);
  assert.equal(result.status, "no_obvious_conflict");
}

// TEST C — Demand needs loading, Provider can load
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: false },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: true, canHelpUnloading: false },
    }),
  );
  assert.deepEqual(result.reasons, ["handling_fee_negotiation_required"]);
  assert.equal(result.status, "needs_confirmation");
  assert.equal(isConflictReason("handling_fee_negotiation_required"), false);
}

// TEST D — Demand needs unloading, Provider can unload
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: false, needsUnloadingHelp: true },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: false, canHelpUnloading: true },
    }),
  );
  assert.deepEqual(result.reasons, ["handling_fee_negotiation_required"]);
  assert.equal(result.status, "needs_confirmation");
  assert.equal(isConflictReason("handling_fee_negotiation_required"), false);
}

// TEST E — Demand needs loading, Provider cannot
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: false },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: false, canHelpUnloading: true },
    }),
  );
  assert.deepEqual(result.reasons, ["loading_help_unavailable"]);
  assert.equal(result.status, "needs_confirmation");
  assert.notEqual(result.status, "declared_conflict");
  assert.equal(isConflictReason("loading_help_unavailable"), false);
}

// TEST F — Demand needs unloading, Provider cannot
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: false, needsUnloadingHelp: true },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: true, canHelpUnloading: false },
    }),
  );
  assert.deepEqual(result.reasons, ["unloading_help_unavailable"]);
  assert.equal(result.status, "needs_confirmation");
  assert.notEqual(result.status, "declared_conflict");
  assert.equal(isConflictReason("unloading_help_unavailable"), false);
}

// TEST G — both needed, Provider neither
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: true },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: false, canHelpUnloading: false },
    }),
  );
  assert.deepEqual(result.reasons, [
    "loading_help_unavailable",
    "unloading_help_unavailable",
  ]);
  assert.equal(result.reasons.includes("handling_fee_negotiation_required"), false);
  assert.equal(result.status, "needs_confirmation");
  assert.notEqual(result.status, "declared_conflict");
}

// TEST H — both needed; Provider can load only
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: true },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: true, canHelpUnloading: false },
    }),
  );
  assert.deepEqual(result.reasons, [
    "unloading_help_unavailable",
    "handling_fee_negotiation_required",
  ]);
  assert.equal(result.status, "needs_confirmation");
  assert.notEqual(result.status, "declared_conflict");
}

// TEST I — both needed; Provider can unload only
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: true },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: false, canHelpUnloading: true },
    }),
  );
  assert.deepEqual(result.reasons, [
    "loading_help_unavailable",
    "handling_fee_negotiation_required",
  ]);
  assert.equal(result.status, "needs_confirmation");
  assert.notEqual(result.status, "declared_conflict");
}

// TEST J — handling mismatch + declared space conflict
{
  const result = compare(
    minRequirement({
      requiredSpace: { length: 300, width: 20, height: 20 },
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: false },
    }),
    minCapacity({
      availableSpace: { length: 100, width: 100, height: 100 },
      handlingOffer: { canHelpLoading: false, canHelpUnloading: false },
    }),
  );
  assert.ok(result.reasons.includes("declared_space_exceeds_available_space"));
  assert.ok(result.reasons.includes("loading_help_unavailable"));
  assertNotConflictFromHandling(result, "declared_space_exceeds_available_space");
}

// TEST K — handling mismatch + declared weight conflict
{
  const result = compare(
    minRequirement({
      approximateWeightKg: { kind: "known", kg: 500 },
      handlingRequest: { needsLoadingHelp: false, needsUnloadingHelp: true },
    }),
    minCapacity({
      availablePayloadKg: { kind: "known", kg: 10 },
      handlingOffer: { canHelpLoading: false, canHelpUnloading: false },
    }),
  );
  assert.ok(result.reasons.includes("declared_weight_exceeds_available_payload"));
  assert.ok(result.reasons.includes("unloading_help_unavailable"));
  assertNotConflictFromHandling(
    result,
    "declared_weight_exceeds_available_payload",
  );
}

// TEST L — handling mismatch + escort conflict
{
  const result = compare(
    minRequirement({
      escortPassengerCount: 1,
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: true },
    }),
    minCapacity({
      escortAccommodation: "not_available",
      handlingOffer: { canHelpLoading: false, canHelpUnloading: false },
    }),
  );
  assert.ok(result.reasons.includes("escort_condition_differs"));
  assert.ok(result.reasons.includes("loading_help_unavailable"));
  assert.ok(result.reasons.includes("unloading_help_unavailable"));
  assertNotConflictFromHandling(result, "escort_condition_differs");
}

// TEST M — handling reasons are not conflict reasons
{
  for (const reason of CARGO_ADVISORY_HANDLING_REASONS) {
    assert.equal(isConflictReason(reason), false, reason);
  }
}

// TEST N — four handling fields stay required strict booleans
{
  const missingLoad = parseCargoRequirementV1(
    minRequirement({ handlingRequest: { needsUnloadingHelp: false } }),
  );
  assert.equal(missingLoad.ok, false);
  const missingUnload = parseCargoRequirementV1(
    minRequirement({ handlingRequest: { needsLoadingHelp: false } }),
  );
  assert.equal(missingUnload.ok, false);
  const missingOfferLoad = parseCargoCapacityV1(
    minCapacity({ handlingOffer: { canHelpUnloading: true } }),
  );
  assert.equal(missingOfferLoad.ok, false);
  const missingOfferUnload = parseCargoCapacityV1(
    minCapacity({ handlingOffer: { canHelpLoading: true } }),
  );
  assert.equal(missingOfferUnload.ok, false);
  const okReq = mustParseReq(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: false },
    }),
  );
  assert.equal(okReq.handlingRequest.needsLoadingHelp, true);
  assert.equal(okReq.handlingRequest.needsUnloadingHelp, false);
  for (const value of [0, 1, "true", "false", null]) {
    const parsed = parseCargoRequirementV1(
      minRequirement({
        handlingRequest: { needsLoadingHelp: value, needsUnloadingHelp: false },
      }),
    );
    assert.equal(parsed.ok, false, String(value));
    const cap = parseCargoCapacityV1(
      minCapacity({
        handlingOffer: { canHelpLoading: value, canHelpUnloading: false },
      }),
    );
    assert.equal(cap.ok, false, String(value));
  }
  const extraDemand = parseCargoRequirementV1(
    minRequirement({
      handlingRequest: {
        needsLoadingHelp: false,
        needsUnloadingHelp: false,
        extra: true,
      },
    }),
  );
  assert.equal(extraDemand.ok, false);
  const extraOffer = parseCargoCapacityV1(
    minCapacity({
      handlingOffer: {
        canHelpLoading: false,
        canHelpUnloading: false,
        extra: true,
      },
    }),
  );
  assert.equal(extraOffer.ok, false);
}

// TEST O — old compensation / amount / currency fields still rejected
{
  for (const key of [
    "compensation",
    "amountMinor",
    "currency",
    "fixed",
    "negotiable",
    "voluntary_unpaid",
    "bid",
    "fee",
    "payment",
  ]) {
    const parsed = parseCargoRequirementV1(minRequirement({ [key]: true }));
    assert.equal(parsed.ok, false, key);
  }
  const nested = parseCargoRequirementV1(
    minRequirement({
      handlingRequest: {
        needsLoadingHelp: true,
        needsUnloadingHelp: false,
        compensation: { type: "negotiable" },
      },
    }),
  );
  assert.equal(nested.ok, false);
}

// TEST P — WeakSet authenticity
{
  assert.equal("PARSED_CARGO_REQUIREMENT" in cargoContract, false);
  assert.equal("PARSED_CARGO_CAPACITY" in cargoContract, false);
  const src = read("src/lib/cargo/cargoContract.ts");
  assert.equal(/export const PARSED_CARGO_/.test(src), false);
  assert.equal(isParsedCargoRequirementV1(minRequirement()), false);
  assert.equal(isParsedCargoCapacityV1(minCapacity()), false);
  const req = mustParseReq(minRequirement({ note: "  keep this  " }));
  const cap = mustParseCap(minCapacity({ note: "   " }));
  assert.equal(isParsedCargoRequirementV1(req), true);
  assert.equal(isParsedCargoCapacityV1(cap), true);
  assert.equal(req.note, "keep this");
  assert.equal("note" in cap, false);
  assert.equal(isParsedCargoRequirementV1({ ...req }), false);
  assert.equal(isParsedCargoCapacityV1({ ...cap }), false);
  assert.equal(isParsedCargoRequirementV1(Object.assign({}, req)), false);
  assert.equal(isParsedCargoCapacityV1(Object.assign({}, cap)), false);
  assert.equal(isParsedCargoRequirementV1(JSON.parse(JSON.stringify(req))), false);
  assert.equal(isParsedCargoCapacityV1(JSON.parse(JSON.stringify(cap))), false);
  assert.equal(isParsedCargoRequirementV1(structuredClone(req)), false);
  assert.equal(isParsedCargoCapacityV1(structuredClone(cap)), false);
  assert.equal(Object.getOwnPropertySymbols(req).length, 0);
  assert.equal(Object.isFrozen(req), true);
  assert.equal(Object.isFrozen(req.handlingRequest), true);
  assert.throws(
    () => evaluateCargoCompatibility({ ...req } as never, cap),
    (err: unknown) =>
      err instanceof TypeError && String(err.message) === "error.cargo_unparsed_input",
  );
}

// TEST Q — requiresHumanConfirmation always true
{
  for (const result of [
    compare(minRequirement(), minCapacity()),
    compare(
      minRequirement({
        handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: true },
      }),
      minCapacity({
        handlingOffer: { canHelpLoading: true, canHelpUnloading: true },
      }),
    ),
    compare(
      minRequirement({
        handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: true },
      }),
      minCapacity({
        handlingOffer: { canHelpLoading: false, canHelpUnloading: false },
      }),
    ),
    compare(
      minRequirement({ requiredSpace: { length: 300, width: 20, height: 20 } }),
      minCapacity({ availableSpace: { length: 100, width: 100, height: 100 } }),
    ),
  ]) {
    assert.equal(result.requiresHumanConfirmation, true);
    const text = JSON.stringify(result);
    for (const token of [
      "hard_deny",
      "hardDeny",
      "fraud",
      "fraud_logs",
      "incompatible",
    ]) {
      assert.equal(text.includes(token), false, token);
    }
  }
}

// TEST R — handling mismatch is not wired to Fraud / hard deny / filter / rank
{
  const cargoHits: string[] = [];
  const productionHits: string[] = [];
  for (const file of walkTs(join(repoRoot, "src"))) {
    const rel = relative(repoRoot, file).replaceAll("\\", "/");
    const src = readFileSync(file, "utf8");
    if (rel.startsWith("src/lib/cargo/")) {
      if (rel.endsWith(".test.ts")) continue;
      cargoHits.push(rel);
      continue;
    }
    if (/from\s+["']@\/lib\/cargo\//.test(src)) productionHits.push(rel);
    if (
      /loading_help_unavailable|unloading_help_unavailable|handling_fee_negotiation_required/.test(
        src,
      )
    ) {
      productionHits.push(rel);
    }
  }
  assert.deepEqual(productionHits, []);
  const policy = read("src/lib/cargo/cargoPolicy.ts");
  const compat = read("src/lib/cargo/cargoCompatibility.ts");
  const contractDoc = read("docs/architecture/cargo-v2-contract.md");
  for (const src of [policy, compat, contractDoc]) {
    assert.match(src, /advisory preferences only/);
    assert.match(src, /block creating a post/);
    assert.match(src, /submitting a match request/);
    assert.match(src, /accepting a request/);
    assert.match(src, /Fraud signal/);
    assert.match(src, /hard deny/);
    assert.match(src, /matching filter/);
    assert.match(src, /ranking penalty/);
    assert.match(src, /agreement_snapshot/);
  }
  assert.equal(policy.includes("loading_help_unavailable"), true);
  const conflictBlock = policy.slice(
    policy.indexOf("const CONFLICT_REASONS"),
    policy.indexOf("export function isConflictReason"),
  );
  assert.equal(conflictBlock.includes("loading_help_unavailable"), false);
  assert.equal(conflictBlock.includes("unloading_help_unavailable"), false);
  assert.equal(
    conflictBlock.includes("handling_fee_negotiation_required"),
    false,
  );
}

{
  const dims = parseCargoRequirementV1(
    minRequirement({ requiredSpace: { width: 50, height: 40 } }),
  );
  assert.equal(dims.ok, false);
  const unknownWeight = compare(
    minRequirement({ approximateWeightKg: { kind: "unknown" } }),
    minCapacity(),
  );
  assert.equal(unknownWeight.status, "needs_confirmation");
  const privateKey = parseCargoRequirementV1(minRequirement({ phone: "x" }));
  assert.equal(privateKey.ok, false);
  const bothCovered = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: true },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: true, canHelpUnloading: true },
    }),
  );
  assert.deepEqual(bothCovered.reasons, ["handling_fee_negotiation_required"]);
}

{
  const names = execFileSync(
    "git",
    ["diff", "--name-only", PHASE_BASELINE, "--", "supabase/migrations"],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();
  assert.equal(names, "");
  assert.equal(gitDiff(V92_REL), "");
  assert.equal(
    gitDiff(
      "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.verify.sql",
    ),
    "",
  );
  assert.equal(gitDiff(V91_REL), "");
  assert.equal(gitDiff(V86_REL), "");
  assert.equal(gitDiff("supabase/init.sql"), "");
}

{
  const policy = read("src/lib/cargo/cargoPolicy.ts");
  const contract = read("src/lib/cargo/cargoContract.ts");
  const compat = read("src/lib/cargo/cargoCompatibility.ts");
  for (const src of [policy, contract, compat]) {
    assert.equal(src.includes("CARGO_CURRENCIES"), false);
    assert.equal(src.includes("CARGO_AMOUNT_MINOR_MAX"), false);
    assert.equal(src.includes("DemandHandlingCompensation"), false);
    assert.equal(src.includes("ProviderHandlingCompensation"), false);
    assert.equal(src.includes("parseDemandCompensation"), false);
    assert.equal(src.includes("handling_scope_differs"), false);
    assert.equal(src.includes("handling_compensation_amount_differs"), false);
  }
}

console.log("cargoV2.test.ts: ok");
