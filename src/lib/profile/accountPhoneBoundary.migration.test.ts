/**
 * TEST K–N — migration is the only new DB source; init.sql matches 0e2cb24.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/profile/accountPhoneBoundary.migration.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const migration = read(
  "supabase/migrations/20260908000001_account_display_name_and_phone_boundary.sql",
);
const initSql = read("supabase/init.sql");

function sliceFn(src: string, startNeedle: string, nextNeedles: string[]): string {
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, `missing ${startNeedle}`);
  let end = src.length;
  for (const next of nextNeedles) {
    const i = src.indexOf(next, start + startNeedle.length);
    if (i >= 0 && i < end) end = i;
  }
  return src.slice(start, end);
}

// TEST I — no phone CHECK / trigger; handle_new_user + ACL remain
assert.equal(migration.includes("profiles_phone_canonical_digits"), false);
assert.equal(migration.includes("ADD CONSTRAINT"), false);
assert.equal(migration.includes("NOT VALID"), false);
assert.equal(migration.includes("VALIDATE CONSTRAINT"), false);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?TRIGGER/i.test(migration), false);
assert.equal(/phone.*TRIGGER/i.test(migration), false);

// TEST L — handle_new_user does not read metadata phone
const handleNew = sliceFn(migration, "CREATE OR REPLACE FUNCTION public.handle_new_user()", [
  "CREATE OR REPLACE FUNCTION public.ensure_my_display_name",
]);
assert.equal(handleNew.includes("raw_user_meta_data ->> 'phone'"), false);
assert.ok(handleNew.includes("''"));

// TEST M — init.sql matches 0e2cb24 (git-normalized; required: no diff)
const initDiff = execFileSync(
  "git",
  ["diff", "0e2cb24e9a8d810925e8fc9a7b002b1f1aa56d63", "--", "supabase/init.sql"],
  { cwd: repoRoot, encoding: "utf8" },
);
assert.equal(initDiff, "");

// TEST N — new DB objects live only in this migration, not init.sql
assert.ok(migration.includes("generate_mirio_display_name"));
assert.ok(migration.includes("ensure_my_display_name(p_preferred text DEFAULT NULL)"));
assert.ok(
  migration.includes("DROP FUNCTION IF EXISTS public.update_my_profile(text, text, text, text, text, text)"),
);
const fiveArg = sliceFn(
  migration,
  "CREATE OR REPLACE FUNCTION public.update_my_profile(\n  p_full_name text,\n  p_plate text,",
  ["CREATE OR REPLACE FUNCTION public.set_profile_phone_v87"],
);
assert.ok(fiveArg.includes("p_full_name text"));
assert.ok(fiveArg.includes("p_plate text"));
assert.ok(fiveArg.includes("p_vehicle text"));
assert.ok(fiveArg.includes("p_facebook text"));
assert.ok(fiveArg.includes("p_viber text"));
assert.equal(fiveArg.includes("p_phone"), false);
assert.ok(migration.includes("set_profile_phone_v87(p_user_id uuid, p_phone text)"));
assert.ok(migration.includes("GRANT EXECUTE ON FUNCTION public.set_profile_phone_v87(uuid, text) TO service_role"));
assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.set_profile_phone_v87(uuid, text) FROM anon"));
assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.set_profile_phone_v87(uuid, text) FROM authenticated"));
assert.ok(migration.includes("SET search_path = public, pg_temp"));

assert.equal(initSql.includes("generate_mirio_display_name"), false);
assert.equal(initSql.includes("ensure_my_display_name"), false);
assert.equal(initSql.includes("set_profile_phone_v87"), false);
assert.ok(initSql.includes("p_phone text"));

console.log("accountPhoneBoundary.migration.test.ts: ok");
