"use client";

import { useTranslations } from "next-intl";

type Props = {
  baseFee: number;
  multiplier: number;
  onChange: (value: number) => void;
};

/** Cap hard-locked at 2.5× recommended base fee. */
export function PricePremiumSlider({ baseFee, multiplier, onChange }: Props) {
  const t = useTranslations("ui");
  const capped = Math.min(2.5, Math.max(1, multiplier));
  const preview = (baseFee * capped).toFixed(2);

  return (
    <div className="mt-2 space-y-1.5 rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200/80">
      <div className="flex items-center justify-between text-xs font-medium text-amber-900">
        <span>{t("price_premium_label")}</span>
        <span>
          ×{capped.toFixed(1)} · {preview} EUR
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={2.5}
        step={0.1}
        value={capped}
        onChange={(e) => {
          const next = Number(e.target.value);
          onChange(Math.min(2.5, Math.max(1, next)));
        }}
        className="w-full accent-amber-600"
      />
      <p className="text-[11px] text-amber-800/80">{t("price_premium_hint")}</p>
    </div>
  );
}
