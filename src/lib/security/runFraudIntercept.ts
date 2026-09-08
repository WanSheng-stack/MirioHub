import type { SupabaseClient } from "@supabase/supabase-js";
import {
  processDemandPostIntercept,
  processProviderMatchIntercept,
  processSupplyPostIntercept,
} from "@/lib/post-intercept";
import { totalLuggageUnits } from "@/lib/post-payload";
import type { WindowInterceptMetrics } from "@/lib/security/fraudLookupRpc";
import {
  retainFraudDecision,
  type FraudLogRow,
} from "@/lib/security/writeFraudAudit";
import type { Post } from "@/lib/types";

export type FraudDecision = {
  allowed: boolean;
  errorKey: string;
  isSpaceWarning?: boolean;
};

export type MatchDemandRow = Pick<
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

export type PublishInterceptInput = {
  userId: string;
  postType: "demand" | "provider";
  normalizedPhone: string;
  normalizedPlate: string | null;
  departureDate: string;
  departureWindow: string;
  isPremium: boolean;
};

export type ProviderMatchInterceptInput = {
  userId: string;
  demandPostId: string;
  providerNormalizedPhone: string;
  providerNormalizedLicensePlate: string | null;
  isBankVerified: boolean;
};

export function isPureCargoDemand(demand: {
  category: string;
  escort_seats?: number | null;
}): boolean {
  return demand.category === "deliver" && (demand.escort_seats ?? 0) === 0;
}

export type PublishInterceptDeps = {
  gatherWindow: (
    admin: SupabaseClient,
    userId: string,
    normalizedPhone: string,
    normalizedPlate: string | null,
    departureDate: string,
    departureWindow: string,
  ) => Promise<WindowInterceptMetrics | null>;
  countActiveSupplyPosts: (
    admin: SupabaseClient,
    userId: string,
  ) => Promise<number>;
  writeAudit: (
    admin: SupabaseClient,
    row: FraudLogRow,
  ) => Promise<boolean>;
};

export type ProviderMatchInterceptDeps = {
  loadDemandPost: (
    admin: SupabaseClient,
    demandPostId: string,
  ) => Promise<MatchDemandRow | null>;
  gatherWindow: PublishInterceptDeps["gatherWindow"];
  loadStackedMatchedPosts: (
    admin: SupabaseClient,
    userId: string,
    departureDate: string,
  ) => Promise<Pick<
    Post,
    | "category"
    | "escort_seats"
    | "max_companions"
    | "count_small"
    | "count_medium"
    | "count_large"
    | "count_xlarge"
  >[]>;
  writeAudit: PublishInterceptDeps["writeAudit"];
};

async function applyHardDenyAudit(
  admin: SupabaseClient,
  writeAudit: PublishInterceptDeps["writeAudit"],
  row: FraudLogRow,
  decision: FraudDecision,
): Promise<FraudDecision> {
  const auditOk = await writeAudit(admin, row);
  return retainFraudDecision(decision, auditOk);
}

export async function runPublishIntercept(
  admin: SupabaseClient,
  input: PublishInterceptInput,
  deps: PublishInterceptDeps,
): Promise<FraudDecision> {
  if (input.postType === "demand") {
    const window = await deps.gatherWindow(
      admin,
      input.userId,
      input.normalizedPhone,
      input.normalizedPlate,
      input.departureDate,
      input.departureWindow,
    );
    if (window == null) {
      return { allowed: false, errorKey: "error.submit_failed" };
    }
    const decision = processDemandPostIntercept({
      has_foreign_phone_in_window: window.has_other_phone,
      own_in_window_count: window.own_in_window_count,
    });
    if (!decision.allowed && decision.logFraud && decision.trackerScene) {
      return applyHardDenyAudit(
        admin,
        deps.writeAudit,
        {
          user_id: input.userId,
          scene: decision.trackerScene,
          normalized_phone: input.normalizedPhone,
          normalized_license_plate: input.normalizedPlate,
          reporter_side: "demand",
        },
        { allowed: decision.allowed, errorKey: decision.messageKey },
      );
    }
    return { allowed: decision.allowed, errorKey: decision.messageKey };
  }

  const activeCount = await deps.countActiveSupplyPosts(admin, input.userId);
  const decision = processSupplyPostIntercept({
    active_supply_posts_count: activeCount,
    is_premium_member: input.isPremium,
  });
  return { allowed: decision.allowed, errorKey: decision.messageKey };
}

export async function runProviderMatchIntercept(
  admin: SupabaseClient,
  input: ProviderMatchInterceptInput,
  deps: ProviderMatchInterceptDeps,
): Promise<FraudDecision> {
  const demandPost = await deps.loadDemandPost(admin, input.demandPostId);
  if (!demandPost) return { allowed: false, errorKey: "error.not_found" };

  if (!isPureCargoDemand(demandPost)) {
    return { allowed: true, errorKey: "success.matched" };
  }

  const window = await deps.gatherWindow(
    admin,
    input.userId,
    input.providerNormalizedPhone,
    input.providerNormalizedLicensePlate,
    (demandPost.departure_date as string) ?? "",
    (demandPost.departure_time_window as string) ?? "",
  );
  if (window == null) {
    return { allowed: false, errorKey: "error.submit_failed" };
  }

  const stackedRows = await deps.loadStackedMatchedPosts(
    admin,
    input.userId,
    demandPost.departure_date as string,
  );

  let currentStackedSeats = 0;
  let currentStackedUnits = 0;
  for (const row of stackedRows) {
    const p = row as Post;
    currentStackedSeats +=
      (p.category === "travel" ? p.max_companions ?? 0 : p.escort_seats ?? 0) ||
      0;
    currentStackedUnits += totalLuggageUnits({
      count_small: p.count_small ?? 0,
      count_medium: p.count_medium ?? 0,
      count_large: p.count_large ?? 0,
      count_xlarge: p.count_xlarge ?? 0,
    });
  }

  const newPassengers =
    demandPost.category === "travel"
      ? demandPost.max_companions ?? 1
      : demandPost.escort_seats ?? 0;
  const newUnits = totalLuggageUnits({
    count_small: demandPost.count_small ?? 0,
    count_medium: demandPost.count_medium ?? 0,
    count_large: demandPost.count_large ?? 0,
    count_xlarge: demandPost.count_xlarge ?? 0,
  });

  const decision = processProviderMatchIntercept({
    has_foreign_phone_in_window: window.has_other_phone,
    has_foreign_plate_in_window: window.has_other_plate,
    own_cargo_in_window: window.own_cargo_in_window,
    current_all_matched_units: currentStackedUnits + newUnits,
    current_all_passengers_count: currentStackedSeats + newPassengers,
    is_bank_verified: input.isBankVerified,
  });
  if (!decision.allowed && decision.logFraud && decision.trackerScene) {
    return applyHardDenyAudit(
      admin,
      deps.writeAudit,
      {
        user_id: input.userId,
        scene: decision.trackerScene,
        normalized_phone: input.providerNormalizedPhone,
        normalized_license_plate: input.providerNormalizedLicensePlate,
        reporter_side: "provider",
      },
      {
        allowed: decision.allowed,
        errorKey: decision.messageKey,
        isSpaceWarning: Boolean(decision.isSpaceWarning),
      },
    );
  }
  return {
    allowed: decision.allowed,
    errorKey: decision.messageKey,
    isSpaceWarning: Boolean(decision.isSpaceWarning),
  };
}

export async function countActiveSupplyPosts(
  admin: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count } = await admin
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("post_type", "provider")
    .eq("status", "active");
  return count ?? 0;
}

export async function loadDemandPostForMatch(
  admin: SupabaseClient,
  demandPostId: string,
): Promise<MatchDemandRow | null> {
  const { data } = await admin
    .from("posts")
    .select(
      "id, category, escort_seats, max_companions, count_small, count_medium, count_large, count_xlarge, departure_date, departure_time_window",
    )
    .eq("id", demandPostId)
    .maybeSingle();
  return (data as MatchDemandRow | null) ?? null;
}

export async function loadStackedMatchedPosts(
  admin: SupabaseClient,
  userId: string,
  departureDate: string,
): Promise<
  Pick<
    Post,
    | "category"
    | "escort_seats"
    | "max_companions"
    | "count_small"
    | "count_medium"
    | "count_large"
    | "count_xlarge"
  >[]
> {
  const { data } = await admin
    .from("posts")
    .select(
      "user_id, category, escort_seats, max_companions, count_small, count_medium, count_large, count_xlarge",
    )
    .eq("status", "matched")
    .eq("user_id", userId)
    .eq("departure_date", departureDate);
  return (data ?? []) as Pick<
    Post,
    | "category"
    | "escort_seats"
    | "max_companions"
    | "count_small"
    | "count_medium"
    | "count_large"
    | "count_xlarge"
  >[];
}
