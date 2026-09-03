"use client";

/**
 * DraftIdentityCompletion
 *
 * Presentation-only component shown in BottomSheet Stage 2 when the post was
 * saved as a draft (Channel B — Passkey cancelled).
 *
 * It exposes THREE paths to complete identity verification and activate the
 * SAME draft post (not a new one):
 *   A. Retry Passkey
 *   B. Link Google (Draft activation flow, carries activation_nonce)
 *   C. Send Email confirmation link (Draft activation flow, carries nonce)
 *
 * Handlers are fully owned by PublishBottomSheet — this component is purely
 * presentational and cannot write to the database directly.
 *
 * Phone / plate are contact details only — explicitly NOT identity verification.
 */

import { useTranslations } from "next-intl";

interface DraftIdentityCompletionProps {
  /** The draft postId this component is acting on. Used for display only. */
  postId: string;
  /** True while a Passkey ceremony is in progress (disables Retry button). */
  isRetrying: boolean;
  /** Called when the user clicks "Retry Passkey". Must reuse the SAME
   *  client_request_id so commit_phase3 CASE C activates the same draft. */
  onRetryPasskey: () => void;
  /** Called when the user clicks "Publish with Google". Validates context,
   *  carries activation_nonce in the OAuth redirectTo, calls linkIdentity. */
  onLinkGoogle: () => void;
  /** Current value of the email input in this panel. */
  emailValue: string;
  /** Called on every keystroke in the email input. */
  onEmailChange: (value: string) => void;
  /** Called when the user clicks "Send Email confirmation". Validates context,
   *  carries activation_nonce in emailRedirectTo, calls updateUser. */
  onSendEmail: () => void;
  /** Error / info message from the last activation attempt (null = no message). */
  statusMsg: string | null;
  /** Whether statusMsg is informational (true) or an error (false / undefined). */
  statusIsInfo?: boolean;
  /** True while a Google or Email activation request is in flight. */
  activating: boolean;
  /** When false, Google/Email actions are hidden (expired/invalid context).
   *  Retry Passkey remains available — it does not depend on the context. */
  allowIdentityUpgrade: boolean;
}

export function DraftIdentityCompletion({
  isRetrying,
  onRetryPasskey,
  onLinkGoogle,
  emailValue,
  onEmailChange,
  onSendEmail,
  statusMsg,
  statusIsInfo = false,
  activating,
  allowIdentityUpgrade,
}: DraftIdentityCompletionProps) {
  const t = useTranslations();

  return (
    <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200 space-y-4">
      {/* Header */}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-amber-900">
          {t("identity.complete_to_publish")}
        </p>
        <p className="text-xs leading-relaxed text-amber-800">
          {t("identity.draft_saved_not_published")}
        </p>
      </div>

      {/* ── Path A: Retry Passkey ───────────────────────────────────────── */}
      <button
        type="button"
        disabled={isRetrying || activating}
        onClick={onRetryPasskey}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-medium text-amber-900 transition hover:bg-amber-50 disabled:opacity-50"
      >
        {/* Fingerprint icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 shrink-0"
          aria-hidden="true"
        >
          <path d="M12 10a2 2 0 0 0-2 2v4" />
          <path d="M10 10a4 4 0 0 1 8 0" />
          <path d="M6 12a6 6 0 0 1 12 0" />
          <path d="M3 12a9 9 0 0 1 18 0" />
        </svg>
        {t("identity.retry_passkey")}
      </button>

      {/* ── Path B/C: Google + Email — only with a valid activation context */}
      {allowIdentityUpgrade ? (
        <>
          <button
            type="button"
            disabled={activating || isRetrying}
            onClick={onLinkGoogle}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:opacity-50"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4 shrink-0"
              viewBox="0 0 24 24"
            >
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
            {t("identity.publish_with_google")}
          </button>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="email"
                value={emailValue}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder={t("account.bindEmail")}
                className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
              />
              <button
                type="button"
                disabled={activating || isRetrying || !emailValue.trim()}
                onClick={onSendEmail}
                className="rounded-xl bg-emerald-700 px-3 py-2.5 text-xs font-medium text-white transition hover:bg-emerald-800 disabled:opacity-50"
              >
                {t("identity.publish_with_email")}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {/* Status message (error or confirmation sent) */}
      {statusMsg && (
        <p
          className={`text-xs leading-relaxed ${statusIsInfo ? "text-emerald-700" : "text-red-600"}`}
        >
          {statusMsg}
        </p>
      )}

      {/* Disclaimer: phone is NOT identity verification */}
      <p className="text-xs leading-relaxed text-zinc-400">
        {t("identity.phone_not_identity_verification")}
      </p>
    </div>
  );
}
