/**
 * PHASE 6.7C.2C.3B.1 — real geo-tz smoke (offline, no network).
 * Imports geo-tz find directly; production still uses server-only wrapper only.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/geo/geoTzSmoke.test.ts
 */

import assert from "node:assert/strict";
import { find as geoTzFind } from "geo-tz";
import { assertValidIanaTimezone } from "@/lib/route-kms";

/** Belgrade city center (approx). */
const BELGRADE = { lat: 44.8178131, lon: 20.4568974 };
/** Bačka Topola (approx). */
const BACKA_TOPOLA = { lat: 45.8152, lon: 19.6318 };

function uniqueZones(lat: number, lon: number): string[] {
  const raw = geoTzFind(lat, lon);
  assert.ok(Array.isArray(raw), "geo-tz must return an array");
  return [...new Set(raw.map((z) => String(z).trim()).filter(Boolean))];
}

async function main() {
  const belgrade = uniqueZones(BELGRADE.lat, BELGRADE.lon);
  assert.equal(belgrade.length, 1, `Belgrade zones: ${belgrade.join(",")}`);
  assert.equal(belgrade[0], "Europe/Belgrade");
  assert.equal(assertValidIanaTimezone(belgrade[0]!), true);
  new Intl.DateTimeFormat("en", { timeZone: belgrade[0]! });

  const backa = uniqueZones(BACKA_TOPOLA.lat, BACKA_TOPOLA.lon);
  assert.equal(backa.length, 1, `Bačka Topola zones: ${backa.join(",")}`);
  assert.equal(backa[0], "Europe/Belgrade");
  assert.equal(assertValidIanaTimezone(backa[0]!), true);
  new Intl.DateTimeFormat("en", { timeZone: backa[0]! });

  console.log("geoTzSmoke.test.ts: ok");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
