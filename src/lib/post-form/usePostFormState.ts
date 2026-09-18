"use client";

import { useCallback, useMemo, useReducer } from "react";
import { calculateFinalFee } from "@/lib/post-fee";
import {
  callingCodeForCountry,
  DEFAULT_PHONE_COUNTRY,
  isPhoneCountryCode,
} from "@/lib/phone/phoneNumber";
import { useRouteKmsEstimation } from "@/lib/post-form/useRouteKmsEstimation";
import type {
  DeliveryMode,
  ItemCondition,
  ItemUnit,
  PostCategory,
  PostPayload,
  PostType,
  PriceCalcType,
  ProviderPayType,
  PurchasePriceType,
  ServiceSubtype,
  ShareMode,
} from "@/lib/post-payload";
import {
  isDeliverOrTravel,
  isOnsiteOrErrand,
  isPassengerScene,
  totalLuggageUnits,
} from "@/lib/post-payload";
import {
  cleanupFieldsForServiceSubtype,
  defaultServiceSubtypeForCategory,
  deliverShowsEscortShare,
  travelShowsLuggageControls,
  travelShowsPassengerControls,
} from "@/lib/safety/serviceSubtypePublish";
import { publishTransportModesForSubtype } from "@/lib/auth/publishTransportMode";
import type { ConfirmedAddressGeo } from "@/lib/geo/addressSearch";

export type PostFormState = {
  post_type: PostType;
  category: PostCategory;
  service_subtype: ServiceSubtype | null;
  delivery_mode: DeliveryMode;
  share_mode: ShareMode;
  escort_seats: number;
  max_companions: number;
  item_condition: ItemCondition;
  dial_code: string;
  phone_country: string;
  raw_phone_local: string;
  contact_email: string;
  raw_license_plate: string;
  provider_name: string;
  vehicle_brand: string;
  vehicle_color: string;
  transport_mode: import("@/lib/types").TransportMode | "";
  departure_date: string;
  departure_time: string;
  time_buffer: number;
  departure_time_window: string;
  waypoints: string[];
  origin_address: string;
  destination_address: string;
  service_address: string;
  /** Confirmed candidate geos; null means address not confirmed (search-scope only). */
  origin_geo: ConfirmedAddressGeo | null;
  destination_geo: ConfirmedAddressGeo | null;
  service_geo: ConfirmedAddressGeo | null;
  service_time_window: string;
  item_quantity: number;
  item_unit: ItemUnit;
  price_calc_type: PriceCalcType;
  item_price: number | null;
  purchase_price_type: PurchasePriceType;
  min_budget: number | null;
  max_budget: number | null;
  provider_pay_type: ProviderPayType;
  fixed_reward: number | null;
  count_small: number;
  count_medium: number;
  count_large: number;
  count_xlarge: number;
  /** Travel scene: toggle to reveal luggage card matrix. */
  carry_luggage: boolean;
  bump_fee: number;
  estimated_kms: number;
  kms_loading: boolean;
  kms_error_key: string | null;
  title: string;
  description: string;
  reference_photo_required: boolean;
  reference_photo_uploaded: boolean;
  show_private_buyout_notice: boolean;
};

type Action =
  | { type: "SET_POST_TYPE"; post_type: PostType }
  | { type: "SET_CATEGORY"; category: PostCategory }
  | { type: "SET_SERVICE_SUBTYPE"; service_subtype: ServiceSubtype }
  | { type: "RESET_CURRENT_PUBLISH" }
  | { type: "SET_FIELD"; field: keyof PostFormState; value: PostFormState[keyof PostFormState] }
  | { type: "SET_SHARE_MODE"; share_mode: ShareMode }
  | { type: "ADD_WAYPOINT" }
  | { type: "UPDATE_WAYPOINT"; index: number; value: string }
  | { type: "REMOVE_WAYPOINT"; index: number }
  | { type: "INCREMENT_LUGGAGE"; key: "count_small" | "count_medium" | "count_large" | "count_xlarge" }
  | { type: "DECREMENT_LUGGAGE"; key: "count_small" | "count_medium" | "count_large" | "count_xlarge" }
  | { type: "SET_CARRY_LUGGAGE"; carry_luggage: boolean };

const today = new Date().toISOString().slice(0, 10);

function applySubtypeCleanup(
  state: PostFormState,
  category: PostCategory,
  service_subtype: ServiceSubtype | null,
): PostFormState {
  const cleaned = cleanupFieldsForServiceSubtype({
    category,
    postType: state.post_type,
    serviceSubtype: service_subtype,
    escort_seats: state.escort_seats,
    max_companions: state.max_companions,
    share_mode: state.share_mode,
    count_small: state.count_small,
    count_medium: state.count_medium,
    count_large: state.count_large,
    count_xlarge: state.count_xlarge,
    carry_luggage: state.carry_luggage,
  });
  const allowedModes = new Set(
    publishTransportModesForSubtype(category, service_subtype) as readonly string[],
  );
  return {
    ...state,
    category,
    service_subtype,
    escort_seats: cleaned.escort_seats,
    max_companions: cleaned.max_companions,
    share_mode: (cleaned.share_mode ?? "share") as ShareMode,
    count_small: cleaned.count_small,
    count_medium: cleaned.count_medium,
    count_large: cleaned.count_large,
    count_xlarge: cleaned.count_xlarge,
    carry_luggage: cleaned.carry_luggage,
    transport_mode:
      state.transport_mode && allowedModes.has(state.transport_mode)
        ? state.transport_mode
        : "",
  };
}

export const initialFormState: PostFormState = {
  post_type: "demand",
  category: "travel",
  service_subtype: defaultServiceSubtypeForCategory("travel"),
  delivery_mode: "spot",
  share_mode: "share",
  escort_seats: 1,
  max_companions: 1,
  item_condition: "new",
  dial_code: "+381",
  phone_country: DEFAULT_PHONE_COUNTRY,
  raw_phone_local: "",
  contact_email: "",
  raw_license_plate: "",
  provider_name: "",
  vehicle_brand: "",
  vehicle_color: "",
  transport_mode: "",
  departure_date: today,
  departure_time: "14:00",
  time_buffer: 30,
  departure_time_window: "14:00-14:30",
  waypoints: [],
  origin_address: "",
  destination_address: "",
  service_address: "",
  origin_geo: null,
  destination_geo: null,
  service_geo: null,
  service_time_window: "14:00-14:30",
  item_quantity: 1,
  item_unit: "pcs",
  price_calc_type: "unit",
  item_price: null,
  purchase_price_type: "range",
  min_budget: null,
  max_budget: null,
  provider_pay_type: "fixed",
  fixed_reward: null,
  count_small: 0,
  count_medium: 0,
  count_large: 0,
  count_xlarge: 0,
  carry_luggage: false,
  bump_fee: 0,
  estimated_kms: 0,
  kms_loading: false,
  kms_error_key: null as string | null,
  title: "",
  description: "",
  reference_photo_required: false,
  reference_photo_uploaded: false,
  show_private_buyout_notice: false,
};

function clampSeats(n: number): number {
  return Math.min(4, Math.max(0, Math.floor(n)));
}

function reducer(state: PostFormState, action: Action): PostFormState {
  switch (action.type) {
    case "SET_POST_TYPE": {
      const next = {
        ...initialFormState,
        post_type: action.post_type,
        category: "travel" as const,
        service_subtype: defaultServiceSubtypeForCategory("travel"),
        departure_date: state.departure_date,
        departure_time: state.departure_time,
        time_buffer: state.time_buffer,
        departure_time_window: state.departure_time_window,
        dial_code: state.dial_code,
        phone_country: state.phone_country,
        raw_phone_local: state.raw_phone_local,
        contact_email: state.contact_email,
      };
      return applySubtypeCleanup(next, "travel", next.service_subtype);
    }
    case "SET_CATEGORY": {
      const service_subtype = defaultServiceSubtypeForCategory(action.category);
      return applySubtypeCleanup(
        {
          ...state,
          delivery_mode: "spot",
          show_private_buyout_notice: false,
        },
        action.category,
        service_subtype,
      );
    }
    case "SET_SERVICE_SUBTYPE":
      return applySubtypeCleanup(state, state.category, action.service_subtype);
    case "RESET_CURRENT_PUBLISH": {
      const next = {
        ...initialFormState,
        post_type: state.post_type,
        category: state.category,
        service_subtype: defaultServiceSubtypeForCategory(state.category),
        departure_date: new Date().toISOString().slice(0, 10),
      };
      return applySubtypeCleanup(next, next.category, next.service_subtype);
    }
    case "SET_FIELD": {
      const countryValue = String(action.value);
      if (action.field === "phone_country" && isPhoneCountryCode(countryValue)) {
        return {
          ...state,
          phone_country: countryValue,
          dial_code: `+${callingCodeForCountry(countryValue)}`,
        };
      }
      return { ...state, [action.field]: action.value };
    }
    case "SET_SHARE_MODE": {
      const share_mode = action.share_mode;
      if (share_mode === "private") {
        return {
          ...state,
          share_mode,
          max_companions: travelShowsPassengerControls(state.service_subtype)
            ? 4
            : state.max_companions,
          escort_seats:
            state.category === "deliver" &&
            state.service_subtype === "cargo_with_escort"
              ? 1
              : travelShowsPassengerControls(state.service_subtype)
                ? 4
                : state.escort_seats,
          show_private_buyout_notice: true,
        };
      }
      return { ...state, share_mode, show_private_buyout_notice: false };
    }
    case "ADD_WAYPOINT":
      if (state.waypoints.length >= 10) return state;
      return { ...state, waypoints: [...state.waypoints, ""] };
    case "UPDATE_WAYPOINT": {
      const waypoints = [...state.waypoints];
      waypoints[action.index] = action.value;
      return { ...state, waypoints };
    }
    case "REMOVE_WAYPOINT":
      return { ...state, waypoints: state.waypoints.filter((_, i) => i !== action.index) };
    case "INCREMENT_LUGGAGE":
      return { ...state, [action.key]: state[action.key] + 1 };
    case "DECREMENT_LUGGAGE":
      return { ...state, [action.key]: Math.max(0, state[action.key] - 1) };
    case "SET_CARRY_LUGGAGE":
      if (!action.carry_luggage) {
        return {
          ...state,
          carry_luggage: false,
          count_small: 0,
          count_medium: 0,
          count_large: 0,
          count_xlarge: 0,
        };
      }
      return { ...state, carry_luggage: true };
    default:
      return state;
  }
}

/** Test/harness entry — production UI uses usePostFormState dispatch. */
export type PostFormAction = Action;
export function reducePostFormState(
  state: PostFormState,
  action: Action,
): PostFormState {
  return reducer(state, action);
}

export function usePostFormState() {
  const [state, dispatch] = useReducer(reducer, initialFormState);

  const setField = useCallback(<K extends keyof PostFormState>(field: K, value: PostFormState[K]) => {
    dispatch({ type: "SET_FIELD", field, value });
  }, []);

  const setKmsLoading = useCallback((loading: boolean) => {
    setField("kms_loading", loading);
  }, [setField]);

  const setKmsError = useCallback((errorKey: string | null) => {
    setField("kms_error_key", errorKey);
  }, [setField]);

  useRouteKmsEstimation({ state, setField, setKmsLoading, setKmsError });

  const setPostType = useCallback((post_type: PostType) => {
    dispatch({ type: "SET_POST_TYPE", post_type });
  }, []);

  const setCategory = useCallback((category: PostCategory) => {
    dispatch({ type: "SET_CATEGORY", category });
  }, []);

  const setServiceSubtype = useCallback((service_subtype: ServiceSubtype) => {
    dispatch({ type: "SET_SERVICE_SUBTYPE", service_subtype });
  }, []);

  const setShareMode = useCallback((share_mode: ShareMode) => {
    dispatch({ type: "SET_SHARE_MODE", share_mode });
  }, []);

  const resetCurrentPublishForm = useCallback(() => {
    dispatch({ type: "RESET_CURRENT_PUBLISH" });
  }, []);

  const setEscortSeats = useCallback(
    (n: number) => {
      if (state.service_subtype === "cargo_with_escort") {
        setField("escort_seats", 1);
        return;
      }
      if (state.service_subtype === "cargo_only") {
        setField("escort_seats", 0);
        return;
      }
      const clamped = clampSeats(n);
      if (state.share_mode === "private" && clamped >= 1) {
        setField("escort_seats", 4);
      } else {
        setField("escort_seats", clamped);
      }
    },
    [state.share_mode, state.service_subtype, setField],
  );

  const setMaxCompanions = useCallback(
    (n: number) => {
      const clamped = clampSeats(Math.max(1, n));
      if (state.share_mode === "private") {
        setField("max_companions", 4);
        setField("escort_seats", 4);
      } else {
        setField("max_companions", clamped);
        setField("escort_seats", clamped);
      }
    },
    [state.share_mode, setField],
  );

  const visibility = useMemo(() => {
    const { post_type, category, service_subtype } = state;
    const route = isDeliverOrTravel(category);
    const local = isOnsiteOrErrand(category);
    const buy = category === "buy";
    const showWaypoints = route && post_type === "provider";
    const showDeliveryMode = route && post_type === "demand" && category === "deliver";
    const showShareMode =
      route &&
      (travelShowsPassengerControls(service_subtype) ||
        deliverShowsEscortShare(service_subtype, post_type));
    const showLuggage =
      category === "deliver" ||
      (category === "travel" && travelShowsLuggageControls(service_subtype));
    const showCarryLuggageToggle = false;
    const showFeeDemand = route && post_type === "demand";
    const showTitleDesc = !route;
    const showProviderAssets = post_type === "provider" && (route || buy);
    const showEscortSeats = false;
    const showMaxCompanions =
      route &&
      category === "travel" &&
      travelShowsPassengerControls(service_subtype);
    const showServiceSubtype = route;
    const showTransportMode = route;
    return {
      route,
      local,
      buy,
      showWaypoints,
      showDeliveryMode,
      showShareMode,
      showLuggage,
      showCarryLuggageToggle,
      showFeeDemand,
      showTitleDesc,
      showProviderAssets,
      showEscortSeats,
      showMaxCompanions,
      showServiceSubtype,
      showTransportMode,
    };
  }, [state]);

  const draftPayload = useMemo((): Partial<PostPayload> => {
    const luggageActive =
      state.category === "deliver" ||
      (state.category === "travel" &&
        travelShowsLuggageControls(state.service_subtype));
    const p: Partial<PostPayload> = {
      post_type: state.post_type,
      category: state.category,
      service_subtype: state.service_subtype,
      count_small: luggageActive ? state.count_small : 0,
      count_medium: luggageActive ? state.count_medium : 0,
      count_large: luggageActive ? state.count_large : 0,
      count_xlarge: luggageActive ? state.count_xlarge : 0,
      bump_fee: state.bump_fee,
      departure_date: state.departure_date,
      departure_time_window: state.departure_time_window,
      estimated_kms: state.estimated_kms,
      raw_phone: state.raw_phone_local,
      phone_id: 0,
      normalized_phone: "",
      fee_amount: null,
    };
    if (visibility.showDeliveryMode) p.delivery_mode = state.delivery_mode;
    else p.delivery_mode = null;
    if (visibility.showShareMode) p.share_mode = state.share_mode;
    else p.share_mode = null;
    if (state.category === "deliver") {
      p.escort_seats =
        state.post_type === "demand" &&
        state.service_subtype === "cargo_with_escort"
          ? 1
          : 0;
    } else if (travelShowsPassengerControls(state.service_subtype)) {
      p.escort_seats =
        state.share_mode === "private" ? 4 : state.max_companions;
      p.max_companions = p.escort_seats;
    } else {
      p.escort_seats = 0;
      p.max_companions = 0;
    }
    return p;
  }, [state, visibility]);

  const computedFee = useMemo(() => {
    if (!visibility.route || state.post_type !== "demand") return null;
    if (state.estimated_kms <= 0) return null;
    return calculateFinalFee(state.estimated_kms, draftPayload as PostPayload);
  }, [draftPayload, state.estimated_kms, state.post_type, visibility.route]);

  const feeReady = state.estimated_kms > 0 && !state.kms_loading && !state.kms_error_key;

  const feeIsCityLevelEstimate = useMemo(() => {
    if (!visibility.route) return false;
    return (
      state.origin_geo?.resultLevel === "city" ||
      state.destination_geo?.resultLevel === "city"
    );
  }, [
    state.destination_geo?.resultLevel,
    state.origin_geo?.resultLevel,
    visibility.route,
  ]);

  const showSmallItemHandoffHint = useMemo(() => {
    return (
      visibility.showFeeDemand &&
      state.post_type === "demand" &&
      state.category === "travel" &&
      state.service_subtype === "small_item_only"
    );
  }, [
    visibility.showFeeDemand,
    state.post_type,
    state.category,
    state.service_subtype,
  ]);

  const luggageUnits = useMemo(() => totalLuggageUnits(state), [state]);

  const showPassengerScene = useMemo(
    () =>
      isPassengerScene({
        category: state.category,
        escort_seats: state.escort_seats,
      }) || travelShowsPassengerControls(state.service_subtype),
    [state.category, state.escort_seats, state.service_subtype],
  );

  return {
    state,
    dispatch,
    setField,
    setPostType,
    setCategory,
    setServiceSubtype,
    setShareMode,
    resetCurrentPublishForm,
    setEscortSeats,
    setMaxCompanions,
    visibility,
    draftPayload,
    computedFee,
    feeReady,
    feeIsCityLevelEstimate,
    showSmallItemHandoffHint,
    luggageUnits,
    showPassengerScene,
  };
}

export type PostFormController = ReturnType<typeof usePostFormState>;
