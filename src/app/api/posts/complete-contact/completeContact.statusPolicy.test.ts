/**
 * Complete-contact status/control-flow contract.
 * Run: npx tsx --tsconfig tsconfig.json src/app/api/posts/complete-contact/completeContact.statusPolicy.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const route = read("src/app/api/posts/complete-contact/route.ts");

const phoneParse = route.indexOf("parseUserPhone({");
const demandPhoneGuard = route.indexOf('if (post.post_type === "demand")');
const demandPhoneCheck = route.indexOf(
  "await evaluateCompleteContactDemandPhoneIntercept",
);
const demandPhoneDeny = route.indexOf("if (!phoneIntercept.allowed)");
const historyWrite = route.indexOf("phoneId = await upsertPhoneHistory");
const draftGuard = route.indexOf('if (post.status === "draft")');
const activationRisk = route.indexOf("await evaluateStage1ActivePublicationRisk");
const rpc = route.indexOf('"complete_post_contact_v102"');
const activateArg = route.indexOf("p_activate: wantActivate");
const riskResponse = route.indexOf("if (riskErrorKey)", rpc);
const firstProfileWrite = route.indexOf("await persistAccountCurrentPhone", riskResponse);
const successResponse = route.indexOf("normalizedPhone: normalizedPhoneForPost", rpc);

// Active Demand contact-only: parse, run only the dedicated foreign-phone
// check, then persist with wantActivate's false default.
assert.ok(phoneParse > 0 && demandPhoneGuard > phoneParse);
assert.ok(demandPhoneCheck > demandPhoneGuard && demandPhoneCheck < historyWrite);
assert.ok(demandPhoneDeny > demandPhoneCheck && demandPhoneDeny < historyWrite);
assert.ok(route.indexOf("return NextResponse.json(", demandPhoneDeny) < historyWrite);
assert.ok(route.indexOf("let wantActivate = false") > historyWrite);
assert.equal(route.includes("evaluatePublishIntercept("), false);
assert.ok(rpc > draftGuard && activateArg > rpc);

// Provider contact skips the Demand-only guard and therefore cannot execute
// fresh-publish supply-count limits.
assert.equal(route.includes("countActiveSupplyPosts"), false);
assert.equal(route.includes("active_supply_posts_count"), false);

// Draft risk is evaluated before RPC solely to choose p_activate. A denial is
// recorded, not returned early; RPC and profile persistence precede the error.
assert.ok(draftGuard > historyWrite);
assert.ok(activationRisk > draftGuard && activationRisk < rpc);
assert.ok(route.indexOf("riskErrorKey = risk.errorKey") < rpc);
assert.ok(route.indexOf("wantActivate = false", activationRisk) < rpc);
assert.ok(route.indexOf("wantActivate = true", activationRisk) < rpc);
assert.ok(riskResponse > rpc);
assert.ok(firstProfileWrite > riskResponse);
assert.ok(route.indexOf("errorKey: riskErrorKey", firstProfileWrite) > firstProfileWrite);

// Allowed draft and active contact completion both reach the same RPC/profile
// success path. The RPC receives the activation decision rather than forcing it.
assert.ok(activateArg > rpc);
assert.ok(successResponse > firstProfileWrite);

// Fresh-publish Stage-1 risk remains present in all actual publication paths.
for (const rel of [
  "src/app/api/posts/trusted-publish/route.ts",
  "src/app/api/auth/passkey/verify/route.ts",
  "src/app/api/posts/activate-after-identity/route.ts",
]) {
  assert.ok(read(rel).includes("evaluateStage1ActivePublicationRisk"), rel);
}
const sheet = read("src/components/home/PublishBottomSheet.tsx");
assert.ok(sheet.includes('fetch("/api/posts/shadow-draft"'));
assert.ok(sheet.includes('fetch("/api/posts/trusted-publish"'));
assert.ok(sheet.includes('fetch("/api/auth/passkey/verify"'));

console.log("completeContact.statusPolicy.test.ts: ok");
