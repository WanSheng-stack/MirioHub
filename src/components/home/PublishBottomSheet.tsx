"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import type { PostFormController } from "@/lib/post-form/usePostFormState";
import { submitPost } from "@/lib/post-form/submitPost";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
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
  const {
    state,
    setField,
    setShareMode,
    setMaxCompanions,
    visibility,
    computedFee,
    feeReady,
    dispatch,
  } = form;
  const [stage, setStage] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
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

  // ---------------------------------------------------------------------------
  // Dual-channel WebAuthn submit (Channel A: verify, Channel B: shadow-draft)
  // ---------------------------------------------------------------------------
  async function handleBookAttemptRC4() {
    if (isPublishing) return;
    setIsPublishing(true);
    setErrorKey(null);

    // Idempotency anchor — generated once at the moment of intent
    const clientRequestId = crypto.randomUUID();

    try {
      // Step 1: obtain fencing-token-protected challenge from backend.
      // challenge-init reads auth.uid() server-side from the session cookie —
      // we deliberately do NOT call signInAnonymously() here because doing so
      // creates a new Supabase auth user (and triggers a profile insert) on
      // every button press, even if the user never completes the Passkey flow.
      const challengeInitRes = await fetch("/api/auth/passkey/challenge-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId }),
      });
      const challengeData = (await challengeInitRes.json()) as {
        challengeId: string;
        challengeText: string;
        ceremonyType: "registration" | "authentication";
        options: Record<string, unknown>;
        processingToken: string;
      };
      if (!challengeInitRes.ok) {
        // 401 means no session — user needs to sign in first
        if (challengeInitRes.status === 401) {
          setErrorKey("authentication_required");
          return;
        }
        throw new Error("challenge_init_failed");
      }

      // Enrich payload with session context (Stage 2 contact fields included)
      const enrichedPayload = {
        ...state,
        challenge_text: challengeData.challengeText,
      };

      try {
        // Step 2: invoke biometric prompt
        const webauthnResponse =
          challengeData.ceremonyType === "registration"
            ? await startRegistration({
                optionsJSON:
                  challengeData.options as unknown as Parameters<
                    typeof startRegistration
                  >[0]["optionsJSON"],
              })
            : await startAuthentication({
                optionsJSON:
                  challengeData.options as unknown as Parameters<
                    typeof startAuthentication
                  >[0]["optionsJSON"],
              });

        // Channel A: passkey verified → atomic post commit
        const verifyRes = await fetch("/api/auth/passkey/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challengeId: challengeData.challengeId,
            response: webauthnResponse,
            installationId: window.navigator.userAgent,
            clientRequestId,
            rawPostInput: enrichedPayload,
            ceremonyType: challengeData.ceremonyType,
            processingToken: challengeData.processingToken,
          }),
        });
        const verifyResult = (await verifyRes.json()) as {
          success: boolean;
          errorKey?: string;
        };
        if (!verifyRes.ok)
          throw new Error(verifyResult.errorKey ?? "verify_failed");

        // Success → slide to Stage 2 (contact activation)
        setStage(2);
      } catch (webauthnErr: unknown) {
        // User cancelled or device doesn't support Passkey.
        // This is a normal user action — stop silently, do NOT call shadow-draft,
        // do NOT create any user/profile, do NOT show a server error.
        const cancelNames = ["AbortError", "NotAllowedError", "NotSupportedError"];
        const errName =
          webauthnErr instanceof Error ? webauthnErr.name : "";

        if (cancelNames.includes(errName)) {
          // Silently swallow the cancellation — user can try again
          return;
        }

        // Hard crypto mismatch — surface error inline
        setErrorKey("crypto_invalid_signature");
      }
    } catch {
      setErrorKey("server_internal_crash");
    } finally {
      setIsPublishing(false);
    }
  }

  async function onPublish() {
    setErrorKey(null);
    if (!hasSupabaseEnv()) {
      setErrorKey("missing_env");
      return;
    }
    if (state.post_type === "demand" && !state.contact_email.trim().includes("@")) {
      setErrorKey("email_required");
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
      // Strip leading "error." so rendering via t(`error.${key}`) stays clean
      setErrorKey(result.errorKey.replace(/^error\./, ""));
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
      <div className="relative z-10 flex h-auto max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-[#f7f7f5] shadow-2xl">
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
            className="flex h-auto min-h-[12rem] w-[200%] transition-transform duration-300 ease-out"
            style={{ transform: stage === 1 ? "translateX(0%)" : "translateX(-50%)" }}
          >
            {/* Stage 1 */}
            <div className="h-auto max-h-[calc(88vh-9rem)] w-1/2 overflow-y-auto px-5 pb-36">
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
                    <p className="text-sm font-medium">{t("home.sheet.passengers")}</p>
                    <div className="grid w-full grid-cols-2 items-center gap-4">
                      {/* Left half: passenger stepper — centered in its 50% */}
                      <div className="flex w-full items-center justify-center">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-200 text-xl font-bold disabled:opacity-40"
                            disabled={state.share_mode === "private"}
                            onClick={() => setMaxCompanions(state.max_companions - 1)}
                          >
                            −
                          </button>
                          <span className="min-w-[2rem] text-center text-xl font-semibold tabular-nums text-zinc-900">
                            {state.max_companions}
                          </span>
                          <button
                            type="button"
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-200 text-xl font-bold disabled:opacity-40"
                            disabled={state.share_mode === "private"}
                            onClick={() => setMaxCompanions(state.max_companions + 1)}
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Right half: share / private radios — centered as a block, left edges flush */}
                      <div className="flex w-full flex-col items-center justify-center">
                        <fieldset className="inline-flex flex-col items-start gap-2">
                          <legend className="sr-only">{t("home.sheet.passengers")}</legend>
                          <label className="flex cursor-pointer items-center gap-2.5">
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                                state.share_mode === "share"
                                  ? "border-emerald-600"
                                  : "border-zinc-300"
                              }`}
                              aria-hidden
                            >
                              {state.share_mode === "share" ? (
                                <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                              ) : null}
                            </span>
                            <input
                              type="radio"
                              name="share_mode"
                              className="sr-only"
                              checked={state.share_mode === "share"}
                              onChange={() => setShareMode("share")}
                            />
                            <span
                              className={`text-sm leading-snug ${
                                state.share_mode === "share"
                                  ? "font-medium text-zinc-900"
                                  : "text-zinc-500"
                              }`}
                            >
                              {t("category.demand.share_pool")}
                            </span>
                          </label>
                          <label className="flex cursor-pointer items-center gap-2.5">
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                                state.share_mode === "private"
                                  ? "border-emerald-600"
                                  : "border-zinc-300"
                              }`}
                              aria-hidden
                            >
                              {state.share_mode === "private" ? (
                                <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                              ) : null}
                            </span>
                            <input
                              type="radio"
                              name="share_mode"
                              className="sr-only"
                              checked={state.share_mode === "private"}
                              onChange={() => setShareMode("private")}
                            />
                            <span
                              className={`text-sm leading-snug ${
                                state.share_mode === "private"
                                  ? "font-medium text-zinc-900"
                                  : "text-zinc-500"
                              }`}
                            >
                              {t("category.demand.private_buyout")}
                            </span>
                          </label>
                        </fieldset>
                      </div>
                    </div>

                    {state.show_private_buyout_notice ? (
                      <p className="text-xs leading-5 text-amber-800">
                        {t("ui.private_buyout_notice")}
                      </p>
                    ) : null}

                    {/* Luggage display block — under passenger stepper */}
                    <div className="space-y-3">
                      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-3">
                        <span className="text-sm font-medium text-zinc-800">
                          {t("ui.has_luggage")}
                        </span>
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-emerald-600"
                          checked={state.carry_luggage}
                          onChange={(e) =>
                            dispatch({
                              type: "SET_CARRY_LUGGAGE",
                              carry_luggage: e.target.checked,
                            })
                          }
                        />
                      </label>
                      <div
                        className={`grid transition-all duration-300 ease-out ${
                          state.carry_luggage
                            ? "grid-rows-[1fr] opacity-100"
                            : "grid-rows-[0fr] opacity-0"
                        }`}
                      >
                        <div className="overflow-hidden">
                          {state.carry_luggage ? (
                            <LuggageCounters form={form} />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {isDeliver ? <LuggageCounters form={form} /> : null}

                {visibility.buy ? <BuyFields form={form} /> : null}
                {visibility.local ? <OnsiteErrandFields form={form} /> : null}

                {state.kms_loading ? (
                  <p className="text-sm text-zinc-500">{t("publish.kmsCalculating")}</p>
                ) : null}
                {state.kms_error_key ? (
                  <p className="text-sm text-red-600">
                    {t(state.kms_error_key as "error.route_distance_failed")}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Stage 2 */}
            <div className="h-auto max-h-[calc(88vh-9rem)] w-1/2 overflow-y-auto px-5 pb-28">
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
                    {t(`error.${errorKey}` as "error.post_denied_blurred")}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 space-y-2 border-t border-zinc-200/80 bg-[#f7f7f5]/95 px-5 py-3 backdrop-blur">
          {stage === 1 && visibility.showFeeDemand ? (
            <div className="space-y-1 rounded-xl bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-950 ring-1 ring-emerald-200/70">
              <p className="tabular-nums">
                {t("ui.estimated_kms", {
                  kms: feeReady ? state.estimated_kms.toFixed(0) : "0",
                })}
              </p>
              <p className="font-semibold tabular-nums transition-all duration-150">
                {t("ui.recommended_price", {
                  amount:
                    feeReady && computedFee != null ? computedFee.toFixed(2) : "0.00",
                })}
              </p>
            </div>
          ) : null}
          <div className="flex gap-2">
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
                disabled={isPublishing}
                onClick={handleBookAttemptRC4}
                className="ml-auto flex w-full items-center justify-center gap-2 rounded-xl bg-[#00B074] px-4 py-3 text-sm font-bold text-white transition-all hover:bg-[#00965E] disabled:opacity-60"
              >
                {isPublishing ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="h-5 w-5 animate-spin text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    {t("ui.publishing_loading")}
                  </span>
                ) : (
                  t("ui.next_step")
                )}
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
    </div>
  );
}
