/**
 * Pure address field refinement state machine.
 * Shared by origin and destination AddressSearchField — no duplicated forks.
 */

import type {
  AddressSearchCandidate,
  ConfirmedAddressGeo,
} from "@/lib/geo/addressSearch";

export type RefinementTab = "search" | "map_link";

export type AddressFieldMode = "city_search" | "refine";

export type PendingMapImport = {
  candidate: AddressSearchCandidate;
};

export type AddressFieldMachineState = {
  mode: AddressFieldMode;
  /** Locked city when refining; kept even while precise place is edited. */
  cityAnchor: ConfirmedAddressGeo | null;
  refineTab: RefinementTab;
  pendingMapImport: PendingMapImport | null;
};

export type AddressFieldMachineAction =
  | { type: "ENTER_REFINE" }
  | { type: "USE_WHOLE_CITY" }
  | { type: "BACK_TO_CITY_SEARCH" }
  | { type: "SET_TAB"; tab: RefinementTab }
  | { type: "SET_CITY_ANCHOR"; city: ConfirmedAddressGeo }
  | { type: "CLEAR_PENDING_MAP" }
  | { type: "SET_PENDING_MAP"; candidate: AddressSearchCandidate }
  | { type: "CONFIRM_PRECISE"; place: ConfirmedAddressGeo }
  | { type: "RESET_ALL" };

export function initialAddressFieldMachine(
  confirmed: ConfirmedAddressGeo | null,
): AddressFieldMachineState {
  if (confirmed?.resultLevel === "city") {
    return {
      mode: "city_search",
      cityAnchor: confirmed,
      refineTab: "search",
      pendingMapImport: null,
    };
  }
  if (confirmed != null) {
    // Precise place already confirmed — keep city anchor if locality present.
    return {
      mode: "city_search",
      cityAnchor: null,
      refineTab: "search",
      pendingMapImport: null,
    };
  }
  return {
    mode: "city_search",
    cityAnchor: null,
    refineTab: "search",
    pendingMapImport: null,
  };
}

export function reduceAddressFieldMachine(
  state: AddressFieldMachineState,
  action: AddressFieldMachineAction,
): AddressFieldMachineState {
  switch (action.type) {
    case "ENTER_REFINE": {
      if (state.cityAnchor == null && state.mode !== "refine") {
        return state;
      }
      const city = state.cityAnchor;
      if (city == null) return state;
      return {
        mode: "refine",
        cityAnchor: city,
        refineTab: "search",
        pendingMapImport: null,
      };
    }
    case "USE_WHOLE_CITY": {
      if (state.cityAnchor == null) return state;
      return {
        mode: "city_search",
        cityAnchor: state.cityAnchor,
        refineTab: "search",
        pendingMapImport: null,
      };
    }
    case "BACK_TO_CITY_SEARCH":
      return {
        mode: "city_search",
        cityAnchor: null,
        refineTab: "search",
        pendingMapImport: null,
      };
    case "SET_TAB":
      return {
        ...state,
        refineTab: action.tab,
        pendingMapImport: null,
      };
    case "SET_CITY_ANCHOR":
      return {
        ...state,
        cityAnchor: action.city,
      };
    case "SET_PENDING_MAP":
      return {
        ...state,
        pendingMapImport: { candidate: action.candidate },
      };
    case "CLEAR_PENDING_MAP":
      return { ...state, pendingMapImport: null };
    case "CONFIRM_PRECISE":
      return {
        mode: "city_search",
        cityAnchor: state.cityAnchor,
        refineTab: "search",
        pendingMapImport: null,
      };
    case "RESET_ALL":
      return initialAddressFieldMachine(null);
    default:
      return state;
  }
}

/** Side-effect intent for USE_WHOLE_CITY / BACK / CONFIRM — applied by UI. */
export function cityAnchorAsConfirmed(
  city: ConfirmedAddressGeo,
): ConfirmedAddressGeo {
  return city;
}
