export interface DemandPostInterceptMetrics {
  has_foreign_phone_in_window: boolean;
  own_in_window_count: number;
}

export interface ProviderMatchInterceptMetrics {
  has_foreign_phone_in_window: boolean;
  has_foreign_plate_in_window: boolean;
  own_cargo_in_window: number;
  current_all_matched_units: number;
  current_all_passengers_count: number;
  is_bank_verified: boolean;
}

export interface SupplyPostInterceptMetrics {
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
  if (metrics.has_foreign_phone_in_window === true) {
    return {
      allowed: false,
      messageKey: "error.post_denied_blurred",
      logFraud: true,
      trackerScene: "multi_account_demand_spam",
    };
  }
  if (metrics.own_in_window_count > 0) {
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
  if (
    metrics.has_foreign_phone_in_window === true ||
    metrics.has_foreign_plate_in_window === true
  ) {
    return {
      allowed: false,
      messageKey: "error.match_denied_blurred",
      logFraud: true,
      trackerScene: "multi_account_spacetime_collision",
      isSpaceWarning: false,
    };
  }
  const waterlevel_ceiling = metrics.is_bank_verified ? 3 : 1;
  if (metrics.own_cargo_in_window >= waterlevel_ceiling) {
    const errorKey = metrics.is_bank_verified
      ? "error.active_cargo_limit_reached"
      : "error.bank_verification_required";
    return {
      allowed: false,
      messageKey: errorKey,
      logFraud: false,
      isSpaceWarning: false,
    };
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
  return {
    allowed: true,
    messageKey: "success.matched",
    logFraud: false,
    isSpaceWarning,
  };
}

export function processSupplyPostIntercept(
  metrics: SupplyPostInterceptMetrics,
): InterceptResult {
  const allowed_posts_limit = metrics.is_premium_member ? 99999 : 3;
  if (metrics.active_supply_posts_count >= allowed_posts_limit) {
    return {
      allowed: false,
      messageKey: "error.non_member_limit_exceeded",
      logFraud: false,
    };
  }
  return { allowed: true, messageKey: "success.posted", logFraud: false };
}
