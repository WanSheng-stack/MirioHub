import type { User } from "@supabase/supabase-js";

export type AccountIdentityState = {
  hasGoogle: boolean;
  googleIdentityEmail: string | null;
  hasVerifiedEmail: boolean;
  verifiedAccountEmail: string | null;
  emailsMatch: boolean;
  hasPasskey: boolean;
};

function googleIdentityEmailFromUser(
  user: Pick<User, "identities"> | null | undefined,
): string | null {
  const google = user?.identities?.find((i) => i.provider === "google");
  if (!google) return null;
  const email = String(
    (google.identity_data as { email?: unknown } | undefined)?.email ?? "",
  ).trim();
  return email || null;
}

/** Shared Account / Success identity view. Google email is never auth.users.email. */
export function resolveAccountIdentityState(
  user: Pick<User, "identities" | "email" | "email_confirmed_at"> | null | undefined,
  profile?: { has_passkey?: boolean | null } | null,
): AccountIdentityState {
  const hasGoogle = Boolean(user?.identities?.some((i) => i.provider === "google"));
  const googleIdentityEmail = hasGoogle ? googleIdentityEmailFromUser(user) : null;
  const hasVerifiedEmail = Boolean(user?.email_confirmed_at);
  const verified = String(user?.email ?? "").trim();
  const verifiedAccountEmail = hasVerifiedEmail && verified ? verified : null;
  const emailsMatch =
    Boolean(googleIdentityEmail) &&
    Boolean(verifiedAccountEmail) &&
    googleIdentityEmail!.toLowerCase() === verifiedAccountEmail!.toLowerCase();

  return {
    hasGoogle,
    googleIdentityEmail,
    hasVerifiedEmail,
    verifiedAccountEmail,
    emailsMatch,
    hasPasskey: Boolean(profile?.has_passkey),
  };
}
