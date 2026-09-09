/**
 * PHASE 6.7B.1B.2 — testable MatchRequestSheet lifecycle / a11y helpers.
 * No DOM. Parent owns serverErrorKey; the sheet never mirrors or hides it.
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

export type MatchRequestTabTrapResult = {
  preventDefault: true;
  nextIndex: number;
};

export function matchRequestTabTrap(
  event: { key: string; shiftKey: boolean },
  currentIndex: number,
  count: number,
): MatchRequestTabTrapResult | null {
  if (event.key !== "Tab" || count <= 0) return null;
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
