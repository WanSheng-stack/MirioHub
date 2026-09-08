"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { PaywallModal } from "@/components/paywall/PaywallModal";
import { VerificationShield } from "@/components/post/VerificationShield";
import { AutoMeltDialog } from "@/components/post/AutoMeltDialog";
import { Link } from "@/i18n/navigation";
import type { MatchRow, Post, RevealResult, SystemConfig } from "@/lib/types";

type Props = {
  post: Post;
  userId: string | null;
  campaign: boolean;
  config: SystemConfig | null;
  match: MatchRow | null;
};

export function PostActions({
  post,
  userId,
  campaign,
  config,
  match,
}: Props) {
  const t = useTranslations("post");
  const tRoot = useTranslations();
  const locale = useLocale();
  const [phone, setPhone] = useState<string | null>(null);
  const [paywall, setPaywall] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [matchState, setMatchState] = useState(match);
  const [showPickupShield, setShowPickupShield] = useState(false);
  const [pickupCodeInput, setPickupCodeInput] = useState("");

  const isDemand = matchState?.demand_user_id === userId;
  const isProvider = matchState?.provider_user_id === userId;
  const activeMatch = Boolean(matchState?.confirmed_at && !matchState?.cancelled_at);

  async function reveal() {
    setErrorKey(null);
    if (!userId) {
      setErrorKey("needLogin");
      return;
    }
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("reveal_contact", {
      p_post_id: post.id,
    });
    const result = (data ?? {}) as RevealResult;
    if (rpcError) {
      setErrorKey("error.submit_failed");
      return;
    }
    if (!result.ok && result.error === "PAYWALL") {
      setPaywall(true);
      return;
    }
    if (!result.ok) {
      setErrorKey("error.submit_failed");
      return;
    }
    setPhone(result.phone ?? null);
  }

  async function cancel() {
    const supabase = createClient();
    const { data } = await supabase.rpc("cancel_match_no_fault", {
      p_post_id: post.id,
    });
    const json = data as { ok?: boolean };
    if (json?.ok) {
      setMatchState((prev) =>
        prev ? { ...prev, cancelled_at: new Date().toISOString() } : prev,
      );
    }
  }

  return (
    <div className="mt-6 space-y-4">
      {userId === post.user_id ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-500">{t("ownPost")}</p>
          {post.status !== "draft" && post.status !== "canceled" ? (
            <Link
              href={`/posts/${post.id}/matches`}
              className="inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
            >
              {t("viewMatches")}
            </Link>
          ) : null}
        </div>
      ) : null}

      <div>
        <button
          type="button"
          onClick={() => void reveal()}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          {t("reveal")}
        </button>
        {campaign ? (
          <p className="mt-1 text-xs text-green-700">{t("freeHint")}</p>
        ) : null}
        {phone ? (
          <p className="mt-2 font-mono text-sm text-zinc-900">{phone}</p>
        ) : null}
        {errorKey ? (
          <p className="mt-2 text-sm text-red-600">
            {errorKey.startsWith("error.")
              ? tRoot(errorKey as "error.invalid_phone")
              : t(errorKey as "needLogin")}
          </p>
        ) : null}
      </div>

      {/*
        PHASE 6.6B.1 — one-click direct match is paused (no buttons this round).
        Future 6.7B copy only: Demand 我能帮忙 / Offer help / Ponudi pomoć;
        Provider 请求帮助 / Request help / Zatraži pomoć.
      */}

      {activeMatch && isDemand ? (
        <div className="space-y-3">
          <VerificationShield
            visible={showPickupShield}
            providerName={post.provider_name}
            providerPhone={phone}
            vehicleBrand={post.vehicle_brand}
            vehicleColor={post.vehicle_color}
            licensePlate={post.normalized_license_plate ?? post.raw_license_plate}
          />
          <label className="block text-sm">
            {t("pickupCode")}
            <input
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 font-mono"
              maxLength={4}
              value={pickupCodeInput}
              onFocus={() => setShowPickupShield(true)}
              onChange={(e) => setPickupCodeInput(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <div className="rounded-md bg-yellow-300 px-4 py-3 text-sm font-medium text-zinc-900">
            {t("disclaimer")}
          </div>
          <button
            type="button"
            onClick={() => void cancel()}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white"
          >
            {t("noFault")}
          </button>
        </div>
      ) : null}

      {activeMatch && isProvider ? (
        <div className="space-y-3">
          <label className="block text-sm">
            {t("deliveryCode")}
            <input
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 font-mono"
              maxLength={4}
              readOnly
              placeholder="····"
            />
          </label>
          <AutoMeltDialog postId={post.id} />
        </div>
      ) : null}

      {paywall ? (
        <PaywallModal
          locale={locale}
          config={config}
          onClose={() => setPaywall(false)}
        />
      ) : null}
    </div>
  );
}
