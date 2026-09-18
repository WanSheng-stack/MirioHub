"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AddressCountrySelect } from "@/components/home/AddressCountrySelect";
import {
  candidateToConfirmed,
  type AddressSearchCandidate,
  type ConfirmedAddressGeo,
} from "@/lib/geo/addressSearch";
import type { PhoneCountryCode } from "@/lib/phone/phoneNumber";

const inputClass =
  "mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-base focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

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
  const [query, setQuery] = useState(confirmed?.label ?? "");
  const [candidates, setCandidates] = useState<AddressSearchCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [attemptedSearch, setAttemptedSearch] = useState(false);
  const [cityContext, setCityContext] = useState<ConfirmedAddressGeo | null>(
    confirmed?.precision === "city"
      ? confirmed
      : confirmed?.localityContext
        ? {
            label: confirmed.localityContext,
            lat: confirmed.lat,
            lon: confirmed.lon,
            precision: "city",
            searchCountryCode: confirmed.searchCountryCode,
            localityContext: confirmed.localityContext,
          }
        : null,
  );
  const [refining, setRefining] = useState(false);

  const showCountryError =
    (attemptedSearch || forceValidation) && !countryCode;
  const showConfirmError =
    forceValidation && countryCode != null && confirmed == null;

  function clearConfirmation() {
    if (confirmed != null) onConfirmedChange(null);
  }

  function onCountryChange(next: PhoneCountryCode | null) {
    setCountryCode(next);
    setQuery("");
    setCandidates([]);
    setSearchError(null);
    setCityContext(null);
    setRefining(false);
    setAttemptedSearch(false);
    onConfirmedChange(null);
  }

  function onQueryChange(value: string) {
    setQuery(value);
    setCandidates([]);
    setSearchError(null);
    clearConfirmation();
  }

  async function runSearch() {
    setAttemptedSearch(true);
    if (!countryCode) {
      setCandidates([]);
      return;
    }
    const q = query.trim();
    if (!q) {
      setSearchError("error.address_query_required");
      setCandidates([]);
      return;
    }

    setSearching(true);
    setSearchError(null);
    try {
      // Refine mode: search streets/landmarks inside the confirmed city.
      const localityContext =
        refining && cityContext != null
          ? cityContext.localityContext ?? cityContext.label
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
        setSearchError(json.errorKey ?? "error.geocode_failed");
        return;
      }
      setCandidates(json.candidates ?? []);
      if ((json.candidates ?? []).length === 0) {
        setSearchError("error.address_no_candidates");
      }
    } catch {
      setCandidates([]);
      setSearchError("error.geocode_failed");
    } finally {
      setSearching(false);
    }
  }

  function selectCandidate(candidate: AddressSearchCandidate) {
    if (!countryCode) return;
    const next = candidateToConfirmed(candidate, countryCode);
    onConfirmedChange(next);
    setQuery(next.label);
    setCandidates([]);
    setSearchError(null);
    setRefining(false);
    if (next.precision === "city") {
      setCityContext(next);
    } else if (cityContext == null && next.localityContext) {
      setCityContext({
        ...next,
        label: next.localityContext,
        precision: "city",
      });
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-zinc-700">{label}</p>
      <AddressCountrySelect
        value={countryCode}
        onChange={onCountryChange}
        showRequiredError={showCountryError}
      />

      <div className="flex gap-2">
        <input
          className={`${inputClass} mt-0`}
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
          className="shrink-0 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white enabled:hover:bg-zinc-800 disabled:opacity-60"
        >
          {searching ? t("searching") : t("search")}
        </button>
      </div>

      <p className="text-xs leading-5 text-zinc-500">{t("query_hint")}</p>

      {confirmed != null ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900 ring-1 ring-emerald-200/80">
          <span className="font-semibold">{t("confirmed")}</span>
          <span className="min-w-0 flex-1 truncate">{confirmed.label}</span>
          {confirmed.precision === "city" ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
              {t("city_level")}
            </span>
          ) : null}
        </div>
      ) : null}

      {confirmed?.precision === "city" ? (
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
        <ul className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {candidates.map((c) => (
            <li key={c.id} className="border-b border-zinc-100 last:border-b-0">
              <button
                type="button"
                className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-emerald-50/70"
                onClick={() => selectCandidate(c)}
              >
                <span className="text-sm font-medium text-zinc-900">
                  {c.primaryName}
                </span>
                <span className="text-xs text-zinc-500">
                  {[c.locality, c.countryName ?? c.countryCode, c.typeLabel]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
