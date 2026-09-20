/**
 * Phone status UI contract — Account + publish success.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/profile/phoneStatusUi.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clientValidatePhoneInput } from "@/lib/profile/phoneSaveClient";
import {
  PHONE_SAVED_FLASH_MS,
  derivePhoneStatusUi,
  formatPersistedPhoneDisplay,
  hasServerPersistedPhone,
  phoneStatusAfterSaveAttempt,
} from "@/lib/profile/phoneStatusUi";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

// 1. Save-success flash is transient (timed, not a long-lived badge)
{
  assert.ok(PHONE_SAVED_FLASH_MS >= 2000 && PHONE_SAVED_FLASH_MS <= 3000);
  const withFlash = derivePhoneStatusUi({
    persistedNormalizedPhone: "381653228255",
    savedFlashActive: true,
  });
  assert.equal(withFlash.showSavedFlash, true);
  assert.equal(withFlash.showUnverifiedBadge, true);

  const afterFlash = derivePhoneStatusUi({
    persistedNormalizedPhone: "381653228255",
    savedFlashActive: false,
  });
  assert.equal(afterFlash.showSavedFlash, false);
  assert.equal(afterFlash.showUnverifiedBadge, true);

  const flash = read("src/components/phone/PhonePersistedStatus.tsx");
  assert.ok(flash.includes("PHONE_SAVED_FLASH_MS"));
  assert.ok(flash.includes("setTimeout"));
  assert.ok(flash.includes("onSavedFlashEnd"));
  assert.equal(flash.includes("savedLabel"), false);
  // No dead Verify CTA (comment may mention verification).
  assert.equal(flash.includes("Verify button"), true); // docs only
  assert.equal(/<button[^>]*>\s*Verify/i.test(flash), false);
}

// 2. Unverified badge is persistent (requires server-persisted phone)
{
  assert.equal(hasServerPersistedPhone("381653228255"), true);
  assert.equal(hasServerPersistedPhone(""), false);
  assert.equal(hasServerPersistedPhone(null), false);
  assert.equal(hasServerPersistedPhone("   "), false);

  const persistent = derivePhoneStatusUi({
    persistedNormalizedPhone: "381653228255",
    savedFlashActive: false,
  });
  assert.equal(persistent.showUnverifiedBadge, true);
  assert.equal(persistent.isVerified, false);
  assert.ok(persistent.formattedDisplay);
  assert.equal(formatPersistedPhoneDisplay("381653228255"), "+381653228255");
}

// 3. Save failure must not show unverified (when nothing was persisted)
{
  const failed = phoneStatusAfterSaveAttempt({
    ok: false,
    previousPersistedPhone: null,
  });
  assert.equal(failed.savedFlashActive, false);
  assert.equal(failed.showUnverifiedBadge, false);
  assert.equal(failed.persistedNormalizedPhone, null);

  const failedUi = derivePhoneStatusUi({
    persistedNormalizedPhone: failed.persistedNormalizedPhone,
    savedFlashActive: failed.savedFlashActive,
  });
  assert.equal(failedUi.showSavedFlash, false);
  assert.equal(failedUi.showUnverifiedBadge, false);

  // Flash alone without persist must not invent unverified
  const ghostFlash = derivePhoneStatusUi({
    persistedNormalizedPhone: "",
    savedFlashActive: true,
  });
  assert.equal(ghostFlash.showSavedFlash, false);
  assert.equal(ghostFlash.showUnverifiedBadge, false);
}

// 4. Format validation success ≠ saved
{
  const valid = clientValidatePhoneInput("RS", "653228255");
  assert.equal(valid.ok, true);
  // Validating locally must not imply persisted / unverified / saved flash.
  const ui = derivePhoneStatusUi({
    persistedNormalizedPhone: null,
    savedFlashActive: false,
  });
  assert.equal(ui.showSavedFlash, false);
  assert.equal(ui.showUnverifiedBadge, false);
  assert.equal(ui.hasPersistedPhone, false);
}

// 5. Saved ≠ verified (no verification authority)
{
  const saved = phoneStatusAfterSaveAttempt({
    ok: true,
    normalizedPhone: "381653228255",
  });
  assert.equal(saved.savedFlashActive, true);
  assert.equal(saved.showUnverifiedBadge, true);
  const ui = derivePhoneStatusUi({
    persistedNormalizedPhone: saved.persistedNormalizedPhone,
    savedFlashActive: false,
  });
  assert.equal(ui.showUnverifiedBadge, true);
  assert.equal(ui.isVerified, false);
  assert.equal(ui.showSavedFlash, false);
}

// Surfaces share the same component + semantics
{
  const profile = read("src/app/[locale]/profile/page.tsx");
  assert.ok(profile.includes("PhonePersistedStatus"));
  assert.ok(profile.includes("phoneSavedFlash"));
  assert.ok(profile.includes('t("phoneStatusUnverified")'));
  assert.ok(profile.includes('t("phoneUsageDescription")'));
  // Phone card must not add a dead Verify CTA.
  const phoneCard = profile.slice(
    profile.indexOf("<PhonePersistedStatus"),
    profile.indexOf('t("vehicleSection")'),
  );
  assert.ok(phoneCard.includes("PhonePersistedStatus"));
  assert.equal(/Verify/.test(phoneCard), false);

  const success = read("src/components/home/PublishedPostSuccess.tsx");
  assert.ok(success.includes("PhonePersistedStatus"));
  assert.ok(success.includes("phoneSavedFlash"));
  assert.ok(success.includes("phoneStatusUnverified"));
  assert.ok(success.includes("phoneUsageDescription"));
  assert.equal(success.includes("hasContactPhone"), false);
  assert.equal(/<button[^>]*>\s*Verify/i.test(success), false);

  const sheet = read("src/components/home/PublishBottomSheet.tsx");
  assert.ok(sheet.includes("phoneSavedFlash"));
  assert.ok(sheet.includes("persistedPhone={profilePhone}"));
}

// zh / en / sr key completeness
{
  for (const locale of ["en", "zh", "sr"] as const) {
    const msg = JSON.parse(read(`src/messages/${locale}.json`)) as {
      account: { phoneStatusUnverified: string; phoneUsageDescription: string };
      publishSuccess: { phoneStatusUnverified: string; phoneUsageDescription: string };
    };
    assert.ok(msg.account.phoneStatusUnverified.length > 0, locale);
    assert.ok(msg.account.phoneUsageDescription.length > 0, locale);
    assert.ok(msg.publishSuccess.phoneStatusUnverified.length > 0, locale);
    assert.ok(msg.publishSuccess.phoneUsageDescription.length > 0, locale);
  }
  const zh = JSON.parse(read("src/messages/zh.json")) as {
    account: { phoneStatusUnverified: string; phoneUsageDescription: string };
  };
  const en = JSON.parse(read("src/messages/en.json")) as {
    account: { phoneStatusUnverified: string; phoneUsageDescription: string };
  };
  const sr = JSON.parse(read("src/messages/sr.json")) as {
    account: { phoneStatusUnverified: string; phoneUsageDescription: string };
  };
  assert.equal(zh.account.phoneStatusUnverified, "未验证");
  assert.equal(zh.account.phoneUsageDescription, "仅用于订单联系。");
  assert.equal(en.account.phoneStatusUnverified, "Not verified");
  assert.equal(en.account.phoneUsageDescription, "Used only for order contact.");
  assert.equal(sr.account.phoneStatusUnverified, "Nije verifikovan");
  assert.equal(sr.account.phoneUsageDescription, "Koristi se samo za kontakt u vezi sa narudžbinom.");
}

// Shared layout owns the single title/status/purpose rendering contract.
{
  const shared = read("src/components/phone/PhonePersistedStatus.tsx");
  assert.ok(shared.includes("<fieldset"));
  assert.ok(shared.includes("<legend"));
  assert.ok(shared.includes("✎"));
  assert.ok(shared.includes("✓"));
  assert.ok(shared.includes("×"));
  assert.equal((shared.match(/\{usageDescription\}/g) ?? []).length, 1);

  const profile = read("src/app/[locale]/profile/page.tsx");
  const success = read("src/components/home/PublishedPostSuccess.tsx");
  assert.equal((profile.match(/phoneUsageDescription/g) ?? []).length, 1);
  assert.equal((success.match(/phoneUsageDescription/g) ?? []).length, 1);
  for (const removed of [
    "phoneCardTitle",
    "phoneCardBody",
    "phoneHint",
    "phoneStatusUnverifiedDescription",
  ]) {
    assert.equal(profile.includes(removed), false);
    assert.equal(success.includes(removed), false);
  }
}

console.log("phoneStatusUi.test.ts: ok");
