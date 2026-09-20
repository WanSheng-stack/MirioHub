"use client";

import { useEffect, type ReactNode } from "react";
import {
  PHONE_SAVED_FLASH_MS,
  derivePhoneStatusUi,
} from "@/lib/profile/phoneStatusUi";

type Props = {
  /** Server-persisted normalized phone (profile.phone / post-save). Empty = none. */
  persistedNormalizedPhone: string | null | undefined;
  /** True only right after a successful server save; auto-clears. */
  savedFlashActive: boolean;
  onSavedFlashEnd: () => void;
  unverifiedLabel: string;
  usageDescription: string;
  title: string;
  editing: boolean;
  editor: ReactNode;
  saving: boolean;
  canSave: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  addLabel: string;
  editLabel: string;
  saveLabel: string;
  cancelLabel: string;
  error?: ReactNode;
  className?: string;
};

/**
 * Shared Account + publish-success phone status:
 * transient "saved" flash + persistent formatted number + Not verified.
 * No Verify button (verification authority does not exist yet).
 */
export function PhonePersistedStatus({
  persistedNormalizedPhone,
  savedFlashActive,
  onSavedFlashEnd,
  unverifiedLabel,
  usageDescription,
  title,
  editing,
  editor,
  saving,
  canSave,
  onEdit,
  onSave,
  onCancel,
  addLabel,
  editLabel,
  saveLabel,
  cancelLabel,
  error,
  className = "",
}: Props) {
  const ui = derivePhoneStatusUi({
    persistedNormalizedPhone,
    savedFlashActive,
  });

  useEffect(() => {
    if (!savedFlashActive) return;
    const id = window.setTimeout(() => {
      onSavedFlashEnd();
    }, PHONE_SAVED_FLASH_MS);
    return () => window.clearTimeout(id);
  }, [savedFlashActive, onSavedFlashEnd]);

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      {editing ? (
        <fieldset className="min-h-14 rounded-xl border border-zinc-300 px-3 pb-3 pt-1.5">
          {ui.showUnverifiedBadge ? (
            <legend className="rounded-md bg-amber-50 px-2 text-xs font-semibold text-amber-900">
              {unverifiedLabel}
            </legend>
          ) : null}
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap gap-2">{editor}</div>
            <button
              type="button"
              aria-label={saveLabel}
              title={saveLabel}
              disabled={saving || !canSave}
              onClick={onSave}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-700 text-base font-bold text-white disabled:opacity-40"
            >
              ✓
            </button>
            <button
              type="button"
              aria-label={cancelLabel}
              title={cancelLabel}
              disabled={saving}
              onClick={onCancel}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl text-zinc-500 hover:bg-zinc-100 disabled:opacity-40"
            >
              ×
            </button>
          </div>
        </fieldset>
      ) : ui.showUnverifiedBadge && ui.formattedDisplay ? (
        <fieldset className="min-h-14 rounded-xl border border-zinc-300 px-3 pb-3 pt-1.5">
          <legend className="rounded-md bg-amber-50 px-2 text-xs font-semibold text-amber-900">
            {unverifiedLabel}
          </legend>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium tabular-nums text-zinc-900">
              {ui.formattedDisplay}
            </span>
            <button
              type="button"
              aria-label={editLabel}
              title={editLabel}
              onClick={onEdit}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl text-zinc-600 hover:bg-zinc-100"
            >
              ✎
            </button>
          </div>
        </fieldset>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          className="flex min-h-14 w-full items-center justify-between rounded-xl border border-zinc-300 px-3 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <span>{addLabel}</span>
          <span aria-hidden="true" className="text-xl">＋</span>
        </button>
      )}
      {error}
      <p className="text-xs leading-relaxed text-zinc-600">{usageDescription}</p>
    </div>
  );
}
