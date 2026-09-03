import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import {
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import {
  generateCanonicalPayloadHashV1,
  type RawPostInput,
} from '@/lib/auth/canonicalPayloadHash';

// ---------------------------------------------------------------------------
// Helpers
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
          // Route handler – ignore
        }
      },
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/auth/passkey/verify
// ---------------------------------------------------------------------------

interface RequestBody {
  challengeId: string;
  response: RegistrationResponseJSON | AuthenticationResponseJSON;
  installationId: string;
  clientRequestId: string;
  rawPostInput: RawPostInput;
  ceremonyType: 'registration' | 'authentication';
}

interface DbPasskey {
  credential_id: string;
  public_key: string;
  sign_count: number;
  transports: string[] | null;
  credential_device_type: string;
  credential_backed_up: boolean;
}

interface ChallengeRow {
  is_valid: boolean;
  challenge_text: string;
  processing_token: string;
}

interface TxResult {
  ok: boolean;
  error_msg?: string;
  post_id?: string;
  is_duplicate?: boolean;
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, errorKey: 'error.unauthorized_anonymous_session' },
      { status: 401 },
    );
  }

  const current_uid = session.user.id;

  // Declare outside try so catch can reference it for challenge cleanup.
  let clientRequestId: string | undefined;

  try {
    const body = (await request.json()) as RequestBody;
    const {
      challengeId,
      response,
      installationId,
      rawPostInput,
      ceremonyType,
    } = body;
    // Assign to outer-scoped variable so catch can use it.
    clientRequestId = body.clientRequestId;

    // 1. Reserve & validate challenge
    const { data: challengeData, error: chErr } = await supabase.rpc(
      'reserve_challenge_with_lease_v86',
      {
        p_challenge_id: challengeId,
        p_client_request_id: clientRequestId,
      },
    );

    const challengeRow = challengeData as ChallengeRow | null;

    if (chErr || !challengeRow?.is_valid) {
      return NextResponse.json(
        { success: false, errorKey: 'error.invalid_or_consumed_challenge' },
        { status: 400 },
      );
    }

    // 2. Server-side route distance
    const waypointsArray = Array.isArray(rawPostInput.waypoints)
      ? (rawPostInput.waypoints as Record<string, unknown>[])
      : [];

    const { data: serverKmsData, error: kmsErr } = await supabase.rpc(
      'calculate_server_route_kms_via_waypoints',
      {
        p_origin: rawPostInput.origin_address,
        p_waypoints: waypointsArray.map((w) => w.address),
        p_destination: rawPostInput.destination_address,
      },
    );

    if (kmsErr) throw new Error('Route calculation failed');
    const server_kms = serverKmsData as number;

    // 3. Canonical payload hash + server fee
    const { hash: canonicalPayloadHash, serverFeeMinor: serverFeeMinorVal } =
      generateCanonicalPayloadHashV1(rawPostInput, server_kms);

    // 4. WebAuthn verification
    const expectedRPID = process.env.WEBAUTHN_RP_ID!;
    const expectedOrigin = process.env.WEBAUTHN_ORIGIN!;

    let verified = false;
    let regInfo: Awaited<ReturnType<typeof verifyRegistrationResponse>>['registrationInfo'] =
      undefined;
    let authInfo:
      | Awaited<ReturnType<typeof verifyAuthenticationResponse>>['authenticationInfo']
      | undefined = undefined;
    let dbKey: DbPasskey | null = null;

    if (ceremonyType === 'registration') {
      const verifyRes = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: challengeRow.challenge_text,
        expectedOrigin,
        expectedRPID,
        requireUserVerification: true,
      });
      verified = verifyRes.verified;
      regInfo = verifyRes.registrationInfo;
    } else {
      const { data: keyData, error: keyErr } = await supabase
        .from('passkeys')
        .select('*')
        .eq('credential_id', (response as AuthenticationResponseJSON).id)
        .maybeSingle();

      if (keyErr || !keyData) {
        return NextResponse.json(
          { success: false, errorKey: 'error.authentication_credential_not_found' },
          { status: 400 },
        );
      }

      dbKey = keyData as DbPasskey;

      const verifyRes = await verifyAuthenticationResponse({
        response: response as AuthenticationResponseJSON,
        expectedChallenge: challengeRow.challenge_text,
        expectedOrigin,
        expectedRPID,
        credential: {
          id: dbKey.credential_id,
          publicKey: Buffer.from(dbKey.public_key, 'base64'),
          counter: dbKey.sign_count,
        },
        requireUserVerification: true,
      });
      verified = verifyRes.verified;
      authInfo = verifyRes.authenticationInfo;
    }

    if (!verified) {
      return NextResponse.json(
        { success: false, errorKey: 'error.crypto_invalid_signature' },
        { status: 400 },
      );
    }

    // Extract post-verification fields
    // registrationInfo.credential holds id/publicKey/counter/transports
    const final_counter =
      ceremonyType === 'registration'
        ? regInfo?.credential.counter
        : authInfo?.newCounter;

    const final_device_type =
      ceremonyType === 'registration'
        ? regInfo?.credentialDeviceType
        : dbKey?.credential_device_type;

    const final_backed_up =
      ceremonyType === 'registration'
        ? regInfo?.credentialBackedUp
        : dbKey?.credential_backed_up;

    const final_public_key =
      ceremonyType === 'registration'
        ? Buffer.from(regInfo!.credential.publicKey).toString('base64')
        : dbKey!.public_key;

    const final_transports =
      ceremonyType === 'registration'
        ? (regInfo?.credential.transports ?? null)
        : (dbKey?.transports ?? null);

    const final_credential_id =
      ceremonyType === 'registration'
        ? regInfo!.credential.id
        : dbKey!.credential_id;

    // 5. Idempotent commit RPC
    const { data: txData, error: txErr } = await supabase.rpc(
      'commit_phase3_business_idempotent_v86',
      {
        p_user_id: current_uid,
        p_challenge_id: challengeId,
        p_client_request_id: clientRequestId,
        p_processing_token: challengeRow.processing_token,
        p_payload_hash: canonicalPayloadHash,
        p_installation_id: installationId,
        p_credential_id: final_credential_id,
        p_public_key: final_public_key,
        p_sign_count: final_counter,
        p_transports: final_transports,
        p_device_type: final_device_type,
        p_backed_up: final_backed_up,
        p_post_payload: rawPostInput,
        p_server_fee_minor: serverFeeMinorVal,
        p_ceremony_type: ceremonyType,
      },
    );

    const tx = txData as TxResult | null;

    if (txErr || !tx?.ok) {
      return NextResponse.json(
        { success: false, errorKey: tx?.error_msg ?? 'error.transaction_failed' },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      postId: tx.post_id,
      isDuplicate: tx.is_duplicate,
    });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : 'error.server_internal_crash';
    // Only attempt cleanup when we know which challenge to mark failed.
    if (clientRequestId) {
      await supabase
        .from('auth_challenges')
        .update({ status: 'failed' })
        .eq('client_request_id', clientRequestId);
    }
    return NextResponse.json({ success: false, errorKey: msg }, { status: 500 });
  }
}
