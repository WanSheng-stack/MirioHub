"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AddressCountrySelect } from "@/components/home/AddressCountrySelect";
import {
  ADDRESS_SEARCH_PAGE_SIZE,
  candidateToConfirmed,
  type AddressSearchCandidate,
  type ConfirmedAddressGeo,
} from "@/lib/geo/addressSearch";
import type { PhoneCountryCode } from "@/lib/phone/phoneNumber";

const inputClass =
  "h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

type Props = {
  label: string;
  confirmed: ConfirmedAddressGeo | null;
  onConfirmedChange: (next: ConfirmedAddressGeo | null) => void;
  /** When parent attempts continue without a confirmed address. */
  forceValidation?: boolean;
};

type SearchResponse =
  | { ok: true; candidates: AddressSearchCandidate[] }
  | { ok: false; errorKey?: string };

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
  const [query, setQuery] = useState(confirmed?.displayName ?? "");
  const [candidates, setCandidates] = useState<AddressSearchCandidate[]>([]);
  const [visibleCount, setVisibleCount] = useState(ADDRESS_SEARCH_PAGE_SIZE);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [attemptedSearch, setAttemptedSearch] = useState(false);
  const [cityContext, setCityContext] = useState<ConfirmedAddressGeo | null>(
    confirmed?.resultLevel === "city" ? confirmed : null,
  );
  const [refining, setRefining] = useState(false);

  const showCountryError =
    (attemptedSearch || forceValidation) && !countryCode;
  const showConfirmError =
    forceValidation && countryCode != null && confirmed == null;
  const visibleCandidates = candidates.slice(0, visibleCount);
  const canShowMore = visibleCount < candidates.length;

  function clearConfirmation() {
    if (confirmed != null) onConfirmedChange(null);
  }

  function onCountryChange(next: PhoneCountryCode | null) {
    setCountryCode(next);
    setQuery("");
    setCandidates([]);
    setVisibleCount(ADDRESS_SEARCH_PAGE_SIZE);
    setSearchError(null);
    setCityContext(null);
    setRefining(false);
    setAttemptedSearch(false);
    onConfirmedChange(null);
  }

  function onQueryChange(value: string) {
    setQuery(value);
    setCandidates([]);
    setVisibleCount(ADDRESS_SEARCH_PAGE_SIZE);
    setSearchError(null);
    clearConfirmation();
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
        refining && cityContext != null
          ? cityContext.localityContext ?? cityContext.primaryLabel
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

  /** Expand locally cached results only — never re-fetch Nominatim. */
  function showMoreCandidates() {
    setVisibleCount((n) =>
      Math.min(n + ADDRESS_SEARCH_PAGE_SIZE, candidates.length),
    );
  }

  function selectCandidate(candidate: AddressSearchCandidate) {
    if (!countryCode) return;
    const next = candidateToConfirmed(candidate, countryCode);
    onConfirmedChange(next);
    setQuery(next.displayName);
    setCandidates([]);
    setVisibleCount(ADDRESS_SEARCH_PAGE_SIZE);
    setSearchError(null);
    setRefining(false);
    if (next.resultLevel === "city") {
      setCityContext(next);
    } else if (cityContext == null && next.localityContext) {
      setCityContext({
        ...next,
        displayName: next.localityContext,
        primaryLabel: next.localityContext,
        resultLevel: "city",
      });
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-zinc-700">{label}</p>

      {/* Country + query + Search: one row except extremely narrow viewports */}
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

      <p className="text-xs leading-5 text-zinc-500">{t("query_hint")}</p>

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

      {confirmed?.resultLevel === "city" ? (
        <div className="space-y-1 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 px-3 py-2">
          <p className="text-xs text-zinc-600">{t("refine_hint")}</p>
          <button
            type="button"
            className="text-xs font-semibold text-emerald-700 hover:underline"
            onClick={() => {
              setQuery("");
              setRefining(true);
              clearConfirmation();
              setCandidates([]);
              setVisibleCount(ADDRESS_SEARCH_PAGE_SIZE);
            }}
          >
            {t("refine_action")}
          </button>
        </div>
      ) : null}

      {showConfirmError ? (
        <p className="text-xs text-rose-600">{t("confirm_required")}</p>
      ) : null}
      {searchError ? (
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

      {candidates.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
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
                  <span className="text-sm font-medium text-zinc-900">
                    {c.primaryLabel}
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
