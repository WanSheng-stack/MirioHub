/**
 * PHASE 6.7C.2B / 6.7C.2B.1 — publish-time service_subtype defaults and
 * fail-closed checks. Pure helpers. Server canonical must re-run.
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
import {
  ILLEGAL_TRANSPORT_COMBO_KEY,
  INVALID_TRANSPORT_MODE_KEY,
  isLegacyVanTransportMode,
  TRANSPORT_MODE_REQUIRED_KEY,
} from "@/lib/auth/publishTransportMode";
import {
  isModeAllowedForLane,
  isTargetDeliverTransportMode,
  isTargetTravelTransportMode,
} from "@/lib/transport/transportPolicy";

export const DEFAULT_TRAVEL_SERVICE_SUBTYPE: TravelServiceSubtype = "passenger";
export const DEFAULT_DELIVER_SERVICE_SUBTYPE: DeliverServiceSubtype =
  "cargo_only";

export const INVALID_SERVICE_SUBTYPE_KEY = "error.invalid_service_subtype";
export const BROWSER_NIGHT_AUTHORITY_KEY = "error.browser_night_authority_rejected";
export {
  ILLEGAL_TRANSPORT_COMBO_KEY,
  INVALID_TRANSPORT_MODE_KEY,
  TRANSPORT_MODE_REQUIRED_KEY,
};

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

export type PublishSubtypeTransportInput = {
  category: string;
  postType: "demand" | "provider";
  serviceSubtype: ServiceSubtype | null;
  transportMode: string | null | undefined;
};

export function assertPublishSubtypeTransportLegal(
  input: PublishSubtypeTransportInput,
): void {
  const { category, serviceSubtype, transportMode } = input;

  if (!serviceSubtypeIsLegal(category, serviceSubtype)) {
    throw new Error(INVALID_SERVICE_SUBTYPE_KEY);
  }

  if (category === "travel" || category === "deliver") {
    if (serviceSubtype == null) {
      throw new Error(INVALID_SERVICE_SUBTYPE_KEY);
    }
    const mode =
      transportMode == null || transportMode === "" ? null : String(transportMode).trim();
    if (mode == null || mode === "") {
      throw new Error(TRANSPORT_MODE_REQUIRED_KEY);
    }
    if (isLegacyVanTransportMode(mode)) {
      throw new Error(INVALID_TRANSPORT_MODE_KEY);
    }
    if (category === "travel" && !isTargetTravelTransportMode(mode)) {
      throw new Error(ILLEGAL_TRANSPORT_COMBO_KEY);
    }
    if (category === "deliver" && !isTargetDeliverTransportMode(mode)) {
      throw new Error(ILLEGAL_TRANSPORT_COMBO_KEY);
    }
    if (!isModeAllowedForLane(mode, category)) {
      throw new Error(ILLEGAL_TRANSPORT_COMBO_KEY);
    }
    // People Travel subtypes are car-only; escort Deliver excludes boats.
    if (
      category === "travel" &&
      (serviceSubtype === "passenger" ||
        serviceSubtype === "passenger_with_small_item") &&
      mode !== "car"
    ) {
      throw new Error(ILLEGAL_TRANSPORT_COMBO_KEY);
    }
    if (
      category === "deliver" &&
      serviceSubtype === "cargo_with_escort" &&
      (mode === "cargo_boat" || mode === "private_cargo_boat")
    ) {
      throw new Error(ILLEGAL_TRANSPORT_COMBO_KEY);
    }
    const decision = evaluateNightServicePolicy({
      category,
      serviceSubtype,
      transportMode: mode,
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
  postType: "demand" | "provider";
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
    postType,
    serviceSubtype,
    escort_seats,
    max_companions,
    share_mode,
    count_small,
    count_medium,
    count_large,
    count_xlarge,
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
      // Mutually exclusive: people, no small items. No luggage toggle.
      return {
        escort_seats: Math.max(1, Math.min(4, max_companions || escort_seats || 1)),
        max_companions: Math.max(1, Math.min(4, max_companions || 1)),
        share_mode: share_mode === "private" ? "private" : "share",
        count_small: 0,
        count_medium: 0,
        count_large: 0,
        count_xlarge: 0,
        carry_luggage: false,
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
      // Demand: one escort rider requested. Provider: capability only —
      // never forge escort_seats as a provider headcount.
      return {
        escort_seats: postType === "demand" ? 1 : 0,
        max_companions: 0,
        share_mode:
          postType === "demand"
            ? share_mode === "private"
              ? "private"
              : "share"
            : null,
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
    carry_luggage: false,
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
): boolean {
  return (
    subtype === "small_item_only" || subtype === "passenger_with_small_item"
  );
}

export function deliverShowsEscortShare(
  subtype: ServiceSubtype | null | undefined,
  postType: "demand" | "provider",
): boolean {
  return postType === "demand" && subtype === "cargo_with_escort";
}

export function subtypeRequiresHumanTravel(
  category: string,
  subtype: ServiceSubtype | null | undefined,
): boolean {
  return serviceRequiresHumanTravel(category, subtype);
}
