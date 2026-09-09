/**
 * PHASE 6.7B.1B.3 — testable MatchRequestSheet lifecycle / a11y helpers.
 * Parent owns serverErrorKey. Focus helpers stay DOM-free except explicit readers.
 */

import { TRANSPORT_MODES } from "@/lib/posts";
import type { PostCategory } from "@/lib/post-payload";
import type { TransportMode } from "@/lib/types";

export function canDismissMatchRequestSheet(submitting: boolean): boolean {
  return submitting !== true;
}

export function shouldResetMatchRequestDraft(input: {
  prevOpen: boolean;
  nextOpen: boolean;
  prevTargetId: string;
  nextTargetId: string;
}): boolean {
  if (input.prevOpen !== input.nextOpen) return true;
  return input.nextOpen && input.prevTargetId !== input.nextTargetId;
}

/** Parent owns the key. A non-null key is always shown, including repeats. */
export function displayedServerErrorKey(
  serverErrorKey: string | null,
): string | null {
  return serverErrorKey;
}

export function matchRequestCloseActions(submitting: boolean): {
  clearServerError: boolean;
  close: boolean;
} {
  if (!canDismissMatchRequestSheet(submitting)) {
    return { clearServerError: false, close: false };
  }
  return { clearServerError: true, close: true };
}

export function shouldClearServerErrorOnUserEdit(actionType: string): boolean {
  return actionType !== "RESET" && actionType !== "SET_FIELD_ERRORS";
}

export function matchRequestInitialFocusIndex(focusableCount: number): number | null {
  if (focusableCount <= 0) return null;
  return 0;
}

/** submitting must not remount the focus/restore lifecycle. */
export function shouldRestartMatchRequestFocusLifecycle(input: {
  submittingChanged: boolean;
}): boolean {
  void input.submittingChanged;
  return false;
}

export type MatchRequestTabTrapResult =
  | { preventDefault: true; stayInPanel: true }
  | { preventDefault: true; nextIndex: number };

export function isStayInPanelTrap(
  trap: MatchRequestTabTrapResult,
): trap is { preventDefault: true; stayInPanel: true } {
  return "stayInPanel" in trap;
}

export function matchRequestTabTrap(
  event: { key: string; shiftKey: boolean },
  currentIndex: number,
  count: number,
): MatchRequestTabTrapResult | null {
  if (event.key !== "Tab") return null;
  if (count <= 0) {
    return { preventDefault: true, stayInPanel: true };
  }
  if (currentIndex < 0) {
    return { preventDefault: true, nextIndex: event.shiftKey ? count - 1 : 0 };
  }
  if (event.shiftKey && currentIndex <= 0) {
    return { preventDefault: true, nextIndex: count - 1 };
  }
  if (!event.shiftKey && currentIndex >= count - 1) {
    return { preventDefault: true, nextIndex: 0 };
  }
  return null;
}

export type MatchRequestFocusCandidate = {
  isConnected: boolean;
  hidden: boolean;
  disabled: boolean;
  tabIndex: number;
  ariaHidden: boolean;
  ancestorHidden: boolean;
  display: string;
  visibility: string;
};

export function isMatchRequestFocusableCandidate(
  el: MatchRequestFocusCandidate,
): boolean {
  if (!el.isConnected) return false;
  if (el.hidden || el.ancestorHidden || el.ariaHidden) return false;
  if (el.disabled) return false;
  if (el.tabIndex === -1) return false;
  if (el.display === "none") return false;
  if (el.visibility === "hidden" || el.visibility === "collapse") return false;
  return true;
}

export function readMatchRequestFocusCandidate(
  el: HTMLElement,
): MatchRequestFocusCandidate {
  const style = getComputedStyle(el);
  return {
    isConnected: el.isConnected,
    hidden: el.hidden,
    disabled: el.hasAttribute("disabled"),
    tabIndex: el.tabIndex,
    ariaHidden: el.getAttribute("aria-hidden") === "true",
    ancestorHidden: Boolean(
      el.parentElement?.closest("[hidden], [aria-hidden='true']"),
    ),
    display: style.display,
    visibility: style.visibility,
  };
}

export type MatchRequestRestoreTarget = {
  isConnected: boolean;
  hidden: boolean;
  disabled: boolean;
  display: string;
  visibility: string;
} | null;

export function canRestoreMatchRequestTriggerFocus(
  target: MatchRequestRestoreTarget,
): boolean {
  if (!target) return false;
  if (!target.isConnected) return false;
  if (target.hidden || target.disabled) return false;
  if (target.display === "none") return false;
  if (target.visibility === "hidden" || target.visibility === "collapse") {
    return false;
  }
  return true;
}

export function readMatchRequestRestoreTarget(
  el: HTMLElement | null,
): MatchRequestRestoreTarget {
  if (!el) return null;
  const style = getComputedStyle(el);
  return {
    isConnected: el.isConnected,
    hidden: el.hidden,
    disabled: el.hasAttribute("disabled"),
    display: style.display,
    visibility: style.visibility,
  };
}

export const MATCH_REQUEST_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Deliver applications do not inherit Travel's top-level transportMode.
 * Travel / local Provider offers still use the live V1 enum.
 * V2 names (cargo_van, …) stay out of this unmounted sheet.
 */
export function transportModesForMatchRequest(
  category: PostCategory,
): readonly TransportMode[] {
  if (category === "deliver") return [];
  return TRANSPORT_MODES;
}
