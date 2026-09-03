import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// ---------------------------------------------------------------------------
// Supabase route-handler client (anon key, RLS applies)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// POST /api/posts/shadow-draft
//
// Saves a post payload as a draft when the user cannot complete the full
// Passkey flow. The caller must already have a valid Supabase session —
// this route will NEVER create a new auth user or anonymous session.
// ---------------------------------------------------------------------------

interface WaypointItem {
  address?: unknown;
}

interface RawPostInput {
  origin_address?: unknown;
  destination_address?: unknown;
  waypoints?: unknown;
  bump_fee_minor?: unknown;
  [key: string]: unknown;
}

interface RequestBody {
  clientRequestId: string;
  rawPostInput: RawPostInput;
  fallbackReason?: string;
}

interface ShadowDraftResult {
  ok: boolean;
  error_msg?: string;
  post_id?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();

  // Require an existing valid session — never create a new user here.
  // If no session exists, the caller should redirect to sign-in, not retry.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return NextResponse.json(
      { success: false, errorKey: 'error.authentication_required' },
      { status: 401 },
    );
  }

  const current_uid = user.id;

  try {
    const body = (await request.json()) as RequestBody;
    const { clientRequestId, rawPostInput, fallbackReason } = body;

    if (!clientRequestId) {
      return NextResponse.json(
        { success: false, errorKey: 'error.invalid_client_request_id' },
        { status: 400 },
      );
    }

    // Basic bump-fee guard
    const bumpFeeInput = Number(rawPostInput.bump_fee_minor ?? 0);
    if (!Number.isSafeInteger(bumpFeeInput) || bumpFeeInput < 0) {
      return NextResponse.json(
        { success: false, errorKey: 'error.invalid_bump_fee_boundary' },
        { status: 400 },
      );
    }

    // Server-side route distance (best-effort; fall back to 0 on error)
    const waypointsArray: WaypointItem[] = Array.isArray(rawPostInput.waypoints)
      ? (rawPostInput.waypoints as WaypointItem[])
      : [];

    let server_kms = 0;
    const { data: serverKmsData, error: kmsErr } = await supabase.rpc(
      'calculate_server_route_kms_via_waypoints',
      {
        p_origin: rawPostInput.origin_address,
        p_waypoints: waypointsArray.map((w) => w.address),
        p_destination: rawPostInput.destination_address,
      },
    );
    if (!kmsErr && typeof serverKmsData === 'number') {
      server_kms = serverKmsData;
    } else if (kmsErr) {
      console.warn('[shadow-draft] route kms calculation unavailable:', kmsErr.message);
    }

    // Idempotent shadow-draft commit via RPC.
    const { data: txData, error: txErr } = await supabase.rpc(
      'create_shadow_draft_idempotent_v86',
      {
        p_user_id: current_uid,
        p_client_request_id: clientRequestId,
        p_payload_hash: `SHADOW_FALLBACK_HASH_${clientRequestId}`,
        p_fallback_reason: fallbackReason ?? 'USER_ABORT',
        p_post_payload: rawPostInput,
        p_server_fee_minor: Math.round(server_kms * 0.05 * 100),
      },
    );

    if (txErr) {
      console.error('[shadow-draft] RPC error:', {
        message: txErr.message,
        code: txErr.code,
        details: txErr.details,
        hint: txErr.hint,
      });
      return NextResponse.json(
        { success: false, errorKey: 'error.shadow_draft_transaction_failed' },
        { status: 500 },
      );
    }

    const tx = txData as ShadowDraftResult | null;

    // Duplicate is still success — use the already-existing post_id.
    if (!tx?.ok) {
      return NextResponse.json(
        { success: false, errorKey: tx?.error_msg ?? 'error.shadow_draft_transaction_failed' },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      postId: tx.post_id,
      shadowUserId: current_uid,
    });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : 'error.server_internal_crash';
    console.error('[shadow-draft] unexpected error:', msg);
    return NextResponse.json({ success: false, errorKey: msg }, { status: 500 });
  }
}
