"use client";

/**
 * Published Success — Stage 2 when pendingPostStatus === "active".
 * Account backup (Google / Email) and phone are optional and independent.
 *
 * Public hall/detail reads use public_posts_safe (no raw_phone).
 * reveal_contact remains the old premium/free-view model until a later phase.
 */

import { useTranslations } from "next-intl";
import { COUNTRY_DIAL_CODES } from "@/lib/post-time-windows";

interface PublishedPostSuccessProps {
  postId: string | null;
  hasGoogle: boolean;
  hasVerifiedEmail: boolean;
  googleIdentityEmail: string | null;
  verifiedAccountEmail: string | null;
  connecting: boolean;
  backupEmail: string;
  onBackupEmailChange: (value: string) => void;
  onConnectGoogle: () => void;
  onSendEmail: () => void;
  backupMsg: string | null;
  backupIsInfo: boolean;
  dialCode: string;
  phoneLocal: string;
  onDialCodeChange: (value: string) => void;
  onPhoneLocalChange: (value: string) => void;
  onSavePhone: () => void;
  phoneSaving: boolean;
  phoneSaved: boolean;
  hasContactPhone: boolean;
  onViewMatches: () => void;
  onSkip: () => void;
  onViewPost: () => void;
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function PublishedPostSuccess({
  postId,
  hasGoogle,
  hasVerifiedEmail,
  googleIdentityEmail,
  verifiedAccountEmail,
  connecting,
  backupEmail,
  onBackupEmailChange,
  onConnectGoogle,
  onSendEmail,
  backupMsg,
  backupIsInfo,
  dialCode,
  phoneLocal,
  onDialCodeChange,
  onPhoneLocalChange,
  onSavePhone,
  phoneSaving,
  phoneSaved,
  hasContactPhone,
  onViewMatches,
  onSkip,
  onViewPost,
}: PublishedPostSuccessProps) {
  const t = useTranslations("publishSuccess");
  const needsRecovery = !hasGoogle && !hasVerifiedEmail;
  const emailsMatch =
    Boolean(googleIdentityEmail) &&
    Boolean(verifiedAccountEmail) &&
    googleIdentityEmail!.toLowerCase() === verifiedAccountEmail!.toLowerCase();

  return (
    <div className="space-y-5">
      <div className="space-y-1.5 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
        <p className="text-base font-semibold text-emerald-900">✓ {t("title")}</p>
        <p className="text-sm text-emerald-800">{t("body")}</p>
        <p className="text-xs leading-relaxed text-emerald-700">{t("hint")}</p>
      </div>

      {postId ? (
        <button
          type="button"
          onClick={onViewMatches}
          className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-800"
        >
          {t("viewMatches")}
        </button>
      ) : null}

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        {needsRecovery ? (
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-zinc-900">{t("recoveryTitle")}</h3>
            <p className="text-xs leading-relaxed text-zinc-600">{t("recoveryBody")}</p>
          </div>
        ) : null}

        {hasGoogle ? (
          <div className="space-y-1 rounded-xl bg-emerald-50/80 px-3 py-2.5">
            <p className="text-sm font-medium text-emerald-800">{t("googleConnected")}</p>
            {googleIdentityEmail ? (
              <p className="text-xs text-emerald-700">{googleIdentityEmail}</p>
            ) : null}
            {emailsMatch ? (
              <p className="text-sm font-medium text-emerald-800">{t("emailVerified")}</p>
            ) : null}
          </div>
        ) : null}

        {hasVerifiedEmail && !emailsMatch ? (
          <div className="space-y-1 rounded-xl bg-emerald-50/80 px-3 py-2.5">
            <p className="text-sm font-medium text-emerald-800">{t("emailVerified")}</p>
            {verifiedAccountEmail ? (
              <p className="text-xs text-emerald-700">{verifiedAccountEmail}</p>
            ) : null}
          </div>
        ) : null}

        {needsRecovery ? (
          <button
            type="button"
            disabled={connecting}
            onClick={onConnectGoogle}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50"
          >
            <GoogleMark />
            {t("connectGoogle")}
          </button>
        ) : null}

        {needsRecovery ? (
          <>
            <div className="relative py-1">
              <div aria-hidden="true" className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-xs font-medium uppercase tracking-wide text-zinc-400">
                  {t("orOtherEmail")}
                </span>
              </div>
            </div>

            <label className="block text-sm font-medium text-zinc-800">
              {t("emailAddress")}
              <input
                type="email"
                value={backupEmail}
                onChange={(e) => onBackupEmailChange(e.target.value)}
                placeholder={t("emailPlaceholder")}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
              />
            </label>
            <button
              type="button"
              disabled={connecting || !backupEmail.trim()}
              onClick={onSendEmail}
              className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:opacity-50"
            >
              {t("sendVerification")}
            </button>
          </>
        ) : null}
        {backupMsg ? (
          <p
            className={`text-xs leading-relaxed ${backupIsInfo ? "text-emerald-700" : "text-red-600"}`}
          >
            {backupMsg}
          </p>
        ) : null}
      </section>

      {!hasContactPhone ? (
      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-zinc-900">{t("phoneTitle")}</h3>
          <p className="text-xs leading-relaxed text-zinc-600">{t("phoneHint")}</p>
        </div>
        <div className="flex gap-2">
          <select
            className="rounded-xl border border-zinc-200 bg-white px-2 py-2.5 text-sm"
            value={dialCode}
            onChange={(e) => onDialCodeChange(e.target.value)}
          >
            {COUNTRY_DIAL_CODES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
          <input
            className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
            value={phoneLocal}
            onChange={(e) => onPhoneLocalChange(e.target.value)}
            inputMode="tel"
          />
        </div>
        <button
          type="button"
          disabled={phoneSaving || !phoneLocal.trim()}
          onClick={onSavePhone}
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:opacity-50"
        >
          {phoneSaving ? t("savingPhone") : t("savePhone")}
        </button>
        {phoneSaved ? (
          <p className="text-xs font-medium text-emerald-700">{t("phoneSaved")}</p>
        ) : null}
      </section>
      ) : null}

      <button
        type="button"
        onClick={onSkip}
        className="w-full rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100"
      >
        {t("skip")}
      </button>
      {postId ? (
        <button
          type="button"
          onClick={onViewPost}
          className="w-full text-center text-sm font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
        >
          {t("viewPost")}
        </button>
      ) : null}
    </div>
  );
}
