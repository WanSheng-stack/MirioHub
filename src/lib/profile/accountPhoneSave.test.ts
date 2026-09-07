/**
 * Account phone save API decision + Success/Account client feedback.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/profile/accountPhoneSave.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeAccountPhoneSave } from "@/lib/profile/accountPhoneSave";
import {
  clientValidatePhoneInput,
  interpretPhoneSaveResponse,
  parseJsonSafe,
  readPhoneSaveResponse,
  resetPhoneFeedback,
} from "@/lib/profile/phoneSaveClient";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

async function main() {

{
  const writes: Array<{ userId: string; phone: string }> = [];
  const result = await executeAccountPhoneSave({
    userId: null,
    body: { phone_country: "RS", raw_phone_local: "0641234567", user_id: "attacker" },
    writePhone: async (userId, phone) => {
      writes.push({ userId, phone });
      return true;
    },
  });
  assert.equal(result.status, 401);
  assert.equal(result.json.ok, false);
  if (!result.json.ok) assert.equal(result.json.errorKey, "error.authentication_required");
  assert.equal(writes.length, 0);
}

{
  const writes: Array<{ userId: string; phone: string }> = [];
  const result = await executeAccountPhoneSave({
    userId: "user-a",
    body: { phone_country: "RS", raw_phone_local: "123456789", user_id: "user-b" },
    writePhone: async (userId, phone) => {
      writes.push({ userId, phone });
      return true;
    },
  });
  assert.equal(result.status, 400);
  assert.equal(result.json.ok, false);
  if (!result.json.ok) assert.equal(result.json.errorKey, "error.invalid_phone");
  assert.equal(writes.length, 0);
}

{
  const writes: Array<{ userId: string; phone: string }> = [];
  const result = await executeAccountPhoneSave({
    userId: "user-a",
    body: { phone_country: "RS", raw_phone_local: "0641234567", user_id: "injected-other" },
    writePhone: async (userId, phone) => {
      writes.push({ userId, phone });
      return true;
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  if (result.json.ok) {
    assert.equal(result.json.normalizedPhone, "381641234567");
    assert.ok(result.json.nationalDisplay);
  }
  assert.deepEqual(writes, [{ userId: "user-a", phone: "381641234567" }]);
}

{
  const writes: Array<{ userId: string; phone: string }> = [];
  const result = await executeAccountPhoneSave({
    userId: "user-a",
    body: { phone_country: "RS", raw_phone_local: "   ", user_id: "nope" },
    writePhone: async (userId, phone) => {
      writes.push({ userId, phone });
      return true;
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  if (result.json.ok) {
    assert.equal(result.json.normalizedPhone, "");
    assert.equal(result.json.nationalDisplay, "");
  }
  assert.deepEqual(writes, [{ userId: "user-a", phone: "" }]);
}

{
  const invalid = clientValidatePhoneInput("RS", "06");
  assert.equal(invalid.ok, false);
  const valid = clientValidatePhoneInput("RS", "0641234567");
  assert.equal(valid.ok, true);
}

{
  const cleared = resetPhoneFeedback();
  assert.equal(cleared.phoneSaved, false);
  assert.equal(cleared.phoneError, null);
  assert.equal(parseJsonSafe("not-json"), null);
  assert.equal(interpretPhoneSaveResponse(null).ok, false);
  const failed = interpretPhoneSaveResponse({ ok: false, errorKey: "error.invalid_phone" });
  assert.equal(failed.ok, false);
  const ok = interpretPhoneSaveResponse({
    ok: true,
    normalizedPhone: "381641234567",
    nationalDisplay: "064 1234567",
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.normalizedPhone, "381641234567");
}

{
  const interpreted = await readPhoneSaveResponse({
    text: async () => "<html>oops</html>",
  });
  assert.equal(interpreted.ok, false);
}

const page = read("src/app/[locale]/profile/page.tsx");
assert.ok(page.includes("/api/profile/phone"));
assert.ok(page.includes("phoneError"));
assert.ok(page.includes('role="alert"'));
assert.ok(page.includes("aria-invalid"));
assert.equal(page.includes("p_phone:"), false);
assert.equal(page.includes("persistProfile({ phone:"), false);
assert.ok(page.includes("setPhoneError"));
assert.ok(page.includes("phoneSaved"));
{
  const savePhoneFn = page.slice(
    page.indexOf("async function savePhone"),
    page.indexOf("async function saveName"),
  );
  assert.equal(savePhoneFn.includes("setMessage"), false);
  assert.ok(savePhoneFn.includes("/api/profile/phone"));
}

const route = read("src/app/api/profile/phone/route.ts");
assert.ok(route.includes("executeAccountPhoneSave"));
assert.ok(route.includes("writeAccountPhone"));
assert.ok(route.includes("getUser()"));
assert.equal(route.includes("body.user_id"), false);

const writer = read("src/lib/profile/writeAccountPhone.ts");
assert.ok(writer.includes("set_profile_phone_v87"));
assert.ok(writer.includes("p_user_id: userId"));

const initSql = read("supabase/init.sql");
const updateFn = initSql.slice(
  initSql.indexOf("create or replace function public.update_my_profile("),
  initSql.indexOf("create or replace function public.set_profile_phone_v87"),
);
assert.equal(updateFn.includes("p_phone"), false);
assert.ok(updateFn.includes("p_full_name"));
assert.ok(updateFn.includes("p_plate"));
assert.ok(initSql.includes("grant execute on function public.set_profile_phone_v87(uuid, text) to service_role"));

const complete = read("src/app/api/posts/complete-contact/route.ts");
assert.ok(complete.includes("parseUserPhone"));
assert.ok(complete.includes("writeAccountPhone"));
assert.equal(complete.includes("p_phone:"), false);
assert.equal(complete.includes("update_my_profile"), false);

const success = read("src/components/home/PublishedPostSuccess.tsx");
assert.ok(success.includes("phoneError"));
assert.ok(success.includes('role="alert"'));
assert.ok(success.includes("aria-invalid"));

const sheet = read("src/components/home/PublishBottomSheet.tsx");
assert.ok(sheet.includes("parseUserPhone"));
assert.ok(sheet.includes("setPhoneError"));
assert.ok(sheet.includes("readPhoneSaveResponse"));
const saveFn = sheet.slice(
  sheet.indexOf("async function saveActivePhone"),
  sheet.indexOf("async function onPublish"),
);
assert.equal(saveFn.includes("setErrorKey"), false);
assert.ok(saveFn.includes("clientCheck"));

console.log("accountPhoneSave.test.ts: ok");
}

void main();
