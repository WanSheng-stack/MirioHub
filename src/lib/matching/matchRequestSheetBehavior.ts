/**
 * PHASE 6.7B.1B.1 — testable MatchRequestSheet lifecycle / a11y helpers.
 * No DOM. Sheet calls these so Tab wrap, Escape lock, and error reset
 * are proven by execution, not source-string greps alone.
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

export function visibleServerErrorKey(
  serverErrorKey: string | null,
  errorGeneration: number,
  dismissedGeneration: number,
): string | null {
  if (!serverErrorKey) return null;
  if (dismissedGeneration === errorGeneration) return null;
  return serverErrorKey;
}

export function errorGenerationAfterKeyChange(
  prevKey: string | null,
  nextKey: string | null,
  prevGeneration: number,
): number {
  if (prevKey === nextKey) return prevGeneration;
  return prevGeneration + 1;
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
