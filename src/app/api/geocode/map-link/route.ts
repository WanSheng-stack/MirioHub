import { NextResponse } from "next/server";
import { requireExactCountryCode } from "@/lib/geo/addressSearch";
import { importPlaceFromGoogleMapsLink } from "@/lib/geo/googleMapsLinkImport";

/**
 * POST /api/geocode/map-link
 * Server-only Google Maps share-link import → Nominatim reverse candidate.
 * Never trusts client coordinates; never returns Google Place IDs as authority.
 */
export async function POST(request: Request) {
  let body: { url?: unknown; countryCode?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, errorKey: "error.map_link_invalid" },
      { status: 400 },
    );
  }

  const countryCode = requireExactCountryCode(body.countryCode);
  if (countryCode == null) {
    return NextResponse.json(
      { ok: false, errorKey: "error.map_link_country_mismatch" },
      { status: 400 },
    );
  }

  const result = await importPlaceFromGoogleMapsLink(body.url, countryCode);
  if (!result.ok) {
    const status =
      result.errorKey === "error.map_link_timeout"
        ? 504
        : result.errorKey === "error.map_link_host_not_allowed" ||
            result.errorKey === "error.map_link_redirect_invalid"
          ? 400
          : 422;
    return NextResponse.json(
      { ok: false, errorKey: result.errorKey },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    candidate: result.candidate,
    source: result.source,
  });
}
