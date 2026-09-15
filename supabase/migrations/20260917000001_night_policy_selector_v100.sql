-- PHASE 6.7C.2C.3C / v100 — deterministic night policy selector.
-- Forward-only. Does not modify night_service_policies rows or table DDL.
-- Does not enable matching creation. Does not enable RS night.
-- Does not create tables/policies/triggers/sequences.
-- MANUAL APPLY REQUIRED. Do not auto-apply from Cursor.
-- Explicit BEGIN/COMMIT. If a statement fails, execute ROLLBACK.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Fail-fast deployed-boundary guard
-- Does not output policy rows or other business content.
-- Does not depend on schema_migrations history.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_missing text;
  v_typ text;
  v_rls boolean;
  v_force boolean;
  v_enabled boolean;
  v_tz text;
  v_ver integer;
  v_creation boolean;
  v_priv text;
  v_seed_n integer;
  v_blocked_start time;
  v_blocked_end time;
  v_eff_from timestamptz;
  v_eff_until timestamptz;
  v_cfg_n integer;
BEGIN
  IF to_regclass('public.night_service_policies') IS NULL THEN
    RAISE EXCEPTION 'v100_guard: night_service_policies missing';
  END IF;

  SELECT a.attname INTO v_missing
  FROM (
    VALUES
      ('id'),
      ('country_code'),
      ('region_code'),
      ('timezone_name'),
      ('blocked_start_local'),
      ('blocked_end_local'),
      ('enabled'),
      ('policy_version'),
      ('effective_from'),
      ('effective_until')
  ) AS need(attname)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.night_service_policies'::regclass
      AND a.attname = need.attname
      AND a.attnum > 0
      AND NOT a.attisdropped
  )
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'v100_guard: night_service_policies column missing: %', v_missing;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_typ
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.night_service_policies'::regclass
    AND a.attname = 'country_code'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_typ IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'v100_guard: country_code type drift: %', v_typ;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_typ
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.night_service_policies'::regclass
    AND a.attname = 'region_code'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_typ IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'v100_guard: region_code type drift: %', v_typ;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_typ
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.night_service_policies'::regclass
    AND a.attname = 'timezone_name'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_typ IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'v100_guard: timezone_name type drift: %', v_typ;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_typ
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.night_service_policies'::regclass
    AND a.attname = 'enabled'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_typ IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'v100_guard: enabled type drift: %', v_typ;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_typ
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.night_service_policies'::regclass
    AND a.attname = 'policy_version'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_typ IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION 'v100_guard: policy_version type drift: %', v_typ;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_typ
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.night_service_policies'::regclass
    AND a.attname = 'effective_from'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_typ IS DISTINCT FROM 'timestamp with time zone' THEN
    RAISE EXCEPTION 'v100_guard: effective_from type drift: %', v_typ;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_typ
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.night_service_policies'::regclass
    AND a.attname = 'effective_until'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_typ IS DISTINCT FROM 'timestamp with time zone' THEN
    RAISE EXCEPTION 'v100_guard: effective_until type drift: %', v_typ;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_typ
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.night_service_policies'::regclass
    AND a.attname = 'blocked_start_local'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_typ IS DISTINCT FROM 'time without time zone' THEN
    RAISE EXCEPTION 'v100_guard: blocked_start_local type drift: %', v_typ;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_typ
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.night_service_policies'::regclass
    AND a.attname = 'blocked_end_local'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_typ IS DISTINCT FROM 'time without time zone' THEN
    RAISE EXCEPTION 'v100_guard: blocked_end_local type drift: %', v_typ;
  END IF;

  SELECT c.relrowsecurity, c.relforcerowsecurity
  INTO v_rls, v_force
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'night_service_policies'
    AND c.relkind = 'r';
  IF v_rls IS NOT TRUE THEN
    RAISE EXCEPTION 'v100_guard: night_service_policies RLS not enabled';
  END IF;
  IF v_force IS TRUE THEN
    RAISE EXCEPTION 'v100_guard: night_service_policies FORCE RLS must be off';
  END IF;

  SELECT a.privilege_type INTO v_priv
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(c.relacl, pg_catalog.acldefault('r'::"char", c.relowner))
  ) a
  JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
  WHERE n.nspname = 'public'
    AND c.relname = 'night_service_policies'
    AND c.relkind = 'r'
    AND r.rolname IN ('anon', 'authenticated', 'service_role')
  LIMIT 1;
  IF v_priv IS NOT NULL THEN
    RAISE EXCEPTION 'v100_guard: night_service_policies app-role privilege present';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(c.relacl, pg_catalog.acldefault('r'::"char", c.relowner))
    ) a
    WHERE n.nspname = 'public'
      AND c.relname = 'night_service_policies'
      AND c.relkind = 'r'
      AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'v100_guard: night_service_policies PUBLIC privilege present';
  END IF;

  -- Exact RS country-default seed version 1 only (future RS versions allowed).
  SELECT count(*)::int INTO v_seed_n
  FROM public.night_service_policies p
  WHERE p.country_code = 'RS'
    AND p.region_code IS NULL
    AND p.policy_version = 1;
  IF v_seed_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'v100_guard: RS seed version 1 row_count must be 1 (got %)', v_seed_n;
  END IF;

  SELECT
    p.enabled,
    p.timezone_name,
    p.policy_version,
    p.blocked_start_local,
    p.blocked_end_local,
    p.effective_from,
    p.effective_until
  INTO
    v_enabled,
    v_tz,
    v_ver,
    v_blocked_start,
    v_blocked_end,
    v_eff_from,
    v_eff_until
  FROM public.night_service_policies p
  WHERE p.country_code = 'RS'
    AND p.region_code IS NULL
    AND p.policy_version = 1;
  IF v_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v100_guard: RS seed enabled must be false';
  END IF;
  IF v_tz IS DISTINCT FROM 'Europe/Belgrade' THEN
    RAISE EXCEPTION 'v100_guard: RS seed timezone drift';
  END IF;
  IF v_ver IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'v100_guard: RS seed policy_version must be 1';
  END IF;
  IF v_blocked_start IS DISTINCT FROM TIME '22:00' THEN
    RAISE EXCEPTION 'v100_guard: RS seed blocked_start_local drift';
  END IF;
  IF v_blocked_end IS DISTINCT FROM TIME '06:00' THEN
    RAISE EXCEPTION 'v100_guard: RS seed blocked_end_local drift';
  END IF;
  IF v_eff_from IS NULL THEN
    RAISE EXCEPTION 'v100_guard: RS seed effective_from must be set';
  END IF;
  IF v_eff_until IS NOT NULL THEN
    RAISE EXCEPTION 'v100_guard: RS seed effective_until must be NULL';
  END IF;

  IF to_regclass('public.system_configs') IS NULL THEN
    RAISE EXCEPTION 'v100_guard: system_configs missing';
  END IF;
  SELECT count(*)::int INTO v_cfg_n
  FROM public.system_configs
  WHERE id = 1;
  IF v_cfg_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'v100_guard: system_configs id=1 must exist exactly once (got %)', v_cfg_n;
  END IF;
  SELECT matching_request_creation_enabled INTO v_creation
  FROM public.system_configs
  WHERE id = 1;
  IF v_creation IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v100_guard: matching_request_creation_enabled must be false';
  END IF;

  IF to_regprocedure(
    'public.match_request_admission_post_facts_v99(uuid,uuid,text,text,text,date,text,text,text,text,integer,integer,integer,integer,integer,integer,text,text,jsonb,extensions.geography,extensions.geography,text,text,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v100_guard: v99A facts helper missing';
  END IF;
  IF to_regprocedure(
    'public.match_request_admission_facts_hash_v99(jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v100_guard: v99A hash helper missing';
  END IF;
  IF to_regprocedure(
    'public.read_match_request_candidate_snapshot_v99(uuid,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v100_guard: v99A snapshot missing';
  END IF;
  IF to_regprocedure(
    'public.create_match_request_v99(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,bigint,text,bigint,bigint,integer,integer,integer,text,boolean,boolean)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v100_guard: create_match_request_v99 missing';
  END IF;

  IF to_regprocedure(
    'public.select_night_service_policy_v100(text,text,text,timestamptz)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v100_guard: select_night_service_policy_v100 already exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'select_night_service_policy_v101'
  ) THEN
    RAISE EXCEPTION 'v100_guard: select_night_service_policy_v101 must not exist';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Selector only — no table DDL, no seed mutation
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.select_night_service_policy_v100(
  p_country_code text,
  p_region_code text,
  p_origin_timezone text,
  p_evaluation_time timestamptz
)
RETURNS TABLE (
  policy_id uuid,
  country_code text,
  region_code text,
  timezone_name text,
  blocked_start_local time without time zone,
  blocked_end_local time without time zone,
  policy_version integer,
  effective_from timestamptz,
  effective_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $fn$
  SELECT
    p.id AS policy_id,
    p.country_code,
    p.region_code,
    p.timezone_name,
    p.blocked_start_local,
    p.blocked_end_local,
    p.policy_version,
    p.effective_from,
    p.effective_until
  FROM public.night_service_policies AS p
  WHERE
    p_country_code IS NOT NULL
    AND p_country_code = btrim(p_country_code)
    AND p_country_code ~ '^[A-Z]{2}$'
    AND (
      p_region_code IS NULL
      OR (
        p_region_code = btrim(p_region_code)
        AND char_length(p_region_code) BETWEEN 1 AND 64
      )
    )
    AND p_origin_timezone IS NOT NULL
    AND p_origin_timezone = btrim(p_origin_timezone)
    AND char_length(p_origin_timezone) BETWEEN 1 AND 100
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_timezone_names AS tz
      WHERE tz.name = p_origin_timezone
    )
    AND p_evaluation_time IS NOT NULL
    AND p.enabled IS TRUE
    AND p.country_code = p_country_code
    AND p.effective_from <= p_evaluation_time
    AND (
      p.effective_until IS NULL
      OR p_evaluation_time < p.effective_until
    )
    AND p.timezone_name = p_origin_timezone
    AND (
      CASE
        WHEN p_region_code IS NOT NULL THEN
          (p.region_code = p_region_code OR p.region_code IS NULL)
        ELSE
          (p.region_code IS NULL)
      END
    )
  ORDER BY
    CASE WHEN p.region_code IS NOT NULL THEN 0 ELSE 1 END ASC,
    p.policy_version DESC,
    p.effective_from DESC,
    p.id ASC
  LIMIT 1;
$fn$;

COMMENT ON FUNCTION public.select_night_service_policy_v100(text, text, text, timestamptz) IS
  'v100 fail-closed night policy selector. Exact region beats country default; enabled only; inclusive effective_from; exclusive effective_until; timezone exact match via pg_timezone_names. service_role EXECUTE only.';

REVOKE ALL ON FUNCTION public.select_night_service_policy_v100(text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.select_night_service_policy_v100(text, text, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.select_night_service_policy_v100(text, text, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.select_night_service_policy_v100(text, text, text, timestamptz) TO service_role;

COMMIT;
