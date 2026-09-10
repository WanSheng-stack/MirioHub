/**
 * PHASE 6.7B — MatchRequestSheet contract (TEST P–X).
 * Pure form/submit tests + static source assertions. No browser E2E.
 * Run: npx tsx --tsconfig tsconfig.json src/components/matching/MatchRequestSheet.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  freezeLegacyDirectMatchIntercept,
  MATCHING_TEMPORARILY_UNAVAILABLE_KEY,
} from "@/lib/matching/legacyMatchingFreeze";
import {
  attemptMatchRequestSubmit,
  collectFieldHints,
  createInitialMatchRequestForm,
  formAfterOpenChange,
  reduceMatchRequestForm,
  serverErrorAlert,
  showsHandlingFeeNegotiation,
  type MatchRequestTargetPost,
} from "@/lib/matching/matchRequestForm";
import {
  canDismissMatchRequestSheet,
  collectMatchRequestFocusEligibility,
  displayedServerErrorKey,
  isEligibleMatchRequestFocusTarget,
  isStayInPanelTrap,
  matchRequestCloseActions,
  matchRequestInitialFocusIndex,
  matchRequestTabTrap,
  shouldClearServerErrorOnUserEdit,
  shouldResetMatchRequestDraft,
  shouldRestartMatchRequestFocusLifecycle,
  transportModesForMatchRequest,
  type MatchRequestFocusTreeNode,
} from "@/lib/matching/matchRequestSheetBehavior";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const sheetSrc = read("src/components/matching/MatchRequestSheet.tsx");
const behaviorSrc = read("src/lib/matching/matchRequestSheetBehavior.ts");
const payloadSrc = read("src/lib/matching/applicationPayload.ts");
const postCard = read("src/components/hall/PostCard.tsx");
const homePage = read("src/app/[locale]/page.tsx");
const actionsSrc = read("src/components/post/PostActions.tsx");
const homeConsole = read("src/components/home/HomeConsole.tsx");
const matchRoute = read(
  "src/app/api/posts/evaluate-provider-match-intercept/route.ts",
);
const migration67a = read(
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
);
const publicSelect = read("src/lib/posts/publicPostSelect.ts");
const zh = read("src/messages/zh.json");
const en = read("src/messages/en.json");
const sr = read("src/messages/sr.json");

const demandTravel: MatchRequestTargetPost = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  post_type: "demand",
  category: "travel",
  origin_address: "Belgrade",
  destination_address: "Novi Sad",
  departure_date: "2026-09-10",
  departure_time_window: "14:00-14:30",
  fee_amount: 12,
};

const demandDeliver: MatchRequestTargetPost = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  post_type: "demand",
  category: "deliver",
  origin_address: "Belgrade",
  destination_address: "Novi Sad",
  departure_date: "2026-09-10",
  departure_time_window: "14:00-14:30",
  fee_amount: 20,
};

const providerDeliver: MatchRequestTargetPost = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  post_type: "provider",
  category: "deliver",
  origin_address: "Belgrade",
  destination_address: "Novi Sad",
  departure_date: "2026-09-11",
  departure_time_window: "09:00-09:15",
  fee_amount: 18,
};

function fillCargoSpace(form: ReturnType<typeof createInitialMatchRequestForm>) {
  let next = form;
  next = reduceMatchRequestForm(next, {
    type: "SET_SPACE_FIELD",
    field: "spaceLength",
    value: "120",
  });
  next = reduceMatchRequestForm(next, {
    type: "SET_SPACE_FIELD",
    field: "spaceWidth",
    value: "80",
  });
  next = reduceMatchRequestForm(next, {
    type: "SET_SPACE_FIELD",
    field: "spaceHeight",
    value: "80",
  });
  return next;
}

function validProviderDeliverForm() {
  let form = createInitialMatchRequestForm(demandDeliver);
  form = fillCargoSpace(form);
  form = reduceMatchRequestForm(form, {
    type: "SET_ESCORT_ACCOMMODATION",
    value: "available",
  });
  form = reduceMatchRequestForm(form, {
    type: "SET_HANDLING_FLAG",
    field: "canHelpLoading",
    value: true,
  });
  return form;
}

function validDemandDeliverForm() {
  let form = createInitialMatchRequestForm(providerDeliver);
  form = fillCargoSpace(form);
  form = reduceMatchRequestForm(form, {
    type: "SET_WEIGHT_KIND",
    value: "known",
  });
  form = reduceMatchRequestForm(form, { type: "SET_WEIGHT_KG", value: "12.5" });
  form = reduceMatchRequestForm(form, {
    type: "SET_HANDLING_FLAG",
    field: "needsUnloadingHelp",
    value: true,
  });
  return form;
}

function validProviderOfferForm() {
  let form = createInitialMatchRequestForm(demandTravel);
  form = reduceMatchRequestForm(form, { type: "SET_TRANSPORT_MODE", value: "car" });
  form = reduceMatchRequestForm(form, {
    type: "SET_SEAT_FIELD",
    field: "availablePassengerSeats",
    value: "2",
  });
  form = reduceMatchRequestForm(form, { type: "SET_MESSAGE", value: "  I can drive  " });
  return form;
}

// TEST P onSubmit receives typed normalized payload, not raw form state
{
  const form = validProviderOfferForm();
  const result = attemptMatchRequestSubmit(form, demandTravel, false);
  assert.equal(result.kind, "submitted");
  if (result.kind === "submitted") {
    const payload = result.payload;
    assert.equal(payload.version, 1);
    assert.equal(payload.applicantRole, "provider");
    assert.equal(payload.targetPostType, "demand");
    assert.equal(payload.message, "I can drive");
    assert.equal("transportMode" in form, true);
    assert.equal("availablePassengerSeats" in payload, true);
    assert.equal("origin_address" in payload, false);
    assert.equal("fee_amount" in payload, false);
    assert.equal("fieldErrors" in payload, false);
    assert.equal("fieldErrors" in (payload as object), false);
  }
}

{
  const form = validProviderDeliverForm();
  const result = attemptMatchRequestSubmit(form, demandDeliver, false);
  assert.equal(result.kind, "submitted", JSON.stringify(result));
  if (result.kind === "submitted") {
    assert.equal(result.payload.applicantRole, "provider");
    assert.equal(result.payload.targetCategory, "deliver");
    assert.equal("cargoCapacity" in result.payload, true);
    assert.equal("availableCargo" in result.payload, false);
    assert.equal("applicant_post_id" in result.payload, false);
    if (result.payload.targetCategory === "deliver" && result.payload.applicantRole === "provider") {
      assert.equal(result.payload.cargoCapacity.handlingOffer.canHelpLoading, true);
      assert.equal(result.payload.cargoCapacity.handlingOffer.canHelpUnloading, false);
      assert.equal("transportMode" in result.payload, false);
    }
  }
  assert.equal(showsHandlingFeeNegotiation(form, "provider"), true);
}

{
  const form = validDemandDeliverForm();
  const result = attemptMatchRequestSubmit(form, providerDeliver, false);
  assert.equal(result.kind, "submitted", JSON.stringify(result));
  if (result.kind === "submitted") {
    assert.equal(result.payload.applicantRole, "demand");
    assert.equal(result.payload.targetCategory, "deliver");
    assert.equal("cargoRequirement" in result.payload, true);
    assert.equal("escortSeats" in result.payload, false);
    if (result.payload.targetCategory === "deliver" && result.payload.applicantRole === "demand") {
      assert.equal(result.payload.cargoRequirement.handlingRequest.needsUnloadingHelp, true);
      assert.equal(result.payload.cargoRequirement.approximateWeightKg.kind, "known");
    }
  }
}

{
  const empty = createInitialMatchRequestForm(demandDeliver);
  const result = attemptMatchRequestSubmit(empty, demandDeliver, false);
  assert.equal(result.kind, "invalid");
  assert.ok(collectFieldHints(empty, demandDeliver).cargoSpace);
  assert.equal(collectFieldHints(empty, demandDeliver).transportMode, undefined);
}

{
  let leftover = validProviderDeliverForm();
  leftover = reduceMatchRequestForm(leftover, {
    type: "SET_TRANSPORT_MODE",
    value: "walking",
  });
  const result = attemptMatchRequestSubmit(leftover, demandDeliver, false);
  assert.equal(result.kind, "submitted", JSON.stringify(result));
  if (result.kind === "submitted") {
    assert.equal("transportMode" in result.payload, false);
  }
}

// TEST Q invalid form does not call onSubmit
{
  const form = createInitialMatchRequestForm(demandTravel);
  let submitted: unknown = null;
  const result = attemptMatchRequestSubmit(form, demandTravel, false);
  if (result.kind === "submitted") submitted = result.payload;
  assert.equal(result.kind, "invalid");
  assert.equal(submitted, null);
  assert.ok(collectFieldHints(form, demandTravel).transportMode);
}

// TEST R submitting cannot double-submit
{
  const form = validProviderOfferForm();
  const first = attemptMatchRequestSubmit(form, demandTravel, false);
  const second = attemptMatchRequestSubmit(form, demandTravel, true);
  assert.equal(first.kind, "submitted");
  assert.equal(second.kind, "blocked_submitting");
}

// TEST S server error uses inline role=alert
{
  const alert = serverErrorAlert("error.matching_temporarily_unavailable");
  assert.deepEqual(alert, {
    role: "alert",
    errorKey: "error.matching_temporarily_unavailable",
  });
  assert.equal(serverErrorAlert(null), null);
  assert.ok(sheetSrc.includes('role="alert"'));
  assert.ok(sheetSrc.includes("aria-invalid"));
  assert.ok(sheetSrc.includes("serverErrorKey"));
}

// TEST T close/reopen clears unsubmitted draft
{
  const dirty = validProviderOfferForm();
  assert.equal(dirty.transportMode, "car");
  const closed = formAfterOpenChange(true, false, dirty, demandTravel);
  assert.equal(closed.transportMode, "");
  assert.equal(closed.message, "");
  const reopened = formAfterOpenChange(false, true, closed, demandTravel);
  assert.equal(reopened.transportMode, "");
  assert.deepEqual(reopened.fieldErrors, {});
}

// TEST U this round PostCard / homepage have no apply buttons and no new API fetch
{
  for (const src of [postCard, homePage, actionsSrc, homeConsole]) {
    assert.equal(src.includes("MatchRequestSheet"), false);
    assert.equal(src.includes("matchRequest.offerHelp"), false);
    assert.equal(src.includes("matchRequest.requestHelp"), false);
  }
  for (const src of [postCard, homePage, homeConsole]) {
    assert.equal(src.includes("我能帮忙"), false);
    assert.equal(src.includes("Offer help"), false);
    assert.equal(src.includes("请求帮助"), false);
  }
  assert.ok(actionsSrc.includes("Future 6.7B copy only"));
  assert.equal(/<button[\s\S]{0,400}我能帮忙/.test(actionsSrc), false);
  assert.equal(/fetch\s*\(\s*["']\/api\/match/.test(postCard), false);
  assert.equal(/fetch\s*\(\s*["']\/api\/match/.test(homePage), false);
  assert.equal(/fetch\s*\(\s*["']\/api\/match/.test(actionsSrc), false);
  assert.ok(zh.includes("我能帮忙"));
  assert.ok(en.includes("Offer help"));
  assert.ok(sr.includes("Ponudi pomoć"));
  assert.ok(zh.includes("请求帮助"));
  assert.ok(en.includes("Request help"));
  assert.ok(sr.includes("Zatraži pomoć"));
  assert.ok(zh.includes("需要帮助方协助装货"));
  assert.ok(en.includes("Need the helper to assist with loading"));
  assert.ok(sr.includes("Treba mi pomoć pri utovaru"));
  assert.ok(zh.includes("装卸协助费：面议"));
  assert.ok(en.includes("Handling fee: to be agreed"));
  assert.ok(sr.includes("Naknada za utovar/istovar: po dogovoru"));
  assert.ok(sheetSrc.includes("CargoV2Block"));
  assert.ok(sheetSrc.includes("needsLoadingHelp"));
  assert.ok(sheetSrc.includes("canHelpLoading"));
  assert.ok(sheetSrc.includes("handlingFeeNegotiable"));
  assert.equal(sheetSrc.includes("availablePassengerSeatsOptional"), false);
  assert.equal(sheetSrc.includes("SET_CARGO"), true);
  assert.ok(payloadSrc.includes("cargoCapacity"));
  assert.ok(payloadSrc.includes("cargoRequirement"));
  assert.equal(payloadSrc.includes("availableCargo"), true);
}

// TEST V old confirm_match still frozen, old API still 409
{
  const result = freezeLegacyDirectMatchIntercept();
  assert.equal(result.status, 409);
  assert.deepEqual(result.json, {
    ok: false,
    errorKey: MATCHING_TEMPORARILY_UNAVAILABLE_KEY,
  });
  assert.ok(matchRoute.includes("freezeLegacyDirectMatchIntercept"));
  assert.equal(actionsSrc.includes("confirm_match"), false);
  assert.equal(actionsSrc.includes("confirmMatch"), false);
  assert.equal(sheetSrc.includes("confirm_match"), false);
  assert.equal(payloadSrc.includes("confirm_match"), false);
  assert.equal(sheetSrc.includes("evaluate-provider-match-intercept"), false);

  function walkRuntimeTs(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === "node_modules" || name.name === ".next") continue;
      const full = join(dir, name.name);
      if (name.isDirectory()) walkRuntimeTs(full, out);
      else if (
        (name.name.endsWith(".ts") || name.name.endsWith(".tsx")) &&
        !name.name.endsWith(".test.ts")
      ) {
        out.push(full);
      }
    }
    return out;
  }
  for (const file of walkRuntimeTs(join(repoRoot, "src"))) {
    const src = readFileSync(file, "utf8");
    assert.equal(src.includes('rpc("confirm_match"'), false, file);
    assert.equal(src.includes("rpc('confirm_match'"), false, file);
  }
}

// TEST W match_requests / match_contracts ACL unchanged
{
  for (const table of ["public.match_requests", "public.match_contracts"]) {
    for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
      assert.ok(
        migration67a.includes(`REVOKE ALL ON TABLE ${table} FROM ${role}`),
        `${table} ${role}`,
      );
    }
  }
  assert.equal(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i.test(migration67a), false);
  const PHASE_67B1A_BASELINE = "189d1ef0561b6840df95e0a59874827fd01e4086";
  const migrationDiff = execFileSync(
    "git",
    [
      "diff",
      PHASE_67B1A_BASELINE,
      "--",
      "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(migrationDiff, "");
}

// TEST X public_posts_safe unchanged
{
  const PHASE_67B1A_BASELINE = "189d1ef0561b6840df95e0a59874827fd01e4086";
  const selectDiff = execFileSync(
    "git",
    ["diff", PHASE_67B1A_BASELINE, "--", "src/lib/posts/publicPostSelect.ts"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(selectDiff, "");
  const viewDiff = execFileSync(
    "git",
    [
      "diff",
      PHASE_67B1A_BASELINE,
      "--",
      "supabase/migrations/20260907000001_security_boundary_hardening_v86.sql",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(viewDiff, "");
  assert.ok(publicSelect.includes("PUBLIC_SAFE_POST_SELECT"));
  assert.equal(payloadSrc.includes("public_posts_safe"), false);
  assert.equal(sheetSrc.includes("public_posts_safe"), false);
}

assert.ok(payloadSrc.includes("Client validator is UX"));
assert.ok(payloadSrc.includes("6.7C"));
assert.ok(payloadSrc.includes("Never trust browser-provided"));
assert.ok(sheetSrc.includes("must not be trusted"));
assert.ok(sheetSrc.includes("Do not mount this on PostCard"));
assert.equal(sheetSrc.includes("window.alert"), false);
assert.ok(sheetSrc.includes("Escape"));
assert.ok(sheetSrc.includes("disabled={busy}"));
assert.equal(sheetSrc.includes("setWasOpen"), false);
assert.equal(sheetSrc.includes("open !== wasOpen"), false);
assert.equal(sheetSrc.includes("TRANSPORT_MODES"), false);
assert.equal(/<button[\s\S]{0,220}absolute inset-0/.test(sheetSrc), false);
assert.ok(sheetSrc.includes("matchRequestTabTrap"));
assert.ok(sheetSrc.includes("displayedServerErrorKey"));
assert.ok(sheetSrc.includes("transportModesForMatchRequest"));
assert.ok(sheetSrc.includes("onServerErrorClear"));
assert.ok(sheetSrc.includes("shouldResetMatchRequestDraft"));
assert.ok(sheetSrc.includes("key={props.targetPost.id}"));
assert.ok(sheetSrc.includes("matchRequestInitialFocusIndex"));
assert.ok(sheetSrc.includes("matchRequestCloseActions"));
assert.ok(sheetSrc.includes("shouldClearServerErrorOnUserEdit"));
assert.equal(sheetSrc.includes("onServerErrorClear?:"), false);
assert.ok(sheetSrc.includes("onServerErrorClear: () => void"));
assert.equal(sheetSrc.includes("setErrorTrack"), false);
assert.equal(sheetSrc.includes("errorTrack"), false);
assert.equal(sheetSrc.includes("dismissedGen"), false);
assert.equal(sheetSrc.includes("visibleServerErrorKey"), false);
assert.equal(sheetSrc.includes("errorGenerationAfterKeyChange"), false);
assert.equal(sheetSrc.includes("[open, onOpenChange, submitting]"), false);
assert.ok(sheetSrc.includes("submittingRef"));
assert.ok(sheetSrc.includes("isEligibleMatchRequestFocusTarget"));
assert.ok(sheetSrc.includes("readMatchRequestFocusEligibility"));
assert.ok(sheetSrc.includes("isStayInPanelTrap"));
assert.equal(sheetSrc.includes("if (trapNodes.length === 0) return;"), false);
assert.equal(sheetSrc.includes("isMatchRequestFocusableCandidate"), false);
assert.equal(sheetSrc.includes("canRestoreMatchRequestTriggerFocus"), false);
assert.equal(sheetSrc.includes("readMatchRequestRestoreTarget"), false);
assert.ok(behaviorSrc.includes("inputTypeHidden"));
assert.ok(behaviorSrc.includes("inertInTree"));
assert.ok(behaviorSrc.includes("displayNoneInTree"));
assert.ok(behaviorSrc.includes("visibilityHiddenInTree"));
assert.ok(behaviorSrc.includes('el.hasAttribute("disabled")'));
assert.ok(behaviorSrc.includes(".disabled === true"));
assert.ok(behaviorSrc.includes('el.matches(":disabled")'));
assert.ok(behaviorSrc.includes("el.hidden === true"));
assert.ok(behaviorSrc.includes('el.hasAttribute("hidden")'));
assert.ok(behaviorSrc.includes('input.type === "hidden"'));
assert.ok(behaviorSrc.includes('input.getAttribute("type") === "hidden"'));
assert.ok(behaviorSrc.includes("button:not(:disabled)"));
assert.ok(behaviorSrc.includes("input:not(:disabled):not([type='hidden'])"));
assert.equal(behaviorSrc.includes("canRestoreMatchRequestTriggerFocus"), false);

{
  assert.equal(canDismissMatchRequestSheet(true), false);
  assert.equal(canDismissMatchRequestSheet(false), true);

  assert.equal(
    shouldResetMatchRequestDraft({
      prevOpen: false,
      nextOpen: true,
      prevTargetId: "a",
      nextTargetId: "a",
    }),
    true,
  );
  assert.equal(
    shouldResetMatchRequestDraft({
      prevOpen: true,
      nextOpen: false,
      prevTargetId: "a",
      nextTargetId: "a",
    }),
    true,
  );
  assert.equal(
    shouldResetMatchRequestDraft({
      prevOpen: true,
      nextOpen: true,
      prevTargetId: "a",
      nextTargetId: "b",
    }),
    true,
  );
  assert.equal(
    shouldResetMatchRequestDraft({
      prevOpen: true,
      nextOpen: true,
      prevTargetId: "a",
      nextTargetId: "a",
    }),
    false,
  );
  assert.equal(
    shouldResetMatchRequestDraft({
      prevOpen: false,
      nextOpen: false,
      prevTargetId: "a",
      nextTargetId: "b",
    }),
    false,
  );

  const wrapForward = matchRequestTabTrap({ key: "Tab", shiftKey: false }, 4, 5);
  assert.deepEqual(wrapForward, { preventDefault: true, nextIndex: 0 });
  const wrapBackward = matchRequestTabTrap({ key: "Tab", shiftKey: true }, 0, 5);
  assert.deepEqual(wrapBackward, { preventDefault: true, nextIndex: 4 });
  assert.equal(matchRequestTabTrap({ key: "Tab", shiftKey: false }, 2, 5), null);
  const escaped = matchRequestTabTrap({ key: "Tab", shiftKey: false }, -1, 5);
  assert.deepEqual(escaped, { preventDefault: true, nextIndex: 0 });
  const escapedShift = matchRequestTabTrap({ key: "Tab", shiftKey: true }, -1, 5);
  assert.deepEqual(escapedShift, { preventDefault: true, nextIndex: 4 });
  assert.equal(matchRequestTabTrap({ key: "Escape", shiftKey: false }, 0, 5), null);
  const emptyTab = matchRequestTabTrap({ key: "Tab", shiftKey: false }, 0, 0);
  assert.deepEqual(emptyTab, { preventDefault: true, stayInPanel: true });
  assert.equal(emptyTab !== null && isStayInPanelTrap(emptyTab), true);
  const emptyShift = matchRequestTabTrap({ key: "Tab", shiftKey: true }, -1, 0);
  assert.deepEqual(emptyShift, { preventDefault: true, stayInPanel: true });

  const visibleNode: MatchRequestFocusTreeNode = {
    hidden: false,
    ariaHidden: false,
    inert: false,
    disabled: false,
    display: "block",
    visibility: "visible",
  };
  function eligibility(overrides: {
    isConnected?: boolean;
    disabled?: boolean;
    tabIndex?: number;
    inputTypeHidden?: boolean;
    chain?: MatchRequestFocusTreeNode[];
  } = {}) {
    return collectMatchRequestFocusEligibility({
      isConnected: overrides.isConnected ?? true,
      disabled: overrides.disabled ?? false,
      tabIndex: overrides.tabIndex ?? 0,
      inputTypeHidden: overrides.inputTypeHidden ?? false,
      chain: overrides.chain ?? [visibleNode],
    });
  }
  const eligible = eligibility();
  assert.equal(eligible.inertInTree, false);
  assert.equal(eligible.displayNoneInTree, false);
  assert.equal(eligible.visibilityHiddenInTree, false);
  assert.equal(eligible.inputTypeHidden, false);
  assert.equal(isEligibleMatchRequestFocusTarget(eligible), true);
  const ancestorBlocked = collectMatchRequestFocusEligibility({
    isConnected: true,
    disabled: false,
    tabIndex: 0,
    inputTypeHidden: false,
    chain: [
      visibleNode,
      { ...visibleNode, inert: true, display: "none", visibility: "hidden" },
    ],
  });
  assert.equal(ancestorBlocked.inertInTree, true);
  assert.equal(ancestorBlocked.displayNoneInTree, true);
  assert.equal(ancestorBlocked.visibilityHiddenInTree, true);
  assert.equal(isEligibleMatchRequestFocusTarget(ancestorBlocked), false);
  assert.equal(isEligibleMatchRequestFocusTarget(eligibility({ isConnected: false })), false);
  assert.equal(isEligibleMatchRequestFocusTarget(eligibility({ disabled: true })), false);
  assert.equal(
    isEligibleMatchRequestFocusTarget(
      eligibility({
        disabled: false,
        chain: [visibleNode, { ...visibleNode, disabled: true }],
      }),
    ),
    false,
  );
  const ancestorDisabled = collectMatchRequestFocusEligibility({
    isConnected: true,
    disabled: false,
    tabIndex: 0,
    inputTypeHidden: false,
    chain: [visibleNode, { ...visibleNode, disabled: true }],
  });
  assert.equal(ancestorDisabled.disabled, true);
  assert.equal(isEligibleMatchRequestFocusTarget(ancestorDisabled), false);
  assert.equal(isEligibleMatchRequestFocusTarget(eligibility({ tabIndex: -1 })), false);
  assert.equal(isEligibleMatchRequestFocusTarget(eligibility({ inputTypeHidden: true })), false);
  assert.equal(
    isEligibleMatchRequestFocusTarget(
      eligibility({ chain: [{ ...visibleNode, hidden: true }] }),
    ),
    false,
  );
  assert.equal(
    isEligibleMatchRequestFocusTarget(
      eligibility({ chain: [{ ...visibleNode, ariaHidden: true }] }),
    ),
    false,
  );
  assert.equal(
    isEligibleMatchRequestFocusTarget(
      eligibility({ chain: [{ ...visibleNode, inert: true }] }),
    ),
    false,
  );
  assert.equal(
    isEligibleMatchRequestFocusTarget(
      eligibility({
        chain: [visibleNode, { ...visibleNode, inert: true }],
      }),
    ),
    false,
  );
  assert.equal(
    isEligibleMatchRequestFocusTarget(
      eligibility({ chain: [{ ...visibleNode, display: "none" }] }),
    ),
    false,
  );
  assert.equal(
    isEligibleMatchRequestFocusTarget(
      eligibility({
        chain: [visibleNode, { ...visibleNode, display: "none" }],
      }),
    ),
    false,
  );
  assert.equal(
    isEligibleMatchRequestFocusTarget(
      eligibility({ chain: [{ ...visibleNode, visibility: "hidden" }] }),
    ),
    false,
  );
  assert.equal(
    isEligibleMatchRequestFocusTarget(
      eligibility({ chain: [{ ...visibleNode, visibility: "collapse" }] }),
    ),
    false,
  );
  assert.equal(
    isEligibleMatchRequestFocusTarget(
      eligibility({
        chain: [visibleNode, { ...visibleNode, visibility: "hidden" }],
      }),
    ),
    false,
  );
  assert.equal(
    isEligibleMatchRequestFocusTarget(
      eligibility({
        chain: [visibleNode, { ...visibleNode, hidden: true }],
      }),
    ),
    false,
  );

  const restoreFacts = eligibility();
  const tabFacts = eligibility();
  assert.deepEqual(restoreFacts, tabFacts);
  assert.equal(isEligibleMatchRequestFocusTarget(restoreFacts), true);
  assert.equal(isEligibleMatchRequestFocusTarget(tabFacts), true);

  const firstKey = "error.matching_temporarily_unavailable";
  assert.equal(displayedServerErrorKey(firstKey), firstKey);
  assert.equal(displayedServerErrorKey(firstKey), firstKey);
  assert.deepEqual(serverErrorAlert(displayedServerErrorKey(firstKey)), {
    role: "alert",
    errorKey: firstKey,
  });
  assert.equal(displayedServerErrorKey(null), null);

  assert.deepEqual(matchRequestCloseActions(true), {
    clearServerError: false,
    close: false,
  });
  assert.deepEqual(matchRequestCloseActions(false), {
    clearServerError: true,
    close: true,
  });

  let parentError: string | null = firstKey;
  const clear = () => {
    parentError = null;
  };
  const closeOnce = matchRequestCloseActions(false);
  if (closeOnce.clearServerError) clear();
  assert.equal(parentError, null);
  parentError = firstKey;
  const blocked = matchRequestCloseActions(true);
  if (blocked.clearServerError) clear();
  assert.equal(parentError, firstKey);

  assert.equal(shouldClearServerErrorOnUserEdit("SET_MESSAGE"), true);
  assert.equal(shouldClearServerErrorOnUserEdit("SET_TRANSPORT_MODE"), true);
  assert.equal(shouldClearServerErrorOnUserEdit("RESET"), false);
  assert.equal(shouldClearServerErrorOnUserEdit("SET_FIELD_ERRORS"), false);

  parentError = firstKey;
  if (shouldClearServerErrorOnUserEdit("SET_MESSAGE")) clear();
  assert.equal(parentError, null);
  parentError = firstKey;
  if (shouldClearServerErrorOnUserEdit("SET_FIELD_ERRORS")) clear();
  assert.equal(parentError, firstKey);
  parentError = firstKey;
  if (shouldClearServerErrorOnUserEdit("SET_MESSAGE")) clear();
  parentError = firstKey;
  assert.equal(displayedServerErrorKey(parentError), firstKey);

  assert.equal(matchRequestInitialFocusIndex(4), 0);
  assert.equal(matchRequestInitialFocusIndex(1), 0);
  assert.equal(matchRequestInitialFocusIndex(0), null);
  assert.equal(
    shouldRestartMatchRequestFocusLifecycle({ submittingChanged: true }),
    false,
  );
  assert.equal(
    shouldRestartMatchRequestFocusLifecycle({ submittingChanged: false }),
    false,
  );

  assert.deepEqual(transportModesForMatchRequest("deliver"), []);
  assert.ok(transportModesForMatchRequest("travel").includes("car"));
  assert.ok(transportModesForMatchRequest("travel").includes("walking"));
  assert.equal(transportModesForMatchRequest("buy").includes("flight"), true);
}

console.log("MatchRequestSheet.test.ts: ok");
