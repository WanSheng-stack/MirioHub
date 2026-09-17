/**
 * POST /api/posts/activate-after-identity
 *
 * Activates ONE owned draft via activate_post_after_identity_v102 (service_role).
 * Authority-complete + eligibility enforced in SQL. No direct posts.update.
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getAccountActivationEligibility } from "@/lib/auth/accountActivationEligibility";
import { evaluateStage1ActivePublicationRisk } from "@/lib/auth/stage1ActiveRisk";
import { parseV102PostsWriteRpcResult } from "@/lib/posts/parseV102PostsWriteRpcResult";
import { createAdminClient } from "@/lib/supabase/admin";

async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Route handler — ignore cookie-write errors
        }
      },
    },
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user?.id) {
    return NextResponse.json(
      { ok: false, errorKey: "error.authentication_required" },
      { status: 401 },
    );
  }

  let postId: string | null = null;
  try {
    const body = (await request.json()) as { postId?: unknown };
    if (typeof body.postId === "string" && body.postId.trim()) {
      postId = body.postId.trim();
    }
  } catch {
    // malformed → 400 below
  }

  if (!postId) {
    return NextResponse.json(
      { ok: false, errorKey: "error.target_post_required" },
      { status: 400 },
    );
  }

  const { data: post, error: fetchErr } = await supabase
    .from("posts")
    .select("id, user_id, status, post_type, departure_date, departure_time_window")
    .eq("id", postId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchErr) {
    console.error("[activate-after-identity] fetch error:", {
      code: fetchErr.code,
      category: "fetch_failed",
    });
    return NextResponse.json(
      { ok: false, errorKey: "error.submit_failed" },
      { status: 500 },
    );
  }

  if (!post) {
    return NextResponse.json(
      { ok: false, errorKey: "error.not_found" },
      { status: 404 },
    );
  }

  const typedPost = post as {
    id: string;
    user_id: string;
    status: string;
    post_type: string;
    departure_date: string | null;
    departure_time_window: string | null;
  };

  if (typedPost.status === "active") {
    return NextResponse.json({
      ok: true,
      postId,
      isActive: true,
      alreadyActive: true,
    });
  }

  if (typedPost.status !== "draft") {
    return NextResponse.json(
      { ok: false, errorKey: "error.invalid_post_status" },
      { status: 400 },
    );
  }

  const { eligible } = await getAccountActivationEligibility(supabase, user);
  if (!eligible) {
    return NextResponse.json(
      { ok: false, errorKey: "error.identity_verification_required" },
      { status: 403 },
    );
  }

  const risk = await evaluateStage1ActivePublicationRisk(
    supabase,
    user.id,
    typedPost,
  );
  if (!risk.allowed) {
    return NextResponse.json(
      { ok: false, errorKey: risk.errorKey },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: txData, error: txErr } = await admin.rpc(
    "activate_post_after_identity_v102",
    {
      p_user_id: user.id,
      p_post_id: postId,
    },
  );

  if (txErr) {
    console.error("[activate-after-identity] v102 RPC error:", {
      code: txErr.code,
      category: "v102_rpc_failed",
    });
    return NextResponse.json(
      { ok: false, errorKey: "error.submit_failed" },
      { status: 500 },
    );
  }

  const parsed = parseV102PostsWriteRpcResult(txData, "error.submit_failed");
  if (!parsed.ok) {
    const status =
      parsed.errorKey === "error.not_found"
        ? 404
        : parsed.errorKey === "error.identity_verification_required"
          ? 403
          : 400;
    return NextResponse.json(
      { ok: false, errorKey: parsed.errorKey },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    postId: parsed.postId,
    isActive: true,
    alreadyActive: parsed.alreadyActive,
  });
}
