"use client";

import { useEffect } from "react";
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
  savedLabel: string;
  unverifiedLabel: string;
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
  savedLabel,
  unverifiedLabel,
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

  if (!ui.showSavedFlash && !ui.showUnverifiedBadge) return null;

  return (
    <div className={`mt-2 space-y-1.5 ${className}`.trim()}>
      {ui.showSavedFlash ? (
        <p className="text-sm font-medium text-emerald-700" role="status">
          {savedLabel}
        </p>
      ) : null}
      {ui.showUnverifiedBadge && ui.formattedDisplay ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-800">
          <span className="font-medium tabular-nums">{ui.formattedDisplay}</span>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-200/80">
            {unverifiedLabel}
          </span>
        </p>
      ) : null}
    </div>
  );
}
