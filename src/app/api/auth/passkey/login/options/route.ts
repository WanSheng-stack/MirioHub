/**
 * DEPRECATED / remove candidate (PHASE 6.4A).
 * Returning login should use supabase.auth.signInWithPasskey().
 * Do not apply 20260906000001_passkey_authentication_v86.sql for this path.
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getWebAuthnConfig, WebAuthnConfigError } from "@/lib/auth/webauthnConfig";
import { isUsernamelessAuthenticationOptions } from "@/lib/auth/passkeyLogin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  return NextResponse.json({ success: false, errorKey }, { status });
}

/**
 * POST /api/auth/passkey/login/options
 * Anon-callable. Discoverable authentication only — no user_id / credential list.
 */
export async function POST(request: Request) {
  let clientRequestId = crypto.randomUUID();
  try {
    const body = (await request.json()) as { clientRequestId?: string };
    if (body.clientRequestId) {
      if (!UUID_RE.test(body.clientRequestId)) {
        return jsonError("error.invalid_client_request_id");
      }
      clientRequestId = body.clientRequestId;
    }
  } catch {
    // Empty body is allowed — we mint clientRequestId.
  }

  try {
    const { rpID } = getWebAuthnConfig();
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
    });
    const optionsPayload = options as unknown as Record<string, unknown>;
    if (!isUsernamelessAuthenticationOptions(optionsPayload)) {
      console.error("[passkey-login/options] allowCredentials leaked", {
        category: "options_not_usernameless",
      });
      return jsonError("error.device_login_failed", 500);
    }

    const admin = createAdminClient();
    const { data: challengeRow, error: chErr } = await admin
      .from("auth_challenges")
      .insert({
        user_id: null,
        client_request_id: clientRequestId,
        challenge_text: options.challenge,
        type: "login",
        purpose: "login",
        status: "issued",
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single();

    if (chErr || !challengeRow) {
      console.error("[passkey-login/options] challenge insert failed", {
        category: "challenge_insert",
      });
      return jsonError("error.device_login_failed", 500);
    }

    return NextResponse.json({
      success: true,
      challengeId: (challengeRow as { id: string }).id,
      clientRequestId,
      options: optionsPayload,
    });
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    if (err instanceof WebAuthnConfigError) {
      console.error("[webauthn] configuration error", {
        name: e.name,
        message: e.message,
      });
      return jsonError(err.errorKey, 500);
    }
    console.error("[passkey-login/options] unexpected error", {
      name: e.name,
      message: e.message,
      category: "internal_exception",
    });
    return jsonError("error.device_login_failed", 500);
  }
}
