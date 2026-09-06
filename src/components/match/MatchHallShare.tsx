"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Props = {
  shareUrl: string;
  title: string;
};

export function MatchHallShare({ shareUrl, title }: Props) {
  const t = useTranslations("matchHall");
  const [copied, setCopied] = useState(false);

  function absoluteUrl() {
    if (shareUrl.startsWith("http")) return shareUrl;
    return `${window.location.origin}${shareUrl}`;
  }

  async function share() {
    const url = absoluteUrl();
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* user cancelled or share unavailable */
      }
    }
    await copy();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(absoluteUrl());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => void share()}
        className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white"
      >
        {t("invite")}
      </button>
      <button
        type="button"
        onClick={() => void share()}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
      >
        {t("share")}
      </button>
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
      >
        {copied ? t("copied") : t("copyLink")}
      </button>
    </div>
  );
}
