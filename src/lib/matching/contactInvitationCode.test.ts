/**
 * PHASE 6.7C.1B — HMAC match-request contact-code core.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/matching/contactInvitationCode.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTACT_CODE_HASH_DOMAIN,
  CONTACT_CODE_DOMAIN,
  DELIVERY_CODE_DOMAIN,
  generateContactInvitationCode,
  isContactCode,
  isContactCodeHash,
  pepperIsUsable,
} from "@/lib/matching/contactInvitationCodeCore";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const wrapper = readFileSync(
  join(repoRoot, "src/lib/matching/contactInvitationCode.ts"),
  "utf8",
);
const route = readFileSync(
  join(repoRoot, "src/app/api/matching/requests/route.ts"),
  "utf8",
);

const PEPPER = "miriohub-contact-code-pepper-32chars!!";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CLIENT_A = "55555555-5555-4555-8555-555555555555";
const CLIENT_B = "66666666-6666-4666-8666-666666666666";
const REVISION = "77777777-7777-4777-8777-777777777777";
const DEMAND = "33333333-3333-4333-8333-333333333333";
const PROVIDER = "44444444-4444-4444-8444-444444444444";

function pair(overrides: Partial<Parameters<typeof generateContactInvitationCode>[0]> = {}) {
  return generateContactInvitationCode({
    pepper: PEPPER,
    actorUserId: ACTOR,
    clientRequestId: CLIENT_A,
    clientRevisionId: REVISION,
    initiatorPostId: DEMAND,
    counterpartPostId: PROVIDER,
    ...overrides,
  });
}

assert.equal(pepperIsUsable("short"), false);
assert.equal(pepperIsUsable(PEPPER), true);
assert.throws(() =>
  generateContactInvitationCode({
    pepper: "too-short",
    actorUserId: ACTOR,
    clientRequestId: CLIENT_A,
    clientRevisionId: REVISION,
    initiatorPostId: DEMAND,
    counterpartPostId: PROVIDER,
  }),
);

const first = pair();
const again = pair();
assert.deepEqual(first, again);
assert.equal(isContactCode(first.code), true);
assert.equal(isContactCodeHash(first.codeHash), true);
assert.notEqual(pair({ clientRequestId: CLIENT_B }).codeHash, first.codeHash);
assert.notEqual(pair({ actorUserId: OTHER }).codeHash, first.codeHash);
assert.notEqual(pair({ clientRevisionId: CLIENT_B }).codeHash, first.codeHash);

assert.ok(CONTACT_CODE_DOMAIN.startsWith("miriohub:match-request-code:v1:"));
assert.ok(CONTACT_CODE_HASH_DOMAIN.startsWith("miriohub:match-request-code-hash:v1:"));
assert.ok(DELIVERY_CODE_DOMAIN.startsWith("miriohub:delivery-code:v1:"));
assert.notEqual(CONTACT_CODE_DOMAIN, DELIVERY_CODE_DOMAIN);
assert.ok(wrapper.includes('import "server-only"'));
assert.ok(wrapper.includes("MATCH_CONTACT_CODE_PEPPER"));
assert.equal(wrapper.includes("NEXT_PUBLIC_MATCH_CONTACT_CODE_PEPPER"), false);
assert.ok(route.includes("contactInvitationCode"));
assert.equal(route.includes("Math.random"), false);

let sawLeadingZero = false;
for (let i = 0; i < 400; i += 1) {
  const id = `55555555-5555-4555-8555-${(i + 1).toString().padStart(12, "0")}`;
  const generated = pair({ clientRequestId: id });
  if (generated.code.startsWith("0")) {
    sawLeadingZero = true;
    break;
  }
}
assert.equal(sawLeadingZero, true);

console.log("contactInvitationCode.test.ts: ok");
