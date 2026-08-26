"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import type { AppLocale } from "@/i18n/routing";
import type { SystemConfig } from "@/lib/types";

export function MustReadDialog() {
  const t = useTranslations("app");
  const locale = useLocale() as AppLocale;
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!hasSupabaseEnv()) return;
    const supabase = createClient();
    void supabase
      .from("system_configs")
      .select("must_read_sr, must_read_en, must_read_zh")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as Pick<
          SystemConfig,
          "must_read_sr" | "must_read_en" | "must_read_zh"
        > | null;
        if (!row) return;
        const map = {
          sr: row.must_read_sr,
          en: row.must_read_en,
          zh: row.must_read_zh,
        };
        setBody(map[locale] || row.must_read_zh);
      });
  }, [locale]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-3 top-16 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-red-600 text-lg text-white md:top-20"
        aria-label={t("mustRead")}
      >
        ❗
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center">
          <div className="w-full max-w-md rounded-lg border border-red-200 bg-white p-5">
            <h2 className="text-lg font-bold text-red-700">{t("mustRead")}</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-800">
              {body || "—"}
            </p>
            <button
              type="button"
              className="mt-4 w-full rounded-md bg-red-600 py-2 text-sm font-medium text-white"
              onClick={() => setOpen(false)}
            >
              {t("mustReadClose")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
