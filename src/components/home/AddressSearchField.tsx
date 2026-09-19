"use client";

import { useReducer, useState } from "react";
import { useTranslations } from "next-intl";
import { AddressCountrySelect } from "@/components/home/AddressCountrySelect";
import {
  ADDRESS_SEARCH_PAGE_SIZE,
  candidateToConfirmed,
  type AddressSearchCandidate,
  type ConfirmedAddressGeo,
} from "@/lib/geo/addressSearch";
import {
  initialAddressFieldMachine,
  reduceAddressFieldMachine,
  type RefinementTab,
} from "@/lib/geo/addressRefinementState";
import type { PhoneCountryCode } from "@/lib/phone/phoneNumber";

const inputClass =
  "h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

type Props = {
  label: string;
  confirmed: ConfirmedAddressGeo | null;
  onConfirmedChange: (next: ConfirmedAddressGeo | null) => void;
  forceValidation?: boolean;
};

type SearchResponse =
  | { ok: true; candidates: AddressSearchCandidate[] }
  | { ok: false; errorKey?: string };

type MapLinkResponse =
  | { ok: true; candidate: AddressSearchCandidate }
  | { ok: false; errorKey?: string };

function mapLinkErrorMessage(
  t: ReturnType<typeof useTranslations<"home.address">>,
  key: string,
): string {
  switch (key) {
    case "error.map_link_invalid":
      return t("map_link_invalid");
    case "error.map_link_host_not_allowed":
      return t("map_link_host_not_allowed");
    case "error.map_link_redirect_invalid":
      return t("map_link_redirect_invalid");
    case "error.map_link_timeout":
      return t("map_link_timeout");
    case "error.map_link_coordinates_unavailable":
      return t("map_link_coordinates_unavailable");
    case "error.map_link_coordinates_ambiguous":
      return t("map_link_coordinates_ambiguous");
    case "error.map_link_country_mismatch":
      return t("map_link_country_mismatch");
    case "error.map_link_place_unavailable":
      return t("map_link_place_unavailable");
    default:
      return t("search_failed");
  }
}

export function AddressSearchField({
  label,
  confirmed,
  onConfirmedChange,
  forceValidation = false,
}: Props) {
  const t = useTranslations("home.address");
  const [countryCode, setCountryCode] = useState<string | null>(
    confirmed?.searchCountryCode ?? null,
  );
  const [query, setQuery] = useState(
    confirmed?.resultLevel === "city" ? "" : (confirmed?.displayName ?? ""),
  );
  const [mapLink, setMapLink] = useState("");
  const [candidates, setCandidates] = useState<AddressSearchCandidate[]>([]);
  const [visibleCount, setVisibleCount] = useState(ADDRESS_SEARCH_PAGE_SIZE);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [attemptedSearch, setAttemptedSearch] = useState(false);
  const [machine, dispatch] = useReducer(
    reduceAddressFieldMachine,
    confirmed,
    initialAddressFieldMachine,
  );

  const refining = machine.mode === "refine";
  const cityAnchor = machine.cityAnchor;
  const showCountryError =
    (attemptedSearch || forceValidation) && !countryCode;
  const showConfirmError =
    forceValidation && countryCode != null && confirmed == null;
  const visibleCandidates = candidates.slice(0, visibleCount);
  const canShowMore = visibleCount < candidates.length;
  const allResultsShown = candidates.length > 0 && !canShowMore;

  function clearConfirmation() {
    if (confirmed != null) onConfirmedChange(null);
  }

  function resetSearchDraft() {
    setQuery("");
    setMapLink("");
    setCandidates([]);
    setVisibleCount(ADDRESS_SEARCH_PAGE_SIZE);
    setSearchError(null);
    setMapError(null);
  }

  function onCountryChange(next: PhoneCountryCode | null) {
    setCountryCode(next);
    resetSearchDraft();
    setAttemptedSearch(false);
    dispatch({ type: "RESET_ALL" });
    onConfirmedChange(null);
  }

  function onQueryChange(value: string) {
    setQuery(value);
    setCandidates([]);
    setVisibleCount(ADDRESS_SEARCH_PAGE_SIZE);
    setSearchError(null);
    // Editing invalidates precise confirmation (and thus distance/fee upstream).
    if (refining || (confirmed != null && confirmed.resultLevel !== "city")) {
      clearConfirmation();
    } else if (!refining) {
      clearConfirmation();
    }
  }

  function onMapLinkChange(value: string) {
    setMapLink(value);
    setMapError(null);
    dispatch({ type: "CLEAR_PENDING_MAP" });
    if (confirmed != null && confirmed.resultLevel !== "city") {
      clearConfirmation();
    }
  }

  async function runSearch() {
    setAttemptedSearch(true);
    if (!countryCode) {
      setCandidates([]);
      setVisibleCount(ADDRESS_SEARCH_PAGE_SIZE);
      return;
    }
    const q = query.trim();
    if (!q) {
      setSearchError("error.address_query_required");
      setCandidates([]);
      setVisibleCount(ADDRESS_SEARCH_PAGE_SIZE);
      return;
    }

    setSearching(true);
    setSearchError(null);
    try {
      const localityContext =
        refining && cityAnchor != null
          ? cityAnchor.localityContext ?? cityAnchor.primaryLabel
          : null;
      const res = await fetch("/api/geocode/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countryCode,
          query: q,
          localityContext,
        }),
      });
      const json = (await res.json()) as SearchResponse;
      if (!json.ok) {
        setCandidates([]);
        setVisibleCount(ADDRESS_SEARCH_PAGE_SIZE);
        setSearchError(json.errorKey ?? "error.geocode_failed");
        return;
      }
      setCandidates(json.candidates ?? []);
      setVisibleCount(ADDRESS_SEARCH_PAGE_SIZE);
      if ((json.candidates ?? []).length === 0) {
        setSearchError("error.address_no_candidates");
      }
    } catch {
      setCandidates([]);
      setVisibleCount(ADDRESS_SEARCH_PAGE_SIZE);
      setSearchError("error.geocode_failed");
    } finally {
      setSearching(false);
    }
  }

  function showMoreCandidates() {
    setVisibleCount((n) =>
      Math.min(n + ADDRESS_SEARCH_PAGE_SIZE, candidates.length),
    );
  }

  function selectCandidate(candidate: AddressSearchCandidate) {
    if (!countryCode) return;
    const next = candidateToConfirmed(candidate, countryCode);
    onConfirmedChange(next);
    setQuery(next.resultLevel === "city" ? "" : next.displayName);
    setCandidates([]);
    setVisibleCount(ADDRESS_SEARCH_PAGE_SIZE);
    setSearchError(null);
    if (next.resultLevel === "city") {
      dispatch({ type: "SET_CITY_ANCHOR", city: next });
      dispatch({ type: "USE_WHOLE_CITY" });
    } else {
      dispatch({ type: "CONFIRM_PRECISE", place: next });
    }
  }

  function enterRefine() {
    if (confirmed?.resultLevel === "city") {
      dispatch({ type: "SET_CITY_ANCHOR", city: confirmed });
    }
    const anchor =
      confirmed?.resultLevel === "city" ? confirmed : cityAnchor;
    if (anchor == null) return;
    dispatch({ type: "SET_CITY_ANCHOR", city: anchor });
    dispatch({ type: "ENTER_REFINE" });
    resetSearchDraft();
    // Keep city confirmed until user picks a precise place or backs out.
    onConfirmedChange(anchor);
  }

  function useWholeCity() {
    if (cityAnchor == null) return;
    onConfirmedChange(cityAnchor);
    dispatch({ type: "USE_WHOLE_CITY" });
    resetSearchDraft();
  }

  function backToCitySearch() {
    dispatch({ type: "BACK_TO_CITY_SEARCH" });
    onConfirmedChange(null);
    resetSearchDraft();
  }

  function setTab(tab: RefinementTab) {
    dispatch({ type: "SET_TAB", tab });
    setSearchError(null);
    setMapError(null);
    setCandidates([]);
  }

  async function importMapLink() {
    setAttemptedSearch(true);
    if (!countryCode) return;
    const url = mapLink.trim();
    if (!url) {
      setMapError("error.map_link_invalid");
      return;
    }
    setImporting(true);
    setMapError(null);
    try {
      const res = await fetch("/api/geocode/map-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, countryCode }),
      });
      const json = (await res.json()) as MapLinkResponse;
      if (!json.ok || !("candidate" in json) || json.candidate == null) {
        setMapError(
          !json.ok && "errorKey" in json && json.errorKey
            ? json.errorKey
            : "error.map_link_invalid",
        );
        dispatch({ type: "CLEAR_PENDING_MAP" });
        return;
      }
      dispatch({ type: "SET_PENDING_MAP", candidate: json.candidate });
    } catch {
      setMapError("error.map_link_invalid");
      dispatch({ type: "CLEAR_PENDING_MAP" });
    } finally {
      setImporting(false);
    }
  }

  function confirmPendingMap() {
    if (!countryCode || machine.pendingMapImport == null) return;
    const next = candidateToConfirmed(
      machine.pendingMapImport.candidate,
      countryCode,
    );
    onConfirmedChange(next);
    setQuery(next.displayName);
    dispatch({ type: "CONFIRM_PRECISE", place: next });
    setMapLink("");
  }

  function chooseAnotherMapPlace() {
    dispatch({ type: "CLEAR_PENDING_MAP" });
    setMapLink("");
    setMapError(null);
  }

  const showCityOnlyRefineCta =
    confirmed?.resultLevel === "city" &&
    !refining &&
    candidates.length <= 1;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-zinc-700">{label}</p>

      {(cityAnchor != null || confirmed?.resultLevel === "city") && (
        <div className="rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-700 ring-1 ring-zinc-200/80">
          <span className="font-semibold">{t("city_context_label")}: </span>
          <span>
            {(cityAnchor ?? confirmed)?.primaryLabel}
            {(cityAnchor ?? confirmed)?.countryCode
              ? ` · ${(cityAnchor ?? confirmed)?.countryCode}`
              : ""}
          </span>
          {(cityAnchor ?? confirmed)?.resultLevel === "city" ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
              {t("city_level")}
            </span>
          ) : null}
        </div>
      )}

      {refining ? (
        <div className="space-y-3 rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-3">
          <p className="text-sm font-semibold text-zinc-900">
            {t("refine_title")}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                machine.refineTab === "search"
                  ? "bg-zinc-900 text-white"
                  : "bg-white text-zinc-700 ring-1 ring-zinc-200"
              }`}
              onClick={() => setTab("search")}
            >
              {t("refine_tab_search")}
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                machine.refineTab === "map_link"
                  ? "bg-zinc-900 text-white"
                  : "bg-white text-zinc-700 ring-1 ring-zinc-200"
              }`}
              onClick={() => setTab("map_link")}
            >
              {t("refine_tab_map_link")}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="text-xs font-semibold text-emerald-800 hover:underline"
              onClick={useWholeCity}
            >
              {t("use_whole_city")}
            </button>
            <button
              type="button"
              className="text-xs font-semibold text-zinc-600 hover:underline"
              onClick={backToCitySearch}
            >
              {t("back_to_city_search")}
            </button>
          </div>

          {machine.refineTab === "search" ? (
            <div className="flex flex-nowrap items-stretch gap-2 max-[360px]:flex-wrap">
              <input
                className={`${inputClass} min-w-0 flex-1`}
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runSearch();
                  }
                }}
                placeholder={t("refine_query_placeholder")}
                autoComplete="off"
              />
              <button
                type="button"
                disabled={searching}
                onClick={() => void runSearch()}
                className="h-11 shrink-0 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white enabled:hover:bg-zinc-800 disabled:opacity-60"
              >
                {searching ? t("searching") : t("search")}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-nowrap items-stretch gap-2 max-[360px]:flex-wrap">
                <input
                  className={`${inputClass} min-w-0 flex-1`}
                  value={mapLink}
                  onChange={(e) => onMapLinkChange(e.target.value)}
                  placeholder={t("map_link_placeholder")}
                  autoComplete="off"
                />
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => void importMapLink()}
                  className="h-11 shrink-0 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white enabled:hover:bg-zinc-800 disabled:opacity-60"
                >
                  {importing ? t("map_link_importing") : t("map_link_import")}
                </button>
              </div>
              {mapError ? (
                <p className="text-xs text-rose-600">
                  {mapLinkErrorMessage(t, mapError)}
                </p>
              ) : null}
              {machine.pendingMapImport ? (
                <div className="space-y-2 rounded-xl bg-white p-3 ring-1 ring-emerald-200">
                  <p className="text-sm font-semibold text-zinc-900">
                    {machine.pendingMapImport.candidate.primaryLabel}
                  </p>
                  <p className="text-xs text-zinc-600">
                    {machine.pendingMapImport.candidate.displayName}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {[
                      machine.pendingMapImport.candidate.localityLabel,
                      machine.pendingMapImport.candidate.countryName,
                      machine.pendingMapImport.candidate.countryCode,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="text-xs text-zinc-500">{t("map_link_source")}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white"
                      onClick={confirmPendingMap}
                    >
                      {t("map_link_confirm")}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200"
                      onClick={chooseAnotherMapPlace}
                    >
                      {t("map_link_choose_another")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-nowrap items-stretch gap-2 max-[360px]:flex-wrap">
          <div className="w-[5.25rem] shrink-0 max-[360px]:w-full">
            <AddressCountrySelect
              compact
              value={countryCode}
              onChange={onCountryChange}
              showRequiredError={showCountryError}
            />
          </div>
          <input
            className={`${inputClass} min-w-0 flex-1`}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runSearch();
              }
            }}
            placeholder={t("query_placeholder")}
            autoComplete="off"
          />
          <button
            type="button"
            disabled={searching}
            onClick={() => void runSearch()}
            className="h-11 shrink-0 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white enabled:hover:bg-zinc-800 disabled:opacity-60 max-[360px]:w-full"
          >
            {searching ? t("searching") : t("search")}
          </button>
        </div>
      )}

      {!refining ? (
        <p className="text-xs leading-5 text-zinc-500">{t("query_hint")}</p>
      ) : null}

      {confirmed != null ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900 ring-1 ring-emerald-200/80">
          <span className="font-semibold">{t("confirmed")}</span>
          <span className="min-w-0 flex-1 truncate">{confirmed.displayName}</span>
          {confirmed.resultLevel === "city" ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
              {t("city_level")}
            </span>
          ) : null}
        </div>
      ) : null}

      {confirmed?.resultLevel === "city" && !refining ? (
        <div className="space-y-1 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 px-3 py-2">
          <p className="text-xs text-zinc-600">{t("refine_hint")}</p>
          <button
            type="button"
            className={`text-xs font-semibold text-emerald-700 hover:underline ${
              showCityOnlyRefineCta ? "text-sm" : ""
            }`}
            onClick={enterRefine}
          >
            {t("refine_action")}
          </button>
        </div>
      ) : null}

      {showConfirmError ? (
        <p className="text-xs text-rose-600">{t("confirm_required")}</p>
      ) : null}
      {searchError && (!refining || machine.refineTab === "search") ? (
        <p className="text-xs text-rose-600">
          {searchError === "error.address_query_required"
            ? t("query_required")
            : searchError === "error.address_no_candidates"
              ? t("no_candidates")
              : searchError === "error.geocode_timeout"
                ? t("search_timeout")
                : t("search_failed")}
        </p>
      ) : null}

      {candidates.length > 0 &&
      (!refining || machine.refineTab === "search") ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <p className="border-b border-zinc-100 px-3 py-1.5 text-xs text-zinc-500">
            {allResultsShown
              ? t("results_all_shown", { count: candidates.length })
              : t("results_showing", {
                  shown: visibleCandidates.length,
                  total: candidates.length,
                })}
          </p>
          <ul className="max-h-56 overflow-y-auto">
            {visibleCandidates.map((c) => (
              <li
                key={`${c.osmType}:${c.osmId}`}
                className="border-b border-zinc-100 last:border-b-0"
              >
                <button
                  type="button"
                  className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-emerald-50/70"
                  onClick={() => selectCandidate(c)}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                    {c.primaryLabel}
                    {c.resultLevel === "city" ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                        {t("city_level")}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {[
                      c.localityLabel,
                      c.countryName ?? c.countryCode,
                      c.typeLabel,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {canShowMore ? (
            <button
              type="button"
              className="w-full border-t border-zinc-100 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50/50"
              onClick={showMoreCandidates}
            >
              {t("show_more")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
