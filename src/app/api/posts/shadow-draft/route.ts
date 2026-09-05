import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  buildCanonicalStage1PublishContext,
  CanonicalStage1Error,
  toRpcStage1Payload,
} from "@/lib/auth/buildCanonicalStage1PublishContext";

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

interface ShadowDraftResult {
  ok: boolean;
  error_msg?: string;
  post_id?: string;
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

    const { data: txData, error: txErr } = await supabase.rpc(
      "create_shadow_draft_idempotent_v86",
      {
        p_user_id: current_uid,
        p_client_request_id: clientRequestId,
        p_payload_hash: ctx.payloadHash,
        p_fallback_reason: fallbackReason ?? "USER_ABORT",
        p_post_payload: toRpcStage1Payload(ctx.canonicalPayload, ctx.serverFeeMinor),
        p_server_fee_minor: ctx.serverFeeMinor,
      },
    );

    if (txErr) {
      console.error("[shadow-draft] RPC error:", {
        message: txErr.message,
        code: txErr.code,
        details: txErr.details,
        hint: txErr.hint,
      });
      return NextResponse.json(
        { success: false, errorKey: "error.shadow_draft_transaction_failed" },
        { status: 500 },
      );
    }

    const tx = txData as ShadowDraftResult | null;

    if (!tx?.ok) {
      return NextResponse.json(
        { success: false, errorKey: tx?.error_msg ?? "error.shadow_draft_transaction_failed" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      postId: tx.post_id,
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
    console.error("[shadow-draft] unexpected error:", msg);
    return NextResponse.json({ success: false, errorKey: msg }, { status: 500 });
  }
}
