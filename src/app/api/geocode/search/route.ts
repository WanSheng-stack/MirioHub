import { NextResponse } from "next/server";
import {
  ADDRESS_SEARCH_LIMIT,
  boundAddressQuery,
  boundLocalityContext,
  buildNominatimCandidateSearchUrl,
  parseNominatimCandidateResponse,
  requireExactCountryCode,
} from "@/lib/geo/addressSearch";
import { throttledNominatimGetJson } from "@/lib/geo/nominatimClient";

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

  const countryCode = requireExactCountryCode(body.countryCode);
  if (countryCode == null) {
    return NextResponse.json(
      { ok: false, errorKey: "error.address_country_required" },
      { status: 400 },
    );
  }

  const query = boundAddressQuery(body.query);
  if (query == null) {
    return NextResponse.json(
      { ok: false, errorKey: "error.address_query_required" },
      { status: 400 },
    );
  }

  let localityContext: string | null = null;
  if (body.localityContext != null && body.localityContext !== "") {
    localityContext = boundLocalityContext(body.localityContext);
    if (localityContext == null) {
      return NextResponse.json(
        { ok: false, errorKey: "error.address_query_required" },
        { status: 400 },
      );
    }
  }

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

  const fetched = await throttledNominatimGetJson(url);
  if (!fetched.ok) {
    return NextResponse.json({ ok: false, errorKey: fetched.errorKey });
  }

  const candidates = parseNominatimCandidateResponse(fetched.data, countryCode);
  return NextResponse.json({ ok: true, candidates });
}
