/**
 * PHASE 6.2: fill-if-empty name helpers + PGRST303 detector.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/auth/googleProfileName.test.ts
 */

import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import {
  isProfileFullNameEmpty,
  resolveGoogleDisplayName,
} from "@/lib/auth/googleProfileName";
import { isPgrst303 } from "@/lib/auth/readWithClockSkewRetry";

function googleUser(overrides: {
  meta?: Record<string, unknown>;
  identity?: Record<string, unknown>;
}): User {
  return {
    id: "94ab7bdd-8f37-44b8-a03d-5f61d5cf168c",
    is_anonymous: false,
    user_metadata: overrides.meta ?? {},
    identities: [
      {
        provider: "google",
        identity_data: overrides.identity ?? {},
      },
    ],
  } as User;
}

assert.equal(isProfileFullNameEmpty(null), true);
assert.equal(isProfileFullNameEmpty(""), true);
assert.equal(isProfileFullNameEmpty("   "), true);
assert.equal(isProfileFullNameEmpty("MirioHub Test User"), false);

assert.equal(
  resolveGoogleDisplayName(googleUser({ meta: { full_name: "guiqiong nan" } })),
  "guiqiong nan",
);
assert.equal(
  resolveGoogleDisplayName(googleUser({ meta: { name: "Google Person" } })),
  "Google Person",
);
assert.equal(
  resolveGoogleDisplayName(
    googleUser({ identity: { full_name: "guiqiong nan" } }),
  ),
  "guiqiong nan",
);
assert.equal(
  resolveGoogleDisplayName({
    id: "x",
    is_anonymous: true,
    user_metadata: { full_name: "Should Ignore" },
    identities: [],
  } as unknown as User),
  null,
);

assert.equal(isPgrst303({ code: "PGRST303" }), true);
assert.equal(isPgrst303({ message: "JWT issued at future" }), true);
assert.equal(isPgrst303({ code: "PGRST116" }), false);
assert.equal(isPgrst303(null), false);

console.log("googleProfileName + PGRST303 detector: ok");
