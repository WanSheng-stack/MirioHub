/**
 * PHASE 6.7C.2C.3J-A.3 — precise-place refinement, map-link import, timezone.
 * All network mocked. Run:
 *   npx tsx --tsconfig tsconfig.json src/lib/geo/precisePlaceMapLink.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { find as geoTzFind } from "geo-tz";
import {
  buildNominatimReverseUrl,
  parseNominatimReverseResponse,
  type AddressSearchCandidate,
  type ConfirmedAddressGeo,
} from "@/lib/geo/addressSearch";
import {
  initialAddressFieldMachine,
  reduceAddressFieldMachine,
} from "@/lib/geo/addressRefinementState";
import {
  extractCoordinatesFromGoogleMapsUrl,
  isAllowedGoogleMapsHostname,
  parseHttpsGoogleMapsUrl,
} from "@/lib/geo/googleMapsLink";
import {
  importPlaceFromGoogleMapsLink,
  resetMapLinkRedirectCacheForTests,
  resolveGoogleMapsShareRedirects,
} from "@/lib/geo/googleMapsLinkImport";
import { resetNominatimClientStateForTests } from "@/lib/geo/nominatimClient";
import { nextTransportModeForSubtypeSwitch } from "@/lib/auth/publishTransportMode";
import {
  assembleTrustedGeocodePoint,
  resolveTimezoneFromCoords,
} from "@/lib/route-kms";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function cityConfirmed(overrides: Partial<ConfirmedAddressGeo> = {}): ConfirmedAddressGeo {
  return {
    provider: "nominatim",
    osmType: "relation",
    osmId: "1",
    countryCode: "RS",
    displayName: "Sombor, Serbia",
    primaryLabel: "Sombor",
    localityLabel: "Sombor",
    resultLevel: "city",
    searchCountryCode: "RS",
    localityContext: "Sombor",
    previewLatitude: 45.7742,
    previewLongitude: 19.111,
    ...overrides,
  };
}

function streetCandidate(
  overrides: Partial<AddressSearchCandidate> = {},
): AddressSearchCandidate {
  return {
    provider: "nominatim",
    osmType: "way",
    osmId: "42",
    countryCode: "RS",
    displayName: "Ulica Cara Lazara, Sombor, Serbia",
    primaryLabel: "Ulica Cara Lazara",
    localityLabel: "Sombor",
    countryName: "Serbia",
    typeLabel: "residential",
    resultLevel: "street",
    latitude: 45.7745,
    longitude: 19.112,
    ...overrides,
  };
}

// ── Map link URL allowlist ──────────────────────────────────────────────────
{
  assert.equal(isAllowedGoogleMapsHostname("www.google.com"), true);
  assert.equal(isAllowedGoogleMapsHostname("google.com"), true);
  assert.equal(isAllowedGoogleMapsHostname("maps.google.com"), true);
  assert.equal(isAllowedGoogleMapsHostname("maps.app.goo.gl"), true);
  assert.equal(isAllowedGoogleMapsHostname("goo.gl"), true);
  assert.equal(isAllowedGoogleMapsHostname("www.google.rs"), true);
  assert.equal(isAllowedGoogleMapsHostname("google.de"), true);
  assert.equal(isAllowedGoogleMapsHostname("evil.com"), false);
  assert.equal(isAllowedGoogleMapsHostname("localhost"), false);
  assert.equal(isAllowedGoogleMapsHostname("127.0.0.1"), false);
  assert.equal(isAllowedGoogleMapsHostname("192.168.1.1"), false);
  assert.equal(isAllowedGoogleMapsHostname("10.0.0.1"), false);
  assert.equal(isAllowedGoogleMapsHostname("169.254.1.1"), false);
  assert.equal(isAllowedGoogleMapsHostname("[::1]"), false);

  assert.equal(
    parseHttpsGoogleMapsUrl("https://www.google.com/maps/@45.1,19.2,15z").ok,
    true,
  );
  assert.equal(parseHttpsGoogleMapsUrl("http://www.google.com/maps").ok, false);
  assert.equal(
    parseHttpsGoogleMapsUrl("https://user:pass@www.google.com/maps").ok,
    false,
  );
  assert.equal(
    parseHttpsGoogleMapsUrl("https://evil.com/maps").ok,
    false,
  );
  {
    const r = parseHttpsGoogleMapsUrl("https://evil.com/maps");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.errorKey, "error.map_link_host_not_allowed");
  }
  {
    const r = parseHttpsGoogleMapsUrl("https://goo.gl/notmaps");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.errorKey, "error.map_link_host_not_allowed");
  }
  assert.equal(
    parseHttpsGoogleMapsUrl("https://goo.gl/maps/abc").ok,
    true,
  );
  assert.equal(parseHttpsGoogleMapsUrl("javascript:alert(1)").ok, false);
  assert.equal(parseHttpsGoogleMapsUrl("data:text/html,hi").ok, false);
  assert.equal(parseHttpsGoogleMapsUrl("file:///etc/passwd").ok, false);
}

// ── Coordinate parser + conflicting coords ──────────────────────────────────
{
  const at = extractCoordinatesFromGoogleMapsUrl(
    new URL("https://www.google.com/maps/@45.77417,19.11222,17z"),
  );
  assert.equal(at.ok, true);
  if (at.ok) {
    assert.equal(at.coord.lat, 45.77417);
    assert.equal(at.coord.lon, 19.11222);
  }

  const bang = extractCoordinatesFromGoogleMapsUrl(
    new URL(
      "https://www.google.com/maps/place/Foo/@45.1,19.2,17z/data=!3d45.1!4d19.2",
    ),
  );
  assert.equal(bang.ok, true);

  const q = extractCoordinatesFromGoogleMapsUrl(
    new URL("https://www.google.com/maps?q=45.5,19.5"),
  );
  assert.equal(q.ok, true);
  if (q.ok) {
    assert.equal(q.coord.lat, 45.5);
    assert.equal(q.coord.lon, 19.5);
  }

  const query = extractCoordinatesFromGoogleMapsUrl(
    new URL("https://www.google.com/maps?query=44.8,20.5"),
  );
  assert.equal(query.ok, true);

  const none = extractCoordinatesFromGoogleMapsUrl(
    new URL("https://www.google.com/maps/place/Sombor"),
  );
  assert.equal(none.ok, false);
  if (!none.ok) {
    assert.equal(none.errorKey, "error.map_link_coordinates_unavailable");
  }

  const conflict = extractCoordinatesFromGoogleMapsUrl(
    new URL(
      "https://www.google.com/maps/@45.0,19.0,17z/data=!3d46.0!4d20.0",
    ),
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) {
    assert.equal(conflict.errorKey, "error.map_link_coordinates_ambiguous");
  }

  const badLat = extractCoordinatesFromGoogleMapsUrl(
    new URL("https://www.google.com/maps/@99.0,19.0,17z"),
  );
  assert.equal(badLat.ok, false);
}

// ── Redirect revalidation + reverse import (mocked fetch) ───────────────────
async function runNetworkedMapLinkTests(): Promise<void> {
  resetMapLinkRedirectCacheForTests();
  const start = new URL("https://maps.app.goo.gl/abc");
  const hops: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const href = typeof input === "string" ? input : input.toString();
    hops.push(href);
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.cache, "no-store");
    if (href.includes("maps.app.goo.gl")) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.internal/steal" },
      });
    }
    return new Response("ok", { status: 200 });
  };
  const bad = await resolveGoogleMapsShareRedirects(start, {
    fetchImpl,
    skipRedirectCache: true,
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.errorKey, "error.map_link_redirect_invalid");
  }

  resetMapLinkRedirectCacheForTests();
  const goodFetch: typeof fetch = async (input, init) => {
    const href = typeof input === "string" ? input : input.toString();
    assert.equal(init?.redirect, "manual");
    if (href.includes("maps.app.goo.gl")) {
      return new Response(null, {
        status: 302,
        headers: {
          location:
            "https://www.google.com/maps/@45.77417,19.11222,17z",
        },
      });
    }
    return new Response("ignored-html-body", { status: 200 });
  };
  const good = await resolveGoogleMapsShareRedirects(start, {
    fetchImpl: goodFetch,
    skipRedirectCache: true,
  });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.ok(good.finalUrl.href.includes("@45.77417,19.11222"));
  }

  // Too many redirects
  resetMapLinkRedirectCacheForTests();
  let n = 0;
  const loopFetch: typeof fetch = async () => {
    n += 1;
    return new Response(null, {
      status: 302,
      headers: {
        location: `https://www.google.com/maps/hop${n}`,
      },
    });
  };
  const tooMany = await resolveGoogleMapsShareRedirects(start, {
    fetchImpl: loopFetch,
    skipRedirectCache: true,
  });
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) {
    assert.equal(tooMany.errorKey, "error.map_link_redirect_invalid");
  }

  resetNominatimClientStateForTests();
  resetMapLinkRedirectCacheForTests();

  const reverseOk = {
    osm_type: "way",
    osm_id: 99,
    lat: "45.7745",
    lon: "19.112",
    display_name: "Ulica Cara Lazara, Sombor, Serbia",
    name: "Ulica Cara Lazara",
    addresstype: "road",
    address: {
      road: "Ulica Cara Lazara",
      city: "Sombor",
      country: "Serbia",
      country_code: "rs",
    },
  };

  const fetchOk: typeof fetch = async (input) => {
    const href = String(input);
    if (href.includes("maps.app.goo.gl")) {
      return new Response(null, {
        status: 302,
        headers: {
          location: "https://www.google.com/maps/@45.7745,19.112,17z",
        },
      });
    }
    if (href.includes("nominatim.openstreetmap.org/reverse")) {
      return new Response(JSON.stringify(reverseOk), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("ok", { status: 200 });
  };

  const imported = await importPlaceFromGoogleMapsLink(
    "https://maps.app.goo.gl/xyz",
    "RS",
    { fetchImpl: fetchOk, skipRedirectCache: true },
  );
  assert.equal(imported.ok, true);
  if (imported.ok) {
    assert.equal(imported.candidate.provider, "nominatim");
    assert.equal(imported.candidate.osmType, "way");
    assert.equal(imported.candidate.osmId, "99");
    assert.equal(imported.candidate.countryCode, "RS");
    assert.equal(imported.source, "google_maps_share_link");
  }

  resetNominatimClientStateForTests();
  resetMapLinkRedirectCacheForTests();
  const mismatchFetch: typeof fetch = async (input) => {
    const href = String(input);
    if (href.includes("maps.app.goo.gl")) {
      return new Response(null, {
        status: 302,
        headers: {
          location: "https://www.google.com/maps/@48.85,2.35,17z",
        },
      });
    }
    if (href.includes("/reverse")) {
      return new Response(
        JSON.stringify({
          ...reverseOk,
          lat: "48.85",
          lon: "2.35",
          address: {
            ...reverseOk.address,
            country: "France",
            country_code: "fr",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("ok", { status: 200 });
  };
  const mismatch = await importPlaceFromGoogleMapsLink(
    "https://maps.app.goo.gl/fr",
    "RS",
    { fetchImpl: mismatchFetch, skipRedirectCache: true },
  );
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.equal(mismatch.errorKey, "error.map_link_country_mismatch");
  }

  const parsed = parseNominatimReverseResponse(reverseOk, "RS");
  assert.ok(parsed);
  assert.equal(parsed!.provider, "nominatim");
  assert.equal(parsed!.osmType, "way");
  assert.equal(parsed!.osmId, "99");
  assert.equal(parsed!.countryCode, "RS");

  assert.equal(parseNominatimReverseResponse(reverseOk, "FR"), null);
  assert.ok(buildNominatimReverseUrl(45.1, 19.2)?.includes("reverse"));
  assert.equal(buildNominatimReverseUrl(99, 19), null);
}

// ── Refinement state reducer ────────────────────────────────────────────────
{
  const city = cityConfirmed();
  let s = initialAddressFieldMachine(city);
  assert.equal(s.mode, "city_search");
  assert.equal(s.cityAnchor?.primaryLabel, "Sombor");

  s = reduceAddressFieldMachine(s, { type: "ENTER_REFINE" });
  assert.equal(s.mode, "refine");
  assert.equal(s.refineTab, "search");
  assert.equal(s.cityAnchor?.osmId, "1");

  s = reduceAddressFieldMachine(s, { type: "SET_TAB", tab: "map_link" });
  assert.equal(s.refineTab, "map_link");

  const cand = streetCandidate();
  s = reduceAddressFieldMachine(s, { type: "SET_PENDING_MAP", candidate: cand });
  assert.ok(s.pendingMapImport);

  s = reduceAddressFieldMachine(s, {
    type: "CONFIRM_PRECISE",
    place: {
      ...cand,
      searchCountryCode: "RS",
      localityContext: "Sombor",
      previewLatitude: cand.latitude,
      previewLongitude: cand.longitude,
    },
  });
  assert.equal(s.mode, "city_search");
  assert.equal(s.pendingMapImport, null);
  assert.equal(s.cityAnchor?.primaryLabel, "Sombor");

  s = reduceAddressFieldMachine(s, { type: "ENTER_REFINE" });
  s = reduceAddressFieldMachine(s, { type: "USE_WHOLE_CITY" });
  assert.equal(s.mode, "city_search");
  assert.equal(s.cityAnchor?.resultLevel, "city");
  assert.equal(s.pendingMapImport, null);

  s = reduceAddressFieldMachine(s, { type: "ENTER_REFINE" });
  s = reduceAddressFieldMachine(s, { type: "BACK_TO_CITY_SEARCH" });
  assert.equal(s.mode, "city_search");
  assert.equal(s.cityAnchor, null);
}

// ── UI: edit invalidates; use whole city; back; results count ───────────────
{
  const field = read("src/components/home/AddressSearchField.tsx");
  assert.ok(field.includes("ENTER_REFINE"));
  assert.ok(field.includes("USE_WHOLE_CITY"));
  assert.ok(field.includes("BACK_TO_CITY_SEARCH"));
  assert.ok(field.includes("useWholeCity"));
  assert.ok(field.includes("backToCitySearch"));
  assert.ok(field.includes("onQueryChange"));
  assert.ok(field.includes("clearConfirmation"));
  assert.ok(field.includes("results_showing"));
  assert.ok(field.includes("results_all_shown"));
  assert.ok(field.includes("refine_title"));
  assert.ok(field.includes("map_link_import"));
  assert.ok(field.includes("/api/geocode/map-link"));
  assert.ok(field.includes("localityContext"));
  assert.ok(field.includes("confirmPendingMap"));
  // Show more still local-only
  const showMoreBody = field.slice(
    field.indexOf("function showMoreCandidates"),
    field.indexOf("function selectCandidate"),
  );
  assert.equal(showMoreBody.includes("fetch("), false);

  const cfg = read("next.config.ts");
  assert.ok(cfg.includes('serverExternalPackages: ["geo-tz"]'));
}

// ── Transport subtype switch truth table ────────────────────────────────────
{
  assert.equal(
    nextTransportModeForSubtypeSwitch({
      category: "travel",
      previousSubtype: null,
      nextSubtype: "passenger",
      previousTransportMode: "",
    }),
    "car",
  );
  assert.equal(
    nextTransportModeForSubtypeSwitch({
      category: "travel",
      previousSubtype: "passenger",
      nextSubtype: "passenger_with_small_item",
      previousTransportMode: "car",
    }),
    "car",
  );
  assert.equal(
    nextTransportModeForSubtypeSwitch({
      category: "travel",
      previousSubtype: "passenger",
      nextSubtype: "small_item_only",
      previousTransportMode: "car",
    }),
    "",
  );
  assert.equal(
    nextTransportModeForSubtypeSwitch({
      category: "travel",
      previousSubtype: "passenger_with_small_item",
      nextSubtype: "small_item_only",
      previousTransportMode: "car",
    }),
    "",
  );
  assert.equal(
    nextTransportModeForSubtypeSwitch({
      category: "travel",
      previousSubtype: "small_item_only",
      nextSubtype: "small_item_only",
      previousTransportMode: "bicycle",
    }),
    "bicycle",
  );
  assert.equal(
    nextTransportModeForSubtypeSwitch({
      category: "travel",
      previousSubtype: "small_item_only",
      nextSubtype: "passenger",
      previousTransportMode: "bicycle",
    }),
    "car",
  );
}

// ── geo-tz smoke: Sombor / Niš / Belgrade / Bačka Topola ─────────────────────
{
  const points = [
    { name: "Sombor", lat: 45.77417, lon: 19.11222 },
    { name: "Niš", lat: 43.3209, lon: 21.8958 },
    { name: "Belgrade", lat: 44.8178131, lon: 20.4568974 },
    { name: "Bačka Topola", lat: 45.8152, lon: 19.6318 },
  ];
  for (const p of points) {
    const raw = geoTzFind(p.lat, p.lon);
    const unique = [...new Set(raw.map((z) => String(z).trim()).filter(Boolean))];
    assert.equal(
      unique.length,
      1,
      `${p.name} zones=${unique.join(",")}`,
    );
    assert.equal(unique[0], "Europe/Belgrade", p.name);
    const resolved = resolveTimezoneFromCoords(p.lat, p.lon, geoTzFind);
    assert.equal(resolved.ok, true, p.name);
    if (resolved.ok) {
      assert.equal(resolved.timezone, "Europe/Belgrade");
    }
    const assembled = assembleTrustedGeocodePoint(
      { lat: p.lat, lon: p.lon, countryCode: "RS" },
      geoTzFind,
    );
    assert.equal(assembled.ok, true, p.name);
    if (assembled.ok) {
      assert.equal(assembled.value.timezone, "Europe/Belgrade");
    }
  }

  // Duplicate identical zones accepted
  const dup = resolveTimezoneFromCoords(45.77, 19.11, () => [
    "Europe/Belgrade",
    "Europe/Belgrade",
  ]);
  assert.equal(dup.ok, true);

  // Distinct zones fail closed
  const amb = resolveTimezoneFromCoords(45.77, 19.11, () => [
    "Europe/Belgrade",
    "Europe/Budapest",
  ]);
  assert.equal(amb.ok, false);
  if (!amb.ok) assert.equal(amb.reason, "timezone_lookup_ambiguous");

  const empty = resolveTimezoneFromCoords(45.77, 19.11, () => []);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.reason, "timezone_lookup_empty");

  const threw = resolveTimezoneFromCoords(45.77, 19.11, () => {
    throw new Error("boom");
  });
  assert.equal(threw.ok, false);
  if (!threw.ok) assert.equal(threw.reason, "timezone_lookup_threw");
}

// ── Authority logging classified reasons (no address payload) ───────────────
{
  const auth = read("src/lib/safety/buildAuthorityForPublishFromOriginHit.ts");
  assert.ok(auth.includes("timezoneFailReason"));
  assert.ok(auth.includes("[authority.timezone]"));
  assert.equal(auth.includes("displayName"), false);
  assert.equal(auth.includes("origin_address"), false);
  assert.ok(auth.includes("latFinite"));
}

// ── i18n key completeness zh/en/sr ──────────────────────────────────────────
{
  const keys = [
    "refine_title",
    "refine_tab_search",
    "refine_tab_map_link",
    "use_whole_city",
    "back_to_city_search",
    "results_showing",
    "results_all_shown",
    "map_link_invalid",
    "map_link_host_not_allowed",
    "map_link_redirect_invalid",
    "map_link_timeout",
    "map_link_coordinates_unavailable",
    "map_link_coordinates_ambiguous",
    "map_link_country_mismatch",
    "map_link_place_unavailable",
    "map_link_confirm",
    "map_link_choose_another",
    "map_link_source",
  ] as const;
  for (const locale of ["en", "zh", "sr"] as const) {
    const msg = JSON.parse(read(`src/messages/${locale}.json`)) as {
      home: { address: Record<string, string> };
    };
    for (const k of keys) {
      assert.ok(
        typeof msg.home.address[k] === "string" &&
          msg.home.address[k]!.length > 0,
        `${locale} missing ${k}`,
      );
    }
  }
}

// ── API route exists + no Google Places/Geocoding ───────────────────────────
{
  const route = read("src/app/api/geocode/map-link/route.ts");
  assert.ok(route.includes("importPlaceFromGoogleMapsLink"));
  assert.equal(route.includes("maps.googleapis.com"), false);
  assert.equal(route.includes("GOOGLE_"), false);
  const importer = read("src/lib/geo/googleMapsLinkImport.ts");
  assert.ok(importer.includes("redirect: \"manual\""));
  assert.ok(importer.includes("MAP_LINK_MAX_REDIRECTS"));
  assert.ok(importer.includes("throttledNominatimGetJson"));
}

async function main(): Promise<void> {
  await runNetworkedMapLinkTests();
  console.log("precisePlaceMapLink.test.ts: ok");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
