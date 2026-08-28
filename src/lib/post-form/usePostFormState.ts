"use client";

import { useCallback, useMemo, useReducer } from "react";
import { calculateFinalFee } from "@/lib/post-fee";
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
  ShareMode,
} from "@/lib/post-payload";
import {
  isDeliverOrTravel,
  isOnsiteOrErrand,
  isPassengerScene,
  totalLuggageUnits,
} from "@/lib/post-payload";

export type PostFormState = {
  post_type: PostType;
  category: PostCategory;
  delivery_mode: DeliveryMode;
  share_mode: ShareMode;
  escort_seats: number;
  max_companions: number;
  item_condition: ItemCondition;
  dial_code: string;
  raw_phone_local: string;
  raw_license_plate: string;
  provider_name: string;
  vehicle_brand: string;
  vehicle_color: string;
  departure_date: string;
  departure_time_window: string;
  waypoints: string[];
  origin_address: string;
  destination_address: string;
  service_address: string;
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
  | { type: "SET_FIELD"; field: keyof PostFormState; value: PostFormState[keyof PostFormState] }
  | { type: "SET_SHARE_MODE"; share_mode: ShareMode }
  | { type: "ADD_WAYPOINT" }
  | { type: "UPDATE_WAYPOINT"; index: number; value: string }
  | { type: "REMOVE_WAYPOINT"; index: number }
  | { type: "INCREMENT_LUGGAGE"; key: "count_small" | "count_medium" | "count_large" | "count_xlarge" }
  | { type: "DECREMENT_LUGGAGE"; key: "count_small" | "count_medium" | "count_large" | "count_xlarge" };

const today = new Date().toISOString().slice(0, 10);

export const initialFormState: PostFormState = {
  post_type: "demand",
  category: "deliver",
  delivery_mode: "spot",
  share_mode: "share",
  escort_seats: 0,
  max_companions: 1,
  item_condition: "new",
  dial_code: "+381",
  raw_phone_local: "",
  raw_license_plate: "",
  provider_name: "",
  vehicle_brand: "",
  vehicle_color: "",
  departure_date: today,
  departure_time_window: "09:00-09:15",
  waypoints: [],
  origin_address: "",
  destination_address: "",
  service_address: "",
  service_time_window: "09:00-09:15",
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
      return {
        ...initialFormState,
        post_type: action.post_type,
        category: "deliver",
        departure_date: state.departure_date,
        dial_code: state.dial_code,
        raw_phone_local: state.raw_phone_local,
      };
    }
    case "SET_CATEGORY":
      return { ...state, category: action.category };
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };
    case "SET_SHARE_MODE": {
      const share_mode = action.share_mode;
      if (share_mode === "private") {
        return {
          ...state,
          share_mode,
          max_companions: state.category === "travel" ? 4 : state.max_companions,
          escort_seats:
            state.category === "deliver" && state.escort_seats >= 1 ? 4 : state.escort_seats,
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
    default:
      return state;
  }
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

  const setShareMode = useCallback((share_mode: ShareMode) => {
    dispatch({ type: "SET_SHARE_MODE", share_mode });
  }, []);

  const setEscortSeats = useCallback(
    (n: number) => {
      const clamped = clampSeats(n);
      if (state.share_mode === "private" && clamped >= 1) {
        setField("escort_seats", 4);
      } else {
        setField("escort_seats", clamped);
      }
    },
    [state.share_mode, setField],
  );

  const setMaxCompanions = useCallback(
    (n: number) => {
      const clamped = clampSeats(Math.max(1, n));
      if (state.share_mode === "private") {
        setField("max_companions", 4);
      } else {
        setField("max_companions", clamped);
      }
    },
    [state.share_mode, setField],
  );

  const visibility = useMemo(() => {
    const { post_type, category, escort_seats } = state;
    const route = isDeliverOrTravel(category);
    const local = isOnsiteOrErrand(category);
    const buy = category === "buy";
    const showWaypoints = route && post_type === "provider";
    const showDeliveryMode = route && post_type === "demand" && category === "deliver";
    const showShareMode =
      route &&
      (category === "travel" || (category === "deliver" && escort_seats >= 1));
    const showLuggage = route;
    const showFeeDemand = route && post_type === "demand";
    const showTitleDesc = !route;
    const showProviderAssets = post_type === "provider" && (route || buy);
    const showEscortSeats = route && category === "deliver" && post_type === "demand";
    const showMaxCompanions = route && category === "travel";
    return {
      route,
      local,
      buy,
      showWaypoints,
      showDeliveryMode,
      showShareMode,
      showLuggage,
      showFeeDemand,
      showTitleDesc,
      showProviderAssets,
      showEscortSeats,
      showMaxCompanions,
    };
  }, [state]);

  const draftPayload = useMemo((): Partial<PostPayload> => {
    const p: Partial<PostPayload> = {
      post_type: state.post_type,
      category: state.category,
      count_small: state.count_small,
      count_medium: state.count_medium,
      count_large: state.count_large,
      count_xlarge: state.count_xlarge,
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
    if (visibility.showEscortSeats) p.escort_seats = state.escort_seats;
    else p.escort_seats = null;
    if (visibility.showMaxCompanions) p.max_companions = state.max_companions;
    else p.max_companions = null;
    if (state.category === "travel") {
      p.escort_seats =
        state.share_mode === "private" ? 4 : state.max_companions;
    }
    return p;
  }, [state, visibility]);

  const computedFee = useMemo(() => {
    if (!visibility.route || state.post_type !== "demand") return null;
    if (state.estimated_kms <= 0) return null;
    return calculateFinalFee(state.estimated_kms, draftPayload as PostPayload);
  }, [draftPayload, state.estimated_kms, state.post_type, visibility.route]);

  const feeReady = state.estimated_kms > 0 && !state.kms_loading && !state.kms_error_key;

  const luggageUnits = useMemo(() => totalLuggageUnits(state), [state]);

  const showPassengerScene = useMemo(
    () => isPassengerScene({ category: state.category, escort_seats: state.escort_seats }),
    [state.category, state.escort_seats],
  );

  return {
    state,
    dispatch,
    setField,
    setPostType,
    setCategory,
    setShareMode,
    setEscortSeats,
    setMaxCompanions,
    visibility,
    draftPayload,
    computedFee,
    feeReady,
    luggageUnits,
    showPassengerScene,
  };
}

export type PostFormController = ReturnType<typeof usePostFormState>;
