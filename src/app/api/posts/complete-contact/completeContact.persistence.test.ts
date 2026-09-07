/**
 * PHASE 6.5B.2 — persist Account current phone on complete-contact.
 * Run: npx tsx --tsconfig tsconfig.json src/app/api/posts/complete-contact/completeContact.persistence.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const routeSrc = read("src/app/api/posts/complete-contact/route.ts");
const sheetSrc = read("src/components/home/PublishBottomSheet.tsx");
const readinessSrc = read("src/lib/auth/postPublishReadiness.ts");
const upsertSrc = read("src/lib/post-form/submitPost.ts");

// TEST 1 — phone save writes history, this post, then profiles.phone
assert.ok(routeSrc.includes("upsertPhoneHistory"));
assert.ok(routeSrc.includes("persistAccountCurrentPhone"));
assert.ok(routeSrc.includes("writeAccountPhone"));
assert.equal(routeSrc.includes("update_my_profile"), false);
{
  const historyCall = routeSrc.indexOf("phoneId = await upsertPhoneHistory");
  const persistSection = routeSrc.indexOf("// ── Persist");
  const lastProfilePersist = routeSrc.lastIndexOf("await persistAccountCurrentPhone");
  assert.ok(historyCall > 0);
  assert.ok(persistSection > historyCall);
  assert.ok(lastProfilePersist > persistSection);
}

// Normalized canonical phone — not the UI raw string
assert.ok(routeSrc.includes("normalizedPhoneForPost = phoneResult.normalizedDigits"));
assert.equal(routeSrc.includes("p_phone:"), false);
assert.equal(routeSrc.includes("p_phone: rawPhoneForPost"), false);
assert.equal(routeSrc.includes("p_phone: raw_phone_local"), false);

// Ownership: session user only; browser cannot pass user_id for profile write
{
  const bodyBlock = routeSrc.slice(
    routeSrc.indexOf("interface RequestBody"),
    routeSrc.indexOf("// POST handler"),
  );
  assert.equal(bodyBlock.includes("user_id"), false);
}
assert.ok(routeSrc.includes("writeAccountPhone"));
assert.ok(read("supabase/init.sql").includes("where id = auth.uid();"));

// This post only — do not rewrite other posts' phone_id
assert.ok(routeSrc.includes(".eq('id', postId)"));
assert.ok(routeSrc.includes(".eq('user_id', user.id)"));
assert.equal(routeSrc.includes(".in('id'"), false);

// TEST 1 continued — history upsert still keyed by user + normalized phone
assert.ok(upsertSrc.includes('.from("phone_history")'));
assert.ok(upsertSrc.includes("normalized_phone: normalizedPhone"));
assert.ok(upsertSrc.includes(".eq(\"user_id\", userId)"));

// API returns normalizedPhone only when a phone was saved
assert.ok(routeSrc.includes("normalizedPhone: normalizedPhoneForPost"));
assert.ok(routeSrc.includes("return NextResponse.json({ ok: true, postId, isActive });"));

// Profile failure after post success is not reported as ok:true
assert.ok(routeSrc.includes("writeAccountPhone"));
assert.ok(routeSrc.includes("if (!profileWrite.ok)"));
assert.ok(routeSrc.includes("formatSafePhoneWriteLog(profileWrite)"));
assert.ok(routeSrc.includes("[complete-contact] set_profile_phone_v87 failed"));
assert.ok(routeSrc.includes("clientJsonForPhoneWriteFailure"));
assert.ok(routeSrc.includes("If profile persist fails after post update"));
{
  const fraud = routeSrc.indexOf("const intercept = await evaluatePublishIntercept");
  const history = routeSrc.indexOf("phoneId = await upsertPhoneHistory");
  const persist = routeSrc.indexOf("// ── Persist");
  const profile = routeSrc.lastIndexOf("await persistAccountCurrentPhone");
  assert.ok(fraud > 0 && history > fraud && persist > history && profile > persist);
}

// TEST 2/3/4 — next publish still reads profiles.phone, not post snapshot
assert.ok(readinessSrc.includes("hasValidContactPhone(input.profilePhone)"));
assert.equal(readinessSrc.includes("raw_phone"), false);
assert.ok(sheetSrc.includes('.from("profiles")'));
assert.ok(sheetSrc.includes('.select("phone")'));
assert.ok(sheetSrc.includes("profilePhone: phone"));

// React state uses API canonical phone, not concatenated UI digits
{
  const saveFn = sheetSrc.slice(
    sheetSrc.indexOf("async function saveActivePhone"),
    sheetSrc.indexOf("async function onPublish"),
  );
  assert.ok(saveFn.includes("normalizedPhone"));
  assert.ok(saveFn.includes("setProfilePhone(interpreted.normalizedPhone)"));
  assert.ok(saveFn.includes("phone_country"));
  assert.ok(saveFn.includes("parseUserPhone"));
  assert.equal(saveFn.includes("setErrorKey"), false);
  assert.equal(saveFn.includes("dial_code}${state.raw_phone_local"), false);
  assert.equal(saveFn.includes("savedDigits"), false);
}

assert.ok(routeSrc.includes("parseUserPhone"));
assert.ok(routeSrc.includes("phone_country"));
assert.ok(routeSrc.includes("normalizedDigits"));

console.log("completeContact.persistence.test.ts: ok");
