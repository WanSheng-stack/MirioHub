import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateRouteMatchScore } from "@/lib/route/calculateRouteMatchScore";
import type { RouteScorePost } from "@/lib/route/calculateRouteMatchScore";
import {
  evaluateRouteMatchAccess,
  toRouteMatchApiPayload,
} from "@/lib/route/routeMatchAccess";
import { evaluateMatchAdmission } from "@/lib/matching/matchAdmissionPolicy";
import { loadMatchAdmissionThresholds } from "@/lib/matching/matchAdmissionServer";

type Body = {
  demandPostId?: string;
  providerPostId?: string;
};

/**
 * evaluateRouteMatchAccess is session ownership / public-active access only.
 * It is NOT pair admission. After access succeeds, this route uses the same
 * evaluateMatchAdmission contract as the hall and contact invitation.
 * Denied responses keep error.route_not_compatible and never leak invitation
 * reasons (date, time, detour, OSRM).
 */
const SCORE_SELECT = [
  "id",
  "user_id",
  "post_type",
  "status",
  "category",
  "departure_date",
  "departure_time_window",
  "service_time_window",
  "transport_mode",
  "escort_seats",
  "max_companions",
  "count_small",
  "count_medium",
  "count_large",
  "count_xlarge",
  "origin_address",
  "destination_address",
  "waypoints",
  "origin_gps",
  "destination_gps",
].join(", ");

const DENIED = { ok: false as const, errorKey: "error.route_not_compatible" };

type AdmissionRow = {
  id: string;
  user_id: string;
  post_type: string;
  status: string;
  category: string;
  departure_date?: string | null;
  departure_time_window?: string | null;
  service_time_window?: string | null;
  transport_mode?: string | null;
  escort_seats?: number | null;
  max_companions?: number | null;
  count_small?: number | null;
  count_medium?: number | null;
  count_large?: number | null;
  count_xlarge?: number | null;
  origin_address?: string | null;
  destination_address?: string | null;
  waypoints?: string[] | null;
  origin_gps?: unknown;
  destination_gps?: unknown;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, errorKey: "error.submit_failed" },
      { status: 401 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(DENIED);
  }
  if (!body.demandPostId || !body.providerPostId) {
    return NextResponse.json(DENIED);
  }

  const admin = createAdminClient();
  const [{ data: demand }, { data: provider }] = await Promise.all([
    admin.from("posts").select(SCORE_SELECT).eq("id", body.demandPostId).maybeSingle(),
    admin.from("posts").select(SCORE_SELECT).eq("id", body.providerPostId).maybeSingle(),
  ]);

  if (
    !evaluateRouteMatchAccess({
      userId: user.id,
      demand: demand as { user_id: string; post_type: string; status: string } | null,
      provider: provider as { user_id: string; post_type: string; status: string } | null,
    })
  ) {
    return NextResponse.json(DENIED);
  }

  const demandRow = demand as unknown as AdmissionRow;
  const providerRow = provider as unknown as AdmissionRow;
  const result = await calculateRouteMatchScore({
    demand: demandRow as RouteScorePost,
    provider: providerRow as RouteScorePost,
  });
  const thresholds = await loadMatchAdmissionThresholds(admin);
  const admission = evaluateMatchAdmission({
    left: demandRow,
    right: providerRow,
    route: result.ok
      ? {
          ok: true,
          score: result.score,
          extraDetourKms: result.extraDetourKms,
          baselineKms: result.baselineKms,
        }
      : { ok: false },
    thresholds,
  });
  if (!admission.eligible || !result.ok) {
    return NextResponse.json(DENIED);
  }
  return NextResponse.json(toRouteMatchApiPayload(result));
}
