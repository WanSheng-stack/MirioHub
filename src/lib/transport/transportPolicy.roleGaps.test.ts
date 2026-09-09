/**
 * PHASE 6.7B.1A.1A — role/scene field gates, safety reuse, complete-contact
 * reread, i18n, and verify.sql PUBLIC ACL (TEST A–Y).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/transport/transportPolicy.roleGaps.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSafetyFacts } from "@/lib/safety/safetyPolicy";
import {
  COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY,
  COMPLETE_CONTACT_TRANSPORT_REREAD_FAILED_LOG,
  COMPLETE_CONTACT_TRANSPORT_REREAD_MISSING_LOG,
  completeContactTransportRereadResponse,
  interpretCompleteContactTransportReread,
} from "@/lib/posts/completeContactTransport";
import { validateTransportCapability } from "@/lib/transport/transportPolicy";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const ROUND_BASELINE = "22d13695fc1303474e7cd441a4eb80689b72f481";

const travelBase = { lane: "travel" as const, mode: "car" };
const deliverDemand = {
  lane: "deliver" as const,
  postType: "demand" as const,
  mode: "cargo_van",
};
const deliverProvider = {
  lane: "deliver" as const,
  postType: "provider" as const,
  mode: "cargo_van",
};

function rejectKey(
  result: { ok: true } | { ok: false; errorKey: string },
): string {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected reject");
  return result.errorKey;
}

function gitDiff(baseline: string, path: string): string {
  return execFileSync("git", ["diff", "--name-only", baseline, "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

const deliverEscortOk = "error.transport_escort_field_not_allowed";
const travelItemKey = "error.transport_travel_item_field_not_allowed";

// TEST A — Deliver Demand + escort 0 → ok
{
  assert.equal(
    validateTransportCapability({
      ...deliverDemand,
      escortPassengerCount: 0,
    }).ok,
    true,
  );
}

// TEST B — Deliver Demand + escort 1 → ok
{
  assert.equal(
    validateTransportCapability({
      ...deliverDemand,
      escortPassengerCount: 1,
    }).ok,
    true,
  );
}

// TEST C — Deliver Demand + escort 2 → reject
{
  assert.equal(
    rejectKey(
      validateTransportCapability({
        ...deliverDemand,
        escortPassengerCount: 2,
      }),
    ),
    "error.transport_escort_bounds",
  );
}

// TEST D — Deliver Provider + escort 0 → reject
{
  assert.equal(
    rejectKey(
      validateTransportCapability({
        ...deliverProvider,
        escortPassengerCount: 0,
      }),
    ),
    deliverEscortOk,
  );
}

// TEST E — Deliver Provider + escort 1 → reject
{
  assert.equal(
    rejectKey(
      validateTransportCapability({
        ...deliverProvider,
        escortPassengerCount: 1,
      }),
    ),
    deliverEscortOk,
  );
}

// TEST F — Travel + escort 0/1 → reject
{
  for (const postType of ["demand", "provider"] as const) {
    for (const escort of [0, 1]) {
      const extra =
        postType === "demand"
          ? { peopleCount: 1, travelItemUnits: 0 }
          : { peopleCapacity: 1, travelItemUnits: 0 };
      assert.equal(
        rejectKey(
          validateTransportCapability({
            ...travelBase,
            postType,
            ...extra,
            escortPassengerCount: escort,
          }),
        ),
        deliverEscortOk,
        `${postType} escort ${escort}`,
      );
    }
  }
}

// TEST G — Travel + travelItemUnits follows Travel combo rules
{
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "demand",
      peopleCount: 1,
      travelItemUnits: 0,
    }).ok,
    true,
  );
  assert.equal(
    validateTransportCapability({
      ...travelBase,
      postType: "demand",
      peopleCount: 0,
      travelItemUnits: 2,
    }).ok,
    true,
  );
  assert.equal(
    validateTransportCapability({
      lane: "travel",
      postType: "demand",
      mode: "walking",
      peopleCount: 0,
      travelItemUnits: 1,
    }).ok,
    true,
  );
  assert.equal(
    rejectKey(
      validateTransportCapability({
        ...travelBase,
        postType: "demand",
        peopleCount: 0,
        travelItemUnits: 0,
      }),
    ),
    "error.transport_travel_empty",
  );
}

// TEST H — Deliver + travelItemUnits 0 → reject
{
  assert.equal(
    rejectKey(
      validateTransportCapability({
        ...deliverDemand,
        travelItemUnits: 0,
      }),
    ),
    travelItemKey,
  );
  assert.equal(
    rejectKey(
      validateTransportCapability({
        ...deliverProvider,
        travelItemUnits: 0,
      }),
    ),
    travelItemKey,
  );
}

// TEST I — Deliver + travelItemUnits > 0 → reject
{
  assert.equal(
    rejectKey(
      validateTransportCapability({
        ...deliverDemand,
        travelItemUnits: 3,
      }),
    ),
    travelItemKey,
  );
  assert.equal(
    rejectKey(
      validateTransportCapability({
        ...deliverProvider,
        travelItemUnits: 1,
      }),
    ),
    travelItemKey,
  );
}

// TEST J — Safety buy/onsite/errand + peopleCount → reject
{
  for (const category of ["buy", "onsite", "errand"] as const) {
    assert.equal(
      rejectKey(validateSafetyFacts({ category, peopleCount: 1 })),
      "error.safety_facts_invalid_role",
    );
    assert.equal(
      rejectKey(
        validateSafetyFacts({
          category,
          postType: "demand",
          peopleCount: 0,
        }),
      ),
      "error.transport_people_field_not_allowed",
    );
  }
}

// TEST K — Safety facts without postType but with a people field → reject
{
  assert.equal(
    rejectKey(validateSafetyFacts({ category: "travel", peopleCount: 1 })),
    "error.safety_facts_invalid_role",
  );
  assert.equal(
    rejectKey(
      validateSafetyFacts({ category: "deliver", peopleCapacity: 0 }),
    ),
    "error.safety_facts_invalid_role",
  );
}

// TEST L — Safety Travel Demand + peopleCount → ok
{
  const facts = validateSafetyFacts({
    category: "travel",
    postType: "demand",
    peopleCount: 1,
  });
  assert.equal(facts.ok, true);
  const withMode = validateSafetyFacts({
    category: "travel",
    postType: "demand",
    peopleCount: 1,
    travelItemUnits: 0,
    transportMode: "car",
  });
  assert.equal(withMode.ok, true);
}

// TEST M — Safety Travel Provider + peopleCapacity → ok
{
  assert.equal(
    validateSafetyFacts({
      category: "travel",
      postType: "provider",
      peopleCapacity: 2,
    }).ok,
    true,
  );
}

// TEST N — Safety Deliver Demand + escort 0/1 → ok
{
  assert.equal(
    validateSafetyFacts({
      category: "deliver",
      postType: "demand",
      escortPassengerCount: 0,
    }).ok,
    true,
  );
  assert.equal(
    validateSafetyFacts({
      category: "deliver",
      postType: "demand",
      escortPassengerCount: 1,
      transportMode: "cargo_van",
    }).ok,
    true,
  );
}

// TEST O — Safety Deliver Provider + escort → reject
{
  assert.equal(
    rejectKey(
      validateSafetyFacts({
        category: "deliver",
        postType: "provider",
        escortPassengerCount: 0,
      }),
    ),
    deliverEscortOk,
  );
  assert.equal(
    rejectKey(
      validateSafetyFacts({
        category: "deliver",
        postType: "provider",
        escortPassengerCount: 1,
        transportMode: "cargo_van",
      }),
    ),
    deliverEscortOk,
  );
}

// TEST P — Safety Deliver + travelItemUnits → reject
{
  assert.equal(
    rejectKey(
      validateSafetyFacts({
        category: "deliver",
        travelItemUnits: 0,
      }),
    ),
    travelItemKey,
  );
  assert.equal(
    rejectKey(
      validateSafetyFacts({
        category: "deliver",
        postType: "demand",
        travelItemUnits: 2,
      }),
    ),
    travelItemKey,
  );
}

function reread(input: {
  error?: object | null;
  row?: { transport_mode?: string | null } | null;
}) {
  return interpretCompleteContactTransportReread({
    intendedMode: "car",
    error: input.error,
    row: input.row,
  });
}

// TEST Q — secondary SELECT error → 500 submit_failed, not conflict
{
  const interpreted = reread({
    error: { message: "boom", details: "d", hint: "h" },
    row: { transport_mode: "van" },
  });
  assert.equal(interpreted.kind, "failed");
  if (interpreted.kind !== "failed") throw new Error("expected failed");
  assert.equal(interpreted.errorKey, "error.submit_failed");
  assert.equal(interpreted.log, COMPLETE_CONTACT_TRANSPORT_REREAD_FAILED_LOG);
  const response = completeContactTransportRereadResponse(interpreted);
  assert.equal(response.ok, false);
  if (response.ok) throw new Error("expected fail response");
  assert.equal(response.status, 500);
  assert.equal(response.errorKey, "error.submit_failed");
  assert.notEqual(response.errorKey, COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY);
}

// TEST R — secondary SELECT no row → safe fail, not existing-transport conflict
{
  const interpreted = reread({ error: null, row: null });
  assert.equal(interpreted.kind, "failed");
  if (interpreted.kind !== "failed") throw new Error("expected failed");
  assert.equal(interpreted.errorKey, "error.submit_failed");
  assert.equal(interpreted.log, COMPLETE_CONTACT_TRANSPORT_REREAD_MISSING_LOG);
  const response = completeContactTransportRereadResponse(interpreted);
  assert.equal(response.ok, false);
  if (response.ok) throw new Error("expected fail response");
  assert.equal(response.status, 500);
  assert.notEqual(response.errorKey, COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY);
}

// TEST S — secondary SELECT same mode → idempotent success
{
  const interpreted = reread({ error: null, row: { transport_mode: "car" } });
  assert.equal(interpreted.kind, "idempotent");
  assert.deepEqual(completeContactTransportRereadResponse(interpreted), {
    ok: true,
  });
}

// TEST T — secondary SELECT different mode → conflict, no overwrite signal
{
  const interpreted = reread({ error: null, row: { transport_mode: "van" } });
  assert.equal(interpreted.kind, "conflict");
  if (interpreted.kind !== "conflict") throw new Error("expected conflict");
  assert.equal(interpreted.errorKey, COMPLETE_CONTACT_TRANSPORT_CONFLICT_KEY);
  const response = completeContactTransportRereadResponse(interpreted);
  assert.equal(response.ok, false);
  if (response.ok) throw new Error("expected fail response");
  assert.equal(response.status, 400);
  assert.equal(response.errorKey, "error.transport_mode_already_set");
}

// TEST U — logs omit Supabase message/details/hint, post id, owner, transport
{
  const interpreted = reread({
    error: {
      message: "duplicate key post-id-aaa owner-bbb transport-van",
      details: "secret-details",
      hint: "secret-hint",
    },
    row: { transport_mode: "van" },
  });
  assert.equal(interpreted.kind, "failed");
  const packed = JSON.stringify(interpreted);
  assert.equal(packed.includes("secret-details"), false);
  assert.equal(packed.includes("secret-hint"), false);
  assert.equal(packed.includes("post-id-aaa"), false);
  assert.equal(packed.includes("owner-bbb"), false);
  assert.equal(packed.includes("transport-van"), false);
  assert.equal(packed.includes("duplicate key"), false);
  assert.equal(interpreted.kind === "failed" && interpreted.log.includes("message"), false);
  const contactSrc = read("src/app/api/posts/complete-contact/route.ts");
  assert.ok(contactSrc.includes("interpretCompleteContactTransportReread"));
  assert.ok(contactSrc.includes("console.error(response.log)"));
  assert.equal(contactSrc.includes("rereadError.message"), false);
  assert.equal(contactSrc.includes("rereadError.details"), false);
  assert.equal(contactSrc.includes("rereadError.hint"), false);
}

// TEST V — four new browser errorKeys exist in zh/en/sr
{
  const keys = [
    "invalid_transport_mode",
    "transport_mode_already_set",
    "transport_escort_field_not_allowed",
    "transport_travel_item_field_not_allowed",
  ];
  for (const locale of ["zh", "en", "sr"] as const) {
    const messages = JSON.parse(read(`src/messages/${locale}.json`)) as {
      error: Record<string, string>;
    };
    for (const key of keys) {
      const text = messages.error[key];
      assert.equal(typeof text, "string", `${locale} ${key}`);
      assert.ok(text.trim().length > 0, `${locale} ${key}`);
      assert.equal(text.includes("escortPassengerCount"), false, key);
      assert.equal(text.includes("travelItemUnits"), false, key);
      assert.equal(text.includes("transport_mode"), false, key);
    }
  }
}

const verifySql = read(
  "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.verify.sql",
);

// TEST W — verify.sql no longer uses has_function_privilege('public'
{
  assert.equal(verifySql.includes("has_function_privilege('public'"), false);
  assert.equal(verifySql.includes('has_function_privilege("public"'), false);
}

// TEST X — verify.sql uses catalog ACL for PUBLIC (grantee = 0)
{
  assert.ok(verifySql.includes("aclexplode"));
  assert.ok(verifySql.includes("acldefault('f'"));
  assert.ok(verifySql.includes("a.grantee = 0"));
  assert.ok(verifySql.includes("public_can_execute"));
  assert.ok(verifySql.includes("anon_can_execute"));
  assert.ok(verifySql.includes("authenticated_can_execute"));
  assert.ok(verifySql.includes("service_role_can_execute"));
  assert.equal(verifySql.includes("FROM posts"), false);
  assert.equal(verifySql.includes("INSERT INTO"), false);
}

// TEST Y — main migration signature / body / V1 allowlist / ACL unchanged
{
  const mainSql =
    "supabase/migrations/20260909000001_stage1_transport_mode_boundary_v91.sql";
  assert.equal(gitDiff(ROUND_BASELINE, mainSql), "");
  const migration = read(mainSql);
  assert.ok(
    /CREATE OR REPLACE FUNCTION public\.insert_stage1_post_v86\(/.test(migration),
  );
  assert.equal(
    (migration.match(/CREATE OR REPLACE FUNCTION public\.insert_stage1_post_v86/g) || [])
      .length,
    1,
  );
  assert.ok(migration.includes("p_client_request_id uuid"));
  assert.ok(migration.includes("transport_mode"));
  assert.ok(migration.includes("'van'"));
  assert.equal(migration.includes("cargo_van"), false);
  assert.ok(
    migration.includes("REVOKE ALL ON FUNCTION public.insert_stage1_post_v86"),
  );
  assert.ok(migration.includes("FROM PUBLIC"));
  assert.ok(migration.includes("FROM anon"));
  assert.ok(migration.includes("FROM authenticated"));
  assert.equal(gitDiff(ROUND_BASELINE, "supabase/init.sql"), "");
}

{
  const safetySrc = read("src/lib/safety/safetyPolicy.ts");
  assert.ok(safetySrc.includes("validateTransportDeclaredFields"));
  assert.ok(safetySrc.includes("validateTransportCapability"));
  assert.ok(safetySrc.includes("not an authorization boundary"));
}

console.log("transportPolicy.roleGaps.test.ts: ok");
