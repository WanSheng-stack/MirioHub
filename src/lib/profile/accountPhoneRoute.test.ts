/**
 * Account phone route orchestration (TEST A–B, G).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/profile/accountPhoneRoute.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAccountPhoneRoute } from "@/lib/profile/accountPhoneRoute";
import {
  clientJsonForPhoneWriteFailure,
  formatSafePhoneWriteLog,
  PHONE_SAVE_FAILED_KEY,
  type AccountPhoneWriteResult,
} from "@/lib/profile/accountPhoneWrite";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

async function main() {
  // TEST A — unauthenticated: 401 JSON, no admin, no writer
  {
    let adminCalls = 0;
    let writerCalls = 0;
    const result = await runAccountPhoneRoute({
      getUserId: async () => null,
      readBody: async () => ({
        phone_country: "RS",
        raw_phone_local: "653228255",
        user_id: "attacker",
      }),
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
    assert.equal(adminCalls, 0);
    assert.equal(writerCalls, 0);
    assert.equal(JSON.stringify(result.json).includes("<html"), false);
  }

  // TEST B — logged in, admin init fails: 500 JSON, no HTML, no secrets
  {
    let writerCalls = 0;
    const result = await runAccountPhoneRoute({
      getUserId: async () => "session-user",
      readBody: async () => ({ phone_country: "RS", raw_phone_local: "653228255" }),
      createAdmin: () => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
      },
      writePhone: async () => {
        writerCalls += 1;
        return { ok: true };
      },
    });
    assert.equal(result.status, 500);
    assert.deepEqual(result.json, { ok: false, errorKey: "error.server_configuration" });
    const browser = JSON.stringify(result.json);
    assert.equal(browser.includes("<html"), false);
    assert.equal(browser.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
    assert.equal(browser.includes("not configured"), false);
    assert.equal(browser.includes("service_role"), false);
    assert.equal(browser.includes("NEXT_PUBLIC"), false);
    assert.equal(writerCalls, 0);
  }

  // TEST G — Account-only save calls the profile writer, not phone_history/posts
  {
    const writes: Array<{ userId: string; phone: string }> = [];
    const result = await runAccountPhoneRoute({
      getUserId: async () => "session-user",
      readBody: async () => ({ phone_country: "RS", raw_phone_local: "653228255" }),
      createAdmin: () => ({ kind: "admin" }),
      writePhone: async (_admin, userId, phone) => {
        writes.push({ userId, phone });
        return { ok: true };
      },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(writes, [{ userId: "session-user", phone: "381653228255" }]);
    const route = read("src/app/api/profile/phone/route.ts");
    assert.equal(route.includes("phone_history"), false);
    assert.equal(route.includes("upsertPhoneHistory"), false);
    assert.equal(route.includes('.from("posts")'), false);
    assert.ok(route.includes("writeAccountPhone"));
  }

  // TEST C/D wiring through the route orchestrator
  {
    const rpcError: AccountPhoneWriteResult = {
      ok: false,
      reason: "rpc_error",
      error: {
        code: "42883",
        message: "function missing",
        details: "Failing row contains (..., 381653228255, ...)",
        hint: "retry with 381653228255",
      },
    };
    const result = await runAccountPhoneRoute({
      getUserId: async () => "session-user",
      readBody: async () => ({ phone_country: "RS", raw_phone_local: "653228255" }),
      createAdmin: () => ({}),
      writePhone: async () => rpcError,
    });
    assert.equal(result.status, 500);
    assert.deepEqual(result.json, { ok: false, errorKey: PHONE_SAVE_FAILED_KEY });
    const browser = JSON.stringify(result.json);
    assert.equal(browser.includes("42883"), false);
    assert.equal(browser.includes("function missing"), false);
    assert.equal(browser.includes("381653228255"), false);
    assert.equal(browser.includes("hint"), false);
    assert.equal(browser.includes("details"), false);
  }

  {
    const rejected = await runAccountPhoneRoute({
      getUserId: async () => "session-user",
      readBody: async () => ({ phone_country: "RS", raw_phone_local: "653228255" }),
      createAdmin: () => ({}),
      writePhone: async () => ({ ok: false, reason: "rpc_rejected", rpcError: "NOT_FOUND" }),
    });
    assert.equal(rejected.status, 500);
    assert.deepEqual(rejected.json, { ok: false, errorKey: PHONE_SAVE_FAILED_KEY });
    assert.equal(JSON.stringify(rejected.json).includes("NOT_FOUND"), false);
  }

  // TEST F helper: structured failure kept for logs, browser only gets errorKey
  {
    const failure: AccountPhoneWriteResult = {
      ok: false,
      reason: "rpc_error",
      error: {
        code: "P0001",
        message: "boom",
        details: "Failing row contains (..., 381653228255, ...)",
        hint: "retry with 381653228255",
      },
    };
    assert.equal(failure.ok, false);
    const json = clientJsonForPhoneWriteFailure();
    assert.deepEqual(json, { ok: false, errorKey: PHONE_SAVE_FAILED_KEY });
    const log = formatSafePhoneWriteLog(failure);
    assert.equal(log.reason, "rpc_error");
    const serialized = JSON.stringify({ json, log });
    assert.equal(serialized.includes("381653228255"), false);
    assert.equal(serialized.includes("details"), false);
    assert.equal(serialized.includes("hint"), false);
  }

  const zh = JSON.parse(read("src/messages/zh.json")) as { error: Record<string, string> };
  const en = JSON.parse(read("src/messages/en.json")) as { error: Record<string, string> };
  const sr = JSON.parse(read("src/messages/sr.json")) as { error: Record<string, string> };
  assert.equal(zh.error.server_configuration, "服务暂时不可用，请稍后重试。");
  assert.equal(
    en.error.server_configuration,
    "The service is temporarily unavailable. Please try again later.",
  );
  assert.equal(sr.error.server_configuration, "Usluga trenutno nije dostupna. Pokušajte ponovo kasnije.");

  console.log("accountPhoneRoute.test.ts: ok");
}

void main();
