/**
 * Account phone route orchestration (TEST A–J).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/profile/accountPhoneRoute.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAccountPhoneRoute } from "@/lib/profile/accountPhoneRoute";
import { prepareAccountPhoneSave } from "@/lib/profile/accountPhoneSave";
import {
  clientJsonForPhoneWriteFailure,
  formatSafePhoneWriteLog,
  PHONE_SAVE_FAILED_KEY,
  runPhoneWriterSafely,
} from "@/lib/profile/accountPhoneWrite";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

async function main() {
  // TEST A — unauthenticated: no parse / write / admin
  {
    let adminCalls = 0;
    let writerCalls = 0;
    let bodyReads = 0;
    const result = await runAccountPhoneRoute({
      getUserId: async () => null,
      readBody: async () => {
        bodyReads += 1;
        return { phone_country: "RS", raw_phone_local: "653228255" };
      },
      createAdmin: () => {
        adminCalls += 1;
        return {};
      },
      writePhone: async () => {
        writerCalls += 1;
        return { ok: true };
      },
    });
    assert.equal(result.status, 401);
    assert.deepEqual(result.json, { ok: false, errorKey: "error.authentication_required" });
    assert.equal(bodyReads, 0);
    assert.equal(adminCalls, 0);
    assert.equal(writerCalls, 0);
  }

  // TEST B — invalid phone + admin would throw → 400, admin never created
  {
    let adminCalls = 0;
    const result = await runAccountPhoneRoute({
      getUserId: async () => "session-user",
      readBody: async () => ({ phone_country: "RS", raw_phone_local: "123456789" }),
      createAdmin: () => {
        adminCalls += 1;
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
      },
      writePhone: async () => ({ ok: true }),
    });
    assert.equal(result.status, 400);
    assert.deepEqual(result.json, { ok: false, errorKey: "error.invalid_phone" });
    assert.equal(adminCalls, 0);
    assert.equal(prepareAccountPhoneSave({ phone_country: "RS", raw_phone_local: "123456789" }).ok, false);
  }

  // TEST C — invalid JSON before admin
  {
    let adminCalls = 0;
    const result = await runAccountPhoneRoute({
      getUserId: async () => "session-user",
      readBody: async () => {
        throw new SyntaxError("Unexpected token");
      },
      createAdmin: () => {
        adminCalls += 1;
        return {};
      },
      writePhone: async () => ({ ok: true }),
    });
    assert.equal(result.status, 400);
    assert.deepEqual(result.json, { ok: false, errorKey: "error.invalid_request_body" });
    assert.equal(adminCalls, 0);
    assert.equal(JSON.stringify(result.json).includes("<html"), false);
  }

  // TEST D — valid phone + admin init throws
  {
    const result = await runAccountPhoneRoute({
      getUserId: async () => "session-user",
      readBody: async () => ({ phone_country: "RS", raw_phone_local: "653228255" }),
      createAdmin: () => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
      },
      writePhone: async () => ({ ok: true }),
    });
    assert.equal(result.status, 500);
    assert.deepEqual(result.json, { ok: false, errorKey: "error.server_configuration" });
    const browser = JSON.stringify(result.json);
    assert.equal(browser.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
    assert.equal(browser.includes("not configured"), false);
    assert.equal(browser.includes("service_role"), false);
    assert.equal(browser.includes("<html"), false);
  }

  // TEST E / F — formatted phones never enter the safe log
  {
    for (const message of ["+381 65 322 8255", "+381-65-322-8255"]) {
      const log = formatSafePhoneWriteLog({
        ok: false,
        reason: "rpc_error",
        error: { code: "23514", message, details: message, hint: message },
      });
      const serialized = JSON.stringify(log);
      assert.deepEqual(Object.keys(log), ["reason", "error"]);
      assert.equal("message" in (log.error ?? {}), false);
      assert.equal(serialized.includes(message), false);
      assert.equal(serialized.includes("381"), false);
      assert.equal(serialized.includes("322"), false);
      assert.equal(serialized.includes("8255"), false);
    }
  }

  // TEST G — details/hint/failing row dropped; only reason + whitelist code
  {
    const log = formatSafePhoneWriteLog({
      ok: false,
      reason: "rpc_error",
      error: {
        code: "23514",
        message: "new row for relation profiles violates check constraint",
        details: "Failing row contains (..., 381653228255, ...)",
        hint: "retry with +381 65 322 8255",
      },
    });
    assert.deepEqual(log, { reason: "rpc_error", error: { code: "23514" } });
    const serialized = JSON.stringify(log);
    assert.equal(serialized.includes("message"), false);
    assert.equal(serialized.includes("details"), false);
    assert.equal(serialized.includes("hint"), false);
    assert.equal(serialized.includes("Failing row"), false);
    assert.equal(serialized.includes("381653228255"), false);
  }

  // TEST H — writer unexpected throw → phone_save_failed, not server_configuration
  {
    let threwLog = 0;
    let configLog = 0;
    const result = await runAccountPhoneRoute({
      getUserId: async () => "session-user",
      readBody: async () => ({ phone_country: "RS", raw_phone_local: "653228255" }),
      createAdmin: () => ({}),
      writePhone: async () => {
        throw new Error("fetch failed: ECONNRESET stack=secret");
      },
      onWriterThrow: () => {
        threwLog += 1;
      },
      onConfigFailure: () => {
        configLog += 1;
      },
    });
    assert.equal(result.status, 500);
    assert.deepEqual(result.json, { ok: false, errorKey: PHONE_SAVE_FAILED_KEY });
    assert.notEqual(result.json.errorKey, "error.server_configuration");
    assert.equal(threwLog, 1);
    assert.equal(configLog, 0);
    const browser = JSON.stringify(result.json);
    assert.equal(browser.includes("ECONNRESET"), false);
    assert.equal(browser.includes("stack"), false);
    const route = read("src/app/api/profile/phone/route.ts");
    assert.ok(route.includes('[api/profile/phone] phone writer threw'));
    assert.equal(route.includes("error.stack"), false);
  }

  // TEST I — complete-contact writer throw stays phone_save_failed
  {
    const result = await runPhoneWriterSafely(
      async () => {
        throw new Error("network exploded 381653228255");
      },
      () => undefined,
    );
    assert.equal(result.ok, false);
    const json = clientJsonForPhoneWriteFailure();
    assert.deepEqual(json, { ok: false, errorKey: PHONE_SAVE_FAILED_KEY });
    assert.equal(JSON.stringify(json).includes("submit_failed"), false);
    assert.equal(JSON.stringify(json).includes("exploded"), false);
    const complete = read("src/app/api/posts/complete-contact/route.ts");
    assert.ok(complete.includes("runPhoneWriterSafely"));
    assert.ok(complete.includes("[complete-contact] phone writer threw"));
    assert.ok(complete.includes("clientJsonForPhoneWriteFailure"));
    assert.equal(/phone writer threw[\s\S]*error\.message/.test(complete), false);
  }

  // TEST J — valid Account save: admin only after parse; profile writer only
  {
    const order: string[] = [];
    const writes: Array<{ userId: string; phone: string }> = [];
    const result = await runAccountPhoneRoute({
      getUserId: async () => "session-user",
      readBody: async () => ({ phone_country: "RS", raw_phone_local: "653228255", user_id: "nope" }),
      createAdmin: () => {
        order.push("admin");
        return { kind: "admin" };
      },
      writePhone: async (_admin, userId, phone) => {
        order.push("write");
        writes.push({ userId, phone });
        return { ok: true };
      },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(order, ["admin", "write"]);
    assert.deepEqual(writes, [{ userId: "session-user", phone: "381653228255" }]);
    const prepared = prepareAccountPhoneSave({
      phone_country: "RS",
      raw_phone_local: "653228255",
    });
    assert.equal(prepared.ok, true);
    const route = read("src/app/api/profile/phone/route.ts");
    assert.equal(route.includes("phone_history"), false);
    assert.equal(route.includes("upsertPhoneHistory"), false);
    assert.equal(route.includes('.from("posts")'), false);
    assert.ok(route.includes("writeAccountPhone"));
    assert.ok(read("src/lib/profile/accountPhoneRoute.ts").includes("prepareAccountPhoneSave"));
  }

  console.log("accountPhoneRoute.test.ts: ok");
}

void main();
