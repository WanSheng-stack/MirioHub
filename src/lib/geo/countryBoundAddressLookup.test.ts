/**
 * PHASE 6.7C.2C.3J-A.1A — country-bound address lookup + publish fail-closed.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/geo/countryBoundAddressLookup.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CanonicalStage1Error,
  buildCanonicalStage1PublishContext,
  toRpcStage1Payload,
} from "@/lib/auth/buildCanonicalStage1PublishContextCore";
import {
  parseAddressPlaceRef,
  placeRefKey,
  type AddressPlaceRef,
} from "@/lib/geo/addressSearch";
import {
  lookupNominatimPlaceRefsBatch,
  resetNominatimClientStateForTests,
  throttledNominatimGetJson,
} from "@/lib/geo/nominatimClient";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const SOMBOR: AddressPlaceRef = {
  provider: "nominatim",
  osmType: "relation",
  osmId: "2117117",
  countryCode: "RS",
};
const NIS: AddressPlaceRef = {
  provider: "nominatim",
  osmType: "relation",
  osmId: "1741449",
  countryCode: "RS",
};

const SOMBOR_DISPLAY =
  "Sombor, Zapadnobački okrug, Vojvodina, Serbia";
const NIS_DISPLAY = "Niš, Serbia";

function nominatimRow(
  ref: AddressPlaceRef,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    osm_type: ref.osmType,
    osm_id: Number(ref.osmId),
    lat: ref.osmId === SOMBOR.osmId ? "45.7742" : "43.3209",
    lon: ref.osmId === SOMBOR.osmId ? "19.1187" : "21.8958",
    name: ref.osmId === SOMBOR.osmId ? "Sombor" : "Niš",
    display_name:
      ref.osmId === SOMBOR.osmId ? SOMBOR_DISPLAY : NIS_DISPLAY,
    type: "city",
    addresstype: "city",
    address: {
      city: ref.osmId === SOMBOR.osmId ? "Sombor" : "Niš",
      country: "Serbia",
      country_code: "rs",
    },
    ...overrides,
  };
}

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  } as Response;
}

function mockFetchFactory(opts: {
  lookupBody?: unknown | ((url: string) => unknown);
  osrmDistanceM?: number;
  onNominatim?: (url: string) => void;
}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("nominatim.openstreetmap.org/lookup")) {
      opts.onNominatim?.(url);
      const body =
        typeof opts.lookupBody === "function"
          ? opts.lookupBody(url)
          : (opts.lookupBody ?? [
              nominatimRow(SOMBOR),
              nominatimRow(NIS),
            ]);
      return jsonResponse(body);
    }
    if (url.includes("/route/v1/driving/")) {
      return jsonResponse({
        routes: [{ distance: opts.osrmDistanceM ?? 180_000 }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

function baseTravelRaw(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    post_type: "demand",
    category: "travel",
    service_subtype: "passenger",
    title: "",
    origin_address: "CLIENT_FORGED_ORIGIN",
    destination_address: "CLIENT_FORGED_DEST",
    departure_date: "2026-09-10",
    departure_time: "14:30",
    time_buffer: 0,
    waypoints: [],
    share_mode: "share",
    delivery_mode: null,
    count_small: 0,
    count_medium: 0,
    count_large: 0,
    count_xlarge: 0,
    escort_seats: 1,
    max_companions: 1,
    bump_fee: 0,
    currency: "EUR",
    locale: "en",
    transport_mode: "car",
    origin_geo: {
      ...SOMBOR,
      displayName: "FORGED_DISPLAY_ORIGIN",
      primaryLabel: "Sombor",
      localityLabel: null,
      resultLevel: "city",
      searchCountryCode: "RS",
      localityContext: "Sombor",
      previewLatitude: 1,
      previewLongitude: 2,
    },
    destination_geo: {
      ...NIS,
      displayName: "FORGED_DISPLAY_DEST",
      primaryLabel: "Niš",
      localityLabel: null,
      resultLevel: "city",
      searchCountryCode: "RS",
      localityContext: "Niš",
      previewLatitude: 3,
      previewLongitude: 4,
    },
    ...overrides,
  };
}

function baseServiceRaw(
  category: "buy" | "onsite" | "errand",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    post_type: "demand",
    category,
    service_subtype: null,
    title: "t",
    origin_address: "CLIENT_FORGED_SERVICE",
    destination_address: "CLIENT_FORGED_SERVICE",
    service_address: "CLIENT_FORGED_SERVICE",
    departure_date: "2026-09-10",
    departure_time: "14:30",
    time_buffer: 0,
    waypoints: [],
    share_mode: null,
    delivery_mode: null,
    count_small: 0,
    count_medium: 0,
    count_large: 0,
    count_xlarge: 0,
    escort_seats: 0,
    max_companions: 0,
    bump_fee: 0,
    currency: "EUR",
    locale: "en",
    transport_mode: null,
    service_geo: {
      ...NIS,
      displayName: "FORGED_SERVICE_DISPLAY",
      primaryLabel: "Niš",
      localityLabel: null,
      resultLevel: "city",
      searchCountryCode: "RS",
      localityContext: "Niš",
      previewLatitude: 99,
      previewLongitude: 99,
    },
    ...overrides,
  };
}

async function expectPublishReject(
  raw: Record<string, unknown>,
  key: string,
  deps: { fetchImpl: typeof fetch },
) {
  await assert.rejects(
    () => buildCanonicalStage1PublishContext(raw, deps),
    (err: unknown) => {
      assert.ok(err instanceof CanonicalStage1Error);
      assert.equal(err.errorKey, key);
      return true;
    },
  );
}

async function main() {
// ── 1–2: countryCode required exact ─────────────────────────────────────────
{
  assert.equal(
    parseAddressPlaceRef({
      provider: "nominatim",
      osmType: "relation",
      osmId: "1741449",
    }),
    null,
  );
  assert.equal(
    parseAddressPlaceRef({
      provider: "nominatim",
      osmType: "relation",
      osmId: "1741449",
      countryCode: "rs",
    }),
    null,
  );
  assert.equal(
    parseAddressPlaceRef({
      provider: "nominatim",
      osmType: "relation",
      osmId: "1741449",
      countryCode: " RS",
    }),
    null,
  );
  assert.equal(
    parseAddressPlaceRef({
      provider: "nominatim",
      osmType: "relation",
      osmId: "1741449",
      countryCode: "RS ",
    }),
    null,
  );
  assert.deepEqual(parseAddressPlaceRef(NIS), NIS);
}

// ── 3–5: batch lookup HTTP once, restore order, fail closed ─────────────────
{
  resetNominatimClientStateForTests();
  let nominatimCalls = 0;
  const fetchImpl = mockFetchFactory({
    lookupBody: [nominatimRow(SOMBOR), nominatimRow(NIS)],
    onNominatim: () => {
      nominatimCalls += 1;
    },
  });
  const batch = await lookupNominatimPlaceRefsBatch([SOMBOR, NIS], {
    fetchImpl,
    minIntervalMs: 0,
    skipCache: true,
  });
  assert.equal(batch.ok, true);
  if (batch.ok) {
    assert.equal(batch.values.length, 2);
    assert.equal(batch.values[0].osmId, SOMBOR.osmId);
    assert.equal(batch.values[1].osmId, NIS.osmId);
  }
  assert.equal(nominatimCalls, 1);
}

{
  resetNominatimClientStateForTests();
  let nominatimCalls = 0;
  const fetchImpl = mockFetchFactory({
    lookupBody: [nominatimRow(NIS)],
    onNominatim: (url) => {
      nominatimCalls += 1;
      assert.ok(url.includes("osm_ids=R1741449"));
      assert.equal(url.includes("R1741449,R1741449"), false);
    },
  });
  const batch = await lookupNominatimPlaceRefsBatch([NIS, NIS], {
    fetchImpl,
    minIntervalMs: 0,
    skipCache: true,
  });
  assert.equal(batch.ok, true);
  if (batch.ok) {
    assert.equal(batch.values.length, 2);
    assert.equal(batch.values[0].displayName, NIS_DISPLAY);
    assert.equal(batch.values[1].displayName, NIS_DISPLAY);
    assert.equal(placeRefKey(NIS), placeRefKey(NIS));
  }
  assert.equal(nominatimCalls, 1);
}

{
  resetNominatimClientStateForTests();
  // missing
  let r = await lookupNominatimPlaceRefsBatch([SOMBOR, NIS], {
    fetchImpl: mockFetchFactory({ lookupBody: [nominatimRow(SOMBOR)] }),
    minIntervalMs: 0,
    skipCache: true,
  });
  assert.equal(r.ok, false);

  // duplicate response rows
  r = await lookupNominatimPlaceRefsBatch([SOMBOR], {
    fetchImpl: mockFetchFactory({
      lookupBody: [nominatimRow(SOMBOR), nominatimRow(SOMBOR)],
    }),
    minIntervalMs: 0,
    skipCache: true,
  });
  assert.equal(r.ok, false);

  // cross-country
  r = await lookupNominatimPlaceRefsBatch([SOMBOR], {
    fetchImpl: mockFetchFactory({
      lookupBody: [
        nominatimRow(SOMBOR, {
          address: { country_code: "hu", country: "Hungary" },
        }),
      ],
    }),
    minIntervalMs: 0,
    skipCache: true,
  });
  assert.equal(r.ok, false);

  // bad coords
  r = await lookupNominatimPlaceRefsBatch([SOMBOR], {
    fetchImpl: mockFetchFactory({
      lookupBody: [nominatimRow(SOMBOR, { lat: "999", lon: "0" })],
    }),
    minIntervalMs: 0,
    skipCache: true,
  });
  assert.equal(r.ok, false);

  // missing country_code
  r = await lookupNominatimPlaceRefsBatch([SOMBOR], {
    fetchImpl: mockFetchFactory({
      lookupBody: [
        nominatimRow(SOMBOR, {
          address: { city: "Sombor", country: "Serbia" },
        }),
      ],
    }),
    minIntervalMs: 0,
    skipCache: true,
  });
  assert.equal(r.ok, false);
}

// ── 6–8 / 18: forged preview/display do not affect canonical / authority / RPC
{
  resetNominatimClientStateForTests();
  let nominatimCalls = 0;
  const fetchImpl = mockFetchFactory({
    lookupBody: [nominatimRow(SOMBOR), nominatimRow(NIS)],
    osrmDistanceM: 200_000,
    onNominatim: () => {
      nominatimCalls += 1;
    },
  });
  const ctx = await buildCanonicalStage1PublishContext(baseTravelRaw(), {
    fetchImpl,
    minIntervalMs: 0,
    skipCache: true,
  });
  assert.equal(ctx.canonicalPayload.origin_address, SOMBOR_DISPLAY);
  assert.equal(ctx.canonicalPayload.destination_address, NIS_DISPLAY);
  assert.equal(ctx.originNominatimHit.lat, 45.7742);
  assert.equal(ctx.originNominatimHit.lon, 19.1187);
  assert.equal(ctx.originNominatimHit.countryCode, "RS");
  assert.equal(ctx.serverKms, 200);
  assert.equal(nominatimCalls, 1);

  const rpc = toRpcStage1Payload(ctx.canonicalPayload, ctx.serverFeeMinor);
  assert.equal(rpc.origin_address, SOMBOR_DISPLAY);
  assert.equal(rpc.destination_address, NIS_DISPLAY);
  assert.equal("origin_geo" in rpc, false);
  assert.equal("destination_geo" in rpc, false);
  assert.equal("service_geo" in rpc, false);
  assert.equal("previewLatitude" in rpc, false);
  assert.equal(JSON.stringify(rpc).includes("FORGED"), false);
  assert.equal(JSON.stringify(rpc).includes("preview"), false);
}

// ── 9 / 12 / 13: missing refs + waypoints fail closed on publish builder
{
  resetNominatimClientStateForTests();
  const fetchImpl = mockFetchFactory({
    lookupBody: [nominatimRow(SOMBOR), nominatimRow(NIS)],
  });
  const deps = { fetchImpl, minIntervalMs: 0, skipCache: true };

  await expectPublishReject(
    baseTravelRaw({ origin_geo: undefined }),
    "error.address_confirmation_required",
    deps,
  );
  await expectPublishReject(
    baseTravelRaw({ destination_geo: undefined }),
    "error.address_confirmation_required",
    deps,
  );
  await expectPublishReject(
    baseTravelRaw({ waypoints: ["Novi Sad stop"] }),
    "error.address_confirmation_required",
    deps,
  );

  // Source: three production APIs use builder; builder has no free-text fallback.
  const builder = read("src/lib/auth/buildCanonicalStage1PublishContextCore.ts");
  assert.equal(builder.includes("resolveStage1RouteWithOriginHit"), false);
  assert.ok(builder.includes("error.address_confirmation_required"));
  for (const rel of [
    "src/app/api/posts/trusted-publish/route.ts",
    "src/app/api/posts/shadow-draft/route.ts",
    "src/app/api/auth/passkey/verify/route.ts",
  ]) {
    const src = read(rel);
    assert.ok(src.includes("buildCanonicalStage1PublishContext"));
    assert.equal(src.includes("resolveStage1RouteWithOriginHit"), false);
  }
}

// ── 10–11: buy / onsite / errand single service ref, kms=0
{
  for (const category of ["buy", "onsite", "errand"] as const) {
    resetNominatimClientStateForTests();
    let nominatimCalls = 0;
    const fetchImpl = mockFetchFactory({
      lookupBody: [nominatimRow(NIS)],
      onNominatim: (url) => {
        nominatimCalls += 1;
        assert.ok(url.includes("osm_ids=R1741449"));
        assert.equal(url.includes(","), false);
      },
    });
    const ctx = await buildCanonicalStage1PublishContext(
      baseServiceRaw(category),
      { fetchImpl, minIntervalMs: 0, skipCache: true },
    );
    assert.equal(ctx.serverKms, 0);
    assert.equal(ctx.canonicalPayload.origin_address, NIS_DISPLAY);
    assert.equal(ctx.canonicalPayload.destination_address, NIS_DISPLAY);
    assert.equal(ctx.originNominatimHit.countryCode, "RS");
    assert.equal(nominatimCalls, 1);
  }
}

// ── Buy must not require destination_geo
{
  resetNominatimClientStateForTests();
  const ctx = await buildCanonicalStage1PublishContext(
    baseServiceRaw("buy", { destination_geo: undefined }),
    {
      fetchImpl: mockFetchFactory({ lookupBody: [nominatimRow(NIS)] }),
      minIntervalMs: 0,
      skipCache: true,
    },
  );
  assert.equal(ctx.serverKms, 0);
}

// ── 14: concurrent identical lookup → one fetch
{
  resetNominatimClientStateForTests();
  let nominatimCalls = 0;
  const fetchImpl = mockFetchFactory({
    lookupBody: [nominatimRow(NIS)],
    onNominatim: () => {
      nominatimCalls += 1;
    },
  });
  const url =
    "https://nominatim.openstreetmap.org/lookup?osm_ids=R1741449&format=jsonv2&addressdetails=1";
  const deps = { fetchImpl, minIntervalMs: 0 };
  const [a, b] = await Promise.all([
    throttledNominatimGetJson(url, deps),
    throttledNominatimGetJson(url, deps),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(nominatimCalls, 1);
  resetNominatimClientStateForTests();
}

// ── 15–17: small_item hint matrix + zh/en/sr copy
{
  const form = read("src/lib/post-form/usePostFormState.ts");
  assert.ok(form.includes("showFeeDemand"));
  assert.ok(form.includes('state.post_type === "demand"'));
  assert.ok(form.includes('state.category === "travel"'));
  assert.ok(form.includes('state.service_subtype === "small_item_only"'));

  const zh = JSON.parse(read("src/messages/zh.json")) as {
    home: { address: { small_item_handoff_hint: string } };
  };
  const en = JSON.parse(read("src/messages/en.json")) as {
    home: { address: { small_item_handoff_hint: string } };
  };
  const sr = JSON.parse(read("src/messages/sr.json")) as {
    home: { address: { small_item_handoff_hint: string } };
  };
  assert.equal(
    zh.home.address.small_item_handoff_hint,
    "此金额按顺路交接估算。若需要明显绕行、上门取送或等待，实际感谢金可能更高。选择司机路线附近的安全地点，更容易被接单。",
  );
  assert.equal(
    en.home.address.small_item_handoff_hint,
    "This estimate assumes handoff near the driver's existing route. Door-to-door pickup, extra detours, or waiting may require a higher amount. A safe meeting point near the route is more likely to be accepted.",
  );
  assert.equal(
    sr.home.address.small_item_handoff_hint,
    "Ova procena važi za primopredaju blizu postojeće rute vozača. Preuzimanje na adresi, dodatno skretanje ili čekanje mogu zahtevati veći iznos. Bezbedno mesto blizu rute povećava šansu da neko prihvati zahtev.",
  );

  // Provider / other subtypes must not satisfy the matrix alone.
  assert.ok(form.includes("visibility.showFeeDemand"));
}

// ── route-distance contract
{
  const dist = read("src/app/api/route-distance/route.ts");
  assert.ok(dist.includes("lookupNominatimPlaceRefsBatch"));
  assert.ok(dist.includes("parseAddressPlaceRef"));
  assert.ok(dist.includes("sliceOriginIndex"));
  assert.equal(dist.includes("lookupNominatimPlaceRefsSequential"), false);
  assert.ok(dist.includes("displayName"));
  assert.equal(dist.includes("sliceOrigin,"), false);
  assert.equal(dist.includes("body.locations"), false);
}

console.log("countryBoundAddressLookup.test.ts: PASS");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
