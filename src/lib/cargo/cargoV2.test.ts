/**
 * PHASE 6.7B.1A.2B — Cargo V2 yes/no handling + authentic parsed values.
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

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const PHASE_BASELINE = "6e6778556c035b84110104041058d3072620a996";
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

// TEST A — Demand both handling booleans required
{
  const missingLoad = parseCargoRequirementV1(
    minRequirement({ handlingRequest: { needsUnloadingHelp: false } }),
  );
  assert.equal(missingLoad.ok, false);
  const missingUnload = parseCargoRequirementV1(
    minRequirement({ handlingRequest: { needsLoadingHelp: false } }),
  );
  assert.equal(missingUnload.ok, false);
}

// TEST B — Provider both handling booleans required
{
  const missingLoad = parseCargoCapacityV1(
    minCapacity({ handlingOffer: { canHelpUnloading: true } }),
  );
  assert.equal(missingLoad.ok, false);
  const missingUnload = parseCargoCapacityV1(
    minCapacity({ handlingOffer: { canHelpLoading: true } }),
  );
  assert.equal(missingUnload.ok, false);
}

// TEST C — booleans accept true/false
{
  const req = mustParseReq(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: false },
    }),
  );
  assert.equal(req.handlingRequest.needsLoadingHelp, true);
  assert.equal(req.handlingRequest.needsUnloadingHelp, false);
  const cap = mustParseCap(
    minCapacity({
      handlingOffer: { canHelpLoading: false, canHelpUnloading: true },
    }),
  );
  assert.equal(cap.handlingOffer.canHelpLoading, false);
  assert.equal(cap.handlingOffer.canHelpUnloading, true);
}

// TEST D — reject 0 / 1 / string / null
{
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
}

// TEST E — Demand handling unknown key reject
{
  const parsed = parseCargoRequirementV1(
    minRequirement({
      handlingRequest: {
        needsLoadingHelp: false,
        needsUnloadingHelp: false,
        extra: true,
      },
    }),
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.errorKey, "error.cargo_unknown_key");
}

// TEST F — Provider handling unknown key reject
{
  const parsed = parseCargoCapacityV1(
    minCapacity({
      handlingOffer: {
        canHelpLoading: false,
        canHelpUnloading: false,
        extra: true,
      },
    }),
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.errorKey, "error.cargo_unknown_key");
}

// TEST G — old compensation / amount / currency fields reject
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

// TEST H — Demand needs no help: Provider offer does not add a reason
{
  for (const offer of [
    { canHelpLoading: false, canHelpUnloading: false },
    { canHelpLoading: true, canHelpUnloading: false },
    { canHelpLoading: false, canHelpUnloading: true },
    { canHelpLoading: true, canHelpUnloading: true },
  ]) {
    const result = compare(
      minRequirement(),
      minCapacity({ handlingOffer: offer }),
    );
    assert.equal(result.reasons.includes("loading_help_unavailable"), false);
    assert.equal(result.reasons.includes("unloading_help_unavailable"), false);
    assert.equal(
      result.reasons.includes("handling_fee_negotiation_required"),
      false,
    );
  }
}

// TEST I — needs loading + Provider false → declared_conflict
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: false },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: false, canHelpUnloading: true },
    }),
  );
  assert.equal(result.status, "declared_conflict");
  assert.ok(result.reasons.includes("loading_help_unavailable"));
}

// TEST J — needs unloading + Provider false → declared_conflict
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: false, needsUnloadingHelp: true },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: true, canHelpUnloading: false },
    }),
  );
  assert.equal(result.status, "declared_conflict");
  assert.ok(result.reasons.includes("unloading_help_unavailable"));
}

// TEST K — both needed and Provider both false → two stable unavailable reasons
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: true },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: false, canHelpUnloading: false },
    }),
  );
  assert.equal(result.status, "declared_conflict");
  assert.deepEqual(result.reasons, [
    "loading_help_unavailable",
    "unloading_help_unavailable",
  ]);
}

// TEST L — all requested help available → needs_confirmation + negotiation
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: true },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: true, canHelpUnloading: true },
    }),
  );
  assert.equal(result.status, "needs_confirmation");
  assert.deepEqual(result.reasons, ["handling_fee_negotiation_required"]);
}

// TEST M — only loading requested and covered → negotiation
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: false },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: true, canHelpUnloading: false },
    }),
  );
  assert.equal(result.status, "needs_confirmation");
  assert.ok(result.reasons.includes("handling_fee_negotiation_required"));
}

// TEST N — only unloading requested and covered → negotiation
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: false, needsUnloadingHelp: true },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: false, canHelpUnloading: true },
    }),
  );
  assert.equal(result.status, "needs_confirmation");
  assert.ok(result.reasons.includes("handling_fee_negotiation_required"));
}

// TEST O — unavailable outranks negotiation
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: true },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: true, canHelpUnloading: false },
    }),
  );
  assert.equal(result.status, "declared_conflict");
  assert.ok(result.reasons.includes("unloading_help_unavailable"));
  assert.equal(
    result.reasons.includes("handling_fee_negotiation_required"),
    false,
  );
}

// TEST P — requiresHumanConfirmation always true
{
  for (const result of [
    compare(minRequirement(), minCapacity()),
    compare(
      minRequirement({
        handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: false },
      }),
      minCapacity({
        handlingOffer: { canHelpLoading: true, canHelpUnloading: false },
      }),
    ),
    compare(
      minRequirement({
        handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: false },
      }),
      minCapacity({
        handlingOffer: { canHelpLoading: false, canHelpUnloading: false },
      }),
    ),
  ]) {
    assert.equal(result.requiresHumanConfirmation, true);
  }
}

// TEST Q — no Fraud / hard deny
{
  const result = compare(
    minRequirement({
      handlingRequest: { needsLoadingHelp: true, needsUnloadingHelp: true },
    }),
    minCapacity({
      handlingOffer: { canHelpLoading: false, canHelpUnloading: false },
    }),
  );
  const text = JSON.stringify(result);
  for (const token of [
    "hard_deny",
    "hardDeny",
    "fraud",
    "fraud_logs",
    "incompatible",
    "preliminarily_compatible",
  ]) {
    assert.equal(text.includes(token), false, token);
  }
}

// TEST R — runtime brand Symbols are not exported
{
  assert.equal("PARSED_CARGO_REQUIREMENT" in cargoContract, false);
  assert.equal("PARSED_CARGO_CAPACITY" in cargoContract, false);
  const src = read("src/lib/cargo/cargoContract.ts");
  assert.equal(/export const PARSED_CARGO_/.test(src), false);
}

// TEST S — same-shape objects fail isParsed
{
  assert.equal(isParsedCargoRequirementV1(minRequirement()), false);
  assert.equal(isParsedCargoCapacityV1(minCapacity()), false);
}

// TEST T — spread copy fails isParsed
{
  const req = mustParseReq(minRequirement());
  const cap = mustParseCap(minCapacity());
  assert.equal(isParsedCargoRequirementV1({ ...req }), false);
  assert.equal(isParsedCargoCapacityV1({ ...cap }), false);
}

// TEST U — Object.assign copy fails isParsed
{
  const req = mustParseReq(minRequirement());
  const cap = mustParseCap(minCapacity());
  assert.equal(isParsedCargoRequirementV1(Object.assign({}, req)), false);
  assert.equal(isParsedCargoCapacityV1(Object.assign({}, cap)), false);
}

// TEST V — JSON round-trip fails isParsed
{
  const req = mustParseReq(minRequirement());
  const cap = mustParseCap(minCapacity());
  assert.equal(isParsedCargoRequirementV1(JSON.parse(JSON.stringify(req))), false);
  assert.equal(isParsedCargoCapacityV1(JSON.parse(JSON.stringify(cap))), false);
  assert.equal(Object.getOwnPropertySymbols(req).length, 0);
  assert.equal(Object.getOwnPropertySymbols(cap).length, 0);
}

// TEST W — structuredClone copy fails isParsed
{
  const req = mustParseReq(minRequirement());
  const cap = mustParseCap(minCapacity());
  assert.equal(isParsedCargoRequirementV1(structuredClone(req)), false);
  assert.equal(isParsedCargoCapacityV1(structuredClone(cap)), false);
}

// TEST X — parser originals pass isParsed and stay frozen
{
  const req = mustParseReq(
    minRequirement({ note: "  keep this  " }),
  );
  const cap = mustParseCap(minCapacity({ note: "   " }));
  assert.equal(isParsedCargoRequirementV1(req), true);
  assert.equal(isParsedCargoCapacityV1(cap), true);
  assert.equal(req.note, "keep this");
  assert.equal("note" in cap, false);
  assert.equal(Object.isFrozen(req), true);
  assert.equal(Object.isFrozen(req.requiredSpace), true);
  assert.equal(Object.isFrozen(req.handlingRequest), true);
  assert.equal(Object.isFrozen(cap), true);
  assert.equal(Object.isFrozen(cap.availableSpace), true);
  assert.equal(Object.isFrozen(cap.handlingOffer), true);
}

// TEST Y — evaluator rejects forged / copied objects
{
  const req = mustParseReq(minRequirement());
  const cap = mustParseCap(minCapacity());
  assert.throws(
    () => evaluateCargoCompatibility({ ...req } as never, cap),
    (err: unknown) =>
      err instanceof TypeError && String(err.message) === "error.cargo_unparsed_input",
  );
  assert.throws(
    () => evaluateCargoCompatibility(req, Object.assign({}, cap) as never),
    (err: unknown) =>
      err instanceof TypeError && String(err.message) === "error.cargo_unparsed_input",
  );
  assert.equal(evaluateCargoCompatibility(req, cap).requiresHumanConfirmation, true);
}

// TEST Z — compareDeclaredCargo parses then compares
{
  const viaUnknown = compareDeclaredCargo(minRequirement(), minCapacity());
  assert.equal(viaUnknown.ok, true);
  if (viaUnknown.ok) {
    assert.equal(viaUnknown.value.status, "no_obvious_conflict");
    assert.equal(viaUnknown.value.requiresHumanConfirmation, true);
  }
}

{
  const dims = parseCargoRequirementV1(
    minRequirement({ requiredSpace: { width: 50, height: 40 } }),
  );
  assert.equal(dims.ok, false);
  const conflict = compare(
    minRequirement({ requiredSpace: { length: 300, width: 20, height: 20 } }),
    minCapacity({ availableSpace: { length: 100, width: 100, height: 100 } }),
  );
  assert.equal(conflict.status, "declared_conflict");
  const weight = compare(
    minRequirement({ approximateWeightKg: { kind: "unknown" } }),
    minCapacity(),
  );
  assert.equal(weight.status, "needs_confirmation");
  const escort = compare(
    minRequirement({ escortPassengerCount: 1 }),
    minCapacity({ escortAccommodation: "not_available" }),
  );
  assert.equal(escort.status, "declared_conflict");
  const privateKey = parseCargoRequirementV1(minRequirement({ phone: "x" }));
  assert.equal(privateKey.ok, false);
}

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
    assert.equal(src.includes("parseProviderCompensation"), false);
    assert.equal(src.includes("parseCurrency"), false);
    assert.equal(src.includes("parseFixedAmount"), false);
    assert.equal(src.includes("handling_scope_differs"), false);
    assert.equal(src.includes("handling_compensation_requires_confirmation"), false);
    assert.equal(src.includes("handling_compensation_currency_differs"), false);
    assert.equal(src.includes("handling_compensation_amount_differs"), false);
  }
  assert.equal(policy.includes("amountMinor"), false);
  assert.equal(compat.includes("amountMinor"), false);
  assert.equal(policy.includes("voluntary_unpaid"), false);
  assert.equal(compat.includes("voluntary_unpaid"), false);
}

console.log("cargoV2.test.ts: ok");
