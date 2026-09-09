/**
 * PHASE 6.7B.1A.2A — centralized Cargo V2 policy numbers.
 *
 * Input safety bounds only. They do not mean the platform supports that
 * size, payload, or fee, and they are not a load-fit guarantee.
 * This module is not on the production runtime path.
 */

export const CARGO_CONTRACT_VERSION = 1 as const;

export const CARGO_DIMENSION_CM_MIN = 1;
export const CARGO_DIMENSION_CM_MAX = 2000;
export const CARGO_WEIGHT_KG_MAX = 10_000;
export const CARGO_AMOUNT_MINOR_MAX = 100_000_000;
export const CARGO_NOTE_MAX = 300;

export const CARGO_CURRENCIES = ["RSD", "EUR"] as const;
export type SupportedCargoCurrency = (typeof CARGO_CURRENCIES)[number];

export const CARGO_HANDLING_SCOPES = [
  "none",
  "loading",
  "unloading",
  "both",
] as const;
export type CargoHandlingScope = (typeof CARGO_HANDLING_SCOPES)[number];

export const CARGO_ESCORT_ACCOMMODATIONS = [
  "available",
  "not_available",
  "requires_confirmation",
] as const;
export type CargoEscortAccommodation =
  (typeof CARGO_ESCORT_ACCOMMODATIONS)[number];

export const CARGO_DECLARED_COMPARISON_STATUSES = [
  "declared_conflict",
  "needs_confirmation",
  "no_obvious_conflict",
] as const;
export type CargoDeclaredComparisonStatus =
  (typeof CARGO_DECLARED_COMPARISON_STATUSES)[number];

export const CARGO_COMPARISON_REASONS = [
  "declared_space_exceeds_available_space",
  "declared_weight_exceeds_available_payload",
  "escort_condition_differs",
  "handling_scope_differs",
  "weight_confirmation_required",
  "escort_requires_confirmation",
  "handling_compensation_requires_confirmation",
  "handling_compensation_currency_differs",
  "handling_compensation_amount_differs",
] as const;
export type CargoDeclaredComparisonReason =
  (typeof CARGO_COMPARISON_REASONS)[number];

const CONFLICT_REASONS = new Set<CargoDeclaredComparisonReason>([
  "declared_space_exceeds_available_space",
  "declared_weight_exceeds_available_payload",
  "escort_condition_differs",
  "handling_scope_differs",
]);

export function isConflictReason(
  reason: CargoDeclaredComparisonReason,
): boolean {
  return CONFLICT_REASONS.has(reason);
}

/**
 * Provider scope must cover the Demand assistance request.
 * `none` covers no assistance request; Demand `none` needs no coverage.
 */
export function providerScopeCoversDemand(
  provider: CargoHandlingScope,
  demand: CargoHandlingScope,
): boolean {
  if (demand === "none") return true;
  if (provider === "both") return true;
  return provider === demand;
}

export function sortedCargoReasons(
  reasons: Iterable<CargoDeclaredComparisonReason>,
): CargoDeclaredComparisonReason[] {
  const seen = new Set(reasons);
  return CARGO_COMPARISON_REASONS.filter((reason) => seen.has(reason));
}
