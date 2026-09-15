-- PHASE 6.7C.2C.1 / v99A — match admission authority facts, hash, snapshot.
-- Forward-only. Does not CREATE OR REPLACE v95 functions.
-- Does not create create_match_request_v99 (writer deferred).
-- MANUAL APPLY REQUIRED. Do not auto-apply from Cursor.
-- Does not enable matching creation. Does not enable night policy.
-- PostGIS types/functions use extensions. schema (post-v97).
-- Does not infer country/timezone/policy from NULL (v98 still writes NULL).

BEGIN;

DO $$
BEGIN
  IF to_regprocedure(
    'public.match_request_admission_post_facts_v99(uuid,uuid,text,text,text,date,text,text,text,text,integer,integer,integer,integer,integer,integer,text,text,jsonb,extensions.geography,extensions.geography,text,text,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v99 match_request_admission_post_facts_v99 already exists — refuse re-apply';
  END IF;
  IF to_regprocedure(
    'public.match_request_admission_facts_hash_v99(jsonb)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v99 match_request_admission_facts_hash_v99 already exists — refuse re-apply';
  END IF;
  IF to_regprocedure(
    'public.read_match_request_candidate_snapshot_v99(uuid,uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v99 read_match_request_candidate_snapshot_v99 already exists — refuse re-apply';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_match_request_v99'
  ) THEN
    RAISE EXCEPTION 'v99 create_match_request_v99 must not exist in v99A — refuse';
  END IF;
  IF to_regclass('public.posts') IS NULL THEN
    RAISE EXCEPTION 'public.posts missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts'
      AND column_name = 'service_subtype'
  ) THEN
    RAISE EXCEPTION 'posts.service_subtype missing — apply v96 first';
  END IF;
  IF to_regprocedure(
    'public.match_request_admission_post_facts_v95(uuid,uuid,text,text,text,date,text,text,text,integer,integer,integer,integer,integer,integer,text,text,jsonb,extensions.geography,extensions.geography)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v95 facts helper missing (post-v97 identity) — refuse v99A';
  END IF;
  IF to_regprocedure(
    'public.read_match_request_candidate_snapshot_v95(uuid,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v95 snapshot missing — refuse v99A';
  END IF;
  IF to_regprocedure(
    'public.match_request_admission_facts_hash_v95(jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v95 hash helper missing — refuse v99A';
  END IF;
END;
$$;

-- ── Single-post admission facts (no SELECT on posts) ────────────────────────

CREATE FUNCTION public.match_request_admission_post_facts_v99(
  p_id uuid,
  p_user_id uuid,
  p_post_type text,
  p_category text,
  p_status text,
  p_departure_date date,
  p_departure_time_window text,
  p_service_time_window text,
  p_transport_mode text,
  p_service_subtype text,
  p_escort_seats integer,
  p_max_companions integer,
  p_count_small integer,
  p_count_medium integer,
  p_count_large integer,
  p_count_xlarge integer,
  p_origin_address text,
  p_destination_address text,
  p_waypoints jsonb,
  p_origin_gps extensions.geography,
  p_destination_gps extensions.geography,
  p_origin_country_code text,
  p_origin_timezone text,
  p_night_policy_version integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $facts$
  SELECT jsonb_build_object(
    'admission_schema_version', 99,
    'id', p_id,
    'user_id', p_user_id,
    'post_type', p_post_type,
    'category', p_category,
    'status', p_status,
    'departure_date', p_departure_date,
    'departure_time_window', p_departure_time_window,
    'service_time_window', p_service_time_window,
    'transport_mode', p_transport_mode,
    'service_subtype', p_service_subtype,
    'escort_seats', p_escort_seats,
    'max_companions', p_max_companions,
    'count_small', p_count_small,
    'count_medium', p_count_medium,
    'count_large', p_count_large,
    'count_xlarge', p_count_xlarge,
    'origin_address', p_origin_address,
    'destination_address', p_destination_address,
    'waypoints', p_waypoints,
    'origin_gps_ewkb',
      CASE
        WHEN p_origin_gps IS NULL THEN NULL
        ELSE encode(extensions.st_asewkb(p_origin_gps::extensions.geometry), 'hex')
      END,
    'destination_gps_ewkb',
      CASE
        WHEN p_destination_gps IS NULL THEN NULL
        ELSE encode(extensions.st_asewkb(p_destination_gps::extensions.geometry), 'hex')
      END,
    'origin_country_code', p_origin_country_code,
    'origin_timezone', p_origin_timezone,
    'night_policy_version', p_night_policy_version
  );
$facts$;

COMMENT ON FUNCTION public.match_request_admission_post_facts_v99(
  uuid, uuid, text, text, text, date, text, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, jsonb,
  extensions.geography, extensions.geography, text, text, integer
) IS
  'v99A: builds one post admission jsonb from already-read columns. Does not read posts. NULL and empty string stay distinct. admission_schema_version=99. Browser country/timezone/policy are not authority.';

REVOKE ALL ON FUNCTION public.match_request_admission_post_facts_v99(
  uuid, uuid, text, text, text, date, text, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, jsonb,
  extensions.geography, extensions.geography, text, text, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_request_admission_post_facts_v99(
  uuid, uuid, text, text, text, date, text, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, jsonb,
  extensions.geography, extensions.geography, text, text, integer
) FROM anon;
REVOKE ALL ON FUNCTION public.match_request_admission_post_facts_v99(
  uuid, uuid, text, text, text, date, text, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, jsonb,
  extensions.geography, extensions.geography, text, text, integer
) FROM authenticated;
REVOKE ALL ON FUNCTION public.match_request_admission_post_facts_v99(
  uuid, uuid, text, text, text, date, text, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, jsonb,
  extensions.geography, extensions.geography, text, text, integer
) FROM service_role;
GRANT EXECUTE ON FUNCTION public.match_request_admission_post_facts_v99(
  uuid, uuid, text, text, text, date, text, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, jsonb,
  extensions.geography, extensions.geography, text, text, integer
) TO service_role;

-- ── Pair hash (exactly two facts, id-ordered by caller) ─────────────────────

CREATE FUNCTION public.match_request_admission_facts_hash_v99(p_facts jsonb)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $hash$
  SELECT CASE
    WHEN p_facts IS NULL
      OR jsonb_typeof(p_facts) IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_facts) IS DISTINCT FROM 2
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_facts) AS t(fact)
        WHERE t.fact->>'id' IS NULL
          OR (t.fact->>'admission_schema_version') IS DISTINCT FROM '99'
      )
      OR (
        SELECT count(DISTINCT t.fact->>'id')
        FROM jsonb_array_elements(p_facts) AS t(fact)
      ) IS DISTINCT FROM 2
    THEN NULL
    ELSE encode(
      extensions.digest(convert_to(p_facts::text, 'UTF8'), 'sha256'),
      'hex'
    )
  END;
$hash$;

COMMENT ON FUNCTION public.match_request_admission_facts_hash_v99(jsonb) IS
  'v99A: SHA-256 of a two-element admission facts jsonb array (UTF-8). Requires admission_schema_version=99 and two distinct non-NULL ids. Does not read posts.';

REVOKE ALL ON FUNCTION public.match_request_admission_facts_hash_v99(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_request_admission_facts_hash_v99(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.match_request_admission_facts_hash_v99(jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.match_request_admission_facts_hash_v99(jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.match_request_admission_facts_hash_v99(jsonb) TO service_role;

-- ── Atomic candidate snapshot (one posts read) ──────────────────────────────

CREATE FUNCTION public.read_match_request_candidate_snapshot_v99(
  p_left_post_id uuid,
  p_right_post_id uuid
)
RETURNS TABLE (
  admission_facts_hash text,
  left_id uuid,
  left_user_id uuid,
  left_post_type text,
  left_category text,
  left_status text,
  left_departure_date text,
  left_departure_time_window text,
  left_service_time_window text,
  left_transport_mode text,
  left_escort_seats integer,
  left_max_companions integer,
  left_count_small integer,
  left_count_medium integer,
  left_count_large integer,
  left_count_xlarge integer,
  left_origin_address text,
  left_destination_address text,
  left_waypoints jsonb,
  left_origin_gps_ewkb text,
  left_destination_gps_ewkb text,
  left_origin_lat double precision,
  left_origin_lng double precision,
  left_destination_lat double precision,
  left_destination_lng double precision,
  left_service_subtype text,
  left_origin_country_code text,
  left_origin_timezone text,
  left_night_policy_version integer,
  right_id uuid,
  right_user_id uuid,
  right_post_type text,
  right_category text,
  right_status text,
  right_departure_date text,
  right_departure_time_window text,
  right_service_time_window text,
  right_transport_mode text,
  right_escort_seats integer,
  right_max_companions integer,
  right_count_small integer,
  right_count_medium integer,
  right_count_large integer,
  right_count_xlarge integer,
  right_origin_address text,
  right_destination_address text,
  right_waypoints jsonb,
  right_origin_gps_ewkb text,
  right_destination_gps_ewkb text,
  right_origin_lat double precision,
  right_origin_lng double precision,
  right_destination_lat double precision,
  right_destination_lng double precision,
  right_service_subtype text,
  right_origin_country_code text,
  right_origin_timezone text,
  right_night_policy_version integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $snap$
  WITH pair AS MATERIALIZED (
    SELECT
      p.id,
      p.user_id,
      p.post_type,
      p.category,
      p.status,
      p.departure_date,
      p.departure_time_window,
      p.service_time_window,
      p.transport_mode,
      p.service_subtype,
      p.escort_seats,
      p.max_companions,
      p.count_small,
      p.count_medium,
      p.count_large,
      p.count_xlarge,
      p.origin_address,
      p.destination_address,
      p.waypoints,
      p.origin_gps,
      p.destination_gps,
      p.origin_country_code,
      p.origin_timezone,
      p.night_policy_version
    FROM public.posts p
    WHERE p_left_post_id IS NOT NULL
      AND p_right_post_id IS NOT NULL
      AND p_left_post_id IS DISTINCT FROM p_right_post_id
      AND p.id IN (p_left_post_id, p_right_post_id)
  ),
  decorated AS MATERIALIZED (
    SELECT
      p.*,
      public.match_request_admission_post_facts_v99(
        p.id,
        p.user_id,
        p.post_type,
        p.category,
        p.status,
        p.departure_date,
        p.departure_time_window,
        p.service_time_window,
        p.transport_mode,
        p.service_subtype,
        p.escort_seats,
        p.max_companions,
        p.count_small,
        p.count_medium,
        p.count_large,
        p.count_xlarge,
        p.origin_address,
        p.destination_address,
        p.waypoints,
        p.origin_gps,
        p.destination_gps,
        p.origin_country_code,
        p.origin_timezone,
        p.night_policy_version
      ) AS fact
    FROM pair p
  )
  SELECT
    public.match_request_admission_facts_hash_v99(
      (SELECT jsonb_agg(d.fact ORDER BY d.id) FROM decorated d)
    ),
    l.id,
    l.user_id,
    l.post_type,
    l.category,
    l.status,
    l.departure_date::text,
    l.departure_time_window,
    l.service_time_window,
    l.transport_mode,
    l.escort_seats,
    l.max_companions,
    l.count_small,
    l.count_medium,
    l.count_large,
    l.count_xlarge,
    l.origin_address,
    l.destination_address,
    l.waypoints,
    l.fact->>'origin_gps_ewkb',
    l.fact->>'destination_gps_ewkb',
    extensions.st_y(l.origin_gps::extensions.geometry),
    extensions.st_x(l.origin_gps::extensions.geometry),
    extensions.st_y(l.destination_gps::extensions.geometry),
    extensions.st_x(l.destination_gps::extensions.geometry),
    l.service_subtype,
    l.origin_country_code,
    l.origin_timezone,
    l.night_policy_version,
    r.id,
    r.user_id,
    r.post_type,
    r.category,
    r.status,
    r.departure_date::text,
    r.departure_time_window,
    r.service_time_window,
    r.transport_mode,
    r.escort_seats,
    r.max_companions,
    r.count_small,
    r.count_medium,
    r.count_large,
    r.count_xlarge,
    r.origin_address,
    r.destination_address,
    r.waypoints,
    r.fact->>'origin_gps_ewkb',
    r.fact->>'destination_gps_ewkb',
    extensions.st_y(r.origin_gps::extensions.geometry),
    extensions.st_x(r.origin_gps::extensions.geometry),
    extensions.st_y(r.destination_gps::extensions.geometry),
    extensions.st_x(r.destination_gps::extensions.geometry),
    r.service_subtype,
    r.origin_country_code,
    r.origin_timezone,
    r.night_policy_version
  FROM decorated l
  JOIN decorated r ON r.id = p_right_post_id
  WHERE l.id = p_left_post_id
    AND (SELECT count(*) FROM decorated) = 2;
$snap$;

COMMENT ON FUNCTION public.read_match_request_candidate_snapshot_v99(uuid, uuid) IS
  'v99A: single SQL statement. One MATERIALIZED posts read. Returned fields and admission_facts_hash come from that CTE. Hash order is post id ascending. Missing/duplicate ids return no row. Does not run night policy. Does not write business data. Not applied until user runs migration.';

REVOKE ALL ON FUNCTION public.read_match_request_candidate_snapshot_v99(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_match_request_candidate_snapshot_v99(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.read_match_request_candidate_snapshot_v99(uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.read_match_request_candidate_snapshot_v99(uuid, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.read_match_request_candidate_snapshot_v99(uuid, uuid) TO service_role;

COMMIT;
