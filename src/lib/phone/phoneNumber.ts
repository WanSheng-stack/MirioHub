import {
  ParseError,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberWithError,
  type CountryCode,
  type NumberType,
} from "libphonenumber-js/max";

export type PhoneCountryCode = CountryCode;

export const DEFAULT_PHONE_COUNTRY: PhoneCountryCode = "RS";

export const PHONE_ERROR_KEY = "error.invalid_phone" as const;

export type PhoneParseSuccess = {
  valid: true;
  countryCode: PhoneCountryCode;
  callingCode: string;
  e164: string;
  normalizedDigits: string;
  nationalDisplay: string;
  nationalNumber: string;
};

export type PhoneParseFailure = {
  valid: false;
  errorKey: typeof PHONE_ERROR_KEY;
};

export type PhoneParseResult = PhoneParseSuccess | PhoneParseFailure;

export type PhoneCountryOption = {
  countryCode: PhoneCountryCode;
  callingCode: string;
  name: string;
  flag: string;
};

const PINNED_COUNTRIES: PhoneCountryCode[] = ["RS", "CN", "US", "KZ", "RU"];

const failure = (): PhoneParseFailure => ({
  valid: false,
  errorKey: PHONE_ERROR_KEY,
});

export function isPhoneCountryCode(value: string | null | undefined): value is PhoneCountryCode {
  const code = String(value ?? "").trim().toUpperCase();
  return (getCountries() as string[]).includes(code);
}

export function flagEmoji(countryCode: string): string {
  const cc = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((ch) => 127397 + ch.charCodeAt(0)));
}

export function callingCodeForCountry(countryCode: PhoneCountryCode): string {
  return String(getCountryCallingCode(countryCode));
}

function displayLocale(locale: string): string {
  const lower = locale.toLowerCase();
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("sr")) return "sr";
  return "en";
}

export function listPhoneCountries(locale: string): PhoneCountryOption[] {
  const display = new Intl.DisplayNames([displayLocale(locale)], { type: "region" });
  const items: PhoneCountryOption[] = [];
  for (const countryCode of getCountries()) {
    try {
      const callingCode = String(getCountryCallingCode(countryCode));
      items.push({
        countryCode,
        callingCode,
        name: display.of(countryCode) ?? countryCode,
        flag: flagEmoji(countryCode),
      });
    } catch {
      // Skip territories without a calling code in this metadata set.
    }
  }
  items.sort((a, b) => {
    const pinA = PINNED_COUNTRIES.indexOf(a.countryCode);
    const pinB = PINNED_COUNTRIES.indexOf(b.countryCode);
    if (pinA !== -1 || pinB !== -1) {
      if (pinA === -1) return 1;
      if (pinB === -1) return -1;
      return pinA - pinB;
    }
    return a.name.localeCompare(b.name, displayLocale(locale));
  });
  return items;
}

/** Unique ISO country for a calling code, or null when several countries share it. */
export function uniqueCountryForCallingCode(callingDigits: string): PhoneCountryCode | null {
  const digits = callingDigits.replace(/\D/g, "");
  if (!digits) return null;
  const matches: PhoneCountryCode[] = [];
  for (const countryCode of getCountries()) {
    try {
      if (String(getCountryCallingCode(countryCode)) === digits) {
        matches.push(countryCode);
      }
    } catch {
      // skip
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

export function resolvePhoneCountry(input: {
  phoneCountry?: string | null;
  dialCode?: string | null;
}): PhoneCountryCode | null {
  const explicit = String(input.phoneCountry ?? "").trim().toUpperCase();
  if (isPhoneCountryCode(explicit)) return explicit;
  const fromDial = uniqueCountryForCallingCode(String(input.dialCode ?? ""));
  return fromDial;
}

function toE164AndDigits(e164: string): { e164: string; normalizedDigits: string } {
  const withPlus = e164.startsWith("+") ? e164 : `+${e164}`;
  return { e164: withPlus, normalizedDigits: withPlus.replace(/^\+/, "") };
}

function looksInternational(raw: string): boolean {
  const compact = raw.trim().replace(/[\s()-]/g, "");
  return compact.startsWith("+") || compact.startsWith("00");
}

function prepareInput(raw: string): string {
  const trimmed = raw.trim();
  const compact = trimmed.replace(/[\s()-]/g, "");
  if (compact.startsWith("00") && compact.length > 2) {
    return `+${compact.slice(2)}`;
  }
  return trimmed;
}

const ACCEPTED_NUMBER_TYPES: ReadonlySet<NumberType> = new Set([
  "MOBILE",
  "FIXED_LINE_OR_MOBILE",
]);

function isAcceptedMobileType(type: NumberType | undefined): boolean {
  return type != null && ACCEPTED_NUMBER_TYPES.has(type);
}

function fromParsed(
  parsed: ReturnType<typeof parsePhoneNumberWithError>,
  selectedCountry: PhoneCountryCode,
): PhoneParseResult {
  if (!parsed.isPossible() || !parsed.isValid()) return failure();
  if (!isAcceptedMobileType(parsed.getType())) return failure();
  if (parsed.country && parsed.country !== selectedCountry) return failure();
  if (
    !parsed.country &&
    String(parsed.countryCallingCode) !== callingCodeForCountry(selectedCountry)
  ) {
    return failure();
  }
  const { e164, normalizedDigits } = toE164AndDigits(parsed.format("E.164"));
  return {
    valid: true,
    countryCode: selectedCountry,
    callingCode: String(parsed.countryCallingCode),
    e164,
    normalizedDigits,
    nationalDisplay: parsed.formatNational(),
    nationalNumber: String(parsed.nationalNumber),
  };
}

/**
 * Parse a user-typed national or full international number against a picker country.
 * Strict: does not extract a number from surrounding text.
 */
export function parseUserPhone(input: {
  countryCode: string;
  nationalInput: string;
}): PhoneParseResult {
  const country = String(input.countryCode ?? "").trim().toUpperCase();
  if (!isPhoneCountryCode(country)) return failure();
  const raw = String(input.nationalInput ?? "").trim();
  if (!raw) return failure();

  const text = prepareInput(raw);
  try {
    const parsed = parsePhoneNumberWithError(text, {
      defaultCountry: country,
      extract: false,
    });
    if (looksInternational(raw) && parsed.country && parsed.country !== country) {
      return failure();
    }
    return fromParsed(parsed, country);
  } catch (error) {
    if (error instanceof ParseError) return failure();
    return failure();
  }
}

export function validatePhone(input: {
  countryCode: string;
  nationalInput: string;
}): PhoneParseResult {
  return parseUserPhone(input);
}

/** Reconstruct picker + national display from profiles.phone / history digits. */
export function parseStoredPhone(stored: string | null | undefined): PhoneParseResult {
  const digits = String(stored ?? "").replace(/\D/g, "");
  if (!digits) return failure();
  try {
    const parsed = parsePhoneNumberWithError(`+${digits}`, { extract: false });
    if (!parsed.isPossible() || !parsed.isValid() || !parsed.country) return failure();
    if (!isAcceptedMobileType(parsed.getType())) return failure();
    const country = parsed.country;
    const { e164, normalizedDigits } = toE164AndDigits(parsed.format("E.164"));
    return {
      valid: true,
      countryCode: country,
      callingCode: String(parsed.countryCallingCode),
      e164,
      normalizedDigits,
      nationalDisplay: parsed.formatNational(),
      nationalNumber: String(parsed.nationalNumber),
    };
  } catch {
    return failure();
  }
}
