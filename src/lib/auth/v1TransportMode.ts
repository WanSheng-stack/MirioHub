/**
 * Production V1 transport_mode allowlist for Stage 1 persistence.
 * Must stay aligned with live publish `TRANSPORT_MODES` (not V2 policy names).
 * Does not map van → cargo_van. Does not accept V2 modes.
 */

import { TRANSPORT_MODES } from "@/lib/posts";
import type { TransportMode } from "@/lib/types";

export type ValidV1TransportMode = TransportMode;

export const V1_STAGE1_TRANSPORT_MODES: readonly ValidV1TransportMode[] =
  TRANSPORT_MODES;

export const INVALID_TRANSPORT_MODE_KEY = "error.invalid_transport_mode";

const ALLOWED = new Set<string>(V1_STAGE1_TRANSPORT_MODES);

export function isValidV1TransportMode(
  value: string,
): value is ValidV1TransportMode {
  return ALLOWED.has(value);
}

/**
 * Stage 1 normalize: missing / null / blank → null.
 * Unknown, V2, and non-string values reject. No fuzzy mapping.
 */
export function parseV1TransportMode(
  raw: unknown,
):
  | { ok: true; value: ValidV1TransportMode | null }
  | { ok: false; errorKey: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, errorKey: INVALID_TRANSPORT_MODE_KEY };
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: true, value: null };
  }
  if (!isValidV1TransportMode(trimmed)) {
    return { ok: false, errorKey: INVALID_TRANSPORT_MODE_KEY };
  }
  return { ok: true, value: trimmed };
}
