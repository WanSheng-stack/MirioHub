/**
 * Phone save status UI semantics (Account + publish success).
 * No verification authority yet — every server-persisted number is unverified.
 */

import { parseStoredPhone } from "@/lib/phone/phoneNumber";

/** Transient "Phone number saved" toast duration (ms). */
export const PHONE_SAVED_FLASH_MS = 2500;

/** True only when a non-empty phone was saved server-side (or re-loaded from profile). */
export function hasServerPersistedPhone(
  normalizedPhone: string | null | undefined,
): boolean {
  return typeof normalizedPhone === "string" && normalizedPhone.trim().length > 0;
}

/** Format a server-persisted normalized phone for display. */
export function formatPersistedPhoneDisplay(
  normalizedPhone: string | null | undefined,
): string | null {
  if (!hasServerPersistedPhone(normalizedPhone)) return null;
  const raw = String(normalizedPhone).trim();
  const parsed = parseStoredPhone(raw);
  if (parsed.valid) return parsed.e164;
  return raw.startsWith("+") ? raw : `+${raw.replace(/\D/g, "")}`;
}

/**
 * Derive visible phone status flags.
 * - saved flash is transient and only meaningful after a successful save.
 * - unverified badge is persistent and requires a server-persisted number.
 * - client format validation alone never yields unverified.
 * - persisted ≠ verified (there is no verification authority).
 */
export function derivePhoneStatusUi(input: {
  persistedNormalizedPhone: string | null | undefined;
  savedFlashActive: boolean;
}): {
  hasPersistedPhone: boolean;
  showSavedFlash: boolean;
  showUnverifiedBadge: boolean;
  formattedDisplay: string | null;
  /** Always false until a real phone verification authority exists. */
  isVerified: false;
} {
  const hasPersistedPhone = hasServerPersistedPhone(
    input.persistedNormalizedPhone,
  );
  const formattedDisplay = formatPersistedPhoneDisplay(
    input.persistedNormalizedPhone,
  );
  return {
    hasPersistedPhone,
    showSavedFlash: input.savedFlashActive === true && hasPersistedPhone,
    showUnverifiedBadge: hasPersistedPhone,
    formattedDisplay,
    isVerified: false,
  };
}

/**
 * Pure outcome after a dedicated phone save attempt (no timers).
 * Format-only success paths must not call this with ok:true.
 */
export function phoneStatusAfterSaveAttempt(input: {
  ok: boolean;
  normalizedPhone?: string | null;
  previousPersistedPhone?: string | null;
}): {
  persistedNormalizedPhone: string | null;
  savedFlashActive: boolean;
  showUnverifiedBadge: boolean;
} {
  if (!input.ok) {
    const previous = input.previousPersistedPhone ?? null;
    return {
      persistedNormalizedPhone: previous,
      savedFlashActive: false,
      showUnverifiedBadge: hasServerPersistedPhone(previous),
    };
  }
  const next =
    typeof input.normalizedPhone === "string" ? input.normalizedPhone : "";
  return {
    persistedNormalizedPhone: next,
    savedFlashActive: hasServerPersistedPhone(next),
    showUnverifiedBadge: hasServerPersistedPhone(next),
  };
}
