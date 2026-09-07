/**
 * PHASE 6.5B.4 — Account page information architecture.
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
  't("title")',
  "IdentitySection",
  't("personalSection")',
  't("fullName")',
  't("phone")',
  't("phoneHelper")',
  't("save")',
  't("vehicleSection")',
  't("plate")',
  't("vehicle")',
  't("otherContactsSection")',
  't("facebook")',
  't("viber")',
  't("identityVerificationSection")',
  't("bankVerification")',
  't("benefitsSection")',
  't("signOut")',
];
let prev = -1;
for (const token of order) {
  const i = loggedIn.indexOf(token);
  assert.ok(i > prev, `order failed at ${token}`);
  prev = i;
}

assert.ok(loggedIn.indexOf("IdentitySection") < loggedIn.indexOf('t("personalSection")'));
assert.ok(loggedIn.indexOf('t("bankVerification")') > loggedIn.indexOf('t("personalSection")'));
assert.ok(loggedIn.indexOf('t("signOut")') > loggedIn.indexOf('t("benefitsSection")'));

assert.ok(page.includes("needsRecovery"));
assert.ok(page.includes("recoveryTitle"));
assert.ok(page.includes("googleBound"));
assert.ok(page.includes("emailVerified"));
assert.ok(page.includes("emailsMatch"));
assert.ok(page.includes("profile?.phone"));
assert.ok(page.includes('value={profile?.phone ?? ""}'));

assert.ok(page.includes("p_full_name: profile.full_name"));
assert.ok(page.includes("p_phone: profile.phone"));
assert.ok(page.includes("p_plate: profile.plate"));
assert.ok(page.includes("p_vehicle: profile.vehicle"));
assert.ok(page.includes("p_facebook: profile.facebook"));
assert.ok(page.includes("p_viber: profile.viber"));
assert.ok(page.includes("p_phone: current.phone"));

assert.ok(page.includes("<details"));
assert.ok(page.includes('t("otherContactsSection")'));
assert.ok(page.includes('t("bankStatusUnverified")'));
assert.ok(page.includes('t("bankStatusVerified")'));
assert.equal(page.includes('t("premium")}:'), false);
assert.equal(page.includes("Premium: —"), false);

assert.ok(page.includes("max-w-lg"));
assert.ok(page.includes("px-4"));
assert.ok(page.includes("w-full"));

assert.equal(zh.account.signInSection, "登录与账户");
assert.equal(zh.account.recoveryTitle, "保存你的账户");
assert.equal(zh.account.recoveryBody, "添加 Google 或邮箱，以便之后可以继续使用这个账户。");
assert.equal(zh.account.personalSection, "个人资料");
assert.equal(zh.account.fullName, "姓名");
assert.equal(zh.account.phone, "手机号码");
assert.equal(zh.account.phoneHelper, "方便订单确认后联系。");
assert.equal(zh.account.vehicleSection, "车辆资料");
assert.equal(zh.account.otherContactsSection, "其他联系方式");
assert.equal(zh.account.identityVerificationSection, "身份与交易验证");
assert.equal(zh.account.bankVerification, "银行验证");
assert.equal(zh.account.bankStatusUnverified, "未验证");
assert.equal(zh.account.bankStatusVerified, "已验证");
assert.equal(zh.account.benefitsSection, "套餐与权益");
assert.equal(zh.account.quota, "剩余免费查看次数");
assert.equal(zh.account.signOut, "退出登录");

assert.equal(en.account.signInSection, "Sign-in & account");
assert.equal(en.account.recoveryTitle, "Keep your account");
assert.equal(en.account.phoneHelper, "For contact after an order is confirmed.");
assert.equal(en.account.bankStatusUnverified, "Not verified");
assert.equal(sr.account.signInSection, "Prijava i nalog");
assert.equal(sr.account.phoneHelper, "Za kontakt nakon potvrde dogovora.");
assert.equal(sr.account.bankStatusUnverified, "Nije verifikovano");

assert.ok(page.includes("resolveAccountIdentityState"));
assert.equal(page.includes("from(\"posts\")"), false);

console.log("accountPageLayout.test.ts: ok");
