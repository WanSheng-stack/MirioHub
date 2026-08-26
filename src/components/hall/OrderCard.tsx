"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ROLE_LABEL, roleTagClass } from "@/lib/roles";
import type { AppLocale } from "@/i18n/routing";
import type { Order } from "@/lib/types";

type Props = {
  order: Order;
  authorName?: string | null;
};

export function OrderCard({ order, authorName }: Props) {
  const t = useTranslations("hall");
  const locale = useLocale() as AppLocale;
  const [text, setText] = useState(order.description);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  const sameCity =
    order.from_city.trim().toLowerCase() === order.to_city.trim().toLowerCase();

  const cached = useMemo(() => {
    const map = order.translations ?? {};
    return map[locale];
  }, [order.translations, locale]);

  async function translate() {
    if (cached) {
      setText(cached);
      setFromCache(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          locale,
          sourceLocale: order.source_locale,
          text: order.description,
        }),
      });
      const json = (await res.json()) as { ok: boolean; text?: string; cached?: boolean };
      if (json.ok && json.text) {
        setText(json.text);
        setFromCache(Boolean(json.cached));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className={`rounded-xl border border-zinc-200 p-4 ${
        order.role === "DEMAND" ? "bg-green-50/40" : "bg-purple-50/40"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleTagClass(order.role)}`}
        >
          {ROLE_LABEL[order.role][locale]}
        </span>
        {sameCity ? (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
            {t("sameCity")}
          </span>
        ) : null}
      </div>
      <Link href={`/orders/${order.id}`} className="mt-2 block">
        <h2 className="text-base font-semibold text-zinc-950">{order.title}</h2>
        <p className="mt-1 text-sm text-zinc-600">
          {order.from_city} → {order.to_city}
          {authorName ? ` · ${authorName}` : ""}
        </p>
      </Link>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{text}</p>
      {order.task_notes ? (
        <p className="mt-2 text-sm text-zinc-600">
          {t("taskNotes")}: {order.task_notes}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void translate()}
        disabled={busy}
        className="mt-3 text-sm text-blue-700"
      >
        🌐 {busy ? t("translating") : t("translate")}
        {fromCache ? ` · ${t("cached")}` : ""}
      </button>
    </article>
  );
}
