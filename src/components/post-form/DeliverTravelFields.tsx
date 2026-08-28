"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PostFormController } from "@/lib/post-form/usePostFormState";

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10";

type Props = { form: PostFormController };

export function DeliverTravelFields({ form }: Props) {
  const t = useTranslations();
  const { state, setField, visibility, dispatch, setShareMode, setEscortSeats, setMaxCompanions } =
    form;

  return (
    <section className="space-y-4">
      <label className="block text-sm">
        {t("publish.originAddress")}
        <input
          className={inputClass}
          value={state.origin_address}
          onChange={(e) => setField("origin_address", e.target.value)}
          required
        />
      </label>

      <label className="block text-sm">
        {t("publish.destinationAddress")}
        <input
          className={inputClass}
          value={state.destination_address}
          onChange={(e) => setField("destination_address", e.target.value)}
          required
        />
      </label>

      {visibility.showWaypoints ? (
        <div className="space-y-2">
          {state.waypoints.map((wp, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={`${inputClass} mt-0 flex-1`}
                value={wp}
                placeholder={t("publish.waypointPlaceholder", { index: i + 1 })}
                onChange={(e) =>
                  dispatch({ type: "UPDATE_WAYPOINT", index: i, value: e.target.value })
                }
              />
              <button
                type="button"
                className="shrink-0 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-600"
                onClick={() => dispatch({ type: "REMOVE_WAYPOINT", index: i })}
              >
                ×
              </button>
            </div>
          ))}
          {state.waypoints.length < 10 ? (
            <button
              type="button"
              className="text-sm font-medium text-zinc-700 underline-offset-2 hover:underline"
              onClick={() => dispatch({ type: "ADD_WAYPOINT" })}
            >
              + {t("ui.add_waypoint")}
            </button>
          ) : null}
        </div>
      ) : null}

      {visibility.showEscortSeats ? (
        <label className="block text-sm">
          {t("publish.escortSeats")}
          <input
            type="number"
            min={0}
            max={4}
            className={inputClass}
            value={state.escort_seats}
            onChange={(e) => setEscortSeats(Number(e.target.value))}
          />
        </label>
      ) : null}

      {visibility.showMaxCompanions ? (
        <label className="block text-sm">
          {t("publish.maxCompanions")}
          <input
            type="number"
            min={1}
            max={4}
            className={inputClass}
            value={state.max_companions}
            disabled={state.share_mode === "private"}
            onChange={(e) => setMaxCompanions(Number(e.target.value))}
          />
        </label>
      ) : null}

      {visibility.showDeliveryMode ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("publish.deliveryMode")}</legend>
          <div className="flex flex-wrap gap-3">
            {(["spot", "door"] as const).map((mode) => (
              <label key={mode} className="inline-flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="delivery_mode"
                  checked={state.delivery_mode === mode}
                  onChange={() => setField("delivery_mode", mode)}
                />
                <span>
                  {t(`ui.${mode === "spot" ? "spot_mode" : "door_mode"}`)}
                  {mode === "door" ? (
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      {t("ui.door_mode_hint")}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {visibility.showShareMode ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("publish.shareMode")}</legend>
          <div className="flex flex-wrap gap-3">
            {(["share", "private"] as const).map((mode) => (
              <label key={mode} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="share_mode"
                  checked={state.share_mode === mode}
                  onChange={() => setShareMode(mode)}
                />
                {t(`ui.${mode === "share" ? "share_pool" : "private_buyout"}`)}
              </label>
            ))}
          </div>
          {state.show_private_buyout_notice ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
              {t("ui.private_buyout_notice")}
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </section>
  );
}

export function LuggageCounters({ form }: Props) {
  const t = useTranslations();
  const { state, dispatch } = form;
  const [guideOpen, setGuideOpen] = useState(false);

  const items = [
    { key: "count_small" as const, emoji: "🎒", labelKey: "luggage.small" },
    { key: "count_medium" as const, emoji: "🧳", labelKey: "luggage.medium" },
    { key: "count_large" as const, emoji: "📦", labelKey: "luggage.large" },
    { key: "count_xlarge" as const, emoji: "🛋️", labelKey: "luggage.xlarge" },
  ];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700">{t("publish.luggage")}</h2>
        <button
          type="button"
          className="text-lg"
          title={t("luggage.sizeGuide")}
          onClick={() => setGuideOpen(true)}
          onMouseEnter={() => setGuideOpen(true)}
        >
          📐
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {items.map(({ key, emoji, labelKey }) => (
          <div
            key={key}
            className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2.5"
          >
            <span className="text-sm">
              {emoji} {t(labelKey as "luggage.small")}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-lg shadow-sm ring-1 ring-zinc-200"
                onClick={() => dispatch({ type: "DECREMENT_LUGGAGE", key })}
              >
                −
              </button>
              <span className="min-w-[1.5rem] text-center text-sm font-semibold">
                {state[key]}
              </span>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-lg shadow-sm ring-1 ring-zinc-200"
                onClick={() => dispatch({ type: "INCREMENT_LUGGAGE", key })}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      {guideOpen ? (
        <div
          className="rounded-xl border border-zinc-200 bg-white p-4 shadow-lg"
          onMouseLeave={() => setGuideOpen(false)}
        >
          <p className="text-sm font-medium">{t("luggage.sizeGuide")}</p>
          <ul className="mt-2 space-y-1 text-sm text-zinc-600">
            <li>🎒 {t("luggage.dimSmall")}</li>
            <li>🧳 {t("luggage.dimMedium")}</li>
            <li>📦 {t("luggage.dimLarge")}</li>
            <li>🛋️ {t("luggage.dimXlarge")}</li>
          </ul>
          <p className="mt-3 text-sm font-bold text-red-600">{t("luggage.oversizeWarning")}</p>
        </div>
      ) : null}
    </section>
  );
}

export function FeeDisplay({ form }: Props) {
  const t = useTranslations();
  const { state, setField, computedFee, visibility, feeReady } = form;

  if (!visibility.showFeeDemand) return null;

  return (
    <section className="space-y-3 rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
      {state.kms_loading ? (
        <p className="text-sm text-zinc-500">{t("publish.kmsCalculating")}</p>
      ) : null}

      {state.kms_error_key ? (
        <p className="text-sm text-red-600">
          {(t as (key: string) => string)(state.kms_error_key)}
        </p>
      ) : null}

      {feeReady && state.estimated_kms > 0 ? (
        <p className="text-xs text-zinc-500">
          {t("publish.estimatedKms", { kms: state.estimated_kms.toFixed(1) })}
        </p>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("publish.bumpFee")}</legend>
        <div className="flex flex-wrap gap-2">
          {[0, 2, 5, 10].map((fee) => (
            <button
              key={fee}
              type="button"
              className={`rounded-full px-3 py-1.5 text-sm ${
                state.bump_fee === fee
                  ? "bg-zinc-900 text-white"
                  : "bg-white text-zinc-700 ring-1 ring-zinc-200"
              }`}
              onClick={() => setField("bump_fee", fee)}
            >
              {t(`publish.bumpOption.${fee}` as "publish.bumpOption.0")}
            </button>
          ))}
        </div>
      </fieldset>

      {computedFee != null ? (
        <p className="text-2xl font-bold text-zinc-900">
          {t("ui.recommended_fee", { amount: computedFee.toFixed(2) })}
        </p>
      ) : null}

      <p className="text-sm font-medium text-amber-800">{t("ui.demand_disclaimer")}</p>
    </section>
  );
}

export function ProviderAssetsFields({ form }: Props) {
  const t = useTranslations();
  const { state, setField } = form;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-zinc-700">{t("publish.providerAssets")}</h2>
      {(
        [
          ["provider_name", "publish.providerName"],
          ["vehicle_brand", "publish.vehicleBrand"],
          ["vehicle_color", "publish.vehicleColor"],
          ["raw_license_plate", "publish.licensePlate"],
        ] as const
      ).map(([field, labelKey]) => (
        <label key={field} className="block text-sm">
          {t(labelKey)}
          <input
            className={inputClass}
            value={state[field]}
            onChange={(e) => setField(field, e.target.value)}
          />
        </label>
      ))}
    </section>
  );
}
