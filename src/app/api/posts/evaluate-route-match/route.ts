import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateRouteMatchScore } from "@/lib/route/calculateRouteMatchScore";
import type { RouteScorePost } from "@/lib/route/calculateRouteMatchScore";
import {
  evaluateRouteMatchAccess,
  toRouteMatchApiPayload,
} from "@/lib/route/routeMatchAccess";

type Body = {
  demandPostId?: string;
  providerPostId?: string;
};

const SCORE_SELECT =
  "id, user_id, post_type, status, origin_address, destination_address, waypoints, origin_gps, destination_gps";

const DENIED = { ok: false as const, errorKey: "error.route_not_compatible" };

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

  const result = await calculateRouteMatchScore({
    demand: demand as RouteScorePost,
    provider: provider as RouteScorePost,
  });
  if (!result.ok) {
    return NextResponse.json(DENIED);
  }
  return NextResponse.json(toRouteMatchApiPayload(result));
}
