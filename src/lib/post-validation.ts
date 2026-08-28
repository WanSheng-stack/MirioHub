export type PhoneValidationResult =
  | { ok: true; normalized: string; countryDigits: string; localDigits: string }
  | { ok: false; errorKey: "error.invalid_phone" };

export type PlateValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; errorKey: "error.invalid_plate" };

/** Extract country digits from dial code like +381 → 381 */
export function extractCountryDigits(dialCode: string): string {
  return dialCode.replace(/\D/g, "");
}

/** Normalize local phone: trim, remove spaces, strip leading 0 */
export function normalizeLocalPhone(local: string): string {
  const trimmed = local.replace(/\s+/g, "").trim();
  return trimmed.startsWith("0") ? trimmed.slice(1) : trimmed;
}

/** Full phone normalization: country + local, digits only, 9-14 length check */
export function normalizePhone(dialCode: string, localPhone: string): PhoneValidationResult {
  const countryDigits = extractCountryDigits(dialCode);
  const localDigits = normalizeLocalPhone(localPhone);
  const normalized = `${countryDigits}${localDigits}`.replace(/\s+/g, "");

  if (!/^\d+$/.test(normalized) || normalized.length < 9 || normalized.length > 14) {
    return { ok: false, errorKey: "error.invalid_phone" };
  }
  return { ok: true, normalized, countryDigits, localDigits };
}

/** Plate: remove spaces/special chars, uppercase */
export function normalizeLicensePlate(raw: string): PlateValidationResult {
  const normalized = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (normalized.length < 3) {
    return { ok: false, errorKey: "error.invalid_plate" };
  }
  return { ok: true, normalized };
}

/** Build raw_phone display form for storage */
export function buildRawPhone(dialCode: string, localPhone: string): string {
  return `${dialCode}${localPhone}`.replace(/\s+/g, " ").trim();
}
