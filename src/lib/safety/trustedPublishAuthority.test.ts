/**
 * PHASE 6.7C.2C.3D — trusted publish authority context (offline).
 * Imports pure core only (no server-only / geo-tz / network).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/trustedPublishAuthority.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanonicalStage1Payload } from "@/lib/auth/canonicalStage1Core";
import type { TrustedOriginResolution } from "@/lib/route-kms";
import {
  TRUSTED_PUBLISH_AUTHORITY_TEST_INSTANT,
  buildTrustedPublishAuthority,
  isStrictEvaluationInstant,
  type NightPolicySelectorRow,
  type SelectNightPolicyFn,
} from "@/lib/safety/trustedPublishAuthorityCore";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const PHASE_BASELINE = "c390f9e2f86c410f23e6490663e4e4ccde90cef1";
const T0 = TRUSTED_PUBLISH_AUTHORITY_TEST_INSTANT;

const FROZEN = [
  "supabase/migrations/20260908000004_match_request_contract_foundation_v90.sql",
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql",
  "supabase/migrations/20260909000002_security_advisor_immediate_boundary_v92.sql",
  "supabase/migrations/20260911000001_matching_dual_post_foundation_v93.sql",
  "supabase/migrations/20260911000002_matching_allocation_event_foundation_v94.sql",
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql",
  "supabase/migrations/20260913000001_service_subtype_night_safety_foundation_v96.sql",
  "supabase/migrations/20260914000001_postgis_extensions_rebind_v97.sql",
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.sql",
  "supabase/migrations/20260916000001_match_admission_authority_v99.sql",
  "supabase/migrations/20260916000002_match_request_writer_v99b.sql",
  "supabase/migrations/20260917000001_night_policy_selector_v100.sql",
  "supabase/migrations/20260917000001_night_policy_selector_v100.verify.sql",
  "supabase/init.sql",
] as const;

function gitDiff(path: string): string {
  return execFileSync("git", ["diff", PHASE_BASELINE, "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function baseCanonical(
  overrides: Partial<CanonicalStage1Payload> = {},
): CanonicalStage1Payload {
  return {
    post_type: "demand",
    category: "travel",
    title: "t",
    origin_address: "Belgrade",
    destination_address: "Novi Sad",
    departure_date: "2026-06-15",
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
    ...overrides,
  };
}

function okOrigin(
  overrides: Partial<{
    lat: number;
    lon: number;
    wkt: string;
    countryCode: string;
    timezone: string;
  }> = {},
): TrustedOriginResolution {
  const lat = overrides.lat ?? 44.8178131;
  const lon = overrides.lon ?? 20.4568974;
  return {
    ok: true,
    value: {
      lat,
      lon,
      wkt: overrides.wkt ?? `SRID=4326;POINT(${lon} ${lat})`,
      countryCode: overrides.countryCode ?? "RS",
      timezone: overrides.timezone ?? "Europe/Belgrade",
    },
  };
}

function policyRow(
  overrides: Partial<NightPolicySelectorRow> = {},
): NightPolicySelectorRow {
  return {
    policy_id: "11111111-1111-4111-8111-111111111111",
    country_code: "RS",
    region_code: null,
    timezone_name: "Europe/Belgrade",
    blocked_start_local: "22:00:00",
    blocked_end_local: "06:00:00",
    policy_version: 1,
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_until: null,
    ...overrides,
  };
}

function selectRows(
  rows: NightPolicySelectorRow[],
): SelectNightPolicyFn {
  return async () => rows;
}

async function main() {
  // 1. resolver ok + selector zero rows
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([]),
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.value.originCountryCode, "RS");
      assert.equal(res.value.originTimezone, "Europe/Belgrade");
      assert.ok(res.value.originGpsWkt.startsWith("SRID=4326;POINT("));
      assert.equal(res.value.nightPolicyVersion, null);
      assert.equal(res.value.nightPolicyApplied, false);
      assert.equal(res.value.policyId, null);
    }
  }

  // 2. RS disabled semantics — zero rows, never write version=1, no night_blocked
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical({ departure_time: "23:30" }),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      // Disabled seed is filtered by v100 (enabled IS TRUE) → zero rows
      selectNightPolicy: selectRows([]),
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.value.nightPolicyVersion, null);
      assert.equal(res.value.nightPolicyApplied, false);
    }
  }

  // 3. one enabled row, daytime → success + applied
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical({ departure_time: "14:00" }),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([policyRow({ policy_version: 2 })]),
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.value.nightPolicyVersion, 2);
      assert.equal(res.value.nightPolicyApplied, true);
      assert.equal(res.value.policyId, "11111111-1111-4111-8111-111111111111");
    }
  }

  // 4. night-sensitive subtype in blocked window
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical({
        departure_time: "23:00",
        service_subtype: "passenger",
      }),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([policyRow()]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_service_blocked");
  }

  // 5. small_item_only / cargo_only allowed at night
  for (const [category, subtype, mode] of [
    ["travel", "small_item_only", "car"],
    ["deliver", "cargo_only", "cargo_van"],
  ] as const) {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical({
        category,
        service_subtype: subtype,
        transport_mode: mode,
        departure_time: "23:00",
        share_mode: category === "travel" ? "share" : null,
        delivery_mode: category === "deliver" ? "spot" : null,
        max_companions: category === "travel" ? 1 : null,
      }),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([policyRow()]),
    });
    assert.equal(res.ok, true, `${category}/${subtype}`);
    if (res.ok) assert.equal(res.value.nightPolicyApplied, true);
  }

  // 6. onsite blocked in window
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical({
        category: "onsite",
        service_subtype: null,
        transport_mode: null,
        departure_time: "23:00",
        share_mode: null,
        max_companions: null,
      }),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([policyRow()]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_service_blocked");
  }

  // 7. buy / errand allowed at night
  for (const category of ["buy", "errand"] as const) {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical({
        category,
        service_subtype: null,
        transport_mode: null,
        departure_time: "23:00",
        share_mode: null,
        max_companions: null,
      }),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([policyRow()]),
    });
    assert.equal(res.ok, true, category);
  }

  // 8. ambiguous (>1)
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({ policy_id: "a", policy_version: 1 }),
        policyRow({ policy_id: "b", policy_version: 2 }),
      ]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_ambiguous");
  }

  // 9. bad policy_version
  for (const ver of [null, 0, -1, 1.5, NaN, Infinity] as unknown[]) {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({ policy_version: ver as number }),
      ]),
    });
    assert.equal(res.ok, false, `ver=${String(ver)}`);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }

  // 10. country / timezone mismatch
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([policyRow({ country_code: "HU" })]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({ timezone_name: "Europe/Paris" }),
      ]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }

  // 11. region non-NULL fail closed
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([policyRow({ region_code: "VOJ" })]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }

  // 12. illegal blocked times
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({ blocked_start_local: "not-a-time", blocked_end_local: "06:00" }),
      ]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_time_invalid");
  }
  {
    // empty blocked → time_invalid before evaluate
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({ blocked_start_local: "", blocked_end_local: "06:00" }),
      ]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_time_invalid");
  }

  // 13. evaluation time null/illegal before resolver/selector
  async function assertInstantRejectedBeforeGeo(
    evaluationTime: string,
    label: string,
  ) {
    let resolverCalls = 0;
    let selectorCalls = 0;
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime,
      resolveTrustedOrigin: async () => {
        resolverCalls += 1;
        return okOrigin();
      },
      selectNightPolicy: async () => {
        selectorCalls += 1;
        return [];
      },
    });
    assert.equal(res.ok, false, label);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid", label);
    assert.equal(resolverCalls, 0, `${label} resolver`);
    assert.equal(selectorCalls, 0, `${label} selector`);
  }
  await assertInstantRejectedBeforeGeo("", "empty");
  await assertInstantRejectedBeforeGeo("  2026-06-15T12:00:00.000Z", "padded");
  await assertInstantRejectedBeforeGeo("not-an-instant", "garbage");
  await assertInstantRejectedBeforeGeo("2026-06-15", "date-only");
  await assertInstantRejectedBeforeGeo("2026-06-15T12:00:00", "timezone-less");
  await assertInstantRejectedBeforeGeo("2026-02-30T12:00:00Z", "invalid-date");
  assert.equal(isStrictEvaluationInstant("2026-06-15T12:00:00Z"), true);
  assert.equal(isStrictEvaluationInstant("2026-06-15T14:00:00+02:00"), true);
  assert.equal(isStrictEvaluationInstant("NaN"), false);

  // 3D.1 — selector non-array fail-closed
  for (const bad of [
    null,
    undefined,
    { policy_id: "x" },
    "not-rows",
  ] as const) {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: async () => bad,
    });
    assert.equal(res.ok, false, String(bad));
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: async () => {
        throw new Error("selector boom");
      },
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: () => Promise.reject(new Error("selector reject")),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([]),
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.value.nightPolicyVersion, null);
  }

  // 3D.1 — resolver success defensive validation
  async function assertOriginShapeInvalid(
    origin: TrustedOriginResolution,
    label: string,
  ) {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => origin,
      selectNightPolicy: selectRows([]),
    });
    assert.equal(res.ok, false, label);
    if (!res.ok) assert.equal(res.errorKey, "error.geocode_invalid_response", label);
  }
  await assertOriginShapeInvalid(
    okOrigin({ countryCode: "rs" }),
    "lowercase-country",
  );
  await assertOriginShapeInvalid(
    okOrigin({ timezone: " Europe/Belgrade" }),
    "padded-timezone",
  );
  await assertOriginShapeInvalid(
    okOrigin({ timezone: "Not/A/Timezone" }),
    "bad-iana",
  );
  await assertOriginShapeInvalid(
    okOrigin({ wkt: "" }),
    "empty-wkt",
  );
  await assertOriginShapeInvalid(
    okOrigin({ lat: 91, lon: 0, wkt: "SRID=4326;POINT(0 91)" }),
    "oob-lat",
  );
  await assertOriginShapeInvalid(
    okOrigin({
      lat: 44.8178131,
      lon: 20.4568974,
      wkt: "SRID=4326;POINT(21 44.8178131)",
    }),
    "wkt-lon-mismatch",
  );

  // 3D.1 — zero-row path does not invoke night evaluate (structural + night-time ok)
  {
    const core = read("src/lib/safety/trustedPublishAuthorityCore.ts");
    const zeroIdx = core.indexOf("if (rows.length === 0)");
    const evalIdx = core.indexOf("evaluateNightServicePolicy(");
    assert.ok(zeroIdx >= 0 && evalIdx >= 0);
    assert.ok(zeroIdx < evalIdx, "zero-row return precedes night evaluate");
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical({ departure_time: "23:30" }),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([]),
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.value.nightPolicyApplied, false);
      assert.equal(res.value.nightPolicyVersion, null);
    }
  }

  // 3D.2 — unconditional blocked-time validation (incl. non-night-sensitive)
  async function assertBlockedTimeInvalid(
    canonical: CanonicalStage1Payload,
    start: string,
    end: string,
    label: string,
  ) {
    const res = await buildTrustedPublishAuthority({
      canonical,
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({ blocked_start_local: start, blocked_end_local: end }),
      ]),
    });
    assert.equal(res.ok, false, label);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_time_invalid", label);
  }
  await assertBlockedTimeInvalid(
    baseCanonical({ service_subtype: "passenger", departure_time: "14:00" }),
    "not-a-time",
    "06:00",
    "passenger-bad-start",
  );
  await assertBlockedTimeInvalid(
    baseCanonical({
      service_subtype: "small_item_only",
      departure_time: "23:00",
    }),
    "not-a-time",
    "06:00",
    "small_item_only-bad-start",
  );
  await assertBlockedTimeInvalid(
    baseCanonical({
      category: "deliver",
      service_subtype: "cargo_only",
      transport_mode: "cargo_van",
      share_mode: null,
      delivery_mode: "spot",
      max_companions: null,
      departure_time: "23:00",
    }),
    "22:00",
    "not-a-time",
    "cargo_only-bad-end",
  );
  await assertBlockedTimeInvalid(
    baseCanonical({
      category: "buy",
      service_subtype: null,
      transport_mode: null,
      share_mode: null,
      max_companions: null,
      departure_time: "23:00",
    }),
    "xx:yy",
    "06:00",
    "buy-bad-time",
  );
  await assertBlockedTimeInvalid(
    baseCanonical({
      category: "errand",
      service_subtype: null,
      transport_mode: null,
      share_mode: null,
      max_companions: null,
      departure_time: "23:00",
    }),
    "22:00",
    "bad",
    "errand-bad-time",
  );
  await assertBlockedTimeInvalid(
    baseCanonical(),
    "22:00",
    "22:00",
    "start-eq-end-hhmm",
  );
  await assertBlockedTimeInvalid(
    baseCanonical(),
    "22:00:00",
    "22:00",
    "start-eq-end-mixed",
  );
  await assertBlockedTimeInvalid(baseCanonical(), "24:00", "06:00", "24:00");
  await assertBlockedTimeInvalid(
    baseCanonical(),
    " 22:00",
    "06:00",
    "padded-start",
  );
  await assertBlockedTimeInvalid(
    baseCanonical(),
    "22:00",
    "06:00 ",
    "padded-end",
  );
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical({ departure_time: "14:00" }),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({
          blocked_start_local: "22:00",
          blocked_end_local: "06:00",
        }),
      ]),
    });
    assert.equal(res.ok, true, "hhmm-ok");
    if (res.ok) assert.equal(res.value.nightPolicyApplied, true);
  }
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical({ departure_time: "14:00" }),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({
          blocked_start_local: "22:00:00",
          blocked_end_local: "06:00:00",
        }),
      ]),
    });
    assert.equal(res.ok, true, "hhmmss-ok");
    if (res.ok) assert.equal(res.value.nightPolicyApplied, true);
  }

  // 3D.2 — policy_id UUID
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([policyRow({ policy_id: "not-a-uuid" })]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({
          policy_id: " 11111111-1111-4111-8111-111111111111",
        }),
      ]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical({ departure_time: "14:00" }),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({
          policy_id: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
        }),
      ]),
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.value.policyId, "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE");
    }
  }

  // 3D.2 — effective interval
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({ effective_from: "2026-01-01" }),
      ]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({ effective_until: "2026-12-31T00:00:00" }),
      ]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({ effective_from: "2026-12-01T00:00:00.000Z" }),
      ]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical({ departure_time: "14:00" }),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({ effective_from: T0 }),
      ]),
    });
    assert.equal(res.ok, true, "eval-eq-from");
  }
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({
          effective_from: "2026-01-01T00:00:00.000Z",
          effective_until: T0,
        }),
      ]),
    });
    assert.equal(res.ok, false, "eval-eq-until");
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical({ departure_time: "14:00" }),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({
          effective_from: "2026-01-01T00:00:00.000Z",
          effective_until: "2026-12-31T00:00:00.000Z",
        }),
      ]),
    });
    assert.equal(res.ok, true, "eval-before-until");
  }
  for (const until of [
    "2026-01-01T00:00:00.000Z",
    "2025-12-31T00:00:00.000Z",
  ] as const) {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([
        policyRow({
          effective_from: "2026-01-01T00:00:00.000Z",
          effective_until: until,
        }),
      ]),
    });
    assert.equal(res.ok, false, `until=${until}`);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }

  // 3D.2 — malformed single-element selector arrays
  for (const bad of [null, undefined, "row", 123, []] as const) {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: async () => [bad],
    });
    assert.equal(res.ok, false, `single=${String(bad)}`);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }

  // 3D.2A — non-plain single-row objects rejected at shape gate
  {
    class PolicyRowLike {}
    const nonPlain: unknown[] = [
      new Date("2026-06-15T12:00:00.000Z"),
      new PolicyRowLike(),
      new Map(),
      new Set(),
      /policy/,
    ];
    for (const bad of nonPlain) {
      const res = await buildTrustedPublishAuthority({
        canonical: baseCanonical(),
        evaluationTime: T0,
        resolveTrustedOrigin: async () => okOrigin(),
        selectNightPolicy: async () => [bad],
      });
      assert.equal(res.ok, false, `nonplain=${Object.prototype.toString.call(bad)}`);
      if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
    }
  }

  // 3D.2A — region_code must be exact null
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical({ departure_time: "14:00" }),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: selectRows([policyRow({ region_code: null })]),
    });
    assert.equal(res.ok, true, "region-null-ok");
  }
  {
    const { region_code: _omit, ...rest } = policyRow();
    void _omit;
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: async () => [rest],
    });
    assert.equal(res.ok, false, "region-omitted");
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }
  for (const [label, region] of [
    ["undefined", undefined],
    ["empty", ""],
    ["string", "Vojvodina"],
    ["zero", 0],
  ] as const) {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin(),
      selectNightPolicy: async () => [
        { ...policyRow(), region_code: region as never },
      ],
    });
    assert.equal(res.ok, false, `region=${label}`);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }

  // 14. resolver typed errors pass through
  for (const errorKey of [
    "error.geocode_failed",
    "error.geocode_timeout",
    "error.geocode_invalid_response",
    "error.geocode_country_unavailable",
    "error.geocode_timezone_unavailable",
  ] as const) {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => ({ ok: false, errorKey }),
      selectNightPolicy: selectRows([policyRow()]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, errorKey);
  }

  // 15. browser authority fields are not inputs; cannot override result
  {
    const sneaky = {
      ...baseCanonical(),
      origin_country_code: "XX",
      origin_timezone: "Etc/UTC",
      night_policy_version: 99,
    } as CanonicalStage1Payload & Record<string, unknown>;
    const res = await buildTrustedPublishAuthority({
      canonical: sneaky,
      evaluationTime: T0,
      resolveTrustedOrigin: async () => okOrigin({ countryCode: "RS" }),
      selectNightPolicy: selectRows([]),
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.value.originCountryCode, "RS");
      assert.equal(res.value.originTimezone, "Europe/Belgrade");
      assert.equal(res.value.nightPolicyVersion, null);
    }
  }

  // 16. no Date.now / live clock in core
  {
    const core = read("src/lib/safety/trustedPublishAuthorityCore.ts");
    assert.equal(core.includes("Date.now("), false);
    assert.equal(core.includes("new Date("), false);
    assert.ok(core.includes("TRUSTED_PUBLISH_AUTHORITY_TEST_INSTANT"));
  }

  // Import / server-only boundary
  {
    const wrapper = read("src/lib/safety/trustedPublishAuthority.ts");
    assert.ok(wrapper.includes('import "server-only"'));
    assert.ok(wrapper.includes("resolveTrustedOrigin"));
    assert.ok(wrapper.includes("from \"@/lib/geo/trustedOriginResolver\""));
    const core = read("src/lib/safety/trustedPublishAuthorityCore.ts");
    assert.equal(/import\s+["']server-only["']/.test(core), false);
    assert.equal(/from\s+["']geo-tz["']/.test(core), false);
    assert.equal(
      /from\s+["']@\/lib\/geo\/trustedOriginResolver["']/.test(core),
      false,
    );
  }

  // Client components must not import authority modules
  {
    const files: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
          files.push(full);
        }
      }
    }
    walk(join(repoRoot, "src"));
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const head = src.slice(0, 400);
      if (!head.includes('"use client"') && !head.includes("'use client'")) {
        continue;
      }
      assert.equal(
        src.includes("trustedPublishAuthority"),
        false,
        `client import trustedPublishAuthority: ${file}`,
      );
      assert.equal(
        src.includes("trustedOriginResolver"),
        false,
        `client import trustedOriginResolver: ${file}`,
      );
    }
  }

  // Publish paths on v101; complete-contact does not write authority
  {
    const trusted = read("src/app/api/posts/trusted-publish/route.ts");
    const shadow = read("src/app/api/posts/shadow-draft/route.ts");
    const passkey = read("src/app/api/auth/passkey/verify/route.ts");
    const contact = read("src/app/api/posts/complete-contact/route.ts");
    assert.ok(trusted.includes("publish_active_post_idempotent_v101"));
    assert.ok(shadow.includes("create_shadow_draft_idempotent_v101"));
    assert.ok(passkey.includes("commit_phase3_business_idempotent_v101"));
    assert.equal(trusted.includes("publish_active_post_idempotent_v98"), false);
    assert.equal(shadow.includes("create_shadow_draft_idempotent_v98"), false);
    assert.equal(passkey.includes("commit_phase3_business_idempotent_v98"), false);
    assert.equal(contact.includes("origin_country_code"), false);
    assert.equal(contact.includes("origin_timezone"), false);
    assert.equal(contact.includes("night_policy_version"), false);
    assert.equal(contact.includes("buildTrustedPublishAuthority"), false);
  }

  // v101B/cutover may exist; reject v102; frozen history zero-diff
  {
    const migs = readdirSync(join(repoRoot, "supabase/migrations"));
    assert.equal(migs.some((n) => /v102/.test(n)), false);
    assert.equal(
      migs.some((n) => /cutover|revoke_v98|posts_update_own_seal/.test(n)),
      false,
    );
    for (const path of FROZEN) {
      assert.equal(gitDiff(path), "", `frozen dirty: ${path}`);
    }
  }

  // creation / night flags not flipped in this phase's new modules
  {
    const core = read("src/lib/safety/trustedPublishAuthorityCore.ts");
    const wrap = read("src/lib/safety/trustedPublishAuthority.ts");
    assert.equal(core.includes("matching_request_creation_enabled"), false);
    assert.equal(wrap.includes("matching_request_creation_enabled"), false);
    assert.equal(/enabled\s*=\s*true/.test(core + wrap), false);
  }

  // Selector call contract: regionCode always null; country from trusted origin
  {
    let seen: unknown = null;
    await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () =>
        okOrigin({ countryCode: "RS", timezone: "Europe/Belgrade" }),
      selectNightPolicy: async (input) => {
        seen = input;
        return [];
      },
    });
    assert.deepEqual(seen, {
      countryCode: "RS",
      regionCode: null,
      originTimezone: "Europe/Belgrade",
      evaluationTime: T0,
    });
  }

  // Thrown injector errors become typed fail-closed
  {
    const res = await buildTrustedPublishAuthority({
      canonical: baseCanonical(),
      evaluationTime: T0,
      resolveTrustedOrigin: async () => {
        throw new Error("network boom");
      },
      selectNightPolicy: selectRows([]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errorKey, "error.night_policy_invalid");
  }

  const ledger = read("docs/architecture/deferred-cleanup.md");
  assert.ok(ledger.includes("2C.3D") || ledger.includes("trusted publish authority"));
  assert.ok(ledger.includes("3D.2") || ledger.includes("2C.3D.2"));
  assert.ok(ledger.includes("3D.2A") || ledger.includes("2C.3D.2A"));
  assert.ok(ledger.includes("31/31 PASS") || ledger.includes("31/31"));
  assert.equal(
    /Forward-only unapplied migration[\s\S]*night_policy_selector_v100/.test(
      ledger,
    ),
    false,
  );

  console.log("trustedPublishAuthority.test.ts: ok");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
