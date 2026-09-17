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
  buildCanonicalStage1PublishContext,
  CanonicalStage1Error,
  toRpcStage1Payload,
} from '@/lib/auth/buildCanonicalStage1PublishContext';
import {
  evaluateStage1ActivePublicationRisk,
  findPublishIntentByClientRequestId,
  isExistingActiveIntentForOwner,
} from '@/lib/auth/stage1ActiveRisk';
import {
  classifyChallengeReserveFailure,
  markChallengeFailed,
  type ChallengeFence,
} from '@/lib/auth/markChallengeFailed';
import {
  isUsableReserveChallengeRow,
  normalizeReserveChallengeRow,
} from '@/lib/auth/normalizeReserveChallengeRow';
import {
  clientErrorKeyFromUnknownVerifyError,
  getWebAuthnConfig,
  WebAuthnConfigError,
} from '@/lib/auth/webauthnConfig';
import { buildAuthorityForPublishFromOriginHit } from '@/lib/safety/buildAuthorityForPublishFromOriginHit';
import { parseV101PublishRpcResult } from '@/lib/safety/parseV101PublishRpcResult';
import { createAdminClient } from '@/lib/supabase/admin';

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

interface RequestBody {
  challengeId: string;
  response: RegistrationResponseJSON | AuthenticationResponseJSON;
  installationId: string;
  clientRequestId: string;
  rawPostInput: Record<string, unknown>;
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

function jsonError(errorKey: string, status = 400) {
  return NextResponse.json({ success: false, errorKey }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();

  // Server-verified JWT actor for service-role v101 writer p_user_id.
  // Keep challenge reserve / passkey reads on this session client.
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user?.id) {
    return jsonError('error.unauthorized_anonymous_session', 401);
  }

  const current_uid = user.id;
  let fence: ChallengeFence | null = null;
  let ceremonyType: 'registration' | 'authentication' | undefined;

  try {
    const body = (await request.json()) as RequestBody;
    const { challengeId, response, installationId, rawPostInput } = body;
    ceremonyType = body.ceremonyType;
    const clientRequestId = body.clientRequestId;
    if (!clientRequestId) {
      return jsonError('error.invalid_client_request_id');
    }
    if (!challengeId || !response) {
      return jsonError('error.device_verification_invalid');
    }
    if (ceremonyType !== 'registration' && ceremonyType !== 'authentication') {
      return jsonError('error.device_verification_invalid');
    }

    const { rpID, origin } = getWebAuthnConfig();

    const { data: challengeData, error: chErr } = await supabase.rpc(
      'reserve_challenge_with_lease_v86',
      {
        p_challenge_id: challengeId,
        p_client_request_id: clientRequestId,
      },
    );

    const challengeRow = normalizeReserveChallengeRow(challengeData);

    if (chErr || !isUsableReserveChallengeRow(challengeRow)) {
      const errorKey = await classifyChallengeReserveFailure(
        supabase,
        challengeId,
        clientRequestId,
      );
      console.error('[verify] reserve rejected', {
        challenge_id: challengeId,
        client_request_id: clientRequestId,
        ceremony_type: ceremonyType,
        category: 'reserve_rejected',
      });
      return jsonError(errorKey);
    }

    fence = {
      challengeId,
      clientRequestId,
      processingToken: challengeRow.processing_token,
    };

    const ctx = await buildCanonicalStage1PublishContext(rawPostInput);
    const existing = await findPublishIntentByClientRequestId(
      supabase,
      clientRequestId,
    );
    // Owner+active may skip risk/fresh authority only — not payload equality.
    const skipRiskAndFreshAuthority = isExistingActiveIntentForOwner(
      existing,
      current_uid,
    );
    if (!skipRiskAndFreshAuthority) {
      const risk = await evaluateStage1ActivePublicationRisk(
        supabase,
        current_uid,
        ctx.canonicalPayload,
      );
      if (!risk.allowed) {
        await markChallengeFailed(supabase, fence, 'risk_rejected');
        return jsonError(risk.errorKey);
      }
    }

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
        expectedOrigin: origin,
        expectedRPID: rpID,
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
        await markChallengeFailed(supabase, fence, 'credential_not_found');
        return jsonError('error.authentication_credential_not_found');
      }

      dbKey = keyData as DbPasskey;

      const verifyRes = await verifyAuthenticationResponse({
        response: response as AuthenticationResponseJSON,
        expectedChallenge: challengeRow.challenge_text,
        expectedOrigin: origin,
        expectedRPID: rpID,
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
      await markChallengeFailed(supabase, fence, 'crypto_unverified');
      return jsonError('error.device_verification_failed');
    }

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

    // Authority after successful WebAuthn crypto. Owner+active may omit fresh
    // authority (NULL args → v101 uses stored). Other paths require it.
    let originGps: string | null = null;
    let originCountry: string | null = null;
    let originTimezone: string | null = null;
    let nightVersion: number | null = null;

    if (!skipRiskAndFreshAuthority) {
      const authority = await buildAuthorityForPublishFromOriginHit(
        ctx.canonicalPayload,
        ctx.originNominatimHit,
      );
      if (!authority.ok) {
        await markChallengeFailed(supabase, fence, 'authority_rejected');
        return jsonError(authority.errorKey);
      }
      originGps = authority.fields.origin_gps;
      originCountry = authority.fields.origin_country_code;
      originTimezone = authority.fields.origin_timezone;
      nightVersion = authority.fields.night_policy_version;
    }

    const admin = createAdminClient();
    const { data: txData, error: txErr } = await admin.rpc(
      'commit_phase3_business_idempotent_v101',
      {
        p_user_id: current_uid,
        p_challenge_id: challengeId,
        p_client_request_id: clientRequestId,
        p_processing_token: challengeRow.processing_token,
        p_canonical_payload_hash: ctx.payloadHash,
        p_installation_id: installationId,
        p_credential_id: final_credential_id,
        p_public_key: final_public_key,
        p_sign_count: final_counter,
        p_transports: final_transports,
        p_device_type: final_device_type,
        p_backed_up: final_backed_up,
        p_post_payload: toRpcStage1Payload(ctx.canonicalPayload, ctx.serverFeeMinor),
        p_server_fee_minor: ctx.serverFeeMinor,
        p_ceremony_type: ceremonyType,
        p_origin_gps: originGps,
        p_origin_country_code: originCountry,
        p_origin_timezone: originTimezone,
        p_night_policy_version: nightVersion,
      },
    );

    if (txErr) {
      console.error('[verify] v101 RPC error', {
        code: txErr.code,
        category: 'v101_rpc_failed',
        client_request_id: clientRequestId,
        ceremony_type: ceremonyType,
      });
      await markChallengeFailed(supabase, fence, 'commit_rejected');
      return jsonError('error.transaction_failed');
    }

    const parsed = parseV101PublishRpcResult(txData, 'error.transaction_failed');
    if (!parsed.ok) {
      if (parsed.errorKey !== 'error.challenge_fencing_stale') {
        await markChallengeFailed(supabase, fence, 'commit_rejected');
      }
      return jsonError(parsed.errorKey);
    }

    return NextResponse.json({
      success: true,
      postId: parsed.postId,
      isDuplicate: parsed.isDuplicate,
    });
  } catch (error: unknown) {
    if (error instanceof CanonicalStage1Error) {
      await markChallengeFailed(supabase, fence, 'canonical_rejected');
      return jsonError(error.errorKey);
    }
    const e = error instanceof Error ? error : new Error(String(error));
    if (error instanceof WebAuthnConfigError) {
      console.error('[webauthn] configuration error', {
        name: e.name,
        message: e.message,
        client_request_id: fence?.clientRequestId,
        ceremony_type: ceremonyType,
      });
      await markChallengeFailed(supabase, fence, 'configuration_error');
      return jsonError(error.errorKey, 500);
    }
    console.error('[verify] unexpected error', {
      name: e.name,
      message: e.message,
      client_request_id: fence?.clientRequestId,
      ceremony_type: ceremonyType,
      category: 'internal_exception',
    });
    await markChallengeFailed(supabase, fence, 'internal_exception');
    return jsonError(clientErrorKeyFromUnknownVerifyError(error));
  }
}
