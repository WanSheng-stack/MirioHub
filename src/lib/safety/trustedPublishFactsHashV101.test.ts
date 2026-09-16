/**
 * PHASE 6.7C.2C.3G / v101B — pure publish-facts hash fixtures.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/trustedPublishFactsHashV101.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLISH_FACTS_FIELDS_V101,
  PUBLISH_FACTS_SCHEMA_VERSION_V101,
  buildTrustedPublishFactsV101,
  hashTrustedPublishFactsV101,
  validateTrustedPublishFactsInputsV101,
} from "@/lib/safety/trustedPublishFactsHashV101";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const MIG =
  "supabase/migrations/20260918000002_trusted_publish_authority_writer_v101b.sql";

const CANON =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CANON_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const EWKB_A = "0101000020e6100000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EWKB_B = "0101000020e6100000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function base(
  overrides: Partial<Parameters<typeof hashTrustedPublishFactsV101>[0]> = {},
) {
  return {
    canonical_payload_hash: CANON,
    origin_gps_ewkb_hex: EWKB_A,
    origin_country_code: "RS",
    origin_timezone: "Europe/Belgrade",
    night_policy_version: 2 as number | null,
    ...overrides,
  };
}

async function main() {
  // Identical inputs → identical hash
  {
    const a = hashTrustedPublishFactsV101(base());
    const b = hashTrustedPublishFactsV101(base());
    assert.equal(typeof a, "string");
    assert.equal(a, b);
    assert.ok(/^[0-9a-f]{64}$/.test(a!));
  }

  // Each authority / canonical field change flips hash
  {
    const h0 = hashTrustedPublishFactsV101(base())!;
    assert.notEqual(
      hashTrustedPublishFactsV101(base({ origin_country_code: "HU" })),
      h0,
    );
    assert.notEqual(
      hashTrustedPublishFactsV101(base({ origin_timezone: "Europe/Budapest" })),
      h0,
    );
    assert.notEqual(
      hashTrustedPublishFactsV101(base({ night_policy_version: 3 })),
      h0,
    );
    assert.notEqual(
      hashTrustedPublishFactsV101(base({ origin_gps_ewkb_hex: EWKB_B })),
      h0,
    );
    assert.notEqual(
      hashTrustedPublishFactsV101(base({ canonical_payload_hash: CANON_B })),
      h0,
    );
  }

  // night NULL ≠ 1
  {
    const hNull = hashTrustedPublishFactsV101(
      base({ night_policy_version: null }),
    )!;
    const h1 = hashTrustedPublishFactsV101(base({ night_policy_version: 1 }))!;
    assert.notEqual(hNull, h1);
  }

  // Field concatenation boundary: structured fields cannot collide via concat
  {
    const a = hashTrustedPublishFactsV101(
      base({ origin_country_code: "RS", origin_timezone: "Europe/Belgrade" }),
    )!;
    const c = hashTrustedPublishFactsV101(
      base({
        origin_country_code: "HU",
        origin_timezone: "Europe/Belgrade",
      }),
    )!;
    assert.notEqual(a, c);
    // Same characters different fields → different hash (json keys separate values)
    const d = hashTrustedPublishFactsV101(
      base({
        origin_country_code: "AB",
        origin_timezone: "CD",
        // force through validate with short tz — length 1–100 ok; pure fixture
        // uses literal JSON keys so "AB"+"CD" ≠ country "A" + tz "BCD"
      }),
    );
    // "CD" is valid under pure length/country rules; ensure distinct from swapped
    const e = hashTrustedPublishFactsV101(
      base({ origin_country_code: "CD", origin_timezone: "AB" }),
    );
    assert.ok(d);
    assert.ok(e);
    assert.notEqual(d, e);
  }

  // Field order frozen in module + SQL
  {
    assert.deepEqual(PUBLISH_FACTS_FIELDS_V101, [
      "publish_facts_schema_version",
      "canonical_payload_hash",
      "origin_gps_ewkb_hex",
      "origin_country_code",
      "origin_timezone",
      "night_policy_version",
    ]);
    assert.equal(PUBLISH_FACTS_SCHEMA_VERSION_V101, 101);
    const facts = buildTrustedPublishFactsV101(base())!;
    assert.equal(facts.publish_facts_schema_version, 101);
    const mig = read(MIG);
    assert.ok(mig.includes("'publish_facts_schema_version', 101"));
    assert.ok(mig.includes("'canonical_payload_hash'"));
    assert.ok(mig.includes("'origin_gps_ewkb_hex'"));
    assert.ok(mig.includes("'origin_country_code'"));
    assert.ok(mig.includes("'origin_timezone'"));
    assert.ok(mig.includes("'night_policy_version'"));
  }

  // Reject uppercase canonical, padding, illegal GPS/country/tz/version
  {
    assert.equal(
      validateTrustedPublishFactsInputsV101(
        base({
          canonical_payload_hash: CANON.toUpperCase(),
        }),
      ),
      false,
    );
    assert.equal(hashTrustedPublishFactsV101(base({
      canonical_payload_hash: CANON.toUpperCase(),
    })), null);
    assert.equal(
      hashTrustedPublishFactsV101(
        base({ origin_country_code: " rs" }),
      ),
      null,
    );
    assert.equal(
      hashTrustedPublishFactsV101(base({ origin_country_code: "rs" })),
      null,
    );
    assert.equal(
      hashTrustedPublishFactsV101(base({ origin_timezone: " Europe/Belgrade" })),
      null,
    );
    assert.equal(
      hashTrustedPublishFactsV101(base({ night_policy_version: 0 })),
      null,
    );
    assert.equal(
      hashTrustedPublishFactsV101(base({ night_policy_version: -1 })),
      null,
    );
    assert.equal(
      hashTrustedPublishFactsV101(
        base({ origin_gps_ewkb_hex: "ZZ" }),
      ),
      null,
    );
  }

  // SQL hash helper locks digest path (no JS EWKB)
  {
    const mig = read(MIG);
    assert.ok(mig.includes("extensions.st_asewkb"));
    assert.ok(mig.includes("extensions.digest"));
    assert.ok(mig.includes("convert_to"));
    assert.ok(mig.includes("encode("));
    assert.equal(mig.includes("auth.uid()"), false);
  }

  console.log("trustedPublishFactsHashV101.test.ts: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
