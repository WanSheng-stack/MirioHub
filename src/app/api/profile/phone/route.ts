import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  runAccountPhoneRoute,
  SERVER_CONFIGURATION_KEY,
} from "@/lib/profile/accountPhoneRoute";
import { formatSafePhoneWriteLog } from "@/lib/profile/accountPhoneWrite";
import { writeAccountPhone } from "@/lib/profile/writeAccountPhone";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * POST /api/profile/phone
 * Session user only. Body: { phone_country, raw_phone_local }.
 * Ignores any client-supplied user_id.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const result = await runAccountPhoneRoute({
      getUserId: async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        return user?.id;
      },
      readBody: () => request.json(),
      createAdmin: () => createAdminClient(),
      writePhone: (admin, userId, phone) =>
        writeAccountPhone(admin as SupabaseClient, userId, phone),
      onWriteFailure: (failure) => {
        console.error(
          "[api/profile/phone] set_profile_phone_v87 failed",
          formatSafePhoneWriteLog(failure),
        );
      },
      onConfigFailure: () => {
        console.error("[api/profile/phone] admin client init failed");
      },
    });
    return NextResponse.json(result.json, { status: result.status });
  } catch {
    return NextResponse.json(
      { ok: false, errorKey: SERVER_CONFIGURATION_KEY },
      { status: 500 },
    );
  }
}
