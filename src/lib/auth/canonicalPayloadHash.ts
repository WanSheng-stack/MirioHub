/**
 * Compatibility wrapper. New publish paths must use
 * buildCanonicalStage1PublishContext() so hash/fee/normalization stay unified.
 */

import "server-only";
import {
  computeServerFeeMinor,
  hashCanonicalStage1,
  normalizeCanonicalStage1,
} from "@/lib/auth/canonicalStage1";

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
  const canonicalPayload = normalizeCanonicalStage1(rawPostInput);
  const serverFeeMinor = computeServerFeeMinor(serverKms, canonicalPayload);
  return {
    hash: hashCanonicalStage1(canonicalPayload, serverKms, serverFeeMinor),
    serverFeeMinor,
  };
}
