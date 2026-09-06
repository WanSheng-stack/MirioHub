/**
 * PHASE 6.4S — public-safe post projection contract.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/posts/publicPostSelect.test.ts
 */

import assert from "node:assert/strict";
import {
  FORBIDDEN_PUBLIC_POST_COLUMNS,
  OWNER_POST_SELECT,
  PUBLIC_SAFE_POST_COLUMNS,
  PUBLIC_SAFE_POST_SELECT,
  publicSelectContainsForbidden,
} from "@/lib/posts/publicPostSelect";

for (const col of FORBIDDEN_PUBLIC_POST_COLUMNS) {
  assert.equal(
    PUBLIC_SAFE_POST_COLUMNS.includes(col as (typeof PUBLIC_SAFE_POST_COLUMNS)[number]),
    false,
    `safe columns must not include ${col}`,
  );
  assert.equal(
    PUBLIC_SAFE_POST_SELECT.split(",").map((c) => c.trim()).includes(col),
    false,
    `PUBLIC_SAFE_POST_SELECT must not include ${col}`,
  );
}

assert.equal(publicSelectContainsForbidden(PUBLIC_SAFE_POST_SELECT), false);
assert.equal(publicSelectContainsForbidden(`${PUBLIC_SAFE_POST_SELECT}, raw_phone`), true);

assert.ok(OWNER_POST_SELECT.includes("raw_phone"));
assert.ok(OWNER_POST_SELECT.includes("normalized_phone"));
assert.ok(OWNER_POST_SELECT.includes("id"));

console.log("publicPostSelect.test.ts: ok");
