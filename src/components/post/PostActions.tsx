"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { PaywallModal } from "@/components/paywall/PaywallModal";
import { VerificationShield } from "@/components/post/VerificationShield";
import { AutoMeltDialog } from "@/components/post/AutoMeltDialog";
import { runProviderMatchIntercept } from "@/lib/post-form/providerMatch";
import { totalLuggageUnits } from "@/lib/post-payload";
import type { MatchRow, Post, RevealResult, SystemConfig } from "@/lib/types";

type Props = {
  post: Post;
  userId: string | null;
  campaign: boolean;
  config: SystemConfig | null;
  match: MatchRow | null;
};

export function PostActions({ post, userId, campaign, config, match }: Props) {
  const t = useTranslations("post");
  const tRoot = useTranslations();
  const locale = useLocale();
  const [phone, setPhone] = useState<string | null>(null);
  const [paywall, setPaywall] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [matchState, setMatchState] = useState(match);
  const [showPickupShield, setShowPickupShield] = useState(false);
  const [spaceWarning, setSpaceWarning] = useState(false);
  const [pickupCodeInput, setPickupCodeInput] = useState("");

  const isDemand = matchState?.demand_user_id === userId;
  const isProvider = matchState?.provider_user_id === userId;
  const activeMatch = Boolean(matchState?.confirmed_at && !matchState?.cancelled_at);
  const isCargoDemand =
    post.post_type === "demand" &&
    post.category === "deliver" &&
    (post.escort_seats ?? 0) === 0;

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

  async function confirm() {
    setErrorKey(null);
    setSpaceWarning(false);
    if (!userId) return;

    const supabase = createClient();

    if (isCargoDemand && post.post_type === "demand") {
      const { data: me } = await supabase
        .from("profiles")
        .select("phone, plate, is_bank_verified")
        .eq("id", userId)
        .maybeSingle();

      const normPhone = (me?.phone ?? "").replace(/\D/g, "");
      const normPlate = (me?.plate ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      const newUnits = totalLuggageUnits({
        count_small: post.count_small ?? 0,
        count_medium: post.count_medium ?? 0,
        count_large: post.count_large ?? 0,
        count_xlarge: post.count_xlarge ?? 0,
      });
      const newPassengers = (post.escort_seats ?? 0) + (post.max_companions ?? 0);

      const intercept = await runProviderMatchIntercept(
        supabase,
        userId,
        post.id,
        normPhone,
        normPlate || null,
        Boolean(me?.is_bank_verified),
        newPassengers,
        newUnits,
      );

      if (!intercept.ok) {
        setErrorKey(intercept.errorKey);
        return;
      }
      if (intercept.isSpaceWarning) {
        setSpaceWarning(true);
      }
    }

    const { data } = await supabase.rpc("confirm_match", { p_post_id: post.id });
    const json = data as {
      ok?: boolean;
      demand_user_id?: string;
      provider_user_id?: string;
    };
    if (json?.ok && json.demand_user_id && json.provider_user_id) {
      setMatchState({
        id: "local",
        post_id: post.id,
        demand_user_id: json.demand_user_id,
        provider_user_id: json.provider_user_id,
        confirmed_at: new Date().toISOString(),
        cancelled_at: null,
      });
    }
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
        <p className="text-sm text-zinc-500">{t("ownPost")}</p>
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

      {userId && userId !== post.user_id && !activeMatch ? (
        <>
          {spaceWarning ? (
            <p className="animate-pulse rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
              {tRoot("ui.space_overload_warning")}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void confirm()}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm"
          >
            {isCargoDemand ? t("acceptCargo") : t("confirmMatch")}
          </button>
        </>
      ) : null}

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
