/**
 * PHASE 6.5 ADDENDUM: Account / Success identity semantics.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/auth/accountIdentityState.test.ts
 */

import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { resolveAccountIdentityState } from "@/lib/auth/accountIdentityState";

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

const emailOnly = resolveAccountIdentityState(
  user({
    identities: [{ provider: "email", identity_data: { email: "custom@example.com" } }],
    email: "custom@example.com",
    email_confirmed_at: "2026-09-01T00:00:00Z",
  }),
);
assert.equal(emailOnly.hasGoogle, false);
assert.equal(emailOnly.googleIdentityEmail, null);
assert.equal(emailOnly.hasVerifiedEmail, true);
assert.equal(emailOnly.verifiedAccountEmail, "custom@example.com");
assert.equal(emailOnly.emailsMatch, false);

const sameGoogle = resolveAccountIdentityState(
  user({
    identities: [{ provider: "google", identity_data: { email: "joy@gmail.com" } }],
    email: "joy@gmail.com",
    email_confirmed_at: "2026-09-01T00:00:00Z",
  }),
);
assert.equal(sameGoogle.hasGoogle, true);
assert.equal(sameGoogle.googleIdentityEmail, "joy@gmail.com");
assert.equal(sameGoogle.verifiedAccountEmail, "joy@gmail.com");
assert.equal(sameGoogle.emailsMatch, true);

const different = resolveAccountIdentityState(
  user({
    identities: [{ provider: "google", identity_data: { email: "joy@gmail.com" } }],
    email: "work@example.com",
    email_confirmed_at: "2026-09-01T00:00:00Z",
  }),
);
assert.equal(different.hasGoogle, true);
assert.equal(different.googleIdentityEmail, "joy@gmail.com");
assert.equal(different.verifiedAccountEmail, "work@example.com");
assert.equal(different.emailsMatch, false);

const googleWithoutIdentityEmail = resolveAccountIdentityState(
  user({
    identities: [{ provider: "google", identity_data: {} }],
    email: "fallback@example.com",
    email_confirmed_at: "2026-09-01T00:00:00Z",
  }),
);
assert.equal(googleWithoutIdentityEmail.hasGoogle, true);
assert.equal(googleWithoutIdentityEmail.googleIdentityEmail, null);
assert.equal(googleWithoutIdentityEmail.verifiedAccountEmail, "fallback@example.com");

const unconfirmedAccountEmail = resolveAccountIdentityState(
  user({
    identities: [],
    email: "pending@example.com",
    email_confirmed_at: null,
  }),
);
assert.equal(unconfirmedAccountEmail.hasVerifiedEmail, false);
assert.equal(unconfirmedAccountEmail.verifiedAccountEmail, null);
assert.equal(unconfirmedAccountEmail.hasGoogle, false);

console.log("accountIdentityState.test.ts: all passed");
