import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Stage-2 contact helpers only. New Stage-1 posts must go through
 * trusted-publish / Passkey commit_phase3 / shadow-draft → insert_stage1_post_v98.
 * Direct browser `posts.insert` publish paths are removed (PHASE 6.7C.2B.1).
 */

export async function upsertPhoneHistory(
  supabase: SupabaseClient,
  userId: string,
  normalizedPhone: string,
): Promise<number> {
  const { data: existing } = await supabase
    .from("phone_history")
    .select("id")
    .eq("normalized_phone", normalizedPhone)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("phone_history")
      .update({ last_post_at: new Date().toISOString() })
      .eq("id", existing.id);
    return existing.id as number;
  }

  const { data: inserted, error } = await supabase
    .from("phone_history")
    .insert({
      user_id: userId,
      normalized_phone: normalizedPhone,
      last_post_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !inserted) return 0;
  return inserted.id as number;
}

export async function upsertPlateHistory(
  supabase: SupabaseClient,
  userId: string,
  normalizedLicensePlate: string,
): Promise<number | null> {
  if (!normalizedLicensePlate) return null;

  const { data: existing } = await supabase
    .from("plate_history")
    .select("id")
    .eq("normalized_license_plate", normalizedLicensePlate)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.id) return existing.id as number;

  const { data: inserted, error } = await supabase
    .from("plate_history")
    .insert({
      user_id: userId,
      normalized_license_plate: normalizedLicensePlate,
    })
    .select("id")
    .single();
  if (error || !inserted) return null;
  return inserted.id as number;
}
