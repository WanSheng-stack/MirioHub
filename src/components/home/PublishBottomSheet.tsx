"use client";

import { useEffect, useRef, useState } from "react";
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
  // postId from Channel A (verify) or Channel B (shadow-draft).
  // When set, Stage 2 updates this existing post instead of inserting a new one.
  const [pendingPostId, setPendingPostId] = useState<string | null>(null);

  // Publish-intent anchor — generated once per sheet session, reused across:
  //   Passkey retries, Channel B fallbacks, Stage-2 contact completion.
  // Reset to null when the sheet opens so each new sheet session gets a fresh intent.
  // Using useRef to guarantee synchronous reads within the same call without React
  // state batching race conditions.
  const publishIntentIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      setStage(1);
      setErrorKey(null);
      setPendingPostId(null);
      // New sheet session → clear any prior intent so first click creates a fresh UUID
      publishIntentIdRef.current = null;
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

    // Reuse the intent ID if this is a retry/fallback within the same sheet session.
    // Only generate a fresh UUID when no intent has been started yet.
    if (!publishIntentIdRef.current) {
      publishIntentIdRef.current = crypto.randomUUID();
    }
    const clientRequestId = publishIntentIdRef.current;

    try {
      // Step 1: resolve or provision anonymous session.
      // Key invariant: signInAnonymously() is called AT MOST ONCE per browser.
      // If a session already exists (anonymous or real), we reuse it — never
      // create a second user. This means the profile trigger fires only once.
      const supabase = createClient();
      const {
        data: { session: existingSession },
      } = await supabase.auth.getSession();
      let user_id = existingSession?.user?.id;

      if (!user_id) {
        // First Publish intent with no session: create one anonymous auth user.
        // Subsequent clicks reuse the cookie session — this branch won't run again.
        const { data: anonData, error: anonErr } =
          await supabase.auth.signInAnonymously();
        if (anonErr || !anonData.user) throw new Error("anonymous_auth_failed");
        user_id = anonData.user.id;
      }

      // Step 2: obtain fencing-token-protected challenge from backend.
      // challenge-init reads auth.uid() server-side from the session cookie set
      // by the signInAnonymously() / existing session above.
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
        // processingToken is NOT returned by challenge-init; it lives in the DB
        // and is read server-side by the verify route — do not use here.
      };
      if (!challengeInitRes.ok) throw new Error("challenge_init_failed");

      // Enrich payload with all Stage-1 business fields for both channels
      const enrichedPayload = {
        ...state,
        associated_user_id: user_id,
        challenge_text: challengeData.challengeText,
      };

      // ── Step 3: WebAuthn biometric prompt (isolated try/catch) ──────────
      // Only AbortError / NotAllowedError / NotSupportedError are user-driven
      // cancel events → Channel B.  All other errors here are hard crypto
      // failures → crypto_invalid_signature.
      // Verify API errors (step 4) must NOT fall into this catch.
      type WebAuthnResponse = Awaited<ReturnType<typeof startRegistration>>;
      let webauthnResponse: WebAuthnResponse;
      try {
        webauthnResponse = (
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
              })
        ) as WebAuthnResponse;
      } catch (webauthnErr: unknown) {
        const cancelNames = ["AbortError", "NotAllowedError", "NotSupportedError"];
        const errName = webauthnErr instanceof Error ? webauthnErr.name : "";

        if (cancelNames.includes(errName)) {
          // Channel B: save shadow draft using the existing session cookie.
          // No new user is created — we reuse the anonymous session from above.
          const fallbackRes = await fetch("/api/posts/shadow-draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientRequestId,
              rawPostInput: enrichedPayload,
              fallbackReason: errName,
            }),
          });
          const fallbackResult = (await fallbackRes.json()) as {
            success: boolean;
            postId?: string | null;
          };
          if (!fallbackRes.ok || !fallbackResult.success) {
            // shadow-draft failure = server/network issue, not a crypto error
            setErrorKey("shadow_draft_failed");
            return;
          }
          // Save the draft postId so Stage 2 updates the SAME post
          setPendingPostId(fallbackResult.postId ?? null);
          // Draft saved → guide user to Stage 2 for contact activation
          setStage(2);
          return;
        }

        // Hard WebAuthn error (SecurityError, InvalidStateError, etc.)
        setErrorKey("crypto_invalid_signature");
        return;
      }

      // ── Step 4: Channel A — verify + atomic commit (outside WebAuthn catch) ──
      // Any error here surfaces its own errorKey; it is NOT a WebAuthn error.
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
          // processingToken is NOT sent — the verify route reads it from DB
        }),
      });
      const verifyResult = (await verifyRes.json()) as {
        success: boolean;
        postId?: string | null;
        errorKey?: string;
      };
      if (!verifyRes.ok) {
        // Show the specific API error, not a generic crypto message
        const raw = verifyResult.errorKey ?? "error.verify_failed";
        setErrorKey(raw.replace(/^error\./, ""));
        return;
      }

      // Channel A success: save postId so Stage 2 updates the SAME post
      setPendingPostId(verifyResult.postId ?? null);
      setStage(2);
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

    setSubmitting(true);

    // ── Path A: post already created by Channel A/B — write Stage-2 contact ─
    // Channel A posts are already active; contact info is a post-publish enhancement.
    // Channel B drafts are activated only if the Account has a verified identity;
    // unverified phone alone does NOT activate a draft (per activation policy).
    if (pendingPostId) {
      const res = await fetch("/api/posts/complete-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: pendingPostId,
          dial_code: state.dial_code,
          raw_phone_local: state.raw_phone_local,
          provider_name: state.provider_name,
          raw_license_plate: state.raw_license_plate,
          vehicle_brand: state.vehicle_brand,
          vehicle_color: state.vehicle_color,
          transport_mode: state.transport_mode,
          locale,
        }),
      });
      const result = (await res.json()) as {
        ok: boolean;
        postId?: string;
        isActive?: boolean;
        errorKey?: string;
      };
      setSubmitting(false);
      if (!result.ok) {
        const raw = result.errorKey ?? "error.submit_failed";
        setErrorKey(raw.replace(/^error\./, ""));
        return;
      }
      if (result.isActive) {
        // Post is live — navigate to post page
        onClose();
        router.push(`/posts/${result.postId}`);
      } else {
        // Draft saved with contact info; identity verification still needed.
        // Close sheet — user can complete verification from their account.
        onClose();
      }
      return;
    }

    // ── Path B: no pending post (legacy / direct publish without Passkey) ────
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_premium")
      .eq("id", auth.user.id)
      .maybeSingle();

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
