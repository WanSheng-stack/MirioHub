"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export type CreditStats = {
  totalCompletionRate: number;
  standardRate: number;
  autoMeltRate: number;
  autoMeltNotes: string[];
};

type Props = {
  stats: CreditStats;
  compact?: boolean;
};

export function CreditDashboard({ stats, compact = false }: Props) {
  const t = useTranslations();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className={`rounded-lg bg-white/60 ${compact ? "p-2 text-xs" : "p-3 text-sm"}`}>
      <p className={`font-bold text-zinc-900 ${compact ? "text-sm" : "text-base"}`}>
        {t("credit.totalRate", { rate: stats.totalCompletionRate.toFixed(0) })}
      </p>

      <div className="mt-2 space-y-1.5">
        <CreditBar
          label={t("ui.standard_completion", { rate: stats.standardRate.toFixed(0) })}
          rate={stats.standardRate}
          color="bg-emerald-500"
        />
        <div>
          <CreditBar
            label={t("ui.auto_melt_completion", { rate: stats.autoMeltRate.toFixed(0) })}
            rate={stats.autoMeltRate}
            color="bg-amber-400"
          />
          <p className="mt-0.5 text-xs text-zinc-500">{t("credit.autoMeltExplain")}</p>
        </div>
      </div>

      {stats.autoMeltNotes.length > 0 ? (
        <div className="mt-2">
          <button
            type="button"
            className="text-xs font-medium text-zinc-600 underline-offset-2 hover:underline"
            onClick={() => setDrawerOpen(!drawerOpen)}
          >
            {t("credit.historyDrawer")}
          </button>
          {drawerOpen ? (
            <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-zinc-600">
              {stats.autoMeltNotes.map((note, i) => (
                <li key={i} className="rounded bg-zinc-50 px-2 py-1">
                  {note}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CreditBar({
  label,
  rate,
  color,
}: {
  label: string;
  rate: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span>{label}</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-zinc-200">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, rate)}%` }} />
      </div>
    </div>
  );
}
