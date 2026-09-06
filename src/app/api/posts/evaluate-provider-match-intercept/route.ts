import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { evaluateProviderMatchFraud } from "@/lib/security/evaluateFraudIntercept";

type Body = {
  demandPostId?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, errorKey: "error.submit_failed" },
      { status: 401 },
    );
  }

  const body = (await request.json()) as Body;
  if (!body.demandPostId) {
    return NextResponse.json(
      { ok: false, errorKey: "error.not_found" },
      { status: 400 },
    );
  }

  const { data: me } = await supabase
    .from("profiles")
    .select("phone, plate, is_bank_verified")
    .eq("id", user.id)
    .maybeSingle();

  const normPhone = String(
    (me as { phone?: string } | null)?.phone ?? "",
  ).replace(/\D/g, "");
  const normPlate = String(
    (me as { plate?: string } | null)?.plate ?? "",
  )
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

  const decision = await evaluateProviderMatchFraud({
    userId: user.id,
    demandPostId: body.demandPostId,
    providerNormalizedPhone: normPhone,
    providerNormalizedLicensePlate: normPlate || null,
    isBankVerified: Boolean(
      (me as { is_bank_verified?: boolean } | null)?.is_bank_verified,
    ),
  });

  if (!decision.allowed) {
    return NextResponse.json({
      ok: false,
      errorKey: decision.errorKey,
    });
  }
  return NextResponse.json({
    ok: true,
    errorKey: decision.errorKey,
    isSpaceWarning: Boolean(decision.isSpaceWarning),
  });
}
