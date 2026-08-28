"use client";

import { useTranslations } from "next-intl";
import type { PostFormController } from "@/lib/post-form/usePostFormState";
import { COUNTRY_DIAL_CODES, TIME_WINDOWS } from "@/lib/post-time-windows";

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10";

type Props = { form: PostFormController };

export function BaseFields({ form }: Props) {
  const t = useTranslations();
  const { state, setField } = form;

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-zinc-700">{t("publish.section.base")}</h2>

      <label className="block text-sm">
        {t("publish.departureDate")}
        <input
          type="date"
          className={inputClass}
          value={state.departure_date}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setField("departure_date", e.target.value)}
          required
        />
      </label>

      <label className="block text-sm">
        {t("publish.departureTimeWindow")}
        <select
          className={inputClass}
          value={state.departure_time_window}
          onChange={(e) => setField("departure_time_window", e.target.value)}
          required
        >
          {TIME_WINDOWS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>

      <div className="block text-sm">
        <span>{t("publish.phone")}</span>
        <div className="mt-1 flex gap-2">
          <select
            className="w-28 shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-2.5 text-sm"
            value={state.dial_code}
            onChange={(e) => setField("dial_code", e.target.value)}
          >
            {COUNTRY_DIAL_CODES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {t(c.key)}
              </option>
            ))}
          </select>
          <input
            type="tel"
            className={`${inputClass} mt-0`}
            value={state.raw_phone_local}
            onChange={(e) => setField("raw_phone_local", e.target.value)}
            placeholder={t("publish.phonePlaceholder")}
            required
          />
        </div>
      </div>
    </section>
  );
}
