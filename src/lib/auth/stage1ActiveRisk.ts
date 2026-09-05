/**
 * Submit-time ACTIVE publication risk (deterministic, existing rules only).
 *
 * IDEMPOTENCY ≠ ANTI-SPAM:
 *   same client_request_id + same payload_hash → retry, skip risk
 *   a new client_request_id is a new intent and must pass the ACTIVE gate
 *
 * Phone / plate rules cannot run at Stage-1 (contact is post-publish).
 * Those remain on complete-contact / submitPost.
 *
 * This check is application-side (not inside the RPC transaction).
 * Concurrent publishes can race (TOCTOU). Not claimed as financial-grade atomic.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  processDemandPostIntercept,
  processSupplyPostIntercept,
} from "@/lib/post-intercept";
import { demandInterceptRange, buildDepartureTimestamp } from "@/lib/post-time-windows";

export type PublishIntentRow = {
  id: string;
  user_id: string;
  payload_hash: string | null;
  status: string;
};

export type Stage1ActiveRiskDecision = {
  allowed: boolean;
  errorKey: string;
  logFraud: boolean;
};

export async function findPublishIntentByClientRequestId(
  supabase: SupabaseClient,
  clientRequestId: string,
): Promise<PublishIntentRow | null> {
  const { data, error } = await supabase
    .from("posts")
    .select("id, user_id, payload_hash, status")
    .eq("client_request_id", clientRequestId)
    .maybeSingle();

  if (error || !data) return null;
  return data as PublishIntentRow;
}

/** Same owner + same hash + already ACTIVE → HTTP retry, not spam. */
export function isIdempotentActiveRetry(
  existing: PublishIntentRow | null,
  userId: string,
  payloadHash: string,
): boolean {
  return (
    existing != null &&
    existing.user_id === userId &&
    existing.payload_hash === payloadHash &&
    existing.status === "active"
  );
}

export async function evaluateStage1ActivePublicationRisk(
  supabase: SupabaseClient,
  userId: string,
  payload: {
    post_type: string;
    departure_date?: string | null;
    departure_time_window?: string | null;
  },
): Promise<Stage1ActiveRiskDecision> {
  if (payload.post_type === "demand") {
    if (!payload.departure_date || !payload.departure_time_window) {
      return { allowed: true, errorKey: "success.posted", logFraud: false };
    }

    const { from, to } = demandInterceptRange(
      payload.departure_date,
      payload.departure_time_window,
    );
    const { data: rows } = await supabase
      .from("posts")
      .select("user_id, departure_date, departure_time_window")
      .eq("user_id", userId)
      .in("status", ["active", "matched", "pending_completion"]);

    const activeOwn = (rows ?? []).filter((r) => {
      if (!r.departure_date || !r.departure_time_window) return false;
      const ts = buildDepartureTimestamp(
        r.departure_date as string,
        r.departure_time_window as string,
      );
      return ts >= from && ts <= to;
    }).length;

    const decision = processDemandPostIntercept({
      is_phone_duplicated: false,
      account_count: 1,
      active_order_count: activeOwn,
    });
    return {
      allowed: decision.allowed,
      errorKey: decision.messageKey,
      logFraud: decision.logFraud,
    };
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("is_premium")
    .eq("id", userId)
    .maybeSingle();
  const isPremium = Boolean((profileRow as { is_premium?: boolean } | null)?.is_premium);

  const { count } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("post_type", "provider")
    .eq("status", "active");

  const decision = processSupplyPostIntercept({
    is_phone_historically_reused: false,
    last_post_time_delta_months: 999,
    active_supply_posts_count: count ?? 0,
    is_premium_member: isPremium,
  });
  return {
    allowed: decision.allowed,
    errorKey: decision.messageKey,
    logFraud: decision.logFraud,
  };
}
