/**
 * PHASE 6.7C.2C.3B.1 / 3J-A.3 — real geo-tz smoke (offline, no network).
 * Imports geo-tz find directly; production still uses server-only wrapper only.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/geo/geoTzSmoke.test.ts
 */

import assert from "node:assert/strict";
import { find as geoTzFind } from "geo-tz";
import {
  assertValidIanaTimezone,
  resolveTimezoneFromCoords,
} from "@/lib/route-kms";

const POINTS = [
  { name: "Sombor", lat: 45.77417, lon: 19.11222 },
  { name: "Niš", lat: 43.3209, lon: 21.8958 },
  { name: "Belgrade", lat: 44.8178131, lon: 20.4568974 },
  { name: "Bačka Topola", lat: 45.8152, lon: 19.6318 },
] as const;

function uniqueZones(lat: number, lon: number): string[] {
  const raw = geoTzFind(lat, lon);
  assert.ok(Array.isArray(raw), "geo-tz must return an array");
  return [...new Set(raw.map((z) => String(z).trim()).filter(Boolean))];
}

async function main() {
  for (const p of POINTS) {
    const zones = uniqueZones(p.lat, p.lon);
    assert.equal(zones.length, 1, `${p.name} zones: ${zones.join(",")}`);
    assert.equal(zones[0], "Europe/Belgrade", p.name);
    assert.equal(assertValidIanaTimezone(zones[0]!), true);
    new Intl.DateTimeFormat("en", { timeZone: zones[0]! });

    const resolved = resolveTimezoneFromCoords(p.lat, p.lon, geoTzFind);
    assert.equal(resolved.ok, true, `${p.name} resolve`);
    if (resolved.ok) {
      assert.equal(resolved.timezone, "Europe/Belgrade");
    }
  }

  console.log("geoTzSmoke.test.ts: ok");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
