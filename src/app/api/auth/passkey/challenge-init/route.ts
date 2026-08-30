import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

// ---------------------------------------------------------------------------
// Supabase route-handler client
// ---------------------------------------------------------------------------

function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
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
          // Route handler — ignore
        }
      },
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/auth/passkey/challenge-init
// ---------------------------------------------------------------------------

interface DbPasskeyRow {
  credential_id: string;
  transports: AuthenticatorTransportFuture[] | null;
}

export async function POST(request: Request) {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, errorKey: 'error.unauthorized_anonymous_session' },
      { status: 401 },
    );
  }

  const userId = session.user.id;

  try {
    const body = (await request.json()) as { clientRequestId?: string };
    const { clientRequestId } = body;
    if (!clientRequestId) throw new Error('Missing client_request_id');

    const expectedRPID = process.env.WEBAUTHN_RP_ID ?? 'localhost';
    const rpName = process.env.WEBAUTHN_RP_NAME ?? 'MirioHub Co-Car';

    // Check if this user already has registered passkeys
    const { data: dbKeys } = await supabase
      .from('passkeys')
      .select('credential_id, transports')
      .eq('user_id', userId);

    const passkeyRows = (dbKeys ?? []) as DbPasskeyRow[];
    const hasKeys = passkeyRows.length > 0;

    let ceremonyType: 'registration' | 'authentication';
    let challengeText: string;
    let optionsPayload: Record<string, unknown>;

    if (!hasKeys) {
      // First time: register a new passkey
      ceremonyType = 'registration';
      const opts = await generateRegistrationOptions({
        rpName,
        rpID: expectedRPID,
        userName: session.user.email ?? `user_${userId.slice(0, 8)}`,
        userID: new TextEncoder().encode(userId),
        userDisplayName: session.user.email ?? 'MirioHub Traveler',
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
      });
      challengeText = opts.challenge;
      optionsPayload = opts as unknown as Record<string, unknown>;
    } else {
      // Subsequent: authenticate with existing passkey
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

    // Persist challenge to DB (idempotent on client_request_id)
    const { data: challengeRow, error: chErr } = await supabase
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
    const msg =
      err instanceof Error ? err.message : 'error.server_internal_crash';
    return NextResponse.json(
      { success: false, errorKey: msg },
      { status: 500 },
    );
  }
}
