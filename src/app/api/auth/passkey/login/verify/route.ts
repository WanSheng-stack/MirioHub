import { NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getWebAuthnConfig, WebAuthnConfigError } from "@/lib/auth/webauthnConfig";
import {
  LOGIN_SESSION_ISSUANCE_AVAILABLE,
  clientErrorKeyFromLoginVerifyException,
  credentialIdLogTag,
  mapLoginReserveReason,
} from "@/lib/auth/passkeyLogin";
import { isUsableReserveChallengeRow, normalizeReserveChallengeRow } from "@/lib/auth/normalizeReserveChallengeRow";

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createSupabaseAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function jsonError(errorKey: string, status = 400) {
  return NextResponse.json({ success: false, sessionIssued: false, errorKey }, { status });
}

interface RequestBody {
  challengeId?: string;
  clientRequestId?: string;
  response?: AuthenticationResponseJSON;
}

/**
 * POST /api/auth/passkey/login/verify
 * Resolves owner from credential_id only. Does not mint a Supabase session.
 */
export async function POST(request: Request) {
  const admin = createAdminClient();
  let fence: {
    challengeId: string;
    clientRequestId: string;
    processingToken: string;
  } | null = null;
  let credentialTag: string | undefined;

  try {
    const body = (await request.json()) as RequestBody;
    const { challengeId, clientRequestId, response } = body;
    if (!challengeId || !clientRequestId || !response?.id) {
      return jsonError("error.device_login_failed");
    }

    const { rpID, origin } = getWebAuthnConfig();

    const { data: reserveData, error: reserveErr } = await admin.rpc(
      "reserve_login_challenge_with_lease_v86",
      {
        p_challenge_id: challengeId,
        p_client_request_id: clientRequestId,
      },
    );
    const reserveRow = normalizeReserveChallengeRow(reserveData);
    if (reserveErr || !isUsableReserveChallengeRow(reserveRow)) {
      const { data: reason } = await admin.rpc(
        "classify_login_challenge_reserve_failure_v86",
        {
          p_challenge_id: challengeId,
          p_client_request_id: clientRequestId,
        },
      );
      return jsonError(mapLoginReserveReason(typeof reason === "string" ? reason : "invalid"));
    }

    fence = {
      challengeId,
      clientRequestId,
      processingToken: reserveRow.processing_token,
    };

    credentialTag = credentialIdLogTag(response.id);
    const { data: keyData, error: keyErr } = await admin
      .from("passkeys")
      .select("user_id, credential_id, public_key, sign_count, transports")
      .eq("credential_id", response.id)
      .maybeSingle();

    if (keyErr || !keyData) {
      console.error("[passkey-login/verify] credential not found", {
        challenge_id: challengeId,
        credential_id: credentialTag,
        category: "login_not_found",
      });
      await admin.rpc("mark_login_challenge_failed_v86", {
        p_challenge_id: fence.challengeId,
        p_client_request_id: fence.clientRequestId,
        p_processing_token: fence.processingToken,
      });
      return jsonError("error.device_login_not_found");
    }

    const passkey = keyData as {
      user_id: string;
      credential_id: string;
      public_key: string;
      sign_count: number;
      transports: string[] | null;
    };

    const verifyRes = await verifyAuthenticationResponse({
      response,
      expectedChallenge: reserveRow.challenge_text,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credential_id,
        publicKey: Buffer.from(passkey.public_key, "base64"),
        counter: passkey.sign_count,
      },
      requireUserVerification: true,
    });

    if (!verifyRes.verified) {
      console.error("[passkey-login/verify] assertion unverified", {
        challenge_id: challengeId,
        credential_id: credentialTag,
        category: "crypto_unverified",
      });
      await admin.rpc("mark_login_challenge_failed_v86", {
        p_challenge_id: fence.challengeId,
        p_client_request_id: fence.clientRequestId,
        p_processing_token: fence.processingToken,
      });
      return jsonError("error.device_login_failed");
    }

    const { data: consumeData, error: consumeErr } = await admin.rpc(
      "consume_login_challenge_and_bump_sign_count_v86",
      {
        p_challenge_id: fence.challengeId,
        p_client_request_id: fence.clientRequestId,
        p_processing_token: fence.processingToken,
        p_user_id: passkey.user_id,
        p_credential_id: passkey.credential_id,
        p_sign_count: verifyRes.authenticationInfo.newCounter,
      },
    );
    const consumed = consumeData as { ok?: boolean } | null;
    if (consumeErr || !consumed?.ok) {
      console.error("[passkey-login/verify] consume failed", {
        challenge_id: challengeId,
        credential_id: credentialTag,
        category: "consume_rejected",
      });
      await admin.rpc("mark_login_challenge_failed_v86", {
        p_challenge_id: fence.challengeId,
        p_client_request_id: fence.clientRequestId,
        p_processing_token: fence.processingToken,
      });
      return jsonError("error.device_login_failed");
    }

    console.error("[passkey-login/verify] assertion ok, session not issued", {
      challenge_id: challengeId,
      credential_id: credentialTag,
      category: "session_issuance_unavailable",
      session_issuance: LOGIN_SESSION_ISSUANCE_AVAILABLE,
    });

    return NextResponse.json(
      {
        success: false,
        verified: true,
        sessionIssued: false,
        errorKey: "error.device_login_session_unavailable",
      },
      { status: 503 },
    );
  } catch (error: unknown) {
    const e = error instanceof Error ? error : new Error(String(error));
    if (error instanceof WebAuthnConfigError) {
      console.error("[webauthn] configuration error", {
        name: e.name,
        message: e.message,
        challenge_id: fence?.challengeId,
        credential_id: credentialTag,
      });
      if (fence) {
        await admin.rpc("mark_login_challenge_failed_v86", {
          p_challenge_id: fence.challengeId,
          p_client_request_id: fence.clientRequestId,
          p_processing_token: fence.processingToken,
        });
      }
      return jsonError(error.errorKey, 500);
    }
    console.error("[passkey-login/verify] unexpected error", {
      name: e.name,
      message: e.message,
      challenge_id: fence?.challengeId,
      credential_id: credentialTag,
      category: "internal_exception",
    });
    if (fence) {
      await admin.rpc("mark_login_challenge_failed_v86", {
        p_challenge_id: fence.challengeId,
        p_client_request_id: fence.clientRequestId,
        p_processing_token: fence.processingToken,
      });
    }
    return jsonError(clientErrorKeyFromLoginVerifyException(error));
  }
}
