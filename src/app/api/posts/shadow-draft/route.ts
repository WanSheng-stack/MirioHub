import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// ---------------------------------------------------------------------------
// Supabase route-handler client (mirrors src/lib/supabase/server.ts)
// ---------------------------------------------------------------------------

function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  // In Next 15 route handlers cookies() is still synchronous
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cookieStore = cookies() as any;
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll?.() ?? [],
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set?.(name, value, options),
          );
        } catch {
          // Route handler – ignore
        }
      },
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/posts/shadow-draft
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
  const supabase = createClient();

  // Resolve or provision a user identity (supports anonymous sessions)
  const {
    data: { session },
  } = await supabase.auth.getSession();

  let current_uid = session?.user?.id;

  if (!current_uid) {
    const { data: anonData, error: anonErr } = await supabase.auth.signInAnonymously();
    if (anonErr || !anonData.user) {
      return NextResponse.json(
        { success: false, errorKey: 'error.anonymous_provision_failed' },
        { status: 500 },
      );
    }
    current_uid = anonData.user.id;
  }

  try {
    const body = (await request.json()) as RequestBody;
    const { clientRequestId, rawPostInput, fallbackReason } = body;

    // Server-side route distance
    const waypointsArray: WaypointItem[] = Array.isArray(rawPostInput.waypoints)
      ? (rawPostInput.waypoints as WaypointItem[])
      : [];

    const { data: serverKmsData, error: kmsErr } = await supabase.rpc(
      'calculate_server_route_kms_via_waypoints',
      {
        p_origin: rawPostInput.origin_address,
        p_waypoints: waypointsArray.map((w) => w.address),
        p_destination: rawPostInput.destination_address,
      },
    );

    if (kmsErr) throw new Error('Shadow route calculation failed');
    const server_kms = (serverKmsData as number) ?? 10;

    // Basic bump-fee guard
    const bumpFeeInput = Number(rawPostInput.bump_fee_minor ?? 0);
    if (!Number.isSafeInteger(bumpFeeInput) || bumpFeeInput < 0) {
      return NextResponse.json(
        { success: false, errorKey: 'error.invalid_bump_fee_boundary' },
        { status: 400 },
      );
    }

    // Idempotent shadow-draft commit
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

    const tx = txData as ShadowDraftResult | null;

    if (txErr || !tx?.ok) {
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
    return NextResponse.json({ success: false, errorKey: msg }, { status: 500 });
  }
}
