import { NextResponse } from "next/server";
import { computeRouteDistance } from "@/lib/route-kms";

export async function POST(request: Request) {
  let body: { locations?: string[]; sliceOrigin?: string; sliceDestination?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, errorKey: "error.route_distance_failed" });
  }

  const locations = body.locations ?? [];
  const result = await computeRouteDistance(
    locations,
    body.sliceOrigin,
    body.sliceDestination,
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, errorKey: result.errorKey });
  }

  return NextResponse.json({
    ok: true,
    totalKms: result.totalKms,
    sliceKms: result.sliceKms,
  });
}
