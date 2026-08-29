"use client";

import { useTranslations } from "next-intl";
import {
  CATEGORY_ICONS,
  HOME_CATEGORY_ORDER,
  type PostCategory,
} from "@/lib/post-payload";
import type { PostType } from "@/lib/types";

type Props = {
  role: PostType;
  category: PostCategory;
  onChange: (category: PostCategory) => void;
};

export function CategoryIconGrid({ role, category, onChange }: Props) {
  const t = useTranslations(`home.icons.${role}`);

  return (
    <div className="grid grid-cols-5 gap-2">
      {HOME_CATEGORY_ORDER.map((key) => {
        const active = category === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className="flex flex-col items-center gap-1.5"
          >
            <span
              className={`flex h-14 w-14 items-center justify-center rounded-full text-2xl transition-all duration-300 ${
                active
                  ? role === "demand"
                    ? "scale-105 bg-emerald-500 text-white shadow-md shadow-emerald-500/30"
                    : "scale-105 bg-violet-500 text-white shadow-md shadow-violet-500/30"
                  : "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200/80"
              }`}
            >
              {CATEGORY_ICONS[key]}
            </span>
            <span
              className={`max-w-[4.5rem] text-center text-[10px] leading-tight font-medium ${
                active ? "text-zinc-900" : "text-zinc-500"
              }`}
            >
              {t(key)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
