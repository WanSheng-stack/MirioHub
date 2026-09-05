/**
 * Canonical Stage-1 business contract.
 * Server-only: do not import from client components.
 *
 * raw client input ≠ canonical payload.
 * Illegal numerics are REJECTED, never silently clamped.
 */

import "server-only";
import crypto from "crypto";
import { calculateFinalFee } from "@/lib/post-fee";
import { mergeDepartureWindow } from "@/lib/post-time-windows";

export const SERVER_MAX_BUMP_FEE_MINOR = 5000;

export type CanonicalStage1Payload = {
  post_type: "demand" | "provider";
  category: "deliver" | "buy" | "onsite" | "errand" | "travel";
  title: string;
  origin_address: string;
  destination_address: string;
  departure_date: string;
  departure_time: string;
  departure_time_window: string;
  time_buffer: number;
  waypoints: string[];
  share_mode: "share" | "private" | null;
  delivery_mode: "spot" | "door" | null;
  count_small: number;
  count_medium: number;
  count_large: number;
  count_xlarge: number;
  escort_seats: number;
  bump_fee_minor: number;
  currency: string;
  locale: "zh" | "en" | "sr";
};

export type CanonicalStage1PublishContext = {
  canonicalPayload: CanonicalStage1Payload;
  payloadHash: string;
  serverKms: number;
  serverFeeMinor: number;
};

export class CanonicalStage1Error extends Error {
  readonly errorKey: string;
  constructor(errorKey: string) {
    super(errorKey);
    this.errorKey = errorKey;
  }
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const POST_TYPES = new Set(["demand", "provider"]);
const CATEGORIES = new Set(["deliver", "buy", "onsite", "errand", "travel"]);
const LOCALES = new Set(["zh", "en", "sr"]);

function requireSafeNonNegInt(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new CanonicalStage1Error("error.invalid_payload_numeric_values");
  }
  void field;
  return n;
}

function normalizeWaypointList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ordered: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const s = item.normalize("NFC").trim();
      if (s) ordered.push(s);
      continue;
    }
    if (item && typeof item === "object" && "address" in item) {
      const s = String((item as { address?: unknown }).address ?? "")
        .normalize("NFC")
        .trim();
      if (s) ordered.push(s);
    }
  }
  return ordered;
}

export function validateBumpFeeMinor(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  if (typeof raw === "number" && !Number.isFinite(raw)) {
    throw new CanonicalStage1Error("error.invalid_bump_fee_boundary");
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isSafeInteger(n) || n < 0 || n > SERVER_MAX_BUMP_FEE_MINOR) {
    throw new CanonicalStage1Error("error.invalid_bump_fee_boundary");
  }
  return n;
}

/** Accept integer minor units, or convert form major-unit bump_fee. */
export function resolveBumpFeeMinor(raw: Record<string, unknown>): number {
  if (raw.bump_fee_minor !== undefined && raw.bump_fee_minor !== null && raw.bump_fee_minor !== "") {
    return validateBumpFeeMinor(raw.bump_fee_minor);
  }
  if (raw.bump_fee !== undefined && raw.bump_fee !== null && raw.bump_fee !== "") {
    const major = Number(raw.bump_fee);
    if (!Number.isFinite(major) || major < 0) {
      throw new CanonicalStage1Error("error.invalid_bump_fee_boundary");
    }
    const minor = Math.round(major * 100);
    if (!Number.isSafeInteger(minor) || minor > SERVER_MAX_BUMP_FEE_MINOR) {
      throw new CanonicalStage1Error("error.invalid_bump_fee_boundary");
    }
    return minor;
  }
  return 0;
}

export function normalizeCanonicalStage1(
  raw: Record<string, unknown>,
): CanonicalStage1Payload {
  const post_type = String(raw.post_type ?? "").trim().toLowerCase();
  const category = String(raw.category ?? "").trim().toLowerCase();
  if (!POST_TYPES.has(post_type) || !CATEGORIES.has(category)) {
    throw new CanonicalStage1Error("error.invalid_payload_numeric_values");
  }

  const bump_fee_minor = resolveBumpFeeMinor(raw);
  const count_small = requireSafeNonNegInt(raw.count_small, "count_small");
  const count_medium = requireSafeNonNegInt(raw.count_medium, "count_medium");
  const count_large = requireSafeNonNegInt(raw.count_large, "count_large");
  const count_xlarge = requireSafeNonNegInt(raw.count_xlarge, "count_xlarge");
  const escort_seats = requireSafeNonNegInt(raw.escort_seats, "escort_seats");

  const time_buffer = requireSafeNonNegInt(raw.time_buffer, "time_buffer");
  if (time_buffer > 180) {
    throw new CanonicalStage1Error("error.invalid_payload_numeric_values");
  }

  const departure_time = String(raw.departure_time ?? "").trim().slice(0, 5);
  if (departure_time && !TIME_RE.test(departure_time)) {
    throw new CanonicalStage1Error("error.invalid_payload_numeric_values");
  }

  const departure_time_window = departure_time
    ? mergeDepartureWindow(departure_time, time_buffer)
    : String(raw.departure_time_window ?? "").trim();

  const shareRaw = raw.share_mode ? String(raw.share_mode).trim().toLowerCase() : "";
  const deliveryRaw = raw.delivery_mode
    ? String(raw.delivery_mode).trim().toLowerCase()
    : "";

  const localeRaw = String(raw.locale ?? "sr").trim().toLowerCase();
  const locale = (LOCALES.has(localeRaw) ? localeRaw : "sr") as "zh" | "en" | "sr";

  return {
    post_type: post_type as CanonicalStage1Payload["post_type"],
    category: category as CanonicalStage1Payload["category"],
    title: String(raw.title ?? "").trim(),
    origin_address: raw.origin_address
      ? String(raw.origin_address).normalize("NFC").trim()
      : "",
    destination_address: raw.destination_address
      ? String(raw.destination_address).normalize("NFC").trim()
      : "",
    departure_date: String(raw.departure_date ?? "").trim(),
    departure_time,
    departure_time_window,
    time_buffer,
    waypoints: normalizeWaypointList(raw.waypoints),
    share_mode: shareRaw === "share" || shareRaw === "private" ? shareRaw : null,
    delivery_mode: deliveryRaw === "spot" || deliveryRaw === "door" ? deliveryRaw : null,
    count_small,
    count_medium,
    count_large,
    count_xlarge,
    escort_seats,
    bump_fee_minor,
    currency: String(raw.currency ?? "EUR").trim().toUpperCase() || "EUR",
    locale,
  };
}

export function computeServerFeeMinor(
  serverKms: number,
  payload: CanonicalStage1Payload,
): number {
  const feeMajor = calculateFinalFee(serverKms, {
    post_type: payload.post_type,
    category: payload.category,
    count_small: payload.count_small,
    count_medium: payload.count_medium,
    count_large: payload.count_large,
    count_xlarge: payload.count_xlarge,
    bump_fee: payload.bump_fee_minor / 100,
    share_mode: payload.share_mode,
    delivery_mode: payload.delivery_mode,
    escort_seats: payload.escort_seats,
    phone_id: 0,
    raw_phone: "",
    normalized_phone: "",
    departure_date: payload.departure_date,
    departure_time_window: payload.departure_time_window,
    estimated_arrival_time: null,
    fee_amount: null,
  });
  return Math.round(feeMajor * 100);
}

export function hashCanonicalStage1(
  payload: CanonicalStage1Payload,
  serverKms: number,
  serverFeeMinor: number,
): string {
  const canonical = {
    pt: payload.post_type,
    cat: payload.category,
    origin: payload.origin_address ? payload.origin_address.toLowerCase() : "",
    dest: payload.destination_address ? payload.destination_address.toLowerCase() : "",
    date: payload.departure_date,
    time: payload.departure_time,
    tw: payload.departure_time_window,
    tb: payload.time_buffer,
    sm: payload.share_mode,
    dm: payload.delivery_mode,
    es: payload.escort_seats,
    wp: payload.waypoints.map((w) => w.toLowerCase()),
    c_s: payload.count_small,
    c_m: payload.count_medium,
    c_l: payload.count_large,
    c_xl: payload.count_xlarge,
    bump: payload.bump_fee_minor,
    fee_minor: serverFeeMinor,
    currency: payload.currency,
    locale: payload.locale,
    skms: serverKms,
  };
  const sortedKeys = Object.keys(canonical).sort() as (keyof typeof canonical)[];
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical, sortedKeys))
    .digest("hex");
}

export function toRpcStage1Payload(
  payload: CanonicalStage1Payload,
  serverFeeMinor: number,
): Record<string, unknown> {
  return {
    post_type: payload.post_type,
    category: payload.category,
    title: payload.title,
    origin_address: payload.origin_address,
    destination_address: payload.destination_address,
    departure_date: payload.departure_date,
    departure_time: payload.departure_time,
    departure_time_window: payload.departure_time_window,
    time_buffer: payload.time_buffer,
    waypoints: payload.waypoints,
    share_mode: payload.share_mode,
    delivery_mode: payload.delivery_mode,
    count_small: payload.count_small,
    count_medium: payload.count_medium,
    count_large: payload.count_large,
    count_xlarge: payload.count_xlarge,
    escort_seats: payload.escort_seats,
    bump_fee_minor: payload.bump_fee_minor,
    currency: payload.currency,
    locale: payload.locale,
    fee_amount_minor: serverFeeMinor,
  };
}
