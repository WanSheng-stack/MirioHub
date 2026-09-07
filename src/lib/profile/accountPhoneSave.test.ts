/**
 * Account / Success phone save contract (TEST A–J).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/profile/accountPhoneSave.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeAccountPhoneSave } from "@/lib/profile/accountPhoneSave";
import {
  formatSafePhoneWriteLog,
  interpretProfilePhoneRpc,
  PHONE_SAVE_FAILED_KEY,
  type AccountPhoneWriteResult,
} from "@/lib/profile/accountPhoneWrite";
import { parseUserPhone } from "@/lib/phone/phoneNumber";
import {
  applyDedicatedPhoneSaveOutcome,
  interpretPhoneSaveResponse,
  readPhoneSaveResponse,
} from "@/lib/profile/phoneSaveClient";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

async function main() {
  const okWrite = async (): Promise<AccountPhoneWriteResult> => ({ ok: true });

  // TEST A — RS 653228255 → canonical 381653228255 → writer success → 200
  {
    const parsed = parseUserPhone({ countryCode: "RS", nationalInput: "653228255" });
    assert.equal(parsed.valid, true);
    if (parsed.valid) assert.equal(parsed.normalizedDigits, "381653228255");

    const writes: Array<{ userId: string; phone: string }> = [];
    const result = await executeAccountPhoneSave({
      userId: "session-user",
      body: { phone_country: "RS", raw_phone_local: "653228255", user_id: "injected" },
      writePhone: async (userId, phone) => {
        writes.push({ userId, phone });
        return { ok: true };
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, true);
    if (result.json.ok) {
      assert.equal(result.json.normalizedPhone, "381653228255");
    }
    assert.deepEqual(writes, [{ userId: "session-user", phone: "381653228255" }]);
  }

  // TEST B — Supabase RPC error → 500 phone_save_failed
  {
    const dbError = {
      code: "42883",
      message: "function public.set_profile_phone_v87 does not exist",
      details: "schema cache miss",
      hint: "run migration",
    };
    const result = await executeAccountPhoneSave({
      userId: "session-user",
      body: { phone_country: "RS", raw_phone_local: "653228255" },
      writePhone: async () => ({ ok: false, reason: "rpc_error", error: dbError }),
    });
    assert.equal(result.status, 500);
    assert.deepEqual(result.json, { ok: false, errorKey: PHONE_SAVE_FAILED_KEY });
    const browser = JSON.stringify(result.json);
    assert.equal(browser.includes("42883"), false);
    assert.equal(browser.includes("does not exist"), false);
    assert.equal(browser.includes("schema cache"), false);
    assert.equal(browser.includes("run migration"), false);
  }

  // TEST C — RPC data.ok=false → 500 phone_save_failed
  {
    const mapped = interpretProfilePhoneRpc({ data: { ok: false, error: "NOT_FOUND" }, error: null });
    assert.equal(mapped.ok, false);
    if (!mapped.ok) assert.equal(mapped.reason, "rpc_rejected");

    const result = await executeAccountPhoneSave({
      userId: "session-user",
      body: { phone_country: "RS", raw_phone_local: "653228255" },
      writePhone: async () => ({ ok: false, reason: "rpc_rejected", rpcError: "NOT_FOUND" }),
    });
    assert.equal(result.status, 500);
    assert.deepEqual(result.json, { ok: false, errorKey: PHONE_SAVE_FAILED_KEY });
    assert.equal(JSON.stringify(result.json).includes("NOT_FOUND"), false);
  }

  // TEST D — database details never enter the browser response
  {
    const result = await executeAccountPhoneSave({
      userId: "session-user",
      body: { phone_country: "RS", raw_phone_local: "653228255" },
      writePhone: async () => ({
        ok: false,
        reason: "rpc_error",
        error: { code: "P0001", message: "boom", details: "row dump", hint: "check phone" },
      }),
    });
    const keys = Object.keys(result.json);
    assert.deepEqual(keys.sort(), ["errorKey", "ok"]);
    assert.equal("writeFailure" in result.json, false);
    assert.equal("error" in result.json, false);
  }

  // Safe log: reason + whitelist code only
  {
    const log = formatSafePhoneWriteLog({
      ok: false,
      reason: "rpc_error",
      error: {
        code: "23514",
        message: "+381 65 322 8255",
        details: "Failing row contains (..., 381653228255, ...)",
        hint: "retry with +381-65-322-8255",
      },
    });
    assert.deepEqual(log, { reason: "rpc_error", error: { code: "23514" } });
    const serialized = JSON.stringify(log);
    assert.equal(serialized.includes("message"), false);
    assert.equal(serialized.includes("+381"), false);
    assert.equal(serialized.includes("322"), false);

    const route = read("src/app/api/profile/phone/route.ts");
    assert.ok(route.includes('[api/profile/phone] set_profile_phone_v87 failed'));
    assert.ok(route.includes("formatSafePhoneWriteLog"));
    assert.equal(/console\.(error|log|warn)\([\s\S]*raw_phone/.test(route), false);
    assert.equal(/console\.(error|log|warn)\([\s\S]*normalizedPhone/.test(route), false);
    assert.equal(route.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
    assert.equal(/console\.(error|log|warn)\([\s\S]*Authorization/.test(route), false);
  }

  // TEST F — unauthenticated
  {
    const writes: unknown[] = [];
    const result = await executeAccountPhoneSave({
      userId: null,
      body: { phone_country: "RS", raw_phone_local: "653228255" },
      writePhone: async () => {
        writes.push(1);
        return okWrite();
      },
    });
    assert.equal(result.status, 401);
    assert.deepEqual(result.json, { ok: false, errorKey: "error.authentication_required" });
    assert.equal(writes.length, 0);
  }

  // TEST G — invalid / landline → 400, writer not called
  {
    const writes: unknown[] = [];
    const result = await executeAccountPhoneSave({
      userId: "session-user",
      body: { phone_country: "RS", raw_phone_local: "123456789" },
      writePhone: async () => {
        writes.push(1);
        return okWrite();
      },
    });
    assert.equal(result.status, 400);
    assert.deepEqual(result.json, { ok: false, errorKey: "error.invalid_phone" });
    assert.equal(writes.length, 0);
  }

  // TEST H — injected user_id is ignored
  {
    const writes: Array<{ userId: string; phone: string }> = [];
    const result = await executeAccountPhoneSave({
      userId: "auth-uid-from-session",
      body: {
        phone_country: "RS",
        raw_phone_local: "653228255",
        user_id: "attacker-uuid",
      },
      writePhone: async (userId, phone) => {
        writes.push({ userId, phone });
        return { ok: true };
      },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(writes, [{ userId: "auth-uid-from-session", phone: "381653228255" }]);
  }

  // TEST I — clear phone: writer success / writer failure
  {
    const success = await executeAccountPhoneSave({
      userId: "session-user",
      body: { phone_country: "RS", raw_phone_local: "  " },
      writePhone: async (userId, phone) => {
        assert.equal(userId, "session-user");
        assert.equal(phone, "");
        return { ok: true };
      },
    });
    assert.equal(success.status, 200);
    assert.equal(success.json.ok, true);
    if (success.json.ok) assert.equal(success.json.normalizedPhone, "");

    const failed = await executeAccountPhoneSave({
      userId: "session-user",
      body: { phone_country: "RS", raw_phone_local: "" },
      writePhone: async () => ({ ok: false, reason: "rpc_rejected", rpcError: "AUTH" }),
    });
    assert.equal(failed.status, 500);
    assert.deepEqual(failed.json, { ok: false, errorKey: PHONE_SAVE_FAILED_KEY });
  }

  // TEST J — Success dedicated save failure stays on phone, not publish error
  {
    const outcome = applyDedicatedPhoneSaveOutcome({
      ok: false,
      errorKey: "error.submit_failed",
    });
    assert.equal(outcome.phoneSaved, false);
    assert.equal(outcome.phoneError, PHONE_SAVE_FAILED_KEY);
    assert.equal(outcome.publishErrorKey, null);

    const interpreted = interpretPhoneSaveResponse({
      ok: false,
      errorKey: "error.submit_failed",
    });
    assert.equal(interpreted.ok, false);
    if (!interpreted.ok) assert.equal(interpreted.errorKey, PHONE_SAVE_FAILED_KEY);

    const sheet = read("src/components/home/PublishBottomSheet.tsx");
    const saveFn = sheet.slice(
      sheet.indexOf("async function saveActivePhone"),
      sheet.indexOf("async function onPublish"),
    );
    assert.equal(saveFn.includes("setErrorKey"), false);
    assert.ok(saveFn.includes("setPhoneError"));
    assert.ok(saveFn.includes("error.phone_save_failed"));
    assert.ok(sheet.includes("phoneError={phoneError}"));
  }

  {
    const mapped = interpretProfilePhoneRpc({
      data: null,
      error: { code: "57014", message: "timeout" },
    });
    assert.equal(mapped.ok, false);
    if (!mapped.ok) {
      assert.equal(mapped.reason, "rpc_error");
      assert.equal(mapped.error.code, "57014");
    }
    assert.equal(interpretProfilePhoneRpc({ data: { ok: true }, error: null }).ok, true);
  }

  {
    const html = await readPhoneSaveResponse({ text: async () => "<html>oops</html>" });
    assert.equal(html.ok, false);
    if (!html.ok) assert.equal(html.errorKey, PHONE_SAVE_FAILED_KEY);
  }

  const page = read("src/app/[locale]/profile/page.tsx");
  {
    const savePhoneFn = page.slice(
      page.indexOf("async function savePhone"),
      page.indexOf("async function saveName"),
    );
    assert.ok(savePhoneFn.includes("error.phone_save_failed"));
    assert.equal(savePhoneFn.includes("error.submit_failed"), false);
    assert.equal(savePhoneFn.includes("setMessage"), false);
  }

  const zh = JSON.parse(read("src/messages/zh.json")) as { error: Record<string, string> };
  const en = JSON.parse(read("src/messages/en.json")) as { error: Record<string, string> };
  const sr = JSON.parse(read("src/messages/sr.json")) as { error: Record<string, string> };
  assert.equal(zh.error.phone_save_failed, "手机号保存失败，请稍后重试。");
  assert.equal(en.error.phone_save_failed, "Failed to save the phone number. Please try again.");
  assert.equal(sr.error.phone_save_failed, "Broj telefona nije sačuvan. Pokušajte ponovo.");

  console.log("accountPhoneSave.test.ts: ok");
}

void main();
