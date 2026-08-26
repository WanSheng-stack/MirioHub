"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import type { OrderRole } from "@/lib/roles";
import type { AppLocale } from "@/i18n/routing";

export default function PublishPage() {
  const t = useTranslations("publish");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const [role, setRole] = useState<OrderRole>("DEMAND");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!hasSupabaseEnv()) {
      setError("missing env");
      return;
    }
    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      router.push("/profile");
      return;
    }
    const { error: insertError } = await supabase.from("orders").insert({
      author_id: auth.user.id,
      role,
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      task_notes: String(form.get("task_notes") ?? ""),
      from_city: String(form.get("from_city") ?? ""),
      to_city: String(form.get("to_city") ?? ""),
      source_locale: locale,
    });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    router.push("/");
  }

  return (
    <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">{t("role")}</legend>
        <label className="mr-4">
          <input
            type="radio"
            name="role"
            checked={role === "DEMAND"}
            onChange={() => setRole("DEMAND")}
          />{" "}
          {t("demand")}
        </label>
        <label>
          <input
            type="radio"
            name="role"
            checked={role === "PROVIDER"}
            onChange={() => setRole("PROVIDER")}
          />{" "}
          {t("provider")}
        </label>
      </fieldset>
      <label className="block text-sm">
        {t("heading")}
        <input name="title" required className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2" />
      </label>
      <label className="block text-sm">
        {t("description")}
        <textarea name="description" rows={4} className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2" />
      </label>
      <label className="block text-sm">
        {t("taskNotes")}
        <textarea name="task_notes" rows={3} className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2" />
      </label>
      <label className="block text-sm">
        {t("fromCity")}
        <input name="from_city" required className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2" />
      </label>
      <label className="block text-sm">
        {t("toCity")}
        <input name="to_city" required className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2" />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white" type="submit">
        {t("submit")}
      </button>
    </form>
  );
}
