/**
 * PHASE 6.5B.1 — post-publish Success vs Match Hall routing.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/auth/postPublishReadiness.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { User } from "@supabase/supabase-js";
import { resolveAccountIdentityState } from "@/lib/auth/accountIdentityState";
import { resolvePostPublishReadiness } from "@/lib/auth/postPublishReadiness";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function user(partial: {
  identities?: Array<{ provider: string; identity_data?: Record<string, unknown> }>;
  email?: string | null;
  email_confirmed_at?: string | null;
}): User {
  return {
    id: "u1",
    is_anonymous: false,
    identities: partial.identities ?? [],
    email: partial.email ?? undefined,
    email_confirmed_at: partial.email_confirmed_at ?? undefined,
  } as unknown as User;
}

function ready(opts: {
  google?: boolean;
  verifiedEmail?: boolean;
  passkey?: boolean;
  phone?: string | null;
}) {
  const u = user({
    identities: opts.google
      ? [{ provider: "google", identity_data: { email: "joy@gmail.com" } }]
      : [],
    email: opts.verifiedEmail ? "work@example.com" : "pending@example.com",
    email_confirmed_at: opts.verifiedEmail ? "2026-09-01T00:00:00Z" : null,
  });
  return resolvePostPublishReadiness({
    identity: resolveAccountIdentityState(u, { has_passkey: opts.passkey ?? false }),
    profilePhone: opts.phone,
  });
}

// TEST 1 — fresh user
{
  const r = ready({});
  assert.equal(r.hasRecoveryIdentity, false);
  assert.equal(r.hasContactPhone, false);
  assert.equal(r.shouldShowCompletionStep, true);
  assert.equal(r.shouldGoDirectlyToMatches, false);
}

// TEST 2 — Google, no phone
{
  const r = ready({ google: true, phone: null });
  assert.equal(r.hasRecoveryIdentity, true);
  assert.equal(r.hasContactPhone, false);
  assert.equal(r.shouldShowCompletionStep, true);
}

// TEST 3 — verified email + phone
{
  const r = ready({ verifiedEmail: true, phone: "+381641234567" });
  assert.equal(r.shouldGoDirectlyToMatches, true);
  assert.equal(r.shouldShowCompletionStep, false);
}

// TEST 4 — Google + phone
{
  const r = ready({ google: true, phone: "381641234567" });
  assert.equal(r.shouldGoDirectlyToMatches, true);
}

// Passkey alone is not cross-device recovery
{
  const r = ready({ passkey: true, phone: "381641234567" });
  assert.equal(r.hasRecoveryIdentity, false);
  assert.equal(r.shouldGoDirectlyToMatches, false);
}

const successSrc = read("src/components/home/PublishedPostSuccess.tsx");
assert.equal(successSrc.includes("onViewMatches"), true);
assert.equal(/home\.sheet\.back|setStage\(1\)/.test(successSrc), false);
assert.ok(successSrc.includes("viewMatches"));
assert.ok(successSrc.includes("skip"));

const sheetSrc = read("src/components/home/PublishBottomSheet.tsx");
assert.ok(sheetSrc.includes("completeActivePublish"));
assert.ok(sheetSrc.includes("/posts/${postId}/matches"));
assert.ok(sheetSrc.includes("resolvePostPublishReadiness"));
assert.ok(sheetSrc.includes("handleViewMatches"));
assert.ok(sheetSrc.includes("handleViewPublishedPost"));
assert.ok(sheetSrc.includes("handleSheetDismiss"));
assert.ok(sheetSrc.includes("profiles"));
assert.ok(sheetSrc.includes("phone"));

// TEST 5–6: Skip and View matches both go to matches, after capturing postId
assert.ok(sheetSrc.includes("onSkip={handleViewMatches}"));
assert.ok(sheetSrc.includes("onViewMatches={handleViewMatches}"));
assert.match(
  sheetSrc,
  /function handleViewMatches\(\) \{\s*const postId = pendingPostId;\s*finishActivePublishIntent\(\);\s*onClose\(\);\s*if \(postId\) router\.push\(`\/posts\/\$\{postId\}\/matches`\);/,
);

// TEST 7: X/backdrop does not push matches
const dismissSrc = sheetSrc.slice(
  sheetSrc.indexOf("function handleSheetDismiss"),
  sheetSrc.indexOf("function handleViewMatches"),
);
assert.ok(dismissSrc.includes("finishActivePublishIntent()"));
assert.ok(dismissSrc.includes("onClose()"));
assert.equal(dismissSrc.includes("/matches"), false);

// TEST 8: View post goes to detail
assert.match(
  sheetSrc,
  /function handleViewPublishedPost[\s\S]*\/posts\/\$\{postId\}/,
);

// Active Success footer Back is not shown
assert.ok(sheetSrc.includes("isActiveSuccess"));
assert.ok(sheetSrc.includes("stage === 2 && !isActiveSuccess"));

console.log("postPublishReadiness.test.ts: ok");
