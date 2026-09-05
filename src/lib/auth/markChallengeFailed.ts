/**
 * Fenced challenge cleanup after a successful reserve.
 * Never updates by challenge id alone — stale tokens must no-op.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ChallengeFence = {
  challengeId: string;
  clientRequestId: string;
  processingToken: string;
};

export function mapChallengeReserveReason(reason: string | null | undefined): string {
  switch (reason) {
    case "expired":
      return "error.device_verification_expired";
    case "in_progress":
      return "error.device_verification_in_progress";
    case "failed":
      return "error.device_verification_failed";
    default:
      return "error.device_verification_invalid";
  }
}

export async function classifyChallengeReserveFailure(
  supabase: SupabaseClient,
  challengeId: string,
  clientRequestId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("classify_challenge_reserve_failure_v86", {
    p_challenge_id: challengeId,
    p_client_request_id: clientRequestId,
  });
  if (error) {
    console.error("[challenge] classify reserve failure", {
      challenge_id: challengeId,
      client_request_id: clientRequestId,
      category: "classify_rpc_error",
    });
    return mapChallengeReserveReason("invalid");
  }
  return mapChallengeReserveReason(typeof data === "string" ? data : "invalid");
}

export async function markChallengeFailed(
  supabase: SupabaseClient,
  fence: ChallengeFence | null,
  category: string,
): Promise<void> {
  if (!fence) return;
  const { error } = await supabase.rpc("mark_challenge_failed_v86", {
    p_challenge_id: fence.challengeId,
    p_client_request_id: fence.clientRequestId,
    p_processing_token: fence.processingToken,
  });
  if (error) {
    console.error("[challenge] mark failed rpc error", {
      challenge_id: fence.challengeId,
      client_request_id: fence.clientRequestId,
      category,
    });
    return;
  }
  console.error("[challenge] marked failed", {
    challenge_id: fence.challengeId,
    client_request_id: fence.clientRequestId,
    category,
  });
}
