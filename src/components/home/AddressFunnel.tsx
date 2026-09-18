"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AddressSearchField } from "@/components/home/AddressSearchField";
import type { ConfirmedAddressGeo } from "@/lib/geo/addressSearch";
import type { PostCategory } from "@/lib/types";

type Props = {
  category: PostCategory;
  originGeo: ConfirmedAddressGeo | null;
  destinationGeo: ConfirmedAddressGeo | null;
  serviceGeo: ConfirmedAddressGeo | null;
  onOriginGeo: (v: ConfirmedAddressGeo | null) => void;
  onDestinationGeo: (v: ConfirmedAddressGeo | null) => void;
  onServiceGeo: (v: ConfirmedAddressGeo | null) => void;
  onConfirm: () => void;
};

export function AddressFunnel({
  category,
  originGeo,
  destinationGeo,
  serviceGeo,
  onOriginGeo,
  onDestinationGeo,
  onServiceGeo,
  onConfirm,
}: Props) {
  const t = useTranslations("home");
  const [forceValidation, setForceValidation] = useState(false);
  const isRoute = category === "travel" || category === "deliver";

  const canConfirm = isRoute
    ? originGeo != null && destinationGeo != null
    : serviceGeo != null;

  function handleContinue() {
    if (!canConfirm) {
      setForceValidation(true);
      return;
    }
    setForceValidation(false);
    onConfirm();
  }

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-200/80 bg-white/90 p-4 shadow-sm">
      {isRoute ? (
        <>
          <AddressSearchField
            label={t("origin")}
            confirmed={originGeo}
            onConfirmedChange={onOriginGeo}
            forceValidation={forceValidation}
          />
          <AddressSearchField
            label={t("destination")}
            confirmed={destinationGeo}
            onConfirmedChange={onDestinationGeo}
            forceValidation={forceValidation}
          />
        </>
      ) : (
        <AddressSearchField
          label={t("service_location")}
          confirmed={serviceGeo}
          onConfirmedChange={onServiceGeo}
          forceValidation={forceValidation}
        />
      )}

      <button
        type="button"
        onClick={handleContinue}
        className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
      >
        {t("confirm_location")}
      </button>
    </div>
  );
}
