/**
 * POST /api/posts/complete-contact
 *
 * Saves Stage-2 contact fields (phone, plate, provider info, GPS scope) onto
 * an existing post that was created by:
 *   - Channel A: commit_phase3_business_idempotent_v86  (status='active')
 *   - Channel B: create_shadow_draft_idempotent_v86     (status='draft')
 *
 * ACTIVATION POLICY (draft → active):
 *   A draft post is activated only when the current Account has at least one
 *   confirmed identity:
 *     1. profiles.has_passkey = true   (Passkey verified)
 *     2. auth.identities contains 'google'  (Google OAuth linked to this UUID)
 *     3. user.email_confirmed_at is set    (Email OTP / password sign-up confirmed)
 *
 *   Unverified phone number alone does NOT activate a draft.
 *
 * BLOCKED — Google/Email cross-UUID account continuity:
 *   If the user logs in with Google/Email and Supabase creates a NEW auth UUID
 *   (instead of linking to the existing anonymous UUID), the draft post belongs
 *   to the old UUID and is unreachable by the new UUID. That scenario requires
 *   a safe account-link/merge architecture decision before implementation.
 *   Current code handles it safely: the RLS check (user_id = auth.uid()) returns
 *   404 for cross-UUID access, preventing any silent data corruption.
 *
 * Returns: { ok: true, postId: string, isActive: boolean }
 *   isActive = true  → post is active, caller should route to /posts/:id
 *   isActive = false → draft saved, contact info written, identity not yet verified
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
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
// Supabase route-handler client (anon key — RLS enforces ownership)
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
// Identity activation policy
// ---------------------------------------------------------------------------

/**
 * Returns true when the current Account holds at least one recognised identity
 * that qualifies a draft post for publication.
 *
 * All checks are scoped to the current session UUID.  A different UUID (e.g.
 * a freshly-created Google user) will correctly return false for posts owned
 * by an anonymous UUID — preventing silent cross-account activation.
 */
async function checkCanActivatePost(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: User,
): Promise<boolean> {
  // 1. Passkey registered for this Account
  const { data: profile } = await supabase
    .from('profiles')
    .select('has_passkey')
    .eq('id', user.id)
    .maybeSingle();
  if ((profile as { has_passkey?: boolean } | null)?.has_passkey) return true;

  // 2. Google OAuth identity linked to THIS exact UUID
  //    (works only when Supabase preserves the anonymous UUID on OAuth link,
  //    which requires auto-merge or explicit linkIdentity() — BLOCKED if not).
  if (user.identities?.some((i) => i.provider === 'google')) return true;

  // 3. Email confirmed for THIS UUID (email/password sign-up confirmed)
  if (user.email_confirmed_at) return true;

  return false;
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
  /** Optional — Stage-2 contact fields.  Empty = skip, keep existing. */
  dial_code?: string;
  raw_phone_local?: string;
  provider_name?: string;
  raw_license_plate?: string;
  vehicle_brand?: string;
  vehicle_color?: string;
  transport_mode?: string;
  locale?: string;
}

// ---------------------------------------------------------------------------
// POST handler
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

  // ── Fetch post & verify ownership (RLS: user_id = auth.uid()) ─────────────
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

  // ── Phone — optional: skip if caller didn't provide a local number ─────────
  const hasPhone = raw_phone_local?.trim();
  let phoneId: number | null = null;
  let rawPhoneForPost: string | null = null;
  let normalizedPhoneForPost: string | null = null;

  if (hasPhone) {
    const phoneResult = normalizePhone(dial_code ?? '', raw_phone_local!);
    if (!phoneResult.ok) {
      return NextResponse.json(
        { ok: false, errorKey: phoneResult.errorKey },
        { status: 400 },
      );
    }
    normalizedPhoneForPost = phoneResult.normalized;
    rawPhoneForPost = buildRawPhone(dial_code ?? '', raw_phone_local!);

    // ── Fraud interception (runs before persisting anything) ─────────────────
    if (post.post_type === 'demand') {
      const metrics = await gatherDemandMetrics(
        supabase,
        user.id,
        phoneResult.normalized,
        null, // plate checked separately below
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
            reporter_side: 'demand',
          });
        }
        return NextResponse.json(
          { ok: false, errorKey: decision.messageKey },
          { status: 400 },
        );
      }
    } else {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('is_premium')
        .eq('id', user.id)
        .maybeSingle();
      const isPremium = Boolean((profileRow as { is_premium?: boolean } | null)?.is_premium);
      const metrics = await gatherSupplyMetrics(
        supabase,
        user.id,
        phoneResult.normalized,
        null,
        isPremium,
      );
      const decision = processSupplyPostIntercept(metrics);
      if (!decision.allowed) {
        if (decision.logFraud) {
          await supabase.from('fraud_logs').insert({
            user_id: user.id,
            scene: decision.trackerScene,
            normalized_phone: phoneResult.normalized,
            reporter_side: 'provider',
          });
        }
        return NextResponse.json(
          { ok: false, errorKey: decision.messageKey },
          { status: 400 },
        );
      }
    }

    // Persist phone history after fraud check passes
    phoneId = await upsertPhoneHistory(supabase, user.id, phoneResult.normalized);
  }

  // ── Plate — optional: only provider posts, only if provided ───────────────
  const plateRequiringModes = ['car', 'motorbike', 'van'];
  const needsPlate =
    post.post_type === 'provider' && plateRequiringModes.includes(transport_mode ?? '');
  let normalizedPlate: string | null = null;
  let rawPlate: string | null = null;
  let plateId: number | null = null;

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
    plateId = await upsertPlateHistory(supabase, user.id, normalizedPlate);
  }

  if (needsPlate && !normalizedPlate) {
    return NextResponse.json(
      { ok: false, errorKey: 'error.invalid_plate' },
      { status: 400 },
    );
  }

  // ── Geocoding (best-effort; don't block contact save on failure) ───────────
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
    // Geocoding is best-effort
  }

  // ── Build update payload ───────────────────────────────────────────────────
  const updatePayload: Record<string, unknown> = {
    origin_gps,
    destination_gps,
    scope,
    locale: locale ?? 'en',
    updated_at: new Date().toISOString(),
  };

  // Write contact fields only when provided (don't overwrite with nulls)
  if (hasPhone) {
    updatePayload.raw_phone = rawPhoneForPost;
    updatePayload.normalized_phone = normalizedPhoneForPost;
    updatePayload.phone_id = phoneId;
  }
  if (normalizedPlate !== null) {
    updatePayload.raw_license_plate = rawPlate;
    updatePayload.normalized_license_plate = normalizedPlate;
    updatePayload.plate_id = plateId;
  }
  if (provider_name !== undefined) updatePayload.provider_name = provider_name.trim() || null;
  if (vehicle_brand !== undefined) updatePayload.vehicle_brand = vehicle_brand.trim() || null;
  if (vehicle_color !== undefined) updatePayload.vehicle_color = vehicle_color.trim() || null;
  if (transport_mode !== undefined) updatePayload.transport_mode = transport_mode || null;

  // ── Activation policy ─────────────────────────────────────────────────────
  // Channel A posts are already active — contact save only, status unchanged.
  // Channel B drafts are activated only when the Account has a verified identity.
  // Unverified phone alone is NOT sufficient (rule 5 / rule 21 / rule 51).
  let isActive = post.status === 'active';

  if (post.status === 'draft') {
    const canActivate = await checkCanActivatePost(supabase, user);
    if (canActivate) {
      updatePayload.status = 'active';
      isActive = true;
    }
    // No identity → keep status='draft', contact info saved for future use
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  const { error: updateErr } = await supabase
    .from('posts')
    .update(updatePayload)
    .eq('id', postId)
    .eq('user_id', user.id);

  if (updateErr) {
    console.error('[complete-contact] update error:', {
      message: updateErr.message,
      code: updateErr.code,
    });
    return NextResponse.json(
      { ok: false, errorKey: 'error.submit_failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, postId, isActive });
}
