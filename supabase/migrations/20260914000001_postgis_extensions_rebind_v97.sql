-- MirioHub v97: rebind application routines after Supabase Support moves
-- PostGIS from public to extensions.
-- DO NOT RUN before Support confirms the move is complete.
BEGIN;

DO $guard$
DECLARE
  v_postgis_schema text;
  v_creation_enabled boolean;
BEGIN
  SELECT n.nspname INTO v_postgis_schema
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'postgis';

  IF v_postgis_schema IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION 'v97_guard: postgis must be in extensions; observed=%',
      COALESCE(v_postgis_schema, 'missing');
  END IF;
  IF to_regtype('extensions.geography') IS NULL
     OR to_regtype('extensions.geometry') IS NULL THEN
    RAISE EXCEPTION 'v97_guard: extensions PostGIS types missing';
  END IF;
  IF to_regclass('public.posts') IS NULL THEN
    RAISE EXCEPTION 'v97_guard: public.posts missing';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE a.attrelid = 'public.posts'::regclass
      AND a.attname IN ('origin_gps', 'destination_gps')
      AND a.attnum > 0 AND NOT a.attisdropped
      AND n.nspname = 'extensions'
      AND t.typname = 'geography'
      AND pg_catalog.format_type(a.atttypid, a.atttypmod) IN (
        'geography(Point,4326)',
        'extensions.geography(Point,4326)'
      )
  ) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'v97_guard: posts GPS type/typmod mismatch after move';
  END IF;

  SELECT c.matching_request_creation_enabled INTO v_creation_enabled
  FROM public.system_configs c WHERE c.id = 1;
  IF v_creation_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v97_guard: matching request creation must remain false';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'match_request_admission_post_facts_v95',
        'read_match_request_candidate_snapshot_v95',
        'nearby_local_posts'
      )
  ) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'v97_guard: expected application routine set mismatch';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.match_request_admission_post_facts_v95(
  p_id uuid,
  p_user_id uuid,
  p_post_type text,
  p_category text,
  p_status text,
  p_departure_date date,
  p_departure_time_window text,
  p_service_time_window text,
  p_transport_mode text,
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
  p_destination_gps extensions.geography
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $facts$
  SELECT jsonb_build_object(
    'id', p_id,
    'user_id', p_user_id,
    'post_type', p_post_type,
    'category', p_category,
    'status', p_status,
    'departure_date', p_departure_date,
    'departure_time_window', p_departure_time_window,
    'service_time_window', p_service_time_window,
    'transport_mode', p_transport_mode,
    'escort_seats', p_escort_seats,
    'max_companions', p_max_companions,
    'count_small', p_count_small,
    'count_medium', p_count_medium,
    'count_large', p_count_large,
    'count_xlarge', p_count_xlarge,
    'origin_address', p_origin_address,
    'destination_address', p_destination_address,
    'waypoints', p_waypoints,
    'origin_gps_ewkb', CASE
      WHEN p_origin_gps IS NULL THEN NULL
      ELSE encode(extensions.st_asewkb(p_origin_gps::extensions.geometry), 'hex')
    END,
    'destination_gps_ewkb', CASE
      WHEN p_destination_gps IS NULL THEN NULL
      ELSE encode(extensions.st_asewkb(p_destination_gps::extensions.geometry), 'hex')
    END
  );
$facts$;

CREATE OR REPLACE FUNCTION public.read_match_request_candidate_snapshot_v95(
  p_left_post_id uuid,
  p_right_post_id uuid
)
RETURNS TABLE (
  admission_facts_hash text,
  left_id uuid, left_user_id uuid, left_post_type text, left_category text,
  left_status text, left_departure_date text, left_departure_time_window text,
  left_service_time_window text, left_transport_mode text,
  left_escort_seats integer, left_max_companions integer,
  left_count_small integer, left_count_medium integer, left_count_large integer,
  left_count_xlarge integer, left_origin_address text,
  left_destination_address text, left_waypoints jsonb,
  left_origin_gps_ewkb text, left_destination_gps_ewkb text,
  left_origin_lat double precision, left_origin_lng double precision,
  left_destination_lat double precision, left_destination_lng double precision,
  right_id uuid, right_user_id uuid, right_post_type text, right_category text,
  right_status text, right_departure_date text, right_departure_time_window text,
  right_service_time_window text, right_transport_mode text,
  right_escort_seats integer, right_max_companions integer,
  right_count_small integer, right_count_medium integer, right_count_large integer,
  right_count_xlarge integer, right_origin_address text,
  right_destination_address text, right_waypoints jsonb,
  right_origin_gps_ewkb text, right_destination_gps_ewkb text,
  right_origin_lat double precision, right_origin_lng double precision,
  right_destination_lat double precision, right_destination_lng double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $snap$
  WITH pair AS MATERIALIZED (
    SELECT p.id, p.user_id, p.post_type, p.category, p.status,
      p.departure_date, p.departure_time_window, p.service_time_window,
      p.transport_mode, p.escort_seats, p.max_companions,
      p.count_small, p.count_medium, p.count_large, p.count_xlarge,
      p.origin_address, p.destination_address, p.waypoints,
      p.origin_gps, p.destination_gps
    FROM public.posts p
    WHERE p_left_post_id IS NOT NULL
      AND p_right_post_id IS NOT NULL
      AND p_left_post_id IS DISTINCT FROM p_right_post_id
      AND p.id IN (p_left_post_id, p_right_post_id)
  ),
  decorated AS MATERIALIZED (
    SELECT p.*,
      public.match_request_admission_post_facts_v95(
        p.id, p.user_id, p.post_type, p.category, p.status,
        p.departure_date, p.departure_time_window, p.service_time_window,
        p.transport_mode, p.escort_seats, p.max_companions,
        p.count_small, p.count_medium, p.count_large, p.count_xlarge,
        p.origin_address, p.destination_address, p.waypoints,
        p.origin_gps, p.destination_gps
      ) AS fact
    FROM pair p
  )
  SELECT
    public.match_request_admission_facts_hash_v95(
      (SELECT jsonb_agg(d.fact ORDER BY d.id) FROM decorated d)
    ),
    l.id, l.user_id, l.post_type, l.category, l.status,
    l.departure_date::text, l.departure_time_window, l.service_time_window,
    l.transport_mode, l.escort_seats, l.max_companions,
    l.count_small, l.count_medium, l.count_large, l.count_xlarge,
    l.origin_address, l.destination_address, l.waypoints,
    l.fact->>'origin_gps_ewkb', l.fact->>'destination_gps_ewkb',
    extensions.st_y(l.origin_gps::extensions.geometry),
    extensions.st_x(l.origin_gps::extensions.geometry),
    extensions.st_y(l.destination_gps::extensions.geometry),
    extensions.st_x(l.destination_gps::extensions.geometry),
    r.id, r.user_id, r.post_type, r.category, r.status,
    r.departure_date::text, r.departure_time_window, r.service_time_window,
    r.transport_mode, r.escort_seats, r.max_companions,
    r.count_small, r.count_medium, r.count_large, r.count_xlarge,
    r.origin_address, r.destination_address, r.waypoints,
    r.fact->>'origin_gps_ewkb', r.fact->>'destination_gps_ewkb',
    extensions.st_y(r.origin_gps::extensions.geometry),
    extensions.st_x(r.origin_gps::extensions.geometry),
    extensions.st_y(r.destination_gps::extensions.geometry),
    extensions.st_x(r.destination_gps::extensions.geometry)
  FROM decorated l
  JOIN decorated r ON r.id = p_right_post_id
  WHERE l.id = p_left_post_id
    AND (SELECT count(*) FROM decorated) = 2;
$snap$;

CREATE OR REPLACE FUNCTION public.nearby_local_posts(
  p_lng double precision,
  p_lat double precision,
  p_limit integer DEFAULT 60
)
RETURNS TABLE (id uuid, distance_m double precision)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $nearby$
  SELECT p.id,
    extensions.st_distance(
      COALESCE(p.origin_gps, p.destination_gps),
      extensions.st_setsrid(
        extensions.st_makepoint(p_lng, p_lat), 4326
      )::extensions.geography
    ) AS distance_m
  FROM public.posts p
  WHERE p.status = 'active'
    AND p.category IN ('buy', 'onsite', 'errand')
    AND COALESCE(p.origin_gps, p.destination_gps) IS NOT NULL
    AND extensions.st_dwithin(
      COALESCE(p.origin_gps, p.destination_gps),
      extensions.st_setsrid(
        extensions.st_makepoint(p_lng, p_lat), 4326
      )::extensions.geography,
      50000
    )
  ORDER BY distance_m ASC
  LIMIT greatest(1, least(COALESCE(p_limit, 60), 200));
$nearby$;

COMMIT;
