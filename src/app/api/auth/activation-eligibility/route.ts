/**
 * GET /api/auth/activation-eligibility
 *
 * Returns the current Account's persistent publish eligibility.
 * All claims come from server-trusted session + profiles.has_passkey.
 * Client identity flags are ignored (this route has no body).
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountActivationEligibility } from "@/lib/auth/accountActivationEligibility";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user?.id) {
    return NextResponse.json(
      { success: false, errorKey: "error.authentication_required" },
      { status: 401 },
    );
  }

  const eligibility = await getAccountActivationEligibility(supabase, user);

  return NextResponse.json({
    success: true,
    eligible: eligibility.eligible,
    methods: {
      passkey: eligibility.hasPasskey,
      google: eligibility.hasGoogleIdentity,
      email: eligibility.hasVerifiedEmail,
    },
  });
}
