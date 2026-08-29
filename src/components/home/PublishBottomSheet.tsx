"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import type { PostFormController } from "@/lib/post-form/usePostFormState";
import { submitPost } from "@/lib/post-form/submitPost";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import { COUNTRY_DIAL_CODES } from "@/lib/post-time-windows";
import { LuggageCounters } from "@/components/post-form/DeliverTravelFields";
import { BuyFields, OnsiteErrandFields } from "@/components/post-form/BuyOnsiteFields";
import type { TransportMode } from "@/lib/types";

const inputClass =
  "mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

const VEHICLE_OPTIONS: TransportMode[] = [
  "car",
  "motorbike",
  "van",
  "bus",
  "train",
  "bicycle",
  "walking",
];

type Props = {
  open: boolean;
  onClose: () => void;
  form: PostFormController;
};

export function PublishBottomSheet({ open, onClose, form }: Props) {
  const t = useTranslations();
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { state, setField, setShareMode, setMaxCompanions, visibility, computedFee, feeReady } =
    form;
  const [stage, setStage] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStage(1);
      setErrorKey(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const needsPlate =
    state.transport_mode === "car" ||
    state.transport_mode === "motorbike" ||
    state.transport_mode === "van";

  const isTravel = state.category === "travel";
  const isDeliver = state.category === "deliver";

  async function onPublish() {
    setErrorKey(null);
    if (!hasSupabaseEnv()) {
      setErrorKey("error.missing_env");
      return;
    }
    if (state.post_type === "demand" && !state.contact_email.trim().includes("@")) {
      setErrorKey("error.email_required");
      return;
    }

    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      router.push("/profile");
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_premium")
      .eq("id", auth.user.id)
      .maybeSingle();

    setSubmitting(true);
    const result = await submitPost(
      supabase,
      auth.user.id,
      locale,
      form.state,
      Boolean(profile?.is_premium),
    );
    setSubmitting(false);

    if (!result.ok) {
      setErrorKey(result.errorKey);
      return;
    }
    onClose();
    router.push(`/posts/${result.postId}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label={t("home.sheet.close")}
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-[#f7f7f5] shadow-2xl">
        <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-zinc-300" />
        <div className="flex items-center justify-between px-5 pt-3 pb-2">
          <h2 className="text-base font-semibold text-zinc-900">
            {stage === 1 ? t("home.sheet.stage1_title") : t("home.sheet.stage2_title")}
          </h2>
          <button
            type="button"
            aria-label={t("home.sheet.close")}
            onClick={onClose}
            className="rounded-full px-2 py-1 text-zinc-500 hover:bg-zinc-200/60"
          >
            ×
          </button>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            className="flex h-full w-[200%] transition-transform duration-300 ease-out"
            style={{ transform: stage === 1 ? "translateX(0%)" : "translateX(-50%)" }}
          >
            {/* Stage 1 */}
            <div className="h-full w-1/2 overflow-y-auto px-5 pb-28">
              <div className="space-y-4">
                <label className="block text-sm font-medium">
                  {t("home.sheet.departure_time")}
                  <input
                    type="time"
                    className={inputClass}
                    value={state.departure_time}
                    onChange={(e) => setField("departure_time", e.target.value)}
                  />
                </label>

                <div>
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span>{t("home.sheet.time_buffer")}</span>
                    <span className="text-zinc-600">
                      {t("ui.wait_minutes", { minutes: state.time_buffer })}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      className="h-10 w-10 rounded-full bg-zinc-200 text-lg font-bold"
                      onClick={() =>
                        setField("time_buffer", Math.max(0, state.time_buffer - 5))
                      }
                    >
                      −
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={120}
                      step={5}
                      value={state.time_buffer}
                      onChange={(e) => setField("time_buffer", Number(e.target.value))}
                      className="flex-1 accent-emerald-600"
                    />
                    <button
                      type="button"
                      className="h-10 w-10 rounded-full bg-zinc-200 text-lg font-bold"
                      onClick={() =>
                        setField("time_buffer", Math.min(120, state.time_buffer + 5))
                      }
                    >
                      +
                    </button>
                  </div>
                </div>

                {isTravel ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span>{t("home.sheet.passengers")}</span>
                      <span>{state.max_companions}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="h-10 w-10 rounded-full bg-zinc-200 text-lg font-bold disabled:opacity-40"
                        disabled={state.share_mode === "private"}
                        onClick={() => setMaxCompanions(state.max_companions - 1)}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="h-10 w-10 rounded-full bg-zinc-200 text-lg font-bold disabled:opacity-40"
                        disabled={state.share_mode === "private"}
                        onClick={() => setMaxCompanions(state.max_companions + 1)}
                      >
                        +
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShareMode("share")}
                        className={`flex-1 rounded-xl px-3 py-2 text-sm ${
                          state.share_mode === "share"
                            ? "bg-emerald-600 text-white"
                            : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {t("ui.share_pool")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShareMode("private")}
                        className={`flex-1 rounded-xl px-3 py-2 text-sm ${
                          state.share_mode === "private"
                            ? "bg-emerald-600 text-white"
                            : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {t("ui.private_buyout")}
                      </button>
                    </div>
                    {state.show_private_buyout_notice ? (
                      <p className="text-xs leading-5 text-amber-800">
                        {t("ui.private_buyout_notice")}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {isDeliver ? <LuggageCounters form={form} /> : null}

                {visibility.buy ? <BuyFields form={form} /> : null}
                {visibility.local ? <OnsiteErrandFields form={form} /> : null}

                {visibility.showFeeDemand && feeReady && computedFee != null ? (
                  <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    {t("ui.estimated_kms_fee", {
                      kms: state.estimated_kms.toFixed(0),
                      amount: computedFee.toFixed(2),
                    })}
                  </p>
                ) : null}
                {state.kms_loading ? (
                  <p className="text-sm text-zinc-500">{t("publish.kmsCalculating")}</p>
                ) : null}
                {state.kms_error_key ? (
                  <p className="text-sm text-red-600">{t(state.kms_error_key as "error.route_distance_failed")}</p>
                ) : null}
              </div>
            </div>

            {/* Stage 2 */}
            <div className="h-full w-1/2 overflow-y-auto px-5 pb-28">
              <div className="space-y-4">
                {state.post_type === "demand" ? (
                  <>
                    <label className="block text-sm font-medium">
                      {t("home.sheet.email")}
                      <input
                        type="email"
                        className={inputClass}
                        value={state.contact_email}
                        onChange={(e) => setField("contact_email", e.target.value)}
                      />
                    </label>
                    <label className="block text-sm font-medium">
                      {t("home.sheet.phone")}
                      <div className="mt-1 flex gap-2">
                        <select
                          className="rounded-xl border border-zinc-200 bg-white px-2 py-2.5 text-sm"
                          value={state.dial_code}
                          onChange={(e) => setField("dial_code", e.target.value)}
                        >
                          {COUNTRY_DIAL_CODES.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code}
                            </option>
                          ))}
                        </select>
                        <input
                          className={`${inputClass} mt-0 flex-1`}
                          value={state.raw_phone_local}
                          onChange={(e) => setField("raw_phone_local", e.target.value)}
                          inputMode="tel"
                        />
                      </div>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="block text-sm font-medium">
                      {t("home.sheet.real_name")}
                      <input
                        className={inputClass}
                        value={state.provider_name}
                        onChange={(e) => setField("provider_name", e.target.value)}
                      />
                    </label>
                    <label className="block text-sm font-medium">
                      {t("home.sheet.phone")}
                      <div className="mt-1 flex gap-2">
                        <select
                          className="rounded-xl border border-zinc-200 bg-white px-2 py-2.5 text-sm"
                          value={state.dial_code}
                          onChange={(e) => setField("dial_code", e.target.value)}
                        >
                          {COUNTRY_DIAL_CODES.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code}
                            </option>
                          ))}
                        </select>
                        <input
                          className={`${inputClass} mt-0 flex-1`}
                          value={state.raw_phone_local}
                          onChange={(e) => setField("raw_phone_local", e.target.value)}
                          inputMode="tel"
                        />
                      </div>
                    </label>
                    <label className="block text-sm font-medium">
                      {t("home.sheet.vehicle_type")}
                      <select
                        className={inputClass}
                        value={state.transport_mode}
                        onChange={(e) =>
                          setField(
                            "transport_mode",
                            e.target.value as TransportMode | "",
                          )
                        }
                      >
                        <option value="">—</option>
                        {VEHICLE_OPTIONS.map((mode) => (
                          <option key={mode} value={mode}>
                            {t(`hall.transport.${mode}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {needsPlate ? (
                      <div className="space-y-3 rounded-xl bg-violet-50/80 p-3 ring-1 ring-violet-200/70">
                        <label className="block text-sm font-medium">
                          {t("home.sheet.vehicle_brand")}
                          <input
                            className={inputClass}
                            value={state.vehicle_brand}
                            onChange={(e) => setField("vehicle_brand", e.target.value)}
                            required
                          />
                        </label>
                        <label className="block text-sm font-medium">
                          {t("home.sheet.vehicle_color")}
                          <input
                            className={inputClass}
                            value={state.vehicle_color}
                            onChange={(e) => setField("vehicle_color", e.target.value)}
                            required
                          />
                        </label>
                        <label className="block text-sm font-medium">
                          {t("home.sheet.license_plate")}
                          <input
                            className={inputClass}
                            value={state.raw_license_plate}
                            onChange={(e) => setField("raw_license_plate", e.target.value)}
                            required
                          />
                        </label>
                      </div>
                    ) : null}
                  </>
                )}

                {errorKey ? (
                  <p className="text-sm text-red-600">
                    {t(errorKey as "error.post_denied_blurred")}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex gap-2 border-t border-zinc-200/80 bg-[#f7f7f5]/95 px-5 py-4 backdrop-blur">
          {stage === 2 ? (
            <button
              type="button"
              onClick={() => setStage(1)}
              className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium"
            >
              {t("home.sheet.back")}
            </button>
          ) : null}
          {stage === 1 ? (
            <button
              type="button"
              onClick={() => setStage(2)}
              className="ml-auto rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white"
            >
              {t("ui.next_step")}
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void onPublish()}
              className="ml-auto rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting
                ? t("publish.submitting")
                : state.post_type === "demand"
                  ? t("ui.publish")
                  : t("ui.match_now")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
