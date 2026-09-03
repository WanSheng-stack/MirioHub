"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
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
  const tApp = useTranslations("app");
  const tErr = useTranslations("error");
  const locale = useLocale();
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

  const bankRef = useMemo(
    () => profile?.bank_reference_code ?? (user ? bankRefFromUuid(user.id) : "------"),
    [profile?.bank_reference_code, user],
  );

  useEffect(() => {
    if (!hasSupabaseEnv()) return;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) void loadProfile(data.user.id);
    });
    void supabase
      .from("system_configs")
      .select("*")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => setConfig(data as SystemConfig | null));

    // ── Handle auth callback URL params ──────────────────────────────────────
    // After Google linking or email verification, the callback redirects back
    // with ?error=account_identity_continuity_broken  or  ?identity_linked=...
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const cbError = params.get("error");
      const linked = params.get("identity_linked");

      if (cbError === "account_identity_continuity_broken") {
        setIdentityMsg(tErr("account_identity_continuity_broken"));
      } else if (linked) {
        // Identity was just linked.
        // Only activate a post if there is an EXPLICIT target stored in
        // sessionStorage (written by PublishBottomSheet on Channel B).
        // If the user linked Google/Email independently (Account page, no
        // draft context) there will be no key — and we do NOT activate anything.
        const activationPostId = sessionStorage.getItem(
          "mirio_identity_activation_post_id",
        );
        if (activationPostId) {
          void (async () => {
            try {
              const res = await fetch("/api/posts/activate-after-identity", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ postId: activationPostId }),
              });
              const json = (await res.json()) as {
                ok: boolean;
                postId?: string;
                isActive?: boolean;
                alreadyActive?: boolean;
              };
              if (json.ok && json.isActive && !json.alreadyActive) {
                setActivatedCount(1);
              }
            } catch {
              // Activation failure is non-fatal — draft is still safe
            } finally {
              // Always clear the target — whether activation succeeded or not.
              // On failure the user can retry through another flow.
              sessionStorage.removeItem("mirio_identity_activation_post_id");
            }
          })();
        }
        // No activationPostId → Account-only linking → zero drafts activated (correct).
      }

      // Clean up URL params to avoid re-triggering on reload
      if (cbError ?? linked) {
        const clean = new URL(window.location.href);
        clean.searchParams.delete("error");
        clean.searchParams.delete("identity_linked");
        window.history.replaceState({}, "", clean.toString());
      }
    }
  }, [tErr]);

  async function loadProfile(id: string) {
    const supabase = createClient();
    const { data } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
    setProfile(data as ExtendedProfile | null);
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
    // linkIdentity preserves the current auth.users UUID-A.
    // Must NOT use signInWithOAuth here — that may create a new UUID-B.
    const callbackNext = encodeURIComponent(`/${locale}/profile?identity_linked=google`);
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${callbackNext}`,
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
    // updateUser({ email }) sends a confirmation email.
    // The anonymous user's UUID is preserved — no new auth.users row is created.
    const callbackNext = encodeURIComponent(`/${locale}/profile?identity_linked=email`);
    const { error } = await supabase.auth.updateUser(
      { email: emailForBinding.trim() },
      { emailRedirectTo: `${window.location.origin}/auth/callback?next=${callbackNext}` },
    );
    if (error) {
      setIdentityMsg(error.message);
    } else {
      setIdentityMsg(t("emailVerificationSent"));
    }
    setIdentityLoading(false);
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile) return;
    const supabase = createClient();
    const { data } = await supabase.rpc("update_my_profile", {
      p_full_name: profile.full_name,
      p_phone: profile.phone,
      p_plate: profile.plate,
      p_vehicle: profile.vehicle,
      p_facebook: profile.facebook,
      p_viber: profile.viber,
    });
    const json = data as { ok?: boolean };
    setMessage(json?.ok ? t("saved") : tErr("submit_failed"));
  }

  if (!hasSupabaseEnv()) {
    return <p className="text-sm">{tErr("missing_env")}</p>;
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
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{tApp("name")}</h1>
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
              {t("orDivider")}
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
    <>
    <form className="mx-auto max-w-lg space-y-4" onSubmit={(e) => void save(e)}>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <button
          type="button"
          className="text-sm text-zinc-500"
          onClick={async () => {
            await createClient().auth.signOut();
            setUser(null);
            setProfile(null);
          }}
        >
          {t("signOut")}
        </button>
      </div>
      <p className="text-sm text-zinc-600">
        {t("quota")}: {profile?.free_views_left ?? "—"} · {t("premium")}:{" "}
        {profile?.is_premium ? "✓" : "—"}
      </p>

      <section className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4">
        <h2 className="text-sm font-semibold">{t("bankVerifyTitle")}</h2>
        <p className="mt-1 text-xs text-zinc-600">{t("bankVerifyHint")}</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">{t("recipient")}</dt>
            <dd className="font-medium">{config?.bank_recipient ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">{t("accountNumber")}</dt>
            <dd className="font-mono text-xs">{config?.bank_account ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">{t("bankReference")}</dt>
            <dd className="font-mono text-lg font-bold tracking-widest text-zinc-900">{bankRef}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">{t("bankVerified")}</dt>
            <dd className={profile?.is_bank_verified ? "text-emerald-700" : "text-amber-700"}>
              {profile?.is_bank_verified ? t("bankVerified") : t("bankNotVerified")}
            </dd>
          </div>
        </dl>
      </section>

      {(
        [
          ["full_name", t("fullName")],
          ["phone", t("phone")],
          ["plate", t("plate")],
          ["vehicle", t("vehicle")],
          ["facebook", t("facebook")],
          ["viber", t("viber")],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="block text-sm">
          {label}
          <input
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2"
            value={profile?.[key] ?? ""}
            onChange={(e) =>
              setProfile((p) => (p ? { ...p, [key]: e.target.value } : p))
            }
          />
        </label>
      ))}
      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      <button className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white" type="submit">
        {t("save")}
      </button>
    </form>
    <IdentitySection
      user={user}
      profile={profile}
      locale={locale}
      t={t}
      tErr={tErr}
      identityMsg={identityMsg}
      setIdentityMsg={setIdentityMsg}
      identityLoading={identityLoading}
      setIdentityLoading={setIdentityLoading}
      emailForBinding={emailForBinding}
      setEmailForBinding={setEmailForBinding}
      activatedCount={activatedCount}
      linkGoogle={linkGoogle}
      bindEmail={bindEmail}
    />
    </>
  );
}

// ---------------------------------------------------------------------------
// IdentitySection — shown below the profile form for logged-in users
// Handles linkIdentity (Google) and updateUser (Email) for anonymous accounts
// ---------------------------------------------------------------------------

type TFn = ReturnType<typeof useTranslations>;

interface IdentitySectionProps {
  user: User;
  profile: (Profile & { has_passkey?: boolean; is_bank_verified?: boolean; bank_reference_code?: string | null }) | null;
  locale: string;
  t: TFn;
  tErr: TFn;
  identityMsg: string | null;
  setIdentityMsg: (v: string | null) => void;
  identityLoading: boolean;
  setIdentityLoading: (v: boolean) => void;
  emailForBinding: string;
  setEmailForBinding: (v: string) => void;
  activatedCount: number;
  linkGoogle: () => Promise<void>;
  bindEmail: () => Promise<void>;
}

function IdentitySection({
  user,
  profile,
  locale: _locale,
  t,
  tErr: _tErr,
  identityMsg,
  setIdentityMsg: _setIdentityMsg,
  identityLoading,
  setIdentityLoading: _setIdentityLoading,
  emailForBinding,
  setEmailForBinding,
  activatedCount,
  linkGoogle,
  bindEmail,
}: IdentitySectionProps) {
  const hasPasskey = Boolean(profile?.has_passkey);
  const hasGoogle = user.identities?.some((i) => i.provider === "google") ?? false;
  const hasVerifiedEmail = Boolean(user.email_confirmed_at);
  const isAnonymous = user.is_anonymous === true;

  // If the user already has all identities or is not anonymous, show minimal status
  if (!isAnonymous && !hasPasskey) return null; // non-anonymous without passkey — signed-in via Google or email directly
  if (hasPasskey && hasGoogle && hasVerifiedEmail) return null; // fully verified

  return (
    <section className="mx-auto mt-4 max-w-lg rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-emerald-900">{t("identityTitle")}</h2>
      <p className="text-xs text-emerald-700">{t("identityHint")}</p>

      {/* Activation success banner */}
      {activatedCount > 0 && (
        <p className="rounded-lg bg-emerald-100 px-3 py-2 text-xs font-medium text-emerald-800">
          {t("draftActivatedCount", { count: activatedCount })}
        </p>
      )}

      {/* Identity message (error or confirmation) */}
      {identityMsg && (
        <p className="text-xs text-red-600">{identityMsg}</p>
      )}

      {/* ── Google status / link button ──────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-700">Google</span>
        {hasGoogle ? (
          <span className="text-sm font-medium text-emerald-700">{t("googleLinked")}</span>
        ) : (
          <button
            type="button"
            disabled={identityLoading}
            onClick={() => void linkGoogle()}
            className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50"
          >
            {identityLoading ? t("linkingGoogle") : t("linkGoogle")}
          </button>
        )}
      </div>

      {/* ── Email status / bind form ─────────────────────────────────────── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-zinc-700">{t("emailBindingLabel")}</span>
          {hasVerifiedEmail && (
            <span className="text-sm font-medium text-emerald-700">{t("emailVerified")}</span>
          )}
        </div>
        {!hasVerifiedEmail && (
          <div className="flex gap-2">
            <input
              type="email"
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
              placeholder={t("bindEmail")}
              value={emailForBinding}
              onChange={(e) => setEmailForBinding(e.target.value)}
            />
            <button
              type="button"
              disabled={identityLoading || !emailForBinding.trim()}
              onClick={() => void bindEmail()}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-800 disabled:opacity-50"
            >
              {t("sendVerification")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
