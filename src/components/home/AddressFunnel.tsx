"use client";

import { useTranslations } from "next-intl";
import type { PostCategory } from "@/lib/types";

const inputClass =
  "mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-base focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

type Props = {
  category: PostCategory;
  origin: string;
  destination: string;
  serviceAddress: string;
  onOrigin: (v: string) => void;
  onDestination: (v: string) => void;
  onServiceAddress: (v: string) => void;
  onConfirm: () => void;
};

export function AddressFunnel({
  category,
  origin,
  destination,
  serviceAddress,
  onOrigin,
  onDestination,
  onServiceAddress,
  onConfirm,
}: Props) {
  const t = useTranslations("home");
  const isRoute = category === "travel" || category === "deliver";

  const canConfirm = isRoute
    ? origin.trim().length > 0 && destination.trim().length > 0
    : serviceAddress.trim().length > 0;

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-200/80 bg-white/90 p-4 shadow-sm">
      {isRoute ? (
        <>
          <label className="block text-sm font-medium text-zinc-700">
            {t("origin")}
            <input
              className={inputClass}
              value={origin}
              onChange={(e) => onOrigin(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium text-zinc-700">
            {t("destination")}
            <input
              className={inputClass}
              value={destination}
              onChange={(e) => onDestination(e.target.value)}
            />
          </label>
        </>
      ) : (
        <label className="block text-sm font-medium text-zinc-700">
          {t("service_location")}
          <input
            className={inputClass}
            value={serviceAddress}
            onChange={(e) => onServiceAddress(e.target.value)}
          />
        </label>
      )}

      <button
        type="button"
        disabled={!canConfirm}
        onClick={onConfirm}
        className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition enabled:hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
      >
        {t("confirm_location")}
      </button>
    </div>
  );
}
