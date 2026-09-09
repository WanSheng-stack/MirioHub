"use client";

/**
 * PHASE 6.7B.1B.2 — unmounted match-request sheet.
 *
 * Client validator is UX + shared contract only.
 * Deliver applications collect Cargo V2 aggregate space (applicant side only).
 * Handling flags are advisory; 面议 copy is shown when any help flag is on.
 * PHASE 6.7C server MUST re-run parseApplicationPayloadV1 and MUST re-read from
 * DB: target_post_id → post, category, owner, current status.
 * Browser-provided targetPostType / targetCategory / recipient / applicant role
 * must not be trusted.
 *
 * Do not mount this on PostCard or the homepage this round.
 * Do not write match_requests, match_contracts, or agreement_snapshot.
 * Closed sheets unmount; targetPost.id remounts the draft (shouldResetMatchRequestDraft).
 */

import { useId, useLayoutEffect, useReducer, useRef } from "react";
import { useTranslations } from "next-intl";
import { ITEM_UNITS } from "@/lib/post-payload";
import type { TransportMode } from "@/lib/types";
import type { ApplicationPayloadV1 } from "@/lib/matching/applicationPayload";
import { MATCH_REQUEST_MESSAGE_MAX } from "@/lib/matching/applicationPayload";
import { CARGO_ESCORT_ACCOMMODATIONS } from "@/lib/cargo/cargoPolicy";
import type { CargoEscortAccommodation } from "@/lib/cargo/cargoPolicy";
import {
  attemptMatchRequestSubmit,
  collectFieldHints,
  createInitialMatchRequestForm,
  reduceMatchRequestForm,
  serverErrorAlert,
  showsHandlingFeeNegotiation,
  type MatchRequestFormAction,
  type MatchRequestFormState,
  type MatchRequestTargetPost,
} from "@/lib/matching/matchRequestForm";
import {
  displayedServerErrorKey,
  MATCH_REQUEST_FOCUSABLE_SELECTOR,
  matchRequestCloseActions,
  matchRequestInitialFocusIndex,
  matchRequestTabTrap,
  shouldClearServerErrorOnUserEdit,
  transportModesForMatchRequest,
} from "@/lib/matching/matchRequestSheetBehavior";

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
  onServerErrorClear: () => void;
};

export function MatchRequestSheet(props: MatchRequestSheetProps) {
  if (!props.open) return null;
  return <MatchRequestSheetBody key={props.targetPost.id} {...props} />;
}

function MatchRequestSheetBody({
  targetPost,
  open,
  onOpenChange,
  onSubmit,
  submitting,
  serverErrorKey,
  onServerErrorClear,
}: MatchRequestSheetProps) {
  const t = useTranslations("matchRequest");
  const tHall = useTranslations("hall");
  const tRoot = useTranslations();
  const tPublish = useTranslations("publish");
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(submitting);
  const onOpenChangeRef = useRef(onOpenChange);
  const onServerErrorClearRef = useRef(onServerErrorClear);
  const [form, dispatch] = useReducer(
    reduceMatchRequestForm,
    targetPost,
    createInitialMatchRequestForm,
  );

  function apply(action: MatchRequestFormAction) {
    if (shouldClearServerErrorOnUserEdit(action.type)) {
      onServerErrorClear();
    }
    dispatch(action);
  }

  function requestClose() {
    const actions = matchRequestCloseActions(submitting);
    if (actions.clearServerError) onServerErrorClear();
    if (actions.close) onOpenChange(false);
  }

  useLayoutEffect(() => {
    submittingRef.current = submitting;
    onOpenChangeRef.current = onOpenChange;
    onServerErrorClearRef.current = onServerErrorClear;
  });

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;

    function focusables(): HTMLElement[] {
      if (!panelRef.current) return [];
      return Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(MATCH_REQUEST_FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
    }

    const nodes = focusables();
    const initial = matchRequestInitialFocusIndex(nodes.length);
    if (initial !== null) nodes[initial]?.focus();
    else panelRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        const actions = matchRequestCloseActions(submittingRef.current);
        if (actions.clearServerError) onServerErrorClearRef.current();
        if (actions.close) onOpenChangeRef.current(false);
        return;
      }
      if (event.key !== "Tab") return;
      const trapNodes = focusables();
      if (trapNodes.length === 0) return;
      const current = document.activeElement;
      const currentIndex = trapNodes.findIndex((el) => el === current);
      const trap = matchRequestTabTrap(
        { key: event.key, shiftKey: event.shiftKey },
        currentIndex,
        trapNodes.length,
      );
      if (!trap) return;
      event.preventDefault();
      trapNodes[trap.nextIndex]?.focus();
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  if (!open) return null;

  const isProviderApplicant = targetPost.post_type === "demand";
  const hints = collectFieldHints(form, targetPost);
  const fieldMsg = (field: keyof MatchRequestFormState["fieldErrors"]) =>
    form.fieldErrors[field] ?? hints[field];
  const alert = serverErrorAlert(displayedServerErrorKey(serverErrorKey));
  const busy = submitting;
  const modeOptions = transportModesForMatchRequest(targetPost.category);
  const showTransportSelect = isProviderApplicant && modeOptions.length > 0;

  function handleSubmit() {
    const result = attemptMatchRequestSubmit(form, targetPost, busy);
    if (result.kind === "blocked_submitting") return;
    if (result.kind === "invalid") {
      dispatch({ type: "SET_FIELD_ERRORS", errors: result.fieldErrors });
      return;
    }
    onSubmit(result.payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px]"
        onClick={requestClose}
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
            disabled={busy}
            onClick={requestClose}
            className="rounded-full px-2 py-1 text-zinc-500 hover:bg-zinc-200/60 disabled:opacity-60"
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
            {showTransportSelect ? (
              <label className="block text-sm font-medium">
                {t("transportMode")}
                <select
                  className={inputClass}
                  value={form.transportMode}
                  disabled={busy}
                  aria-invalid={Boolean(fieldMsg("transportMode"))}
                  onChange={(event) =>
                    apply({
                      type: "SET_TRANSPORT_MODE",
                      value: event.target.value as TransportMode | "",
                    })
                  }
                >
                  <option value="">—</option>
                  {modeOptions.map((mode) => (
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
                value={form.availablePassengerSeats}
                disabled={busy}
                invalid={Boolean(fieldMsg("availablePassengerSeats"))}
                hint={fieldMsg("availablePassengerSeats")}
                onChange={(value) =>
                  apply({
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
                value={form.passengerCount}
                disabled={busy}
                invalid={Boolean(fieldMsg("passengerCount"))}
                hint={fieldMsg("passengerCount")}
                onChange={(value) =>
                  apply({
                    type: "SET_SEAT_FIELD",
                    field: "passengerCount",
                    value,
                  })
                }
                tRoot={tRoot}
              />
            ) : null}

            {targetPost.category === "travel" ? (
              <CargoBlock
                form={form}
                busy={busy}
                required={false}
                showToggle={true}
                hint={fieldMsg("cargo")}
                dispatch={apply}
                t={t}
                tRoot={tRoot}
                tPublish={tPublish}
              />
            ) : null}

            {targetPost.category === "deliver" ? (
              <CargoV2Block
                form={form}
                busy={busy}
                isProviderApplicant={isProviderApplicant}
                fieldMsg={fieldMsg}
                dispatch={apply}
                t={t}
                tRoot={tRoot}
              />
            ) : null}

            {!isProviderApplicant && targetPost.category === "buy" ? (
              <BuyBlock
                form={form}
                busy={busy}
                fieldMsg={fieldMsg}
                dispatch={apply}
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
                value={form.message}
                disabled={busy}
                aria-invalid={Boolean(fieldMsg("message"))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.currentTarget.tagName === "TEXTAREA") {
                    event.stopPropagation();
                  }
                }}
                onChange={(event) =>
                  apply({ type: "SET_MESSAGE", value: event.target.value })
                }
              />
              <span className="mt-1 block text-xs text-zinc-500">
                {form.message.length}/{MATCH_REQUEST_MESSAGE_MAX}
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
              disabled={busy}
              className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm disabled:opacity-60"
              onClick={requestClose}
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

function CargoV2Block({
  form,
  busy,
  isProviderApplicant,
  fieldMsg,
  dispatch,
  t,
  tRoot,
}: {
  form: MatchRequestFormState;
  busy: boolean;
  isProviderApplicant: boolean;
  fieldMsg: (field: keyof MatchRequestFormState["fieldErrors"]) => string | undefined;
  dispatch: (action: Parameters<typeof reduceMatchRequestForm>[1]) => void;
  t: ReturnType<typeof useTranslations>;
  tRoot: ReturnType<typeof useTranslations>;
}) {
  const role = isProviderApplicant ? "provider" : "demand";
  const showFee = showsHandlingFeeNegotiation(form, role);
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-zinc-700">
        {isProviderApplicant ? t("availableSpace") : t("requiredSpace")}
      </h3>
      <p className="text-xs text-zinc-500">
        {isProviderApplicant ? t("availableSpaceHint") : t("requiredSpaceHint")}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["spaceLength", "lengthCm"],
            ["spaceWidth", "widthCm"],
            ["spaceHeight", "heightCm"],
          ] as const
        ).map(([field, labelKey]) => (
          <label key={field} className="block text-sm font-medium">
            {t(labelKey)}
            <input
              type="number"
              inputMode="numeric"
              min={1}
              className={inputClass}
              value={form[field]}
              disabled={busy}
              aria-invalid={Boolean(fieldMsg("cargoSpace"))}
              onChange={(event) =>
                dispatch({
                  type: "SET_SPACE_FIELD",
                  field,
                  value: event.target.value,
                })
              }
            />
          </label>
        ))}
      </div>
      {fieldMsg("cargoSpace") ? (
        <p role="alert" className="text-xs text-amber-800">
          {tx(tRoot, fieldMsg("cargoSpace")!)}
        </p>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          {isProviderApplicant ? t("availablePayload") : t("approximateWeight")}
        </legend>
        {(["unknown", "known"] as const).map((kind) => (
          <label key={kind} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="cargo_weight_kind"
              disabled={busy}
              checked={form.weightKind === kind}
              onChange={() => dispatch({ type: "SET_WEIGHT_KIND", value: kind })}
            />
            {t(kind === "unknown" ? "weightUnknown" : "weightKnown")}
          </label>
        ))}
        {form.weightKind === "known" ? (
          <label className="block text-sm font-medium">
            {t("weightKg")}
            <input
              type="number"
              inputMode="decimal"
              min={0.1}
              step="0.1"
              className={inputClass}
              value={form.weightKg}
              disabled={busy}
              aria-invalid={Boolean(fieldMsg("cargoWeight"))}
              onChange={(event) =>
                dispatch({ type: "SET_WEIGHT_KG", value: event.target.value })
              }
            />
          </label>
        ) : null}
        {fieldMsg("cargoWeight") ? (
          <p role="alert" className="text-xs text-amber-800">
            {tx(tRoot, fieldMsg("cargoWeight")!)}
          </p>
        ) : null}
      </fieldset>

      {isProviderApplicant ? (
        <label className="block text-sm font-medium">
          {t("escortAccommodationLabel")}
          <select
            className={inputClass}
            value={form.escortAccommodation}
            disabled={busy}
            aria-invalid={Boolean(fieldMsg("cargoEscort"))}
            onChange={(event) =>
              dispatch({
                type: "SET_ESCORT_ACCOMMODATION",
                value: event.target.value as CargoEscortAccommodation | "",
              })
            }
          >
            <option value="">—</option>
            {CARGO_ESCORT_ACCOMMODATIONS.map((value) => (
              <option key={value} value={value}>
                {t(`escortAccommodation.${value}`)}
              </option>
            ))}
          </select>
          {fieldMsg("cargoEscort") ? (
            <p role="alert" className="mt-1 text-xs text-amber-800">
              {tx(tRoot, fieldMsg("cargoEscort")!)}
            </p>
          ) : null}
        </label>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("escortPassengerCount")}</legend>
          {(["0", "1"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="escort_passenger_count"
                disabled={busy}
                checked={form.escortPassengerCount === value}
                onChange={() =>
                  dispatch({ type: "SET_ESCORT_PASSENGER_COUNT", value })
                }
              />
              {t(value === "0" ? "escortNone" : "escortOne")}
            </label>
          ))}
          {fieldMsg("cargoEscort") ? (
            <p role="alert" className="text-xs text-amber-800">
              {tx(tRoot, fieldMsg("cargoEscort")!)}
            </p>
          ) : null}
        </fieldset>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("handlingTitle")}</legend>
        {isProviderApplicant ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={busy}
                checked={form.canHelpLoading}
                onChange={(event) =>
                  dispatch({
                    type: "SET_HANDLING_FLAG",
                    field: "canHelpLoading",
                    value: event.target.checked,
                  })
                }
              />
              {t("canHelpLoading")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={busy}
                checked={form.canHelpUnloading}
                onChange={(event) =>
                  dispatch({
                    type: "SET_HANDLING_FLAG",
                    field: "canHelpUnloading",
                    value: event.target.checked,
                  })
                }
              />
              {t("canHelpUnloading")}
            </label>
          </>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={busy}
                checked={form.needsLoadingHelp}
                onChange={(event) =>
                  dispatch({
                    type: "SET_HANDLING_FLAG",
                    field: "needsLoadingHelp",
                    value: event.target.checked,
                  })
                }
              />
              {t("needsLoadingHelp")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={busy}
                checked={form.needsUnloadingHelp}
                onChange={(event) =>
                  dispatch({
                    type: "SET_HANDLING_FLAG",
                    field: "needsUnloadingHelp",
                    value: event.target.checked,
                  })
                }
              />
              {t("needsUnloadingHelp")}
            </label>
          </>
        )}
        {showFee ? (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-medium">{t("handlingFeeNegotiable")}</p>
            <p className="mt-1">
              {isProviderApplicant
                ? t("handlingFeeProviderHint")
                : t("handlingFeeDemandHint")}
            </p>
          </div>
        ) : null}
        {fieldMsg("cargoHandling") ? (
          <p role="alert" className="text-xs text-amber-800">
            {tx(tRoot, fieldMsg("cargoHandling")!)}
          </p>
        ) : null}
      </fieldset>

      <label className="block text-sm font-medium">
        {t("cargoNote")}
        <textarea
          className={inputClass}
          rows={2}
          maxLength={300}
          value={form.cargoNote}
          disabled={busy}
          aria-invalid={Boolean(fieldMsg("cargoNote"))}
          onChange={(event) =>
            dispatch({ type: "SET_CARGO_NOTE", value: event.target.value })
          }
        />
        {fieldMsg("cargoNote") ? (
          <p role="alert" className="mt-1 text-xs text-amber-800">
            {tx(tRoot, fieldMsg("cargoNote")!)}
          </p>
        ) : null}
      </label>
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
