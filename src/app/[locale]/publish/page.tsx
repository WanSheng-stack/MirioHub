"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  CAPACITY_TYPES,
  POST_CATEGORIES,
  POST_SCOPES,
  TRANSPORT_MODES,
} from "@/lib/posts";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import type { AppLocale } from "@/i18n/routing";
import type {
  CapacityType,
  PostCategory,
  PostScope,
  PostType,
  TransportMode,
} from "@/lib/types";

function parseOptionalNumber(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export default function PublishPage() {
  const t = useTranslations("publish");
  const tHall = useTranslations("hall");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const [postType, setPostType] = useState<PostType>("demand");
  const [category, setCategory] = useState<PostCategory>("deliver");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const showItemCost = category === "buy";

  const inputClass =
    "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!hasSupabaseEnv()) {
      setError("missing env");
      return;
    }

    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      router.push("/profile");
      return;
    }

    const scope = String(form.get("scope") ?? "city") as PostScope;
    const capacityRaw = String(form.get("capacity_type") ?? "");
    const transportRaw = String(form.get("transport_mode") ?? "");
    const escortRaw = String(form.get("escort_seats") ?? "0").trim();
    const escortSeats = escortRaw === "" ? 0 : Math.max(0, Math.floor(Number(escortRaw) || 0));
    const feeAmount = parseOptionalNumber(form.get("fee_amount"));
    const estimatedItemCost = showItemCost
      ? parseOptionalNumber(form.get("estimated_item_cost"))
      : null;

    setSubmitting(true);
    const { error: insertError } = await supabase.from("posts").insert({
      user_id: auth.user.id,
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      status: "active",
      locale,
      post_type: postType,
      category,
      scope,
      origin_address: String(form.get("origin_address") ?? "").trim(),
      destination_address: String(form.get("destination_address") ?? "").trim(),
      capacity_type: (capacityRaw || null) as CapacityType | null,
      transport_mode: (transportRaw || null) as TransportMode | null,
      escort_seats: escortSeats,
      fee_amount: feeAmount,
      estimated_item_cost: estimatedItemCost,
    });
    setSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }
    router.push("/");
  }

  return (
    <form className="mx-auto max-w-lg space-y-4" onSubmit={(e) => void onSubmit(e)}>
      <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>

      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">{t("postType")}</legend>
        <label className="mr-4 inline-flex items-center gap-1.5">
          <input
            type="radio"
            name="post_type"
            checked={postType === "demand"}
            onChange={() => setPostType("demand")}
          />
          {tHall("postType.demand")}
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="radio"
            name="post_type"
            checked={postType === "provider"}
            onChange={() => setPostType("provider")}
          />
          {tHall("postType.provider")}
        </label>
      </fieldset>

      <label className="block text-sm">
        {t("category")}
        <select
          className={inputClass}
          value={category}
          onChange={(e) => setCategory(e.target.value as PostCategory)}
          required
        >
          {POST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {tHall(`category.${c}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        {t("scope")}
        <select name="scope" className={inputClass} defaultValue="city" required>
          {POST_SCOPES.map((s) => (
            <option key={s} value={s}>
              {tHall(`scope.${s}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        {t("heading")}
        <input name="title" required className={inputClass} />
      </label>

      <label className="block text-sm">
        {t("description")}
        <textarea name="description" rows={4} className={inputClass} />
      </label>

      <label className="block text-sm">
        {t("originAddress")}
        <input name="origin_address" required className={inputClass} />
      </label>

      <label className="block text-sm">
        {t("destinationAddress")}
        <input name="destination_address" required className={inputClass} />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          {t("capacityType")}
          <select name="capacity_type" className={inputClass} defaultValue="">
            <option value="">{t("optional")}</option>
            {CAPACITY_TYPES.map((c) => (
              <option key={c} value={c}>
                {tHall(`capacity.${c}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          {t("transportMode")}
          <select name="transport_mode" className={inputClass} defaultValue="">
            <option value="">{t("optional")}</option>
            {TRANSPORT_MODES.map((m) => (
              <option key={m} value={m}>
                {tHall(`transport.${m}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          {t("escortSeats")}
          <input
            name="escort_seats"
            type="number"
            min={0}
            step={1}
            defaultValue={0}
            className={inputClass}
          />
        </label>

        <label className="block text-sm">
          {t("feeAmount")}
          <input
            name="fee_amount"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className={inputClass}
            placeholder={t("optional")}
          />
        </label>
      </div>

      {showItemCost ? (
        <label className="block text-sm">
          {t("estimatedItemCost")}
          <input
            name="estimated_item_cost"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className={inputClass}
            placeholder={t("optional")}
          />
        </label>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        type="submit"
        disabled={submitting}
      >
        {submitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
