/**
 * Server-only Account activation eligibility.
 *
 * Eligibility is a persistent Account property, not a per-post ceremony:
 *   has_passkey OR linked Google identity OR email_confirmed_at
 *
 * Phone / plate are contact data and MUST NOT appear here.
 * Client-supplied flags (hasPasskey, googleVerified, …) are never trusted.
 */

import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AccountActivationEligibility = {
  eligible: boolean;
  hasPasskey: boolean;
  hasGoogleIdentity: boolean;
  hasVerifiedEmail: boolean;
};

export async function getAccountActivationEligibility(
  supabase: SupabaseClient,
  user: User,
): Promise<AccountActivationEligibility> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("has_passkey")
    .eq("id", user.id)
    .maybeSingle();

  const hasPasskey = Boolean(
    (profile as { has_passkey?: boolean } | null)?.has_passkey,
  );
  const hasGoogleIdentity = Boolean(
    user.identities?.some((i) => i.provider === "google"),
  );
  const hasVerifiedEmail = Boolean(user.email_confirmed_at);

  return {
    hasPasskey,
    hasGoogleIdentity,
    hasVerifiedEmail,
    eligible: hasPasskey || hasGoogleIdentity || hasVerifiedEmail,
  };
}
