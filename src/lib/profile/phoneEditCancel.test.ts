/**
 * Shared Account + PublishedPostSuccess phone cancel behavior.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/profile/phoneEditCancel.test.ts
 */

import assert from "node:assert/strict";
import {
  cancelPhoneEdit,
  shouldShowPhoneError,
} from "@/lib/profile/phoneSaveClient";
import { phoneStatusAfterSaveAttempt } from "@/lib/profile/phoneStatusUi";

// Persisted A -> draft B -> cancel -> reopening receives A-derived fields.
{
  const persistedA = "381631829008";
  const draftB = { country: "RS", local: "641112222" };
  assert.notEqual(draftB.local, "631829008");
  const accountReset = cancelPhoneEdit(persistedA);
  const publishReset = cancelPhoneEdit(persistedA);
  assert.deepEqual(accountReset, publishReset);
  assert.equal(accountReset.country, "RS");
  assert.equal(accountReset.local.replace(/\s/g, ""), "0631829008");
  assert.equal(accountReset.editing, false);
}

// A failed save's draft/error/flash are all discarded by cancel.
{
  const beforeCancel = {
    country: "RS",
    local: "bad draft",
    phoneError: "error.invalid_phone",
    phoneSaved: true,
  };
  assert.ok(beforeCancel.phoneError);
  const reset = cancelPhoneEdit("381631829008");
  assert.equal(reset.phoneError, null);
  assert.equal(reset.phoneSaved, false);
  assert.notEqual(reset.local, beforeCancel.local);
}

// No persisted phone -> cancel returns the empty Add-phone state.
{
  const reset = cancelPhoneEdit(null);
  assert.equal(reset.local, "");
  assert.equal(reset.phoneError, null);
  assert.equal(reset.phoneSaved, false);
  assert.equal(reset.editing, false);
}

// Defensive rendering contract: view mode never exposes a stale edit error.
assert.equal(shouldShowPhoneError(false, true), false);
assert.equal(shouldShowPhoneError(true, true), true);

// Successful persistence still owns the displayed value and folds to view.
{
  const saved = phoneStatusAfterSaveAttempt({
    ok: true,
    normalizedPhone: "381631829008",
  });
  assert.equal(saved.persistedNormalizedPhone, "381631829008");
  assert.equal(saved.showUnverifiedBadge, true);
}

console.log("phoneEditCancel.test.ts: ok");
