/**
 * PHASE 6.5B.5 — Account page lightweight IA.
 * Run: npx tsx --tsconfig tsconfig.json src/app/[locale]/profile/accountPageLayout.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const page = read("src/app/[locale]/profile/page.tsx");
const intercept = read("src/lib/post-intercept.ts");
const zh = JSON.parse(read("src/messages/zh.json")) as {
  account: Record<string, string>;
};
const en = JSON.parse(read("src/messages/en.json")) as {
  account: Record<string, string>;
};
const sr = JSON.parse(read("src/messages/sr.json")) as {
  account: Record<string, string>;
};

const loggedIn = page.slice(page.indexOf("<header className=\"mb-5\">"));

const order = [
  '{t("title")}',
  "avatarUrl",
  "headerName",
  '{t("premiumBadge")}',
  '{t("editName")}',
  '{t("fullName")}',
  "IdentitySection",
  '{t("phoneCardTitle")}',
  '{t("phoneCardBody")}',
  "PhoneCountryPicker",
  "savePhone",
  '{t("vehicleSection")}',
  '{t("plate")}',
  '{t("vehicle")}',
  '{t("otherContactsSection")}',
  '{t("facebook")}',
  '{t("viber")}',
  '{t("bankVerification")}',
  't("bankStatusUnverified")',
  '{t("signOut")}',
];
let prev = -1;
for (const token of order) {
  const i = loggedIn.indexOf(token);
  assert.ok(i > prev, `order failed at ${token}`);
  prev = i;
}

assert.ok(loggedIn.indexOf("IdentitySection") < loggedIn.indexOf('{t("phoneCardTitle")}'));
assert.ok(loggedIn.indexOf('{t("phoneCardTitle")}') < loggedIn.indexOf('{t("vehicleSection")}'));
assert.ok(loggedIn.indexOf('{t("vehicleSection")}') < loggedIn.indexOf('{t("otherContactsSection")}'));
assert.ok(loggedIn.indexOf('{t("otherContactsSection")}') < loggedIn.indexOf('{t("bankVerification")}'));
assert.ok(loggedIn.indexOf('{t("signOut")}') > loggedIn.indexOf('{t("bankVerification")}'));

assert.equal(page.includes('t("benefitsSection")'), false);
assert.equal(page.includes('t("quota")'), false);
assert.equal(page.includes("free_views_left"), false);
assert.equal(page.includes('t("identityVerificationSection")'), false);
assert.equal(page.includes('t("signInSection")'), false);
assert.equal(page.includes('t("phoneHelper")'), false);
assert.equal(page.includes("Premium: —"), false);
assert.equal(page.includes('t("premium")}:'), false);
assert.equal(page.includes('label={t("personalSection")}'), false);

assert.equal((page.match(/<SettingRow/g) ?? []).length, 3);
assert.ok(page.includes('label={t("vehicleSection")}'));
assert.ok(page.includes('label={t("otherContactsSection")}'));
assert.ok(page.includes('label={t("bankVerification")}'));
assert.ok(page.includes("settingRowClass"));
assert.ok(page.includes("settingSummaryClass"));

assert.ok(page.includes('text-sm leading-relaxed text-zinc-600">{t("phoneCardBody")}'));
assert.ok(page.includes("flex flex-wrap gap-2"));
assert.ok(page.includes("PhoneCountryPicker"));
assert.ok(page.includes("parseStoredPhone"));
assert.ok(page.includes("parseUserPhone"));
assert.ok(page.includes("savePhone"));
assert.equal(page.includes("COUNTRY_DIAL_CODES"), false);
assert.equal(page.includes("splitStoredPhone"), false);
assert.equal(page.includes("normalizePhone(dialCode"), false);

assert.ok(page.includes("needsRecovery"));
assert.ok(page.includes("recoveryTitle"));
assert.ok(page.includes("googleBound"));
assert.ok(page.includes("emailVerified"));
assert.ok(page.includes("emailsMatch"));
assert.ok(page.includes("resolveAccountIdentityState"));
assert.equal(page.includes("from(\"posts\")"), false);

assert.ok(page.includes("p_full_name: next.full_name"));
assert.ok(page.includes("p_phone: next.phone"));
assert.ok(page.includes("p_plate: next.plate"));
assert.ok(page.includes("p_vehicle: next.vehicle"));
assert.ok(page.includes("p_facebook: next.facebook"));
assert.ok(page.includes("p_viber: next.viber"));
assert.ok(page.includes("p_phone: current.phone"));
assert.ok(page.includes("p_plate: current.plate"));
assert.ok(page.includes("p_vehicle: current.vehicle"));
assert.ok(page.includes("p_facebook: current.facebook"));
assert.ok(page.includes("p_viber: current.viber"));
assert.ok(page.includes("persistProfile({ phone: parsed.normalizedDigits })"));
assert.ok(page.includes("saveName"));
assert.ok(page.includes('p_phone: next.phone'));

assert.ok(page.includes("is_premium === true"));
assert.ok(page.includes("<details"));
assert.ok(page.includes('t("bankStatusVerified")'));
assert.ok(page.includes("max-w-lg"));
assert.ok(page.includes("px-4"));
assert.ok(page.includes("w-full"));
assert.ok(page.includes("min-w-0"));

assert.ok(intercept.includes("allowed_posts_limit = metrics.is_premium_member ? 99999 : 3"));

assert.equal(zh.account.recoveryTitle, "保存你的账户");
assert.equal(zh.account.recoveryBody, "添加 Google 或邮箱，以便之后可以继续使用这个账户。");
assert.equal(zh.account.personalSection, "个人资料");
assert.equal(zh.account.phoneCardTitle, "让对方更方便联系你");
assert.equal(zh.account.phoneCardBody, "填写手机号码，方便订单确认后联系。");
assert.equal(zh.account.fullName, "姓名");
assert.equal(zh.account.save, "保存");
assert.equal(zh.account.vehicleSection, "机动车信息");
assert.equal(zh.account.plate, "车牌号");
assert.equal(zh.account.vehicle, "车辆型号");
assert.equal(zh.account.otherContactsSection, "其他联系方式");
assert.equal(zh.account.bankVerification, "银行验证");
assert.equal(zh.account.bankStatusUnverified, "未验证");
assert.equal(zh.account.bankStatusVerified, "已验证");
assert.equal(zh.account.signOut, "退出登录");
assert.equal(zh.account.editName, "编辑");
assert.equal(zh.account.premiumBadge, "Premium");

assert.equal(en.account.recoveryTitle, "Keep your account");
assert.equal(
  en.account.recoveryBody,
  "Add Google or email so you can continue using this account later.",
);
assert.equal(en.account.phoneCardTitle, "Make it easier for others to reach you");
assert.equal(
  en.account.phoneCardBody,
  "Add a phone number for contact after an order is confirmed.",
);
assert.equal(en.account.vehicleSection, "Vehicle");
assert.equal(en.account.bankStatusUnverified, "Not verified");
assert.equal(en.account.premiumBadge, "Premium");

assert.equal(sr.account.recoveryTitle, "Sačuvajte svoj nalog");
assert.equal(sr.account.personalSection, "Lični podaci");
assert.equal(sr.account.phoneCardTitle, "Olakšajte drugima da vas kontaktiraju");
assert.equal(sr.account.vehicleSection, "Motorno vozilo");
assert.equal(sr.account.bankVerification, "Bankovna verifikacija");
assert.equal(sr.account.bankStatusUnverified, "Nije verifikovano");
assert.equal(sr.account.signOut, "Odjava");
assert.equal(sr.account.premiumBadge, "Premium");

assert.equal(zh.account.identityVerificationSection, "身份与交易验证");
assert.equal(zh.account.benefitsSection, "套餐与权益");
assert.equal(zh.account.quota, "剩余免费查看次数");

console.log("accountPageLayout.test.ts: ok");
