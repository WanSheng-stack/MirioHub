"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  callingCodeForCountry,
  flagEmoji,
  isPhoneCountryCode,
  listPhoneCountries,
  type PhoneCountryCode,
  DEFAULT_PHONE_COUNTRY,
} from "@/lib/phone/phoneNumber";

type Props = {
  value: string;
  onChange: (countryCode: PhoneCountryCode) => void;
  ariaLabel?: string;
};

export function PhoneCountryPicker({ value, onChange, ariaLabel }: Props) {
  const locale = useLocale();
  const t = useTranslations("phone");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const countries = useMemo(() => listPhoneCountries(locale), [locale]);
  const selectedCode: PhoneCountryCode = isPhoneCountryCode(value)
    ? value
    : DEFAULT_PHONE_COUNTRY;
  const selected = countries.find((c) => c.countryCode === selectedCode);
  const callingCode = selected?.callingCode ?? callingCodeForCountry(selectedCode);
  const flag = selected?.flag ?? flagEmoji(selectedCode);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => {
      return (
        c.name.toLowerCase().includes(q) ||
        c.countryCode.toLowerCase().includes(q) ||
        c.callingCode.includes(q.replace(/^\+/, "")) ||
        `+${c.callingCode}`.includes(q)
      );
    });
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
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={ariaLabel ?? t("countryPicker")}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-11 w-[7.75rem] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-zinc-200 bg-white px-2 text-sm text-zinc-900"
      >
        <span aria-hidden>{flag}</span>
        <span className="font-medium">+{callingCode}</span>
      </button>
      {open ? (
        <div className="absolute z-30 mt-1 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchCountry")}
            className="h-10 w-full border-b border-zinc-100 px-3 text-sm outline-none"
          />
          <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
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
                  <span aria-hidden>{c.flag}</span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="shrink-0 text-zinc-500">+{c.callingCode}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
