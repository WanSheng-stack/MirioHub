/**
 * PHASE 6.7C.2C.3J-A — country-scoped address candidate search (offline).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/geo/addressSearch.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADDRESS_SEARCH_LIMIT,
  buildNominatimCandidateSearchUrl,
  candidateToConfirmed,
  classifyAddressPrecision,
  isCityLevelPrecision,
  normalizeSearchCountryCode,
  parseNominatimCandidateResponse,
} from "@/lib/geo/addressSearch";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

{
  assert.equal(normalizeSearchCountryCode("rs"), "RS");
  assert.equal(normalizeSearchCountryCode(" RS "), "RS");
  assert.equal(normalizeSearchCountryCode("serbia"), null);
  assert.equal(normalizeSearchCountryCode(""), null);
  assert.equal(normalizeSearchCountryCode(null), null);
}

{
  assert.equal(classifyAddressPrecision({ type: "city" }), "city");
  assert.equal(classifyAddressPrecision({ addresstype: "suburb" }), "locality");
  assert.equal(classifyAddressPrecision({ type: "residential" }), "street");
  assert.equal(classifyAddressPrecision({ class: "amenity", type: "cafe" }), "poi");
  assert.equal(isCityLevelPrecision("city"), true);
  assert.equal(isCityLevelPrecision("street"), false);
}

{
  const url = buildNominatimCandidateSearchUrl({
    query: "nis",
    countryCode: "RS",
  });
  assert.ok(url);
  assert.ok(url!.includes("countrycodes=rs"));
  assert.ok(url!.includes("limit=5"));
  assert.ok(url!.includes("featureType=settlement"));
  assert.ok(url!.includes(encodeURIComponent("nis")) || url!.includes("q=nis"));
  assert.equal(url!.includes("limit=1"), false);
}

{
  const refined = buildNominatimCandidateSearchUrl({
    query: "Medijana",
    countryCode: "RS",
    localityContext: "Niš",
  });
  assert.ok(refined);
  assert.ok(refined!.includes("countrycodes=rs"));
  assert.equal(refined!.includes("featureType=settlement"), false);
  assert.ok(decodeURIComponent(refined!).includes("Medijana"));
  assert.ok(decodeURIComponent(refined!).includes("Niš"));
}

{
  assert.equal(
    buildNominatimCandidateSearchUrl({ query: "nis", countryCode: "" }),
    null,
  );
  assert.equal(
    buildNominatimCandidateSearchUrl({ query: "  ", countryCode: "RS" }),
    null,
  );
}

{
  // Nice (FR) must not appear when expecting RS
  const frNice = [
    {
      place_id: 1,
      lat: "43.7102",
      lon: "7.2620",
      name: "Nice",
      display_name: "Nice, France",
      type: "city",
      address: { city: "Nice", country: "France", country_code: "fr" },
    },
  ];
  assert.deepEqual(parseNominatimCandidateResponse(frNice, "RS"), []);

  const rsNis = [
    {
      place_id: 2,
      lat: "43.3209",
      lon: "21.8958",
      name: "Niš",
      display_name: "Niš, Serbia",
      type: "city",
      addresstype: "city",
      address: {
        city: "Niš",
        country: "Serbia",
        country_code: "rs",
      },
    },
    {
      place_id: 3,
      lat: "43.33",
      lon: "21.9",
      name: "Medijana",
      display_name: "Medijana, Niš, Serbia",
      type: "suburb",
      address: {
        suburb: "Medijana",
        city: "Niš",
        country: "Serbia",
        country_code: "rs",
      },
    },
  ];
  const parsed = parseNominatimCandidateResponse(rsNis, "RS");
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].primaryName, "Niš");
  assert.equal(parsed[0].countryCode, "RS");
  assert.equal(parsed[0].precision, "city");
  assert.equal(parsed[1].precision, "locality");
  assert.ok(!JSON.stringify(parsed).includes("43.7102")); // not asserting lat display; just structure

  const confirmed = candidateToConfirmed(parsed[0], "RS");
  assert.equal(confirmed.precision, "city");
  assert.equal(confirmed.searchCountryCode, "RS");
  assert.ok(confirmed.localityContext);
}

{
  const many = Array.from({ length: 8 }, (_, i) => ({
    place_id: i + 10,
    lat: String(44 + i * 0.01),
    lon: "20.4",
    name: `Place ${i}`,
    display_name: `Place ${i}, Serbia`,
    type: "suburb",
    address: { country_code: "rs", country: "Serbia", city: "Belgrade" },
  }));
  assert.equal(parseNominatimCandidateResponse(many, "RS").length, ADDRESS_SEARCH_LIMIT);
}

{
  const api = read("src/app/api/geocode/search/route.ts");
  assert.ok(api.includes("countryCode"));
  assert.ok(api.includes("localityContext"));
  assert.ok(api.includes("buildNominatimCandidateSearchUrl"));
  assert.ok(api.includes("parseNominatimCandidateResponse"));

  const funnel = read("src/components/home/AddressFunnel.tsx");
  assert.ok(funnel.includes("AddressSearchField"));
  assert.equal(funnel.includes("origin.trim()"), false);

  const field = read("src/components/home/AddressSearchField.tsx");
  assert.ok(field.includes("/api/geocode/search"));
  assert.ok(field.includes("confirmed"));
  assert.equal(field.includes("debounce"), false);
  assert.ok(field.includes("onClick={() => void runSearch()}"));

  const kms = read("src/lib/post-form/useRouteKmsEstimation.ts");
  assert.ok(kms.includes("origin_geo"));
  assert.ok(kms.includes("destination_geo"));
  assert.ok(kms.includes("points"));
}

console.log("addressSearch.test.ts: PASS");
