"use client";

import { useTranslations } from "next-intl";

type Props = {
  visible: boolean;
  providerName?: string | null;
  providerPhone?: string | null;
  vehicleBrand?: string | null;
  vehicleColor?: string | null;
  licensePlate?: string | null;
};

export function VerificationShield({
  visible,
  providerName,
  providerPhone,
  vehicleBrand,
  vehicleColor,
  licensePlate,
}: Props) {
  const t = useTranslations();

  if (!visible) return null;

  return (
    <div
      className="animate-pulse rounded-xl border-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-900 ring-2 ring-red-300"
      role="alert"
    >
      <p className="font-bold">{t("ui.handover_shield_alert")}</p>
      <ul className="mt-2 space-y-0.5 text-xs">
        {providerName ? (
          <li>
            {t("publish.providerName")}: {providerName}
          </li>
        ) : null}
        {providerPhone ? (
          <li>
            {t("publish.phone")}: {providerPhone}
          </li>
        ) : null}
        {vehicleBrand ? (
          <li>
            {t("publish.vehicleBrand")}: {vehicleBrand}
          </li>
        ) : null}
        {vehicleColor ? (
          <li>
            {t("publish.vehicleColor")}: {vehicleColor}
          </li>
        ) : null}
        {licensePlate ? (
          <li>
            {t("publish.licensePlate")}: {licensePlate}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
