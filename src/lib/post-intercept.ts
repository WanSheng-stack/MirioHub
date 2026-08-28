export interface DemandPostInterceptMetrics {
  is_phone_duplicated: boolean;
  account_count: number;
  active_order_count: number;
}

export interface ProviderMatchInterceptMetrics {
  is_plate_duplicated: boolean;
  is_phone_duplicated: boolean;
  account_count: number;
  active_cargo_order_count: number;
  current_all_matched_units: number;
  current_all_passengers_count: number;
  is_bank_verified: boolean;
}

export interface SupplyPostInterceptMetrics {
  is_phone_historically_reused: boolean;
  last_post_time_delta_months: number;
  active_supply_posts_count: number;
  is_premium_member: boolean;
}

export type InterceptResult = {
  allowed: boolean;
  messageKey: string;
  logFraud: boolean;
  trackerScene?: string;
  isSpaceWarning?: boolean;
};

export function processDemandPostIntercept(
  metrics: DemandPostInterceptMetrics,
): InterceptResult {
  if (metrics.is_phone_duplicated === true && metrics.account_count > 1) {
    return {
      allowed: false,
      messageKey: "error.post_denied_blurred",
      logFraud: true,
      trackerScene: "multi_account_demand_spam",
    };
  }
  if (metrics.account_count <= 1 && metrics.active_order_count > 0) {
    return {
      allowed: false,
      messageKey: "error.time_window_overlap",
      logFraud: false,
    };
  }
  return { allowed: true, messageKey: "success.posted", logFraud: false };
}

export function processProviderMatchIntercept(
  metrics: ProviderMatchInterceptMetrics,
): InterceptResult {
  if ((metrics.is_plate_duplicated || metrics.is_phone_duplicated) && metrics.account_count > 1) {
    return {
      allowed: false,
      messageKey: "error.match_denied_blurred",
      logFraud: true,
      trackerScene: "multi_account_cargo_theft",
      isSpaceWarning: false,
    };
  }
  const waterlevel_ceiling = metrics.is_bank_verified ? 3 : 1;

  if (
    (metrics.is_plate_duplicated || metrics.is_phone_duplicated) &&
    metrics.account_count <= 1 &&
    metrics.active_cargo_order_count >= waterlevel_ceiling
  ) {
    const errorKey = metrics.is_bank_verified
      ? "error.active_cargo_limit_reached"
      : "error.bank_verification_required";
    return { allowed: false, messageKey: errorKey, logFraud: false, isSpaceWarning: false };
  }
  if (metrics.current_all_passengers_count + 1 > 5) {
    return {
      allowed: false,
      messageKey: "error.passenger_limit_exceeded",
      logFraud: false,
      isSpaceWarning: false,
    };
  }
  const isSpaceWarning = metrics.current_all_matched_units > 24;
  return { allowed: true, messageKey: "success.matched", logFraud: false, isSpaceWarning };
}

export function processSupplyPostIntercept(
  metrics: SupplyPostInterceptMetrics,
): InterceptResult {
  if (metrics.is_phone_historically_reused === true && metrics.last_post_time_delta_months <= 12) {
    return {
      allowed: false,
      messageKey: "error.post_denied_blurred",
      logFraud: true,
      trackerScene: "phone_recycling_fraud_1year",
    };
  }
  const allowed_posts_limit = metrics.is_premium_member ? 99999 : 3;
  if (metrics.active_supply_posts_count >= allowed_posts_limit) {
    return { allowed: false, messageKey: "error.non_member_limit_exceeded", logFraud: false };
  }
  return { allowed: true, messageKey: "success.posted", logFraud: false };
}
