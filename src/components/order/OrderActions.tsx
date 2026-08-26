"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { PaywallModal } from "@/components/paywall/PaywallModal";
import type { MatchRow, RevealResult, SystemConfig } from "@/lib/types";

type Props = {
  orderId: string;
  authorId: string;
  userId: string | null;
  campaign: boolean;
  config: SystemConfig | null;
  match: MatchRow | null;
};

export function OrderActions({
  orderId,
  authorId,
  userId,
  campaign,
  config,
  match,
}: Props) {
  const t = useTranslations("order");
  const locale = useLocale();
  const [phone, setPhone] = useState<string | null>(null);
  const [paywall, setPaywall] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchState, setMatchState] = useState(match);

  const isDemand = matchState?.demand_user_id === userId;
  const activeMatch = Boolean(matchState?.confirmed_at && !matchState?.cancelled_at);

  async function reveal() {
    setError(null);
    if (!userId) {
      setError(t("needLogin"));
      return;
    }
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("reveal_contact", {
      p_order_id: orderId,
    });
    const result = (data ?? {}) as RevealResult;
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (!result.ok && result.error === "PAYWALL") {
      setPaywall(true);
      return;
    }
    if (!result.ok) {
      setError(result.error ?? "error");
      return;
    }
    setPhone(result.phone ?? null);
  }

  async function confirm() {
    const supabase = createClient();
    const { data } = await supabase.rpc("confirm_match", { p_order_id: orderId });
    const json = data as { ok?: boolean; demand_user_id?: string; provider_user_id?: string };
    if (json?.ok && json.demand_user_id && json.provider_user_id) {
      setMatchState({
        id: "local",
        order_id: orderId,
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
      p_order_id: orderId,
    });
    const json = data as { ok?: boolean };
    if (json?.ok) {
      setMatchState((prev) =>
        prev
          ? { ...prev, cancelled_at: new Date().toISOString() }
          : prev,
      );
    }
  }

  return (
    <div className="mt-6 space-y-4">
      {userId === authorId ? (
        <p className="text-sm text-zinc-500">{t("ownOrder")}</p>
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
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </div>

      {userId && userId !== authorId && !activeMatch ? (
        <button
          type="button"
          onClick={() => void confirm()}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm"
        >
          {t("confirmMatch")}
        </button>
      ) : null}

      {activeMatch && isDemand ? (
        <div className="space-y-3">
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
