/**
 * PHASE 6.5B.3 FINAL — keep-account copy. Device verification is not recovery.
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

assert.equal(zhAccount.recoveryTitle, "保存你的账户");
assert.equal(zhAccount.recoveryBody, "添加 Google 或邮箱，以便之后可以继续使用这个账户。");
assert.equal(enAccount.recoveryTitle, "Keep your account");
assert.equal(
  enAccount.recoveryBody,
  "Add Google or email so you can continue using this account later.",
);
assert.equal(srAccount.recoveryTitle, "Sačuvajte svoj nalog");
assert.equal(
  srAccount.recoveryBody,
  "Povežite Google ili email kako biste kasnije mogli da nastavite da koristite ovaj nalog.",
);

assert.equal(zhAccount.deviceVerified, "✓ 已完成设备验证");
assert.equal(enAccount.deviceVerified, "✓ Device verification completed");

assert.equal(zhSuccess.recoveryTitle, zhAccount.recoveryTitle);
assert.equal(zhSuccess.recoveryBody, zhAccount.recoveryBody);
assert.equal(enSuccess.recoveryTitle, enAccount.recoveryTitle);
assert.equal(enSuccess.recoveryBody, enAccount.recoveryBody);
assert.equal(srSuccess.recoveryTitle, srAccount.recoveryTitle);
assert.equal(srSuccess.recoveryBody, srAccount.recoveryBody);

assert.equal(zhSuccess.phoneTitle, "手机号码");
assert.equal(zhSuccess.phoneHint, "方便订单确认后联系。");
assert.equal(enSuccess.phoneTitle, "Phone number");
assert.equal(enSuccess.phoneHint, "For contact after an order is confirmed.");
assert.equal(srSuccess.phoneTitle, "Broj telefona");
assert.equal(srSuccess.phoneHint, "Za kontakt nakon potvrde dogovora.");
for (const phone of [zhSuccess.phoneTitle, zhSuccess.phoneHint, enSuccess.phoneHint, srSuccess.phoneHint]) {
  assert.equal(/登录|找回账户|保存账户|recover|recovery|oporavak/i.test(phone), false);
}

assert.equal(zhIdentity.verify_with_device, "使用设备验证");
assert.equal(zhIdentity.verify_with_device_helper, "使用指纹、面容或设备解锁完成安全验证。");
assert.equal(enIdentity.verify_with_device, "Verify with a device");
assert.equal(
  enIdentity.verify_with_device_helper,
  "Use your fingerprint, face, or device unlock to complete secure verification.",
);
assert.equal(srIdentity.verify_with_device, "Verifikujte uređajem");

const profileSrc = read("src/app/[locale]/profile/page.tsx");
assert.ok(profileSrc.includes("needsRecovery"));
assert.ok(profileSrc.includes("deviceVerified"));
assert.ok(profileSrc.includes("recoveryTitle"));
assert.equal(profileSrc.includes("customOnly"), false);

const successSrc = read("src/components/home/PublishedPostSuccess.tsx");
assert.ok(successSrc.includes("recoveryTitle"));
assert.ok(successSrc.includes("recoveryBody"));
assert.match(
  successSrc,
  /needsRecovery \? \(\s*<button[\s\S]*connectGoogle/,
);

const draftSrc = read("src/components/home/DraftIdentityCompletion.tsx");
assert.ok(draftSrc.includes("verify_with_device_helper"));
assert.equal(draftSrc.includes("Windows Hello"), false);

const forbidden = [
  "Windows Hello",
  "WebAuthn",
  "Passkey",
  "passkey",
  "credential",
  "challenge",
  "risk gate",
  "privacy bind",
  "目前只有设备验证",
  "当前只有设备验证",
  "建议添加账户恢复方式",
  "保护你的账户",
  "完善账户安全",
  "添加账户恢复方式",
  "找回当前账户",
  "recover this account",
  "recovery method",
  "signing out",
  "clearing browser data",
  "switching devices",
  "browser data",
  "oporavak naloga",
  "brisanja podataka pregledača",
];
for (const text of leafStrings({ zh, en, sr })) {
  const lower = text.toLowerCase();
  for (const term of forbidden) {
    assert.equal(
      text.includes(term) || lower.includes(term.toLowerCase()),
      false,
      `${term} in: ${text}`,
    );
  }
  assert.equal(/\brecovery\b/i.test(text), false, text);
}

const readinessSrc = read("src/lib/auth/postPublishReadiness.ts");
assert.ok(readinessSrc.includes("hasGoogle || input.identity.hasVerifiedEmail"));
assert.ok(readinessSrc.includes("hasValidContactPhone(input.profilePhone)"));

console.log("accountRecoveryCopy.test.ts: ok");
