"use client";

import { useTranslations } from "next-intl";
import type { PostType } from "@/lib/types";

type Props = {
  role: PostType;
  onChange: (role: PostType) => void;
};

export function RoleTabs({ role, onChange }: Props) {
  const t = useTranslations("home.tab");

  return (
    <div className="relative grid grid-cols-2 rounded-2xl bg-zinc-100 p-1">
      <span
        aria-hidden
        className={`absolute inset-y-1 w-[calc(50%-4px)] rounded-xl bg-white shadow-sm transition-transform duration-300 ease-out ${
          role === "provider" ? "translate-x-[calc(100%+4px)]" : "translate-x-1"
        }`}
      />
      <button
        type="button"
        onClick={() => onChange("demand")}
        className={`relative z-10 rounded-xl px-3 py-3 text-sm font-semibold transition-colors duration-300 ${
          role === "demand" ? "text-emerald-800" : "text-zinc-400"
        }`}
      >
        {t("demand")}
      </button>
      <button
        type="button"
        onClick={() => onChange("provider")}
        className={`relative z-10 rounded-xl px-3 py-3 text-sm font-semibold transition-colors duration-300 ${
          role === "provider" ? "text-violet-800" : "text-zinc-400"
        }`}
      >
        {t("provider")}
      </button>
    </div>
  );
}
