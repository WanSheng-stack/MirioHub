import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateRouteMatchScore } from "@/lib/route/calculateRouteMatchScore";
import type { RouteScorePost } from "@/lib/route/calculateRouteMatchScore";

type Body = {
  demandPostId?: string;
  providerPostId?: string;
};

const SCORE_SELECT =
  "id, post_type, origin_address, destination_address, waypoints, origin_gps, destination_gps";

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
    return NextResponse.json({ ok: false, errorKey: "error.route_not_compatible" });
  }
  if (!body.demandPostId || !body.providerPostId) {
    return NextResponse.json({ ok: false, errorKey: "error.route_not_compatible" });
  }

  const admin = createAdminClient();
  const [{ data: demand }, { data: provider }] = await Promise.all([
    admin.from("posts").select(SCORE_SELECT).eq("id", body.demandPostId).maybeSingle(),
    admin.from("posts").select(SCORE_SELECT).eq("id", body.providerPostId).maybeSingle(),
  ]);
  if (!demand || !provider) {
    return NextResponse.json({ ok: false, errorKey: "error.route_not_compatible" });
  }

  const result = await calculateRouteMatchScore({
    source: demand as RouteScorePost,
    candidate: provider as RouteScorePost,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, errorKey: "error.route_not_compatible" });
  }
  return NextResponse.json({ ok: true, score: result.score });
}
