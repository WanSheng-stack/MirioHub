/**
 * PHASE 6.5B.3 — Account recovery copy must not imply device verification
 * is a returning-login method.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/auth/accountRecoveryCopy.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const zh = JSON.parse(read("src/messages/zh.json")) as Record<string, unknown>;
const en = JSON.parse(read("src/messages/en.json")) as Record<string, unknown>;
const sr = JSON.parse(read("src/messages/sr.json")) as Record<string, unknown>;

function leafStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) leafStrings(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      leafStrings(child, out);
    }
  }
  return out;
}

const zhAccount = zh.account as Record<string, string>;
const enAccount = en.account as Record<string, string>;
const srAccount = sr.account as Record<string, string>;
const zhSuccess = zh.publishSuccess as Record<string, string>;
const enSuccess = en.publishSuccess as Record<string, string>;
const srSuccess = sr.publishSuccess as Record<string, string>;
const zhIdentity = zh.identity as Record<string, string>;
const enIdentity = en.identity as Record<string, string>;
const srIdentity = sr.identity as Record<string, string>;

// TEST 1 / 5 / 10 — recovery copy
assert.equal(zhAccount.recoveryTitle, "建议添加账户恢复方式");
assert.equal(
  zhAccount.recoveryBody,
  "绑定 Google 或邮箱后，即使退出登录、清除浏览器数据或更换设备，也能重新找回当前账户。",
);
assert.equal(enAccount.recoveryTitle, "Add an account recovery method");
assert.equal(
  enAccount.recoveryBody,
  "Connect Google or email so you can recover this account after signing out, clearing browser data, or switching devices.",
);
assert.equal(srAccount.recoveryTitle, "Dodajte način za oporavak naloga");
assert.equal(
  srAccount.recoveryBody,
  "Povežite Google ili email kako biste mogli ponovo da pristupite ovom nalogu nakon odjave, brisanja podataka pregledača ili promene uređaja.",
);

assert.equal(zhAccount.deviceVerified, "✓ 已完成设备验证");
assert.equal(enAccount.deviceVerified, "✓ Device verification completed");

assert.equal(zhSuccess.recoveryTitle, zhAccount.recoveryTitle);
assert.equal(zhSuccess.recoveryBody, zhAccount.recoveryBody);
assert.equal(enSuccess.recoveryTitle, enAccount.recoveryTitle);
assert.equal(enSuccess.recoveryBody, enAccount.recoveryBody);
assert.equal(srSuccess.recoveryTitle, srAccount.recoveryTitle);
assert.equal(srSuccess.recoveryBody, srAccount.recoveryBody);

for (const text of leafStrings({ zh, en, sr })) {
  assert.equal(text.includes("目前只有设备验证"), false, text);
  assert.equal(text.includes("当前只有设备验证"), false, text);
  assert.equal(text.toLowerCase().includes("only has device verification"), false, text);
  assert.equal(text.includes("samo verifikaciju uređajem"), false, text);
  assert.equal(text.includes("设备验证本身以后可以让我登录"), false, text);
  assert.equal(text.includes("device verification lets you sign in again"), false, text);
}

// TEST 8 — phone is order contact, not recovery
assert.equal(zhSuccess.phoneTitle, "手机号码");
assert.equal(zhSuccess.phoneHint, "方便订单确认后联系。");
assert.equal(enSuccess.phoneTitle, "Phone number");
assert.equal(enSuccess.phoneHint, "For contact after an order is confirmed.");
assert.equal(srSuccess.phoneTitle, "Broj telefona");
assert.equal(srSuccess.phoneHint, "Za kontakt nakon potvrde dogovora.");
for (const phone of [zhSuccess.phoneHint, enSuccess.phoneHint, srSuccess.phoneHint]) {
  assert.equal(/找回账户|账户恢复|sign in|recover this account|oporavak naloga|prijav/i.test(phone), false);
}

// TEST 10 — device verification ceremony stays publish-security, not recovery
assert.equal(zhIdentity.verify_with_device, "使用设备验证");
assert.equal(zhIdentity.verify_with_device_helper, "使用指纹、面容或设备解锁完成安全验证。");
assert.equal(enIdentity.verify_with_device, "Verify with a device");
assert.equal(
  enIdentity.verify_with_device_helper,
  "Use your fingerprint, face, or device unlock to complete secure verification.",
);
assert.equal(srIdentity.verify_with_device, "Verifikujte uređajem");
for (const text of [zhIdentity.verify_with_device_helper, enIdentity.verify_with_device_helper, srIdentity.verify_with_device_helper]) {
  assert.equal(/账户恢复|recover this account|oporavak naloga|以后登录/.test(text), false);
}

const profileSrc = read("src/app/[locale]/profile/page.tsx");
assert.ok(profileSrc.includes("needsRecovery"));
assert.ok(profileSrc.includes("deviceVerified"));
assert.ok(profileSrc.includes("recoveryTitle"));
assert.equal(profileSrc.includes("customOnly"), false);

const successSrc = read("src/components/home/PublishedPostSuccess.tsx");
assert.ok(successSrc.includes("recoveryTitle"));
assert.ok(successSrc.includes("recoveryBody"));
assert.ok(successSrc.includes("googleConnected"));
assert.ok(successSrc.includes("emailVerified"));
assert.ok(successSrc.includes("emailsMatch"));
assert.match(
  successSrc,
  /needsRecovery \? \(\s*<button[\s\S]*connectGoogle/,
);

const draftSrc = read("src/components/home/DraftIdentityCompletion.tsx");
assert.ok(draftSrc.includes("verify_with_device_helper"));
assert.equal(draftSrc.includes("Windows Hello"), false);
assert.equal(draftSrc.includes("WebAuthn"), false);
assert.equal(draftSrc.includes("risk gate"), false);
assert.equal(draftSrc.includes("privacy bind"), false);

// TEST 9 — user-visible message values must not leak ceremony jargon
const forbidden = [
  "Windows Hello",
  "WebAuthn",
  "Passkey",
  "passkey",
  "credential",
  "challenge",
  "risk gate",
  "privacy bind",
];
for (const text of leafStrings({ zh, en, sr })) {
  for (const term of forbidden) {
    assert.equal(text.includes(term), false, `${term} in: ${text}`);
  }
}

const readinessSrc = read("src/lib/auth/postPublishReadiness.ts");
assert.ok(readinessSrc.includes("hasGoogle || input.identity.hasVerifiedEmail"));
assert.ok(readinessSrc.includes("hasValidContactPhone(input.profilePhone)"));

console.log("accountRecoveryCopy.test.ts: ok");
