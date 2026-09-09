/**
 * PHASE 6.7B.1A.2B — declared-space comparison (never a fit guarantee).
 *
 * Not on the production runtime path. Server must re-parse both snapshots
 * before any future accept. requiresHumanConfirmation is always true.
 * This is not a Fraud decision, hard deny, or vehicle verification.
 */

import {
  isConflictReason,
  sortedCargoReasons,
  type CargoDeclaredComparisonReason,
  type CargoDeclaredComparisonStatus,
} from "@/lib/cargo/cargoPolicy";
import type { CargoDimensionsCm } from "@/lib/cargo/cargoContract";
import {
  isParsedCargoCapacityV1,
  isParsedCargoRequirementV1,
  parseCargoCapacityV1,
  parseCargoRequirementV1,
  type CargoParseResult,
  type ParsedCargoCapacityV1,
  type ParsedCargoRequirementV1,
} from "@/lib/cargo/cargoContract";

export type { CargoDeclaredComparisonReason, CargoDeclaredComparisonStatus };

export type CargoDeclaredComparisonResult = {
  status: CargoDeclaredComparisonStatus;
  reasons: CargoDeclaredComparisonReason[];
  requiresHumanConfirmation: true;
};

export function sortedDimensions(
  dims: CargoDimensionsCm,
): [number, number, number] {
  return [dims.length, dims.width, dims.height]
    .slice()
    .sort((a, b) => a - b) as [number, number, number];
}

function declaredSpaceFits(
  required: CargoDimensionsCm,
  available: CargoDimensionsCm,
): boolean {
  const demand = sortedDimensions(required);
  const provider = sortedDimensions(available);
  return (
    demand[0] <= provider[0] &&
    demand[1] <= provider[1] &&
    demand[2] <= provider[2]
  );
}

function collectReasons(
  requirement: ParsedCargoRequirementV1,
  capacity: ParsedCargoCapacityV1,
): CargoDeclaredComparisonReason[] {
  const reasons = new Set<CargoDeclaredComparisonReason>();

  if (!declaredSpaceFits(requirement.requiredSpace, capacity.availableSpace)) {
    reasons.add("declared_space_exceeds_available_space");
  }

  const demandWeight = requirement.approximateWeightKg;
  const payload = capacity.availablePayloadKg;
  if (demandWeight.kind === "unknown" || payload.kind === "unknown") {
    reasons.add("weight_confirmation_required");
  } else if (demandWeight.kg > payload.kg) {
    reasons.add("declared_weight_exceeds_available_payload");
  }

  if (requirement.escortPassengerCount === 1) {
    if (capacity.escortAccommodation === "not_available") {
      reasons.add("escort_condition_differs");
    } else if (capacity.escortAccommodation === "requires_confirmation") {
      reasons.add("escort_requires_confirmation");
    }
  }

  const needsLoading = requirement.handlingRequest.needsLoadingHelp;
  const needsUnloading = requirement.handlingRequest.needsUnloadingHelp;
  const canLoad = capacity.handlingOffer.canHelpLoading;
  const canUnload = capacity.handlingOffer.canHelpUnloading;

  if (needsLoading && !canLoad) {
    reasons.add("loading_help_unavailable");
  }
  if (needsUnloading && !canUnload) {
    reasons.add("unloading_help_unavailable");
  }
  if (
    (needsLoading || needsUnloading) &&
    (!needsLoading || canLoad) &&
    (!needsUnloading || canUnload)
  ) {
    reasons.add("handling_fee_negotiation_required");
  }

  return sortedCargoReasons(reasons);
}

function statusFromReasons(
  reasons: CargoDeclaredComparisonReason[],
): CargoDeclaredComparisonStatus {
  if (reasons.some(isConflictReason)) return "declared_conflict";
  if (reasons.length > 0) return "needs_confirmation";
  return "no_obvious_conflict";
}

export function evaluateCargoCompatibility(
  requirement: ParsedCargoRequirementV1,
  capacity: ParsedCargoCapacityV1,
): CargoDeclaredComparisonResult {
  if (
    !isParsedCargoRequirementV1(requirement) ||
    !isParsedCargoCapacityV1(capacity)
  ) {
    throw new TypeError("error.cargo_unparsed_input");
  }
  const reasons = collectReasons(requirement, capacity);
  return {
    status: statusFromReasons(reasons),
    reasons,
    requiresHumanConfirmation: true,
  };
}

export function compareDeclaredCargo(
  requirementInput: unknown,
  capacityInput: unknown,
): CargoParseResult<CargoDeclaredComparisonResult> {
  const requirement = parseCargoRequirementV1(requirementInput);
  if (!requirement.ok) return requirement;
  const capacity = parseCargoCapacityV1(capacityInput);
  if (!capacity.ok) return capacity;
  return {
    ok: true,
    value: evaluateCargoCompatibility(requirement.value, capacity.value),
  };
}
