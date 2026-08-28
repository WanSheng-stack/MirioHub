"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";

const REASON_KEYS = [
  "autoMelt.reason.frontDesk",
  "autoMelt.reason.meeting",
  "autoMelt.reason.refused",
  "autoMelt.reason.other",
] as const;

type Props = {
  postId: string;
  onSubmitted?: () => void;
};

export function AutoMeltDialog({ postId, onSubmitted }: Props) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [reasonKey, setReasonKey] = useState<string>(REASON_KEYS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    const supabase = createClient();
    const { data } = await supabase.rpc("submit_auto_melt", {
      p_post_id: postId,
      p_completion_note: note,
      p_reason_key: reasonKey,
    });
    setBusy(false);
    const json = data as { ok?: boolean };
    if (json?.ok) {
      setDone(true);
      setOpen(false);
      onSubmitted?.();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border-2 border-amber-500 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900"
      >
        {t("ui.request_auto_melt")}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold">{t("autoMelt.title")}</h3>
            <fieldset className="mt-4 space-y-2">
              {REASON_KEYS.map((key) => (
                <label key={key} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="auto_melt_reason"
                    checked={reasonKey === key}
                    onChange={() => setReasonKey(key)}
                  />
                  {t(key)}
                </label>
              ))}
            </fieldset>
            <label className="mt-3 block text-sm">
              {t("autoMelt.note")}
              <textarea
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg bg-zinc-900 py-2 text-sm text-white disabled:opacity-60"
                disabled={busy}
                onClick={() => void submit()}
              >
                {t("autoMelt.submit")}
              </button>
              <button
                type="button"
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm"
                onClick={() => setOpen(false)}
              >
                {t("autoMelt.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {done ? (
        <p className="mt-2 text-sm text-amber-800">{t("autoMelt.countdownHint")}</p>
      ) : null}
    </>
  );
}
