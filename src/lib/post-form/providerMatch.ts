import type { SupabaseClient } from "@supabase/supabase-js";
import { processProviderMatchIntercept } from "@/lib/post-intercept";
import { totalLuggageUnits } from "@/lib/post-payload";

export type ProviderMatchResult =
  | { ok: true; isSpaceWarning: boolean }
  | { ok: false; errorKey: string; logFraud?: boolean };

export async function runProviderMatchIntercept(
  supabase: SupabaseClient,
  providerUserId: string,
  demandPostId: string,
  providerNormalizedPhone: string,
  providerNormalizedPlate: string | null,
  isBankVerified: boolean,
  newPassengers: number,
  newUnits: number,
): Promise<ProviderMatchResult> {
  const { data: demandPost } = await supabase
    .from("posts")
    .select("*")
    .eq("id", demandPostId)
    .maybeSingle();

  if (!demandPost) return { ok: false, errorKey: "error.not_found" };

  const depDate = demandPost.departure_date as string;
  const depWindow = demandPost.departure_time_window as string;

  const { data: activePosts } = await supabase
    .from("posts")
    .select("*")
    .eq("status", "matched")
    .eq("departure_date", depDate);

  const overlapping = (activePosts ?? []).filter((p) => {
    return p.departure_time_window === depWindow;
  });

  const phoneDup = overlapping.some(
    (p) => p.normalized_phone === providerNormalizedPhone,
  );
  const plateDup =
    providerNormalizedPlate &&
    overlapping.some((p) => p.normalized_license_plate === providerNormalizedPlate);
  const accountIds = new Set(overlapping.map((p) => p.user_id));
  const ownCargo = overlapping.filter((p) => p.user_id === providerUserId).length;

  let allUnits = 0;
  let allPassengers = 0;
  for (const p of overlapping) {
    allUnits += totalLuggageUnits({
      count_small: p.count_small ?? 0,
      count_medium: p.count_medium ?? 0,
      count_large: p.count_large ?? 0,
      count_xlarge: p.count_xlarge ?? 0,
    });
    allPassengers += (p.escort_seats ?? 0) + (p.max_companions ?? 0);
  }
  allUnits += newUnits;
  allPassengers += newPassengers;

  const decision = processProviderMatchIntercept({
    is_plate_duplicated: Boolean(plateDup),
    is_phone_duplicated: phoneDup,
    account_count: accountIds.size,
    active_cargo_order_count: ownCargo,
    current_all_matched_units: allUnits,
    current_all_passengers_count: allPassengers,
    is_bank_verified: isBankVerified,
  });

  if (!decision.allowed) {
    if (decision.logFraud) {
      await supabase.from("fraud_logs").insert({
        user_id: providerUserId,
        scene: decision.trackerScene,
        normalized_phone: providerNormalizedPhone,
        normalized_plate: providerNormalizedPlate,
      });
    }
    return { ok: false, errorKey: decision.messageKey, logFraud: decision.logFraud };
  }

  return { ok: true, isSpaceWarning: Boolean(decision.isSpaceWarning) };
}
