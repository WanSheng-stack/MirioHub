/**
 * PHASE 6.7C.2C.3J-A.1 — trusted OSM place refs + strict search contract.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/geo/addressSearch.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADDRESS_SEARCH_LIMIT,
  boundAddressQuery,
  boundLocalityContext,
  buildNominatimCandidateSearchUrl,
  buildNominatimLookupUrl,
  candidateToConfirmed,
  classifyAddressResultLevel,
  isCityLevelResult,
  osmLookupId,
  parseAddressPlaceRef,
  parseNominatimCandidateResponse,
  parseNominatimLookupResponse,
  parseNominatimOsmId,
  parseNominatimOsmType,
  requireExactCountryCode,
} from "@/lib/geo/addressSearch";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

{
  assert.equal(requireExactCountryCode("RS"), "RS");
  assert.equal(requireExactCountryCode("rs"), null);
  assert.equal(requireExactCountryCode(" RS"), null);
  assert.equal(requireExactCountryCode("RS "), null);
  assert.equal(requireExactCountryCode("serbia"), null);
  assert.equal(requireExactCountryCode(null), null);
}

{
  assert.equal(boundAddressQuery("nis"), "nis");
  assert.equal(boundAddressQuery(""), null);
  assert.equal(boundAddressQuery("a".repeat(201)), null);
  assert.equal(boundLocalityContext("Niš"), "Niš");
  assert.equal(boundLocalityContext("x".repeat(201)), null);
}

{
  assert.equal(parseNominatimOsmType("node"), "node");
  assert.equal(parseNominatimOsmType("N"), "node");
  assert.equal(parseNominatimOsmType("way"), "way");
  assert.equal(parseNominatimOsmType("relation"), "relation");
  assert.equal(parseNominatimOsmType("foo"), null);
  assert.equal(parseNominatimOsmId(12345), "12345");
  assert.equal(parseNominatimOsmId("0"), null);
  assert.equal(osmLookupId("node", "99"), "N99");
  assert.equal(osmLookupId("way", "1"), "W1");
  assert.equal(osmLookupId("relation", "2"), "R2");
}

{
  assert.equal(classifyAddressResultLevel({ type: "city" }), "city");
  assert.equal(classifyAddressResultLevel({ addresstype: "suburb" }), "district");
  assert.equal(classifyAddressResultLevel({ type: "residential" }), "street");
  assert.equal(classifyAddressResultLevel({ class: "amenity" }), "place");
  assert.equal(isCityLevelResult("city"), true);
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
  assert.equal(
    buildNominatimCandidateSearchUrl({ query: "nis", countryCode: "rs" }),
    null,
  );
}

{
  const lookup = buildNominatimLookupUrl([
    { provider: "nominatim", osmType: "node", osmId: "42" },
  ]);
  assert.ok(lookup);
  assert.ok(lookup!.includes("osm_ids=N42"));
  assert.ok(lookup!.includes("/lookup?"));
}

{
  const frNice = [
    {
      osm_type: "node",
      osm_id: 1,
      lat: "43.7102",
      lon: "7.2620",
      name: "Nice",
      display_name: "Nice, France",
      type: "city",
      address: { city: "Nice", country: "France", country_code: "fr" },
    },
  ];
  assert.deepEqual(parseNominatimCandidateResponse(frNice, "RS"), []);

  const missingCc = [
    {
      osm_type: "relation",
      osm_id: 2,
      lat: "43.32",
      lon: "21.89",
      name: "Niš",
      display_name: "Niš",
      type: "city",
      address: { city: "Niš", country: "Serbia" },
    },
  ];
  // Missing country_code must fail closed (no expected-country fill).
  assert.deepEqual(parseNominatimCandidateResponse(missingCc, "RS"), []);

  const rsNis = [
    {
      osm_type: "relation",
      osm_id: 1741449,
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
  ];
  const parsed = parseNominatimCandidateResponse(rsNis, "RS");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].provider, "nominatim");
  assert.equal(parsed[0].osmType, "relation");
  assert.equal(parsed[0].osmId, "1741449");
  assert.equal(parsed[0].primaryLabel, "Niš");
  assert.equal(parsed[0].resultLevel, "city");
  assert.equal(parsed[0].countryCode, "RS");

  const confirmed = candidateToConfirmed(parsed[0], "RS");
  assert.equal(confirmed.osmType, "relation");
  assert.equal(confirmed.osmId, "1741449");
  assert.equal(confirmed.displayName, "Niš, Serbia");
  assert.ok(confirmed.previewLatitude);

  const looked = parseNominatimLookupResponse(rsNis, {
    provider: "nominatim",
    osmType: "relation",
    osmId: "1741449",
  });
  assert.ok(looked);
  assert.equal(looked!.osmId, "1741449");
}

{
  const many = Array.from({ length: 8 }, (_, i) => ({
    osm_type: "node",
    osm_id: i + 10,
    lat: String(44 + i * 0.01),
    lon: "20.4",
    name: `Place ${i}`,
    display_name: `Place ${i}, Serbia`,
    type: "suburb",
    address: { country_code: "rs", country: "Serbia", city: "Belgrade" },
  }));
  assert.equal(
    parseNominatimCandidateResponse(many, "RS").length,
    ADDRESS_SEARCH_LIMIT,
  );
}

{
  assert.deepEqual(
    parseAddressPlaceRef({
      provider: "nominatim",
      osmType: "way",
      osmId: "99",
    }),
    { provider: "nominatim", osmType: "way", osmId: "99" },
  );
  assert.equal(parseAddressPlaceRef({ provider: "google" }), null);
}

{
  const api = read("src/app/api/geocode/search/route.ts");
  assert.ok(api.includes("requireExactCountryCode"));
  assert.ok(api.includes("throttledNominatimGetJson"));
  assert.ok(api.includes("boundAddressQuery"));

  const dist = read("src/app/api/route-distance/route.ts");
  assert.ok(dist.includes("places"));
  assert.ok(dist.includes("lookupNominatimPlaceRefsSequential"));
  assert.ok(dist.includes("body.points"));
  assert.equal(dist.includes("parsePoints"), false);

  const builder = read("src/lib/auth/buildCanonicalStage1PublishContext.ts");
  assert.ok(builder.includes("resolveStage1RouteFromPlaceRefs"));
  assert.ok(builder.includes("origin_geo"));

  const kms = read("src/lib/post-form/useRouteKmsEstimation.ts");
  assert.ok(kms.includes("places"));
  assert.equal(kms.includes("previewLatitude"), false);
  assert.equal(kms.includes("points:"), false);

  const sheet = read("src/components/home/PublishBottomSheet.tsx");
  assert.ok(sheet.includes("small_item_handoff_hint"));

  const client = read("src/lib/geo/nominatimClient.ts");
  assert.ok(client.includes("CACHE_TTL_MS"));
  assert.ok(client.includes("throttledNominatimGetJson"));
}

console.log("addressSearch.test.ts: PASS");
