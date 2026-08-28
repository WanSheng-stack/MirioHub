"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  CAPACITY_EMOJI,
  postCardAlignClass,
  postCardShellClass,
  postMetaRowClass,
  postTypeTagClass,
} from "@/lib/posts";
import { CreditDashboard, type CreditStats } from "@/components/credit/CreditDashboard";
import type { RouteMatchInfo } from "@/lib/hall-route-match";
import { resolveDriverOrderedRoute } from "@/lib/post-route-match";
import type { AppLocale } from "@/i18n/routing";
import type { Post } from "@/lib/types";

type Props = {
  post: Post;
  authorName?: string | null;
  creditStats?: CreditStats | null;
  routeMatch?: RouteMatchInfo | null;
  /** Enable translate control (detail page) */
  showTranslate?: boolean;
  /** When false, render without wrapping Link (already on detail) */
  linkToDetail?: boolean;
};

export function PostCard({
  post,
  authorName,
  creditStats,
  routeMatch,
  showTranslate = false,
  linkToDetail = true,
}: Props) {
  const t = useTranslations("hall");
  const locale = useLocale() as AppLocale;
  const [text, setText] = useState(post.description);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  const cached = useMemo(() => {
    const map = post.translations ?? {};
    return map[locale];
  }, [post.translations, locale]);

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
          postId: post.id,
          locale,
          sourceLocale: post.locale,
          text: post.description,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        text?: string;
        cached?: boolean;
      };
      if (json.ok && json.text) {
        setText(json.text);
        setFromCache(Boolean(json.cached));
      }
    } finally {
      setBusy(false);
    }
  }

  const tRoot = useTranslations();
  const routeAxis =
    post.post_type === "provider" &&
    (post.category === "deliver" || post.category === "travel")
      ? resolveDriverOrderedRoute(post)
      : null;

  const body = (
    <>
      <div className={postMetaRowClass(post.post_type)}>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${postTypeTagClass(post.post_type)}`}
        >
          {t(`postType.${post.post_type}`)}
        </span>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-zinc-600 ring-1 ring-zinc-200/80">
          {t(`category.${post.category}`)}
        </span>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-zinc-600 ring-1 ring-zinc-200/80">
          {t(`scope.${post.scope}`)}
        </span>
      </div>

      {post.title ? (
        <h2 className="mt-2 text-base font-semibold tracking-tight text-zinc-950">
          {post.title}
        </h2>
      ) : null}

      <p className="mt-1 text-sm text-zinc-600">
        {post.origin_address || "—"}
        <span className="mx-1.5 text-zinc-400" aria-hidden>
          →
        </span>
        {post.destination_address || "—"}
      </p>

      {routeAxis && routeAxis.length > 2 ? (
        <p className="mt-1 text-xs text-zinc-500">
          {routeAxis.join(" → ")}
        </p>
      ) : null}

      {routeMatch ? (
        <div className="mt-2 space-y-1">
          <span className="inline-block rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800">
            {t("routeMatchCount", { count: routeMatch.matchedCount })}
          </span>
          {routeMatch.showSpaceWarning ? (
            <p className="animate-pulse text-xs text-amber-700">
              {tRoot("ui.space_overload_warning")}
            </p>
          ) : null}
        </div>
      ) : null}

      {authorName ? (
        <p className="mt-0.5 text-xs text-zinc-500">{authorName}</p>
      ) : null}

      {post.post_type === "provider" && creditStats ? (
        <div className="mt-2">
          <CreditDashboard stats={creditStats} compact />
        </div>
      ) : null}

      {text ? (
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-zinc-800">
          {text}
        </p>
      ) : null}

      <div className={`mt-3 text-xs text-zinc-600 ${postMetaRowClass(post.post_type)}`}>
        {post.capacity_type ? (
          <span>
            {CAPACITY_EMOJI[post.capacity_type]} {t(`capacity.${post.capacity_type}`)}
          </span>
        ) : null}
        {post.transport_mode ? (
          <span>{t(`transport.${post.transport_mode}`)}</span>
        ) : null}
        {post.escort_seats > 0 ? (
          <span>
            {t("escortSeats")}: {post.escort_seats}
          </span>
        ) : null}
        {post.fee_amount != null ? (
          <span className="font-medium text-zinc-800">
            {t("fee")}: {Number(post.fee_amount).toFixed(0)}
          </span>
        ) : null}
        {post.category === "buy" && post.estimated_item_cost != null ? (
          <span>
            {t("itemCost")}: {Number(post.estimated_item_cost).toFixed(0)}
          </span>
        ) : null}
      </div>
    </>
  );

  return (
    <article
      className={`${postCardAlignClass(post.post_type)} ${postCardShellClass(post.post_type)} px-4 py-3.5`}
    >
      {linkToDetail ? (
        <Link href={`/posts/${post.id}`} className="block">
          {body}
        </Link>
      ) : (
        body
      )}

      {showTranslate && post.description ? (
        <button
          type="button"
          onClick={() => void translate()}
          disabled={busy}
          className="mt-3 text-sm text-blue-700"
        >
          🌐 {busy ? t("translating") : t("translate")}
          {fromCache ? ` · ${t("cached")}` : ""}
        </button>
      ) : null}
    </article>
  );
}
