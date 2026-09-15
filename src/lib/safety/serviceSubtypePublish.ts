/**
 * PHASE 6.7C.2B — publish-time service_subtype defaults and fail-closed checks.
 * Pure helpers. Server canonical must re-run; do not trust browser conclusions.
 * Night policy runtime stays disabled; subtype/transport legality still applies.
 */

import {
  DELIVER_SERVICE_SUBTYPES,
  TRAVEL_SERVICE_SUBTYPES,
  evaluateNightServicePolicy,
  serviceRequiresHumanTravel,
  serviceSubtypeIsLegal,
  type DeliverServiceSubtype,
  type ServiceSubtype,
  type TravelServiceSubtype,
} from "@/lib/safety/nightServicePolicy";
import { LEGACY_VAN } from "@/lib/transport/transportPolicy";

export const DEFAULT_TRAVEL_SERVICE_SUBTYPE: TravelServiceSubtype = "passenger";
export const DEFAULT_DELIVER_SERVICE_SUBTYPE: DeliverServiceSubtype =
  "cargo_only";

export const INVALID_SERVICE_SUBTYPE_KEY = "error.invalid_service_subtype";
export const BROWSER_NIGHT_AUTHORITY_KEY = "error.browser_night_authority_rejected";
export const TRANSPORT_MODE_REQUIRED_KEY = "error.transport_mode_required";
export const ILLEGAL_TRANSPORT_COMBO_KEY = "error.illegal_transport_combo";

const BROWSER_AUTHORITY_KEYS = [
  "origin_country_code",
  "origin_timezone",
  "night_policy_version",
] as const;

export function defaultServiceSubtypeForCategory(
  category: string,
): ServiceSubtype | null {
  if (category === "travel") return DEFAULT_TRAVEL_SERVICE_SUBTYPE;
  if (category === "deliver") return DEFAULT_DELIVER_SERVICE_SUBTYPE;
  return null;
}

export function assertNoBrowserNightAuthorityFields(
  raw: Record<string, unknown>,
): void {
  for (const key of BROWSER_AUTHORITY_KEYS) {
    if (
      Object.prototype.hasOwnProperty.call(raw, key) &&
      raw[key] !== undefined &&
      raw[key] !== null &&
      raw[key] !== ""
    ) {
      throw new Error(BROWSER_NIGHT_AUTHORITY_KEY);
    }
  }
}

export function parsePublishServiceSubtype(
  category: string,
  raw: unknown,
): ServiceSubtype | null {
  if (category === "buy" || category === "onsite" || category === "errand") {
    if (raw === undefined || raw === null || raw === "") return null;
    throw new Error(INVALID_SERVICE_SUBTYPE_KEY);
  }

  if (category !== "travel" && category !== "deliver") {
    throw new Error(INVALID_SERVICE_SUBTYPE_KEY);
  }

  if (raw === undefined || raw === null || raw === "") {
    throw new Error(INVALID_SERVICE_SUBTYPE_KEY);
  }
  if (typeof raw !== "string") {
    throw new Error(INVALID_SERVICE_SUBTYPE_KEY);
  }
  const subtype = raw.trim();
  if (!serviceSubtypeIsLegal(category, subtype) || subtype === "") {
    throw new Error(INVALID_SERVICE_SUBTYPE_KEY);
  }
  if (category === "travel") {
    if (!(TRAVEL_SERVICE_SUBTYPES as readonly string[]).includes(subtype)) {
      throw new Error(INVALID_SERVICE_SUBTYPE_KEY);
    }
    return subtype as TravelServiceSubtype;
  }
  if (!(DELIVER_SERVICE_SUBTYPES as readonly string[]).includes(subtype)) {
    throw new Error(INVALID_SERVICE_SUBTYPE_KEY);
  }
  return subtype as DeliverServiceSubtype;
}

/**
 * V1 Stage-1 modes stay as persisted names. For deliver, legacy `van` is
 * evaluated as the suggested cargo target so subtype/transport legality can
 * run without accepting V2 mode names into the write path.
 */
function modeForPolicyEval(mode: string | null | undefined): string | null {
  if (mode == null || mode === "") return null;
  if (mode === LEGACY_VAN) return "cargo_van";
  return mode;
}

export type PublishSubtypeTransportInput = {
  category: string;
  postType: "demand" | "provider";
  serviceSubtype: ServiceSubtype | null;
  transportMode: string | null | undefined;
};

export function assertPublishSubtypeTransportLegal(
  input: PublishSubtypeTransportInput,
): void {
  const { category, postType, serviceSubtype, transportMode } = input;

  if (!serviceSubtypeIsLegal(category, serviceSubtype)) {
    throw new Error(INVALID_SERVICE_SUBTYPE_KEY);
  }

  if (category === "travel" || category === "deliver") {
    if (serviceSubtype == null) {
      throw new Error(INVALID_SERVICE_SUBTYPE_KEY);
    }
    const mode = transportMode == null || transportMode === "" ? null : transportMode;
    if (postType === "provider" && mode == null) {
      throw new Error(TRANSPORT_MODE_REQUIRED_KEY);
    }
    if (mode == null) {
      // Demand may omit transport_mode; still reject illegal subtype above.
      return;
    }
    const decision = evaluateNightServicePolicy({
      category,
      serviceSubtype,
      transportMode: modeForPolicyEval(mode),
      purpose: "publish",
      policyEnabled: false,
    });
    if (!decision.ok) {
      if (decision.reason === "illegal_transport_combo") {
        throw new Error(ILLEGAL_TRANSPORT_COMBO_KEY);
      }
      throw new Error(INVALID_SERVICE_SUBTYPE_KEY);
    }
    return;
  }

  if (serviceSubtype != null) {
    throw new Error(INVALID_SERVICE_SUBTYPE_KEY);
  }
}

export type SubtypeFieldCleanupInput = {
  category: string;
  serviceSubtype: ServiceSubtype | null;
  escort_seats: number;
  max_companions: number;
  share_mode: "share" | "private" | null;
  count_small: number;
  count_medium: number;
  count_large: number;
  count_xlarge: number;
  carry_luggage: boolean;
};

export type SubtypeFieldCleanupResult = {
  escort_seats: number;
  max_companions: number;
  share_mode: "share" | "private" | null;
  count_small: number;
  count_medium: number;
  count_large: number;
  count_xlarge: number;
  carry_luggage: boolean;
};

/** Normalize hidden/stale fields so prior subtype residue cannot reach writers. */
export function cleanupFieldsForServiceSubtype(
  input: SubtypeFieldCleanupInput,
): SubtypeFieldCleanupResult {
  const {
    category,
    serviceSubtype,
    escort_seats,
    max_companions,
    share_mode,
    count_small,
    count_medium,
    count_large,
    count_xlarge,
    carry_luggage,
  } = input;

  if (category === "buy" || category === "onsite" || category === "errand") {
    return {
      escort_seats: 0,
      max_companions: 0,
      share_mode: null,
      count_small: 0,
      count_medium: 0,
      count_large: 0,
      count_xlarge: 0,
      carry_luggage: false,
    };
  }

  if (category === "travel") {
    if (serviceSubtype === "small_item_only") {
      return {
        escort_seats: 0,
        max_companions: 0,
        share_mode: null,
        count_small,
        count_medium,
        count_large,
        count_xlarge,
        carry_luggage: true,
      };
    }
    if (serviceSubtype === "passenger") {
      const luggageOn = carry_luggage;
      return {
        escort_seats: Math.max(1, Math.min(4, max_companions || escort_seats || 1)),
        max_companions: Math.max(1, Math.min(4, max_companions || 1)),
        share_mode: share_mode === "private" ? "private" : "share",
        count_small: luggageOn ? count_small : 0,
        count_medium: luggageOn ? count_medium : 0,
        count_large: luggageOn ? count_large : 0,
        count_xlarge: luggageOn ? count_xlarge : 0,
        carry_luggage: luggageOn,
      };
    }
    if (serviceSubtype === "passenger_with_small_item") {
      return {
        escort_seats: Math.max(1, Math.min(4, max_companions || escort_seats || 1)),
        max_companions: Math.max(1, Math.min(4, max_companions || 1)),
        share_mode: share_mode === "private" ? "private" : "share",
        count_small,
        count_medium,
        count_large,
        count_xlarge,
        carry_luggage: true,
      };
    }
  }

  if (category === "deliver") {
    if (serviceSubtype === "cargo_only") {
      return {
        escort_seats: 0,
        max_companions: 0,
        share_mode: null,
        count_small,
        count_medium,
        count_large,
        count_xlarge,
        carry_luggage: false,
      };
    }
    if (serviceSubtype === "cargo_with_escort") {
      return {
        escort_seats: 1,
        max_companions: 0,
        share_mode: share_mode === "private" ? "private" : "share",
        count_small,
        count_medium,
        count_large,
        count_xlarge,
        carry_luggage: false,
      };
    }
  }

  return {
    escort_seats,
    max_companions,
    share_mode,
    count_small,
    count_medium,
    count_large,
    count_xlarge,
    carry_luggage,
  };
}

export function travelShowsPassengerControls(
  subtype: ServiceSubtype | null | undefined,
): boolean {
  return (
    subtype === "passenger" || subtype === "passenger_with_small_item"
  );
}

export function travelShowsLuggageControls(
  subtype: ServiceSubtype | null | undefined,
  carryLuggage: boolean,
): boolean {
  if (subtype === "small_item_only" || subtype === "passenger_with_small_item") {
    return true;
  }
  if (subtype === "passenger") return carryLuggage;
  return false;
}

export function deliverShowsEscortShare(
  subtype: ServiceSubtype | null | undefined,
): boolean {
  return subtype === "cargo_with_escort";
}

export function subtypeRequiresHumanTravel(
  category: string,
  subtype: ServiceSubtype | null | undefined,
): boolean {
  return serviceRequiresHumanTravel(category, subtype);
}
