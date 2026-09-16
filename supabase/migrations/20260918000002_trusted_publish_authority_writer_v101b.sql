-- PHASE 6.7C.2C.3G / v101B — authority-bound publish facts hash + three outer writers.
-- Forward-only. Does NOT cut over APIs. Does NOT revoke/alter v98 ACL.
-- Does NOT touch posts_update_own / init.sql / posts schema / RS seed.
-- Does NOT enable matching creation. Does NOT enable RS night.
-- Does NOT grant EXECUTE on insert_stage1_post_v101 or hash helper to service_role.
-- Outer writers: service_role EXECUTE only (future server RPC with authenticated userId).
-- MANUAL APPLY REQUIRED. Do not auto-apply from Cursor.
-- Explicit BEGIN/COMMIT. If a statement fails, execute ROLLBACK.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Fail-fast deployed-boundary guard
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
  v_pgcrypto_schema text;
  v_has_crid_unique boolean;
  v_acl_exec boolean;
  v_fn oid;
BEGIN
  IF to_regclass('public.posts') IS NULL THEN
    RAISE EXCEPTION 'v101B_guard: public.posts missing';
  END IF;

  -- v101A insert exact identity present; no EXECUTE for app roles
  v_fn := to_regprocedure(
    'public.insert_stage1_post_v101(uuid,uuid,text,text,jsonb,bigint,text,extensions.geography,text,text,integer)'
  );
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'v101B_guard: insert_stage1_post_v101 exact identity missing';
  END IF;

  SELECT COALESCE(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
  INTO v_acl_exec
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) a
  WHERE p.oid = v_fn;
  IF v_acl_exec IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v101B_guard: insert_stage1_post_v101 must not grant PUBLIC EXECUTE';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'v101B_guard: required roles missing';
  END IF;

  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v101B_guard: insert_stage1_post_v101 must have no role EXECUTE';
  END IF;

  -- Authority columns (same shapes as v101A)
  SELECT need.attname INTO v_missing
  FROM (
    VALUES
      ('origin_gps'),
      ('origin_country_code'),
      ('origin_timezone'),
      ('night_policy_version'),
      ('client_request_id'),
      ('payload_hash'),
      ('status'),
      ('user_id')
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
    RAISE EXCEPTION 'v101B_guard: posts column missing: %', v_missing;
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
  IF v_type_schema IS DISTINCT FROM 'extensions'
     OR v_typname IS DISTINCT FROM 'geography'
     OR v_typ NOT IN (
       'geography(Point,4326)',
       'extensions.geography(Point,4326)'
     ) THEN
    RAISE EXCEPTION 'v101B_guard: origin_gps type/typmod drift: %', COALESCE(v_typ, 'null');
  END IF;
  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'v101B_guard: origin_gps must remain nullable';
  END IF;
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'v101B_guard: origin_gps must have no column default';
  END IF;

  -- v98 writers + insert still present
  IF to_regprocedure(
    'public.insert_stage1_post_v98(uuid,uuid,text,text,jsonb,bigint,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101B_guard: insert_stage1_post_v98 missing';
  END IF;
  IF to_regprocedure(
    'public.publish_active_post_idempotent_v98(uuid,uuid,text,jsonb,bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101B_guard: publish_active_post_idempotent_v98 missing';
  END IF;
  IF to_regprocedure(
    'public.create_shadow_draft_idempotent_v98(uuid,uuid,text,text,jsonb,bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101B_guard: create_shadow_draft_idempotent_v98 missing';
  END IF;
  IF to_regprocedure(
    'public.commit_phase3_business_idempotent_v98(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101B_guard: commit_phase3_business_idempotent_v98 missing';
  END IF;

  IF to_regprocedure(
    'public.match_request_admission_facts_hash_v99(jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101B_guard: match_request_admission_facts_hash_v99 missing';
  END IF;
  IF to_regprocedure(
    'public.create_match_request_v99(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,bigint,text,bigint,bigint,integer,integer,integer,text,boolean,boolean)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101B_guard: create_match_request_v99 missing';
  END IF;
  IF to_regprocedure(
    'public.select_night_service_policy_v100(text,text,text,timestamptz)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v101B_guard: select_night_service_policy_v100 missing';
  END IF;

  -- v101B targets must not exist yet
  IF to_regprocedure(
    'public.trusted_publish_facts_hash_v101(text,extensions.geography,text,text,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v101B_guard: trusted_publish_facts_hash_v101 already exists';
  END IF;
  IF to_regprocedure(
    'public.publish_active_post_idempotent_v101(uuid,uuid,text,jsonb,bigint,extensions.geography,text,text,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v101B_guard: publish_active_post_idempotent_v101 already exists';
  END IF;
  IF to_regprocedure(
    'public.create_shadow_draft_idempotent_v101(uuid,uuid,text,text,jsonb,bigint,extensions.geography,text,text,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v101B_guard: create_shadow_draft_idempotent_v101 already exists';
  END IF;
  IF to_regprocedure(
    'public.commit_phase3_business_idempotent_v101(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text,extensions.geography,text,text,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v101B_guard: commit_phase3_business_idempotent_v101 already exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'trusted_publish_facts_hash_v101',
        'publish_active_post_idempotent_v101',
        'create_shadow_draft_idempotent_v101',
        'commit_phase3_business_idempotent_v101',
        'insert_stage1_post_v102'
      )
  ) THEN
    RAISE EXCEPTION 'v101B_guard: unexpected v101B/v102 function name present';
  END IF;

  -- posts.client_request_id unique constraint or unique index (valid)
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'posts'
      AND c.contype = 'u'
      AND pg_catalog.pg_get_constraintdef(c.oid) ~* 'client_request_id'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = t.oid
     AND a.attnum = ANY (i.indkey::smallint[])
     AND a.attname = 'client_request_id'
    WHERE n.nspname = 'public'
      AND t.relname = 'posts'
      AND i.indisunique
      AND i.indisvalid
      AND NOT i.indisprimary
  )
  INTO v_has_crid_unique;
  IF v_has_crid_unique IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'v101B_guard: posts.client_request_id unique constraint/index missing or invalid';
  END IF;

  -- Passkey / challenge / profile columns
  IF to_regclass('public.auth_challenges') IS NULL THEN
    RAISE EXCEPTION 'v101B_guard: auth_challenges missing';
  END IF;
  IF to_regclass('public.passkeys') IS NULL THEN
    RAISE EXCEPTION 'v101B_guard: passkeys missing';
  END IF;
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'v101B_guard: profiles missing';
  END IF;

  SELECT need.attname INTO v_missing
  FROM (
    VALUES
      ('auth_challenges', 'id'),
      ('auth_challenges', 'client_request_id'),
      ('auth_challenges', 'user_id'),
      ('auth_challenges', 'processing_token'),
      ('auth_challenges', 'status'),
      ('passkeys', 'credential_id'),
      ('passkeys', 'user_id'),
      ('passkeys', 'sign_count'),
      ('profiles', 'id'),
      ('profiles', 'has_passkey')
  ) AS need(rel, attname)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = need.rel
      AND a.attname = need.attname
      AND a.attnum > 0
      AND NOT a.attisdropped
  )
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'v101B_guard: required column missing near: %', v_missing;
  END IF;

  SELECT n.nspname INTO v_ext_schema
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'postgis';
  IF v_ext_schema IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION 'v101B_guard: PostGIS must be in extensions (got %)',
      COALESCE(v_ext_schema, 'null');
  END IF;

  SELECT n.nspname INTO v_pgcrypto_schema
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';
  IF v_pgcrypto_schema IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION 'v101B_guard: pgcrypto must be in extensions (got %)',
      COALESCE(v_pgcrypto_schema, 'null');
  END IF;

  IF to_regclass('public.system_configs') IS NULL THEN
    RAISE EXCEPTION 'v101B_guard: system_configs missing';
  END IF;
  SELECT count(*)::int INTO v_cfg_n
  FROM public.system_configs
  WHERE id = 1;
  IF v_cfg_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'v101B_guard: system_configs id=1 must exist exactly once (got %)', v_cfg_n;
  END IF;
  SELECT matching_request_creation_enabled INTO v_creation
  FROM public.system_configs
  WHERE id = 1;
  IF v_creation IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v101B_guard: matching_request_creation_enabled must be false';
  END IF;

  SELECT count(*)::int INTO v_seed_n
  FROM public.night_service_policies p
  WHERE p.country_code = 'RS'
    AND p.region_code IS NULL
    AND p.policy_version = 1;
  IF v_seed_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'v101B_guard: RS seed version 1 row_count must be 1 (got %)', v_seed_n;
  END IF;
  SELECT p.enabled INTO v_enabled
  FROM public.night_service_policies p
  WHERE p.country_code = 'RS'
    AND p.region_code IS NULL
    AND p.policy_version = 1;
  IF v_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v101B_guard: RS seed enabled must be false';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Internal publish facts hash helper (authority-bound)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.trusted_publish_facts_hash_v101(
  p_canonical_payload_hash text,
  p_origin_gps             extensions.geography,
  p_origin_country_code    text,
  p_origin_timezone        text,
  p_night_policy_version   integer
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $hash$
DECLARE
  v_lon double precision;
  v_lat double precision;
  v_ewkb_hex text;
  v_facts jsonb;
BEGIN
  -- Canonical hash: exact 64 lowercase hex; no upper / trim accept
  IF p_canonical_payload_hash IS NULL
     OR p_canonical_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  IF p_origin_gps IS NULL THEN
    RETURN NULL;
  END IF;
  IF extensions.geometrytype(p_origin_gps::extensions.geometry)
       IS DISTINCT FROM 'POINT' THEN
    RETURN NULL;
  END IF;
  IF extensions.st_srid(p_origin_gps::extensions.geometry) IS DISTINCT FROM 4326 THEN
    RETURN NULL;
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
    RETURN NULL;
  END IF;

  IF p_origin_country_code IS NULL
     OR p_origin_country_code IS DISTINCT FROM btrim(p_origin_country_code)
     OR p_origin_country_code !~ '^[A-Z]{2}$' THEN
    RETURN NULL;
  END IF;

  IF p_origin_timezone IS NULL
     OR p_origin_timezone IS DISTINCT FROM btrim(p_origin_timezone)
     OR char_length(p_origin_timezone) < 1
     OR char_length(p_origin_timezone) > 100 THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names tz
    WHERE tz.name = p_origin_timezone
  ) THEN
    RETURN NULL;
  END IF;

  IF p_night_policy_version IS NOT NULL AND p_night_policy_version <= 0 THEN
    RETURN NULL;
  END IF;

  v_ewkb_hex := encode(
    extensions.st_asewkb(p_origin_gps::extensions.geometry),
    'hex'
  );

  v_facts :=
    jsonb_build_object(
      'publish_facts_schema_version', 101,
      'canonical_payload_hash', p_canonical_payload_hash,
      'origin_gps_ewkb_hex', v_ewkb_hex,
      'origin_country_code', p_origin_country_code,
      'origin_timezone', p_origin_timezone
    )
    || CASE
         WHEN p_night_policy_version IS NULL
           THEN '{"night_policy_version":null}'::jsonb
         ELSE jsonb_build_object('night_policy_version', p_night_policy_version)
       END;

  RETURN encode(
    extensions.digest(convert_to(v_facts::text, 'UTF8'), 'sha256'),
    'hex'
  );
END;
$hash$;

COMMENT ON FUNCTION public.trusted_publish_facts_hash_v101(
  text, extensions.geography, text, text, integer
) IS
  'v101B: SHA-256 of versioned publish facts (schema=101) including canonical hash + EWKB hex + country + timezone + night version. STABLE; internal SECURITY DEFINER; no role EXECUTE.';

REVOKE ALL ON FUNCTION public.trusted_publish_facts_hash_v101(
  text, extensions.geography, text, text, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trusted_publish_facts_hash_v101(
  text, extensions.geography, text, text, integer
) FROM anon;
REVOKE ALL ON FUNCTION public.trusted_publish_facts_hash_v101(
  text, extensions.geography, text, text, integer
) FROM authenticated;
REVOKE ALL ON FUNCTION public.trusted_publish_facts_hash_v101(
  text, extensions.geography, text, text, integer
) FROM service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Trusted ACTIVE outer writer
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.publish_active_post_idempotent_v101(
  p_user_id               uuid,
  p_client_request_id     uuid,
  p_canonical_payload_hash text,
  p_post_payload          jsonb,
  p_server_fee_minor      bigint,
  p_origin_gps            extensions.geography,
  p_origin_country_code   text,
  p_origin_timezone       text,
  p_night_policy_version  integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $fn$
DECLARE
  v_post_id          uuid;
  v_existing_post_id uuid;
  v_existing_hash    text;
  v_existing_status  text;
  v_existing_owner   uuid;
  v_stored_gps       extensions.geography;
  v_stored_cc        text;
  v_stored_tz        text;
  v_stored_night     integer;
  v_eligible         boolean;
  v_final_hash       text;
  v_expected_hash    text;
  v_complete         boolean;
  v_legacy           boolean;
  v_updated          integer;
BEGIN
  IF p_user_id IS NULL OR p_client_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  END IF;

  -- Global client_request_id xact advisory lock BEFORE any posts read
  -- (same contract all writers; key must not include userId — posts.crid is globally unique).
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'v101_publish_crid:' || p_client_request_id::text,
      0
    )
  );

  SELECT
    COALESCE((SELECT has_passkey FROM public.profiles WHERE id = p_user_id), false)
    OR EXISTS (
      SELECT 1 FROM auth.identities
      WHERE user_id = p_user_id AND provider = 'google'
    )
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = p_user_id AND email_confirmed_at IS NOT NULL
    )
  INTO v_eligible;

  IF NOT v_eligible THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.identity_verification_required');
  END IF;

  SELECT
    id, payload_hash, status, user_id,
    origin_gps, origin_country_code, origin_timezone, night_policy_version
  INTO
    v_existing_post_id, v_existing_hash, v_existing_status, v_existing_owner,
    v_stored_gps, v_stored_cc, v_stored_tz, v_stored_night
  FROM public.posts
  WHERE client_request_id = p_client_request_id
  FOR UPDATE;

  IF v_existing_post_id IS NOT NULL THEN
    IF v_existing_owner IS DISTINCT FROM p_user_id THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
    END IF;

    v_complete :=
      v_stored_gps IS NOT NULL
      AND v_stored_cc IS NOT NULL
      AND v_stored_tz IS NOT NULL;
    v_legacy :=
      v_stored_gps IS NULL
      AND v_stored_cc IS NULL
      AND v_stored_tz IS NULL
      AND v_stored_night IS NULL;

    IF NOT v_complete AND NOT v_legacy THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_partial_state');
    END IF;

    IF v_complete THEN
      -- Exact retry: recompute from STORED authority + this canonical hash.
      v_expected_hash := public.trusted_publish_facts_hash_v101(
        p_canonical_payload_hash,
        v_stored_gps,
        v_stored_cc,
        v_stored_tz,
        v_stored_night
      );
      IF v_expected_hash IS NULL
         OR v_expected_hash IS DISTINCT FROM v_existing_hash THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
      END IF;

      IF v_existing_status = 'active' THEN
        RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_existing_post_id);
      END IF;

      IF v_existing_status = 'draft' THEN
        UPDATE public.posts
        SET status = 'active', updated_at = NOW()
        WHERE id = v_existing_post_id
          AND user_id = p_user_id
          AND status = 'draft'
          AND origin_gps IS NOT NULL
          AND origin_country_code IS NOT NULL
          AND origin_timezone IS NOT NULL
          AND payload_hash = v_existing_hash;

        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated = 1 THEN
          RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_existing_post_id);
        END IF;

        SELECT
          id, payload_hash, status, user_id,
          origin_gps, origin_country_code, origin_timezone, night_policy_version
        INTO
          v_existing_post_id, v_existing_hash, v_existing_status, v_existing_owner,
          v_stored_gps, v_stored_cc, v_stored_tz, v_stored_night
        FROM public.posts
        WHERE client_request_id = p_client_request_id
        FOR UPDATE;

        IF v_existing_owner IS DISTINCT FROM p_user_id THEN
          RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
        END IF;
        v_expected_hash := public.trusted_publish_facts_hash_v101(
          p_canonical_payload_hash,
          v_stored_gps,
          v_stored_cc,
          v_stored_tz,
          v_stored_night
        );
        IF v_expected_hash IS NULL
           OR v_expected_hash IS DISTINCT FROM v_existing_hash THEN
          RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
        END IF;
        IF v_existing_status = 'active' THEN
          RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_existing_post_id);
        END IF;
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
      END IF;

      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
    END IF;

    -- Legacy (all authority NULL)
    IF v_existing_status IS DISTINCT FROM 'draft' THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_legacy_missing');
    END IF;
    IF v_existing_hash IS DISTINCT FROM p_canonical_payload_hash THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
    END IF;

    v_final_hash := public.trusted_publish_facts_hash_v101(
      p_canonical_payload_hash,
      p_origin_gps,
      p_origin_country_code,
      p_origin_timezone,
      p_night_policy_version
    );
    IF v_final_hash IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_invalid');
    END IF;

    UPDATE public.posts
    SET
      status = 'active',
      payload_hash = v_final_hash,
      origin_gps = p_origin_gps,
      origin_country_code = p_origin_country_code,
      origin_timezone = p_origin_timezone,
      night_policy_version = p_night_policy_version,
      updated_at = NOW()
    WHERE id = v_existing_post_id
      AND user_id = p_user_id
      AND status = 'draft'
      AND payload_hash = p_canonical_payload_hash
      AND origin_gps IS NULL
      AND origin_country_code IS NULL
      AND origin_timezone IS NULL
      AND night_policy_version IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN
      RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_existing_post_id);
    END IF;

    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_partial_state');
  END IF;

  -- Fresh insert
  v_final_hash := public.trusted_publish_facts_hash_v101(
    p_canonical_payload_hash,
    p_origin_gps,
    p_origin_country_code,
    p_origin_timezone,
    p_night_policy_version
  );
  IF v_final_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_invalid');
  END IF;

  v_post_id := public.insert_stage1_post_v101(
    p_user_id,
    p_client_request_id,
    v_final_hash,
    'active',
    p_post_payload,
    p_server_fee_minor,
    NULL,
    p_origin_gps,
    p_origin_country_code,
    p_origin_timezone,
    p_night_policy_version
  );

  RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_post_id);

EXCEPTION WHEN unique_violation THEN
  SELECT
    id, payload_hash, status, user_id,
    origin_gps, origin_country_code, origin_timezone, night_policy_version
  INTO
    v_existing_post_id, v_existing_hash, v_existing_status, v_existing_owner,
    v_stored_gps, v_stored_cc, v_stored_tz, v_stored_night
  FROM public.posts
  WHERE client_request_id = p_client_request_id
  FOR UPDATE;

  IF v_existing_owner IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  END IF;

  v_complete :=
    v_stored_gps IS NOT NULL
    AND v_stored_cc IS NOT NULL
    AND v_stored_tz IS NOT NULL;
  v_legacy :=
    v_stored_gps IS NULL
    AND v_stored_cc IS NULL
    AND v_stored_tz IS NULL
    AND v_stored_night IS NULL;

  IF NOT v_complete AND NOT v_legacy THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_partial_state');
  END IF;

  IF v_complete THEN
    v_expected_hash := public.trusted_publish_facts_hash_v101(
      p_canonical_payload_hash,
      v_stored_gps,
      v_stored_cc,
      v_stored_tz,
      v_stored_night
    );
    IF v_expected_hash IS NULL
       OR v_expected_hash IS DISTINCT FROM v_existing_hash THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
    END IF;
    IF v_existing_status = 'active' THEN
      RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_existing_post_id);
    END IF;
    IF v_existing_status = 'draft' THEN
      UPDATE public.posts
      SET status = 'active', updated_at = NOW()
      WHERE id = v_existing_post_id
        AND user_id = p_user_id
        AND status = 'draft'
        AND payload_hash = v_existing_hash;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 1 THEN
        RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_existing_post_id);
      END IF;
    END IF;
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
  END IF;

  -- Legacy under unique_violation: only draft upgrade path; never silent active
  IF v_existing_status IS DISTINCT FROM 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_legacy_missing');
  END IF;
  IF v_existing_hash IS DISTINCT FROM p_canonical_payload_hash THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
  END IF;
  v_final_hash := public.trusted_publish_facts_hash_v101(
    p_canonical_payload_hash,
    p_origin_gps,
    p_origin_country_code,
    p_origin_timezone,
    p_night_policy_version
  );
  IF v_final_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_invalid');
  END IF;
  UPDATE public.posts
  SET
    status = 'active',
    payload_hash = v_final_hash,
    origin_gps = p_origin_gps,
    origin_country_code = p_origin_country_code,
    origin_timezone = p_origin_timezone,
    night_policy_version = p_night_policy_version,
    updated_at = NOW()
  WHERE id = v_existing_post_id
    AND user_id = p_user_id
    AND status = 'draft'
    AND payload_hash = p_canonical_payload_hash
    AND origin_gps IS NULL
    AND origin_country_code IS NULL
    AND origin_timezone IS NULL
    AND night_policy_version IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_existing_post_id);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_partial_state');
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Shadow DRAFT outer writer
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.create_shadow_draft_idempotent_v101(
  p_user_id               uuid,
  p_client_request_id     uuid,
  p_canonical_payload_hash text,
  p_fallback_reason       text,
  p_post_payload          jsonb,
  p_server_fee_minor      bigint,
  p_origin_gps            extensions.geography,
  p_origin_country_code   text,
  p_origin_timezone       text,
  p_night_policy_version  integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $fn$
DECLARE
  v_post_id          uuid;
  v_existing_hash    text;
  v_existing_owner   uuid;
  v_existing_status  text;
  v_stored_gps       extensions.geography;
  v_stored_cc        text;
  v_stored_tz        text;
  v_stored_night     integer;
  v_final_hash       text;
  v_expected_hash    text;
  v_complete         boolean;
  v_legacy           boolean;
  v_updated          integer;
BEGIN
  IF p_user_id IS NULL OR p_client_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  END IF;

  -- Global client_request_id xact advisory lock BEFORE any posts read
  -- (same contract all writers; key must not include userId).
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'v101_publish_crid:' || p_client_request_id::text,
      0
    )
  );

  SELECT
    id, payload_hash, user_id, status,
    origin_gps, origin_country_code, origin_timezone, night_policy_version
  INTO
    v_post_id, v_existing_hash, v_existing_owner, v_existing_status,
    v_stored_gps, v_stored_cc, v_stored_tz, v_stored_night
  FROM public.posts
  WHERE client_request_id = p_client_request_id
  FOR UPDATE;

  IF v_post_id IS NOT NULL THEN
    IF v_existing_owner IS DISTINCT FROM p_user_id THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
    END IF;

    v_complete :=
      v_stored_gps IS NOT NULL
      AND v_stored_cc IS NOT NULL
      AND v_stored_tz IS NOT NULL;
    v_legacy :=
      v_stored_gps IS NULL
      AND v_stored_cc IS NULL
      AND v_stored_tz IS NULL
      AND v_stored_night IS NULL;

    IF NOT v_complete AND NOT v_legacy THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_partial_state');
    END IF;

    IF v_complete THEN
      v_expected_hash := public.trusted_publish_facts_hash_v101(
        p_canonical_payload_hash,
        v_stored_gps,
        v_stored_cc,
        v_stored_tz,
        v_stored_night
      );
      IF v_expected_hash IS NULL
         OR v_expected_hash IS DISTINCT FROM v_existing_hash THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
      END IF;
      -- Existing draft or active with matching authority-bound hash → duplicate
      IF v_existing_status IN ('draft', 'active') THEN
        RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_post_id);
      END IF;
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
    END IF;

    -- Legacy: only draft may upgrade; keep draft status
    IF v_existing_status IS DISTINCT FROM 'draft' THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_legacy_missing');
    END IF;
    IF v_existing_hash IS DISTINCT FROM p_canonical_payload_hash THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
    END IF;

    v_final_hash := public.trusted_publish_facts_hash_v101(
      p_canonical_payload_hash,
      p_origin_gps,
      p_origin_country_code,
      p_origin_timezone,
      p_night_policy_version
    );
    IF v_final_hash IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_invalid');
    END IF;

    UPDATE public.posts
    SET
      payload_hash = v_final_hash,
      origin_gps = p_origin_gps,
      origin_country_code = p_origin_country_code,
      origin_timezone = p_origin_timezone,
      night_policy_version = p_night_policy_version,
      updated_at = NOW()
    WHERE id = v_post_id
      AND user_id = p_user_id
      AND status = 'draft'
      AND payload_hash = p_canonical_payload_hash
      AND origin_gps IS NULL
      AND origin_country_code IS NULL
      AND origin_timezone IS NULL
      AND night_policy_version IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN
      RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_post_id);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_partial_state');
  END IF;

  v_final_hash := public.trusted_publish_facts_hash_v101(
    p_canonical_payload_hash,
    p_origin_gps,
    p_origin_country_code,
    p_origin_timezone,
    p_night_policy_version
  );
  IF v_final_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_invalid');
  END IF;

  v_post_id := public.insert_stage1_post_v101(
    p_user_id,
    p_client_request_id,
    v_final_hash,
    'draft',
    p_post_payload,
    p_server_fee_minor,
    p_fallback_reason,
    p_origin_gps,
    p_origin_country_code,
    p_origin_timezone,
    p_night_policy_version
  );

  RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_post_id);

EXCEPTION WHEN unique_violation THEN
  SELECT
    id, payload_hash, user_id, status,
    origin_gps, origin_country_code, origin_timezone, night_policy_version
  INTO
    v_post_id, v_existing_hash, v_existing_owner, v_existing_status,
    v_stored_gps, v_stored_cc, v_stored_tz, v_stored_night
  FROM public.posts
  WHERE client_request_id = p_client_request_id
  FOR UPDATE;

  IF v_existing_owner IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  END IF;

  v_complete :=
    v_stored_gps IS NOT NULL
    AND v_stored_cc IS NOT NULL
    AND v_stored_tz IS NOT NULL;
  v_legacy :=
    v_stored_gps IS NULL
    AND v_stored_cc IS NULL
    AND v_stored_tz IS NULL
    AND v_stored_night IS NULL;

  IF NOT v_complete AND NOT v_legacy THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_partial_state');
  END IF;

  IF v_complete THEN
    v_expected_hash := public.trusted_publish_facts_hash_v101(
      p_canonical_payload_hash,
      v_stored_gps,
      v_stored_cc,
      v_stored_tz,
      v_stored_night
    );
    IF v_expected_hash IS NULL
       OR v_expected_hash IS DISTINCT FROM v_existing_hash THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
    END IF;
    IF v_existing_status IN ('draft', 'active') THEN
      RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_post_id);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
  END IF;

  IF v_existing_status IS DISTINCT FROM 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_legacy_missing');
  END IF;
  IF v_existing_hash IS DISTINCT FROM p_canonical_payload_hash THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
  END IF;
  v_final_hash := public.trusted_publish_facts_hash_v101(
    p_canonical_payload_hash,
    p_origin_gps,
    p_origin_country_code,
    p_origin_timezone,
    p_night_policy_version
  );
  IF v_final_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_invalid');
  END IF;
  UPDATE public.posts
  SET
    payload_hash = v_final_hash,
    origin_gps = p_origin_gps,
    origin_country_code = p_origin_country_code,
    origin_timezone = p_origin_timezone,
    night_policy_version = p_night_policy_version,
    updated_at = NOW()
  WHERE id = v_post_id
    AND user_id = p_user_id
    AND status = 'draft'
    AND payload_hash = p_canonical_payload_hash
    AND origin_gps IS NULL
    AND origin_country_code IS NULL
    AND origin_timezone IS NULL
    AND night_policy_version IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_post_id);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_partial_state');
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Passkey ACTIVE outer writer (challenge + credential + post atomic)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.commit_phase3_business_idempotent_v101(
  p_user_id                uuid,
  p_challenge_id           uuid,
  p_client_request_id      uuid,
  p_processing_token       uuid,
  p_canonical_payload_hash text,
  p_installation_id        text,
  p_credential_id          text,
  p_public_key             text,
  p_sign_count             bigint,
  p_transports             text[],
  p_device_type            text,
  p_backed_up              boolean,
  p_post_payload           jsonb,
  p_server_fee_minor       bigint,
  p_ceremony_type          text,
  p_origin_gps             extensions.geography,
  p_origin_country_code    text,
  p_origin_timezone        text,
  p_night_policy_version   integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $fn$
DECLARE
  v_post_id          uuid;
  v_existing_post_id uuid;
  v_existing_hash    text;
  v_existing_status  text;
  v_existing_owner   uuid;
  v_stored_gps       extensions.geography;
  v_stored_cc        text;
  v_stored_tz        text;
  v_stored_night     integer;
  v_final_hash       text;
  v_expected_hash    text;
  v_complete         boolean;
  v_legacy           boolean;
  v_updated          integer;
  v_path             text; -- 'fresh' | 'complete_draft' | 'legacy_draft'
  v_cred_owner       uuid;
  v_cred_pk          text;
BEGIN
  IF p_user_id IS NULL OR p_client_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  END IF;

  -- Global client_request_id xact advisory lock BEFORE any posts read
  -- (same contract all writers; key must not include userId).
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'v101_publish_crid:' || p_client_request_id::text,
      0
    )
  );

  -- Ownership / authority classification first — before any challenge/passkey mutation.
  SELECT
    id, payload_hash, status, user_id,
    origin_gps, origin_country_code, origin_timezone, night_policy_version
  INTO
    v_existing_post_id, v_existing_hash, v_existing_status, v_existing_owner,
    v_stored_gps, v_stored_cc, v_stored_tz, v_stored_night
  FROM public.posts
  WHERE client_request_id = p_client_request_id
  FOR UPDATE;

  IF v_existing_post_id IS NOT NULL THEN
    IF v_existing_owner IS DISTINCT FROM p_user_id THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
    END IF;

    v_complete :=
      v_stored_gps IS NOT NULL
      AND v_stored_cc IS NOT NULL
      AND v_stored_tz IS NOT NULL;
    v_legacy :=
      v_stored_gps IS NULL
      AND v_stored_cc IS NULL
      AND v_stored_tz IS NULL
      AND v_stored_night IS NULL;

    IF NOT v_complete AND NOT v_legacy THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_partial_state');
    END IF;

    IF v_complete THEN
      v_expected_hash := public.trusted_publish_facts_hash_v101(
        p_canonical_payload_hash,
        v_stored_gps,
        v_stored_cc,
        v_stored_tz,
        v_stored_night
      );
      IF v_expected_hash IS NULL
         OR v_expected_hash IS DISTINCT FROM v_existing_hash THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
      END IF;

      -- Exact retry existing active: return duplicate WITHOUT consuming challenge.
      IF v_existing_status = 'active' THEN
        RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_existing_post_id);
      END IF;

      IF v_existing_status IS DISTINCT FROM 'draft' THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
      END IF;
      v_path := 'complete_draft';
    ELSIF v_legacy THEN
      IF v_existing_status IS DISTINCT FROM 'draft' THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_legacy_missing');
      END IF;
      IF v_existing_hash IS DISTINCT FROM p_canonical_payload_hash THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
      END IF;
      v_path := 'legacy_draft';
    END IF;
  ELSE
    v_path := 'fresh';
  END IF;

  -- Pre-mutation validation (fail closed before challenge/passkey/posts writes).
  IF p_ceremony_type IS DISTINCT FROM 'registration'
     AND p_ceremony_type IS DISTINCT FROM 'authentication' THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.passkey_transaction_failed');
  END IF;

  IF p_ceremony_type = 'registration' THEN
    IF p_credential_id IS NULL
       OR p_public_key IS NULL
       OR p_sign_count IS NULL
       OR p_device_type IS NULL
       OR p_backed_up IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.passkey_transaction_failed');
    END IF;
  ELSE
    IF p_credential_id IS NULL OR p_sign_count IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.authentication_credential_not_found');
    END IF;
  END IF;

  IF v_path IN ('fresh', 'legacy_draft') THEN
    v_final_hash := public.trusted_publish_facts_hash_v101(
      p_canonical_payload_hash,
      p_origin_gps,
      p_origin_country_code,
      p_origin_timezone,
      p_night_policy_version
    );
    IF v_final_hash IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.publish_authority_invalid');
    END IF;
  END IF;

  -- ── Mutation phase (nested subtransaction) ───────────────────────────────
  -- After challenge consume succeeds, failures MUST RAISE so this block rolls
  -- back challenge/profile/passkey/posts together. No plain failure RETURN here.
  BEGIN
    UPDATE public.auth_challenges
    SET status = 'consumed', used_at = NOW()
    WHERE id                 = p_challenge_id
      AND client_request_id  = p_client_request_id
      AND user_id            = p_user_id
      AND processing_token   = p_processing_token
      AND status             = 'processing';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'error.challenge_fencing_stale';
    END IF;

    IF p_ceremony_type = 'registration' THEN
      UPDATE public.profiles
      SET has_passkey = true, updated_at = NOW()
      WHERE id = p_user_id;

      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'error.passkey_transaction_failed';
      END IF;

      INSERT INTO public.passkeys (
        user_id, credential_id, public_key, sign_count,
        credential_device_type, credential_backed_up, created_at
      )
      VALUES (
        p_user_id, p_credential_id, p_public_key, p_sign_count,
        p_device_type, p_backed_up, NOW()
      )
      ON CONFLICT (credential_id) DO NOTHING;

      SELECT user_id, public_key
      INTO v_cred_owner, v_cred_pk
      FROM public.passkeys
      WHERE credential_id = p_credential_id
      FOR UPDATE;

      IF v_cred_owner IS NULL THEN
        RAISE EXCEPTION 'error.passkey_transaction_failed';
      END IF;
      IF v_cred_owner IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'error.security_boundary_compromised';
      END IF;
      IF v_cred_pk IS DISTINCT FROM p_public_key THEN
        RAISE EXCEPTION 'error.security_boundary_compromised';
      END IF;
    ELSE
      UPDATE public.passkeys
      SET sign_count = GREATEST(sign_count, p_sign_count), last_used_at = NOW()
      WHERE credential_id = p_credential_id AND user_id = p_user_id;

      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'error.authentication_credential_not_found';
      END IF;
    END IF;

    IF v_path = 'complete_draft' THEN
      UPDATE public.posts
      SET status = 'active', updated_at = NOW()
      WHERE id = v_existing_post_id
        AND user_id = p_user_id
        AND status = 'draft'
        AND payload_hash = v_existing_hash
        AND origin_gps IS NOT NULL
        AND origin_country_code IS NOT NULL
        AND origin_timezone IS NOT NULL;

      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'error.invalid_post_status';
      END IF;
      v_post_id := v_existing_post_id;

    ELSIF v_path = 'legacy_draft' THEN
      UPDATE public.posts
      SET
        status = 'active',
        payload_hash = v_final_hash,
        origin_gps = p_origin_gps,
        origin_country_code = p_origin_country_code,
        origin_timezone = p_origin_timezone,
        night_policy_version = p_night_policy_version,
        updated_at = NOW()
      WHERE id = v_existing_post_id
        AND user_id = p_user_id
        AND status = 'draft'
        AND payload_hash = p_canonical_payload_hash
        AND origin_gps IS NULL
        AND origin_country_code IS NULL
        AND origin_timezone IS NULL
        AND night_policy_version IS NULL;

      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'error.publish_authority_partial_state';
      END IF;
      v_post_id := v_existing_post_id;

    ELSE
      -- fresh: insert failure / unique_violation must abort entire RPC (no soft success)
      v_post_id := public.insert_stage1_post_v101(
        p_user_id,
        p_client_request_id,
        v_final_hash,
        'active',
        p_post_payload,
        p_server_fee_minor,
        NULL,
        p_origin_gps,
        p_origin_country_code,
        p_origin_timezone,
        p_night_policy_version
      );
    END IF;

    RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_post_id);

  EXCEPTION
    WHEN raise_exception THEN
      -- Nested block already rolled back challenge/profile/passkey/posts.
      -- Map only known stable keys; rethrow anything else so the whole RPC aborts.
      IF SQLERRM IN (
        'error.challenge_fencing_stale',
        'error.authentication_credential_not_found',
        'error.security_boundary_compromised',
        'error.idempotency_payload_conflict',
        'error.invalid_post_status',
        'error.publish_authority_invalid',
        'error.publish_authority_partial_state',
        'error.passkey_transaction_failed'
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error_msg', SQLERRM);
      END IF;
      RAISE;
    -- unique_violation and other DB errors are intentionally NOT caught here:
    -- they abort the nested subtransaction and then the outer function, rolling
    -- back challenge/passkey mutations. No duplicate-success after mutation.
  END;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. ACL — outer writers: service_role EXECUTE only; hash already revoked
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.publish_active_post_idempotent_v101(
  uuid, uuid, text, jsonb, bigint, extensions.geography, text, text, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_active_post_idempotent_v101(
  uuid, uuid, text, jsonb, bigint, extensions.geography, text, text, integer
) FROM anon;
REVOKE ALL ON FUNCTION public.publish_active_post_idempotent_v101(
  uuid, uuid, text, jsonb, bigint, extensions.geography, text, text, integer
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.publish_active_post_idempotent_v101(
  uuid, uuid, text, jsonb, bigint, extensions.geography, text, text, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.create_shadow_draft_idempotent_v101(
  uuid, uuid, text, text, jsonb, bigint, extensions.geography, text, text, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_shadow_draft_idempotent_v101(
  uuid, uuid, text, text, jsonb, bigint, extensions.geography, text, text, integer
) FROM anon;
REVOKE ALL ON FUNCTION public.create_shadow_draft_idempotent_v101(
  uuid, uuid, text, text, jsonb, bigint, extensions.geography, text, text, integer
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_shadow_draft_idempotent_v101(
  uuid, uuid, text, text, jsonb, bigint, extensions.geography, text, text, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.commit_phase3_business_idempotent_v101(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text,
  extensions.geography, text, text, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_phase3_business_idempotent_v101(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text,
  extensions.geography, text, text, integer
) FROM anon;
REVOKE ALL ON FUNCTION public.commit_phase3_business_idempotent_v101(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text,
  extensions.geography, text, text, integer
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.commit_phase3_business_idempotent_v101(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text,
  extensions.geography, text, text, integer
) TO service_role;

COMMIT;
