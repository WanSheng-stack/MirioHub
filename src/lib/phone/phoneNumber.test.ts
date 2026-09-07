/**
 * PHASE 6.5B.6 — canonical phone helper (libphonenumber-js).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/phone/phoneNumber.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  callingCodeForCountry,
  listPhoneCountries,
  parseStoredPhone,
  parseUserPhone,
  uniqueCountryForCallingCode,
  validatePhone,
} from "@/lib/phone/phoneNumber";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

// TEST 1 — Serbia national with trunk 0
{
  const parsed = parseUserPhone({ countryCode: "RS", nationalInput: "0641234567" });
  assert.equal(parsed.valid, true);
  if (parsed.valid) {
    assert.equal(parsed.e164, "+381641234567");
    assert.equal(parsed.normalizedDigits, "381641234567");
    assert.equal(parsed.countryCode, "RS");
    assert.equal(parsed.callingCode, "381");
    assert.equal(parsed.nationalDisplay.startsWith("0"), true);
    assert.ok(digitsOf(parsed.nationalDisplay).includes("641234567"));
  }
}

// TEST 2 — Serbia without leading 0 (library decides)
{
  const withZero = parseUserPhone({ countryCode: "RS", nationalInput: "0641234567" });
  const withoutZero = parseUserPhone({ countryCode: "RS", nationalInput: "641234567" });
  if (withoutZero.valid && withZero.valid) {
    assert.equal(withoutZero.normalizedDigits, withZero.normalizedDigits);
  }
}

// TEST 3 — full international
{
  const parsed = parseUserPhone({ countryCode: "RS", nationalInput: "+381641234567" });
  assert.equal(parsed.valid, true);
  if (parsed.valid) {
    assert.equal(parsed.normalizedDigits, "381641234567");
  }
}

// TEST 4 — China mobile
{
  const parsed = parseUserPhone({ countryCode: "CN", nationalInput: "13800138000" });
  assert.equal(parsed.valid, true);
  if (parsed.valid) {
    assert.equal(parsed.e164, "+8613800138000");
    assert.equal(parsed.normalizedDigits, "8613800138000");
    assert.equal(parsed.countryCode, "CN");
  }
}

// TEST 5 — shared calling code +7
{
  assert.equal(callingCodeForCountry("RU"), "7");
  assert.equal(callingCodeForCountry("KZ"), "7");
  const ru = parseUserPhone({ countryCode: "RU", nationalInput: "9123456789" });
  const kz = parseUserPhone({ countryCode: "KZ", nationalInput: "7011234567" });
  assert.equal(ru.valid, true);
  assert.equal(kz.valid, true);
  if (ru.valid && kz.valid) {
    assert.equal(ru.countryCode, "RU");
    assert.equal(kz.countryCode, "KZ");
    assert.equal(ru.callingCode, kz.callingCode);
    assert.notEqual(ru.normalizedDigits, kz.normalizedDigits);
  }
  assert.equal(parseUserPhone({ countryCode: "RU", nationalInput: "7011234567" }).valid, false);
}

// TEST 6 — illegal numbers
{
  assert.equal(parseUserPhone({ countryCode: "RS", nationalInput: "06" }).valid, false);
  assert.equal(parseUserPhone({ countryCode: "CN", nationalInput: "123" }).valid, false);
  assert.equal(parseUserPhone({ countryCode: "US", nationalInput: "123" }).valid, false);
  assert.equal(validatePhone({ countryCode: "RS", nationalInput: "06" }).valid, false);
}

// TEST 7 — strict parsing, no extract
{
  assert.equal(
    parseUserPhone({ countryCode: "RS", nationalInput: "my phone is 0641234567" }).valid,
    false,
  );
}

// TEST 8 — DB backfill
{
  const stored = parseStoredPhone("381641234567");
  assert.equal(stored.valid, true);
  if (stored.valid) {
    assert.equal(stored.countryCode, "RS");
    assert.equal(stored.callingCode, "381");
    assert.equal(stored.nationalDisplay.startsWith("0"), true);
    assert.ok(digitsOf(stored.nationalDisplay).includes("641234567"));
  }
}

// TEST 9 — canonical equality
{
  const a = parseUserPhone({ countryCode: "RS", nationalInput: "0641234567" });
  const b = parseUserPhone({ countryCode: "RS", nationalInput: "+381641234567" });
  assert.equal(a.valid && b.valid, true);
  if (a.valid && b.valid) {
    assert.equal(a.normalizedDigits, b.normalizedDigits);
  }
}

{
  const intlConflict = parseUserPhone({
    countryCode: "RS",
    nationalInput: "+8613800138000",
  });
  assert.equal(intlConflict.valid, false);
}

assert.equal(uniqueCountryForCallingCode("381"), "RS");
assert.equal(uniqueCountryForCallingCode("7"), null);

const zhCountries = listPhoneCountries("zh");
const rs = zhCountries.find((c) => c.countryCode === "RS");
assert.ok(rs);
assert.equal(rs?.callingCode, "381");
assert.equal(rs?.flag, "🇷🇸");
assert.ok(rs?.name.includes("塞尔维亚") || rs?.name.toLowerCase().includes("serbia"));

const helperSrc = read("src/lib/phone/phoneNumber.ts");
assert.ok(helperSrc.includes("extract: false"));
assert.ok(helperSrc.includes("isPossible()"));
assert.ok(helperSrc.includes("isValid()"));
assert.equal(helperSrc.includes('startsWith("0")'), false);
assert.equal(helperSrc.includes("slice(1)"), false);

const validationSrc = read("src/lib/post-validation.ts");
assert.ok(validationSrc.includes("parseUserPhone"));
assert.equal(validationSrc.includes("normalized.length < 9"), false);
assert.equal(validationSrc.includes('startsWith("0")'), false);

const pickerSrc = read("src/components/phone/PhoneCountryPicker.tsx");
assert.ok(pickerSrc.includes("w-[7.75rem]"));
assert.ok(pickerSrc.includes("whitespace-nowrap"));
assert.ok(pickerSrc.includes("+{callingCode}"));

const successSrc = read("src/components/home/PublishedPostSuccess.tsx");
assert.ok(successSrc.includes("PhoneCountryPicker"));
assert.equal(successSrc.includes("COUNTRY_DIAL_CODES"), false);

const routeSrc = read("src/app/api/posts/complete-contact/route.ts");
assert.ok(routeSrc.includes("parseUserPhone"));
assert.ok(routeSrc.includes("phone_country"));
assert.ok(routeSrc.includes("normalizedDigits"));
assert.ok(routeSrc.includes("resolvePhoneCountry"));

console.log("phoneNumber.test.ts: ok");
