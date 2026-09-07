import "server-only";
import {
  processDemandPostIntercept,
  processProviderMatchIntercept,
  processSupplyPostIntercept,
} from "@/lib/post-intercept";
import { totalLuggageUnits } from "@/lib/post-payload";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  rpcCountAssetBoundAccounts,
  rpcGatherWindowInterceptMetrics,
  rpcLookupForeignPhoneReuse,
} from "@/lib/security/fraudLookupRpc";
import type { Post } from "@/lib/types";

export type FraudDecision = {
  allowed: boolean;
  errorKey: string;
  isSpaceWarning?: boolean;
};

async function writeFraudLog(row: {
  user_id: string;
  scene: string;
  normalized_phone?: string | null;
  normalized_license_plate?: string | null;
  reporter_side: string;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from("fraud_logs").insert(row);
}

export async function evaluatePublishIntercept(input: {
  userId: string;
  postType: "demand" | "provider";
  normalizedPhone: string;
  normalizedPlate: string | null;
  departureDate: string;
  departureWindow: string;
  isPremium: boolean;
}): Promise<FraudDecision> {
  const admin = createAdminClient();

  if (input.postType === "demand") {
    const window = await rpcGatherWindowInterceptMetrics(
      admin,
      input.userId,
      input.normalizedPhone,
      input.normalizedPlate,
      input.departureDate,
      input.departureWindow,
    );
    const historyPhoneAccounts = await rpcCountAssetBoundAccounts(
      admin,
      "phone",
      input.normalizedPhone,
    );
    if (window == null || historyPhoneAccounts == null) {
      return { allowed: false, errorKey: "error.submit_failed" };
    }
    const decision = processDemandPostIntercept({
      is_phone_duplicated: window.has_other_phone || historyPhoneAccounts > 1,
      account_count: Math.max(
        window.window_phone_account_count,
        historyPhoneAccounts,
      ),
      active_order_count: window.own_in_window_count,
    });
    if (!decision.allowed && decision.logFraud && decision.trackerScene) {
      await writeFraudLog({
        user_id: input.userId,
        scene: decision.trackerScene,
        normalized_phone: input.normalizedPhone,
        normalized_license_plate: input.normalizedPlate,
        reporter_side: "demand",
      });
    }
    return { allowed: decision.allowed, errorKey: decision.messageKey };
  }

  const reuse = await rpcLookupForeignPhoneReuse(
    admin,
    input.userId,
    input.normalizedPhone,
  );
  const phoneAccounts = await rpcCountAssetBoundAccounts(
    admin,
    "phone",
    input.normalizedPhone,
  );
  const plateAccounts = input.normalizedPlate
    ? await rpcCountAssetBoundAccounts(admin, "plate", input.normalizedPlate)
    : 0;
  if (reuse == null || phoneAccounts == null || plateAccounts == null) {
    return { allowed: false, errorKey: "error.submit_failed" };
  }

  let is_phone_historically_reused = reuse.reused;
  let last_post_time_delta_months = 999;
  if (reuse.last_post_at) {
    last_post_time_delta_months = Math.floor(
      (Date.now() - new Date(reuse.last_post_at).getTime()) /
        (1000 * 60 * 60 * 24 * 30),
    );
  }
  if (phoneAccounts > 1 || plateAccounts > 1) {
    is_phone_historically_reused = true;
    last_post_time_delta_months = Math.min(last_post_time_delta_months, 0);
  }

  const { count } = await admin
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.userId)
    .eq("post_type", "provider")
    .eq("status", "active");

  const decision = processSupplyPostIntercept({
    is_phone_historically_reused,
    last_post_time_delta_months,
    active_supply_posts_count: count ?? 0,
    is_premium_member: input.isPremium,
  });
  if (!decision.allowed && decision.logFraud && decision.trackerScene) {
    await writeFraudLog({
      user_id: input.userId,
      scene: decision.trackerScene,
      normalized_phone: input.normalizedPhone,
      normalized_license_plate: input.normalizedPlate,
      reporter_side: "provider",
    });
  }
  return { allowed: decision.allowed, errorKey: decision.messageKey };
}

export async function evaluateProviderMatchFraud(input: {
  userId: string;
  demandPostId: string;
  providerNormalizedPhone: string;
  providerNormalizedLicensePlate: string | null;
  isBankVerified: boolean;
}): Promise<FraudDecision> {
  const admin = createAdminClient();
  const { data: demandPost } = await admin
    .from("posts")
    .select(
      "id, category, escort_seats, max_companions, count_small, count_medium, count_large, count_xlarge, departure_date, departure_time_window",
    )
    .eq("id", input.demandPostId)
    .maybeSingle();
  if (!demandPost) return { allowed: false, errorKey: "error.not_found" };

  const demand = demandPost as Pick<
    Post,
    | "category"
    | "escort_seats"
    | "max_companions"
    | "count_small"
    | "count_medium"
    | "count_large"
    | "count_xlarge"
    | "departure_date"
    | "departure_time_window"
  >;
  const isPureCargo =
    demand.category === "deliver" && (demand.escort_seats ?? 0) === 0;

  const window = await rpcGatherWindowInterceptMetrics(
    admin,
    input.userId,
    input.providerNormalizedPhone,
    input.providerNormalizedLicensePlate,
    (demand.departure_date as string) ?? "",
    (demand.departure_time_window as string) ?? "",
  );
  const phoneHistoryAccounts = await rpcCountAssetBoundAccounts(
    admin,
    "phone",
    input.providerNormalizedPhone,
  );
  const plateHistoryAccounts = input.providerNormalizedLicensePlate
    ? await rpcCountAssetBoundAccounts(
        admin,
        "plate",
        input.providerNormalizedLicensePlate,
      )
    : 0;

  if (window == null || phoneHistoryAccounts == null || plateHistoryAccounts == null) {
    return { allowed: false, errorKey: "error.submit_failed" };
  }

  const account_count = Math.max(
    window.window_phone_account_count,
    phoneHistoryAccounts,
    plateHistoryAccounts,
  );
  const is_phone_duplicated =
    window.window_phone_account_count > 1 || phoneHistoryAccounts > 1;
  const is_plate_duplicated =
    Boolean(input.providerNormalizedLicensePlate) &&
    (plateHistoryAccounts > 1 || window.has_other_plate);

  if ((is_phone_duplicated || is_plate_duplicated) && account_count > 1) {
    await writeFraudLog({
      user_id: input.userId,
      scene: "multi_account_spacetime_collision",
      normalized_phone: input.providerNormalizedPhone,
      normalized_license_plate: input.providerNormalizedLicensePlate,
      reporter_side: "provider",
    });
    return { allowed: false, errorKey: "error.match_denied_blurred" };
  }

  if (!isPureCargo) {
    return { allowed: true, errorKey: "success.matched" };
  }

  const { data: stackedRows } = await admin
    .from("posts")
    .select(
      "user_id, category, escort_seats, max_companions, count_small, count_medium, count_large, count_xlarge",
    )
    .eq("status", "matched")
    .eq("user_id", input.userId)
    .eq("departure_date", demand.departure_date as string);

  let currentStackedSeats = 0;
  let currentStackedUnits = 0;
  for (const row of stackedRows ?? []) {
    const p = row as Post;
    currentStackedSeats +=
      (p.category === "travel" ? p.max_companions ?? 0 : p.escort_seats ?? 0) || 0;
    currentStackedUnits += totalLuggageUnits({
      count_small: p.count_small ?? 0,
      count_medium: p.count_medium ?? 0,
      count_large: p.count_large ?? 0,
      count_xlarge: p.count_xlarge ?? 0,
    });
  }

  const newPassengers =
    demand.category === "travel"
      ? demand.max_companions ?? 1
      : demand.escort_seats ?? 0;
  const newUnits = totalLuggageUnits({
    count_small: demand.count_small ?? 0,
    count_medium: demand.count_medium ?? 0,
    count_large: demand.count_large ?? 0,
    count_xlarge: demand.count_xlarge ?? 0,
  });

  const decision = processProviderMatchIntercept({
    is_plate_duplicated,
    is_phone_duplicated,
    account_count,
    active_cargo_order_count: window.own_cargo_in_window,
    current_all_matched_units: currentStackedUnits + newUnits,
    current_all_passengers_count: currentStackedSeats + newPassengers,
    is_bank_verified: input.isBankVerified,
  });
  if (!decision.allowed && decision.logFraud && decision.trackerScene) {
    await writeFraudLog({
      user_id: input.userId,
      scene: decision.trackerScene,
      normalized_phone: input.providerNormalizedPhone,
      normalized_license_plate: input.providerNormalizedLicensePlate,
      reporter_side: "provider",
    });
  }
  return {
    allowed: decision.allowed,
    errorKey: decision.messageKey,
    isSpaceWarning: Boolean(decision.isSpaceWarning),
  };
}
