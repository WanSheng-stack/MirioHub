-- PHASE 6.7C.2C.3I-B / v102 — seal direct posts DML behind narrow writers.
-- Forward-only. Does NOT modify v90–v101B / init.sql / posts_init.sql / posts schema.
-- Does NOT enable matching creation. Does NOT enable RS night.
-- Does NOT modify v101 writers/hash. Does NOT DROP v98 functions (REVOKE only).
-- MANUAL APPLY REQUIRED. Do not auto-apply from Cursor.
-- Explicit BEGIN/COMMIT. If a statement fails, execute ROLLBACK.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Fail-fast deployed-boundary guard
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
DECLARE
  v_fn oid;
  v_missing text;
  v_typ text;
  v_type_schema text;
  v_typname text;
  v_creation boolean;
  v_cfg_n integer;
  v_seed_n integer;
  v_enabled boolean;
  v_ext_schema text;
  v_pol_n integer;
  v_qual text;
  v_with_check text;
  v_has_ins boolean;
  v_has_upd boolean;
  v_has_del boolean;
BEGIN
  IF to_regclass('public.posts') IS NULL THEN
    RAISE EXCEPTION 'v102_guard: public.posts missing';
  END IF;

  IF to_regprocedure(
       'public.complete_post_contact_v102(uuid,uuid,boolean,text,text,integer,boolean,text,text,integer,boolean,text,boolean,text,boolean,text,boolean,text,text,extensions.geography,boolean)'
     ) IS NOT NULL
     OR to_regprocedure('public.activate_post_after_identity_v102(uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public._posts_is_account_eligible_v102(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'v102_guard: v102 identities already exist — refuse re-apply';
  END IF;

  v_fn := to_regprocedure(
    'public.insert_stage1_post_v101(uuid,uuid,text,text,jsonb,bigint,text,extensions.geography,text,text,integer)'
  );
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'v102_guard: insert_stage1_post_v101 missing';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102_guard: insert_stage1_post_v101 must remain sealed';
  END IF;

  v_fn := to_regprocedure(
    'public.trusted_publish_facts_hash_v101(text,extensions.geography,text,text,integer)'
  );
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'v102_guard: trusted_publish_facts_hash_v101 missing';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102_guard: hash helper must remain sealed';
  END IF;

  v_fn := to_regprocedure(
    'public.publish_active_post_idempotent_v101(uuid,uuid,text,jsonb,bigint,extensions.geography,text,text,integer)'
  );
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'v102_guard: publish_active_post_idempotent_v101 missing';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102_guard: v101 active writer ACL drift';
  END IF;

  v_fn := to_regprocedure(
    'public.create_shadow_draft_idempotent_v101(uuid,uuid,text,text,jsonb,bigint,extensions.geography,text,text,integer)'
  );
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'v102_guard: create_shadow_draft_idempotent_v101 missing';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102_guard: v101 shadow writer ACL drift';
  END IF;

  v_fn := to_regprocedure(
    'public.commit_phase3_business_idempotent_v101(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text,extensions.geography,text,text,integer)'
  );
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'v102_guard: commit_phase3_business_idempotent_v101 missing';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102_guard: v101 commit writer ACL drift';
  END IF;

  IF to_regprocedure(
       'public.publish_active_post_idempotent_v98(uuid,uuid,text,jsonb,bigint)'
     ) IS NULL
     OR to_regprocedure(
       'public.create_shadow_draft_idempotent_v98(uuid,uuid,text,text,jsonb,bigint)'
     ) IS NULL
     OR to_regprocedure(
       'public.commit_phase3_business_idempotent_v98(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'v102_guard: v98 outer writers missing';
  END IF;

  SELECT need.attname INTO v_missing
  FROM (
    VALUES
      ('origin_gps'), ('origin_country_code'), ('origin_timezone'),
      ('night_policy_version'), ('payload_hash'), ('client_request_id'),
      ('user_id'), ('status'), ('destination_gps'), ('scope'),
      ('transport_mode'), ('category')
  ) AS need(attname)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.posts'::regclass
      AND a.attname = need.attname AND a.attnum > 0 AND NOT a.attisdropped
  )
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'v102_guard: posts column missing: %', v_missing;
  END IF;

  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod), tn.nspname, t.typname
  INTO v_typ, v_type_schema, v_typname
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
  JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
  WHERE a.attrelid = 'public.posts'::regclass AND a.attname = 'origin_gps'
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_type_schema IS DISTINCT FROM 'extensions' OR v_typname IS DISTINCT FROM 'geography' THEN
    RAISE EXCEPTION 'v102_guard: origin_gps type drift: %', COALESCE(v_typ, 'null');
  END IF;

  SELECT tn.nspname, t.typname INTO v_type_schema, v_typname
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
  JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
  WHERE a.attrelid = 'public.posts'::regclass AND a.attname = 'destination_gps'
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_type_schema IS DISTINCT FROM 'extensions' OR v_typname IS DISTINCT FROM 'geography' THEN
    RAISE EXCEPTION 'v102_guard: destination_gps type drift';
  END IF;

  SELECT count(*)::int INTO v_pol_n
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'posts'
    AND pol.polname IN ('posts_update_own', 'posts_insert_own', 'posts_delete_own');
  IF v_pol_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'v102_guard: expected 3 write policies, got %', v_pol_n;
  END IF;

  SELECT pg_catalog.pg_get_expr(pol.polqual, pol.polrelid),
         pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
  INTO v_qual, v_with_check
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'posts' AND pol.polname = 'posts_update_own';
  IF v_qual IS NULL OR v_qual !~* 'auth\.uid\(\)\s*=\s*user_id'
     OR v_with_check IS NULL OR v_with_check !~* 'auth\.uid\(\)\s*=\s*user_id' THEN
    RAISE EXCEPTION 'v102_guard: posts_update_own definition drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'posts' AND pol.polname = 'posts_select_own'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'posts'
      AND pol.polname = 'posts_select_match_participant'
  ) THEN
    RAISE EXCEPTION 'v102_guard: posts SELECT policies missing';
  END IF;

  IF to_regclass('public.public_posts_safe') IS NULL THEN
    RAISE EXCEPTION 'v102_guard: public_posts_safe missing';
  END IF;

  v_has_ins := has_table_privilege('authenticated', 'public.posts', 'INSERT');
  v_has_upd := has_table_privilege('authenticated', 'public.posts', 'UPDATE');
  v_has_del := has_table_privilege('authenticated', 'public.posts', 'DELETE');
  IF NOT (v_has_ins AND v_has_upd AND v_has_del) THEN
    RAISE EXCEPTION 'v102_guard: authenticated DML privilege unexpected';
  END IF;
  IF has_table_privilege('anon', 'public.posts', 'INSERT')
     OR has_table_privilege('anon', 'public.posts', 'UPDATE')
     OR has_table_privilege('anon', 'public.posts', 'DELETE') THEN
    RAISE EXCEPTION 'v102_guard: anon must not have posts DML';
  END IF;

  SELECT n.nspname INTO v_ext_schema
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'postgis';
  IF v_ext_schema IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION 'v102_guard: PostGIS must be in extensions';
  END IF;

  SELECT count(*)::int INTO v_cfg_n FROM public.system_configs WHERE id = 1;
  IF v_cfg_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'v102_guard: system_configs id=1 missing';
  END IF;
  SELECT matching_request_creation_enabled INTO v_creation
  FROM public.system_configs WHERE id = 1;
  IF v_creation IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v102_guard: matching_request_creation_enabled must be false';
  END IF;

  SELECT count(*)::int INTO v_seed_n
  FROM public.night_service_policies p
  WHERE p.country_code = 'RS' AND p.region_code IS NULL AND p.policy_version = 1;
  IF v_seed_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'v102_guard: RS night seed missing';
  END IF;
  SELECT p.enabled INTO v_enabled
  FROM public.night_service_policies p
  WHERE p.country_code = 'RS' AND p.region_code IS NULL AND p.policy_version = 1;
  IF v_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v102_guard: RS night enabled must be false';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Sealed internal eligibility helper
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public._posts_is_account_eligible_v102(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $elig$
  SELECT
    p_user_id IS NOT NULL
    AND (
      COALESCE((SELECT has_passkey FROM public.profiles WHERE id = p_user_id), false)
      OR EXISTS (
        SELECT 1 FROM auth.identities
        WHERE user_id = p_user_id AND provider = 'google'
      )
      OR EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = p_user_id AND email_confirmed_at IS NOT NULL
      )
    );
$elig$;

COMMENT ON FUNCTION public._posts_is_account_eligible_v102(uuid) IS
  'v102 internal: Passkey OR Google identity OR confirmed email. No role EXECUTE.';

REVOKE ALL ON FUNCTION public._posts_is_account_eligible_v102(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._posts_is_account_eligible_v102(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._posts_is_account_eligible_v102(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public._posts_is_account_eligible_v102(uuid) FROM service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. activate_post_after_identity_v102
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.activate_post_after_identity_v102(
  p_user_id uuid,
  p_post_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $fn$
DECLARE
  v_owner uuid;
  v_status text;
  v_gps extensions.geography;
  v_cc text;
  v_tz text;
  v_night integer;
  v_hash text;
  v_complete boolean;
  v_legacy boolean;
  v_updated integer;
BEGIN
  IF p_user_id IS NULL OR p_post_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  END IF;

  SELECT user_id, status, origin_gps, origin_country_code, origin_timezone,
         night_policy_version, payload_hash
  INTO v_owner, v_status, v_gps, v_cc, v_tz, v_night, v_hash
  FROM public.posts
  WHERE id = p_post_id
  FOR UPDATE;

  IF NOT FOUND OR v_owner IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.not_found');
  END IF;

  IF v_status = 'active' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'post_id', p_post_id,
      'is_active', true,
      'already_active', true
    );
  END IF;

  IF v_status IS DISTINCT FROM 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
  END IF;

  IF NOT public._posts_is_account_eligible_v102(p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.identity_verification_required');
  END IF;

  v_complete := v_gps IS NOT NULL AND v_cc IS NOT NULL AND v_tz IS NOT NULL
    AND (v_night IS NULL OR v_night > 0);
  v_legacy := v_gps IS NULL AND v_cc IS NULL AND v_tz IS NULL AND v_night IS NULL;

  IF v_legacy THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_legacy_missing');
  END IF;
  IF NOT v_complete THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_partial_state');
  END IF;

  IF v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_invalid');
  END IF;

  UPDATE public.posts
  SET status = 'active',
      updated_at = timezone('utc', now())
  WHERE id = p_post_id
    AND user_id = p_user_id
    AND status = 'draft';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated IS DISTINCT FROM 1 THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'post_id', p_post_id,
    'is_active', true,
    'already_active', false
  );
END;
$fn$;

COMMENT ON FUNCTION public.activate_post_after_identity_v102(uuid, uuid) IS
  'v102: authority-complete draft→active; active idempotent; service_role only.';

REVOKE ALL ON FUNCTION public.activate_post_after_identity_v102(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_post_after_identity_v102(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.activate_post_after_identity_v102(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.activate_post_after_identity_v102(uuid, uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. complete_post_contact_v102
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.complete_post_contact_v102(
  p_user_id uuid,
  p_post_id uuid,
  p_has_phone boolean,
  p_raw_phone text,
  p_normalized_phone text,
  p_phone_id integer,
  p_has_plate boolean,
  p_raw_license_plate text,
  p_normalized_license_plate text,
  p_plate_id integer,
  p_has_provider_name boolean,
  p_provider_name text,
  p_has_vehicle_brand boolean,
  p_vehicle_brand text,
  p_has_vehicle_color boolean,
  p_vehicle_color text,
  p_has_transport_mode boolean,
  p_transport_mode text,
  p_destination_update_kind text,
  p_destination_gps extensions.geography,
  p_activate boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $fn$
DECLARE
  v_owner uuid;
  v_status text;
  v_category text;
  v_transport text;
  v_gps extensions.geography;
  v_cc text;
  v_tz text;
  v_night integer;
  v_hash text;
  v_dest extensions.geography;
  v_scope text;
  v_complete boolean;
  v_legacy boolean;
  v_new_transport text;
  v_new_dest extensions.geography;
  v_new_scope text;
  v_apply_dest boolean := false;
  v_dist_m double precision;
  v_lon double precision;
  v_lat double precision;
  v_will_activate boolean := false;
  v_updated integer;
BEGIN
  IF p_user_id IS NULL OR p_post_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  END IF;

  IF p_destination_update_kind IS NULL
     OR p_destination_update_kind NOT IN ('omit', 'point', 'use_origin') THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.submit_failed');
  END IF;

  SELECT
    user_id, status, category, transport_mode,
    origin_gps, origin_country_code, origin_timezone, night_policy_version,
    payload_hash, destination_gps, scope
  INTO
    v_owner, v_status, v_category, v_transport,
    v_gps, v_cc, v_tz, v_night,
    v_hash, v_dest, v_scope
  FROM public.posts
  WHERE id = p_post_id
  FOR UPDATE;

  IF NOT FOUND OR v_owner IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.not_found');
  END IF;

  IF v_status NOT IN ('draft', 'active') THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
  END IF;

  v_complete := v_gps IS NOT NULL AND v_cc IS NOT NULL AND v_tz IS NOT NULL
    AND (v_night IS NULL OR v_night > 0);
  v_legacy := v_gps IS NULL AND v_cc IS NULL AND v_tz IS NULL AND v_night IS NULL;

  IF NOT v_complete AND NOT v_legacy THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_partial_state');
  END IF;

  -- transport_mode rules
  v_new_transport := v_transport;
  IF COALESCE(p_has_transport_mode, false) THEN
    IF p_transport_mode IS NULL OR btrim(p_transport_mode) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_transport_mode');
    END IF;
    IF p_transport_mode IS DISTINCT FROM btrim(p_transport_mode)
       OR p_transport_mode = 'van' THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_transport_mode');
    END IF;
    IF v_category IN ('buy', 'onsite', 'errand') THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_transport_mode');
    END IF;
    IF v_category = 'travel' THEN
      IF p_transport_mode NOT IN (
        'walking', 'bicycle', 'ebike', 'scooter', 'motorbike', 'car',
        'subway', 'bus', 'train', 'flight', 'ferry',
        'passenger_boat', 'private_boat'
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_transport_mode');
      END IF;
    ELSIF v_category = 'deliver' THEN
      IF p_transport_mode NOT IN (
        'cargo_van', 'light_truck', 'box_truck', 'vehicle_with_trailer',
        'cargo_boat', 'private_cargo_boat', 'other_cargo_vehicle'
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_transport_mode');
      END IF;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_transport_mode');
    END IF;

    IF v_complete THEN
      IF v_transport IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.transport_mode_already_set');
      END IF;
      IF v_transport IS DISTINCT FROM p_transport_mode THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.transport_mode_already_set');
      END IF;
      -- same value: idempotent, no write
    ELSE
      -- legacy
      IF v_transport IS NULL THEN
        v_new_transport := p_transport_mode;
      ELSIF v_transport IS DISTINCT FROM p_transport_mode THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.transport_mode_already_set');
      END IF;
    END IF;
  END IF;

  -- destination_gps / scope (never touch origin_gps)
  v_new_dest := v_dest;
  v_new_scope := v_scope;
  IF p_destination_update_kind = 'point' THEN
    IF p_destination_gps IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.submit_failed');
    END IF;
    IF extensions.geometrytype(p_destination_gps::extensions.geometry)
         IS DISTINCT FROM 'POINT' THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.submit_failed');
    END IF;
    IF extensions.st_srid(p_destination_gps::extensions.geometry) IS DISTINCT FROM 4326 THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.submit_failed');
    END IF;
    v_lon := extensions.st_x(p_destination_gps::extensions.geometry);
    v_lat := extensions.st_y(p_destination_gps::extensions.geometry);
    IF v_lon IS NULL OR v_lat IS NULL
       OR v_lon <> v_lon OR v_lat <> v_lat
       OR v_lon < -180::double precision OR v_lon > 180::double precision
       OR v_lat < -90::double precision OR v_lat > 90::double precision THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.submit_failed');
    END IF;
    IF v_gps IS NOT NULL THEN
      v_new_dest := p_destination_gps;
      v_dist_m := extensions.st_distance(v_gps, v_new_dest);
      IF v_dist_m <= 5000::double precision THEN
        v_new_scope := 'near';
      ELSIF v_dist_m <= 20000::double precision THEN
        v_new_scope := 'city';
      ELSIF v_dist_m <= 200000::double precision THEN
        v_new_scope := 'intercity';
      ELSE
        v_new_scope := 'cross_border';
      END IF;
      v_apply_dest := true;
    END IF;
    -- If stored origin_gps is NULL, keep prior destination_gps/scope (no overwrite).
  ELSIF p_destination_update_kind = 'use_origin' THEN
    IF v_gps IS NOT NULL THEN
      v_new_dest := v_gps;
      v_new_scope := 'near';
      v_apply_dest := true;
    END IF;
  END IF;
  -- omit: keep stored destination_gps/scope

  -- activation request
  IF COALESCE(p_activate, false) THEN
    IF v_status = 'active' THEN
      v_will_activate := false;
    ELSIF v_status IS DISTINCT FROM 'draft' THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
    ELSE
      IF NOT public._posts_is_account_eligible_v102(p_user_id) THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.identity_verification_required');
      END IF;
      IF v_legacy THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_legacy_missing');
      END IF;
      IF NOT v_complete THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_partial_state');
      END IF;
      IF v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_invalid');
      END IF;
      v_will_activate := true;
    END IF;
  END IF;

  UPDATE public.posts p
  SET
    raw_phone = CASE WHEN COALESCE(p_has_phone, false) THEN p_raw_phone ELSE p.raw_phone END,
    normalized_phone = CASE WHEN COALESCE(p_has_phone, false) THEN p_normalized_phone ELSE p.normalized_phone END,
    phone_id = CASE WHEN COALESCE(p_has_phone, false) THEN p_phone_id ELSE p.phone_id END,
    raw_license_plate = CASE WHEN COALESCE(p_has_plate, false) THEN p_raw_license_plate ELSE p.raw_license_plate END,
    normalized_license_plate = CASE WHEN COALESCE(p_has_plate, false) THEN p_normalized_license_plate ELSE p.normalized_license_plate END,
    plate_id = CASE WHEN COALESCE(p_has_plate, false) THEN p_plate_id ELSE p.plate_id END,
    provider_name = CASE WHEN COALESCE(p_has_provider_name, false) THEN p_provider_name ELSE p.provider_name END,
    vehicle_brand = CASE WHEN COALESCE(p_has_vehicle_brand, false) THEN p_vehicle_brand ELSE p.vehicle_brand END,
    vehicle_color = CASE WHEN COALESCE(p_has_vehicle_color, false) THEN p_vehicle_color ELSE p.vehicle_color END,
    transport_mode = v_new_transport,
    destination_gps = CASE WHEN v_apply_dest THEN v_new_dest ELSE p.destination_gps END,
    scope = CASE WHEN v_apply_dest THEN v_new_scope ELSE p.scope END,
    status = CASE WHEN v_will_activate THEN 'active' ELSE p.status END,
    updated_at = timezone('utc', now())
  WHERE p.id = p_post_id
    AND p.user_id = p_user_id
    AND p.status IN ('draft', 'active');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated IS DISTINCT FROM 1 THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.submit_failed');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'post_id', p_post_id,
    'is_active', (CASE WHEN v_will_activate THEN true ELSE (v_status = 'active') END),
    'activated', v_will_activate,
    'already_active', (v_status = 'active' AND NOT v_will_activate)
  );
END;
$fn$;

COMMENT ON FUNCTION public.complete_post_contact_v102(
  uuid, uuid, boolean, text, text, integer, boolean, text, text, integer,
  boolean, text, boolean, text, boolean, text, boolean, text, text,
  extensions.geography, boolean
) IS
  'v102: sealed contact/destination/legacy-transport/optional activate; service_role only.';

REVOKE ALL ON FUNCTION public.complete_post_contact_v102(
  uuid, uuid, boolean, text, text, integer, boolean, text, text, integer,
  boolean, text, boolean, text, boolean, text, boolean, text, text,
  extensions.geography, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_post_contact_v102(
  uuid, uuid, boolean, text, text, integer, boolean, text, text, integer,
  boolean, text, boolean, text, boolean, text, boolean, text, text,
  extensions.geography, boolean
) FROM anon;
REVOKE ALL ON FUNCTION public.complete_post_contact_v102(
  uuid, uuid, boolean, text, text, integer, boolean, text, text, integer,
  boolean, text, boolean, text, boolean, text, boolean, text, text,
  extensions.geography, boolean
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_post_contact_v102(
  uuid, uuid, boolean, text, text, integer, boolean, text, text, integer,
  boolean, text, boolean, text, boolean, text, boolean, text, text,
  extensions.geography, boolean
) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. ACL seal — drop direct posts write policies + revoke DML + revoke v98
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS posts_update_own ON public.posts;
DROP POLICY IF EXISTS posts_insert_own ON public.posts;
DROP POLICY IF EXISTS posts_delete_own ON public.posts;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.posts FROM authenticated;
-- anon already lacks these; assert revoke is safe/no-op if absent
REVOKE INSERT, UPDATE, DELETE ON TABLE public.posts FROM anon;

REVOKE ALL ON FUNCTION public.publish_active_post_idempotent_v98(
  uuid, uuid, text, jsonb, bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_active_post_idempotent_v98(
  uuid, uuid, text, jsonb, bigint
) FROM anon;
REVOKE ALL ON FUNCTION public.publish_active_post_idempotent_v98(
  uuid, uuid, text, jsonb, bigint
) FROM authenticated;
REVOKE ALL ON FUNCTION public.publish_active_post_idempotent_v98(
  uuid, uuid, text, jsonb, bigint
) FROM service_role;

REVOKE ALL ON FUNCTION public.create_shadow_draft_idempotent_v98(
  uuid, uuid, text, text, jsonb, bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_shadow_draft_idempotent_v98(
  uuid, uuid, text, text, jsonb, bigint
) FROM anon;
REVOKE ALL ON FUNCTION public.create_shadow_draft_idempotent_v98(
  uuid, uuid, text, text, jsonb, bigint
) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_shadow_draft_idempotent_v98(
  uuid, uuid, text, text, jsonb, bigint
) FROM service_role;

REVOKE ALL ON FUNCTION public.commit_phase3_business_idempotent_v98(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_phase3_business_idempotent_v98(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text
) FROM anon;
REVOKE ALL ON FUNCTION public.commit_phase3_business_idempotent_v98(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text
) FROM authenticated;
REVOKE ALL ON FUNCTION public.commit_phase3_business_idempotent_v98(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text
) FROM service_role;

COMMIT;
