import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  interpretProfilePhoneRpc,
  type AccountPhoneWriteResult,
} from "@/lib/profile/accountPhoneWrite";

/** Service-role writer. Only phone. Never trust a browser-supplied user_id. */
export async function writeAccountPhone(
  admin: SupabaseClient,
  userId: string,
  phone: string,
): Promise<AccountPhoneWriteResult> {
  const { data, error } = await admin.rpc("set_profile_phone_v87", {
    p_user_id: userId,
    p_phone: phone,
  });
  return interpretProfilePhoneRpc({ data, error });
}
