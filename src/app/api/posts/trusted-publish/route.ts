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
  generateCanonicalPayloadHashV1,
  type RawPostInput,
} from "@/lib/auth/canonicalPayloadHash";

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
  rawPostInput?: RawPostInput;
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
    const waypointsArray = Array.isArray(rawPostInput.waypoints)
      ? (rawPostInput.waypoints as Record<string, unknown>[])
      : [];

    const { data: serverKmsData, error: kmsErr } = await supabase.rpc(
      "calculate_server_route_kms_via_waypoints",
      {
        p_origin: rawPostInput.origin_address,
        p_waypoints: waypointsArray.map((w) => w.address),
        p_destination: rawPostInput.destination_address,
      },
    );

    if (kmsErr) {
      return NextResponse.json(
        { success: false, errorKey: "error.server_price_calculation_failed" },
        { status: 500 },
      );
    }

    const serverKms = typeof serverKmsData === "number" ? serverKmsData : 0;
    const { hash, serverFeeMinor } = generateCanonicalPayloadHashV1(
      rawPostInput,
      serverKms,
    );

    const { data: txData, error: txErr } = await supabase.rpc(
      "publish_active_post_idempotent_v86",
      {
        p_user_id: user.id,
        p_client_request_id: clientRequestId,
        p_payload_hash: hash,
        p_post_payload: rawPostInput,
        p_server_fee_minor: serverFeeMinor,
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
    const msg = error instanceof Error ? error.message : "error.server_internal_crash";
    const errorKey = msg.startsWith("error.") ? msg : "error.server_internal_crash";
    return NextResponse.json({ success: false, errorKey }, { status: 400 });
  }
}
