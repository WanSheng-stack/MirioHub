import { parseUserPhone } from "@/lib/phone/phoneNumber";

export type PhoneValidationResult =
  | { ok: true; normalized: string; countryDigits: string; localDigits: string }
  | { ok: false; errorKey: "error.invalid_phone" };

export type PlateValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; errorKey: "error.invalid_plate" };

/** Canonical phone via libphonenumber-js. countryCode is ISO 3166-1 alpha-2. */
export function normalizePhone(countryCode: string, nationalInput: string): PhoneValidationResult {
  const parsed = parseUserPhone({ countryCode, nationalInput });
  if (!parsed.valid) return { ok: false, errorKey: parsed.errorKey };
  return {
    ok: true,
    normalized: parsed.normalizedDigits,
    countryDigits: parsed.callingCode,
    localDigits: parsed.nationalNumber,
  };
}

/** Display/raw phone for posts.raw_phone — national format from the shared helper. */
export function buildRawPhone(countryCode: string, nationalInput: string): string {
  const parsed = parseUserPhone({ countryCode, nationalInput });
  if (parsed.valid) return parsed.nationalDisplay;
  return nationalInput.trim();
}

/** Plate: remove spaces/special chars, uppercase */
export function normalizeLicensePlate(raw: string): PlateValidationResult {
  const normalized = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (normalized.length < 3) {
    return { ok: false, errorKey: "error.invalid_plate" };
  }
  return { ok: true, normalized };
}
