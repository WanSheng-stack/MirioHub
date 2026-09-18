"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  flagEmoji,
  isPhoneCountryCode,
  listPhoneCountries,
  type PhoneCountryCode,
} from "@/lib/phone/phoneNumber";

type Props = {
  value: string | null;
  onChange: (countryCode: PhoneCountryCode | null) => void;
  /** When true, show validation hint (after user attempted search/continue). */
  showRequiredError?: boolean;
  ariaLabel?: string;
};

/**
 * Address search-scope country picker. Empty by default — no phone/locale/IP inference.
 */
export function AddressCountrySelect({
  value,
  onChange,
  showRequiredError = false,
  ariaLabel,
}: Props) {
  const locale = useLocale();
  const t = useTranslations("home.address");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const countries = useMemo(() => listPhoneCountries(locale), [locale]);
  const selectedCode =
    value && isPhoneCountryCode(value) ? (value as PhoneCountryCode) : null;
  const selected = selectedCode
    ? countries.find((c) => c.countryCode === selectedCode)
    : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.countryCode.toLowerCase().includes(q),
    );
  }, [countries, query]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        aria-label={ariaLabel ?? t("country_label")}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-11 w-full items-center gap-2 rounded-xl border bg-white px-3 text-left text-sm ${
          showRequiredError && !selectedCode
            ? "border-rose-400 text-rose-700"
            : "border-zinc-200 text-zinc-900"
        }`}
      >
        {selected ? (
          <>
            <span aria-hidden>{selected.flag}</span>
            <span className="min-w-0 flex-1 truncate font-medium">
              {selected.name}
            </span>
            <span className="shrink-0 text-zinc-500">{selected.countryCode}</span>
          </>
        ) : (
          <span className="text-zinc-500">{t("country_placeholder")}</span>
        )}
      </button>
      {showRequiredError && !selectedCode ? (
        <p className="mt-1 text-xs text-rose-600">{t("country_required")}</p>
      ) : null}
      {open ? (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("country_search")}
            className="h-10 w-full border-b border-zinc-100 px-3 text-sm outline-none"
          />
          <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
            {selectedCode ? (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-50"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {t("country_clear")}
                </button>
              </li>
            ) : null}
            {filtered.map((c) => (
              <li key={c.countryCode}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.countryCode === selectedCode}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 ${
                    c.countryCode === selectedCode ? "bg-zinc-50 font-medium" : ""
                  }`}
                  onClick={() => {
                    onChange(c.countryCode);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span aria-hidden>{c.flag || flagEmoji(c.countryCode)}</span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="shrink-0 text-zinc-500">{c.countryCode}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
