/**
 * PHASE 6.7C.2C.3B.1 — route-kms coordinate / OSRM / sequential Nominatim (offline).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/route-kms.test.ts
 */

import assert from "node:assert/strict";
import {
  assembleTrustedGeocodePoint,
  buildNominatimSearchUrl,
  computeRouteDistance,
  fetchNominatimCoordinateHitsSequential,
  fetchOrderedRouteKms,
  fetchOrderedRouteKmsFromCoords,
  fetchNominatimSearchHit,
  geocodeAddress,
  isValidLatLon,
  normalizeGeocodeAddress,
  osrmRouteKmsFromCoords,
  parseFiniteCoordinate,
  parseNominatimSearchResponse,
  resolveTrustedOriginWithLookup,
} from "@/lib/route-kms";

async function main() {
  assert.equal(normalizeGeocodeAddress(" a "), "a");
  assert.ok(buildNominatimSearchUrl("Novi Sad").includes("addressdetails=1"));

  // ── Unified coordinate helpers ──────────────────────────────────────────
  assert.equal(parseFiniteCoordinate(""), null);
  assert.equal(parseFiniteCoordinate("   "), null);
  assert.equal(parseFiniteCoordinate("NaN"), null);
  assert.equal(parseFiniteCoordinate("Infinity"), null);
  assert.equal(parseFiniteCoordinate("-Infinity"), null);
  assert.equal(parseFiniteCoordinate("abc"), null);
  assert.equal(parseFiniteCoordinate(NaN), null);
  assert.equal(parseFiniteCoordinate(Infinity), null);
  assert.equal(parseFiniteCoordinate(-Infinity), null);
  assert.equal(parseFiniteCoordinate(44.8), 44.8);
  assert.equal(parseFiniteCoordinate("44.8"), 44.8);
  assert.equal(parseFiniteCoordinate("  -90  "), -90);

  assert.equal(isValidLatLon(90, 180), true);
  assert.equal(isValidLatLon(-90, -180), true);
  assert.equal(isValidLatLon(0, 0), true);
  assert.equal(isValidLatLon(91, 0), false);
  assert.equal(isValidLatLon(-91, 0), false);
  assert.equal(isValidLatLon(0, 181), false);
  assert.equal(isValidLatLon(0, -181), false);
  assert.equal(isValidLatLon(NaN, 0), false);
  assert.equal(isValidLatLon(0, Infinity), false);

  {
    const p = parseNominatimSearchResponse([
      { lat: "", lon: "20.5", address: { country_code: "rs" } },
    ]);
    assert.equal(p.ok, false);
    if (!p.ok) assert.equal(p.errorKey, "error.geocode_invalid_response");
  }
  {
    const p = parseNominatimSearchResponse([
      { lat: "44.8", lon: "", address: { country_code: "rs" } },
    ]);
    assert.equal(p.ok, false);
    if (!p.ok) assert.equal(p.errorKey, "error.geocode_invalid_response");
  }
  {
    const p = parseNominatimSearchResponse([
      { lat: "   ", lon: "20.5", address: { country_code: "rs" } },
    ]);
    assert.equal(p.ok, false);
  }
  {
    const p = parseNominatimSearchResponse([
      { lat: "44.8", lon: "   ", address: { country_code: "rs" } },
    ]);
    assert.equal(p.ok, false);
  }
  {
    const p = parseNominatimSearchResponse([
      { lat: "not-a-number", lon: "20.5", address: { country_code: "rs" } },
    ]);
    assert.equal(p.ok, false);
  }

  for (const [lat, lon] of [
    [90, 180],
    [-90, -180],
    [90, -180],
    [-90, 180],
  ] as const) {
    const p = parseNominatimSearchResponse([
      { lat: String(lat), lon: String(lon), address: { country_code: "rs" } },
    ]);
    assert.equal(p.ok, true, `boundary ${lat},${lon}`);
  }
  for (const [lat, lon] of [
    [90.0001, 0],
    [-90.0001, 0],
    [0, 180.0001],
    [0, -180.0001],
  ] as const) {
    const p = parseNominatimSearchResponse([
      { lat: String(lat), lon: String(lon), address: { country_code: "rs" } },
    ]);
    assert.equal(p.ok, false, `oob ${lat},${lon}`);
  }

  // Coordinate hit without country still succeeds
  {
    const p = parseNominatimSearchResponse([{ lat: "44.8", lon: "20.4" }]);
    assert.equal(p.ok, true);
    if (p.ok) {
      assert.equal(p.value.countryCode, null);
      assert.equal(p.value.lat, 44.8);
      assert.equal(p.value.lon, 20.4);
    }
  }

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

  // Missing country: geocodeAddress succeeds; trusted fails; route can continue
  {
    let called = 0;
    const fetchImpl = (async () => {
      called += 1;
      return {
        ok: true,
        status: 200,
        json: async () => [{ lat: "44.8", lon: "20.5" }],
      } as unknown as Response;
    }) as typeof fetch;

    const geo = await geocodeAddress("Somewhere", { fetchImpl });
    assert.deepEqual(geo, { lat: 44.8, lon: 20.5 });

    const hit = await fetchNominatimSearchHit("Somewhere", { fetchImpl });
    assert.equal(hit.ok, true);
    if (hit.ok) {
      assert.equal(hit.value.countryCode, null);
      const trusted = assembleTrustedGeocodePoint(hit.value, () => [
        "Europe/Belgrade",
      ]);
      assert.equal(trusted.ok, false);
      if (!trusted.ok) {
        assert.equal(trusted.errorKey, "error.geocode_country_unavailable");
      }
    }

    const trustedRes = await resolveTrustedOriginWithLookup("Somewhere", {
      fetchImpl,
      findTimezones: () => ["Europe/Belgrade"],
    });
    assert.equal(trustedRes.ok, false);
    if (!trustedRes.ok) {
      assert.equal(trustedRes.errorKey, "error.geocode_country_unavailable");
    }

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
          } as unknown as Response;
        }) as typeof fetch,
      },
    );
    assert.equal(kms, 5);
    assert.equal(osrmCalls, 1);
    assert.ok(called >= 1);
  }

  // Same HTTP result → authority without second Nominatim
  {
    let nominatimCalls = 0;
    const fetchImpl = (async () => {
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
      } as unknown as Response;
    }) as typeof fetch;
    const hit = await fetchNominatimSearchHit("Belgrade", { fetchImpl });
    assert.equal(nominatimCalls, 1);
    assert.equal(hit.ok, true);
    if (hit.ok) {
      const trusted = assembleTrustedGeocodePoint(hit.value, () => [
        "Europe/Belgrade",
      ]);
      assert.equal(trusted.ok, true);
      assert.equal(nominatimCalls, 1);
    }
  }

  // ── OSRM hardening ──────────────────────────────────────────────────────
  {
    let osrmCalls = 0;
    const fetchImpl = (async () => {
      osrmCalls += 1;
      return {
        ok: true,
        json: async () => ({ routes: [{ distance: 5000 }] }),
      } as unknown as Response;
    }) as typeof fetch;

    assert.equal(
      await osrmRouteKmsFromCoords(
        [
          { lat: 91, lon: 20 },
          { lat: 45, lon: 20 },
        ],
        { fetchImpl },
      ),
      null,
    );
    assert.equal(osrmCalls, 0);

    assert.equal(
      await osrmRouteKmsFromCoords(
        [
          { lat: 44, lon: 181 },
          { lat: 45, lon: 20 },
        ],
        { fetchImpl },
      ),
      null,
    );
    assert.equal(osrmCalls, 0);

    assert.equal(
      await osrmRouteKmsFromCoords(
        [
          { lat: 44.8, lon: 20.5 },
          { lat: 45.0, lon: 20.7 },
        ],
        {
          fetchImpl: (async () =>
            ({
              ok: true,
              json: async () => ({ routes: [{ distance: -1 }] }),
            }) as unknown as Response) as typeof fetch,
        },
      ),
      null,
    );

    assert.equal(
      await osrmRouteKmsFromCoords(
        [
          { lat: 44.8, lon: 20.5 },
          { lat: 45.0, lon: 20.7 },
        ],
        {
          fetchImpl: (async () =>
            ({
              ok: true,
              json: async () => ({ routes: [{ distance: "5000" }] }),
            }) as unknown as Response) as typeof fetch,
        },
      ),
      null,
    );

    assert.equal(
      await osrmRouteKmsFromCoords(
        [
          { lat: 44.8, lon: 20.5 },
          { lat: 45.0, lon: 20.7 },
        ],
        {
          fetchImpl: (async () =>
            ({
              ok: true,
              json: async () => ({ routes: [] }),
            }) as unknown as Response) as typeof fetch,
        },
      ),
      null,
    );

    assert.equal(
      await osrmRouteKmsFromCoords(
        [
          { lat: 44.8, lon: 20.5 },
          { lat: 45.0, lon: 20.7 },
        ],
        {
          fetchImpl: (async () =>
            ({
              ok: true,
              json: async () => {
                throw new SyntaxError("bad");
              },
            }) as unknown as Response) as typeof fetch,
        },
      ),
      null,
    );

    assert.equal(
      await osrmRouteKmsFromCoords(
        [
          { lat: 44.8, lon: 20.5 },
          { lat: 45.0, lon: 20.7 },
        ],
        {
          fetchImpl: (async () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            throw err;
          }) as typeof fetch,
        },
      ),
      null,
    );

    const okKms = await osrmRouteKmsFromCoords(
      [
        { lat: 44.8, lon: 20.5 },
        { lat: 45.0, lon: 20.7 },
      ],
      {
        fetchImpl: (async () =>
          ({
            ok: true,
            json: async () => ({ routes: [{ distance: 5000 }] }),
          }) as unknown as Response) as typeof fetch,
      },
    );
    assert.equal(okKms, 5);
  }

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
        }) as unknown as Response) as typeof fetch,
    },
  );
  assert.equal(kms2, 8);

  // ── Sequential Nominatim: order, dedupe, injectable delay ───────────────
  {
    const callOrder: string[] = [];
    const delays: number[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const q = new URL(url).searchParams.get("q") ?? "";
      callOrder.push(q);
      const lat = q.includes("B") ? "45.0" : "44.8";
      const lon = q.includes("B") ? "20.7" : "20.5";
      return {
        ok: true,
        status: 200,
        json: async () => [{ lat, lon, address: { country_code: "rs" } }],
      } as unknown as Response;
    }) as typeof fetch;

    const batch = await fetchNominatimCoordinateHitsSequential(
      ["  CityA  ", "CityB", "CityA"],
      {
        fetchImpl,
        minIntervalMs: 1000,
        delayMs: async (ms) => {
          delays.push(ms);
        },
      },
    );
    assert.equal(batch.ok, true);
    if (batch.ok) {
      assert.equal(batch.hits.length, 3);
      assert.equal(batch.hits[0]!.lat, 44.8);
      assert.equal(batch.hits[1]!.lat, 45.0);
      assert.equal(batch.hits[2]!.lat, 44.8);
      assert.deepEqual(callOrder, ["CityA", "CityB"]);
      assert.deepEqual(delays, [1000]);
    }
  }

  {
    let concurrent = 0;
    let maxConcurrent = 0;
    const fetchImpl = (async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await Promise.resolve();
      concurrent -= 1;
      return {
        ok: true,
        status: 200,
        json: async () => [
          { lat: "44.8", lon: "20.5", address: { country_code: "rs" } },
        ],
      } as unknown as Response;
    }) as typeof fetch;

    const seq = await fetchNominatimCoordinateHitsSequential(["X", "Y", "Z"], {
      fetchImpl,
      minIntervalMs: 50,
      delayMs: async () => {},
    });
    assert.equal(seq.ok, true);
    assert.equal(maxConcurrent, 1);

    const routeFetch = (async (input: RequestInfo | URL) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await Promise.resolve();
      concurrent -= 1;
      const url = String(input);
      if (url.includes("nominatim")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { lat: "44.8", lon: "20.5", address: { country_code: "rs" } },
          ],
        } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({ routes: [{ distance: 3000 }] }),
      } as unknown as Response;
    }) as typeof fetch;

    const kms = await fetchOrderedRouteKms(["A", "B", "C"], {
      fetchImpl: routeFetch,
      minIntervalMs: 0,
      delayMs: async () => {},
    });
    assert.equal(kms, 3);
    assert.equal(maxConcurrent, 1);
  }

  {
    // Route distance with missing country still works (coords only)
    let n = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("nominatim")) {
        n += 1;
        return {
          ok: true,
          status: 200,
          json: async () => [{ lat: String(44 + n * 0.1), lon: "20.5" }],
        } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({ routes: [{ distance: 9000 }] }),
      } as unknown as Response;
    }) as typeof fetch;

    const dist = await computeRouteDistance(["A", "B"], undefined, undefined, {
      fetchImpl,
      delayMs: async () => {},
      minIntervalMs: 0,
    });
    assert.equal(dist.ok, true);
    if (dist.ok) assert.equal(dist.totalKms, 9);
  }

  console.log("route-kms.test.ts: ok");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
