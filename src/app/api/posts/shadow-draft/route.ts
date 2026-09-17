/**
 * POST /api/posts/shadow-draft
 *
 * Shadow draft persistence via create_shadow_draft_idempotent_v101 (service_role).
 * Trusted authority is always built before write — never creates a four-NULL
 * authority row. Session auth derives user id.
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  buildCanonicalStage1PublishContext,
  CanonicalStage1Error,
  toRpcStage1Payload,
} from "@/lib/auth/buildCanonicalStage1PublishContext";
import { buildAuthorityForPublishFromOriginHit } from "@/lib/safety/buildAuthorityForPublishFromOriginHit";
import { parseV101PublishRpcResult } from "@/lib/safety/parseV101PublishRpcResult";
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
          // Route handler — ignore
        }
      },
    },
  });
}

interface RequestBody {
  clientRequestId: string;
  rawPostInput: Record<string, unknown>;
  fallbackReason?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return NextResponse.json(
      { success: false, errorKey: "error.authentication_required" },
      { status: 401 },
    );
  }

  const current_uid = user.id;

  try {
    const body = (await request.json()) as RequestBody;
    const { clientRequestId, rawPostInput, fallbackReason } = body;

    if (!clientRequestId) {
      return NextResponse.json(
        { success: false, errorKey: "error.invalid_client_request_id" },
        { status: 400 },
      );
    }

    const ctx = await buildCanonicalStage1PublishContext(rawPostInput);
    const authority = await buildAuthorityForPublishFromOriginHit(
      ctx.canonicalPayload,
      ctx.originNominatimHit,
    );
    if (!authority.ok) {
      return NextResponse.json(
        { success: false, errorKey: authority.errorKey },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { data: txData, error: txErr } = await admin.rpc(
      "create_shadow_draft_idempotent_v101",
      {
        p_user_id: current_uid,
        p_client_request_id: clientRequestId,
        p_canonical_payload_hash: ctx.payloadHash,
        p_fallback_reason: fallbackReason ?? "USER_ABORT",
        p_post_payload: toRpcStage1Payload(
          ctx.canonicalPayload,
          ctx.serverFeeMinor,
        ),
        p_server_fee_minor: ctx.serverFeeMinor,
        p_origin_gps: authority.fields.origin_gps,
        p_origin_country_code: authority.fields.origin_country_code,
        p_origin_timezone: authority.fields.origin_timezone,
        p_night_policy_version: authority.fields.night_policy_version,
      },
    );

    if (txErr) {
      console.error("[shadow-draft] RPC error:", {
        code: txErr.code,
        category: "v101_rpc_failed",
      });
      return NextResponse.json(
        { success: false, errorKey: "error.shadow_draft_transaction_failed" },
        { status: 500 },
      );
    }

    const parsed = parseV101PublishRpcResult(
      txData,
      "error.shadow_draft_transaction_failed",
    );
    if (!parsed.ok) {
      return NextResponse.json(
        { success: false, errorKey: parsed.errorKey },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      postId: parsed.postId,
      shadowUserId: current_uid,
    });
  } catch (error: unknown) {
    if (error instanceof CanonicalStage1Error) {
      return NextResponse.json(
        { success: false, errorKey: error.errorKey },
        { status: 400 },
      );
    }
    const msg =
      error instanceof Error ? error.message : "error.server_internal_crash";
    console.error("[shadow-draft] unexpected error:", {
      category: "internal_exception",
    });
    const errorKey = msg.startsWith("error.") ? msg : "error.server_internal_crash";
    return NextResponse.json({ success: false, errorKey }, { status: 500 });
  }
}
