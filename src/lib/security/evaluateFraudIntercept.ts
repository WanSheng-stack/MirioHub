import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { rpcGatherWindowInterceptMetrics } from "@/lib/security/fraudLookupRpc";
import { writeFraudLog } from "@/lib/security/writeFraudAudit";
import {
  countActiveSupplyPosts,
  loadDemandPostForMatch,
  loadStackedMatchedPosts,
  runProviderMatchIntercept,
  runPublishIntercept,
  type FraudDecision,
  type ProviderMatchInterceptInput,
  type PublishInterceptInput,
} from "@/lib/security/runFraudIntercept";

export type { FraudDecision };

export async function evaluatePublishIntercept(
  input: PublishInterceptInput,
): Promise<FraudDecision> {
  const admin = createAdminClient();
  return runPublishIntercept(admin, input, {
    gatherWindow: rpcGatherWindowInterceptMetrics,
    countActiveSupplyPosts,
    writeAudit: writeFraudLog,
  });
}

export async function evaluateProviderMatchFraud(
  input: ProviderMatchInterceptInput,
): Promise<FraudDecision> {
  const admin = createAdminClient();
  return runProviderMatchIntercept(admin, input, {
    loadDemandPost: loadDemandPostForMatch,
    gatherWindow: rpcGatherWindowInterceptMetrics,
    loadStackedMatchedPosts,
    writeAudit: writeFraudLog,
  });
}
