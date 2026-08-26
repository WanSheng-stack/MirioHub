"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import type { User } from "@supabase/supabase-js";

export default function ProfilePage() {
  const t = useTranslations("profile");
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

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
      <form
        className="mx-auto max-w-sm space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void signIn("in");
        }}
      >
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <label className="block text-sm">
          {t("email")}
          <input
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          {t("password")}
          <input
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {message ? <p className="text-sm text-red-600">{message}</p> : null}
        <div className="flex gap-2">
          <button className="flex-1 rounded-md bg-zinc-900 py-2 text-sm text-white" type="submit">
            {t("signIn")}
          </button>
          <button
            className="flex-1 rounded-md border border-zinc-300 py-2 text-sm"
            type="button"
            onClick={() => void signIn("up")}
          >
            {t("signUp")}
          </button>
        </div>
      </form>
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
