import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { evaluatePublishIntercept } from "@/lib/security/evaluateFraudIntercept";

type Body = {
  postType?: "demand" | "provider";
  normalizedPhone?: string;
  normalizedPlate?: string | null;
  departureDate?: string;
  departureWindow?: string;
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
  if (body.postType !== "demand" && body.postType !== "provider") {
    return NextResponse.json(
      { ok: false, errorKey: "error.submit_failed" },
      { status: 400 },
    );
  }
  if (!body.normalizedPhone) {
    return NextResponse.json(
      { ok: false, errorKey: "error.submit_failed" },
      { status: 400 },
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_premium")
    .eq("id", user.id)
    .maybeSingle();

  const decision = await evaluatePublishIntercept({
    userId: user.id,
    postType: body.postType,
    normalizedPhone: body.normalizedPhone,
    normalizedPlate: body.normalizedPlate ?? null,
    departureDate: body.departureDate ?? "",
    departureWindow: body.departureWindow ?? "",
    isPremium: Boolean(
      (profile as { is_premium?: boolean } | null)?.is_premium,
    ),
  });

  if (!decision.allowed) {
    return NextResponse.json({
      ok: false,
      errorKey: decision.errorKey,
    });
  }
  return NextResponse.json({ ok: true, errorKey: decision.errorKey });
}
