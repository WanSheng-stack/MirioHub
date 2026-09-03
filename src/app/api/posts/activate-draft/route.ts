import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  normalizePhone,
  normalizeLicensePlate,
  buildRawPhone,
} from '@/lib/post-validation';
import {
  upsertPhoneHistory,
  upsertPlateHistory,
  gatherDemandMetrics,
  gatherSupplyMetrics,
} from '@/lib/post-form/submitPost';
import {
  processDemandPostIntercept,
  processSupplyPostIntercept,
} from '@/lib/post-intercept';
import { geocodeAddress, toGeographyPointWkt } from '@/lib/route-kms';
import { haversineKm } from '@/lib/geo';
import type { PostScope } from '@/lib/types';

// ---------------------------------------------------------------------------
// Supabase route-handler client (anon key, RLS applies to current session)
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
          // Route handler — ignore cookie write errors
        }
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExistingPost {
  id: string;
  user_id: string;
  status: string;
  post_type: string;
  departure_date: string | null;
  departure_time_window: string | null;
  origin_address: string;
  destination_address: string;
  origin_gps: string | null;
}

interface RequestBody {
  postId: string;
  dial_code: string;
  raw_phone_local: string;
  provider_name?: string;
  raw_license_plate?: string;
  vehicle_brand?: string;
  vehicle_color?: string;
  transport_mode?: string;
  locale?: string;
}

// ---------------------------------------------------------------------------
// POST /api/posts/activate-draft
//
// Writes Stage-2 contact fields into an existing post (created by Channel A
// verify RPC or Channel B shadow-draft RPC) and sets status → 'active'.
// Guards:
//  - Session required (RLS ensures user can only update their own post)
//  - Phone / plate normalization + history upsert
//  - Fraud interception (same rules as submitPost)
//  - Geocoding to fill GPS columns and compute scope
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return NextResponse.json(
      { ok: false, errorKey: 'error.authentication_required' },
      { status: 401 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, errorKey: 'error.invalid_request_body' },
      { status: 400 },
    );
  }

  const {
    postId,
    dial_code,
    raw_phone_local,
    provider_name,
    raw_license_plate,
    vehicle_brand,
    vehicle_color,
    transport_mode,
    locale,
  } = body;

  if (!postId) {
    return NextResponse.json(
      { ok: false, errorKey: 'error.invalid_post_id' },
      { status: 400 },
    );
  }

  // ── Fetch existing post — verify ownership via RLS ──────────────────────
  const { data: rawPost, error: postErr } = await supabase
    .from('posts')
    .select(
      'id, user_id, status, post_type, departure_date, departure_time_window, origin_address, destination_address, origin_gps',
    )
    .eq('id', postId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (postErr || !rawPost) {
    return NextResponse.json(
      { ok: false, errorKey: 'error.not_found' },
      { status: 404 },
    );
  }

  const post = rawPost as ExistingPost;

  if (!['draft', 'active'].includes(post.status)) {
    return NextResponse.json(
      { ok: false, errorKey: 'error.invalid_post_status' },
      { status: 400 },
    );
  }

  // ── Phone normalization ──────────────────────────────────────────────────
  const phoneResult = normalizePhone(dial_code ?? '', raw_phone_local ?? '');
  if (!phoneResult.ok) {
    return NextResponse.json(
      { ok: false, errorKey: phoneResult.errorKey },
      { status: 400 },
    );
  }

  // ── Plate normalization (provider only, vehicle types that require it) ───
  const plateRequiringModes = ['car', 'motorbike', 'van'];
  const needsPlate =
    post.post_type === 'provider' && plateRequiringModes.includes(transport_mode ?? '');

  let normalizedPlate: string | null = null;
  let rawPlate: string | null = null;

  if (post.post_type === 'provider' && raw_license_plate?.trim()) {
    const plateResult = normalizeLicensePlate(raw_license_plate);
    if (!plateResult.ok) {
      return NextResponse.json(
        { ok: false, errorKey: plateResult.errorKey },
        { status: 400 },
      );
    }
    normalizedPlate = plateResult.normalized;
    rawPlate = raw_license_plate.trim();
  }

  if (needsPlate && !normalizedPlate) {
    return NextResponse.json(
      { ok: false, errorKey: 'error.invalid_plate' },
      { status: 400 },
    );
  }

  // ── Phone / plate history upsert ─────────────────────────────────────────
  const phoneId = await upsertPhoneHistory(supabase, user.id, phoneResult.normalized);
  const plateId = normalizedPlate
    ? await upsertPlateHistory(supabase, user.id, normalizedPlate)
    : null;

  // ── Profile for premium check ─────────────────────────────────────────────
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('is_premium')
    .eq('id', user.id)
    .maybeSingle();
  const isPremium = Boolean((profileRow as { is_premium?: boolean } | null)?.is_premium);

  // ── Fraud interception ───────────────────────────────────────────────────
  if (post.post_type === 'demand') {
    // gatherDemandMetrics handles null departure_time_window gracefully:
    // rows without a window are excluded from the in-window filter.
    const metrics = await gatherDemandMetrics(
      supabase,
      user.id,
      phoneResult.normalized,
      normalizedPlate,
      post.departure_date ?? '',
      post.departure_time_window ?? '',
    );
    const decision = processDemandPostIntercept(metrics);
    if (!decision.allowed) {
      if (decision.logFraud) {
        await supabase.from('fraud_logs').insert({
          user_id: user.id,
          scene: decision.trackerScene,
          normalized_phone: phoneResult.normalized,
          normalized_license_plate: normalizedPlate,
          reporter_side: 'demand',
        });
      }
      return NextResponse.json(
        { ok: false, errorKey: decision.messageKey },
        { status: 400 },
      );
    }
  } else {
    const metrics = await gatherSupplyMetrics(
      supabase,
      user.id,
      phoneResult.normalized,
      normalizedPlate,
      isPremium,
    );
    const decision = processSupplyPostIntercept(metrics);
    if (!decision.allowed) {
      if (decision.logFraud) {
        await supabase.from('fraud_logs').insert({
          user_id: user.id,
          scene: decision.trackerScene,
          normalized_phone: phoneResult.normalized,
          normalized_license_plate: normalizedPlate,
          reporter_side: 'provider',
        });
      }
      return NextResponse.json(
        { ok: false, errorKey: decision.messageKey },
        { status: 400 },
      );
    }
  }

  // ── Geocoding (fill GPS if the RPC didn't) ───────────────────────────────
  let origin_gps: string | null = post.origin_gps;
  let destination_gps: string | null = null;
  let scope: PostScope = 'city';

  try {
    const [originGeo, destGeo] = await Promise.all([
      post.origin_address ? geocodeAddress(post.origin_address) : Promise.resolve(null),
      post.destination_address
        ? geocodeAddress(post.destination_address)
        : Promise.resolve(null),
    ]);

    if (originGeo) {
      origin_gps = toGeographyPointWkt(originGeo.lat, originGeo.lon);
      const resolved = destGeo ?? originGeo;
      destination_gps = toGeographyPointWkt(resolved.lat, resolved.lon);
      const d = haversineKm(originGeo.lat, originGeo.lon, resolved.lat, resolved.lon);
      if (d <= 5) scope = 'near';
      else if (d <= 20) scope = 'city';
      else if (d <= 200) scope = 'intercity';
      else scope = 'cross_border';
    }
  } catch {
    // Geocoding is best-effort; don't block activation
  }

  // ── UPDATE the post with Stage-2 fields ──────────────────────────────────
  const updatePayload: Record<string, unknown> = {
    raw_phone: buildRawPhone(dial_code ?? '', raw_phone_local ?? ''),
    normalized_phone: phoneResult.normalized,
    phone_id: phoneId,
    raw_license_plate: rawPlate,
    normalized_license_plate: normalizedPlate,
    plate_id: plateId,
    provider_name: provider_name?.trim() || null,
    vehicle_brand: vehicle_brand?.trim() || null,
    vehicle_color: vehicle_color?.trim() || null,
    transport_mode: transport_mode || null,
    origin_gps,
    destination_gps,
    scope,
    locale: locale ?? 'en',
    updated_at: new Date().toISOString(),
  };

  // Only flip status for drafts — active posts (Channel A) stay active.
  if (post.status === 'draft') {
    updatePayload.status = 'active';
  }

  const { error: updateErr } = await supabase
    .from('posts')
    .update(updatePayload)
    .eq('id', postId)
    .eq('user_id', user.id);

  if (updateErr) {
    console.error('[activate-draft] update error:', {
      message: updateErr.message,
      code: updateErr.code,
    });
    return NextResponse.json(
      { ok: false, errorKey: 'error.submit_failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, postId });
}
