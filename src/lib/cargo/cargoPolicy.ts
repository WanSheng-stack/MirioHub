/**
 * PHASE 6.7B.1A.2B.1 — centralized Cargo V2 policy numbers.
 *
 * Input safety bounds only. They do not mean the platform supports that
 * size or payload, and they are not a load-fit guarantee.
 * This module is not on the production runtime path.
 *
 * Handling flags are advisory preferences only. A handling mismatch does
 * not block creating a post, does not block submitting a match request,
 * and does not block accepting a request. It is not a Fraud signal, hard
 * deny, matching filter, or ranking penalty. Final handling arrangement
 * and any fee / currency / unpaid agreement belong on a future
 * agreement_snapshot immediately before acceptance. This module does not
 * write that snapshot. The UI must require the parties to communicate
 * and confirm when preferences differ.
 */

export const CARGO_CONTRACT_VERSION = 1 as const;

export const CARGO_DIMENSION_CM_MIN = 1;
export const CARGO_DIMENSION_CM_MAX = 2000;
export const CARGO_WEIGHT_KG_MAX = 10_000;
export const CARGO_NOTE_MAX = 300;

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
  "loading_help_unavailable",
  "unloading_help_unavailable",
  "weight_confirmation_required",
  "escort_requires_confirmation",
  "handling_fee_negotiation_required",
] as const;
export type CargoDeclaredComparisonReason =
  (typeof CARGO_COMPARISON_REASONS)[number];

/** Advisory only. Never a declared_conflict, hard deny, or Fraud signal. */
export const CARGO_ADVISORY_HANDLING_REASONS = [
  "loading_help_unavailable",
  "unloading_help_unavailable",
  "handling_fee_negotiation_required",
] as const;
export type CargoAdvisoryHandlingReason =
  (typeof CARGO_ADVISORY_HANDLING_REASONS)[number];

const CONFLICT_REASONS = new Set<CargoDeclaredComparisonReason>([
  "declared_space_exceeds_available_space",
  "declared_weight_exceeds_available_payload",
  "escort_condition_differs",
]);

export function isConflictReason(
  reason: CargoDeclaredComparisonReason,
): boolean {
  return CONFLICT_REASONS.has(reason);
}

export function isAdvisoryHandlingReason(
  reason: CargoDeclaredComparisonReason,
): boolean {
  return (CARGO_ADVISORY_HANDLING_REASONS as readonly string[]).includes(
    reason,
  );
}

export function sortedCargoReasons(
  reasons: Iterable<CargoDeclaredComparisonReason>,
): CargoDeclaredComparisonReason[] {
  const seen = new Set(reasons);
  return CARGO_COMPARISON_REASONS.filter((reason) => seen.has(reason));
}
