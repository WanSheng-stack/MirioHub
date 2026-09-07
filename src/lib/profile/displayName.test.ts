/**
 * Account display-name inline edit + stable default nickname.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/profile/displayName.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISPLAY_NAME_MAX,
  NAME_REQUIRED_KEY,
  accountNameHeaderChrome,
  applyEmptyNameWrite,
  applyEnsureNameToLocalProfile,
  applyNameSaveResult,
  beginNameEdit,
  cancelNameEdit,
  changeNameDraft,
  decideEnsureDisplayName,
  isGeneratedMirioNickname,
  isRpcOk,
  prepareNameSave,
  validateDisplayNameInput,
  visibleHeaderNameCopies,
} from "@/lib/profile/displayName";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

{
  const copies = visibleHeaderNameCopies({
    editing: false,
    headerName: "Alice",
    draft: "",
  });
  assert.deepEqual(copies, ["Alice"]);
  const chrome = accountNameHeaderChrome(false);
  assert.equal(chrome.showsHeading, true);
  assert.equal(chrome.showsInput, false);
  assert.equal(chrome.showsNameLabel, false);
  assert.equal(chrome.showsBelowSave, false);
  assert.equal(chrome.showsPencil, true);
  assert.equal(chrome.showsConfirm, false);
}

{
  const started = beginNameEdit("Alice");
  assert.equal(started.editing, true);
  assert.equal(started.draft, "Alice");
  const copies = visibleHeaderNameCopies({
    editing: true,
    headerName: "Alice",
    draft: started.draft,
  });
  assert.deepEqual(copies, ["Alice"]);
  const chrome = accountNameHeaderChrome(true);
  assert.equal(chrome.showsHeading, false);
  assert.equal(chrome.showsInput, true);
  assert.equal(chrome.showsNameLabel, false);
  assert.equal(chrome.showsBelowSave, false);
  assert.equal(chrome.showsConfirm, true);
  assert.equal(chrome.showsCancel, true);
  assert.equal(chrome.showsPencil, false);
}

{
  let state = beginNameEdit("Alice");
  state = changeNameDraft(state, "Bob");
  const prepared = prepareNameSave(state);
  assert.equal(prepared.ok, true);
  if (prepared.ok) assert.equal(prepared.name, "Bob");
}

{
  let state = beginNameEdit("Alice");
  state = changeNameDraft(state, "Changed");
  state = cancelNameEdit(state);
  assert.equal(state.editing, false);
  assert.equal(state.draft, "Alice");
}

{
  assert.equal(validateDisplayNameInput("   ").ok, false);
  assert.equal(validateDisplayNameInput("").ok, false);
  const blank = prepareNameSave(beginNameEdit("   "));
  assert.equal(blank.ok, false);
  if (!blank.ok) assert.equal(blank.errorKey, NAME_REQUIRED_KEY);
}

{
  let state = beginNameEdit("Alice");
  state = changeNameDraft(state, "Bob");
  state = applyNameSaveResult(state, false);
  assert.equal(state.editing, true);
  assert.equal(state.draft, "Bob");
  state = applyNameSaveResult(state, true);
  assert.equal(state.editing, false);
  assert.equal(state.draft, "Bob");
}

{
  assert.equal(isRpcOk({ message: "fail" }, { ok: true }), false);
  assert.equal(isRpcOk(null, { ok: false }), false);
  assert.equal(isRpcOk(null, { ok: true }), true);
}

{
  const generated = decideEnsureDisplayName({ currentDbName: "", preferredGoogle: null });
  assert.equal(generated.action, "generate");
  const google = decideEnsureDisplayName({
    currentDbName: "",
    preferredGoogle: "Google User",
  });
  assert.deepEqual(google, { action: "prefer", name: "Google User" });
  const keep = decideEnsureDisplayName({
    currentDbName: "Existing",
    preferredGoogle: "Google User",
  });
  assert.deepEqual(keep, { action: "keep", name: "Existing" });
}

{
  const first = applyEmptyNameWrite("", "Mirio-A7K9Q2");
  const second = applyEmptyNameWrite(first, "Mirio-ZZZZZZ");
  assert.equal(first, "Mirio-A7K9Q2");
  assert.equal(second, "Mirio-A7K9Q2");
  assert.equal(isGeneratedMirioNickname(first), true);
}

{
  assert.equal(applyEmptyNameWrite("Alice", "Mirio-A7K9Q2"), "Alice");
  assert.equal(applyEmptyNameWrite("Google Name", "Mirio-A7K9Q2"), "Google Name");
}

{
  const concurrent = applyEmptyNameWrite("User Typed", "Mirio-A7K9Q2");
  assert.equal(concurrent, "User Typed");
  assert.equal(applyEnsureNameToLocalProfile("User Typed", "Mirio-A7K9Q2"), "User Typed");
  assert.equal(applyEnsureNameToLocalProfile("", "Mirio-A7K9Q2"), "Mirio-A7K9Q2");
}

assert.equal(DISPLAY_NAME_MAX, 50);

const page = read("src/app/[locale]/profile/page.tsx");
assert.ok(page.includes("nameEdit.editing"));
assert.ok(page.includes("nameInputRef"));
assert.ok(page.includes("maxLength={DISPLAY_NAME_MAX}"));
assert.ok(page.includes('aria-label={t("displayName")}'));
assert.ok(page.includes('aria-label={t("confirmName")}'));
assert.ok(page.includes('aria-label={t("cancelName")}'));
assert.ok(page.includes('e.key === "Enter"'));
assert.ok(page.includes('e.key === "Escape"'));
assert.ok(page.includes("ensure_my_display_name"));
assert.ok(page.includes("applyEnsureNameToLocalProfile"));
assert.equal(page.includes('{t("fullName")}'), false);
assert.equal(page.includes("setEditingName(false)"), false);
assert.equal(page.includes("mt-3 space-y-2"), false);
assert.ok(page.includes("/api/profile/phone"));

const initSql = read("supabase/init.sql");
const updateFn = initSql.slice(
  initSql.indexOf("create or replace function public.update_my_profile("),
  initSql.indexOf("create or replace function public.set_profile_phone_v87"),
);
assert.equal(updateFn.includes("p_phone"), false);
assert.ok(initSql.includes("generate_mirio_display_name"));
assert.ok(initSql.includes("and nullif(btrim(full_name), '') is null"));

const migration = read("supabase/migrations/20260908000001_account_display_name_and_phone_boundary.sql");
assert.ok(migration.includes("AND nullif(btrim(full_name), '') IS NULL"));
assert.ok(migration.includes("DROP FUNCTION IF EXISTS public.update_my_profile(text, text, text, text, text, text)"));
assert.ok(migration.includes("GRANT EXECUTE ON FUNCTION public.set_profile_phone_v87(uuid, text) TO service_role"));
assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.set_profile_phone_v87(uuid, text) FROM authenticated"));
assert.ok(migration.includes("23456789ABCDEFGHJKLMNPQRSTUVWXYZ"));

console.log("displayName.test.ts: ok");
