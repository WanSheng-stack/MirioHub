/**
 * PHASE 6.7C.2C.3B — route-kms Nominatim/OSRM helpers (offline).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/route-kms.test.ts
 */

import assert from "node:assert/strict";
import {
  buildNominatimSearchUrl,
  fetchOrderedRouteKmsFromCoords,
  fetchNominatimSearchHit,
  geocodeAddress,
  normalizeGeocodeAddress,
  osrmRouteKmsFromCoords,
  parseNominatimSearchResponse,
} from "@/lib/route-kms";

async function main() {
  assert.equal(normalizeGeocodeAddress(" a "), "a");
  assert.ok(buildNominatimSearchUrl("Novi Sad").includes("addressdetails=1"));

  {
    const p = parseNominatimSearchResponse([
      {
        lat: 44.8,
        lon: 20.5,
        address: { country_code: "rs" },
      },
    ]);
    assert.equal(p.ok, true);
    if (p.ok) assert.equal(p.value.countryCode, "RS");
  }

  assert.equal(await geocodeAddress(""), null);

  let nominatimCalls = 0;
  const hit = await fetchNominatimSearchHit("Belgrade", {
    fetchImpl: (async () => {
      nominatimCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            lat: "44.8",
            lon: "20.5",
            address: { country_code: "rs" },
          },
        ],
      } as Response;
    }) as typeof fetch,
  });
  assert.equal(nominatimCalls, 1);
  assert.equal(hit.ok, true);

  let osrmCalls = 0;
  const kms = await osrmRouteKmsFromCoords(
    [
      { lat: 44.8, lon: 20.5 },
      { lat: 45.0, lon: 20.7 },
    ],
    {
      fetchImpl: (async () => {
        osrmCalls += 1;
        return {
          ok: true,
          json: async () => ({ routes: [{ distance: 5000 }] }),
        } as Response;
      }) as typeof fetch,
    },
  );
  assert.equal(kms, 5);
  assert.equal(osrmCalls, 1);
  assert.equal(nominatimCalls, 1);

  const kms2 = await fetchOrderedRouteKmsFromCoords(
    [
      { lat: 44.8, lon: 20.5 },
      { lat: 45.0, lon: 20.7 },
    ],
    {
      fetchImpl: (async () =>
        ({
          ok: true,
          json: async () => ({ routes: [{ distance: 8000 }] }),
        }) as Response) as typeof fetch,
    },
  );
  assert.equal(kms2, 8);
  assert.equal(nominatimCalls, 1);

  console.log("route-kms.test.ts: ok");
}

void main();
