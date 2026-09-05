/**
 * POST /api/posts/trusted-publish
 *
 * Active publish for an Account that already has a verified identity.
 * Does NOT create a Passkey challenge, processing_token, or credential.
 *
 * Server re-checks getAccountActivationEligibility() before calling
 * publish_active_post_idempotent_v86. Client identity flags are ignored.
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getAccountActivationEligibility } from "@/lib/auth/accountActivationEligibility";
import {
  buildCanonicalStage1PublishContext,
  CanonicalStage1Error,
  toRpcStage1Payload,
} from "@/lib/auth/buildCanonicalStage1PublishContext";
import {
  evaluateStage1ActivePublicationRisk,
  findPublishIntentByClientRequestId,
  isIdempotentActiveRetry,
} from "@/lib/auth/stage1ActiveRisk";

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

interface RequestBody {
  clientRequestId?: unknown;
  rawPostInput?: Record<string, unknown>;
}

interface PublishResult {
  ok: boolean;
  error_msg?: string;
  post_id?: string;
  is_duplicate?: boolean;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user?.id) {
    return NextResponse.json(
      { success: false, errorKey: "error.authentication_required" },
      { status: 401 },
    );
  }

  const eligibility = await getAccountActivationEligibility(supabase, user);
  if (!eligibility.eligible) {
    return NextResponse.json(
      { success: false, errorKey: "error.identity_verification_required" },
      { status: 403 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { success: false, errorKey: "error.invalid_request_body" },
      { status: 400 },
    );
  }

  const clientRequestId =
    typeof body.clientRequestId === "string" ? body.clientRequestId.trim() : "";
  const rawPostInput = body.rawPostInput;
  if (!clientRequestId || !rawPostInput) {
    return NextResponse.json(
      { success: false, errorKey: "error.invalid_request_body" },
      { status: 400 },
    );
  }

  try {
    const ctx = await buildCanonicalStage1PublishContext(rawPostInput);
    const existing = await findPublishIntentByClientRequestId(
      supabase,
      clientRequestId,
    );
    if (!isIdempotentActiveRetry(existing, user.id, ctx.payloadHash)) {
      const risk = await evaluateStage1ActivePublicationRisk(
        supabase,
        user.id,
        ctx.canonicalPayload,
      );
      if (!risk.allowed) {
        return NextResponse.json(
          { success: false, errorKey: risk.errorKey },
          { status: 400 },
        );
      }
    }

    const { data: txData, error: txErr } = await supabase.rpc(
      "publish_active_post_idempotent_v86",
      {
        p_user_id: user.id,
        p_client_request_id: clientRequestId,
        p_payload_hash: ctx.payloadHash,
        p_post_payload: toRpcStage1Payload(ctx.canonicalPayload, ctx.serverFeeMinor),
        p_server_fee_minor: ctx.serverFeeMinor,
      },
    );

    if (txErr) {
      console.error("[trusted-publish] RPC error:", {
        message: txErr.message,
        code: txErr.code,
      });
      return NextResponse.json(
        { success: false, errorKey: "error.submit_failed" },
        { status: 500 },
      );
    }

    const tx = txData as PublishResult | null;
    if (!tx?.ok || !tx.post_id) {
      return NextResponse.json(
        { success: false, errorKey: tx?.error_msg ?? "error.submit_failed" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      postId: tx.post_id,
      isDuplicate: Boolean(tx.is_duplicate),
    });
  } catch (error: unknown) {
    if (error instanceof CanonicalStage1Error) {
      return NextResponse.json(
        { success: false, errorKey: error.errorKey },
        { status: 400 },
      );
    }
    const msg = error instanceof Error ? error.message : "error.server_internal_crash";
    const errorKey = msg.startsWith("error.") ? msg : "error.server_internal_crash";
    return NextResponse.json({ success: false, errorKey }, { status: 400 });
  }
}
