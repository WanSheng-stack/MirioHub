import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeAccountPhoneSave } from "@/lib/profile/accountPhoneSave";
import { writeAccountPhone } from "@/lib/profile/writeAccountPhone";

/**
 * POST /api/profile/phone
 * Session user only. Body: { phone_country, raw_phone_local }.
 * Ignores any client-supplied user_id.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const admin = createAdminClient();
  const result = await executeAccountPhoneSave({
    userId: user?.id,
    body,
    writePhone: (userId, phone) => writeAccountPhone(admin, userId, phone),
  });

  return NextResponse.json(result.json, { status: result.status });
}
