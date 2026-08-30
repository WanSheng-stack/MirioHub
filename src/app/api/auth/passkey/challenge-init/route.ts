import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

// ---------------------------------------------------------------------------
// SSR session client — reads the authenticated/anonymous session cookie only.
// Uses the anon key; subject to RLS. Do NOT write privileged tables with this.
// ---------------------------------------------------------------------------

async function createSessionClient() {
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
// Service-role admin client — bypasses RLS.
// Used ONLY server-side. Key is never exposed to the client.
// ---------------------------------------------------------------------------

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// UUID format guard
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DbPasskeyRow {
  credential_id: string;
  transports: AuthenticatorTransportFuture[] | null;
}

interface AuthChallengeRow {
  id: string;
  status: string;
}

// ---------------------------------------------------------------------------
// POST /api/auth/passkey/challenge-init
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // ── 1. Resolve session via SSR cookie client (anon key, RLS applies) ──────
  const sessionClient = await createSessionClient();
  const {
    data: { user },
    error: userErr,
  } = await sessionClient.auth.getUser();

  if (userErr || !user?.id) {
    return NextResponse.json(
      { success: false, errorKey: 'error.authentication_required' },
      { status: 401 },
    );
  }

  const userId = user.id; // trusted server-side auth.uid()

  // ── 2. Validate clientRequestId from body ─────────────────────────────────
  let clientRequestId: string;
  try {
    const body = (await request.json()) as { clientRequestId?: unknown };
    if (!isValidUUID(body.clientRequestId)) {
      return NextResponse.json(
        { success: false, errorKey: 'error.invalid_client_request_id' },
        { status: 400 },
      );
    }
    clientRequestId = body.clientRequestId;
  } catch {
    return NextResponse.json(
      { success: false, errorKey: 'error.invalid_request_body' },
      { status: 400 },
    );
  }

  // ── 3. Admin client — bypasses RLS for privileged reads/writes ────────────
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error('[challenge-init] Admin client init failed:', e);
    return NextResponse.json(
      { success: false, errorKey: 'error.server_internal_crash' },
      { status: 500 },
    );
  }

  try {
    // ── 4. Guard: don't overwrite a challenge that is already processing/consumed ──
    const { data: existing } = await admin
      .from('auth_challenges')
      .select('id, status')
      .eq('client_request_id', clientRequestId)
      .maybeSingle();

    if (existing) {
      const row = existing as AuthChallengeRow;
      if (row.status === 'processing' || row.status === 'consumed') {
        // Idempotency: return existing challenge id so client can retry verify
        return NextResponse.json(
          {
            success: false,
            errorKey: 'error.invalid_or_consumed_challenge',
          },
          { status: 409 },
        );
      }
    }

    // ── 5. Read registered passkeys (admin, no RLS block) ────────────────────
    const { data: dbKeys, error: keysErr } = await admin
      .from('passkeys')
      .select('credential_id, transports')
      .eq('user_id', userId);

    if (keysErr) {
      console.error('[challenge-init] passkeys read error:', {
        message: keysErr.message,
        code: keysErr.code,
        details: keysErr.details,
        hint: keysErr.hint,
      });
      return NextResponse.json(
        { success: false, errorKey: 'error.server_internal_crash' },
        { status: 500 },
      );
    }

    const passkeyRows = (dbKeys ?? []) as DbPasskeyRow[];
    const hasKeys = passkeyRows.length > 0;

    // ── 6. Generate WebAuthn options ──────────────────────────────────────────
    const expectedRPID = process.env.WEBAUTHN_RP_ID ?? 'localhost';
    const rpName = process.env.WEBAUTHN_RP_NAME ?? 'MirioHub Co-Car';

    let ceremonyType: 'registration' | 'authentication';
    let challengeText: string;
    let optionsPayload: Record<string, unknown>;

    if (!hasKeys) {
      ceremonyType = 'registration';
      const opts = await generateRegistrationOptions({
        rpName,
        rpID: expectedRPID,
        userName: user.email ?? `user_${userId.slice(0, 8)}`,
        userID: new TextEncoder().encode(userId),
        userDisplayName: user.email ?? 'MirioHub Traveler',
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
      });
      challengeText = opts.challenge;
      optionsPayload = opts as unknown as Record<string, unknown>;
    } else {
      ceremonyType = 'authentication';
      const opts = await generateAuthenticationOptions({
        rpID: expectedRPID,
        allowCredentials: passkeyRows.map((k) => ({
          id: k.credential_id,
          transports: k.transports ?? undefined,
        })),
        userVerification: 'required',
      });
      challengeText = opts.challenge;
      optionsPayload = opts as unknown as Record<string, unknown>;
    }

    // ── 7. Upsert challenge via admin client (bypasses RLS) ───────────────────
    // Only overwrite if current status is 'issued' (never overwrite processing/consumed).
    const upsertPayload = {
      user_id: userId,
      client_request_id: clientRequestId,
      challenge_text: challengeText,
      type: ceremonyType === 'registration' ? 'register' : 'login',
      purpose: ceremonyType === 'registration' ? 'anonymous_register' : 'login',
      status: 'issued',
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };

    const { data: challengeRow, error: chErr } = await admin
      .from('auth_challenges')
      .upsert(upsertPayload, { onConflict: 'client_request_id' })
      .select('id')
      .single();

    if (chErr || !challengeRow) {
      console.error('[challenge-init] auth_challenges upsert error:', {
        message: chErr?.message,
        code: chErr?.code,
        details: chErr?.details,
        hint: chErr?.hint,
      });
      return NextResponse.json(
        { success: false, errorKey: 'error.challenge_db_upsert_failed' },
        { status: 400 },
      );
    }

    const row = challengeRow as Record<string, unknown>;

    return NextResponse.json({
      success: true,
      challengeId: row.id,
      challengeText,
      options: optionsPayload,
      ceremonyType,
    });
  } catch (err: unknown) {
    console.error('[challenge-init] unexpected error:', err);
    return NextResponse.json(
      { success: false, errorKey: 'error.server_internal_crash' },
      { status: 500 },
    );
  }
}
