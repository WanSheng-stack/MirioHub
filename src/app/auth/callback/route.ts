import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/sr";

  if (code) {
    const supabase = await createClient();

    // ── UUID continuity guard for identity-linking flows ────────────────────
    // When an anonymous user links Google or verifies email via OAuth, the
    // exchangeCodeForSession call MUST preserve their existing UUID-A.
    // If the UUID changes (i.e. a new auth.users row was created), we have
    // an account-split — we must not activate any draft and must report it.
    const {
      data: { user: beforeUser },
    } = await supabase.auth.getUser();
    const beforeUuid = beforeUser?.id ?? null;

    await supabase.auth.exchangeCodeForSession(code);

    // Only check continuity when there was a pre-existing session.
    // Fresh sign-ins (beforeUuid === null) are not subject to this guard.
    if (beforeUuid) {
      const {
        data: { user: afterUser },
      } = await supabase.auth.getUser();
      const afterUuid = afterUser?.id ?? null;

      if (afterUuid && afterUuid !== beforeUuid) {
        // UUID changed — a new Account was created instead of linking.
        // Do NOT auto-merge, do NOT transfer posts.  Report the break.
        console.error("[auth/callback] Account identity continuity broken:", {
          before: beforeUuid,
          after: afterUuid,
        });
        const errorTarget = new URL(`${origin}${next}`);
        errorTarget.searchParams.set(
          "error",
          "account_identity_continuity_broken",
        );
        return NextResponse.redirect(errorTarget.toString());
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
