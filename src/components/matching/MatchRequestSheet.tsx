"use client";

/**
 * PHASE 6.7B — unmounted match-request sheet.
 *
 * Client validator is UX + shared contract only.
 * PHASE 6.7C server MUST re-run parseApplicationPayloadV1 and MUST re-read from
 * DB: target_post_id → post, category, owner, current status.
 * Browser-provided targetPostType / targetCategory / recipient / applicant role
 * must not be trusted.
 *
 * Do not mount this on PostCard or the homepage this round.
 */

import { useEffect, useId, useReducer, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { TRANSPORT_MODES } from "@/lib/posts";
import { ITEM_UNITS } from "@/lib/post-payload";
import type { TransportMode } from "@/lib/types";
import type { ApplicationPayloadV1 } from "@/lib/matching/applicationPayload";
import { MATCH_REQUEST_MESSAGE_MAX } from "@/lib/matching/applicationPayload";
import {
  attemptMatchRequestSubmit,
  collectFieldHints,
  createInitialMatchRequestForm,
  reduceMatchRequestForm,
  serverErrorAlert,
  type MatchRequestFormState,
  type MatchRequestTargetPost,
} from "@/lib/matching/matchRequestForm";

function tx(t: ReturnType<typeof useTranslations>, key: string): string {
  return (t as unknown as (k: string) => string)(key);
}

const inputClass =
  "mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

const CARGO_ITEMS = [
  { key: "small" as const, emoji: "🎒", labelKey: "luggage.small" },
  { key: "medium" as const, emoji: "🧳", labelKey: "luggage.medium" },
  { key: "large" as const, emoji: "📦", labelKey: "luggage.large" },
  { key: "xlarge" as const, emoji: "🛋️", labelKey: "luggage.xlarge" },
];

export type MatchRequestSheetProps = {
  targetPost: MatchRequestTargetPost;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: ApplicationPayloadV1) => void;
  submitting: boolean;
  serverErrorKey: string | null;
};

export function MatchRequestSheet({
  targetPost,
  open,
  onOpenChange,
  onSubmit,
  submitting,
  serverErrorKey,
}: MatchRequestSheetProps) {
  const t = useTranslations("matchRequest");
  const tHall = useTranslations("hall");
  const tRoot = useTranslations();
  const tPublish = useTranslations("publish");
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [wasOpen, setWasOpen] = useState(open);
  const [form, dispatch] = useReducer(
    reduceMatchRequestForm,
    targetPost,
    createInitialMatchRequestForm,
  );
  const displayForm =
    open !== wasOpen ? createInitialMatchRequestForm(targetPost) : form;
  if (open !== wasOpen) {
    setWasOpen(open);
    dispatch({
      type: "RESET",
      target: targetPost,
    });
  }

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  const isProviderApplicant = targetPost.post_type === "demand";
  const hints = collectFieldHints(displayForm, targetPost);
  const fieldMsg = (field: keyof MatchRequestFormState["fieldErrors"]) =>
    displayForm.fieldErrors[field] ?? hints[field];
  const alert = serverErrorAlert(serverErrorKey);
  const busy = submitting;

  function close() {
    onOpenChange(false);
  }

  function handleSubmit() {
    const result = attemptMatchRequestSubmit(displayForm, targetPost, busy);
    if (result.kind === "blocked_submitting") return;
    if (result.kind === "invalid") {
      dispatch({ type: "SET_FIELD_ERRORS", errors: result.fieldErrors });
      return;
    }
    onSubmit(result.payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label={t("cancel")}
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px]"
        onClick={close}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-[#f7f7f5] shadow-2xl outline-none sm:rounded-3xl"
      >
        <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-zinc-300 sm:hidden" />
        <div className="flex items-center justify-between px-5 pt-3 pb-2">
          <h2 id={titleId} className="text-base font-semibold text-zinc-900">
            {isProviderApplicant ? t("titleOffer") : t("titleRequest")}
          </h2>
          <button
            type="button"
            aria-label={t("cancel")}
            onClick={close}
            className="rounded-full px-2 py-1 text-zinc-500 hover:bg-zinc-200/60"
          >
            ×
          </button>
        </div>

        <form
          className="min-h-0 flex-1 overflow-y-auto px-5 pb-28"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          {alert ? (
            <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
              {tx(tRoot,alert.errorKey)}
            </p>
          ) : null}

          <section className="space-y-1 rounded-xl bg-white px-3 py-3 ring-1 ring-zinc-200">
            <p className="text-xs font-medium text-zinc-500">{t("targetType")}</p>
            <p className="text-sm font-semibold text-zinc-900">
              {tHall(`postType.${targetPost.post_type}`)}
              <span className="mx-1.5 text-zinc-400">·</span>
              {tHall(`category.${targetPost.category}`)}
            </p>
            <p className="text-sm text-zinc-600">
              {targetPost.origin_address || "—"}
              <span className="mx-1.5 text-zinc-400" aria-hidden>
                →
              </span>
              {targetPost.destination_address || "—"}
            </p>
            <p className="text-sm text-zinc-600">
              {targetPost.departure_date || "—"}
              {targetPost.departure_time_window
                ? ` · ${targetPost.departure_time_window}`
                : ""}
            </p>
            <p className="text-sm font-medium text-zinc-800">
              {tHall("fee")}:{" "}
              {targetPost.fee_amount != null
                ? Number(targetPost.fee_amount).toFixed(0)
                : "—"}
            </p>
          </section>

          <div className="mt-4 space-y-4">
            {isProviderApplicant ? (
              <label className="block text-sm font-medium">
                {t("transportMode")}
                <select
                  className={inputClass}
                  value={displayForm.transportMode}
                  disabled={busy}
                  aria-invalid={Boolean(fieldMsg("transportMode"))}
                  onChange={(event) =>
                    dispatch({
                      type: "SET_TRANSPORT_MODE",
                      value: event.target.value as TransportMode | "",
                    })
                  }
                >
                  <option value="">—</option>
                  {TRANSPORT_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {tHall(`transport.${mode}`)}
                    </option>
                  ))}
                </select>
                {fieldMsg("transportMode") ? (
                  <p role="alert" className="mt-1 text-xs text-amber-800">
                    {tx(tRoot,fieldMsg("transportMode")!)}
                  </p>
                ) : null}
              </label>
            ) : null}

            {isProviderApplicant && targetPost.category === "travel" ? (
              <SeatField
                label={t("availablePassengerSeats")}
                value={displayForm.availablePassengerSeats}
                disabled={busy}
                invalid={Boolean(fieldMsg("availablePassengerSeats"))}
                hint={fieldMsg("availablePassengerSeats")}
                onChange={(value) =>
                  dispatch({
                    type: "SET_SEAT_FIELD",
                    field: "availablePassengerSeats",
                    value,
                  })
                }
                tRoot={tRoot}
              />
            ) : null}

            {isProviderApplicant && targetPost.category === "deliver" ? (
              <SeatField
                label={t("availablePassengerSeatsOptional")}
                value={displayForm.availablePassengerSeats}
                disabled={busy}
                invalid={Boolean(fieldMsg("availablePassengerSeats"))}
                hint={fieldMsg("availablePassengerSeats")}
                onChange={(value) =>
                  dispatch({
                    type: "SET_SEAT_FIELD",
                    field: "availablePassengerSeats",
                    value,
                  })
                }
                tRoot={tRoot}
              />
            ) : null}

            {!isProviderApplicant && targetPost.category === "travel" ? (
              <SeatField
                label={t("passengerCount")}
                value={displayForm.passengerCount}
                disabled={busy}
                invalid={Boolean(fieldMsg("passengerCount"))}
                hint={fieldMsg("passengerCount")}
                onChange={(value) =>
                  dispatch({
                    type: "SET_SEAT_FIELD",
                    field: "passengerCount",
                    value,
                  })
                }
                tRoot={tRoot}
              />
            ) : null}

            {!isProviderApplicant && targetPost.category === "deliver" ? (
              <SeatField
                label={tPublish("escortSeats")}
                value={displayForm.escortSeats}
                disabled={busy}
                invalid={Boolean(fieldMsg("escortSeats"))}
                hint={fieldMsg("escortSeats")}
                onChange={(value) =>
                  dispatch({
                    type: "SET_SEAT_FIELD",
                    field: "escortSeats",
                    value,
                  })
                }
                tRoot={tRoot}
              />
            ) : null}

            {targetPost.category === "travel" || targetPost.category === "deliver" ? (
              <CargoBlock
                form={displayForm}
                busy={busy}
                required={!isProviderApplicant && targetPost.category === "deliver"}
                showToggle={targetPost.category === "travel"}
                hint={fieldMsg("cargo")}
                dispatch={dispatch}
                t={t}
                tRoot={tRoot}
                tPublish={tPublish}
              />
            ) : null}

            {!isProviderApplicant && targetPost.category === "buy" ? (
              <BuyBlock
                form={displayForm}
                busy={busy}
                fieldMsg={fieldMsg}
                dispatch={dispatch}
                t={t}
                tRoot={tRoot}
                tPublish={tPublish}
              />
            ) : null}

            <label className="block text-sm font-medium">
              {t("message")}
              <textarea
                className={inputClass}
                rows={3}
                maxLength={MATCH_REQUEST_MESSAGE_MAX}
                value={displayForm.message}
                disabled={busy}
                aria-invalid={Boolean(fieldMsg("message"))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.currentTarget.tagName === "TEXTAREA") {
                    event.stopPropagation();
                  }
                }}
                onChange={(event) =>
                  dispatch({ type: "SET_MESSAGE", value: event.target.value })
                }
              />
              <span className="mt-1 block text-xs text-zinc-500">
                {displayForm.message.length}/{MATCH_REQUEST_MESSAGE_MAX}
              </span>
              {fieldMsg("message") ? (
                <p role="alert" className="mt-1 text-xs text-amber-800">
                  {tx(tRoot,fieldMsg("message")!)}
                </p>
              ) : null}
            </label>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-xl bg-zinc-900 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {t("submit")}
            </button>
            <button
              type="button"
              className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm"
              onClick={close}
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SeatField({
  label,
  value,
  disabled,
  invalid,
  hint,
  onChange,
  tRoot,
}: {
  label: string;
  value: string;
  disabled: boolean;
  invalid: boolean;
  hint?: string;
  onChange: (value: string) => void;
  tRoot: ReturnType<typeof useTranslations>;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={4}
        className={inputClass}
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <p role="alert" className="mt-1 text-xs text-amber-800">
          {tx(tRoot,hint)}
        </p>
      ) : null}
    </label>
  );
}

function CargoBlock({
  form,
  busy,
  required,
  showToggle,
  hint,
  dispatch,
  t,
  tRoot,
  tPublish,
}: {
  form: MatchRequestFormState;
  busy: boolean;
  required: boolean;
  showToggle: boolean;
  hint?: string;
  dispatch: (action: Parameters<typeof reduceMatchRequestForm>[1]) => void;
  t: ReturnType<typeof useTranslations>;
  tRoot: ReturnType<typeof useTranslations>;
  tPublish: ReturnType<typeof useTranslations>;
}) {
  const showCounters = required || form.carryLuggage || !showToggle;
  return (
    <section className="space-y-3">
      {showToggle ? (
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.carryLuggage}
            disabled={busy}
            onChange={(event) =>
              dispatch({ type: "SET_CARRY_LUGGAGE", value: event.target.checked })
            }
          />
          {t("carryLuggage")}
        </label>
      ) : (
        <h3 className="text-sm font-semibold text-zinc-700">{tPublish("luggage")}</h3>
      )}
      {showCounters ? (
        <div className="grid grid-cols-2 gap-3">
          {CARGO_ITEMS.map(({ key, emoji, labelKey }) => (
            <div
              key={key}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2.5"
            >
              <span className="text-sm">
                {emoji} {tx(tRoot,labelKey)}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-lg shadow-sm ring-1 ring-zinc-200 disabled:opacity-60"
                  onClick={() => dispatch({ type: "SET_CARGO", size: key, delta: -1 })}
                >
                  −
                </button>
                <span className="min-w-[1.5rem] text-center text-sm font-semibold">
                  {form.cargo[key]}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-lg shadow-sm ring-1 ring-zinc-200 disabled:opacity-60"
                  onClick={() => dispatch({ type: "SET_CARGO", size: key, delta: 1 })}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {hint ? (
        <p role="alert" className="text-xs text-amber-800">
          {tx(tRoot,hint)}
        </p>
      ) : null}
    </section>
  );
}

function BuyBlock({
  form,
  busy,
  fieldMsg,
  dispatch,
  t,
  tRoot,
  tPublish,
}: {
  form: MatchRequestFormState;
  busy: boolean;
  fieldMsg: (field: keyof MatchRequestFormState["fieldErrors"]) => string | undefined;
  dispatch: (action: Parameters<typeof reduceMatchRequestForm>[1]) => void;
  t: ReturnType<typeof useTranslations>;
  tRoot: ReturnType<typeof useTranslations>;
  tPublish: ReturnType<typeof useTranslations>;
}) {
  void t;
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">
          {tPublish("itemQuantity")}
          <input
            type="number"
            min={1}
            className={inputClass}
            value={form.itemQuantity}
            disabled={busy}
            aria-invalid={Boolean(fieldMsg("itemQuantity"))}
            onChange={(event) =>
              dispatch({ type: "SET_ITEM_QUANTITY", value: event.target.value })
            }
          />
          {fieldMsg("itemQuantity") ? (
            <p role="alert" className="mt-1 text-xs text-amber-800">
              {tx(tRoot,fieldMsg("itemQuantity")!)}
            </p>
          ) : null}
        </label>
        <label className="block text-sm font-medium">
          {tPublish("itemUnit")}
          <select
            className={inputClass}
            value={form.itemUnit}
            disabled={busy}
            aria-invalid={Boolean(fieldMsg("itemUnit"))}
            onChange={(event) =>
              dispatch({
                type: "SET_ITEM_UNIT",
                value: event.target.value as MatchRequestFormState["itemUnit"],
              })
            }
          >
            {ITEM_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {tx(tRoot,`unit.${unit}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{tPublish("itemCondition")}</legend>
        {(["new", "used"] as const).map((condition) => (
          <label key={condition} className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="item_condition"
              disabled={busy}
              checked={form.itemCondition === condition}
              onChange={() =>
                dispatch({ type: "SET_ITEM_CONDITION", value: condition })
              }
            />
            {tx(tRoot,`itemCondition.demand.${condition}`)}
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{tPublish("budgetType")}</legend>
        {(["range", "negotiable"] as const).map((type) => (
          <label key={type} className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="purchase_price_type"
              disabled={busy}
              checked={form.purchasePriceType === type}
              onChange={() =>
                dispatch({ type: "SET_PURCHASE_PRICE_TYPE", value: type })
              }
            />
            {tPublish(`purchasePrice.${type}`)}
          </label>
        ))}
      </fieldset>

      {form.purchasePriceType === "range" ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            {tPublish("minBudget")}
            <input
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              value={form.minBudget}
              disabled={busy}
              aria-invalid={Boolean(fieldMsg("minBudget"))}
              onChange={(event) =>
                dispatch({ type: "SET_BUDGET", field: "minBudget", value: event.target.value })
              }
            />
            {fieldMsg("minBudget") ? (
              <p role="alert" className="mt-1 text-xs text-amber-800">
                {tx(tRoot,fieldMsg("minBudget")!)}
              </p>
            ) : null}
          </label>
          <label className="block text-sm font-medium">
            {tPublish("maxBudget")}
            <input
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              value={form.maxBudget}
              disabled={busy}
              aria-invalid={Boolean(fieldMsg("maxBudget"))}
              onChange={(event) =>
                dispatch({ type: "SET_BUDGET", field: "maxBudget", value: event.target.value })
              }
            />
            {fieldMsg("maxBudget") ? (
              <p role="alert" className="mt-1 text-xs text-amber-800">
                {tx(tRoot,fieldMsg("maxBudget")!)}
              </p>
            ) : null}
          </label>
        </div>
      ) : null}
    </section>
  );
}
