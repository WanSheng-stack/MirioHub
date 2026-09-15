"use client";

import { useTranslations } from "next-intl";
import type { PostFormController } from "@/lib/post-form/usePostFormState";
import {
  DELIVER_SERVICE_SUBTYPES,
  TRAVEL_SERVICE_SUBTYPES,
  type ServiceSubtype,
} from "@/lib/post-payload";

type Props = { form: PostFormController };

export function ServiceSubtypeFields({ form }: Props) {
  const t = useTranslations();
  const { state, setServiceSubtype, visibility } = form;

  if (!visibility.showServiceSubtype) return null;

  const options: readonly ServiceSubtype[] =
    state.category === "travel"
      ? TRAVEL_SERVICE_SUBTYPES
      : state.category === "deliver"
        ? DELIVER_SERVICE_SUBTYPES
        : [];

  if (options.length === 0) return null;

  const role = state.post_type === "demand" ? "demand" : "provider";

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-zinc-800">
        {t("home.sheet.service_subtype_legend")}
      </legend>
      <p className="text-xs text-zinc-500">
        {t("home.sheet.service_subtype_hint")}
      </p>
      <div className="grid gap-2">
        {options.map((subtype) => {
          const selected = state.service_subtype === subtype;
          return (
            <label
              key={subtype}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 ${
                selected
                  ? "border-emerald-600 bg-emerald-50/70"
                  : "border-zinc-200 bg-white"
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                  selected ? "border-emerald-600" : "border-zinc-300"
                }`}
                aria-hidden
              >
                {selected ? (
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                ) : null}
              </span>
              <input
                type="radio"
                className="sr-only"
                name="service_subtype"
                checked={selected}
                onChange={() => setServiceSubtype(subtype)}
              />
              <span className="min-w-0">
                <span
                  className={`block text-sm leading-snug ${
                    selected ? "font-medium text-zinc-900" : "text-zinc-700"
                  }`}
                >
                  {t(`home.sheet.subtype.${role}.${subtype}` as never)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
