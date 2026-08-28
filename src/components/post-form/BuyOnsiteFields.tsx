"use client";

import { useTranslations } from "next-intl";
import type { PostFormController } from "@/lib/post-form/usePostFormState";
import { ITEM_UNITS } from "@/lib/post-payload";
import { TIME_WINDOWS } from "@/lib/post-time-windows";

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10";

type Props = { form: PostFormController };

export function BuyFields({ form }: Props) {
  const t = useTranslations();
  const { state, setField } = form;
  const isDemand = state.post_type === "demand";
  const totalBudget =
    state.price_calc_type === "unit" && state.item_price != null
      ? state.item_quantity * state.item_price
      : null;

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-zinc-700">{t("publish.buySection")}</h2>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          {t("publish.itemQuantity")}
          <input
            type="number"
            min={1}
            className={inputClass}
            value={state.item_quantity}
            onChange={(e) => setField("item_quantity", Math.max(1, Number(e.target.value)))}
          />
        </label>
        <label className="block text-sm">
          {t("publish.itemUnit")}
          <select
            className={inputClass}
            value={state.item_unit}
            onChange={(e) => setField("item_unit", e.target.value as typeof state.item_unit)}
          >
            {ITEM_UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`unit.${u}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("publish.itemCondition")}</legend>
        <div className="flex flex-wrap gap-3">
          {(["new", "used"] as const).map((c) => (
            <label key={c} className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="item_condition"
                checked={state.item_condition === c}
                onChange={() => setField("item_condition", c)}
              />
              {t(`itemCondition.${state.post_type}.${c}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <div className="inline-flex rounded-full bg-zinc-100 p-1">
          {(["unit", "total"] as const).map((type) => (
            <button
              key={type}
              type="button"
              className={`rounded-full px-4 py-1.5 text-sm ${
                state.price_calc_type === type
                  ? "bg-white font-medium shadow-sm"
                  : "text-zinc-600"
              }`}
              onClick={() => setField("price_calc_type", type)}
            >
              {t(`publish.priceCalc.${type}`)}
            </button>
          ))}
        </div>
        <label className="block text-sm">
          {t("publish.itemPrice")}
          <input
            type="number"
            min={0}
            step="0.01"
            className={inputClass}
            value={state.item_price ?? ""}
            onChange={(e) =>
              setField("item_price", e.target.value === "" ? null : Number(e.target.value))
            }
          />
        </label>
        {totalBudget != null ? (
          <p className="text-sm text-zinc-500">
            {t("publish.totalBudgetHint", {
              quantity: state.item_quantity,
              price: state.item_price?.toFixed(2) ?? "0",
              total: totalBudget.toFixed(2),
            })}
          </p>
        ) : null}
      </div>

      {isDemand ? (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("publish.budgetType")}</legend>
            <div className="flex flex-wrap gap-3">
              {(["range", "negotiable"] as const).map((type) => (
                <label key={type} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="purchase_price_type"
                    checked={state.purchase_price_type === type}
                    onChange={() => {
                      setField("purchase_price_type", type);
                      setField("reference_photo_required", type === "negotiable");
                    }}
                  />
                  {t(`publish.purchasePrice.${type}`)}
                </label>
              ))}
            </div>
          </fieldset>

          {state.purchase_price_type === "range" ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                {t("publish.minBudget")}
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputClass}
                  value={state.min_budget ?? ""}
                  onChange={(e) =>
                    setField("min_budget", e.target.value === "" ? null : Number(e.target.value))
                  }
                />
              </label>
              <label className="block text-sm">
                {t("publish.maxBudget")}
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputClass}
                  value={state.max_budget ?? ""}
                  onChange={(e) =>
                    setField("max_budget", e.target.value === "" ? null : Number(e.target.value))
                  }
                />
              </label>
            </div>
          ) : (
            <label className="block text-sm">
              {t("publish.referencePhoto")}
              <input
                type="file"
                accept="image/*"
                className={inputClass}
                onChange={(e) =>
                  setField("reference_photo_uploaded", (e.target.files?.length ?? 0) > 0)
                }
              />
            </label>
          )}

          <p className="text-sm text-zinc-600">
            {state.purchase_price_type === "range"
              ? t("publish.feeHintRange")
              : t("publish.feeHintNegotiable")}
          </p>
        </>
      ) : (
        <p className="text-sm font-medium text-zinc-700">{t("publish.providerCargoFee")}</p>
      )}

      <label className="block text-sm">
        {t("publish.heading")}
        <input className={inputClass} value={state.title} onChange={(e) => setField("title", e.target.value)} />
      </label>
      <label className="block text-sm">
        {t("publish.description")}
        <textarea
          rows={3}
          className={inputClass}
          value={state.description}
          onChange={(e) => setField("description", e.target.value)}
        />
      </label>
    </section>
  );
}

export function OnsiteErrandFields({ form }: Props) {
  const t = useTranslations();
  const { state, setField } = form;
  const isProvider = state.post_type === "provider";

  return (
    <section className="space-y-4">
      <label className="block text-sm">
        {t("publish.serviceAddress")}
        <input
          className={inputClass}
          value={state.service_address}
          onChange={(e) => setField("service_address", e.target.value)}
          required
        />
      </label>

      <label className="block text-sm">
        {t("publish.serviceTimeWindow")}
        <select
          className={inputClass}
          value={state.service_time_window}
          onChange={(e) => setField("service_time_window", e.target.value)}
        >
          {TIME_WINDOWS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>

      {isProvider ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("publish.providerPayType")}</legend>
          <div className="flex flex-wrap gap-3">
            {(["hourly", "fixed", "negotiable"] as const).map((type) => (
              <label key={type} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="provider_pay_type"
                  checked={state.provider_pay_type === type}
                  onChange={() => setField("provider_pay_type", type)}
                />
                {t(`publish.payType.${type}`)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {(!isProvider || state.provider_pay_type !== "negotiable") && (
        <label className="block text-sm">
          {t(isProvider ? "publish.expectedPay" : "publish.fixedReward")}
          <input
            type="number"
            min={0}
            step="0.01"
            className={inputClass}
            value={state.fixed_reward ?? ""}
            onChange={(e) =>
              setField("fixed_reward", e.target.value === "" ? null : Number(e.target.value))
            }
          />
        </label>
      )}

      {isProvider && state.provider_pay_type === "negotiable" ? (
        <p className="text-sm text-zinc-600">{t("publish.negotiableDisplay")}</p>
      ) : null}

      <label className="block text-sm">
        {t("publish.heading")}
        <input className={inputClass} value={state.title} onChange={(e) => setField("title", e.target.value)} />
      </label>
      <label className="block text-sm">
        {t("publish.description")}
        <textarea
          rows={3}
          className={inputClass}
          value={state.description}
          onChange={(e) => setField("description", e.target.value)}
        />
      </label>
    </section>
  );
}
