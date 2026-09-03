/**
 * Shared canonical payload hash (v1).
 * Used by Passkey verify and trusted-account publish so the same intent
 * produces the same payload_hash. Do not fork this algorithm.
 */

import crypto from "crypto";
import { calculateFinalFee } from "@/lib/post-fee";

export interface RawPostInput {
  post_type?: unknown;
  category?: unknown;
  origin_address?: unknown;
  destination_address?: unknown;
  departure_date?: unknown;
  departure_time?: unknown;
  share_mode?: unknown;
  delivery_mode?: unknown;
  escort_seats?: unknown;
  count_small?: unknown;
  count_medium?: unknown;
  count_large?: unknown;
  count_xlarge?: unknown;
  bump_fee_minor?: unknown;
  waypoints?: unknown;
  currency?: unknown;
  [key: string]: unknown;
}

export function generateCanonicalPayloadHashV1(
  rawPostInput: RawPostInput,
  serverKms: number,
): { hash: string; serverFeeMinor: number } {
  const bumpFeeInput = Number(rawPostInput.bump_fee_minor ?? 0);
  if (!Number.isSafeInteger(bumpFeeInput) || bumpFeeInput < 0 || bumpFeeInput > 5000) {
    throw new Error("error.invalid_bump_fee_boundary");
  }

  const normalized = {
    post_type: String(rawPostInput.post_type ?? "").trim().toLowerCase(),
    category: String(rawPostInput.category ?? "").trim().toLowerCase(),
    origin_address: rawPostInput.origin_address
      ? String(rawPostInput.origin_address).normalize("NFC").trim()
      : null,
    destination_address: rawPostInput.destination_address
      ? String(rawPostInput.destination_address).normalize("NFC").trim()
      : null,
    departure_date: String(rawPostInput.departure_date ?? "").trim(),
    departure_time: String(rawPostInput.departure_time ?? "").trim().slice(0, 5),
    share_mode: rawPostInput.share_mode ? String(rawPostInput.share_mode).trim() : null,
    delivery_mode: rawPostInput.delivery_mode
      ? String(rawPostInput.delivery_mode).trim()
      : null,
    escort_seats: Math.max(0, Math.floor(Number(rawPostInput.escort_seats ?? 0))),
    count_small: Math.max(0, Math.floor(Number(rawPostInput.count_small ?? 0))),
    count_medium: Math.max(0, Math.floor(Number(rawPostInput.count_medium ?? 0))),
    count_large: Math.max(0, Math.floor(Number(rawPostInput.count_large ?? 0))),
    count_xlarge: Math.max(0, Math.floor(Number(rawPostInput.count_xlarge ?? 0))),
    bump_fee_minor: bumpFeeInput,
  };

  if (
    Object.values(normalized).some(
      (v) => typeof v === "number" && (!Number.isSafeInteger(v) || v < 0),
    )
  ) {
    throw new Error("error.invalid_payload_numeric_values");
  }

  const mockStateForFee = {
    estimated_kms: serverKms,
    count_small: normalized.count_small,
    count_medium: normalized.count_medium,
    count_large: normalized.count_large,
    count_xlarge: normalized.count_xlarge,
    bump_fee: normalized.bump_fee_minor / 100,
    share_mode: normalized.share_mode,
    delivery_mode: normalized.delivery_mode,
    category: normalized.category,
    escort_seats: normalized.escort_seats,
  };

  const serverCalculatedFeeFloat = calculateFinalFee(
    serverKms,
    mockStateForFee as Parameters<typeof calculateFinalFee>[1],
  );
  const serverFeeMinor = Math.round(serverCalculatedFeeFloat * 100);

  const waypointsList = Array.isArray(rawPostInput.waypoints)
    ? (rawPostInput.waypoints as Record<string, unknown>[]).map((w) =>
        String(w.address ?? "").normalize("NFC").trim().toLowerCase(),
      )
    : [];

  const canonical = {
    pt: normalized.post_type,
    cat: normalized.category,
    origin: normalized.origin_address ? normalized.origin_address.toLowerCase() : null,
    dest: normalized.destination_address
      ? normalized.destination_address.toLowerCase()
      : null,
    date: normalized.departure_date,
    time: normalized.departure_time,
    sm: normalized.share_mode ? normalized.share_mode.toLowerCase() : null,
    dm: normalized.delivery_mode ? normalized.delivery_mode.toLowerCase() : null,
    es: normalized.escort_seats,
    wp: waypointsList,
    c_s: normalized.count_small,
    c_m: normalized.count_medium,
    c_l: normalized.count_large,
    c_xl: normalized.count_xlarge,
    fee_minor: serverFeeMinor,
    currency: String(rawPostInput.currency ?? "EUR").trim().toUpperCase(),
    skms: serverKms,
  };

  const sortedKeys = Object.keys(canonical).sort() as (keyof typeof canonical)[];
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical, sortedKeys))
    .digest("hex");

  return { hash, serverFeeMinor };
}
