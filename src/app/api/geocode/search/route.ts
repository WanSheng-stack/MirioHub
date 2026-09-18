import { NextResponse } from "next/server";
import {
  ADDRESS_SEARCH_LIMIT,
  buildNominatimCandidateSearchUrl,
  normalizeSearchCountryCode,
  parseNominatimCandidateResponse,
} from "@/lib/geo/addressSearch";
import {
  NOMINATIM_GEOCODE_TIMEOUT_MS,
  NOMINATIM_USER_AGENT,
  normalizeGeocodeAddress,
} from "@/lib/route-kms";

export async function POST(request: Request) {
  let body: {
    countryCode?: unknown;
    query?: unknown;
    localityContext?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, errorKey: "error.geocode_failed" },
      { status: 400 },
    );
  }

  const countryCode = normalizeSearchCountryCode(body.countryCode);
  const query = normalizeGeocodeAddress(
    typeof body.query === "string" ? body.query : "",
  );
  if (countryCode == null) {
    return NextResponse.json(
      { ok: false, errorKey: "error.address_country_required" },
      { status: 400 },
    );
  }
  if (query == null) {
    return NextResponse.json(
      { ok: false, errorKey: "error.address_query_required" },
      { status: 400 },
    );
  }

  const localityContext =
    typeof body.localityContext === "string"
      ? normalizeGeocodeAddress(body.localityContext)
      : null;

  const url = buildNominatimCandidateSearchUrl({
    query,
    countryCode,
    localityContext,
    limit: ADDRESS_SEARCH_LIMIT,
  });
  if (url == null) {
    return NextResponse.json(
      { ok: false, errorKey: "error.geocode_failed" },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(NOMINATIM_GEOCODE_TIMEOUT_MS),
    });
  } catch (err) {
    const name =
      err != null && typeof err === "object"
        ? (err as { name?: string }).name
        : undefined;
    if (name === "AbortError" || name === "TimeoutError") {
      return NextResponse.json({ ok: false, errorKey: "error.geocode_timeout" });
    }
    return NextResponse.json({ ok: false, errorKey: "error.geocode_failed" });
  }

  if (!res.ok) {
    return NextResponse.json({ ok: false, errorKey: "error.geocode_failed" });
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return NextResponse.json({
      ok: false,
      errorKey: "error.geocode_invalid_response",
    });
  }

  const candidates = parseNominatimCandidateResponse(data, countryCode);
  return NextResponse.json({ ok: true, candidates });
}
