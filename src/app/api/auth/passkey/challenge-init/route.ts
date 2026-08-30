import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

// ---------------------------------------------------------------------------
// A. sessionClient — SSR cookie client, anon key, subject to RLS.
//    Only used to read the authenticated/anonymous session (auth.uid()).
//    Never used to access passkeys or auth_challenges.
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
          // Route handler — ignore cookie write errors
        }
      },
    },
  });
}

// ---------------------------------------------------------------------------
// B. adminClient — service-role client, bypasses RLS.
//    Used ONLY server-side for passkeys reads and auth_challenges writes.
//    Key MUST NOT appear in NEXT_PUBLIC_* or any client-side bundle.
// ---------------------------------------------------------------------------

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return createSupabaseAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// UUID format guard (RFC 4122 — version bits [1-5], variant bits [89ab])
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  // ── A. Session: resolve trusted auth.uid() via SSR cookie client ──────────
  const sessionClient = await createSessionClient();
  const adminClient = createAdminClient();

  const {
    data: { user },
    error: userError,
  } = await sessionClient.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { success: false, errorKey: 'error.authentication_required' },
      { status: 401 },
    );
  }

  const userId = user.id; // server-trusted auth.uid() — never use body.userId

  // ── Parse + validate request body ─────────────────────────────────────────
  let clientRequestId: string;
  let bodyUserId: string | undefined;

  try {
    const body = (await request.json()) as {
      clientRequestId?: string;
      userId?: string;
    };
    clientRequestId = body.clientRequestId ?? '';
    bodyUserId = body.userId;
  } catch {
    return NextResponse.json(
      { success: false, errorKey: 'error.invalid_request_body' },
      { status: 400 },
    );
  }

  // ── UUID format guard ──────────────────────────────────────────────────────
  if (!clientRequestId || !UUID_RE.test(clientRequestId)) {
    return NextResponse.json(
      { success: false, errorKey: 'error.invalid_client_request_id' },
      { status: 400 },
    );
  }

  // ── bodyUserId consistency check (if client sends it, must match session) ──
  if (bodyUserId && bodyUserId !== userId) {
    return NextResponse.json(
      { success: false, errorKey: 'error.security_boundary_compromised' },
      { status: 403 },
    );
  }

  try {
    // ── Guard: refuse to overwrite a processing/consumed challenge ─────────
    const { data: existing } = await adminClient
      .from('auth_challenges')
      .select('id, status')
      .eq('client_request_id', clientRequestId)
      .maybeSingle();

    if (existing) {
      const row = existing as AuthChallengeRow;
      if (row.status === 'processing' || row.status === 'consumed') {
        return NextResponse.json(
          { success: false, errorKey: 'error.invalid_or_consumed_challenge' },
          { status: 409 },
        );
      }
    }

    // ── B. Read passkeys via adminClient (bypasses RLS) ────────────────────
    const { data: dbKeys, error: passkeysError } = await adminClient
      .from('passkeys')
      .select('credential_id, transports')
      .eq('user_id', userId);

    if (passkeysError) {
      console.error('[challenge-init] passkeys read error:', {
        message: passkeysError.message,
        code: passkeysError.code,
        details: passkeysError.details,
        hint: passkeysError.hint,
      });
      return NextResponse.json(
        { success: false, errorKey: 'error.passkeys_read_failed' },
        { status: 500 },
      );
    }

    const passkeyRows = (dbKeys ?? []) as DbPasskeyRow[];
    const hasKeys = passkeyRows.length > 0;

    // ── Generate WebAuthn options ──────────────────────────────────────────
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

    // ── B. Write auth_challenges via adminClient (bypasses RLS) ───────────
    const { data: challengeRow, error: chErr } = await adminClient
      .from('auth_challenges')
      .upsert(
        {
          user_id: userId,
          client_request_id: clientRequestId,
          challenge_text: challengeText,
          type: ceremonyType === 'registration' ? 'register' : 'login',
          purpose:
            ceremonyType === 'registration' ? 'anonymous_register' : 'login',
          status: 'issued',
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        },
        { onConflict: 'client_request_id' },
      )
      .select()
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
        { status: 500 },
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
    const e = err instanceof Error ? err : new Error(String(err));
    console.error('[challenge-init] unexpected error:', {
      name: e.name,
      message: e.message,
      stack: e.stack,
    });
    return NextResponse.json(
      { success: false, errorKey: 'error.server_internal_crash' },
      { status: 500 },
    );
  }
}
