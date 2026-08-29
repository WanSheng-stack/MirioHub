import { NextResponse } from "next/server";
import { geocodeAddress, toGeographyPointWkt } from "@/lib/route-kms";

export async function POST(request: Request) {
  let body: { address?: string; origin?: string; destination?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false });
  }

  if (body.address) {
    const geo = await geocodeAddress(body.address);
    if (!geo) return NextResponse.json({ ok: false });
    return NextResponse.json({
      ok: true,
      lat: geo.lat,
      lon: geo.lon,
      wkt: toGeographyPointWkt(geo.lat, geo.lon),
    });
  }

  const [origin, destination] = await Promise.all([
    body.origin ? geocodeAddress(body.origin) : Promise.resolve(null),
    body.destination ? geocodeAddress(body.destination) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    ok: Boolean(origin || destination),
    origin: origin
      ? { lat: origin.lat, lon: origin.lon, wkt: toGeographyPointWkt(origin.lat, origin.lon) }
      : null,
    destination: destination
      ? {
          lat: destination.lat,
          lon: destination.lon,
          wkt: toGeographyPointWkt(destination.lat, destination.lon),
        }
      : null,
  });
}
