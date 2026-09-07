import type { SupabaseClient } from "@supabase/supabase-js";

export type FraudLogRow = {
  user_id: string;
  scene: string;
  normalized_phone?: string | null;
  normalized_license_plate?: string | null;
  reporter_side: string;
};

/**
 * Persist a hard-deny audit row. Failure is observable in server logs only.
 * The boolean must never change an already-decided hard deny.
 */
export async function writeFraudLog(
  admin: SupabaseClient,
  row: FraudLogRow,
): Promise<boolean> {
  try {
    const { error } = await admin.from("fraud_logs").insert(row);
    if (error) {
      console.error("[fraud-audit] write failed");
      return false;
    }
    return true;
  } catch {
    console.error("[fraud-audit] writer threw");
    return false;
  }
}

/** Audit storage outcome never overrides an already-decided FraudDecision. */
export function retainFraudDecision<
  T extends { allowed: boolean; errorKey: string; isSpaceWarning?: boolean },
>(decision: T, auditOk: boolean): T {
  void auditOk;
  return decision;
}
