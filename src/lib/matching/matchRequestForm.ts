/**
 * PHASE 6.7B — pure match-request form state (no DOM).
 * MatchRequestSheet uses these functions so submit / draft / validation
 * can be unit-tested without a browser harness.
 */

import {
  applicantRoleForTarget,
  MATCH_REQUEST_DELIVER_ESCORT_MIN,
  MATCH_REQUEST_TRAVEL_SEATS_MIN,
  parseApplicationPayloadV1,
  parseFiniteNonNegInt,
  parseNonNegFiniteNumber,
  parseSeatCount,
  type ApplicationPayloadV1,
  type CargoCountsV1,
} from "@/lib/matching/applicationPayload";
import type { MatchPostType } from "@/lib/matching/model";
import type {
  ItemCondition,
  ItemUnit,
  PostCategory,
  PurchasePriceType,
} from "@/lib/post-payload";
import type { TransportMode } from "@/lib/types";

export type MatchRequestTargetPost = {
  id: string;
  post_type: MatchPostType;
  category: PostCategory;
  origin_address: string;
  destination_address: string;
  departure_date?: string | null;
  departure_time_window?: string | null;
  fee_amount?: number | null;
};

export type MatchRequestField =
  | "transportMode"
  | "availablePassengerSeats"
  | "passengerCount"
  | "escortSeats"
  | "cargo"
  | "itemQuantity"
  | "itemUnit"
  | "itemCondition"
  | "purchasePriceType"
  | "minBudget"
  | "maxBudget"
  | "message";

export type MatchRequestFormState = {
  transportMode: TransportMode | "";
  availablePassengerSeats: string;
  passengerCount: string;
  escortSeats: string;
  cargo: CargoCountsV1;
  carryLuggage: boolean;
  itemQuantity: string;
  itemUnit: ItemUnit;
  itemCondition: ItemCondition;
  purchasePriceType: PurchasePriceType;
  minBudget: string;
  maxBudget: string;
  message: string;
  fieldErrors: Partial<Record<MatchRequestField, string>>;
};

export type MatchRequestFormAction =
  | { type: "RESET"; target: MatchRequestTargetPost }
  | { type: "SET_TRANSPORT_MODE"; value: TransportMode | "" }
  | { type: "SET_SEAT_FIELD"; field: "availablePassengerSeats" | "passengerCount" | "escortSeats"; value: string }
  | { type: "SET_CARGO"; size: keyof CargoCountsV1; delta: 1 | -1 }
  | { type: "SET_CARRY_LUGGAGE"; value: boolean }
  | { type: "SET_ITEM_QUANTITY"; value: string }
  | { type: "SET_ITEM_UNIT"; value: ItemUnit }
  | { type: "SET_ITEM_CONDITION"; value: ItemCondition }
  | { type: "SET_PURCHASE_PRICE_TYPE"; value: PurchasePriceType }
  | { type: "SET_BUDGET"; field: "minBudget" | "maxBudget"; value: string }
  | { type: "SET_MESSAGE"; value: string }
  | { type: "SET_FIELD_ERRORS"; errors: MatchRequestFormState["fieldErrors"] };

export function createInitialMatchRequestForm(
  _target: MatchRequestTargetPost,
): MatchRequestFormState {
  void _target;
  return {
    transportMode: "",
    availablePassengerSeats: String(MATCH_REQUEST_TRAVEL_SEATS_MIN),
    passengerCount: String(MATCH_REQUEST_TRAVEL_SEATS_MIN),
    escortSeats: String(MATCH_REQUEST_DELIVER_ESCORT_MIN),
    cargo: { small: 0, medium: 0, large: 0, xlarge: 0 },
    carryLuggage: false,
    itemQuantity: "1",
    itemUnit: "pcs",
    itemCondition: "new",
    purchasePriceType: "range",
    minBudget: "",
    maxBudget: "",
    message: "",
    fieldErrors: {},
  };
}

function clearError(
  errors: MatchRequestFormState["fieldErrors"],
  field: MatchRequestField,
): MatchRequestFormState["fieldErrors"] {
  if (!(field in errors)) return errors;
  const next = { ...errors };
  delete next[field];
  return next;
}

export function reduceMatchRequestForm(
  state: MatchRequestFormState,
  action: MatchRequestFormAction,
): MatchRequestFormState {
  switch (action.type) {
    case "RESET":
      return createInitialMatchRequestForm(action.target);
    case "SET_TRANSPORT_MODE":
      return {
        ...state,
        transportMode: action.value,
        fieldErrors: clearError(state.fieldErrors, "transportMode"),
      };
    case "SET_SEAT_FIELD":
      return {
        ...state,
        [action.field]: action.value,
        fieldErrors: clearError(state.fieldErrors, action.field),
      };
    case "SET_CARGO": {
      const next = Math.max(0, state.cargo[action.size] + action.delta);
      return {
        ...state,
        cargo: { ...state.cargo, [action.size]: next },
        fieldErrors: clearError(state.fieldErrors, "cargo"),
      };
    }
    case "SET_CARRY_LUGGAGE":
      return {
        ...state,
        carryLuggage: action.value,
        cargo: action.value ? state.cargo : { small: 0, medium: 0, large: 0, xlarge: 0 },
        fieldErrors: clearError(state.fieldErrors, "cargo"),
      };
    case "SET_ITEM_QUANTITY":
      return {
        ...state,
        itemQuantity: action.value,
        fieldErrors: clearError(state.fieldErrors, "itemQuantity"),
      };
    case "SET_ITEM_UNIT":
      return {
        ...state,
        itemUnit: action.value,
        fieldErrors: clearError(state.fieldErrors, "itemUnit"),
      };
    case "SET_ITEM_CONDITION":
      return {
        ...state,
        itemCondition: action.value,
        fieldErrors: clearError(state.fieldErrors, "itemCondition"),
      };
    case "SET_PURCHASE_PRICE_TYPE": {
      let errors = clearError(state.fieldErrors, "purchasePriceType");
      if (action.value === "negotiable") {
        errors = clearError(clearError(errors, "minBudget"), "maxBudget");
      }
      return {
        ...state,
        purchasePriceType: action.value,
        fieldErrors: errors,
      };
    }
    case "SET_BUDGET":
      return {
        ...state,
        [action.field]: action.value,
        fieldErrors: clearError(state.fieldErrors, action.field),
      };
    case "SET_MESSAGE":
      return {
        ...state,
        message: action.value,
        fieldErrors: clearError(state.fieldErrors, "message"),
      };
    case "SET_FIELD_ERRORS":
      return { ...state, fieldErrors: action.errors };
    default:
      return state;
  }
}

export function formAfterOpenChange(
  wasOpen: boolean,
  nextOpen: boolean,
  current: MatchRequestFormState,
  target: MatchRequestTargetPost,
): MatchRequestFormState {
  if (wasOpen === nextOpen) return current;
  return createInitialMatchRequestForm(target);
}

function parseFormIntegerToken(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (!/^-?\d+$/.test(trimmed)) return raw;
  return Number(trimmed);
}

function parseFormNumberToken(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return raw;
  return Number(trimmed);
}

function optionalCargo(form: MatchRequestFormState): CargoCountsV1 | undefined {
  const total = form.cargo.small + form.cargo.medium + form.cargo.large + form.cargo.xlarge;
  if (!form.carryLuggage || total <= 0) return undefined;
  return { ...form.cargo };
}

export function collectFieldHints(
  form: MatchRequestFormState,
  target: MatchRequestTargetPost,
): Partial<Record<MatchRequestField, string>> {
  const errors: Partial<Record<MatchRequestField, string>> = {};
  const role = applicantRoleForTarget(target.post_type);

  if (form.message.trim().length > 300) {
    errors.message = "error.match_request_message_too_long";
  }

  if (role === "provider") {
    if (!form.transportMode) {
      errors.transportMode = "error.match_request_transport_mode_required";
    }
    if (target.category === "travel") {
      const seats = parseSeatCount(
        parseFormIntegerToken(form.availablePassengerSeats),
        MATCH_REQUEST_TRAVEL_SEATS_MIN,
      );
      if (seats === null) errors.availablePassengerSeats = "error.match_request_passenger_count_bounds";
    }
    if (target.category === "deliver") {
      if (form.availablePassengerSeats.trim() !== "") {
        const seats = parseSeatCount(
          parseFormIntegerToken(form.availablePassengerSeats),
          MATCH_REQUEST_DELIVER_ESCORT_MIN,
        );
        if (seats === null) {
          errors.availablePassengerSeats = "error.match_request_passenger_count_bounds";
        }
      }
    }
    return errors;
  }

  if (target.category === "travel") {
    const seats = parseSeatCount(
      parseFormIntegerToken(form.passengerCount),
      MATCH_REQUEST_TRAVEL_SEATS_MIN,
    );
    if (seats === null) errors.passengerCount = "error.match_request_passenger_count_bounds";
  }

  if (target.category === "deliver") {
    const escort = parseSeatCount(
      parseFormIntegerToken(form.escortSeats),
      MATCH_REQUEST_DELIVER_ESCORT_MIN,
    );
    if (escort === null) errors.escortSeats = "error.match_request_passenger_count_bounds";
    const cargoTotal =
      form.cargo.small + form.cargo.medium + form.cargo.large + form.cargo.xlarge;
    if ((escort ?? 0) + cargoTotal <= 0) {
      errors.cargo = "error.match_request_need_demand_quantity";
    }
  }

  if (target.category === "buy") {
    const qty = parseFiniteNonNegInt(parseFormIntegerToken(form.itemQuantity));
    if (qty === null || qty < 1) errors.itemQuantity = "error.match_request_invalid_quantity";
    if (form.purchasePriceType === "range") {
      const min = parseNonNegFiniteNumber(parseFormNumberToken(form.minBudget));
      const max = parseNonNegFiniteNumber(parseFormNumberToken(form.maxBudget));
      if (min === null) errors.minBudget = "error.match_request_invalid_budget";
      if (max === null) errors.maxBudget = "error.match_request_invalid_budget";
      if (min !== null && max !== null && min > max) {
        errors.maxBudget = "error.match_request_invalid_budget";
      }
    }
  }

  return errors;
}

function firstErrorKey(
  fieldErrors: MatchRequestFormState["fieldErrors"],
  fallback: string,
): string {
  for (const value of Object.values(fieldErrors)) {
    if (value) return value;
  }
  return fallback;
}

function assembleTypedPayload(
  form: MatchRequestFormState,
  target: MatchRequestTargetPost,
): ApplicationPayloadV1 | null {
  const applicantRole = applicantRoleForTarget(target.post_type);
  const message = form.message.trim() ? form.message : undefined;

  if (applicantRole === "provider") {
    if (!form.transportMode) return null;
    const transportMode = form.transportMode;
    if (target.category === "travel") {
      const availablePassengerSeats = parseSeatCount(
        parseFormIntegerToken(form.availablePassengerSeats),
        MATCH_REQUEST_TRAVEL_SEATS_MIN,
      );
      if (availablePassengerSeats === null) return null;
      return {
        version: 1,
        applicantRole: "provider",
        targetPostType: "demand",
        targetCategory: "travel",
        transportMode,
        availablePassengerSeats,
        availableCargo: optionalCargo(form),
        message,
      };
    }
    if (target.category === "deliver") {
      let availablePassengerSeats: number | undefined;
      if (form.availablePassengerSeats.trim() !== "") {
        const seats = parseSeatCount(
          parseFormIntegerToken(form.availablePassengerSeats),
          MATCH_REQUEST_DELIVER_ESCORT_MIN,
        );
        if (seats === null) return null;
        availablePassengerSeats = seats;
      }
      return {
        version: 1,
        applicantRole: "provider",
        targetPostType: "demand",
        targetCategory: "deliver",
        transportMode,
        availableCargo: { ...form.cargo },
        availablePassengerSeats,
        message,
      };
    }
    if (target.category === "buy" || target.category === "onsite" || target.category === "errand") {
      return {
        version: 1,
        applicantRole: "provider",
        targetPostType: "demand",
        targetCategory: target.category,
        transportMode,
        message,
      };
    }
    return null;
  }

  if (target.category === "travel") {
    const passengerCount = parseSeatCount(
      parseFormIntegerToken(form.passengerCount),
      MATCH_REQUEST_TRAVEL_SEATS_MIN,
    );
    if (passengerCount === null) return null;
    return {
      version: 1,
      applicantRole: "demand",
      targetPostType: "provider",
      targetCategory: "travel",
      passengerCount,
      luggage: optionalCargo(form),
      message,
    };
  }

  if (target.category === "deliver") {
    const escortSeats = parseSeatCount(
      parseFormIntegerToken(form.escortSeats),
      MATCH_REQUEST_DELIVER_ESCORT_MIN,
    );
    if (escortSeats === null) return null;
    return {
      version: 1,
      applicantRole: "demand",
      targetPostType: "provider",
      targetCategory: "deliver",
      escortSeats,
      cargo: { ...form.cargo },
      message,
    };
  }

  if (target.category === "buy") {
    const itemQuantity = parseFiniteNonNegInt(parseFormIntegerToken(form.itemQuantity));
    if (itemQuantity === null || itemQuantity < 1) return null;
    if (form.purchasePriceType === "range") {
      const minBudget = parseNonNegFiniteNumber(parseFormNumberToken(form.minBudget));
      const maxBudget = parseNonNegFiniteNumber(parseFormNumberToken(form.maxBudget));
      if (minBudget === null || maxBudget === null) return null;
      return {
        version: 1,
        applicantRole: "demand",
        targetPostType: "provider",
        targetCategory: "buy",
        itemQuantity,
        itemUnit: form.itemUnit,
        itemCondition: form.itemCondition,
        purchasePriceType: "range",
        minBudget,
        maxBudget,
        message,
      };
    }
    return {
      version: 1,
      applicantRole: "demand",
      targetPostType: "provider",
      targetCategory: "buy",
      itemQuantity,
      itemUnit: form.itemUnit,
      itemCondition: form.itemCondition,
      purchasePriceType: "negotiable",
      message,
    };
  }

  if (target.category === "onsite" || target.category === "errand") {
    return {
      version: 1,
      applicantRole: "demand",
      targetPostType: "provider",
      targetCategory: target.category,
      message,
    };
  }

  return null;
}

/**
 * Builds a typed candidate from form state, then runs the shared V1 parser.
 * Does not dump raw form state or target route/fee into the payload.
 */
export function buildApplicationPayloadFromForm(
  form: MatchRequestFormState,
  target: MatchRequestTargetPost,
): { ok: true; value: ApplicationPayloadV1 } | { ok: false; errorKey: string; fieldErrors: MatchRequestFormState["fieldErrors"] } {
  const fieldErrors = collectFieldHints(form, target);
  if (Object.keys(fieldErrors).length) {
    return {
      ok: false,
      errorKey: firstErrorKey(fieldErrors, "error.match_request_invalid_payload"),
      fieldErrors,
    };
  }

  const candidate = assembleTypedPayload(form, target);
  if (!candidate) {
    return {
      ok: false,
      errorKey: "error.match_request_invalid_payload",
      fieldErrors: { message: "error.match_request_invalid_payload" },
    };
  }

  const parsed = parseApplicationPayloadV1(candidate);
  if (!parsed.ok) {
    return {
      ok: false,
      errorKey: parsed.errorKey,
      fieldErrors: { message: parsed.errorKey },
    };
  }
  return { ok: true, value: parsed.value };
}

export type MatchRequestSubmitAttempt =
  | { kind: "submitted"; payload: ApplicationPayloadV1 }
  | { kind: "blocked_submitting" }
  | { kind: "invalid"; errorKey: string; fieldErrors: MatchRequestFormState["fieldErrors"] };

export function attemptMatchRequestSubmit(
  form: MatchRequestFormState,
  target: MatchRequestTargetPost,
  submitting: boolean,
): MatchRequestSubmitAttempt {
  if (submitting) return { kind: "blocked_submitting" };
  const built = buildApplicationPayloadFromForm(form, target);
  if (!built.ok) {
    return { kind: "invalid", errorKey: built.errorKey, fieldErrors: built.fieldErrors };
  }
  return { kind: "submitted", payload: built.value };
}

export function serverErrorAlert(
  serverErrorKey: string | null,
): { role: "alert"; errorKey: string } | null {
  if (!serverErrorKey) return null;
  return { role: "alert", errorKey: serverErrorKey };
}
