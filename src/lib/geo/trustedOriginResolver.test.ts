/**
 * PHASE 6.7C.2C.3B — trusted origin resolver + Nominatim parse (offline).
 * Tests pure assembly via route-kms; statically verifies server-only wrapper.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/geo/trustedOriginResolver.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOMINATIM_GEOCODE_TIMEOUT_MS,
  assembleTrustedGeocodePoint,
  assertValidIanaTimezone,
  buildNominatimSearchUrl,
  fetchNominatimSearchHit,
  geocodeAddress,
  normalizeGeocodeAddress,
  osrmRouteKmsFromCoords,
  parseNominatimSearchResponse,
  resolveTimezoneFromCoords,
  resolveTrustedOriginWithLookup,
  toGeographyPointWkt,
} from "@/lib/route-kms";
import { assertNoBrowserNightAuthorityFields } from "@/lib/safety/serviceSubtypePublish";
import { toRpcStage1Payload } from "@/lib/auth/canonicalStage1Core";
import type { CanonicalStage1Payload } from "@/lib/auth/canonicalStage1";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function rsNominatimBody(overrides: Record<string, unknown> = {}) {
  return [
    {
      lat: "44.8178131",
      lon: "20.4568974",
      address: { country_code: "rs", city: "Belgrade" },
      ...overrides,
    },
  ];
}

function mockFetchJson(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response) as typeof fetch;
}

function mockFetchAbort(): typeof fetch {
  return (async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }) as typeof fetch;
}

async function main() {
  assert.equal(normalizeGeocodeAddress("  Belgrade  "), "Belgrade");
  assert.equal(normalizeGeocodeAddress(""), null);
  assert.equal(normalizeGeocodeAddress("   "), null);
  assert.equal(
    normalizeGeocodeAddress("\u0041\u030A"),
    "\u00C5".normalize("NFC"),
  );
  assert.ok(NOMINATIM_GEOCODE_TIMEOUT_MS === 8000);

  const url = buildNominatimSearchUrl("Belgrade");
  assert.ok(url.includes("format=jsonv2"));
  assert.ok(url.includes("limit=1"));
  assert.ok(url.includes("addressdetails=1"));
  assert.ok(!url.includes("format=json&"));

  {
    const parsed = parseNominatimSearchResponse(rsNominatimBody());
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.countryCode, "RS");
      assert.ok(parsed.value.lat > 44 && parsed.value.lat < 45);
      const trusted = assembleTrustedGeocodePoint(parsed.value, () => [
        "Europe/Belgrade",
      ]);
      assert.equal(trusted.ok, true);
      if (trusted.ok) {
        assert.equal(trusted.value.countryCode, "RS");
        assert.equal(trusted.value.timezone, "Europe/Belgrade");
        assert.equal(
          trusted.value.wkt,
          toGeographyPointWkt(trusted.value.lat, trusted.value.lon),
        );
      }
    }
  }

  {
    const res = await resolveTrustedOriginWithLookup("Belgrade, Serbia", {
      fetchImpl: mockFetchJson(200, rsNominatimBody()),
      findTimezones: () => ["Europe/Belgrade"],
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.value.countryCode, "RS");
      assert.equal(res.value.timezone, "Europe/Belgrade");
    }
  }

  {
    const res = await resolveTrustedOriginWithLookup("  ", {
      fetchImpl: mockFetchJson(200, rsNominatimBody()),
      findTimezones: () => ["Europe/Belgrade"],
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.geocode_failed");
  }

  {
    const res = await resolveTrustedOriginWithLookup("x", {
      fetchImpl: mockFetchJson(500, rsNominatimBody()),
      findTimezones: () => ["Europe/Belgrade"],
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.geocode_failed");
  }

  {
    const res = await resolveTrustedOriginWithLookup("x", {
      fetchImpl: mockFetchAbort(),
      findTimezones: () => ["Europe/Belgrade"],
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.geocode_timeout");
  }

  assert.equal(parseNominatimSearchResponse({}).ok, false);
  assert.equal(parseNominatimSearchResponse(null).ok, false);
  assert.equal(parseNominatimSearchResponse("nope").ok, false);

  {
    const p = parseNominatimSearchResponse([]);
    assert.equal(p.ok, false);
    if (!p.ok) assert.equal(p.errorKey, "error.geocode_failed");
  }

  {
    const p = parseNominatimSearchResponse([
      { address: { country_code: "rs" } },
    ]);
    assert.equal(p.ok, false);
    if (!p.ok) assert.equal(p.errorKey, "error.geocode_invalid_response");
  }

  for (const bad of [
    [{ lat: "NaN", lon: "20", address: { country_code: "rs" } }],
    [{ lat: "44", lon: "Infinity", address: { country_code: "rs" } }],
    [{ lat: "91", lon: "20", address: { country_code: "rs" } }],
    [{ lat: "44", lon: "181", address: { country_code: "rs" } }],
  ]) {
    const p = parseNominatimSearchResponse(bad);
    assert.equal(p.ok, false, JSON.stringify(bad));
    if (!p.ok) assert.equal(p.errorKey, "error.geocode_invalid_response");
  }

  {
    const p = parseNominatimSearchResponse([{ lat: "44.8", lon: "20.4" }]);
    assert.equal(p.ok, false);
    if (!p.ok) assert.equal(p.errorKey, "error.geocode_country_unavailable");
  }

  for (const cc of [undefined, "", "   ", "SRB", "12", "r"]) {
    const body =
      cc === undefined
        ? [{ lat: "44.8", lon: "20.4", address: {} }]
        : [{ lat: "44.8", lon: "20.4", address: { country_code: cc } }];
    const p = parseNominatimSearchResponse(body);
    assert.equal(p.ok, false, `cc=${String(cc)}`);
    if (!p.ok) assert.equal(p.errorKey, "error.geocode_country_unavailable");
  }

  {
    const p = parseNominatimSearchResponse(rsNominatimBody());
    assert.equal(p.ok, true);
    if (p.ok) assert.equal(p.value.countryCode, "RS");
  }

  assert.equal(resolveTimezoneFromCoords(44.8, 20.5, () => []).ok, false);

  {
    const r = resolveTimezoneFromCoords(44.8, 20.5, () => [
      "Europe/Belgrade",
      "Europe/Belgrade",
    ]);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.timezone, "Europe/Belgrade");
  }

  assert.equal(
    resolveTimezoneFromCoords(0, 0, () => [
      "Europe/Belgrade",
      "Europe/Paris",
    ]).ok,
    false,
  );

  assert.equal(assertValidIanaTimezone(""), false);
  assert.equal(assertValidIanaTimezone("Not/A_Real_Zone"), false);
  assert.equal(assertValidIanaTimezone("Europe/Belgrade"), true);
  assert.equal(
    resolveTimezoneFromCoords(1, 1, () => ["Not/A_Real_Zone"]).ok,
    false,
  );

  {
    let fetchCount = 0;
    const fetchImpl = (async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => rsNominatimBody(),
      } as unknown as Response;
    }) as typeof fetch;
    const hit = await fetchNominatimSearchHit("Belgrade", { fetchImpl });
    assert.equal(fetchCount, 1);
    assert.equal(hit.ok, true);
    if (hit.ok) {
      const trusted = assembleTrustedGeocodePoint(hit.value, () => [
        "Europe/Belgrade",
      ]);
      assert.equal(trusted.ok, true);
      if (trusted.ok) {
        assert.equal(trusted.value.countryCode, "RS");
        assert.equal(trusted.value.timezone, "Europe/Belgrade");
        assert.ok(trusted.value.wkt.startsWith("SRID=4326;POINT("));
      }
      let osrmFetches = 0;
      const kms = await osrmRouteKmsFromCoords(
        [
          { lat: hit.value.lat, lon: hit.value.lon },
          { lat: hit.value.lat + 0.1, lon: hit.value.lon + 0.1 },
        ],
        {
          fetchImpl: (async () => {
            osrmFetches += 1;
            return {
              ok: true,
              json: async () => ({ routes: [{ distance: 12000 }] }),
            } as unknown as Response;
          }) as typeof fetch,
        },
      );
      assert.equal(kms, 12);
      assert.equal(osrmFetches, 1);
      assert.equal(fetchCount, 1);
    }
  }

  assert.equal(await geocodeAddress(""), null);
  assert.equal(await geocodeAddress("   "), null);

  {
    const clientFiles: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) clientFiles.push(full);
      }
    }
    walk(join(repoRoot, "src"));
    for (const file of clientFiles) {
      if (file.includes(".test.")) continue;
      const src = readFileSync(file, "utf8");
      const firstLines = src.slice(0, 400);
      if (
        !firstLines.includes('"use client"') &&
        !firstLines.includes("'use client'")
      ) {
        continue;
      }
      assert.equal(
        src.includes("trustedOriginResolver"),
        false,
        `client import trustedOriginResolver: ${file}`,
      );
      assert.equal(
        src.includes('from "geo-tz"') || src.includes("from 'geo-tz'"),
        false,
        `client import geo-tz: ${file}`,
      );
    }
    const resolverSrc = read("src/lib/geo/trustedOriginResolver.ts");
    assert.ok(resolverSrc.includes('import "server-only"'));
    assert.ok(resolverSrc.includes('from "geo-tz"'));
    assert.ok(resolverSrc.includes("resolveTrustedOrigin"));
    assert.ok(resolverSrc.includes("geoTzFind"));
    assert.ok(resolverSrc.includes("resolveTrustedOriginWithLookup"));
    const routeKmsSrc = read("src/lib/route-kms.ts");
    assert.equal(
      /from\s+["']geo-tz["']/.test(routeKmsSrc),
      false,
    );
    assert.equal(
      /import\s+["']server-only["']/.test(routeKmsSrc),
      false,
    );
    assert.equal(
      /from\s+["']@\/lib\/geo\/trustedOriginResolver["']/.test(routeKmsSrc),
      false,
    );
  }

  {
    const sample: CanonicalStage1Payload = {
      post_type: "demand",
      category: "travel",
      title: "t",
      origin_address: "a",
      destination_address: "b",
      departure_date: "2026-09-16",
      departure_time: "14:00",
      departure_time_window: "14:00-14:15",
      time_buffer: 0,
      waypoints: [],
      share_mode: "share",
      delivery_mode: null,
      count_small: 0,
      count_medium: 0,
      count_large: 0,
      count_xlarge: 0,
      escort_seats: 0,
      max_companions: 1,
      bump_fee_minor: 0,
      currency: "EUR",
      locale: "en",
      transport_mode: "car",
      service_subtype: "passenger",
    };
    const rpc = toRpcStage1Payload(sample, 100);
    assert.equal("origin_country_code" in rpc, false);
    assert.equal("origin_timezone" in rpc, false);
    assert.equal("night_policy_version" in rpc, false);
  }

  assert.doesNotThrow(() =>
    assertNoBrowserNightAuthorityFields({ category: "travel" }),
  );
  assert.throws(
    () =>
      assertNoBrowserNightAuthorityFields({
        origin_country_code: "RS",
      }),
    (e: unknown) =>
      e instanceof Error &&
      e.message === "error.browser_night_authority_rejected",
  );

  {
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("bad json");
        },
      }) as unknown as Response) as typeof fetch;
    const hit = await fetchNominatimSearchHit("x", { fetchImpl });
    assert.equal(hit.ok, false);
    if (!hit.ok) assert.equal(hit.errorKey, "error.geocode_invalid_response");
  }

  console.log("trustedOriginResolver.test.ts: ok");
}

void main();
