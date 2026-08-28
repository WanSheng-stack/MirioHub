"use client";

import { useTranslations } from "next-intl";
import type { PostFormController } from "@/lib/post-form/usePostFormState";
import type { PostCategory, PostType } from "@/lib/post-payload";
import { POST_CATEGORIES } from "@/lib/post-payload";

const tabClass = (active: boolean) =>
  `flex-1 py-2.5 text-center text-sm font-medium transition-colors ${
    active
      ? "border-b-2 border-zinc-900 text-zinc-900"
      : "border-b border-zinc-200 text-zinc-500 hover:text-zinc-700"
  }`;

type Props = { form: PostFormController };

export function PostTypeTabs({ form }: Props) {
  const t = useTranslations();
  const { state, setPostType } = form;

  return (
    <div className="flex border-b border-zinc-200">
      <button
        type="button"
        className={tabClass(state.post_type === "demand")}
        onClick={() => setPostType("demand")}
      >
        {t("ui.need_help")}
      </button>
      <button
        type="button"
        className={tabClass(state.post_type === "provider")}
        onClick={() => setPostType("provider")}
      >
        {t("ui.passing_by")}
      </button>
    </div>
  );
}

export function CategorySelect({ form }: Props) {
  const t = useTranslations();
  const { state, setCategory } = form;
  const postType = state.post_type as PostType;

  return (
    <label className="block text-sm">
      {t("publish.category")}
      <select
        className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base"
        value={state.category}
        onChange={(e) => setCategory(e.target.value as PostCategory)}
        required
      >
        {POST_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {t(`category.${postType}.${c}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
