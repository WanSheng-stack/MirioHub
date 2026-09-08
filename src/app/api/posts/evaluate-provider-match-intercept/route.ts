import { NextResponse } from "next/server";
import { freezeLegacyDirectMatchIntercept } from "@/lib/matching/legacyMatchingFreeze";

export async function POST() {
  const result = freezeLegacyDirectMatchIntercept();
  return NextResponse.json(result.json, { status: result.status });
}
