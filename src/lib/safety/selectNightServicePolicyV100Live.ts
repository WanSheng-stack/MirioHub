/**
 * PHASE 6.7C.2C.3H — live night-policy selector adapter (service_role).
 * Calls select_night_service_policy_v100. Fail-closed; no RS/timezone/version
 * inference. Server-only.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NightPolicySelectInput } from "@/lib/safety/trustedPublishAuthorityCore";

export class NightPolicySelectorRpcError extends Error {
  readonly errorKey = "error.night_policy_invalid" as const;
  constructor(message = "select_night_service_policy_v100 failed") {
    super(message);
    this.name = "NightPolicySelectorRpcError";
  }
}

/**
 * Live v100 selector via admin client. Returns RPC data as unknown for the
 * existing runtime validator. region_code is always SQL NULL.
 */
export async function selectNightServicePolicyV100Live(
  input: NightPolicySelectInput,
): Promise<unknown> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("select_night_service_policy_v100", {
    p_country_code: input.countryCode,
    p_region_code: null,
    p_origin_timezone: input.originTimezone,
    p_evaluation_time: input.evaluationTime,
  });

  if (error) {
    console.error("[night-selector-v100] RPC error", {
      code: error.code,
      category: "selector_rpc_failed",
    });
    throw new NightPolicySelectorRpcError();
  }

  return data as unknown;
}
