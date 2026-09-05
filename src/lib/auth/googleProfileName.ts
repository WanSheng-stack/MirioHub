import type { User } from "@supabase/supabase-js";

export function isProfileFullNameEmpty(fullName: string | null | undefined): boolean {
  return !String(fullName ?? "").trim();
}

/** Google / Auth metadata name. Never an authoritative overwrite source. */
export function resolveGoogleDisplayName(user: User): string | null {
  const hasGoogle = user.identities?.some((i) => i.provider === "google") ?? false;
  if (!hasGoogle) return null;

  const meta = user.user_metadata ?? {};
  const fromMeta = String(meta.full_name ?? meta.name ?? "").trim();
  if (fromMeta) return fromMeta;

  const google = user.identities?.find((i) => i.provider === "google");
  const data = (google?.identity_data ?? {}) as Record<string, unknown>;
  const fromIdentity = String(data.full_name ?? data.name ?? "").trim();
  return fromIdentity || null;
}
