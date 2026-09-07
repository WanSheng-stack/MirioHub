"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import { readWithClockSkewRetry } from "@/lib/auth/readWithClockSkewRetry";
import {
  isProfileFullNameEmpty,
  resolveGoogleDisplayName,
} from "@/lib/auth/googleProfileName";
import { resolveAccountIdentityState } from "@/lib/auth/accountIdentityState";
import { PhoneCountryPicker } from "@/components/phone/PhoneCountryPicker";
import {
  DEFAULT_PHONE_COUNTRY,
  parseStoredPhone,
  parseUserPhone,
  type PhoneCountryCode,
} from "@/lib/phone/phoneNumber";
import type { Profile, SystemConfig } from "@/lib/types";
import type { User } from "@supabase/supabase-js";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
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

const fieldClass =
  "mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

const settingRowClass =
  "rounded-xl border border-zinc-200 bg-white";
const settingSummaryClass =
  "flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-zinc-900 [&::-webkit-details-marker]:hidden";

function SettingRow({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className={settingRowClass}>
      <summary className={settingSummaryClass}>
        <span>{label}</span>
        <span className="flex items-center gap-2 text-zinc-500">
          {trailing}
          <span className="text-zinc-400" aria-hidden>
            ›
          </span>
        </span>
      </summary>
      <div className="space-y-3 border-t border-zinc-100 px-4 py-3">{children}</div>
    </details>
  );
}

function resolveAvatarUrl(user: User): string | null {
  const meta = user.user_metadata ?? {};
  const fromMeta = String(meta.avatar_url ?? meta.picture ?? "").trim();
  if (fromMeta.startsWith("http")) return fromMeta;
  const google = user.identities?.find((i) => i.provider === "google");
  const data = (google?.identity_data ?? {}) as Record<string, unknown>;
  const fromIdentity = String(data.avatar_url ?? data.picture ?? "").trim();
  return fromIdentity.startsWith("http") ? fromIdentity : null;
}

function resolveHeaderName(profile: { full_name?: string | null } | null, user: User): string {
  const fromProfile = String(profile?.full_name ?? "").trim();
  if (fromProfile) return fromProfile;
  const fromGoogle = resolveGoogleDisplayName(user);
  if (fromGoogle) return fromGoogle;
  const meta = user.user_metadata ?? {};
  const fromMeta = String(meta.full_name ?? meta.name ?? "").trim();
  if (fromMeta) return fromMeta;
  return "";
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "M";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

// ── Identity Activation Context ──────────────────────────────────────────────
// These helpers are module-level (no React state) so they can be called both
// from useEffect and from linkGoogle / bindEmail without closure issues.
//
// Design principles:
//   1. Context is written by PublishBottomSheet (Channel B) — not by this page.
//   2. The activation_nonce from the URL is the second required signal.
//      Context alone (sessionStorage) is NOT sufficient to trigger activation.
//   3. Server is the final authority: auth.uid() + post.user_id + identity.

const IDENTITY_ACTIVATION_CONTEXT_KEY = "mirio_identity_activation_context";
const IDENTITY_ACTIVATION_LEGACY_KEY = "mirio_identity_activation_post_id";

interface IdentityActivationContext {
  version: 1;
  purpose: "draft_activation";
  postId: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
}

/** Parse and structurally validate the context object from sessionStorage.
 *  Returns null on missing key, malformed JSON, or invalid shape. */
function parseActivationContext(): IdentityActivationContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(IDENTITY_ACTIVATION_CONTEXT_KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw) as Record<string, unknown>;
    if (
      ctx["version"] !== 1 ||
      ctx["purpose"] !== "draft_activation" ||
      typeof ctx["postId"] !== "string" ||
      !ctx["postId"] ||
      typeof ctx["nonce"] !== "string" ||
      !ctx["nonce"] ||
      typeof ctx["createdAt"] !== "number" ||
      typeof ctx["expiresAt"] !== "number" ||
      ctx["expiresAt"] <= ctx["createdAt"]
    ) {
      return null;
    }
    return ctx as unknown as IdentityActivationContext;
  } catch {
    return null;
  }
}

/** Remove the context from sessionStorage. */
function clearActivationContext(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(IDENTITY_ACTIVATION_CONTEXT_KEY);
}

/**
 * Validate the context against the URL-supplied nonce.
 * All 10 invariants must pass; on any failure the stale context is cleared.
 *
 * Gate 1:  context exists
 * Gate 2:  JSON parses successfully
 * Gate 3:  version === 1
 * Gate 4:  purpose === "draft_activation"
 * Gate 5:  postId is a non-empty string
 * Gate 6:  nonce is a non-empty string
 * Gate 7:  URL nonce === context.nonce
 * Gate 8:  Date.now() <= context.expiresAt
 * Gate 9:  createdAt / expiresAt are valid numbers
 * Gate 10: expiresAt > createdAt
 *
 * Returns the validated context, or null if any gate fails.
 */
function validateActivationContext(
  urlNonce: string,
): IdentityActivationContext | null {
  const ctx = parseActivationContext();

  // Gates 1–6, 9–10 are checked by parseActivationContext.
  if (!ctx) {
    // Malformed or missing → clear and return null (Gate 1/2/3/4/5/6/9/10)
    clearActivationContext();
    return null;
  }

  // Gate 8: TTL check
  if (Date.now() > ctx.expiresAt) {
    clearActivationContext(); // expired
    return null;
  }

  // Gate 7: nonce match
  if (ctx.nonce !== urlNonce) {
    clearActivationContext(); // stale / tampered context
    return null;
  }

  return ctx;
}

function bankRefFromUuid(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return String(hash % 1000000).padStart(6, "0");
}

type ExtendedProfile = Profile & {
  is_bank_verified?: boolean;
  bank_reference_code?: string | null;
};

export default function ProfilePage() {
  const t = useTranslations("account");
  const tErr = useTranslations("error");
  const locale = useLocale();
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ExtendedProfile | null>(null);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  // Identity-linking state (for logged-in / anonymous users)
  const [identityMsg, setIdentityMsg] = useState<string | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [emailForBinding, setEmailForBinding] = useState("");
  const [activatedCount, setActivatedCount] = useState(0);
  // postId of a draft that was activated after Google/Email identity verification.
  // Populated from the server response (not from client URL).
  const [activatedPostId, setActivatedPostId] = useState<string | null>(null);
  const [phoneOverride, setPhoneOverride] = useState<{
    stored: string;
    country: string;
    local: string;
  } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [avatarBroken, setAvatarBroken] = useState(false);
  const nameFillAttemptedRef = useRef(false);

  const bankRef = useMemo(
    () => profile?.bank_reference_code ?? (user ? bankRefFromUuid(user.id) : "------"),
    [profile?.bank_reference_code, user],
  );

  useEffect(() => {
    if (!hasSupabaseEnv()) {
      return;
    }

    const supabase = createClient();
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(IDENTITY_ACTIVATION_LEGACY_KEY);
    }

    void (async () => {
      const { data } = await supabase.auth.getUser();
      const resolved = data.user ?? null;
      // Auth session is the only source of unauthenticated. Data API errors never clear user.
      setUser(resolved);
      setAuthReady(true);

      if (resolved) {
        const loaded = await loadProfile(resolved.id);
        await loadSystemConfig();
        if (loaded) {
          await maybeFillGoogleFullName(resolved, loaded);
        }
      }

      handleIdentityCallbackParams();
    })();
    // Mount-once auth bootstrap. Identity callback reads the current URL only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tErr]);

  function handleIdentityCallbackParams() {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const cbError = params.get("error");
    const linked = params.get("identity_linked");
    const urlNonce = params.get("activation_nonce");

    if (cbError === "account_identity_continuity_broken") {
      setIdentityMsg(tErr("account_identity_continuity_broken"));
    } else if (linked && urlNonce) {
      const ctx = validateActivationContext(urlNonce);
      if (ctx) {
        void (async () => {
          let clearCtx = false;
          try {
            const res = await fetch("/api/posts/activate-after-identity", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ postId: ctx.postId }),
            });
            const json = (await res.json()) as {
              ok: boolean;
              postId?: string;
              isActive?: boolean;
              alreadyActive?: boolean;
              errorKey?: string;
            };
            if (res.ok && json.ok) {
              if (json.isActive) {
                setActivatedCount(1);
                if (json.postId) setActivatedPostId(json.postId);
              }
              clearCtx = true;
            } else if (
              res.status === 403 &&
              json.errorKey === "error.identity_verification_required"
            ) {
              clearCtx = false;
            } else if (res.status === 403 || res.status === 404 || res.status === 400) {
              clearCtx = true;
            } else {
              clearCtx = false;
            }
          } catch {
            clearCtx = false;
          } finally {
            if (clearCtx) clearActivationContext();
          }
        })();
      } else if (urlNonce) {
        setIdentityMsg(tErr("identity_activation_context_expired"));
      }
    }

    if (cbError ?? linked) {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("error");
      clean.searchParams.delete("identity_linked");
      clean.searchParams.delete("activation_nonce");
      window.history.replaceState({}, "", clean.toString());
    }
  }

  async function loadProfile(id: string): Promise<ExtendedProfile | null> {
    const supabase = createClient();
    const { data, error } = await readWithClockSkewRetry(supabase, async () => {
      const result = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
      return { data: result.data, error: result.error };
    });
    if (error) {
      console.error("[profile] profiles read failed", error);
      return null;
    }
    const row = data as ExtendedProfile | null;
    setProfile(row);
    return row;
  }

  async function loadSystemConfig(): Promise<void> {
    const supabase = createClient();
    const { data, error } = await readWithClockSkewRetry(supabase, async () => {
      const result = await supabase.from("system_configs").select("*").eq("id", 1).maybeSingle();
      return { data: result.data, error: result.error };
    });
    if (error) {
      console.error("[profile] system_configs read failed", error);
      return;
    }
    setConfig(data as SystemConfig | null);
  }

  async function maybeFillGoogleFullName(resolved: User, current: ExtendedProfile) {
    if (nameFillAttemptedRef.current) return;
    if (!isProfileFullNameEmpty(current.full_name)) return;
    const suggestion = resolveGoogleDisplayName(resolved);
    if (!suggestion) return;
    nameFillAttemptedRef.current = true;
    const supabase = createClient();
    const { data } = await supabase.rpc("update_my_profile", {
      p_full_name: suggestion,
      p_phone: current.phone,
      p_plate: current.plate,
      p_vehicle: current.vehicle,
      p_facebook: current.facebook,
      p_viber: current.viber,
    });
    const json = data as { ok?: boolean };
    if (json?.ok) {
      setProfile((p) => (p ? { ...p, full_name: suggestion } : { ...current, full_name: suggestion }));
    }
  }

  async function signInWithGoogle() {
    setMessage(null);
    setGoogleLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/${locale}/profile`,
      },
    });
    if (error) {
      setMessage(error.message);
      setGoogleLoading(false);
    }
  }

  async function signIn(mode: "in" | "up") {
    const supabase = createClient();
    const fn =
      mode === "in"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
    const { data, error } = await fn;
    setMessage(error?.message ?? null);
    if (data.user) {
      setUser(data.user);
      void loadProfile(data.user.id);
    }
  }

  // ── Identity linking (for already-logged-in / anonymous users) ─────────────

  async function linkGoogle() {
    setIdentityMsg(null);
    setIdentityLoading(true);
    const supabase = createClient();

    // ── Safe default: Account-only linking — NO activation_nonce ─────────────
    // linkGoogle() always operates as "identity management only".
    // Draft activation via Google requires a dedicated UI path that explicitly
    // carries the activation_nonce from the current IdentityActivationContext.
    // Reason: the presence of a sessionStorage context alone cannot prove the
    // user intends to publish a specific draft on this particular action.
    // See: PHASE 5.2 STOP GATE — IDENTITY ACTION INTENT UI PATH NOT DISTINGUISHABLE
    //
    // linkIdentity (not signInWithOAuth) preserves the current auth.users UUID-A.
    const callbackNext = new URLSearchParams({
      identity_linked: "google",
      // activation_nonce intentionally omitted — Account-only path
    });
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: {
        redirectTo:
          `${window.location.origin}/auth/callback?next=` +
          encodeURIComponent(`/${locale}/profile?${callbackNext.toString()}`),
      },
    });
    if (error) {
      setIdentityMsg(error.message);
      setIdentityLoading(false);
    }
    // On success: Supabase redirects to Google → callback → profile page
  }

  async function bindEmail() {
    if (!emailForBinding.trim()) return;
    setIdentityMsg(null);
    setIdentityLoading(true);
    const supabase = createClient();

    // ── Safe default: Account-only binding — NO activation_nonce ─────────────
    // Same reasoning as linkGoogle above.
    // updateUser({ email }) sends a confirmation email via Supabase.
    // The anonymous user's UUID is preserved — no new auth.users row is created.
    const callbackNext = new URLSearchParams({
      identity_linked: "email",
      // activation_nonce intentionally omitted — Account-only path
    });
    const { error } = await supabase.auth.updateUser(
      { email: emailForBinding.trim() },
      {
        emailRedirectTo:
          `${window.location.origin}/auth/callback?next=` +
          encodeURIComponent(`/${locale}/profile?${callbackNext.toString()}`),
      },
    );
    if (error) {
      setIdentityMsg(error.message);
    } else {
      setIdentityMsg(t("emailVerificationSent"));
    }
    setIdentityLoading(false);
  }

  const storedPhone = profile?.phone ?? "";
  const storedParsed = parseStoredPhone(profile?.phone);
  const phoneFields =
    phoneOverride && phoneOverride.stored === storedPhone
      ? phoneOverride
      : {
          stored: storedPhone,
          country: storedParsed.valid ? storedParsed.countryCode : DEFAULT_PHONE_COUNTRY,
          local: storedParsed.valid ? storedParsed.nationalDisplay : "",
        };
  const phoneCountry = phoneFields.country;
  const phoneLocal = phoneFields.local;

  async function persistProfile(patch: Partial<ExtendedProfile> = {}) {
    if (!profile) return;
    const next: ExtendedProfile = { ...profile, ...patch };
    const supabase = createClient();
    const { data } = await supabase.rpc("update_my_profile", {
      p_full_name: next.full_name,
      p_phone: next.phone,
      p_plate: next.plate,
      p_vehicle: next.vehicle,
      p_facebook: next.facebook,
      p_viber: next.viber,
    });
    const json = data as { ok?: boolean };
    if (json?.ok) {
      setProfile(next);
      setMessage(t("saved"));
    } else {
      setMessage(tErr("submit_failed"));
    }
  }

  async function savePhone() {
    if (!phoneLocal.trim()) {
      await persistProfile({ phone: "" });
      return;
    }
    const parsed = parseUserPhone({ countryCode: phoneCountry, nationalInput: phoneLocal });
    if (!parsed.valid) {
      setMessage(tErr("invalid_phone"));
      return;
    }
    await persistProfile({ phone: parsed.normalizedDigits });
  }

  async function saveName() {
    await persistProfile({ full_name: nameDraft.trim() });
    setEditingName(false);
  }

  const headerName = user ? resolveHeaderName(profile, user) : "";
  const avatarUrl = user && !avatarBroken ? resolveAvatarUrl(user) : null;
  const showPremiumBadge = profile?.is_premium === true;

  if (!hasSupabaseEnv()) {
    return <p className="text-sm">{tErr("missing_env")}</p>;
  }

  if (!authReady) {
    return (
      <p className="mx-auto mt-16 max-w-sm text-center text-sm text-zinc-500">
        {t("loadingAccount")}
      </p>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-sm px-1">
        <header className="mb-8 text-center">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-700 shadow-lg ring-1 ring-zinc-900/10"
          >
            <span className="text-2xl font-bold tracking-tight text-white">M</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{t("accessTitle")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">{t("welcome")}</p>
        </header>

        <button
          type="button"
          disabled={googleLoading}
          onClick={() => void signInWithGoogle()}
          className="group flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3.5 text-sm font-semibold text-zinc-800 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-zinc-50 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
        >
          <GoogleIcon />
          <span>{googleLoading ? t("googleLoading") : t("continueWithGoogle")}</span>
        </button>

        <div className="relative my-6">
          <div aria-hidden="true" className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-200" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-zinc-50 px-3 text-xs font-medium uppercase tracking-wide text-zinc-400">
              {t("continueWithEmail")}
            </span>
          </div>
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void signIn("in");
          }}
        >
          <label className="block text-sm">
            {t("email")}
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            {t("password")}
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {message ? <p className="text-sm text-red-600">{message}</p> : null}
          <div className="flex gap-2 pt-1">
            <button
              className="flex-1 rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 active:bg-zinc-950"
              type="submit"
            >
              {t("signIn")}
            </button>
            <button
              className="flex-1 rounded-lg border border-zinc-300 bg-white py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:border-zinc-400 hover:bg-zinc-50"
              type="button"
              onClick={() => void signIn("up")}
            >
              {t("signUp")}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-12">
    {activatedCount > 0 ? (
      <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
        <p className="text-sm font-medium text-emerald-800">
          {t("identity.post_published_after_verification")}
        </p>
        {activatedPostId ? (
          <Link
            href={`/posts/${activatedPostId}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
          >
            {t("identity.view_post")} →
          </Link>
        ) : null}
      </div>
    ) : null}
    {identityMsg ? (
      <p className="mb-3 text-sm text-red-600">{identityMsg}</p>
    ) : null}

    <header className="mb-5">
      <p className="mb-3 text-sm font-medium text-zinc-500">{t("title")}</p>
      <div className="flex min-w-0 items-center gap-3">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full object-cover"
            onError={() => setAvatarBroken(true)}
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-700"
          >
            {initialsFromName(headerName)}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {headerName ? (
            <h1 className="truncate text-lg font-semibold text-zinc-900">{headerName}</h1>
          ) : null}
          {showPremiumBadge ? (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {t("premiumBadge")}
            </span>
          ) : null}
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            aria-label={t("editName")}
            onClick={() => {
              setNameDraft(profile?.full_name ?? headerName);
              setEditingName((open) => !open);
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12.3 4.2 15.8 7.7M3 17l3.4-.6L16 6.8a1.5 1.5 0 0 0 0-2.1L15.3 4a1.5 1.5 0 0 0-2.1 0L3.6 13.6 3 17Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      {editingName ? (
        <div className="mt-3 space-y-2">
          <label className="block text-sm text-zinc-800">
            {t("fullName")}
            <input
              className={fieldClass}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white"
            onClick={() => void saveName()}
          >
            {t("save")}
          </button>
        </div>
      ) : null}
    </header>

    <IdentitySection
      user={user}
      profile={profile}
      t={t}
      identityLoading={identityLoading}
      emailForBinding={emailForBinding}
      setEmailForBinding={setEmailForBinding}
      linkGoogle={linkGoogle}
      bindEmail={bindEmail}
    />

    {message ? (
      <p className="mt-3 text-sm text-zinc-700">{message}</p>
    ) : null}

    <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">{t("phoneCardTitle")}</h2>
      <p className="mt-1 text-sm leading-relaxed text-zinc-600">{t("phoneCardBody")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <PhoneCountryPicker
          value={phoneCountry}
          ariaLabel={t("phone")}
          onChange={(country: PhoneCountryCode) =>
            setPhoneOverride({
              stored: storedPhone,
              country,
              local: phoneLocal,
            })
          }
        />
        <input
          className="h-11 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-base focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
          value={phoneLocal}
          inputMode="tel"
          autoComplete="tel"
          onChange={(e) =>
            setPhoneOverride({
              stored: storedPhone,
              country: phoneCountry,
              local: e.target.value,
            })
          }
        />
        <button
          type="button"
          className="h-11 w-full rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white sm:w-auto"
          onClick={() => void savePhone()}
        >
          {t("save")}
        </button>
      </div>
    </section>

    <div className="mt-4 space-y-2">
      <SettingRow label={t("vehicleSection")}>
        <label className="block text-sm text-zinc-800">
          {t("plate")}
          <input
            className={fieldClass}
            value={profile?.plate ?? ""}
            onChange={(e) =>
              setProfile((p) => (p ? { ...p, plate: e.target.value } : p))
            }
          />
        </label>
        <label className="block text-sm text-zinc-800">
          {t("vehicle")}
          <input
            className={fieldClass}
            value={profile?.vehicle ?? ""}
            onChange={(e) =>
              setProfile((p) => (p ? { ...p, vehicle: e.target.value } : p))
            }
          />
        </label>
        <button
          type="button"
          className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white"
          onClick={() => void persistProfile()}
        >
          {t("save")}
        </button>
      </SettingRow>

      <SettingRow label={t("otherContactsSection")}>
        <label className="block text-sm text-zinc-800">
          {t("facebook")}
          <input
            className={fieldClass}
            value={profile?.facebook ?? ""}
            onChange={(e) =>
              setProfile((p) => (p ? { ...p, facebook: e.target.value } : p))
            }
          />
        </label>
        <label className="block text-sm text-zinc-800">
          {t("viber")}
          <input
            className={fieldClass}
            value={profile?.viber ?? ""}
            onChange={(e) =>
              setProfile((p) => (p ? { ...p, viber: e.target.value } : p))
            }
          />
        </label>
        <button
          type="button"
          className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white"
          onClick={() => void persistProfile()}
        >
          {t("save")}
        </button>
      </SettingRow>

      <SettingRow
        label={t("bankVerification")}
        trailing={
          <span className={profile?.is_bank_verified ? "text-sm font-normal text-emerald-700" : "text-sm font-normal text-zinc-500"}>
            {profile?.is_bank_verified ? t("bankStatusVerified") : t("bankStatusUnverified")}
          </span>
        }
      >
        <p className="text-sm font-medium text-zinc-900">{t("bankVerifyTitle")}</p>
        <p className="text-sm leading-relaxed text-zinc-600">{t("bankVerifyHint")}</p>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">{t("recipient")}</dt>
            <dd className="font-medium">{config?.bank_recipient ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">{t("accountNumber")}</dt>
            <dd className="break-all font-mono text-xs">{config?.bank_account ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">{t("bankReference")}</dt>
            <dd className="font-mono text-lg font-bold tracking-widest text-zinc-900">{bankRef}</dd>
          </div>
        </dl>
      </SettingRow>
    </div>

    <div className="mt-10 text-center">
      <button
        type="button"
        className="text-sm text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
        onClick={async () => {
          await createClient().auth.signOut();
          setUser(null);
          setProfile(null);
        }}
      >
        {t("signOut")}
      </button>
    </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IdentitySection — sign-in / keep-account card at the top of the logged-in Account page.
// Handles linkIdentity (Google) and updateUser (Email) for anonymous accounts
// ---------------------------------------------------------------------------

type TFn = ReturnType<typeof useTranslations>;

interface IdentitySectionProps {
  user: User;
  profile: (Profile & { has_passkey?: boolean; is_bank_verified?: boolean; bank_reference_code?: string | null }) | null;
  t: TFn;
  identityLoading: boolean;
  emailForBinding: string;
  setEmailForBinding: (v: string) => void;
  linkGoogle: () => Promise<void>;
  bindEmail: () => Promise<void>;
}

function IdentitySection({
  user,
  profile,
  t,
  identityLoading,
  emailForBinding,
  setEmailForBinding,
  linkGoogle,
  bindEmail,
}: IdentitySectionProps) {
  const identity = resolveAccountIdentityState(user, profile);
  const {
    hasGoogle,
    googleIdentityEmail,
    hasVerifiedEmail,
    verifiedAccountEmail,
    emailsMatch,
    hasPasskey,
  } = identity;
  const needsRecovery = !hasGoogle && !hasVerifiedEmail;
  const needsGoogle = !hasGoogle;
  const needsEmail = !hasVerifiedEmail;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
      {hasPasskey ? (
        <p className="text-sm font-medium text-emerald-700">{t("deviceVerified")}</p>
      ) : null}
      {needsRecovery ? (
        <div className="space-y-1">
          <p className="text-sm font-semibold text-zinc-900">{t("recoveryTitle")}</p>
          <p className="text-sm leading-relaxed text-zinc-600">{t("recoveryBody")}</p>
        </div>
      ) : null}

      {hasGoogle ? (
        <div className="space-y-1 rounded-lg bg-emerald-50 px-3 py-2.5">
          <p className="text-sm font-medium text-emerald-800">{t("googleBound")}</p>
          {googleIdentityEmail ? (
            <p className="text-xs text-emerald-700">{googleIdentityEmail}</p>
          ) : null}
          {emailsMatch ? (
            <p className="text-sm font-medium text-emerald-800">{t("emailVerified")}</p>
          ) : null}
        </div>
      ) : null}

      {hasVerifiedEmail && !emailsMatch ? (
        <div className="space-y-1 rounded-lg bg-emerald-50 px-3 py-2.5">
          <p className="text-sm font-medium text-emerald-800">{t("emailVerified")}</p>
          {verifiedAccountEmail ? (
            <p className="text-xs text-emerald-700">{verifiedAccountEmail}</p>
          ) : null}
        </div>
      ) : null}

      {needsRecovery ? (
        <div className="space-y-3">
          {needsGoogle ? (
            <button
              type="button"
              disabled={identityLoading}
              onClick={() => void linkGoogle()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50"
            >
              {identityLoading ? t("linkingGoogle") : t("bindGoogle")}
            </button>
          ) : null}
          {needsGoogle && needsEmail ? (
            <div className="relative py-1">
              <div aria-hidden="true" className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-xs font-medium text-zinc-400">
                  {t("orOtherEmail")}
                </span>
              </div>
            </div>
          ) : null}
          {needsEmail ? (
            <div className="space-y-2">
              <input
                type="email"
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-400 focus:outline-none"
                placeholder={t("bindEmail")}
                value={emailForBinding}
                onChange={(e) => setEmailForBinding(e.target.value)}
              />
              <button
                type="button"
                disabled={identityLoading || !emailForBinding.trim()}
                onClick={() => void bindEmail()}
                className="w-full rounded-xl bg-emerald-700 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:opacity-50"
              >
                {t("sendVerification")}
              </button>
            </div>
          ) : null}
        </div>
      ) : needsGoogle || needsEmail ? (
        <div className="space-y-2 border-t border-zinc-100 pt-3">
          {needsGoogle ? (
            <button
              type="button"
              disabled={identityLoading}
              onClick={() => void linkGoogle()}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
            >
              {identityLoading ? t("linkingGoogle") : t("bindGoogle")}
            </button>
          ) : null}
          {needsEmail ? (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">{t("orOtherEmail")}</p>
              <input
                type="email"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                placeholder={t("bindEmail")}
                value={emailForBinding}
                onChange={(e) => setEmailForBinding(e.target.value)}
              />
              <button
                type="button"
                disabled={identityLoading || !emailForBinding.trim()}
                onClick={() => void bindEmail()}
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                {t("sendVerification")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
