-- PHASE 6.7C.2C.3F / v101A — atomic trusted publish authority Stage-1 insert.
-- Forward-only internal helper only. Does NOT create outer publish RPCs.
-- Does NOT cut over APIs. Does NOT revoke/alter v98. Does NOT touch posts_update_own.
-- Does NOT enable matching creation. Does NOT enable RS night.
-- MANUAL APPLY REQUIRED. Do not auto-apply from Cursor.
-- Explicit BEGIN/COMMIT. If a statement fails, execute ROLLBACK.
--
-- Payload-hash boundary (explicit):
--   v98 payload_hash covers the existing canonical Stage-1 publish payload only.
--   v101A stores the caller-supplied hash as-is; it does NOT claim that hash already
--   includes the four authority fields. v101B outer writer must generate and lock a
--   versioned server hash that includes origin_gps / origin_country_code /
--   origin_timezone / night_policy_version before exact-retry. APIs must not call
--   insert_stage1_post_v101 before that v101B cutover.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Fail-fast deployed-boundary guard
-- Does not call v98 writers. Does not insert/update business rows.
-- Does not depend on schema_migrations history.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_missing text;
  v_typ text;
  v_nullable text;
  v_default text;
  v_type_schema text;
  v_typname text;
  v_creation boolean;
  v_cfg_n integer;
  v_seed_n integer;
  v_enabled boolean;
  v_ext_schema text;
BEGIN
  IF to_regclass('public.posts') IS NULL THEN
    RAISE EXCEPTION 'v101A_guard: public.posts missing';
  END IF;

  -- Four authority columns exist with v96-compatible shapes (nullable, no default).
  SELECT need.attname INTO v_missing
  FROM (
    VALUES
      ('origin_gps'),
      ('origin_country_code'),
      ('origin_timezone'),
      ('night_policy_version')
  ) AS need(attname)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.posts'::regclass
      AND a.attname = need.attname
      AND a.attnum > 0
      AND NOT a.attisdropped
  )
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'v101A_guard: posts authority column missing: %', v_missing;
  END IF;

  SELECT
    pg_catalog.format_type(a.atttypid, a.atttypmod),
    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END,
    pg_catalog.pg_get_expr(ad.adbin, ad.adrelid),
    tn.nspname,
    t.typname
  INTO v_typ, v_nullable, v_default, v_type_schema, v_typname
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
  JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = 'public.posts'::regclass
    AND a.attname = 'origin_gps'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  -- Exact typmod lock (v97 live-verified pattern). Reject bare geography /
  -- wrong SRID / non-Point / geometry.
  IF v_type_schema IS DISTINCT FROM 'extensions'
     OR v_typname IS DISTINCT FROM 'geography'
     OR v_typ NOT IN (
       'geography(Point,4326)',
       'extensions.geography(Point,4326)'
     ) THEN
    RAISE EXCEPTION 'v101A_guard: origin_gps type/typmod drift: %',
      COALESCE(v_typ, 'null');
  END IF;
  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'v101A_guard: origin_gps must remain nullable';
  END IF;
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'v101A_guard: origin_gps must have no column default';
  END IF;

  SELECT
    pg_catalog.format_type(a.atttypid, a.atttypmod),
    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END,
    pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)
  INTO v_typ, v_nullable, v_default
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = 'public.posts'::regclass
    AND a.attname = 'origin_country_code'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_typ IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'v101A_guard: origin_country_code type drift: %', v_typ;
  END IF;
  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'v101A_guard: origin_country_code must remain nullable';
  END IF;
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'v101A_guard: origin_country_code must have no column default';
  END IF;

  SELECT
    pg_catalog.format_type(a.atttypid, a.atttypmod),
    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END,
    pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)
  INTO v_typ, v_nullable, v_default
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = 'public.posts'::regclass
    AND a.attname = 'origin_timezone'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_typ IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'v101A_guard: origin_timezone type drift: %', v_typ;
  END IF;
  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'v101A_guard: origin_timezone must remain nullable';
  END IF;
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'v101A_guard: origin_timezone must have no column default';
  END IF;

  SELECT
    pg_catalog.format_type(a.atttypid, a.atttypmod),
    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END,
    pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)
  INTO v_typ, v_nullable, v_default
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = 'public.posts'::regclass
    AND a.attname = 'night_policy_version'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_typ IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION 'v101A_guard: night_policy_version type drift: %', v_typ;
  END IF;
  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'v101A_guard: night_policy_version must remain nullable';
  END IF;
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'v101A_guard: night_policy_version must have no column default';
  END IF;

  SELECT n.nspname INTO v_ext_schema
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'postgis';
  IF v_ext_schema IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION 'v101A_guard: PostGIS schema must be extensions (got %)',
      COALESCE(v_ext_schema, 'missing');
  END IF;
  IF to_regtype('public.geometry') IS NOT NULL
     OR to_regtype('public.geography') IS NOT NULL THEN
    RAISE EXCEPTION 'v101A_guard: public.geometry/public.geography must not exist';
  END IF;

  IF to_regprocedure(
    'public.insert_stage1_post_v98(uuid,uuid,text,text,jsonb,bigint,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101A_guard: insert_stage1_post_v98 missing';
  END IF;
  IF (
    SELECT count(*)::int
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'insert_stage1_post_v98'
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'v101A_guard: insert_stage1_post_v98 must be unique';
  END IF;

  IF to_regprocedure(
    'public.publish_active_post_idempotent_v98(uuid,uuid,text,jsonb,bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101A_guard: publish_active_post_idempotent_v98 missing';
  END IF;
  IF to_regprocedure(
    'public.create_shadow_draft_idempotent_v98(uuid,uuid,text,text,jsonb,bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101A_guard: create_shadow_draft_idempotent_v98 missing';
  END IF;
  IF to_regprocedure(
    'public.commit_phase3_business_idempotent_v98(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101A_guard: commit_phase3_business_idempotent_v98 missing';
  END IF;

  IF to_regprocedure(
    'public.match_request_admission_post_facts_v99(uuid,uuid,text,text,text,date,text,text,text,text,integer,integer,integer,integer,integer,integer,text,text,jsonb,extensions.geography,extensions.geography,text,text,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101A_guard: v99A facts helper missing';
  END IF;
  IF to_regprocedure(
    'public.create_match_request_v99(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,bigint,text,bigint,bigint,integer,integer,integer,text,boolean,boolean)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101A_guard: create_match_request_v99 missing';
  END IF;
  IF to_regprocedure(
    'public.select_night_service_policy_v100(text,text,text,timestamptz)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101A_guard: select_night_service_policy_v100 missing';
  END IF;

  IF to_regprocedure(
    'public.insert_stage1_post_v101(uuid,uuid,text,text,jsonb,bigint,text,extensions.geography,text,text,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v101A_guard: insert_stage1_post_v101 already exists — refuse re-apply';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'insert_stage1_post_v101'
  ) THEN
    RAISE EXCEPTION 'v101A_guard: insert_stage1_post_v101 name already present';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'publish_active_post_idempotent_v101',
        'create_shadow_draft_idempotent_v101',
        'commit_phase3_business_idempotent_v101',
        'insert_stage1_post_v102'
      )
  ) THEN
    RAISE EXCEPTION 'v101A_guard: unexpected v101 outer / v102 function present';
  END IF;

  IF to_regclass('public.system_configs') IS NULL THEN
    RAISE EXCEPTION 'v101A_guard: system_configs missing';
  END IF;
  SELECT count(*)::int INTO v_cfg_n
  FROM public.system_configs
  WHERE id = 1;
  IF v_cfg_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'v101A_guard: system_configs id=1 must exist exactly once (got %)', v_cfg_n;
  END IF;
  SELECT matching_request_creation_enabled INTO v_creation
  FROM public.system_configs
  WHERE id = 1;
  IF v_creation IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v101A_guard: matching_request_creation_enabled must be false';
  END IF;

  SELECT count(*)::int INTO v_seed_n
  FROM public.night_service_policies p
  WHERE p.country_code = 'RS'
    AND p.region_code IS NULL
    AND p.policy_version = 1;
  IF v_seed_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'v101A_guard: RS seed version 1 row_count must be 1 (got %)', v_seed_n;
  END IF;
  SELECT p.enabled INTO v_enabled
  FROM public.night_service_policies p
  WHERE p.country_code = 'RS'
    AND p.region_code IS NULL
    AND p.policy_version = 1;
  IF v_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v101A_guard: RS seed enabled must be false';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Internal Stage-1 insert with atomic authority columns
-- Frozen business body from insert_stage1_post_v98. GPS / country / timezone
-- are required server authority inputs. night_policy_version is nullable when
-- the selector returns zero enabled rows. All four are validated then written
-- in the SAME posts INSERT (no post-insert UPDATE).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.insert_stage1_post_v101(
  p_user_id               uuid,
  p_client_request_id     uuid,
  p_payload_hash          text,
  p_status                text,
  p_post_payload          jsonb,
  p_server_fee_minor      bigint,
  p_fallback_reason       text,
  p_origin_gps            extensions.geography,
  p_origin_country_code   text,
  p_origin_timezone       text,
  p_night_policy_version  integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
  v_post_type text;
  v_category text;
  v_subtype_raw text;
  v_service_subtype text;
  v_transport_raw text;
  v_transport_mode text;
  v_share_raw text;
  v_share_mode text;
  v_delivery_raw text;
  v_delivery_mode text;
  v_count_small integer;
  v_count_medium integer;
  v_count_large integer;
  v_count_xlarge integer;
  v_escort_seats integer;
  v_max_companions integer;
  v_people integer;
  v_lon double precision;
  v_lat double precision;
  -- PHASE 6.7C.2B.2 markers retained from v98 (verify locks these branches):
  -- v98_people_travel_car_only
  -- v98_small_item_travel_all_modes
  -- v98_cargo_escort_land_only
  -- v98_cargo_only_full_deliver
  -- v98_normalize_passenger_zero_counts
  -- v98_normalize_cargo_escort_demand_provider
BEGIN
  IF p_status IS DISTINCT FROM 'draft' AND p_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'error.invalid_post_status';
  END IF;

  -- Browser must not submit authority keys in payload (same as v98).
  IF p_post_payload ? 'origin_country_code'
     OR p_post_payload ? 'origin_timezone'
     OR p_post_payload ? 'night_policy_version'
     OR p_post_payload ? 'origin_gps' THEN
    RAISE EXCEPTION 'error.browser_night_authority_rejected';
  END IF;

  -- ── Trusted authority parameters (server-only; fail closed before INSERT) ─
  IF p_origin_gps IS NULL THEN
    RAISE EXCEPTION 'error.geocode_invalid_response';
  END IF;
  IF extensions.geometrytype(p_origin_gps::extensions.geometry)
       IS DISTINCT FROM 'POINT' THEN
    RAISE EXCEPTION 'error.geocode_invalid_response';
  END IF;
  IF extensions.st_srid(p_origin_gps::extensions.geometry) IS DISTINCT FROM 4326 THEN
    RAISE EXCEPTION 'error.geocode_invalid_response';
  END IF;
  v_lon := extensions.st_x(p_origin_gps::extensions.geometry);
  v_lat := extensions.st_y(p_origin_gps::extensions.geometry);
  IF v_lon IS NULL OR v_lat IS NULL
     OR v_lon <> v_lon OR v_lat <> v_lat
     OR v_lon = 'Infinity'::double precision
     OR v_lon = '-Infinity'::double precision
     OR v_lat = 'Infinity'::double precision
     OR v_lat = '-Infinity'::double precision
     OR v_lon < -180::double precision OR v_lon > 180::double precision
     OR v_lat < -90::double precision OR v_lat > 90::double precision THEN
    RAISE EXCEPTION 'error.geocode_invalid_response';
  END IF;

  IF p_origin_country_code IS NULL
     OR p_origin_country_code IS DISTINCT FROM btrim(p_origin_country_code)
     OR p_origin_country_code !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'error.geocode_invalid_response';
  END IF;

  IF p_origin_timezone IS NULL
     OR p_origin_timezone IS DISTINCT FROM btrim(p_origin_timezone)
     OR char_length(p_origin_timezone) < 1
     OR char_length(p_origin_timezone) > 100 THEN
    RAISE EXCEPTION 'error.geocode_timezone_unavailable';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names tz
    WHERE tz.name = p_origin_timezone
  ) THEN
    RAISE EXCEPTION 'error.geocode_timezone_unavailable';
  END IF;

  IF p_night_policy_version IS NOT NULL AND p_night_policy_version <= 0 THEN
    RAISE EXCEPTION 'error.night_policy_invalid';
  END IF;

  v_post_type := lower(btrim(COALESCE(p_post_payload->>'post_type', '')));
  IF v_post_type IS DISTINCT FROM 'demand' AND v_post_type IS DISTINCT FROM 'provider' THEN
    RAISE EXCEPTION 'error.invalid_payload_numeric_values';
  END IF;

  v_category := lower(btrim(COALESCE(p_post_payload->>'category', '')));
  v_subtype_raw := NULLIF(btrim(COALESCE(p_post_payload->>'service_subtype', '')), '');

  IF v_category = 'travel' THEN
    IF v_subtype_raw IS NULL OR v_subtype_raw NOT IN (
      'passenger', 'small_item_only', 'passenger_with_small_item'
    ) THEN
      RAISE EXCEPTION 'error.invalid_service_subtype';
    END IF;
    v_service_subtype := v_subtype_raw;
  ELSIF v_category = 'deliver' THEN
    IF v_subtype_raw IS NULL OR v_subtype_raw NOT IN (
      'cargo_only', 'cargo_with_escort'
    ) THEN
      RAISE EXCEPTION 'error.invalid_service_subtype';
    END IF;
    v_service_subtype := v_subtype_raw;
  ELSIF v_category IN ('buy', 'onsite', 'errand') THEN
    IF v_subtype_raw IS NOT NULL THEN
      RAISE EXCEPTION 'error.invalid_service_subtype';
    END IF;
    v_service_subtype := NULL;
  ELSE
    RAISE EXCEPTION 'error.invalid_service_subtype';
  END IF;

  v_transport_raw := NULLIF(btrim(COALESCE(p_post_payload->>'transport_mode', '')), '');
  IF v_transport_raw = 'van' THEN
    RAISE EXCEPTION 'error.invalid_transport_mode';
  END IF;

  IF v_category = 'travel' THEN
    IF v_transport_raw IS NULL THEN
      RAISE EXCEPTION 'error.transport_mode_required';
    END IF;
    IF v_service_subtype IN ('passenger', 'passenger_with_small_item') THEN
      -- v98_people_travel_car_only
      IF v_transport_raw IS DISTINCT FROM 'car' THEN
        RAISE EXCEPTION 'error.illegal_transport_combo';
      END IF;
    ELSIF v_service_subtype = 'small_item_only' THEN
      -- v98_small_item_travel_all_modes
      IF v_transport_raw NOT IN (
        'walking', 'bicycle', 'ebike', 'scooter', 'motorbike', 'car',
        'subway', 'bus', 'train', 'flight', 'ferry',
        'passenger_boat', 'private_boat'
      ) THEN
        RAISE EXCEPTION 'error.illegal_transport_combo';
      END IF;
    ELSE
      RAISE EXCEPTION 'error.illegal_transport_combo';
    END IF;
    v_transport_mode := v_transport_raw;
  ELSIF v_category = 'deliver' THEN
    IF v_transport_raw IS NULL THEN
      RAISE EXCEPTION 'error.transport_mode_required';
    END IF;
    IF v_service_subtype = 'cargo_only' THEN
      -- v98_cargo_only_full_deliver
      IF v_transport_raw NOT IN (
        'cargo_van', 'light_truck', 'box_truck', 'vehicle_with_trailer',
        'cargo_boat', 'private_cargo_boat', 'other_cargo_vehicle'
      ) THEN
        RAISE EXCEPTION 'error.illegal_transport_combo';
      END IF;
    ELSIF v_service_subtype = 'cargo_with_escort' THEN
      -- v98_cargo_escort_land_only (boats cannot carry escort)
      IF v_transport_raw IN ('cargo_boat', 'private_cargo_boat') THEN
        RAISE EXCEPTION 'error.illegal_transport_combo';
      END IF;
      IF v_transport_raw NOT IN (
        'cargo_van', 'light_truck', 'box_truck',
        'vehicle_with_trailer', 'other_cargo_vehicle'
      ) THEN
        RAISE EXCEPTION 'error.illegal_transport_combo';
      END IF;
    ELSE
      RAISE EXCEPTION 'error.illegal_transport_combo';
    END IF;
    v_transport_mode := v_transport_raw;
  ELSIF v_category IN ('buy', 'onsite', 'errand') THEN
    IF v_transport_raw IS NOT NULL THEN
      RAISE EXCEPTION 'error.invalid_transport_mode';
    END IF;
    v_transport_mode := NULL;
  ELSE
    RAISE EXCEPTION 'error.invalid_transport_mode';
  END IF;

  BEGIN
    IF p_post_payload ? 'count_small'
       AND jsonb_typeof(p_post_payload->'count_small') = 'string'
       AND btrim(p_post_payload->>'count_small') !~ '^\d+$' THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
    END IF;
    IF p_post_payload ? 'count_medium'
       AND jsonb_typeof(p_post_payload->'count_medium') = 'string'
       AND btrim(p_post_payload->>'count_medium') !~ '^\d+$' THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
    END IF;
    IF p_post_payload ? 'count_large'
       AND jsonb_typeof(p_post_payload->'count_large') = 'string'
       AND btrim(p_post_payload->>'count_large') !~ '^\d+$' THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
    END IF;
    IF p_post_payload ? 'count_xlarge'
       AND jsonb_typeof(p_post_payload->'count_xlarge') = 'string'
       AND btrim(p_post_payload->>'count_xlarge') !~ '^\d+$' THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
    END IF;
    IF p_post_payload ? 'escort_seats'
       AND jsonb_typeof(p_post_payload->'escort_seats') = 'string'
       AND btrim(p_post_payload->>'escort_seats') !~ '^\d+$' THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
    END IF;
    IF p_post_payload ? 'max_companions'
       AND jsonb_typeof(p_post_payload->'max_companions') = 'string'
       AND btrim(p_post_payload->>'max_companions') !~ '^\d+$' THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
    END IF;

    v_count_small := COALESCE((p_post_payload->>'count_small')::integer, 0);
    v_count_medium := COALESCE((p_post_payload->>'count_medium')::integer, 0);
    v_count_large := COALESCE((p_post_payload->>'count_large')::integer, 0);
    v_count_xlarge := COALESCE((p_post_payload->>'count_xlarge')::integer, 0);
    v_escort_seats := COALESCE((p_post_payload->>'escort_seats')::integer, 0);
    IF NOT (p_post_payload ? 'max_companions')
       OR jsonb_typeof(p_post_payload->'max_companions') = 'null'
       OR NULLIF(btrim(COALESCE(p_post_payload->>'max_companions', '')), '') IS NULL
       OR NULLIF(btrim(p_post_payload->>'max_companions'), '0') IS NULL THEN
      v_max_companions := NULL;
    ELSE
      v_max_companions := (p_post_payload->>'max_companions')::integer;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
  END;

  IF v_count_small < 0 OR v_count_medium < 0 OR v_count_large < 0 OR v_count_xlarge < 0
     OR v_escort_seats < 0
     OR v_count_small > 2147483647 OR v_count_medium > 2147483647
     OR v_count_large > 2147483647 OR v_count_xlarge > 2147483647
     OR v_escort_seats > 2147483647
     OR (
       v_max_companions IS NOT NULL
       AND (v_max_companions < 0 OR v_max_companions > 2147483647)
     ) THEN
    RAISE EXCEPTION 'error.invalid_payload_numeric_values';
  END IF;

  v_share_raw := lower(btrim(COALESCE(p_post_payload->>'share_mode', '')));
  v_delivery_raw := NULLIF(lower(btrim(COALESCE(p_post_payload->>'delivery_mode', ''))), '');

  IF v_category = 'deliver' AND v_post_type = 'demand' THEN
    IF v_delivery_raw IS NULL THEN
      v_delivery_mode := NULL;
    ELSIF v_delivery_raw IN ('spot', 'door') THEN
      v_delivery_mode := v_delivery_raw;
    ELSE
      RAISE EXCEPTION 'error.invalid_delivery_mode';
    END IF;
  ELSE
    v_delivery_mode := NULL;
  END IF;

  IF v_category = 'travel' THEN
    v_delivery_mode := NULL;
    IF v_service_subtype = 'passenger' THEN
      -- v98_normalize_passenger_zero_counts
      v_count_small := 0;
      v_count_medium := 0;
      v_count_large := 0;
      v_count_xlarge := 0;
      IF COALESCE(v_max_companions, 0) > 4 OR v_escort_seats > 4 THEN
        RAISE EXCEPTION 'error.invalid_payload_numeric_values';
      END IF;
      v_people := GREATEST(1, LEAST(4, COALESCE(v_max_companions, NULLIF(v_escort_seats, 0), 1)));
      v_escort_seats := v_people;
      v_max_companions := v_people;
      IF v_share_raw = 'private' THEN
        v_share_mode := 'private';
      ELSE
        v_share_mode := 'share';
      END IF;
    ELSIF v_service_subtype = 'small_item_only' THEN
      v_escort_seats := 0;
      v_max_companions := NULL;
      v_share_mode := NULL;
    ELSIF v_service_subtype = 'passenger_with_small_item' THEN
      IF COALESCE(v_max_companions, 0) > 4 OR v_escort_seats > 4 THEN
        RAISE EXCEPTION 'error.invalid_payload_numeric_values';
      END IF;
      v_people := GREATEST(1, LEAST(4, COALESCE(v_max_companions, NULLIF(v_escort_seats, 0), 1)));
      v_escort_seats := v_people;
      v_max_companions := v_people;
      IF v_share_raw = 'private' THEN
        v_share_mode := 'private';
      ELSE
        v_share_mode := 'share';
      END IF;
    END IF;
  ELSIF v_category = 'deliver' THEN
    IF v_post_type = 'provider' THEN
      v_delivery_mode := NULL;
    END IF;
    IF v_service_subtype = 'cargo_only' THEN
      v_escort_seats := 0;
      v_max_companions := NULL;
      v_share_mode := NULL;
    ELSIF v_service_subtype = 'cargo_with_escort' THEN
      -- v98_normalize_cargo_escort_demand_provider
      v_max_companions := NULL;
      IF v_post_type = 'demand' THEN
        v_escort_seats := 1;
        IF v_share_raw = 'private' THEN
          v_share_mode := 'private';
        ELSE
          v_share_mode := 'share';
        END IF;
      ELSE
        v_escort_seats := 0;
        v_share_mode := NULL;
      END IF;
    END IF;
  ELSE
    v_count_small := 0;
    v_count_medium := 0;
    v_count_large := 0;
    v_count_xlarge := 0;
    v_escort_seats := 0;
    v_max_companions := NULL;
    v_share_mode := NULL;
    v_delivery_mode := NULL;
  END IF;

  -- Single atomic INSERT: canonical Stage-1 + four trusted authority fields.
  -- No post-insert UPDATE of authority. Failure above yields zero posts rows.
  INSERT INTO public.posts (
    user_id, client_request_id, payload_hash, status,
    post_type, category, title, scope,
    origin_address, destination_address, departure_date,
    departure_time_window, waypoints, share_mode, delivery_mode,
    count_small, count_medium, count_large, count_xlarge,
    escort_seats, max_companions, bump_fee, fee_amount, fee_amount_minor, currency, locale,
    fallback_reason, transport_mode, service_subtype,
    origin_gps, origin_country_code, origin_timezone, night_policy_version
  ) VALUES (
    p_user_id,
    p_client_request_id,
    p_payload_hash,
    p_status,
    v_post_type,
    v_category,
    COALESCE(p_post_payload->>'title', ''),
    'city',
    COALESCE(p_post_payload->>'origin_address', ''),
    COALESCE(p_post_payload->>'destination_address', ''),
    NULLIF(p_post_payload->>'departure_date', '')::DATE,
    NULLIF(p_post_payload->>'departure_time_window', ''),
    COALESCE(p_post_payload->'waypoints', '[]'::jsonb),
    v_share_mode,
    v_delivery_mode,
    v_count_small,
    v_count_medium,
    v_count_large,
    v_count_xlarge,
    v_escort_seats,
    v_max_companions,
    COALESCE((p_post_payload->>'bump_fee_minor')::NUMERIC, 0) / 100,
    (p_server_fee_minor::NUMERIC / 100),
    p_server_fee_minor,
    COALESCE(p_post_payload->>'currency', 'EUR'),
    COALESCE(NULLIF(p_post_payload->>'locale', ''), 'sr'),
    p_fallback_reason,
    v_transport_mode,
    v_service_subtype,
    p_origin_gps,
    p_origin_country_code,
    p_origin_timezone,
    p_night_policy_version
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.insert_stage1_post_v101(
  uuid, uuid, text, text, jsonb, bigint, text,
  extensions.geography, text, text, integer
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.insert_stage1_post_v101(
  uuid, uuid, text, text, jsonb, bigint, text,
  extensions.geography, text, text, integer
) FROM anon;

REVOKE ALL ON FUNCTION public.insert_stage1_post_v101(
  uuid, uuid, text, text, jsonb, bigint, text,
  extensions.geography, text, text, integer
) FROM authenticated;

REVOKE ALL ON FUNCTION public.insert_stage1_post_v101(
  uuid, uuid, text, text, jsonb, bigint, text,
  extensions.geography, text, text, integer
) FROM service_role;

COMMIT;
