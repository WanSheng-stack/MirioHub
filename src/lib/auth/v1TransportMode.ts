/**
 * Frozen V1 Stage-1 transport allowlist (v86 / historical rows).
 * New publish uses `@/lib/auth/publishTransportMode` + transportPolicy targets.
 * Do not expand this list with V2 cargo modes.
 */

export type ValidV1TransportMode =
  | "walking"
  | "scooter"
  | "bicycle"
  | "motorbike"
  | "subway"
  | "bus"
  | "train"
  | "flight"
  | "car"
  | "van";

export const V1_STAGE1_TRANSPORT_MODES: readonly ValidV1TransportMode[] = [
  "walking",
  "scooter",
  "bicycle",
  "motorbike",
  "subway",
  "bus",
  "train",
  "flight",
  "car",
  "van",
] as const;

export const INVALID_TRANSPORT_MODE_KEY = "error.invalid_transport_mode";

const ALLOWED = new Set<string>(V1_STAGE1_TRANSPORT_MODES);

export function isValidV1TransportMode(
  value: string,
): value is ValidV1TransportMode {
  return ALLOWED.has(value);
}

/**
 * Historical V1 parser: missing / null / blank → null.
 * Unknown and non-string values reject. No fuzzy mapping.
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
