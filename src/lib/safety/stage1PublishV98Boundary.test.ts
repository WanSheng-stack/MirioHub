/**
 * PHASE 6.7C.2B.2A — v98 INSERT mapping, delivery_mode, CHECK precision, reducer.
 * Does not execute SQL or connect to Supabase.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/safety/stage1PublishV98Boundary.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CanonicalStage1Error,
  hashCanonicalStage1,
  normalizeCanonicalStage1,
  toRpcStage1Payload,
} from "@/lib/auth/canonicalStage1Core";
import { publishTransportModesForSubtype } from "@/lib/auth/publishTransportMode";
import { buildPayloadFromForm } from "@/lib/post-form/buildPayload";
import {
  initialFormState,
  reducePostFormState,
} from "@/lib/post-form/usePostFormState";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const migration = read(
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.sql",
);
const verifySql = read(
  "supabase/migrations/20260915000001_stage1_publish_service_subtype_v98.verify.sql",
);
const postsV2 = read("supabase/posts_v2_migration.sql");
const postsInit = read("supabase/posts_init.sql");

function insertFnBody(): string {
  const start = migration.indexOf(
    "CREATE FUNCTION public.insert_stage1_post_v98(",
  );
  const end = migration.indexOf(
    "REVOKE ALL ON FUNCTION public.insert_stage1_post_v98(",
    start,
  );
  assert.ok(start >= 0 && end > start);
  return migration.slice(start, end);
}

function extractInsertMapping(body: string): {
  columns: string[];
  values: string[];
} {
  const insertIdx = body.lastIndexOf("INSERT INTO public.posts (");
  assert.ok(insertIdx > 0);
  const colsStart = body.indexOf("(", insertIdx) + 1;
  const colsEnd = body.indexOf(") VALUES (", colsStart);
  assert.ok(colsEnd > colsStart);
  const valuesStart = colsEnd + ") VALUES (".length;
  let depth = 1;
  let i = valuesStart;
  for (; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const cols = body
    .slice(colsStart, colsEnd)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Split VALUES by top-level commas
  const rawVals = body.slice(valuesStart, i);
  const values: string[] = [];
  let cur = "";
  let d = 0;
  let inStr = false;
  for (let j = 0; j < rawVals.length; j++) {
    const ch = rawVals[j];
    if (ch === "'" && rawVals[j - 1] !== "\\") inStr = !inStr;
    if (!inStr) {
      if (ch === "(") d += 1;
      if (ch === ")") d -= 1;
      if (ch === "," && d === 0) {
        values.push(cur.trim());
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) values.push(cur.trim());
  assert.equal(cols.length, values.length, "INSERT cols/values length mismatch");
  return { columns: cols, values };
}

const insertBody = insertFnBody();
const { columns, values } = extractInsertMapping(insertBody);

// ── Catalog evidence (frozen formal migrations, not live probe) ─────────────
assert.ok(
  postsV2.includes(
    "max_companions integer check (max_companions is null or (max_companions >= 1 and max_companions <= 4))",
  ),
);
assert.ok(postsInit.includes("transport_mode text"));
assert.ok(postsInit.includes("'van'"));
assert.ok(migration.includes("posts.max_companions missing or not nullable integer"));
assert.equal(migration.includes("posts_max_companions_check"), false);
assert.equal(migration.includes("max_companions >= 0 AND max_companions <= 4"), false);
assert.equal(
  /DROP CONSTRAINT(?:\s+IF EXISTS)?\s+posts_max_companions_check/i.test(migration),
  false,
);
assert.equal(
  /DROP CONSTRAINT %I[\s\S]{0,200}max_companions/i.test(migration),
  false,
);
assert.ok(migration.includes("v_max_companions := NULL"));
assert.ok(migration.includes("v_max_companions := v_people"));

// Frozen posts_init V1 transport CHECK definition (exact-name replace only)
const frozenTransportCheckDef =
  "CHECK (((transport_mode IS NULL) OR (transport_mode = ANY " +
  "(ARRAY['walking'::text, 'scooter'::text, 'bicycle'::text, " +
  "'motorbike'::text, 'subway'::text, 'bus'::text, 'train'::text, " +
  "'flight'::text, 'car'::text, 'van'::text]))))";
assert.ok(migration.includes("''walking''::text"));
assert.ok(migration.includes("posts_transport_mode_check missing"));
assert.ok(migration.includes("DROP CONSTRAINT posts_transport_mode_check"));
assert.equal(migration.includes("not uniquely identifiable"), false);
assert.equal(/~[*] 'transport_mode'/.test(migration), false);

// ── INSERT final field mapping: max_companions uses v_max_companions ─────────
{
  const idx = columns.indexOf("max_companions");
  assert.ok(idx >= 0, "INSERT must list max_companions column");
  assert.equal(values[idx], "v_max_companions");
  assert.equal(values[idx].includes("p_post_payload"), false);
  const escortIdx = columns.indexOf("escort_seats");
  assert.equal(values[escortIdx], "v_escort_seats");
  const deliveryIdx = columns.indexOf("delivery_mode");
  assert.equal(values[deliveryIdx], "v_delivery_mode");
  const shareIdx = columns.indexOf("share_mode");
  assert.equal(values[shareIdx], "v_share_mode");
}

// Executable max_companions write truth: passenger/PWSI → 1..4; else NULL
{
  const pIdx = insertBody.lastIndexOf("v98_normalize_passenger_zero_counts");
  const pBlock = insertBody.slice(pIdx, pIdx + 700);
  assert.ok(pBlock.includes("v_max_companions := v_people"));
  assert.equal(pBlock.includes("v_max_companions := 0"), false);

  const pwsiIdx = insertBody.lastIndexOf(
    "v_service_subtype = 'passenger_with_small_item'",
  );
  const pwsiBlock = insertBody.slice(pwsiIdx, pwsiIdx + 500);
  assert.ok(pwsiBlock.includes("v_max_companions := v_people"));

  const smallIdx = insertBody.lastIndexOf(
    "v_service_subtype = 'small_item_only'",
  );
  const smallBlock = insertBody.slice(smallIdx, smallIdx + 250);
  assert.ok(smallBlock.includes("v_max_companions := NULL"));

  const cargoOnly = insertBody.slice(
    insertBody.lastIndexOf("v_service_subtype = 'cargo_only'"),
    insertBody.lastIndexOf("v98_normalize_cargo_escort_demand_provider"),
  );
  assert.ok(cargoOnly.includes("v_max_companions := NULL"));

  const escortNorm = insertBody.slice(
    insertBody.lastIndexOf("v98_normalize_cargo_escort_demand_provider"),
    insertBody.lastIndexOf("Buy/Onsite/Errand"),
  );
  assert.ok(escortNorm.includes("v_max_companions := NULL"));
  assert.equal(escortNorm.includes("v_max_companions := 0"), false);

  const buyBlock = insertBody.slice(
    insertBody.lastIndexOf("Buy/Onsite/Errand"),
    insertBody.lastIndexOf("INSERT INTO public.posts"),
  );
  assert.ok(buyBlock.includes("v_max_companions := NULL"));
}

// Executable branch: delivery_mode only deliver+demand
{
  assert.ok(insertBody.includes("error.invalid_delivery_mode"));
  assert.ok(
    insertBody.includes(
      "v_category = 'deliver' AND v_post_type = 'demand'",
    ),
  );
  const demandBlock = insertBody.slice(
    insertBody.indexOf("v_category = 'deliver' AND v_post_type = 'demand'"),
    insertBody.indexOf("Independent field normalization"),
  );
  assert.ok(demandBlock.includes("'spot'"));
  assert.ok(demandBlock.includes("'door'"));
  assert.ok(demandBlock.includes("error.invalid_delivery_mode"));
}

// Executable subtype×transport branches (not marker-only)
{
  const peopleIdx = insertBody.lastIndexOf(
    "v_service_subtype IN ('passenger', 'passenger_with_small_item')",
  );
  assert.ok(peopleIdx > 0);
  const peopleBlock = insertBody.slice(peopleIdx, peopleIdx + 350);
  assert.ok(peopleBlock.includes("IS DISTINCT FROM 'car'"));
  assert.ok(peopleBlock.includes("error.illegal_transport_combo"));

  const landMarker = insertBody.lastIndexOf("v98_cargo_escort_land_only");
  assert.ok(landMarker > 0);
  const escortTransport = insertBody.slice(landMarker, landMarker + 900);
  assert.ok(escortTransport.includes("'cargo_boat'"));
  assert.ok(escortTransport.includes("'private_cargo_boat'"));
  assert.ok(escortTransport.includes("'cargo_van'"));
  assert.ok(escortTransport.includes("error.illegal_transport_combo"));
}

// Demand/Provider escort normalize executable branch
{
  const marker = insertBody.lastIndexOf(
    "v98_normalize_cargo_escort_demand_provider",
  );
  assert.ok(marker > 0);
  const block = insertBody.slice(marker, marker + 700);
  assert.ok(block.includes("v_post_type = 'demand'"));
  assert.ok(block.includes("v_escort_seats := 1"));
  assert.ok(block.includes("v_escort_seats := 0"));
  assert.ok(block.includes("v_max_companions := NULL"));
  assert.ok(block.includes("v_share_mode := NULL"));
}

// passenger zeros counts in executable normalize
{
  const pIdx = insertBody.lastIndexOf("v98_normalize_passenger_zero_counts");
  assert.ok(pIdx > 0);
  const block = insertBody.slice(pIdx, pIdx + 600);
  assert.ok(block.includes("v_count_small := 0"));
  assert.ok(block.includes("v_count_xlarge := 0"));
  assert.ok(block.includes("v_max_companions := v_people"));
}

// ── Transport CHECK: exact name + full frozen definition only ───────────────
{
  const checkDo = migration.slice(
    migration.indexOf("Expand posts.transport_mode CHECK"),
    migration.indexOf("Passkey ACTIVE"),
  );
  assert.equal(checkDo.includes("ILIKE '%transport_mode%'"), false);
  assert.ok(checkDo.includes("c.conname = 'posts_transport_mode_check'"));
  assert.ok(checkDo.includes("DROP CONSTRAINT posts_transport_mode_check"));
  assert.ok(checkDo.includes("definition drift"));
  assert.ok(checkDo.includes("posts_transport_mode_check missing"));
  assert.equal(checkDo.includes("not uniquely identifiable"), false);
  assert.equal(checkDo.includes("cargo_van''"), false); // no token fallback search
  assert.equal(/FOR r IN[\s\S]*transport_mode/.test(checkDo), false);
  // Other CHECKs that mention transport_mode must not be delete targets
  assert.equal(checkDo.includes("EXECUTE format('ALTER TABLE public.posts DROP CONSTRAINT"), false);
  assert.ok(
    checkDo.includes(frozenTransportCheckDef.replace(/'/g, "''")) ||
      checkDo.includes("''walking''::text, ''scooter''::text"),
  );
}

// ── Canonical delivery_mode parity ──────────────────────────────────────────
const travelBase: Record<string, unknown> = {
  post_type: "demand",
  category: "travel",
  service_subtype: "passenger",
  title: "",
  origin_address: "A",
  destination_address: "B",
  departure_date: "2026-09-10",
  departure_time: "14:30",
  time_buffer: 30,
  waypoints: [],
  share_mode: "share",
  delivery_mode: "spot",
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
};

assert.equal(normalizeCanonicalStage1(travelBase).delivery_mode, null);
assert.equal(normalizeCanonicalStage1(travelBase).max_companions, 1);
assert.equal(
  normalizeCanonicalStage1({
    ...travelBase,
    service_subtype: "small_item_only",
    transport_mode: "walking",
    max_companions: 0,
    escort_seats: 0,
    share_mode: null,
  }).max_companions,
  null,
);
assert.equal(
  normalizeCanonicalStage1({
    ...travelBase,
    category: "deliver",
    service_subtype: "cargo_only",
    transport_mode: "cargo_van",
    delivery_mode: "door",
    share_mode: null,
    escort_seats: 0,
    max_companions: 0,
  }).max_companions,
  null,
);
assert.equal(
  normalizeCanonicalStage1({
    ...travelBase,
    category: "deliver",
    service_subtype: "cargo_only",
    transport_mode: "cargo_van",
    delivery_mode: "door",
    share_mode: null,
    escort_seats: 0,
    max_companions: 0,
  }).delivery_mode,
  "door",
);
assert.equal(
  normalizeCanonicalStage1({
    ...travelBase,
    category: "deliver",
    post_type: "provider",
    service_subtype: "cargo_only",
    transport_mode: "cargo_van",
    delivery_mode: "spot",
    share_mode: null,
    escort_seats: 0,
    max_companions: 0,
  }).delivery_mode,
  null,
);
assert.equal(
  normalizeCanonicalStage1({
    ...travelBase,
    category: "buy",
    service_subtype: null,
    transport_mode: null,
    delivery_mode: "door",
    share_mode: null,
    escort_seats: 0,
    max_companions: 0,
  }).delivery_mode,
  null,
);
assert.equal(
  normalizeCanonicalStage1({
    ...travelBase,
    category: "onsite",
    service_subtype: null,
    transport_mode: null,
    delivery_mode: "spot",
    share_mode: null,
    escort_seats: 0,
    max_companions: 0,
  }).delivery_mode,
  null,
);
assert.throws(
  () =>
    normalizeCanonicalStage1({
      ...travelBase,
      category: "deliver",
      service_subtype: "cargo_only",
      transport_mode: "cargo_van",
      delivery_mode: "express",
      share_mode: null,
      escort_seats: 0,
      max_companions: 0,
    }),
  (err: unknown) =>
    err instanceof CanonicalStage1Error &&
    err.errorKey === "error.invalid_delivery_mode",
);

// Direct RPC-bypass structure: SQL final authority does not re-read payload for delivery_mode INSERT
{
  const deliveryIdx = columns.indexOf("delivery_mode");
  assert.equal(values[deliveryIdx], "v_delivery_mode");
  assert.equal(values[deliveryIdx].includes("p_post_payload"), false);
  const elseNull = insertBody.indexOf("ELSE\n    v_delivery_mode := NULL;");
  assert.ok(elseNull > 0);
  assert.ok(
    insertBody.includes("RAISE EXCEPTION 'error.invalid_delivery_mode'"),
  );
}

// ── Real reducer/state behavior ─────────────────────────────────────────────
{
  const state = {
    ...initialFormState,
    service_subtype: "small_item_only" as const,
    transport_mode: "walking" as const,
    escort_seats: 0,
    max_companions: 0,
  };
  const next = reducePostFormState(state, {
    type: "SET_SERVICE_SUBTYPE",
    service_subtype: "passenger",
  });
  assert.equal(next.service_subtype, "passenger");
  assert.equal(next.transport_mode, "");
  assert.deepEqual(
    [...publishTransportModesForSubtype("travel", "passenger")],
    ["car"],
  );
}

{
  let state = reducePostFormState(initialFormState, {
    type: "SET_CATEGORY",
    category: "deliver",
  });
  state = reducePostFormState(state, {
    type: "SET_SERVICE_SUBTYPE",
    service_subtype: "cargo_only",
  });
  state = reducePostFormState(state, {
    type: "SET_FIELD",
    field: "transport_mode",
    value: "cargo_boat",
  });
  // cargo_boat is legal in SQL for cargo_only but omitted from land UI list —
  // SET_FIELD can still set it; switching to escort must clear it.
  assert.equal(state.transport_mode, "cargo_boat");
  state = reducePostFormState(state, {
    type: "SET_SERVICE_SUBTYPE",
    service_subtype: "cargo_with_escort",
  });
  assert.equal(state.transport_mode, "");
  assert.equal(
    (
      publishTransportModesForSubtype(
        "deliver",
        "cargo_with_escort",
      ) as readonly string[]
    ).includes("cargo_boat"),
    false,
  );
}

{
  // Hidden escort/share residue must not survive real SET_POST_TYPE reset,
  // and provider+cargo_with_escort payload must not forge escort headcount.
  let state = reducePostFormState(initialFormState, {
    type: "SET_CATEGORY",
    category: "deliver",
  });
  state = reducePostFormState(state, {
    type: "SET_SERVICE_SUBTYPE",
    service_subtype: "cargo_with_escort",
  });
  state = reducePostFormState(state, {
    type: "SET_FIELD",
    field: "escort_seats",
    value: 9,
  });
  state = reducePostFormState(state, {
    type: "SET_SHARE_MODE",
    share_mode: "private",
  });
  assert.equal(state.share_mode, "private");
  assert.equal(state.escort_seats, 1);

  // Plant residue that UI might still hold, then switch post_type via reducer.
  state = reducePostFormState(state, {
    type: "SET_FIELD",
    field: "escort_seats",
    value: 9,
  });
  assert.equal(state.escort_seats, 9);

  state = reducePostFormState(state, {
    type: "SET_POST_TYPE",
    post_type: "provider",
  });
  assert.equal(state.category, "travel");
  assert.equal(state.service_subtype, "passenger");
  assert.equal(state.share_mode, "share");
  assert.notEqual(state.escort_seats, 9);
  assert.ok(state.escort_seats >= 1 && state.escort_seats <= 4);

  const providerEscort = buildPayloadFromForm(
    {
      ...initialFormState,
      post_type: "provider",
      category: "deliver",
      service_subtype: "cargo_with_escort",
      transport_mode: "cargo_van",
      origin_address: "A",
      destination_address: "B",
      estimated_kms: 10,
      raw_phone_local: "601234567",
      raw_license_plate: "BG123AB",
      escort_seats: 9,
      max_companions: 3,
      share_mode: "share",
    },
    1,
    1,
  );
  assert.equal(providerEscort.ok, true);
  if (providerEscort.ok) {
    assert.equal(providerEscort.payload.escort_seats, 0);
    assert.equal(providerEscort.payload.share_mode, null);
    assert.equal(providerEscort.payload.max_companions, 0);
  }
}

// Canonical hash uses final NULL max_companions (not form 0)
{
  const withZero = normalizeCanonicalStage1({
    ...travelBase,
    category: "deliver",
    service_subtype: "cargo_only",
    transport_mode: "cargo_van",
    delivery_mode: "spot",
    share_mode: null,
    escort_seats: 0,
    max_companions: 0,
  });
  assert.equal(withZero.max_companions, null);
  const h1 = hashCanonicalStage1(withZero, 10, 100);
  const h2 = hashCanonicalStage1({ ...withZero, max_companions: null }, 10, 100);
  assert.equal(h1, h2);
  assert.equal(toRpcStage1Payload(withZero, 100).max_companions, null);
}

// ── Verify + static proofs ──────────────────────────────────────────────────
assert.ok(verifySql.includes("insert_writes_max_companions"));
assert.ok(verifySql.includes("delivery_mode_authority"));
assert.ok(verifySql.includes("insert_v98 max_companions + delivery"));
assert.ok(verifySql.includes("posts.max_companions CHECK remains 1..4"));
assert.ok(verifySql.includes("posts_transport_mode_check exact name"));
assert.ok(verifySql.includes(">=\\s*1"));
assert.ok(verifySql.includes("!~* '>=\\s*0'"));
assert.equal(/SELECT\s+p\.prosrc\b/i.test(verifySql), false);
assert.equal(migration.includes("ILIKE '%transport_mode%'"), false);
assert.equal(migration.includes("posts_max_companions_check"), false);

for (const src of [
  read("src/app/api/posts/trusted-publish/route.ts"),
  read("src/app/api/posts/shadow-draft/route.ts"),
  read("src/app/api/auth/passkey/verify/route.ts"),
]) {
  assert.ok(src.includes("_v98"));
  assert.equal(src.includes("insert_stage1_post_v86"), false);
  assert.equal(src.includes("publish_active_post_idempotent_v86"), false);
  assert.equal(src.includes("create_shadow_draft_idempotent_v86"), false);
  assert.equal(src.includes("commit_phase3_business_idempotent_v86"), false);
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, acc);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

let insertHits = 0;
let v86Hits = 0;
for (const file of walk(join(repoRoot, "src"))) {
  const src = readFileSync(file, "utf8");
  const rel = file.slice(repoRoot.length + 1).replace(/\\/g, "/");
  if (rel.includes(".test.")) continue;
  if (/from\(["']posts["']\)\s*\.insert/.test(src)) insertHits += 1;
  if (
    (rel.includes("app/api/") ||
      rel.includes("components/") ||
      rel.includes("lib/auth/") ||
      rel.includes("lib/post-form/")) &&
    /insert_stage1_post_v86|publish_active_post_idempotent_v86|create_shadow_draft_idempotent_v86|commit_phase3_business_idempotent_v86/.test(
      src,
    )
  ) {
    v86Hits += 1;
  }
}
assert.equal(insertHits, 0);
assert.equal(v86Hits, 0);

assert.ok(read("src/messages/en.json").includes("invalid_delivery_mode"));
assert.ok(read("src/messages/zh.json").includes("invalid_delivery_mode"));
assert.ok(read("src/messages/sr.json").includes("invalid_delivery_mode"));

console.log("stage1PublishV98Boundary.test.ts: ok");
console.log("v98 SQL is not applied remotely.");
