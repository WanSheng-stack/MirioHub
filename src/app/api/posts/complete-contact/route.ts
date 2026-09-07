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
 * Returns: { ok: true, postId, isActive, normalizedPhone? }
 *   isActive = true  → post is active, caller should route to /posts/:id
 *   isActive = false → draft saved, contact info written, identity not yet verified
 *   normalizedPhone  → Account current phone after a successful phone save
 *
 * Consistency: fraud → phone_history → post update → profiles.phone.
 * Not a single DB transaction. If profile persist fails after post update,
 * this API returns ok:false (not a fake full success). Retry is safe.
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getAccountActivationEligibility } from '@/lib/auth/accountActivationEligibility';
import { evaluateStage1ActivePublicationRisk } from '@/lib/auth/stage1ActiveRisk';
import {
  normalizeLicensePlate,
} from '@/lib/post-validation';
import { parseUserPhone, resolvePhoneCountry } from '@/lib/phone/phoneNumber';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  clientJsonForPhoneWriteFailure,
  formatSafePhoneWriteLog,
  runPhoneWriterSafely,
  type AccountPhoneWriteResult,
} from '@/lib/profile/accountPhoneWrite';
import { writeAccountPhone } from '@/lib/profile/writeAccountPhone';
import {
  upsertPhoneHistory,
  upsertPlateHistory,
} from '@/lib/post-form/submitPost';
import { evaluatePublishIntercept } from '@/lib/security/evaluateFraudIntercept';
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

/**
 * Persist Account current/default phone via service-role writer.
 * Never accepts a browser-supplied user_id. Does not rewrite other profile fields.
 */
async function persistAccountCurrentPhone(
  userId: string,
  normalizedPhone: string,
): Promise<AccountPhoneWriteResult> {
  return runPhoneWriterSafely(
    () => writeAccountPhone(createAdminClient(), userId, normalizedPhone),
    () => {
      console.error('[complete-contact] phone writer threw');
    },
  );
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
  /** ISO 3166-1 alpha-2. Canonical validation uses this, not dial_code. */
  phone_country?: string;
  /** Optional compat — ignored when phone_country is present; only used if unique. */
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
    phone_country,
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
    const country = resolvePhoneCountry({
      phoneCountry: phone_country,
      dialCode: dial_code,
    });
    const phoneResult = country
      ? parseUserPhone({ countryCode: country, nationalInput: raw_phone_local! })
      : { valid: false as const, errorKey: "error.invalid_phone" as const };
    if (!phoneResult.valid) {
      return NextResponse.json(
        { ok: false, errorKey: phoneResult.errorKey },
        { status: 400 },
      );
    }
    normalizedPhoneForPost = phoneResult.normalizedDigits;
    rawPhoneForPost = phoneResult.nationalDisplay;

    // ── Fraud interception (runs before persisting anything) ─────────────────
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('is_premium')
      .eq('id', user.id)
      .maybeSingle();
    const intercept = await evaluatePublishIntercept({
      userId: user.id,
      postType: post.post_type === 'demand' ? 'demand' : 'provider',
      normalizedPhone: phoneResult.normalizedDigits,
      normalizedPlate: null,
      departureDate: post.departure_date ?? '',
      departureWindow: post.departure_time_window ?? '',
      isPremium: Boolean(
        (profileRow as { is_premium?: boolean } | null)?.is_premium,
      ),
    });
    if (!intercept.allowed) {
      return NextResponse.json(
        { ok: false, errorKey: intercept.errorKey },
        { status: 400 },
      );
    }

    // Persist phone history after fraud check passes
    phoneId = await upsertPhoneHistory(supabase, user.id, phoneResult.normalizedDigits);
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
    const { eligible } = await getAccountActivationEligibility(supabase, user);
    if (eligible) {
      const risk = await evaluateStage1ActivePublicationRisk(supabase, user.id, post);
      if (!risk.allowed) {
        const { error: contactOnlyErr } = await supabase
          .from('posts')
          .update(updatePayload)
          .eq('id', postId)
          .eq('user_id', user.id);
        if (contactOnlyErr) {
          return NextResponse.json(
            { ok: false, errorKey: 'error.submit_failed' },
            { status: 500 },
          );
        }
        if (hasPhone && normalizedPhoneForPost) {
          const profileWrite = await persistAccountCurrentPhone(
            user.id,
            normalizedPhoneForPost,
          );
          if (!profileWrite.ok) {
            console.error(
              '[complete-contact] set_profile_phone_v87 failed',
              formatSafePhoneWriteLog(profileWrite),
            );
            return NextResponse.json(clientJsonForPhoneWriteFailure(), { status: 500 });
          }
        }
        return NextResponse.json(
          { ok: false, errorKey: risk.errorKey },
          { status: 400 },
        );
      }
      updatePayload.status = 'active';
      isActive = true;
    }
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

  if (hasPhone && normalizedPhoneForPost) {
    const profileWrite = await persistAccountCurrentPhone(
      user.id,
      normalizedPhoneForPost,
    );
    if (!profileWrite.ok) {
      console.error(
        '[complete-contact] set_profile_phone_v87 failed',
        formatSafePhoneWriteLog(profileWrite),
      );
      return NextResponse.json(clientJsonForPhoneWriteFailure(), { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      postId,
      isActive,
      normalizedPhone: normalizedPhoneForPost,
    });
  }

  return NextResponse.json({ ok: true, postId, isActive });
}
