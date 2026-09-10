/**
 * PHASE 6.7B.1B.5A — testable MatchRequestSheet lifecycle / a11y helpers.
 * Parent owns serverErrorKey. Tab and restore share one focus-eligibility rule.
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

export type MatchRequestFocusEligibility = {
  isConnected: boolean;
  disabled: boolean;
  tabIndex: number;
  inputTypeHidden: boolean;
  hiddenInTree: boolean;
  ariaHiddenInTree: boolean;
  inertInTree: boolean;
  displayNoneInTree: boolean;
  visibilityHiddenInTree: boolean;
};

export type MatchRequestFocusTreeNode = {
  hidden: boolean;
  ariaHidden: boolean;
  inert: boolean;
  disabled: boolean;
  display: string;
  visibility: string;
};

export function collectMatchRequestFocusEligibility(input: {
  isConnected: boolean;
  disabled: boolean;
  tabIndex: number;
  inputTypeHidden: boolean;
  chain: readonly MatchRequestFocusTreeNode[];
}): MatchRequestFocusEligibility {
  return {
    isConnected: input.isConnected,
    disabled: input.disabled || input.chain.some((node) => node.disabled),
    tabIndex: input.tabIndex,
    inputTypeHidden: input.inputTypeHidden,
    hiddenInTree: input.chain.some((node) => node.hidden),
    ariaHiddenInTree: input.chain.some((node) => node.ariaHidden),
    inertInTree: input.chain.some((node) => node.inert),
    displayNoneInTree: input.chain.some((node) => node.display === "none"),
    visibilityHiddenInTree: input.chain.some(
      (node) => node.visibility === "hidden" || node.visibility === "collapse",
    ),
  };
}

export function isEligibleMatchRequestFocusTarget(
  facts: MatchRequestFocusEligibility,
): boolean {
  if (!facts.isConnected) return false;
  if (facts.disabled) return false;
  if (facts.tabIndex < 0) return false;
  if (facts.inputTypeHidden) return false;
  if (facts.hiddenInTree) return false;
  if (facts.ariaHiddenInTree) return false;
  if (facts.inertInTree) return false;
  if (facts.displayNoneInTree) return false;
  if (facts.visibilityHiddenInTree) return false;
  return true;
}

function failClosedFocusEligibility(): MatchRequestFocusEligibility {
  return {
    isConnected: false,
    disabled: true,
    tabIndex: -1,
    inputTypeHidden: true,
    hiddenInTree: true,
    ariaHiddenInTree: true,
    inertInTree: true,
    displayNoneInTree: true,
    visibilityHiddenInTree: true,
  };
}

export type MatchRequestStyleSnapshot = {
  display: string;
  visibility: string;
};

export function safeMatchRequestStyleReader(el: HTMLElement): MatchRequestStyleSnapshot {
  const style = getComputedStyle(el);
  return {
    display: String(style.display),
    visibility: String(style.visibility),
  };
}

export function safeFocusMatchRequestElement(
  element: { focus: () => void } | null | undefined,
): boolean {
  if (!element) return false;
  try {
    element.focus();
    return true;
  } catch {
    return false;
  }
}

function nodeIsDisabled(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled")) return true;
  if ((el as HTMLElement & { disabled?: boolean }).disabled === true) return true;
  try {
    if (typeof el.matches === "function" && el.matches(":disabled")) return true;
  } catch {
    // Attribute/property already decided; a :disabled throw must not clear that.
  }
  return false;
}

function nodeIsHiddenFlag(el: HTMLElement): boolean {
  return el.hidden === true || el.hasAttribute("hidden");
}

function nodeIsInert(el: HTMLElement): boolean {
  return el.hasAttribute("inert") || Boolean((el as HTMLElement & { inert?: boolean }).inert);
}

function nodeIsHiddenInput(el: HTMLElement): boolean {
  if (el.tagName !== "INPUT") return false;
  const input = el as HTMLInputElement;
  return input.type === "hidden" || input.getAttribute("type") === "hidden";
}

export function readMatchRequestFocusEligibility(
  el: HTMLElement,
  options?: {
    getStyle?: (node: HTMLElement) => MatchRequestStyleSnapshot;
  },
): MatchRequestFocusEligibility {
  const getStyle = options?.getStyle ?? safeMatchRequestStyleReader;
  try {
    const chain: MatchRequestFocusTreeNode[] = [];
    let node: HTMLElement | null = el;
    while (node) {
      let snapshot: MatchRequestStyleSnapshot;
      try {
        snapshot = getStyle(node);
      } catch {
        return failClosedFocusEligibility();
      }
      chain.push({
        hidden: nodeIsHiddenFlag(node),
        ariaHidden: node.getAttribute("aria-hidden") === "true",
        inert: nodeIsInert(node),
        disabled: nodeIsDisabled(node),
        display: snapshot.display,
        visibility: snapshot.visibility,
      });
      node = node.parentElement;
    }
    return collectMatchRequestFocusEligibility({
      isConnected: el.isConnected,
      disabled: nodeIsDisabled(el),
      tabIndex: el.tabIndex,
      inputTypeHidden: nodeIsHiddenInput(el),
      chain,
    });
  } catch {
    return failClosedFocusEligibility();
  }
}

export type RestoreMatchRequestTriggerFocusResult =
  | "restored"
  | "skipped"
  | "focus_failed";

export type MatchRequestRestoreNode = {
  isConnected: boolean;
  contains?(other: unknown): boolean;
  focus?(): void;
};

export function restoreMatchRequestTriggerFocus(input: {
  target: MatchRequestRestoreNode | HTMLElement | null;
  dialog: MatchRequestRestoreNode | HTMLElement | null;
  contains?: (
    dialog: MatchRequestRestoreNode | HTMLElement | null,
    target: MatchRequestRestoreNode | HTMLElement,
  ) => boolean;
  eligibility?: MatchRequestFocusEligibility;
  readEligibility?: (
    target: MatchRequestRestoreNode | HTMLElement,
  ) => MatchRequestFocusEligibility;
  focus?: (target: MatchRequestRestoreNode | HTMLElement) => boolean;
}): RestoreMatchRequestTriggerFocusResult {
  const target = input.target;
  if (!target || target.isConnected !== true) return "skipped";

  const insideDialog = input.contains
    ? input.contains(input.dialog, target)
    : typeof (input.dialog as HTMLElement | null)?.contains === "function"
      ? Boolean((input.dialog as HTMLElement).contains(target as Node))
      : false;
  if (insideDialog) return "skipped";

  let facts: MatchRequestFocusEligibility;
  try {
    facts =
      input.eligibility ??
      input.readEligibility?.(target) ??
      readMatchRequestFocusEligibility(target as unknown as HTMLElement, {
        getStyle: safeMatchRequestStyleReader,
      });
  } catch {
    return "skipped";
  }
  if (!isEligibleMatchRequestFocusTarget(facts)) return "skipped";

  try {
    const focused = input.focus
      ? input.focus(target)
      : safeFocusMatchRequestElement(
          typeof target.focus === "function"
            ? { focus: () => target.focus?.() }
            : null,
        );
    return focused ? "restored" : "focus_failed";
  } catch {
    return "focus_failed";
  }
}

export const MATCH_REQUEST_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "textarea:not(:disabled)",
  "input:not(:disabled):not([type='hidden'])",
  "select:not(:disabled)",
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
