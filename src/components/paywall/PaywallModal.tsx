"use client";

import { useTranslations } from "next-intl";
import type { SystemConfig } from "@/lib/types";

type Props = {
  locale: string;
  config: SystemConfig | null;
  onClose: () => void;
};

export function PaywallModal({ locale, config, onClose }: Props) {
  const t = useTranslations("paywall");
  const zh = locale === "zh";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center">
      <div className="w-full max-w-md rounded-lg bg-white p-5">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-2 text-sm text-zinc-600">{t("body")}</p>
        {zh ? (
          <p className="mt-4 rounded-md bg-zinc-50 p-3 text-sm leading-6">
            {config?.wechat_support_hint ??
              "请添加微信客服并备注 Premium 开通。"}
          </p>
        ) : (
          <div className="mt-4 space-y-2 rounded-md bg-zinc-50 p-3 text-sm">
            <p className="font-medium">{t("bank")}</p>
            <p>Primalac: {config?.bank_recipient}</p>
            <p>Banka: {config?.bank_name}</p>
            <p>Račun: {config?.bank_account}</p>
            <p>Poziv na broj: {config?.bank_reference}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={config?.ips_qr_url || "/ips-qr.svg"}
              alt="IPS QR"
              className="mx-auto mt-2 h-40 w-40"
            />
          </div>
        )}
        <button
          type="button"
          className="mt-4 w-full rounded-md border border-zinc-300 py-2 text-sm"
          onClick={onClose}
        >
          {t("close")}
        </button>
      </div>
    </div>
  );
}
