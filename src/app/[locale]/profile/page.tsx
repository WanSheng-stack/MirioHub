"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
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

export default function ProfilePage() {
  const t = useTranslations("profile");
  const tApp = useTranslations("app");
  const locale = useLocale();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (!hasSupabaseEnv()) return;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) void loadProfile(data.user.id);
    });
  }, []);

  async function loadProfile(id: string) {
    const supabase = createClient();
    const { data } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
    setProfile(data as Profile | null);
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
    setMessage(json?.ok ? t("saved") : "error");
  }

  if (!hasSupabaseEnv()) {
    return <p className="text-sm">缺少 Supabase 环境变量。</p>;
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
    <form className="space-y-3" onSubmit={(e) => void save(e)}>
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
  );
}
