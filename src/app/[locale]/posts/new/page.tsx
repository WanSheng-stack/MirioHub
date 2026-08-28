"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { usePostFormState } from "@/lib/post-form/usePostFormState";
import { submitPost } from "@/lib/post-form/submitPost";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import { PostTypeTabs, CategorySelect } from "@/components/post-form/PostTypeTabs";
import { BaseFields } from "@/components/post-form/BaseFields";
import {
  DeliverTravelFields,
  FeeDisplay,
  LuggageCounters,
  ProviderAssetsFields,
} from "@/components/post-form/DeliverTravelFields";
import { BuyFields, OnsiteErrandFields } from "@/components/post-form/BuyOnsiteFields";

export default function NewPostPage() {
  const t = useTranslations();
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const form = usePostFormState();
  const { visibility } = form;
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);

    if (!hasSupabaseEnv()) {
      setErrorKey("error.missing_env");
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
    router.push(`/posts/${result.postId}`);
  }

  return (
    <div className="mx-auto max-w-lg pb-8">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">{t("publish.title")}</h1>

      <form className="space-y-6" onSubmit={(e) => void onSubmit(e)}>
        <PostTypeTabs form={form} />
        <CategorySelect form={form} />
        <BaseFields form={form} />

        {visibility.route ? (
          <>
            <DeliverTravelFields form={form} />
            {visibility.showLuggage ? <LuggageCounters form={form} /> : null}
            {visibility.showProviderAssets ? <ProviderAssetsFields form={form} /> : null}
            <FeeDisplay form={form} />
          </>
        ) : null}

        {visibility.buy ? <BuyFields form={form} /> : null}
        {visibility.local ? <OnsiteErrandFields form={form} /> : null}

        {errorKey ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {(t as (key: string) => string)(errorKey)}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-zinc-900 py-3 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? t("publish.submitting") : t("publish.submit")}
        </button>
      </form>
    </div>
  );
}
